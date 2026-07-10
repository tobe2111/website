// 핵심 가설 계측: 등록 경로 태깅(self/proxy) + 참여 지표
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

test("셀프 가입=self, 관리자 대행=proxy 태깅 + 참여 지표", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "m", name: "M상인회" });
  const pw = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "adm@m.kr", passwordHash: pw.hash, salt: pw.salt, name: "총무", role: "ADMIN", associationId: a.id });

  // 사장님 셀프 가입 → source='self'
  const j = jar();
  let r = await post(env, j, "/t/m/register", { name: "가", email: "s1@m.kr", password: "merchant1234", business_name: "직접가게", category: "음식점", agree: "1" }, "/t/m/register");
  assert.equal(r.status, 303);
  const b1 = await D.getBusinessByOwner(env.DB, (await D.getUserByEmail(env.DB, "s1@m.kr")).id);
  assert.equal(b1.source, "self");

  // 관리자 로그인 → 대행 등록 → source='proxy'
  const ja = jar();
  await post(env, ja, "/login", { email: "adm@m.kr", password: "admin1234" }, "/login");
  r = await post(env, ja, "/t/m/admin/members/add", { name: "나", email: "p1@m.kr", business_name: "대행가게", category: "카페" }, "/t/m/admin");
  assert.equal(r.status, 303);
  const b2 = await D.getBusinessByOwner(env.DB, (await D.getUserByEmail(env.DB, "p1@m.kr")).id);
  assert.equal(b2.source, "proxy");

  // 지표: 직접 1 / 대행 1 → 셀프 등록률 50%
  const met = await D.engagementMetrics(env.DB, a.id);
  assert.equal(met.total, 2);
  assert.equal(met.selfCnt, 1);
  assert.equal(met.proxyCnt, 1);
  assert.equal(met.selfRate, 50);
});

test("콘텐츠 수정 시 updated_at 갱신 → 갱신률 반영", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "n", name: "N상인회" });
  const pw = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "adm@n.kr", passwordHash: pw.hash, salt: pw.salt, name: "총무", role: "ADMIN", associationId: a.id });
  const j = jar();
  await post(env, j, "/t/n/register", { name: "다", email: "s2@n.kr", password: "merchant1234", business_name: "라이브가게", category: "기타", agree: "1" }, "/t/n/register");
  const biz = await D.getBusinessByOwner(env.DB, (await D.getUserByEmail(env.DB, "s2@n.kr")).id);
  // 가입 직후: 미채움·미갱신
  let met = await D.engagementMetrics(env.DB, a.id);
  assert.equal(met.refreshRate, 0);
  // 소개 수정 → updated_at + 채움
  await D.updateBusiness(env.DB, biz.id, { name: "라이브가게", category: "기타", description: "맛있어요", phone: "", address: "", hours: "", lat: null, lng: null });
  met = await D.engagementMetrics(env.DB, a.id);
  assert.equal(met.filledRate, 100);
  assert.equal(met.refreshRate, 100);
});
