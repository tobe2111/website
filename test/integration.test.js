// 통합 테스트 — 실제 서버를 임시 DB로 띄우고 HTTP 로 검증 (외부 의존성 없음)
// 실행: npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 서버 임포트 전에 임시 환경을 설정 (config 가 최초 임포트 시 env 를 읽음)
const TMP = path.join(os.tmpdir(), "scm-test");
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, "uploads"), { recursive: true });
process.env.DB_FILE = path.join(TMP, "test.db");
process.env.UPLOAD_DIR = path.join(TMP, "uploads");
process.env.SESSION_SECRET = "test-secret-integration";
process.env.PORT = "47100";
process.env.LOG_REQUESTS = "0";

const PORT = 47100;
const BASE = `http://localhost:${PORT}`;

// 시드 후 서버 기동
await import("../src/seed.js");
const { server } = await import("../src/server.js");
before(async () => {
  if (!server.listening) await new Promise((r) => server.once("listening", r));
});
after(() => server.close());

// ----- 쿠키 처리 헬퍼 -----
function jarUpdate(res, jar) {
  for (const c of res.headers.getSetCookie?.() || []) {
    const pair = c.split(";")[0];
    const i = pair.indexOf("=");
    jar[pair.slice(0, i).trim()] = pair.slice(i + 1);
  }
}
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");

async function loginAs(email, password) {
  const jar = {};
  let r = await fetch(`${BASE}/login`);
  jarUpdate(r, jar);
  await r.text();
  r = await fetch(`${BASE}/login`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar) },
    body: new URLSearchParams({ _csrf: jar.sc_csrf, email, password }),
  });
  jarUpdate(r, jar);
  return { jar, status: r.status, location: r.headers.get("location") };
}

// ================= 테스트 =================
test("플랫폼 홈 200", async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /참여 상인회|상인회 플랫폼/);
});

test("테넌트 홈 200 + 히어로", async () => {
  const r = await fetch(`${BASE}/t/seocho`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /hero-title/);
});

test("존재하지 않는 테넌트 404", async () => {
  const r = await fetch(`${BASE}/t/nonexistent-xyz`);
  assert.equal(r.status, 404);
});

test("보안 헤더 존재", async () => {
  const r = await fetch(`${BASE}/t/seocho`);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.ok(r.headers.get("content-security-policy"));
  assert.equal(r.headers.get("x-frame-options"), "SAMEORIGIN");
});

test("CSRF: 토큰 없는 POST /login 은 403", async () => {
  const r = await fetch(`${BASE}/login`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "email=x@y.z&password=whatever",
  });
  assert.equal(r.status, 403);
});

test("로그인 성공 → 역할별 리다이렉트", async () => {
  const admin = await loginAs("admin@seocho-merchants.kr", "admin1234");
  assert.equal(admin.status, 303);
  assert.match(admin.location, /\/t\/seocho\/admin$/);

  const merchant = await loginAs("jung@ex.kr", "merchant1234");
  assert.equal(merchant.status, 303);
  assert.match(merchant.location, /\/t\/seocho\/dashboard$/);

  const sup = await loginAs("super@platform.kr", "super1234");
  assert.equal(sup.status, 303);
  assert.match(sup.location, /\/super$/);
});

test("잘못된 비밀번호 로그인 실패", async () => {
  const bad = await loginAs("admin@seocho-merchants.kr", "wrong-password");
  assert.equal(bad.status, 303);
  assert.match(bad.location, /err=1/);
});

test("권한: 미인증 사용자는 대시보드 접근 시 로그인으로", async () => {
  const r = await fetch(`${BASE}/t/seocho/dashboard`, { redirect: "manual" });
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /\/login/);
});

test("테넌트 격리: 업체 회원은 관리자 페이지 403", async () => {
  const { jar } = await loginAs("jung@ex.kr", "merchant1234");
  const r = await fetch(`${BASE}/t/seocho/admin`, { headers: { cookie: cookieHeader(jar) }, redirect: "manual" });
  assert.equal(r.status, 403);
});

test("업체 상세: LocalBusiness 구조화 데이터", async () => {
  const r = await fetch(`${BASE}/t/seocho/business/${encodeURIComponent("서초정육점")}`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"@type":"LocalBusiness"/);
  assert.match(html, /name="description"/); // 메타 설명 존재 (og:image 는 미디어 없으면 생략됨)
});

test("검색: 존재하는 업종 매칭", async () => {
  const r = await fetch(`${BASE}/t/seocho/businesses?${new URLSearchParams({ q: "방배" })}`);
  const html = await r.text();
  assert.match(html, /방배동 로스터리/);
});

test("SEO: sitemap.xml + robots.txt", async () => {
  const sm = await fetch(`${BASE}/sitemap.xml`);
  assert.equal(sm.status, 200);
  assert.match(sm.headers.get("content-type"), /xml/);
  assert.match(await sm.text(), /<loc>.*\/t\/seocho/);

  const rb = await fetch(`${BASE}/robots.txt`);
  assert.equal(rb.status, 200);
  assert.match(await rb.text(), /Sitemap:/);
});

test("헬스체크 /healthz", async () => {
  const r = await fetch(`${BASE}/healthz`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: "ok" });
});
