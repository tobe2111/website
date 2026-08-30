// 프랜차이즈 가맹점 모집 랜딩페이지 — 섹션 카탈로그 · 기본값 · 렌더러
//
// 상인회 홈(homeLayout.js)과 목적이 다르다. 상인회 홈은 "이미 온 사람에게 정보를 준다",
// 이 화면은 "처음 온 사람의 연락처를 받는다"(DB 수집)가 유일한 목표다.
// 그래서 한 장짜리 세로 스크롤로 짜고, 어느 지점에서 마음이 움직여도 바로 신청할 수 있게
// 상담 폼으로 가는 길(고정 하단 바 · 중간 CTA)을 계속 열어 둔다.
import { esc } from "./util.js";
import { presetText, termsOf, DEFAULT_PRESET, PRESETS } from "./kinds.js";

// 한 줄에 한 항목, 칸은 | 로 나눈다. 관리자가 표 편집기 없이 반복 항목을 넣는 가장 싼 방법.
export function splitLines(v, cols = 3) {
  return String(v || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split("|").map((p) => p.trim());
      while (parts.length < cols) parts.push("");
      return parts.slice(0, cols);
    });
}

// 이미지 주소는 관리자가 직접 붙여 넣는다 — https 외부 주소와 우리 경로만 허용.
// javascript: · data: 를 그대로 background-image 에 넣으면 그게 곧 주입 통로가 된다.
export function safeSrc(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^https:\/\/[^\s'"()]+$/i.test(s)) return s;
  if (/^\/(media|img)\/[^\s'"()]+$/.test(s)) return s;
  return "";
}

const nl2br = (v) => esc(v).replace(/\n/g, "<br />");

// 섹션 카탈로그 — 관리자 편집 화면이 이 정의만 보고 자동으로 만들어진다.
// type: text | textarea | lines | bool | image (주소 입력 + 파일 업로드)
export const LANDING_CATALOG = {
  hero: {
    label: "히어로 (첫 화면)",
    fields: [
      { key: "eyebrow", label: "상단 한 줄", type: "text" },
      { key: "title", label: "큰 제목 (줄바꿈 가능)", type: "textarea" },
      { key: "highlight", label: "강조할 단어 (제목 안에서 색이 바뀝니다)", type: "text" },
      { key: "subtitle", label: "설명", type: "textarea" },
      { key: "ctaLabel", label: "버튼 문구", type: "text" },
      { key: "note", label: "버튼 아래 작은 글씨", type: "text" },
      { key: "image", label: "배경 사진 (비우면 브랜딩의 히어로 사진)", type: "image" },
    ],
  },
  ticker: {
    label: "흐르는 띠 (핵심 숫자)",
    fields: [{ key: "items", label: "문구 — 한 줄에 하나", type: "lines", cols: 1, placeholder: "가맹점 240호점 돌파\n창업비용 4,900만원부터\n본사 직영 물류" }],
  },
  why: {
    label: "브랜드 소개 (왜 우리인가)",
    fields: [
      { key: "eyebrow", label: "상단 한 줄", type: "text" },
      { key: "title", label: "제목", type: "text" },
      { key: "body", label: "본문", type: "textarea" },
      { key: "image", label: "사진", type: "image" },
    ],
  },
  strengths: {
    label: "강점 카드",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "lead", label: "설명", type: "textarea" },
      { key: "items", label: "강점 — 한 줄에 하나 · 제목 | 설명", type: "lines", cols: 2, placeholder: "검증된 레시피 | 3일 교육으로 누구나 동일한 맛을 냅니다\n본사 직배송 | 원가를 고정해 마진이 흔들리지 않습니다" },
    ],
  },
  reviews: {
    label: "후기",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "lead", label: "설명", type: "textarea" },
      { key: "items", label: "후기 — 한 줄에 하나 · 내용 | 작성자", type: "lines", cols: 2, placeholder: "혼자서도 돌아가는 매장이라 처음 창업인데도 버틸 수 있었습니다 | 수원 영통점 김○○ 점주" },
    ],
  },
  menu: {
    label: "메뉴·상품 라인업",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "lead", label: "설명", type: "textarea" },
      { key: "items", label: "메뉴 — 한 줄에 하나 · 이름 | 가격 | 사진주소", type: "lines", cols: 3, placeholder: "대표 삼겹살 | 12,000원 | https://…/photo.jpg" },
    ],
  },
  process: {
    label: "진행 절차",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "lead", label: "설명", type: "textarea" },
      { key: "items", label: "단계 — 한 줄에 하나 · 제목 | 설명", type: "lines", cols: 2, placeholder: "가맹 상담 | 전화·방문 상담으로 조건을 확인합니다\n상권 분석 | 후보 자리의 유동인구·경쟁 현황을 봅니다" },
    ],
  },
  cost: {
    label: "비용 표",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "items", label: "항목 — 한 줄에 하나 · 항목 | 금액 | 비고", type: "lines", cols: 3, placeholder: "가맹비 | 1,000만원 | 부가세 별도\n교육비 | 300만원 | 2인 기준" },
      { key: "note", label: "표 아래 안내", type: "text" },
      { key: "locked", label: "상담 신청 전에는 흐리게 가리기", type: "bool" },
    ],
  },
  lead: {
    label: "상담 신청 폼 (DB 수집)",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "lead", label: "설명", type: "textarea" },
      { key: "buttonLabel", label: "버튼 문구", type: "text" },
      { key: "regionLabel", label: "지역 칸 이름", type: "text" },
      { key: "budgetLabel", label: "예산·구분 칸 이름", type: "text" },
      { key: "budgets", label: "예산·구분 선택지 — 한 줄에 하나", type: "lines", cols: 1, placeholder: "5천만원 이하\n5천~1억\n1억 이상" },
      { key: "extras", label: "추가 질문 — 한 줄에 하나 · 질문 | 종류(글·선택·연락처) | 선택지(;로 구분)", type: "lines", cols: 3,
        placeholder: "희망 오픈 시기 | 선택 | 3개월 내;6개월 내;미정\n보유 점포 유무 | 글 |" },
      { key: "funnels", label: "유입 경로 선택지 — 한 줄에 하나", type: "lines", cols: 1, placeholder: "네이버 검색\n인스타그램\n지인 소개" },
    ],
  },
  stores: {
    label: "매장·지점 안내 (등록된 곳)",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "lead", label: "설명", type: "textarea" },
    ],
  },
  faq: {
    label: "자주 묻는 질문",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "items", label: "문답 — 한 줄에 하나 · 질문 | 답변", type: "lines", cols: 2, placeholder: "외식업 경험이 없어도 되나요? | 점주의 70%가 첫 창업입니다. 3일 교육과 오픈 동행으로 시작합니다." },
    ],
  },
  notices: {
    label: "공지",
    fields: [{ key: "title", label: "제목", type: "text" }],
  },
  cta: {
    label: "하단 마무리 배너",
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "body", label: "설명", type: "textarea" },
      { key: "buttonLabel", label: "버튼 문구", type: "text" },
    ],
  },
};

