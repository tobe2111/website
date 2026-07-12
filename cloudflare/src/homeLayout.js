// 홈페이지 구성(레이아웃) 시스템
// 각 상인회는 섹션의 표시 여부·순서·문구를 독립적으로 바꿀 수 있습니다.
import { esc } from "./util.js";

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
    {
      type: "hero",
      enabled: true,
      eyebrow: "",
      title: "이웃님, 안녕하세요 👋\n가까운 가게를 찾아보세요.",
      highlight: "",
      subtitle: "",
      primaryLabel: "",
      showStats: false,
    },
    { type: "businesses", enabled: true, title: "지금 문 연 가게", lead: "" },
    { type: "mapbanner", enabled: true, title: "우리 동네 점포 지도", subtitle: "" },
    { type: "notices", enabled: true, title: "동네 소식" },
    { type: "events", enabled: true, title: "다가오는 행사" },
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
    case "mapbanner": {
      const n = deps.counts ? deps.counts.businesses : 0;
      const sub = s.subtitle || (n > 0 ? `${n}곳이 지도 위에. 가까운 가게를 한눈에 찾아요.` : "가까운 가게를 지도에서 한눈에 찾아요.");
      return `<section class="section" style="padding-top:0"><div class="container">
        <a href="${deps.base}/map" class="map-banner">
          <span class="mb-glow" aria-hidden="true"></span>
          <span class="mb-text"><strong>${esc(s.title || "우리 동네 점포 지도")}</strong><em>${esc(sub)}</em></span>
          <span class="mb-map" aria-hidden="true"><svg viewBox="0 0 24 24" width="86" height="86" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg></span>
          <span class="mb-chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></span>
        </a></div></section>`;
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

function heroSection(s, deps) {
  const { stats, base } = deps;
  // 제목: \n 줄바꿈 지원 + 강조 단어 색상 (시안: 인사말 2줄)
  const title = esc(s.title || "").replace(/\n/g, "<br />");
  const hl = s.highlight && title.includes(esc(s.highlight))
    ? title.replace(esc(s.highlight), `<span>${esc(s.highlight)}</span>`)
    : title;
  const statsHtml = s.showStats && stats.businesses > 0
    ? `<dl class="hero-stats">
        <div><dt>등록 업체</dt><dd>${stats.businesses}<span>곳</span></dd></div>
        <div><dt>진행 행사</dt><dd>${stats.events}<span>건</span></dd></div>
        <div><dt>홍보 미디어</dt><dd>${stats.mediaCount}<span>개</span></dd></div>
      </dl>`
    : "";
  return `<section class="hero"><div class="hero-bg" aria-hidden="true"></div>
    <div class="container hero-inner">
      ${s.eyebrow ? `<p class="hero-eyebrow">${esc(s.eyebrow)}</p>` : ""}
      <h1 class="hero-title">${hl}</h1>
      ${s.subtitle ? `<p class="hero-desc">${esc(s.subtitle)}</p>` : ""}
      <form class="hero-search" method="get" action="${base}/businesses" role="search">
        <input type="search" name="q" placeholder="가게 이름, 업종을 검색해 보세요" aria-label="점포 검색"${deps.suggestNames && deps.suggestNames.length ? ' list="storeSuggest"' : ""} />
        <button class="btn btn-primary" type="submit">검색</button>
        ${deps.suggestNames && deps.suggestNames.length ? `<datalist id="storeSuggest">${deps.suggestNames.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>` : ""}
      </form>
      ${s.primaryLabel ? `<div class="hero-actions">
        <a href="${base}/register" class="btn btn-primary">${esc(s.primaryLabel)}</a>
        <a href="${base}/businesses" class="btn btn-ghost">업체 둘러보기</a>
      </div>` : ""}
      ${statsHtml}
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
