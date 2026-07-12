// E2E 스모크: 실제 브라우저(Chromium)에서 JS 동작을 검증한다.
// 단위 테스트(node --test)가 못 보는 것들 — 다크 토글, 모바일 메뉴, 초성 검색 드롭다운,
// QR 렌더, 중복 제출 가드 — 를 화면에서 직접 확인.
//
// 실행:  node cloudflare/test-e2e/smoke.mjs
// 요구:  전역 playwright (npm i -g playwright) + Chromium
//        (기본 경로 /opt/pw-browsers/chromium — 없으면 playwright 내장 탐색으로 폴백)
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = (await import(path.join(ROOT, "src/index.js"))).default;
const { makeEnv } = await import(path.join(ROOT, "test/shim.js"));
const D = await import(path.join(ROOT, "src/db.js"));
const { hashPassword } = await import(path.join(ROOT, "src/crypto.js"));

// ---- 시드 + 페이지 캡처 ----
const env = makeEnv();
const a = await D.createAssociation(env.DB, { slug: "seocho", name: "서초구 상인회" });
const pw = await hashPassword("merchant1234");
const u = await D.createUser(env.DB, { email: "m@x.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장", role: "MERCHANT", associationId: a.id });
const su = await hashPassword("super1234");
await D.createUser(env.DB, { email: "s@p.kr", passwordHash: su.hash, salt: su.salt, name: "슈퍼", role: "SUPERADMIN", associationId: null });
const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "홍가네분식", category: "음식점", description: "떡볶이" });
await D.setBusinessStatus(env.DB, b.id, "approved");

const jar = {};
const ch = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); } };
let r = await worker.fetch(new Request("http://localhost/login"), env); absorb(r);
const t = (/name="_csrf" value="([^"]+)"/.exec(await r.text()) || [])[1];
r = await worker.fetch(new Request("http://localhost/login", { method: "POST", headers: { cookie: ch(), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, email: "m@x.kr", password: "merchant1234" }).toString() }), env);
absorb(r);

const DIR = mkdtempSync(path.join(tmpdir(), "smoke-"));
for (const sub of ["css", "js", "img"]) {
  mkdirSync(path.join(DIR, sub), { recursive: true });
  for (const f of readdirSync(path.join(ROOT, "public", sub))) copyFileSync(path.join(ROOT, "public", sub, f), path.join(DIR, sub, f));
}
async function grab(p, file, useCookie) {
  const res = await worker.fetch(new Request("http://localhost" + p, { headers: useCookie ? { cookie: ch() } : {} }), env);
  let h = await res.text();
  h = h.replace(/<link[^>]*jsdelivr[^>]*>/g, "").replace(/\?v=[a-z0-9]+/g, "");
  writeFileSync(path.join(DIR, file), h);
}
await grab("/t/seocho", "home.html");
await grab("/t/seocho/map", "map.html");
await grab("/login", "login.html");
await grab("/t/seocho/dashboard", "dashboard.html", true);

// ---- 정적 서버 ----
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
const srv = http.createServer((req, res) => {
  const f = path.join(DIR, req.url.split("?")[0]);
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const PORT = srv.address().port;

// ---- 브라우저 검증 ----
const pwRoot = execSync("npm root -g").toString().trim();
const { chromium } = await import(path.join(pwRoot, "playwright/index.mjs"));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.error("  ✗", name); } };

// 1) 다크 모드 토글
{
  const p = await browser.newPage();
  await p.goto(`http://localhost:${PORT}/home.html`);
  await p.click("#themeToggle");
  ok(await p.evaluate(() => document.documentElement.getAttribute("data-theme")) === "dark", "다크 토글 → data-theme=dark");
  await p.click("#themeToggle");
  ok(await p.evaluate(() => document.documentElement.getAttribute("data-theme")) === "light", "재클릭 → light");
  await p.close();
}
// 2) OS 다크 설정 자동 반영 (theme.js)
{
  const p = await browser.newPage({ colorScheme: "dark" });
  await p.goto(`http://localhost:${PORT}/home.html`);
  ok(await p.evaluate(() => document.documentElement.getAttribute("data-theme")) === "dark", "OS 다크 → 자동 다크");
  await p.close();
}
// 3) 모바일 메뉴
{
  const p = await browser.newPage({ viewport: { width: 390, height: 800 } });
  await p.goto(`http://localhost:${PORT}/home.html`);
  await p.click("#navToggle");
  ok(await p.evaluate(() => document.getElementById("mainNav").classList.contains("open")), "모바일 메뉴 열림");
  await p.close();
}
// 4) 초성 검색
{
  const p = await browser.newPage();
  await p.goto(`http://localhost:${PORT}/home.html`);
  const chosungOk = await p.evaluate(() => window.__storeSuggest && window.__storeSuggest.matches("홍가네분식", "ㅎㄱㄴ"));
  ok(chosungOk, "초성 매칭 함수 (ㅎㄱㄴ → 홍가네분식)");
  const input = p.locator('.hero-search input[type="search"]');
  await input.fill("ㅎㄱ");
  await p.waitForTimeout(120);
  ok(await p.locator(".suggest-list li", { hasText: "홍가네분식" }).count() > 0, "초성 입력 → 드롭다운 제안");
  await p.close();
}
// 5) 지도 폴백 (키 없음)
{
  const p = await browser.newPage();
  await p.goto(`http://localhost:${PORT}/map.html`);
  ok(await p.locator(".map-fallback").count() > 0, "지도 키 없음 → 목록 폴백 안내");
  await p.close();
}
// 6) QR 위젯 렌더 (대시보드)
{
  const p = await browser.newPage();
  await p.goto(`http://localhost:${PORT}/dashboard.html`);
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => { const el = document.querySelector(".qr-img"); return !!el && el.children.length > 0; }), "QR 코드 렌더");
  await p.close();
}
// 7) 중복 제출 가드 — 진짜 제출을 숨은 iframe 으로 흘려보내 페이지 이동 없이 검증
//    (preventDefault 된 제출은 가드가 의도적으로 잠그지 않으므로 가짜 이벤트로는 검증 불가)
{
  const p = await browser.newPage();
  await p.goto(`http://localhost:${PORT}/login.html`);
  await p.fill('input[name="email"]', "x@x.kr");
  await p.fill('input[name="password"]', "12345678");
  await p.evaluate(() => {
    const f = document.querySelector('form[method="post"]');
    const ifr = document.createElement("iframe"); ifr.name = "sink"; ifr.hidden = true;
    document.body.appendChild(ifr);
    f.target = "sink"; f.action = "/login.html";
  });
  await p.click('form[method="post"] button');
  await p.waitForTimeout(80);
  ok(await p.evaluate(() => !!document.querySelector('form[method="post"] button.is-busy:disabled')), "제출 후 버튼 잠금(is-busy)");
  await p.close();
}

await browser.close();
srv.close();
console.log(`\nE2E 스모크: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
