// 엑셀 명부 한 장을 붙여넣어 가게를 한 번에 등록한다.
//
// 상인회는 이미 명부를 갖고 있다. 실제로 받은 방배카페골목 명부는 114줄이었고,
// 상호·대표자·전화번호·주소·업종이 다 들어 있었다. 그런데 그걸 두고도 한 곳씩 손으로
// 다시 쳐야 했다 — 114번이다. 거기서 대부분 그만둔다.
//
// 그래서 이 파일이 재는 것은 "붙여넣으면 들어가는가" 가 아니라,
// **엑셀이 망가뜨려 놓은 것을 되돌리는가**, 그리고 **되돌리다가 더 나쁜 짓을 하지 않는가** 다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { parseMemberRoster, restorePhone, mapCategory, withPrefix, guessPrefix, describeColumns, inferRosterColumns, IMPORT_MAX } from "../src/roster.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
const get = async (env, j, p) => { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; };
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
const IMPORT = "/t/bb/admin/members/import";
async function seed(env, slug = "bb") {
  const a = await D.createAssociation(env.DB, { slug, name: "방배카페골목 상인회", kind: "merchant" });
  await D.updateAssociation(env.DB, a.id, { name: a.name, tagline: "", brand_color: "#1F6CFF",
    phone: "", email: "", address: "서울특별시 서초구 방배중앙로 166", logo: "", hero_image: "" }).catch(() => {});
  const p = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: `a@${slug}.kr`, passwordHash: p.hash, salt: p.salt, name: "회장", role: "ADMIN", associationId: a.id });
  return a;
}
const login = async (env, slug = "bb") => {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, `/t/${slug}/login`)).text()) || [])[1];
  await post(env, j, `/t/${slug}/login`, { login: `a@${slug}.kr`, password: "admin1234" }, `/t/${slug}/login`).catch(() => {});
  await worker.fetch(new Request(B + `/t/${slug}/login`, { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, login: `a@${slug}.kr`, password: "admin1234" }).toString() }), env)
    .then((r) => absorb(j, r));
  return j;
};

// 실제로 받은 명부의 모양 그대로 — 제목 줄이 맨 위에 한 칸만 채워져 붙어 오고,
// 전화번호는 엑셀이 앞의 0 을 지운 채로 들어 있다.
const REAL = [
  "카페골목 상가번영회 회원명부\t\t\t\t\t",
  "연번\t상호\t대표자\t전화번호\t주소\t업종",
  "1\t2001호텔\t송우진\t1099117118\t 방배중앙로 174\t숙박업",
  "2\tCAN\t이지영\t1032887215\t 방배중앙로25길 16\t제조업",
  "3\tGS더프레시\t최민우\t1026455916\t 동광로 35\t편의점",
  "4\tSBS노래빵\t허만경\t1045007647\t 방배중앙로27길 9\t노래방",
  "5\t버들카페\t김방배\t1012345678\t 방배중앙로 100\t카페",
].join("\n");

// ── 엑셀이 지운 0 ────────────────────────────────────────────────────────
test("엑셀이 지운 맨 앞 0 을 되살린다", () => {
  assert.equal(restorePhone("1099117118").phone, "01099117118");
  assert.equal(restorePhone("1099117118").fixed, true);
  // 아홉 자리 유선번호도 같은 사고를 겪는다 (02-555-1234 → 25551234 … 는 8자리라 제외,
  // 서울 외 지역번호는 열 자리다)
  assert.equal(restorePhone("315551234").phone, "0315551234");
});

test("멀쩡한 번호는 건드리지 않는다", () => {
  // 되돌리기가 멀쩡한 것을 망가뜨리면 안 된다 — 그 편이 훨씬 나쁘다
  assert.deepEqual(restorePhone("010-1234-5678"), { phone: "01012345678", fixed: false });
  assert.deepEqual(restorePhone("01012345678"), { phone: "01012345678", fixed: false });
  assert.equal(restorePhone("").phone, "");
});

test("1588 같은 대표번호에는 0 을 붙이지 않는다", () => {
  assert.deepEqual(restorePhone("15881234"), { phone: "15881234", fixed: false });
  assert.deepEqual(restorePhone("1600-9280"), { phone: "16009280", fixed: false });
});

