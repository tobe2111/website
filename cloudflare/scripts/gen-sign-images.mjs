// 데모용 서명 이미지 생성기 — public/img/demo/sign/*.png
//
// 실제 서명 화면은 캔버스에 손으로 그린 획을 PNG 로 저장합니다. 데모 데이터에도
// 같은 형태의 이미지가 있어야 관리자 화면의 '서명' 칸이 비지 않습니다.
// 이름을 글자로 찍으면 서명이 아니라 '타이핑'으로 보이므로, 사람이 빠르게 흘려 쓴
// 사인처럼 획을 합성합니다. 이름을 씨앗으로 쓰기 때문에 사람마다 늘 같은 사인이 나옵니다.
//
//   node scripts/gen-sign-images.mjs
import { mkdirSync } from "node:fs";
// 로컬에 playwright 가 설치돼 있지 않을 수 있어 전역 경로도 함께 봅니다.
const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

// BIZ 의 owner 순서와 1:1 로 대응 (파일명 = 인덱스+1)
const NAMES = ["김정식", "이현주", "박순자", "정만석", "최유진", "한지원", "오경택", "윤미경", "장수민", "배동식",
  "신다혜", "권세라", "문재호", "서정민", "노상철", "임태섭", "황보경", "구민아", "조영표", "천경수",
  "지수현", "표진우", "석말순", "여운형", "마동철"];

const page_html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}canvas{display:block}</style>
<canvas id="c" width="600" height="200"></canvas><script>
function rng(seed){let a=seed>>>0;return()=>{a|=0;a=a+0x6d2b79f5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function hash(s){let h=2166136261;for(const ch of s){h^=ch.codePointAt(0);h=Math.imul(h,16777619)}return h>>>0}

window.draw = (name) => {
  const c = document.getElementById("c"), g = c.getContext("2d");
  g.clearRect(0, 0, 600, 200);
  const r = rng(hash(name));
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const ink = pick(["#16233d", "#1b1b2b", "#101a33", "#232323"]);
  g.strokeStyle = ink; g.lineCap = "round"; g.lineJoin = "round";

  // 기울기 — 사람마다 필기 각도가 다릅니다
  const slant = -0.16 + r() * 0.22;
  g.setTransform(1, 0, Math.tan(slant) * -1, 1, 60 + r() * 20, 0);

  const clusters = 2 + Math.floor(r() * 2);   // 이름을 2~3덩어리로 흘려 씀
  const cw = 110 + r() * 30;                  // 덩어리 폭
  const baseY = 120 + r() * 12;
  let x = 40;
  const ends = [];

  for (let ci = 0; ci < clusters; ci++) {
    const strokes = 2 + Math.floor(r() * 2);
    for (let si = 0; si < strokes; si++) {
      g.beginPath();
      g.lineWidth = 2.4 + r() * 1.5;
      let px = x + r() * 18, py = baseY - 40 + r() * 60;
      g.moveTo(px, py);
      const segs = 2 + Math.floor(r() * 3);
      for (let s = 0; s < segs; s++) {
        const nx = px + (cw / segs) * (0.5 + r() * 0.9) * (r() < 0.12 ? -0.6 : 1);
        const ny = baseY - 46 + r() * 78;
        // 제어점을 크게 벌려 획이 둥글게 흐르도록
        g.bezierCurveTo(px + (nx - px) * 0.35, py - 30 + r() * 60, px + (nx - px) * 0.7, ny - 30 + r() * 60, nx, ny);
        px = nx; py = ny;
      }
      g.stroke();
      ends.push([px, py]);
    }
    x += cw * (0.72 + r() * 0.2);
  }

  // 마무리 획 — 이름 아래를 길게 긋거나(밑줄형), 크게 한 바퀴 돌리는(고리형) 두 가지
  const [ex, ey] = ends[ends.length - 1];
  g.lineWidth = 2.2 + r() * 1.2;
  g.beginPath(); g.moveTo(ex, ey);
  if (r() < 0.55) {
    const x2 = 20 + r() * 30, y2 = baseY + 30 + r() * 22;
    g.bezierCurveTo(ex + 40, ey + 40, x2 + 120, y2 + 18, x2, y2 - r() * 14);
  } else {
    g.bezierCurveTo(ex + 60, ey - 60, x + 30, baseY + 70, x - cw * 0.6, baseY + 24);
    g.bezierCurveTo(x - cw * 1.2, baseY - 6, ex - 40, ey - 70, ex + 10, ey - 20);
  }
  g.stroke();
  g.setTransform(1, 0, 0, 1, 0, 0);

  // 잉크가 닿은 영역만 돌려줍니다 — 여백째로 저장하면 목록의 서명 썸네일이 점처럼 작아집니다.
  const d = g.getImageData(0, 0, 600, 200).data;
  let x0 = 600, y0 = 200, x1 = 0, y1 = 0;
  for (let y = 0; y < 200; y++) for (let px2 = 0; px2 < 600; px2++)
    if (d[(y * 600 + px2) * 4 + 3] > 8) { if (px2 < x0) x0 = px2; if (px2 > x1) x1 = px2; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const pad = 10;
  return { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad),
    width: Math.min(600, x1 + pad) - Math.max(0, x0 - pad), height: Math.min(200, y1 + pad) - Math.max(0, y0 - pad) };
};
</script>`;

mkdirSync("public/img/demo/sign", { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 600, height: 200 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.setContent(page_html, { waitUntil: "load" });
for (let i = 0; i < NAMES.length; i++) {
  const clip = await page.evaluate((n) => window.draw(n), NAMES[i]);
  await page.screenshot({ path: `public/img/demo/sign/${i + 1}.png`, omitBackground: true, clip });
}
await browser.close();
console.log(`public/img/demo/sign/1..${NAMES.length}.png`);
