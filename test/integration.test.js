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

test("회원 게시판: 비회원 차단, 회원 글·댓글 작성", async () => {
  // 비로그인 → 로그인 리다이렉트
  let r = await fetch(`${BASE}/t/seocho/board`, { redirect: "manual" });
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /\/login/);

  // 회원 글 작성
  const { jar } = await loginAs("jung@ex.kr", "merchant1234");
  r = await fetch(`${BASE}/t/seocho/board`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar) },
    body: new URLSearchParams({ _csrf: jar.sc_csrf, title: "테스트 게시글", body: "본문 내용" }),
  });
  assert.equal(r.status, 303);
  const loc = r.headers.get("location");
  const postId = /\/board\/(\d+)/.exec(loc)[1];
  const detail = await (await fetch(`${BASE}/t/seocho/board/${postId}`, { headers: { cookie: cookieHeader(jar) } })).text();
  assert.match(detail, /테스트 게시글/);

  // 댓글
  r = await fetch(`${BASE}/t/seocho/board/${postId}/comment`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar) },
    body: new URLSearchParams({ _csrf: jar.sc_csrf, body: "테스트 댓글입니다" }),
  });
  assert.equal(r.status, 303);
  const withComment = await (await fetch(`${BASE}/t/seocho/board/${postId}`, { headers: { cookie: cookieHeader(jar) } })).text();
  assert.match(withComment, /테스트 댓글입니다/);
});

test("점포 지도: 페이지 렌더 + 좌표 저장 후 마커 데이터 노출", async () => {
  // 지도 페이지 접근
  let r = await fetch(`${BASE}/t/seocho/map`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /가입 점포 지도/);

  // 회원이 좌표 저장 → 지도 마커 데이터에 반영
  const { jar } = await loginAs("jung@ex.kr", "merchant1234");
  r = await fetch(`${BASE}/t/seocho/dashboard/business`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar) },
    body: new URLSearchParams({ _csrf: jar.sc_csrf, name: "서초정육점", category: "농수축산", lat: "37.4919", lng: "127.0079" }),
  });
  assert.equal(r.status, 303);
  const map = await (await fetch(`${BASE}/t/seocho/map`)).text();
  assert.match(map, /"lat":37\.4919/);
  assert.match(map, /map\.naver\.com/); // 폴백 딥링크
});

test("점포 지도: 잘못된 좌표 거부", async () => {
  const { jar } = await loginAs("jung@ex.kr", "merchant1234");
  const r = await fetch(`${BASE}/t/seocho/dashboard/business`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar) },
    body: new URLSearchParams({ _csrf: jar.sc_csrf, name: "서초정육점", lat: "999", lng: "127" }),
  });
  assert.match(new URL(r.headers.get("location"), BASE).search, /err=1/);
});

test("헬스체크 /healthz", async () => {
  const r = await fetch(`${BASE}/healthz`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: "ok" });
});

test("비밀번호 찾기: 요청이 관리자 알림으로 전달(내부 처리)", async () => {
  // 폼 + csrf
  const jar = {};
  let r = await fetch(`${BASE}/forgot`);
  jarUpdate(r, jar);
  await r.text();
  r = await fetch(`${BASE}/forgot`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar) },
    body: new URLSearchParams({ _csrf: jar.sc_csrf, email: "jung@ex.kr" }),
  });
  assert.equal(r.status, 303); // 항상 접수 응답(이메일 존재 비노출)

  // 관리자 대시보드에 알림 표시
  const { jar: aj } = await loginAs("admin@seocho-merchants.kr", "admin1234");
  const dash = await (await fetch(`${BASE}/t/seocho/admin`, { headers: { cookie: cookieHeader(aj) } })).text();
  assert.match(dash, /알림함/);
  assert.match(dash, /비밀번호 재설정 요청/);
});

// 최소 유효 PNG 생성 (서명 이미지 대용)
function makePng() {
  const zlib = require("node:zlib");
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cc]); };
  const w = 60, h = 30, ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3); const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("전자서명: 문서 생성 → 서명 → 검증(유효)", async () => {
  const { createRequire } = await import("node:module");
  global.require = createRequire(import.meta.url);
  const { jar: aj } = await loginAs("admin@seocho-merchants.kr", "admin1234");
  // 문서 생성
  let r = await fetch(`${BASE}/t/seocho/admin/documents`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(aj) },
    body: new URLSearchParams({ _csrf: aj.sc_csrf, title: "테스트 동의서", body: "동의 내용 본문" }),
  });
  assert.equal(r.status, 303);
  const { getDocument, listDocuments } = await import("../src/models.js");
  const { getAssociationBySlug } = await import("../src/associations.js");
  const assoc = getAssociationBySlug("seocho");
  const docId = listDocuments(assoc.id)[0].id;

  // 회원 서명
  const { jar: mj } = await loginAs("flower@ex.kr", "merchant1234");
  const dataUrl = "data:image/png;base64," + makePng().toString("base64");
  r = await fetch(`${BASE}/t/seocho/sign/${docId}`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(mj) },
    body: new URLSearchParams({ _csrf: mj.sc_csrf, consent: "1", signer_name: "최반포", signature: dataUrl }),
  });
  assert.equal(r.status, 303);
  const msg = decodeURIComponent(new URL(r.headers.get("location"), BASE).searchParams.get("msg") || "");
  const code = /검증 코드: (\w+)/.exec(msg)[1];

  // 공개 검증
  const vr = await fetch(`${BASE}/verify/${code}`);
  assert.equal(vr.status, 200);
  assert.match(await vr.text(), /유효한 서명/);
});

test("관리자: 회원 임시 비밀번호 발급 → 새 비밀번호로 로그인", async () => {
  const { jar } = await loginAs("admin@seocho-merchants.kr", "admin1234");
  // cafe 회원 id 조회 (models 직접)
  const { getUserByEmail } = await import("../src/auth.js");
  const cafe = getUserByEmail("cafe@ex.kr");
  const r = await fetch(`${BASE}/t/seocho/admin/user/${cafe.id}/reset-password`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar) },
    body: new URLSearchParams({ _csrf: jar.sc_csrf }),
  });
  assert.equal(r.status, 303);
  const msg = decodeURIComponent(new URL(r.headers.get("location"), BASE).searchParams.get("msg") || "");
  const temp = /임시 비밀번호: (\S+)/.exec(msg)[1];
  const login = await loginAs("cafe@ex.kr", temp);
  assert.equal(login.status, 303);
  assert.match(login.location, /dashboard$/);
});