export const LANDING_TYPES = Object.keys(LANDING_CATALOG);

// 기본 구성 — 관리자가 아무것도 손대지 않아도 팔리는 한 장이 나와야 한다.
// 문구는 업종 프리셋(kinds.js PRESETS)에서 가져온다. 업종을 늘릴 때 이 함수는 손대지 않는다.
// 숫자는 넣지 않는다 — 확인하지 않은 숫자가 기본값으로 박제되면 거짓말이 된다.
// 흐르는 띠만 문자열 한 덩어리라 presetText 의 "구역.키" 경로에 맞지 않는다
const tickerOf = (preset, n) => {
  const raw = (PRESETS[preset] && PRESETS[preset].ticker) || PRESETS[DEFAULT_PRESET].ticker || "";
  return String(raw).replace(/\{name\}/g, n);
};
export function defaultLandingLayout(brandName = "우리 브랜드", preset = DEFAULT_PRESET) {
  const n = brandName || "우리 브랜드";
  const t = (path, fb = "") => String(presetText(preset, path, fb)).replace(/\{name\}/g, n);
  const T = termsOf(preset);
  return [
    { type: "hero", enabled: true, eyebrow: t("hero.eyebrow"), title: t("hero.title"), highlight: t("hero.highlight"),
      subtitle: t("hero.subtitle"), ctaLabel: t("hero.ctaLabel"), note: t("hero.note"), image: "" },
    { type: "ticker", enabled: true, items: tickerOf(preset, n) },
    { type: "why", enabled: true, eyebrow: "WHY", title: t("why.title"), body: t("why.body"), image: "" },
    { type: "strengths", enabled: true, title: t("strengths.title"), lead: "", items: t("strengths.items") },
    { type: "reviews", enabled: true, title: t("reviews.title"), lead: t("reviews.lead"), items: "" },
    { type: "menu", enabled: true, title: t("menu.title"), lead: "", items: "" },
    { type: "process", enabled: true, title: t("process.title"), lead: t("process.lead"), items: t("process.items") },
    { type: "cost", enabled: true, title: t("cost.title"), locked: true, items: "", note: t("cost.note") },
    { type: "lead", enabled: true, title: t("lead.title"), lead: t("lead.lead"), buttonLabel: "상담 신청하기",
      budgets: t("lead.budgets"), regionLabel: t("lead.regionLabel"), budgetLabel: t("lead.budgetLabel"),
      funnels: "네이버 검색\n인스타그램·유튜브\n지인 소개\n방문·전단\n기타" },
    { type: "stores", enabled: true, title: t("stores.title"), lead: "" },
    { type: "faq", enabled: true, title: "자주 묻는 질문", items: t("faq.items") },
    { type: "notices", enabled: true, title: "공지" },
    { type: "cta", enabled: true, title: t("cta.title"), body: t("cta.body"), buttonLabel: `${T.consult} 신청하기` },
  ];
}

