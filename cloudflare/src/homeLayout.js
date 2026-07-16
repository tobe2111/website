// 홈페이지 구성(레이아웃) 시스템
// 각 상인회는 섹션의 표시 여부·순서·문구를 독립적으로 바꿀 수 있습니다.
import { esc } from "./util.js";

const FC_ICONS = {
  store: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l1.2-4.2A1 1 0 0 1 6.2 4h11.6a1 1 0 0 1 1 .8L20 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M9 20v-5h6v5"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>',
  news: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l14-6v14L3 13z"/><path d="M17 8a3 3 0 0 1 0 8"/><path d="M6 13v4a2 2 0 0 0 2 2h1"/></svg>',
};
// 쇼케이스 밴드 스카이라인 실루엣 (브랜드색)
const SHOWCASE_SKYLINE = '<svg viewBox="0 0 1200 220" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><g fill="var(--brand-700)" opacity="0.55"><rect x="40" y="120" width="60" height="100"/><rect x="110" y="90" width="46" height="130"/><rect x="165" y="140" width="70" height="80"/><rect x="250" y="70" width="52" height="150"/><rect x="315" y="110" width="80" height="110"/><rect x="410" y="150" width="60" height="70"/><rect x="486" y="96" width="48" height="124"/><rect x="548" y="130" width="72" height="90"/><rect x="636" y="84" width="54" height="136"/><rect x="704" y="120" width="66" height="100"/><rect x="786" y="150" width="58" height="70"/><rect x="858" y="100" width="50" height="120"/><rect x="922" y="132" width="76" height="88"/><rect x="1012" y="74" width="52" height="146"/><rect x="1078" y="122" width="82" height="98"/></g><g fill="var(--brand-500)" opacity="0.5"><rect x="120" y="104" width="8" height="8"/><rect x="136" y="120" width="8" height="8"/><rect x="262" y="88" width="8" height="8"/><rect x="330" y="128" width="8" height="8"/><rect x="500" y="112" width="8" height="8"/><rect x="648" y="100" width="8" height="8"/><rect x="720" y="140" width="8" height="8"/><rect x="1024" y="92" width="8" height="8"/></g></svg>';

// 섹션 카탈로그: 편집 가능한 필드 정의 (관리자 UI 자동 생성용)
export const SECTION_CATALOG = {
  hero: {
    label: "히어로 (상단 대문)",
    fields: [
      { key: "eyebrow", label: "상단 문구", type: "text" },
      { key: "title", label: "제목", type: "text" },
      { key: "highlight", label: "강조 단어 (제목 중 색상 강조)", type: "text" },
      { key: "subtitle", label: "설명", type: "textarea" },
      { key: "primaryLabel", label: "주요 버튼 문구", type: "text" },
      { key: "showStats", label: "통계 표시", type: "bool" },
    ],
  },
  businesses: {
    label: "업체 소개",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "lead", label: "설명", type: "textarea" },
    ],
  },
  notices: {
    label: "공지사항",
    fields: [{ key: "title", label: "제목", type: "text" }],
  },
  events: {
    label: "행사·이벤트",
    fields: [{ key: "title", label: "제목", type: "text" }],
  },
  text: {
    label: "자유 문단 (소개글 등)",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "body", label: "본문", type: "textarea" },
    ],
  },
  mapbanner: {
    label: "지도 배너 (점포 지도 바로가기)",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "subtitle", label: "설명", type: "text" },
    ],
  },
  featurecards: {
    label: "바로가기 카드 (소개 + 3색 카드)",
    fields: [
      { key: "title", label: "소개 제목", type: "text" },
      { key: "lead", label: "소개 문구", type: "textarea" },
    ],
  },
  updates: {
    label: "동네 새소식 (가게 소식 피드)",
    fields: [{ key: "title", label: "제목", type: "text" }],
  },
  showcase: {
    label: "브랜드 쇼케이스 (야경 밴드)",
    fields: [
      { key: "title", label: "큰 문구", type: "text" },
      { key: "lead", label: "아래 문구", type: "text" },
    ],
  },
  cta: {
    label: "가입 유도 배너",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "body", label: "설명", type: "textarea" },
      { key: "buttonLabel", label: "버튼 문구", type: "text" },
    ],
  },
};

