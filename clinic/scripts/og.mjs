// 공유 썸네일 만들기 — 카톡·문자·SNS 로 링크를 보낼 때 뜨는 미리보기 그림(1200×630)을 페이지마다 만든다.
//
//   node clinic/scripts/og.mjs cheonsaem      → clinic/dist/cheonsaem/og/*.png (+ 각 페이지가 그 그림을 가리키게 다시 빌드)
//
// 카톡은 SVG 미리보기를 보여주지 않아서 PNG 가 필요하다. 글자를 그림으로 굽는 데는 브라우저가 가장 정확하므로
// 검사에 쓰는 Playwright(크롬)로 찍는다. Playwright 가 없는 컴퓨터에서는 이 단계만 건너뛴다.
import path from "node:path";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "../build.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Playwright 는 저장소에 넣지 않고(외부 의존성 0) 검사하는 컴퓨터에 전역으로 깐다. 가까운 곳에 없으면 전역에서 찾는다.
function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try { return req("playwright"); } catch {}
  try { return req(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright")); } catch { return null; }
}

export function ogCard(site, title) {
  const accent = site.theme?.accent || "#2B5F6B";
  const serif = site.theme?.type === "serif";
  const head = serif ? `"Noto Serif KR", serif` : `"Pretendard Variable", Pretendard, sans-serif`;
  const host = String(site.siteUrl || "").replace(/^https?:\/\//, "");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
${serif ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@600&display=swap" />` : ""}
<style>
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;font-family:"Pretendard Variable",Pretendard,sans-serif;color:#fff;word-break:keep-all;
  background:repeating-linear-gradient(90deg,rgba(255,255,255,.05) 0 1px,transparent 1px 150px),color-mix(in srgb,${accent} 70%,#0B1315);
  display:flex;flex-direction:column;justify-content:space-between;padding:72px 80px}
.top{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:700;letter-spacing:-.02em}
.top i{width:40px;height:2px;background:#fff;opacity:.7}
h1{font-family:${head};font-size:72px;line-height:1.18;letter-spacing:-.04em;font-weight:${serif ? 600 : 700};max-width:980px;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.bot{display:flex;justify-content:space-between;font-size:26px;opacity:.82;font-variant-numeric:tabular-nums}
</style></head><body>
<div class="top"><i></i>${esc(site.name)}</div>
<h1>${esc(title)}</h1>
<div class="bot"><span>${esc(site.phone || "")}</span><span>${esc(host)}</span></div>
</body></html>`;
}

export async function makeOg(id) {
  const pw = loadPlaywright();
  if (!pw) { console.log("! Playwright 가 없어 공유 썸네일을 만들지 않습니다."); return { made: 0 }; }
  const { chromium } = pw;
  const { out, ogPlan, site } = build(id, { og: true });
  mkdirSync(path.join(out, "og"), { recursive: true });
  const br = await chromium.launch();
  const page = await br.newPage({ viewport: { width: 1200, height: 630 } });
  for (const p of ogPlan) {
    await page.setContent(ogCard(site, p.title), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, "og", `${p.key}.png`) });
  }
  await br.close();
  return { made: ogPlan.length, out };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const id = process.argv[2];
  if (!id) { console.error("사용법: node clinic/scripts/og.mjs <병원 폴더 이름>"); process.exit(1); }
  const { made, out } = await makeOg(id);
  if (made) console.log(`✓ 공유 썸네일 ${made}장 → ${path.relative(process.cwd(), path.join(out, "og"))}`);
}
