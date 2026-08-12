// 랜딩 실측 — 감이 아니라 숫자로.
//
// 광고를 타고 들어온 사람은 첫 화면이 늦으면 그냥 나간다. 그 이탈은 그대로 상담 신청 수로 빠진다.
// 그래서 "빨라 보인다" 가 아니라 재서 확인한다. 모바일 4G + 느린 CPU 로 조인다 —
// 사무실 기가 와이파이에서 재면 항상 빠르고, 그 숫자는 아무 것도 말해 주지 않는다.
//
//   node --experimental-sqlite scripts/measure.mjs
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import fs from "node:fs";
import { execSync } from "node:child_process";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import worker from "../src/index.js";
import { makeEnv } from "../test/shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { serializeLandingLayout, defaultLandingLayout } from "../src/franchise.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = mkdtempSync(path.join(tmpdir(), "measure-"));
for (const sub of ["css", "js", "img"]) {
  mkdirSync(path.join(DIR, sub), { recursive: true });
  cpSync(path.join(ROOT, "public", sub), path.join(DIR, sub), { recursive: true });
}

// 히어로 사진 대역 — 실제 브랜드가 올릴 법한 크기(약 250KB)의 JPEG 를 만들어 둔다.
// 사진 없이 재면 preload 의 효과를 볼 수 없고, 실제 고객사는 반드시 사진을 넣는다.
async function makeHero(w, h, q, blots) {
  const pwRoot = execSync("npm root -g").toString().trim();
  const { chromium } = await import(path.join(pwRoot, "playwright/index.mjs"));
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
  const p = await b.newPage();
  const uri = await p.evaluate(({ w, h, q, blots }) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#3b2d12"); grad.addColorStop(1, "#c08a20");
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    for (let i = 0; i < blots; i++) {          // 사진처럼 압축이 잘 안 되게 잡티를 뿌린다
      g.fillStyle = `rgba(${(i * 37) % 255},${(i * 91) % 255},${(i * 53) % 255},.5)`;
      g.fillRect((i * 173) % w, (i * 71) % h, Math.round(w / 180), Math.round(w / 180));
    }
    return c.toDataURL("image/jpeg", q);
  }, { w, h, q, blots });
  await b.close();
  return Buffer.from(uri.split(",")[1], "base64");
}
// 폰이 찍은 그대로 (요즘 기본 4032×3024) vs 브라우저가 줄인 것 (긴 변 1600 · 품질 .82)
const heroPhone = await makeHero(4032, 3024, 0.92, 20000);
const heroSmall = await makeHero(1600, 1200, 0.82, 9000);
writeFileSync(path.join(DIR, "img", "hero-phone.jpg"), heroPhone);
writeFileSync(path.join(DIR, "img", "hero-small.jpg"), heroSmall);
console.log(`폰 사진 그대로 ${(heroPhone.length / 1024).toFixed(0)}KB · 줄인 사진 ${(heroSmall.length / 1024).toFixed(0)}KB\n`);

async function landingHtml({ hero }) {   // hero: false | "phone" | "small"
  const env = makeEnv();
  const su = await hashPassword("x1234567");
  await D.createUser(env.DB, { email: "s@e.kr", passwordHash: su.hash, salt: su.salt, name: "s", role: "SUPERADMIN", associationId: null });
  const a = await D.createAssociation(env.DB, { slug: "demo", name: "다뽕고", kind: "franchise", preset: "franchise" });
  await D.updateAssociation(env.DB, a.id, {
    name: "다뽕고", tagline: "삼겹살 창업, 결국 쉬워야 합니다", brand_color: "#e8b400",
    phone: "1600-9280", email: "hq@e.kr", address: "서울 서초구", logo: "", hero_image: hero ? `/img/hero-${hero}.jpg` : "",
  });
  const lay = defaultLandingLayout("다뽕고", "franchise").map((s) => {
    if (s.type === "reviews") return { ...s, items: Array.from({ length: 3 }, (_, i) => `점주 후기 ${i + 1} 입니다. 실제 길이에 가깝게 두 문장 정도를 담습니다. | 지점 ${i + 1} 점주`).join("\n") };
    if (s.type === "menu") return { ...s, items: Array.from({ length: 8 }, (_, i) => `메뉴 ${i + 1} | ${(i + 8) * 1000}원`).join("\n") };
    if (s.type === "cost") return { ...s, locked: false, items: Array.from({ length: 5 }, (_, i) => `항목 ${i + 1} | ${(i + 1) * 500}만원 | 비고`).join("\n") };
    if (s.type === "lead") return { ...s, extras: "희망 오픈 시기 | 선택 | 3개월 내;6개월 내;미정" };
    return s;
  });
  await D.saveLandingLayout(env.DB, a.id, serializeLandingLayout(lay));
  await D.publishLandingDraft(env.DB, a.id).catch(() => {});
  const res = await worker.fetch(new Request("http://localhost/t/demo", {
    headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
  }), env);
  return (await res.text()).replace(/<link[^>]*jsdelivr[^>]*>/g, "").replace(/\?v=[a-z0-9]+/g, "");
}

