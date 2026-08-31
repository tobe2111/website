// E2E 스모크: 실제 브라우저(Chromium)에서 JS 동작을 검증한다.
// 단위 테스트(node --test)가 못 보는 것들 — 다크 토글, 모바일 메뉴, 초성 검색 드롭다운,
// QR 렌더, 중복 제출 가드 — 를 화면에서 직접 확인.
//
// 실행:  node cloudflare/test-e2e/smoke.mjs
// 요구:  전역 playwright (npm i -g playwright) + Chromium
//        (기본 경로 /opt/pw-browsers/chromium — 없으면 playwright 내장 탐색으로 폴백)
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
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

// 전자계약 필드 배치 검증용 — 관리자 + 여러 장짜리 계약서 + 배치된 필드
const apw = await hashPassword("admin1234");
const adm = await D.createUser(env.DB, { email: "ad@x.kr", passwordHash: apw.hash, salt: apw.salt, name: "관리자", role: "ADMIN", associationId: a.id });
const { contentHash } = await import(path.join(ROOT, "src/esign.js"));
const CONTRACT = Array.from({ length: 80 }, (_, i) => `제${i + 1}조 임차인은 본 계약의 조건을 성실히 이행한다.`).join("\n");
const cdoc = await D.createDocument(env.DB, { associationId: a.id, title: "임대차계약서", body: CONTRACT, contentHash: await contentHash(CONTRACT), createdBy: adm.id, ordered: 0, dueDate: "" });
await D.createSignatureRequests(env.DB, cdoc.id, [u.id]);
await D.replaceFields(env.DB, cdoc.id, [
  { kind: "sign", label: "임차인 서명", page: 0, x: 0.55, y: 0.78, w: 0.22, h: 0.05, assignee: u.id, required: 1 },
  { kind: "stamp", label: "인감", page: 0, x: 0.8, y: 0.77, w: 0.09, h: 0.064, assignee: u.id, required: 0 },
  { kind: "date", label: "작성일", page: 0, x: 0.1, y: 0.9, w: 0.16, h: 0.03, assignee: 0, required: 1 },
]);

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
  // 하위 폴더(예: img/demo)까지 통째로 복사 — 파일만 복사하면 폴더에서 EISDIR 로 죽는다
  cpSync(path.join(ROOT, "public", sub), path.join(DIR, sub), { recursive: true });
}
async function grab(p, file, useCookie) {
  const res = await worker.fetch(new Request("http://localhost" + p, { headers: useCookie ? { cookie: ch() } : {} }), env);
  let h = await res.text();
  h = h.replace(/<link[^>]*jsdelivr[^>]*>/g, "").replace(/\?v=[a-z0-9]+/g, "");
  writeFileSync(path.join(DIR, file), h);
}
await grab("/t/seocho", "home.html");
// 모집형 랜딩 — 상담 폼의 임시 보관 동작을 실제 브라우저에서 본다
{
  await D.createAssociation(env.DB, { slug: "dapong", name: "다뽕고", kind: "franchise" });
  await grab("/t/dapong", "landing.html");   // 발행 전에도 기본 구성이 그대로 나온다
  await grab("/t/dapong?err=1&msg=" + encodeURIComponent("개인정보 수집·이용에 동의해 주세요."), "landing-err.html");
}
await grab("/t/seocho/map", "map.html");
await grab("/login", "login.html");
await grab("/t/seocho/dashboard", "dashboard.html", true);
await grab(`/t/seocho/sign/${cdoc.id}`, "signfill.html", true);
// 운영사 콘솔도 캡처 — 저장 알림이 안내문을 집어 들던 버그가 여기서만 보였다
{
  const sj = {};
  const sch = () => Object.entries(sj).map(([k, v]) => `${k}=${v}`).join("; ");
  const soak = (res) => { for (const c of res.headers.getSetCookie?.() || []) { const kv = c.split(";")[0]; const i = kv.indexOf("="); sj[kv.slice(0, i)] = kv.slice(i + 1); } };
  let sr = await worker.fetch(new Request("http://localhost/login"), env); soak(sr);
  const st = (/name="_csrf" value="([^"]+)"/.exec(await sr.text()) || [])[1];
  sr = await worker.fetch(new Request("http://localhost/login", { method: "POST", headers: { cookie: sch(), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: st, email: "s@p.kr", password: "super1234" }).toString() }), env);
  soak(sr);
  const res = await worker.fetch(new Request("http://localhost/super", { headers: { cookie: sch() } }), env);
  writeFileSync(path.join(DIR, "super.html"), (await res.text()).replace(/<link[^>]*jsdelivr[^>]*>/g, "").replace(/\?v=[a-z0-9]+/g, ""));
}
// 관리자 세션으로 배치 편집기도 캡처 (별도 쿠키)
{
  const ajar = {};
  const ach = () => Object.entries(ajar).map(([k, v]) => `${k}=${v}`).join("; ");
  const soak = (res) => { for (const c of res.headers.getSetCookie?.() || []) { const kv = c.split(";")[0]; const i = kv.indexOf("="); ajar[kv.slice(0, i)] = kv.slice(i + 1); } };
  let ar = await worker.fetch(new Request("http://localhost/login"), env); soak(ar);
  const at = (/name="_csrf" value="([^"]+)"/.exec(await ar.text()) || [])[1];
  ar = await worker.fetch(new Request("http://localhost/login", { method: "POST", headers: { cookie: ach(), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: at, email: "ad@x.kr", password: "admin1234" }).toString() }), env);
  soak(ar);
  const res = await worker.fetch(new Request(`http://localhost/t/seocho/admin/documents/${cdoc.id}/fields`, { headers: { cookie: ach() } }), env);
  writeFileSync(path.join(DIR, "fieldedit.html"), (await res.text()).replace(/\?v=[a-z0-9]+/g, ""));
}

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

