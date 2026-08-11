// 전자계약 독립 상품 — 조직 유형에 따라 손님·관리자에게 보이는 것이 달라지는가
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import { hashPassword } from "../src/crypto.js";
import * as D from "../src/db.js";

let env, db, mart, law;
const BASE = "http://localhost";
const req = (method, path, { cookie = "", body = null } = {}) => {
  const headers = {}; if (cookie) headers.cookie = cookie;
  const init = { method, headers, redirect: "manual" };
  if (body) { headers["content-type"] = "application/x-www-form-urlencoded"; init.body = new URLSearchParams(body).toString(); }
  return worker.fetch(new Request(BASE + path, init), env);
};
const cookiesOf = (r) => (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
async function loginAs(email, pw) {
  const seed = await req("GET", "/login");
  const j0 = cookiesOf(seed);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(await seed.text())[1];
  const r = await req("POST", "/login", { cookie: j0, body: { email, password: pw, _csrf: csrf } });
  return [j0, cookiesOf(r)].filter(Boolean).join("; ");
}
const csrfFrom = async (cookie, path) => (/name="_csrf" value="([^"]+)"/.exec(await (await req("GET", path, { cookie })).text()) || [])[1];

before(async () => {
  env = makeEnv(); db = env.DB;
  mart = await D.createAssociation(db, { slug: "mart", name: "서초 상인회" });
  law = await D.createAssociation(db, { slug: "law", name: "○○법무법인", kind: "esign" });
  const mk = async (e, n, role, aid, pw) => { const h = await hashPassword(pw);
    return D.createUser(db, { email: e, passwordHash: h.hash, salt: h.salt, name: n, role, associationId: aid }); };
  await mk("m@x.kr", "상인회관리자", "ADMIN", mart.id, "admin1234");
  await mk("l@x.kr", "법무관리자", "ADMIN", law.id, "admin1234");
  const su = await hashPassword("super1234");
  await D.createUser(db, { email: "s@p.kr", passwordHash: su.hash, salt: su.salt, name: "슈퍼", role: "SUPERADMIN", associationId: null });
});

// ---------- 조직 유형 ----------
test("조직은 상인회 / 전자계약 전용 두 유형을 갖는다", async () => {
  assert.equal((await D.getAssociationBySlug(db, "mart")).kind, "merchant", "기본값은 상인회");
  assert.equal((await D.getAssociationBySlug(db, "law")).kind, "esign");
});

// ---------- 손님에게 보이는 화면 ----------
test("전자계약 조직의 홈은 상권 홈페이지가 아니라 계약 창구다", async () => {
  const h = await (await req("GET", "/t/law")).text();
  assert.match(h, /전자계약/);
  assert.match(h, /가입 없이/, "상대방이 가입 없이 서명한다는 안내");
  assert.match(h, /검증 코드/, "누구나 검증할 수 있는 입구");
  assert.doesNotMatch(h, /가입 점포/, "점포 소개가 나오면 안 됨");
  assert.doesNotMatch(h, /점포 지도/);
});

test("상인회 홈은 그대로 상권 홈페이지다 (기존 동작 유지)", async () => {
  const r = await req("GET", "/t/mart");
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.match(h, /가입 점포/);
  assert.match(h, /점포 지도/);
});

test("메뉴에서 쓰지 않을 항목이 사라진다", async () => {
  const esign = await (await req("GET", "/t/law")).text();
  const nav = esign.slice(esign.indexOf("<nav"), esign.indexOf("</nav>") + 6);
  assert.doesNotMatch(nav, /가입 점포|점포 지도/, "전자계약 조직 메뉴에 점포가 없어야 함");
  assert.doesNotMatch(nav, /가입<\/a>|>가입</, "점포 등록용 가입 버튼도 없어야 함");

  const merchant = await (await req("GET", "/t/mart")).text();
  const nav2 = merchant.slice(merchant.indexOf("<nav"), merchant.indexOf("</nav>") + 6);
  assert.match(nav2, /가입 점포/, "상인회는 그대로");
});