const phoneHtml = await landingHtml({ hero: "phone" });
writeFileSync(path.join(DIR, "phone.html"), phoneHtml);
// 대조군: preload 줄만 뺀다. 나머지는 한 글자도 다르지 않아야 비교가 성립한다.
writeFileSync(path.join(DIR, "phone-nopreload.html"), phoneHtml.replace(/<link rel="preload"[^>]*>\n?/, ""));
writeFileSync(path.join(DIR, "small.html"), await landingHtml({ hero: "small" }));
writeFileSync(path.join(DIR, "nohero.html"), await landingHtml({ hero: false }));

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json" };
// ★ 압축은 반드시 켠다. Cloudflare 는 텍스트 자산을 brotli 로 보내는데, 압축 없이 재면
//   CSS 가 실제의 대여섯 배로 보이고, 있지도 않은 문제를 고치게 된다.
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|manifest))/;
const srv = http.createServer((req, res) => {
  const f = path.join(DIR, req.url.split("?")[0]);
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
  const type = MIME[path.extname(f)] || "application/octet-stream";
  const body = fs.readFileSync(f);
  const accepts = String(req.headers["accept-encoding"] || "");
  if (COMPRESSIBLE.test(type) && /br/.test(accepts)) {
    const out = zlib.brotliCompressSync(body);
    res.writeHead(200, { "content-type": type, "content-encoding": "br", "content-length": out.length });
    res.end(out); return;
  }
  if (COMPRESSIBLE.test(type) && /gzip/.test(accepts)) {
    const out = zlib.gzipSync(body);
    res.writeHead(200, { "content-type": type, "content-encoding": "gzip", "content-length": out.length });
    res.end(out); return;
  }
  res.writeHead(200, { "content-type": type, "content-length": body.length });
  res.end(body);
}).listen(0);
const PORT = srv.address().port;

const pwRoot = execSync("npm root -g").toString().trim();
const { chromium } = await import(path.join(pwRoot, "playwright/index.mjs"));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());

// 모바일 4G + CPU 4배 느리게. 국내 광고 유입의 대부분이 이 근처다.
const NET = { offline: false, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 };

async function measure(file, runs = 5) {
  const got = [];
  for (let i = 0; i < runs; i++) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1",
    });
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", NET);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const bytes = {};
    p.on("response", async (r) => {
      const t = (r.headers()["content-type"] || "").split(";")[0] || "기타";
      try {
        const sz = (await r.serverAddr?.()) ? 0 : 0; // (미사용)
        const enc = r.headers()["content-encoding"];
        const len = parseInt(r.headers()["content-length"] || "0", 10) || (await r.body()).length;
        bytes[t + (enc ? ` (${enc})` : "")] = (bytes[t] || 0) + len;
      } catch {}
    });
    await p.goto(`http://localhost:${PORT}/${file}`, { waitUntil: "load", timeout: 60000 });
    await p.waitForTimeout(2500);           // LCP·CLS 가 자리 잡을 시간
    const m = await p.evaluate(() => new Promise((resolve) => {
      let lcp = 0, cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp = Math.max(lcp, e.startTime); })
        .observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; })
        .observe({ type: "layout-shift", buffered: true });
      setTimeout(() => {
        const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime || 0;
        const nav = performance.getEntriesByType("navigation")[0] || {};
        const hero = performance.getEntriesByType("resource").find((r) => /hero-\w+\.jpg/.test(r.name));
        resolve({ lcp, cls, fcp, dcl: nav.domContentLoadedEventEnd || 0,
          heroStart: hero ? hero.startTime : null, heroEnd: hero ? hero.responseEnd : null });
      }, 300);
    }));
    got.push({ ...m, bytes });
    await ctx.close();
  }
  const med = (k) => { const v = got.map((g) => g[k]).filter((x) => x != null).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const total = Object.values(got[0].bytes).reduce((a, b) => a + b, 0);
  return { lcp: med("lcp"), fcp: med("fcp"), cls: med("cls"), dcl: med("dcl"),
    heroStart: med("heroStart"), heroEnd: med("heroEnd"), bytes: got[0].bytes, total };
}

const ms = (v) => v == null ? "—" : `${(v / 1000).toFixed(2)}s`;
const kb = (v) => `${(v / 1024).toFixed(0)}KB`;
console.log("모바일 4G(1.6Mbps·150ms) + CPU 4배 감속 · 5회 중앙값\n");
const rows = [];
for (const [label, file] of [["사진 없음", "nohero.html"], ["폰 사진 그대로 (고치기 전)", "phone.html"], ["줄인 사진 (고친 뒤)", "small.html"], ["폰 사진, preload 없음 (대조군)", "phone-nopreload.html"]]) {
  const r = await measure(file);
  rows.push([label, r]);
  console.log(`■ ${label}`);
  console.log(`   LCP ${ms(r.lcp)} · FCP ${ms(r.fcp)} · CLS ${r.cls.toFixed(3)} · DOM ${ms(r.dcl)}`);
  if (r.heroStart != null) console.log(`   히어로 사진: ${ms(r.heroStart)} 에 출발 → ${ms(r.heroEnd)} 도착`);
  console.log(`   총 ${kb(r.total)} — ` + Object.entries(r.bytes).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t.replace(/^(text|image|application)\//, "")} ${kb(n)}`).join(" · "));
  console.log();
}
const g = (k) => rows.find((r) => r[0].includes(k))[1];
const d = (a, b) => `${(a - b) >= 0 ? "-" : "+"}${Math.abs(a - b).toFixed(0)}ms`;
console.log("── 사진 줄이기 효과 (폰 사진 그대로 → 줄인 사진) ──");
console.log(`   LCP  ${ms(g("고치기 전").lcp)} → ${ms(g("고친 뒤").lcp)}  (${d(g("고치기 전").lcp, g("고친 뒤").lcp)})`);
console.log("\n── preload 효과 (같은 폰 사진끼리) ──");
console.log(`   LCP  ${ms(g("대조군").lcp)} → ${ms(g("고치기 전").lcp)}  (${d(g("대조군").lcp, g("고치기 전").lcp)})`);

await browser.close();
srv.close();