// 1) 화이트 테마 고정 — 토글 제거, OS 다크여도 라이트 유지
{
  const p = await browser.newPage({ colorScheme: "dark" });
  await p.goto(`http://localhost:${PORT}/home.html`);
  ok(await p.evaluate(() => document.documentElement.getAttribute("data-theme")) === "light", "OS 다크여도 data-theme=light 고정");
  ok(await p.evaluate(() => !document.getElementById("themeToggle")), "다크 토글 버튼 제거됨");
  await p.close();
}
// 2) 첫 화면에 떠다니는 흐린 광원이 없다.
//    예전에는 blur 90px 짜리 원 두 개가 26초·30초 주기로 배경을 떠다녔다. AI 랜딩페이지의
//    대표적인 인상이었고, 게다가 '움직임 최소화' 를 켠 방문자에게도 그대로 재생됐다
//    (예전 검사는 그 재생을 오히려 성공으로 봤다). 먹빛 바탕과 타이포만 남긴다.
{
  const p = await browser.newPage({ reducedMotion: "reduce" });
  await p.goto(`http://localhost:${PORT}/home.html`);
  await p.waitForTimeout(1200);
  const moving = await p.evaluate(() => {
    if (document.querySelector(".hp-glow, .hp-glow-1, .hp-glow-2")) return "광원 요소가 남아 있음";
    // 배경 어디에도 스스로 움직이는 것이 없어야 한다
    for (const el of document.querySelectorAll(".hero-pro *, .hero-pro")) {
      const cs = getComputedStyle(el);
      if (cs.animationName && cs.animationName !== "none") return "움직이는 배경: " + cs.animationName;
    }
    return "";
  });
  ok(!moving, "첫 화면에 떠다니는 광원이 없다", moving);
  await p.close();
}
// 2-b) 저장 알림은 '저장 결과' 일 때만 뜬다.
//     안내문을 .flash 로 그려 둔 패널이 여럿 있는데(운영사 콘솔의 알림톡 키 안내 등),
//     예전에는 그것까지 집어 들어 제자리에서 뜯어내 화면 한가운데 검은 상자로 띄웠다.
//     성공 알림이 아니라 사라지지도 않아, 콘솔의 절반을 영구히 가리고 있었다.
{
  const p = await browser.newPage();
  await p.goto(`http://localhost:${PORT}/super.html`);
  await p.waitForTimeout(600);
  const floating = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll("body *").forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed") return;
      const r = el.getBoundingClientRect();
      if (r.width > 120 && r.height > 60) out.push(el.className || el.tagName);
    });
    return out;
  });
  ok(floating.length === 0, "저장하지 않았는데 화면을 가리는 알림이 없다", floating.join(", "));

  const p2 = await browser.newPage();
  await p2.goto(`http://localhost:${PORT}/super.html?msg=${encodeURIComponent("저장했습니다")}`);
  await p2.waitForTimeout(400);
  ok(await p2.evaluate(() => !!document.querySelector(".toast-save")), "저장하면 알림이 뜬다");
  await p2.close(); await p.close();
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
  const input = p.locator('.feat-search input[type="search"]');
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

