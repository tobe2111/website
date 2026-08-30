// 홈페이지 구성(레이아웃) 시스템
// 각 상인회는 섹션의 표시 여부·순서·문구를 독립적으로 바꿀 수 있습니다.
import { esc } from "./util.js";

const ico = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const FC_ICONS = {
  store: ico('<path d="M4 9l1.2-4.2A1 1 0 0 1 6.2 4h11.6a1 1 0 0 1 1 .8L20 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M9 20v-5h6v5"/>'),
  map: ico('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>'),
  news: ico('<path d="M3 11l14-6v14L3 13z"/><path d="M17 8a3 3 0 0 1 0 8"/><path d="M6 13v4a2 2 0 0 0 2 2h1"/>'),
};

// 입점 혜택 아이콘 — 점포가 아직 없는 상권에서도 화면이 비지 않게 하는 핵심 블록
const BENEFIT_ICONS = {
  page: ico('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 13h7M7 16h5"/>'),
  media: ico('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5-6 6-2-2-5 5"/>'),
  product: ico('<path d="M4 8h16l-1 12H5L4 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  coupon: ico('<path d="M3 9V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4z"/><path d="M14 8v1M14 12v1M14 16v1"/>'),
  map: ico('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>'),
  qr: ico('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14h1M14 20h1M18 18h3v3h-3z"/>'),
  phone: ico('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>'),
  pin: ico('<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>'),
  mail: ico('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
};

// 기본 문구 프리셋 — 관리자가 아무것도 입력하지 않아도 화면이 비지 않도록.
// (관리자 화면에서 각 항목을 자유롭게 고칠 수 있습니다.)
const DEFAULT_STEPS = [
  ["가입 신청", "상호·업종·연락처만 있으면 5분이면 끝납니다. 사진은 나중에 올려도 됩니다."],
  ["상인회 확인", "상인회 관리자가 실제 영업 여부를 확인하고 승인합니다. 보통 1~2일 걸립니다."],
  ["우리 가게 페이지 오픈", "승인 즉시 전용 주소가 생기고, 사진·메뉴·영업시간을 직접 관리할 수 있습니다."],
];
const DEFAULT_BENEFITS = [
  ["page", "우리 가게 전용 페이지", "검색에 걸리는 고유 주소가 생깁니다. 홈페이지 없이도 가게 소개를 인터넷에 올릴 수 있습니다."],
  ["media", "사진·영상 갤러리", "가게 사진과 영상을 직접 올립니다. 인스타그램·유튜브 링크도 그대로 붙습니다."],
  ["product", "메뉴·상품 진열", "대표 메뉴와 가격을 사진과 함께 올립니다. 품절 표시도 사장님이 직접 바꿉니다."],
  ["coupon", "매장 제시 쿠폰", "손님이 화면을 보여주면 되는 쿠폰을 발행합니다. 별도 앱이나 수수료가 없습니다."],
  ["map", "점포 지도 노출", "지도 위에 우리 가게가 표시됩니다. 근처 손님이 걸어오다 찾을 수 있습니다."],
  ["qr", "가게 QR 코드", "우리 가게 페이지로 바로 가는 QR을 뽑아 출입문·명함·전단에 붙일 수 있습니다."],
];
const DEFAULT_FAQ = [
  ["돈이 드나요?", "가입비와 이용료 모두 없습니다. 결제 기능이 아예 없어 수수료가 발생할 여지도 없습니다."],
  ["컴퓨터를 잘 몰라도 되나요?", "휴대폰으로 사진 고르듯이 올리면 됩니다. 어려우면 상인회 사무실에서 대신 등록해 드립니다."],
  ["가게 정보를 나중에 바꿀 수 있나요?", "언제든 직접 수정할 수 있습니다. 영업시간·휴무일·메뉴·사진 전부 사장님 계정에서 바꿉니다."],
  ["손님 개인정보를 받나요?", "받지 않습니다. 주문·예약·결제 기능이 없어 손님 정보를 저장하지 않습니다."],
  ["상인회 회원이 아니어도 되나요?", "상권 안에서 실제로 영업 중이면 신청할 수 있습니다. 승인은 상인회 관리자가 판단합니다."],
  ["탈퇴하면 자료는 어떻게 되나요?", "탈퇴 시 올린 사진과 가게 정보는 함께 삭제됩니다."],
];

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
  steps: {
    label: "입점 절차 3단계",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "lead", label: "설명", type: "textarea" },
    ],
  },
  benefits: {
    label: "입점하면 생기는 것 (6칸)",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "lead", label: "설명", type: "textarea" },
    ],
  },
  faq: {
    label: "자주 묻는 질문",
    fields: [{ key: "title", label: "제목", type: "text" }],
  },
  contact: {
    label: "연락처·오시는 길",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "hours", label: "사무실 운영 안내", type: "text" },
    ],
  },
};