// ---------- 관리자 콘솔 ----------
test("전자계약 조직의 관리자 콘솔에는 점포·회비·홈구성이 없다", async () => {
  const jar = await loginAs("l@x.kr", "admin1234");
  const h = await (await req("GET", "/t/law/admin", { cookie: jar })).text();
  assert.equal((await req("GET", "/t/law/admin", { cookie: jar })).status, 200);
  assert.match(h, /전자계약 관리/, "제목이 전자계약 중심");
  assert.match(h, /계약서 만들기/);
  assert.doesNotMatch(h, /업체 승인/, "업체 승인 메뉴가 없어야 함");
  assert.doesNotMatch(h, /회비 장부/);
  assert.doesNotMatch(h, /홈페이지 구성 편집/);
  assert.match(h, /API 연동/, "API 연동 입구는 있어야 함");
  assert.match(h, /담당자/, "회원이 아니라 담당자로 부른다");
});

test("상인회 관리자 콘솔은 기존 그대로다", async () => {
  const jar = await loginAs("m@x.kr", "admin1234");
  const h = await (await req("GET", "/t/mart/admin", { cookie: jar })).text();
  assert.match(h, /업체 관리|업체 승인/);
  assert.match(h, /회비 장부/);
  assert.match(h, /홈페이지 구성 편집/);
});

// ---------- 제품 랜딩 ----------
test("전자계약 제품 소개 페이지가 따로 있다", async () => {
  const r = await req("GET", "/esign");
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.match(h, /가입 없이 링크 하나로/);
  assert.match(h, /서명 자리 배치/, "핵심 기능 설명");
  assert.match(h, /자리만 옮기는 조작도 탐지/, "보안 설명");
  assert.match(h, /api\/v1\/documents/, "API 예시");
  assert.match(h, /검증 코드/, "제3자 검증 입구");
  assert.match(h, /esign-public-key/, "공개키 공개 위치");
});

test("플랫폼 랜딩에서 전자계약으로 갈 길이 있다", async () => {
  await D.setSetting(db, "platform_mode", "1");
  const h = await (await req("GET", "/")).text();
  assert.match(h, /\/esign/, "상인회가 아닌 손님을 위한 통로");
});

// ---------- 슈퍼 콘솔 ----------
test("슈퍼가 조직을 만들 때 유형을 고른다", async () => {
  const jar = await loginAs("s@p.kr", "super1234");
  const h = await (await req("GET", "/super", { cookie: jar })).text();
  assert.match(h, /name="kind"/, "유형 선택이 있어야 함");
  assert.match(h, /전자계약 전용/);
  assert.match(h, /새 조직 만들기/, "'새 상인회'가 아니라 '조직'");
});

test("전자계약 전용 조직을 슈퍼 콘솔에서 만들 수 있다", async () => {
  const jar = await loginAs("s@p.kr", "super1234");
  const csrf = await csrfFrom(jar, "/super");
  const r = await req("POST", "/super/association", { cookie: jar, body: {
    _csrf: csrf, name: "부동산중개", kind: "esign", brand_color: "#123456",
    admin_email: "re@x.kr", admin_password: "password1234", admin_name: "중개사",
  } });
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);
  const made = (await D.listAllAssociations(db)).find((x) => x.name === "부동산중개");
  assert.ok(made, "생성되어야 함");
  assert.equal(made.kind, "esign");
  assert.match(made.tagline, /계약/, "전자계약용 기본 소개문");
});

test("유형은 나중에 바꿀 수 있고 데이터는 남는다", async () => {
  const jar = await loginAs("s@p.kr", "super1234");
  const csrf = await csrfFrom(jar, "/super");
  const before = await D.listNotices(db, law.id, 10);
  await D.createNotice(db, { associationId: law.id, title: "남아 있어야 할 공지", body: "본문", tag: "안내" });

  await req("POST", `/super/association/${law.id}/kind`, { cookie: jar, body: { _csrf: csrf, kind: "merchant" } });
  assert.equal((await D.getAssociationById(db, law.id)).kind, "merchant");
  assert.match(await (await req("GET", "/t/law")).text(), /가입 점포/, "상인회로 바뀌면 점포 메뉴가 돌아온다");

  await req("POST", `/super/association/${law.id}/kind`, { cookie: jar, body: { _csrf: csrf, kind: "esign" } });
  assert.equal((await D.getAssociationById(db, law.id)).kind, "esign");
  const notices = await D.listNotices(db, law.id, 10);
  assert.equal(notices.length, before.length + 1, "유형을 오가도 데이터는 그대로");
});