// ── 업종 묶기 ────────────────────────────────────────────────────────────
test("상인회가 쓰는 27가지 업종이 손님 화면의 일곱 분류로 묶인다", () => {
  const pairs = [
    ["음식업", "음식점"], ["주점", "음식점"], ["카페", "카페·디저트"], ["제빵", "카페·디저트"],
    ["떡집", "카페·디저트"], ["정육점", "농수축산"], ["노래방", "생활·서비스"],
    ["부동산", "생활·서비스"], ["미용실", "생활·서비스"], ["안경점", "패션·잡화"],
    ["의류", "패션·잡화"], ["태권도", "교육·문화"], ["스포츠", "교육·문화"],
    ["편의점", "생활·서비스"], ["숙박업", "생활·서비스"], ["한의원", "생활·서비스"],
  ];
  for (const [raw, want] of pairs) assert.equal(mapCategory(raw), want, `${raw} → ${mapCategory(raw)} (기대: ${want})`);
});

test("모르는 업종은 지어내지 않고 '기타' 로 둔다", () => {
  assert.equal(mapCategory("?"), "기타");
  assert.equal(mapCategory(""), "기타");
  assert.equal(mapCategory("우주정거장"), "기타");
});

test("'정육식당' 은 식당이고 '정육점' 은 농수축산이다", () => {
  // 더 좁은 규칙이 위에 있어야 한다. 순서가 뒤집히면 고깃집이 전부 정육점이 된다.
  assert.equal(mapCategory("정육식당"), "음식점");
  assert.equal(mapCategory("정육점"), "농수축산");
});

// ── 주소 앞머리 ──────────────────────────────────────────────────────────
test("동네 안에서만 통하는 주소 앞에 시·구를 붙인다", () => {
  // "방배중앙로 174" 만으로는 지도가 못 찾는다 — 전국에 같은 이름의 길이 있다
  assert.equal(withPrefix("방배중앙로 174", "서울 서초구"), "서울 서초구 방배중앙로 174");
  // 이미 붙어 있으면 두 번 붙이지 않는다
  assert.equal(withPrefix("서울 서초구 방배중앙로 174", "서울 서초구"), "서울 서초구 방배중앙로 174");
  assert.equal(withPrefix("서초구 방배동 769-10", "서울 서초구"), "서초구 방배동 769-10");
  assert.equal(withPrefix("", "서울 서초구"), "");
});

test("상인회 주소에서 시·구를 뽑아 기본값으로 쓴다", () => {
  assert.equal(guessPrefix("서울특별시 서초구 방배중앙로 166, 4층"), "서울특별시 서초구");
  assert.equal(guessPrefix("방배동"), "");
});

// ── 명부 읽기 ────────────────────────────────────────────────────────────
test("맨 위의 제목 줄을 건너뛰고 머리글을 찾는다", () => {
  // 명부 첫 줄은 대개 "○○ 회원명부" 한 칸이다. 그걸 머리글로 읽으면 전부 실패한다.
  const r = parseMemberRoster(REAL, { prefix: "서울 서초구" });
  assert.ok(!r.error, r.error);
  assert.equal(r.rows.length, 5);
  assert.equal(r.rows[0].name, "2001호텔");
  assert.equal(r.rows[0].owner, "송우진");
  assert.equal(r.rows[0].phone, "01099117118");
  assert.equal(r.rows[0].phoneFixed, true);
  assert.equal(r.rows[0].address, "서울 서초구 방배중앙로 174");
  assert.equal(r.rows[0].category, "생활·서비스");
  assert.equal(r.rows[0].rawCat, "숙박업", "원래 업종을 함께 남겨야 회장님이 확인할 수 있다");
});

test("상호 칸이 없으면 무엇을 고쳐야 하는지 말하고 멈춘다", () => {
  const r = parseMemberRoster("이름\t번호\n김씨\t010-1111-2222");
  assert.ok(r.error);
  assert.match(r.error, /상호/);
});

test("한 명부에 같은 상호가 두 번 있으면 뒤엣것을 막는다", () => {
  const r = parseMemberRoster("상호\t대표자\n버들카페\t김방배\n버들카페\t이서초");
  assert.equal(r.rows[0].status, "ok");
  assert.equal(r.rows[1].status, "bad");
  assert.match(r.rows[1].note, /같은 상호/);
});