// 10) 계약서 필드 배치 — 클릭으로 놓고, 드래그로 옮기고, 저장 JSON 이 좌표로 나온다
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(`http://localhost:${PORT}/fieldedit.html`);
  await p.waitForTimeout(300);
  const pages = await p.locator(".paper").count();
  ok(pages > 1, `배치 편집기: 계약서가 여러 장으로 렌더 (${pages}장)`);
  // 지면이 화면 폭에 맞춰 축소되되 내부 리플로우는 없어야 한다(좌표 고정의 전제)
  ok(await p.evaluate(() => document.querySelector(".paper").offsetWidth === 794), "지면 내부 폭은 794px 로 고정(축소는 transform 으로만)");

  const before = await p.locator(".pf").count();
  await p.click('.fp-item[data-kind="stamp"]');
  await p.locator(".paper").first().scrollIntoViewIfNeeded();
  const box = await p.locator(".paper").first().boundingBox();
  // 화면 안에 확실히 들어오는 지점(위쪽 1/4)을 클릭 — 기존 필드가 없는 빈 자리
  await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.22);
  ok(await p.locator(".pf").count() === before + 1, "지면 클릭으로 도장 필드가 생성됨");
  ok(await p.locator("#fieldProps").isVisible(), "생성 즉시 속성 패널이 열림");

  const sel = p.locator(".pf-sel");
  const left0 = await sel.evaluate((el) => parseFloat(el.style.left));
  const b2 = await sel.boundingBox();
  await p.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await p.mouse.down();
  await p.mouse.move(b2.x + b2.width / 2 + 120, b2.y + b2.height / 2 + 40, { steps: 8 });
  await p.mouse.up();
  const left1 = await sel.evaluate((el) => parseFloat(el.style.left));
  ok(left1 > left0 + 5, "드래그로 필드가 이동함");

  await p.fill("#fpLabel", "법인 인감");
  const json = await p.evaluate(() => {
    document.getElementById("fieldsForm").dispatchEvent(new Event("submit", { cancelable: true }));
    return document.getElementById("fieldsData").value;
  });
  const parsed = JSON.parse(json);
  ok(parsed.length === before + 1, "저장 데이터에 모든 필드가 담김");
  const stamp = parsed.find((f) => f.label === "법인 인감");
  ok(!!stamp && stamp.kind === "stamp", "이름표와 종류가 저장 데이터에 반영");
  ok(stamp.x > 0 && stamp.x < 1 && stamp.y > 0 && stamp.y < 1, "좌표가 0~1 비율로 정규화");
  await p.close();
}