test("알 수 없는 유형 값은 상인회로 떨어진다", async () => {
  const x = await D.createAssociation(db, { slug: "weird", name: "이상한값", kind: "해킹시도" });
  assert.equal(x.kind, "merchant");
});

// ---------- 전자계약 기능은 두 유형 모두에서 동작 ----------
test("상인회도 전자계약을 그대로 쓴다", async () => {
  const jar = await loginAs("m@x.kr", "admin1234");
  const r = await req("GET", "/t/mart/admin/documents", { cookie: jar });
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.match(h, /서식으로 만들기/);
  assert.match(h, /API 연동/);
});

// ---------- 셀프 가입 ----------
const signup = async (body) => {
  const page = await req("GET", "/esign/signup");
  const cookie = cookiesOf(page);
  // 가입이 꺼져 있으면 폼이 없어 토큰도 없다 — 핸들러의 판단을 보고 싶으므로 다른 페이지에서 받아온다
  let csrf = (/name="_csrf" value="([^"]+)"/.exec(await page.text()) || [])[1] || "";
  if (!csrf) csrf = (await csrfFrom(cookie, "/login")) || "";
  const r = await req("POST", "/esign/signup", { cookie, body: { _csrf: csrf, ...body } });
  return { r, cookie: [cookie, cookiesOf(r)].filter(Boolean).join("; ") };
};
const OK = { name: "가나공인중개사", admin_name: "김중개", email: "gana@example.com", password: "password1234", agree: "1" };

test("셀프 가입 화면이 열린다", async () => {
  const r = await req("GET", "/esign/signup");
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.match(h, /전자계약 시작하기/);
  assert.match(h, /name="password"/);
  assert.match(h, /이용약관/, "약관 동의가 있어야 함");
});

test("스스로 가입하면 전자계약 조직이 만들어지고 바로 로그인된다", async () => {
  const { r, cookie } = await signup(OK);
  const loc = r.headers.get("location") || "";
  assert.match(loc, /\/admin\/documents/, "가입 직후 계약서 화면으로");
  assert.doesNotMatch(loc, /err=1/);

  const made = (await D.listAllAssociations(db)).find((x) => x.name === OK.name);
  assert.ok(made, "조직이 생성되어야 함");
  assert.equal(made.kind, "esign");
  const admin = await D.getUserByEmail(db, OK.email);
  assert.equal(admin.role, "ADMIN");
  assert.equal(admin.association_id, made.id);

  // 세션이 붙어 바로 관리자 화면이 열린다
  const page = await req("GET", `/t/${made.slug}/admin/documents`, { cookie });
  assert.equal(page.status, 200, "다시 로그인하지 않아도 들어가야 함");
  assert.match(await page.text(), /서식으로 만들기/);
});

test("같은 이메일로는 두 번 가입되지 않는다", async () => {
  const { r } = await signup({ ...OK, name: "다른이름" });
  assert.match(r.headers.get("location") || "", /err=1/);
});

test("이름이 겹쳐도 주소가 충돌하지 않는다", async () => {
  const { r } = await signup({ ...OK, email: "gana2@example.com" });
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);
  const same = (await D.listAllAssociations(db)).filter((x) => x.name === OK.name);
  assert.equal(same.length, 2);
  assert.notEqual(same[0].slug, same[1].slug, "주소가 달라야 함");
});

test("예약된 주소는 조직 주소로 나가지 않는다", async () => {
  const { r } = await signup({ ...OK, name: "admin", email: "res@example.com" });
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);
  const made = (await D.listAllAssociations(db)).find((x) => x.name === "admin");
  assert.notEqual(made.slug, "admin", "다른 경로와 겹치는 주소는 피해야 함");
});

