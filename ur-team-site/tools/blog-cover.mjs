// 블로그 글 표지(1600×900)를 만든다: 분류 · 제목 · 주제 그림 · 로고.
//   node ur-team-site/tools/blog-cover.mjs <목록.json>   (목록: [{slug, title, category, icon}])
// PNG 로 찍은 뒤 python3 + Pillow 로 WebP 로 바꾼다. 브라우저(Playwright)가 있는 컴퓨터에서만 돈다.
import { readFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "img", "blog");
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire("/opt/")("playwright")); }
const list = JSON.parse(readFileSync(process.argv[2], "utf8"));
const b64 = (p) => readFileSync(p).toString("base64");
const logo = "data:image/png;base64," + b64(join(ROOT, "assets/img/urteam_black.png"));
const fontFile = (n) => join(ROOT, "tools", ".fonts", n);
const face = (w, n) => existsSync(fontFile(n)) ? `@font-face{font-family:"C";font-weight:${w};src:url(data:font/woff2;base64,${b64(fontFile(n))}) format("woff2")}` : "";
const FONTS = face(600, "Pretendard-SemiBold.woff2") + face(700, "Pretendard-Bold.woff2");
// 주제 그림: 검은 선 + 파란 강조. 400×460 칸 안에 그린다.
const K = "#0f1216", A = "#1747e6", G = "#dfe3e8", S = `fill="none" stroke="${K}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"`;
const card = `<rect x="20" y="20" width="360" height="420" rx="26" fill="#fff" ${S.replace('fill="none" ', "")}/>`;
const ICON = {
  doc: `${card}<rect x="62" y="70" width="150" height="20" rx="10" fill="${A}"/><rect x="62" y="130" width="276" height="16" rx="8" fill="${K}"/><rect x="62" y="176" width="236" height="16" rx="8" fill="${K}"/><rect x="62" y="222" width="262" height="16" rx="8" fill="${K}"/><rect x="62" y="290" width="200" height="16" rx="8" fill="${G}"/><rect x="62" y="336" width="240" height="16" rx="8" fill="${G}"/>`,
  check: `${card}${[0, 1, 2, 3].map((i) => `<rect x="60" y="${72 + i * 84}" width="46" height="46" rx="10" fill="${i < 3 ? A : "#fff"}" stroke="${i < 3 ? A : K}" stroke-width="7"/>${i < 3 ? `<path d="M71 ${96 + i * 84}l9 9 16-18" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` : ""}<rect x="134" y="${86 + i * 84}" width="${[200, 160, 190, 150][i]}" height="16" rx="8" fill="${i < 3 ? K : G}"/>`).join("")}`,
  chart: `${card}<path d="M70 380V90M70 380h270" ${S}/><rect x="104" y="270" width="44" height="110" rx="6" fill="${G}"/><rect x="170" y="210" width="44" height="170" rx="6" fill="${G}"/><rect x="236" y="150" width="44" height="230" rx="6" fill="${A}"/><path d="M100 230l70-60 60 30 80-90" ${S}/><circle cx="310" cy="110" r="13" fill="${A}"/>`,
  search: `${card}<circle cx="180" cy="200" r="92" ${S}/><path d="M248 268l78 78" ${S} stroke-width="16"/><rect x="134" y="176" width="92" height="16" rx="8" fill="${A}"/><rect x="134" y="212" width="62" height="16" rx="8" fill="${G}"/>`,
  split: `<rect x="20" y="60" width="170" height="340" rx="22" fill="#fff" stroke="${K}" stroke-width="9"/><rect x="210" y="60" width="170" height="340" rx="22" fill="${A}" stroke="${A}" stroke-width="9"/><rect x="50" y="110" width="90" height="16" rx="8" fill="${K}"/><rect x="50" y="160" width="110" height="14" rx="7" fill="${G}"/><rect x="50" y="200" width="80" height="14" rx="7" fill="${G}"/><rect x="50" y="240" width="100" height="14" rx="7" fill="${G}"/><rect x="240" y="110" width="90" height="16" rx="8" fill="#fff"/><rect x="240" y="160" width="110" height="14" rx="7" fill="rgba(255,255,255,.6)"/><rect x="240" y="200" width="80" height="14" rx="7" fill="rgba(255,255,255,.6)"/><rect x="240" y="240" width="100" height="14" rx="7" fill="rgba(255,255,255,.6)"/>`,
  pin: `${card}<path d="M200 96c-58 0-100 44-100 100 0 78 100 172 100 172s100-94 100-172c0-56-42-100-100-100z" fill="${A}"/><circle cx="200" cy="196" r="38" fill="#fff"/><rect x="92" y="392" width="216" height="14" rx="7" fill="${G}"/>`,
  chat: `<path d="M40 70h250a26 26 0 0 1 26 26v130a26 26 0 0 1-26 26H150l-60 52v-52H66a26 26 0 0 1-26-26V96a26 26 0 0 1 26-26z" fill="#fff" stroke="${K}" stroke-width="9" stroke-linejoin="round"/><rect x="84" y="118" width="170" height="16" rx="8" fill="${K}"/><rect x="84" y="162" width="120" height="16" rx="8" fill="${G}"/><path d="M150 300h184a26 26 0 0 1 26 26v60a26 26 0 0 1-26 26h-20v40l-48-40H150a26 26 0 0 1-26-26v-60a26 26 0 0 1 26-26z" fill="${A}"/><rect x="164" y="346" width="150" height="16" rx="8" fill="#fff"/>`,
  calendar: `${card}<path d="M20 124h360" ${S}/><path d="M120 0v60M280 0v60" ${S}/>${[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => `<rect x="${64 + c * 74}" y="${170 + r * 82}" width="50" height="50" rx="10" fill="${r === 1 && c === 2 ? A : G}"/>`).join("")).join("")}`,
  coins: `${card}<ellipse cx="150" cy="300" rx="84" ry="28" fill="#fff" ${S.replace('fill="none" ', "")}/><path d="M66 300v-44M234 300v-44" ${S}/><ellipse cx="150" cy="256" rx="84" ry="28" fill="#fff" ${S.replace('fill="none" ', "")}/><path d="M66 256v-44M234 256v-44" ${S}/><ellipse cx="150" cy="212" rx="84" ry="28" fill="${A}" stroke="${A}" stroke-width="9"/><circle cx="286" cy="130" r="50" fill="#fff" ${S.replace('fill="none" ', "")}/><path d="M286 104v52M266 118h30a12 12 0 0 1 0 24h-20" ${S} stroke-width="7"/>`,
  pen: `${card}<rect x="62" y="80" width="180" height="16" rx="8" fill="${K}"/><rect x="62" y="126" width="240" height="16" rx="8" fill="${G}"/><rect x="62" y="172" width="210" height="16" rx="8" fill="${G}"/><path d="M130 350l28-8 170-170-20-20-170 170z" fill="${A}"/><path d="M130 350l-12 34 40-42" fill="${K}"/><rect x="62" y="388" width="140" height="10" rx="5" fill="${K}"/>`,
  box: `<path d="M200 50l160 80v200l-160 80-160-80V130z" fill="#fff" stroke="${K}" stroke-width="9" stroke-linejoin="round"/><path d="M40 130l160 80 160-80M200 210v200" ${S}/><path d="M120 90l160 80v70" fill="none" stroke="${A}" stroke-width="16" stroke-linejoin="round"/>`,
  image: `${card}<rect x="60" y="70" width="280" height="200" rx="14" fill="${G}"/><circle cx="130" cy="130" r="26" fill="#fff"/><path d="M60 250l80-76 70 60 50-40 80 70v6a14 14 0 0 1-14 14H74a14 14 0 0 1-14-14z" fill="${A}"/><rect x="60" y="310" width="190" height="16" rx="8" fill="${K}"/><rect x="60" y="356" width="130" height="16" rx="8" fill="${G}"/>`,
  target: `<circle cx="200" cy="230" r="170" fill="#fff" stroke="${K}" stroke-width="9"/><circle cx="200" cy="230" r="112" fill="#fff" stroke="${G}" stroke-width="20"/><circle cx="200" cy="230" r="48" fill="${A}"/><path d="M200 230L340 90M340 90v54M340 90h-54" ${S}/>`,
  video: `${card}<rect x="60" y="70" width="280" height="190" rx="16" fill="${K}"/><path d="M178 122v86l76-43z" fill="#fff"/><rect x="60" y="300" width="200" height="16" rx="8" fill="${K}"/><rect x="60" y="346" width="140" height="16" rx="8" fill="${G}"/><circle cx="316" cy="340" r="26" fill="${A}"/>`,
  globe: `<circle cx="200" cy="230" r="170" fill="#fff" stroke="${K}" stroke-width="9"/><ellipse cx="200" cy="230" rx="76" ry="170" ${S}/><path d="M30 230h340M56 140h288M56 320h288" ${S}/><circle cx="286" cy="140" r="22" fill="${A}"/><circle cx="130" cy="320" r="16" fill="${A}"/>`,
  filter: `<path d="M40 70h320l-116 150v150l-88 44V220z" fill="#fff" stroke="${K}" stroke-width="9" stroke-linejoin="round"/><path d="M40 70h320l-52 68H92z" fill="${A}"/><circle cx="110" cy="30" r="12" fill="${K}"/><circle cx="200" cy="18" r="12" fill="${G}"/><circle cx="290" cy="30" r="12" fill="${K}"/>`,
  cart: `<path d="M30 80h50l44 220h200l36-150H104" fill="none" stroke="${K}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><circle cx="150" cy="370" r="28" fill="${K}"/><circle cx="300" cy="370" r="28" fill="${K}"/><rect x="150" y="186" width="150" height="18" rx="9" fill="${A}"/><rect x="150" y="236" width="110" height="18" rx="9" fill="${G}"/>`,
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
// 제목을 두세 줄로 고르게 나눈다 (마지막 줄에 한두 글자만 남지 않게)
const lines = (t) => {
  const words = t.split(" "); const n = Math.min(4, Math.max(2, Math.ceil(t.length / 12)));
  let best = null;
  const walk = (i, acc) => {
    if (acc.length === n - 1) { const all = [...acc, words.slice(i).join(" ")]; if (!all[n - 1]) return;
      const max = Math.max(...all.map((l) => l.length)), min = Math.min(...all.map((l) => l.length));
      const score = max * 3 - min + (all[n - 1].length < 3 ? 20 : 0); if (!best || score < best.score) best = { score, all }; return; }
    for (let j = i + 1; j < words.length; j++) walk(j, [...acc, words.slice(i, j).join(" ")]);
  };
  walk(0, []);
  const out = best ? best.all : [t];
  // 줄이 가운뎃점으로 시작하지 않게 앞줄 끝으로 올린다
  for (let i = 1; i < out.length; i++) if (out[i].startsWith("· ")) { out[i - 1] += " ·"; out[i] = out[i].slice(2); }
  return out;
};
const page = ({ title, category, icon }) => {
  const ls = lines(title), size = ls.length <= 3 ? 82 : ls.length === 4 ? 70 : 60;
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><style>${FONTS}
  *{box-sizing:border-box;margin:0}
  body{width:1600px;height:900px;overflow:hidden;background:#fafcff;color:${K};font-family:"C","Pretendard Variable","Noto Sans CJK KR",sans-serif;word-break:keep-all;position:relative}
  .rule{position:absolute;left:130px;right:120px;top:96px;height:4px;background:${K}}
  .tx{position:absolute;left:130px;top:150px;bottom:170px;width:800px;display:flex;flex-direction:column;justify-content:center}
  .cat{font-size:30px;font-weight:700;color:${A};letter-spacing:-.02em;margin-bottom:26px}
  h1{font-size:${size}px;line-height:1.14;font-weight:700;letter-spacing:-.045em}
  .ic{position:absolute;right:210px;top:230px;width:400px;height:460px}
  .ft{position:absolute;left:130px;bottom:86px;display:flex;align-items:center;gap:18px;font-size:22px;font-weight:600;color:#646b75}
  .ft img{height:34px;width:auto}
  </style><div class="rule"></div><div class="tx"><p class="cat">${esc(category)}</p><h1>${ls.map(esc).join("<br>")}</h1></div>
  <svg class="ic" viewBox="0 0 400 460" overflow="visible">${ICON[icon] || ICON.doc}</svg>
  <p class="ft"><img src="${logo}" alt="">유어팀 블로그</p></html>`;
};
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
for (const it of list) {
  const png = join(OUT, `${it.slug}-cover.png`);
  await pg.setContent(page(it), { waitUntil: "load" }); await pg.evaluate(() => document.fonts.ready);
  await pg.screenshot({ path: png });
  execFileSync("python3", ["-c", "import sys;from PIL import Image;Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2],'WEBP',quality=86,method=6)", png, png.replace(/\.png$/, ".webp")]);
  unlinkSync(png);
}
await b.close();
console.log(`표지 ${list.length}장 → assets/img/blog/`);
