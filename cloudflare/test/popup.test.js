// 홈 팝업 — 관리자가 띄우는 안내창.
//
// 손님 화면을 가로막는 유일한 기능이라, 여기서 재는 것은 "뜬다" 가 아니라
// **스스로 내려간다**·**남의 팝업이 우리 홈에 안 뜬다**·**javascript: 주소가 버튼이 되지 않는다** 입니다.
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
// KST 기준 오늘에서 n일 떨어진 'YYYY-MM-DD'
const day = (n) => new Date(Date.now() + 9 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10);

async function seed(env, { slug = "seocho", name = "서초구 상인회" } = {}) {
  const a = await D.createAssociation(env.DB, { slug, name });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: `a@${slug}.kr`, passwordHash: ad.hash, salt: ad.salt, name: "회장", role: "ADMIN", associationId: a.id });
  return a;
}
async function login(env, j, email) {
  await post(env, j, "/login", { email, password: "admin1234" });
}

test("팝업 등록 → 홈에 실리고, 관리자 목록에 '노출 중' 으로 뜬다", async () => {
  const env = makeEnv();
  await seed(env);
  const j = jar();
  await login(env, j, "a@seocho.kr");
  const r = await post(env, j, "/t/seocho/admin/popup", { title: "여름 골목 야시장", body: "8월 15일 저녁 6시부터" }, "/t/seocho/admin");
  assert.equal(r.status, 303, "폼 전송 뒤에는 GET 으로 돌려보낸다 (새로고침 재전송 방지)");

  const home = await (await get(env, jar(), "/t/seocho/")).text();
  assert.match(home, /class="popup-layer"/, "팝업 판이 홈에 실린다");
  assert.match(home, /여름 골목 야시장/);
  assert.match(home, /role="dialog" aria-modal="true"/, "읽어 주는 프로그램에 창으로 알린다");
  assert.match(home, /오늘 하루 보지 않기/);
  assert.match(home, /js\/popup\.js/, "여는 스크립트가 함께 실린다");
  assert.match(home, /data-popup="\d+" hidden/, "서버는 닫힌 채로 그린다 — JS 가 꺼져 있으면 화면을 가로막지 않는다");

  const admin = await (await get(env, j, "/t/seocho/admin")).text();
  assert.match(admin, /홈 팝업/);
  assert.match(admin, /노출 중/);
});

test("팝업이 없으면 홈에 아무것도 싣지 않는다 — 빈 판도, 스크립트도", async () => {
  const env = makeEnv();
  await seed(env);
  const home = await (await get(env, jar(), "/t/seocho/")).text();
  assert.ok(!home.includes("popup-layer"), "팝업이 없으면 판 자체가 없다");
  assert.ok(!home.includes("js/popup.js"), "쓰지 않을 스크립트를 받게 하지 않는다");
});

test("노출 기간이 지나면 스스로 내려간다 — 관리자가 잊어도", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = jar();
  await login(env, j, "a@seocho.kr");
  await post(env, j, "/t/seocho/admin/popup", { title: "지난 행사", end_date: day(-1) }, "/t/seocho/admin");
  await post(env, j, "/t/seocho/admin/popup", { title: "다음 주 행사", start_date: day(3) }, "/t/seocho/admin");
  await post(env, j, "/t/seocho/admin/popup", { title: "지금 하는 행사", start_date: day(-1), end_date: day(1) }, "/t/seocho/admin");

  const home = await (await get(env, jar(), "/t/seocho/")).text();
  assert.match(home, /지금 하는 행사/);
  assert.ok(!home.includes("지난 행사"), "끝난 팝업은 켜져 있어도 뜨지 않는다");
  assert.ok(!home.includes("다음 주 행사"), "아직 시작 안 한 팝업도 뜨지 않는다");

  // 관리자 화면에서는 왜 안 뜨는지 구분해 보여야 한다 — 셋을 같은 회색으로 그리면 원인을 알 수 없다
  const admin = await (await get(env, j, "/t/seocho/admin")).text();
  assert.match(admin, /기간 끝/);
  assert.match(admin, /대기/);
  assert.equal((await D.listActivePopups(env.DB, a.id)).length, 1);
});