test("너무 긴 명부는 나눠 넣으라고 말한다", () => {
  const many = ["상호\t대표자", ...Array.from({ length: IMPORT_MAX + 1 }, (_, i) => `가게${i}\t김${i}`)].join("\n");
  const r = parseMemberRoster(many);
  assert.ok(r.error);
  assert.match(r.error, new RegExp(String(IMPORT_MAX)));
});

test("상호 한 칸짜리 명부도 받는다", () => {
  // 화면에 "상호 한 칸만 있으면 됩니다" 라고 적어 두었다. 제목 줄 건너뛰기를
  // '칸 수' 로 풀면 이 명부가 통째로 사라진다 — 실제로 한 번 그렇게 짰다가 잡혔다.
  const r = parseMemberRoster("우리 상인회 명부\n상호\n버들카페\n너나들이");
  assert.ok(!r.error, r.error);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].name, "버들카페");
  assert.equal(r.rows[0].category, "기타", "업종을 모르면 지어내지 않는다");
});

test("명부의 '?' 를 그대로 넣지 않는다", () => {
  // 명부에서 '?' 는 "아직 안 알아봤다" 는 뜻이다. 손님 화면에 물음표가 뜨면 안 된다.
  const r = parseMemberRoster("상호\t대표자\t업종\n새롬상사\t?\t?");
  assert.equal(r.rows[0].owner, "");
  assert.equal(r.rows[0].category, "기타");
});

// ── 실제로 넣기 ──────────────────────────────────────────────────────────
test("붙여넣고 [등록하기] 를 누르면 가게가 한 번에 들어간다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const j = await login(env);
  const r = await post(env, j, IMPORT, { roster: REAL, prefix: "서울 서초구", confirm: "1" }, IMPORT);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes("5곳을 등록했습니다"), html.slice(0, 400));
  const list = await D.listAllBusinesses(env.DB, a.id);
  assert.equal(list.length, 5);
  const hotel = list.find((b) => b.name === "2001호텔");
  assert.equal(hotel.address, "서울 서초구 방배중앙로 174");
  assert.equal(hotel.category, "생활·서비스");
});

test("사장님 개인 휴대폰이 가게 공개 전화번호로 새지 않는다", async () => {
  // 명부의 번호는 대표자 개인 번호다. businesses.phone 은 손님 화면에 그대로 뜬다 —
  // 거기에 넣으면 114명의 개인 번호를 인터넷에 올리는 것이 된다.
  const env = makeEnv(); const a = await seed(env);
  const j = await login(env);
  await post(env, j, IMPORT, { roster: REAL, prefix: "서울 서초구", confirm: "1" }, IMPORT);
  const list = await D.listAllBusinesses(env.DB, a.id);
  for (const b of list) assert.equal(b.phone || "", "", `${b.name} 의 개인 번호가 공개 칸에 들어갔다`);
  // 대신 사장님 계정에는 들어가 있어야 한다 — 그 번호가 곧 로그인 아이디이자 알림톡 수신처다
  const hotel = list.find((b) => b.name === "2001호텔");
  const owner = await D.getUserById(env.DB, hotel.owner_id);
  assert.equal(owner.phone, "01099117118");
  assert.equal(owner.name, "송우진");
});

test("미리보기만 눌렀을 때는 아무것도 만들지 않는다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const j = await login(env);
  const html = await (await post(env, j, IMPORT, { roster: REAL, prefix: "서울 서초구" }, IMPORT)).text();
  assert.ok(html.includes("이렇게 읽었습니다"), "무엇을 넣을지 보여 주지 않는다");
  assert.ok(html.includes("5곳 등록하기"), "확인 단추가 없다");
  assert.equal((await D.listAllBusinesses(env.DB, a.id)).length, 0, "미리보기가 가게를 만들었다");
});

test("미리보기가 0 을 되살린 것과 업종을 묶은 것을 말해 준다", async () => {
  const env = makeEnv(); await seed(env);
  const j = await login(env);
  const html = await (await post(env, j, IMPORT, { roster: REAL, prefix: "서울 서초구" }, IMPORT)).text();
  assert.ok(/전화번호 5개의 맨 앞 0 을 되살렸습니다/.test(html), "조용히 고치면 회장님이 모른다");
  assert.ok(html.includes("숙박업 → "), "원래 업종과 묶은 결과를 나란히 보여야 한다");
  assert.ok(html.includes("가게 페이지에는 안 띄웁니다"), "개인 번호를 어떻게 다루는지 말해야 한다");
});