// 기본 홈 구성
export function defaultLayout(assocName = "우리 상인회") {
  return [
    { type: "hero", enabled: true, eyebrow: "함께 만드는 우리 동네", title: "", highlight: "", subtitle: "", primaryLabel: "", showStats: false },
    { type: "featurecards", enabled: true, title: "", lead: "" },
    { type: "businesses", enabled: true, title: "지금 문 연 가게", lead: "" },
    { type: "updates", enabled: true, title: "가게가 전하는 소식" },
    { type: "mapbanner", enabled: true, title: "우리 동네 점포 지도", subtitle: "" },
    { type: "notices", enabled: true, title: "상인회 공지" },
    { type: "events", enabled: true, title: "다가오는 행사" },
    { type: "showcase", enabled: true, title: "", lead: "" },
    { type: "steps", enabled: true, title: "입점은 이렇게 진행됩니다", lead: "" },
    { type: "benefits", enabled: true, title: "입점하면 생기는 것", lead: "" },
    { type: "faq", enabled: true, title: "자주 묻는 질문" },
    { type: "contact", enabled: true, title: "연락처·오시는 길", hours: "" },
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
      out.splice(i >= 0 ? i + 1 : out.length, 0, { type: "updates", enabled: true, title: "가게가 전하는 소식" });
    }
    // 안내 섹션 업그레이드 — 점포가 적은 상권에서 홈이 텅 비지 않게, 가입 배너 앞에 순서대로 주입
    const guides = [
      ["steps", { type: "steps", enabled: true, title: "입점은 이렇게 진행됩니다", lead: "" }],
      ["benefits", { type: "benefits", enabled: true, title: "입점하면 생기는 것", lead: "" }],
      ["faq", { type: "faq", enabled: true, title: "자주 묻는 질문" }],
      ["contact", { type: "contact", enabled: true, title: "연락처·오시는 길", hours: "" }],
    ];
    for (const [type, sec] of guides) {
      if (out.some((s) => s.type === type)) continue;
      const c = out.findIndex((s) => s.type === "cta");
      out.splice(c >= 0 ? c : out.length, 0, sec);
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
      return sectionWrap("", s.title || "가게가 전하는 소식", "", `<div class="update-grid">${deps.updatesHtml}</div>`);
    case "mapbanner": {
      const n = deps.stats ? deps.stats.businesses : 0; // counts.businesses 는 페이지당 카드 수 — 전체 수는 stats
      if (!n) return ""; // 점포가 0곳이면 빈 지도로 보내는 배너일 뿐이라 숨깁니다
      const sub = s.subtitle || `${n}곳이 지도 위에. 가까운 가게를 한눈에 찾아요.`;
      return `<section class="section" style="padding-top:0"><div class="container">
        <a href="${deps.base}/map" class="map-banner">
          <span class="mb-glow" aria-hidden="true"></span>
          <span class="mb-text"><strong>${esc(s.title || "우리 동네 점포 지도")}</strong><em>${esc(sub)}</em></span>
          <span class="mb-map" aria-hidden="true"><svg viewBox="0 0 24 24" width="86" height="86" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg></span>
          <span class="mb-chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></span>
        </a></div></section>`;
    }
    case "showcase": {
      // 이 자리는 상인회가 자기 목소리로 한 문장 말하는 곳이다. 그 이상을 넣지 않는다.
      //
      // 예전에는 여기에 가입 점포·공지·행사 숫자를 크게 세 개 박았는데,
      //   ① 첫 화면 오른쪽 정보 패널이 이미 같은 세 숫자를 보여 준다 — 한 페이지에 두 번이었다.
      //   ② 25곳·6건·3건 을 2rem 으로 키우면 자랑이 아니라 초라해 보인다.
      //      작은 숫자는 크게 쓸수록 작아 보인다.
      // 안내 단추도 뺐다 — 바로 위 점포 목록과 맨 아래 가입 유도가 이미 같은 곳으로 보낸다.
      const big = esc(s.title || (deps.assoc && deps.assoc.tagline) || "우리 동네 상권의 오늘을 함께 만들어 갑니다.");
      const sub = esc(s.lead || "");
      return `<section class="showcase">
        <div class="container sc-inner">
          <p class="sc-big">${big}</p>
          ${sub ? `<p class="sc-sub">${sub}</p>` : ""}
        </div></section>`;
    }
    case "steps": {
      const rows = DEFAULT_STEPS.map(([t, d], i) => `<li class="step-item">
        <span class="step-num">${i + 1}</span>
        <div class="step-body"><strong>${t}</strong><p>${d}</p></div>
      </li>`).join("");
      return sectionWrap("section-alt", s.title || "입점은 이렇게 진행됩니다", s.lead || "",
        `<ol class="step-list">${rows}</ol>
         <div class="step-cta"><a href="${deps.base}/register" class="btn btn-primary">가입 신청하기</a>
         <span>가입비·이용료 없음 · 사진은 나중에 올려도 됩니다</span></div>`);
    }
    case "benefits": {
      // 여섯 칸 카드 격자였다. '제목 한 줄 + 설명 한 줄' 이 여섯 번 반복되는 것은
      // 카드가 아니라 목록이다 — 카드로 만들면 읽는 품만 늘고 아무것도 더 말해 주지 않는다.
      // 이 화면에서 카드 모양은 '사진이 있는 가게' 하나만 쓴다. 그래야 카드가 뜻을 갖는다.
      const rows = DEFAULT_BENEFITS.map(([, t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join("");
      return sectionWrap("", s.title || "입점하면 생기는 것", s.lead || "", `<ul class="plain-list">${rows}</ul>`);
    }
    case "faq": {
      const items = DEFAULT_FAQ.map(([q, a]) => `<details class="faq-item"><summary>${q}</summary><p>${a}</p></details>`).join("");
      return sectionWrap("section-alt", s.title || "자주 묻는 질문", "", `<div class="faq-grid">${items}</div>`);
    }
    case "contact": {
      const a = deps.assoc || {};
      const rows = [
        a.phone ? ["phone", "전화", esc(a.phone), `tel:${esc(a.phone)}`] : null,
        a.address ? ["pin", "주소", esc(a.address), `${deps.base}/map`] : null,
        a.email ? ["mail", "이메일", esc(a.email), `mailto:${esc(a.email)}`] : null,
      ].filter(Boolean);
      if (!rows.length) return ""; // 연락처가 하나도 없으면 빈 껍데기를 만들지 않음
      const cards = rows.map(([k, label, val, href]) => `<li class="contact-card">
        <span class="cc-ico" aria-hidden="true">${BENEFIT_ICONS[k]}</span>
        <span class="cc-label">${label}</span>
        <a class="cc-val" href="${href}">${val}</a>
      </li>`).join("");
      const hours = esc(s.hours || "");
      return sectionWrap("", s.title || "연락처·오시는 길", "",
        `<ul class="contact-grid">${cards}</ul>${hours ? `<p class="contact-hours">${hours}</p>` : ""}`);
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
  // 에디토리얼 히어로: 잉크 톤 배경 + 은은한 브랜드 광원 + 중앙 검색.
  // (사각형 실루엣 스카이라인은 만화처럼 보여 제거했습니다.)
  const base = deps.base;
  const eyebrow = esc(s.eyebrow || "함께 만드는 우리 동네");
  const name = (deps.assoc && deps.assoc.name) || "우리 상인회";
  const title = esc(s.title || name).replace(/\n/g, "<br />");
  const sub = esc(s.subtitle || (deps.assoc && deps.assoc.tagline) || "우리 동네 상권을 한곳에서 만나보세요.");
  const sug = deps.suggestNames && deps.suggestNames.length;
  // 배경 사진이 있으면 사진 + 어두운 베일(가독성), 없으면 먹빛 바탕과 타이포만으로 잡는다.
  const photo = deps.heroImage;
  const video = deps.heroVideo;
  // 영상은 '있으면 좋은 것'이다. 사진을 poster 로 깔아 두면 영상이 뜨기 전에도,
  // 데이터를 아끼는 방문자에게도, 움직임을 꺼 둔 방문자에게도 첫 화면이 비지 않는다.
  const clean = (u) => String(u || "").replace(/['"\\]/g, "");
  const bg = video
    ? `<video class="hp-video" autoplay muted loop playsinline preload="metadata"
        ${photo ? `poster="${clean(photo)}"` : ""} aria-hidden="true" tabindex="-1"><source src="${clean(video)}" /></video>
       ${photo ? `<div class="hp-photo" style="background-image:url('${clean(photo)}')"></div>` : ""}<div class="hp-photo-veil"></div>`
    : photo
      ? `<div class="hp-photo" style="background-image:url('${clean(photo)}')"></div><div class="hp-photo-veil"></div>`
      : ""; // 배경 사진·영상이 없으면 먹빛 바탕 그대로 — 떠다니는 흐린 광원은 걷어냈다
  // 우측 정보 패널 — 상호와 검색창만 놓인 텅 빈 대문 대신, 실제 정보로 첫 화면을 채웁니다.
  // 점포가 0곳인 상권에서는 숫자 대신 '모집 중' 상태를 보여 빈 칸을 만들지 않습니다.
  const a = deps.assoc || {};
  const st = deps.stats || {};
  const facts = [
    a.address ? ["pin", "주소", esc(a.address), ""] : null,
    a.phone ? ["phone", "문의", esc(a.phone), `tel:${esc(a.phone)}`] : null,
    a.email ? ["mail", "이메일", esc(a.email), `mailto:${esc(a.email)}`] : null,
  ].filter(Boolean);
  const factRows = facts.map(([k, label, val, href]) => `<li>
    <span class="hf-ico" aria-hidden="true">${BENEFIT_ICONS[k]}</span>
    <span class="hf-label">${label}</span>
    ${href ? `<a class="hf-val" href="${href}">${val}</a>` : `<span class="hf-val">${val}</span>`}
  </li>`).join("");
  // 0 은 표시하지 않습니다 — "0건"이 늘어선 패널은 채운 게 아니라 비어 보입니다.
  const nBiz = Number(st.businesses) || 0;
  const counts = [
    ["가입 점포", nBiz > 0 ? `${nBiz.toLocaleString("ko-KR")}곳` : "모집 중"],
    ...(Number(st.notices) > 0 ? [["공지·소식", `${Number(st.notices).toLocaleString("ko-KR")}건`]] : []),
    ...(Number(st.events) > 0 ? [["다가오는 행사", `${Number(st.events).toLocaleString("ko-KR")}건`]] : []),
  ];
  const countRows = counts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  const panel = `<aside class="hp-panel">
    <p class="hp-panel-title">${esc(name)} 안내</p>
    ${factRows ? `<ul class="hp-facts">${factRows}</ul>` : ""}
    <dl class="hp-counts">${countRows}</dl>
    <a class="btn btn-primary btn-block" href="${base}/register">우리 가게 입점 신청</a>
  </aside>`;
  return `<section class="hero-pro${photo || video ? " has-photo" : ""}${video ? " has-video" : ""}">
    <div class="hero-pro-bg" aria-hidden="true">${bg}</div>
    <div class="container hp-inner">
      <div class="hp-lead">
        <p class="hp-eyebrow">${eyebrow}</p>
        <h1 class="hp-title">${title}</h1>
        <p class="hp-sub">${sub}</p>
        <form class="feat-search hp-search" method="get" action="${base}/businesses" role="search">
          <input type="search" name="q" placeholder="가게 이름·업종 검색" aria-label="점포 검색"${sug ? ' list="storeSuggest"' : ""} />
          <button class="btn btn-primary" type="submit" aria-label="검색"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg></button>
          ${sug ? `<datalist id="storeSuggest">${deps.suggestNames.map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>` : ""}
        </form>
      </div>
      ${panel}
    </div>
  </section>`;
}

// 바로가기 카드 밴드 — 왼쪽 소개(제목·문구·검색·버튼) + 오른쪽 3색 파스텔 카드가 히어로에 겹침
function featureCardsSection(s, deps) {
  const base = deps.base;
  const st = deps.stats || {};
  const cards = [
    ["mint", "가입 점포 찾기", st.businesses ? `${Number(st.businesses).toLocaleString("ko-KR")}곳` : "업종·이름으로", `${base}/businesses`, FC_ICONS.store],
    ["beige", "점포 지도", "걸어서 찾아가기", `${base}/map`, FC_ICONS.map],
    ["forest", "공지·소식", st.notices ? `${Number(st.notices).toLocaleString("ko-KR")}건` : "상인회 알림", `${base}/notices`, FC_ICONS.news],
  ];
  const cardHtml = cards.map(([tone, ko, sub, href, ico]) => `<a class="feat-card feat-${tone}" href="${href}">
      <span class="fc-ico" aria-hidden="true">${ico}</span>
      <span class="fc-txt"><strong>${ko}</strong><em>${sub}</em></span>
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