test("내리기 → 다시 띄우기 · 삭제", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = jar();
  await login(env, j, "a@seocho.kr");
  await post(env, j, "/t/seocho/admin/popup", { title: "안내" }, "/t/seocho/admin");
  const p = (await D.listPopups(env.DB, a.id))[0];

  await post(env, j, `/t/seocho/admin/popup/${p.id}/toggle`, {}, "/t/seocho/admin");
  assert.ok(!(await (await get(env, jar(), "/t/seocho/")).text()).includes("popup-layer"), "내리면 홈에서 사라진다");

  await post(env, j, `/t/seocho/admin/popup/${p.id}/toggle`, {}, "/t/seocho/admin");
  assert.match(await (await get(env, jar(), "/t/seocho/")).text(), /안내/, "다시 띄우면 돌아온다");

  await post(env, j, `/t/seocho/admin/popup/${p.id}/delete`, {}, "/t/seocho/admin");
  assert.equal((await D.listPopups(env.DB, a.id)).length, 0);
});

test("링크는 http(s) 와 같은 사이트 경로만 — javascript: 는 버튼이 되지 않는다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = jar();
  await login(env, j, "a@seocho.kr");
  await post(env, j, "/t/seocho/admin/popup", { title: "나쁜 링크", link_url: "javascript:alert(1)" }, "/t/seocho/admin");
  await post(env, j, "/t/seocho/admin/popup", { title: "좋은 링크", link_url: "/t/seocho/notices" }, "/t/seocho/admin");
  const rows = await D.listPopups(env.DB, a.id);
  assert.equal(rows.find((r) => r.title === "나쁜 링크").link_url, "", "javascript: 주소는 통째로 버린다");
  assert.equal(rows.find((r) => r.title === "좋은 링크").link_url, "/t/seocho/notices", "같은 사이트 경로는 그대로 둔다");
  const home = await (await get(env, jar(), "/t/seocho/")).text();
  assert.ok(!/javascript:/.test(home));
});

test("다른 상인회 팝업은 우리 홈에 뜨지 않고, 남이 지우지도 못한다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const b = await seed(env, { slug: "gangnam", name: "강남 상인회" });
  const ja = jar(); await login(env, ja, "a@seocho.kr");
  const jb = jar(); await login(env, jb, "a@gangnam.kr");
  await post(env, ja, "/t/seocho/admin/popup", { title: "서초 안내" }, "/t/seocho/admin");
  const mine = (await D.listPopups(env.DB, a.id))[0];

  assert.ok(!(await (await get(env, jar(), "/t/gangnam/")).text()).includes("서초 안내"), "남의 팝업이 우리 홈에 뜨면 안 된다");
  // 강남 관리자가 서초 팝업 id 로 삭제를 시도한다
  await post(env, jb, `/t/gangnam/admin/popup/${mine.id}/delete`, {}, "/t/gangnam/admin");
  assert.equal((await D.listPopups(env.DB, a.id)).length, 1, "다른 조직 팝업은 지워지지 않는다");
  await post(env, jb, `/t/gangnam/admin/popup/${mine.id}/toggle`, {}, "/t/gangnam/admin");
  assert.equal((await D.getPopup(env.DB, mine.id)).enabled, 1, "다른 조직 팝업을 내리지도 못한다");
});

test("제목이 없으면 등록하지 않는다 · 종료일이 시작일보다 빠르면 막는다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = jar();
  await login(env, j, "a@seocho.kr");
  await post(env, j, "/t/seocho/admin/popup", { title: "   " }, "/t/seocho/admin");
  await post(env, j, "/t/seocho/admin/popup", { title: "거꾸로", start_date: day(5), end_date: day(1) }, "/t/seocho/admin");
  assert.equal((await D.listPopups(env.DB, a.id)).length, 0);
});

test("제목·내용의 <script> 는 글자로 나간다", async () => {
  const env = makeEnv();
  await seed(env);
  const j = jar();
  await login(env, j, "a@seocho.kr");
  await post(env, j, "/t/seocho/admin/popup", { title: "<script>alert(1)</script>", body: "<img onerror=x>" }, "/t/seocho/admin");
  const home = await (await get(env, jar(), "/t/seocho/")).text();
  assert.ok(!home.includes("<script>alert(1)</script>"));
  assert.match(home, /&lt;script&gt;/);
});
