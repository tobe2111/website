// 카톡 · 문자 · SNS 에 주소를 붙였을 때 뜨는 공유 그림(1200×630)을 페이지마다 만든다.
// 유어팀 로고 + 페이지 이름이 들어간다. 페이지를 새로 만들거나 제목을 바꾸면 다시 돌린다:
//   node ur-team-site/build.mjs && node ur-team-site/tools/og.mjs && node ur-team-site/build.mjs
// (브라우저가 필요해서 빌드와 따로 돈다. 만든 그림은 assets/img/og/ 에 들어가고 저장소에 함께 올린다.)
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist"), OUT = join(ROOT, "assets", "img", "og");
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire("/opt/")("playwright")); }
const logo = "data:image/png;base64," + readFileSync(join(ROOT, "assets/img/urteam_white.png")).toString("base64");
// 글꼴(프리텐다드): tools/.fonts/ 에 있으면 그것을, 없으면 내려받아 쓴다. 둘 다 안 되면 기기 글꼴로 그린다.
const FONT_URL = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/web/static/woff2/";
const font = async (name) => {
  const local = join(ROOT, "tools", ".fonts", name);
  if (existsSync(local)) return readFileSync(local).toString("base64");
  try { const r = await fetch(FONT_URL + name); if (r.ok) return Buffer.from(await r.arrayBuffer()).toString("base64"); } catch {}
  console.warn(`글꼴을 받지 못했습니다(${name}). 기기 글꼴로 그립니다.`); return "";
};
const [f600, f700] = await Promise.all([font("Pretendard-SemiBold.woff2"), font("Pretendard-Bold.woff2")]);
const face = (w, d) => d ? `@font-face{font-family:"OG";font-weight:${w};src:url(data:font/woff2;base64,${d}) format("woff2")}` : "";
const FONTS = face(600, f600) + face(700, f700);
const pages = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f === "index.html") {
      const h = readFileSync(p, "utf8");
      if (/http-equiv="refresh"/i.test(h)) continue; // 예전 주소 이동 페이지
      const url = "/" + relative(DIST, d).replace(/\\/g, "/");
      const og = (h.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || "";
      pages.push({ url, en: /<html lang="en"/.test(h), title: og.replace(/\s*\|\s*[^|]*$/, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"') });
    }
  }
})(DIST);
const SECTION = { ko: { distribution: "국내 유통", export: "해외 수출", marketing: "마케팅", blog: "블로그", contact: "상담 신청" }, en: { distribution: "Distribution", export: "Global Export", marketing: "Marketing", blog: "Insights", contact: "Contact" } };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const card = ({ url, en, title }) => {
  const parts = url.split("/").filter(Boolean); if (en) parts.shift();
  const home = parts.length === 0;
  const sec = home ? "" : (SECTION[en ? "en" : "ko"][parts[0]] || "");
  // 블로그 글은 제목 그대로, 그 밖의 페이지는 "이름 · 덧붙임" 에서 이름을 크게, 덧붙임을 작게
  const blogPost = parts[0] === "blog" && parts.length > 1;
  const cut = !home && !blogPost && title.includes(" · ") ? title.indexOf(" · ") : -1;
  const head = cut > 0 ? title.slice(0, cut) : title, sub = cut > 0 ? title.slice(cut + 3) : "";
  const main = home ? "We sell,<br>You grow." : esc(head);
  const n = head.length, size = home ? 108 : n <= 8 ? 104 : n <= 14 ? 88 : n <= 22 ? 70 : n <= 32 ? 58 : 50;
  const tag = en ? "Distribution · Global Export · Marketing" : "국내 유통 · 해외 수출 · 마케팅";
  return `<!doctype html><html lang="${en ? "en" : "ko"}"><meta charset="utf-8"><style>${FONTS}
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;overflow:hidden;color:#fff;background:#0b1a4a;font-family:"OG","Pretendard Variable",Pretendard,"Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo",sans-serif;word-break:keep-all;position:relative}
  body::before{content:"";position:absolute;inset:0;background:radial-gradient(62% 95% at 88% 8%,rgba(23,71,230,.7),transparent 70%),linear-gradient(rgba(255,255,255,.055) 1px,transparent 1px) 0 0/60px 60px,linear-gradient(90deg,rgba(255,255,255,.055) 1px,transparent 1px) 0 0/60px 60px}
  .in{position:absolute;inset:0;padding:90px 150px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
  img{height:54px;width:auto;margin-bottom:40px}
  .sec{font-size:26px;font-weight:600;color:#a9bdff;margin-bottom:18px;letter-spacing:-.01em}
  h1{font-size:${size}px;line-height:1.18;font-weight:700;letter-spacing:-.04em;max-width:900px}
  .sub{margin-top:20px;font-size:32px;font-weight:600;letter-spacing:-.02em;color:rgba(255,255,255,.86);max-width:900px}
  .tag{font-weight:600;margin-top:40px;font-size:23px;color:rgba(255,255,255,.62)}
  </style><div class="in"><img src="${logo}" alt="">${sec && sec !== head ? `<p class="sec">${sec}</p>` : ""}<h1>${main}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}<p class="tag">${tag} · ur-team.com</p></div></html>`;
};
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1200, height: 630 } });
for (const p of pages) {
  const slug = p.url.replace(/^\/|\/$/g, "").replace(/\//g, "-") || "home";
  await pg.setContent(card(p), { waitUntil: "load" }); await pg.evaluate(() => document.fonts.ready);
  await pg.screenshot({ path: join(OUT, slug + ".jpg"), type: "jpeg", quality: 82 });
}
await b.close();
console.log(`공유 그림 ${pages.length}장 → assets/img/og/`);