export function parseLandingLayout(json, brandName, preset = DEFAULT_PRESET) {
  if (!json) return defaultLandingLayout(brandName, preset);
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length === 0) return defaultLandingLayout(brandName, preset);
    const out = arr.filter((s) => s && LANDING_CATALOG[s.type]);
    if (!out.length) return defaultLandingLayout(brandName, preset);
    // 나중에 추가된 섹션은 기본값에서 가져와 뒤에 붙인다 — 저장해 둔 구성이 옛 버전이라고 화면이 비면 안 된다
    const have = new Set(out.map((s) => s.type));
    for (const sec of defaultLandingLayout(brandName, preset)) if (!have.has(sec.type)) out.push(sec);
    return out;
  } catch {
    return defaultLandingLayout(brandName, preset);
  }
}

export const serializeLandingLayout = (arr) => JSON.stringify(arr);

// ----- 렌더링 -----
// deps: { assoc, base, storesHtml, storeCount, noticesHtml, turnstile, flash, utm, variant }
// 고정 하단 바는 여기서 만들지 않는다 — 랜딩뿐 아니라 매장·공지 같은 하위 페이지에도 있어야 해서
// render.js 의 layout() 이 프랜차이즈 조직의 모든 화면에 붙인다.
export function renderLanding(layout, deps) {
  const on = layout.filter((s) => s.enabled);
  const hasLead = on.some((s) => s.type === "lead");
  return on.map((s) => renderSection(s, { ...deps, hasLead })).join("\n");
}

function renderSection(s, deps) {
  switch (s.type) {
    case "hero": return heroSection(s, deps);
    case "ticker": return tickerSection(s);
    case "why": return whySection(s);
    case "strengths": return strengthsSection(s);
    case "reviews": return reviewsSection(s);
    case "menu": return menuSection(s);
    case "process": return processSection(s);
    case "cost": return costSection(s, deps);
    case "lead": return leadSection(s, deps);
    case "stores": return storesSection(s, deps);
    case "faq": return faqSection(s);
    case "notices": return noticesSection(s, deps);
    case "cta": return ctaSection(s, deps);
    default: return "";
  }
}

// 제목 안의 한 단어만 색을 바꾼다. esc 한 뒤에 감싸므로 사용자 입력이 태그가 되지 않는다.
function titleWithHighlight(title, highlight) {
  const t = esc(title || "").replace(/\n/g, "<br />");
  const h = String(highlight || "").trim();
  if (!h) return t;
  const e = esc(h);
  return t.split(e).join(`<span class="fr-hl">${e}</span>`);
}

function sectionHead(title, lead, tone = "") {
  if (!title && !lead) return "";
  return `<div class="fr-head${tone ? " " + tone : ""}">
    ${title ? `<h2 class="fr-h2">${esc(title).replace(/\n/g, "<br />")}</h2>` : ""}
    ${lead ? `<p class="fr-lead">${nl2br(lead)}</p>` : ""}</div>`;
}