// 11) 서명자 화면 — 내 자리 안내, 서명 그리기, 도장 생성, 필수 충족 전 제출 잠금
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(`http://localhost:${PORT}/signfill.html`);
  await p.waitForTimeout(300);
  ok(await p.locator(".pf-mine").count() >= 2, "내가 채울 자리가 강조 표시됨");
  ok((await p.locator("#fieldProgress").textContent()).includes("남았습니다"), "남은 필수 항목 안내 — 몇 개 중 몇 개인지");
  ok(await p.locator("#signSubmit").isDisabled(), "필수 항목 전에는 제출 버튼 잠금");

  // 서명 필드 → 캔버스에 그리기
  await p.locator('.pf-mine[data-kind="sign"]').click();
  ok(await p.locator("#fieldDialog").isVisible(), "서명 입력창이 열림");
  const pad = await p.locator(".fd-pad").boundingBox();
  await p.mouse.move(pad.x + 30, pad.y + pad.height / 2);
  await p.mouse.down();
  await p.mouse.move(pad.x + 200, pad.y + 40, { steps: 10 });
  await p.mouse.move(pad.x + 320, pad.y + pad.height - 30, { steps: 10 });
  await p.mouse.up();
  await p.click("#fdOk");
  ok(await p.locator('.pf[data-kind="sign"] img').count() === 1, "그린 서명이 계약서 자리에 박힘");

  // 날짜 필드
  await p.locator('.pf-mine[data-kind="date"]').click();
  await p.click("#fdOk"); // 오늘 날짜가 기본값
  // 필수 항목을 다 채워도 '동의' 전에는 아직 잠겨 있어야 한다 — 버튼이 눌리는데 브라우저가
  // 막아 세우면, 사람은 왜 안 되는지 모른 채 페이지를 닫는다.
  ok(await p.locator("#signSubmit").isDisabled() === true, "동의 전에는 여전히 잠겨 있음");
  ok((await p.locator("#signWhy").textContent()).includes("동의"), "왜 못 누르는지 알려 줌");
  await p.locator("#signConsent").check();
  ok(await p.locator("#signSubmit").isDisabled() === false, "필수 항목 + 동의를 마치면 제출 잠금 해제");
  ok((await p.locator("#signWhy").textContent()).includes("제출할 수 있습니다"), "이제 된다고 알려 줌");
  ok((await p.locator("#fieldProgress").textContent()).includes("모두 채웠"), "완료 안내로 바뀜");

  // 도장 생성 (선택 항목)
  await p.locator('.pf-mine[data-kind="stamp"]').click();
  await p.click("#fdOk");
  const stampSrc = await p.locator('.pf[data-kind="stamp"] img').getAttribute("src");
  ok(!!stampSrc && stampSrc.startsWith("data:image/png"), "이름으로 도장 이미지가 생성됨");

  const payload = await p.evaluate(() => {
    document.getElementById("signForm").dispatchEvent(new Event("submit", { cancelable: true }));
    return { fields: document.getElementById("fieldValues").value, sig: document.getElementById("signatureData").value };
  });
  const vals = JSON.parse(payload.fields);
  ok(Object.keys(vals).length === 3, "채운 값 3개가 전송 데이터에 담김");
  ok(payload.sig.startsWith("data:image/png"), "서명 필드 그림이 대표 서명으로 전달됨");
  await p.close();
}

