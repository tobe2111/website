// 상인회가 총회에서 보여 주는 숫자.
//
// 왜 필요한가 — 재계약할 때 상인회가 실제로 묻는 것은 "그래서 우리한테 뭐가 좋았냐" 다.
// 그 답이 화면에 없으면 홈페이지는 '작년에 만든 것' 이 되고 다음 해 예산에서 빠진다.
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
const UA = { "user-agent": "Mozilla/5.0 (iPhone) Safari" };
async function get(env, j, p, extra = {}) {
  const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j), ...UA, ...extra } }), env); absorb(j, r); return r;
}
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), ...UA, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "방배카페골목상인회" });
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const mk = async (name, i) => {
    const u = await D.createUser(env.DB, { email: `m${i}@x.kr`, passwordHash: pw.hash, salt: pw.salt, name: "사장" + i, role: "MERCHANT", associationId: a.id });
    const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name, category: "음식점" });
    await D.setBusinessStatus(env.DB, b.id, "approved");
    return b;
  };
  return { a, b1: await mk("방배 커피", 1), b2: await mk("방배 정육점", 2) };
}
const login = async (env) => { const j = jar(); await post(env, j, "/login", { login: "ad@s.kr", password: "pass1234" }); return j; };

test("손님이 가게를 열면 그 가게 앞으로 세어진다", async () => {
  const env = makeEnv(); const { a, b1, b2 } = await seed(env);
  // 같은 방문자의 연타는 한 번으로 본다 — 그래서 IP 를 바꿔 가며 연다
  for (let i = 0; i < 3; i++) await get(env, jar(), `/t/seocho/business/${b1.slug}`, { "cf-connecting-ip": `1.2.3.${i}` });
  await get(env, jar(), `/t/seocho/business/${b2.slug}`, { "cf-connecting-ip": "9.9.9.9" });

  const top = await D.topBusinesses(env.DB, a.id, { days: 30, limit: 8 });
  assert.equal(top.length, 2);
  assert.equal(top[0].name, "방배 커피", "많이 본 순서여야: " + JSON.stringify(top.map((t) => [t.name, t.views])));
  assert.equal(top[0].views, 3);
  assert.equal(top[1].views, 1);
});

test("같은 사람이 연타해도 한 번으로 센다", async () => {
  const env = makeEnv(); const { a, b1 } = await seed(env);
  const j = jar();
  for (let i = 0; i < 5; i++) await get(env, j, `/t/seocho/business/${b1.slug}`, { "cf-connecting-ip": "5.5.5.5" });
  const top = await D.topBusinesses(env.DB, a.id);
  assert.equal(top[0].views, 1, "새로고침 연타가 성과로 잡히면 그 숫자는 못 쓴다");
});

test("검색 로봇은 세지 않는다", async () => {
  const env = makeEnv(); const { a, b1 } = await seed(env);
  await get(env, jar(), `/t/seocho/business/${b1.slug}`,
    { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)", "cf-connecting-ip": "7.7.7.7" });
  assert.equal((await D.topBusinesses(env.DB, a.id)).length, 0, "로봇을 세면 분모가 부풀어 판단이 틀어진다");
});

test("승인 전 가게는 세지 않는다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const pw = await hashPassword("pass1234");
  const u = await D.createUser(env.DB, { email: "p@x.kr", passwordHash: pw.hash, salt: pw.salt, name: "대기", role: "MERCHANT", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "승인 대기 가게", category: "음식점" });
  const j = await login(env);   // 관리자만 볼 수 있는 상태
  await get(env, j, `/t/seocho/business/${b.slug}`, { "cf-connecting-ip": "8.8.8.8" });
  assert.equal((await D.topBusinesses(env.DB, a.id)).length, 0, "손님에게 안 보이는 가게의 열람은 성과가 아니다");
});

test("성과 화면에 큰 숫자·추이·많이 본 가게가 있다", async () => {
  const env = makeEnv(); const { b1 } = await seed(env);
  await get(env, jar(), `/t/seocho/business/${b1.slug}`, { "cf-connecting-ip": "3.3.3.3" });
  const j = await login(env);
  const html = await (await get(env, j, "/t/seocho/admin")).text();
  const sec = html.slice(html.indexOf('id="s-stats"'), html.indexOf('id="s-notify"'));
  assert.ok(sec.length > 200, "성과 탭이 있어야");
  assert.match(sec, /이번 주 방문/);
  assert.match(sec, /class="spark"/, "추이 막대");
  assert.match(sec, /많이 본 가게/);
  assert.match(sec, /방배 커피/);
  assert.match(sec, /손님이 무엇을 했나/);
});

test("아직 아무 기록이 없어도 화면이 성립한다", async () => {
  const env = makeEnv(); await seed(env);
  const j = await login(env);
  const html = await (await get(env, j, "/t/seocho/admin")).text();
  const sec = html.slice(html.indexOf('id="s-stats"'), html.indexOf('id="s-notify"'));
  assert.match(sec, /아직 열람 기록이 없습니다/, "0 을 늘어놓는 대신 무엇을 하면 쌓이는지 말해야");
  assert.ok(!/NaN|Infinity|undefined/.test(sec), "빈 데이터에서 계산이 깨지면 안 된다: " + (/(NaN|Infinity|undefined)/.exec(sec) || [])[0]);
});

test("방문이 얇으면 비율을 들이대지 않는다", async () => {
  const env = makeEnv(); const { a, b1 } = await seed(env);
  await get(env, jar(), `/t/seocho/business/${b1.slug}`, { "cf-connecting-ip": "4.4.4.4" });
  const j = await login(env);
  const html = await (await get(env, j, "/t/seocho/admin")).text();
  const sec = html.slice(html.indexOf('id="s-stats"'), html.indexOf('id="s-notify"'));
  assert.match(sec, /비율은 우연일 수 있습니다/, "몇 건짜리 표본에 %를 붙이면 잘못된 결정을 만든다");
  void a;
});

test("남의 상인회 열람이 우리 성과에 섞이지 않는다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const other = await D.createAssociation(env.DB, { slug: "other", name: "다른상인회" });
  const pw = await hashPassword("pass1234");
  const ou = await D.createUser(env.DB, { email: "o@x.kr", passwordHash: pw.hash, salt: pw.salt, name: "남", role: "MERCHANT", associationId: other.id });
  const ob = await D.createBusiness(env.DB, { associationId: other.id, ownerId: ou.id, name: "남의가게", category: "카페" });
  await D.setBusinessStatus(env.DB, ob.id, "approved");
  await get(env, jar(), `/t/other/business/${ob.slug}`, { "cf-connecting-ip": "6.6.6.6" });
  assert.equal((await D.topBusinesses(env.DB, a.id)).length, 0);
  assert.equal((await D.topBusinesses(env.DB, other.id)).length, 1);
});

test("점주는 성과 화면을 못 본다", async () => {
  const env = makeEnv(); await seed(env);
  const j = jar(); await post(env, j, "/login", { login: "m1@x.kr", password: "pass1234" });
  assert.equal((await get(env, j, "/t/seocho/admin")).status, 403);
});
