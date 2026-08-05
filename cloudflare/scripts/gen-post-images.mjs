// 게시판 첨부 이미지 생성기 — public/img/demo/post/*.png
//
// ⚠️ 사진이 아닙니다. 사진인 척하는 이미지는 조악해 보이므로 만들지 않습니다.
//    대신 실제 상인회 게시판에 정말 올라오는 '자료' 를 그립니다 —
//    야시장 부스 배치도, 간판 조명 견적 비교표. 그림이 자연스러운 종류만 고른 것입니다.
//
//   node scripts/gen-post-images.mjs
import { mkdirSync } from "node:fs";
const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const FONT = `-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif`;

// ── 1. 야시장 부스 배치도
const booth = (n, kind) => {
  const c = { food: ["#f6e7d6", "#b5764a"], goods: ["#e4edf3", "#3d7591"], play: ["#e8f0e4", "#4f8f42"] }[kind];
  return `<div class="b" style="background:${c[0]};border-color:${c[1]};color:${c[1]}">${n}</div>`;
};
const layout = `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0;width:1200px;height:690px;background:#fbfaf7;font-family:${FONT};color:#26241f;padding:44px 48px}
  h1{margin:0 0 4px;font-size:31px;letter-spacing:-.4px}
  .sub{margin:0 0 26px;font-size:16px;color:#7d7a73}
  .street{position:relative;height:400px;border-radius:14px;background:#efece5;border:2px dashed #cfc9bd;padding:20px 26px;display:flex;flex-direction:column;justify-content:space-between}
  .road{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:74px;background:repeating-linear-gradient(90deg,#e2ded4 0 46px,#efece5 46px 92px)}
  .road span{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:15px;color:#8f8a7e;letter-spacing:5px;background:#efece5;padding:4px 16px;border-radius:6px}
  .row{position:relative;display:flex;gap:12px;justify-content:center}
  .b{width:96px;height:74px;border:2px solid;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;background:#fff}
  .ends{position:absolute;inset:0;pointer-events:none}
  .gate{position:absolute;top:50%;transform:translateY(-50%);font-size:15px;font-weight:700;color:#8a8478;background:#fbfaf7;padding:7px 12px;border-radius:8px;border:1px solid #ddd8cc}
  .gate.l{left:-14px} .gate.r{right:-14px}
  .legend{display:flex;gap:26px;margin-top:24px;font-size:16px;align-items:center}
  .legend i{display:inline-block;width:15px;height:15px;border-radius:4px;margin-right:8px;vertical-align:-2px}
  .note{margin-left:auto;color:#7d7a73;font-size:15px}
</style>
<h1>여름 골목 야시장 — 부스 배치(안)</h1>
<p class="sub">중앙골목 일대 · 저녁 6시–10시 · 차 없는 거리 운영</p>
<div class="street">
  <div class="row">${booth(1, "food")}${booth(2, "food")}${booth(3, "food")}${booth(4, "food")}${booth(5, "goods")}${booth(6, "goods")}</div>
  <div class="road"><span>보행 통로</span></div>
  <div class="row">${booth(7, "food")}${booth(8, "goods")}${booth(9, "goods")}${booth(10, "play")}${booth(11, "play")}${booth(12, "goods")}</div>
  <div class="ends"><span class="gate l">골목 입구</span><span class="gate r">주차장 쪽</span></div>
</div>
<div class="legend">
  <span><i style="background:#f6e7d6;border:2px solid #b5764a"></i>먹거리 (1~4, 7)</span>
  <span><i style="background:#e4edf3;border:2px solid #3d7591"></i>공산품·잡화</span>
  <span><i style="background:#e8f0e4;border:2px solid #4f8f42"></i>체험·아이들</span>
  <span class="note">먹거리는 연기가 빠지도록 입구 쪽에 모았습니다</span>
</div>`;

// ── 2. 간판 조명 견적 비교
const rows = [
  ["가나조명", "38만원", "34만원", "LED 모듈 교체, A/S 2년"],
  ["빛솔사인", "42만원", "35만원", "간판 청소 포함, A/S 3년"],
  ["대성전기", "35만원", "33만원", "모듈만 교체, A/S 1년"],
];
const quote = `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0;width:1200px;height:600px;background:#fbfaf7;font-family:${FONT};color:#26241f;padding:52px 56px}
  h1{margin:0 0 4px;font-size:31px;letter-spacing:-.4px}
  .sub{margin:0 0 30px;font-size:16px;color:#7d7a73}
  table{width:100%;border-collapse:collapse;font-size:19px}
  th,td{padding:18px 16px;text-align:left;border-bottom:1px solid #e4e0d6}
  th{font-size:15px;color:#7d7a73;font-weight:700;background:#f3f0e9}
  td.p{font-weight:800}
  td.d{color:#1f7a4d;font-weight:800}
  tr.best td{background:#f1f7f2}
  .tag{display:inline-block;margin-left:8px;font-size:13px;font-weight:800;color:#1f7a4d;background:#e0efe5;padding:3px 9px;border-radius:999px;vertical-align:2px}
  .foot{margin-top:26px;font-size:16px;color:#7d7a73;line-height:1.75}
</style>
<h1>간판 조명 교체 — 업체별 견적 비교</h1>
<p class="sub">점포 1곳 기준 · 3집 이상 동시 시공 시 할인가 적용</p>
<table>
  <tr><th>업체</th><th>단독 시공</th><th>3집 동시</th><th>포함 내역</th></tr>
  ${rows.map((r, i) => `<tr class="${i === 1 ? "best" : ""}"><td class="p">${r[0]}${i === 1 ? '<span class="tag">추천</span>' : ""}</td>
    <td>${r[1]}</td><td class="d">${r[2]}</td><td>${r[3]}</td></tr>`).join("")}
</table>
<p class="foot">· 구청 시설개선 지원사업에 넣으면 최대 300만원까지 지원됩니다(자부담 별도).<br>
· 세 집 이상 모이면 견적을 다시 받아 보겠습니다. 관심 있으신 사장님은 사무실로 알려 주세요.</p>`;

mkdirSync("public/img/demo/post", { recursive: true });
const browser = await chromium.launch();
for (const [name, html] of [["yasijang-layout", layout], ["signage-quote", quote]]) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(150);
  // 본문 높이에 맞춰 잘라 저장 — 남는 여백째로 두면 목록 썸네일에서 그림이 작아집니다
  const h = await page.evaluate(() => document.body.getBoundingClientRect().height);
  await page.screenshot({ path: `public/img/demo/post/${name}.png`, clip: { x: 0, y: 0, width: 1200, height: Math.round(h) } });
  await ctx.close();
  console.log(`public/img/demo/post/${name}.png`);
}
await browser.close();
