// 상인회 홈 A/B — 사본 주소를 뿌리고, 그 사본이 실제로 무엇을 만들었는지 세는 길 전체.
//
// 이 기능의 어려운 점은 '홈에서 곧바로 성과가 나오지 않는다' 는 것이다. 손님은 홈을 보고,
// 가게를 눌러 보고, 검색해 보고, 그러다 입점 신청을 한다. 그 여정을 이어 붙이지 못하면
// 숫자는 쌓이지만 어느 홈이 만든 것인지 알 수 없다 — 그래서 그 이어 붙임을 여기서 검사한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const B = "http://localhost";
// 방문자마다 IP 를 달리한다 — 같은 IP 연타는 일부러 한 번으로 세기 때문이다(traffic.js).
let ipN = 0;
const visit = (env, path, cookie = "") => {
  const headers = { "user-agent": "Mozilla/5.0 (iPhone)", "cf-connecting-ip": `203.0.113.${++ipN % 250}` };
  if (cookie) headers.cookie = cookie;
  return worker.fetch(new Request(B + path, { headers, redirect: "manual" }), env, { waitUntil() {}, passThroughOnException() {} });
};
const cookieOf = (r) => (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");

async function seed() {
  const env = makeEnv();
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "s@p.kr", passwordHash: pw.hash, salt: pw.salt, name: "운영", role: "SUPERADMIN", associationId: null });
  const a = await D.createAssociation(env.DB, { slug: "s", name: "서초구 상인회", kind: "merchant" });
  await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const u = await D.createUser(env.DB, { email: "m@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "홍가네분식", category: "음식점", description: "떡볶이" });
  await D.setBusinessStatus(env.DB, b.id, "approved");
  await D.createLandingVariant(env.DB, { associationId: a.id, slug: "b", name: "가게 먼저", layout: null });
  return { env, a, b: await D.getBusinessById(env.DB, b.id) };
}
const statOf = async (env, aid, v) =>
  (await D.homeVariantStats(env.DB, aid, 30)).find((r) => (r.variant || "") === v) || {};
// 사본 줄은 방문이 잡히는 순간 이미 생기므로, 아직 안 일어난 성과는 undefined 가 아니라 0 이다
const n = (row, key) => Number(row[key]) || 0;

test("사본 주소가 열리고 방문이 그 사본 앞으로 쌓인다", async () => {
  const { env, a } = await seed();
  const r = await visit(env, "/t/s/l/b");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /서초구 상인회/);
  assert.equal(Number((await statOf(env, a.id, "b")).views), 1);
  assert.equal(n(await statOf(env, a.id, ""), "views"), 0, "기본 홈 몫으로 새면 안 된다");

  await visit(env, "/t/s/");
  assert.equal(Number((await statOf(env, a.id, "")).views), 1, "기본 홈은 기본 홈대로");
});

test("없는 사본은 404", async () => {
  const { env } = await seed();
  assert.equal((await visit(env, "/t/s/l/없는것")).status, 404);
});

// 여정을 이어 붙이는 부분 — 이 기능의 핵심이다.
test("사본에서 시작한 사람이 가게를 열면 그 사본의 성과가 된다", async () => {
  const { env, a, b } = await seed();
  const home = await visit(env, "/t/s/l/b");
  const jar = cookieOf(home);
  assert.match(jar, /sc_hv=b/, "어느 사본에서 시작했는지 기억해야");

  await visit(env, `/t/s/business/${encodeURIComponent(b.slug)}`, jar);
  assert.equal(Number((await statOf(env, a.id, "b")).bizviews), 1);
  assert.equal(n(await statOf(env, a.id, ""), "bizviews"), 0, "기본 홈 몫으로 새면 안 된다");
});

test("검색·지도는 '찾기' 로, 목록만 연 것은 세지 않는다", async () => {
  const { env, a } = await seed();
  const jar = cookieOf(await visit(env, "/t/s/l/b"));

  await visit(env, "/t/s/businesses", jar);                 // 그냥 목록 — 찾은 게 아니다
  assert.equal(n(await statOf(env, a.id, "b"), "finds"), 0);

  await visit(env, "/t/s/businesses?q=분식", jar);
  await visit(env, "/t/s/map", jar);
  assert.equal(Number((await statOf(env, a.id, "b")).finds), 2);
});

test("사본을 보고 온 사람의 입점 신청이 그 사본 앞으로 잡힌다", async () => {
  const { env, a } = await seed();
  const home = await visit(env, "/t/s/l/b");
  let jar = cookieOf(home);
  const reg = await visit(env, "/t/s/register", jar);
  jar = [jar, cookieOf(reg)].filter(Boolean).join("; ");
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(await reg.text()) || [])[1];
  const r = await worker.fetch(new Request(B + "/t/s/register", {
    method: "POST", redirect: "manual",
    headers: { cookie: jar, origin: B, "user-agent": "Mozilla/5.0 (iPhone)", "cf-connecting-ip": "203.0.113.77",
      "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, name: "새사장", email: "new@s.kr", password: "pass1234",
      business_name: "새가게", agree: "1" }),
  }), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(r.status, 303);
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);
  assert.equal(Number((await statOf(env, a.id, "b")).signups), 1, "입점 신청이 사본 앞으로 잡혀야");
});

test("관리 화면에 비교표가 있고, 표본이 얇으면 그렇게 말해 준다", async () => {
  const { env } = await seed();
  const g = await visit(env, "/login");
  const seedC = cookieOf(g);
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const lr = await worker.fetch(new Request(B + "/login", { method: "POST", redirect: "manual",
    headers: { cookie: seedC, origin: B, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: tk, email: "ad@s.kr", password: "pass1234" }) }), env, { waitUntil() {}, passThroughOnException() {} });
  const jar = [seedC, cookieOf(lr)].filter(Boolean).join("; ");
  const html = await (await visit(env, "/t/s/admin", jar)).text();
  assert.match(html, /홈 비교하기 \(A\/B\)/);
  assert.match(html, /가게 먼저/, "만들어 둔 사본이 표에 있어야");
  assert.match(html, /입점 신청<\/th>/);
  assert.match(html, /표본 부족/, "방문 100회 전에는 비교하지 말라고 해야");
  assert.match(html, /사본 만들기/);
  // 두 갈래 프리셋 — 첫 화면이 무엇을 앞세우는지만 다르게 해서 복사한다
  assert.match(html, /가게가 먼저/);
  assert.match(html, /찾는 게 먼저/);
});

// 전자계약 조직은 홈에 비교할 구성이 없다 — 없는 기능을 화면에 띄우지 않는다.
test("전자계약 조직에는 A/B 가 없다", async () => {
  const env = makeEnv();
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "s2@p.kr", passwordHash: pw.hash, salt: pw.salt, name: "운영", role: "SUPERADMIN", associationId: null });
  const a = await D.createAssociation(env.DB, { slug: "law", name: "한빛법무법인", kind: "esign" });
  await D.createLandingVariant(env.DB, { associationId: a.id, slug: "b", name: "x", layout: null });
  assert.equal((await visit(env, "/t/law/l/b")).status, 404, "전자계약 홈에는 사본 주소가 없어야");
});