// 기본 홈 구성
export function defaultLayout(assocName = "우리 상인회") {
  return [
    { type: "hero", enabled: true, eyebrow: "함께 만드는 우리 동네", title: "", highlight: "", subtitle: "", primaryLabel: "", showStats: false },
    { type: "featurecards", enabled: true, title: "", lead: "" },
    { type: "businesses", enabled: true, title: "지금 문 연 가게", lead: "" },
    { type: "updates", enabled: true, title: "동네 새소식" },
    { type: "mapbanner", enabled: true, title: "우리 동네 점포 지도", subtitle: "" },
    { type: "notices", enabled: true, title: "동네 소식" },
    { type: "events", enabled: true, title: "다가오는 행사" },
    { type: "showcase", enabled: true, title: "", lead: "" },
    { type: "cta", enabled: true, title: "아직 회원이 아니신가요?", body: "지금 업체를 등록하면 나만의 업체 페이지에 사진·영상을 올리고 상권 홍보에 함께할 수 있습니다.", buttonLabel: "무료로 업체 등록하기" },
  ];
}

// 저장된 JSON → 레이아웃 배열 (유효성 보정)
export function parseLayout(json, assocName) {
  if (!json) return defaultLayout(assocName);
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length === 0) return defaultLayout(assocName);
    const out = arr.filter((s) => s && SECTION_CATALOG[s.type]);
    // 구버전 저장 레이아웃 업그레이드: 지도 배너가 없으면 업체 섹션 뒤에 추가
    if (!out.some((s) => s.type === "mapbanner")) {
      const i = out.findIndex((s) => s.type === "businesses");
      out.splice(i >= 0 ? i + 1 : out.length, 0, { type: "mapbanner", enabled: true, title: "우리 동네 점포 지도", subtitle: "" });
    }
    // 개편 업그레이드: 바로가기 카드가 없으면 히어로 뒤에 주입
    if (!out.some((s) => s.type === "featurecards")) {
      const h = out.findIndex((s) => s.type === "hero");
      out.splice(h >= 0 ? h + 1 : 0, 0, { type: "featurecards", enabled: true, title: "", lead: "" });
    }
    // 개편 업그레이드: 쇼케이스가 없으면 행사 뒤에 주입
    if (!out.some((s) => s.type === "showcase")) {
      const e = out.findIndex((s) => s.type === "events");
      out.splice(e >= 0 ? e + 1 : out.length, 0, { type: "showcase", enabled: true, title: "", lead: "" });
    }
    // 구버전 업그레이드: 동네 새소식 섹션이 없으면 업체 섹션 뒤에 추가
    if (!out.some((s) => s.type === "updates")) {
      const i = out.findIndex((s) => s.type === "businesses");
      out.splice(i >= 0 ? i + 1 : out.length, 0, { type: "updates", enabled: true, title: "동네 새소식" });
    }
    return out;
  } catch {
    return defaultLayout(assocName);
  }
}

export function serializeLayout(arr) {
  return JSON.stringify(arr);
}

// ----- 렌더링 -----
// deps: { assoc, base, stats, businessesHtml, noticesHtml, eventsHtml, loggedIn }
export function renderHome(layout, deps) {
  return layout
    .filter((s) => s.enabled)
    .map((s) => renderSection(s, deps))
    .join("\n");
}

