// 데모용 커버 이미지 생성기 — public/img/demo/*.jpg
//
// ⚠️ 이것은 사진이 아닙니다. 사진인 척하는 흐린 이미지는 오히려 조악해 보이므로,
//    '명백히 디자인된 커버'로 만듭니다. 업종 선화 심볼 + 은은한 톤 배경.
//    저장소에 함께 배포되므로 외부 호스트에 의존하지 않고 절대 깨지지 않습니다.
//    진짜 사진이 생기면 사장님 대시보드에서 덮어쓰면 그대로 대체됩니다.
//
//   node scripts/gen-demo-images.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const s = (d, w = 1.6) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

// [바탕색, 심볼색, 심볼 path] — 업종마다 톤을 달리해 그리드에서 단조롭지 않게
export const COVERS = {
  gukbap:  ["#f3ece2", "#b5764a", s('<path d="M4 10h16a8 8 0 0 1-8 8 8 8 0 0 1-8-8z"/><path d="M20 11h1.5a2 2 0 0 1 0 4H19"/><path d="M8 6c0-1 1-1.4 1-2.4M12 6c0-1 1-1.4 1-2.4M16 6c0-1 1-1.4 1-2.4"/><path d="M3 21h18"/>')],
  bakery:  ["#f6efe1", "#c08f45", s('<path d="M4 13c0-3.3 3.6-6 8-6s8 2.7 8 6v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M9 8.5 8 17M12 7.5V17M15 8.5l1 8.5"/>')],
  sewing:  ["#e8efec", "#4d8375", s('<circle cx="6" cy="7" r="2.4"/><circle cx="6" cy="17" r="2.4"/><path d="M8.1 8.6 20 19M8.1 15.4 20 5"/>')],
  fish:    ["#e6eef3", "#3d7591", s('<path d="M3 12c3-4.5 7-6.5 11-6.5 3.4 0 5.8 1.6 7 3-1.2 1.4-3.6 3-7 3-4 0-8-2-11-6.5z" transform="translate(0 3)"/><path d="M3 12c3 4.5 7 6.5 11 6.5" opacity=".55"/><circle cx="17" cy="11" r=".9" fill="currentColor" stroke="none"/>')],
  hair:    ["#f3e9ee", "#a2607e", s('<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><path d="M8 7.2 20 18M8 16.8 20 6M13.5 10.5 11 13"/>')],
  book:    ["#eaeee6", "#5a7a4c", s('<path d="M4 4.5h6a2.5 2.5 0 0 1 2.5 2.5v12A2 2 0 0 0 10.5 17H4z"/><path d="M20 4.5h-6A2.5 2.5 0 0 0 11.5 7v12a2 2 0 0 1 2-2H20z"/>')],
  mart:    ["#e9f1e5", "#4f8f42", s('<path d="M3 5h2.2l2.3 10.4a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>')],
  banchan: ["#f5eddd", "#b8842f", s('<rect x="3" y="9" width="8" height="7" rx="1.4"/><rect x="13" y="9" width="8" height="7" rx="1.4"/><path d="M3 6.5h8M13 6.5h8"/>')],
  // 히어로 배경 — 상권 골목 실루엣 (가로로 길게)
  street:  ["#141a17", "#3f5a4c", s('<path d="M2 20h20M4 20V9l4-3 4 3v11M12 20V6l5-3 5 3v14"/><path d="M6 12h1.6M6 15h1.6M15 9h1.6M15 12h1.6M15 15h1.6M19 9h1M19 12h1"/>', 1.1)],
};

const card = (bg, fg, svg, wide) => `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;overflow:hidden;width:${wide ? 1600 : 1200}px;height:800px}
  .f{position:absolute;inset:0;background:${bg}}
  /* 은은한 광원 두 개 — 단색 판이 아니라 '결'이 생기게 */
  .g{position:absolute;border-radius:50%;filter:blur(120px);opacity:.5}
  .g1{width:900px;height:760px;left:-16%;top:-40%;background:radial-gradient(circle,${fg},transparent 66%)}
  .g2{width:820px;height:700px;right:-14%;bottom:-38%;background:radial-gradient(circle,#ffffff,transparent 64%);opacity:.75}
  .s{position:absolute;inset:0;display:grid;place-items:center;color:${fg};opacity:.2}
  .s svg{width:${wide ? 34 : 30}%;height:auto}
  /* 종이 질감 — 완전 평면은 인쇄물처럼 죽어 보임 */
  .n{position:absolute;inset:0;opacity:.5;mix-blend-mode:multiply}
</style>
<div class="f"></div><div class="g g1"></div><div class="g g2"></div>
<div class="s">${svg}</div>
<svg class="n" xmlns="http://www.w3.org/2000/svg"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".06"/></feComponentTransfer></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;

mkdirSync("public/img/demo", { recursive: true });
const browser = await chromium.launch();
for (const [name, [bg, fg, svg]] of Object.entries(COVERS)) {
  const wide = name === "street";
  const ctx = await browser.newContext({ viewport: { width: wide ? 1600 : 1200, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(card(bg, fg, svg, wide), { waitUntil: "load" });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `public/img/demo/${name}.jpg`, type: "jpeg", quality: 86 });
  await ctx.close();
  console.log("public/img/demo/" + name + ".jpg");
}
await browser.close();