test("같은 명부를 두 번 넣어도 중복이 안 생긴다", async () => {
  // 이게 안전장치다. 114줄을 넣다 중간에 끊겨도 그대로 다시 붙여넣으면 된다.
  const env = makeEnv(); const a = await seed(env);
  const j = await login(env);
  await post(env, j, IMPORT, { roster: REAL, confirm: "1" }, IMPORT);
  const r2 = await post(env, j, IMPORT, { roster: REAL, confirm: "1" }, IMPORT);
  const html = await r2.text();
  assert.equal((await D.listAllBusinesses(env.DB, a.id)).length, 5, "두 번 넣어 가게가 늘었다");
  assert.ok(html.includes("이미 있던 5곳은 건너뛰었습니다"), html.slice(0, 300));
});

test("대표자를 모르는 줄도 가게는 등록된다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const j = await login(env);
  await post(env, j, IMPORT, { roster: "상호\t대표자\n새롬상사\t\n버들카페\t김방배", confirm: "1" }, IMPORT);
  const list = await D.listAllBusinesses(env.DB, a.id);
  assert.equal(list.length, 2);
  const s = list.find((b) => b.name === "새롬상사");
  const u = await D.getUserById(env.DB, s.owner_id);
  // 목록에서 '누구' 칸이 비면 회장님이 그 줄을 못 읽는다 — 가게 이름이라도 보여 준다
  assert.equal(u.name, "새롬상사");
});

test("임시 비밀번호를 화면에 쏟지 않는다", async () => {
  // 114개를 늘어놓아 봐야 아무도 옮겨 적을 수 없다. 필요한 사장님만 따로 정해 준다.
  const env = makeEnv(); await seed(env);
  const j = await login(env);
  const html = await (await post(env, j, IMPORT, { roster: REAL, confirm: "1" }, IMPORT)).text();
  assert.ok(!/임시비번|임시 비밀번호 [A-Za-z0-9]{6}/.test(html), "전달할 수도 없는 비번을 늘어놓는다");
});

test("남의 상인회 명단과 섞이지 않는다", async () => {
  const env = makeEnv(); const a = await seed(env); const zz = await seed(env, "zz");
  const j = await login(env);
  await post(env, j, IMPORT, { roster: REAL, confirm: "1" }, IMPORT);
  assert.equal((await D.listAllBusinesses(env.DB, a.id)).length, 5);
  assert.equal((await D.listAllBusinesses(env.DB, zz.id)).length, 0);
});

test("로그인하지 않으면 이 화면을 열 수 없다", async () => {
  const env = makeEnv(); await seed(env);
  const r = await get(env, jar(), IMPORT);
  assert.ok(r.status === 302 || r.status === 303 || r.status === 403 || r.status === 404,
    `누구나 명부 화면을 열 수 있다 (${r.status})`);
  assert.ok(!(r.status === 200), "명부 화면이 그냥 열렸다");
});

test("회원·점포 목록에서 이 화면으로 가는 길이 있다", async () => {
  const env = makeEnv(); await seed(env);
  const j = await login(env);
  const html = await (await get(env, j, "/t/bb/admin")).text();
  assert.ok(html.includes(">명부로 한 번에 등록</a>"), "기능이 있어도 못 찾으면 없는 것과 같다");
  assert.ok(html.includes("/admin/members/import"));
});

// ── 머리글 없이 몸통만 붙여넣었을 때 ────────────────────────────────────
//
// 실제로 회장님이 이렇게 보내 왔습니다 — 엑셀 머리글은 병합돼 있어서 첫 가게 줄부터
// 드래그하게 됩니다. 예전에는 여기서 "머리글에 '상호' 칸이 없습니다" 로 되돌아갔습니다.
const BODY_ONLY = [
  "2001호텔\t송우진\t010-9911-7118\t769-10\t숙박업",
  "박사부동산\t권경숙\t010-5048-2547\t2233\t부동산",
  "서광안경\t김세웅\t010-9015-1001\t3282\t안경점",
  "컴포즈커피\t이원정\t010-3516-6216\t3282\t카페",
  "새롬상사\t백화실\t010-4701-1945\t?\t?",
  "형제네축산\t\t010-2222-3333\t791-3\t정육점",
].join("\n");

