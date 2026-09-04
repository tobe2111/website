// 구글 애널리틱스(GA4) · 검색엔진 소유 확인.
//
// 여기서 재는 것은 "태그가 붙는다" 가 아니라, 붙이면서 **보안 정책을 필요한 만큼만 연다** 입니다.
// 애널리틱스를 안 쓰는 상인회의 화면에서까지 구글 도메인이 열려 있으면, 기능 하나가
// 전 조직의 방어를 낮춘 셈이 됩니다.
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
async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "서초구 상인회" });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@s.kr", passwordHash: ad.hash, salt: ad.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const j = jar();
  await post(env, j, "/login", { email: "a@s.kr", password: "admin1234" });
  return { a, j };
}
// 브랜딩 폼은 한 번에 통째로 저장되므로, 필수값을 채운 뒤 바꿀 것만 얹습니다.
const settings = (extra) => ({ name: "서초구 상인회", ...extra });

test("측정 ID 를 넣으면 태그가 붙고, 보안 정책이 그만큼만 열린다", async () => {
  const env = makeEnv();
  const { j } = await seed(env);
  await post(env, j, "/t/seocho/admin/settings", settings({ ga_measurement_id: "G-ABC1234567" }), "/t/seocho/admin");

  const res = await get(env, jar(), "/t/seocho/");
  const html = await res.text();
  assert.match(html, /googletagmanager\.com\/gtag\/js\?id=G-ABC1234567/, "구글 태그를 싣는다");
  assert.match(html, /js\/ga\.js[^"]*" data-ga-id="G-ABC1234567"/, "설정은 우리 파일에서 — 페이지 안에 직접 쓴 스크립트는 CSP 가 막는다");
  assert.ok(!/<script>[\s\S]*dataLayer/.test(html), "인라인 설치 코드를 쓰지 않는다");

  const csp = res.headers.get("content-security-policy") || "";
  assert.match(csp, /script-src[^;]*googletagmanager\.com/);
  assert.match(csp, /connect-src[^;]*google-analytics\.com/);
  assert.ok(!/unsafe-inline/.test(csp.split("script-src")[1].split(";")[0]), "스크립트에 unsafe-inline 을 열지 않는다");
});

test("측정 ID 가 없으면 태그도, 열린 정책도 없다", async () => {
  const env = makeEnv();
  await seed(env);
  const res = await get(env, jar(), "/t/seocho/");
  const html = await res.text();
  assert.ok(!html.includes("googletagmanager"), "안 쓰는 조직에 구글 스크립트를 싣지 않는다");
  assert.ok(!html.includes("ga.js"));
  const csp = res.headers.get("content-security-policy") || "";
  assert.ok(!csp.includes("googletagmanager.com"), "쓰지 않는 조직의 정책은 그대로 좁게 둔다");
  assert.ok(!csp.includes("google-analytics.com"));
});

test("규격에 맞지 않는 측정 ID 는 저장하지 않는다 — 구글로 나가는 주소에 들어가는 값이다", async () => {
  const env = makeEnv();
  const { a, j } = await seed(env);
  for (const bad of ['"><script>alert(1)</script>', "UA-12345-1", "G-", "G-한글값1234", "javascript:alert(1)"]) {
    await post(env, j, "/t/seocho/admin/settings", settings({ ga_measurement_id: bad }), "/t/seocho/admin");
    assert.equal((await D.getAssociationBySlug(env.DB, "seocho")).ga_measurement_id, "", `거부해야 함: ${bad}`);
  }
  await post(env, j, "/t/seocho/admin/settings", settings({ ga_measurement_id: "g-abc1234567" }), "/t/seocho/admin");
  assert.equal((await D.getAssociationBySlug(env.DB, "seocho")).ga_measurement_id, "G-ABC1234567", "소문자로 넣어도 받아 준다");
  assert.ok(a);
});

test("네이버 웹마스터도구·구글 서치콘솔 소유 확인 코드는 메타 태그로 나간다", async () => {
  const env = makeEnv();
  const { j } = await seed(env);
  await post(env, j, "/t/seocho/admin/settings",
    settings({ naver_verification: "abc123def", google_verification: "xyz789" }), "/t/seocho/admin");
  const html = await (await get(env, jar(), "/t/seocho/")).text();
  assert.match(html, /<meta name="naver-site-verification" content="abc123def"/);
  assert.match(html, /<meta name="google-site-verification" content="xyz789"/);
});
