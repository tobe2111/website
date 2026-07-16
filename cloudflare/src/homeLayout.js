// 홈페이지 구성(레이아웃) 시스템
// 각 상인회는 섹션의 표시 여부·순서·문구를 독립적으로 바꿀 수 있습니다.
import { esc } from "./util.js";

// 플랫 일러스트 히어로 (오리지널 · 브랜드색 따라감). 상점가·역·사람들 — 참고 상인회 사이트 톤.
const HERO_ILLUS = `<svg class="hi-svg" viewBox="0 0 1200 470" preserveAspectRatio="xMidYMax slice" role="img" aria-label="상점가 일러스트">
<defs>
 <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
   <stop offset="0" stop-color="var(--brand-300)"/>
   <stop offset="0.62" stop-color="var(--brand-100)"/>
   <stop offset="1" stop-color="#f4fcfa"/>
 </linearGradient>
</defs>
<rect width="1200" height="470" fill="url(#sky)"/>
<!-- clouds -->
<g fill="#ffffff" opacity="0.9">
 <ellipse cx="200" cy="66" rx="54" ry="19"/><ellipse cx="250" cy="74" rx="38" ry="15"/><ellipse cx="150" cy="76" rx="34" ry="13"/>
 <ellipse cx="960" cy="56" rx="60" ry="21"/><ellipse cx="1020" cy="66" rx="42" ry="16"/>
</g>
<!-- sun -->
<circle cx="1090" cy="86" r="34" fill="#ffffff" opacity="0.55"/>
<!-- ground -->
<rect y="322" width="1200" height="148" fill="#e8e4d9"/>
<rect y="322" width="1200" height="12" fill="#dcd6c7"/>
<!-- road -->
<rect y="412" width="1200" height="58" fill="#e3dfd6"/>
<line x1="0" y1="441" x2="1200" y2="441" stroke="#ffffff" stroke-width="4" stroke-dasharray="26 22" opacity="0.85"/>
<g fill="#ffffff" opacity="0.92"><rect x="548" y="414" width="13" height="56"/><rect x="573" y="414" width="13" height="56"/><rect x="598" y="414" width="13" height="56"/><rect x="623" y="414" width="13" height="56"/></g>

<!-- Building: 꽃집 -->
<g>
 <rect x="70" y="198" width="118" height="124" rx="4" fill="#f4efe4"/>
 <path d="M62 200 L129 150 L196 200 Z" fill="var(--brand-500)"/>
 <rect x="86" y="226" width="86" height="16" fill="var(--brand)"/>
 <rect x="92" y="258" width="30" height="64" fill="#e6ece4"/><circle cx="116" cy="292" r="2.4" fill="var(--brand)"/>
 <rect x="132" y="256" width="38" height="34" rx="3" fill="#dbe5ea"/><path d="M132 273 h38 M151 256 v34" stroke="#fff" stroke-width="2"/>
 <g><circle cx="80" cy="314" r="6" fill="#d7a3ad"/><circle cx="93" cy="314" r="6" fill="#e2c07d"/><circle cx="106" cy="314" r="6" fill="#cc93a1"/></g>
</g>
<!-- Building: 카페 -->
<g>
 <rect x="196" y="216" width="100" height="106" rx="4" fill="#ece5d6"/>
 <rect x="196" y="216" width="100" height="20" fill="#d9a066"/>
 <rect x="212" y="252" width="68" height="40" rx="3" fill="#dbe5ea"/><path d="M246 252 v40 M212 272 h68" stroke="#fff" stroke-width="2"/>
 <rect x="228" y="298" width="36" height="24" fill="#9c7a58"/>
 <circle cx="246" cy="204" r="6" fill="#fff"/><path d="M240 200 q6 -10 12 0" fill="none" stroke="#fff" stroke-width="2"/>
</g>
<!-- MARKET -->
<g>
 <rect x="304" y="182" width="196" height="140" rx="4" fill="#ffffff"/>
 <rect x="304" y="182" width="196" height="26" fill="var(--brand)"/>
 <text x="402" y="201" text-anchor="middle" font-family="Pretendard,sans-serif" font-size="16" font-weight="800" fill="#fff">MARKET</text>
 <!-- striped awning -->
 <g>
  <rect x="300" y="214" width="204" height="26" fill="#cf9b7d"/>
  <g fill="#fff">
   <path d="M300 214 h26 v26 h-26 z" opacity="0"/>
   <rect x="326" y="214" width="26" height="26"/><rect x="378" y="214" width="26" height="26"/><rect x="430" y="214" width="26" height="26"/><rect x="482" y="214" width="22" height="26"/>
  </g>
  <path d="M300 240 l13 12 l13 -12 l13 12 l13 -12 l13 12 l13 -12 l13 12 l13 -12 l13 12 l13 -12 l13 12 l13 -12 l13 12 l13 -12 l13 12 l0 0" fill="#cf9b7d"/>
 </g>
 <rect x="322" y="258" width="70" height="64" rx="3" fill="#e6ece4"/><path d="M357 258 v64 M322 290 h70" stroke="#fff" stroke-width="2"/>
 <rect x="410" y="262" width="72" height="60" fill="#efe9dd"/>
 <rect x="418" y="270" width="56" height="10" rx="3" fill="#cf9b7d"/><rect x="418" y="286" width="56" height="10" rx="3" fill="#e2c07d"/><rect x="418" y="302" width="56" height="10" rx="3" fill="#9fc196"/>
</g>
<!-- 베이커리 -->
<g>
 <rect x="516" y="222" width="96" height="100" rx="4" fill="#efe6d5"/>
 <path d="M508 224 L564 186 L620 224 Z" fill="#c9a079"/>
 <rect x="530" y="252" width="68" height="38" rx="3" fill="#dbe5ea"/><path d="M564 252 v38 M530 271 h68" stroke="#fff" stroke-width="2"/>
 <rect x="546" y="296" width="36" height="26" fill="#a07a54"/>
</g>
<!-- 서점(보라) -->
<g>
 <rect x="632" y="206" width="104" height="116" rx="4" fill="#e7dfd1"/>
 <rect x="632" y="206" width="104" height="20" fill="#b2a488"/>
 <rect x="650" y="244" width="70" height="42" rx="3" fill="#e3ddce"/>
 <g fill="#b2a488"><rect x="658" y="252" width="8" height="26"/><rect x="670" y="250" width="8" height="28"/><rect x="682" y="254" width="8" height="24"/><rect x="694" y="250" width="8" height="28"/><rect x="706" y="252" width="8" height="26"/></g>
 <rect x="666" y="296" width="36" height="26" fill="#8a7f64"/>
</g>
<!-- 타워 오피스 -->
<g>
 <rect x="756" y="150" width="96" height="172" rx="4" fill="#ebe6da"/>
 <rect x="756" y="150" width="96" height="12" fill="var(--brand)"/>
 <g fill="#d5dfe2">
  <rect x="770" y="176" width="20" height="18"/><rect x="800" y="176" width="20" height="18"/><rect x="830" y="176" width="12" height="18"/>
  <rect x="770" y="206" width="20" height="18"/><rect x="800" y="206" width="20" height="18"/><rect x="830" y="206" width="12" height="18"/>
  <rect x="770" y="236" width="20" height="18"/><rect x="800" y="236" width="20" height="18"/><rect x="830" y="236" width="12" height="18"/>
  <rect x="770" y="266" width="20" height="18"/><rect x="800" y="266" width="20" height="18"/><rect x="830" y="266" width="12" height="18"/>
 </g>
</g>
<!-- 역 -->
<g>
 <rect x="880" y="176" width="250" height="146" rx="6" fill="#ece7db"/>
 <rect x="880" y="176" width="250" height="34" rx="6" fill="var(--brand)"/>
 <text x="1005" y="199" text-anchor="middle" font-family="Pretendard,sans-serif" font-size="16" font-weight="800" fill="#fff">우리역</text>
 <g fill="#d5dfe2">
  <rect x="900" y="228" width="40" height="60" rx="3"/><rect x="956" y="228" width="40" height="60" rx="3"/><rect x="1012" y="228" width="40" height="60" rx="3"/><rect x="1068" y="228" width="44" height="60" rx="3"/>
 </g>
 <rect x="960" y="296" width="90" height="26" rx="3" fill="#dcd6c8"/>
 <circle cx="1122" cy="160" r="10" fill="#fff"/><path d="M1122 160 v-6 M1122 160 h5" stroke="var(--brand)" stroke-width="2"/>
</g>

<!-- 가로수 -->
<g>
 <g><rect x="250" y="300" width="7" height="30" fill="#9c7a58"/><circle cx="253" cy="292" r="20" fill="#a6c49c"/><circle cx="240" cy="300" r="14" fill="#b6cfab"/><circle cx="266" cy="300" r="14" fill="#b6cfab"/></g>
 <g><rect x="610" y="298" width="7" height="32" fill="#9c7a58"/><circle cx="613" cy="290" r="20" fill="#a6c49c"/><circle cx="600" cy="298" r="14" fill="#b6cfab"/><circle cx="626" cy="298" r="14" fill="#b6cfab"/></g>
 <g><rect x="862" y="298" width="7" height="32" fill="#9c7a58"/><circle cx="865" cy="290" r="19" fill="#a6c49c"/><circle cx="853" cy="298" r="13" fill="#b6cfab"/><circle cx="877" cy="298" r="13" fill="#b6cfab"/></g>
</g>
<!-- 가로등 -->
<g stroke="#9a958a" stroke-width="4" fill="none"><line x1="470" y1="330" x2="470" y2="270"/><line x1="740" y1="330" x2="740" y2="270"/></g>
<g fill="#ecd9a0"><circle cx="470" cy="266" r="7"/><circle cx="740" cy="266" r="7"/></g>

<!-- 푸드카트 -->
<g>
 <rect x="150" y="360" width="70" height="40" rx="4" fill="#d8a689"/>
 <rect x="150" y="354" width="70" height="10" fill="#fff"/>
 <path d="M140 344 q45 -26 90 0 z" fill="#cf9b7d"/><path d="M140 344 q45 -26 90 0" fill="none" stroke="#fff" stroke-width="0"/>
 <g fill="#fff"><path d="M162 344 q23 -14 0 0" opacity="0"/></g>
 <line x1="185" y1="344" x2="185" y2="356" stroke="#b07d5f" stroke-width="3"/>
 <circle cx="165" cy="404" r="8" fill="#6b6b64"/><circle cx="205" cy="404" r="8" fill="#6b6b64"/>
</g>

<!-- 사람들 -->
<g>
 <!-- person walking dog -->
 <g><circle cx="330" cy="372" r="9" fill="#f0c9a0"/><rect x="322" y="382" width="16" height="26" rx="7" fill="var(--brand)"/><ellipse cx="360" cy="404" rx="12" ry="7" fill="#c98a5a"/><circle cx="372" cy="400" r="5" fill="#c98a5a"/><line x1="336" y1="392" x2="360" y2="400" stroke="#9a958a" stroke-width="2"/></g>
 <!-- person 2 -->
 <g><circle cx="470" cy="374" r="9" fill="#e8b48c"/><rect x="462" y="384" width="16" height="26" rx="7" fill="#cf9b7d"/></g>
 <!-- couple -->
 <g><circle cx="700" cy="372" r="9" fill="#f0c9a0"/><rect x="692" y="382" width="16" height="28" rx="7" fill="#b2a488"/><circle cx="722" cy="374" r="9" fill="#e8b48c"/><rect x="714" y="384" width="16" height="26" rx="7" fill="#e2c07d"/></g>
 <!-- person on bench -->
 <g><rect x="560" y="392" width="46" height="8" rx="2" fill="#a58459"/><rect x="564" y="378" width="6" height="16" fill="#a58459"/><rect x="596" y="378" width="6" height="16" fill="#a58459"/><circle cx="583" cy="378" r="8" fill="#e8b48c"/><rect x="576" y="386" width="14" height="12" rx="5" fill="var(--brand-500)"/></g>
 <!-- delivery scooter -->
 <g><circle cx="915" cy="404" r="10" fill="#5c5c56"/><circle cx="955" cy="404" r="10" fill="#5c5c56"/><path d="M915 404 L940 380 L958 380 L960 404" fill="none" stroke="#cf9b7d" stroke-width="5"/><rect x="936" y="366" width="18" height="16" rx="3" fill="#cf9b7d"/><circle cx="935" cy="360" r="8" fill="#f0c9a0"/></g>
 <!-- person right -->
 <g><circle cx="1060" cy="374" r="9" fill="#f0c9a0"/><rect x="1052" y="384" width="16" height="26" rx="7" fill="var(--brand)"/></g>
</g>
</svg>`;
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