test("머리글 없이 몸통만 붙여넣어도 칸을 알아본다", () => {
  const r = parseMemberRoster(BODY_ONLY);
  assert.equal(r.error, undefined);
  assert.equal(r.rows.length, 6, "첫 줄을 머리글로 잡아먹으면 안 된다");
  assert.deepEqual(describeColumns(r.inferred), [
    "1번째 칸 = 상호", "2번째 칸 = 대표자", "3번째 칸 = 전화번호",
    "4번째 칸 = 주소", "5번째 칸 = 업종",
  ]);
  assert.equal(r.rows[0].name, "2001호텔");
  assert.equal(r.rows[0].owner, "송우진");
  assert.equal(r.rows[0].phone, "01099117118");
  assert.equal(r.rows[0].category, "생활·서비스");
});

test("머리글이 있으면 알아맞히지 않고 머리글을 따른다", () => {
  const r = parseMemberRoster(REAL);
  assert.equal(r.inferred, null, "머리글이 있는데도 넘겨짚으면 순서가 다른 명부가 망가진다");
  assert.equal(r.rows.length, 5);
});

test("우리가 모르는 머리글 낱말이 붙어 와도 그 줄을 가게로 넣지 않는다", () => {
  const r = parseMemberRoster(["점포이름\t사장이름\t연락처번호\t번지\t취급품목", ...BODY_ONLY.split("\n")].join("\n"));
  assert.equal(r.error, undefined);
  assert.equal(r.rows.length, 6, "머리글 줄이 '점포이름' 이라는 가게로 등록되면 안 된다");
  assert.equal(r.rows[0].name, "2001호텔");
});

test("지번만 적힌 주소에도 앞말이 붙는다", () => {
  const r = parseMemberRoster(BODY_ONLY, { prefix: "서울 서초구 방배동" });
  assert.equal(r.rows[0].address, "서울 서초구 방배동 769-10");
  assert.equal(r.rows[4].address, "", "'?' 를 주소로 넣으면 지도가 엉뚱한 곳을 찍는다");
});

test("상호 한 칸짜리 명부를 머리글 없이 넣어도 살아남는다", () => {
  const r = parseMemberRoster("본죽\n쭈꾸미\n곱창집");
  assert.equal(r.error, undefined);
  assert.equal(r.rows.length, 3, "짧은 한글 상호가 대표자 칸으로 끌려가면 상호가 빈다");
  assert.deepEqual(r.rows.map((x) => x.name), ["본죽", "쭈꾸미", "곱창집"]);
});

test("업종 칸은 되풀이로 알아본다 — 상호 칸을 업종으로 읽지 않는다", () => {
  const r = parseMemberRoster(BODY_ONLY);
  assert.equal(r.rows[3].name, "컴포즈커피");
  assert.equal(r.rows[3].rawCat, "카페");
  assert.equal(r.rows[3].category, "카페·디저트");
});

test("빈 글을 넣으면 알아맞히려 들지 않고 안내한다", () => {
  assert.ok(parseMemberRoster("").error);
  assert.ok(parseMemberRoster("상호\t대표자\t전화번호").error, "머리글만 있고 가게가 없다");
});

test("머리글 없이 넣으면 화면이 어떻게 읽었는지 적어 준다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const j = await login(env);
  const html = await (await post(env, j, IMPORT, { roster: BODY_ONLY }, null)).text();
  assert.ok(html.includes("머리글이 없어서 칸의 내용을 보고 읽었습니다"), "조용히 넘겨짚으면 안 된다");
  assert.ok(html.includes("3번째 칸 = 전화번호"));
  assert.ok(!(await D.listAllBusinesses(env.DB, a.id)).length, "미리보기는 아무것도 넣지 않는다");
});

test("머리글 없는 명부도 그대로 등록된다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const j = await login(env);
  await post(env, j, IMPORT, { roster: BODY_ONLY, prefix: "서울 서초구 방배동", confirm: "1" }, IMPORT);
  const list = await D.listAllBusinesses(env.DB, a.id);
  assert.equal(list.length, 6);
  const one = list.find((b) => b.name === "2001호텔");
  assert.ok(one, "첫 줄이 머리글로 오해받아 사라졌다");
  assert.equal(one.address, "서울 서초구 방배동 769-10");
  assert.ok(!one.phone, "대표자 개인 번호가 가게 공개 번호로 새면 안 된다");
});

