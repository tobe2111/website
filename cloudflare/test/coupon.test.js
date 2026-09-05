// 쿠폰 사용 처리.
//
// 지금까지 쿠폰은 "걸어 두는" 데서 끝났다. 그래서 상인회가 총회에서 가장 많이 받는 질문
// — "그래서 몇 명이나 썼어요?" — 에 답할 방법이 없었다. 답을 못 하면 다음 해 예산이 깎인다.
//
// 결제가 아니라 세는 장부다. 그래서 두 가지를 반드시 지킨다:
//   ① 되돌릴 수 있어야 한다 (손이 미끄러진 숫자를 못 고치면 아무도 안 믿는다)
//   ② 되돌리기는 오늘 것만 건드린다 (지난 날짜를 조용히 바꾸면 장부가 아니다)
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
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "방배카페골목상인회", kind: "merchant" });
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const owner = await D.createUser(env.DB, { email: "own@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const biz = await D.createBusiness(env.DB, { associationId: a.id, ownerId: owner.id, name: "고을국밥", slug: "goeul", category: "음식점" });
  await D.setBusinessStatus(env.DB, biz.id, "approved");
  await D.createCoupon(env.DB, { businessId: biz.id, associationId: a.id, title: "공깃밥 서비스", terms: "2인 이상" });
  const c = (await D.listCoupons(env.DB, biz.id))[0];
  return { a, biz, c, owner };
}
const loginAdmin = async (env) => { const j = jar(); await post(env, j, "/login", { login: "ad@s.kr", password: "pass1234" }); return j; };
const loginOwner = async (env) => { const j = jar(); await post(env, j, "/login", { login: "own@s.kr", password: "pass1234" }); return j; };

test("총무가 사용 처리를 누르면 숫자가 오른다", async () => {
  const env = makeEnv(); const { a, c } = await seed(env);
  const j = await loginAdmin(env);
  await post(env, j, `/t/seocho/admin/coupon/${c.id}/use`, {}, "/t/seocho/admin");
  await post(env, j, `/t/seocho/admin/coupon/${c.id}/use`, {}, "/t/seocho/admin");
  const m = await D.couponUseCounts(env.DB, a.id);
  assert.equal(m.get(c.id).total, 2);
  assert.equal(m.get(c.id).today, 2);
  assert.equal(await D.couponUseTotal(env.DB, a.id, 30), 2);
});

test("되돌리기는 오늘 것 한 건만 뺀다", async () => {
  const env = makeEnv(); const { a, c } = await seed(env);
  const j = await loginAdmin(env);
  await post(env, j, `/t/seocho/admin/coupon/${c.id}/use`, {}, "/t/seocho/admin");
  await post(env, j, `/t/seocho/admin/coupon/${c.id}/use`, {}, "/t/seocho/admin");
  await post(env, j, `/t/seocho/admin/coupon/${c.id}/use`, { undo: "1" }, "/t/seocho/admin");
  assert.equal((await D.couponUseCounts(env.DB, a.id)).get(c.id).total, 1);
});

test("0에서 되돌리기를 눌러도 음수가 되지 않는다", async () => {
  const env = makeEnv(); const { a, c } = await seed(env);
  const j = await loginAdmin(env);
  await post(env, j, `/t/seocho/admin/coupon/${c.id}/use`, { undo: "1" }, "/t/seocho/admin");
  const m = await D.couponUseCounts(env.DB, a.id);
  assert.equal(m.get(c.id) ? m.get(c.id).total : 0, 0);
  assert.equal(await D.couponUseTotal(env.DB, a.id, 30), 0);
});

test("어제 기록은 오늘 되돌리기로 사라지지 않는다 (장부를 조용히 고치지 않는다)", async () => {
  const env = makeEnv(); const { a, biz, c } = await seed(env);
  // 어제 두 번 쓰였다고 직접 적어 둔다
  const yday = new Date(Date.now() + 9 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
  await env.DB.prepare("INSERT INTO coupon_uses (coupon_id, business_id, association_id, day, uses) VALUES (?,?,?,?,2)")
    .bind(c.id, biz.id, a.id, yday).run();
  await D.unredeemCoupon(env.DB, c.id);          // 오늘 것이 없으니 아무 일도 없어야 한다
  assert.equal((await D.couponUseCounts(env.DB, a.id)).get(c.id).total, 2);
});

test("사장님도 자기 가게 쿠폰을 사용 처리할 수 있다", async () => {
  const env = makeEnv(); const { a, c } = await seed(env);
  const j = await loginOwner(env);
  await post(env, j, `/t/seocho/dashboard/coupons/${c.id}/use`, {}, "/t/seocho/dashboard");
  assert.equal((await D.couponUseCounts(env.DB, a.id)).get(c.id).total, 1);
});

test("남의 가게 쿠폰은 사용 처리할 수 없다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const pw = await hashPassword("pass1234");
  const other = await D.createUser(env.DB, { email: "own2@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "옆집", role: "MERCHANT", associationId: a.id });
  const b2 = await D.createBusiness(env.DB, { associationId: a.id, ownerId: other.id, name: "옆집분식", slug: "yeop", category: "음식점" });
  await D.createCoupon(env.DB, { businessId: b2.id, associationId: a.id, title: "튀김 하나" });
  const mine = (await D.listCoupons(env.DB, b2.id))[0];

  const j = await loginOwner(env);               // 고을국밥 사장으로 로그인
  await post(env, j, `/t/seocho/dashboard/coupons/${mine.id}/use`, {}, "/t/seocho/dashboard");
  const m = await D.couponUseCounts(env.DB, a.id);
  assert.equal(m.get(mine.id) ? m.get(mine.id).total : 0, 0, "옆집 쿠폰이 올라가면 안 된다");
});

test("옆 상인회 쿠폰은 건드릴 수 없다 (테넌트 격리)", async () => {
  const env = makeEnv(); await seed(env);
  const b2 = await D.createAssociation(env.DB, { slug: "other", name: "다른상인회", kind: "merchant" });
  const pw = await hashPassword("pass1234");
  const u2 = await D.createUser(env.DB, { email: "o@x.kr", passwordHash: pw.hash, salt: pw.salt, name: "남", role: "MERCHANT", associationId: b2.id });
  const bz = await D.createBusiness(env.DB, { associationId: b2.id, ownerId: u2.id, name: "남의가게", slug: "nam", category: "음식점" });
  await D.createCoupon(env.DB, { businessId: bz.id, associationId: b2.id, title: "남의 혜택" });
  const foreign = (await D.listCoupons(env.DB, bz.id))[0];

  const j = await loginAdmin(env);               // seocho 관리자
  await post(env, j, `/t/seocho/admin/coupon/${foreign.id}/use`, {}, "/t/seocho/admin");
  assert.equal(await D.couponUseTotal(env.DB, b2.id, 30), 0, "남의 상인회 숫자가 올라가면 안 된다");
});

test("콘솔에 사용 처리 줄이 뜨고, 성과에 쿠폰 숫자가 잡힌다", async () => {
  const env = makeEnv(); const { c } = await seed(env);
  const j = await loginAdmin(env);
  await post(env, j, `/t/seocho/admin/coupon/${c.id}/use`, {}, "/t/seocho/admin");
  const html = await (await get(env, j, "/t/seocho/admin")).text();
  assert.match(html, /쿠폰 사용 처리/);
  assert.match(html, /공깃밥 서비스/);
  assert.match(html, /되돌리기/, "오늘 누른 뒤에는 되돌리기가 보여야 한다");
  assert.match(html, /쿠폰이 쓰였다/, "성과에 쿠폰 줄이 있어야 한다");
});

test("기한 지난 쿠폰은 사용 처리 목록에서 빠진다", async () => {
  const env = makeEnv(); const { a, biz } = await seed(env);
  await D.createCoupon(env.DB, { businessId: biz.id, associationId: a.id, title: "지난 혜택", validUntil: "2020-01-01" });
  const live = await D.listAssocCoupons(env.DB, a.id);
  assert.deepEqual(live.map((r) => r.title), ["공깃밥 서비스"]);
});

test("사용 기록은 백업 대상에 들어 있다 (사고로 날리면 다시 못 만든다)", async () => {
  const { TABLES } = await import("../src/scheduled.js");
  assert.ok(TABLES.includes("coupon_uses"));
});
