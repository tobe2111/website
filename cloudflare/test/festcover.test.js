// 대문 행사 — 축제가 홈 첫 화면이 된다 (회장님이 고른 C안).
//
// 이 기능의 위험은 "안 뜬다" 가 아니라 **"끝났는데 안 내려간다"** 입니다.
// 끝난 축제가 첫 화면에 남아 있으면 그 홈페이지는 '관리 안 하는 상인회' 로 읽히고,
// 그걸 사람이 기억해서 내리게 하면 언젠가 반드시 안 내려갑니다. 그래서 여기서 재는 것은
//   ① 날짜가 지나면 **스스로** 사라지는가
//   ② 원래 대문(검색)이 없어지지 않고 아래로 밀렸는가
//   ③ 대문이 둘이 되지 않는가
//   ④ 밝은 브랜드색에서도 글자가 읽히는가(흰 글자를 박지 않았는가)
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, p) { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
// KST 기준 오늘에서 n일
const day = (n) => new Date(Date.now() + 9 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10);

async function seed(env, { slug = "bangbae", name = "방배카페골목상인회", brand } = {}) {
  const a = await D.createAssociation(env.DB, { slug, name });
  // updateAssociation 은 모든 칸을 함께 받는 함수라, 색 하나만 바꿀 때는 그 줄만 건드린다
  if (brand) await env.DB.prepare("UPDATE associations SET brand_color=? WHERE id=?").bind(brand, a.id).run();
  const h = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: `a@${slug}.kr`, passwordHash: h.hash, salt: h.salt, name: "회장", role: "ADMIN", associationId: a.id });
  return a;
}
const login = (env, j, email) => post(env, j, "/login", { email, password: "admin1234" });
const mkEvent = (env, a, over = {}) => D.createEvent(env.DB, {
  associationId: a.id, title: "제5회 방배페스티벌 — 골목이 카페다", event_date: day(11),
  time_text: "오후 3시 ~ 저녁 8시", place: "방배카페골목 일대", description: "",
  signup: "", host: "", contact: "", image: "/img/festival/x.webp", rsvp: 0, ...over,
});

test("대문으로 고른 행사가 홈 첫 화면에 포스터와 함께 선다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const e = await mkEvent(env, a);
  await D.setEventCover(env.DB, e.id, a.id);

  const home = await (await get(env, jar(), "/t/bangbae/")).text();
  assert.match(home, /class="fest-cover"/, "대문 구역이 그려진다");
  assert.match(home, /제5회 방배페스티벌/);
  assert.match(home, /D-11/, "며칠 남았는지가 보인다");
  assert.match(home, /10월|월 \d+일 .요일/, "요일까지 적는다 — 손님이 묻는 것은 '토요일이야?' 다");
  assert.match(home, /오후 3시 ~ 저녁 8시/);
  assert.match(home, /방배카페골목 일대/);
  assert.match(home, /class="fc-poster"/, "포스터가 오른쪽에 선다");
  assert.match(home, /alt="제5회 방배페스티벌 — 골목이 카페다 포스터"/, "읽어 주는 프로그램에 포스터라고 알린다");

  // 대문이 히어로보다 **먼저** 나와야 대문이다
  assert.ok(home.indexOf('class="fest-cover"') < home.indexOf("hero"), "대문이 원래 첫 화면보다 위에 있다");
});

test("원래 대문(검색)은 없어지지 않고 아래로 밀린다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const e = await mkEvent(env, a);
  await D.setEventCover(env.DB, e.id, a.id);
  const home = await (await get(env, jar(), "/t/bangbae/")).text();
  assert.match(home, /type="search"|name="q"/, "가게 찾는 검색창이 홈에 그대로 있다");
});

test("날짜가 지나면 대문이 스스로 사라진다 — 사람이 내리지 않아도 된다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const e = await mkEvent(env, a, { event_date: day(-1) }); // 어제 끝난 축제
  await D.setEventCover(env.DB, e.id, a.id);
  assert.equal((await D.getEvent(env.DB, e.id)).cover, 1, "체크는 그대로 켜져 있다");
  assert.equal(await D.coverEvent(env.DB, a.id), null, "그래도 홈이 가져가지 않는다");

  const home = await (await get(env, jar(), "/t/bangbae/")).text();
  assert.ok(!home.includes("fest-cover"), "끝난 축제가 첫 화면에 남지 않는다");
  assert.ok(!home.includes("제5회 방배페스티벌"), "제목도 안 남는다");
});

test("오늘 열리는 축제는 아직 대문이다 (새벽에 사라지지 않는다)", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const e = await mkEvent(env, a, { event_date: day(0) });
  await D.setEventCover(env.DB, e.id, a.id);
  const home = await (await get(env, jar(), "/t/bangbae/")).text();
  assert.match(home, /class="fest-cover"/, "행사 당일 아침에 대문이 내려가 있으면 안 된다");
  assert.match(home, /D-DAY/);
});

