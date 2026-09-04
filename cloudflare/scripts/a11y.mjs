// 접근성 실측 — 이 화면의 이용자는 40~60대 예비 창업자와 점주다.
// 대비가 낮으면 안 읽히고, 버튼이 작으면 안 눌린다. 그건 그대로 상담 신청 수로 빠진다.
//
//   node --experimental-sqlite scripts/a11y.mjs
//
// 검사: 글자 대비(WCAG AA) · 터치 목표 크기 · 폼 이름표 · 제목 순서 ·
//       키보드 초점 표시 · 이미지 대체텍스트 · 200% 확대 시 가로 스크롤
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import worker from "../src/index.js";
import { makeEnv } from "../test/shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { serializeLandingLayout, defaultLandingLayout } from "../src/franchise.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = mkdtempSync(path.join(tmpdir(), "a11y-"));
for (const sub of ["css", "js", "img"]) {
  mkdirSync(path.join(DIR, sub), { recursive: true });
  cpSync(path.join(ROOT, "public", sub), path.join(DIR, sub), { recursive: true });
}

const env = makeEnv();
const su = await hashPassword("x1234567");
await D.createUser(env.DB, { email: "s@e.kr", passwordHash: su.hash, salt: su.salt, name: "s", role: "SUPERADMIN", associationId: null });
const a = await D.createAssociation(env.DB, { slug: "demo", name: "다뽕고", kind: "franchise", preset: "franchise" });
await D.updateAssociation(env.DB, a.id, {
  name: "다뽕고", tagline: "삼겹살 창업, 결국 쉬워야 합니다", brand_color: "#e8b400",
  phone: "1600-9280", email: "hq@e.kr", address: "서울 서초구", logo: "", hero_image: "",
});
const ad = await hashPassword("admin1234");
await D.createUser(env.DB, { email: "admin@e.kr", passwordHash: ad.hash, salt: ad.salt, name: "본사", role: "ADMIN", associationId: a.id });
const lay = defaultLandingLayout("다뽕고", "franchise").map((s) => {
  if (s.type === "reviews") return { ...s, items: "후기 하나입니다. 두 문장 정도 길이를 담습니다. | 수원 영통점 김○○ 점주" };
  if (s.type === "menu") return { ...s, items: "대표 삼겹살 | 12,000원\n목살 정식 | 13,000원" };
  if (s.type === "cost") return { ...s, locked: false, items: "가맹비 | 1,000만원 | 부가세 별도" };
  if (s.type === "lead") return { ...s, extras: "희망 오픈 시기 | 선택 | 3개월 내;6개월 내;미정" };
  return s;
});
await D.saveLandingLayout(env.DB, a.id, serializeLandingLayout(lay));
await D.publishLandingDraft(env.DB, a.id).catch(() => {});
for (const [n, ph, r, b] of [["김창업", "010-1234-5678", "수원 영통", "1억원 ~ 2억원"], ["이점주", "010-2222-3333", "부산 서면", "5천만원 ~ 1억원"]])
  await D.createLead(env.DB, { associationId: a.id, name: n, phone: ph, region: r, budget: b, funnel: "네이버 검색", message: "문의" });
for (let i = 0; i < 60; i++) await D.bumpLandingView(env.DB, a.id, "");