function heroSection(s, deps) {
  const a = deps.assoc || {};
  const img = safeSrc(s.image) || deps.heroImage || "";
  const title = titleWithHighlight(s.title || a.name || "", s.highlight);
  const tel = String(a.phone || "").replace(/[^0-9+\-]/g, "");
  return `<section class="fr-hero${img ? " has-photo" : ""}">
    ${img ? `<div class="fr-hero-bg" style="background-image:url('${esc(img)}')" aria-hidden="true"></div><div class="fr-hero-veil" aria-hidden="true"></div>` : ""}
    <div class="container fr-hero-inner">
      ${s.eyebrow ? `<p class="fr-eyebrow">${esc(s.eyebrow)}</p>` : ""}
      <h1 class="fr-hero-title">${title}</h1>
      ${s.subtitle ? `<p class="fr-hero-sub">${nl2br(s.subtitle)}</p>` : ""}
      <div class="fr-hero-actions">
        ${deps.hasLead ? `<a href="#apply" class="btn btn-primary btn-lg">${esc(s.ctaLabel || "가맹 상담 신청하기")}</a>` : ""}
        ${tel ? `<a href="tel:${esc(tel)}" class="btn btn-ghost btn-lg">전화 상담 ${esc(a.phone)}</a>` : ""}
      </div>
      ${s.note ? `<p class="fr-hero-note">${esc(s.note)}</p>` : ""}
    </div></section>`;
}

function tickerSection(s) {
  const items = splitLines(s.items, 1).map(([t]) => t);
  if (!items.length) return "";
  // 끊김 없이 흐르게 하려면 같은 줄이 두 벌 있어야 한다(하나가 빠져나가는 동안 뒤가 이어 붙는다)
  const run = items.map((t) => `<span class="fr-tick-item">${esc(t)}</span>`).join("");
  return `<div class="fr-ticker" aria-label="${esc(items.join(", "))}">
    <div class="fr-ticker-track" aria-hidden="true">${run}${run}</div></div>`;
}

function whySection(s) {
  const img = safeSrc(s.image);
  if (!s.title && !s.body && !img) return "";
  return `<section class="section fr-why" id="brand"><div class="container">
    ${s.eyebrow ? `<p class="fr-eyebrow center">${esc(s.eyebrow)}</p>` : ""}
    ${s.title ? `<h2 class="fr-h2 center">${esc(s.title)}</h2>` : ""}
    ${img ? `<div class="fr-why-photo"><img src="${esc(img)}" alt="" loading="lazy" /></div>` : ""}
    ${s.body ? `<div class="fr-why-body">${nl2br(s.body)}</div>` : ""}
  </div></section>`;
}

function strengthsSection(s) {
  const items = splitLines(s.items, 2);
  if (!items.length) return "";
  const cards = items.map(([t, d], i) => `<li class="fr-strength">
    <span class="fr-strength-no">강점 ${i + 1}</span>
    <strong>${esc(t)}</strong>${d ? `<p>${esc(d)}</p>` : ""}</li>`).join("");
  return `<section class="section fr-strengths"><div class="container">
    ${sectionHead(s.title, s.lead, "center")}
    <ul class="fr-strength-grid">${cards}</ul></div></section>`;
}

function reviewsSection(s) {
  const items = splitLines(s.items, 2);
  if (!items.length) return "";
  const cards = items.map(([body, who]) => `<li class="fr-review">
    <p>${esc(body)}</p>${who ? `<cite>${esc(who)}</cite>` : ""}</li>`).join("");
  return `<section class="section fr-reviews"><div class="container">
    ${sectionHead(s.title, s.lead, "center")}
    <ul class="fr-review-grid">${cards}</ul></div></section>`;
}

function menuSection(s) {
  const items = splitLines(s.items, 3);
  if (!items.length) return "";
  const cards = items.map(([name, price, img]) => {
    const src = safeSrc(img);
    return `<li class="fr-menu-card">
      <span class="fr-menu-thumb">${src ? `<img src="${esc(src)}" alt="" loading="lazy" />` : `<span class="fr-menu-noimg" aria-hidden="true"></span>`}</span>
      <strong>${esc(name)}</strong>${price ? `<em>${esc(price)}</em>` : ""}</li>`;
  }).join("");
  return `<section class="section fr-menu" id="menu"><div class="container">
    ${sectionHead(s.title, s.lead, "center")}
    <ul class="fr-menu-grid">${cards}</ul></div></section>`;
}