function renderSection(s, deps) {
  switch (s.type) {
    case "hero":
      return heroSection(s, deps);
    case "businesses":
      // 빈 상태: 회색 빈말 대신 "첫 상점" 초대 카드 (개점 준비 분위기)
      if (!deps.counts || deps.counts.businesses === 0)
        return sectionWrap("", s.title, s.lead,
          `<div class="first-invite">
            <span class="first-invite-badge">OPEN 준비 중</span>
            <h3>이 상권의 첫 번째 상점이 되어주세요</h3>
            <p>지금 등록하면 홈 첫 화면에 우리 가게가 가장 먼저 소개됩니다.<br />사진·메뉴·위치까지 5분이면 등록 완료.</p>
            <a href="${deps.base}/register" class="btn btn-primary btn-lg">무료로 우리 가게 올리기</a>
          </div>`);
      return sectionWrap(
        "",
        s.title,
        s.lead,
        `${deps.catTiles || ""}<div class="market-grid">${deps.businessesHtml}</div>`,
        { href: `${deps.base}/businesses`, label: "더보기" }
      );
    case "notices":
      if (!deps.noticesHtml) return ""; // 공지 없으면 공개 홈에서 섹션 자체 숨김
      return sectionWrap(
        "section-alt",
        s.title,
        "",
        `<ul class="notice-list">${deps.noticesHtml}</ul>`,
        { href: `${deps.base}/notices`, label: "전체보기" }
      );
    case "events":
      if (!deps.eventsHtml) return ""; // 행사 없으면 섹션 숨김
      return sectionWrap("", s.title, "", `<div class="event-grid">${deps.eventsHtml}</div>`, { href: `${deps.base}/events`, label: "전체보기" });
    case "text":
      return sectionWrap(
        "section-alt",
        s.title,
        "",
        `<div class="free-text container narrow">${esc(s.body || "").replace(/\n/g, "<br />")}</div>`
      );
    case "featurecards":
      return featureCardsSection(s, deps);
    case "updates":
      if (!deps.updatesHtml) return ""; // 소식 없으면 섹션 숨김
      return sectionWrap("", s.title || "동네 새소식", "", `<div class="update-grid">${deps.updatesHtml}</div>`);
    case "mapbanner": {
      const n = deps.stats ? deps.stats.businesses : 0; // counts.businesses 는 페이지당 카드 수(최대 6) — 전체 수는 stats
      const sub = s.subtitle || (n > 0 ? `${n}곳이 지도 위에. 가까운 가게를 한눈에 찾아요.` : "가까운 가게를 지도에서 한눈에 찾아요.");
      return `<section class="section" style="padding-top:0"><div class="container">
        <a href="${deps.base}/map" class="map-banner">
          <span class="mb-glow" aria-hidden="true"></span>
          <span class="mb-text"><strong>${esc(s.title || "우리 동네 점포 지도")}</strong><em>${esc(sub)}</em></span>
          <span class="mb-map" aria-hidden="true"><svg viewBox="0 0 24 24" width="86" height="86" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg></span>
          <span class="mb-chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></span>
        </a></div></section>`;
    }
    case "showcase": {
      const nm = (deps.assoc && deps.assoc.name) || "우리 상인회";
      const big = esc(s.title || nm);
      const sub = esc(s.lead || (deps.assoc && deps.assoc.tagline) || "우리 동네 상권의 오늘을 함께 만들어 갑니다.");
      return `<section class="showcase"><div class="sc-sky" aria-hidden="true">${SHOWCASE_SKYLINE}</div>
        <div class="container sc-inner">
          <p class="sc-big">${big}</p>
          <p class="sc-sub">${sub}</p>
          <a class="btn btn-primary" href="${deps.base}/businesses">가입 점포 둘러보기</a>
        </div></section>`;
    }
    case "cta":
      return `<section class="section"><div class="container">
        <div class="join-cta">
          <span class="jc-glow" aria-hidden="true"></span>
          <span class="mark jc-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l1.2-4.2A1 1 0 0 1 6.2 4h11.6a1 1 0 0 1 1 .8L20 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M9 20v-5h6v5"/></svg></span>
          <h2>${esc(s.title || "")}</h2>
          <p>${esc(s.body || "")}</p>
          <a href="${deps.base}/register" class="btn btn-primary btn-lg">${esc(s.buttonLabel || "업체 등록하기")}</a>
        </div></div></section>`;
    default:
      return "";
  }
}

// 프리미엄 에디토리얼 히어로용 랜드마크 실루엣 — 반투명 그라데이션으로 녹색 배경 위에 원근 레이어.
// 예술의전당 갓지붕 · 우면산 능선 · 오피스 스카이라인 · 세빛섬 · 반포대교.
const HERO_SKYLINE = `<svg class="hp-sky-svg" viewBox="0 0 1200 340" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
<defs>
 <linearGradient id="hpFar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".13"/><stop offset="1" stop-color="#ffffff" stop-opacity=".04"/></linearGradient>
 <linearGradient id="hpMid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03130d" stop-opacity=".16"/><stop offset="1" stop-color="#03130d" stop-opacity=".32"/></linearGradient>
 <linearGradient id="hpNear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#010c07" stop-opacity=".32"/><stop offset="1" stop-color="#010c07" stop-opacity=".52"/></linearGradient>
</defs>
<path d="M0 158 Q 240 96 480 138 Q 720 178 960 126 Q 1092 100 1200 138 L1200 340 L0 340 Z" fill="url(#hpFar)"/>
<g fill="url(#hpMid)">
 <rect x="150" y="182" width="64" height="158" rx="3"/><rect x="228" y="150" width="50" height="190" rx="3"/><rect x="292" y="206" width="58" height="134" rx="3"/>
 <path d="M472 200 L520 132 L568 200 Z"/><ellipse cx="520" cy="200" rx="64" ry="9"/><rect x="484" y="200" width="72" height="140"/>
 <rect x="602" y="172" width="56" height="168" rx="3"/><rect x="676" y="150" width="70" height="190" rx="3"/><rect x="764" y="196" width="52" height="144" rx="3"/>
 <rect x="900" y="178" width="60" height="162" rx="3"/><rect x="978" y="158" width="46" height="182" rx="3"/><rect x="1040" y="200" width="60" height="140" rx="3"/>
</g>
<g fill="url(#hpNear)">
 <rect x="0" y="300" width="1200" height="40"/>
 <path d="M470 300 q0 -30 30 -30 q30 0 30 30 z"/><path d="M544 300 q0 -40 38 -40 q38 0 38 40 z"/><path d="M628 300 q0 -28 30 -28 q30 0 30 28 z"/>
 <rect x="150" y="292" width="360" height="7"/><rect x="196" y="299" width="5" height="16"/><rect x="300" y="299" width="5" height="16"/><rect x="404" y="299" width="5" height="16"/>
</g>
</svg>`;