let cookie = "";
{
  const g = await worker.fetch(new Request("http://localhost/login"), env);
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const lr = await worker.fetch(new Request("http://localhost/login", {
    method: "POST", headers: { cookie: seed, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: tk, email: "admin@e.kr", password: "admin1234" }).toString(),
  }), env);
  cookie = [seed, ...(lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");
}
async function grab(p, file, auth) {
  const res = await worker.fetch(new Request("http://localhost" + p, {
    headers: { ...(auth ? { cookie } : {}), "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
  }), env);
  writeFileSync(path.join(DIR, file), (await res.text()).replace(/<link[^>]*jsdelivr[^>]*>/g, "").replace(/\?v=[a-z0-9]+/g, ""));
}
await grab("/t/demo", "landing.html");
await grab("/t/demo/admin/leads", "leads.html", true);
await grab("/t/demo/admin/landing", "editor.html", true);

// ── 상인회 홈 —— 이 화면의 이용자는 동네 손님과 40~60대 점주다.
// 랜딩만 재고 있으면, 정작 사람이 가장 많이 여는 화면(가게를 찾는 홈)이 측정 밖에 남는다.
// 팝업은 화면을 가로막는 유일한 요소라 반드시 함께 잰다 — 대비가 낮으면 닫을 단추도 안 보인다.
const { seedDemo } = await import("../src/demoContent.js");
const m = await D.createAssociation(env.DB, { slug: "market", name: "방배 카페골목 상인회", kind: "merchant" });
await seedDemo(env, env.DB, m, { emailDomain: "market.kr" });
await D.updateAssociation(env.DB, m.id, {
  name: "방배 카페골목 상인회", tagline: "커피 한 잔에서 시작하는 골목", brand_color: "#6F4423",
  phone: "02-9410-1004", email: "office@market.kr", address: "서울 서초구 방배로 42",
  logo: "", hero_image: "", hero_video: "", naver_verification: "", google_verification: "", ga_measurement_id: "",
});
await D.createPopup(env.DB, { associationId: m.id, title: "여름 골목 야시장이 열립니다",
  body: "8월 15일(금) 저녁 6시부터 10시까지 골목길을 차 없는 거리로 운영합니다.",
  linkUrl: "/t/market/events", linkLabel: "행사 자세히 보기" });
await grab("/t/market", "market-home.html");
await grab("/t/market/businesses", "market-list.html");
await grab("/t/market/notices", "market-notices.html");
await grab("/t/market/map", "market-map.html");
await grab("/t/market/events", "market-events.html");
await grab("/t/market/business/goeul-gukbap", "market-biz.html");

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
const srv = http.createServer((req, res) => {
  const f = path.join(DIR, req.url.split("?")[0]);
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const PORT = srv.address().port;

const AUDIT = () => {
  const out = { contrast: [], tap: [], label: [], heading: [], alt: [], focus: [], misc: [] };
  const px = (v) => parseFloat(v) || 0;
  // 색 문자열 → {r,g,b,a}
  //
  // ⚠️ 예전에는 rgb()/rgba() 만 정규식으로 읽었습니다. 그런데 이 사이트의 브랜드 색 단계는
  // color-mix(in oklab, …) 로 파생되고, 크롬은 그 계산 결과를 **oklab(...)** 문자열로 돌려줍니다.
  // 그래서 정규식이 못 읽고 null → "배경을 모르겠다" → body 의 흰색으로 후퇴했고,
  // 결과적으로 **짙은 브랜드 배경 위의 흰 글자가 흰 바탕 위의 흰 글자로 측정**됐습니다.
  // 랜딩 히어로에서 1.09:1 이라는 있을 수 없는 값이 나온 것이 그 때문입니다.
  // 브라우저가 이미 계산해 둔 색이므로, 1×1 캔버스에 칠해 sRGB 바이트로 돌려받습니다 —
  // oklab·lab·color(display-p3 …) 등 앞으로 어떤 표기가 와도 그대로 읽힙니다.
  const cvs = document.createElement("canvas");
  cvs.width = cvs.height = 1;
  const cx = cvs.getContext("2d", { willReadFrequently: true });
  const parse = (c) => {
    const v = String(c || "").trim();
    if (!v || v === "transparent") return null;
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(v);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
    try {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = "#000";
      cx.fillStyle = v;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    } catch { return null; }
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (fg, bg) => ({                    // 반투명 글자색을 배경 위에 합성
    r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
  });
  const ratio = (f, b) => { const L1 = lum(f), L2 = lum(b); const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1]; return (hi + 0.05) / (lo + 0.05); };
  const bgOf = (el) => {                          // 실제로 뒤에 깔린 색 (투명하면 위로 올라간다)
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null;   // 사진 위 글자는 자동 판정 불가
      const c = parse(cs.backgroundColor);
      if (c && c.a >= 0.95) return c;
      if (c && c.a > 0) return null;              // 반투명 겹침은 자동 판정 불가
      n = n.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  };
  const sel = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = (el.className && typeof el.className === "string") ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const seen = new Set();

  // ① 글자 대비
  for (const el of document.querySelectorAll("body *")) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const fg = parse(cs.color), bg = bgOf(el);
    if (!fg || !bg) continue;
    const size = px(cs.fontSize), weight = +cs.fontWeight || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(over(fg, bg), bg);
    if (got + 0.005 < need) {
      const key = `${sel(el)}|${cs.color}|${got.toFixed(2)}`;
      if (!seen.has(key)) { seen.add(key); out.contrast.push({ sel: sel(el), text: own.slice(0, 28), got: +got.toFixed(2), need, size: Math.round(size), weight }); }
    }
  }
  // ② 터치 목표. 손가락 화면은 44px, 마우스 화면은 WCAG 2.2 AA 의 24px 을 본다.
  //    체크박스처럼 label 이 통째로 눌리는 것은 label 을 잰다 — 실제로 누르는 넓이가 그것이다.
  //    본문 문장 속 링크(인라인)는 크기 기준을 적용하지 않는다 — 글줄 높이가 곧 크기다.
  const MIN = window.__touch ? 44 : 24;
  for (const el of document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [role=button]")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    if (el.closest("[aria-hidden=true]")) continue;
    if (cs.display === "inline" && el.tagName === "A") continue;
    const lab = el.closest("label");
    const r = (lab && lab.contains(el) ? lab : el).getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.width < MIN || r.height < MIN) out.tap.push({ sel: sel(el), text: (el.textContent || el.value || "").trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) });
  }
  // ③ 폼 이름표
  for (const el of document.querySelectorAll("input:not([type=hidden]), select, textarea")) {
    if (el.closest("[aria-hidden=true]") || el.getAttribute("aria-hidden") === "true") continue;
    const has = el.labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.closest("label") || el.getAttribute("title");
    if (!has) out.label.push({ sel: sel(el), name: el.name || "(이름없음)", type: el.type || el.tagName.toLowerCase() });
  }
  // ④ 제목 순서
  let prev = 0;
  for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    const lv = +h.tagName[1];
    if (prev && lv > prev + 1) out.heading.push({ from: `h${prev}`, to: `h${lv}`, text: h.textContent.trim().slice(0, 26) });
    prev = lv;
  }
  if (document.querySelectorAll("h1").length !== 1) out.misc.push(`h1 이 ${document.querySelectorAll("h1").length}개 (1개여야 함)`);
  // ⑤ 이미지 대체텍스트
  for (const img of document.images) if (img.getAttribute("alt") == null) out.alt.push({ src: (img.currentSrc || img.src).split("/").pop().slice(0, 30) });
  // ⑥ 기타
  if (!document.documentElement.lang) out.misc.push("html lang 없음");
  if (!document.querySelector("main")) out.misc.push("main 랜드마크 없음");
  return out;
};