test("고른 행사가 없으면 홈은 예전과 똑같다 — 빈 대문이 생기지 않는다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  await mkEvent(env, a); // 행사는 있지만 대문으로 고르지 않았다
  const home = await (await get(env, jar(), "/t/bangbae/")).text();
  assert.ok(!home.includes("fest-cover"), "기본은 꺼짐이다 — 켜기 전까지 화면이 안 바뀐다");
});

test("대문은 한 번에 하나다 — 새로 고르면 앞의 것이 꺼진다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const e1 = await mkEvent(env, a, { title: "축제 하나" });
  const e2 = await mkEvent(env, a, { title: "축제 둘" });
  await D.setEventCover(env.DB, e1.id, a.id);
  await D.setEventCover(env.DB, e2.id, a.id);
  assert.equal((await D.getEvent(env.DB, e1.id)).cover, 0, "앞의 대문이 꺼진다");
  assert.equal((await D.getEvent(env.DB, e2.id)).cover, 1);
  const home = await (await get(env, jar(), "/t/bangbae/")).text();
  assert.equal((home.match(/class="fest-cover"/g) || []).length, 1, "대문이 둘이면 둘 다 안 읽힌다");
});

test("같은 날 함께 열리는 행사가 대문에 함께 적힌다 — 손으로 또 안 적는다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const main = await mkEvent(env, a);
  await mkEvent(env, a, { title: "미식로드 — 골목 맛집 22곳", event_date: main.event_date });
  await mkEvent(env, a, { title: "주민 노래자랑 본선", event_date: main.event_date });
  await mkEvent(env, a, { title: "상관없는 다른 날 행사", event_date: day(20) });
  await D.setEventCover(env.DB, main.id, a.id);

  const home = await (await get(env, jar(), "/t/bangbae/")).text();
  const cover = home.slice(home.indexOf("fest-cover"), home.indexOf("fest-cover") + 2500);
  assert.match(cover, /같은 날 함께/);
  assert.match(cover, /미식로드/);
  assert.match(cover, /주민 노래자랑 본선/);
  assert.ok(!cover.includes("상관없는 다른 날 행사"), "다른 날 행사는 안 적는다");
});

test("밝은 브랜드색에서도 글자가 읽힌다 — 흰 글자를 박아 두지 않았다", async () => {
  const env = makeEnv();
  // #50edc5 는 라이브에 들어가 있던 형광 민트다. 흰 글자를 얹으면 1.47:1 (기준 4.5:1).
  const a = await seed(env, { brand: "#50edc5" });
  const e = await mkEvent(env, a);
  await D.setEventCover(env.DB, e.id, a.id);
  const home = await (await get(env, jar(), "/t/bangbae/")).text();
  assert.match(home, /--on-brand:#121417/, "밝은 브랜드색에서는 먹 글자를 골라 준다");

  const css = await (await get(env, jar(), "/css/app.css")).text();
  const block = css.slice(css.indexOf(".fest-cover{"), css.indexOf(".fest-cover{") + 400);
  assert.match(block, /color:var\(--on-brand\)/, "구역의 글자색은 고정색이 아니라 골라 준 값이다");
  assert.ok(!/color:#fff/.test(block), "흰 글자를 박아 두면 민트 배경에서 안 읽힌다");
});

test("관리 화면 체크로 켜고 끈다 — 그리고 스스로 내려간다고 적어 둔다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const e = await mkEvent(env, a);
  const j = jar();
  await login(env, j, "a@bangbae.kr");

  const admin = await (await get(env, j, "/t/bangbae/admin")).text();
  assert.match(admin, /홈 첫 화면을 이 행사로/, "행사 칸에 체크가 있다");
  assert.match(admin, /날짜가 지나면 스스로 내려갑니다/, "되돌릴 작업이 없다는 것을 화면이 말한다");

  await post(env, j, `/t/bangbae/admin/event/${e.id}`, {
    title: e.title, event_date: e.event_date, cover: "1",
  }, "/t/bangbae/admin");
  assert.equal((await D.getEvent(env.DB, e.id)).cover, 1);

  // 체크를 빼면 꺼진다 (cover 를 안 보내는 것이 '끔' 이다)
  await post(env, j, `/t/bangbae/admin/event/${e.id}`, {
    title: e.title, event_date: e.event_date,
  }, "/t/bangbae/admin");
  assert.equal((await D.getEvent(env.DB, e.id)).cover, 0);
});

test("남의 상인회 행사를 내 대문으로 세우지 못한다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const b = await seed(env, { slug: "seorae", name: "서래마을상인회" });
  const e = await mkEvent(env, a);
  const j = jar();
  await login(env, j, "a@seorae.kr");
  await post(env, j, `/t/seorae/admin/event/${e.id}`, {
    title: e.title, event_date: e.event_date, cover: "1",
  }, "/t/seorae/admin");
  assert.equal((await D.getEvent(env.DB, e.id)).cover, 0, "다른 상인회 관리자는 손대지 못한다");
  assert.equal(await D.coverEvent(env.DB, b.id), null);
});
