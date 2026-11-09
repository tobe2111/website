// 접근성 실측 — 정형외과 환자는 중장년이 많다. 글자가 흐리면 안 읽히고, 단추가 작으면 안 눌린다.
//
//   node clinic/scripts/a11y.mjs cheonsaem         (여러 개: node clinic/scripts/a11y.mjs cheonsaem sample-b)
//
// 모든 페이지를 휴대폰(390px)과 PC(1440px)로 실제로 띄워 잰다. 기준은 국제 웹 접근성 기준(WCAG 2.2 AA):
//   · 글자 대비 — 보통 글자 4.5:1, 큰 글자(24px 이상, 굵으면 18.7px 이상) 3:1
//   · 누르는 곳 — 휴대폰에서 44×44px 이상 (문장 속 글자 링크는 예외)
//   · 사진 설명(alt) · 제목(h1) 하나 · 화면이 옆으로 넘치지 않음(320px — 글자 200% 확대와 같은 폭)
// 하나라도 걸리면 어느 페이지 어느 요소인지 적고 실패(종료 코드 1)로 끝난다.
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { build } from "../build.mjs";

// Playwright 는 저장소에 넣지 않고(외부 의존성 0) 검사하는 컴퓨터에 전역으로 깐다. 가까운 곳에 없으면 전역에서 찾는다.
function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req("playwright"); } catch {}
  try { return req(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright")); } catch { return null; }
}
const pw = loadPlaywright();
if (!pw) { console.error("Playwright 가 없습니다: npm i -g playwright && npx playwright install chromium"); process.exit(1); }
const { chromium } = pw;
const ids = process.argv.slice(2);
if (!ids.length) { console.error("사용법: node clinic/scripts/a11y.mjs <병원 폴더 이름> [...]"); process.exit(1); }

const TYPES = { html: "text/html; charset=utf-8", css: "text/css", js: "text/javascript", svg: "image/svg+xml", png: "image/png", webp: "image/webp", jpg: "image/jpeg", xml: "text/xml", txt: "text/plain" };
function serve(dir) {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      let f = path.join(dir, p);
      if (existsSync(f) && statSync(f).isDirectory()) f = path.join(f, "index.html");
      if (!existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": TYPES[f.split(".").pop()] || "application/octet-stream" });
      res.end(readFileSync(f));
    }).listen(0, () => ok(s));
  });
}

// 브라우저 안에서 도는 측정. 글자 대비는 글자색과 '실제로 뒤에 깔린' 배경색(조상을 거슬러 올라가며 처음 만나는 불투명 배경)으로 잰다.
function measure(mobile) {
  // 브라우저는 색을 rgb(…) 또는 color(srgb 0~1 …) 로 돌려준다. 후자는 0~1 이라 255 를 곱해야 한다.
  const rgb = (s) => {
    const m = s.match(/[\d.]+/g);
    if (!m) return [0, 0, 0, 1];
    const n = m.map(Number);
    if (s.startsWith("color(")) return [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1];
    return [n[0], n[1], n[2], n[3] ?? 1];
  };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (fg, bg) => { const a = fg[3] ?? 1; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)); };
  const bgOf = (el) => {
    let layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== "none" && !/gradient/.test(cs.backgroundImage)) return null; // 사진 위 글자는 눈으로 본다
      const c = rgb(cs.backgroundColor);
      if ((c[3] ?? 1) > 0) { layers.push(c); if ((c[3] ?? 1) >= 1) break; }
    }
    let bg = [255, 255, 255];
    for (const c of layers.reverse()) bg = blend(c, bg);
    return bg;
  };
  const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} "${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 24)}"`;
  // 닫힌 <details>(휴대폰 메뉴·자주 묻는 질문) 안쪽은 화면에 없다 — 여닫는 손잡이(summary)만 센다
  const hidden = (el) => { const d = el.closest("details:not([open])"); return d && !el.closest("summary"); };
  const vis = (el) => { if (hidden(el)) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.05; };
  const out = [];
  // 1) 글자 대비
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    // 첫 화면 사진 위에 투명하게 뜬 머리의 흰 글자는 뒤 배경이 사진이라 여기서 못 잰다(사진이 들어온 뒤 눈으로 본다)
    if (!vis(el) || el.closest("[aria-hidden=true], .ph, .hero-spec, .skip, [disabled], .hd-over:not(.scrolled)")) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    const bg = bgOf(el);
    if (!bg) continue;
    const fg = blend(rgb(cs.color), bg);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const key = `${cs.color}|${bg}|${need}`;
    if (ratio < need && !seen.has(key)) { seen.add(key); out.push(`글자 대비 ${ratio.toFixed(2)} < ${need} — ${label(el)}`); }
  }
  // 2) 누르는 곳 크기 (휴대폰만)
  if (mobile) {
    for (const el of document.querySelectorAll("a, button, summary, input:not([type=hidden]), select, textarea")) {
      if (!vis(el) || el.closest(".hp, [aria-hidden=true]")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "inline" && el.closest("p, li, td, dd, small, label")) continue; // 문장 속 글자 링크는 예외
      const r = el.getBoundingClientRect();
      const tgt = el.type === "checkbox" ? 22 : 44;
      if (r.height < tgt - 0.5 || r.width < tgt - 0.5) out.push(`누르는 곳 ${Math.round(r.width)}×${Math.round(r.height)} < ${tgt} — ${label(el)}`);
    }
  }
  // 3) 사진 설명 · 제목 · 옆으로 넘침
  for (const img of document.querySelectorAll("img")) if (!img.hasAttribute("alt")) out.push(`사진 설명(alt) 없음 — ${img.src}`);
  const h1 = document.querySelectorAll("h1").length;
  if (h1 !== 1) out.push(`h1 이 ${h1}개`);
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`화면이 옆으로 ${document.documentElement.scrollWidth - innerWidth}px 넘침`);
  return out;
}

let fails = 0, checked = 0;
const br = await chromium.launch();
for (const id of ids) {
  const out = mkdtempSync(path.join(tmpdir(), `a11y-${id}-`));
  const { pages } = build(id, { outDir: out });
  const srv = await serve(out);
  const base = `http://localhost:${srv.address().port}`;
  for (const [name, vp, mobile] of [["휴대폰", { width: 390, height: 844 }, true], ["PC", { width: 1440, height: 900 }, false], ["확대200%", { width: 320, height: 640 }, true]]) {
    // 움직임을 끈 상태로 잰다 — 떠오르기 전의 투명한 글자를 '흐리다'고 오판하지 않게
    const ctx = await br.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    for (const p of pages) {
      await page.goto(base + p, { waitUntil: "load" });
      const issues = name === "확대200%" ? (await page.evaluate(measure, false)).filter((x) => x.includes("넘침")) : await page.evaluate(measure, mobile);
      checked++;
      for (const i of issues) { fails++; console.log(`✗ [${id} · ${name}] ${p}  ${i}`); }
    }
    await ctx.close();
  }
  srv.close();
}
await br.close();
console.log(fails ? `\n접근성 문제 ${fails}건 (화면 ${checked}개 검사)` : `✓ 접근성 문제 없음 — 화면 ${checked}개 검사 (휴대폰·PC·200% 확대)`);
process.exit(fails ? 1 : 0);