const pwRoot = execSync("npm root -g").toString().trim();
const { chromium } = await import(path.join(pwRoot, "playwright/index.mjs"));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());

const PAGES = [
  ["손님이 보는 랜딩 (모바일)", "landing.html", { width: 390, height: 844, isMobile: true }],
  ["상인회 홈 (모바일)", "market-home.html", { width: 390, height: 844, isMobile: true }],
  ["상인회 홈 (데스크톱)", "market-home.html", { width: 1440, height: 900 }],
  ["가입 점포 목록 (모바일)", "market-list.html", { width: 390, height: 844, isMobile: true }],
  ["가게 페이지 (모바일)", "market-biz.html", { width: 390, height: 844, isMobile: true }],
  ["공지·소식 (모바일)", "market-notices.html", { width: 390, height: 844, isMobile: true }],
  ["점포 지도 (모바일)", "market-map.html", { width: 390, height: 844, isMobile: true }],
  ["행사 (모바일)", "market-events.html", { width: 390, height: 844, isMobile: true }],
  ["상담 DB 콘솔", "leads.html", { width: 1280, height: 900 }],
  ["랜딩 편집기", "editor.html", { width: 1280, height: 900 }],
];
let problems = 0;
for (const [label, file, vp] of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.isMobile, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto(`http://localhost:${PORT}/${file}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(300);
  await p.evaluate((t) => { window.__touch = t; }, !!vp.isMobile);
  const r = await p.evaluate(AUDIT);

  // 키보드 초점이 눈에 보이는가 — 실제로 Tab 을 눌러 확인한다
  const focus = await p.evaluate(async () => {
    const first = document.querySelector("a[href], button, input:not([type=hidden])");
    if (!first) return null;
    first.focus();
    const cs = getComputedStyle(first);
    const vis = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
      cs.boxShadow !== "none" || cs.getPropertyValue("--focus-ring");
    return { sel: first.tagName.toLowerCase(), visible: !!vis, outline: cs.outline, shadow: cs.boxShadow.slice(0, 40) };
  });

  // 글자 200% 확대 — 저시력 이용자의 기본 설정. 가로 스크롤이 생기면 읽기가 무너진다
  await p.addStyleTag({ content: "html{font-size:200%!important}" });
  await p.waitForTimeout(200);
  const zoom = await p.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    sw: document.documentElement.scrollWidth, iw: window.innerWidth }));

  console.log(`\n■ ${label}  (${vp.width}px)`);
  const show = (name, arr, fmt) => {
    if (!arr.length) { console.log(`   ✓ ${name}`); return; }
    problems += arr.length;
    console.log(`   ✗ ${name} — ${arr.length}건`);
    arr.slice(0, 6).forEach((x) => console.log(`       ${fmt(x)}`));
    if (arr.length > 6) console.log(`       … 외 ${arr.length - 6}건`);
  };
  show("글자 대비 (WCAG AA)", r.contrast, (x) => `${x.got}:1 (필요 ${x.need}) ${x.size}px/${x.weight} · ${x.sel} · "${x.text}"`);
  show(`터치 목표 ${vp.isMobile ? 44 : 24}px`, r.tap, (x) => `${x.w}×${x.h} · ${x.sel} · "${x.text}"`);
  show("폼 이름표", r.label, (x) => `${x.sel} name=${x.name} (${x.type})`);
  show("제목 순서", r.heading, (x) => `${x.from} → ${x.to} · "${x.text}"`);
  show("이미지 대체텍스트", r.alt, (x) => x.src);
  if (focus) { if (focus.visible) console.log("   ✓ 키보드 초점 표시"); else { problems++; console.log(`   ✗ 키보드 초점이 보이지 않음 (${focus.sel})`); } }
  if (zoom.overflow) { problems++; console.log(`   ✗ 글자 200% 확대 시 가로 스크롤 (${zoom.sw}px > ${zoom.iw}px)`); }
  else console.log("   ✓ 글자 200% 확대에도 가로 스크롤 없음");
  r.misc.forEach((m) => { problems++; console.log(`   ✗ ${m}`); });
  await ctx.close();
}
console.log(`\n합계 ${problems}건\n`);
await browser.close();
srv.close();