// N) 상담 폼 임시 보관 — 검증에 걸려 되돌아와도 쓰던 값이 살아 있어야 한다.
//    긴 문의 내용을 다시 치게 만들면 가장 진지한 신청자부터 나간다.
{
  const p = await browser.newPage();
  await p.goto(`http://localhost:${PORT}/landing.html`);
  await p.fill('[name="name"]', "김창업");
  await p.fill('[name="phone"]', "010-1234-5678");
  await p.fill('[name="region"]', "수원 영통");
  await p.fill('[name="message"]', "상권 분석을 먼저 받아보고 싶습니다. 평일 오후에 통화 가능합니다.");
  await p.check('[name="agree_marketing"]');
  // 서버로 실제 전송하지는 않고, 제출 이벤트만 일으켜 보관 동작을 확인한다
  await p.evaluate(() => document.getElementById("leadForm").dispatchEvent(new Event("submit", { cancelable: true })));
  const stashed = await p.evaluate(() => {
    const k = Object.keys(sessionStorage).find((x) => x.startsWith("draft:"));
    return k ? JSON.parse(sessionStorage.getItem(k)) : null;
  });
  ok(stashed && stashed.name === "김창업" && stashed.message.includes("상권 분석"), "상담 폼: 제출 시 입력값 임시 보관");
  ok(stashed && !("agree_marketing" in stashed), "동의 체크는 보관하지 않음 (본인이 다시 체크해야 동의다)");
  ok(stashed && !("_csrf" in stashed), "CSRF 토큰은 보관하지 않음");

  // 검증 실패로 되돌아온 화면(err=1) — 값이 복원되어야 한다
  await p.goto(`http://localhost:${PORT}/landing-err.html?err=1&msg=x`);
  const restored = await p.evaluate(() => ({
    name: document.querySelector('[name="name"]').value,
    message: document.querySelector('[name="message"]').value,
    agree: document.querySelector('[name="agree"]').checked,
  }));
  ok(restored.name === "김창업", "되돌아온 화면에서 성함 복원");
  ok(restored.message.includes("상권 분석"), "긴 문의 내용도 복원");
  ok(restored.agree === false, "개인정보 동의는 자동으로 체크되지 않음");

  // 접수 성공(err 없음)이면 보관분을 지운다 — 남겨 둘 이유가 없다
  await p.goto(`http://localhost:${PORT}/landing.html?msg=${encodeURIComponent("접수되었습니다")}`);
  const cleared = await p.evaluate(() => Object.keys(sessionStorage).filter((x) => x.startsWith("draft:")).length === 0);
  ok(cleared, "접수되면 보관분 삭제 (개인정보를 남겨 두지 않는다)");
  await p.close();
}

// N) 사진 줄여 올리기 — 폰 사진 한 장이 모든 방문자의 첫 화면을 망치지 않게.
{
  const p = await browser.newPage();
  await p.goto(`http://localhost:${PORT}/landing.html`);
  // 실제 폰 사진에 가까운 큰 JPEG 을 만들어 파일 입력에 넣는다
  const big = await p.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 4032; c.height = 3024;                      // 요즘 폰 기본 해상도
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 4032, 3024);
    grad.addColorStop(0, "#204060"); grad.addColorStop(1, "#c08a20");
    g.fillStyle = grad; g.fillRect(0, 0, 4032, 3024);
    for (let i = 0; i < 20000; i++) {                     // 압축이 잘 안 되게 잡티
      g.fillStyle = `rgba(${(i * 37) % 255},${(i * 91) % 255},${(i * 53) % 255},.6)`;
      g.fillRect((i * 173) % 4032, (i * 71) % 3024, 12, 12);
    }
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
    const buf = new Uint8Array(await blob.arrayBuffer());
    window.__big = { bytes: [...buf], size: blob.size };
    return blob.size;
  });
  // 파일 입력 하나를 만들어 붙이고(랜딩에는 업로드 칸이 없다) 실제 핸들러를 태운다
  const res = await p.evaluate(async () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    const label = document.createElement("label");
    label.appendChild(input); document.body.appendChild(label);
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(window.__big.bytes)], "IMG_4821.jpg", { type: "image/jpeg" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 100 && input.files[0].name !== "IMG_4821.jpg" === false; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1500));
    const f = input.files[0];
    const bmp = await createImageBitmap(f);
    return { name: f.name, size: f.size, w: bmp.width, h: bmp.height,
             tip: (label.querySelector(".shrink-tip") || {}).textContent || "" };
  });
  ok(res.size < big / 3, `큰 사진을 줄여서 올린다 (${(big / 1024 / 1024).toFixed(1)}MB → ${(res.size / 1024).toFixed(0)}KB)`);
  ok(Math.max(res.w, res.h) === 1600, `긴 변을 1600px 로 맞춘다 (${res.w}×${res.h})`);
  ok(/줄여서 올립니다/.test(res.tip), "무엇을 했는지 관리자에게 알려준다");
  await p.close();
}

await browser.close();
srv.close();
console.log(`\nE2E 스모크: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
