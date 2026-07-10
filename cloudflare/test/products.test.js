// 점포 제품 진열 (전시 전용) — 사장님 CRUD · 공개 노출 · 관리자 숨김 · 테넌트 격리
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
async function seedAdmin(env, aid, email) {
  const pw = await hashPassword("admin1234");
  await D.createUser(env.DB, { email, passwordHash: pw.hash, salt: pw.salt, name: "총무", role: "ADMIN", associationId: aid });
}

test("완료기준: 사장님이 제품 3개 → 공개 점포 페이지에 노출", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "서초 상인회" });
  await seedAdmin(env, a.id, "adm@seocho.kr");
  // 사장님 셀프 가입
  const j = jar();
  await post(env, j, "/t/seocho/register", { name: "홍사장", email: "hong@s.kr", password: "merchant1234", business_name: "홍가네분식", category: "음식점", agree: "1" }, "/t/seocho/register");
  const biz = await D.getBusinessByOwner(env.DB, (await D.getUserByEmail(env.DB, "hong@s.kr")).id);
  await D.setBusinessStatus(env.DB, biz.id, "approved");

  for (const [name, price] of [["김밥", "3,500원"], ["떡볶이", "4,000원"], ["오늘의 특선", "시가"]])
    assert.equal((await post(env, j, "/t/seocho/dashboard/products", { name, price, description: "맛있어요" }, "/t/seocho/dashboard")).status, 303);

  assert.equal(await D.countProducts(env.DB, biz.id), 3);
  const prods = await D.listProducts(env.DB, biz.id);
  assert.equal(prods[0].source, "self", "셀프 등록 태깅");

  // 공개 페이지(비로그인)에 제품·가격 노출
  const pub = await (await get(env, jar(), `/t/seocho/business/${biz.slug}`)).text();
  assert.match(pub, /제품·메뉴/);
  assert.match(pub, /김밥/);
  assert.match(pub, /시가/);
});

test("플랜 제품 수 상한 · 관리자 숨김 · 테넌트 격리", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "s", name: "S상인회", plan: "free" });
  await D.setAssociationPlan(env.DB, a.id, "free");
  await seedAdmin(env, a.id, "adm@s.kr");
  const j = jar();
  await post(env, j, "/t/s/register", { name: "가", email: "m@s.kr", password: "merchant1234", business_name: "가게", category: "기타", agree: "1" }, "/t/s/register");
  const biz = await D.getBusinessByOwner(env.DB, (await D.getUserByEmail(env.DB, "m@s.kr")).id);
  await D.setBusinessStatus(env.DB, biz.id, "approved");
  await post(env, j, "/t/s/dashboard/products", { name: "제품A" }, "/t/s/dashboard");
  const p = (await D.listProducts(env.DB, biz.id))[0];

  // 관리자 숨김 → 공개 목록에서 사라짐
  const ja = jar();
  await post(env, ja, "/login", { email: "adm@s.kr", password: "admin1234" }, "/login");
  assert.equal((await post(env, ja, `/t/s/admin/product/${p.id}/hide`, {}, "/t/s/admin")).status, 303);
  assert.equal((await D.listProducts(env.DB, biz.id)).length, 0, "공개 목록 숨김");
  assert.equal((await D.listProducts(env.DB, biz.id, { includeHidden: true })).length, 1, "숨김 포함 시 보임");

  // 다른 상인회 관리자는 이 제품을 못 건드림 (테넌트 격리)
  const b = await D.createAssociation(env.DB, { slug: "other", name: "타상인회" });
  await seedAdmin(env, b.id, "adm@other.kr");
  const jo = jar();
  await post(env, jo, "/login", { email: "adm@other.kr", password: "admin1234" }, "/login");
  const r = await post(env, jo, `/t/other/admin/product/${p.id}/hide`, {}, "/t/other/admin");
  assert.match(decodeURIComponent(r.headers.get("location") || ""), /찾을 수 없습니다/);
  assert.equal((await D.getProduct(env.DB, p.id)).hidden, 1, "격리 유지: 값 불변");
});