test("입력이 부실하면 거부된다", async () => {
  const bad = [
    [{ ...OK, name: "", email: "a1@example.com" }, "이름 없음"],
    [{ ...OK, email: "이상한주소" }, "이메일 형식"],
    [{ ...OK, email: "a2@example.com", password: "123" }, "짧은 비밀번호"],
    [{ ...OK, email: "a3@example.com", agree: "" }, "약관 미동의"],
    [{ ...OK, email: "a4@example.com", phone: "12345" }, "번호 형식"],
  ];
  for (const [body, why] of bad) {
    const { r } = await signup(body);
    assert.match(r.headers.get("location") || "", /err=1/, why);
  }
});

test("가입만으로는 발송 크레딧이 생기지 않는다 (체험 0일 때)", async () => {
  const made = (await D.listAllAssociations(db)).find((x) => x.email !== undefined && x.name === OK.name);
  assert.equal(await D.getBalance(db, made.id), 0, "돈이 새면 안 된다");
});

test("체험 크레딧을 켜면 가입 시 지급된다", async () => {
  await D.setSetting(db, "esign_trial_credit", "3000");
  const { r } = await signup({ ...OK, name: "체험조직", email: "trial@example.com" });
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);
  const made = (await D.listAllAssociations(db)).find((x) => x.name === "체험조직");
  assert.equal(await D.getBalance(db, made.id), 3000);
  await D.setSetting(db, "esign_trial_credit", "0");
});

test("셀프 가입을 끄면 문의 안내로 바뀌고 제출도 막힌다", async () => {
  await D.setSetting(db, "esign_self_signup", "0");
  const h = await (await req("GET", "/esign/signup")).text();
  assert.match(h, /도입 문의/);
  assert.doesNotMatch(h, /name="password"/, "폼이 나오면 안 됨");
  const { r } = await signup({ ...OK, name: "막힌조직", email: "blocked@example.com" });
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.ok(!(await D.listAllAssociations(db)).some((x) => x.name === "막힌조직"));
  await D.setSetting(db, "esign_self_signup", "1");
});

test("제품 랜딩에서 셀프 가입으로 이어진다", async () => {
  const h = await (await req("GET", "/esign")).text();
  assert.match(h, /\/esign\/signup/);
  assert.match(h, /무료로 시작하기/);
});

test("가입 경로가 외부 서명 링크를 가리지 않는다", async () => {
  // /esign/signup 과 /esign/:token 은 자리 수가 같다 — 순서가 어긋나면 서명 링크가 죽는다
  const made = (await D.listAllAssociations(db)).find((x) => x.name === "체험조직");
  const d = await D.createDocument(db, { associationId: made.id, title: "충돌 확인", body: "본문",
    contentHash: "x".repeat(64), createdBy: null, ordered: 0, dueDate: "" });
  const e = await D.addExternalSigner(db, { documentId: d.id, name: "서명자", email: "s@example.com", signOrder: 1 });
  const { makeExtToken } = await import("../src/extsign.js");
  const t = await makeExtToken(env.SESSION_SECRET, e.id, d.id);
  assert.equal((await req("GET", `/esign/${t}`)).status, 200, "서명 링크가 살아 있어야 함");
  assert.equal((await req("GET", "/esign/signup")).status, 200, "가입 화면도 살아 있어야 함");
});

test("슈퍼 콘솔에서 셀프 가입을 끄고 켤 수 있다", async () => {
  const jar = await loginAs("s@p.kr", "super1234");
  const h = await (await req("GET", "/super", { cookie: jar })).text();
  assert.match(h, /셀프 가입/);
  assert.match(h, /name="trial_credit"/);
  const csrf = await csrfFrom(jar, "/super");
  await req("POST", "/super/signup-settings", { cookie: jar, body: { _csrf: csrf, trial_credit: "5000" } });
  assert.equal(await D.getSetting(db, "esign_self_signup"), "0", "체크 안 하면 꺼진다");
  assert.equal(await D.getSetting(db, "esign_trial_credit"), "5000");
  await req("POST", "/super/signup-settings", { cookie: jar, body: { _csrf: csrf, self_signup: "1", trial_credit: "0" } });
  assert.equal(await D.getSetting(db, "esign_self_signup"), "1");
});