function heroSection(s, deps) {
  // 프리미엄 에디토리얼 히어로: 딥 그린 그라데이션 + 부드럽게 흐르는 광원 + 랜드마크 실루엣 + 중앙 검색.
  const base = deps.base;
  const eyebrow = esc(s.eyebrow || "함께 만드는 우리 동네");
  const name = (deps.assoc && deps.assoc.name) || "우리 상인회";
  const title = esc(s.title || name).replace(/\n/g, "<br />");
  const sub = esc(s.subtitle || (deps.assoc && deps.assoc.tagline) || "우리 동네 상권을 한곳에서 만나보세요.");
  const sug = deps.suggestNames && deps.suggestNames.length;
  // 배경 사진이 있으면 사진 + 어두운 베일(가독성), 없으면 그라데이션 + 광원 + 랜드마크 실루엣.
  const photo = deps.heroImage;
  const bg = photo
    ? `<div class="hp-photo" style="background-image:url('${String(photo).replace(/['"\\]/g, "")}')"></div><div class="hp-photo-veil"></div>`
    : `<span class="hp-glow hp-glow-1"></span><span class="hp-glow hp-glow-2"></span><div class="hp-skyline">${HERO_SKYLINE}</div>`;
  return `<section class="hero-pro${photo ? " has-photo" : ""}">
    <div class="hero-pro-bg" aria-hidden="true">${bg}</div>
    <div class="container hp-inner">
      <p class="hp-eyebrow">${eyebrow}</p>
      <h1 class="hp-title">${title}</h1>
      <p class="hp-sub">${sub}</p>
      <form class="feat-search hp-search" method="get" action="${base}/businesses" role="search">
        <input type="search" name="q" placeholder="가게 이름·업종 검색" aria-label="점포 검색"${sug ? ' list="storeSuggest"' : ""} />
        <button class="btn btn-primary" type="submit" aria-label="검색"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg></button>
        ${sug ? `<datalist id="storeSuggest">${deps.suggestNames.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>` : ""}
      </form>
    </div>
  </section>`;
}

// 바로가기 카드 밴드 — 왼쪽 소개(제목·문구·검색·버튼) + 오른쪽 3색 파스텔 카드가 히어로에 겹침
function featureCardsSection(s, deps) {
  const base = deps.base;
  const cards = [
    ["mint", "가입 점포 찾기", "Find member stores", `${base}/businesses`, FC_ICONS.store],
    ["beige", "점포 지도", "Store map", `${base}/map`, FC_ICONS.map],
    ["forest", "공지·소식", "News & notices", `${base}/notices`, FC_ICONS.news],
  ];
  const cardHtml = cards.map(([tone, ko, en, href, ico]) => `<a class="feat-card feat-${tone}" href="${href}">
      <span class="fc-ico" aria-hidden="true">${ico}</span>
      <span class="fc-txt"><strong>${ko}</strong><em>${en}</em></span>
    </a>`).join("");
  return `<section class="feat-band"><div class="container">
    <div class="feat-cards feat-cards-row">${cardHtml}</div>
  </div></section>`;
}

function sectionWrap(extraClass, title, lead, inner, more) {
  return `<section class="section ${extraClass}"><div class="container">
    <div class="section-head head-row">
      <div><h2 class="section-title">${esc(title || "")}</h2>
      ${lead ? `<p class="section-lead">${esc(lead)}</p>` : ""}</div>
      ${more ? `<a class="section-more-link" href="${more.href}">${esc(more.label)} <span aria-hidden="true">›</span></a>` : ""}
    </div>
    ${inner}</div></section>`;
}