function heroSection(s, deps) {
  // 플랫 일러스트 배너 + 상단 중앙 타이틀 (참고: 상점가 일러스트 히어로)
  const eyebrow = esc(s.eyebrow || "함께 만드는 우리 동네");
  const name = (deps.assoc && deps.assoc.name) || "우리 상인회";
  const title = esc(s.title || name).replace(/\n/g, "<br />");
  return `<section class="hero-illus">
    <div class="hi-scene" aria-hidden="true">${HERO_ILLUS}</div>
    <div class="container hi-head">
      <p class="hi-eyebrow">${eyebrow}</p>
      <h1 class="hi-title">${title}</h1>
    </div>
  </section>`;
}

// 바로가기 카드 밴드 — 왼쪽 소개(제목·문구·검색·버튼) + 오른쪽 3색 파스텔 카드가 히어로에 겹침
function featureCardsSection(s, deps) {
  const base = deps.base;
  const name = (deps.assoc && deps.assoc.name) || "우리 상인회";
  const lead = s.lead || (deps.assoc && deps.assoc.tagline) || "우리 동네 상권을 한곳에서 만나보세요.";
  const cards = [
    ["mint", "가입 점포 찾기", "Find member stores", `${base}/businesses`, FC_ICONS.store],
    ["beige", "점포 지도", "Store map", `${base}/map`, FC_ICONS.map],
    ["purple", "공지·소식", "News & notices", `${base}/notices`, FC_ICONS.news],
  ];
  const cardHtml = cards.map(([tone, ko, en, href, ico]) => `<a class="feat-card feat-${tone}" href="${href}">
      <span class="fc-ico" aria-hidden="true">${ico}</span>
      <span class="fc-txt"><strong>${ko}</strong><em>${en}</em></span>
    </a>`).join("");
  const sug = deps.suggestNames && deps.suggestNames.length;
  return `<section class="feat-band"><div class="container feat-inner">
    <div class="feat-intro">
      <h2>${esc(s.title || "우리 동네 상권, 한자리에")}</h2>
      <p><strong>${esc(name)}</strong> — ${esc(lead)}</p>
      <form class="feat-search" method="get" action="${base}/businesses" role="search">
        <input type="search" name="q" placeholder="가게 이름·업종 검색" aria-label="점포 검색"${sug ? ' list="storeSuggest"' : ""} />
        <button class="btn btn-primary" type="submit" aria-label="검색">${FC_ICONS.store ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>' : "검색"}</button>
        ${sug ? `<datalist id="storeSuggest">${deps.suggestNames.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>` : ""}
      </form>
      <a class="btn btn-ghost feat-more" href="${base}/businesses">자세히 보기 →</a>
    </div>
    <div class="feat-cards">${cardHtml}</div>
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