// ── 같은 명부가 두 번 들어올 때 ──────────────────────────────────────────
//
// 실제로 난 사고입니다. 114줄은 넣는 데 시간이 걸리는데 화면이 아무 말이 없어서
// 회장님이 [등록하기] 를 한 번 더 누르셨고, 그 두 번째가 첫 번째와 겹쳐 돌면서
// UNIQUE 오류로 화면 전체가 500 이 됐습니다. 겹쳐 돌아도 오류가 아니라 **한 벌**이 되어야 합니다.
const TWO = [
  "상호\t대표자\t전화번호",
  "버들카페\t김방배\t010-1111-2222",
  "돈거돈락\t최진호\t010-3333-4444",
  "삼호골프연습장\t이유진\t010-5555-6666",
].join("\n");

test("[등록하기] 가 겹쳐 눌려도 가게가 두 벌 생기지 않는다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const j = await login(env);
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, IMPORT)).text()) || [])[1];
  const body = new URLSearchParams({ _csrf: t, roster: TWO, confirm: "1" }).toString();
  const fire = () => worker.fetch(new Request(B + IMPORT, { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body }), env);
  const rs = await Promise.all([fire(), fire()]);
  for (const r of rs) assert.equal(r.status, 200, "겹쳐 눌렀다고 화면이 죽으면 안 된다");
  const list = await D.listAllBusinesses(env.DB, a.id);
  assert.equal(list.length, 3, `가게가 ${list.length}곳 생겼다 — 한 벌이어야 한다`);
});

test("겹쳐 눌려도 주인 없는 계정이 남지 않는다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const j = await login(env);
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, IMPORT)).text()) || [])[1];
  const body = new URLSearchParams({ _csrf: t, roster: TWO, confirm: "1" }).toString();
  const fire = () => worker.fetch(new Request(B + IMPORT, { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body }), env);
  await Promise.all([fire(), fire()]);
  // 사장님 계정은 가게마다 하나여야 한다. 가게를 못 만든 자리에 계정만 남으면
  // 회원 정원(요금제 한도)을 갉아먹고, 회원 목록에 가게 없는 이름이 뜬다.
  assert.equal(await D.countMembers(env.DB, a.id), 3);
});

test("이름이 달라도 인터넷 주소가 같아지는 줄은 미리 알려 준다", () => {
  const r = parseMemberRoster("상호\n버들카페\n버들카페!");
  assert.equal(r.rows[0].status, "ok");
  assert.equal(r.rows[1].status, "bad", "조용히 빠지면 113곳만 들어간 것을 세어 보고서야 안다");
  assert.match(r.rows[1].note, /인터넷 주소/);
});

test("한 줄이 실패해도 나머지는 들어간다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const j = await login(env);
  // 가운데 줄의 상호를 이미 등록해 둔다 — 그 줄은 건너뛰고 나머지 둘은 들어가야 한다.
  const p = await hashPassword("x12345678");
  const u = await D.createUser(env.DB, { email: "x@bb.kr", passwordHash: p.hash, salt: p.salt,
    name: "최진호", role: "MERCHANT", associationId: a.id });
  await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "돈거돈락", category: "음식점" });
  await post(env, j, IMPORT, { roster: TWO, confirm: "1" }, IMPORT);
  const names = (await D.listAllBusinesses(env.DB, a.id)).map((b) => b.name).sort();
  assert.deepEqual(names, ["돈거돈락", "버들카페", "삼호골프연습장"]);
});

test("등록 화면이 지금 몇 곳인지를 늘 말해 준다", async () => {
  const env = makeEnv(); await seed(env);
  const j = await login(env);
  assert.match(await (await get(env, j, IMPORT)).text(), /지금 0곳이 등록돼 있습니다/);
  await post(env, j, IMPORT, { roster: TWO, confirm: "1" }, IMPORT);
  const html = await (await get(env, j, IMPORT)).text();
  assert.match(html, /지금 3곳이 등록돼 있습니다/, "두 번 들어가 목록이 두 배가 된 상태는 숫자로만 보인다");
});

test("오래 걸리는 단추는 두 번 눌리지 않게 막아 둔다", async () => {
  const env = makeEnv(); await seed(env);
  const j = await login(env);
  const html = await (await get(env, j, IMPORT)).text();
  assert.ok(html.includes("data-once"), "폼에 표시가 없으면 스크립트가 잡을 것이 없다");
  assert.ok(html.includes("/js/submit-once.js"));
});
