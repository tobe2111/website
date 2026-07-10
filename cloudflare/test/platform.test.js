// 플랫폼화: 랜딩·셀프 입점 신청→승인·플랜
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
async function post(env, j, p, f, csrfFrom) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, csrfFrom || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
async function seedSuper(env) {
  const su = await hashPassword("super1234");
  await D.createUser(env.DB, { email: "super@p.kr", passwordHash: su.hash, salt: su.salt, name: "슈퍼", role: "SUPERADMIN", associationId: null });
}

test("셀프 입점 신청 → 슈퍼 승인 → 상인회·관리자 자동 발급 → 로그인", async () => {
  const env = makeEnv();
  await seedSuper(env);
  let r = await post(env, jar(), "/apply", { assoc_name: "강남시장 상인회", contact_email: "gn@ex.kr", contact_name: "김강남", agree: "1" }, "/apply");
  assert.equal(r.status, 303);
  const apps = await D.listApplications(env.DB, "pending");
  assert.equal(apps.length, 1);

  const j = jar(); await post(env, j, "/login", { email: "super@p.kr", password: "super1234" }, "/login");
  r = await post(env, j, `/super/application/${apps[0].id}/approve`, {}, "/super");
  assert.equal(r.status, 303);
  const loc = decodeURIComponent(r.headers.get("location"));
  const temp = (/임시비번 (\w+)/.exec(loc) || [])[1];
  assert.ok(temp, "임시 비밀번호 발급");
  const gn = await D.getAssociationBySlug(env.DB, "강남시장-상인회");
  assert.ok(gn, "상인회 발급");
  assert.equal((await D.getUserByEmail(env.DB, "gn@ex.kr")).role, "ADMIN");
  const j2 = jar();
  r = await post(env, j2, "/login", { email: "gn@ex.kr", password: temp }, "/login");
  assert.equal(r.status, 303);
  assert.match(decodeURIComponent(r.headers.get("location")), /강남시장-상인회\/admin/);
  assert.equal((await D.getApplication(env.DB, apps[0].id)).status, "approved");
});

test("루트 랜딩: 플랫폼 모드 켜면 랜딩, 끄고 1곳이면 그 홈으로", async () => {
  const env = makeEnv();
  await seedSuper(env);
  await D.createAssociation(env.DB, { slug: "seocho", name: "서초구 상인회" });
  let r = await worker.fetch(new Request(B + "/"), env);
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /\/t\/seocho/);
  const j = jar(); await post(env, j, "/login", { email: "super@p.kr", password: "super1234" }, "/login");
  await post(env, j, "/super/platform-mode", { on: "1" }, "/super");
  r = await worker.fetch(new Request(B + "/"), env);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /5분 만에|무료로 신청하기/);
});

test("슈퍼 플랜 변경 + 가입 카운트", async () => {
  const env = makeEnv();
  await seedSuper(env);
  const a = await D.createAssociation(env.DB, { slug: "s", name: "S" });
  const j = jar();
  let r = await post(env, j, "/t/s/register", { name: "가", email: "m1@ex.kr", password: "merchant1234", business_name: "가게1", category: "기타", agree: "1" }, "/t/s/register");
  assert.equal(r.status, 303);
  assert.equal(await D.countMembers(env.DB, a.id), 1);
  const js = jar(); await post(env, js, "/login", { email: "super@p.kr", password: "super1234" }, "/login");
  r = await post(env, js, `/super/association/${a.id}/plan`, { plan: "pro" }, "/super");
  assert.equal(r.status, 303);
  assert.equal((await D.getAssociationById(env.DB, a.id)).plan, "pro");
});

test("공개 신청 폼 렌더", async () => {
  const env = makeEnv();
  await seedSuper(env);
  assert.match(await (await get(env, jar(), "/apply")).text(), /홈페이지 신청/);
});