function processSection(s) {
  const items = splitLines(s.items, 2);
  if (!items.length) return "";
  const steps = items.map(([t, d], i) => `<li class="fr-step">
    <span class="fr-step-no">${String(i + 1).padStart(2, "0")}</span>
    <strong>${esc(t)}</strong>${d ? `<p>${esc(d)}</p>` : ""}</li>`).join("");
  return `<section class="section fr-process" id="process"><div class="container">
    ${sectionHead(s.title, s.lead, "center")}
    <ol class="fr-step-grid">${steps}</ol></div></section>`;
}

function costSection(s, deps) {
  const items = splitLines(s.items, 3);
  if (!items.length) return "";
  // 가린 표에도 진짜 금액을 심어 두면 소스만 열어도 다 보인다 — 가릴 때는 값 자체를 보내지 않는다.
  const locked = !!s.locked;
  const rows = items.map(([label, amount, memo]) => `<tr>
    <th scope="row">${esc(label)}</th>
    <td class="fr-cost-amt">${locked ? `<span class="fr-cost-hidden" aria-label="상담 시 안내">●●●●</span>` : esc(amount)}</td>
    <td class="fr-cost-memo">${locked ? "" : esc(memo)}</td></tr>`).join("");
  return `<section class="section fr-cost" id="cost"><div class="container narrow">
    ${sectionHead(s.title, "", "center")}
    <div class="fr-cost-wrap${locked ? " is-locked" : ""}">
      <table class="fr-cost-table"><thead><tr><th>항목</th><th>금액</th><th>비고</th></tr></thead><tbody>${rows}</tbody></table>
      ${locked ? `<div class="fr-cost-veil">
        <p><strong>상담을 신청하시면</strong> 매장 조건에 맞춘 정확한 견적을 보내드립니다.</p>
        ${deps.hasLead ? `<a href="#apply" class="btn btn-primary">비용 안내받기</a>` : ""}</div>` : ""}
    </div>
    ${s.note ? `<p class="fr-cost-note">${esc(s.note)}</p>` : ""}
  </div></section>`;
}

// 업종별 추가 질문. 고정 칸(성함·연락처·지역·예산)에 없는 것을 관리자가 직접 정의한다.
// 이름은 q1·q2… 로 보내고 라벨은 서버가 정의에서 다시 읽는다 — 폼에서 온 라벨을 그대로 믿으면
// 아무 문자열이나 상담 DB 의 열 이름이 된다.
export function extraDefs(sec) {
  return splitLines(sec && sec.extras, 3)
    .filter(([label]) => label)
    .slice(0, 8) // 상한 — 폼이 길어질수록 신청률은 떨어진다
    .map(([label, type, opts], i) => ({
      name: `q${i + 1}`, label,
      type: /선택/.test(type) ? "select" : /연락|전화|번호/.test(type) ? "tel" : "text",
      options: String(opts || "").split(";").map((o) => o.trim()).filter(Boolean),
    }));
}
function extraFields(sec) {
  return extraDefs(sec).map((f) => {
    if (f.type === "select" && f.options.length)
      return `<label>${esc(f.label)}<select name="${f.name}"><option value="">선택해 주세요</option>
        ${f.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select></label>`;
    return `<label>${esc(f.label)}<input type="${f.type === "tel" ? "tel" : "text"}" name="${f.name}" maxlength="100" /></label>`;
  }).join("");
}

