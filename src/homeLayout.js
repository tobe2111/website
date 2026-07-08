// 홈페이지 구성(레이아웃) 시스템
// 각 상인회는 섹션의 표시 여부·순서·문구를 독립적으로 바꿀 수 있습니다.
import { esc } from "./http.js";

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
      eyebrow: "지역 상권 공식 커뮤니티",
      title: "함께 성장하는 상권을 만듭니다",
      highlight: "함께",
      subtitle: "업체 소개, 사진·영상 홍보, 공동 마케팅으로 활기찬 상권을 함께 만들어갑니다.",
      primaryLabel: "우리 업체 등록하기",
      showStats: true,
    },
    { type: "businesses", enabled: true, title: "우리 동네 업체", lead: "상인회에 소속된 업체들을 만나보세요. 사진과 영상도 확인할 수 있습니다." },
    { type: "notices", enabled: true, title: "공지사항" },
    { type: "events", enabled: true, title: "다가오는 행사·이벤트" },
    { type: "cta", enabled: true, title: "아직 회원이 아니신가요?", body: "지금 업체를 등록하면 나만의 업체 페이지에 사진·영상을 올리고 상권 홍보에 함께할 수 있습니다.", buttonLabel: "무료로 업체 등록하기" },
  ];
}

// 저장된 JSON → 레이아웃 배열 (유효성 보정)
export function parseLayout(json, assocName) {
  if (!json) return defaultLayout(assocName);
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length === 0) return defaultLayout(assocName);
    return arr.filter((s) => s && SECTION_CATALOG[s.type]);
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
      return sectionWrap(
        "",
        s.title,
        s.lead,
        `<div class="market-grid">${deps.businessesHtml}</div>
         <div class="section-more"><a href="${deps.base}/businesses" class="btn btn-ghost btn-sm">전체 업체 보기</a></div>`
      );
    case "notices":
      return sectionWrap(
        "section-alt",
        s.title,
        "",
        `<ul class="notice-list">${deps.noticesHtml}</ul>
         <div class="section-more"><a href="${deps.base}/notices" class="btn btn-ghost btn-sm">공지사항 전체보기</a></div>`
      );
    case "events":
      return sectionWrap("", s.title, "", `<div class="event-grid">${deps.eventsHtml}</div>`);
    case "text":
      return sectionWrap(
        "section-alt",
        s.title,
        "",
        `<div class="free-text container narrow">${esc(s.body || "").replace(/\n/g, "<br />")}</div>`
      );
    case "cta":
      return `<section class="section section-dark"><div class="container cta-inner">
        <h2 class="section-title">${esc(s.title || "")}</h2>
        <p class="section-lead">${esc(s.body || "")}</p>
        <a href="${deps.base}/register" class="btn btn-primary">${esc(s.buttonLabel || "업체 등록하기")}</a>
      </div></section>`;
    default:
      return "";
  }
}

function heroSection(s, deps) {
  const { stats, base } = deps;
  const title = esc(s.title || "");
  const hl = s.highlight && title.includes(s.highlight)
    ? title.replace(esc(s.highlight), `<span>${esc(s.highlight)}</span>`)
    : title;
  const statsHtml = s.showStats
    ? `<dl class="hero-stats">
        <div><dt>등록 업체</dt><dd>${stats.businesses}<span>곳</span></dd></div>
        <div><dt>진행 행사</dt><dd>${stats.events}<span>건</span></dd></div>
        <div><dt>홍보 미디어</dt><dd>${stats.mediaCount}<span>개</span></dd></div>
      </dl>`
    : "";
  return `<section class="hero"><div class="hero-bg" aria-hidden="true"></div>
    <div class="container hero-inner">
      <p class="hero-eyebrow">${esc(s.eyebrow || "")}</p>
      <h1 class="hero-title">${hl}</h1>
      <p class="hero-desc">${esc(s.subtitle || "")}</p>
      <div class="hero-actions">
        <a href="${base}/register" class="btn btn-primary">${esc(s.primaryLabel || "업체 등록하기")}</a>
        <a href="${base}/businesses" class="btn btn-ghost">업체 둘러보기</a>
      </div>
      ${statsHtml}
    </div></section>`;
}

function sectionWrap(extraClass, title, lead, inner) {
  return `<section class="section ${extraClass}"><div class="container">
    <div class="section-head"><h2 class="section-title">${esc(title || "")}</h2>
    ${lead ? `<p class="section-lead">${esc(lead)}</p>` : ""}</div>
    ${inner}</div></section>`;
}
