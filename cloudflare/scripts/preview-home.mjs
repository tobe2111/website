// 로컬 홈 프리뷰 렌더러 (디자인 확인용) — DB·wrangler 없이 목 데이터로 홈 HTML 을 만듭니다.
//
//   node scripts/preview-home.mjs public/__preview.html 8   # 점포 8개 있는 홈
//   node scripts/preview-home.mjs public/__preview.html 0   # 빈 상권(첫 상점 초대) 홈
//   npx http-server public -p 8899                          # → http://127.0.0.1:8899/__preview.html
//
// /css, /js 를 상대 경로로 불러오므로 반드시 public/ 아래에 써야 합니다. 산출물은 .gitignore 처리됨.
import { writeFileSync } from "node:fs";
import { layout } from "../src/render.js";
import { parseLayout, renderHome } from "../src/homeLayout.js";

const assoc = { id: 1, name: "리스터코퍼레이션", slug: "리스터코퍼레이션", brand_color: "#0b8a46", tagline: "우리 동네 상권의 오늘을 함께 만들어 갑니다.", home_layout: null, phone: "02-000-0000", address: "서울 서초구 강남대로 1" };
const base = "/t/리스터코퍼레이션";

const CATS = ["음식점", "카페", "미용", "생활", "교육"];
const bizCard = (i) => `<article class="market-card"><a class="market-thumb" href="${base}/business/b${i}">
  <span class="market-cat">${CATS[i % CATS.length]}</span>
  <span class="thumb-mono">${"가나다라마".charAt(i % 5)}</span>
</a><div class="market-body"><h3><a href="${base}/business/b${i}">샘플 가게 ${i + 1}</a></h3>
<p>동네에서 오래 사랑받아 온 가게입니다. 신선한 재료와 정성으로 준비합니다.</p>
<ul class="market-meta"><li>서울 서초구 어딘가 ${i + 1}길</li><li>02-1234-56${String(i).padStart(2, "0")}</li></ul></div></article>`;

const noticeRow = (i) => `<li><a href="${base}/notices/${i}"><span class="notice-ico"></span>
  <span class="notice-main"><span class="notice-title">${i === 0 ? '<i class="pin-mini">공지</i>' : ""}상인회 정기 총회 안내 ${i + 1}</span><span class="notice-meta">2026.07.${String(10 + i).padStart(2, "0")}</span></span>
  <span class="notice-chev">›</span></a></li>`;

const eventCard = (i) => `<article class="event-card"><div class="event-date"><span class="d">${12 + i}</span><span class="m">8월</span></div>
  <div class="event-info"><h3>여름 골목 축제 ${i + 1}</h3><p>가게마다 준비한 특별 할인과 먹거리 부스가 열립니다.</p><span class="event-place">중앙로 일대</span></div></article>`;

const updateCard = (i) => `<a class="update-card" href="${base}/business/b${i}"><span class="uc-body"><strong>샘플 가게 ${i + 1}</strong><p>이번 주 신메뉴가 나왔습니다. 많이 찾아주세요!</p><time>07.${String(20 + i).padStart(2, "0")}</time></span></a>`;

const n = Number(process.argv[3] || 6);
const cats = n ? CATS.map((c) => ({ category: c })) : [];
const catTiles = cats.length ? `<div class="cat-grid">${cats.map((c) => `<a class="cat-tile" href="#"><span class="cat-ico"></span><span class="cat-name">${c.category}</span></a>`).join("")}<a class="cat-tile cat-all" href="#"><span class="cat-ico"></span><span class="cat-name">전체보기</span></a></div>` : "";

const body = renderHome(parseLayout(assoc.home_layout, assoc.name), {
  assoc, base, loggedIn: false, heroImage: "",
  stats: { businesses: n ? 42 : 0, notices: n ? 12 : 0, events: n ? 3 : 0 },
  businessesHtml: Array.from({ length: n }, (_, i) => bizCard(i)).join(""),
  catTiles,
  noticesHtml: n ? Array.from({ length: 5 }, (_, i) => noticeRow(i)).join("") : "",
  eventsHtml: n ? Array.from({ length: 2 }, (_, i) => eventCard(i)).join("") : "",
  updatesHtml: n ? Array.from({ length: 3 }, (_, i) => updateCard(i)).join("") : "",
  counts: { businesses: n, notices: n ? 5 : 0, events: n ? 2 : 0 },
  suggestNames: [],
});

writeFileSync(process.argv[2], layout({ title: "", assoc, base, user: null, body, activeNav: `${base}/` }));
