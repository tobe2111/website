// PNG 여러 장을 폭 제한 + JPEG 로 다시 굽고 data URI 로 묶는다.
// 아티팩트는 외부 요청이 막혀 있어 사진을 페이지 안에 넣어야 하고, 그러려면 용량을 줄여야 한다.
// 이미지 도구가 없는 환경이라 Chromium 의 캔버스를 인코더로 쓴다.
//
//   node scripts/pack-shots.mjs <사진폴더> <출력.json> [최대폭] [품질]
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const DIR = process.argv[2];
const OUT = process.argv[3];
const MAXW = parseInt(process.argv[4] || "1200", 10);
const Q = parseFloat(process.argv[5] || "0.78");

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".png")).sort();
const pwRoot = execSync("npm root -g").toString().trim();
const { chromium } = await import(path.join(pwRoot, "playwright/index.mjs"));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const p = await browser.newPage();

const out = {};
for (const f of files) {
  const b64 = fs.readFileSync(path.join(DIR, f)).toString("base64");
  const res = await p.evaluate(async ({ b64, maxw, q }) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const scale = Math.min(1, maxw / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { uri: c.toDataURL("image/jpeg", q), w: c.width, h: c.height };
  }, { b64, maxw: MAXW, q: Q });
  out[f.replace(/\.png$/, "")] = res;
  console.log(`  ${f}: ${(b64.length / 1024 / 1.37).toFixed(0)}KB → ${(res.uri.length / 1024 / 1.37).toFixed(0)}KB (${res.w}×${res.h})`);
}
await browser.close();
fs.writeFileSync(OUT, JSON.stringify(out));
const total = Object.values(out).reduce((n, r) => n + r.uri.length, 0);
console.log(`\n합계 ${(total / 1024 / 1024).toFixed(2)}MB (data URI 기준) → ${OUT}`);