// ★ 이 서비스의 목적. 위 섹션들은 전부 이 폼을 채우게 하려고 존재한다.
function leadSection(s, deps) {
  const base = deps.base || "";
  const budgets = splitLines(s.budgets, 1).map(([t]) => t);
  const funnels = splitLines(s.funnels, 1).map(([t]) => t);
  const opt = (list) => list.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  // 광고 출처는 서버가 이미 알고 있는 값(주소의 utm_*)을 심어 두고, 자바스크립트가 있으면
  // 유입 페이지(referrer)까지 채운다. 자기신고 항목만 믿으면 절반이 '기타'로 돌아온다.
  const utm = deps.utm || {};
  const hidden = (n, v) => `<input type="hidden" name="${n}" value="${esc(v || "")}" data-track="${n}" />`;
  return `<section class="section fr-apply" id="apply"><div class="container narrow">
    ${sectionHead(s.title || "가맹 상담 신청", s.lead, "center")}
    ${deps.flash || ""}
    <form method="post" action="${base}/lead" class="fr-form stack-form" id="leadForm" data-draft>
      ${hidden("utm_source", utm.source)}${hidden("utm_medium", utm.medium)}${hidden("utm_campaign", utm.campaign)}
      ${hidden("referrer", "")}<input type="hidden" name="variant" value="${esc(deps.variant || "")}" />
      <div class="form-two">
        <label>성함 <span class="req">*</span><input type="text" name="name" required maxlength="60" autocomplete="name" /></label>
        <label>연락처 <span class="req">*</span><input type="tel" name="phone" required maxlength="20" inputmode="numeric" placeholder="010-0000-0000" autocomplete="tel" /></label>
      </div>
      <div class="form-two">
        <label>${esc(s.regionLabel || "희망 지역")}<input type="text" name="region" maxlength="60" placeholder="예: 서울 서초구" /></label>
        ${budgets.length ? `<label>${esc(s.budgetLabel || "창업 예산")}<select name="budget"><option value="">선택해 주세요</option>${opt(budgets)}</select></label>`
          : `<label>${esc(s.budgetLabel || "창업 예산")}<input type="text" name="budget" maxlength="40" /></label>`}
      </div>
      ${extraFields(s)}
      ${funnels.length ? `<label>어떻게 알고 오셨나요?<select name="funnel"><option value="">선택해 주세요</option>${opt(funnels)}</select></label>` : ""}
      <label>문의 내용<textarea name="message" rows="4" maxlength="2000" placeholder="궁금한 점을 자유롭게 적어주세요."></textarea></label>
      <label class="check"><input type="checkbox" name="agree" value="1" required />
        <a href="/privacy" target="_blank">개인정보 수집·이용</a>에 동의합니다. <small>(상담 목적으로만 사용하며 보관 기간 경과 후 파기합니다)</small></label>
      <label class="check"><input type="checkbox" name="agree_marketing" value="1" /> 설명회·이벤트 등 마케팅 정보 수신에 동의합니다. <small>(선택)</small></label>
      <input type="text" name="website" class="hp-field" tabindex="-1" autocomplete="off" aria-hidden="true" />
      ${deps.turnstile || ""}
      <button class="btn btn-primary btn-block btn-lg">${esc(s.buttonLabel || "상담 신청하기")}</button>
    </form>
  </div></section>`;
}

function storesSection(s, deps) {
  if (!deps.storesHtml) return "";
  return `<section class="section fr-stores" id="stores"><div class="container">
    ${sectionHead(s.title || "매장 안내", s.lead || `현재 ${deps.storeCount || 0}개 매장이 운영 중입니다.`, "center")}
    <div class="market-grid">${deps.storesHtml}</div>
    <p class="fr-more"><a href="${deps.base}/businesses">전체 매장 보기 ›</a>${deps.storeCount ? ` <a href="${deps.base}/map">매장 지도 ›</a>` : ""}</p>
  </div></section>`;
}

function faqSection(s) {
  const items = splitLines(s.items, 2);
  if (!items.length) return "";
  const rows = items.map(([q, a]) => `<details class="fr-faq-item"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("");
  return `<section class="section fr-faq"><div class="container narrow">
    ${sectionHead(s.title || "자주 묻는 질문", "", "center")}
    <div class="fr-faq-list">${rows}</div></div></section>`;
}

function noticesSection(s, deps) {
  if (!deps.noticesHtml) return "";
  return `<section class="section fr-notices"><div class="container narrow">
    ${sectionHead(s.title || "본사 공지", "", "center")}
    <ul class="notice-list">${deps.noticesHtml}</ul>
    <p class="fr-more"><a href="${deps.base}/notices">전체 공지 ›</a></p></div></section>`;
}

function ctaSection(s, deps) {
  if (!s.title && !s.body) return "";
  return `<section class="fr-cta"><div class="container">
    <h2>${esc(s.title || "")}</h2>
    ${s.body ? `<p>${nl2br(s.body)}</p>` : ""}
    ${deps.hasLead ? `<a href="#apply" class="btn btn-primary btn-lg">${esc(s.buttonLabel || "가맹 상담 신청하기")}</a>` : ""}
  </div></section>`;
}
