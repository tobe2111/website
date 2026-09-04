// 공개/인증 페이지 핸들러 (async). ctx = { env, db, assoc, base, user, url, query, csrf, params }
import * as D from "./db.js";
import { esc, cap, clip, openBadge, openNow, hoursLine, dongOf, fmtBytes, kstStamp, kstDate, prettyPath, safeNext, parseCookies } from "./util.js";
import { layout, flash, statusBadge, pager, mediaUrl, STOREFRONT_SVG, ORIGIN, assetUrl } from "./render.js";
import { verifyInviteToken, SALES_STAGES, otpRequired, selfSignupOn, MAX_SLOTS, BULK_MAX, BULK_CHUNK, docOf, isPlaceholderEmail } from "./api.js"; // 초대 링크 검증 (api ↔ pages 순환 없음: api 는 pages 를 임포트하지 않음)
import { html, notFoundResponse, back, redirect } from "./http.js";
import { countable, countHomeGoal, homeVariantCookie } from "./traffic.js";
import { galleryItem } from "./media-render.js";
import { priceOf, costOf, jeonToWon, notifyEnabled, autoNotifyOn, canAutoSend, ALIGO_VARS, hasCfg, TEMPLATE_KEYS, TEMPLATES, billingMode, BILLING_MODES } from "./notify.js";
import { providerLabel } from "./embed.js";
import { verifySignature, publicKeyJwk, publicKeyFingerprint, keyStorage, algorithm, verifyChain, verifyAnchor } from "./esign.js";
import { renderPaper, fieldBox, FIELD_KINDS, paginate, pageCount } from "./paper.js";
import { BUILTIN, builtinsFor, builtinById, isBuiltinId, normalizeTemplate, extractVars, applyVars, resolveFieldPages } from "./templates.js";
import { buildEvidence } from "./evidence.js";
import { resolveExtToken, makeExtToken, extSignUrl } from "./extsign.js";
import { KEY_PREFIX } from "./apiv1.js";
import { text } from "./http.js";
import { parseLayout, renderHome, SECTION_CATALOG, HOME_PRESETS } from "./homeLayout.js";
import { parseLandingLayout, renderLanding, LANDING_CATALOG, safeSrc } from "./franchise.js";
import { KINDS, KIND_KEYS, PRESETS, PRESET_KEYS, kindOf, kindById, assocTerms, AREA_THEMES } from "./kinds.js";
import { turnstileWidget, turnstileScript } from "./turnstile.js";
import { otpauthUri } from "./totp.js";
import { PLANS, PLAN_KEYS, planPrices, planOf } from "./plans.js";
import { emailEnabled as emailOn } from "./email.js";
import { CRON, CRON_JOBS, cronRunKey } from "./scheduled.js";

const DOC_EVENT_LABEL = { created: "문서 생성", viewed: "계약서 열람", otp_sent: "인증번호 발송", otp_ok: "휴대폰 본인확인", signed: "전자서명 완료", declined: "서명 거절", reminded: "재알림 발송", notified: "알림 발송", edited: "문서 수정", sealed: "직인 날인 (보내는 쪽)", expired: "기한 경과로 마감" };
const CATEGORIES = ["음식점", "카페·디저트", "생활·서비스", "패션·잡화", "농수축산", "교육·문화", "기타"];
const NOTICE_CATEGORIES = ["안내", "공지", "소식", "행사", "혜택", "긴급"];
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v != null && v !== "" && !(k === "page" && v === 1)) p.set(k, v); const s = p.toString(); return s ? "?" + s : ""; };
const canModerate = (user, assoc) => user && (user.role === "SUPERADMIN" || (user.role === "ADMIN" && user.association_id === assoc.id));

// 카테고리 SVG 라인 아이콘 (디자인 시스템: brand-700 stroke, 이모지 대체)
const _ic = (inner) => `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const CAT_SVG = {
  "음식점": _ic('<path d="M4 3v7a2 2 0 0 0 2 2h1V3M7 3v9M7 12v9M17 3c-2 1.5-3 3.8-3 6v3h3v9M17 12V3"/>'),
  "카페·디저트": _ic('<path d="M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M7 5.5c0-1 .8-1 .8-2M11 5.5c0-1 .8-1 .8-2"/>'),
  "생활·서비스": _ic('<path d="M14.7 6.3a4.5 4.5 0 0 0-6 5.6L3 17.6V21h3.4l5.7-5.7a4.5 4.5 0 0 0 5.6-6L14.5 12l-2.5-2.5 2.7-3.2z"/>'),
  "의류·잡화": _ic('<path d="M9 4 5 7l1.5 3L9 8.7V20h6V8.7l2.5 1.3L19 7l-4-3a3 3 0 0 1-6 0z"/>'),
  "패션·잡화": _ic('<path d="M9 4 5 7l1.5 3L9 8.7V20h6V8.7l2.5 1.3L19 7l-4-3a3 3 0 0 1-6 0z"/>'),
  "뷰티·건강": _ic('<circle cx="6.5" cy="7" r="2.5"/><circle cx="6.5" cy="17" r="2.5"/><path d="M8.7 8.5 20 20M8.7 15.5 20 4"/>'),
  "농수축산": _ic('<path d="M7 21h10M12 21c0-6 0-8 0-10M12 11C12 7 9 5 4 5c0 5 3 7 8 7M12 13c0-3 2-5 6-5 0 4-2 6-6 6"/>'),
  "학원·교육": _ic('<path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 0 2 2h13"/><path d="M9 7h6"/>'),
  "교육·문화": _ic('<path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 0 2 2h13"/><path d="M9 7h6"/>'),
  "의료": _ic('<path d="M12 4v16M4 12h16"/><rect x="3" y="3" width="18" height="18" rx="4"/>'),
  "기타": _ic('<path d="M4 9l1.2-4.2A1 1 0 0 1 6.2 4h11.6a1 1 0 0 1 1 .8L20 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M9 20v-5h6v5"/>'),
  "전체": _ic('<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>'),
};
const catIcon = (cat) => CAT_SVG[cat] || CAT_SVG["기타"];
const PIN_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="2.6"/></svg>';
const PHONE_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.7a16 16 0 0 0 6 6l1.2-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7A2 2 0 0 1 22 16.9z"/></svg>';
const CLOCK_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const TAG_SVG = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 12 22 2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.4"/></svg>';
// 업체 SNS 원형 버튼 (시안: 히어로의 반투명 원형 아이콘 버튼)
const SNS_DEFS = [
  ["sns_naver", "네이버 플레이스", '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><text x="12" y="17" text-anchor="middle" font-size="15" font-weight="800" font-family="sans-serif">N</text></svg>'],
  ["sns_instagram", "인스타그램", '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>'],
  ["sns_youtube", "유튜브", '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M23 12s0-3.8-.5-5.6a2.9 2.9 0 0 0-2-2C18.7 4 12 4 12 4s-6.7 0-8.5.4a2.9 2.9 0 0 0-2 2C1 8.2 1 12 1 12s0 3.8.5 5.6a2.9 2.9 0 0 0 2 2C5.3 20 12 20 12 20s6.7 0 8.5-.4a2.9 2.9 0 0 0 2-2C23 15.8 23 12 23 12z" opacity=".9"/><path d="M10 15.5l6-3.5-6-3.5z" fill="var(--brand-800,#083f2b)"/></svg>'],
  ["sns_blog", "네이버 블로그", '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><text x="12" y="17" text-anchor="middle" font-size="15" font-weight="800" font-family="sans-serif">b</text></svg>'],
  ["sns_kakao", "카카오톡 채널", '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.8 5.2 4.6 6.6L5.5 21l4-2.3c.8.2 1.6.3 2.5.3 5.5 0 10-3.6 10-8S17.5 3 12 3z"/></svg>'],
];
function snsButtons(b) {
  const btns = SNS_DEFS.filter(([k]) => b[k]).map(([k, label, ico]) =>
    `<a class="sns-btn" href="${esc(b[k])}" target="_blank" rel="noopener" aria-label="${label}" title="${label}">${ico}</a>`).join("");
  return btns ? `<span class="sns-row">${btns}</span>` : "";
}

// 영업 상태 배지: 오늘 임시휴무 > 영업시간 계산
function bizStatusBadge(b) {
  if (D.isDayOff(b)) return '<span class="badge badge-dayoff">오늘 휴무</span>';
  return openBadge(b.hours);
}
// 카드 아래 두 줄. 한 줄에 주소와 영업시간을 이어 붙이면 좁은 칸에서 한가운데가 잘린다.
// 첫 줄은 "지금 갈 수 있나"(닫는 시각 / 여는 시각), 둘째 줄은 "어느 동네냐".
function bizLines(b) {
  // 오늘 임시휴무면 좌상단 배지가 이미 "오늘 휴무" 라고 말한다 — 바로 아래 같은 말을 또 쓰지 않는다.
  const dayOff = D.isDayOff(b);
  const h = dayOff ? { state: "", label: "" } : hoursLine(b.hours);
  return { h, dong: dongOf(b.address), dayOff };
}
// 업체 카드 (시안: 영업중 dot pill 좌상단 · 본문 = 카테고리 라벨/이름/두 줄 메타)
function businessCard(base, b, cover) {
  const thumb = cover
    ? `<img src="${esc(mediaUrl(cover.thumb || cover.filename))}" alt="" loading="lazy" />`
    : `<span class="thumb-ico" aria-hidden="true">${catIcon(b.category)}</span>`;
  const open = bizStatusBadge(b);
  const { h, dong } = bizLines(b);
  return `<article class="market-card" data-slug="${esc(b.slug)}">
    <button type="button" class="fav-btn" data-fav="${esc(b.slug)}" aria-label="찜하기" hidden>♥</button>
    <a href="${base}/business/${esc(b.slug)}" class="market-thumb${cover ? " has-img" : ""}">
      ${thumb}
      ${open ? `<span class="market-open">${open}</span>` : ""}
    </a>
    <div class="market-body">
      <span class="mc-cat">${esc(b.category)}</span>
      <h3><a href="${base}/business/${esc(b.slug)}">${esc(b.name)}</a></h3>
      ${h.label ? `<p class="mc-when mc-${h.state}">${esc(h.label)}</p>` : ""}
      ${dong ? `<p class="mc-meta">${PIN_SVG}<span>${esc(dong)}</span></p>` : ""}
    </div></article>`;
}

// 한 줄 목록 (시안 B — 사진 없이 한 화면에 더 많이). 같은 데이터를 카드 대신 행으로 그린다.
function businessRow(base, b) {
  // 카드와 달리 이 줄에는 배지가 없다 — 휴무도 여기서 말해야 한다.
  const { h, dong, dayOff } = bizLines(b);
  const when = dayOff ? { state: "shut", label: "오늘 휴무" } : h;
  const sub = [b.category, dong].filter(Boolean).join(" · ");
  return `<li class="biz-row">
    <a href="${base}/business/${esc(b.slug)}">
      <span class="br-main"><strong>${esc(b.name)}</strong>${sub ? `<span class="br-sub">${esc(sub)}</span>` : ""}</span>
      ${when.label ? `<span class="br-when mc-${when.state}">${esc(when.label)}</span>` : ""}
    </a></li>`;
}

// D-day 계산 (KST 기준): 오늘=D-DAY, 미래=D-n, 과거=null(공개 홈은 예정 행사만 노출)
function dDayLabel(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) return "";
  const day = 86400000;
  const diff = Math.round((Date.parse(dateStr + "T00:00:00Z") - Date.parse(D.kstToday() + "T00:00:00Z")) / day);
  if (isNaN(diff) || diff < 0) return "";
  return diff === 0 ? "D-DAY" : "D-" + diff;
}
// 행사 카드 (시안: 이미지 16:10 + 오버레이 + 날짜 칩 / 이미지 없으면 날짜 사각형형)
function eventCard(base, e) {
  const d = e.event_date.slice(8, 10), mo = Number(e.event_date.slice(5, 7)) + "월";
  const dd = dDayLabel(e.event_date);
  const ddBadge = dd ? `<span class="dday${dd === "D-DAY" ? " is-today" : ""}">${dd}</span>` : "";
  const calLink = `<a class="event-cal" href="${base}/events/${e.id}/calendar.ics" title="아이폰·구글 캘린더에 추가">${CAL_SVG} 캘린더에 추가</a>`;
  if (e.image) return `<article class="event-photo-card">
    <img src="${esc(mediaUrl(e.image))}" alt="" loading="lazy" />
    <span class="epc-overlay" aria-hidden="true"></span>
    ${ddBadge ? `<span class="dday dday-corner${dd === "D-DAY" ? " is-today" : ""}">${dd}</span>` : ""}
    <span class="epc-body"><span class="epc-date">${Number(e.event_date.slice(5, 7))}.${Number(d)}</span><strong>${esc(e.title)}</strong>${e.place ? `<span class="epc-place">${PIN_SVG}${esc(e.place)}</span>` : ""}${calLink}</span>
  </article>`;
  return `<article class="event-card"><div class="event-date"><span class="d">${d}</span><span class="m">${mo}</span></div>
      <div class="event-info">${ddBadge ? `<div class="ev-head"><h3>${esc(e.title)}</h3>${ddBadge}</div>` : `<h3>${esc(e.title)}</h3>`}<p>${esc(e.description)}</p>${e.place ? `<span class="event-place">${PIN_SVG}${esc(e.place)}</span>` : ""}${calLink}</div></article>`;
}
const CAL_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 9h18M12 13v5M9.5 15.5h5"/></svg>';

// 행사 → iCalendar 파일 (아이폰·구글·네이버 캘린더 공통 규격)
export async function eventIcs(ctx) {
  const { db, assoc, params } = ctx;
  const e = await D.getEvent(db, Number(params.id));
  if (!e || e.association_id !== assoc.id || !/^\d{4}-\d{2}-\d{2}/.test(e.event_date || "")) return notFoundResponse(ctx);
  const day = e.event_date.slice(0, 10);
  const next = new Date(day + "T00:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
  const icsEsc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//sanginhoe-platform//ko", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:event-${e.id}@${assoc.slug}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${day.replace(/-/g, "")}`,
    `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`,
    `SUMMARY:${icsEsc(e.title)} — ${icsEsc(assoc.name)}`,
    e.place ? `LOCATION:${icsEsc(e.place)}` : "",
    e.description ? `DESCRIPTION:${icsEsc(e.description)}` : "",
    "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
  return new Response(ics, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="event-${e.id}.ics"`, "cache-control": "public, max-age=600" } });
}

export async function home(ctx, opts = {}) {
  const { db, assoc, base, user, csrf } = ctx;
  // 어떤 홈을 그릴지는 제품 유형 레지스트리가 정한다 (kinds.js). 새 제품을 더해도 이 분기는 그대로다.
  //   esign   = 계약 창구(점포·지도 대신 서명 입구), landing = 한 장짜리 모집 화면
  const home = kindOf(assoc).home;
  if (home === "esign") return esignHome(ctx);
  if (home === "landing") return franchiseHome(ctx);
  // A/B 사본이면 그 사본의 구성으로 그리고, 방문을 사본 이름으로 센다.
  // 기본 홈은 variant "" 로 세므로 둘을 나란히 비교할 수 있다.
  const variant = String(opts.variant || "");
  const lay = parseLayout(opts.layoutJson || assoc.home_layout, assoc.name);
  if (countable(ctx, variant, "view")) await D.bumpLandingView(db, assoc.id, variant).catch(() => {});
  // 이 방문이 어느 사본에서 시작됐는지 30분만 기억한다. 손님은 홈에서 곧장 신청하지 않고
  // 가게를 눌러 보고 검색해 본 뒤에 움직이므로, 그 여정을 이어 붙이지 않으면
  // "어느 홈이 실제로 입점 신청을 만들었나" 를 영원히 알 수 없다.
  // 개인을 식별하는 값이 아니라 사본 이름 한 조각이고, 30분 뒤 스스로 사라진다.
  if (ctx.addCookie) ctx.addCookie(homeVariantCookie(variant, base, ctx.isProd));
  // 독립 쿼리는 병렬로 — D1 은 쿼리마다 네트워크 왕복이라 직렬 대기가 TTFB 로 직결됨
  // 한 줄 목록 구성은 한 화면에 12곳을 담는다. 12곳을 받아 두고 사진 카드 구성에서만 8곳으로 자른다
  // (4열 그리드는 8이라야 마지막 줄이 꽉 찬다).
  const [{ items }, notices, events, stats, cats, names, recentUpdates, hourRows] = await Promise.all([
    D.listBusinessesPaged(db, assoc.id, { perPage: 12 }),
    D.listNotices(db, assoc.id, 5),
    D.listEvents(db, assoc.id, true),
    D.stats(db, assoc.id),
    D.distinctCategories(db, assoc.id),
    D.listBusinessNames(db, assoc.id),
    D.listAssocUpdates(db, assoc.id, 6),
    D.listBusinessHours(db, assoc.id),
  ]);
  // 홈 팝업 — 관리자가 띄운 안내창. 기간이 지난 것은 질의에서 이미 빠집니다.
  const popups = await D.listActivePopups(db, assoc.id, 3).catch(() => []);
  const cardItems = items.slice(0, 8);
  const covers = await D.coverImagesFor(db, cardItems.map((b) => b.id));
  const businessesHtml = cardItems.map((b) => businessCard(base, b, covers.get(b.id))).join("");
  const businessRowsHtml = items.map((b) => businessRow(base, b)).join("");
  // "지금 문 연 곳 24곳" — 영업시간은 자유 입력 문자열이라 SQL 로는 못 세고 여기서 센다.
  const openCount = hourRows.filter((r) => openNow(r.hours) === true && !D.isDayOff(r)).length;
  // 업종 줄 — 아이콘 아홉 개가 붙으면 도구모음처럼 보인다. 여기는 사실상 이 사이트의 주 메뉴이므로
  // 글자만 남기고, 맨 앞에 손님이 가장 자주 쓸 "지금 문 연 곳"을 둔다.
  const catTiles = cats.length ? `<nav class="cat-tabs" aria-label="업종별 보기">
    ${openCount > 0 ? `<a class="cat-tab cat-tab-open" href="${base}/businesses?open=1">지금 문 연 곳 ${openCount}</a>` : ""}
    ${cats.map((c) => `<a class="cat-tab" href="${base}/businesses?category=${encodeURIComponent(c.category)}">${esc(c.category)}</a>`).join("")}
    <a class="cat-tab cat-tab-all" href="${base}/businesses">전체 ${Number(stats.businesses) || 0}곳</a>
  </nav>` : "";
  const eventsHtml = events.map((e) => eventCard(base, e)).join("");
  // ── 활동사진 —— 사진이 붙은 공지를 사진판으로 보여준다.
  // 상인회가 실제로 무엇을 하는 곳인지는 문장보다 사진이 빨리 말한다.
  // 다만 같은 공지를 사진판과 공지 목록에 두 번 늘어놓지는 않는다 — 사진판이 켜져 있으면
  // 그 공지는 사진판 몫이고, 아래 공지 목록에는 사진 없는 것만 남는다.
  const photoOn = lay.some((s) => s.type === "photos" && s.enabled !== false);
  const withPhoto = photoOn ? notices.filter((n) => n.image) : [];
  const textNotices = photoOn ? notices.filter((n) => !n.image) : notices;
  const photosHtml = withPhoto.slice(0, 6).map((n) => `<a class="pb-card" href="${base}/notices/${n.id}">
    <span class="pb-shot"><img src="${esc(mediaUrl(n.image))}" alt="" loading="lazy" />
      <span class="pb-view" aria-hidden="true">view <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></span></span>
    <time>${esc(kstDate(n.created_at))}</time>
    <strong>${esc(n.title)}</strong></a>`).join("");
  const body = renderHome(lay, {
    assoc, base, stats, businessesHtml, businessRowsHtml, openCount, catTiles, eventsHtml, loggedIn: !!user,
    heroImage: assoc.hero_image ? mediaUrl(assoc.hero_image) : "",
    heroVideo: assoc.hero_video ? mediaUrl(assoc.hero_video) : "",
    photosHtml,
    noticesHtml: textNotices.length ? noticeRows(base, textNotices) : "",
    counts: { businesses: items.length, notices: notices.length, events: events.length },
    // 사진 카드 구성은 8곳, 한 줄 목록 구성은 12곳을 보여준다
    suggestNames: names.map((r) => r.name),
    updatesHtml: recentUpdates.map((u) => `<a class="update-card" href="${base}/business/${esc(u.biz_slug)}">
      ${u.image ? `<span class="uc-img"><img src="${esc(mediaUrl(u.image))}" alt="" loading="lazy" /></span>` : ""}
      <span class="uc-body"><strong>${esc(u.biz_name)}</strong><p>${esc(u.body)}</p><time>${esc(kstDate(u.created_at, ".").slice(5))}</time></span></a>`).join(""),
  });
  // 검색엔진 구조화 데이터: 상인회 = 조직 + 사이트 검색액션(사이트링크 검색창)
  const homeUrl = `${ORIGIN}${base}/`;
  const orgLd = {
    "@context": "https://schema.org", "@type": "Organization",
    name: assoc.name, url: homeUrl,
    ...(assoc.tagline ? { description: assoc.tagline } : {}),
    ...(assoc.logo ? { logo: /^https?:\/\//.test(mediaUrl(assoc.logo)) ? mediaUrl(assoc.logo) : ORIGIN + mediaUrl(assoc.logo) } : {}),
    ...(assoc.phone ? { telephone: assoc.phone } : {}),
    ...(assoc.address ? { address: { "@type": "PostalAddress", streetAddress: assoc.address, addressCountry: "KR" } } : {}),
  };
  const siteLd = {
    "@context": "https://schema.org", "@type": "WebSite",
    name: assoc.name, url: homeUrl,
    // 구글 사이트링크 검색창: 브랜드 검색 시 결과에 점포 검색 입력창 노출
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${ORIGIN}${base}/businesses?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
  return html(layout({ title: "", assoc, base, user, body: body + popupLayer(popups), activeNav: `${base}/`, csrf, description: assoc.tagline, jsonLd: [orgLd, siteLd],
    scripts: `${names.length ? `<script src="${assetUrl("/js/suggest.js")}" defer></script>` : ""}${popups.length ? `<script src="${assetUrl("/js/popup.js")}" defer></script>` : ""}` }));
}

// 홈 팝업 마크업.
//
// 처음에는 아무것도 보이지 않게 두고(hidden), 자바스크립트가 '오늘 안 봤다'를 확인한 뒤에만 엽니다.
// 그래서 자바스크립트가 꺼진 브라우저에서는 팝업이 아예 뜨지 않습니다 — 화면을 가로막아 놓고
// 닫을 수단이 없는 상태가 되는 것보다, 안 뜨는 편이 낫습니다.
// 읽어 주는 프로그램(스크린리더)에는 창으로 알려야 하므로 role="dialog" + aria-modal 을 답니다.
function popupLayer(popups) {
  if (!popups || !popups.length) return "";
  const cards = popups.map((p) => `<div class="popup-card" role="dialog" aria-modal="true" aria-labelledby="popupTitle${p.id}" data-popup="${p.id}" hidden>
    <div class="popup-head"><h2 class="popup-title" id="popupTitle${p.id}">${esc(p.title)}</h2>
      <button type="button" class="popup-x" data-popup-close aria-label="팝업 닫기">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    ${p.image ? `<img class="popup-img" src="${esc(mediaUrl(p.image))}" alt="" />` : ""}
    ${p.body ? `<p class="popup-body">${esc(p.body).replace(/\n/g, "<br />")}</p>` : ""}
    ${p.link_url ? `<a class="btn btn-primary btn-sm popup-go" href="${esc(p.link_url)}">${esc(p.link_label || "자세히 보기")}</a>` : ""}
    <div class="popup-foot">
      <label class="check popup-today"><input type="checkbox" data-popup-today /> 오늘 하루 보지 않기</label>
      <button type="button" class="btn btn-ghost btn-xs" data-popup-close>닫기</button>
    </div>
  </div>`).join("");
  return `<div class="popup-layer" id="popupLayer" hidden><div class="popup-dim" data-popup-close></div>${cards}</div>`;
}

// 섹션 편집기 — 상인회 홈(SECTION_CATALOG)과 프랜차이즈 랜딩(LANDING_CATALOG)이 같은 편집기를 쓴다.
// 카탈로그 정의만 보고 입력칸을 만들므로, 섹션을 늘려도 이 함수는 그대로다.
function layoutEditor(base, layoutArr, opts = {}) {
  const catalog = opts.catalog || SECTION_CATALOG;
  const action = opts.action || `${base}/admin/layout`;
  const resetAction = opts.resetAction || `${base}/admin/layout/reset`;
  const submitLabel = opts.submitLabel || "홈페이지 구성 저장";
  const rows = layoutArr.map((sec, i) => {
    const cat = catalog[sec.type];
    const fields = cat.fields.map((f) => {
      const val = sec[f.key], name = `f_${i}_${f.key}`;
      if (f.type === "bool") return `<label class="check"><input type="checkbox" name="${name}" value="1"${val ? " checked" : ""} /> ${esc(f.label)}</label>`;
      // lines: 한 줄에 한 항목, 칸은 | 로 나눈 반복 입력 (표 편집기 없이 목록을 다루는 가장 싼 방법)
      if (f.type === "lines") return `<label class="mini-label">${esc(f.label)}<textarea name="${name}" rows="5" class="lines-input" spellcheck="false"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ""}>${esc(val || "")}</textarea></label>`;
      if (f.type === "textarea") return `<label class="mini-label">${esc(f.label)}<textarea name="${name}" rows="2">${esc(val || "")}</textarea></label>`;
      if (f.type === "select") {
        const cur = val || (f.options[0] && f.options[0][0]);
        return `<label class="mini-label">${esc(f.label)}<select name="${name}">${f.options.map(([ov, ol]) => `<option value="${esc(ov)}"${cur === ov ? " selected" : ""}>${esc(ol)}</option>`).join("")}</select></label>`;
      }
      // image: 주소를 직접 넣어도 되고, 파일을 고르면 올린 뒤 그 주소로 채워 넣는다.
      // "사진을 어디에 올려서 주소를 따오지?" 에서 막히는 것이 편집기의 가장 큰 마찰이었다.
      if (f.type === "image") return `<div class="img-field"><label class="mini-label">${esc(f.label)}
        <input type="text" name="${name}" value="${esc(val || "")}" placeholder="https://… 또는 아래에서 파일 선택" /></label>
        <label class="mini-label">파일 올리기<input type="file" name="file_${i}_${f.key}" accept="image/*" /></label>
        ${safeSrc(val) ? `<span class="img-field-preview"><img src="${esc(safeSrc(val))}" alt="" loading="lazy" /></span>` : ""}</div>`;
      return `<label class="mini-label">${esc(f.label)}<input type="text" name="${name}" value="${esc(val || "")}" /></label>`;
    }).join("");
    return `<div class="layout-row" data-index="${i}"><div class="layout-row-head">
      <div class="row-toggle"><label class="switch"><input type="checkbox" name="en_${i}" value="1"${sec.enabled ? " checked" : ""} /><span class="track"></span></label> <strong>${esc(cat.label)}</strong></div>
      <input type="hidden" name="ty_${i}" value="${esc(sec.type)}" />
      <span class="layout-move"><button type="button" class="move-btn" data-dir="up" aria-label="위로">▲</button><button type="button" class="move-btn" data-dir="down" aria-label="아래로">▼</button></span>
    </div><div class="layout-fields">${fields}</div></div>`;
  }).join("");
  return `<form method="post" action="${action}" class="layout-editor" id="layoutEditor"${opts.upload ? ' enctype="multipart/form-data"' : ""}>
    <input type="hidden" name="order" id="layoutOrder" value="${layoutArr.map((_, i) => i).join(",")}" />
    <div id="layoutRows">${rows}</div>
    <div class="layout-actions"><button type="submit" class="btn btn-primary btn-sm">${esc(submitLabel)}</button>
      ${opts.extra || ""}
      <button type="submit" formaction="${resetAction}" class="btn btn-ghost btn-sm" data-confirm="기본 구성으로 되돌릴까요?">기본 구성으로 초기화</button></div></form>`;
}

// ================= 프랜차이즈 가맹점 모집 랜딩 =================
// 방문자가 이 화면에서 할 일은 하나다 — 연락처를 남기는 것. 나머지 섹션은 그 결심을 돕는 근거다.

// 광고 주소에 붙어 오는 값. 신청자 자기신고(유입 경로)와 달리 거짓말을 하지 않는다.
const utmOf = (query) => ({
  source: cap(query.get("utm_source") || "", 60),
  medium: cap(query.get("utm_medium") || "", 60),
  campaign: cap(query.get("utm_campaign") || "", 60),
});

// 랜딩 한 장을 그린다. 기본 랜딩과 캠페인 사본, 편집 미리보기가 모두 이 함수를 지난다.
// layoutJson 이 지정되면 그것을, 아니면 조직의 발행본을 쓴다.
async function renderFranchisePage(ctx, { layoutJson, variant = "", preview = false, countView = true }) {
  const { db, env, assoc, base, user, csrf, query } = ctx;
  const lay = parseLandingLayout(layoutJson, assoc.name, assoc.preset);
  const [{ items }, notices, stats] = await Promise.all([
    D.listBusinessesPaged(db, assoc.id, { perPage: 8 }),
    D.listNotices(db, assoc.id, 4),
    D.stats(db, assoc.id),
  ]);
  const covers = await D.coverImagesFor(db, items.map((b) => b.id));
  // 방문 수 — 신청 수만 알면 "많이 왔는데 안 남긴 건지"를 영원히 구분할 수 없다.
  // 미리보기는 관리자 자신의 조회라 세지 않는다.
  if (countView && countable(ctx, variant, "view")) await D.bumpLandingView(db, assoc.id, variant).catch(() => {});
  const heroImage = assoc.hero_image ? mediaUrl(assoc.hero_image) : "";
  const heroVideo = assoc.hero_video ? mediaUrl(assoc.hero_video) : "";
  const body = renderLanding(lay, {
    assoc, base, variant,
    storesHtml: items.map((b) => businessCard(base, b, covers.get(b.id))).join(""),
    storeCount: stats.businesses,
    heroImage,
    heroVideo,
    noticesHtml: notices.length ? noticeRows(base, notices) : "",
    turnstile: turnstileWidget(env),
    flash: flashOf(query),
    utm: utmOf(query),
  });
  const homeUrl = `${ORIGIN}${base}/`;
  const orgLd = {
    "@context": "https://schema.org", "@type": "Organization",
    name: assoc.name, url: homeUrl,
    ...(assoc.tagline ? { description: assoc.tagline } : {}),
    ...(assoc.logo ? { logo: /^https?:\/\//.test(mediaUrl(assoc.logo)) ? mediaUrl(assoc.logo) : ORIGIN + mediaUrl(assoc.logo) } : {}),
    ...(assoc.phone ? { telephone: assoc.phone } : {}),
    ...(assoc.address ? { address: { "@type": "PostalAddress", streetAddress: assoc.address, addressCountry: "KR" } } : {}),
  };
  // 카톡·SNS 공유 미리보기: 로고보다 첫 화면 사진이 훨씬 잘 먹힌다.
  // 히어로 섹션에 따로 넣은 사진이 있으면 그걸, 없으면 브랜딩의 히어로 배경을 쓴다.
  const heroSec = lay.find((s) => s.type === "hero" && s.enabled);
  const ogImage = (heroSec && safeSrc(heroSec.image)) || heroImage || "";
  const banner = preview
    ? `<div class="preview-bar">미리보기 — 아직 발행되지 않은 초안입니다. 손님에게는 보이지 않습니다.
        <a href="${base}/admin/landing${variant ? `?v=${encodeURIComponent(variant)}` : ""}">편집으로 돌아가기</a></div>`
    : "";
  // 히어로 사진은 CSS background-image 라 브라우저의 preload 스캐너가 발견하지 못한다.
  // CSS 파싱과 레이아웃을 기다린 뒤에야 받기 시작하는데, 광고로 들어온 사람에게는 그 지연이
  // 곧 이탈이다. 이 사진이 첫 화면의 가장 큰 그림(LCP)이라 HTML 과 동시에 받게 한다.
  return html(layout({ title: "", assoc, base, user, body: banner + body, activeNav: `${base}/`, csrf, jsonLd: orgLd, ogImage, preloadImage: ogImage,
    description: assoc.tagline || `${assoc.name} 가맹점 모집 — 창업 비용·가맹 절차 안내와 상담 신청.`,
    scripts: `${turnstileScript(env)}<script src="${assetUrl("/js/lead-track.js")}" defer></script>` }));
}

async function franchiseHome(ctx) {
  return renderFranchisePage(ctx, { layoutJson: ctx.assoc.landing_layout });
}

// 캠페인 사본 — /l/:slug. 인스타용·검색광고용 문구를 따로 두고 전환율을 비교한다.
// 사본 주소 — 같은 조직의 다른 구성. 모집 랜딩과 상인회 홈이 같은 표(landing_variants)를 쓴다.
// 무엇을 사본으로 두느냐만 다르다: 모집형은 랜딩 구성, 상인회는 홈 구성.
export async function tenantVariant(ctx) {
  const { db, assoc, params } = ctx;
  const v = await D.getLandingVariant(db, assoc.id, String(params.slug || "").slice(0, 40));
  if (!v) return notFoundResponse(ctx);
  if (assoc.kind === "franchise")
    return renderFranchisePage(ctx, { layoutJson: v.layout || assoc.landing_layout, variant: v.slug });
  // 상인회 홈 — 전자계약 조직은 홈에 비교할 구성이 없으므로 사본을 두지 않는다
  if (kindOf(assoc).home !== "merchant") return notFoundResponse(ctx);
  return home(ctx, { layoutJson: v.layout || assoc.home_layout, variant: v.slug });
}
export const franchiseVariant = tenantVariant; // 예전 이름 (라우트 표에서 참조)

// 발행 전 초안 미리보기 — 관리자만.
export async function adminLandingPreview(ctx) {
  const { db, assoc, query } = ctx;
  const slug = cap(query.get("v") || "", 40);
  if (slug) {
    const v = await D.getLandingVariant(db, assoc.id, slug);
    if (!v) return notFoundResponse(ctx);
    return renderFranchisePage(ctx, { layoutJson: v.draft || v.layout || assoc.landing_layout, variant: v.slug, preview: true, countView: false });
  }
  return renderFranchisePage(ctx, { layoutJson: assoc.landing_draft || assoc.landing_layout, preview: true, countView: false });
}

// 랜딩 편집 화면 — 관리자가 문구·순서·표시 여부를 직접 바꾼다.
// 상인회 관리자 콘솔(/admin)에 끼워 넣지 않고 따로 둔다: 프랜차이즈 관리자에게 회비·투표는 남의 화면이다.
export async function adminLanding(ctx) {
  const { db, assoc, base, user, csrf, query } = ctx;
  const slug = cap(query.get("v") || "", 40);
  const [variants, assets, stats] = await Promise.all([
    D.listLandingVariants(db, assoc.id),
    D.listLandingAssets(db, assoc.id),
    D.leadStats(db, assoc.id),
  ]);
  const cur = slug ? variants.find((v) => v.slug === slug) : null;
  if (slug && !cur) return notFoundResponse(ctx);
  // 편집기는 항상 초안을 연다. 초안이 없으면 발행본을 복사해 온 것처럼 보여 준다.
  const source = cur ? (cur.draft || cur.layout) : (assoc.landing_draft || assoc.landing_layout);
  const hasDraft = cur ? !!cur.draft : !!assoc.landing_draft;
  const lay = parseLandingLayout(source, assoc.name, assoc.preset);
  const qv = cur ? `?v=${encodeURIComponent(cur.slug)}` : "";
  const publicUrl = cur ? `${base}/l/${encodeURIComponent(cur.slug)}` : `${base}/`;
  const retention = parseInt((await D.getSetting(db, `lead_retention:${assoc.id}`)) || String(D.LEAD_RETENTION_DEFAULT), 10);

  const variantTabs = [`<a class="pill${cur ? "" : " pill-on"}" href="${base}/admin/landing">기본 랜딩</a>`,
    ...variants.map((v) => `<a class="pill${cur && cur.slug === v.slug ? " pill-on" : ""}" href="${base}/admin/landing?v=${encodeURIComponent(v.slug)}">${esc(v.name || v.slug)}${v.draft ? " •" : ""}</a>`)].join("");
  const assetCards = assets.length ? assets.map((a) => `<li class="asset-card">
    <img src="${esc(mediaUrl(a.filename))}" alt="" loading="lazy" />
    <input type="text" class="asset-url" value="${esc(mediaUrl(a.filename))}" readonly data-select-all />
    <form method="post" action="${base}/admin/landing/asset/${a.id}/delete" data-confirm="이 사진을 지울까요?&#10;섹션에 넣어 둔 곳이 있으면 사진이 사라집니다."><button class="link-danger">삭제</button></form>
  </li>`).join("") : `<li class="empty">아직 올린 사진이 없습니다.</li>`;

  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">모집 랜딩 · ${esc(assoc.name)}</p><h1 class="dash-title">랜딩페이지 편집</h1>
      <p class="dash-sub">공개 주소: <a href="${publicUrl}" target="_blank">${esc(prettyPath(publicUrl))}</a>${hasDraft ? ` · <b class="draft-mark">발행되지 않은 수정본 있음</b>` : ""}</p></div>
      <div class="dash-head-actions"><a href="${base}/admin/leads" class="btn btn-primary btn-sm">상담 DB ${stats.total}건</a>
        <a href="${base}/admin" class="btn btn-ghost btn-sm">관리자</a></div></div>
    ${flashOf(query)}
    ${assoc.kind === "franchise" ? "" : `<div class="flash flash-warn">이 조직의 유형이 <b>프랜차이즈</b>가 아니라서, 발행해도 공개 홈에는 이 랜딩이 아닌 기존 홈페이지가 나옵니다.
      유형은 플랫폼 운영자가 바꿔 드립니다.</div>`}

    <section class="panel"><div class="panel-head"><h2 class="panel-title">편집할 랜딩</h2>
      <span class="pill-row">${variantTabs}</span></div>
      <p class="panel-hint">광고 소재마다 다른 문구를 쓰고 싶으면 <b>사본</b>을 만드세요. 사본은 <code>${esc(prettyPath(base))}/l/주소</code> 로 열리고,
        상담 신청도 사본별로 따로 집계됩니다. <b>•</b> 표시는 발행되지 않은 수정본이 있다는 뜻입니다.</p>
      <div class="form-two">
        <form method="post" action="${base}/admin/landing/variant" class="stack-form compact">
          <div class="form-two"><label>사본 이름<input type="text" name="name" required maxlength="40" placeholder="예: 인스타 광고용" autocomplete="name" /></label>
            <label>주소<input type="text" name="slug" required maxlength="40" pattern="[a-z0-9\-]+" placeholder="instagram" /></label></div>
          <button class="btn btn-primary btn-sm">현재 내용으로 사본 만들기</button></form>
        ${cur ? `<form method="post" action="${base}/admin/landing/variant/${encodeURIComponent(cur.slug)}/delete" class="stack-form compact"
            data-confirm="'${esc(cur.name || cur.slug)}' 사본을 지울까요?&#10;이미 받은 상담 신청은 그대로 남습니다.">
          <p class="panel-hint">지금 <b>${esc(cur.name || cur.slug)}</b> 사본을 편집 중입니다.</p>
          <button class="btn btn-ghost btn-sm">이 사본 삭제</button></form>` : ""}
      </div></section>

    <section class="panel"><h2 class="panel-title">사진 보관함</h2>
      <p class="panel-hint">여기에 올린 뒤 주소를 복사해 섹션에 붙여 넣습니다. 메뉴처럼 여러 장이 필요한 칸은 이 주소를 씁니다.</p>
      <form method="post" action="${base}/admin/landing/asset" enctype="multipart/form-data" class="stack-form compact">
        <label class="mini-label">사진 올리기 <small>(여러 장 선택 가능 · 장당 8MB 이하)</small>
          <input type="file" name="images" accept="image/*" multiple required /></label>
        <button class="btn btn-primary btn-sm">올리기</button></form>
      <ul class="asset-grid">${assetCards}</ul></section>

    <section class="panel">
      <div class="panel-head"><h2 class="panel-title">섹션 구성 ${cur ? `<span class="badge badge-info">${esc(cur.name || cur.slug)}</span>` : ""}</h2>
        <span class="pill-row"><a class="btn btn-xs btn-ghost" href="${base}/admin/landing/preview${qv}" target="_blank">미리보기</a></span></div>
      <p class="panel-hint">스위치로 켜고 끄고, ▲▼ 로 순서를 바꾸고, 문구를 직접 고칩니다.
        <b>한 줄에 하나</b>라고 적힌 칸은 줄바꿈으로 항목을 나누고 <code>|</code> 로 칸을 나눕니다 — 예: <code>가맹비 | 1,000만원 | 부가세 별도</code>.</p>
      <p class="panel-hint"><b>저장</b>은 초안에만 반영됩니다. 손님에게 보이려면 <b>발행</b>을 눌러야 합니다.</p>
      ${layoutEditor(base, lay, { catalog: LANDING_CATALOG, action: `${base}/admin/landing${qv}`,
        resetAction: `${base}/admin/landing/reset${qv}`, submitLabel: "초안 저장", upload: true,
        extra: `${hasDraft ? `<button type="submit" formaction="${base}/admin/landing/publish${qv}" class="btn btn-primary btn-sm">발행하기</button>
          <button type="submit" formaction="${base}/admin/landing/discard${qv}" class="btn btn-ghost btn-sm" data-confirm="편집한 초안을 버리고 발행본으로 되돌릴까요?">초안 버리기</button>` : ""}` })}
      <p class="panel-hint">저장과 동시에 발행하려면 <b>저장 → 발행하기</b> 순서로 두 번 누르세요.</p>
    </section>

    <section class="panel"><h2 class="panel-title">상담 정보 보관 기간</h2>
      <p class="panel-hint">처리가 끝난 건(<b>계약</b>·<b>보류·종료</b>)은 이 기간이 지나면 매일 자동으로 지웁니다.
        진행 중인 건은 지우지 않습니다. 개인정보처리방침의 "상담 종료 시 파기" 약속을 사람 손이 아니라 시스템이 지키게 하는 장치입니다.</p>
      <form method="post" action="${base}/admin/landing/retention" class="stack-form compact">
        <label>보관 기간 <small>(일)</small><input type="number" name="days" value="${retention}" min="30" max="3650" required /></label>
        <button class="btn btn-primary btn-sm">저장</button></form></section>
  </div></section>`;
  return html(layout({ title: "랜딩페이지 편집", assoc, base, user, body, csrf,
    scripts: `<script src="${assetUrl("/js/layout-editor.js")}" defer></script><script src="${assetUrl("/js/upload-resize.js")}" defer></script>` }));
}

// 업종별 추가 질문의 답 — 조직마다 항목이 달라 고정 열로 둘 수 없다. 이름 칸 아래에 함께 보여준다.
function parseExtra(l) {
  try { const o = JSON.parse(l.extra || ""); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}
function extraSummary(l) {
  const e = Object.entries(parseExtra(l));
  if (!e.length) return "";
  return `<ul class="lead-extra">${e.map(([k, v]) => `<li><span>${esc(k)}</span> ${esc(v)}</li>`).join("")}</ul>`;
}

const LEAD_BADGE = { new: "badge-wait", contacted: "badge-info", visit: "badge-brand", contract: "badge-ok", drop: "badge-neutral" };
const LEAD_PER_PAGE = 50;

// 상담 신청 DB — 이 제품이 파는 것의 실체. 목록·상태·메모·내보내기가 전부 여기 있다.
export async function adminLeads(ctx) {
  const { db, assoc, base, user, csrf, query } = ctx;
  const status = D.LEAD_STATUSES.includes(query.get("status")) ? query.get("status") : "";
  const page = Math.max(1, parseInt(query.get("page") || "1", 10) || 1);
  const [stats, funnels, utms, views, calls, byVariant, viewsByVariant, variants, since30] = await Promise.all([
    D.leadStats(db, assoc.id),
    D.leadFunnelStats(db, assoc.id),
    D.leadUtmStats(db, assoc.id, 30),
    D.landingViewsSince(db, assoc.id, 30),
    D.landingCallsSince(db, assoc.id, 30),
    D.leadCountsByVariant(db, assoc.id, 30),
    D.landingViewsByVariant(db, assoc.id, 30),
    D.listLandingVariants(db, assoc.id),
    D.countLeadsSince(db, assoc.id, 30),
  ]);
  const total = status ? null : stats.total;
  const leads = await D.listLeads(db, assoc.id, { status, limit: LEAD_PER_PAGE, offset: (page - 1) * LEAD_PER_PAGE });
  const pages = total != null ? Math.max(1, Math.ceil(total / LEAD_PER_PAGE)) : (leads.length === LEAD_PER_PAGE ? page + 1 : page);
  const rate = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "-");

  const tab = (v, label, n) => `<a class="pill${status === v ? " pill-on" : ""}" href="${base}/admin/leads${v ? `?status=${v}` : ""}">${esc(label)}${n != null ? ` <b>${n}</b>` : ""}</a>`;
  const srcLabel = (l) => {
    const parts = [l.utm_source && `${l.utm_source}${l.utm_medium ? `/${l.utm_medium}` : ""}`, l.utm_campaign].filter(Boolean);
    if (parts.length) return `<b>${esc(parts.join(" · "))}</b>`;
    if (l.referrer) { try { return esc(new URL(l.referrer).hostname); } catch { return esc(clip(l.referrer, 30)); } }
    return "직접·기타";
  };
  const rows = leads.length ? leads.map((l) => `<tr>
    <td><time>${esc(kstStamp(l.created_at, { year: false }))}</time>${l.variant ? `<br /><small class="badge badge-muted">${esc(l.variant)}</small>` : ""}</td>
    <td><strong>${esc(l.name)}</strong>${l.agree_marketing ? ` <span class="badge badge-muted">수신동의</span>` : ""}
      ${extraSummary(l)}
      ${l.message ? `<details class="lead-msg"><summary>문의 내용</summary><p>${esc(l.message)}</p></details>` : ""}</td>
    <td>${l.phone ? `<a href="tel:${esc(l.phone)}">${esc(l.phone)}</a>` : "-"}</td>
    <td>${esc(l.region || "-")}<br /><small>${esc(l.budget || "")}</small></td>
    <td>${srcLabel(l)}${l.funnel ? `<br /><small>신고: ${esc(l.funnel)}</small>` : ""}</td>
    <td><span class="badge ${LEAD_BADGE[l.status] || "badge-muted"}">${esc(D.LEAD_STATUS_LABEL[l.status] || l.status)}</span>
      <form method="post" action="${base}/admin/leads/${l.id}/status" class="inline-form">
        <select name="status" data-autosubmit aria-label="${esc(l.name)} 상담 상태">${D.LEAD_STATUSES.map((s) => `<option value="${s}"${s === l.status ? " selected" : ""}>${esc(D.LEAD_STATUS_LABEL[s])}</option>`).join("")}</select>
        <button class="btn btn-xs btn-ghost">변경</button></form></td>
    <td><form method="post" action="${base}/admin/leads/${l.id}/memo" class="inline-form">
        <input type="text" name="memo" value="${esc(l.memo || "")}" maxlength="500" placeholder="상담 메모" aria-label="${esc(l.name)} 상담 메모" />
        <button class="btn btn-xs btn-ghost">저장</button></form>
      <span class="pill-row">
        <a class="btn btn-xs btn-ghost" href="${base}/admin/templates?lead=${l.id}">계약서 만들기</a>
        <form method="post" action="${base}/admin/leads/${l.id}/delete" class="inline-form" data-confirm="이 신청 건을 지울까요?&#10;개인정보는 복구할 수 없습니다."><button class="link-danger">삭제</button></form></span></td>
  </tr>`).join("") : `<tr><td colspan="7" class="empty">${status ? "해당 상태의 신청이 없습니다." : "아직 신청이 없습니다. 랜딩페이지를 알리면 여기에 쌓입니다."}</td></tr>`;

  const funnelRows = funnels.length
    ? funnels.map((f) => `<li><span>${esc(f.funnel)}</span><b>${f.n}건</b></li>`).join("")
    : `<li class="empty">집계할 기록이 없습니다.</li>`;
  const utmRows = utms.length
    ? utms.map((u) => `<li><span>${esc(u.source)}${u.campaign ? ` · ${esc(u.campaign)}` : ""}</span><b>${u.n}건</b></li>`).join("")
    : `<li class="empty">아직 광고 주소로 들어온 신청이 없습니다.</li>`;
  // 사본별 전환율 — 어느 문구가 실제로 신청을 만들었는지
  const leadByV = new Map(byVariant.map((r) => [r.variant, r.n]));
  const viewByV = new Map(viewsByVariant.map((r) => [r.variant, r.n]));
  const callByV = new Map(viewsByVariant.map((r) => [r.variant, r.calls || 0]));
  const variantRows = [{ slug: "", name: "기본 랜딩" }, ...variants.map((v) => ({ slug: v.slug, name: v.name || v.slug }))]
    .map((v) => {
      const n = leadByV.get(v.slug) || 0, w = viewByV.get(v.slug) || 0, c = callByV.get(v.slug) || 0;
      const thin = w < 100; // 표본이 얇으면 전환율은 우연이다
      return `<tr><td>${esc(v.name)}${v.slug ? `<br /><small>/l/${esc(v.slug)}</small>` : ""}</td>
        <td>${w.toLocaleString()}</td><td>${n.toLocaleString()}</td><td>${c.toLocaleString()}</td>
        <td><b>${rate(n + c, w)}</b>${thin ? ` <small class="thin-warn" title="방문 100회 미만입니다. 우연히 높거나 낮게 나올 수 있어 아직 비교하지 마세요.">표본 부족</small>` : ""}</td></tr>`;
    }).join("");

  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">상담 신청 · ${esc(assoc.name)}</p><h1 class="dash-title">가맹 상담 DB</h1>
      <p class="dash-sub">랜딩페이지로 들어온 상담 신청입니다. 연락 결과를 상태로 남기면 어디까지 진행됐는지 한눈에 보입니다.</p></div>
      <div class="dash-head-actions"><a href="${base}/admin/leads.csv" class="btn btn-ghost btn-sm">CSV 내려받기</a>
        <a href="${base}/admin/landing" class="btn btn-primary btn-sm">랜딩 편집</a></div></div>
    ${flashOf(query)}
    <div class="stat-cards">
      <div class="stat-card"><span class="stat-num">${stats.total}</span><span class="stat-label">전체 신청</span></div>
      <div class="stat-card${stats.fresh ? " stat-alert" : ""}"><span class="stat-num">${stats.fresh}</span><span class="stat-label">미처리(신규)</span></div>
      <div class="stat-card"><span class="stat-num">${stats.today}</span><span class="stat-label">오늘</span></div>
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">30일 전환율</span></div><span class="stat-num">${rate(since30 + calls, views)}</span>
        <div class="stat-delta mut">방문 ${views.toLocaleString()} · 신청 ${since30.toLocaleString()} · 전화 ${calls.toLocaleString()}</div></div>
      <div class="stat-card"><span class="stat-num">${stats.contract}</span><span class="stat-label">계약 성사</span></div>
    </div>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">신청 목록 <span class="badge badge-muted">${leads.length}건</span></h2>
      <span class="pill-row">${tab("", "전체", stats.total)}${D.LEAD_STATUSES.map((s) => tab(s, D.LEAD_STATUS_LABEL[s])).join("")}</span></div>
      <div class="table-scroll"><table class="admin-table lead-table"><thead><tr>
        <th>신청 시각</th><th>성함</th><th>연락처</th><th>지역 · 예산</th><th>유입</th><th>상태</th><th>메모 · 처리</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${pager((p) => `${base}/admin/leads${qs({ status, page: p })}`, page, pages)}
      <p class="panel-hint">연락처는 개인정보입니다. 상담이 끝난 건은 보관 기간이 지나면 자동으로 지워집니다 —
        기간은 <a href="${base}/admin/landing">랜딩 편집</a> 화면에서 바꿉니다.</p></section>
    <div class="dash-grid">
      <section class="panel"><h2 class="panel-title">광고 출처 <small>(최근 30일)</small></h2>
        <p class="panel-hint">링크에 <code>?utm_source=naver&amp;utm_campaign=봄모집</code> 처럼 붙여 두면 어느 광고가 신청을 만들었는지 그대로 쌓입니다.</p>
        <ul class="funnel-list">${utmRows}</ul></section>
      <section class="panel"><h2 class="panel-title">유입 경로 <small>(신청자 자기신고)</small></h2>
        <p class="panel-hint">신청자가 직접 고른 값이라 참고용입니다. 정확한 판단은 위의 광고 출처로 하세요.</p>
        <ul class="funnel-list">${funnelRows}</ul></section>
    </div>
    <section class="panel"><h2 class="panel-title">랜딩별 성과 <small>(최근 30일)</small></h2>
      <p class="panel-hint">전환율은 <b>신청 + 전화</b>를 방문으로 나눈 값입니다. 모바일에서는 폼을 채우기보다 그냥 거는 사람이 많아,
        전화를 빼고 보면 실제보다 낮게 나옵니다. 방문 100회가 넘기 전에는 사본끼리 비교하지 마세요.</p>
      <div class="table-scroll"><table class="admin-table"><thead><tr><th>랜딩</th><th>방문</th><th>신청</th><th>전화</th><th>전환율</th></tr></thead>
        <tbody>${variantRows}</tbody></table></div></section>
  </div></section>`;
  return html(layout({ title: "가맹 상담 DB", assoc, base, user, body, csrf }));
}

export async function adminLeadsCsv(ctx) {
  const { db, assoc } = ctx;
  const leads = await D.listLeads(db, assoc.id, { limit: 5000 });
  // 추가 질문은 조직마다 다르다 — 실제로 답이 들어온 질문만 열로 편다
  const extraKeys = [...new Set(leads.flatMap((l) => Object.keys(parseExtra(l))))].slice(0, 12);
  const rows = [["신청시각", "성함", "연락처", "이메일", "희망지역", "창업예산", ...extraKeys, "유입경로", "광고출처", "매체", "캠페인", "유입페이지", "랜딩", "문의내용", "상태", "메모", "마케팅수신"],
    ...leads.map((l) => { const ex = parseExtra(l);
      return [kstStamp(l.created_at), l.name, l.phone, l.email, l.region, l.budget, ...extraKeys.map((k) => ex[k] || ""), l.funnel,
        l.utm_source, l.utm_medium, l.utm_campaign, l.referrer, l.variant || "기본", l.message,
        D.LEAD_STATUS_LABEL[l.status] || l.status, l.memo, l.agree_marketing ? "동의" : ""]; })];
  const csv = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  return text(csv, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="leads_${assoc.slug}.csv"`, "cache-control": "no-store" });
}
export async function businesses(ctx) {
  const { db, assoc, base, user, query, csrf } = ctx;
  const cat = query.get("category"), q = (query.get("q") || "").trim().slice(0, 60);
  const openOnly = query.get("open") === "1";
  const page = parseInt(query.get("page") || "1", 10) || 1;
  // A/B — 손님이 실제로 '찾는' 행동을 했을 때만 센다. 목록을 그냥 연 것은 찾기가 아니다.
  if (q || cat || openOnly) await countHomeGoal(ctx, "find");
  // "지금 영업중" 필터: 영업시간 문자열 기반이라 서버에서 계산 — 페이지네이션 대신 넉넉히 가져와 거른다
  let { items, total, page: cur, pages } = await D.listBusinessesPaged(db, assoc.id, { category: cat, q, page: openOnly ? 1 : page, perPage: openOnly ? 1000 : 12 }); // open 필터는 서버 계산이라 넉넉히 (1000곳 초과 상권은 현실적으로 없음)
  if (openOnly) { items = items.filter((b) => openNow(b.hours) === true && !D.isDayOff(b)); total = items.length; cur = 1; pages = 1; }
  const cats = await D.distinctCategories(db, assoc.id);
  const chips = `<a href="${base}/businesses${qs({ q })}" class="chip-filter${!cat && !openOnly ? " active" : ""}">전체</a>` +
    `<a href="${base}/businesses${qs({ q, open: "1" })}" class="chip-filter chip-open${openOnly ? " active" : ""}">지금 문 연 곳</a>` +
    `<button type="button" class="chip-filter chip-fav" id="favFilter" hidden>찜한 가게</button>` +
    cats.map((c) => `<a href="${base}/businesses${qs({ category: c.category, q })}" class="chip-filter${cat === c.category ? " active" : ""}">${esc(c.category)} <em>${c.n}</em></a>`).join("");
  const covers = await D.coverImagesFor(db, items.map((b) => b.id));
  const cards = items.map((b) => businessCard(base, b, covers.get(b.id))).join("") || `<p class="empty">${openOnly ? "지금 문 연 가게가 없습니다." : q ? "검색 결과가 없습니다." : "등록된 점포가 없습니다."}</p>`;
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><h1 class="section-title">가입 점포 안내</h1><p class="section-lead">총 ${total}곳</p></div>
    <form method="get" action="${base}/businesses" class="board-search"><input type="search" name="q" value="${esc(q)}" placeholder="점포·업종 검색" aria-label="점포·업종 검색" /><button class="btn btn-ghost btn-sm">검색</button></form>
    <div class="chip-filters">${chips}</div>
    <!-- 눈에는 안 보이지만 읽어 주는 프로그램에는 들리는 제목.
         페이지 제목(h1) 다음에 가게 이름(h3)이 바로 오면 단계를 하나 건너뛴 것이 되어,
         목차만 훑어 내려가는 이용자가 "여기부터 목록" 이라는 신호를 못 받습니다. -->
    <h2 class="a11y-only">점포 목록</h2>
    <div class="market-grid" id="bizGrid">${cards}</div>
    ${openOnly ? "" : pager((i) => `${base}/businesses${qs({ category: cat, q, page: i })}`, cur, pages)}
  </div></section>`;
  // 구조화 데이터: 점포 목록(ItemList) + 빵부스러기 → 검색엔진이 디렉터리 구조·구성원 인식
  const startPos = openOnly ? 0 : (cur - 1) * 12;
  const listLd = {
    "@context": "https://schema.org", "@type": "ItemList",
    itemListElement: items.map((b, i) => ({ "@type": "ListItem", position: startPos + i + 1, url: `${ORIGIN}${base}/business/${encodeURIComponent(b.slug)}`, name: b.name })),
  };
  const crumbLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: assoc.name, item: `${ORIGIN}${base}/` },
      { "@type": "ListItem", position: 2, name: "가입 점포", item: `${ORIGIN}${base}/businesses` },
    ],
  };
  const desc = `${assoc.name} 가입 점포 ${total}곳${cat ? ` · ${cat}` : ""} — 우리 동네 상권을 업종별로 한눈에.`;
  return html(layout({ title: cat ? `가입 점포 · ${cat}` : "가입 점포", assoc, base, user, body, activeNav: `${base}/businesses`, csrf, description: desc, jsonLd: [listLd, crumbLd], scripts: `<script src="${assetUrl("/js/fav.js")}" defer></script>` }));
}

export async function businessDetail(ctx) {
  const { db, env, assoc, base, user, params, csrf } = ctx;
  // A/B — 이 방문이 어느 홈 사본에서 시작됐는지 세어 둔다. "그 홈이 가게를 보게 만드는가".
  await countHomeGoal(ctx, "bizview");
  const b = await D.getBusinessBySlug(db, assoc.id, params.slug);
  const canSee = b && (b.status === "approved" || (user && (user.id === b.owner_id || user.role === "SUPERADMIN" || (user.role === "ADMIN" && user.association_id === assoc.id))));
  if (!canSee) return notFoundResponse(ctx);
  const [media, prods, coupons, updates, others] = await Promise.all([
    D.listMedia(db, b.id), D.listProducts(db, b.id), D.listActiveCoupons(db, b.id), D.listUpdates(db, b.id, 5),
    D.listSameCategory(db, assoc.id, b.category, b.id, 3), // 같은 업종 추천 (상권 내 순환)
  ]);
  const otherCovers = others.length ? await D.coverImagesFor(db, others.map((x) => x.id)) : new Map();
  const images = media.filter((m) => m.kind === "image");
  const vids = media.filter((m) => m.kind === "video" || m.kind === "embed");
  const gallery = (arr) => arr.length ? `<div class="gallery">${arr.map((m) => galleryItem(m)).join("")}</div>` : "";
  const productGrid = prods.length ? `<h2 class="biz-section-title">제품·메뉴</h2>
    <div class="product-grid">${prods.map((p) => `<figure class="product-card${p.sold_out ? " is-sold" : ""}">
      <div class="product-photo">${p.image ? `<img src="${esc(mediaUrl(p.image))}" alt="${esc(p.name)}" loading="lazy" />` : `<span class="product-noimg">${TAG_SVG}</span>`}${p.sold_out ? `<span class="product-sold">품절</span>` : ""}</div>
      <figcaption><div class="product-caption-top"><strong class="product-name">${esc(p.name)}</strong>${p.price ? `<span class="product-price">${esc(p.price)}</span>` : ""}</div>${p.description ? `<p class="product-desc">${esc(p.description)}</p>` : ""}</figcaption>
    </figure>`).join("")}</div>` : "";
  const pending = b.status !== "approved" ? `<div class="flash flash-warn">이 페이지는 ${statusBadge(b.status)} 상태입니다.</div>` : "";
  // 가게 소식 (한 줄 피드)
  const updateFeed = updates.length ? `<h2 class="biz-section-title">가게 소식</h2>
    <ul class="update-feed">${updates.map((u) => `<li class="update-item">
      ${u.image ? `<img class="update-img" src="${esc(mediaUrl(u.image))}" alt="" loading="lazy" />` : ""}
      <div class="update-body"><p>${esc(u.body)}</p><time>${esc(kstDate(u.created_at, "."))}</time></div></li>`).join("")}</ul>` : "";
  // 이런 가게는 어때요 (같은 업종)
  const recommend = others.length ? `<h2 class="biz-section-title">이런 가게는 어때요</h2>
    <div class="market-grid recommend-grid">${others.map((x) => businessCard(base, x, otherCovers.get(x.id))).join("")}</div>` : "";
  // 쿠폰: 매장에서 화면 제시 방식 (결제·발급 없음)
  const couponSection = coupons.length ? `<h2 class="biz-section-title">쿠폰·혜택</h2>
    <div class="coupon-grid">${coupons.map((c) => `<div class="coupon-card">
      <span class="coupon-punch" aria-hidden="true"></span>
      <strong class="coupon-title">${esc(c.title)}</strong>
      ${c.terms ? `<span class="coupon-terms">${esc(c.terms)}</span>` : ""}
      <span class="coupon-meta">${c.valid_until ? `${esc(c.valid_until.replace(/-/g, "."))}까지` : "기한 없음"} · 매장에서 이 화면을 보여주세요</span>
    </div>`).join("")}</div>` : "";
  // 오시는 길: 좌표가 있으면 미니 지도 (브랜드 핀 재사용)
  const naverKey = assoc.map_client_id || env.NAVER_MAP_CLIENT_ID;
  const hasGeo = b.lat != null && b.lng != null && naverKey;
  // 네이버 플레이스 링크가 있으면 검색 대신 그 가게 페이지로 직행 (리뷰·길찾기 정확)
  const naverLink = b.sns_naver || `https://map.naver.com/p/search/${encodeURIComponent(b.address || b.name)}`;
  const wayToCome = b.lat != null && b.lng != null ? `<h2 class="biz-section-title">오시는 길</h2>
    ${hasGeo ? `<div id="bizMap" class="biz-map" data-lat="${b.lat}" data-lng="${b.lng}" data-name="${esc(b.name)}"></div>` : ""}
    <p class="biz-way">${b.address ? `${PIN_SVG} ${esc(b.address)} · ` : ""}<a href="${esc(naverLink)}" target="_blank" rel="noopener">네이버 지도에서 길찾기 →</a></p>` : "";
  // 대표 사진 — 맨 앞 사진 한 장을 이름 위에 크게. 없으면 이 자리가 아예 없다.
  // 회색 상자를 남기면 '아직 아무것도 없는 가게' 라고 먼저 말하는 셈이다.
  const coverShot = images[0]
    ? `<span class="biz-cover"><img src="${esc(mediaUrl(images[0].filename))}" alt="${esc(b.name)} 대표 사진" /></span>`
    : "";
  const body = `
  <section class="biz-hero"><div class="container biz-hero-inner">${pending}
    <div class="biz-hero-lead">
      ${coverShot}
      <span class="chip chip-light">${esc(b.category)}</span>${bizStatusBadge(b)}<h1>${esc(b.name)}</h1>
      <p class="biz-desc">${esc(b.description || "소개가 곧 등록됩니다.")}</p>
      <div class="biz-actions">
        <button type="button" class="btn btn-share" data-share data-share-title="${esc(b.name)} — ${esc(assoc.name)}">${SHARE_SVG} 가게 공유하기</button>
        ${snsButtons(b)}
      </div>
    </div>
    <aside class="biz-panel">
      <ul class="biz-contact">
        ${b.address ? `<li>${PIN_SVG}<span class="bc-label">주소</span><span class="bc-val">${esc(b.address)}</span></li>` : ""}${b.phone ? `<li>${PHONE_SVG}<span class="bc-label">전화</span><a class="bc-val" href="tel:${esc(b.phone)}">${esc(b.phone)}</a></li>` : ""}${b.hours ? `<li>${CLOCK_SVG}<span class="bc-label">영업시간</span><span class="bc-val">${esc(b.hours)}</span></li>` : ""}
      </ul>
      <div class="biz-panel-actions">
        ${b.phone ? `<a class="btn btn-primary btn-block" href="tel:${esc(b.phone)}">전화 걸기</a>` : ""}
        ${b.address || b.lat != null ? `<a class="btn btn-ghost btn-block" href="${esc(b.sns_naver || `https://map.naver.com/p/search/${encodeURIComponent(b.address || b.name)}`)}" target="_blank" rel="noopener">길찾기</a>` : ""}
      </div>
    </aside></div></section>
  <section class="section"><div class="container">
    ${updateFeed}
    ${couponSection}
    ${productGrid}
    ${images.length ? `<h2 class="biz-section-title">사진</h2>${gallery(images)}` : ""}
    ${vids.length ? `<h2 class="biz-section-title">영상</h2>${gallery(vids)}` : ""}
    ${!media.length && !prods.length ? `<p class="empty">아직 등록된 제품·사진이 없습니다.</p>` : ""}
    ${wayToCome}
    ${recommend}
    <div class="section-more"><a href="${base}/businesses" class="btn btn-ghost btn-sm">← 다른 점포 보기</a></div>
  </div></section>`;
  const cover = images[0] || null; // 카톡 공유 미리보기용 대표 사진
  // 검색엔진 구조화 데이터: 네이버·구글이 가게 정보(주소·전화·좌표)를 리치 결과로 노출
  const pageUrl = `${ORIGIN}${base}/business/${encodeURIComponent(b.slug)}`;
  const coverUrl = cover ? mediaUrl(cover.thumb || cover.filename) : "";
  const ld = [{
    "@context": "https://schema.org", "@type": "LocalBusiness",
    name: b.name, url: pageUrl,
    ...(b.description ? { description: b.description } : {}),
    ...(b.phone ? { telephone: b.phone } : {}),
    ...(b.address ? { address: { "@type": "PostalAddress", streetAddress: b.address, addressCountry: "KR" } } : {}),
    ...(b.lat != null && b.lng != null ? { geo: { "@type": "GeoCoordinates", latitude: b.lat, longitude: b.lng } } : {}),
    ...(b.hours ? { openingHours: b.hours } : {}),
    ...(coverUrl ? { image: /^https?:\/\//.test(coverUrl) ? coverUrl : ORIGIN + coverUrl } : {}),
    // sameAs: 네이버 플레이스·SNS — 검색엔진이 동일 가게임을 인식 (지역 검색 신뢰도)
    ...((() => { const s = [b.sns_naver, b.sns_instagram, b.sns_youtube, b.sns_blog, b.sns_kakao].filter(Boolean); return s.length ? { sameAs: s } : {}; })()),
    parentOrganization: { "@type": "Organization", name: assoc.name, url: `${ORIGIN}${base}/` },
  }, {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: assoc.name, item: `${ORIGIN}${base}/` },
      { "@type": "ListItem", position: 2, name: "가입 점포", item: `${ORIGIN}${base}/businesses` },
      { "@type": "ListItem", position: 3, name: b.name, item: pageUrl },
    ],
  }];
  return html(layout({ title: b.name, assoc, base, user, body, activeNav: `${base}/businesses`, csrf,
    description: clip(b.description) || `${assoc.name} · ${b.category} · ${b.name}`,
    ogImage: cover ? (cover.thumb || cover.filename) : "",
    jsonLd: ld,
    scripts: `${media.length ? `<script src="${assetUrl("/js/viewer.js")}" defer></script>` : ""}<script src="${assetUrl("/js/share.js")}" defer></script>${hasGeo ? `<script src="https://oapi.map.naver.com/openapi/v3/maps.js?${esc(env.NAVER_MAP_PARAM || "ncpClientId")}=${esc(naverKey)}"></script><script src="${assetUrl("/js/map.js")}" defer></script>` : ""}` }));
}

export function loginForm(ctx) {
  const { env, query, csrf, assoc } = ctx;
  // 전자계약만 쓰는 조직·플랫폼 전역에서 "상인회 회원 로그인"은 남의 옷이다
  const esign = assoc && assoc.kind === "esign";
  const sub = esign ? "계약서를 만들고 보내는 분들의 로그인" : assoc ? "상인회 회원·관리자 로그인" : "로그인 후 이용하실 수 있습니다";
  // 서명 링크를 눌렀다가 로그인 화면으로 온 사람은, 로그인이 끝나면 그 문서로 돌아가야 한다
  const nextTo = safeNext(query.get("next") || "");
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    ${authHead("로그인", sub)}
    ${flash(query.get("msg") || "", query.get("err") ? "err" : "ok")}
    <form method="post" action="/login" class="stack-form">
      ${nextTo ? `<input type="hidden" name="next" value="${esc(nextTo)}" />` : ""}
      <label>이메일<input type="email" name="email" required autocomplete="email" /></label>
      <label>비밀번호<input type="password" name="password" required autocomplete="current-password" /></label>
      <details class="totp-login"><summary>2단계 인증을 쓰고 계신가요?</summary>
        <label>인증 앱의 6자리 코드<input type="text" name="totp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" placeholder="000000" /></label></details>
      ${turnstileWidget(env)}
      <button class="btn btn-primary btn-block">로그인</button>
    </form>
    <p class="auth-note"><a href="/forgot">비밀번호를 잊으셨나요?</a></p>
    ${assoc ? "" : `<p class="auth-note">계정이 없으신가요? <a href="/esign/signup">전자계약 시작하기</a></p>`}
    </div></div></section>`;
  return html(layout({ title: "로그인", assoc: ctx.assoc, base: ctx.base, body, csrf, scripts: turnstileScript(env) }));
}

const flashOf = (q) => flash(q.get("msg") || "", q.get("err") ? "err" : "ok");
// '2026.09.21 (월)' — 티켓 카드 머리띠의 날짜 표기 (레퍼런스와 같은 꼴)
const DOW = "일월화수목금토";
export function ymdDow(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  if (!m) return String(ymd || "");
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${m[1]}.${m[2]}.${m[3]} (${DOW[d.getUTCDay()]})`;
}
// 'N일 남음' · '오늘까지' · 'N일 지남' — 기한을 오늘과 견줘 사람 말로
export function daysLeftText(due, today) {
  const a = Date.parse(String(due).slice(0, 10) + "T00:00:00Z"), b = Date.parse(String(today).slice(0, 10) + "T00:00:00Z");
  if (!(a >= 0) || !(b >= 0)) return "";
  const n = Math.round((a - b) / 86400000);
  return n > 0 ? `${n}일 남음` : n === 0 ? "오늘까지" : `${-n}일 지남`;
} // get() 이 이미 디코드 — 이중 디코드는 %25 등에서 URIError
// 디자인 v2: 인증 카드 브랜드 아이콘 헤더
const authHead = (title, sub) => `<div class="auth-head"><span class="mark auth-mark">${STOREFRONT_SVG}</span><h1 class="auth-title">${esc(title)}</h1><p class="auth-sub">${esc(sub)}</p></div>`;

// ================= 점포 지도 =================
export async function mapPage(ctx) {
  const { db, env, assoc, base, user, query, csrf } = ctx;
  await countHomeGoal(ctx, "find"); // 지도를 여는 것 자체가 '가까운 가게 찾기' 다
  const cat = query.get("category");
  let markers = await D.listBusinessMarkers(db, assoc.id);
  if (cat) markers = markers.filter((m) => m.category === cat);
  const cats = await D.distinctCategories(db, assoc.id);
  const naver = assoc.map_client_id || env.NAVER_MAP_CLIENT_ID; // 상인회 전용 지도 키 우선
  const chips = `<a href="${base}/map" class="chip-filter${!cat ? " active" : ""}">전체</a>` +
    cats.map((c) => `<a href="${base}/map?category=${encodeURIComponent(c.category)}" class="chip-filter${cat === c.category ? " active" : ""}">${esc(c.category)}</a>`).join("");
  const listRows = markers.length ? markers.map((m) => `<li class="map-store" data-lat="${m.lat}" data-lng="${m.lng}">
      <a href="${base}/business/${esc(m.slug)}" class="map-store-name">${esc(m.name)}</a><span class="chip">${esc(m.category)}</span>
      ${m.address ? `<span class="map-store-addr">${PIN_SVG} ${esc(m.address)}</span>` : ""}
      <a class="map-store-link" href="${esc(m.sns_naver || `https://map.naver.com/p/search/${encodeURIComponent(m.address || m.name)}`)}" target="_blank" rel="noopener">네이버 지도에서 열기 →</a></li>`).join("")
    : `<li class="empty">지도에 표시할 좌표가 등록된 점포가 없습니다.</li>`;
  const mapEl = naver
    ? `<div id="storeMap" class="store-map" data-center-lat="${assoc.map_lat}" data-center-lng="${assoc.map_lng}" data-zoom="${assoc.map_zoom}" data-base="${esc(base)}"></div>`
    : `<div class="map-fallback"><span class="mf-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg></span><p>인터랙티브 지도는 관리자가 네이버 지도 키를 설정하면 표시됩니다. 아래 목록에서 각 점포의 네이버 지도를 열 수 있습니다.</p></div>`;
  const loader = naver ? `<script src="https://oapi.map.naver.com/openapi/v3/maps.js?${esc(env.NAVER_MAP_PARAM || "ncpClientId")}=${esc(naver)}"></script><script src="${assetUrl("/js/map.js")}" defer></script>` : "";
  const markerData = markers.map((m) => ({ name: m.name, slug: m.slug, category: m.category, lat: m.lat, lng: m.lng, address: m.address || "", phone: m.phone || "" }));
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><h1 class="section-title">가입 점포 지도</h1><p class="section-lead">${esc(assoc.name)} 가입 점포 ${markers.length}곳</p></div>
    <div class="chip-filters">${chips}</div>${mapEl}
    <ul class="map-list">${listRows}</ul>
    <script type="application/json" id="mapData">${JSON.stringify(markerData).replace(/</g, "\\u003c")}</script>
  </div></section>`;
  return html(layout({ title: "점포 지도", assoc, base, user, body, activeNav: `${base}/map`, csrf, scripts: loader }));
}

// ================= 공지 =================
const SHARE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="2.6"/><circle cx="17.5" cy="5.5" r="2.6"/><circle cx="17.5" cy="18.5" r="2.6"/><path d="M8.4 10.8l6.8-4M8.4 13.2l6.8 4"/></svg>';
const CHEV_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
const BELL_SVG = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg>';
const SEND_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
const DOC_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg>';
const noticeIco = (n) => n.pinned ? BELL_SVG : (/모집|참여|이벤트/.test(n.tag) ? SEND_SVG : DOC_SVG);
function noticeRows(base, list) {
  return list.length ? list.map((n) => `<li><a href="${base}/notices/${n.id}">
    ${n.image ? `<img class="notice-ico notice-thumb-img" src="${esc(mediaUrl(n.image))}" alt="" loading="lazy" />` : `<span class="notice-ico${n.pinned ? " is-pinned" : ""}${/모집|참여|이벤트/.test(n.tag) ? " is-recruit" : ""}">${noticeIco(n)}</span>`}
    <span class="notice-main">
      <span class="notice-title">${n.pinned ? '<em class="pin-mini">고정</em>' : ""}${esc(n.title)}</span>
      <span class="notice-meta">${esc(n.tag)} · ${esc(kstDate(n.created_at, "."))}</span>
    </span>
    <span class="notice-chev">${CHEV_SVG}</span></a></li>`).join("")
    : `<li class="empty">등록된 공지가 없습니다.</li>`;
}
// 공지 RSS 피드 — 구독기·네이버 수집용 (layout 의 rel=alternate 로 자동 발견)
export async function noticesFeed(ctx) {
  const { db, assoc, base } = ctx;
  const items = await D.listNotices(db, assoc.id, 20);
  const x = (s) => String(s == null ? "" : s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
  const link = ORIGIN + base;
  const rfc822 = (t) => new Date(String(t).replace(" ", "T") + "Z").toUTCString();
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${x(assoc.name)} 공지·소식</title>
<link>${x(link + "/notices")}</link>
<description>${x(assoc.tagline || assoc.name + " 공지사항")}</description>
<language>ko</language>
${items.map((n) => `<item><title>${x(n.title)}</title><link>${x(`${link}/notices/${n.id}`)}</link><guid isPermaLink="true">${x(`${link}/notices/${n.id}`)}</guid><pubDate>${rfc822(n.created_at)}</pubDate><category>${x(n.tag)}</category><description>${x(clip(n.body, 300))}</description></item>`).join("\n")}
</channel></rss>`;
  return new Response(rss, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=600" } });
}
export async function notices(ctx) {
  const { db, assoc, base, user, query, csrf } = ctx;
  const page = parseInt(query.get("page") || "1", 10) || 1;
  const q = (query.get("q") || "").trim().slice(0, 60), tag = (query.get("tag") || "").trim().slice(0, 20);
  const { items, total, page: cur, pages } = await D.listNoticesPaged(db, assoc.id, { page, q: q || null, tag: tag || null });
  const tags = await D.distinctNoticeTags(db, assoc.id);
  const chips = `<a href="${base}/notices${qs({ q })}" class="chip-filter${!tag ? " active" : ""}">전체</a>` +
    tags.map((t) => `<a href="${base}/notices${qs({ tag: t.tag, q })}" class="chip-filter${tag === t.tag ? " active" : ""}">${esc(t.tag)} <em>${t.n}</em></a>`).join("");
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><h1 class="section-title">공지사항</h1><p class="section-lead">총 ${total}건</p></div>
    <form method="get" action="${base}/notices" class="board-search">${tag ? `<input type="hidden" name="tag" value="${esc(tag)}">` : ""}<input type="search" name="q" value="${esc(q)}" placeholder="제목·내용 검색" aria-label="공지 제목·내용 검색"><button class="btn btn-ghost btn-sm">검색</button></form>
    ${tags.length > 1 ? `<div class="chip-filters">${chips}</div>` : ""}
    <ul class="notice-list">${items.length ? noticeRows(base, items) : `<li class="empty">${q || tag ? "조건에 맞는 공지가 없습니다." : "등록된 공지가 없습니다."}</li>`}</ul>
    ${pager((i) => `${base}/notices${qs({ q, tag, page: i })}`, cur, pages)}
  </div></section>`;
  return html(layout({ title: "공지사항", assoc, base, user, body, activeNav: `${base}/notices`, csrf,
    description: `${assoc.name} 공지사항 — 안내·행사·혜택 등 우리 동네 상권 소식 ${total}건.` }));
}
export async function noticeDetail(ctx) {
  const { db, assoc, base, user, params, csrf } = ctx;
  const n = await D.getNotice(db, Number(params.id));
  if (!n || n.association_id !== assoc.id) return notFoundResponse(ctx);
  const body = `<section class="section page-top"><div class="container narrow">
    <a href="${base}/notices" class="back-link">← 공지 목록</a>
    <div class="article-head"><span class="notice-tag${n.pinned ? " tag-important" : ""}">${esc(n.tag)}</span><time>${esc(kstDate(n.created_at, "."))}</time></div>
    <h1 class="article-title">${esc(n.title)}</h1>
    ${n.image ? `<img class="article-image" src="${esc(mediaUrl(n.image))}" alt="${esc(n.title)}" />` : ""}
    <div class="article-body">${esc(n.body).replace(/\n/g, "<br />")}</div>
    <div class="article-actions"><button type="button" class="btn btn-share" data-share data-share-title="${esc(n.title)} — ${esc(assoc.name)}">${SHARE_SVG} 공지 공유하기</button></div></div></section>`;
  // 구조화 데이터: Article — 공지/소식 리치 결과(제목·발행일·발행처)
  const artLd = {
    "@context": "https://schema.org", "@type": "Article",
    headline: clip(n.title, 110) || n.title, datePublished: n.created_at.slice(0, 10),
    ...(n.image ? { image: /^https?:\/\//.test(mediaUrl(n.image)) ? mediaUrl(n.image) : ORIGIN + mediaUrl(n.image) } : {}),
    author: { "@type": "Organization", name: assoc.name },
    publisher: { "@type": "Organization", name: assoc.name, ...(assoc.logo ? { logo: { "@type": "ImageObject", url: /^https?:\/\//.test(mediaUrl(assoc.logo)) ? mediaUrl(assoc.logo) : ORIGIN + mediaUrl(assoc.logo) } } : {}) },
    mainEntityOfPage: `${ORIGIN}${base}/notices/${n.id}`,
  };
  return html(layout({ title: n.title, assoc, base, user, body, activeNav: `${base}/notices`, csrf, description: clip(n.body) || n.title, ogImage: n.image || "", jsonLd: artLd, scripts: `<script src="${assetUrl("/js/share.js")}" defer></script>` }));
}

// ================= 행사 =================
export async function events(ctx) {
  const { db, assoc, base, user, query, csrf } = ctx;
  const list = await D.listEvents(db, assoc.id);
  const isMember = !!user && (user.association_id === assoc.id || user.role === "SUPERADMIN");
  // 행사 수와 무관하게 1쿼리 (건별 카운트·내 신청 조회의 N+1 제거)
  const rsvpMap = new Map((await D.eventRsvpSummary(db, assoc.id, isMember ? user.id : 0)).map((r) => [r.event_id, r]));
  const cards = [];
  for (const e of list) {
    const count = rsvpMap.get(e.id)?.n || 0;
    const mine = isMember ? !!rsvpMap.get(e.id)?.mine : false;
    const rsvp = `<div class="event-rsvp">
      ${count ? `<span class="rsvp-count">참가 신청 ${count}곳</span>` : ""}
      ${isMember ? (mine
        ? `<form method="post" action="${base}/events/${e.id}/rsvp/cancel" class="inline-form"><button class="btn btn-xs btn-ghost">✓ 신청됨 (취소)</button></form>`
        : `<form method="post" action="${base}/events/${e.id}/rsvp" class="inline-form"><button class="btn btn-xs btn-primary">참가 신청</button></form>`) : ""}
    </div>`;
    cards.push(eventCard(base, e).replace("</article>", rsvp + "</article>"));
  }
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><h1 class="section-title">행사·소식</h1>
      ${isMember ? `<p class="section-lead">회원은 행사별로 참가 신청을 할 수 있습니다. 명단은 관리자에게 전달됩니다.</p>` : ""}</div>
    ${flashOf(query)}
    <h2 class="a11y-only">행사 목록</h2>
    <div class="event-grid">${cards.join("") || `<p class="empty">예정된 행사가 없습니다.</p>`}</div></div></section>`;
  // 구조화 데이터: Event — 구글/네이버 행사 리치 결과(날짜·장소·주최)
  const eventLd = list.map((e) => ({
    "@context": "https://schema.org", "@type": "Event",
    name: e.title, startDate: e.event_date,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...(e.place ? { location: { "@type": "Place", name: e.place, address: { "@type": "PostalAddress", streetAddress: e.place, addressCountry: "KR" } } } : {}),
    ...(e.description ? { description: e.description } : {}),
    ...(e.image ? { image: /^https?:\/\//.test(mediaUrl(e.image)) ? mediaUrl(e.image) : ORIGIN + mediaUrl(e.image) } : {}),
    organizer: { "@type": "Organization", name: assoc.name, url: `${ORIGIN}${base}/` },
  }));
  return html(layout({ title: "행사", assoc, base, user, body, activeNav: `${base}/notices`, csrf,
    description: `${assoc.name} 행사·이벤트 안내 — 골목축제·정기총회 등 우리 동네 소식.`,
    jsonLd: eventLd.length ? eventLd : null }));
}

// ================= 총회 안건 투표 =================
export async function polls(ctx) {
  const { db, assoc, base, user, query, csrf } = ctx;
  const list = await D.listPolls(db, assoc.id);
  const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";
  // 안건 수와 무관하게 2쿼리 (건별 결과·내 표 조회의 N+1 제거)
  const [resultsMap, votesMap] = await Promise.all([D.pollResultsBulk(db, assoc.id), D.userVotesBulk(db, assoc.id, user.id)]);
  const cards = [];
  for (const p of list) {
    const open = D.isPollOpen(p);
    const r = resultsMap.get(p.id) || { yes: 0, no: 0, abstain: 0, total: 0 };
    const mine = votesMap.get(p.id) || null;
    const pct = (n) => (r.total ? Math.round((n / r.total) * 100) : 0);
    const bar = (label, key, cls) => `<div class="poll-bar"><span class="pb-label">${label} <b>${r[key]}표</b></span>
      <span class="pb-track"><span class="pb-fill ${cls}" style="width:${pct(r[key])}%"></span></span><span class="pb-pct">${pct(r[key])}%</span></div>`;
    const voteBtns = open ? `<form method="post" action="${base}/polls/${p.id}/vote" class="poll-actions">
        ${[["yes", "찬성"], ["no", "반대"], ["abstain", "기권"]].map(([v, l]) =>
          `<button name="choice" value="${v}" class="btn btn-sm ${mine === v ? "btn-primary" : "btn-ghost"}">${l}${mine === v ? " ✓" : ""}</button>`).join("")}
      </form>${mine ? `<p class="panel-hint">내 투표: <b>${{ yes: "찬성", no: "반대", abstain: "기권" }[mine]}</b> — 마감 전까지 변경할 수 있습니다.</p>` : ""}` : "";
    cards.push(`<section class="panel poll-card${open ? "" : " is-closed"}">
      <div class="panel-head"><h2 class="panel-title">${esc(p.title)}</h2>
        <span class="badge ${open ? "badge-open" : "badge-muted"}">${open ? (p.closes_at ? `~${esc(p.closes_at)}` : "진행 중") : "마감"}</span></div>
      ${p.body ? `<p class="poll-body">${esc(p.body).replace(/\n/g, "<br />")}</p>` : ""}
      ${voteBtns}
      <div class="poll-results">${bar("찬성", "yes", "is-yes")}${bar("반대", "no", "is-no")}${bar("기권", "abstain", "is-abs")}
        <p class="panel-hint">총 ${r.total}명 참여</p></div>
      ${isAdmin && open ? `<form method="post" action="${base}/admin/polls/${p.id}/close" data-confirm="이 투표를 마감할까요? 마감 후에는 변경할 수 없습니다."><button class="btn btn-xs btn-ghost">투표 마감</button></form>` : ""}
    </section>`);
  }
  const createForm = isAdmin ? `<section class="panel panel-accent"><h2 class="panel-title">새 안건 올리기</h2>
    <form method="post" action="${base}/admin/polls" class="stack-form compact">
      <label>안건 제목<input name="title" required maxlength="200" placeholder="예: 가을 골목축제 공동 부스 운영 여부" /></label>
      <label>설명 (선택)<textarea name="body" rows="3" maxlength="2000"></textarea></label>
      <label>마감일 (선택·비우면 수동 마감)<input type="date" name="closes_at" /></label>
      <button class="btn btn-primary btn-sm">투표 시작</button></form></section>` : "";
  const body = `<section class="section page-top"><div class="container narrow">
    <div class="section-head"><h1 class="section-title">안건 투표</h1>
      <p class="section-lead">총회에 못 오셔도 폰에서 의견을 남길 수 있습니다. 1인 1표, 마감 전 변경 가능.</p></div>
    ${flashOf(query)}
    ${createForm}
    ${cards.join("") || `<p class="empty">진행 중인 안건이 없습니다.</p>`}
  </div></section>`;
  return html(layout({ title: "안건 투표", assoc, base, user, body, activeNav: `${base}/polls`, csrf }));
}

// ================= 회원 게시판 =================
export async function board(ctx) {
  const { db, assoc, base, user, query, csrf } = ctx;
  const page = parseInt(query.get("page") || "1", 10) || 1;
  const q = (query.get("q") || "").trim().slice(0, 60);
  const { items, total, page: cur, pages } = await D.listPostsPaged(db, assoc.id, { page, q: q || null });
  const rows = items.length ? items.map((p) => {
    const thumb = p.pi_thumb || p.pi_file || p.image;
    const cnt = (p.image_count || 0) + (p.image ? 1 : 0);
    return `<li class="board-row${p.pinned ? " pinned" : ""}">${p.pinned ? `<span class="board-pin">고정</span>` : ""}
      ${thumb ? `<a href="${base}/board/${p.id}" class="board-thumb"><img src="${esc(mediaUrl(thumb))}" alt="" loading="lazy" /></a>` : ""}
      <a href="${base}/board/${p.id}" class="board-title">${esc(p.title)}${cnt ? ` <span class="board-clip">사진 ${cnt}</span>` : ""}</a>
      <span class="board-meta">${esc(p.author_name || "(탈퇴)")} · ${esc(kstDate(p.created_at, "."))}${p.comment_count ? ` · 댓글 ${p.comment_count}` : ""}</span></li>`;
  }).join("") : `<li class="empty">${q ? "검색 결과가 없습니다." : "아직 게시글이 없습니다."}</li>`;
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><h1 class="section-title">회원 게시판</h1><p class="section-lead">글 ${total}개</p></div>
    ${flashOf(query)}
    <form method="get" action="${base}/board" class="board-search"><input type="search" name="q" value="${esc(q)}" placeholder="제목·내용 검색"><button class="btn btn-ghost btn-sm">검색</button></form>
    <section class="panel"><h2 class="panel-title">새 글 쓰기</h2>
      <form method="post" action="${base}/board" class="stack-form compact" enctype="multipart/form-data">
        <input type="text" name="title" placeholder="제목" required maxlength="200" />
        <textarea name="body" rows="4" placeholder="내용" required></textarea>
        <label class="file-inline">사진 첨부 <small>(선택 · 최대 6장)</small><input type="file" name="images" accept="image/*" multiple /><span class="fi-btn">사진 고르기<span class="fi-name"></span></span></label>
        <button class="btn btn-primary btn-sm">등록</button></form></section>
    <ul class="board-list">${rows}</ul>
    ${pager((i) => `${base}/board${qs({ q, page: i })}`, cur, pages)}</div></section>`;
  return html(layout({ title: "회원 게시판", assoc, base, user, body, activeNav: `${base}/board`, csrf, scripts: `<script src="${assetUrl("/js/upload-resize.js")}" defer></script><script src="${assetUrl("/js/file-preview.js")}" defer></script>` }));
}
export async function postDetail(ctx) {
  const { db, assoc, base, user, params, query, csrf } = ctx;
  const p = await D.getPost(db, Number(params.id));
  if (!p || p.association_id !== assoc.id) return notFoundResponse(ctx);
  const comments = await D.listComments(db, p.id);
  const imgs = await D.listPostImages(db, p.id);
  const mod = canModerate(user, assoc), isAuthor = user && p.author_id === user.id;
  const tiles = [...(p.image ? [{ filename: p.image, thumb: "" }] : []), ...imgs].map((im) => {
    const full = mediaUrl(im.filename), th = im.thumb ? mediaUrl(im.thumb) : full;
    return `<button type="button" class="gallery-item" data-src="${esc(full)}" data-kind="image" data-poster="" data-caption="" aria-label="사진"><img src="${esc(th)}" alt="" loading="lazy" /></button>`;
  }).join("");
  const cRows = comments.length ? comments.map((c) => `<li class="comment"><div class="comment-head"><strong>${esc(c.author_name || "(탈퇴)")}</strong>
      <time>${esc(kstStamp(c.created_at))}</time>
      ${(mod || (user && c.author_id === user.id)) ? `<form method="post" action="${base}/board/${p.id}/comment/${c.id}/delete" data-confirm="댓글 삭제?"><button class="link-danger">삭제</button></form>` : ""}</div>
      <div class="comment-body">${esc(c.body).replace(/\n/g, "<br />")}</div></li>`).join("") : `<li class="empty">첫 댓글을 남겨보세요.</li>`;
  const body = `<section class="section page-top"><div class="container narrow">
    <a href="${base}/board" class="back-link">← 게시판</a>
    <div class="article-head">${p.pinned ? `<span class="notice-tag tag-important">고정</span>` : ""}<time>${esc(kstStamp(p.created_at))}</time></div>
    <h1 class="article-title">${esc(p.title)}</h1>
    <p class="post-author">작성자: ${esc(p.author_name || "(탈퇴)")}${p.updated_at ? ` · <span class="post-edited">수정됨</span>` : ""}</p>
    <div class="article-body">${esc(p.body).replace(/\n/g, "<br />")}</div>
    ${tiles ? `<div class="gallery post-gallery">${tiles}</div>` : ""}
    <div class="post-actions">
      ${(mod || isAuthor) ? `<a href="${base}/board/${p.id}/edit" class="btn btn-ghost btn-xs">수정</a>` : ""}
      ${mod ? `<form method="post" action="${base}/board/${p.id}/pin"><button class="btn btn-ghost btn-xs">${p.pinned ? "고정 해제" : "상단 고정"}</button></form>` : ""}
      ${(mod || isAuthor) ? `<form method="post" action="${base}/board/${p.id}/delete" data-confirm="게시글 삭제?"><button class="btn btn-ghost btn-xs link-danger">삭제</button></form>` : ""}</div>
    <h2 class="biz-section-title" style="margin-top:32px">댓글 (${comments.length})</h2>
    <ul class="comment-list">${cRows}</ul>
    <form method="post" action="${base}/board/${p.id}/comment" class="stack-form compact comment-form"><textarea name="body" rows="3" placeholder="댓글" required maxlength="3000"></textarea><button class="btn btn-primary btn-sm">댓글 등록</button></form>
  </div></section>`;
  return html(layout({ title: p.title, assoc, base, user, body, activeNav: `${base}/board`, csrf, scripts: tiles ? `<script src="${assetUrl("/js/viewer.js")}" defer></script>` : "" }));
}
export async function editPost(ctx) {
  const { db, assoc, base, user, params, query, csrf } = ctx;
  const p = await D.getPost(db, Number(params.id));
  if (!p || p.association_id !== assoc.id) return notFoundResponse(ctx);
  if (!(canModerate(user, assoc) || (user && p.author_id === user.id))) return notFoundResponse(ctx);
  const imgs = await D.listPostImages(db, p.id);
  const existing = (imgs.length || p.image) ? `<div class="edit-images"><p class="mini-label">현재 사진 <small>(삭제할 사진 체크)</small></p><div class="edit-thumbs">
      ${p.image ? `<label class="edit-thumb"><img src="${esc(mediaUrl(p.image))}" alt="" /><span class="check"><input type="checkbox" name="remove_image" value="1" /> 삭제</span></label>` : ""}
      ${imgs.map((im) => `<label class="edit-thumb"><img src="${esc(mediaUrl(im.thumb || im.filename))}" alt="" /><span class="check"><input type="checkbox" name="del_${im.id}" value="1" /> 삭제</span></label>`).join("")}
    </div></div>` : "";
  const body = `<section class="section page-top"><div class="container narrow">
    <a href="${base}/board/${p.id}" class="back-link">← 게시글로</a><h1 class="article-title">글 수정</h1>${flashOf(query)}
    <form method="post" action="${base}/board/${p.id}/edit" class="stack-form" enctype="multipart/form-data">
      <label>제목<input type="text" name="title" value="${esc(p.title)}" required maxlength="200" /></label>
      <label>내용<textarea name="body" rows="8" required>${esc(p.body)}</textarea></label>
      ${existing}
      <label class="file-inline">사진 추가 <small>(총 6장까지)</small><input type="file" name="images" accept="image/*" multiple /><span class="fi-btn">사진 고르기<span class="fi-name"></span></span></label>
      <div class="post-actions"><button class="btn btn-primary">저장</button><a href="${base}/board/${p.id}" class="btn btn-ghost">취소</a></div>
    </form></div></section>`;
  return html(layout({ title: "글 수정", assoc, base, user, body, activeNav: `${base}/board`, csrf, scripts: `<script src="${assetUrl("/js/upload-resize.js")}" defer></script><script src="${assetUrl("/js/file-preview.js")}" defer></script>` }));
}

// ================= 회원가입 =================
export function registerForm(ctx) {
  // 셀프 가입을 받지 않는 제품에서는 URL 도 닫는다. 메뉴에서만 감추면 업체 레코드가 생겨
  // 쓰지도 않을 대시보드가 딸려 오고, 모집형에서는 아무나 '가맹점'을 자칭해 목록에 오른다.
  if (ctx.assoc && !kindOf(ctx.assoc).selfRegister) return notFoundResponse(ctx);
  const { env, assoc, base, query, csrf } = ctx;
  const opts = CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    ${authHead(assoc.name + " 가입", "점포 정보를 등록하고 사진·소식을 공유하세요.")}${flashOf(query)}
    <form method="post" action="${base}/register" class="stack-form">
      <label>대표자 성함<input type="text" name="name" required maxlength="60" autocomplete="name" /></label>
      <label>휴대폰 <small>(선택 · 계약서 서명 요청을 카카오 알림톡으로 받습니다)</small><input type="tel" name="phone" maxlength="13" inputmode="numeric" placeholder="010-1234-5678" autocomplete="tel" /></label>
      <label>이메일<input type="email" name="email" required autocomplete="email" /></label>
      <label>비밀번호 (8자 이상)<input type="password" name="password" required minlength="8" autocomplete="new-password" /></label>
      <label>점포명<input type="text" name="business_name" required maxlength="100" autocomplete="organization" /></label>
      <label>업종<select name="category">${opts}</select></label>
      <label class="check"><input type="checkbox" name="agree" value="1" required /> <a href="/privacy" target="_blank">개인정보 수집·이용</a>에 동의합니다.</label>
      ${turnstileWidget(env)}
      <button class="btn btn-primary btn-block">가입 신청</button>
    </form><p class="auth-note">가입 후 관리자 승인 시 일반에 공개됩니다.</p></div></div></section>`;
  return html(layout({ title: "가입", assoc, base, body, csrf, scripts: turnstileScript(env) }));
}

// ================= 초대 링크 가입 (관리자가 가게 정보를 미리 채움) =================
export async function invitePage(ctx) {
  if (ctx.assoc && ctx.assoc.kind === "esign") return notFoundResponse(ctx);
  const { env, assoc, base, query, csrf } = ctx;
  const inv = await verifyInviteToken(env.SESSION_SECRET, query.get("t"), assoc.id);
  if (!inv) {
    const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
      ${authHead("초대 링크 만료", "링크가 만료되었거나 올바르지 않습니다.")}
      <p class="auth-note">상인회 관리자에게 새 초대 링크를 요청해 주세요. 직접 가입하려면 <a href="${base}/register">가입 신청</a>을 이용할 수 있습니다.</p></div></div></section>`;
    return html(layout({ title: "초대", assoc, base, body, csrf }));
  }
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    ${authHead(`${inv.b} 사장님, 환영합니다!`, `${assoc.name}에서 초대했습니다. 아래만 입력하면 가게 페이지가 바로 열립니다.`)}${flashOf(query)}
    <div class="invite-summary"><span class="chip">${esc(inv.c || "기타")}</span> <strong>${esc(inv.b)}</strong></div>
    <form method="post" action="${base}/invite" class="stack-form">
      <input type="hidden" name="token" value="${esc(query.get("t") || "")}" />
      <label>사장님 성함<input type="text" name="name" required maxlength="60" autocomplete="name" /></label>
      <label>이메일<input type="email" name="email" required autocomplete="email" /></label>
      <label>비밀번호 (8자 이상)<input type="password" name="password" required minlength="8" autocomplete="new-password" /></label>
      <label class="check"><input type="checkbox" name="agree" value="1" required /> <a href="/privacy" target="_blank">개인정보 수집·이용</a>에 동의합니다.</label>
      <button class="btn btn-primary btn-block">가게 열기</button>
    </form><p class="auth-note">관리자 초대라 승인 절차 없이 바로 공개됩니다.</p></div></div></section>`;
  return html(layout({ title: "초대 가입", assoc, base, body, csrf }));
}

// ================= 유어딜 연동 안내 =================
export function urdealPage(ctx) {
  const { assoc, base, user, csrf } = ctx;
  const steps = [
    ["1", "유어딜에 가게 등록", "운영사(리스터코퍼레이션)가 등록을 도와드립니다. 아래 문의로 연락주세요."],
    ["2", "이용권·동네딜 만들기", "예: '2만원 식사권을 1만 8천원에' — 손님은 할인가로 사고, 가게는 선결제 매출이 생깁니다."],
    ["3", "손님이 매장에서 사용", "손님이 폰으로 이용권을 보여주면 확인 후 사용 처리 — 끝."],
  ];
  const body = `<section class="section page-top"><div class="container narrow">
    <div class="section-head"><h1 class="section-title">유어딜로 매출 만들기</h1>
      <p class="section-lead">이 홈페이지는 우리 가게를 <b>알리는 곳</b>, 유어딜은 <b>파는 곳</b>입니다. 운영사의 커머스 서비스라 상인회 회원은 등록을 도와드립니다.</p></div>
    <div class="urdeal-hero">
      <span class="fb-badge">FAMILY SERVICE</span>
      <h3>유어딜 — 돈버는 쇼핑</h3>
      <p>할인가로 사서 매장에서 바로 쓰는 <b>이용권</b>, 기프티콘 <b>교환권</b>, 내 주변 <b>동네딜</b>. 결제·정산은 유어딜이 처리하니 가게는 쿠폰 확인만 하면 됩니다.</p>
      <a class="btn btn-primary" href="https://live.ur-team.com/" target="_blank" rel="noopener">유어딜 구경하기 →</a>
    </div>
    <div class="urdeal-steps">${steps.map(([n, t, d]) => `<div class="us-step"><span class="us-num">${n}</span><div><strong>${t}</strong><p>${d}</p></div></div>`).join("")}</div>
    <div class="urdeal-vs">
      <div class="uv-col"><h4>이 홈페이지 (무료)</h4><ul><li>가게 소개·사진·소식</li><li>보여주기 쿠폰 (결제 없음)</li><li>지도·검색 노출</li></ul></div>
      <div class="uv-col is-urdeal"><h4>유어딜 (판매 채널)</h4><ul><li>이용권·교환권 실제 판매</li><li>동네딜로 신규 손님 유입</li><li>결제·정산 대행</li></ul></div>
    </div>
    <p class="panel-hint">등록 문의: <a href="${base}/contact">상인회 문의하기</a> 또는 유어딜에서 직접 신청</p>
  </div></section>`;
  return html(layout({ title: "유어딜 연동", assoc, base, user, body, csrf, description: "이용권·교환권·동네딜 — 유어딜로 우리 가게 매출 만들기" }));
}

// ================= 방문자 문의 =================
export function contactForm(ctx) {
  const { env, assoc, base, query, csrf, user } = ctx;
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    ${authHead(`${assoc.name}에 문의`, "가입·행사·제휴 등 무엇이든 남겨주세요. 확인 후 연락드립니다.")}${flashOf(query)}
    <form method="post" action="${base}/contact" class="stack-form">
      <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px" />
      <div class="form-two"><label>성함<input type="text" name="name" required maxlength="60" autocomplete="name" /></label>
        <label>연락처 (전화 또는 이메일)<input type="text" name="contact" required maxlength="120" /></label></div>
      <label>문의 내용<textarea name="message" rows="6" required maxlength="2000"></textarea></label>
      <label class="check"><input type="checkbox" name="agree" value="1" required /> 회신 목적의 <a href="/privacy" target="_blank">개인정보 수집·이용</a>에 동의합니다.</label>
      ${turnstileWidget(env)}
      <button class="btn btn-primary btn-block">문의 보내기</button>
    </form>${assoc.phone ? `<p class="auth-note">급하신 경우 전화 ${esc(assoc.phone)}</p>` : ""}</div></div></section>`;
  return html(layout({ title: "문의", assoc, base, user, body, csrf, scripts: turnstileScript(env) }));
}

// ================= 대시보드 (내 업체) =================
export async function dashboard(ctx) {
  const { db, env, assoc, base, user, query, csrf } = ctx;
  // 전자계약 전용 조직에는 '내 업체'가 없다 — 빈 화면 대신 할 일이 있는 곳으로 보낸다
  if (assoc.kind === "esign") return redirect(`${base}/sign`);
  const b = await D.getBusinessByOwner(db, user.id);
  if (!b || b.association_id !== assoc.id) return html(layout({ title: "대시보드", assoc, base, user, body: `<section class="section page-top"><div class="container"><p class="empty">연결된 업체가 없습니다.</p></div></section>`, csrf }));
  const media = await D.listMedia(db, b.id);
  const products = await D.listProducts(db, b.id, { includeHidden: true });
  const coupons = await D.listCoupons(db, b.id);
  const updates = await D.listUpdates(db, b.id, 10);
  const dayOff = D.isDayOff(b);
  const plan = PLANS[assoc.plan] || PLANS.free;
  const prodMax = plan.maxProducts === Infinity ? "무제한" : plan.maxProducts;
  const productRows = products.length ? products.map((p) => `<div class="prod-row${p.sold_out ? " sold" : ""}">
      <div class="prod-thumb">${p.image ? `<img src="${esc(mediaUrl(p.image))}" alt="" loading="lazy" />` : `<span class="prod-noimg">사진 없음</span>`}</div>
      <div class="prod-info"><div class="prod-line"><strong>${esc(p.name)}</strong>${p.price ? `<span class="prod-price">${esc(p.price)}</span>` : ""}${p.sold_out ? `<span class="badge badge-no">품절</span>` : `<span class="badge badge-ok">판매중</span>`}${p.hidden ? `<span class="badge badge-neutral">관리자 숨김</span>` : ""}</div>
        ${p.description ? `<p class="prod-desc">${esc(p.description)}</p>` : ""}
        <div class="prod-actions">
          <form method="post" action="${base}/dashboard/products/${p.id}/move" class="inline-form"><input type="hidden" name="dir" value="up"><button class="move-btn" title="위로">▲</button></form>
          <form method="post" action="${base}/dashboard/products/${p.id}/move" class="inline-form"><input type="hidden" name="dir" value="down"><button class="move-btn" title="아래로">▼</button></form>
          <form method="post" action="${base}/dashboard/products/${p.id}/soldout" class="inline-form"><button class="btn btn-xs btn-ghost">${p.sold_out ? "판매중으로" : "품절로"}</button></form>
          <details class="prod-edit"><summary class="btn btn-xs btn-ghost">수정</summary>
            <form method="post" action="${base}/dashboard/products/${p.id}" class="stack-form compact">
              <label>이름<input name="name" value="${esc(p.name)}" required autocomplete="name"></label>
              <label>가격 <small>(선택)</small><input name="price" value="${esc(p.price)}" placeholder="예: 8,000원 · 시가 · 미표기"></label>
              <label>한 줄 설명<textarea name="description" rows="2">${esc(p.description)}</textarea></label>
              <label class="check"><input type="checkbox" name="sold_out" value="1"${p.sold_out ? " checked" : ""}> 품절</label>
              <button class="btn btn-primary btn-sm">저장</button></form></details>
          <form method="post" action="${base}/dashboard/products/${p.id}/delete" class="inline-form" data-confirm="이 제품을 삭제할까요?"><button class="link-danger">삭제</button></form>
        </div></div></div>`).join("") : `<p class="empty">아직 등록한 제품이 없습니다. 아래에서 추가해 보세요.</p>`;
  const productPanel = `<section class="panel" id="d-products"><div class="panel-head"><h2 class="panel-title">제품·메뉴 진열 <span class="badge badge-muted">${products.length}/${prodMax}</span></h2></div>
    <p class="panel-hint">가게에서 파는 제품·메뉴를 사진과 함께 진열합니다. <strong>전시 전용</strong>이라 결제·주문 기능은 없습니다.</p>
    <div class="prod-list">${productRows}</div>
    <h3 class="panel-subtitle">제품 추가</h3>
    <form method="post" action="${base}/dashboard/products" enctype="multipart/form-data" class="stack-form compact">
      <label class="file-drop"><input type="file" name="image" accept="image/*" /><span class="file-drop-text">제품 사진 (선택·최대 8MB)</span></label>
      <div class="form-two"><label>제품 이름<input name="name" required autocomplete="name" /></label><label>가격 <small>(선택)</small><input name="price" placeholder="예: 8,000원 · 시가 · 미표기" /></label></div>
      <label>한 줄 설명 <small>(선택)</small><input name="description" maxlength="300" /></label>
      <button class="btn btn-primary btn-sm">제품 추가</button></form></section>`;
  const updatePanel = `<section class="panel" id="d-updates"><h2 class="panel-title">가게 소식 <span class="badge badge-muted">${updates.length}</span></h2>
      <p class="panel-hint">"오늘 딸기 들어왔어요" 같은 한 줄 소식을 올리면 <strong>가게 페이지와 상인회 홈 첫 화면</strong>에 바로 노출됩니다. 자주 올릴수록 손님이 자주 봅니다.</p>
      <form method="post" action="${base}/dashboard/updates" enctype="multipart/form-data" class="stack-form compact">
        <label>오늘의 소식<input name="body" required maxlength="300" placeholder="예: 오늘 생딸기 크레페 한정 20개!" /></label>
        <label class="file-inline">사진 1장 <small>(선택)</small><input type="file" name="image" accept="image/*" /><span class="fi-btn">사진 고르기<span class="fi-name"></span></span></label>
        <button class="btn btn-primary btn-sm">소식 올리기</button></form>
      ${updates.length ? `<ul class="update-feed compact">${updates.map((u) => `<li class="update-item">
        ${u.image ? `<img class="update-img" src="${esc(mediaUrl(u.image))}" alt="" loading="lazy" />` : ""}
        <div class="update-body"><p>${esc(u.body)}</p><time>${esc(kstDate(u.created_at, "."))}</time></div>
        <form method="post" action="${base}/dashboard/updates/${u.id}/delete" data-confirm="이 소식을 삭제할까요?"><button class="link-danger">삭제</button></form></li>`).join("")}</ul>` : ""}</section>`;
  const couponPanel = `<section class="panel" id="d-coupons"><h2 class="panel-title">쿠폰·혜택 <span class="badge badge-muted">${coupons.length}/5</span></h2>
      <p class="panel-hint">손님이 매장에서 <strong>이 화면을 보여주면</strong> 제공하는 혜택입니다. 결제·발급 기능이 없어 부담 없이 운영할 수 있어요. 기한이 지나면 자동으로 내려갑니다.</p>
      ${coupons.length ? `<ul class="coupon-admin-list">${coupons.map((c) => {
        const expired = c.valid_until && c.valid_until < new Date().toISOString().slice(0, 10);
        return `<li class="coupon-admin${expired ? " is-expired" : ""}"><div class="ca-text"><strong>${esc(c.title)}</strong>${c.terms ? `<small>${esc(c.terms)}</small>` : ""}<small>${c.valid_until ? `~${esc(c.valid_until)}` : "무기한"}${expired ? " · 기간 종료(비노출)" : ""}</small></div>
          <form method="post" action="${base}/dashboard/coupons/${c.id}/delete" data-confirm="이 쿠폰을 삭제할까요?"><button class="link-danger">삭제</button></form></li>`;
      }).join("")}</ul>` : `<p class="empty">등록한 쿠폰이 없습니다. 첫 쿠폰으로 손님을 맞아보세요.</p>`}
      <h3 class="panel-subtitle">쿠폰 추가</h3>
      <form method="post" action="${base}/dashboard/coupons" class="stack-form compact">
        <label>혜택 내용<input name="title" required maxlength="80" placeholder="예: 어묵 1개 서비스" /></label>
        <div class="form-two"><label>조건 <small>(선택)</small><input name="terms" maxlength="120" placeholder="예: 2만원 이상 주문 시" /></label>
          <label>유효기한 <small>(선택·비우면 무기한)</small><input type="date" name="valid_until" /></label></div>
        <button class="btn btn-primary btn-sm">쿠폰 등록</button></form></section>`;
  const urdealPanel = `<section class="panel urdeal-promo">
      <span class="up-badge">운영사 서비스</span>
      <h2 class="panel-title">이용권·동네딜을 온라인으로 팔고 싶다면</h2>
      <p class="panel-hint">이곳의 쿠폰은 보여주기 혜택(결제 없음)입니다. 할인 이용권·기프티콘 교환권을 <strong>실제로 판매</strong>하려면 운영사의 커머스 <strong>유어딜</strong>과 함께하세요.</p>
      <span class="pill-row"><a class="btn btn-primary btn-sm" href="${base}/urdeal">연동 방법 보기</a>
      <a class="btn btn-ghost btn-sm" href="https://live.ur-team.com/" target="_blank" rel="noopener">유어딜 바로가기 →</a></span></section>`;
  const qrPanel = `<section class="panel"><h2 class="panel-title">가게 QR 코드</h2>
      <p class="panel-hint">인쇄해서 계산대·출입문에 붙여보세요. 손님이 스캔하면 우리 가게 페이지가 열립니다.</p>
      <div id="qrWidget" class="qr-widget" data-url="${base}/business/${esc(b.slug)}" data-name="${esc(b.name)}">
        <div class="qr-img" aria-label="가게 QR 코드"></div>
        <div class="qr-actions">
          <button type="button" class="btn btn-primary btn-sm" data-qr-png>PNG 저장 (인쇄용)</button>
          <button type="button" class="btn btn-ghost btn-sm" data-qr-copy>링크 복사</button>
        </div>
      </div></section>`;
  // 사장님 온보딩 체크리스트 (콘텐츠 채움 유도 — 셀프 등록률 핵심 장치)
  const imgCount = media.filter((m) => m.kind === "image").length;
  // 영업 시간이 맨 앞이다. 상인회 홈 첫 화면이 "지금 문 연 곳"으로 가게를 고르는데,
  // 영업 시간이 비어 있으면 우리 가게는 그 목록에 아예 뜨지 않는다 —
  // 사진을 아무리 올려도 손님이 도달하지 못한다. 그래서 무엇을 잃는지까지 적는다.
  const mSteps = [
    { done: !!(b.hours || "").trim(), label: "영업 시간 적기", why: "비어 있으면 홈의 '지금 문 연 곳'에 우리 가게가 안 뜹니다", href: "#d-info" },
    { done: !!(b.phone || "").trim(), label: "전화번호 적기", why: "손님이 가게 페이지에서 바로 걸 수 있습니다", href: "#d-info" },
    { done: !!(b.description || "").trim(), label: "가게 소개 쓰기", why: "검색 결과에 이 문장이 함께 나옵니다", href: "#d-info" },
    { done: imgCount >= 3, label: `가게 사진 3장 올리기 (${Math.min(imgCount, 3)}/3)`, why: "사진이 없으면 카드가 회색으로 나옵니다", href: "#d-media" },
    { done: products.length >= 1, label: "제품·메뉴 1개 올리기", why: "가격을 보고 오는 손님이 가장 많습니다", href: "#d-products" },
    { done: b.lat != null && b.lng != null, label: "지도에 위치 찍기", why: "점포 지도에 우리 가게가 표시됩니다", href: "#d-info" },
  ];
  // 끝난 항목까지 줄줄이 늘어놓고 취소선을 그으면 '다 지워진 목록' 처럼 보여
  // 정작 남은 하나가 묻힙니다. 남은 것만 적고, 끝난 것은 숫자 한 줄로 셉니다.
  const mLeft = mSteps.filter((x) => !x.done);
  const mDone = mSteps.length - mLeft.length;
  const merchantOnboard = mLeft.length ? `<section class="panel onboard"><h2 class="panel-title">아직 덜 채운 것 <span class="badge badge-wait">${mLeft.length}가지</span></h2>
    <p class="panel-hint">채우면 손님이 보는 가게 페이지가 완성됩니다. 못 채우면 무엇을 잃는지 옆에 적었습니다.${
      mDone ? ` 나머지 ${mDone}가지는 이미 채우셨습니다.` : ""}</p>
    <ul class="onboard-list">${mLeft.map((x) => `<li><a href="${x.href}">${x.label}</a><span class="ob-why">${x.why}</span></li>`).join("")}</ul></section>` : "";
  const approveBanner = b.status === "approved" ? `<div class="approve-banner" data-dismiss-key="approved-${b.id}" hidden>
    <div class="ab-text"><strong>가게가 공개되었습니다!</strong><p>아래 QR을 인쇄해 계산대에 붙이고, 가게 페이지의 공유 버튼으로 카톡방에 알려보세요.</p></div>
    <span class="ab-actions"><a class="btn btn-sm btn-primary" href="${base}/business/${esc(b.slug)}" target="_blank">내 가게 보기</a><button type="button" class="btn btn-sm btn-ghost" data-dismiss>닫기</button></span>
  </div>` : "";
  const opts = CATEGORIES.map((c) => `<option value="${esc(c)}"${c === b.category ? " selected" : ""}>${esc(c)}</option>`).join("");
  const grid = media.length ? media.map((m) => `<figure class="media-tile">${galleryItem(m, { showCaption: false })}<figcaption>
      <span class="media-kind">${m.kind === "image" ? "사진" : (m.kind === "embed" ? "" + esc(providerLabel(m.provider)) : "🎬 영상")}</span>
      <form method="post" action="${base}/dashboard/media/${m.id}/delete" data-confirm="삭제?"><button class="link-danger">삭제</button></form></figcaption></figure>`).join("") : `<p class="empty">아직 등록한 사진·영상이 없습니다.</p>`;
  const naver = assoc.map_client_id || env.NAVER_MAP_CLIENT_ID; // 상인회 전용 지도 키 우선
  const infoPanel = `  <section class="panel" id="d-info"><h2 class="panel-title">업체 정보</h2>
    <form method="post" action="${base}/dashboard/business" class="stack-form">
      <label>업체명<input type="text" name="name" value="${esc(b.name)}" required autocomplete="name" /></label>
      <label>업종<select name="category">${opts}</select></label>
      <label>소개<textarea name="description" rows="4">${esc(b.description)}</textarea></label>
      <div class="form-two"><label>전화<input type="tel" name="phone" value="${esc(b.phone)}" autocomplete="tel" /></label><label>영업시간<input type="text" name="hours" value="${esc(b.hours)}" /></label></div>
      <label>주소<input type="text" name="address" value="${esc(b.address)}" autocomplete="street-address" /></label>
      <div class="form-divider">SNS 링크 <small style="font-weight:400;color:var(--muted)">(선택 · 가게 페이지에 버튼으로 표시)</small></div>
      <div class="form-two"><label>인스타그램<input type="url" name="sns_instagram" value="${esc(b.sns_instagram || "")}" placeholder="instagram.com/가게계정" /></label>
        <label>유튜브<input type="url" name="sns_youtube" value="${esc(b.sns_youtube || "")}" placeholder="youtube.com/@채널" /></label></div>
      <div class="form-two"><label>네이버 블로그<input type="url" name="sns_blog" value="${esc(b.sns_blog || "")}" placeholder="blog.naver.com/아이디" /></label>
        <label>카카오톡 채널<input type="url" name="sns_kakao" value="${esc(b.sns_kakao || "")}" placeholder="pf.kakao.com/_채널" /></label></div>
      <label>네이버 플레이스 <small>(내 가게 네이버 지도 페이지 — 리뷰·길찾기 연결)</small><input type="url" name="sns_naver" value="${esc(b.sns_naver || "")}" placeholder="naver.me/… 또는 map.naver.com/p/entry/place/…" /></label>
      <div class="form-divider">지도 위치</div>
      ${naver ? `<div class="geo-search"><input type="text" id="geoQuery" value="${esc(b.address)}" placeholder="도로명 주소 (예: 서초대로 123)" aria-label="주소로 좌표 찾기" /><button type="button" class="btn btn-ghost btn-sm" id="geoBtn">주소로 찾기</button></div>
      <p class="geo-msg panel-hint" id="geoMsg" hidden></p>
      <div id="pickMap" class="pick-map" data-center-lat="${b.lat ?? assoc.map_lat}" data-center-lng="${b.lng ?? assoc.map_lng}" data-zoom="16"></div><p class="panel-hint">주소로 찾거나, 지도를 직접 클릭하면 좌표가 입력됩니다.</p>` : `<p class="panel-hint">위도·경도를 입력하면 지도에 표시됩니다.</p>`}
      <div class="form-two"><label>위도<input type="text" inputmode="decimal" name="lat" id="latInput" value="${b.lat != null ? esc(String(b.lat)) : ""}" /></label><label>경도<input type="text" inputmode="decimal" name="lng" id="lngInput" value="${b.lng != null ? esc(String(b.lng)) : ""}" /></label></div>
      <button class="btn btn-primary">정보 저장</button></form></section>`;
  const mediaPanel = `  <section class="panel" id="d-media"><h2 class="panel-title">사진 업로드</h2>
    <form method="post" action="${base}/dashboard/media" enctype="multipart/form-data" class="upload-form">
      <label class="file-drop"><input type="file" name="files" accept="image/*" multiple /><span class="file-drop-text">사진 선택 (최대 8MB)</span></label>
      <input type="text" name="caption" placeholder="설명 (선택)" class="caption-input" />
      <button class="btn btn-primary btn-block">업로드</button></form>
    <h3 class="panel-subtitle">영상 링크 추가</h3>
    <p class="panel-hint">유튜브·쇼츠·인스타 릴스·네이버TV 주소를 붙여넣으세요. <small>단축 주소(naver.me/…)는 안 됩니다 — 영상을 열어 주소창의 원래 주소를 복사해 주세요.</small></p>
    <form method="post" action="${base}/dashboard/media/embed" class="stack-form compact">
      <input type="url" name="url" placeholder="영상 주소(링크)" required /><input type="text" name="caption" placeholder="설명 (선택)" maxlength="200" />
      <button class="btn btn-primary btn-sm">영상 링크 추가</button></form>
    <h3 class="panel-subtitle">등록된 미디어 (${media.length})</h3><div class="media-grid">${grid}</div></section>`;
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><h1 class="dash-title">${esc(b.name)} ${statusBadge(b.status)}</h1>
      <p class="dash-sub">공개 주소: <a href="${base}/business/${esc(b.slug)}" target="_blank">${esc(prettyPath(base))}/business/${esc(b.slug)}</a></p></div>
      <div class="dash-head-actions">
        <form method="post" action="${base}/dashboard/dayoff" class="inline-form">
          <button class="btn btn-sm ${dayOff ? "btn-primary" : "btn-ghost"}" title="가게 카드에 '오늘 휴무'로 표시됩니다. 내일 자동 해제.">${dayOff ? "오늘 휴무 중 (해제)" : "오늘 임시휴무"}</button></form>
        <a href="${base}/sign" class="btn btn-ghost btn-sm">전자서명</a></div></div>
    ${flashOf(query)}
    ${approveBanner}
    ${merchantOnboard}
    <div class="console-grid"><aside class="console-side"><nav id="consoleNav">
      ${[["shop", "가게 정보"], ["photo", "사진·영상"], ["sell", "메뉴·쿠폰"], ["tell", "알리기"]]
        .map(([id, label]) => `<a href="#s-${id}" data-tab="${id}">${label}</a>`).join("")}
    </nav></aside><div class="console-main">
      <div class="sgroup" id="s-shop" data-tab="shop">${infoPanel}</div>
      <div class="sgroup" id="s-photo" data-tab="photo">${mediaPanel}</div>
      <div class="sgroup" id="s-sell" data-tab="sell">${productPanel}${couponPanel}</div>
      <div class="sgroup" id="s-tell" data-tab="tell">${updatePanel}${qrPanel}${urdealPanel}</div>
    </div></div>
    </div></section>`;
  const picker = naver ? `<script src="https://oapi.map.naver.com/openapi/v3/maps.js?${esc(env.NAVER_MAP_PARAM || "ncpClientId")}=${esc(naver)}&submodules=geocoder"></script><script src="${assetUrl("/js/map.js")}" defer></script>` : "";
  return html(layout({ title: "내 업체 관리", assoc, base, user, body, csrf, scripts: `<script src="${assetUrl("/js/viewer.js")}" defer></script><script src="${assetUrl("/js/upload-resize.js")}" defer></script><script src="${assetUrl("/js/qr.js")}" defer></script><script src="${assetUrl("/js/qr-widget.js")}" defer></script><script src="${assetUrl("/js/super-tabs.js")}" defer></script><script src="${assetUrl("/js/file-preview.js")}" defer></script>${picker}` }));
}

const docBody = (b) => esc(b).replace(/\n/g, "<br />");
// 휴대폰에서는 A4 지면이 화면 폭에 맞춰 절반 이하로 줄어들어 본문 글자가 6px 남짓이 된다.
// 임대차계약서를 읽지 못하는 채로 서명하게 두는 것은, 그 기능이 없는 것과 같다.
// 지면은 서명 자리를 누르는 데 쓰고, 읽기는 이 블록에서 한다 — 글자 하나까지 같은 본문이다.
// 좁은 화면에서는 스크립트가 이 블록을 펴 둔 채로 시작한다(paper.js). 그래서 제목은
// 접혀 있을 때만 말이 되는 문장("글씨가 작으면 —")이 아니라, 펴져 있어도 읽히는 이름이어야 한다.
const plainRead = (body) => `<details class="read-plain">
  <summary>계약서 본문 크게 읽기</summary>
  <p class="rp-note">아래 계약서 지면과 <b>글자 하나까지 같은 내용</b>입니다. 서명·날인 자리는 지면에서 눌러 주세요.</p>
  <div class="rp-body">${docBody(body)}</div></details>`;

// CSV 셀: 따옴표 이스케이프 + 수식 인젝션 방지(= + - @ 로 시작하면 \' 접두)
const csvCell = (v) => {
  let s = String(v == null ? "" : v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ================= 관리자 =================
export async function admin(ctx) {
  const { db, env, assoc, base, user, query, csrf } = ctx;
  // 독립 쿼리 병렬화 — D1 은 쿼리마다 왕복이라 직렬 대기가 관리자 TTFB 의 주범이었음
  const duePeriod0 = /^\d{4}-\d{2}$/.test(query.get("due_period") || "") ? query.get("due_period") : D.kstToday().slice(0, 7);
  const [s, all, notices, events, members, admins, notifs, unread, auditLog, met, assocProducts, allRsvps, dueRowsRaw, visitsRaw, popupList] = await Promise.all([
    D.stats(db, assoc.id),
    D.listAllBusinesses(db, assoc.id),
    D.listNotices(db, assoc.id),
    D.listEvents(db, assoc.id),
    D.listUsersByAssociation(db, assoc.id, "MERCHANT"),
    D.listUsersByAssociation(db, assoc.id, "ADMIN"),
    D.listNotifications(db, assoc.id, 15),
    D.unreadCount(db, assoc.id),
    D.listAudit(db, assoc.id, 12),
    D.engagementMetrics(db, assoc.id),
    D.listAssocProducts(db, assoc.id),
    D.listRsvpsByAssoc(db, assoc.id),
    D.listDuesForPeriod(db, assoc.id, duePeriod0),
    D.visitTrend(db, assoc.id).catch(() => ({ cur: 0, prev: 0 })),
    D.listPopups(db, assoc.id).catch(() => []),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const visits = { cur: Number(visitsRaw && visitsRaw.cur) || 0, prev: Number(visitsRaw && visitsRaw.prev) || 0 };
  const lay = parseLayout(assoc.home_layout, assoc.name);

  // ── 홈 A/B — 같은 상인회의 다른 홈 구성을 나란히 놓고 무엇이 실제로 통했는지 본다.
  // 성공을 하나로 합치지 않는다. 상인회에는 목적이 둘이다 —
  // 점주를 늘리는 것(입점 신청)과 손님을 가게로 보내는 것(가게 열람·찾기).
  // 하나의 '전환율' 로 뭉개면 어느 쪽이 좋아졌는지 알 수 없다.
  const isMerchant = kindOf(assoc).home === "merchant";
  const homeVariants = isMerchant ? await D.listLandingVariants(db, assoc.id).catch(() => []) : [];
  const abStats = isMerchant ? await D.homeVariantStats(db, assoc.id, 30).catch(() => []) : [];
  const abPanel = !isMerchant ? "" : (() => {
    const by = new Map(abStats.map((r) => [r.variant || "", r]));
    const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");
    const rows = [{ slug: "", name: "지금 쓰는 홈" }, ...homeVariants.map((v) => ({ slug: v.slug, name: v.name || v.slug }))]
      .map((v) => {
        const r = by.get(v.slug) || {};
        const w = Number(r.views) || 0;
        // 방문이 얇으면 비율은 우연이다. 숫자를 보여 주되 "아직 비교하지 마세요" 를 같이 말한다.
        const thin = w < 100;
        return `<tr><td><b>${esc(v.name)}</b>${v.slug
            ? `<br /><small><code>${esc(prettyPath(`${base}/l/${v.slug}`))}</code></small>` : ""}</td>
          <td>${w.toLocaleString()}</td>
          <td>${(Number(r.signups) || 0).toLocaleString()}<br /><small>${pct(Number(r.signups) || 0, w)}</small></td>
          <td>${(Number(r.bizviews) || 0).toLocaleString()}<br /><small>${pct(Number(r.bizviews) || 0, w)}</small></td>
          <td>${(Number(r.finds) || 0).toLocaleString()}<br /><small>${pct(Number(r.finds) || 0, w)}</small></td>
          <td>${thin ? '<span class="badge badge-muted" title="방문 100회가 넘기 전에는 우연히 높거나 낮게 나옵니다.">표본 부족</span>' : '<span class="badge badge-ok">비교 가능</span>'}
            ${v.slug ? `<form method="post" action="${base}/admin/home-variant/${esc(v.slug)}/delete" class="inline-form" data-confirm="'${esc(v.name)}' 사본을 지울까요?&#10;쌓인 성과 기록은 남습니다."><button class="btn btn-xs btn-ghost">삭제</button></form>` : ""}</td></tr>`;
      }).join("");
    return `<details class="panel panel-fold" id="p-ab"${homeVariants.length ? " open" : ""}>
      <summary class="panel-title">홈 비교하기 (A/B) ${homeVariants.length
        ? `<span class="badge badge-info">사본 ${homeVariants.length}</span>` : '<span class="badge badge-muted">아직 없음</span>'}</summary>
      <p class="panel-hint">지금 쓰는 홈을 그대로 두고 <b>사본</b>을 하나 만들어, 사본 주소를 전단 QR·카톡·인스타에 뿌립니다.
        어느 쪽이 실제로 <b>입점 신청</b>과 <b>가게 열람</b>을 만들었는지 아래 표에 쌓입니다.
        사본을 만들면 지금 구성이 그대로 복사되므로, 복사한 뒤 사본만 고치면 됩니다.</p>
      <div class="table-scroll"><table class="admin-table">
        <thead><tr><th>홈</th><th>방문</th><th>입점 신청</th><th>가게 열람</th><th>검색·지도</th><th>판정</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="panel-hint">최근 30일. 비율은 <b>방문 대비</b>입니다. 방문 100회가 넘기 전에는 숫자가 우연히 흔들리니
        <b>비교하지 마세요</b> — 하루 방문이 적은 상권이면 한두 달은 그냥 두고 보셔야 합니다.</p>
      <form method="post" action="${base}/admin/home-variant" class="stack-form compact">
        <div class="form-two"><label>사본 이름 <small>(나만 봅니다 — 예: 가게 먼저 보여주기)</small>
            <input type="text" name="name" required maxlength="40" autocomplete="name" /></label>
          <label>주소 <small>(영문 소문자·숫자·하이픈)</small>
            <span class="slug-row"><span class="slug-pre">${esc(prettyPath(base + "/l/"))}</span>
            <input type="text" name="slug" required maxlength="40" pattern="[a-z0-9\-]+" placeholder="b" /></span></label></div>
        <label>첫 화면 구성 <small>(나머지 구역은 지금 홈 그대로 복사됩니다)</small>
          <select name="preset">
            <option value="">지금 홈을 그대로 복사</option>
            ${Object.entries(HOME_PRESETS).map(([k, p]) => `<option value="${esc(k)}">${esc(p.label)}</option>`).join("")}
          </select></label>
        <button class="btn btn-primary btn-sm">사본 만들기</button></form>
    </details>`;
  })();
  // 핵심 가설 계측: "회원이 스스로 채운다"가 성립하는가. 셀프 등록률 30% 이상이면 성립 신호.
  const selfOk = met.total >= 5 && met.selfRate >= 30;
  const productModPanel = assocProducts.length ? `<section class="panel"><h2 class="panel-title">제품 진열 관리 <span class="badge badge-muted">${assocProducts.length}</span></h2>
    <p class="panel-hint">부적절한 제품은 숨길 수 있습니다. (사장님 화면에는 '관리자 숨김'으로 표시됩니다)</p>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>제품</th><th>점포</th><th>상태</th><th>처리</th></tr></thead><tbody>
    ${assocProducts.map((p) => `<tr><td>${esc(p.name)}${p.price ? `<br /><small>${esc(p.price)}</small>` : ""}</td>
      <td><a href="${base}/business/${esc(p.biz_slug)}" target="_blank">${esc(p.biz_name)}</a></td>
      <td>${p.hidden ? '<span class="badge badge-neutral">숨김</span>' : (p.sold_out ? '<span class="badge badge-no">품절</span>' : '<span class="badge badge-ok">노출</span>')}</td>
      <td class="actions-cell"><form method="post" action="${base}/admin/product/${p.id}/hide"><button class="btn btn-xs btn-ghost">${p.hidden ? "다시 노출" : "숨기기"}</button></form></td></tr>`).join("")}
    </tbody></table></div></section>` : "";
  const auditPanel = `<details class="panel panel-fold"><summary class="panel-title">감사 로그 <span class="badge badge-muted">최근 ${auditLog.length}</span></summary>
    <ul class="audit-list">${auditLog.length ? auditLog.map((a) => `<li><span class="audit-action">${esc(a.action)}</span> <span class="audit-detail">${esc(a.detail)}</span><span class="audit-meta">${esc(a.actor_name)} · ${esc(kstStamp(a.created_at, { year: false }))}</span></li>`).join("") : `<li class="empty">기록이 없습니다.</li>`}</ul></details>`;

  const bizRows = all.length ? all.map((b) => `<tr><td><a href="${base}/business/${esc(b.slug)}" target="_blank">${esc(b.name)}</a><br /><small>${esc(b.category)}</small></td>
    <td>${esc(b.owner_name)}<br /><small>${isPlaceholderEmail(b.owner_email)
      ? '<span class="badge badge-wait">로그인 미설정</span>' : esc(b.owner_email)}</small></td><td>${statusBadge(b.status)}</td>
    <td class="actions-cell"><a class="btn btn-xs btn-ghost" href="${base}/admin/business/${b.id}">정보 채우기</a>
      ${b.status !== "approved" ? `<form method="post" action="${base}/admin/business/${b.id}/status"><input type="hidden" name="status" value="approved"><button class="btn btn-xs btn-primary">승인</button></form>` : ""}
      ${b.status !== "rejected" ? `<form method="post" action="${base}/admin/business/${b.id}/status"><input type="hidden" name="status" value="rejected"><button class="btn btn-xs btn-ghost">반려</button></form>` : ""}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">등록된 업체가 없습니다.</td></tr>`;
  // 전자계약 조직은 '담당자'(관리자·담당자)를 관리한다 — 목록·권한회수·비번 재발급이 필요하다.
  // 한 번 발급한 계정을 회수할 방법이 없으면 퇴사자가 계약을 계속 만들 수 있다.
  const staffList = [...admins, ...(await D.listUsersByAssociation(db, assoc.id, "STAFF"))];
  const roleLabel = (r) => (r === "ADMIN" ? '<span class="badge badge-brand">관리자</span>' : '<span class="badge badge-info">담당자</span>');
  // 부서 — 만들어 두면 담당자 표에 배정 칸이 생긴다. 하나도 없으면 칸 자체를 그리지 않는다.
  const teams = await D.listTeams(db, assoc.id);
  const teamOf = (id) => (teams.find((t) => t.id === id) || {}).name || "";
  const teamCell = (m) => !teams.length ? "" : `<td class="team-cell">${m.role === "ADMIN"
    ? '<small class="txt-muted">전부 봅니다</small>'
    : `<form method="post" action="${base}/admin/user/${m.id}/team" class="inline-form"><select name="team">
        <option value="0"${m.team_id ? "" : " selected"}>— 부서 없음 —</option>
        ${teams.map((t) => `<option value="${t.id}"${m.team_id === t.id ? " selected" : ""}>${esc(t.name)}</option>`).join("")}
      </select><button class="btn btn-xs btn-ghost">저장</button></form>`}</td>`;
  const staffRows = staffList.length ? staffList.map((m) => `<tr><td>${esc(m.name)}<br /><small>${esc(m.email)}</small></td>
    <td>${roleLabel(m.role)}<br /><small>${m.role === "ADMIN" ? "설정·API·과금 포함" : "계약서 작성·발송"}</small></td>
    ${teamCell(m)}
    <td class="actions-cell">
      ${m.id === user.id ? '<small class="txt-muted">본인</small>' : `
      <form method="post" action="${base}/admin/user/${m.id}/reset-password" class="inline-form" data-confirm="${esc(m.name)}님의 임시 비밀번호를 발급할까요?&#10;기존 비밀번호는 즉시 무효가 됩니다."><button class="btn btn-xs btn-ghost">임시 비밀번호</button></form>
      <form method="post" action="${base}/admin/user/${m.id}/revoke" class="inline-form" data-confirm="${esc(m.name)}님의 권한을 회수할까요?&#10;계정과 서명 이력은 그대로 남고, 계약을 만들 수 없게 됩니다."><button class="btn btn-xs btn-ghost">권한 회수</button></form>`}
    </td></tr>`).join("") : `<tr><td colspan="${teams.length ? 4 : 3}" class="empty">담당자가 없습니다.</td></tr>`;
  // ---- 부서 패널 ----
  // 왜 '켜기' 를 따로 두는가: 부서를 만들자마자 화면이 나뉘면, 시험 삼아 하나 만들어 본
  // 관리자가 담당자들의 계약 목록을 통째로 비워 버린다. 만드는 것과 켜는 것을 갈라 둔다.
  const teamCount = await D.teamCounts(db, assoc.id);
  const unassigned = staffList.filter((m) => m.role !== "ADMIN" && !m.team_id).length;
  const teamRows = teams.length ? teams.map((t) => `<tr>
      <td><form method="post" action="${base}/admin/teams/${t.id}/rename" class="inline-form team-rename">
        <input type="text" name="team_name" value="${esc(t.name)}" maxlength="40" aria-label="부서 이름" autocomplete="off" />
        <button class="btn btn-xs btn-ghost">이름 바꾸기</button></form></td>
      <td>${teamCount[t.id] || 0}명</td>
      <td class="actions-cell"><form method="post" action="${base}/admin/teams/${t.id}/delete" class="inline-form"
        data-confirm="'${esc(t.name)}' 부서를 없앨까요?&#10;그 부서의 계약과 담당자는 '부서 없음' 이 되어 조직 전체가 다시 봅니다.&#10;계약이 지워지지는 않습니다."><button class="btn btn-xs btn-ghost">없애기</button></form></td>
    </tr>`).join("") : `<tr><td colspan="3" class="empty">부서가 없습니다.</td></tr>`;
  const teamsPanel = `<section class="panel" id="p-teams"><div class="panel-head">
      <h2 class="panel-title">부서 <span class="badge badge-${assoc.team_scope ? "ok" : "muted"}">${assoc.team_scope ? "나눠 보는 중" : "아직 안 나눔"}</span></h2></div>
    <p class="panel-hint">인사팀의 근로계약서가 영업팀 화면에 그대로 뜨는 것을 막습니다.
      <b>지금은 ${assoc.team_scope ? "부서별로 나눠 봅니다" : "담당자가 조직의 계약을 모두 봅니다"}.</b></p>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>부서</th><th>담당자</th><th>관리</th></tr></thead><tbody>${teamRows}</tbody></table></div>
    <form method="post" action="${base}/admin/teams/add" class="inline-form team-add">
      <input type="text" name="team_name" maxlength="40" placeholder="예: 인사팀" aria-label="새 부서 이름" autocomplete="off" required />
      <button class="btn btn-primary btn-sm">부서 추가</button></form>
    <div class="form-divider">부서별로 나눠 보기</div>
    <p class="panel-hint">켜면 담당자는 <b>자기 부서의 계약</b>과 <b>자기가 만든 계약</b>만 봅니다.
      관리자는 늘 전부 봅니다. <b>부서를 정하지 않은 계약(지난 계약 포함)은 그대로 모두가 봅니다</b> —
      켠다고 지난 계약이 사라지지 않습니다.</p>
    ${assoc.team_scope && unassigned ? `<div class="flash flash-warn">부서를 정하지 않은 담당자가 ${unassigned}명 있습니다.
      이분들은 자기가 만든 계약만 보게 됩니다.</div>` : ""}
    <form method="post" action="${base}/admin/teams/scope">
      <input type="hidden" name="on" value="${assoc.team_scope ? "0" : "1"}" />
      <button class="btn btn-${assoc.team_scope ? "ghost" : "primary"} btn-sm"${teams.length ? "" : " disabled"}
        ${assoc.team_scope ? 'data-confirm="부서 경계를 끌까요?&#10;담당자가 조직의 계약을 다시 모두 보게 됩니다."' : ""}>${assoc.team_scope ? "끄기" : "켜기"}</button>
      ${teams.length ? "" : `<small class="txt-muted">부서를 먼저 하나 만들어 주세요.</small>`}</form></section>`;

  // 이메일 없이 등록한 사장님은 아직 로그인할 수 없다. 가짜 주소를 그대로 보여 주면
  // 회장님이 그걸 진짜 주소로 알고 사장님께 불러 줄 수 있으므로, 상태를 그대로 적는다.
  const memberRows = members.length ? members.map((m) => `<tr><td>${esc(m.name)}<br /><small>${
      isPlaceholderEmail(m.email) ? '<span class="badge badge-wait">로그인 미설정</span>' : esc(m.email)
    }${m.phone ? ` · ${esc(D.maskPhone(m.phone))}` : ""}</small></td><td>${esc(m.business_name || "-")}</td>
    <td class="actions-cell"><form method="post" action="${base}/admin/user/${m.id}/reset-password" data-confirm="임시 비밀번호를 발급할까요?"><button class="btn btn-xs btn-ghost"${isPlaceholderEmail(m.email) ? " disabled title=\"로그인 이메일이 아직 없습니다 — 점포 화면에서 지정해 주세요\"" : ""}>임시 비밀번호</button></form></td></tr>`).join("") : `<tr><td colspan="3" class="empty">회원이 없습니다.</td></tr>`;
  // ── 회원 추가 —— 예전에는 접힌 상자 안 맨 아래에 있어 아무도 못 찾았다.
  // 상인회장이 명단을 먼저 넣는 것이 실제 시작 방식이므로, 이건 눈에 보이는 자리에 있어야 한다.
  const kakaoReady = !!String(env.KAKAO_REST_KEY || "").trim();
  const addMemberPanel = `<section class="panel panel-accent" id="p-addmember">
    <h2 class="panel-title">회원 추가</h2>
    <p class="panel-hint">사장님 대신 등록합니다. <b>이메일은 없어도 됩니다</b> — 상인회 안내는 알림톡으로 나가므로 실제로 필요한 건 휴대폰입니다.
      이메일을 비우면 사장님은 아직 로그인할 수 없고, 나중에 점포 화면에서 <b>로그인 이메일</b>을 지정하면 그때 임시 비밀번호가 나옵니다.</p>
    ${kakaoReady ? `<div class="form-divider">지도에서 찾아 간편 등록</div>
    <div class="place-find" data-place-find>
      <input type="text" data-place-q placeholder="가게 이름 (예: 방배 버들카페)" aria-label="가게 이름으로 찾기" autocomplete="off" />
      <button type="button" class="btn btn-ghost btn-sm" data-place-go>찾기</button>
    </div>
    <p class="panel-hint" data-place-msg hidden></p>
    <ul class="place-list" data-place-list hidden></ul>
    <p class="panel-hint">고르면 업체명·업종·주소·전화·좌표가 아래에 채워집니다. <b>사장님 성함과 휴대폰만 더 적으면 끝</b>입니다.</p>` : ""}
    <form method="post" action="${base}/admin/members/add" class="stack-form">
      <div class="form-two"><label>사장님 성함<input type="text" name="name" required maxlength="60" autocomplete="name" /></label>
        <label>휴대폰 <small>(알림톡·연락용)</small><input type="tel" name="phone" maxlength="13" inputmode="numeric" placeholder="010-1234-5678" autocomplete="tel" /></label></div>
      <div class="form-two"><label>업체명<input type="text" name="business_name" data-place="name" required maxlength="100" autocomplete="organization" /></label>
        <label>업종<select name="category" data-place="category">${CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select></label></div>
      <div class="form-two"><label>가게 주소 <small>(선택 · 지도에 뜨려면 필요합니다)</small><input type="text" name="address" data-place="address" maxlength="200" autocomplete="street-address" /></label>
        <label>가게 전화 <small>(선택)</small><input type="tel" name="biz_phone" data-place="phone" maxlength="40" /></label></div>
      <label>이메일 <small>(선택 · 있으면 바로 로그인할 수 있습니다)</small><input type="email" name="email" maxlength="120" autocomplete="email" /></label>
      <input type="hidden" name="lat" data-place="lat" /><input type="hidden" name="lng" data-place="lng" />
      <button class="btn btn-primary">회원 추가</button></form>
    <p class="panel-hint">등록한 뒤 <b>[정보 채우기]</b> 에서 주소·전화·사진을 채우면 손님 화면에 제대로 뜹니다.
      사장님이 직접 하시게 하려면 아래 <b>초대 링크</b>를 카톡으로 보내세요.</p></section>`;
  const noticeRows2 = notices.map((n) => `<li><span class="notice-tag${n.pinned ? " tag-important" : ""}">${esc(n.tag)}</span><span class="notice-title">${esc(n.title)}</span>
    <form method="post" action="${base}/admin/notice/${n.id}/delete" data-confirm="삭제?"><button class="link-danger">삭제</button></form></li>`).join("") || `<li class="empty">공지가 없습니다.</li>`;
  const rsvpsByEvent = new Map();
  for (const r of allRsvps) { if (!rsvpsByEvent.has(r.event_id)) rsvpsByEvent.set(r.event_id, []); rsvpsByEvent.get(r.event_id).push(r); }
  let eventRows = "";
  for (const e of events) {
    const rsvps = rsvpsByEvent.get(e.id) || [];
    eventRows += `<li><span class="event-mini-date">${esc(e.event_date)}</span><span class="notice-title">${esc(e.title)}</span>
      ${rsvps.length ? `<details class="rsvp-names"><summary>참가 ${rsvps.length}곳</summary><p>${rsvps.map((r) => esc(r.biz_name || r.user_name)).join(", ")}</p></details>` : ""}
      <form method="post" action="${base}/admin/event/${e.id}/delete" data-confirm="삭제?"><button class="link-danger">삭제</button></form></li>`;
  }
  eventRows = eventRows || `<li class="empty">행사가 없습니다.</li>`;
  // ── 홈 팝업 —— 목록에는 "지금 뜨는가"를 상태로 적습니다.
  // 켜 두고 기간이 지난 것과, 아예 내려 둔 것은 다릅니다. 둘을 같은 회색으로 그리면
  // 왜 안 뜨는지 관리자가 화면만 보고는 알 수 없습니다.
  const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const popupRows = popupList.length ? popupList.map((p) => {
    const notYet = p.start_date && p.start_date > todayKst;
    const over = p.end_date && p.end_date < todayKst;
    const state = !p.enabled ? ['<span class="badge badge-muted">내림</span>', "내려 둔 팝업입니다"]
      : notYet ? [`<span class="badge badge-wait">대기</span>`, `${p.start_date}부터 뜹니다`]
      : over ? [`<span class="badge badge-muted">기간 끝</span>`, `${p.end_date}에 끝났습니다`]
      : ['<span class="badge badge-ok">노출 중</span>', "지금 홈에서 뜹니다"];
    const term = p.start_date || p.end_date ? `${esc(p.start_date || "즉시")} ~ ${esc(p.end_date || "끌 때까지")}` : "기간 제한 없음";
    return `<li>${state[0]}<span class="notice-title">${esc(p.title)}</span>
      <small class="txt-muted">${esc(term)} · ${esc(state[1])}</small>
      <form method="post" action="${base}/admin/popup/${p.id}/toggle" class="inline-form"><button class="btn btn-xs btn-ghost">${p.enabled ? "내리기" : "다시 띄우기"}</button></form>
      <form method="post" action="${base}/admin/popup/${p.id}/delete" data-confirm="팝업을 삭제할까요?"><button class="link-danger">삭제</button></form></li>`;
  }).join("") : `<li class="empty">팝업이 없습니다.</li>`;
  const popupPanel = `<section class="panel" id="p-popup"><h2 class="panel-title">홈 팝업 <span class="badge badge-muted">${popupList.filter((p) => p.enabled).length}개 켜짐</span></h2>
      <p class="panel-hint">홈 첫 화면에 안내창을 띄웁니다. 손님이 보는 화면을 가로막는 유일한 기능이라,
        <b>노출 기간을 정해 두면 그날이 지나 자동으로 내려갑니다</b> — 내리는 것을 잊어 지난 행사 안내가 몇 달씩 뜨는 일이 없습니다.
        방문자는 <b>오늘 하루 보지 않기</b>로 닫을 수 있고, 그 선택은 그 사람 휴대폰에만 남습니다.</p>
      <form method="post" action="${base}/admin/popup" enctype="multipart/form-data" class="stack-form compact">
        <input type="text" name="title" placeholder="팝업 제목 (예: 여름 골목 야시장 안내)" maxlength="100" required />
        <textarea name="body" rows="3" maxlength="500" placeholder="내용 (선택)"></textarea>
        <div class="form-two"><label class="mini-label">노출 시작 <small>(비우면 즉시)</small><input type="date" name="start_date" /></label>
          <label class="mini-label">노출 종료 <small>(비우면 끌 때까지)</small><input type="date" name="end_date" /></label></div>
        <div class="form-two"><label class="mini-label">누르면 갈 주소 <small>(선택)</small><input type="text" name="link_url" placeholder="https:// 또는 /t/…" maxlength="300" /></label>
          <label class="mini-label">버튼 문구 <small>(선택)</small><input type="text" name="link_label" placeholder="자세히 보기" maxlength="30" /></label></div>
        <label class="mini-label">이미지 <small>(선택)</small><input type="file" name="image" accept="image/*" /></label>
        <button class="btn btn-primary btn-sm">팝업 등록</button></form>
      <ul class="admin-mini-list">${popupRows}</ul></section>`;
  // 회비 장부: ?due_period=YYYY-MM (기본 이번 달)
  const duePeriod = duePeriod0;
  const paidSet = new Set(dueRowsRaw.map((r) => r.user_id));
  const dueRows = members.map((m) => `<tr><td>${esc(m.name)}<br /><small>${esc(m.business_name || "")}</small></td>
    <td>${paidSet.has(m.id) ? '<span class="badge badge-ok">납부</span>' : '<span class="badge badge-wait">미납</span>'}</td>
    <td class="actions-cell"><form method="post" action="${base}/admin/dues" class="inline-form">
      <input type="hidden" name="period" value="${esc(duePeriod)}" /><input type="hidden" name="user_id" value="${m.id}" /><input type="hidden" name="on" value="${paidSet.has(m.id) ? "0" : "1"}" />
      <button class="btn btn-xs ${paidSet.has(m.id) ? "btn-ghost" : "btn-primary"}">${paidSet.has(m.id) ? "납부 취소" : "납부 체크"}</button></form></td></tr>`).join("")
    || `<tr><td colspan="3" class="empty">회원이 없습니다.</td></tr>`;
  const duesPanel = `<section class="panel" id="p-dues"><div class="panel-head"><h2 class="panel-title">회비 장부 <span class="badge badge-muted">${paidSet.size}/${members.length} 납부</span></h2>
      <form method="get" action="${base}/admin" class="inline-form"><input type="month" name="due_period" value="${esc(duePeriod)}" data-autosubmit /><button class="btn btn-xs btn-ghost">이동</button></form></div>
    <p class="panel-hint">납부 <b>기록</b>만 남기는 장부입니다(결제 아님). 월을 바꿔 지난 달 현황도 볼 수 있습니다.</p>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>회원</th><th>${esc(duePeriod)}</th><th>처리</th></tr></thead><tbody>${dueRows}</tbody></table></div></section>`;
  // ----- 알림톡: 잔액·충전 신청·발송 이력 -----
  const [balance, msgStats, msgs, orders, unitPrice] = await Promise.all([
    D.getBalance(db, assoc.id), D.messageStats(db, assoc.id), D.listMessages(db, assoc.id, 10),
    D.listCreditOrders(db, assoc.id, 5), priceOf(db, "alimtalk", assoc.id),
  ]);
  const withPhone = members.filter((m) => m.phone).length;
  const sendable = unitPrice > 0 ? Math.floor(balance / unitPrice) : 0;
  const orderRows = orders.length ? orders.map((o) => `<li>${o.amount.toLocaleString()}원 · ${esc(kstStamp(o.created_at, { year: false }))}
    ${o.status === "approved" ? '<span class="badge badge-ok">충전 완료</span>' : o.status === "rejected" ? '<span class="badge badge-no">반려</span>' : '<span class="badge badge-wait">입금 확인 중</span>'}</li>`).join("") : "";
  const msgRows = msgs.length ? msgs.map((m) => `<tr><td>${esc(kstStamp(m.created_at, { year: false }))}</td><td>${esc(m.kind || "-")}</td>
    <td>${esc(m.recipient)}</td><td>${m.status === "sent" ? '<span class="badge badge-ok">발송</span>' : `<span class="badge badge-no">실패</span>`}</td>
    <td>${m.cost ? m.cost.toLocaleString() + "원" : "-"}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">발송 내역이 없습니다.</td></tr>`;
  // 알림 자동화가 꺼져 있으면(기본) 이 패널은 '잔액'이 아니라 '켜시겠습니까'가 주제다.
  const autoOn = autoNotifyOn(assoc);
  const platformReady = notifyEnabled(env);
  const otpOn = await otpRequired(db);
  const notifyOpen = autoOn ? balance < unitPrice : true;
  const autoSwitch = `<form method="post" action="${base}/admin/notify-auto" class="stack-form compact">
      <input type="hidden" name="on" value="${autoOn ? "0" : "1"}" />
      <div class="row-toggle"><label class="switch"><input type="checkbox" ${autoOn ? "checked " : ""}disabled aria-hidden="true" tabindex="-1" /><span class="track"></span></label>
        <span><b>알림 자동화 ${autoOn ? "켜짐" : "꺼짐"}</b>
          <small style="color:var(--muted)">${autoOn
            ? "서명 요청 · 미서명 재알림 · 완료 안내가 카카오톡으로 자동 발송됩니다"
            : "지금은 한 통도 자동으로 나가지 않습니다 — 서명 링크를 직접 보내 계약을 진행합니다"}</small></span></div>
      <button class="btn ${autoOn ? "btn-ghost" : "btn-primary"} btn-sm"${!autoOn && !platformReady ? " disabled" : ""}>${autoOn ? "자동화 끄기" : "자동화 켜기"}</button>
      ${!autoOn && !platformReady ? `<p class="panel-hint">아직 운영사 쪽 발송 준비(알림톡 심사)가 끝나지 않아 켤 수 없습니다. 끝나면 이 버튼이 열립니다.</p>` : ""}
      ${autoOn && otpOn ? "" : otpOn ? `<p class="panel-hint"><b>본인확인(휴대폰 인증)이 켜져 있습니다.</b> 자동화가 꺼져 있으면 인증번호를 보낼 수 없어 서명이 완료되지 않습니다 — 운영사에 본인확인 해제를 요청하거나 자동화를 켜 주세요.</p>` : ""}
    </form>`;
  const notifyPanel = `<${notifyOpen ? "section" : "details"} class="panel${notifyOpen ? "" : " panel-fold"}${autoOn ? "" : " panel-accent"}" id="p-notify">
      <${notifyOpen ? "h2" : "summary"} class="panel-title">알림 자동화 <span class="badge ${autoOn ? "badge-ok" : "badge-muted"}">${autoOn ? "켜짐" : "꺼짐"}</span>${
        autoOn ? ` <span class="badge ${balance > 0 ? "badge-ok" : "badge-wait"}">잔액 ${balance.toLocaleString()}원</span>` : ""}</${notifyOpen ? "h2" : "summary"}>
    ${autoSwitch}
    <div class="form-divider">알림톡 요금</div>
    <p class="panel-hint">서명 요청·리마인더를 카카오톡으로 보냅니다. 건당 <b>${unitPrice.toLocaleString()}원</b> — 지금 잔액으로 <b>약 ${sendable.toLocaleString()}건</b> 보낼 수 있습니다.
      알림 받을 회원은 <b>${withPhone}명</b>(휴대폰 등록 기준 · 전체 ${members.length}명)입니다.</p>
    ${autoOn && balance < unitPrice ? `<div class="flash flash-warn"><b>잔액이 부족해 알림톡이 발송되지 않습니다.</b> 아래에서 충전을 신청해 주세요.<br />
      그동안에도 계약은 진행할 수 있습니다 — 문서 화면의 <b>[보내기 · 복사]</b> 로 서명 링크를 카톡·문자로 직접 보내시면 됩니다.</div>` : ""}
    <div class="form-two">
      <form method="post" action="${base}/admin/credit/order" class="stack-form compact">
        <label>충전 금액 <small>(1만원 이상 · 1,000원 단위)</small>
          <input type="number" name="amount" value="50000" min="10000" max="5000000" step="1000" required list="chargePresets" />
          <datalist id="chargePresets"><option value="30000"></option><option value="50000"></option><option value="100000"></option><option value="300000"></option></datalist></label>
        <p class="panel-hint">건당 ${unitPrice.toLocaleString()}원 기준 — 5만원이면 약 ${Math.floor(50000 / unitPrice).toLocaleString()}건입니다.</p>
        <label>입금자명<input type="text" name="depositor" maxlength="40" placeholder="${esc(assoc.name)}" autocomplete="name" /></label>
        <button class="btn btn-primary btn-sm">충전 신청</button></form>
      <div>${orderRows ? `<p class="mini-label">최근 충전 신청</p><ul class="admin-mini-list">${orderRows}</ul>` : `<p class="panel-hint">충전을 신청하면 운영사가 입금을 확인한 뒤 잔액에 반영합니다.</p>`}</div>
    </div>
    <div class="form-divider">발송 이력 <span class="badge badge-muted">누적 ${(msgStats.n || 0).toLocaleString()}건 · ${(msgStats.spent || 0).toLocaleString()}원${msgStats.failed ? ` · 실패 ${msgStats.failed}` : ""}</span></div>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>시각</th><th>종류</th><th>수신</th><th>상태</th><th>차감</th></tr></thead><tbody>${msgRows}</tbody></table></div>
    <p class="panel-hint">실패한 건은 자동으로 환불되어 잔액이 복구됩니다. 수신번호는 개인정보 보호를 위해 가려서 저장합니다.</p>
    </${balance < unitPrice ? "section" : "details"}>`;

  const notifRows = notifs.length ? notifs.map((n) => `<li class="${n.is_read ? "" : "unread"}"><span class="notif-dot"></span><a href="${esc(n.link || base + "/admin")}" class="notif-msg">${esc(n.message)}</a><time>${esc(kstStamp(n.created_at, { year: false }))}</time></li>`).join("") : `<li class="empty">알림이 없습니다.</li>`;
  const noticeCats = NOTICE_CATEGORIES.map((c) => `<option value="${esc(c)}"${c === "안내" ? " selected" : ""}>${esc(c)}</option>`).join("");
  // 어떤 패널을 띄울지는 제품 유형 레지스트리가 정한다 (kinds.js console 스위치).
  // 안 쓰는 화면을 띄우면 콘솔이 어지럽고, 새 제품마다 여기에 if 를 더하면 금세 손을 못 댄다.
  const K = kindOf(assoc);
  const C = K.console;
  const T = assocTerms(assoc);
  const isEsign = K.id === "esign";
  const isFranchise = C.landing;
  const docs = await D.listDocuments(db, assoc.id);
  const docCount = docs.length;
  const leads = isFranchise ? await D.leadStats(db, assoc.id) : null;
  // 아직 연락하지 않은 상담 — 현황 화면에서 이름·연락처까지 보여야 그 자리에서 전화를 건다
  const freshLeads = isFranchise && leads.fresh ? await D.listLeads(db, assoc.id, { status: "new", limit: 6 }) : [];

  // 한 화면에 열두 덩어리가 쏟아지던 것을 하는 일별로 묶는다.
  // 처음 보는 사람이 "여기서 뭘 해야 하나"를 훑지 않고 고를 수 있어야 한다.
  const ADMIN_TABS = [
    ["home", "현황", "", unread || 0],
    [isEsign ? "people" : "people", isEsign ? "담당자" : "회원·점포", "", isEsign ? 0 : (s.pending || 0)],
    ...(isEsign ? [] : [["content", isFranchise ? "가맹점·콘텐츠" : "콘텐츠", "", 0]]),
    ["notify", "알림톡", "", 0],
    ["settings", "설정", "", 0],
  ];

  // ── 며칠 기다렸는지 —— "승인 대기 3" 을 보고도 오늘 온 것인지 일주일 묵은 것인지
  // 알 수 없으면, 그 숫자는 아무 결정도 만들지 못한다.
  const daysSince = (v) => {
    const t = Date.parse(String(v || "").replace(" ", "T") + "Z");
    return isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / 86400000));
  };
  const pendingBiz = all.filter((b) => b.status === "pending");
  // 25 라는 숫자만으로는 좋은지 나쁜지 알 수 없다. 늘고 있는지가 실제로 궁금한 것이다.
  // 다만 없는 변화를 지어내지 않는다 — 0 이면 아예 표시하지 않는다.
  const newBiz30 = all.filter((b) => b.status === "approved" && daysSince(b.created_at) <= 30).length;
  const openDocs = docs.filter((d) => !d.closed);
  const lateDocs = openDocs.filter((d) => isOverdue(d));
  // ── 숫자 줄 —— 숫자는 "결정을 만드는 것" 만 남긴다.
  // 예전에는 승인업체·승인대기·공지·행사·미디어 다섯 개였는데,
  //   · 승인 대기는 바로 위 할 일 상자가 이미 말하고 있었고 (같은 말 두 번),
  //   · 공지 6 · 행사 3 · 미디어 25 는 세어 봐야 아무것도 달라지지 않는 숫자였다.
  // 대신 상인회장이 실제로 궁금해하던 것을 넣는다 — 사람이 오고 있나.
  const visitPct = visits.prev > 0 ? Math.round(((visits.cur - visits.prev) / visits.prev) * 100) : null;
  // ── 참고 숫자 —— 매일 볼 필요 없는 것들. 예전에는 이 넷이 카드로 화면 맨 위를 차지했는데,
  // 넷이 같은 크기라 그중 손이 필요한 하나가 묻혔다. 알약 한 줄로 맨 아래로 내린다.
  const fact = (label, num, up = "") =>
    `<span>${esc(label)} <b>${num}</b>${up ? ` <u>${esc(up)}</u>` : ""}</span>`;
  // 제품마다 궁금한 숫자가 다르다 — 모집 랜딩에 '가입 점포' 를 보여 줘도 쓸모가 없다
  const factRow = `<div class="quiet-sec" id="p-stats"><p class="quiet-h">이번 주</p><p class="facts">${isEsign
    ? fact("진행 중", `${openDocs.length}건`) + fact("체결 완료", `${docCount - openDocs.length}건`)
      + fact("기한 지남", `${lateDocs.length}건`) + fact("담당자", `${staffList.length}명`)
    : isFranchise
      ? fact("상담 신청", `${leads.total.toLocaleString()}건`, leads.week ? `+${leads.week}` : "")
        + fact("아직 연락 못 함", `${leads.fresh}건`) + fact("계약까지 간 건", `${leads.contract}건`)
        + fact("방문", `${visits.cur.toLocaleString()}회`, visitPct !== null ? `${visitPct >= 0 ? "+" : ""}${visitPct}%` : "")
      : fact("방문", `${visits.cur.toLocaleString()}회`, visitPct !== null ? `${visitPct >= 0 ? "+" : ""}${visitPct}%` : "")
        + fact("가입 점포", `${Number(s.businesses).toLocaleString()}곳`, newBiz30 ? `+${newBiz30}` : "")
        + fact("올린 소식", `${(Number(s.notices) + Number(s.events)).toLocaleString()}건`)
        + fact("체결 완료", `${docCount - openDocs.length}건`)
  }</p></div>`;

  // ── 왼쪽 칸 = 처리할 것 · 오른쪽 칸 = 지나간 것.
  //
  // 예전에는 맨 위에 "오늘 처리할 일" 상자가 따로 있었는데, 그 상자와 가입 신청 표와
  // 알림함이 **같은 사건을 세 번** 말하고 있었다 — "입점 신청 2건" · "모둠분식(표)" ·
  // "모둠분식 — 입점 신청이 들어왔습니다(알림)". 세 번 말하면 한눈에 안 들어온다.
  //
  // 그래서 축을 하나로 했다. 처리해야 하는 것은 전부 왼쪽 한 칸에 모으고, 거기서 바로 처리한다.
  // 예전에는 "검토하기 →" 를 눌러 회원·점포 탭으로 넘어가야 승인 단추가 나왔다 —
  // 매일 하는 일이 두 번 클릭이면, 그 화면은 매일 쓰라고 만든 화면이 아니다.
  // ── 손이 필요한 것은 '면' 으로 가른다.
  //
  // 예전에는 급한 것도 흰 패널, 안 급한 것도 흰 패널이라 화면에서 구별이 되지 않았다.
  // 연한 배경색(#EDF2FF)으로 칠해 봤자 흰 바탕과 명도 차가 3% 라 눈에는 같은 흰색이다.
  // 대비를 만드는 것은 셋뿐이다 — ① 면을 채우고 ② 숫자를 키우고 ③ 나머지를 죽인다.
  //
  // 그래서 처리할 것이 있을 때만 브랜드색 블록이 뜬다. 없으면 블록 자체가 사라지므로
  // **파란 덩어리가 보이는 것 자체가 신호**가 된다. 0 이라는 숫자를 읽을 필요가 없다.
  const hotBlock = ({ n, title, note, href, hrefLabel, rows, more }) => `<section class="hot">
    <div class="hot-h"><span class="hot-n">${n}</span>
      <h3>${esc(title)}${note ? `<small>${note}</small>` : ""}</h3>
      ${href ? `<a class="hot-all" href="${href}">${esc(hrefLabel || "전체 보기")} <span aria-hidden="true">→</span></a>` : ""}</div>
    ${rows.join("")}
    ${more ? `<a class="hot-more" href="${href}">${esc(more)} <span aria-hidden="true">→</span></a>` : ""}</section>`;
  const hotRow = (title, sub, acts) => `<div class="hot-row">
    <div class="hot-m"><b>${esc(title)}</b><small>${esc(sub)}</small></div>
    <div class="hot-acts">${acts}</div></div>`;

  const signHot = openDocs.length ? hotBlock({
    n: openDocs.length, title: "서명 대기",
    note: lateDocs.length ? `${lateDocs.length}건은 기한이 지났습니다` : "상대방이 아직 서명하지 않았습니다",
    href: `${base}/admin/documents`, hrefLabel: "계약서 전체",
    // 기한 지난 것이 위로 — 오늘 손이 갈 곳이 맨 앞에 있어야 한다
    rows: [...openDocs].sort((a, b) => (isOverdue(b) ? 1 : 0) - (isOverdue(a) ? 1 : 0)).slice(0, 5).map((d) => {
      const late = isOverdue(d);
      return hotRow(d.title,
        `${late ? `기한 ${daysSince(d.due_date + " 00:00:00")}일 지남` : "서명을 기다리는 중"}${d.due_date && !late ? ` · 기한 ${d.due_date}` : ""}`,
        `<a class="btn btn-sm" href="${base}/admin/documents/${d.id}">${late ? "링크 다시 보내기" : "진행 보기"}</a>`);
    }),
    more: openDocs.length > 5 ? `진행 중인 계약 ${openDocs.length}건 전체 보기` : "",
  }) : "";

  // 가입 신청은 이 자리에서 바로 승인한다 — 매일 하는 일이 '탭 옮겨 가서 누르기' 면 안 된다.
  const applyHot = pendingBiz.length ? hotBlock({
    n: pendingBiz.length, title: "가입 신청", note: "승인하면 그 자리에서 가게 페이지가 열립니다",
    href: `${base}/admin#s-people`, hrefLabel: "회원·점포",
    // 오래 기다린 순 — 3일째 묵은 신청이 오늘 것 아래에 있으면 그 사장님만 계속 밀린다
    rows: [...pendingBiz].sort((a, b) => daysSince(b.created_at) - daysSince(a.created_at)).slice(0, 5).map((b) => {
      const d = daysSince(b.created_at);
      return hotRow(`${b.name} · ${b.owner_name}`,
        `${b.category || "업종 미기재"} · ${d === 0 ? "오늘 신청" : `${d}일째 기다리는 중`}`,
        `<form method="post" action="${base}/admin/business/${b.id}/status" class="inline-form"><input type="hidden" name="status" value="approved"><button class="btn btn-sm">승인</button></form>
         <form method="post" action="${base}/admin/business/${b.id}/status" class="inline-form"><input type="hidden" name="status" value="rejected"><button class="btn btn-sm is-ghost">반려</button></form>`);
    }),
    more: pendingBiz.length > 5 ? `가입 신청 ${pendingBiz.length}건 전체 보기` : "",
  }) : "";

  // 모집 랜딩은 '상담 신청' 이 곧 할 일이다 — 오늘 전화해야 하는 사람.
  const leadHot = isFranchise && leads && leads.fresh ? hotBlock({
    n: leads.fresh, title: "새 상담 신청", note: "아직 연락하지 않은 건입니다",
    href: `${base}/admin/leads`, hrefLabel: "상담 DB",
    rows: freshLeads.slice(0, 5).map((l) => hotRow(`${l.name}${l.company ? ` · ${l.company}` : ""}`,
      `${l.phone || l.email || "연락처 없음"} · ${daysSince(l.created_at) === 0 ? "오늘 접수" : `${daysSince(l.created_at)}일 전 접수`}`,
      `<a class="btn btn-sm" href="${base}/admin/leads">상담 보기</a>`)),
    more: leads.fresh > 5 ? `새 상담 ${leads.fresh}건 전체 보기` : "",
  }) : "";

  const hotPanels = [applyHot, leadHot, signHot].filter(Boolean).join("");
  const queuePanel = hotPanels || `<p class="all-clear">지금 처리할 일이 없습니다</p>`;

  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><h1 class="dash-title">${esc(kindOf(assoc).dashTitle)}</h1>
      <p class="dash-sub">${isEsign ? "계약 창구" : isFranchise ? "랜딩페이지" : "홈페이지"}: <a href="${base}" target="_blank">${esc(prettyPath(base))}</a></p></div>
      <div class="dash-head-actions">${isFranchise ? `<a href="${base}/admin/leads" class="btn btn-primary btn-sm">상담 DB ${leads.total}건</a>
        <a href="${base}/admin/landing" class="btn btn-ghost btn-sm">랜딩 편집</a>`
        : `<a href="${base}/admin/documents" class="btn btn-primary btn-sm">계약서 만들기</a>`}</div></div>
    ${flashOf(query)}
    <div class="console-grid">
    <aside class="console-side"><nav id="consoleNav">
      ${ADMIN_TABS.map(([id, label, ico, badge]) =>
        `<a href="#s-${id}" data-tab="${id}">${ico} ${esc(label)}${badge ? ` <span class="side-badge">${badge}</span>` : ""}</a>`).join("")}
      <span class="side-sep"></span>
      ${isFranchise ? `<a href="${base}/admin/leads" class="side-ext">상담 DB${leads.fresh ? ` <span class="side-badge">${leads.fresh}</span>` : ""}</a>
      <a href="${base}/admin/landing" class="side-ext">랜딩페이지</a>` : ""}
      ${isEsign || isFranchise ? "" : `<a href="${base}/polls" class="side-ext">안건 투표</a>`}
      <a href="${base}/admin/documents" class="side-ext">계약서</a>
      <a href="${base}/admin/templates" class="side-ext">서식</a>
      <a href="${base}/admin/api" class="side-ext">API 연동</a>
      <a href="${base}" target="_blank" class="side-ext">사이트 보기 ↗</a>
    </nav></aside>
    <div class="console-main">
    <div class="sgroup" id="s-home" data-tab="home">
    <div class="home-sheet">
      ${queuePanel}
      <div class="quiet-sec" id="p-notif">
        <div class="quiet-h">최근 활동${unread ? ` <span class="side-badge">${unread}</span>` : ""}
          ${unread ? `<form method="post" action="${base}/admin/notifications/read" class="inline-form"><button class="btn-linkish">모두 읽음</button></form>` : ""}</div>
        <ul class="notif-list">${notifRows}</ul></div>
      ${factRow}
    </div></div>

    <div class="sgroup" id="s-people" data-tab="people">
    <section class="panel" id="p-members"><div class="panel-head"><h2 class="panel-title">${isEsign ? "담당자 관리" : "회원 관리"} <span class="badge badge-muted">${isEsign ? staffList.length : members.length}명</span></h2>
      <span class="pill-row">${members.length && !isEsign ? `<a class="btn btn-xs btn-ghost" href="${base}/admin/members.csv">명단 CSV</a>` : ""}<a class="btn btn-xs btn-ghost" href="${base}/admin/export.json">전체 백업(JSON)</a></span></div>
      ${isEsign ? `<p class="panel-hint">계약서를 만들고 보내는 사람들입니다. <b>담당자</b>는 계약 업무만 하고 설정·API 키·과금은 볼 수 없습니다.
        권한을 회수해도 계정과 서명 이력은 남습니다 — 지우면 증거가 사라지기 때문입니다.</p>
      <div class="table-scroll"><table class="admin-table"><thead><tr><th>이름</th><th>권한</th>${teams.length ? "<th>부서</th>" : ""}<th>관리</th></tr></thead><tbody>${staffRows}</tbody></table></div>
      ${members.length ? `<div class="form-divider">내부 서명자 <span class="badge badge-muted">${members.length}명</span></div>
        <p class="panel-hint">사내에서 로그인해 서명하는 분들입니다(계약을 만들지는 않습니다).</p>
        <div class="table-scroll"><table class="admin-table"><thead><tr><th>이름</th><th>비밀번호</th></tr></thead><tbody>${members.map((m) => `<tr><td>${esc(m.name)}<br /><small>${esc(m.email)}</small></td>
          <td class="actions-cell"><form method="post" action="${base}/admin/user/${m.id}/reset-password" data-confirm="임시 비밀번호를 발급할까요?"><button class="btn btn-xs btn-ghost">임시 비밀번호</button></form></td></tr>`).join("")}</tbody></table></div>` : ""}`
      : `<div class="table-scroll"><table class="admin-table"><thead><tr><th>회원</th><th>업체</th><th>비밀번호</th></tr></thead><tbody>${memberRows}</tbody></table></div>`}
      ${query.get("invite") ? `<div class="invite-box">
        <p class="invite-box-title">초대 링크가 만들어졌습니다 <small>(7일 유효)</small></p>
        <input type="text" class="invite-url" value="${esc(`${ORIGIN}${base}/invite?t=${encodeURIComponent(query.get("invite"))}`)}" readonly data-select-all />
        <span class="pill-row"><button type="button" class="btn btn-sm btn-primary" data-share data-share-url="${esc(`${ORIGIN}${base}/invite?t=${encodeURIComponent(query.get("invite"))}`)}" data-share-title="${esc(assoc.name)} 입점 초대">카톡으로 보내기 / 복사</button></span>
        <p class="panel-hint">사장님이 링크를 열어 이메일·비밀번호만 정하면 가게가 <b>승인 절차 없이 바로 공개</b>됩니다.</p></div>` : ""}
      ${isEsign ? "" : `<details class="help-box" style="margin-top:14px"${query.get("invite") || s.businesses ? "" : " open"}><summary>사장님 초대 링크 만들기 (가장 쉬운 온보딩)</summary>
        <div class="help-body"><p class="help-lead">가게 이름만 입력해 링크를 만들고 카톡으로 보내세요. 사장님은 이메일·비밀번호만 정하면 끝 — 가게가 바로 공개됩니다.</p>
        <form method="post" action="${base}/admin/invite" class="stack-form compact">
          <div class="form-two"><label>가게 이름<input type="text" name="biz_name" required maxlength="100" /></label><label>업종<select name="category">${CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select></label></div>
          <button class="btn btn-primary btn-sm">초대 링크 만들기</button></form></div></details>`}
      ${isEsign ? `<details class="help-box" style="margin-top:14px" open><summary>담당자 추가</summary>
        <div class="help-body"><p class="help-lead">계약서를 만들고 보낼 사람에게 계정을 발급합니다.
          <b>담당자</b>는 계약 업무만 하고 설정·API 키·과금은 볼 수 없습니다. <b>관리자</b>는 이 콘솔 전부를 함께 씁니다 — 믿을 수 있는 분에게만 주세요.</p>
        <form method="post" action="${base}/admin/admins/add" class="stack-form compact">
          <div class="form-two"><label>성함<input type="text" name="name" required maxlength="60" autocomplete="name" /></label><label>이메일<input type="email" name="email" required maxlength="120" autocomplete="email" /></label></div>
          <div class="form-two"><label>휴대폰 <small>(선택 · 본인확인용)</small><input type="tel" name="phone" maxlength="13" inputmode="numeric" placeholder="010-1234-5678" autocomplete="tel" /></label>
            <label>권한<select name="role">
              <option value="STAFF">담당자 — 계약서 작성·발송만</option>
              <option value="ADMIN">관리자 — 설정·API·과금 포함</option></select></label></div>
          <button class="btn btn-primary btn-sm">계정 발급 + 임시 비번</button></form></div></details>`
      : `<details class="help-box" style="margin-top:14px"><summary>부관리자 추가 (회장·총무 공동 운영)</summary>
        <div class="help-body"><p class="help-lead">관리자 권한 계정을 하나 더 발급합니다. 승인·공지·브랜딩 등 이 콘솔의 모든 기능을 함께 쓸 수 있으니 믿을 수 있는 분에게만 발급하세요.</p>
        ${admins.length > 1 ? `<p class="panel-hint">현재 관리자: ${admins.map((u) => esc(u.name || u.email)).join(", ")}</p>` : ""}
        <form method="post" action="${base}/admin/admins/add" class="stack-form compact">
          <div class="form-two"><label>성함<input type="text" name="name" required autocomplete="name" /></label><label>이메일<input type="email" name="email" required autocomplete="email" /></label></div>
          <button class="btn btn-primary btn-sm">부관리자 발급 + 임시 비번</button></form></div></details>`}
      </section>
    ${isEsign ? "" : addMemberPanel}
    ${isEsign ? teamsPanel : ""}
    ${isEsign || isFranchise ? "" : duesPanel}
    ${isEsign ? "" : `<section class="panel" id="p-biz"><h2 class="panel-title">${isFranchise ? "가맹점" : "업체"} 관리</h2><div class="table-scroll"><table class="admin-table">
      <thead><tr><th>업체</th><th>사장님</th><th>상태</th><th>관리</th></tr></thead><tbody>${bizRows}</tbody></table></div></section>`}
    </div>

${isEsign ? "" : `<div class="sgroup" id="s-content" data-tab="content">`}
${isFranchise ? `    <section class="panel panel-accent" id="p-home"><h2 class="panel-title">랜딩페이지</h2>
      <p class="panel-hint">가맹점 모집 화면의 문구·순서·표시 여부는 전용 편집기에서 바꿉니다. 들어온 상담 신청은 상담 DB 에 쌓입니다.</p>
      <span class="pill-row"><a href="${base}/admin/landing" class="btn btn-primary btn-sm">랜딩페이지 편집</a>
        <a href="${base}/admin/leads" class="btn btn-ghost btn-sm">상담 DB (신규 ${leads.fresh}건)</a>
        <a href="${base}" target="_blank" class="btn btn-ghost btn-sm">공개 화면 보기</a></span></section>`
  : isEsign ? "" : `    <details class="panel panel-fold" id="p-home"><summary class="panel-title">홈페이지 구성 편집 <span class="badge badge-muted">한 번 정해 두는 것</span></summary>
      <p class="panel-hint">섹션을 켜고 끄거나 순서(▲▼)를 바꾸고 문구를 직접 수정할 수 있습니다.</p>
      ${layoutEditor(base, lay)}</details>
${abPanel}`}
    ${isEsign ? "" : `<div id="p-products">${productModPanel}</div>`}
    ${isEsign ? "" : `<div class="dash-grid" id="p-content">
      <section class="panel"><h2 class="panel-title">공지·소식</h2>
        <form method="post" action="${base}/admin/notice" enctype="multipart/form-data" class="stack-form compact">
          <input type="text" name="title" placeholder="제목" required /><textarea name="body" rows="3" placeholder="내용"></textarea>
          <div class="form-two"><label class="mini-label">카테고리<select name="tag">${noticeCats}</select></label><label class="check"><input type="checkbox" name="pinned" value="1" /> 상단 고정</label></div>
          <label class="mini-label">대표 이미지 <small>(선택)</small><input type="file" name="image" accept="image/*" /></label>
          <button class="btn btn-primary btn-sm">등록</button></form>
        <ul class="admin-mini-list">${noticeRows2}</ul></section>
      <section class="panel"><h2 class="panel-title">행사</h2>
        <form method="post" action="${base}/admin/event" enctype="multipart/form-data" class="stack-form compact">
          <input type="text" name="title" placeholder="행사명" required /><input type="date" name="event_date" required />
          <input type="text" name="place" placeholder="장소" /><textarea name="description" rows="2" placeholder="설명"></textarea>
          <label class="mini-label">대표 이미지 <small>(선택 · 홈에 포스터형 카드로 표시)</small><input type="file" name="image" accept="image/*" /></label>
          <button class="btn btn-primary btn-sm">등록</button></form>
        <ul class="admin-mini-list">${eventRows}</ul></section></div>`}
    ${isEsign || isFranchise ? "" : `<div id="p-popup-wrap">${popupPanel}</div>`}
    ${isEsign ? "" : "</div>"}

    <div class="sgroup" id="s-notify" data-tab="notify">${notifyPanel}</div>

    <div class="sgroup" id="s-settings" data-tab="settings">
    <section class="panel" id="p-brand"><h2 class="panel-title">${isEsign ? "조직 정보 · 브랜딩" : isFranchise ? "브랜드 정보 · 브랜딩" : "상인회 정보 · 브랜딩"}</h2>
      <form method="post" action="${base}/admin/settings" enctype="multipart/form-data" class="stack-form">
        <div class="form-two"><label>${isEsign ? "조직" : isFranchise ? "브랜드" : "상인회"} 이름<input type="text" name="name" value="${esc(assoc.name)}" required autocomplete="name" /></label><label>대표 색상<input type="color" name="brand_color" id="brandColor" value="${esc(assoc.brand_color)}" /></label></div>
        ${isEsign ? "" : `<fieldset class="theme-pick"><legend>우리 상권에 어울리는 색 <small>(눌러서 위 색상에 적용)</small></legend>
          <div class="theme-swatches">${AREA_THEMES.map((t) => `<button type="button" class="theme-sw${t.color.toLowerCase() === String(assoc.brand_color).toLowerCase() ? " is-on" : ""}" data-theme-color="${t.color}"
            style="--sw:${t.color}" title="${esc(t.hint)}"><span class="theme-dot" aria-hidden="true"></span><span class="theme-name">${esc(t.label)}</span></button>`).join("")}</div>
          <p class="panel-hint">여기 있는 색은 모두 <b>흰 글자를 얹어도 읽히는지</b> 미리 재 둔 것입니다.
            나머지 밝기 단계와 글자색은 이 색에서 자동으로 만들어집니다. 원하는 색이 따로 있으면 위 색상 네모에서 직접 고르셔도 됩니다.</p>
        </fieldset>`}
        <label>한 줄 소개<input type="text" name="tagline" value="${esc(assoc.tagline)}" /></label>
        <div class="form-two"><label>대표 전화<input type="text" name="phone" value="${esc(assoc.phone)}" autocomplete="tel" /></label><label>이메일<input type="email" name="email" value="${esc(assoc.email)}" autocomplete="email" /></label></div>
        <label>주소<input type="text" name="address" value="${esc(assoc.address)}" autocomplete="street-address" /></label>
        <label class="mini-label">로고 <small>(선택·이미지)</small><input type="file" name="logo" accept="image/*" /></label>
        <label class="mini-label">홈 첫 화면 배경 사진 <small>(가로 사진 권장 · 비우면 먹빛 바탕만 남습니다)</small><input type="file" name="hero_image" accept="image/*" /></label>
        <label class="mini-label">홈 히어로 배경 영상 <small>(선택·MP4 또는 WebM·8MB 이하)</small><input type="file" name="hero_video" accept="video/mp4,video/webm" /></label>
        <p class="panel-hint"><b>영상을 넣으실 거면 배경 사진도 함께 올려 주세요.</b> 그 사진이 영상이 뜨기 전 화면이 되고,
          데이터를 아끼거나 움직임을 꺼 둔 방문자에게는 사진만 보입니다. 소리는 나가지 않습니다(무음 자동재생).
          10~15초짜리 짧은 반복 영상이 가장 잘 어울립니다 — 길고 무거운 영상은 첫 화면이 늦게 뜹니다.</p>
        ${assoc.hero_video ? `<div class="hero-img-cur"><video src="${esc(mediaUrl(assoc.hero_video))}" muted playsinline preload="metadata" style="max-width:220px;border-radius:8px"></video>
          <label class="check"><input type="checkbox" name="hero_video_clear" value="1" /> 현재 영상 제거</label></div>` : ""}
        ${assoc.hero_image ? `<div class="hero-img-cur"><img src="${esc(mediaUrl(assoc.hero_image))}" alt="현재 히어로 배경" loading="lazy" /><label class="check"><input type="checkbox" name="hero_image_clear" value="1" /> 현재 사진 제거하고 그라데이션으로</label></div>` : ""}
        <div class="form-divider">검색 노출 (선택) — 네이버·구글에 사이트를 등록할 때 발급받는 소유 확인 코드</div>
        <div class="form-two"><label>네이버 서치어드바이저 코드<input type="text" name="naver_verification" value="${esc(assoc.naver_verification || "")}" placeholder="content=&quot;…&quot; 안의 값만" /></label>
          <label>구글 서치콘솔 코드<input type="text" name="google_verification" value="${esc(assoc.google_verification || "")}" placeholder="content=&quot;…&quot; 안의 값만" /></label></div>
        <label>구글 애널리틱스 측정 ID <small>(선택 · 방문자 통계)</small><input type="text" name="ga_measurement_id" value="${esc(assoc.ga_measurement_id || "")}" placeholder="G-XXXXXXXXXX" maxlength="30" /></label>
        <p class="panel-hint">구글 애널리틱스에서 <b>데이터 스트림</b>을 만들면 나오는 <code>G-</code> 로 시작하는 값입니다.
          넣으면 이 상인회의 모든 화면에서 방문자 수·유입 경로가 집계됩니다. 비우면 아무것도 보내지 않습니다.
          방문자 IP 는 익명화해서 보냅니다.</p>
        <p class="panel-hint">입력하면 모든 페이지에 확인 메타 태그가 자동 삽입됩니다. 등록 후 사이트맵 <code>/sitemap.xml</code> 과 RSS <code>${esc(prettyPath(base))}/feed.xml</code> 을 제출하세요.</p>
        <button class="btn btn-primary btn-sm">브랜딩 저장</button></form></section>
    ${auditPanel}
    </div>
        </div></div></div></section>`;
  return html(layout({ title: "관리자", assoc, base, user, body, activeNav: `${base}/admin`, csrf,
    scripts: `<script src="${assetUrl("/js/layout-editor.js")}" defer></script><script src="${assetUrl("/js/upload-resize.js")}" defer></script><script src="${assetUrl("/js/file-preview.js")}" defer></script><script src="${assetUrl("/js/share.js")}" defer></script><script src="${assetUrl("/js/super-tabs.js")}" defer></script>${kakaoReady ? `<script src="${assetUrl("/js/place.js")}" defer></script>` : ""}` }));
}

// 기한이 지났는가 — due_date 는 'YYYY-MM-DD' 이고 그날 자정까지로 본다(KST 기준).
export function isOverdue(d, now = Date.now()) {
  if (d.closed || !d.due_date) return false;
  const today = new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
  return d.due_date < today;
}

// 진행 중인 계약 — 전자계약 조직 관리자가 매일 확인하는 유일한 것.
// 예전엔 이걸 보려면 계약서 화면으로 따로 들어가야 했고, 대시보드 첫 화면은
// 알림함·담당자·브랜딩이 차지하고 있었다. 매일 하는 일이 맨 앞에 와야 한다.
function inFlightPanel(base, docs) {
  const open = docs.filter((d) => !d.closed);
  if (!open.length) {
    return `<section class="panel"><h2 class="panel-title">진행 중인 계약</h2>
      <p class="panel-hint">${docs.length ? "서명을 기다리는 계약이 없습니다. 모두 체결됐습니다." : "아직 만든 계약이 없습니다."}
        <a href="${base}/admin/documents">계약서 만들기 →</a></p></section>`;
  }
  // 급한 것이 위로 — 기한 지난 것, 그다음 기한 가까운 것, 기한 없는 것은 뒤로
  const sorted = [...open].sort((a, b) => {
    const A = a.due_date || "9999-99-99", B = b.due_date || "9999-99-99";
    return A < B ? -1 : A > B ? 1 : 0;
  });
  const overdue = sorted.filter((d) => isOverdue(d)).length;
  const rows = sorted.slice(0, 8).map((d) => {
    const late = isOverdue(d);
    return `<tr class="${late ? "row-late" : ""}">
      <td><a href="${base}/admin/documents/${d.id}">${esc(d.title)}</a></td>
      <td>${Number(d.signer_count) > 0 ? `${d.sign_count}/${d.signer_count}명` : `${d.sign_count}명`}</td>
      <td>${d.due_date
        ? `${esc(d.due_date)} ${late ? '<span class="badge badge-no">기한 지남</span>' : ""}`
        : '<span class="muted">기한 없음</span>'}</td>
      <td class="actions-cell"><a class="btn btn-xs btn-ghost" href="${base}/admin/documents/${d.id}">열기</a></td></tr>`;
  }).join("");
  return `<section class="panel ${overdue ? "panel-warn" : ""}"><div class="panel-head">
      <h2 class="panel-title">진행 중인 계약 <span class="badge ${overdue ? "badge-no" : "badge-wait"}">${open.length}건${overdue ? ` · 기한 지남 ${overdue}` : ""}</span></h2>
      <span class="pill-row"><a class="btn btn-xs btn-ghost" href="${base}/admin/documents">전체 보기</a></span></div>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>계약서</th><th>서명</th><th>기한</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${open.length > 8 ? `<p class="panel-hint">기한이 급한 8건만 보여 드립니다. 나머지는 <a href="${base}/admin/documents">전체 보기</a>에서.</p>` : ""}
    ${overdue ? `<p class="panel-hint"><b>기한이 지난 계약이 ${overdue}건 있습니다.</b> 계약서를 열어 <b>미서명자 재알림</b>을 보내거나, 상대방에게 직접 연락하세요.</p>` : ""}
  </section>`;
}


// 상인회 전체 데이터 내보내기 (백업·이전용 JSON)
export async function adminExportAll(ctx) {
  const { db, assoc } = ctx;
  const [members, businesses, notices, events] = await Promise.all([
    D.listUsersByAssociation(db, assoc.id, "MERCHANT"),
    D.listBusinessesPaged(db, assoc.id, { perPage: 100000 }).then((r) => r.items),
    D.listNotices(db, assoc.id, 100000),
    D.listEvents(db, assoc.id, false),
  ]);
  const products = await D.listAssocProducts(db, assoc.id);
  const dump = {
    exported_at: new Date().toISOString(),
    association: { name: assoc.name, slug: assoc.slug, tagline: assoc.tagline, phone: assoc.phone, email: assoc.email, address: assoc.address },
    counts: { members: members.length, businesses: businesses.length, products: products.length, notices: notices.length, events: events.length },
    members: members.map((m) => ({ name: m.name, email: m.email, business: m.business_name || "" })),
    businesses: businesses.map((b) => ({ name: b.name, category: b.category, description: b.description, phone: b.phone, address: b.address, hours: b.hours, status: b.status })),
    products: products.map((p) => ({ business: p.biz_name, name: p.name, price: p.price, description: p.description, sold_out: !!p.sold_out, hidden: !!p.hidden })),
    notices: notices.map((n) => ({ title: n.title, tag: n.tag, body: n.body, pinned: !!n.pinned, created_at: n.created_at })),
    events: events.map((e) => ({ title: e.title, date: e.event_date, place: e.place, description: e.description })),
  };
  return text(JSON.stringify(dump, null, 2), 200, { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="backup_${assoc.slug}.json"`, "cache-control": "no-store" });
}

export async function adminExportMembers(ctx) {
  const { db, assoc } = ctx;
  const members = await D.listSignerCandidates(db, assoc.id, assoc.kind);
  const lines = [["이름", "이메일", "업체명", "역할"], ...members.map((m) => [m.name, m.email, m.business_name || "", m.role])];
  const csv = "﻿" + lines.map((r) => r.map(csvCell).join(",")).join("\r\n");
  return text(csv, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="members_${assoc.slug}.csv"`, "cache-control": "no-store" });
}

// ================= 전자서명 =================
export async function signList(ctx) {
  const { db, assoc, base, user, query, csrf } = ctx;
  const todo = await D.listDocumentsToSign(db, assoc.id, user.id, user.role);
  const all = await D.listDocuments(db, assoc.id);
  const signedFlags = await Promise.all(all.map((d) => D.hasSigned(db, d.id, user.id)));
  const todoRows = todo.length ? todo.map((d) => `<li><a href="${base}/sign/${d.id}"><span class="notice-tag tag-important">서명 필요</span>
    <span class="notice-title">${esc(d.title)}${d.ordered ? ' <span class="badge badge-info">순차</span>' : ""}${d.due_date ? ` <span class="badge badge-wait">~${esc(d.due_date)}</span>` : ""}</span><time>${esc(kstDate(d.created_at, "."))}</time></a></li>`).join("") : `<li class="empty">서명하실 문서가 없습니다. 계약서를 받으시면 카카오톡·문자로 링크가 옵니다.</li>`;
  const doneRows = all.filter((_, i) => signedFlags[i]).map((d) => `<li><span class="notice-tag badge-ok">서명 완료</span><span class="notice-title">${esc(d.title)}</span></li>`).join("") || `<li class="empty">아직 서명하신 계약이 없습니다.</li>`;
  const body = `<section class="section page-top"><div class="container narrow">
    <a href="${assoc.kind === "esign" ? base + "/" : base + "/dashboard"}" class="back-link">← ${assoc.kind === "esign" ? "홈" : "내 업체"}</a>
    <div class="section-head" style="text-align:left"><h1 class="section-title">전자서명</h1></div>${flashOf(query)}
    <h2 class="biz-section-title">서명 대기 (${todo.length})</h2><ul class="notice-list">${todoRows}</ul>
    <h2 class="biz-section-title" style="margin-top:32px">서명 완료</h2><ul class="notice-list">${doneRows}</ul></div></section>`;
  return html(layout({ title: "전자서명", assoc, base, user, body, csrf }));
}
export async function signForm(ctx) {
  const { db, assoc, base, user, params, query, csrf } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  if (!d || d.association_id !== assoc.id) return notFoundResponse(ctx);
  if (await D.hasSigned(db, d.id, user.id)) return back(base + "/sign", "이미 서명한 문서입니다.");
  if (d.closed) return back(base + "/sign", "마감된 문서입니다.", true);
  if (D.isPastDue(d)) return back(base + "/sign", "서명 기한이 지난 문서입니다.", true);
  if (!(await D.canReceiveSign(db, d.id, user.id, user.role))) return back(base + "/sign", "이 문서의 서명 대상이 아닙니다.", true);
  const meta = `${d.ordered ? '<span class="badge badge-info">순차 서명</span>' : ""}${d.due_date ? `<span class="badge badge-wait">기한 ${esc(d.due_date)}</span>` : ""}`;
  if (!(await D.canSignNow(db, d, user.id))) {
    const wb = `<section class="section page-top"><div class="container narrow"><a href="${base}/sign" class="back-link">← 서명 목록</a>
      <h1 class="article-title">${esc(d.title)}</h1><p>${meta}</p><div class="doc-body">${docBody(d.body)}</div>
      <div class="flash flash-warn">순차 서명 문서입니다. 앞 순번의 서명이 완료되면 서명하실 수 있습니다.</div></div></section>`;
    return html(layout({ title: d.title, assoc, base, user, body: wb, csrf }));
  }
  // 본인확인(OTP) — 켜져 있으면 인증 전에는 서명 폼을 내주지 않는다
  const needOtp = await otpRequired(db);
  const otpDone = needOtp ? await D.otpVerifiedRecently(db, d.id, user.id) : true;
  const hasPhone = D.isValidPhone(user.phone || "");
  const otpBlock = !needOtp || otpDone ? "" : `<section class="panel panel-accent otp-gate">
      <h2 class="panel-title">휴대폰 본인확인</h2>
      ${hasPhone
        ? `<p class="panel-hint">본인 확인을 위해 <b>${esc(D.maskPhone(user.phone))}</b> 으로 인증번호를 보냅니다. 확인 후 서명할 수 있습니다.</p>
           <div class="form-two">
             <form method="post" action="${base}/sign/${d.id}/otp" class="stack-form compact"><button class="btn btn-ghost btn-sm">인증번호 받기</button></form>
             <form method="post" action="${base}/sign/${d.id}/otp/verify" class="stack-form compact">
               <label>인증번호 6자리<input type="text" name="code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required autocomplete="one-time-code" /></label>
               <button class="btn btn-primary btn-sm">확인</button></form></div>`
        : `<div class="flash flash-warn">본인확인용 휴대폰이 등록되어 있지 않습니다. <a href="/account">계정 설정</a>에서 번호를 등록한 뒤 다시 시도해 주세요.</div>`}
    </section>`;
  // 열람 기록 — "못 봤다"는 항변을 막는 증거. 연타로 기록이 폭주하지 않게 10분에 한 번만 남긴다.
  await D.logDocEvent(db, { documentId: d.id, userId: user.id, actorName: user.name, kind: "viewed",
    ip: ctx.ip || "", userAgent: ctx.request.headers.get("user-agent") || "", dedupeMin: 10 });
  // 지면에 배치된 필드가 있으면 "계약서 위에서 직접 채우는" 방식으로, 없으면 종래의 단일 서명란으로.
  const scans = await D.listDocPages(db, d.id);   // 올린 양식이면 이 그림들이 지면이다
  const fields = await D.listFieldsWithValues(db, d.id);
  const reqs = fields.length ? await D.listRequestStatus(db, d.id) : [];
  const extNames2 = fields.length ? await D.listExternalSigners(db, d.id) : [];
  const nameOf = (ref) => { if (ref < 0) { const e = extNames2.find((x) => x.id === -ref); return e ? e.name : ""; }
    const u = reqs.find((r) => r.id === ref); return u ? u.name : ""; };
  const myFields = fields.filter((f) => !f.value && !f.image && (f.assignee === user.id || f.assignee === 0));
  const hasSignField = myFields.some((f) => f.kind === "sign");
  const docView = fields.length
    ? `<div class="paper-wrap">${renderPaper(d.body, { scans, mediaUrl, mode: otpDone ? "fill" : "view", fieldsFor: fieldsRenderer(fields, { mode: otpDone ? "fill" : "view", myId: user.id, nameOf }) })}</div>`
    : `<div class="doc-body">${docBody(d.body)}</div>`;
  const fillBar = fields.length && otpDone ? `<div class="field-progress" id="fieldProgress"></div>
    <button type="button" class="btn btn-ghost btn-sm field-jump" id="fieldJump" hidden>다음 항목으로 이동 ↓</button>` : "";
  const padBlock = hasSignField ? "" : `<label>서명<div class="sign-pad-wrap"><canvas id="signPad" class="sign-pad" width="600" height="200"></canvas><button type="button" class="btn btn-ghost btn-xs sign-clear" id="signClear">지우기</button></div></label>`;
  const dialog = fields.length && otpDone ? `<div class="fd-back" id="fieldDialog" hidden><div class="fd-box">
      <h3 class="fd-title" id="fdTitle"></h3><div id="fdBody"></div>
      <div class="fd-actions"><button type="button" class="btn btn-ghost btn-sm" id="fdCancel">취소</button>
        <button type="button" class="btn btn-primary btn-sm" id="fdOk">확인</button></div></div></div>` : "";
  const body = `<section class="section page-top"><div class="container${fields.length ? "" : " narrow"}"><a href="${base}/sign" class="back-link">← 서명 목록</a>
    <h1 class="article-title">${esc(d.title)}</h1>${meta ? `<p>${meta}</p>` : ""}
    ${flashOf(query)}
    ${otpBlock}
    ${fillBar}
    ${fields.length ? plainRead(d.body) : ""}
    ${docView}
    ${d.attachment ? `<p class="doc-attach">계약서 원문: <a href="${esc(mediaUrl(d.attachment))}" target="_blank" rel="noopener">${esc(d.attachment_name || "계약서.pdf")}</a> <small>— 이 파일의 내용도 해시에 포함되어 봉인됩니다</small></p>` : ""}
    <details class="doc-hash"><summary>문서 지문 <code>${esc(String(d.content_hash).slice(0, 8))}…${esc(String(d.content_hash).slice(-8))}</code></summary>
      <p>이 계약서 내용으로 계산한 값입니다. 글자 하나만 바뀌어도 값이 달라지므로, 나중에 문서가 바뀌지 않았는지 이 값으로 확인할 수 있습니다.</p>
      <code>${esc(d.content_hash)}</code></details>
    ${otpDone ? `${needOtp ? '<p class="otp-ok">휴대폰 본인확인 완료 — 이 서명에는 본인확인 기록이 함께 남습니다.</p>' : ""}
    <form method="post" action="${base}/sign/${d.id}" class="stack-form sign-form" id="signForm" enctype="multipart/form-data">
      ${padBlock}
      <input type="hidden" name="signature" id="signatureData" />
      <input type="hidden" name="fields" id="fieldValues" />
      ${fileInputs(myFields)}
      <label>서명자 성명<input type="text" name="signer_name" id="signerName" value="${esc(user.name)}" required autocomplete="name" /></label>
      <label class="check check-tap"><input type="checkbox" name="consent" value="1" required id="signConsent" /> 위 내용을 확인했으며 본인이 전자서명하는 데 동의합니다.</label>
      <button class="btn btn-primary btn-block" id="signSubmit">전자서명 제출</button>
      <p class="sign-why" id="signWhy">위 <b>동의</b>에 체크하면 제출할 수 있습니다.</p></form>` : ""}
    ${dialog}
    <p class="auth-note">서명 시 서명자·시각·IP·기기·문서해시가 기록되고 Ed25519 디지털 서명으로 봉인됩니다.</p>
    <details class="decline-box"><summary>이 문서에 동의할 수 없습니다 (거절)</summary>
      <form method="post" action="${base}/sign/${d.id}/decline" class="stack-form compact" data-confirm="거절하면 이 문서는 서명 목록에서 사라집니다. 계속할까요?">
        <label>거절 사유<textarea name="reason" rows="3" required maxlength="300" placeholder="예: 3조 임대료 조항에 동의하기 어렵습니다"></textarea></label>
        <button class="btn btn-ghost btn-sm">서명 거절</button></form>
      <p class="panel-hint">사유는 상인회 관리자에게 그대로 전달됩니다.</p></details></div></section>`;
  const scripts = `<script src="${assetUrl("/js/sign.js")}" defer></script>` +
    (fields.length ? `<script src="${assetUrl("/js/paper.js")}" defer></script>` : "");
  return html(layout({ title: `서명: ${d.title}`, assoc, base, user, body, csrf, scripts }));
}

export async function adminDocuments(ctx) {
  const { db, assoc, base, user, query, csrf } = ctx;
  // 담당자(STAFF)는 /admin·/admin/api 가 403 이다 — 못 가는 곳으로 가는 링크를 그리면 안 된다
  const canAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";
  const today = new Date().toISOString().slice(0, 10);

  // ---- 목록: 찾을 수 있어야 목록이다 ----
  // 계약이 쌓이면 날짜순 한 덩어리로는 아무것도 못 한다. 상태 칩 · 검색 · 쪽 나눔.
  const q = cap((query.get("q") || "").trim(), 60);
  const stat = D.DOC_STATUSES.includes(query.get("stat") || "") ? query.get("stat") : "";
  const page = Math.max(1, Number(query.get("p") || 1) | 0);
  const PER = 20;
  const counts = await D.documentCounts(db, assoc.id, q, { assoc, user });
  const docs = await D.listDocumentsPage(db, assoc.id, { q, status: stat, limit: PER, offset: (page - 1) * PER, assoc, user });
  const shown = stat ? counts[stat] : counts.all;
  const pages = Math.max(1, Math.ceil(shown / PER));
  const qs = (over = {}) => {
    const v = { q, stat, p: page, ...over };
    const u = new URLSearchParams();
    if (v.q) u.set("q", v.q);
    if (v.stat) u.set("stat", v.stat);
    if (v.p && v.p > 1) u.set("p", String(v.p));
    const t = u.toString();
    return `${base}/admin/documents${t ? "?" + t : ""}`;
  };
  const chip = (key, label, n) => `<a class="doc-chip${stat === key ? " on" : ""}${n && (key === "overdue" || key === "declined") ? " is-alert" : ""}" href="${qs({ stat: key, p: 1 })}">${esc(label)} <b>${n}</b></a>`;
  const chips = `<div class="doc-chips">${chip("", "전체", counts.all)}${D.DOC_STATUSES.map((k) => chip(k, D.DOC_STATUS_LABEL[k], counts[k])).join("")}</div>`;

  // 계약 한 건 = 티켓 카드 한 장 (디자인 시스템 v3 · 레퍼런스 '나의 티켓').
  // 머리띠에 기한과 '며칠 남음', 이름표 줄에 제목과 서명자 수, 큰 숫자 두 개로 서명 진행.
  // 표를 버린 이유: 휴대폰에서 다섯 칸 표는 가로로 넘치고, 관리자는 대부분 휴대폰으로 확인한다.
  const rows = docs.length ? `<div class="tk-list">${docs.map((d) => {
    const when = d.due_date || String(d.created_at || "").slice(0, 10);
    const right = d.status === "done" ? "체결 완료" : d.status === "closed" ? "마감"
      : d.status === "declined" ? "반려 있음"
      : d.due_date ? daysLeftText(d.due_date, today) : "진행 중";
    const tone = d.status === "overdue" || d.status === "declined" ? " is-alert" : d.status === "done" ? " is-done" : "";
    return `<article class="tk-card${tone}">
      <div class="tk-band"><span>${esc(ymdDow(when))}${d.due_date ? "" : " 보냄"}</span><b>${esc(right)}</b></div>
      <div class="tk-body">
        <div class="tk-row"><span>${esc(d.title)}${d.ordered ? " · 순차" : ""}</span><small>${d.total ? `${d.total}명` : "전체 회원"}${d.author_name ? ` · ${esc(d.author_name)}` : ""}</small></div>
        <div class="tk-route">
          <div class="tk-pt"><small>서명함</small><b>${d.signed}</b></div>
          <div class="tk-arrow" aria-hidden="true"><svg viewBox="0 0 26 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7h20"/><path d="M17 2l5 5-5 5"/></svg></div>
          <div class="tk-pt"><small>전체</small><b>${d.total || "—"}</b></div>
        </div>
      </div>
      <div class="tk-actions"><a class="btn btn-outline" href="${base}/admin/documents/${d.id}">계약서 확인</a></div>
    </article>`;
  }).join("")}</div>`
    : `<div class="tk-empty">${q || stat ? "찾는 계약이 없습니다." : "아직 보낸 계약이 없습니다."}</div>`;
  const pager = pages > 1 ? `<div class="doc-pager">
    ${page > 1 ? `<a class="btn btn-ghost btn-sm" href="${qs({ p: page - 1 })}">← 이전</a>` : ""}
    <span>${page} / ${pages}</span>
    ${page < pages ? `<a class="btn btn-ghost btn-sm" href="${qs({ p: page + 1 })}">다음 →</a>` : ""}</div>` : "";

  const members = await D.listSignerCandidates(db, assoc.id, assoc.kind);
  const checks = members.length ? members.map((m) => `<label class="check member-check"><input type="checkbox" name="members" value="${m.id}" /> ${esc(m.name)} <small>${esc(m.email)}</small></label>`).join("") : `<p class="empty">회원이 없습니다.</p>`;
  // 작성 중(초안) — 아직 계약이 아니다. 보내는 순간 비로소 계약이 된다.
  const drafts = await D.listDrafts(db, assoc.id, { assoc, user });
  const draftRows = drafts.length ? `<ul class="queue-list">${drafts.map((d) => `<li class="queue-item">
      <a class="q-main" href="${base}/admin/documents/write?doc=${d.id}"><b>${esc(d.title)}</b>
        <span>작성 중 · ${d.body ? `${String(d.body).length.toLocaleString()}자` : "아직 비어 있음"}</span></a>
      <a class="q-go" href="${base}/admin/documents/write?doc=${d.id}">이어 쓰기 <span aria-hidden="true">→</span></a></li>`).join("")}</ul>` : "";
  const myTpls = (await D.listTemplates(db, assoc.id)).filter((t) => t.association_id === assoc.id).map(normalizeTemplate);
  const card = (t) => `<a class="tpl-card" href="${base}/admin/documents/new?tpl=${encodeURIComponent(t.id)}">
    <span class="tpl-title">${esc(t.title)}</span>
    <span class="tpl-sum">${esc(t.summary || `${t.vars.length}개 빈칸`)}</span>
    <span class="tpl-meta">${t.vars.length ? `빈칸 ${t.vars.length}` : "빈칸 없음"} · 자리 ${t.fields.length}개${t.ordered ? " · 순차" : ""}</span></a>`;
  const tplCards = builtinsFor(assoc.kind).map(normalizeTemplate).map(card).join("");
  const myCards = myTpls.map(card).join("");
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">전자계약 · ${esc(assoc.name)}</p><h1 class="dash-title">전자서명 문서</h1>
      <p class="dash-sub">${canAdmin ? `<a href="${base}/admin">← 관리자</a>` : `담당자 · ${esc(user.name)}`}</p></div>
      <div class="dash-head-actions"><a href="${base}/admin/templates" class="btn btn-ghost btn-sm">서식 관리</a>${canAdmin ? `<a href="${base}/admin/api" class="btn btn-ghost btn-sm">API 연동</a>` : ""}</div></div>${flashOf(query)}
    <section class="panel panel-accent"><h2 class="panel-title">서식으로 만들기</h2>
      <p class="panel-hint">표준 서식을 고르면 본문과 <b>서명·도장 자리까지</b> 그대로 들어옵니다. 빈칸만 채우면 끝입니다.</p>
      <div class="tpl-grid">${tplCards}</div>
      ${myTpls.length ? `<div class="form-divider">${assoc.kind === "esign" ? "우리 서식" : "우리 상인회 서식"}</div><div class="tpl-grid">${myCards}</div>` : ""}
    </section>
    <section class="panel panel-accent"><div class="panel-head"><h2 class="panel-title">계약서 쓰기</h2>
      <a class="btn btn-primary btn-sm" href="${base}/admin/documents/write">새로 쓰기</a></div>
      <p class="panel-hint">조·항·호를 버튼으로 넣고 오른쪽에서 <b>실제 지면</b>을 보며 씁니다.
        쓰다 말면 <b>임시저장</b>해 두고 다음에 이어 쓰면 됩니다 — 보내기 전에는 서명 요청도 과금도 없습니다.</p>
      ${draftRows}</section>
    ${canAdmin ? `<details class="panel"${assoc.seal_media ? "" : " open"}><summary class="panel-title">우리 직인 ${assoc.seal_media ? "<span class=\"badge badge-ok\">등록됨</span>" : "<span class=\"badge badge-wait\">없음</span>"}</summary>
      <p class="panel-hint">회사는 계약마다 서명하지 않습니다 — <b>직인이 이미 찍힌 계약서</b>를 보내고 상대방만 서명합니다.
        여기에 한 번 올려 두면, 도장 자리를 <b>우리 직인</b>으로 지정할 때마다 자동으로 찍힙니다.
        직인은 서명이 아니라 <b>보내는 쪽이 미리 찍는 표시</b>입니다 — 상대방의 전자서명과 같은 것으로 취급하지 않습니다.</p>
      ${assoc.seal_media ? `<div class="seal-now"><img src="${esc(mediaUrl(assoc.seal_media))}" alt="등록된 직인" />
        <form method="post" action="${base}/admin/seal/delete" data-confirm="직인을 지울까요? 이미 보낸 계약서의 도장은 그대로 남습니다.">
          <button class="btn btn-ghost btn-sm">직인 지우기</button></form></div>` : ""}
      <form method="post" action="${base}/admin/seal" class="stack-form" enctype="multipart/form-data">
        <label class="mini-label">직인 이미지 <small>(PNG 권장 · 배경이 투명하면 글자를 가리지 않습니다 · 8MB 이하)</small>
          <input type="file" name="seal" accept="image/*" required /></label>
        <button class="btn btn-primary btn-sm">${assoc.seal_media ? "직인 바꾸기" : "직인 등록"}</button></form></details>` : ""}
    <details class="panel" id="pdfPanel"><summary class="panel-title">받은 PDF 양식으로 만들기</summary>
      <p class="panel-hint">상대방이 보낸 <b>표준근로계약서·정부 서식·회사 양식</b>을 옮겨 적지 않고 그대로 씁니다.
        PDF 를 고르면 이 화면에서 쪽마다 지면으로 만들고, 그 위에 서명·도장 자리를 놓습니다.
        <b>계약 원문은 올리신 PDF 그대로</b>이며, 그 파일의 해시가 봉인에 들어갑니다.</p>
      <form method="post" action="${base}/admin/documents" class="stack-form" enctype="multipart/form-data">
        <div id="pdfForm">
          <label class="mini-label">PDF 양식 <small>(10MB · 30쪽 이하)</small>
            <input type="file" id="pdfPick" accept="application/pdf" /></label>
          <input type="hidden" name="scan_pages" id="pdfPages" value="" />
          <p class="pdf-status" id="pdfStatus">PDF 를 고르면 여기서 지면으로 만듭니다. 파일은 고르기 전까지 어디에도 올라가지 않습니다.</p>
          <div class="pdf-preview" id="pdfPreview"></div>
        </div>
        <label>제목<input type="text" name="title" required placeholder="예: 2026년 표준근로계약서" autocomplete="off" /></label>
        <div class="form-two"><label>서명 기한 (선택)<input type="date" name="due_date" /></label><label class="check check-inline"><input type="checkbox" name="ordered" value="1" /> 순차 서명</label></div>
        <div class="form-divider">서명 대상</div>
        <label class="check"><input type="radio" name="target" value="all" checked /> 전체 회원</label>
        <label class="check"><input type="radio" name="target" value="select" /> 특정 회원</label>
        <div class="member-picker">${checks}</div>
        <p class="panel-hint">만든 뒤 <b>서명 자리 배치</b> 화면에서 서명·도장 자리를 놓습니다. 놓기 전에는 아무도 서명할 수 없습니다.</p>
        <button class="btn btn-primary" id="pdfSubmit" disabled>이 양식으로 계약서 만들기</button></form></details>
    <details class="panel"><summary class="panel-title">직접 입력해서 만들기</summary>
      <p class="panel-hint">본문을 붙여넣거나 직접 씁니다. <b>제N조</b>·<b>①</b>·<b>1.</b> 로 시작하는 줄은 계약서 조판으로 자동 정리되고,
        그 규칙을 안 따르는 글은 그대로 문단으로 나옵니다.</p>
      <form method="post" action="${base}/admin/documents" class="stack-form" enctype="multipart/form-data">
        <label>제목<input type="text" name="title" required placeholder="예: 2026 가입 동의서" /></label>
        <label>본문<textarea name="body" rows="8" required></textarea></label>
        <label class="mini-label">계약서 PDF 첨부 <small>(선택 · 10MB 이하 · 첨부 내용도 해시에 포함되어 봉인됩니다)</small><input type="file" name="attachment" accept="application/pdf" /></label>
        <div class="form-two"><label>서명 기한 (선택)<input type="date" name="due_date" /></label><label class="check check-inline"><input type="checkbox" name="ordered" value="1" /> 순차 서명</label></div>
        <div class="form-divider">서명 대상</div>
        <label class="check"><input type="radio" name="target" value="all" checked /> 전체 회원</label>
        <label class="check"><input type="radio" name="target" value="select" /> 특정 회원</label>
        <div class="member-picker">${checks}</div>
        <p class="panel-hint">순차 서명 시 위 목록 순서대로 서명 요청이 진행됩니다.</p>
        <button class="btn btn-primary">문서 생성 및 서명 요청</button></form></details>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">보낸 계약</h2>
        <form method="get" action="${base}/admin/documents" class="doc-search" role="search">
          ${stat ? `<input type="hidden" name="stat" value="${esc(stat)}" />` : ""}
          <input type="search" name="q" value="${esc(q)}" placeholder="제목 또는 서명자 이름" aria-label="계약 검색" />
          <button class="btn btn-ghost btn-sm">찾기</button>
          ${q ? `<a class="btn btn-ghost btn-sm" href="${qs({ q: "", p: 1 })}">지우기</a>` : ""}
        </form></div>
      ${chips}
      ${rows}
      ${pager}</section></div></section>`;
  return html(layout({ title: "전자서명 문서", assoc, base, user, body, csrf,
    scripts: `<script src="${assetUrl("/js/pdf-form.js")}" defer></script>` }));
}
export async function adminDocumentDetail(ctx) {
  const { db, env, assoc, base, user, params, csrf, query } = ctx;
  // 상담 DB 에서 이어진 계약이면 신청자를 외부 서명자 폼에 미리 채운다 (이름·번호를 다시 옮겨 적지 않게)
  const lead = Number(query.get("lead")) ? await D.getLead(db, Number(query.get("lead")), assoc.id) : null;
  const d = await docOf(ctx, params.id);
  if (!d || d.association_id !== assoc.id) return notFoundResponse(ctx);
  const sigs = await D.listSignatures(db, d.id);
  const verds = await Promise.all(sigs.map((sig) => verifySignature(env, sig, d)));
  const rows = sigs.length ? sigs.map((sig, i) => { const v = verds[i]; const badge = v.valid ? '<span class="badge badge-ok">유효</span>' : '<span class="badge badge-no">위변조 의심</span>';
    return `<tr><td>${esc(sig.signer_name)}${sig.signer_kind === "external" ? ' <span class="badge badge-info">외부</span>' : ""}<br /><small>${esc(sig.signer_email)}${sig.signer_org ? ` · ${esc(sig.signer_org)}` : ""}</small></td>
      <td>${sig.signature_image ? `<img src="${esc(mediaUrl(sig.signature_image))}" alt="서명" class="sig-thumb" />` : "-"}</td>
      <td><small>${esc(kstStamp(sig.signed_at))} <span class="tz">KST</span><br />IP ${esc(sig.ip)}</small></td>
      <td>${badge}<br /><a href="/certificate/${esc(sig.verify_code)}" target="_blank"><small>확인서</small></a> · <a href="/verify/${esc(sig.verify_code)}" target="_blank"><small>검증</small></a></td></tr>`; }).join("") : `<tr><td colspan="4" class="empty">아직 서명이 없습니다.</td></tr>`;
  const rc = await D.requestCounts(db, d.id);
  const reqStatus = await D.listRequestStatus(db, d.id);
  const fieldN = await D.countFields(db, d.id);
  const events = await D.listDocEvents(db, d.id);
  const pct = rc.total ? Math.round((rc.signed / rc.total) * 100) : 0;
  const nextTurn = d.ordered ? reqStatus.find((u) => !u.signed && !u.declined_at) : null;
  const exts = await D.listExternalSigners(db, d.id);
  const extToken = query && query.get ? query.get("extlink") : "";
  // 링크는 언제든 다시 꺼내 볼 수 있어야 한다.
  // 예전에는 발급 직후 한 번만 보여 주고 사라져서, 창을 닫으면 같은 사람을 또 등록하는 수밖에 없었다.
  // 토큰은 서명값(HMAC)이라 같은 서명자·같은 문서면 늘 같은 값이 나온다 — 다시 계산하면 그만이다.
  const linkOrigin = assoc.custom_domain ? `https://${assoc.custom_domain}` : ORIGIN;
  const extTokens = await Promise.all(exts.map((e) => makeExtToken(env.SESSION_SECRET, e.id, d.id)));
  const canTalk = canAutoSend(env, assoc);
  const otpOn = await otpRequired(db);
  // 카톡·문자에 그대로 붙여 넣을 수 있는 한 통. 모바일은 공유 시트, PC 는 복사된다.
  const shareMsg = (who) => `${who ? who + "님, " : ""}${assoc.name} 「${d.title}」 전자서명 요청입니다.`
    + `${d.due_date ? ` (기한 ${d.due_date})` : ""} 아래 링크에서 내용 확인 후 서명해 주세요.`;
  const linkRow = (url, who) => `<span class="link-row">
      <input type="text" class="invite-url" value="${esc(url)}" readonly data-select-all aria-label="${esc(who || "")} 서명 링크" />
      <button type="button" class="btn btn-xs btn-primary" data-share data-share-url="${esc(url)}"
        data-share-title="${esc(d.title)} 전자서명" data-share-text="${esc(shareMsg(who))}">보내기 · 복사</button></span>`;
  const extRows = exts.length ? exts.map((e, i) => `<li${extToken && extTokens[i] === extToken ? ' class="is-new"' : ""}><span class="req-order">${e.sign_order}</span>
      <span class="req-name">${esc(e.name)}</span> <small>${esc(e.org || "")}${e.email ? ` · ${esc(e.email)}` : ""}${e.phone ? ` · ${esc(D.maskPhone(e.phone))}` : ""}</small>
      <span class="badge badge-info">외부</span>
      ${e.signed ? '<span class="badge badge-ok">완료</span>' : e.declined_at ? `<span class="badge badge-no">거절</span><br /><small class="decline-why">사유: ${esc(e.decline_reason || "")}</small>`
        : `<span class="badge badge-wait">${e.opened_at ? "열람함 · 미서명" : "미열람"}</span>`}
      ${e.signed ? "" : `<form method="post" action="${base}/admin/documents/${d.id}/external/${e.id}/delete" class="inline-form" data-confirm="${esc(e.name)}님을 서명자에서 빼시겠습니까?"><button class="btn btn-xs btn-ghost">삭제</button></form>`}
      ${e.signed || e.declined_at ? "" : linkRow(`${linkOrigin}/esign/${extTokens[i]}`, e.name)}
    </li>`).join("") : "";
  const extPanel = `<section class="panel"><h2 class="panel-title">외부 서명자 <span class="badge badge-muted">${exts.length}</span></h2>
    <p class="panel-hint">회원이 아닌 계약 상대방(임차인·거래처 등)에게 <b>가입 없이 서명할 수 있는 링크</b>를 보냅니다.
      링크는 위조할 수 없는 서명값이 붙어 있어 다른 사람이 열 수 없습니다.
      ${canTalk ? "연락처를 넣으면 알림톡으로 자동 발송되고, 아래 링크로 직접 보내셔도 됩니다."
        : "<b>지금은 자동 발송이 꺼져 있습니다 — 아래 링크를 복사해 카톡·문자로 직접 보내세요.</b> 링크만으로 서명까지 다 됩니다."}</p>
    ${extRows ? `<ul class="req-list">${extRows}</ul>` : ""}
    ${d.closed ? "" : `<form method="post" action="${base}/admin/documents/${d.id}/external" class="stack-form compact">
      <div class="form-two"><label>이름<input type="text" name="name" required maxlength="60" placeholder="예: 홍길동" value="${esc(lead ? lead.name : "")}" autocomplete="name" /></label>
        <label>소속·상호 (선택)<input type="text" name="org" maxlength="80" placeholder="예: ○○상사" autocomplete="organization" /></label></div>
      <div class="form-two"><label>이메일 ${otpOn ? "" : "<small>(선택)</small>"}<input type="email" name="email" maxlength="120" placeholder="link@example.com" value="${esc(lead ? lead.email : "")}" autocomplete="email" /></label>
        <label>휴대폰 ${otpOn ? "" : "<small>(선택)</small>"}<input type="tel" name="phone" maxlength="13" inputmode="numeric" placeholder="010-1234-5678" value="${esc(lead ? lead.phone : "")}" autocomplete="tel" /></label></div>
      <p class="panel-hint">${otpOn
        ? "본인확인(휴대폰 인증)이 켜져 있어 <b>연락처가 반드시 필요합니다</b> — 그 번호로 인증번호가 갑니다."
        : "연락처는 <b>비워 두셔도 됩니다.</b> 넣으면 알림톡으로 자동 발송되고, 비우면 발급된 링크를 직접 전달하시면 됩니다."}</p>
      <button class="btn btn-primary btn-sm">서명 링크 발급</button></form>`}</section>`;
  const reqPanel = rc.total ? `<section class="panel"><h2 class="panel-title">서명 현황 <span class="badge ${rc.signed === rc.total ? "badge-ok" : "badge-wait"}">${rc.signed}/${rc.total} (${pct}%)</span>${d.ordered ? ' <span class="badge badge-info">순차</span>' : ""}</h2>
    <div class="progress"><span style="width:${pct}%"></span></div>
    <ul class="req-list">${reqStatus.map((u) => `<li>${d.ordered ? `<span class="req-order">${u.sign_order}</span>` : ""}<span class="req-name">${esc(u.name)}</span> <small>${esc(u.email)}</small> ${u.signed ? '<span class="badge badge-ok">완료</span>' : u.declined_at ? `<span class="badge badge-no">거절</span><br /><small class="decline-why">사유: ${esc(u.decline_reason || "")}</small>` : (d.ordered ? (nextTurn && nextTurn.id === u.id ? '<span class="badge badge-wait">서명 차례</span>' : '<span class="badge badge-muted">대기</span>') : '<span class="badge badge-wait">미서명</span>')}</li>`).join("")}</ul>
    ${d.ordered && nextTurn ? `<p class="panel-hint">현재 <b>${esc(nextTurn.name)}</b>님 차례입니다.</p>` : ""}
    ${rc.signed === rc.total ? "" : `<div class="form-divider">회원에게 보낼 링크</div>
      <p class="panel-hint">회원(가입한 사람)은 이 주소에서 서명합니다 — <b>로그인이 필요합니다.</b>
        ${canTalk ? "" : "지금은 자동 발송이 꺼져 있으니 이 링크를 카톡·문자로 직접 보내 주세요."}</p>
      ${linkRow(`${linkOrigin}${base}/sign/${d.id}`, "")}`}</section>` : `<section class="panel"><p class="panel-hint">전체 공개 문서(누구나 서명 가능).</p></section>`;
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><h1 class="dash-title">${esc(d.title)} ${d.closed ? '<span class="badge badge-no">마감</span>' : ""}${d.ordered ? ' <span class="badge badge-info">순차</span>' : ""}${d.due_date ? `<span class="badge ${D.isPastDue(d) ? "badge-no" : "badge-wait"}">기한 ${esc(d.due_date)}</span>` : ""}</h1>
      <p class="dash-sub"><a href="${base}/admin/documents">← 문서 목록</a> · 서명 ${sigs.length}명</p></div>
      <div class="dash-head-actions">
        ${d.closed || !canTalk ? "" : `<form method="post" action="${base}/admin/documents/${d.id}/remind" class="inline-form" data-confirm="미서명자에게 알림톡으로 리마인더를 보낼까요? (잔액이 차감됩니다)"><button class="btn btn-primary btn-sm">미서명자 재알림</button></form>`}
        ${d.closed || (rc.total > 0 && rc.signed === rc.total) ? "" : `<form method="post" action="${base}/admin/documents/${d.id}/close" class="inline-form" data-confirm="마감할까요? 남은 사람은 더 이상 서명할 수 없습니다."><button class="btn btn-ghost btn-sm">마감</button></form>`}
        <a href="${base}/documents/${d.id}/paper" class="btn btn-ghost btn-sm">완성본 보기</a>
        <a href="${base}/documents/${d.id}/evidence" class="btn btn-ghost btn-sm">증적 패키지</a>
        <a href="${base}/admin/documents/${d.id}/fields" class="btn btn-ghost btn-sm">필드 배치${fieldN ? ` (${fieldN})` : ""}</a>
        <button type="button" class="btn btn-ghost btn-sm" data-print>인쇄 · PDF</button></div></div>
    ${reqPanel}
    ${extPanel}
    ${sigs.length || d.closed ? "" : `<details class="panel"><summary class="panel-title">문서 수정 <small>(아직 아무도 서명하지 않았습니다)</small></summary>
      <p class="panel-hint">서명이 시작되면 잠깁니다. 본문을 고치면 문서 해시가 다시 계산되고, 쪽수가 줄면 마지막 쪽 밖의 필드를 끌어옵니다.</p>
      <form method="post" action="${base}/admin/documents/${d.id}/edit" class="stack-form">
        <label>제목<input type="text" name="title" value="${esc(d.title)}" required maxlength="200" /></label>
        <label>본문<textarea name="body" rows="12" required>${esc(d.body)}</textarea></label>
        <div class="form-two"><label>서명 기한<input type="date" name="due_date" value="${esc(d.due_date || "")}" /></label>
          <label class="check check-inline"><input type="checkbox" name="ordered" value="1"${d.ordered ? " checked" : ""} /> 순차 서명</label></div>
        <button class="btn btn-primary btn-sm">수정 저장</button></form></details>`}
    <section class="panel"><h2 class="panel-title">문서 본문</h2><div class="doc-body">${docBody(d.body)}</div>
      ${d.attachment ? `<p class="doc-attach"><a href="${esc(mediaUrl(d.attachment))}" target="_blank" rel="noopener">${esc(d.attachment_name || "계약서.pdf")}</a></p>` : ""}
      <p class="doc-hash">해시: <code>${esc(d.content_hash)}</code></p></section>
    <section class="panel"><h2 class="panel-title">서명 내역</h2><div class="table-scroll"><table class="admin-table">
      <thead><tr><th>서명자</th><th>서명</th><th>일시·IP</th><th>검증</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <section class="panel"><h2 class="panel-title">감사 추적 <span class="badge badge-muted">${events.length}건</span></h2>
      <p class="panel-hint">누가 언제 열람하고 인증하고 서명했는지의 기록입니다. "받은 적 없다·읽은 적 없다"는 항변에 대한 증거이며, 증적 패키지에 함께 담깁니다.</p>
      <ul class="audit-list">${events.length ? events.slice(-40).reverse().map((e) => `<li><span class="audit-action">${esc(DOC_EVENT_LABEL[e.kind] || e.kind)}</span>
        <span class="audit-detail">${esc(e.actor_name || "")}${e.detail ? ` — ${esc(e.detail)}` : ""}</span>
        <span class="audit-meta">${esc(kstStamp(e.created_at, { year: false }))}${e.ip ? ` · ${esc(e.ip)}` : ""}</span></li>`).join("") : `<li class="empty">아직 기록이 없습니다.</li>`}</ul></section>
    </div></section>`;
  // share.js 가 없으면 '보내기 · 복사' 버튼이 눌러도 아무 일도 안 하는 죽은 버튼이 된다.
  return html(layout({ title: d.title, assoc, base, user, body, csrf,
    scripts: `<script src="${assetUrl("/js/share.js")}" defer></script>` }));
}

// 서식에서 문서 만들기 — 빈칸({{변수}})과 당사자만 채우면 본문·배치가 완성된다.
export async function adminDocumentNew(ctx) {
  const { db, assoc, base, user, query, csrf, env } = ctx;
  const lead = Number(query.get("lead")) ? await D.getLead(db, Number(query.get("lead")), assoc.id) : null;
  const raw = query.get("tpl") || "";
  // 서식을 고르지 않고 이 주소로 들어온 것은 '없는 페이지' 가 아니라 '아직 안 고른 것' 이다.
  // 404 를 띄우면 주소를 직접 친 사람에게 제품이 고장 난 것처럼 보인다.
  if (!raw) return redirect(`${base}/admin/templates`);
  const src = isBuiltinId(raw) ? builtinById(raw) : await D.getTemplate(db, Number(raw) || 0);
  if (!src || (!isBuiltinId(raw) && src.association_id !== 0 && src.association_id !== assoc.id)) return notFoundResponse(ctx);
  const t = normalizeTemplate(src);
  const members = await D.listSignerCandidates(db, assoc.id, assoc.kind);
  const memberOpts = members.map((m) => `<option value="${m.id}">${esc(m.name)} (${esc(m.email)})</option>`).join("");
  const varInputs = t.vars.length
    ? t.vars.map((v) => `<label>${esc(v)}<input type="text" name="var_${esc(v)}" maxlength="200" placeholder="${esc(v)}" /></label>`).join("")
    : `<p class="panel-hint">이 서식에는 채울 빈칸이 없습니다.</p>`;
  // 서식의 필드는 '당사자 1·2' 로 되어 있다 — 실제 회원을 여기에 연결한다
  // 전자계약의 기본은 '가입하지 않은 상대방'과 맺는 계약이다. 예전에는 여기서 사내 회원만
  // 고를 수 있어서, 계약서를 일단 만들고 상세 화면에 다시 들어가 외부 서명자를 붙여야 했다.
  // 회원이 하나도 없으면 버튼이 아예 잠겨서 계약을 시작조차 못 했다.
  const partyRows = (t.parties.length ? t.parties : ["서명자"]).map((p, i) =>
    `<div class="party-row">
      <label>${esc(p)}<select name="party_${i}" class="party-pick" data-party="${i}" required>
        <option value="">— 선택 —</option>${memberOpts}
        <option value="ext">외부 상대방 — 가입하지 않은 사람</option>
      </select></label>
      <div class="party-ext" data-party="${i}" hidden>
        <div class="form-two"><label>이름<input type="text" name="ext_name_${i}" maxlength="60" placeholder="예: 홍길동" autocomplete="name" /></label>
          <label>소속·상호 <small>(선택)</small><input type="text" name="ext_org_${i}" maxlength="80" placeholder="예: ○○상사" autocomplete="organization" /></label></div>
        <div class="form-two"><label>휴대폰<input type="tel" name="ext_phone_${i}" maxlength="13" inputmode="numeric" placeholder="010-1234-5678" autocomplete="tel" /></label>
          <label>이메일 <small>(선택)</small><input type="email" name="ext_email_${i}" maxlength="120" placeholder="link@example.com" autocomplete="email" /></label></div>
        <p class="panel-hint">이 연락처로 서명 링크와 본인확인 번호가 갑니다.
          ${emailOn(env) ? "휴대폰이 있으면 알림톡으로, 없으면 이메일로 갑니다." : "<b>이 조직은 이메일 발송을 쓰지 않으므로 휴대폰이 필요합니다.</b>"}</p>
      </div>
    </div>`).join("");
  const preview = renderPaper(applyVars(t.body, {}), { fieldsFor: () => "" });
  // 서식은 출발점이지 최종본이 아니다. 표준 서식이든 우리 서식이든 조항 한 줄은
  // 계약마다 달라진다 — 예전에는 여기서 고칠 수 없어, 만든 뒤 상세 화면에 다시 들어가
  // 본문을 고쳐야 했다(그 사이 계약은 이미 상대방에게 나가 있었다).
  // 고친 본문은 이 계약서에만 적용된다. 우리 서식이면 원한다고 표시했을 때만 서식에도 저장한다.
  const canEditTpl = !t.builtin && src.association_id === assoc.id;
  const bodyEditor = `<details class="panel-fold tpl-edit"><summary class="tpl-edit-sum">본문 고치기</summary>
    <p class="panel-hint">고친 내용은 <b>이 계약서에만</b> 적용됩니다${canEditTpl ? " (아래를 체크하면 서식에도 저장됩니다)" : " — 표준 서식은 그대로 남습니다"}.
      본문을 고치면 <b>서명 자리도 문단을 따라 함께 옮겨집니다.</b>
      <code>{{보증금}}</code> 처럼 중괄호로 감싸면 계약마다 채우는 빈칸이 되는데,
      지금 새로 만든 빈칸은 이번 계약서에서는 밑줄로 남습니다 — ${canEditTpl ? "서식에 저장하고 다시 열면" : "서식으로 저장한 뒤 그 서식으로 만들면"} 채우는 칸이 생깁니다.</p>
    <textarea name="body" id="tplBody" rows="16" maxlength="20000" spellcheck="false" aria-label="계약서 본문">${esc(t.body)}</textarea>
    ${canEditTpl ? `<label class="check"><input type="checkbox" name="save_tpl" value="1" /> 고친 내용을 <b>이 서식에도 저장</b> — 다음부터 이 내용으로 시작합니다</label>` : ""}
  </details>`;
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">전자계약 · 서식</p><h1 class="dash-title">${esc(t.title)}</h1>
      <p class="dash-sub"><a href="${base}/admin/documents">← 문서 목록</a>${t.builtin ? " · 표준 서식" : " · 우리 서식"}</p></div></div>${flashOf(query)}
    <div class="tpl-layout">
      <section class="panel">
        <form method="post" action="${base}/admin/documents" class="stack-form">
          <input type="hidden" name="template" value="${esc(String(t.id))}" />
          ${lead ? `<input type="hidden" name="lead_id" value="${lead.id}" />
          <p class="flash flash-ok">계약 상대방: <b>${esc(lead.name)}</b> (${esc(lead.phone)}) — 문서를 만들면 바로 서명 링크를 발급합니다.</p>` : ""}
          <label>문서 제목<input type="text" name="title" required maxlength="200" value="${esc(t.title)}" /></label>
          ${t.vars.length ? `<div class="form-divider">빈칸 채우기</div><div class="tpl-vars">${varInputs}</div>` : ""}
          <div class="form-divider">본문</div>
          ${bodyEditor}
          <div class="form-divider">당사자 지정</div>
          ${partyRows}
          ${members.length ? "" : `<p class="panel-hint">사내에 등록된 서명자가 없습니다 — <b>외부 상대방</b>으로 진행하시면 됩니다.</p>`}
          <div class="form-two"><label>서명 기한 (선택)<input type="date" name="due_date" /></label>
            <label class="check check-inline"><input type="checkbox" name="ordered" value="1"${t.ordered ? " checked" : ""} /> 순차 서명</label></div>
          <button class="btn btn-primary btn-block">문서 만들고 서명 요청</button>
          <p class="panel-hint">만든 뒤에도 <b>필드 배치</b> 화면에서 서명 자리를 옮길 수 있습니다 (서명 시작 전까지).</p>
        </form>
      </section>
      <div class="tpl-preview"><p class="tpl-preview-cap">미리보기 — 빈칸은 밑줄로 표시됩니다. 본문을 고치면 여기도 함께 바뀝니다.</p>
        <div class="paper-wrap" id="tplPreview">${preview}</div></div>
    </div></div></section>`;
  return html(layout({ title: t.title, assoc, base, user, body, csrf,
    scripts: `<script src="${assetUrl("/js/paper.js")}" defer></script><script src="${assetUrl("/js/doc-new.js")}" defer></script>` }));
}

// 관리자가 점포 정보를 대신 채우는 화면.
//
// 상인회장은 명단을 미리 넣어 두고 사장님을 부른다 — 그게 실제 시작 방식이다.
// 그런데 예전에는 주소·전화를 점주 본인만 고칠 수 있어, 대행 등록한 점포는
// 이름과 업종만 있는 빈껍데기로 남았다(지도에 안 뜨고 목록에서도 비어 보인다).
// 여기서 채워 두면 사장님이 나중에 로그인해 이어서 고친다 — 같은 레코드다.
export async function adminBusinessEdit(ctx) {
  const { db, assoc, base, user, query, csrf, env } = ctx;
  const b = await D.getBusinessById(db, Number(ctx.params.id) || 0);
  if (!b || b.association_id !== assoc.id) return notFoundResponse(ctx);
  const opts = CATEGORIES.map((c) => `<option value="${esc(c)}"${c === b.category ? " selected" : ""}>${esc(c)}</option>`).join("");
  const owner = b.owner_id ? await D.getUserById(db, b.owner_id) : null;
  const kakaoOn = !!String(env.KAKAO_REST_KEY || "").trim();
  // 무엇이 비어 있어서 손님에게 어떻게 보이는지 — 숫자가 아니라 결과로 말한다
  const gaps = [
    !b.address && "주소가 없어 <b>지도에 뜨지 않습니다</b>",
    !b.phone && "전화번호가 없어 손님이 <b>전화를 걸 수 없습니다</b>",
    !b.hours && "영업시간이 없어 <b>'지금 문 연 곳'에 안 뜹니다</b>",
    (b.lat == null || b.lng == null) && "좌표가 없어 <b>지도 위 핀이 찍히지 않습니다</b>",
  ].filter(Boolean);
  // ── 사진·영상 —— 사장님이 카톡으로 보내 온 것을 관리자가 대신 올린다.
  // 지도에서 긁어 오지 않는다: 그 사진들은 사장님·손님·플랫폼이 각각 찍은 남의 저작물이라,
  // 우리 서버에 복사해 우리 페이지에 거는 순간 재배포가 된다. 링크(네이버 플레이스)는 괜찮다.
  const media = await D.listMedia(db, b.id);
  const shots = media.filter((m) => m.kind === "image");
  const clips = media.filter((m) => m.kind === "embed" || m.kind === "video");
  const plan = planOf(assoc);
  const delForm = (m) => `<form method="post" action="${base}/admin/business/${b.id}/media/${m.id}/delete" class="inline-form"
      data-confirm="이 ${m.kind === "image" ? "사진" : "영상"}을 지울까요?"><button class="btn btn-xs btn-ghost">지우기</button></form>`;
  const mediaPanel = `<section class="panel"><h2 class="panel-title">사진·영상
      <span class="badge badge-muted">사진 ${shots.length}/${plan.maxPhotos} · 영상 ${clips.length}/${plan.maxEmbeds}</span></h2>
    <p class="panel-hint">사장님께 카톡으로 받은 사진을 여기서 대신 올립니다. 맨 앞 사진이 목록·카톡 공유의 대표 사진이 됩니다.
      <b>지도(네이버·카카오)의 사진은 가져오지 않습니다</b> — 사장님·손님·플랫폼이 각각 찍은 남의 사진이라 옮겨 담으면 저작권 문제가 됩니다.
      대신 위의 <b>네이버 플레이스</b> 칸에 링크를 걸어 두면 손님이 그쪽에서 사진·리뷰를 봅니다.</p>
    <form method="post" action="${base}/admin/business/${b.id}/media" enctype="multipart/form-data" class="upload-form">
      <label class="file-drop"><input type="file" name="files" accept="image/*" multiple /><span class="file-drop-text">사진 선택 (한 장당 최대 8MB · 여러 장 가능)</span></label>
      <input type="text" name="caption" placeholder="설명 (선택)" class="caption-input" maxlength="200" />
      <button class="btn btn-primary btn-block">사진 올리기</button></form>
    ${shots.length ? `<div class="admin-shots">${shots.map((m) => `<figure class="admin-shot">
      <img src="${esc(mediaUrl(m.thumb || m.filename))}" alt="${esc(m.caption || "가게 사진")}" loading="lazy" />
      <figcaption>${esc(m.caption || "")}${delForm(m)}</figcaption></figure>`).join("")}</div>` : `<p class="panel-hint">아직 올린 사진이 없습니다 — 사진이 없으면 목록에서 회색 상자로 보입니다.</p>`}
    <div class="form-divider">영상·릴스·쇼츠</div>
    <p class="panel-hint">유튜브·유튜브 쇼츠·인스타그램 릴스·네이버TV 주소를 붙여넣으세요. 세로 영상은 세로로 열립니다.
      <small>단축 주소(naver.me/…)는 안 됩니다 — 영상을 열어 주소창의 원래 주소를 복사해 주세요.</small></p>
    <form method="post" action="${base}/admin/business/${b.id}/embed" class="stack-form compact">
      <input type="url" name="url" placeholder="예: instagram.com/reel/…  ·  youtube.com/shorts/…" required />
      <input type="text" name="caption" placeholder="설명 (선택)" maxlength="200" />
      <button class="btn btn-ghost btn-sm">영상 추가</button></form>
    ${clips.length ? `<ul class="admin-clips">${clips.map((m) => `<li>
      <b>${esc(providerLabel(m.provider) || "영상")}</b> <span class="muted">${esc(m.caption || m.embed_id || "")}</span>${delForm(m)}</li>`).join("")}</ul>` : ""}
  </section>`;
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow"><a href="${base}/admin#s-people">← 회원·점포</a></p>
      <h1 class="dash-title">${esc(b.name)}</h1>
      <p class="dash-sub">${statusBadge(b.status)} ${owner
        ? `· 사장님 ${esc(owner.name)}${isPlaceholderEmail(owner.email) ? ' <span class="badge badge-wait">로그인 미설정</span>' : ` (${esc(owner.email)})`}`
        : "· 연결된 사장님 계정 없음"}</p></div>
      <div class="dash-head-actions">${b.status === "approved" ? `<a class="btn btn-ghost btn-sm" href="${base}/business/${esc(b.slug)}" target="_blank">가게 페이지 보기 ↗</a>` : ""}</div>
    </div>${flashOf(query)}
    ${gaps.length ? `<div class="flash flash-warn"><b>아직 덜 채운 것</b><ul class="gap-list">${gaps.map((g) => `<li>${g}</li>`).join("")}</ul></div>` : ""}
    ${owner && isPlaceholderEmail(owner.email) ? `<section class="panel panel-accent"><h2 class="panel-title">로그인 이메일 지정</h2>
      <p class="panel-hint">이메일 없이 등록한 계정입니다. 사장님은 <b>아직 로그인할 수 없습니다</b> — 여기서 주소를 정하면 임시 비밀번호가 나옵니다.
        지금 화면의 정보를 회장님이 대신 관리하시는 중이라면 비워 두셔도 됩니다.</p>
      <form method="post" action="${base}/admin/business/${b.id}/owner-email" class="stack-form compact">
        <label>사장님 이메일<input type="email" name="email" required maxlength="120" autocomplete="email" placeholder="사장님이 쓰시는 이메일" /></label>
        <button class="btn btn-primary btn-sm">지정하고 임시 비밀번호 발급</button></form></section>` : ""}
    <section class="panel">
      <h2 class="panel-title">가게 정보</h2>
      <p class="panel-hint">사장님 대신 채워 두는 자리입니다. 사장님이 로그인하면 자기 화면에서 이어서 고칠 수 있습니다.</p>
      ${kakaoOn ? `<div class="form-divider">지도에서 찾아 채우기</div>
      <div class="place-find" data-place-find>
        <input type="text" data-place-q value="${esc(b.name)}" placeholder="가게 이름 (예: 방배 버들카페)" aria-label="가게 이름으로 찾기" autocomplete="off" />
        <button type="button" class="btn btn-ghost btn-sm" data-place-go>찾기</button>
      </div>
      <p class="panel-hint" data-place-msg hidden></p>
      <ul class="place-list" data-place-list hidden></ul>
      <p class="panel-hint">카카오맵에서 찾은 값을 아래 칸에 채워 넣습니다. <b>저장은 확인하고 직접 누르셔야 합니다</b> — 지도의 정보가 늘 최신인 것은 아닙니다.</p>`
        : `<p class="panel-hint">지도에서 자동으로 채우는 기능은 운영사가 카카오 키를 등록하면 열립니다.</p>`}
      <form method="post" action="${base}/admin/business/${b.id}" class="stack-form">
        <label>업체명<input type="text" name="name" data-place="name" value="${esc(b.name)}" required maxlength="100" autocomplete="organization" /></label>
        <label>업종<select name="category" data-place="category">${opts}</select></label>
        <div class="form-two">
          <label>전화<input type="tel" name="phone" data-place="phone" value="${esc(b.phone || "")}" maxlength="40" autocomplete="tel" /></label>
          <label>영업시간 <small>(예: 10:00-21:00 · 일요일 휴무)</small><input type="text" name="hours" id="bizHours" value="${esc(b.hours || "")}" maxlength="100" /></label>
        </div>
        <label>주소<input type="text" name="address" data-place="address" value="${esc(b.address || "")}" maxlength="200" autocomplete="street-address" /></label>
        <label>소개<textarea name="description" rows="4" maxlength="2000">${esc(b.description || "")}</textarea></label>
        <label>네이버 플레이스 <small>(선택 · 리뷰·길찾기 연결)</small>
          <input type="url" name="sns_naver" value="${esc(b.sns_naver || "")}" placeholder="naver.me/…" /></label>
        <div class="form-divider">지도 위치</div>
        <div class="form-two">
          <label>위도<input type="text" inputmode="decimal" name="lat" data-place="lat" value="${b.lat != null ? esc(String(b.lat)) : ""}" /></label>
          <label>경도<input type="text" inputmode="decimal" name="lng" data-place="lng" value="${b.lng != null ? esc(String(b.lng)) : ""}" /></label>
        </div>
        <button class="btn btn-primary">저장</button>
      </form></section>
    ${mediaPanel}
    </div></section>`;
  return html(layout({ title: `${b.name} 정보`, assoc, base, user, body, csrf,
    scripts: `<script src="${assetUrl("/js/place.js")}" defer></script>` }));
}

// 우리 상인회 서식 관리 — 만든 문서를 서식으로 저장해 다음부터 재사용
export async function adminTemplates(ctx) {
  const { db, assoc, base, user, query, csrf } = ctx;
  // 상담 DB 에서 "계약서 만들기"로 넘어온 경우 — 그 신청자를 계약 상대방으로 끌고 간다
  const lead = Number(query.get("lead")) ? await D.getLead(db, Number(query.get("lead")), assoc.id) : null;
  const leadQ = lead ? `&lead=${lead.id}` : "";
  const mine = (await D.listTemplates(db, assoc.id)).filter((t) => t.association_id === assoc.id);
  const docs = await D.listDocuments(db, assoc.id);
  const rows = mine.length ? mine.map((t) => { const n = normalizeTemplate(t);
    return `<tr><td><b>${esc(n.title)}</b><br /><small>${esc(n.summary || "")}</small></td>
      <td>${n.vars.length ? n.vars.map((v) => `<code class="tpl-var">${esc(v)}</code>`).join(" ") : "<small>없음</small>"}</td>
      <td>${n.fields.length}개</td>
      <td class="actions-cell"><a class="btn btn-xs btn-ghost" href="${base}/admin/documents/new?tpl=${n.id}${leadQ}">이 서식으로 만들기</a>
        <form method="post" action="${base}/admin/templates/${n.id}/delete" data-confirm="'${esc(n.title)}' 서식을 삭제할까요?"><button class="btn btn-xs btn-ghost">삭제</button></form></td></tr>`;
  }).join("") : `<tr><td colspan="4" class="empty">저장한 서식이 없습니다.</td></tr>`;
  const docOpts = docs.map((d) => `<option value="${d.id}">${esc(d.title)}</option>`).join("");
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">전자계약 · 서식</p><h1 class="dash-title">${assoc.kind === "esign" ? "우리 서식" : "우리 상인회 서식"}</h1>
      <p class="dash-sub"><a href="${base}/admin/documents">← 문서 목록</a></p></div></div>${flashOf(query)}
    ${lead ? `<div class="flash flash-ok">상담 신청자 <b>${esc(lead.name)}</b>(${esc(lead.phone)})님에게 보낼 계약서입니다. 서식을 고르면 이어서 서명 링크를 발급합니다.</div>` : ""}
    <section class="panel panel-accent"><h2 class="panel-title">문서를 서식으로 저장</h2>
      <p class="panel-hint">이미 만든 문서를 서식으로 저장하면 <b>배치된 서명 자리까지</b> 함께 보관됩니다.
        본문에서 매번 달라지는 부분은 <code>{{보증금}}</code> 처럼 바꿔 두면 다음부터 그 칸만 채우면 됩니다.</p>
      <form method="post" action="${base}/admin/templates" class="stack-form">
        <div class="form-two"><label>원본 문서<select name="document" required><option value="">— 선택 —</option>${docOpts}</select></label>
          <label>서식 이름<input type="text" name="title" required maxlength="200" placeholder="예: 우리 상가 표준 임대차" /></label></div>
        <label>한 줄 설명<input type="text" name="summary" maxlength="120" placeholder="언제 쓰는 서식인지" /></label>
        <button class="btn btn-primary">서식으로 저장</button></form></section>
    <section class="panel"><h2 class="panel-title">저장된 서식 <span class="badge badge-muted">${mine.length}</span></h2>
      <div class="table-scroll"><table class="admin-table">
        <thead><tr><th>서식</th><th>빈칸</th><th>자리</th><th>관리</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <section class="panel"><h2 class="panel-title">표준 서식 (플랫폼 제공)</h2>
      <div class="tpl-grid">${builtinsFor(assoc.kind).map(normalizeTemplate).map((t) => `<a class="tpl-card" href="${base}/admin/documents/new?tpl=${t.id}${leadQ}">
        <span class="tpl-title">${esc(t.title)}</span><span class="tpl-sum">${esc(t.summary)}</span>
        <span class="tpl-meta">빈칸 ${t.vars.length} · 자리 ${t.fields.length}개</span></a>`).join("")}</div></section>
    </div></section>`;
  return html(layout({ title: "계약서 서식", assoc, base, user, body, csrf }));
}

// API 연동 콘솔 — 키 발급·웹훅 설정·최근 전송 결과
export async function adminApi(ctx) {
  const { db, assoc, base, user, query, csrf } = ctx;
  const keys = await D.listApiKeys(db, assoc.id);
  const fresh = query.get("newkey") || "";
  const active = keys.filter((k) => !k.revoked_at);
  const recent = active.length ? await D.listWebhooks(db, active[0].id, 15) : [];
  const rows = keys.length ? keys.map((k) => `<tr class="${k.revoked_at ? "is-revoked" : ""}">
      <td><b>${esc(k.name || "이름 없음")}</b><br /><code>${esc(k.prefix)}…</code></td>
      <td>${k.revoked_at ? '<span class="badge badge-no">폐기됨</span>' : '<span class="badge badge-ok">사용 중</span>'}<br />
        <small>호출 ${k.calls.toLocaleString()}회${k.last_used_at ? ` · 최근 ${esc(kstStamp(k.last_used_at, { year: false }))}` : ""}</small></td>
      <td>${k.revoked_at ? "-" : `<form method="post" action="${base}/admin/api/${k.id}/webhook" class="domain-form">
          <input type="url" name="webhook_url" value="${esc(k.webhook_url || "")}" placeholder="https://내서버/webhook" />
          <button class="btn btn-xs btn-ghost">저장</button></form>
        ${k.webhook_url ? `<small>서명키 <code>${esc(k.webhook_secret)}</code></small>` : '<small class="txt-muted">웹훅 꺼짐</small>'}`}</td>
      <td class="actions-cell">${k.revoked_at ? "" : `<form method="post" action="${base}/admin/api/${k.id}/revoke" data-confirm="이 키를 폐기하면 즉시 호출이 막힙니다. 계속할까요?"><button class="btn btn-xs btn-ghost">폐기</button></form>`}</td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">발급한 키가 없습니다.</td></tr>`;
  const whRows = recent.length ? recent.map((w) => `<li><span class="audit-action">${esc(w.event)}</span>
      <span class="audit-detail">${w.delivered_at ? "전송 완료" : w.attempts >= 6 ? `포기 — ${esc(w.last_error)}` : `대기/재시도 ${w.attempts}회${w.last_error ? ` — ${esc(w.last_error)}` : ""}`}</span>
      <span class="audit-meta">${esc(kstStamp(w.created_at, { year: false }))}</span></li>`).join("")
    : `<li class="empty">전송 이력이 없습니다.</li>`;
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">전자계약 · API</p><h1 class="dash-title">API 연동</h1>
      <p class="dash-sub"><a href="${base}/admin/documents">← 문서 목록</a> · 우리 시스템에서 계약을 자동으로 만들고 보냅니다</p></div>
      <div class="dash-head-actions"><a href="/api/v1/docs" target="_blank" class="btn btn-ghost btn-sm">API 문서</a></div></div>${flashOf(query)}
    ${fresh ? `<div class="invite-box"><p class="invite-box-title">새 API 키 — <b>지금만 보입니다</b></p>
      <input type="text" class="invite-url" value="${esc(fresh)}" readonly data-select-all />
      <p class="panel-hint">이 값은 저장하지 않으므로 다시 볼 수 없습니다. 안전한 곳에 옮겨 두세요.
        잃어버리면 새 키를 발급하고 이 키를 폐기하면 됩니다.</p></div>` : ""}
    <section class="panel panel-accent"><h2 class="panel-title">키 발급</h2>
      <p class="panel-hint">API 호출은 무료입니다. 비용은 <b>알림톡 발송</b>에서만 발생합니다(현재 잔액 기준으로 차감).</p>
      <form method="post" action="${base}/admin/api" class="stack-form compact">
        <div class="form-two"><label>키 이름<input type="text" name="name" maxlength="60" placeholder="예: 사내 ERP 연동" autocomplete="name" /></label>
          <label>웹훅 주소 (선택)<input type="url" name="webhook_url" maxlength="300" placeholder="https://내서버/esign/webhook" /></label></div>
        <button class="btn btn-primary btn-sm">API 키 발급</button></form></section>
    <section class="panel"><h2 class="panel-title">발급된 키 <span class="badge badge-muted">${active.length} 사용 중</span></h2>
      <div class="table-scroll"><table class="admin-table">
        <thead><tr><th>키</th><th>상태</th><th>웹훅</th><th>관리</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <section class="panel"><h2 class="panel-title">최근 웹훅 전송</h2>
      <p class="panel-hint">서명·거절·완료가 나면 등록한 주소로 즉시 알립니다. 실패하면 1·5·25·125분 간격으로 최대 6회 다시 시도합니다.
        요청에는 <code>x-esign-signature</code> 헤더가 붙으며, <code>HMAC-SHA256(서명키, "시각.본문")</code> 으로 검증할 수 있습니다.</p>
      <ul class="audit-list">${whRows}</ul></section>
    <section class="panel"><h2 class="panel-title">빠른 시작</h2>
      <pre class="code-block">curl -X POST ${esc(ORIGIN)}/api/v1/documents \
  -H "Authorization: Bearer ${esc(KEY_PREFIX)}..." \
  -H "content-type: application/json" \
  -d '{
    "title": "○○상가 임대차계약",
    "template": "b-lease",
    "variables": { "임대인": "김갑", "임차인": "이을", "보증금": "50,000,000" },
    "signers": [
      { "name": "김갑", "email": "gap@example.com" },
      { "name": "이을", "phone": "010-1234-5678" }
    ],
    "ordered": true
  }'</pre>
      <p class="panel-hint">응답의 <code>sign_url</code> 로 상대방이 가입 없이 바로 서명합니다. 전체 명세는 <a href="/api/v1/docs" target="_blank">/api/v1/docs</a>.</p></section>
    </div></section>`;
  return html(layout({ title: "API 연동", assoc, base, user, body, csrf }));
}

// 전자계약 셀프 가입 — 영업을 거치지 않고 바로 시작한다.
// 전자계약 독립 제품 화면의 브랜드. 상인회 껍데기(상점 아이콘·"상인회 플랫폼")를 쓰지 않는다.
export const esignProduct = async (db) => ({
  name: (await D.getSetting(db, "esign_brand")) || "전자계약",
  home: "/esign",
});

export async function esignSignupForm(ctx) {
  const { db, env, csrf, query, user } = ctx;
  if (user) return redirect("/account");
  const on = await selfSignupOn(db);
  const trial = parseInt((await D.getSetting(db, "esign_trial_credit")) || "0", 10);
  const body = on ? `<section class="section page-top"><div class="container narrow">
    <div class="auth-card panel">
      <div class="auth-head"><h1 class="auth-title">전자계약 시작하기</h1>
        <p class="auth-sub">1분이면 됩니다. 신용카드도 설치도 필요 없습니다.</p></div>
      ${flashOf(query)}
      <form method="post" action="/esign/signup" class="stack-form">
        <label>조직·상호 이름<input type="text" name="name" required maxlength="100" placeholder="예: ○○법무법인 · ○○공인중개사" autocomplete="organization" />
          <small class="field-note">계약서와 알림톡에 이 이름이 표시됩니다.</small></label>
        <div class="form-two">
          <label>담당자 이름<input type="text" name="admin_name" maxlength="60" placeholder="홍길동" autocomplete="name" /></label>
          <label>휴대폰 <small>(선택)</small><input type="tel" name="phone" maxlength="13" inputmode="numeric" placeholder="010-1234-5678" autocomplete="tel" /></label>
        </div>
        <label>이메일<input type="email" name="email" required maxlength="120" autocomplete="email" />
          <small class="field-note">이 주소로 로그인합니다.</small></label>
        <label>비밀번호<input type="password" name="password" required minlength="8" maxlength="200" autocomplete="new-password" />
          <small class="field-note">8자 이상</small></label>
        <label class="check"><input type="checkbox" name="agree" value="1" required />
          <a href="/terms" target="_blank">이용약관</a>과 <a href="/privacy" target="_blank">개인정보처리방침</a>에 동의합니다.</label>
        ${turnstileWidget(env)}
        <button class="btn btn-primary btn-block">무료로 시작하기</button>
      </form>
      <p class="auth-note">시작하면 표준 서식(임대차·용역·비밀유지·동의서)이 준비된 상태로 바로 계약서를 만들 수 있습니다.
        ${trial > 0 ? `가입 시 <b>${trial.toLocaleString()}원</b>의 알림톡 체험 크레딧을 드립니다.` : "카카오 알림톡 발송은 크레딧을 충전한 뒤 사용합니다."}</p>
      <p class="auth-note">이미 계정이 있으신가요? <a href="/login">로그인</a></p>
    </div></div></section>`
    : `<section class="section page-top"><div class="container narrow">
      <div class="auth-card panel"><div class="auth-head"><h1 class="auth-title">도입 문의</h1></div>
      <p class="panel-hint">지금은 셀프 가입을 받지 않고 있습니다. 아래로 문의해 주시면 계약서 양식까지 함께 옮겨 드립니다.</p>
      <p><a href="/apply?kind=esign" class="btn btn-primary btn-block">문의 남기기</a></p>
      <p class="auth-note">이미 계정이 있으신가요? <a href="/login">로그인</a></p></div></div></section>`;
  return html(layout({ title: "시작하기", body, csrf, base: "", product: await esignProduct(db),
    description: "가입 없이 링크로 서명하는 전자계약을 1분 만에 시작하세요.",
    scripts: turnstileScript(env) }));
}

// 전자계약 제품 소개 (플랫폼 공개 페이지) — 상인회가 아닌 고객이 처음 만나는 화면.
// 상인회 랜딩과 섞으면 "우리는 상인회가 아닌데" 하고 나가 버린다. 따로 둔다.
export async function esignLanding(ctx) {
  const { db, csrf, query, url } = ctx;
  // site_name 은 상인회 플랫폼 이름이다 — 전자계약 랜딩에 쓰면 상인회 간판이 그대로 걸린다
  const siteName = (await D.getSetting(db, "esign_brand")) || "전자계약";
  const origin = url.origin;
  const step = (n, t, d) => `<div class="es-step"><span class="es-n">${n}</span><div><h3>${esc(t)}</h3><p>${esc(d)}</p></div></div>`;
  // 요금은 운영사 콘솔에 넣은 값만 보여 준다. 안 정했으면 아예 안 띄운다 —
  // 화면에는 있는데 실제로는 안 받는 금액이 제일 나쁘다.
  const prices = await planPrices(D.getSetting, db);
  const sendPrice = await priceOf(db, "alimtalk");
  const shown = PLAN_KEYS.filter((k) => prices[k] !== undefined);
  const priceSection = !shown.length ? "" : `
  <section class="section"><div class="container">
    <div class="section-head"><h2 class="section-title">얼마인가</h2></div>
    <div class="price-grid">${shown.map((k) => `<div class="price-card${k === "basic" ? " is-pick" : ""}">
      <h3>${esc(PLANS[k].label)}</h3>
      <p class="price-num">${prices[k] === 0 ? "0" : prices[k].toLocaleString()}<small>원 / 월</small></p>
      <p class="price-note">${prices[k] === 0 ? "계약서 만들기·서명받기·증적 모두 포함" : "부가세 별도"}</p>
    </div>`).join("")}</div>
    <p class="landing-lead">계약서를 만들고 서명받는 것 자체는 요금제에 포함됩니다.
      <b>알림톡 발송만 건당 ${sendPrice.toLocaleString()}원</b>으로 따로 계산합니다 — 미리 충전해 두고 쓴 만큼 차감됩니다.
      계약 한 건에 서명자 1인당 3통(요청·본인확인·완료)이 나갑니다.</p>
    <p class="panel-hint">API 호출·증적 다운로드·위변조 검증에는 추가 요금이 없습니다.</p>
  </div></section>`;
  const body = `
  <section class="landing-hero es-hero"><div class="container">
    <p class="hero-eyebrow">가입 없이 링크 하나로 — 전자계약</p>
    <h1 class="landing-title">계약서를 보내면,<br /><span>그 자리에서 서명</span>됩니다</h1>
    <p class="landing-lead">서명·도장 자리를 계약서 위에 놓고 링크를 보내면 끝입니다.
      상대방은 <b>가입도 앱 설치도 없이</b> 문자로 받은 링크에서 서명하고, 완료되면 양쪽 모두 증적을 받습니다.</p>
    <div class="hero-actions"><a href="/esign/signup" class="btn btn-primary btn-lg">무료로 시작하기</a>
      <a href="/api/v1/docs" class="btn btn-ghost btn-lg" target="_blank">API 문서 보기</a></div>
    <p class="hero-note">이미 쓰고 계신가요? <a href="/login">로그인</a></p>
    <p class="hero-note">계약을 받으신 분이라면 — 문자·메일의 링크를 그대로 열어 주세요. 이 화면에서 로그인할 필요가 없습니다.</p>
  </div></section>

  <section class="section"><div class="container">
    <div class="section-head"><h2 class="section-title">보내고, 서명받고, 끝</h2></div>
    <div class="es-steps">
      ${step(1, "계약서 만들기", "표준 서식(임대차·용역·NDA·동의서)을 고르고 빈칸만 채웁니다. 쓰던 서식을 저장해 재사용할 수도 있습니다.")}
      ${step(2, "서명 자리 배치", "계약서 위를 클릭해 서명·도장·날짜·체크 자리를 놓습니다. 누가 어디에 채울지 사람별로 지정합니다.")}
      ${step(3, "링크 발송", "이름과 연락처만 넣으면 카카오 알림톡으로 각자의 서명 링크가 갑니다. 카톡을 안 쓰는 분께는 문자로 갑니다. 순서대로 받게 할 수도 있습니다.")}
      ${step(4, "본인확인 후 서명", "휴대폰 인증번호로 본인을 확인하고, 계약서 위에서 직접 서명하거나 도장을 찍습니다.")}
      ${step(5, "증적 확보", "체결되면 완성본·확인서·감사추적·검증절차가 한 벌(ZIP)로 남습니다. 소송에 그대로 제출할 수 있습니다.")}
    </div>
  </div></section>

  <section class="section section-alt"><div class="container">
    <div class="section-head"><h2 class="section-title">위변조를 어떻게 잡아내는가</h2></div>
    <div class="feature-grid">
      ${[["본문 해시", "계약서 한 글자만 바뀌어도 해시가 달라져 드러납니다"],
         ["Ed25519 봉인", "서명자·시각·IP·기기를 디지털 서명으로 봉인합니다"],
         ["입력값·좌표 봉인", "채운 값은 물론 '어느 자리에 채웠는지'까지 봉인해, 자리만 옮기는 조작도 탐지합니다"],
         ["서명 사슬", "각 서명이 직전 서명을 가리켜, 중간 기록을 지우면 사슬이 끊깁니다"],
         ["시점 앵커", "매일 사슬의 머리를 봉인해 '그 시점에 이미 존재했다'를 증명합니다"],
         ["공개키 공개", "공개키를 상시 공개해 누구나 직접 검증할 수 있습니다"],
        ].map(([t, d]) => `<div class="feature-card"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join("")}
    </div>
    <p class="panel-hint" style="margin-top:18px">
      공개키: <a href="/.well-known/esign-public-key" target="_blank"><code>/.well-known/esign-public-key</code></a> ·
      시점 앵커: <a href="/.well-known/esign-anchors" target="_blank"><code>/.well-known/esign-anchors</code></a></p>
  </div></section>

  <section class="section"><div class="container">
    <div class="section-head"><h2 class="section-title">우리 시스템에서 자동으로</h2></div>
    <p class="landing-lead">한 번의 호출로 계약서 생성·서명 링크 발급·발송까지 끝납니다. API 호출은 무료입니다.</p>
    <pre class="code-block">curl -X POST ${esc(origin)}/api/v1/documents \
  -H "Authorization: Bearer sk_live_..." \
  -H "content-type: application/json" \
  -d '{
    "title": "○○상가 임대차계약",
    "template": "b-lease",
    "variables": { "임대인": "김갑", "임차인": "이을", "보증금": "50,000,000" },
    "signers": [{ "name": "이을", "phone": "010-1234-5678" }]
  }'</pre>
    <p class="panel-hint">서명·거절·완료는 웹훅으로 즉시 알려 드립니다. 전체 명세: <a href="/api/v1/docs" target="_blank">/api/v1/docs</a></p>
  </div></section>

  <section class="section section-alt"><div class="container">
    <div class="section-head"><h2 class="section-title">받으신 계약이 진짜인지 확인</h2></div>
    <p class="landing-lead">확인서의 검증 코드를 넣으면 누구나 위변조 여부를 확인할 수 있습니다. 로그인은 필요 없습니다.</p>
    <form method="get" action="/verify" class="stack-form" style="max-width:420px">
      <label>검증 코드<input type="text" name="code" placeholder="확인서에 적힌 코드" required autocomplete="one-time-code" /></label>
      <button class="btn btn-primary btn-block">검증하기</button></form>
  </div></section>

  <section class="section section-alt"><div class="container">
    <div class="section-head"><h2 class="section-title">법적으로 유효한가</h2></div>
    <p class="landing-lead">유효합니다. 「전자문서 및 전자거래 기본법」 제4조는 전자문서가 종이 문서와 같은 효력을 가진다고 정하고,
      「전자서명법」 제3조는 <b>전자서명이라는 이유만으로 효력을 부인할 수 없다</b>고 정합니다.
      2020년 개정으로 공인인증서 독점이 폐지되어, 지금은 <b>본인 확인과 위변조 방지가 되는 방식</b>이면 됩니다.</p>
    <p class="landing-lead">그래서 이 서비스는 다툼이 생겼을 때 필요한 것을 남깁니다 —
      <b>누가</b>(휴대폰 본인확인) <b>언제</b>(시점 앵커) <b>무엇에</b>(본문·입력값·좌표 해시) 서명했는지,
      그리고 <b>그 뒤로 바뀌지 않았다는 것</b>(Ed25519 봉인·서명 사슬)까지 한 벌로 묶어 드립니다.</p>
    <div class="honest-box">
      <h3>다만, 이건 안 됩니다</h3>
      <ul>
        <li><b>법으로 종이·공증을 요구하는 계약</b>은 대상이 아닙니다. 유언, 일부 가족관계 서류 등이 그렇습니다.</li>
        <li><b>인감증명서를 대신하지 않습니다.</b> 상대가 인감을 요구하면 별도로 받으셔야 합니다.</li>
        <li><b>국토부 부동산거래 전자계약시스템과는 다른 서비스</b>입니다. 그쪽이 필요한 거래는 그쪽을 쓰셔야 합니다.</li>
        <li>본인확인은 <b>휴대폰 번호 기준</b>입니다. 명의도용까지 막지는 못합니다 —
          중요한 계약은 신분증 사본을 첨부로 함께 받으시길 권합니다.</li>
      </ul>
      <p>업종에 따라 요구되는 요건이 다를 수 있으니, 큰 금액의 계약은 법률 자문을 함께 받으시길 권합니다.</p>
    </div></div>
  </div></section>

  ${priceSection}

  <section class="section"><div class="container">
    <h2 class="section-title">지금 시작하세요</h2>
    <p class="landing-lead">1분이면 됩니다. 신용카드도 설치도 필요 없습니다.<br />
      쓰시던 계약서 양식을 옮겨 드리길 원하시면 문의를 남겨 주세요.</p>
    <div class="hero-actions">
      <a href="/esign/signup" class="btn btn-primary btn-lg">무료로 시작하기</a>
      <a href="/apply?kind=esign" class="btn btn-ghost btn-lg">도입 문의</a></div>
  </div></section>`;
  return html(layout({ title: "", base: "", user: ctx.user, body, csrf, product: { name: siteName, home: "/esign" },
    description: "가입 없이 링크로 서명하는 전자계약. 서명·도장 자리를 계약서 위에 놓고 보내면 그 자리에서 체결됩니다. 위변조 검증·증적 패키지·API 연동 지원." }));
}

// ================= 홈페이지 제작 서비스 (제품 소개) =================
// 파는 것은 "예쁜 홈페이지"가 아니라 "상담 신청이 쌓이는 화면"이다. 그래서 화면 자랑이 아니라
// DB 가 어떻게 들어오고 어떻게 관리되는지를 앞에 둔다.
export const homepageProduct = async (db) => ({
  name: (await D.getSetting(db, "homepage_brand")) || "가맹점 모집 홈페이지",
  home: "/homepage",
  mark: "storefront",
  links: [["/homepage", "소개"], ["/homepage#included", "구성"], ["/homepage#db", "상담 DB"]],
  cta: ["/apply?kind=franchise", "제작 문의"],
});

export async function homepageLanding(ctx) {
  const { db, csrf, user } = ctx;
  const product = await homepageProduct(db);
  const step = (n, t, d) => `<div class="es-step"><span class="es-n">${n}</span><div><h3>${esc(t)}</h3><p>${esc(d)}</p></div></div>`;
  // 요금은 운영사 콘솔에 넣은 값만 보여 준다. 안 정했으면 아예 안 띄운다 —
  // 화면에는 있는데 실제로는 안 받는 금액이 제일 나쁘다.
  const prices = await planPrices(D.getSetting, db);
  const sendPrice = await priceOf(db, "alimtalk");
  const shown = PLAN_KEYS.filter((k) => prices[k] !== undefined);
  const priceSection = !shown.length ? "" : `
  <section class="section"><div class="container">
    <div class="section-head"><h2 class="section-title">얼마인가</h2></div>
    <div class="price-grid">${shown.map((k) => `<div class="price-card${k === "basic" ? " is-pick" : ""}">
      <h3>${esc(PLANS[k].label)}</h3>
      <p class="price-num">${prices[k] === 0 ? "0" : prices[k].toLocaleString()}<small>원 / 월</small></p>
      <p class="price-note">${prices[k] === 0 ? "계약서 만들기·서명받기·증적 모두 포함" : "부가세 별도"}</p>
    </div>`).join("")}</div>
    <p class="landing-lead">계약서를 만들고 서명받는 것 자체는 요금제에 포함됩니다.
      <b>알림톡 발송만 건당 ${sendPrice.toLocaleString()}원</b>으로 따로 계산합니다 — 미리 충전해 두고 쓴 만큼 차감됩니다.
      계약 한 건에 서명자 1인당 3통(요청·본인확인·완료)이 나갑니다.</p>
    <p class="panel-hint">API 호출·증적 다운로드·위변조 검증에는 추가 요금이 없습니다.</p>
  </div></section>`;
  const body = `
  <section class="landing-hero es-hero"><div class="container">
    <p class="hero-eyebrow">프랜차이즈 · 가맹점 모집을 위한</p>
    <h1 class="landing-title">보고 나면<br /><span>연락처를 남기는</span> 홈페이지</h1>
    <p class="landing-lead">브랜드 소개부터 창업 비용·가맹 절차·상담 신청까지 한 장으로 이어지는 <b>가맹점 모집 랜딩페이지</b>를 만들어 드립니다.
      들어온 상담 신청은 그대로 <b>DB로 쌓이고</b>, 연락 상태까지 한 화면에서 관리합니다.</p>
    <div class="hero-actions"><a href="/apply?kind=franchise" class="btn btn-primary btn-lg">제작 문의하기</a>
      <a href="#included" class="btn btn-ghost btn-lg">구성 보기</a></div>
    <p class="hero-note">이미 쓰고 계신가요? <a href="/login">로그인</a></p>
  </div></section>

  <section class="section" id="included"><div class="container">
    <div class="section-head"><h2 class="section-title">한 장에 들어가는 것</h2>
      <p class="section-lead">완성된 페이지를 위에서 아래로 훑으면 이 순서입니다.
        필요 없는 줄은 끄고, 순서는 끌어서 바꿉니다.</p></div>
    <ol class="page-outline">
      ${[["히어로", "첫 화면에서 브랜드와 제안을 한 문장으로"],
         ["흐르는 띠", "핵심 숫자·강점을 반복 노출"],
         ["브랜드 소개", "왜 이 브랜드인지 설명하는 본문과 사진"],
         ["창업 강점", "점주가 궁금해하는 이유를 카드로"],
         ["점주 후기", "실제 운영자의 말이 가장 강한 근거"],
         ["메뉴·상품", "대표 상품을 사진·가격과 함께"],
         ["가맹 절차", "상담부터 오픈까지의 단계"],
         ["가맹 비용", "표로 정리 · 상담 전에는 가려 두기 가능"],
         ["상담 신청 폼", "이 페이지의 목적 — 연락처 수집", true],
         ["매장 안내", "운영 중인 가맹점 목록과 지도"],
         ["자주 묻는 질문", "망설임을 미리 걷어내기"],
         ["고정 하단 바", "모든 페이지에서 전화·신청이 한 번에"],
        ].map(([t, d, key]) => `<li${key ? ' class="is-key"' : ""}><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join("")}
    </ol>
  </div></section>

  <section class="section section-alt" id="db"><div class="container">
    <div class="section-head"><h2 class="section-title">상담 신청이 쌓이는 방식</h2></div>
    <div class="es-steps">
      ${step(1, "방문자가 폼을 채웁니다", "성함·연락처·희망 지역·창업 예산·유입 경로. 필요 없는 칸은 뺄 수 있습니다.")}
      ${step(2, "즉시 알림이 갑니다", "담당자에게 카카오 알림톡과 메일이 바로 갑니다. 신청자에게도 접수 확인 문자가 나갑니다.")}
      ${step(3, "DB로 저장됩니다", "신청 순서대로 목록에 쌓입니다. 같은 번호로 연달아 눌린 중복 신청은 걸러집니다.")}
      ${step(4, "연락 상태를 남깁니다", "신규 · 연락 완료 · 상담/방문 · 계약 · 보류 — 어디까지 진행됐는지 한눈에 보입니다.")}
      ${step(5, "계약으로 잇습니다", "상담 건에서 바로 가맹계약서를 만들어 서명 링크를 보냅니다. 이름·번호를 다시 옮겨 적지 않습니다.")}
      ${step(6, "엑셀로 내려받습니다", "CSV 한 번이면 영업팀 시트로 그대로 옮겨집니다.")}
    </div>
    <p class="panel-hint" style="margin-top:18px">방문 수 대비 <b>전환율</b>과 <b>광고 출처별</b> 집계가 함께 나옵니다 —
      어느 광고가 실제로 신청을 만들었는지 보고 예산을 옮기세요.
      인스타용·검색광고용 <b>문구를 따로 둔 랜딩</b>을 여러 벌 만들어 어느 쪽이 더 신청을 만드는지 나란히 비교할 수 있습니다.</p>
  </div></section>

  <section class="section"><div class="container">
    <div class="section-head"><h2 class="section-title">맡기고 끝이 아니라, 직접 고칩니다</h2>
      <p class="section-lead">문구 하나 바꾸려고 제작사에 메일을 쓰지 않습니다.</p></div>
    <div class="lede-pair">
      ${[["관리자가 직접 수정", "문구·순서·사진을 관리자 화면에서 바꿉니다. 사진은 올리면 바로 붙고, 수정 요청을 기다릴 필요가 없습니다."],
         ["초안으로 고치고 발행", "고치는 동안 손님에게는 옛 화면이 그대로 보입니다. 미리보기로 확인한 뒤 발행하세요."],
        ].map(([t, d]) => `<div class="lede"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join("")}
    </div>
    <p class="section-lead" style="margin-top:34px">그 밖에 따로 말씀하지 않아도 기본으로 들어갑니다.</p>
    <ul class="plain-list">
      ${[["모바일 우선", "가맹 문의는 대부분 휴대폰에서 옵니다. 고정 하단 바로 전화·신청이 어느 화면에서든 손끝에 있습니다."],
         ["우리 도메인 연결", "브랜드 도메인을 그대로 붙이고, 검색 노출 설정도 함께 잡아 드립니다."],
         ["개인정보 자동 파기", "상담에 필요한 항목만 받고, 처리 끝난 건은 정한 기간이 지나면 매일 자동으로 지웁니다."],
         ["스팸 차단", "봇 방지·허니팟·중복 제출 차단이 기본입니다. 쓰레기 DB가 쌓이지 않습니다."],
        ].map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join("")}
    </ul>
  </div></section>

  <section class="section section-alt"><div class="container">
    <div class="section-head"><h2 class="section-title">제작은 이렇게 진행됩니다</h2></div>
    <div class="es-steps">
      ${step(1, "문의 · 상담", "브랜드와 모집 목표를 듣습니다. 지금 쓰시는 자료가 있으면 그대로 받습니다.")}
      ${step(2, "구성 확정", "어떤 섹션을 쓸지, 어떤 항목을 받을지 함께 정합니다.")}
      ${step(3, "제작 · 콘텐츠 반영", "문구와 사진을 넣어 초안을 올립니다. 바로 눈으로 보며 고칩니다.")}
      ${step(4, "오픈 · 인계", "도메인을 연결하고 관리자 계정을 드립니다. 이후 수정은 직접 하시면 됩니다.")}
    </div>
  </div></section>

  <section class="section"><div class="container">
    <h2 class="section-title">가맹점 모집, 화면부터 바꿔 보세요</h2>
    <p class="landing-lead">문의는 무료입니다. 브랜드 자료만 있으면 어떤 구성이 맞을지 먼저 잡아 드립니다.</p>
    <div class="hero-actions">
      <a href="/apply?kind=franchise" class="btn btn-primary btn-lg">제작 문의하기</a>
      <a href="/esign" class="btn btn-ghost btn-lg">전자계약도 보기</a></div>
  </div></section>`;
  return html(layout({ title: "", base: "", user, body, csrf, product,
    description: "프랜차이즈 가맹점 모집 랜딩페이지 제작. 브랜드 소개·가맹 절차·창업 비용·상담 신청을 한 장에 담고, 들어온 상담 신청은 DB로 관리합니다." }));
}

// 전자계약 전용 조직의 홈 — 손님(계약 상대방)과 담당자 둘 다 여기로 들어온다.
async function esignHome(ctx) {
  const { db, assoc, base, user, csrf, query } = ctx;
  const notices = await D.listNotices(db, assoc.id, 3);
  const noticeHtml = notices.length ? `<section class="section section-alt"><div class="container">
    <h2 class="biz-section-title">공지</h2><ul class="notice-list">${notices.map((n) => `<li><a href="${base}/notices/${n.id}">
      <span class="notice-title">${esc(n.title)}</span><time>${esc(kstDate(n.created_at, "."))}</time></a></li>`).join("")}</ul></div></section>` : "";
  // 계약을 만드는 사람과 서명하는 사람이 같을 수 있다 — 해당하는 입구를 모두 보여 준다
  const canManage = user && (user.role === "ADMIN" || user.role === "STAFF");
  const mine = !user
    ? `<a href="/login" class="btn btn-primary btn-lg">로그인</a>`
    : `${canManage ? `<a href="${base}/admin/documents" class="btn btn-primary btn-lg">계약 관리로</a>` : ""}
       <a href="${base}/sign" class="btn ${canManage ? "btn-ghost" : "btn-primary"} btn-lg">서명할 문서 보기</a>`;
  const body = `<section class="landing-hero"><div class="container">
      <p class="hero-eyebrow">${esc(assoc.name)}</p>
      <h1 class="landing-title">전자계약</h1>
      <p class="landing-lead">${esc(assoc.tagline || "종이 없이, 만나지 않고, 법적 효력 있는 계약을 체결합니다.")}</p>
      <div class="hero-actions">${mine}</div>
      <p class="hero-note">계약 상대방은 <b>가입 없이</b> 카카오톡·문자로 받은 링크로 바로 서명합니다.
        서명하실 분은 받으신 링크를 열어 주세요 — 이 화면에서 로그인할 필요가 없습니다.</p>
    </div></section>
    <section class="section"><div class="container">
      <div class="section-head"><h2 class="section-title">계약이 끝나는 과정</h2></div>
      <div class="feature-grid">${[
        ["계약서 작성", "표준 서식을 고르고 빈칸만 채웁니다"],
        ["서명 자리 배치", "서명·도장·날짜 자리를 계약서 위에 놓습니다"],
        ["링크 발송", "상대방에게 카카오톡·문자로 서명 링크가 갑니다"],
        ["본인확인·서명", "휴대폰 인증 후 그 자리에서 서명·날인"],
        ["증적 확보", "확인서·감사추적·검증절차를 한 벌로 보관"],
        ["누구나 검증", "검증코드로 제3자가 위변조를 확인"],
      ].map(([t, d]) => `<div class="feature-card"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join("")}</div>
    </div></section>
    <section class="section section-alt"><div class="container">
      <div class="section-head"><h2 class="section-title">서명한 계약이 진짜인지 확인</h2></div>
      <p class="landing-lead">확인서에 적힌 검증 코드를 넣으면 누구나 위변조 여부를 확인할 수 있습니다.</p>
      <form method="get" action="/verify" class="stack-form" style="max-width:420px">
        <label>검증 코드<input type="text" name="code" placeholder="확인서에 적힌 코드" required autocomplete="one-time-code" /></label>
        <button class="btn btn-primary btn-block">검증하기</button></form>
    </div></section>
    ${noticeHtml}`;
  return html(layout({ title: assoc.name, assoc, base, user, body, csrf, activeNav: `${base}/`,
    description: `${assoc.name} 전자계약 — 가입 없이 링크로 서명하고, 서명한 계약은 누구나 검증할 수 있습니다.` }));
}

// ================= 외부(비회원) 서명 =================
// 로그인 없이 링크만으로 들어오는 화면. 인증은 오직 HMAC 토큰 + (선택) 본인확인이다.
// 상인회 사이트의 레이아웃을 쓰되 로그인 메뉴는 의미가 없으므로 user=null 로 그린다.
export async function extSignForm(ctx) {
  const { db, env, params, query, csrf, url } = ctx;
  const signer = await resolveExtToken(db, env.SESSION_SECRET, params.token || "");
  if (!signer) return notFoundResponse(ctx);
  const d = await D.getDocument(db, signer.document_id);
  if (!d) return notFoundResponse(ctx);
  const assoc = await D.getAssociationById(db, d.association_id);
  if (!assoc) return notFoundResponse(ctx);
  const base = "";
  const to = `/esign/${encodeURIComponent(params.token)}`;
  await D.markExternalOpened(db, signer.id);
  await D.logDocEvent(db, { documentId: d.id, userId: -signer.id, actorName: signer.name, kind: "viewed",
    detail: "외부 서명자", ip: ctx.ip || "", userAgent: ctx.request.headers.get("user-agent") || "", dedupeMin: 10 });

  const shellPage = (inner, title) => html(layout({ title, assoc, base, user: null, body:
    `<section class="section page-top"><div class="container">
      <div class="ext-head"><p class="section-eyebrow">${esc(assoc.name)} · 전자서명</p>
        <h1 class="article-title">${esc(d.title)}</h1>
        <p class="ext-who">${esc(signer.name)}${signer.org ? ` <small>(${esc(signer.org)})</small>` : ""} 님께 서명을 요청했습니다.</p></div>
      ${inner}</div></section>`, csrf }));

  if (await D.hasSignedExt(db, d.id, signer.id)) {
    // 어두운 '완료' 화면 (디자인 시스템 v3 · 레퍼런스 '결제가 완료되었어요').
    // 서명 직후에도, 나중에 링크를 다시 열어도 같은 화면이다 — 완료는 완료다.
    const rc = await D.requestCounts(db, d.id);
    const mine = (await D.listSignatures(db, d.id)).find((x) => x.external_id === signer.id);
    const tokenQ = encodeURIComponent(params.token);
    const allDone = rc.total > 0 && rc.signed >= rc.total;
    const when = d.due_date || String(d.created_at || "").slice(0, 10);
    return html(layout({ title: d.title, assoc, base, user: null, csrf, body: `<section class="done-screen"><div class="container">
      <h1 class="done-title">서명이 완료되었어요</h1>
      <article class="tk-card">
        <div class="tk-band"><span>${esc(ymdDow(when))}</span><b>${allDone ? "체결 완료" : `서명 ${rc.signed}/${rc.total}`}</b></div>
        <div class="tk-body">
          <div class="tk-row"><span>${esc(d.title)}</span><small>${rc.total ? `${rc.total}명` : ""}</small></div>
          <div class="tk-route">
            <div class="tk-pt is-text"><small>${esc(assoc.name)}</small><b>${esc(signer.name)}</b></div>
            <div class="tk-arrow" aria-hidden="true"><svg viewBox="0 0 26 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7h20"/><path d="M17 2l5 5-5 5"/></svg></div>
            <div class="tk-pt"><small>서명함</small><b>${rc.signed}<span class="tk-of">/${rc.total || "-"}</span></b></div>
          </div>
        </div>
        <div class="tk-actions"><a class="btn btn-outline" href="/esign/${tokenQ}/paper">계약서 확인</a></div>
      </article>
      <ul class="done-notes">
        <li>서명하신 계약서는 그 순간 봉인되어 한 글자도 바꿀 수 없습니다.</li>
        <li>확인서는 등록하신 연락처로 보내드렸습니다.${mine ? ` 검증 번호는 <b>${esc(mine.verify_code)}</b> 입니다.` : ""}</li>
        <li>계약서·확인서·검증 방법이 담긴 증적 패키지는 분쟁 시 그대로 쓰실 수 있습니다.</li>
      </ul>
      <section class="done-next">
        <h3>증적 패키지도 받아 둘까요?</h3>
        <p class="done-sub">서명된 계약서 · 전자서명 확인서 · 감사 추적 · 검증 방법이 한 벌로 묶여 있습니다.</p>
        <a class="btn btn-outline" href="/esign/${tokenQ}/evidence"><b>증적 패키지</b><span>내려받기</span> <span aria-hidden="true">›</span></a>
      </section>
    </div></section>` }));
  }
  if (signer.declined_at)
    return shellPage(`<div class="flash flash-warn">이 계약의 서명을 거절하셨습니다.<br /><small>사유: ${esc(signer.decline_reason || "")}</small></div>`, d.title);
  if (d.closed) return shellPage(`<div class="flash flash-warn">마감된 문서입니다.</div>`, d.title);
  if (D.isPastDue(d)) return shellPage(`<div class="flash flash-warn">서명 기한(${esc(d.due_date)})이 지났습니다. 요청하신 분께 문의해 주세요.</div>`, d.title);
  if (!(await D.canSignNowAny(db, d, { externalId: signer.id })))
    return shellPage(`<div class="flash flash-warn">순차 서명 문서입니다. 앞 순번의 서명이 끝나면 다시 이 링크로 들어와 주세요.</div>
      <div class="paper-wrap">${renderPaper(d.body, { scans, mediaUrl, fieldsFor: () => "" })}</div>`, d.title);

  // 본인확인 — 연락처가 있으면 그쪽으로만 보낸다(링크가 유출돼도 서명은 완성되지 않는다)
  const needOtp = await otpRequired(db);
  const otpDone = needOtp ? await D.extOtpVerifiedRecently(db, signer.id) : true;
  const canReach = D.isValidPhone(signer.phone || "") || !!signer.email;
  const otpBlock = !needOtp || otpDone ? "" : `<section class="panel panel-accent otp-gate">
    <h2 class="panel-title">본인확인</h2>
    ${canReach ? `<p class="panel-hint">본인 확인을 위해 <b>${esc(D.isValidPhone(signer.phone) ? D.maskPhone(signer.phone) : maskEmail(signer.email))}</b> 로 인증번호를 보냅니다.</p>
      <div class="form-two">
        <form method="post" action="${to}/otp" class="stack-form compact"><button class="btn btn-ghost btn-sm">인증번호 받기</button></form>
        <form method="post" action="${to}/otp/verify" class="stack-form compact">
          <label>인증번호 6자리<input type="text" name="code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required autocomplete="one-time-code" /></label>
          <button class="btn btn-primary btn-sm">확인</button></form></div>`
      : `<div class="flash flash-warn">연락처가 등록되어 있지 않아 본인확인을 할 수 없습니다. 요청하신 분께 문의해 주세요.</div>`}</section>`;

  const scans = await D.listDocPages(db, d.id);   // 올린 양식이면 이 그림들이 지면이다
  const fields = await D.listFieldsWithValues(db, d.id);
  const reqs = await D.listRequestStatus(db, d.id);
  const exts = await D.listExternalSigners(db, d.id);
  const nameOf = (ref) => { if (ref < 0) { const e = exts.find((x) => x.id === -ref); return e ? e.name : ""; }
    const u = reqs.find((r) => r.id === ref); return u ? u.name : ""; };
  const myRef = -signer.id;
  const myFields = fields.filter((f) => !f.value && !f.image && (f.assignee === myRef || f.assignee === 0));
  const hasSignField = myFields.some((f) => f.kind === "sign");
  const docView = fields.length
    ? `<div class="paper-wrap">${renderPaper(d.body, { scans, mediaUrl, mode: otpDone ? "fill" : "view",
        fieldsFor: fieldsRenderer(fields, { mode: otpDone ? "fill" : "view", myId: myRef, nameOf }) })}</div>`
    : `<div class="doc-body">${docBody(d.body)}</div>`;
  const inner = `${flashOf(query)}${otpBlock}
    ${fields.length && otpDone ? `<div class="field-progress" id="fieldProgress"></div>
      <button type="button" class="btn btn-ghost btn-sm field-jump" id="fieldJump" hidden>다음 항목으로 이동 ↓</button>` : ""}
    ${fields.length ? plainRead(d.body) : ""}
    ${docView}
    ${d.attachment ? `<p class="doc-attach">계약서 원문: <a href="${esc(mediaUrl(d.attachment))}" target="_blank" rel="noopener">${esc(d.attachment_name || "계약서.pdf")}</a></p>` : ""}
    <details class="doc-hash"><summary>문서 지문 <code>${esc(String(d.content_hash).slice(0, 8))}…${esc(String(d.content_hash).slice(-8))}</code></summary>
      <p>이 계약서 내용으로 계산한 값입니다. 글자 하나만 바뀌어도 값이 달라지므로, 나중에 문서가 바뀌지 않았는지 이 값으로 확인할 수 있습니다.</p>
      <code>${esc(d.content_hash)}</code></details>
    ${otpDone ? `<form method="post" action="${to}" class="stack-form sign-form" id="signForm" enctype="multipart/form-data">
      ${hasSignField ? "" : `<label>서명<div class="sign-pad-wrap"><canvas id="signPad" class="sign-pad" width="600" height="200"></canvas><button type="button" class="btn btn-ghost btn-xs sign-clear" id="signClear">지우기</button></div></label>`}
      <input type="hidden" name="signature" id="signatureData" /><input type="hidden" name="fields" id="fieldValues" />
      ${fileInputs(myFields)}
      <label>서명자 성명<input type="text" name="signer_name" id="signerName" value="${esc(signer.name)}" required maxlength="60" autocomplete="name" /></label>
      <label class="check check-tap"><input type="checkbox" name="consent" value="1" required id="signConsent" /> 위 내용을 확인했으며 본인이 전자서명하는 데 동의합니다.</label>
      <button class="btn btn-primary btn-block" id="signSubmit">전자서명 제출</button>
      <p class="sign-why" id="signWhy">위 <b>동의</b>에 체크하면 제출할 수 있습니다.</p></form>` : ""}
    <p class="auth-note">서명 시 서명자·시각·IP·기기·문서해시가 기록되고 Ed25519 디지털 서명으로 봉인됩니다.
      서명이 끝나면 확인서를 ${signer.email ? esc(maskEmail(signer.email)) : "등록된 연락처"}로 보내드립니다.</p>
    <details class="decline-box"><summary>이 계약에 동의할 수 없습니다 (거절)</summary>
      <form method="post" action="${to}/decline" class="stack-form compact" data-confirm="거절하면 이 링크로는 더 이상 서명할 수 없습니다. 계속할까요?">
        <label>거절 사유<textarea name="reason" rows="3" required maxlength="300"></textarea></label>
        <button class="btn btn-ghost btn-sm">서명 거절</button></form></details>
    ${fields.length && otpDone ? `<div class="fd-back" id="fieldDialog" hidden><div class="fd-box">
      <h3 class="fd-title" id="fdTitle"></h3><div id="fdBody"></div>
      <div class="fd-actions"><button type="button" class="btn btn-ghost btn-sm" id="fdCancel">취소</button>
        <button type="button" class="btn btn-primary btn-sm" id="fdOk">확인</button></div></div></div>` : ""}`;
  const scripts = `<script src="${assetUrl("/js/sign.js")}" defer></script>` +
    (fields.length ? `<script src="${assetUrl("/js/paper.js")}" defer></script>` : "");
  return html(layout({ title: `서명: ${d.title}`, assoc, base, user: null, csrf, scripts, body:
    `<section class="section page-top"><div class="container">
      <div class="ext-head"><p class="section-eyebrow">${esc(assoc.name)} · 전자서명</p>
        <h1 class="article-title">${esc(d.title)}</h1>
        <p class="ext-who">${esc(signer.name)}${signer.org ? ` <small>(${esc(signer.org)})</small>` : ""} 님께 서명을 요청했습니다.</p></div>
      ${inner}</div></section>` }));
}
// 외부 서명자가 자기 계약의 완성본·증적을 받는 경로.
// 회원용 /documents/:id/* 는 로그인이 필요하므로 링크가 통하지 않는다 — 토큰으로 여는 짝을 둔다.
async function extDocContext(ctx) {
  const signer = await resolveExtToken(ctx.db, ctx.env.SESSION_SECRET, ctx.params.token || "");
  if (!signer) return null;
  const doc = await D.getDocument(ctx.db, signer.document_id);
  if (!doc) return null;
  const assoc = await D.getAssociationById(ctx.db, doc.association_id);
  if (!assoc) return null;
  return { signer, doc, assoc };
}

export async function extPaper(ctx) {
  const c = await extDocContext(ctx);
  if (!c) return notFoundResponse(ctx);
  const { doc: d, assoc } = c;
  const scans = await D.listDocPages(ctx.db, d.id);   // 올린 양식이면 이 그림들이 지면이다
  const fields = await D.listFieldsWithValues(ctx.db, d.id);
  const reqs = await D.listRequestStatus(ctx.db, d.id);
  const exts = await D.listExternalSigners(ctx.db, d.id);
  const parties = await D.listDocParties(ctx.db, d.id);
  const rc = await D.requestCounts(ctx.db, d.id);
  const done = rc.total > 0 && rc.signed === rc.total;
  const nameOf = (ref) => { if (ref < 0) { const e = exts.find((x) => x.id === -ref); return e ? e.name : ""; }
    const u = reqs.find((r) => r.id === ref); return u ? u.name : ""; };
  const body = `<section class="section page-top"><div class="container">
    <div class="dash-head no-print"><div><p class="section-eyebrow">${esc(assoc.name)} · 완성본</p><h1 class="dash-title">${esc(d.title)}</h1>
      <p class="dash-sub"><a href="/esign/${esc(ctx.params.token)}">← 돌아가기</a> · 서명 ${rc.signed}/${rc.total}${done ? " · 체결 완료" : " · 진행 중"}</p></div>
      <div class="dash-head-actions"><button type="button" class="btn btn-primary btn-sm" data-print>인쇄 · PDF로 저장</button>
        ${done ? `<a href="/esign/${esc(ctx.params.token)}/evidence" class="btn btn-ghost btn-sm">증적 패키지</a>` : ""}</div></div>
    ${sealNote(fields, assoc ? assoc.name : "")}
    <div class="paper-wrap">${renderPaper(d.body, { scans, mediaUrl,
      fieldsFor: fieldsRenderer(fields, { mode: "view", nameOf, parties }), watermark: done ? "" : "미완성" })}</div></div></section>
    <style>@media print{@page{size:A4;margin:0}body{background:#fff}}</style>`;
  return html(layout({ title: `${d.title} — 완성본`, assoc, base: "", user: null, body, csrf: ctx.csrf,
    scripts: `<script src="${assetUrl("/js/paper.js")}" defer></script>` }));
}

export async function extEvidence(ctx) {
  const c = await extDocContext(ctx);
  if (!c) return notFoundResponse(ctx);
  // 자기가 서명한 계약의 증거는 본인도 가져갈 수 있어야 한다 (한쪽만 증거를 쥐면 안 된다)
  const { zip, filename } = await buildEvidence(ctx.env, ctx.db, c.doc, c.assoc);
  return new Response(zip, { headers: { "content-type": "application/zip",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "cache-control": "no-store" } });
}

const maskEmail = (e) => { const [a, b] = String(e || "").split("@"); return b ? `${a.slice(0, 2)}${"*".repeat(Math.max(1, a.length - 2))}@${b}` : ""; };

// 증적 패키지 — 소송·분쟁에 그대로 낼 수 있는 한 벌(ZIP). 서명자도 자기 계약 것은 받을 수 있다.
export async function documentEvidence(ctx) {
  const { db, env, assoc, user, params } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  if (!d || d.association_id !== assoc.id) return notFoundResponse(ctx);
  // 역할 목록에 값을 하나 더했다고 권한이 조용히 늘어나면 안 된다 — 허용 역할을 명시한다.
  // 부서를 켠 조직에서는 '담당자라서 본다' 가 자기 부서 안에서만 성립한다.
  // 서명자는 그대로다 — 남의 부서 계약이어도 자기가 서명할 계약은 봐야 한다.
  const isAdmin = (user.role === "ADMIN" || user.role === "STAFF" || user.role === "SUPERADMIN")
    && D.canSeeDoc(assoc, user, d);
  if (!isAdmin && !(await D.canReceiveSign(db, d.id, user.id, user.role))) return notFoundResponse(ctx);
  const { zip, filename } = await buildEvidence(env, db, d, assoc);
  return new Response(zip, { headers: {
    "content-type": "application/zip",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "cache-control": "no-store",
  } });
}

// 지면에 놓인 필드를 페이지별로 뿌리는 헬퍼. fields 는 값(value/image)이 붙어 있을 수 있다.
// 계약서에 발신자 직인이 찍혀 있으면 그 사실을 종이에도 적는다.
// 이 문서를 받은 제3자는 도장 두 개를 보고 "둘 다 서명했다" 로 읽는다 — 한쪽은 서명이 아니다.
// 첨부 자리는 폼 안에 진짜 <input type=file> 을 하나씩 둔다.
// 파일을 JSON 에 base64 로 실으면 10MB 가 13MB 로 부풀고, 휴대폰에서 그대로 멈춘다.
// 화면에는 안 보이고, 지면의 그 칸을 누르면 이 입력을 대신 연다(paper.js).
const fileInputs = (fields) => (fields || []).filter((f) => f.kind === "file")
  .map((f) => `<input type="file" id="ff-${f.id}" name="file_${f.id}" accept="image/*,application/pdf" hidden />`).join("");

export const sealNote = (fields, orgName = "") => {
  const n = (fields || []).filter((f) => f.auto === "seal" && (f.image || f.value)).length;
  if (!n) return "";
  return `<p class="seal-note">이 계약서의 도장 ${n}곳은 <b>${esc(orgName || "보내는 쪽")}</b>이 발송 전에 찍은 <b>직인</b>입니다.
    상대방의 전자서명이 아니며, 어느 서명자의 봉인에도 들어가지 않습니다.
    상대방의 서명은 서명 자리에 있고, 그 진위는 확인서·증적 패키지로 검증합니다.</p>`;
};

function fieldsRenderer(fields, { mode, myId = 0, nameOf = () => "", parties = {} }) {
  return (page) => fields.filter((f) => f.page === page).map((f) => {
    const val = f.value || f.image ? { value: f.value || "", imageUrl: f.image ? mediaUrl(f.image) : "" } : null;
    // 아직 사람이 정해지지 않은 자리는 그 자리의 이름으로 보여 준다 — 빈칸으로 두면
    // 배치해 놓고도 누구 몫인지 알 수 없다.
    const who = f.auto === "seal" ? "우리 직인"
      : f.assignee ? nameOf(f.assignee) : f.slot > 0 ? D.partyLabel(parties, f.slot) : "";
    return fieldBox(f, { mode, val, mine: mode === "fill" && !val && (f.assignee === myId || f.assignee === 0), assigneeName: who });
  }).join("");
}

// 필드 배치 편집기 — "여기에 서명, 여기에 도장" 을 관리자가 직접 지면 위에 놓는다.
export async function adminDocFields(ctx) {
  const { db, assoc, base, user, params, query, csrf } = ctx;
  const d = await docOf(ctx, params.id);
  if (!d || d.association_id !== assoc.id) return notFoundResponse(ctx);
  const sigs = await D.requestCounts(db, d.id);
  const signedAny = (await D.listSignatures(db, d.id)).length > 0;
  const scans = await D.listDocPages(db, d.id);   // 올린 양식이면 이 그림들이 지면이다
  const reqs = await D.listRequestStatus(db, d.id);
  const parties = await D.listDocParties(db, d.id);   // { 1: "임대인", … }
  // 값까지 함께 읽는다 — 우리 직인은 놓는 즉시 찍히므로, 값을 안 읽으면 배치 화면에서
  // 도장이 안 보여 "안 찍혔나" 싶어진다.
  const fields = await D.listFieldsWithValues(db, d.id);
  const extForName = await D.listExternalSigners(db, d.id);
  const nameOf = (ref) => { if (ref < 0) { const e = extForName.find((x) => x.id === -ref); return e ? e.name : ""; }
    const u = reqs.find((r) => r.id === ref); return u ? u.name : ""; };
  const paper = renderPaper(d.body, { scans, mediaUrl, mode: "edit", fieldsFor: fieldsRenderer(fields, { mode: "edit", nameOf, parties }) });
  // 이미 서명이 시작된 문서는 지면을 바꿀 수 없다 — 서명자가 본 화면과 달라지면 봉인의 의미가 사라진다
  if (signedAny) {
    const b = `<section class="dash"><div class="container">
      <div class="dash-head"><div><h1 class="dash-title">필드 배치 — ${esc(d.title)}</h1></div></div>
      <div class="flash flash-warn">이미 서명이 시작된 문서입니다. 서명자가 확인한 지면이 바뀌면 안 되므로 배치를 수정할 수 없습니다.</div>
      <p><a href="${base}/admin/documents/${d.id}" class="btn btn-ghost btn-sm">← 문서로</a></p>
      <div class="paper-wrap">${renderPaper(d.body, { scans, mediaUrl, fieldsFor: fieldsRenderer(fields, { mode: "view", nameOf, parties }) })}</div></div></section>`;
    return html(layout({ title: "필드 배치", assoc, base, user, body: b, csrf, scripts: `<script src="${assetUrl("/js/paper.js")}" defer></script>` }));
  }
  const palette = Object.entries(FIELD_KINDS).map(([k, v], i) =>
    `<button type="button" class="fp-item${i === 0 ? " on" : ""}" data-kind="${esc(k)}">${esc(v.label)}</button>`).join("");
  // 외부 서명자는 음수(-id)로 구분한다 — 회원 id 와 겹치지 않는 이름공간
  const extList = await D.listExternalSigners(db, d.id);
  // 보내기 전 초안에는 서명자가 아직 없다. 그래서 사람이 아니라 **자리**로 놓는다 —
  // '첫 번째 당사자의 서명', '두 번째 당사자의 도장'. 누가 그 자리인지는 보내기 화면에서 정한다.
  const assigneeOpts = d.draft
    ? `<option value="0" data-name="">누구나(먼저 서명하는 사람)</option>` +
      Array.from({ length: MAX_SLOTS }, (_, i) => {
        const label = esc(D.partyLabel(parties, i + 1));
        return `<option value="slot${i + 1}" data-name="${label}">${label}</option>`;
      }).join("")
    : `<option value="0" data-name="">누구나(먼저 서명하는 사람)</option>` +
      reqs.map((r) => `<option value="${r.id}" data-name="${esc(r.name)}">${esc(r.name)}</option>`).join("") +
      extList.map((e) => `<option value="${-e.id}" data-name="${esc(e.name)}">${esc(e.name)} (외부)</option>`).join("");
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">전자계약 · ${d.draft ? "서명 자리 놓기" : "필드 배치"}</p><h1 class="dash-title">${esc(d.title)}</h1>
      <p class="dash-sub">${d.draft
        ? `<a href="${base}/admin/documents/write?doc=${d.id}">← 계속 쓰기</a> · 아직 보내지 않은 계약서`
        : `<a href="${base}/admin/documents/${d.id}">← 문서로</a> · 서명 대상 ${sigs.total}명`}</p></div></div>
    ${flashOf(query)}
    <p class="fp-hint">놓을 종류를 고른 뒤 <b>계약서 위를 누르면</b> 그 자리에 필드가 생깁니다. 끌어서 옮기고, 오른쪽 아래 손잡이로 크기를 조절하세요.
      ${d.draft
        ? "아직 보내기 전이라 서명자가 정해지지 않았습니다. 그래서 사람 대신 <b>몇 번째 당사자</b>로 놓아 둡니다 — 누가 그 자리인지는 보내기 화면에서 정합니다."
        : "각 필드는 <b>누가 채울지</b> 지정할 수 있습니다."}
      도장 자리는 <b>우리 직인</b>으로 지정하면 ${assoc.seal_media ? "저장할 때 바로 찍힙니다" : "자동으로 찍힙니다 — 다만 아직 등록된 직인이 없습니다"}.</p>
    <!-- 계약서가 세 화면 넘게 길다. 도구와 저장 단추가 맨 위에 고정돼 있지 않으면,
         두 번째 장에 필드를 놓은 뒤 저장하려고 다시 맨 위까지 올라가야 한다. -->
    <div class="fp-dock">
      <div class="fp-bar">${palette}</div>
      <div class="fp-props" id="fieldProps" hidden>
        <span class="badge badge-info" id="fpKind"></span>
        <label>이름표<input type="text" id="fpLabel" maxlength="20" placeholder="예: 임차인 서명" /></label>
        <label>${d.draft ? "누구 자리" : "담당 서명자"}<select id="fpAssignee">${assigneeOpts}</select></label>
        <!-- 자리를 고른 순간 그 자리를 뭐라고 부를지 바로 묻는다. '1번째 당사자' 는 배치하는
             사람에게 아무것도 말해 주지 않는다 — 계약서는 임대인·임차인으로 말한다. -->
        <label class="fp-partyname" id="fpPartyWrap" hidden>이 자리의 이름
          <input type="text" id="fpPartyName" maxlength="20" placeholder="예: 임대인" autocomplete="off" /></label>
        <label class="check-inline"><input type="checkbox" id="fpReq" checked /> 필수</label>
        <!-- 도장 자리에만 뜬다. 회사는 계약마다 서명하지 않는다 — 직인이 이미 찍힌 계약서를 보낸다. -->
        <label class="check-inline fp-seal" id="fpSealWrap" hidden><input type="checkbox" id="fpSeal" /> 우리 직인</label>
        <button type="button" class="btn btn-ghost btn-sm" id="fpDel">삭제</button>
      </div>
      <form method="post" action="${base}/admin/documents/${d.id}/fields" id="fieldsForm" class="fp-save">
        <input type="hidden" name="fields" id="fieldsData" />
        <input type="hidden" name="parties" id="partiesData" />
        <button class="btn btn-primary">배치 저장</button></form>
    </div>
    <div class="paper-wrap">${paper}</div>
    <script type="application/json" id="fieldKinds">${JSON.stringify(FIELD_KINDS)}</script>
    <script type="application/json" id="partyNames">${JSON.stringify(parties)}</script>
    </div></section>`;
  return html(layout({ title: "필드 배치", assoc, base, user, body, csrf, scripts: `<script src="${assetUrl("/js/paper.js")}" defer></script>` }));
}

// 완성본 — 채워진 값이 모두 박힌 계약서. 브라우저 인쇄(PDF로 저장)로 그대로 받을 수 있다.
export async function documentPaper(ctx) {
  const { db, assoc, base, user, params, csrf } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  if (!d || d.association_id !== assoc.id) return notFoundResponse(ctx);
  // 역할 목록에 값을 하나 더했다고 권한이 조용히 늘어나면 안 된다 — 허용 역할을 명시한다.
  // 부서를 켠 조직에서는 '담당자라서 본다' 가 자기 부서 안에서만 성립한다.
  // 서명자는 그대로다 — 남의 부서 계약이어도 자기가 서명할 계약은 봐야 한다.
  const isAdmin = (user.role === "ADMIN" || user.role === "STAFF" || user.role === "SUPERADMIN")
    && D.canSeeDoc(assoc, user, d);
  if (!isAdmin && !(await D.canReceiveSign(db, d.id, user.id, user.role))) return notFoundResponse(ctx);
  const scans = await D.listDocPages(db, d.id);   // 올린 양식이면 이 그림들이 지면이다
  const fields = await D.listFieldsWithValues(db, d.id);
  const reqs = await D.listRequestStatus(db, d.id);
  const rc = await D.requestCounts(db, d.id);
  const done = rc.total > 0 && rc.signed === rc.total;
  const extNames = await D.listExternalSigners(db, d.id);
  const parties = await D.listDocParties(db, d.id);
  const nameOf = (ref) => { if (ref < 0) { const e = extNames.find((x) => x.id === -ref); return e ? e.name : ""; }
    const u = reqs.find((r) => r.id === ref); return u ? u.name : ""; };
  const paper = renderPaper(d.body, { scans, mediaUrl,
    fieldsFor: fieldsRenderer(fields, { mode: "view", nameOf, parties }),
    watermark: done ? "" : "미완성",
  });
  const backTo = isAdmin ? `${base}/admin/documents/${d.id}` : `${base}/sign`;
  const body = `<section class="section page-top"><div class="container">
    <div class="dash-head no-print"><div><p class="section-eyebrow">전자계약 · 완성본</p><h1 class="dash-title">${esc(d.title)}</h1>
      <p class="dash-sub"><a href="${backTo}">← 돌아가기</a> · 서명 ${rc.signed}/${rc.total}${done ? " · 체결 완료" : " · 진행 중"}</p></div>
      <div class="dash-head-actions"><button type="button" class="btn btn-primary btn-sm" data-print>인쇄 · PDF로 저장</button></div></div>
    ${sealNote(fields, assoc.name)}
    <div class="paper-wrap">${paper}</div></div></section>
    <style>@media print{@page{size:A4;margin:0}body{background:#fff}}</style>`;
  return html(layout({ title: `${d.title} — 완성본`, assoc, base, user, body, csrf, scripts: `<script src="${assetUrl("/js/paper.js")}" defer></script>` }));
}

// 전자서명 확인서 — 분쟁 시 제출용. 검증 코드만 있으면 누구나 열람·인쇄할 수 있다(제3자 확인 목적).
export async function certificatePage(ctx) {
  const { db, env, params, csrf } = ctx;
  const sig = await D.getSignatureByCode(db, params.code || "");
  if (!sig) return notFoundResponse(ctx);
  const doc = await D.getDocument(db, sig.document_id);
  const assoc = doc ? await D.getAssociationById(db, doc.association_id) : null;
  const v = await verifySignature(env, sig, doc);
  // 계약서에 발신자 직인이 함께 찍혀 있는가 — 있으면 그것이 서명이 아님을 확인서에도 적는다
  const sealed = doc ? (await D.listFieldsWithValues(db, doc.id)).some((f) => f.auto === "seal" && f.image) : false;
  const verifyUrl = `${ORIGIN}/verify/${encodeURIComponent(sig.verify_code)}`;
  const row = (k, val) => `<tr><th>${esc(k)}</th><td>${val}</td></tr>`;
  const body = `<section class="section page-top"><div class="container narrow cert-sheet">
    <div class="cert-head">
      <h1 class="article-title">전자서명 확인서</h1>
      <p class="cert-issuer">${esc(assoc ? assoc.name : "")}</p>
      <p class="cert-verdict">${v.valid
        ? '<span class="badge badge-ok">유효 — 봉인·본문 모두 무결</span>'
        : '<span class="badge badge-no">위변조 의심 — 아래 항목을 확인하세요</span>'}</p>
    </div>
    <table class="verify-table cert-table">
      ${row("문서 제목", esc(doc ? doc.title : "(삭제됨)"))}
      ${row("서명자", esc(sig.signer_name) + (sig.external_id ? ' <span class="badge badge-info">외부 서명자</span>' : ""))}
      ${row("서명 일시", esc(kstStamp(sig.signed_at)))}
      ${row("본인확인 수준", { identity: '실명 본인확인 <span class="badge badge-ok">최상</span>', otp: '휴대폰 인증번호 확인 <span class="badge badge-ok">강화</span>' }[sig.verify_level] || '계정 로그인 <span class="badge badge-muted">기본</span>')}
      ${row("서명 IP", esc(sig.ip))}
      ${row("서명 기기", `<small>${esc((sig.user_agent || "").slice(0, 120))}</small>`)}
      ${row("문서 해시 (SHA-256)", `<code class="cert-hash">${esc(sig.content_hash)}</code>`)}
      ${row("봉인값 (Ed25519)", `<code class="cert-hash">${esc(sig.record_hash)}</code>`)}
      ${row("본문 무결성", v.contentOk ? "원본과 일치" : "변경됨")}
      ${row("입력값·서명 위치", v.fieldsChecked ? (v.fieldsOk ? "원본과 일치" : "변경됨") : "해당 없음")}
      ${row("봉인 무결성", v.sealOk ? "무결" : "손상")}
      ${row("검증 코드", `<code>${esc(sig.verify_code)}</code>`)}
      ${doc && doc.attachment ? row("첨부 계약서", esc(doc.attachment_name || "계약서.pdf")) : ""}
    </table>
    ${sig.signature_image ? `<div class="cert-sign"><p class="mini-label">서명</p><img src="${esc(mediaUrl(sig.signature_image))}" alt="서명 이미지" /></div>` : ""}
    <div class="cert-foot">
      <div class="cert-verify-row">
        <div class="cert-qr-box"><div id="certQr" data-url="${esc(verifyUrl)}" aria-label="검증 주소 QR"></div><span class="cert-qr-cap">스캔하면 검증</span></div>
        <div>
          <p>이 확인서의 진위는 아래 주소에서 누구나 다시 확인할 수 있습니다.</p>
          <p><a href="${esc(verifyUrl)}"><code>${esc(verifyUrl)}</code></a></p>
        </div>
      </div>
      <p class="cert-note">본 확인서는 서명 시점의 서명자·시각·접속 IP·문서 해시를 Ed25519 전자서명으로 봉인한 기록입니다.
        문서 본문이 한 글자라도 바뀌면 해시가 달라져 “변경됨”으로 표시됩니다.
        이 확인서가 확인하는 것은 <b>위 서명자 한 사람의 전자서명</b>입니다.${sealed
        ? " 계약서에 함께 찍힌 발신자 <b>직인</b>은 보내는 쪽이 발송 전에 찍은 표시이며, 이 확인 범위에 들어가지 않습니다."
        : ""}</p>
    </div>
    <div class="cert-actions no-print"><button type="button" class="btn btn-primary btn-sm" data-print>인쇄 · PDF 저장</button>
      <a class="btn btn-ghost btn-sm" href="/verify/${esc(sig.verify_code)}">검증 페이지</a></div>
  </div></section>`;
  return html(layout({ title: "전자서명 확인서", assoc, body, csrf,
    scripts: `<script src="${assetUrl("/js/qr.js")}" defer></script><script src="${assetUrl("/js/cert-qr.js")}" defer></script>` }));
}

// 서명 공개키 공개 — 제3자가 우리 서버를 믿지 않고도 봉인을 독립 검증할 수 있게 한다.
// (개인키는 절대 나가지 않는다. 공개키만 노출되며, 이는 공개되어야 정상이다.)
export async function esignPublicKey(ctx) {
  const { env } = ctx;
  const jwk = await publicKeyJwk(env);
  const fp = await publicKeyFingerprint(env);
  return text(JSON.stringify({ algorithm: "Ed25519", use: "verify", fingerprint: fp, key: jwk,
    note: "전자서명 봉인 검증용 공개키입니다. record_hash 를 이 키로 Ed25519 검증하세요." }, null, 2),
    200, { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600" });
}

// 사슬 앵커 공개 — 제3자가 "언제 시점에 어떤 서명들이 존재했는지"를 확인할 수 있다.
export async function esignAnchors(ctx) {
  const { db, env } = ctx;
  const rows = await D.listAnchors(db, 60);
  const checked = await Promise.all(rows.map(async (a) => ({
    anchored_at: a.anchored_at, head_hash: a.head_hash, signatures: a.sig_count,
    seal_valid: await verifyAnchor(env, a), external_timestamp: !!a.external,
  })));
  return text(JSON.stringify({ note: "각 시점의 서명 사슬 머리(head)입니다. 해당 시각에 이미 그 서명들이 존재했음을 증명합니다.", anchors: checked }, null, 2),
    200, { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=600" });
}

// 공개 검증
export async function verifyPage(ctx) {
  const { db, env, params, query, csrf } = ctx;
  const code = params.code || query.get("code") || "";
  const sig = code ? await D.getSignatureByCode(db, code) : null;
  let inner;
  if (!sig) {
    inner = `<div class="flash flash-err">해당 검증 코드의 서명 기록을 찾을 수 없습니다.</div>
      <form method="get" action="/verify" class="stack-form"><label>검증 코드<input type="text" name="code" value="${esc(code)}" autocomplete="one-time-code" /></label><button class="btn btn-primary btn-sm">검증</button></form>`;
  } else {
    const doc = await D.getDocument(db, sig.document_id);
    const v = await verifySignature(env, sig, doc);
    const badge = v.valid ? '<span class="badge badge-ok">유효한 서명</span>' : '<span class="badge badge-no">위변조 의심</span>';
    inner = `<div class="verify-result">${badge}
      <table class="verify-table"><tr><th>문서</th><td>${esc(doc ? doc.title : "(삭제됨)")}</td></tr>
      <tr><th>서명자</th><td>${esc(sig.signer_name)}${sig.external_id ? ' <span class="badge badge-info">외부 서명자</span>' : ""}</td></tr>
      <tr><th>서명 시각</th><td>${esc(kstStamp(sig.signed_at))} <span class="tz">KST</span></td></tr>
      <tr><th>봉인(Ed25519)</th><td>${v.sealOk ? "무결" : "손상"}</td></tr><tr><th>문서 본문</th><td>${v.contentOk ? "원본 일치" : "변경됨"}</td></tr>
      <tr><th>입력값·서명 위치</th><td>${v.fieldsChecked ? (v.fieldsOk ? "원본 일치" : "변경됨") : "해당 없음"}</td></tr>
      <tr><th>알고리즘</th><td>${esc(algorithm)}</td></tr></table></div>`;
  }
  const body = `<section class="section page-top"><div class="container narrow"><h1 class="article-title">전자서명 검증</h1>${inner}</div></section>`;
  return html(layout({ title: "문서 진위확인", body, csrf, user: ctx.user, product: await esignProduct(db) }));
}

// ================= 슈퍼관리자 =================
// ================= 조직 한 곳만 모아 보기 =================
// 조직 하나에 대한 일이 여섯 탭에 흩어져 있었다 — 주소는 조직 탭, 크레딧은 정산 탭,
// 사용량은 또 다른 탭. 고객사 한 곳을 손보려면 화면을 세 번 갈아타야 했다.
// 여기서는 그 조직에 대한 모든 것을 한 화면에 모은다. 고쳐도 이 화면에 남는다.
export async function superOrg(ctx) {
  const { db, user, query, csrf, params, env } = ctx;
  const id = parseInt(params.id, 10);
  const a = Number.isFinite(id) ? await D.getAssociationById(db, id) : null;
  if (!a) return notFoundResponse(ctx);
  const K = kindById(a.kind);
  const here = `/super/org/${a.id}`;
  const ret = `<input type="hidden" name="return" value="${esc(here)}" />`;

  const [aliases, admins, usageAll, notifyAll, balance, ownPrice, basePrice, lastActs, demoStamps] = await Promise.all([
    D.listSlugAliases(db).catch(() => []),
    D.listAllAdmins(db).catch(() => []),
    D.usageByAssociation(db).catch(() => []),
    D.platformMessageUsage(db).catch(() => []),
    D.getBalance(db, a.id).catch(() => 0),
    D.getUnitPrice(db, a.id).catch(() => 0),
    priceOf(db, "alimtalk"),
    D.lastActivityByAssociation(db).catch(() => []),
    D.demoSeedStamps(db).catch(() => []),
  ]);
  const myAliases = aliases.filter((r) => r.association_id === a.id).map((r) => r.slug);
  const myAdmins = admins.filter((u) => u.association_id === a.id);
  const use = usageAll.find((u) => u.id === a.id) || { members: 0, media_count: 0, storage: 0 };
  const msg = notifyAll.find((u) => u.id === a.id) || { sent: 0, revenue: 0, charged: 0 };
  const lastAt = (lastActs.find((r) => r.aid === a.id) || {}).last_at || "";
  const demoAt = (demoStamps.find((r) => r.aid === a.id) || {}).seeded_at || "";
  const planOpts = (cur) => PLAN_KEYS.map((k) => `<option value="${k}"${k === cur ? " selected" : ""}>${esc(PLANS[k].label)}</option>`).join("");
  const days = lastAt ? Math.floor((Date.now() - Date.parse(lastAt.includes("T") ? lastAt : lastAt.replace(" ", "T") + "Z")) / 86400000) : null;

  const stat = (n, label, hint) => `<div class="stat-card left"><div class="stat-top"><span class="stat-label">${esc(label)}</span></div>
    <span class="stat-num">${n}</span>${hint ? `<div class="stat-delta mut">${hint}</div>` : ""}</div>`;

  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div>
      <p class="section-eyebrow"><a href="/super#s-home" data-goto="home">← 고객사 목록</a></p>
      <h1 class="dash-title">${esc(a.name)}
        <span class="badge ${K.badge}">${esc(K.label)}</span>
        ${a.active ? '<span class="badge badge-ok">활성</span>' : '<span class="badge badge-no">비활성</span>'}</h1>
      <p class="dash-sub">공개 주소 <a href="/t/${esc(a.slug)}" target="_blank">${esc(prettyPath(`/t/${a.slug}`))}</a>
        · ${days === null ? "활동 없음" : days <= 0 ? "오늘 활동" : `${days}일 전 활동`}</p></div>
      <div class="dash-head-actions">
        <a href="/t/${esc(a.slug)}/admin" class="btn btn-primary btn-sm">관리 화면 열기</a>
        <a href="/t/${esc(a.slug)}" target="_blank" class="btn btn-ghost btn-sm">고객이 보는 화면</a></div></div>
    ${flashOf(query)}

    <div class="stat-cards">
      ${stat(use.members, "회원", "명")}
      ${stat(use.media_count, "사진", `${fmtBytes(use.storage)}`)}
      ${stat(balance.toLocaleString(), "알림톡 잔액", "원")}
      ${stat((msg.sent || 0).toLocaleString(), "누적 발송", `매출 ${(msg.revenue || 0).toLocaleString()}원`)}
    </div>

    <section class="panel"><h2 class="panel-title">주소</h2>
      <form method="post" action="/super/association/${a.id}/slug" class="stack-form compact">${ret}
        <label class="mini-label">공개 주소 <small>(영문 소문자·숫자·하이픈)</small>
          <span class="slug-row"><span class="slug-pre">/t/</span>
          <input type="text" name="slug" value="${esc(a.slug)}" pattern="[a-z0-9\-]+" maxlength="40" required /></span></label>
        <button class="btn btn-ghost btn-sm">주소 바꾸기</button></form>
      ${myAliases.length ? `<p class="panel-hint">옛 주소 ${myAliases.map((x) => `<code>${esc(prettyPath("/t/" + x))}</code>`).join(" · ")} 로 들어와도 자동으로 넘어옵니다.</p>`
        : `<p class="panel-hint">주소를 바꿔도 옛 주소로 들어온 사람은 새 주소로 자동 이동합니다 — 이미 나간 링크가 죽지 않습니다.</p>`}
      <div class="form-divider">개별 도메인</div>
      <form method="post" action="/super/association/${a.id}/domain" class="stack-form compact">${ret}
        <label class="mini-label">이 조직만 쓰는 도메인 <small>(Cloudflare 에 Custom Domain 먼저 연결)</small>
          <input type="text" name="domain" value="${esc(a.custom_domain || "")}" placeholder="예: seocho-market.kr" /></label>
        <button class="btn btn-ghost btn-sm">저장</button></form>
      ${a.custom_domain ? `<p class="panel-hint">연결됨 · <a href="https://${esc(a.custom_domain)}" target="_blank">${esc(a.custom_domain)}</a></p>` : ""}
    </section>

    <section class="panel"><h2 class="panel-title">유형·요금제</h2>
      <p class="panel-hint">유형을 바꾸면 <b>보이는 메뉴와 관리 화면이 통째로 달라집니다.</b> 데이터는 지워지지 않습니다.</p>
      <form method="post" action="/super/association/${a.id}/kind" class="stack-form compact">${ret}
        <label class="mini-label">제품 유형<select name="kind">${KIND_KEYS.map((k) =>
          `<option value="${k}"${(a.kind || "merchant") === k ? " selected" : ""}>${esc(KINDS[k].label)}</option>`).join("")}</select></label>
        <label class="mini-label">업종 문구 <small>(랜딩형 제품에만 적용)</small><select name="preset">${PRESET_KEYS.map((k) =>
          `<option value="${k}"${(a.preset || "franchise") === k ? " selected" : ""}>${esc(PRESETS[k].label)}</option>`).join("")}</select></label>
        <button class="btn btn-ghost btn-sm">유형 저장</button></form>
      <div class="form-divider">요금제</div>
      <form method="post" action="/super/association/${a.id}/plan" class="stack-form compact">${ret}
        <label class="mini-label">플랜<select name="plan">${planOpts(a.plan || "free")}</select></label>
        <button class="btn btn-ghost btn-sm">변경</button></form>
    </section>

    <section class="panel"><h2 class="panel-title">알림톡 <span class="badge ${autoNotifyOn(a) ? "badge-ok" : "badge-muted"}">자동화 ${autoNotifyOn(a) ? "켜짐" : "꺼짐"}</span> <span class="badge ${balance > 0 ? "badge-ok" : "badge-no"}">잔액 ${balance.toLocaleString()}원</span></h2>
      ${autoNotifyOn(a) ? "" : `<p class="panel-hint"><b>이 조직은 자동 발송을 쓰지 않습니다.</b> 관리자가 서명 링크를 카톡·문자로 직접 보내 계약을 진행합니다 —
        정상 상태이며, 켜고 끄는 것은 그 조직 관리자가 자기 관리 화면에서 정합니다(운영사가 대신 켜지 않습니다).</p>`}
      <p class="panel-hint">${balance > 0
        ? `현재 단가로 약 <b>${Math.floor(balance / Math.max(1, ownPrice || basePrice)).toLocaleString()}건</b> 보낼 수 있습니다.`
        : "<b>잔액이 없어 발송이 되지 않습니다.</b> 충전 신청은 정산 화면에서 승인합니다."}
        충전 승인은 <a href="/super#s-money" data-goto="money">알림톡·정산</a> 에서 합니다.</p>
      <form method="post" action="/super/association/${a.id}/unit-price" class="stack-form compact">${ret}
        <label class="mini-label">이 조직 전용 단가 (원/건) <small>(0 이면 기본가 ${basePrice.toLocaleString()}원)</small>
          <input type="number" name="unit_price" value="${ownPrice || 0}" min="0" max="1000" /></label>
        <button class="btn btn-ghost btn-sm">단가 저장</button></form>
    </section>

    <section class="panel"><h2 class="panel-title">관리자 계정 <span class="badge badge-muted">${myAdmins.length}명</span></h2>
      ${myAdmins.length ? `<ul class="admin-mini">${myAdmins.map((u) => `<li><span title="${esc(u.name)}">${esc(u.email)}</span>
        <form method="post" action="/super/admin/${u.id}/reset-password" data-confirm="${esc(u.email)} 의 임시 비밀번호를 발급할까요?&#10;기존 비밀번호는 즉시 무효가 됩니다.">${ret}
          <button class="btn btn-xs btn-ghost">임시 비밀번호</button></form></li>`).join("")}</ul>`
        : `<p class="panel-hint"><b>관리자 계정이 없습니다.</b> 이 조직은 아무도 로그인할 수 없는 상태입니다.</p>`}
    </section>

    ${K.usesLanding || (a.kind || "merchant") === "merchant" ? `<section class="panel"><h2 class="panel-title">내용 채우기</h2>
      <p class="panel-hint"><b>시작 세트</b>는 실전용입니다 — 비어 있는 항목만 채우고 있는 것은 건드리지 않습니다.
        <b>데모</b>는 영업 소개용 가짜 데이터라 <b>기존 내용을 지우고</b> 덮어씁니다.</p>
      <span class="pill-row">
        <form method="post" action="/super/association/${a.id}/starter" class="inline-form"
          data-confirm="'${esc(a.name)}' 에 시작 세트를 넣을까요?&#10;&#10;첫 공지 3건과 가입 동의서를 넣습니다. 이미 있는 것은 건드리지 않습니다.">${ret}
          <button class="btn btn-ghost btn-sm">시작 세트 넣기</button></form>
        <form method="post" action="/super/association/${a.id}/demo" class="inline-form"
          data-confirm="'${esc(a.name)}' 을(를) 데모용 샘플로 채웁니다.&#10;&#10;이 조직의 기존 점포·공지·행사·게시글이 모두 삭제됩니다. (다른 조직은 영향 없음)&#10;&#10;계속할까요?">${ret}
          <button class="btn btn-ghost btn-sm">${demoAt ? "데모 다시 채우기" : "데모 채우기"}</button></form></span>
      <p class="panel-hint">${demoAt
        ? `데모 적용 ${esc(kstStamp(demoAt, { year: false }))}`
        : '<span class="demo-stamp is-none">데모 미적용</span>'}</p>
      ${`<div class="form-divider">지도 키</div>
      <form method="post" action="/super/association/${a.id}/mapkey" class="stack-form compact">${ret}
        <label class="mini-label">이 조직만 다른 Maps 앱 쓰기 <small>(비우면 공용 키)</small>
          <input type="text" name="map_client_id" value="${esc(a.map_client_id || "")}" placeholder="공용이면 비워 두세요" /></label>
        <button class="btn btn-ghost btn-sm">저장</button></form>`}
    </section>` : ""}

    <section class="panel panel-warn"><h2 class="panel-title">되돌릴 수 없는 것</h2>
      <form method="post" action="/super/association/${a.id}/toggle" class="inline-form"
        data-confirm="${a.active ? `'${esc(a.name)}' 을(를) 비활성화하면 고객이 보는 화면이 닫힙니다. 계속할까요?` : `'${esc(a.name)}' 을(를) 다시 열까요?`}">${ret}
        <button class="btn btn-ghost btn-sm">${a.active ? "비활성화 (화면 닫기)" : "다시 활성화"}</button></form>
      <p class="panel-hint">비활성화는 되돌릴 수 있습니다 — 데이터는 그대로 두고 화면만 닫습니다.</p>
      <details class="danger-del"><summary class="btn btn-ghost btn-sm">영구 삭제</summary>
        <form method="post" action="/super/association/${a.id}/delete"
          data-confirm="정말 '${esc(a.name)}' 을(를) 삭제할까요?&#10;&#10;점포·회원 계정·공지·게시글·서명 기록이 모두 사라지며 되돌릴 수 없습니다.">
          <p class="del-warn">되돌릴 수 없습니다. 확인용으로 주소 <code>${esc(a.slug)}</code> 를 입력하세요.</p>
          <input type="text" name="confirm_slug" placeholder="${esc(a.slug)}" required autocomplete="off" />
          <button class="btn btn-xs btn-danger">영구 삭제</button></form></details>
    </section>
  </div></section>`;
  return html(layout({ title: `${a.name} · 고객사`, console: "super", user, body, csrf }));
}

export async function superConsole(ctx) {
  const { db, env, user, query, csrf } = ctx;
  const ps = await D.platformStats(db);
  const list = await D.listAllAssociations(db);
  const auditLog = await D.listAudit(db, null, 15);
  const pendingApps = await D.listApplications(db, "pending");
  // 보조 정보(데모 시각·영업 메모·마지막 활동·관리자 목록)는 하나가 실패해도
  // 콘솔 전체가 500 으로 죽지 않게 각각 감쌉니다. 상인회 목록·승인 같은 본 기능은
  // 못 쓰게 되면 안 되는 화면이기 때문입니다. 실패한 항목은 화면에 그대로 알립니다.
  const loadWarnings = [];
  const soft = async (label, fn, fallback) => {
    try { return await fn(); } catch (e) {
      loadWarnings.push(`${label}: ${String((e && e.message) || e).slice(0, 200)}`);
      return fallback;
    }
  };
  const appNotes = await soft("영업 기록", () => D.listApplicationNotes(db), []);
  const lastAct = new Map((await soft("마지막 활동", () => D.lastActivityByAssociation(db), [])).map((r) => [r.aid, r.last_at]));
  const platformMode = (await D.getSetting(db, "platform_mode")) === "1";
  const siteName = (await D.getSetting(db, "site_name")) || "상인회 플랫폼";
  const operator = (await D.getSetting(db, "operator")) || "";
  const contactEmail = (await D.getSetting(db, "contact_email")) || "";
  const contactPhone = (await D.getSetting(db, "contact_phone")) || "";
  // 있으면 좋은 것 — 꺼져 있어도 서비스는 돈다. 값 자체는 보여 주지 않는다(시크릿).
  const wired = [
    ["봇 차단(캡차)", !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET), "TURNSTILE_SITE_KEY · TURNSTILE_SECRET", "셀프 가입·문의 폼에 Cloudflare Turnstile 이 붙습니다. 없어도 폼은 정상 동작합니다."],
    ["네이버 지도", !!env.NAVER_MAP_CLIENT_ID, "NAVER_MAP_CLIENT_ID", "상인회 홈의 점포 지도. 지도가 안 뜨면 Maps 콘솔의 Web 서비스 URL 에 이 사이트 도메인이 등록됐는지 확인하세요."],
    ["사진 직접 서빙", !!env.MEDIA_PUBLIC_BASE, "MEDIA_PUBLIC_BASE", "R2 버킷에 공개 도메인을 켜고 그 주소를 워커 변수에 넣으면 사진이 워커를 거치지 않고 CDN 직행합니다."],
    ["방문 통계", !!env.CF_ANALYTICS_TOKEN, "CF_ANALYTICS_TOKEN", "Cloudflare Web Analytics 에서 사이트를 추가하고 발급된 토큰을 넣으면 모든 페이지에 자동 삽입됩니다."],
    ["지도에서 가게 찾기", !!String(env.KAKAO_REST_KEY || "").trim(), "KAKAO_REST_KEY",
      "카카오 개발자센터에서 앱을 만들고 <b>REST API 키</b>를 넣으면, 관리자가 점포 정보를 채울 때 가게 이름만으로 주소·전화·업종·좌표가 채워집니다. 없으면 손으로 적으면 됩니다."],
  ];
  const supers = await soft("슈퍼 계정 목록", () => D.listSuperAdmins(db), []);
  const superPanel = `<section class="panel"><h2 class="panel-title">이 콘솔에 접근 가능한 계정 <span class="badge ${supers.length > 1 ? "badge-wait" : "badge-ok"}">${supers.length}개</span></h2>
    <p class="panel-hint">운영사 계정만 이 화면과 조직 생성·삭제를 쓸 수 있습니다. 고객사 관리자·사장님 계정으로는 주소를 직접 입력해도 들어올 수 없습니다.
      ${supers.length > 1 ? " <b>계정이 둘 이상입니다 — 모르는 계정이 있으면 즉시 확인하세요.</b>" : ""}</p>
    <ul class="wire-list">${supers.map((u) => `<li class="is-on"><span class="wire-dot" aria-hidden="true"></span>
      <div><b>${esc(u.email)}</b> <span class="badge ${u.totp_enabled ? "badge-ok" : "badge-muted"}">${u.totp_enabled ? "2단계 인증 사용" : "2단계 인증 없음"}</span>
        <p>${esc(u.name || "")} · 생성 ${esc(kstDate(u.created_at))}</p></div></li>`).join("")}</ul>
    ${supers.some((u) => !u.totp_enabled) ? `<p class="panel-hint">이 계정 하나가 뚫리면 <b>모든 고객사</b>의 데이터가 열립니다. <a href="/account">계정 설정</a>에서 2단계 인증을 켜 두시길 권합니다.</p>` : ""}</section>`;
  const wiredPanel = `<details class="panel panel-fold"><summary class="panel-title">있으면 좋은 것 <span class="badge ${wired.every((w) => w[1]) ? "badge-ok" : "badge-muted"}">${wired.filter((w) => w[1]).length}/${wired.length} 켜짐</span></summary>
    <p class="panel-hint">모두 선택 사항입니다. 꺼져 있어도 사이트는 정상 동작하며, 값은 <b>Workers &amp; Pages → 이 워커 → Settings → Variables</b> 에서 넣습니다.</p>
    <ul class="wire-list">${wired.map(([label, on, keys, help]) => `<li class="${on ? "is-on" : ""}">
      <span class="wire-dot" aria-hidden="true"></span>
      <div><b>${esc(label)}</b> <span class="badge ${on ? "badge-ok" : "badge-muted"}">${on ? "켜짐" : "안 켜짐"}</span>
        <p>${esc(help)}</p><code>${esc(keys)}</code></div></li>`).join("")}</ul></details>`;
  // ----- 알림톡 재판매: 판매단가·템플릿·충전 승인·매출 -----
  const [pendCredits, notifyUsage, unitPrice] = await Promise.all([
    D.listPendingCreditOrders(db), D.platformMessageUsage(db), priceOf(db, "alimtalk"),
  ]);
  // 알림톡은 심사받은 문구와 정확히 일치해야 발송된다 — 등록할 원문을 그대로 보여 주고,
  // 받은 코드를 여기 적게 한다. 문구를 화면에서 바로 복사할 수 있어야 등록이 어긋나지 않는다.
  // pending 문구는 아직 제품이 보내지 않는다. 진행도에서 빼야 '다 됐다' 가 사실이 된다.
  const tplEntries = Object.entries(TEMPLATES);
  const tplLive = tplEntries.filter(([, t]) => !t.pending);
  const tplVals = await Promise.all(tplEntries.map(([, t]) => D.getSetting(db, t.key)));
  const tplInputs = tplEntries.map(([kind, t], i) =>
    `<label class="mini-label">${esc(t.label)}${t.pending
      ? ' <span class="badge badge-muted">아직 제품에 없음</span>'
      : tplVals[i] ? ' <span class="badge badge-ok">등록됨</span>' : ' <span class="badge badge-wait">미등록</span>'}
      <input type="text" name="${esc(t.key)}" value="${esc(tplVals[i] || "")}" maxlength="60" placeholder="${t.pending ? "등록하지 않아도 됩니다" : "카카오 심사 통과 코드"}" /></label>`).join("");
  const tplGuide = tplEntries.map(([kind, t]) => `<details class="tpl-reg"><summary>${esc(t.label)} <code>${esc(t.key)}</code>${tplVals[tplEntries.findIndex(([k]) => k === kind)] ? "" : " — 미등록"}</summary>
      ${t.pending
        ? `<p class="flash flash-warn">이 문구는 <b>아직 제품에서 발송되지 않습니다.</b> 카카오에 올리지 마세요 —
            공지를 알림톡으로 보내는 기능을 만들 때, 카카오 요구대로 <b>목적별(회비·총회·투표…)로 나눠</b> 다시 등록해야 합니다.</p>`
        : `<p class="panel-hint">아래 문구를 <b>그대로</b> 카카오 비즈니스 채널에 등록하세요. 한 글자라도 다르면 발송이 거절됩니다.</p>`}
      <pre class="code-block" data-select-all>${esc(t.body)}</pre>
      <p class="panel-hint">변수: ${t.vars.map((v) => `<code>#{${esc(v)}}</code>`).join(" ")}${t.button ? ` · 버튼: <b>${esc(t.button)}</b> (웹링크)` : " · 버튼 없음"}</p></details>`).join("");
  const tplDone = tplEntries.filter(([, t], i) => !t.pending && tplVals[i]).length;
  const mode = await billingMode(db);
  const baseCost = await costOf(db, "alimtalk");
  const selfSignup = (await D.getSetting(db, "esign_self_signup")) !== "0";
  const trialCredit = parseInt((await D.getSetting(db, "esign_trial_credit")) || "0", 10) || 0;
  const SIGNUP_DAILY_MAX_UI = 20;
  const creditRows = pendCredits.length ? pendCredits.map((o) => `<tr><td>${esc(o.assoc_name)}</td><td>${o.amount.toLocaleString()}원</td>
    <td>${esc(o.depositor || "-")}<br /><small>${esc(kstStamp(o.created_at, { year: false }))}</small></td>
    <td class="actions-cell">
      <form method="post" action="/super/credit/${o.id}" class="inline-form" data-confirm="입금을 확인했습니다. ${o.amount.toLocaleString()}원을 충전할까요?"><input type="hidden" name="action" value="approve" /><button class="btn btn-xs btn-primary">입금 확인·충전</button></form>
      <form method="post" action="/super/credit/${o.id}" class="inline-form" data-confirm="반려할까요?"><input type="hidden" name="action" value="reject" /><button class="btn btn-xs btn-ghost">반려</button></form></td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">대기 중인 충전 신청이 없습니다.</td></tr>`;
  const totalRevenue = notifyUsage.reduce((a, u) => a + (u.revenue || 0), 0);
  const totalCharged = notifyUsage.reduce((a, u) => a + (u.charged || 0), 0);
  const totalSent = notifyUsage.reduce((a, u) => a + (u.sent || 0), 0);
  // ----- 전자서명 키·사슬 상태 (보안) -----
  const keyMode = keyStorage(env);
  const keyFp = await publicKeyFingerprint(env).catch(() => "(확인 불가)");
  const chain = verifyChain(await D.listSignatureChain(db));
  const otpOn = (await D.getSetting(db, "esign_otp")) === "1";
  const anchor = await D.lastAnchor(db);

  // ----- 개통 상태 -----
  // 예전에는 이 값들로 '개통 체크리스트'를 그렸지만, 항목마다 제 집이 생기면서
  // (알림톡 화면·정기 작업 패널·시크릿 옮기기 패널) 같은 말을 두 번 하는 목록이 됐다.
  // 크론이 실제로 돌고 있는가 — 등록이 안 되면 아무 일도 안 일어나는데 화면엔 표시가 없었다.
  // 5분짜리 웹훅 작업이 가장 빠른 신호다. 20분 넘게 소식이 없으면 등록이 안 된 것으로 본다.
  const cronRuns = {};
  for (const job of Object.keys(CRON_JOBS)) {
    try { cronRuns[job] = JSON.parse((await D.getSetting(db, cronRunKey(job))) || "null"); } catch { cronRuns[job] = null; }
  }
  const CRON_STALE_MS = 20 * 60 * 1000;
  const lastTick = cronRuns.webhooks && Date.parse(cronRuns.webhooks.at);
  const cronAlive = !!(lastTick && Date.now() - lastTick < CRON_STALE_MS);
  // 정기 작업 상태 — 개통이 끝난 뒤에도 크론이 조용히 죽는 일은 계속 생길 수 있다.
  // "언제 마지막으로 돌았나"를 늘 보이게 두는 것이 유일한 방어다.
  const agoText = (iso) => {
    const ms = Date.now() - Date.parse(iso);
    if (!(ms >= 0)) return esc(iso);
    const m = Math.floor(ms / 60000);
    if (m < 1) return "방금";
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    return h < 48 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;
  };
  // 얼마에 팔지는 코드가 정할 일이 아니다. 여기 넣은 값만 제품 소개에 나오고,
  // 비워 두면 요금 안내 자체가 나오지 않는다 — 안 받는 값이 화면에 뜨는 것보다 낫다.
  const prices = await planPrices(D.getSetting, db);
  const pricePanel = `<section class="panel"><h2 class="panel-title">요금제 <span class="badge ${Object.keys(prices).length ? "badge-ok" : "badge-muted"}">${Object.keys(prices).length ? "공개 중" : "비공개"}</span></h2>
    <p class="panel-hint">여기 넣은 금액이 <a href="/esign" target="_blank">제품 소개 화면</a>의 요금 안내에 그대로 나갑니다.
      <b>비워 두면 요금 안내가 나오지 않습니다</b> — 아직 안 정하셨으면 비워 두세요. 부가세 별도 표기로 나갑니다.</p>
    <form method="post" action="/super/plan-prices" class="stack-form compact">
      <div class="form-two">${PLAN_KEYS.map((k) =>
        `<label class="mini-label">${esc(PLANS[k].label)} <small>(원/월)</small>
          <input type="number" name="price_${k}" value="${prices[k] === undefined ? "" : prices[k]}" min="0" max="100000000" step="1000" placeholder="비우면 미표시" /></label>`).join("")}</div>
      <button class="btn btn-ghost btn-sm">요금제 저장</button></form>
    <p class="panel-hint">알림톡은 요금제와 별개로 <b>선불 충전 후 발송당 ${unitPrice.toLocaleString()}원</b>입니다
      (원가 ${(await costOf(db, "alimtalk")).toLocaleString()}원 · 마진 ${(unitPrice - (await costOf(db, "alimtalk"))).toLocaleString()}원).
      단가는 <a href="#s-money" data-goto="money">알림톡·정산</a> 에서 바꿉니다.</p>
  </section>`;

  const cronPanel = `<${cronAlive ? "details" : "section"} class="panel ${cronAlive ? "panel-fold" : "panel-warn"}" id="cron-panel"><${cronAlive ? "summary" : "h2"} class="panel-title">정기 작업
      <span class="badge ${cronAlive ? "badge-ok" : "badge-no"}">${cronAlive ? "돌고 있음" : "멈춰 있음"}</span></${cronAlive ? "summary" : "h2"}>
    <p class="panel-hint">사람이 누르지 않아도 저절로 돌아야 하는 일들입니다. ${cronAlive
      ? "마지막으로 돈 시각이 계속 갱신되면 정상입니다."
      : "<b>크론이 등록되지 않으면 아무 일도 일어나지 않는데 사이트는 멀쩡해 보입니다.</b> 그래서 여기에 시각을 남깁니다."}</p>
    <table class="verify-table">${Object.entries(CRON_JOBS).map(([job, label]) => {
      const r = cronRuns[job];
      return `<tr><th>${esc(label)}</th><td>${r
        ? `${agoText(r.at)} <small class="muted">(${esc(String(r.at).replace("T", " ").slice(0, 16))} UTC)</small>${
            r.error ? ` <span class="badge badge-no">오류</span> <code>${esc(r.error)}</code>` : ""}`
        : '<span class="txt-warn">한 번도 안 돌았습니다</span>'}</td></tr>`;
    }).join("")}</table>
    <p class="panel-hint">주간 작업은 월요일 새벽 3시(KST)에 백업을 만듭니다. 일일 작업은 매일 아침 9시에
      기한이 다가온 계약의 미서명자에게 재알림을 보냅니다. 웹훅은 5분마다 밀린 전송을 재시도합니다.</p>
  </${cronAlive ? "details" : "section"}>`;

  // ----- 시크릿 이전 (D1 → 워커 Secret) -----
  // 가장 위험한 수작업이다. 새 값을 만들면 로그인이 전부 풀리고 이미 받은 서명이 검증에 실패한다.
  // 그래서 "현행 값을 그대로 옮기는" 길만 열어 두고, 값은 화면에 그리지 않고 복사만 시킨다
  // (운영자가 이 화면을 캡처해 보내는 일이 실제로 있다).
  // 사본 삭제 버튼은 워커 Secret 이 실제로 들어온 것이 확인된 뒤에만 나타난다 — 그 시점엔
  // 워커 값이 이미 우선하므로 D1 사본은 아무도 쓰지 않는 상태라 지워도 안전하다.
  const signKeyInDb = await D.getSetting(db, "sign_key");
  const sessionValue = await D.getSetting(db, "session_secret");
  const migrate = [
    { key: "session_secret", name: "SESSION_SECRET", label: "세션·백업 암호화 키",
      shape: "96자짜리 긴 문자열 하나 (예: <code>3f8a2c91e04b…</code>)",
      onWorker: !!env.SESSION_SECRET_IS_WORKER, inDb: !!sessionValue, value: sessionValue || "",
      risk: "새로 만들면 <b>로그인이 전부 풀리고</b> 이미 보낸 서명 링크가 무효가 됩니다. 주간 백업도 이 값으로 암호화되므로, 값이 바뀌면 <b>예전 백업을 열 수 없습니다.</b>",
      why: "이 값이 D1 안에 있는 동안은, 백업을 여는 열쇠가 백업 안에 함께 들어 있는 셈입니다 — D1 을 잃으면 R2 의 백업도 못 엽니다." },
    { key: "sign_key", name: "SIGN_PRIVATE_KEY", label: "전자서명 개인키",
      shape: "중괄호로 시작하는 JSON 한 줄 (<code>{\"kty\":\"OKP\",…}</code>) — <b>{ 부터 } 까지 전부</b>",
      onWorker: keyMode === "secret", inDb: !!signKeyInDb, value: signKeyInDb || "",
      risk: "새로 만들면 <b>이미 받은 서명이 전부 검증에 실패합니다.</b> 반드시 현행 키를 그대로 옮기세요.",
      why: "D1 을 읽을 수 있는 사람이 과거 서명을 위조할 수 있습니다.",
      blockDrop: !chain.ok, blockWhy: "서명 사슬 검증이 통과해야 사본을 지울 수 있습니다 — 지금 워커 키로 기존 서명이 확인되지 않습니다." },
  ];
  const migrateDone = migrate.every((m) => m.onWorker && !m.inDb);
  const deployLine = `<p class="panel-hint">지금 돌고 있는 배포:
    <code>${esc((env.CF_VERSION_METADATA && env.CF_VERSION_METADATA.id ? String(env.CF_VERSION_METADATA.id) : "").slice(0, 8) || "확인 불가")}</code>
    — 대시보드 <b>Deployments</b> 맨 위 버전과 같으면 최신입니다. 다르면 아직 반영 전이니 잠시 뒤 새로고침하세요.</p>`;
  const migratePanel = migrateDone ? "" : `<section class="panel panel-warn" id="s-secret"><h2 class="panel-title">시크릿 옮기기
      <span class="badge badge-no">${migrate.filter((m) => !(m.onWorker && !m.inDb)).length}건 남음</span></h2>
    <p class="panel-hint">두 값을 데이터베이스에서 <b>워커 Secret</b> 으로 옮깁니다.
      <b>새로 만들지 말고 지금 값을 그대로 옮기세요</b> — 아래 복사 버튼이 현행 값을 클립보드에 넣어 줍니다.
      값은 화면에 그리지 않습니다(캡처해도 찍히지 않습니다).</p>
    ${migrate.map((m) => {
      const done = m.onWorker && !m.inDb;
      const state = done ? "완료" : m.onWorker ? "사본만 남음" : "아직 DB 에 있음";
      return `<div class="mig-item ${done ? "is-on" : ""}">
        <div class="mig-head"><b><code>${esc(m.name)}</code></b> <span class="muted">${esc(m.label)}</span>
          <span class="badge ${done ? "badge-ok" : m.onWorker ? "badge-wait" : "badge-no"}">${state}</span></div>
        <div class="envcheck">
          <span class="${m.onWorker ? "is-on" : ""}"><b>${m.onWorker ? "있음" : "없음"}</b> 워커 Secret</span>
          <span class="${m.inDb ? "" : "is-on"}"><b>${m.inDb ? "남아 있음" : "없음"}</b> DB 사본</span>
        </div>
        ${done ? "" : `<p>${m.why}</p>
        <div class="flash flash-warn">${m.risk}</div>
        <p class="mig-map">지금 있는 곳 <code>DB · ${esc(m.key)}</code> → 넣을 곳 <code>워커 · ${esc(m.name)}</code>
          <br><span class="muted">이름이 서로 다릅니다. Cloudflare 에 적을 이름은 <b>${esc(m.name)}</b> 입니다.
          값은 ${m.shape}</span></p>
        <ol class="hint-steps">
          <li>${m.value
            ? `<button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(m.value)}">현행 값 복사</button>`
            : "<span class=\"muted\">DB 에 값이 없습니다 (이미 워커에만 있는 상태)</span>"}</li>
          <li>Workers &amp; Pages → <b>website</b> → Settings → Variables and Secrets → ＋ Add →
            Variable name 칸에 <code>${esc(m.name)}</code>, Type <b>Secret</b>, Value 칸에 붙여넣기 → <b>Deploy</b></li>
          <li>배포 후 이 화면을 새로고침하면 <b>사본만 남음</b> 으로 바뀝니다. 그때 아래 버튼으로 DB 사본을 지웁니다.</li>
        </ol>
        ${m.onWorker && m.inDb
          ? (m.blockDrop
            ? `<div class="flash flash-warn">${m.blockWhy}</div>`
            : `<form method="post" action="/super/secret-drop" class="inline-form"
                 data-confirm="워커 Secret 이 확인되었습니다. DB 사본을 지울까요? (워커 값이 이미 쓰이고 있어 동작은 바뀌지 않습니다)">
                 <input type="hidden" name="_csrf" value="${esc(csrf)}" /><input type="hidden" name="key" value="${esc(m.key)}" />
                 <button class="btn btn-primary btn-sm">DB 사본 지우기</button></form>`)
          : m.inDb ? `<p class="muted"><b>DB 사본 지우기 버튼이 아직 없습니다.</b> 위 줄이 <code>워커 Secret 없음</code> 이면,
              이 워커가 <code>${esc(m.name)}</code> 라는 이름을 못 받고 있다는 뜻입니다 —
              ① 이름 철자·앞뒤 공백, ② <b>Deploy</b> 를 안 누름, ③ Preview 환경에 넣음,
              ④ Text 로 넣어서 배포 때 지워짐(반드시 <b>Secret</b>) 중 하나입니다.</p>` : ""}`}
      </div>`;
    }).join("")}
    ${deployLine}
  </section>`;

  const securityPanel = `<section class="panel ${keyMode === "secret" ? "" : "panel-warn"}"><h2 class="panel-title">전자서명 보안
      ${keyMode === "secret" ? '<span class="badge badge-ok">키 안전 보관</span>' : '<span class="badge badge-no">키가 DB에 있음</span>'}
      ${chain.ok ? '<span class="badge badge-ok">서명 사슬 정상</span>' : '<span class="badge badge-no">사슬 끊김</span>'}</h2>
    ${keyMode === "secret"
      ? '<p class="panel-hint">서명 개인키가 Cloudflare Secret 에 있습니다. DB 가 유출되어도 봉인을 위조할 수 없습니다.</p>'
      : `<div class="flash flash-warn"><b>서명 개인키가 데이터베이스에 저장되어 있습니다.</b>
          D1 을 읽을 수 있는 사람은 과거 서명을 위조할 수 있습니다.
          <b>이 화면 맨 위 <a href="#s-secret">시크릿 옮기기</a></b> 에서 복사 버튼으로 현행 값을 그대로 옮기세요 —
          거기에 값 복사·등록·사본 삭제까지 순서대로 있습니다.
          ${chain.length ? `<br /><b>지금 받아 둔 서명이 ${chain.length}건 있습니다.</b> 키를 새로 만들면 이 ${chain.length}건이 전부 검증에 실패합니다.`
            : "<br />받아 둔 서명이 아직 없어 지금은 키를 새로 만들어도 잃을 것이 없지만, 옮기는 편이 더 간단합니다."}</div>`}
    <table class="verify-table"><tr><th>공개키 지문</th><td><code>${esc(keyFp)}</code></td></tr>
      <tr><th>공개키 배포</th><td><a href="/.well-known/esign-public-key" target="_blank"><code>/.well-known/esign-public-key</code></a> — 제3자 독립 검증용</td></tr>
      <tr><th>서명 사슬</th><td>${chain.ok ? `연결 정상 (${chain.length}건)` : `<b class="txt-warn">id ${esc(String(chain.brokenAt))} 지점에서 끊김 — 기록이 삭제·변조되었을 수 있습니다</b>`}</td></tr>
      <tr><th>시점 앵커</th><td>${anchor
        ? `${esc(kstStamp(anchor.anchored_at))} · 서명 ${anchor.sig_count}건 ${anchor.external ? '<span class="badge badge-ok">외부 TSA</span>' : '<span class="badge badge-muted">자체 봉인</span>'}
           · <a href="/.well-known/esign-anchors" target="_blank">공개 목록</a>`
        : '아직 없음 — 서명이 생기면 매일 자동으로 남습니다'}</td></tr></table>
    <form method="post" action="/super/esign-settings" class="stack-form compact otp-toggle">
      <label class="check"><input type="checkbox" name="esign_otp" value="1"${otpOn ? " checked" : ""} data-autosubmit /> 서명 시 <b>휴대폰 본인확인(인증번호)</b> 요구</label>
      <p class="panel-hint">켜면 서명 직전 회원 휴대폰으로 6자리 인증번호를 보내고, 확인해야 서명이 완료됩니다.
        인증번호 1건도 알림톡 크레딧에서 차감됩니다(고객사 부담). 계정 도용·대리 서명을 막는 가장 효과적인 수단입니다.</p></form>
    <p class="panel-hint">지문을 따로 적어 두면, 키가 몰래 교체됐는지 확인할 수 있습니다. 서명 사슬은 각 서명이 직전 서명의 봉인값을 포함해 엮인 구조라 중간 기록을 지우면 끊깁니다.</p></section>`;

  // ----- 월별 정산 (마진 계산 + 공유 계정 대사) -----
  const months = await D.settlementMonths(db);
  const selMonth = (ctx.query && /^\d{4}-\d{2}$/.test(ctx.query.get("m") || "") ? ctx.query.get("m") : null)
    || (months[0] && months[0].m) || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
  const [settle, unitCost] = await Promise.all([D.monthlySettlement(db, selMonth), costOf(db, "alimtalk")]);
  // cost_base 는 전(0.01원) 단위 → 합산 후 원으로 환산해야 반올림 오차가 없다
  const sT = settle.reduce((a, r) => ({ sent: a.sent + r.sent, rev: a.rev + r.revenue, base: a.base + jeonToWon(r.cost_base) }), { sent: 0, rev: 0, base: 0 });
  const margin = sT.rev - sT.base;
  const marginPct = sT.rev > 0 ? Math.round((margin / sT.rev) * 100) : 0;
  const settleRows = settle.length ? settle.map((r) => {
    const cb = jeonToWon(r.cost_base);
    const m = r.revenue - cb;
    return `<tr><td>${esc(r.name)}</td><td>${r.sent.toLocaleString()}건</td>
      <td>${r.revenue.toLocaleString()}원</td><td>${cb.toLocaleString()}원</td>
      <td><b>${m.toLocaleString()}원</b></td><td>${r.revenue > 0 ? Math.round((m / r.revenue) * 100) : 0}%</td></tr>`;
  }).join("") : `<tr><td colspan="6" class="empty">이 달 발송 내역이 없습니다.</td></tr>`;
  const monthOpts = (months.length ? months.map((x) => x.m) : [selMonth]).map((m) =>
    `<option value="${esc(m)}"${m === selMonth ? " selected" : ""}>${esc(m)}</option>`).join("");
  const settlementPanel = `<section class="panel" id="p-settle"><div class="panel-head">
      <h2 class="panel-title">월별 정산 · 마진 <span class="badge ${margin > 0 ? "badge-ok" : "badge-muted"}">${margin.toLocaleString()}원 (${marginPct}%)</span></h2>
      <form method="get" action="/super" class="inline-form"><select name="m" data-autosubmit>${monthOpts}</select><button class="btn btn-xs btn-ghost">이동</button></form></div>
    <div class="stat-cards">
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">발송</span></div><span class="stat-num">${sT.sent.toLocaleString()}</span><div class="stat-delta mut">건 (성공분만)</div></div>
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">매출</span></div><span class="stat-num">${sT.rev.toLocaleString()}</span><div class="stat-delta mut">원 · 고객사 차감액</div></div>
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">원가</span></div><span class="stat-num">${sT.base.toLocaleString()}</span><div class="stat-delta mut">원 · 건당 ${unitCost}원 기준</div></div>
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">마진</span></div><span class="stat-num">${margin.toLocaleString()}</span><div class="stat-delta ${margin > 0 ? "up" : "mut"}">원 (${marginPct}%)</div></div>
    </div>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>조직</th><th>발송</th><th>매출</th><th>원가</th><th>마진</th><th>마진율</th></tr></thead><tbody>${settleRows}</tbody></table></div>
    <div class="form-divider">원가 설정 (CPaaS 실제 계약가)</div>
    <form method="post" action="/super/notify-cost" class="stack-form compact">
      <label class="mini-label">알림톡 원가 (원/건)<input type="number" name="cost_alimtalk" value="${unitCost}" min="0" max="1000" step="0.1" required /></label>
      <p class="panel-hint">알리고 청구서의 실제 건당 단가를 넣으세요. <b>소수점 입력 가능</b>(알림톡은 보통 6.5원). <b>발송 시점의 원가가 로그에 함께 저장</b>되므로,
        나중에 원가를 바꿔도 지난 달 마진은 그대로 유지됩니다.</p>
      <button class="btn btn-primary btn-sm">원가 저장</button></form>
    <div class="form-divider">공유 계정 대사(對査)</div>
    <p class="panel-hint">알리고 계정을 다른 서비스와 함께 쓰신다면, 알리고 대시보드에서 <b>이 플랫폼 템플릿 코드</b>로 필터해
      건수를 맞춰 보세요. ${selMonth} 기준 이 플랫폼 발송은 <b>${sT.sent.toLocaleString()}건</b>입니다.
      차이가 나면 그만큼이 다른 서비스 발송분입니다.</p>
    <table class="verify-table"><tr><th>이 플랫폼 템플릿</th><td>${
      (await Promise.all(Object.values(TEMPLATE_KEYS).map((k) => D.getSetting(db, k)))).filter(Boolean).map((c) => `<code>${esc(c)}</code>`).join(" · ") || "<span class=\"muted\">아직 등록되지 않음</span>"
    }</td></tr>
    <tr><th>발송 참조 코드</th><td><code>SCM-{조직id}-{템플릿}</code> — 발송 로그에 함께 기록됩니다</td></tr></table></section>`;

  const notifySuperPanel = `<section class="panel panel-accent"><h2 class="panel-title">알림톡 판매 <span class="badge badge-brand">건당 ${unitPrice.toLocaleString()}원</span>${pendCredits.length ? ` <span class="badge badge-wait">충전 대기 ${pendCredits.length}</span>` : ""}</h2>
    <p class="panel-hint">고객사가 선불로 충전하고 발송할 때마다 차감됩니다. <b>판매단가 − 원가 = 마진</b>이며, 발송 실패는 자동 환불되어 매출로 잡히지 않습니다.
      ${notifyEnabled(env) ? "" : '<b class="txt-warn">아직 알리고 키가 설정되지 않아 실제 발송은 되지 않습니다.</b>'}</p>
    ${notifyEnabled(env) ? "" : `<div class="flash flash-warn">
      <b>넷이 모두 있어야 발송이 켜집니다 — 하나라도 비면 한 통도 안 나갑니다.</b>
      <p>다만 <b>서비스가 멈추지는 않습니다.</b> 고객사 관리자는 문서 화면의 [보내기 · 복사] 로
        서명 링크를 카톡·문자로 직접 보내 계약을 끝까지 진행할 수 있습니다 — 심사가 끝날 때까지 이렇게 씁니다.</p>
      <div class="envcheck">${ALIGO_VARS.map((k) => `<span class="${hasCfg(env, k) ? "is-on" : ""}"><b>${hasCfg(env, k) ? "있음" : "없음"}</b> <code>${k}</code></span>`).join("")}</div>
      <p><b>없음</b> 은 이 워커가 그 이름을 못 받고 있다는 뜻입니다. 대시보드에 보이는데 여기가 없음이라면
        ① 이름 철자·앞뒤 공백, ② <b>Deploy</b> 를 안 누름, ③ Preview 환경에 넣음,
        ④ <b>Text 로 넣어서 배포 때 지워짐</b>(<code>wrangler.toml</code> 의 <code>[vars]</code> 가 평문 변수를 덮어씁니다 — 반드시 <b>Secret</b>) 중 하나입니다.</p>
      <p>넣는 곳: Workers &amp; Pages → <b>website</b> → Settings → Variables and Secrets → ＋ Add → Type <b>Secret</b> → Deploy</p></div>`}
    <div class="stat-cards">
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">누적 발송</span></div><span class="stat-num">${totalSent.toLocaleString()}</span><div class="stat-delta mut">건</div></div>
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">발송 매출</span></div><span class="stat-num">${totalRevenue.toLocaleString()}</span><div class="stat-delta mut">원 (차감 확정분)</div></div>
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">누적 충전</span></div><span class="stat-num">${totalCharged.toLocaleString()}</span><div class="stat-delta mut">원 (입금 기준)</div></div>
    </div>
    <div class="form-divider">충전 신청 (입금 확인 후 승인)</div>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>조직</th><th>금액</th><th>입금자·신청</th><th>처리</th></tr></thead><tbody>${creditRows}</tbody></table></div>
    </section>

    <details class="panel panel-fold"><summary class="panel-title">알림톡 설정
      <span class="badge ${tplDone === tplLive.length ? "badge-ok" : "badge-wait"}">템플릿 ${tplDone}/${tplLive.length}</span></summary>
    <p class="panel-hint">한 번 정해 두면 다시 볼 일이 거의 없는 것들입니다.</p>
    <div class="form-divider">단가·템플릿 설정</div>
    <form method="post" action="/super/notify-settings" class="stack-form">
      <label class="mini-label">알림톡 판매단가 (원/건)<input type="number" name="price_alimtalk" value="${unitPrice}" min="0" max="1000" required /></label>
      <div class="form-two">${tplInputs}</div>
      <p class="panel-hint">템플릿 코드는 플랫폼 카카오 채널에 등록·심사 통과된 값이어야 합니다. 비어 있으면 <b>그 종류만</b> 발송되지 않습니다(다른 종류는 정상).</p>
      <button class="btn btn-primary btn-sm">알림톡 설정 저장</button></form>
    <form method="post" action="/super/notify-sync" class="inline-form" style="margin-top:10px"
      data-confirm="알리고에 등록된 템플릿 목록을 받아 코드 칸을 자동으로 채웁니다. 계속할까요?">
      <button class="btn btn-ghost btn-sm"${notifyEnabled(env) ? "" : " disabled"}>알리고에서 코드 불러오기</button></form>
    <p class="panel-hint">손으로 일곱 개를 옮겨 적으면 오타 하나로 그 종류만 조용히 실패합니다.
      <b>알리고에 등록된 문구와 대조해</b> 맞는 것만 채우고, 못 찾은 것·아직 심사 중인 것은 이름으로 알려 드립니다.
      ${notifyEnabled(env) ? "" : "<b>알리고 키가 있어야 쓸 수 있습니다.</b>"}</p>
    <div class="form-divider">시험 발송 <span class="badge badge-muted">크레딧 차감 없음</span></div>
    <p class="panel-hint">코드가 틀렸는지는 <b>보내 봐야</b> 알 수 있습니다. 실제 계약 중에 알게 되면 상대방이 기다리는 상태가 됩니다.
      본인 번호로 한 종류씩 보내 보세요 — 실패하면 <b>카카오·알리고가 준 오류 문구를 그대로</b> 보여 줍니다.</p>
    <form method="post" action="/super/notify-test" class="stack-form compact">
      <div class="form-two">
        <label class="mini-label">보낼 종류<select name="kind">${tplEntries.map(([kind, t]) =>
          `<option value="${esc(kind)}">${esc(t.label)}</option>`).join("")}</select></label>
        <label class="mini-label">받을 휴대폰<input type="tel" name="phone" placeholder="010-1234-5678" maxlength="13" inputmode="numeric" required autocomplete="tel" /></label>
      </div>
      <button class="btn btn-ghost btn-sm">테스트 발송</button></form>
    <p class="panel-hint">시험 발송은 정산에 잡히지 않습니다. 다만 제공사 원가는 실제로 발생합니다(1건 기준 ${(await costOf(db, "alimtalk")).toLocaleString()}원).
      문자 대체발송은 꺼 두어, <b>알림톡 자체가 통했는지</b>만 확인합니다.</p>
    <div class="form-divider">카카오에 등록할 문구 <span class="badge ${tplDone === tplLive.length ? "badge-ok" : "badge-wait"}">${tplDone}/${tplLive.length} 등록</span></div>
    <p class="panel-hint">알림톡은 심사받은 문구와 <b>글자 하나까지</b> 같아야 발송됩니다. 아래 문구를 그대로 복사해 등록하고, 받은 코드를 위 칸에 넣으세요.
      용도별로 템플릿이 따로 필요합니다 — 인증번호를 '서명 요청' 템플릿으로 보내면 문구가 달라 거절됩니다.</p>
    ${tplGuide}
    <div class="form-divider">전자계약 셀프 가입</div>
    <form method="post" action="/super/signup-settings" class="stack-form compact">
      <div class="row-toggle"><label class="switch"><input type="checkbox" name="self_signup" value="1"${selfSignup ? " checked" : ""} /><span class="track"></span></label>
        <span><b>/esign/signup</b> 에서 스스로 가입해 바로 시작하게 허용 <small style="color:var(--muted)">(끄면 도입 문의만 받음)</small></span></div>
      <label class="mini-label">가입 체험 크레딧 (원) <small>(0이면 없음 — 이메일은 되고 알림톡은 충전 후)</small>
        <input type="number" name="trial_credit" value="${trialCredit}" min="0" max="100000" step="1000" /></label>
      <button class="btn btn-ghost btn-sm">가입 설정 저장</button></form>
    <p class="panel-hint">가입만으로는 비용이 나가지 않습니다 — 알림톡 발송은 크레딧 충전 승인을 거칩니다.
      하루 ${SIGNUP_DAILY_MAX_UI}개까지만 만들어지고, 캡차(Turnstile)를 설정하면 봇도 막습니다.
      셀프 가입한 조직은 아래 목록에 <b>전자계약</b> 유형으로 나타납니다.</p>
    <div class="form-divider">과금 방식</div>
    <form method="post" action="/super/billing-mode" class="stack-form compact">
      <div class="row-toggle"><label class="switch"><input type="checkbox" name="billing_mode" value="per_doc"${mode === "per_doc" ? " checked" : ""} /><span class="track"></span></label>
        <span><b>계약당 과금</b>으로 받기 <small style="color:var(--muted)">(끄면 발송당 과금 — 지금은 <b>${esc(BILLING_MODES[mode])}</b>)</small></span></div>
      <button class="btn btn-ghost btn-sm">과금 방식 저장</button></form>
    <p class="panel-hint">${mode === "per_doc"
      ? `계약을 만들 때 <b>${unitPrice.toLocaleString()}원</b>을 한 번 받고, 그 계약의 서명 요청·본인확인·완료 안내·재알림은 모두 무료입니다. 공지 발송은 이 요금과 별개로 건당 과금됩니다.`
      : `발송 1건마다 <b>${unitPrice.toLocaleString()}원</b>씩 차감합니다. 서명자·재알림이 늘면 매출도 함께 늘어납니다.`}</p>
    </details>

    <details class="panel panel-fold"><summary class="panel-title">계산 근거 <span class="badge badge-muted">참고</span></summary>
    <p class="panel-hint">단가를 정하거나 과금 방식을 고를 때 보는 표입니다. 평소에는 볼 일이 없습니다.</p>
    <div class="form-divider">계약 1건에 몇 통이 나가나</div>
    <table class="admin-table tpl-count"><thead><tr><th>단계</th><th>발송</th><th>필수</th></tr></thead><tbody>
      <tr><td>서명 요청</td><td>서명자 1인당 1통</td><td>필수</td></tr>
      <tr><td>본인확인(OTP)</td><td>서명자 1인당 1통 <small>(재요청 시 추가)</small></td><td>본인확인 켠 경우</td></tr>
      <tr><td>서명 완료 확인서</td><td>서명자 1인당 1통</td><td>필수</td></tr>
      <tr><td>미완료 재알림</td><td>미서명자 1인당 1통</td><td>보낼 때만</td></tr>
    </tbody></table>
    <p class="panel-hint">서명자 1인당 <b>3통</b>(요청·본인확인·완료). 본인확인을 끄면 2통.
      ${emailOn(env)
        ? "이메일만 등록된 서명자는 메일로 나가 비용이 들지 않습니다."
        : "<b>번호가 없는 서명자에게는 아무 안내도 나가지 않습니다</b> — 서명 링크를 문서 화면에서 복사해 직접 보내야 합니다."}</p>
    <div class="form-divider">서명자 수별 손익 <small>(본인확인 켠 기준 · 원가 ${(await costOf(db, "alimtalk")).toLocaleString()}원)</small></div>
    <div class="table-scroll"><table class="admin-table tpl-count">
      <thead><tr><th>서명자</th><th>발송</th><th>원가</th><th>매출</th><th>마진</th></tr></thead><tbody>
      ${[2, 3, 4, 5, 6, 8].map((n) => {
        const sends = n * 3;
        const cost = sends * (baseCost);
        const rev = mode === "per_doc" ? unitPrice : sends * unitPrice;
        const margin = rev - cost;
        return `<tr class="${margin < 0 ? "is-loss" : ""}"><td>${n}인</td><td>${sends}통</td>
          <td>${cost.toLocaleString()}원</td><td>${rev.toLocaleString()}원</td>
          <td><b>${margin.toLocaleString()}원</b> <small>(${rev ? Math.round((margin / rev) * 100) : 0}%)</small></td></tr>`;
      }).join("")}</tbody></table></div>
    ${mode === "per_doc" ? `<p class="panel-hint txt-warn">계약당 정액은 <b>매출이 고정인데 원가는 서명자 수에 비례</b>합니다.
      현재 단가 ${unitPrice.toLocaleString()}원 기준으로 서명자 <b>${Math.max(1, Math.floor(unitPrice / (3 * baseCost)))}명</b>까지 이익이고,
      그보다 많으면 손해입니다. 재알림을 보낼수록 손익분기가 더 앞당겨집니다.</p>`
      : `<p class="panel-hint">발송당 과금은 인원이 늘어도 마진율이 일정합니다(${unitPrice ? Math.round(((unitPrice - baseCost) / unitPrice) * 100) : 0}%).</p>`}
    </details>`;

  const usagePanel = `<details class="panel panel-fold"><summary class="panel-title">저장용량 <span class="badge badge-muted">R2 총 ${fmtBytes(ps.storage)}</span></summary>
    <p class="panel-hint">무료 한도 10GB 기준입니다. 조직별 사용량은 그 조직 화면에서 봅니다.</p></details>`;
  // 영업 파이프라인 — 신청/발굴 건을 단계별로 굴리고, 연락 기록을 그 자리에 남깁니다.
  const noteMap = new Map();
  for (const n of appNotes) { if (!noteMap.has(n.application_id)) noteMap.set(n.application_id, []); noteMap.get(n.application_id).push(n); }
  const todayStr = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const stageCount = (k) => pendingApps.filter((a) => (a.stage || "new") === k).length;
  const dueSoon = pendingApps.filter((a) => a.next_action_at && a.next_action_at <= todayStr).length;
  const appCards = pendingApps.map((a) => {
    const st = SALES_STAGES[a.stage] ? a.stage : "new";
    const notes = noteMap.get(a.id) || [];
    const overdue = a.next_action_at && a.next_action_at <= todayStr;
    return `<article class="lead-card${overdue ? " is-due" : ""}">
      <div class="lead-head">
        <div><h3>${esc(a.assoc_name)} ${a.source === "direct" ? '<span class="badge badge-info">직접 발굴</span>' : '<span class="badge badge-muted">신청</span>'}</h3>
          <p class="lead-contact">${esc(a.contact_name || "담당자 미상")}${a.contact_email ? ` · <a href="mailto:${esc(a.contact_email)}">${esc(a.contact_email)}</a>` : ""}${a.contact_phone ? ` · <a href="tel:${esc(a.contact_phone)}">${esc(a.contact_phone)}</a>` : ""}</p>
          <p class="lead-meta">등록 ${esc(kstDate(a.created_at))}${a.next_action_at ? ` · <b class="${overdue ? "lead-due" : ""}">다음 연락 ${esc(a.next_action_at)}</b>` : ""}</p></div>
        <span class="stage-badge stage-${st}">${esc(SALES_STAGES[st])}</span></div>
      ${a.message ? `<p class="lead-msg">${esc(clip(a.message, 220))}</p>` : ""}
      <form method="post" action="/super/application/${a.id}/stage" class="lead-stage">
        <select name="stage">${Object.entries(SALES_STAGES).map(([k, v]) => `<option value="${k}"${k === st ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>
        <input type="date" name="next_action_at" value="${esc(a.next_action_at || "")}" title="다음 연락 예정일" />
        <button class="btn btn-xs btn-ghost">단계 저장</button></form>
      <form method="post" action="/super/application/${a.id}/note" class="lead-note">
        <input type="text" name="body" maxlength="1000" placeholder="연락·미팅 기록 (예: 회장님 통화, 다음 주 화요일 방문 약속)" required />
        <button class="btn btn-xs btn-ghost">기록</button></form>
      ${notes.length ? `<ul class="lead-log">${notes.slice(0, 5).map((n) => `<li><span>${esc(n.body)}</span><time>${esc(kstStamp(n.created_at, { year: false }))} · ${esc(n.actor_name)}</time></li>`).join("")}${notes.length > 5 ? `<li class="lead-more">외 ${notes.length - 5}건</li>` : ""}</ul>` : ""}
      <div class="lead-actions">
        <form method="post" action="/super/application/${a.id}/approve" data-confirm="'${esc(a.assoc_name)}' 을(를) 승인하고 조직·관리자 계정을 발급할까요?"><button class="btn btn-xs btn-primary">승인·발급</button></form>
        <form method="post" action="/super/application/${a.id}/reject" data-confirm="반려할까요? 목록에서 사라집니다."><button class="btn btn-xs btn-ghost">반려</button></form></div>
    </article>`;
  }).join("");
  const appsPanel = `<section class="panel panel-accent"><div class="panel-head"><h2 class="panel-title">영업 파이프라인 <span class="badge ${pendingApps.length ? "badge-wait" : "badge-muted"}">${pendingApps.length}건 진행</span>${dueSoon ? ` <span class="badge badge-no">연락할 때 ${dueSoon}건</span>` : ""}</h2></div>
    <p class="panel-hint">공개 신청(<a href="/apply" target="_blank">/apply</a>)으로 들어온 건과 직접 발굴한 곳을 함께 관리합니다. 승인하면 홈과 관리자 계정이 바로 발급됩니다.</p>
    ${pendingApps.length ? `<div class="stage-strip">${Object.entries(SALES_STAGES).map(([k, v]) => `<span class="stage-chip stage-${k}">${esc(v)} <b>${stageCount(k)}</b></span>`).join("")}</div>
    <div class="lead-grid">${appCards}</div>` : `<p class="panel-hint">진행 중인 건이 없습니다.</p>`}
    <details class="lead-add"><summary class="btn btn-ghost btn-sm">＋ 직접 발굴한 곳 추가</summary>
      <form method="post" action="/super/prospect" class="stack-form compact">
        <div class="form-two"><label>조직 이름<input type="text" name="assoc_name" required maxlength="100" placeholder="예: 방배동 먹자골목 상인회" autocomplete="organization" /></label>
          <label>담당자<input type="text" name="contact_name" maxlength="60" placeholder="예: 김회장" autocomplete="name" /></label></div>
        <div class="form-two"><label>이메일 (선택)<input type="email" name="contact_email" autocomplete="email" /></label>
          <label>연락처 (선택)<input type="text" name="contact_phone" maxlength="40" autocomplete="tel" /></label></div>
        <label>메모<textarea name="message" rows="2" maxlength="2000" placeholder="어디서 알게 됐는지, 규모, 관심사 등"></textarea></label>
        <button class="btn btn-primary btn-sm">영업 목록에 추가</button></form></details></section>`;
  // 첫 화면에 고객사를 올린다 — 매일 여는 것이 이것인데 탭 안쪽에 묻혀 있었다.
  // 여기서는 고르기만 한다. 손보는 일은 조직 화면(/super/org/:id) 한 곳에 모여 있다.
  const balByAssoc = new Map(notifyUsage.map((u) => [u.id, u.balance || 0]));
  // 손이 가야 하는 곳이 위로 온다 — 만든 순서는 운영자에게 아무 뜻이 없다.
  // 순서: 비활성 → 잔액 없음 → 오래 조용함 → 나머지는 최근 활동순.
  const asMs = (t) => (t ? Date.parse(t.includes("T") ? t : t.replace(" ", "T") + "Z") : NaN);
  const orgAttention = (a) => {
    // 갓 만든 곳은 아직 아무 활동이 없는 게 당연하다 — 개설일을 바닥으로 삼지 않으면
    // 새 고객사가 만들자마자 "한 달째 조용함"으로 뜬다.
    // Math.max 는 NaN 하나만 섞여도 NaN 이 된다 — 있는 값만 모아서 고른다
    const stamps = [asMs(lastAct.get(a.id)), asMs(a.created_at)].filter(Number.isFinite);
    const d = stamps.length ? Math.floor((Date.now() - Math.max(...stamps)) / 86400000) : null;
    if (!a.active) return { rank: 0, why: "비활성 — 고객이 보는 화면이 닫혀 있습니다", d };
    if (!(balByAssoc.get(a.id) > 0)) return { rank: 1, why: "알림톡 잔액이 없어 안내가 나가지 않습니다", d };
    if (d === null || d >= 30) return { rank: 2, why: "한 달 넘게 아무 움직임이 없습니다", d };
    return { rank: 3, why: "", d };
  };
  const ranked = list.map((a) => ({ a, ...orgAttention(a) }))
    .sort((x, y) => x.rank - y.rank || (x.d === null ? 1e9 : x.d) - (y.d === null ? 1e9 : y.d));
  const needAttention = ranked.filter((r) => r.rank < 3).length;
  const orgCards = ranked.map(({ a, why, d }) => {
    const K = kindById(a.kind);
    const bal = balByAssoc.get(a.id) || 0;
    return `<a class="org-card${a.active ? "" : " is-off"}${why ? " needs" : ""}" href="/super/org/${a.id}">
      <span class="org-top"><b>${esc(a.name)}</b>
        <span class="badge ${K.badge}">${esc(K.label)}</span>${a.active ? "" : '<span class="badge badge-no">비활성</span>'}</span>
      <span class="org-meta"><code>${esc(prettyPath("/t/" + a.slug))}</code></span>
      ${why ? `<span class="org-why">${esc(why)}</span>` : ""}
      <span class="org-foot"><span class="act-stamp${d === null || d >= 30 ? " is-cold" : ""}"
        title="점포·공지·행사·게시글·서명을 통틀어 마지막으로 움직인 시각">${d === null ? "활동 없음" : d <= 0 ? "오늘 활동" : `${d}일 전 활동`}</span>
        · 알림톡 ${bal > 0 ? `${bal.toLocaleString()}원` : "<b class=\"txt-warn\">잔액 없음</b>"}</span></a>`;
  }).join("");
  const orgPanel = `<section class="panel"><div class="panel-head"><h2 class="panel-title">고객사 <span class="badge badge-muted">${list.length}곳</span>${
      needAttention ? `<span class="badge badge-no">손볼 곳 ${needAttention}</span>` : ""}</h2>
      </div>
    ${list.length ? `<p class="panel-hint">${needAttention
        ? "<b>손볼 곳이 위에 옵니다</b> — 화면이 닫힌 곳, 잔액이 없어 안내가 못 나가는 곳, 한 달 넘게 조용한 곳 순입니다."
        : "모두 정상입니다. 최근 움직인 순서로 보여 드립니다."} 한 곳을 누르면 주소·유형·요금제·알림톡·관리자 계정이 <b>한 화면에</b> 모여 있습니다.</p>
      <div class="org-grid">${orgCards}</div>`
      : `<p class="panel-hint">아직 고객사가 없습니다. <a href="#new-assoc">첫 조직 만들기 →</a></p>`}
  </section>`;

  // 콘솔이 한 화면에 14개 패널로 쏟아지던 것을 5개 묶음으로 나눈다.
  // 왼쪽에서 하나를 고르면 그것만 보인다(JS 꺼져 있으면 전부 보이는 문서로 폴백).
  const todo = [
    pendCredits.length ? { n: pendCredits.length, label: "충전 승인 대기", tab: "money" } : null,
    dueSoon ? { n: dueSoon, label: "오늘 연락할 영업", tab: "sales" } : null,
  ].filter(Boolean);
  const todoBar = todo.length
    ? `<div class="super-todo">${todo.map((t) => `<a href="#s-${t.tab}" class="super-todo-item"><b>${t.n}</b><span>${esc(t.label)}</span></a>`).join("")}</div>`
    : `<div class="super-todo is-clear"><span>지금 처리할 일이 없습니다</span></div>`;
  const TABS = [
    ["home", "고객사"],
    ["sales", "영업", pendingApps.length],
    ["money", "알림톡·정산", pendCredits.length],
    ["settings", "설정·보안", keyMode === "secret" ? 0 : 1],
  ];
  const sideNav = `<aside class="console-side"><nav id="superNav">${TABS.map(([id, label, badge]) =>
    `<a href="#s-${id}" data-tab="${id}">${esc(label)}${badge ? `<span class="side-badge">${badge}</span>` : ""}</a>`).join("")}</nav></aside>`;

  // 제품이 셋이므로 "몇 곳"만으로는 무엇을 파는 회사인지 화면에서 읽히지 않는다.
  const kindCounts = KIND_KEYS.map((k) => [k, KINDS[k].label, list.filter((a) => (a.kind || "merchant") === k).length])
    .filter(([, , n]) => n > 0);
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><h1 class="dash-title">운영사 콘솔</h1>
      <p class="dash-sub">고객사 ${ps.associations}곳 · 사용자 ${ps.users}명 — ${kindCounts.map(([, label, n]) => `${esc(label)} ${n}`).join(" · ")}</p></div>
      <div class="dash-head-actions"><a href="#new-assoc" class="btn btn-primary btn-sm" data-goto="home">＋ 새 조직</a></div></div>${flashOf(query)}
    ${loadWarnings.length ? `<div class="flash flash-err"><b>일부 정보를 불러오지 못했습니다.</b> 나머지 기능은 그대로 쓰실 수 있습니다.<br />${loadWarnings.map((w) => esc(w)).join("<br />")}</div>` : ""}
    ${todoBar}
    <div class="console-grid">${sideNav}<div class="console-main">

      <div class="sgroup" id="s-home" data-tab="home">
        ${cronAlive ? "" : cronPanel}
        ${orgPanel}
    <details class="panel panel-accent panel-fold" id="new-assoc"><summary class="panel-title">새 조직 만들기</summary>
      <p class="panel-hint"><b>고객사 한 곳</b>을 새로 여는 작업입니다 — 서초구 상인회, ○○법무법인처럼
        <b>실제로 돈을 내고 쓰는 조직 하나</b>. 서식이나 견본을 만드는 게 아닙니다.
        만들면 그 조직만의 주소(<code>/t/이름</code>)와 관리자 계정이 함께 생깁니다.</p>
      <form method="post" action="/super/association" class="stack-form" id="new-assoc-form">
        <div class="form-two"><label>조직 이름 <small>(고객사 실제 이름 — 화면 곳곳에 그대로 나옵니다)</small>
          <input type="text" name="name" required placeholder="예: 서초구 상인회" autocomplete="organization" /></label>
          <label>대표 색상 <small>(그 조직 화면의 버튼·강조색)</small><input type="color" name="brand_color" value="#0b6e4f" /></label></div>
        <label>유형 <small>(무엇을 파는지 — 이걸로 화면과 메뉴가 통째로 달라집니다)</small><select name="kind" id="new-kind">
          ${KIND_KEYS.map((k) => `<option value="${k}"${KINDS[k].usesLanding ? ' data-landing="1"' : ""}>${esc(KINDS[k].createLabel || KINDS[k].label)} — ${esc(KINDS[k].createHint)}</option>`).join("")}
        </select></label>
        <label class="only-landing">업종 문구 <small>(가맹점 모집 랜딩에만 씁니다 — 상인회·전자계약은 골라도 무시됩니다)</small>
          <select name="preset">${PRESET_KEYS.map((k) => `<option value="${k}">${esc(PRESETS[k].label)}</option>`).join("")}</select></label>
        <label>한 줄 소개 <small>(고객사 홈 첫 화면의 큰 문구 · 검색결과 설명 · 카톡 공유 미리보기에 나옵니다. 비우면 유형에 맞는 기본 문구가 들어갑니다)</small>
          <input type="text" name="tagline" maxlength="200" placeholder="예: 함께 성장하는 우리 동네 상권" /></label>
        <div class="form-divider">관리자 계정</div>
        <div class="form-two"><label>관리자 이름<input type="text" name="admin_name" autocomplete="name" /></label><label>관리자 이메일<input type="email" name="admin_email" required autocomplete="email" /></label></div>
        <label>관리자 비밀번호 (8자 이상)<input type="password" name="admin_password" required minlength="8" autocomplete="new-password" /></label>
        <button class="btn btn-primary">조직 만들기</button></form></details>
    <details class="panel panel-fold" id="clone-assoc"><summary class="panel-title">기존 사이트 복제해서 만들기</summary>
      <p class="panel-hint">잘 만들어 둔 사이트를 본으로 새 고객사를 찍어 냅니다. 프랜차이즈든 상인회든 같습니다.
        <b>복사되는 것</b>: 유형·업종 문구·대표색·홈/랜딩 화면 구성·캠페인 사본.
        <b>복사되지 않는 것</b>: 회원·점포·상담 신청·계약 — 남의 실제 데이터는 절대 따라오지 않습니다.</p>
      <form method="post" action="/super/association/clone" class="stack-form">
        <label>본으로 삼을 사이트<select name="source_id" required><option value="">— 선택 —</option>
          ${list.map((a) => `<option value="${a.id}">${esc(a.name)} (${esc(kindById(a.kind).label)}${kindById(a.kind).usesLanding ? " · " + esc((PRESETS[a.preset] || {}).label || "") : ""})</option>`).join("")}
        </select></label>
        <div class="form-two"><label>새 조직 이름<input type="text" name="name" required maxlength="100" autocomplete="organization" /></label>
          <label>대표 색상 <small>(비우면 원본과 동일)</small><input type="color" name="brand_color" value="#0b6e4f" /></label></div>
        <label>한 줄 소개 <small>(비우면 원본과 동일)</small><input type="text" name="tagline" maxlength="200" /></label>
        <div class="form-divider">관리자 계정</div>
        <div class="form-two"><label>관리자 이름<input type="text" name="admin_name" autocomplete="name" /></label><label>관리자 이메일<input type="email" name="admin_email" required autocomplete="email" /></label></div>
        <label>관리자 비밀번호 (8자 이상)<input type="password" name="admin_password" required minlength="8" autocomplete="new-password" /></label>
        <button class="btn btn-primary">복제해서 만들기</button></form></details>
      </div>

      <div class="sgroup" id="s-sales" data-tab="sales">
        ${appsPanel}
      </div>

      <div class="sgroup" id="s-money" data-tab="money">
        <section class="panel"><h2 class="panel-title">이번 달 알림톡 손익 <span class="badge ${margin > 0 ? "badge-ok" : "badge-muted"}">${margin.toLocaleString()}원</span></h2>
          <p class="panel-hint">건당 판매 ${unitPrice.toLocaleString()}원 · 마진율 ${marginPct}%.</p></section>
        ${notifySuperPanel}
        ${settlementPanel}
        ${pricePanel}
      </div>

      <div class="sgroup" id="s-settings" data-tab="settings">
        ${migratePanel}
        ${securityPanel}
    <section class="panel"><h2 class="panel-title">플랫폼 설정</h2>
      <form method="post" action="/super/platform-mode" class="stack-form compact">
        <div class="row-toggle"><label class="switch"><input type="checkbox" name="on" value="1"${platformMode ? " checked" : ""} /><span class="track"></span></label>
          <span>루트(첫 화면)를 <b>플랫폼 소개 랜딩</b>으로 표시 <small style="color:var(--muted)">(끄면 조직이 1곳일 때 그 홈으로 바로 이동)</small></span></div>
        <button class="btn btn-ghost btn-sm">저장</button></form>
      <div class="form-divider">플랫폼/운영자 정보 (약관·개인정보처리방침·푸터에 표시)</div>
      <form method="post" action="/super/platform-info" class="stack-form compact">
        <div class="form-two"><label>플랫폼/서비스명<input type="text" name="site_name" value="${esc(siteName)}" maxlength="60" /></label>
          <label>운영자(사업자)명<input type="text" name="operator" value="${esc(operator)}" maxlength="80" /></label></div>
        <div class="form-two"><label>문의 이메일<input type="email" name="contact_email" value="${esc(contactEmail)}" autocomplete="email" /></label>
          <label>문의 전화(선택)<input type="text" name="contact_phone" value="${esc(contactPhone)}" maxlength="40" autocomplete="tel" /></label></div>
        <button class="btn btn-ghost btn-sm">정보 저장</button></form>
      <p class="panel-hint">공개 신청: <a href="/apply" target="_blank">/apply</a> · 약관: <a href="/terms" target="_blank">/terms</a> · 개인정보처리방침: <a href="/privacy" target="_blank">/privacy</a></p>    ${deployLine}
  </section>
        ${superPanel}
    <p class="section-eyebrow group-div">시스템 — 평소엔 열어 볼 일이 없습니다</p>
        ${cronAlive ? cronPanel : ""}
        ${wiredPanel}
        ${usagePanel}
    <details class="panel ops-guide"><summary class="panel-title">운영 가이드 — 도메인·지도 설정 위치</summary>
      <div class="ops-body">
      <h3>네이버 지도 (도메인 바뀔 때마다!)</h3>
      <ol>
        <li><a href="https://console.ncloud.com" target="_blank" rel="noopener">네이버 클라우드 콘솔</a> → Maps → Application 목록 → 해당 앱 <b>[변경]</b></li>
        <li><b>Web 서비스 URL</b> 에 지도가 표시될 도메인을 <b>추가</b> (예: <code>https://website.tobe211167.workers.dev</code>, 개별 도메인 연결 시 그 도메인도)</li>
        <li>기존 주소는 지우지 말 것 — 미등록 도메인에선 지도가 "인증 실패" 회색 화면이 됩니다</li>
        <li>URL 은 앱당 <b>최대 10개</b> — 초과 시 Maps 앱을 하나 더 만들고, 아래 조직 목록의 <b>지도 키</b> 칸에 새 앱의 Client ID 를 넣으면 그 조직만 새 앱을 사용합니다</li>
        <li>사장님 대시보드의 <b>"주소로 찾기"</b>(주소→좌표 자동 변환)를 쓰려면 같은 Maps 앱에서 <b>Geocoding</b> 서비스도 체크해 주세요 — 미활성이어도 지도 클릭 방식은 그대로 동작합니다</li>
      </ol>
      <h3>개별 도메인 연결 (조직 1곳당)</h3>
      <ol>
        <li>도메인을 이 Cloudflare 계정에 추가 (Domains → Add)</li>
        <li>Workers &amp; Pages → 이 워커 → Settings → <b>Domains &amp; Routes → Add → Custom Domain</b></li>
        <li>아래 조직 목록의 <b>개별 도메인</b> 칸에 같은 도메인 입력·저장</li>
        <li>네이버 지도 사용 시 → 위의 Web 서비스 URL 에도 추가</li>
      </ol>
      <h3>사진 직접 서빙 (설정 완료)</h3>
      <p>R2 버킷 공개 도메인(r2.dev) → 워커 변수 <code>MEDIA_PUBLIC_BASE</code>. 트래픽 커지면 커스텀 도메인으로 값만 교체.</p>
      </div></details>
    <details class="panel panel-fold"><summary class="panel-title">감사 로그 (플랫폼)</summary>
      <ul class="audit-list">${auditLog.length ? auditLog.map((a) => `<li><span class="audit-action">${esc(a.action)}</span> <span class="audit-detail">${esc(a.detail)}</span><span class="audit-meta">${esc(a.actor_name)} · ${esc(kstStamp(a.created_at, { year: false }))}</span></li>`).join("") : `<li class="empty">기록이 없습니다.</li>`}</ul></details>
      </div>

    </div></div></div></section>`;
  return html(layout({ title: "운영사 콘솔", console: "super", user, body, csrf, scripts: `<script src="${assetUrl("/js/super-tabs.js")}" defer></script>` }));
}

// ================= 계정 =================
export function account(ctx) {
  const { assoc, base, user, query, csrf, env } = ctx;
  // 2FA 상태별 UI
  let twofa;
  if (user.totp_enabled) {
    twofa = `<p class="panel-hint">2단계 인증이 <b>사용 중</b>입니다. 로그인 시 인증 앱의 6자리 코드가 필요합니다.</p>
      <form method="post" action="/account/2fa/disable" class="stack-form compact">
        <label>해제하려면 현재 인증 코드 입력<input type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" placeholder="000000" required autocomplete="one-time-code" /></label>
        <button class="btn btn-ghost btn-sm">2단계 인증 해제</button></form>`;
  } else if (user.totp_secret) {
    const uri = otpauthUri(user.totp_secret, user.email, assoc ? assoc.name : "상인회");
    twofa = `<p class="panel-hint">인증 앱(Google Authenticator, Authy 등)에 아래 키를 등록한 뒤, 앱에 표시된 6자리 코드를 입력해 <b>활성화</b>하세요.</p>
      <div class="totp-setup"><p>설정 키: <code class="totp-key">${esc(user.totp_secret)}</code></p>
      <details><summary>otpauth 링크(수동 등록용)</summary><code class="totp-uri">${esc(uri)}</code></details></div>
      <form method="post" action="/account/2fa/enable" class="stack-form compact">
        <label>앱에 표시된 6자리 코드<input type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" placeholder="000000" required autocomplete="one-time-code" /></label>
        <button class="btn btn-primary btn-sm">2단계 인증 활성화</button></form>
      <form method="post" action="/account/2fa/setup" class="stack-form compact"><button class="btn btn-ghost btn-xs">키 새로 생성</button></form>`;
  } else {
    twofa = `<p class="panel-hint">인증 앱으로 로그인을 한 단계 더 보호합니다. (관리자 계정 권장)</p>
      <form method="post" action="/account/2fa/setup"><button class="btn btn-primary btn-sm">2단계 인증 설정 시작</button></form>`;
  }
  // 운영사 콘솔 입구는 여기 둡니다 — 고객사 사이트 메뉴에 두면 그 조직의 기능처럼 보입니다.
  const superLink = user.role === "SUPERADMIN"
    ? `<section class="panel panel-accent"><h2 class="panel-title">운영사 콘솔</h2>
        <p class="panel-hint">조직 개설·영업 관리·사용량은 운영사 콘솔에서 봅니다. 고객사 화면과는 별개입니다.</p>
        <a class="btn btn-primary btn-sm" href="/super">운영사 콘솔 열기</a></section>`
    : "";
  const body = `<section class="section page-top"><div class="container narrow">
    <h1 class="article-title">계정 설정</h1>${flashOf(query)}
    ${superLink}
    <section class="panel"><h2 class="panel-title">알림 받을 휴대폰</h2>
      <p class="panel-hint">계약서 서명 요청·본인확인 번호를 카카오 알림톡으로 받습니다. ${emailOn(env)
        ? "비워 두면 이메일로만 안내됩니다."
        : "<b>비워 두면 어떤 안내도 받지 못합니다</b> — 이 조직은 이메일 발송을 쓰지 않습니다."}</p>
      <form method="post" action="/account/phone" class="stack-form compact">
        <label>휴대폰<input type="tel" name="phone" value="${esc(user.phone ? user.phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3") : "")}" maxlength="13" inputmode="numeric" placeholder="010-1234-5678" autocomplete="tel" /></label>
        <button class="btn btn-primary btn-sm">저장</button></form></section>
    <section class="panel"><h2 class="panel-title">비밀번호 변경</h2>
      <form method="post" action="/account/password" class="stack-form">
        <label>현재 비밀번호<input type="password" name="current" required autocomplete="current-password" /></label>
        <label>새 비밀번호 (8자 이상)<input type="password" name="new" required minlength="8" autocomplete="new-password" /></label>
        <label>새 비밀번호 확인<input type="password" name="confirm" required autocomplete="new-password" /></label>
        <button class="btn btn-primary btn-sm">변경</button></form></section>
    <section class="panel"><h2 class="panel-title">2단계 인증 (2FA)</h2>${twofa}</section>
    <section class="panel"><h2 class="panel-title">보안</h2>
      <p class="panel-hint">다른 기기·브라우저의 로그인 세션을 모두 종료합니다.</p>
      <form method="post" action="/account/logout-all" data-confirm="모든 기기에서 로그아웃할까요?"><button class="btn btn-ghost btn-sm">전 기기 로그아웃</button></form></section>
  </div></section>`;
  return html(layout({ title: "계정", assoc, base, user, body, csrf }));
}

// ================= 비밀번호 찾기 (내부 처리) =================
export function forgotForm(ctx) {
  const { env, query, csrf } = ctx;
  const auto = emailOn(env);
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    ${authHead("비밀번호 찾기", auto ? "가입한 이메일로 재설정 링크를 보내드립니다." : `가입한 이메일을 입력하면 ${ctx.assoc && ctx.assoc.kind === "esign" ? "조직 관리자" : "상인회 관리자"}에게 재설정 요청이 전달됩니다.`)}
    ${flashOf(query)}
    <form method="post" action="/forgot" class="stack-form"><label>이메일<input type="email" name="email" required autocomplete="email" /></label>
      <button class="btn btn-primary btn-block">${auto ? "재설정 링크 받기" : "재설정 요청"}</button></form>
    <p class="auth-note">보안을 위해 이메일 존재 여부와 관계없이 동일하게 안내됩니다.${auto ? "" : " 관리자가 확인 후 임시 비밀번호를 발급합니다."}</p></div></div></section>`;
  return html(layout({ title: "비밀번호 찾기", assoc: ctx.assoc, base: ctx.base, body, csrf }));
}

// 이메일 재설정 링크로 진입하는 새 비밀번호 설정 폼
export function resetForm(ctx) {
  const { query, csrf } = ctx;
  const token = query.get("token") || "";
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    ${authHead("새 비밀번호 설정", "8자 이상으로 입력해 주세요.")}
    ${flashOf(query)}
    <form method="post" action="/reset" class="stack-form">
      <input type="hidden" name="token" value="${esc(token)}" />
      <label>새 비밀번호<input type="password" name="password" minlength="8" required autocomplete="new-password" /></label>
      <button class="btn btn-primary btn-block">비밀번호 변경</button></form></div></div></section>`;
  return html(layout({ title: "새 비밀번호 설정", body, csrf }));
}

// ================= 설치 마법사 (최초 1회) =================
export async function setupForm(ctx) {
  const { db, query, csrf } = ctx;
  if ((await D.countUsers(db)) > 0) {
    return html(layout({ title: "설치 완료", body: `<section class="section page-top"><div class="container narrow"><h1 class="article-title">이미 설정되었습니다</h1><p>관리자 계정이 이미 존재합니다. <a href="/login">로그인</a> 하세요.</p></div></section>`, csrf }));
  }
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    <h1 class="auth-title">첫 설정</h1><p class="auth-sub">상인회와 관리자 계정을 만들어 시작하세요. (최초 1회)</p>${flashOf(query)}
    <form method="post" action="/setup" class="stack-form">
      <label>조직 이름<input type="text" name="assoc_name" required maxlength="100" placeholder="예: 서초구 상인회" autocomplete="organization" /></label>
      <div class="form-divider">상인회 관리자 (ADMIN)</div>
      <label>관리자 이메일<input type="email" name="admin_email" required autocomplete="email" /></label>
      <label>관리자 비밀번호 (8자 이상)<input type="password" name="admin_password" required minlength="8" autocomplete="new-password" /></label>
      <div class="form-divider">운영사 계정 (모든 고객사 · 사이트 복제 권한)</div>
      <label>슈퍼 이메일<input type="email" name="super_email" required /></label>
      <label>슈퍼 비밀번호 (8자 이상)<input type="password" name="super_password" required minlength="8" autocomplete="new-password" /></label>
      <button class="btn btn-primary btn-block">설정 완료하고 시작</button>
    </form><p class="auth-note">이 화면은 계정이 하나도 없을 때만 열립니다. 설정 후에는 자동으로 닫힙니다.</p></div></div></section>`;
  return html(layout({ title: "첫 설정", body, csrf }));
}

// ================= 플랫폼 랜딩 (루트) =================
export async function platformLanding(ctx) {
  const { db, csrf, query } = ctx;
  const list = await D.listActiveAssociations(db);
  const bizCounts = new Map((await Promise.all(list.map(async (a) => [a.id, (await D.stats(db, a.id)).businesses]))));
  const safeColor = (c) => /^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : "#0b6e4f";
  const cards = list.map((a) => `<a class="tenant-card" href="${a.custom_domain ? "https://" + esc(a.custom_domain) : "/t/" + esc(a.slug)}">
    <span class="tc-band" style="background:${safeColor(a.brand_color)}"></span>
    <span class="tc-avatar">${a.logo ? `<img src="${esc(mediaUrl(a.logo))}" alt="" />` : `<b>${esc(a.name.slice(0, 1))}</b>`}</span>
    <span class="tc-body"><strong>${esc(a.name)}</strong><em>${esc(a.tagline || "")}</em>
      <span class="tc-meta">${STOREFRONT_SVG} 가입 점포 ${bizCounts.get(a.id) || 0}곳</span></span>
  </a>`).join("") || `<p class="empty">첫 상인회를 기다리고 있어요.</p>`;
  const body = `
  <section class="landing-hero"><div class="container">
    <p class="hero-eyebrow">상인회·번영회·소상공인 모임을 위한</p>
    <h1 class="landing-title">우리 상권 홈페이지,<br /><span>5분 만에</span> 만드세요</h1>
    <p class="landing-lead">가입 점포 안내·지도, 공지·소식, 회원 게시판, 전자 동의서까지 — 상인회에 꼭 필요한 기능만 담았습니다. 서버·개발 없이 바로 시작하세요.</p>
    <div class="hero-actions"><a href="/apply" class="btn btn-primary btn-lg">무료로 신청하기</a>
      <a href="#features" class="btn btn-ghost btn-lg">기능 둘러보기</a></div>
    <p class="hero-note">상인회가 아니신가요? <a href="/esign">전자계약만 따로 쓰실 수 있습니다 →</a></p>
    <p class="hero-note">프랜차이즈 본사이신가요? <a href="/homepage">가맹점 모집 홈페이지를 만들어 드립니다 →</a></p>
  </div></section>
  <section class="section" id="features"><div class="container">
    <div class="section-head"><h2 class="section-title">상인회에 필요한 모든 것</h2></div>
    <ul class="plain-list">
      ${[["가입 점포 안내", "점포별 소개와 사진·영상(유튜브·릴스 링크를 그대로 붙입니다)"],
         ["점포 지도", "네이버 지도 위에 우리 상권 점포를 한눈에"],
         ["공지·소식", "카테고리로 나뉘고 검색되는 공지 게시판"],
         ["회원 게시판", "회원만 들어오는 소통 공간 · 사진 여러 장"],
         ["전자 동의서", "동의서·계약을 링크로 보내고 그 자리에서 서명받습니다"],
        ].map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join("")}
    </ul></div></section>
  <section class="section section-alt"><div class="container">
    <div class="section-head"><h2 class="section-title">함께하는 상인회</h2></div>
    <div class="landing-assoc-grid">${cards}</div></div></section>
  <section class="section"><div class="container">
    <a class="family-banner" href="https://live.ur-team.com/" target="_blank" rel="noopener">
      <span class="fb-badge">FAMILY SERVICE</span>
      <span class="fb-text"><strong>유어딜 — 돈버는 쇼핑</strong><em>할인 이용권·기프티콘 교환권·동네딜. 우리 상권 가게의 매출 채널이 되어드립니다.</em></span>
      <span class="fb-chev" aria-hidden="true">→</span></a></div></section>
  <section class="section section-dark"><div class="container cta-inner">
    <h2 class="section-title">지금 우리 상권도 시작해보세요</h2>
    <p class="section-lead">신청은 무료입니다. 검토 후 관리자 계정을 발급해 드립니다.</p>
    <a href="/apply" class="btn btn-primary btn-lg">무료 신청하기</a></div></section>`;
  return html(layout({ title: "상인회 홈페이지 플랫폼", body, csrf, product: { name: "상인회 플랫폼", home: "/", mark: "storefront", nav: false }, description: "상인회·번영회를 위한 홈페이지를 서버·개발 없이 5분 만에. 점포 안내·지도·공지·게시판·전자서명." }));
}

// 셀프 입점 신청 폼 (공개)
export function applyForm(ctx) {
  const { env, query, csrf } = ctx;
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    ${authHead("홈페이지 신청", "간단히 신청하면 검토 후 관리자 계정을 발급해 드립니다. (무료)")}${flashOf(query)}
    <form method="post" action="/apply" class="stack-form">
      <label>상인회·모임 이름<input type="text" name="assoc_name" required maxlength="100" placeholder="예: 강남시장 상인회" autocomplete="organization" /></label>
      <label>담당자 성함<input type="text" name="contact_name" maxlength="60" autocomplete="name" /></label>
      <label>연락받을 이메일<input type="email" name="contact_email" required autocomplete="email" /></label>
      <label>연락처(선택)<input type="tel" name="contact_phone" maxlength="40" autocomplete="tel" /></label>
      <label>남기실 말(선택)<textarea name="message" rows="3" maxlength="2000" placeholder="점포 수, 원하는 기능 등 자유롭게"></textarea></label>
      <label class="check"><input type="checkbox" name="agree" value="1" required /> <a href="/privacy" target="_blank">개인정보 수집·이용</a>에 동의합니다.</label>
      ${turnstileWidget(env)}
      <button class="btn btn-primary btn-block">신청하기</button>
    </form><p class="auth-note">이미 계정이 있으신가요? <a href="/login">로그인</a></p></div></div></section>`;
  return html(layout({ title: "홈페이지 신청", body, csrf, scripts: turnstileScript(env) }));
}

// ================= 법적 페이지 (약관·개인정보) =================
async function platformInfo(db) {
  return {
    siteName: (await D.getSetting(db, "site_name")) || "상인회 플랫폼",
    operator: (await D.getSetting(db, "operator")) || "운영자",
    email: (await D.getSetting(db, "contact_email")) || "",
    phone: (await D.getSetting(db, "contact_phone")) || "",
  };
}
function legalWrap(title, inner, info, csrf) {
  const contact = [info.email && `이메일 ${esc(info.email)}`, info.phone && `전화 ${esc(info.phone)}`].filter(Boolean).join(" · ");
  const body = `<section class="section page-top"><div class="container narrow legal">
    <h1 class="article-title">${esc(title)}</h1>
    <p class="legal-meta">${esc(info.siteName)}${contact ? " · " + contact : ""}</p>
    ${inner}
    <p class="legal-note">※ 본 문서는 표준 양식입니다. 실제 서비스 운영 전 사업 형태에 맞게 검토·보완하시길 권장합니다.</p>
  </div></section>`;
  return html(layout({ title, body, csrf }));
}
export async function terms(ctx) {
  const info = await platformInfo(ctx.db);
  const inner = `
    <h2>제1조 (목적)</h2><p>본 약관은 <b>${esc(info.siteName)}</b>(이하 "서비스")가 제공하는 <b>상인회·소상공인 홈페이지</b>와 <b>전자계약(전자서명)</b> 및 관련 기능의 이용 조건과 절차, 이용자와 운영자의 권리·의무를 규정함을 목적으로 합니다. 두 서비스는 각각 단독으로도 이용할 수 있습니다.</p>
    <h2>제2조 (정의)</h2><p>"이용자"란 서비스에 접속하여 이 약관에 따라 서비스를 이용하는 상인회·기업·회원·방문자를 말합니다. "회원"이란 계정을 등록한 이용자를 말합니다. "서명자"란 계정 없이 전달받은 링크로 전자서명하는 이용자를 말합니다.</p>
    <h2>제3조 (서비스의 제공)</h2><p>서비스는 점포 안내·지도, 공지·소식, 회원 게시판, 전자 동의서(전자서명), 가맹점 모집 홈페이지(상담 신청 접수·관리) 등을 제공합니다. 운영자는 서비스 내용을 변경하거나 중단할 수 있으며, 중대한 변경 시 사전에 공지합니다.</p>
    <h2>제4조 (회원의 의무)</h2><p>회원은 타인의 권리를 침해하거나 법령·공서양속에 반하는 게시물을 등록해서는 안 되며, 계정 정보를 안전하게 관리할 책임이 있습니다.</p>
    <h2>제5조 (게시물의 관리)</h2><p>운영자·상인회 관리자는 관련 법령을 위반하거나 부적절한 게시물을 사전 통지 없이 삭제·이동할 수 있습니다.</p>
    <h2>제6조 (전자서명)</h2><p>서비스가 제공하는 전자서명은 서명자 확인(로그인)·서명 의사(동의)·위변조 방지(해시·디지털 서명)·감사추적(시각·IP·기기)을 갖춘 일반 전자서명입니다. 고강도 인증이 필요한 용도는 별도 검토가 필요합니다.</p>
    <h2>제7조 (면책)</h2><p>운영자는 천재지변, 이용자의 귀책, 제3자 서비스(지도·영상 등)의 장애로 인한 손해에 대해 책임을 지지 않습니다.</p>
    <h2>제8조 (문의)</h2><p>본 약관 관련 문의는 위 연락처로 접수합니다.</p>`;
  return legalWrap("이용약관", inner, info, ctx.csrf);
}
export async function privacy(ctx) {
  const info = await platformInfo(ctx.db);
  const inner = `
    <p><b>${esc(info.siteName)}</b>(이하 "서비스")는 이용자의 개인정보를 중요하게 생각하며, 「개인정보 보호법」 등 관련 법령을 준수합니다.</p>
    <h2>1. 수집하는 개인정보 항목</h2><p>회원가입·입점신청 시 <b>이름, 이메일, 연락처, 점포 정보</b>를 수집합니다. <b>가맹 상담 신청</b> 시에는 <b>성함, 연락처, 희망 지역, 창업 예산, 유입 경로, 문의 내용</b>을 수집하며, 마케팅 정보 수신은 선택 동의 항목입니다. 서비스 이용 과정에서 접속 IP·기기 정보·서비스 이용 기록이 자동 생성·수집될 수 있습니다. 전자서명 시 서명자·시각·IP·기기 정보가 기록됩니다.</p>
    <h2>2. 수집·이용 목적</h2><p>회원 식별 및 관리, 서비스 제공(점포 안내·공지·게시판·전자서명), <b>가맹·창업 상담 응대</b>, 문의 응대, 부정 이용 방지를 위해 이용합니다. 가맹 상담 신청 정보는 해당 브랜드(가맹본부)의 상담 목적으로만 쓰이며, 별도 동의 없이 다른 목적으로 이용하지 않습니다.</p>
    <h2>3. 보유·이용 기간</h2><p>수집·이용 목적 달성 시 지체 없이 파기합니다. 다만 관련 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다. 회원 탈퇴 시 계정 정보는 삭제되며, 전자서명 기록은 법적 효력·분쟁 대비를 위해 별도 기간 보관될 수 있습니다. <b>가맹 상담 신청 정보는 상담이 종료되면 지체 없이 삭제</b>하며, 신청자는 아래 연락처로 삭제를 요청할 수 있습니다.</p>
    <h2>4. 제3자 제공·처리위탁</h2><p>서비스는 원칙적으로 개인정보를 외부에 제공하지 않습니다. 지도(네이버) 및 영상(유튜브·인스타그램·네이버TV)은 이용자가 직접 링크·연동하는 외부 서비스이며, 해당 서비스의 정책이 적용됩니다. 서비스 인프라는 Cloudflare를 통해 운영됩니다.</p>
    <h2>5. 쿠키</h2><p>로그인 유지와 보안(위조 요청 차단)에 쿠키를 씁니다. 이와 별개로, 상인회 홈을 여러 구성으로 나눠 비교하는 동안
      <b>어느 구성으로 들어왔는지</b>를 30분간 기억하는 쿠키(<code>sc_hv</code>)를 둘 수 있습니다. 사본 이름 한 조각만 담기며
      개인을 식별하지 않고, 해당 상인회 주소 안에서만 쓰이고, 30분 뒤 스스로 사라집니다. 브라우저 설정에서 쿠키를 거부해도
      서비스 이용에는 지장이 없습니다(비교 통계에만 잡히지 않습니다).</p>
    <h2>6. 이용자의 권리</h2><p>이용자는 언제든지 본인의 개인정보 열람·정정·삭제·처리정지를 요청할 수 있으며, 계정 설정 또는 문의처를 통해 행사할 수 있습니다.</p>
    <h2>7. 안전성 확보 조치</h2><p>비밀번호는 복호화 불가능한 방식(PBKDF2)으로 저장하고, 통신은 HTTPS로 암호화합니다. 2단계 인증(2FA)을 제공합니다.</p>
    <h2>8. 개인정보 보호책임자·문의</h2><p>${esc(info.operator)}${info.email ? ` (이메일 ${esc(info.email)})` : ""}${info.phone ? ` (전화 ${esc(info.phone)})` : ""}</p>`;
  return legalWrap("개인정보처리방침", inner, info, ctx.csrf);
}

// ================= SEO: sitemap · robots =================
function originOf(ctx) {
  const scheme = ctx.request.headers.get("x-forwarded-proto") || ctx.env.PUBLIC_SCHEME || "https";
  return `${scheme}://${ctx.url.host}`;
}
export async function sitemap(ctx) {
  const { db } = ctx;
  const o = originOf(ctx);
  const urls = [];
  const add = (loc, lastmod) => urls.push(`<url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${esc(String(lastmod).slice(0, 10))}</lastmod>` : ""}</url>`);
  const emitAssoc = async (a, prefix) => {
    add(prefix || o + "/");
    for (const p of ["/businesses", "/map", "/notices", "/events"]) add((prefix || o) + p);
    for (const b of (await D.listBusinessesPaged(db, a.id, { perPage: 200 })).items) add(`${prefix || o}/business/${encodeURIComponent(b.slug)}`, b.updated_at || b.created_at);
    for (const n of await D.listNotices(db, a.id, 200)) add(`${(prefix || o)}/notices/${n.id}`, n.created_at);
  };
  // 개별 도메인으로 접속: 그 상인회의 URL 만, 루트 경로 기준으로 (검색엔진은 같은 호스트 URL 만 수집)
  const own = await D.getAssociationByDomain(db, ctx.url.hostname);
  if (own) {
    await emitAssoc(own, "");
  } else {
    add(o + "/");
    // 제품 소개 페이지 — 검색으로 들어오는 입구다. 테넌트 개별 도메인에서는 넣지 않는다(남의 간판이 된다).
    add(o + "/esign");
    add(o + "/homepage");
    for (const a of await D.listActiveAssociations(db)) {
      if (a.custom_domain) continue; // 개별 도메인 사이트는 그 도메인의 /sitemap.xml 에서 수집 (중복 노출 방지)
      await emitAssoc(a, `${o}/t/${encodeURIComponent(a.slug)}`);
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
export function robots(ctx) {
  const o = originOf(ctx);
  // 공개 페이지는 모두 크롤 허용, 관리/개인/생성 경로만 차단 (테넌트 경로 포함). 사이트맵 명시.
  const disallow = [
    "/admin", "/super", "/dashboard", "/account", "/setup",
    "/*/admin", "/*/dashboard", "/*/board", "/*/polls", "/*/account", "/*/sign", "/*/invite",
    // 캠페인 랜딩 사본은 광고를 타고 들어오는 자리다. 검색에까지 올리면 본 랜딩과 같은 내용으로
    // 서로 순위를 갉아먹는다(중복 콘텐츠).
    "/l/", "/*/l/",
    "/*.csv$", "/*.ics$",
  ].map((p) => `Disallow: ${p}`).join("\n");
  return text(`User-agent: *\nAllow: /\n${disallow}\nSitemap: ${o}/sitemap.xml\n`);
}

// ================= 계약서 작성기 =================
//
// "직접 입력" 은 지금도 됐다 — 빈 textarea 에 붙여넣는 것이었다.
// 그런데 계약서에는 규칙이 있다(조·항·호·목적물 표시·말미 문구). 그 규칙을 아는 사람만
// 제대로 된 계약서를 쓸 수 있었고, 모르는 사람은 줄글을 넣고 줄글을 받았다.
//
// 여기서는 그 규칙을 **버튼이 대신 써 준다**. 저장되는 건 여전히 평문이라
// 해시·봉인·좌표계·증적이 전부 그대로다 — 자유 편집기(굵게·표·글꼴)를 넣지 않은 이유가 이것이다.
// 지면 줄바꿈이 흔들리면 그 위에 놓은 서명 자리가 어긋난다.
export async function adminDocumentWrite(ctx) {
  const { db, assoc, base, user, query, csrf } = ctx;
  const id = Number(query.get("doc") || 0);
  const doc = id ? await docOf(ctx, id) : null;
  if (id && (!doc || doc.association_id !== assoc.id)) return notFoundResponse(ctx);
  if (doc && !doc.draft) return redirect(`${base}/admin/documents/${doc.id}`);
  const members = await D.listSignerCandidates(db, assoc.id, assoc.kind);
  const memberChecks = members.length
    ? members.map((m) => `<label class="check member-check"><input type="checkbox" name="members" value="${m.id}" /> ${esc(m.name)} <small>${esc(m.email)}</small></label>`).join("")
    : `<p class="empty">사내 회원이 없습니다. 아래에서 <b>외부 상대방</b>으로 보내 주세요.</p>`;

  // 아직 채우지 않은 빈칸. 서명 자리를 놓기 **전에** 채워야 한다 — 글자 수가 달라지면
  // 지면 줄바꿈이 달라지고, 그 위에 놓은 서명 자리가 어긋난다.
  const blanks = doc ? extractVars(doc.body) : [];
  const blankPanel = blanks.length ? `<section class="panel wt-blanks"><h2 class="panel-title">빈칸 채우기 <span class="badge badge-wait">${blanks.length}개</span></h2>
      <p class="panel-hint">계약마다 달라지는 값입니다. <b>서명 자리를 놓기 전에</b> 채워 주세요 —
        글자 수가 달라지면 지면의 줄이 밀리고, 그 위에 놓아 둔 서명 자리가 어긋납니다.
        빈칸이 남아 있으면 계약서를 보낼 수 없습니다.</p>
      <form method="post" action="${base}/admin/documents/${doc.id}/fill" class="blank-grid">
        ${blanks.map((n) => `<label>${esc(n)}<input type="text" name="var_${esc(n)}" maxlength="200" autocomplete="off" /></label>`).join("")}
        <button class="btn btn-primary btn-sm">빈칸 채우기</button></form></section>` : "";

  // 서명 자리를 당사자별로 놓아 두었는가. 놓았다면 보내기 화면은 '누가 몇 번째 당사자인가' 를 묻는다.
  const slots = doc ? await D.usedSlots(db, doc.id) : [];
  const partyNames = doc ? await D.listDocParties(db, doc.id) : {};
  const fieldN = doc ? await D.countFields(db, doc.id) : 0;
  const memberOpts = members.map((m) => `<option value="${m.id}">${esc(m.name)}${m.email ? ` (${esc(m.email)})` : ""}</option>`).join("");
  const partyRows = slots.length
    ? Array.from({ length: Math.max(...slots) }, (_, i) => `<div class="wt-party">
        <div class="wt-party-no">${esc(D.partyLabel(partyNames, i + 1))}</div>
        <select name="party_${i}" data-party="${i}" required>
          <option value="">— 고르세요 —</option>${memberOpts}
          <option value="ext">외부 상대방 (회원이 아닌 사람)</option></select>
        <div class="wt-ext" data-ext="${i}" hidden>
          <input type="text" name="ext_name_${i}" maxlength="60" placeholder="이름" autocomplete="off" />
          <input type="text" name="ext_org_${i}" maxlength="80" placeholder="상호 (선택)" autocomplete="off" />
          <input type="email" name="ext_email_${i}" maxlength="120" placeholder="이메일" autocomplete="off" />
          <input type="tel" name="ext_phone_${i}" maxlength="20" placeholder="휴대폰" autocomplete="off" />
        </div></div>`).join("")
    : "";

  // 버튼 하나가 무엇을 써 넣는지. 규칙은 paper.js 의 조판이 읽는 것과 같아야 한다.
  const TOOLS = [
    ["article", "조", "제N조 (제목)", "조문을 시작합니다. 번호는 자동으로 붙습니다."],
    ["clause", "항", "① ② ③", "조문 아래 항입니다. 번호가 이어집니다."],
    ["item", "호", "1. 2. 3.", "항 아래 호입니다."],
    ["label", "표 줄", "소재지   서울…", "목적물 표시처럼 이름표와 값을 한 줄에."],
    ["para", "문단", "그냥 줄", "번호 없는 문단입니다."],
    ["closing", "말미", "본 계약을 증명하기…", "계약서 맨 끝의 문구와 서명란 안내입니다."],
    ["blank", "빈칸", "{{보증금}}", "계약마다 달라지는 값입니다. 아래에서 한꺼번에 채웁니다."],
  ];
  const toolBtns = TOOLS.map(([k, label, sample, hint]) =>
    `<button type="button" class="wt-btn" data-ins="${k}" title="${esc(hint)}"><b>${esc(label)}</b><span>${esc(sample)}</span></button>`).join("");

  const startBody = doc ? doc.body : "";
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><h1 class="dash-title">계약서 쓰기</h1>
      <p class="dash-sub"><a href="${base}/admin/documents">← 문서 목록</a>${doc ? ` · 작성 중 · 마지막 저장 ${esc(kstStamp(doc.created_at, { year: false }))}` : ""}</p></div>
      <div class="dash-head-actions"><span class="wt-saved" id="wtSaved" aria-live="polite"></span>
        <button type="button" class="btn btn-ghost btn-sm" id="wtSave">임시저장</button></div></div>
    ${flashOf(query)}
    <div class="write-grid">
      <div class="write-left">
        <label>제목<input type="text" id="wtTitle" maxlength="200" value="${esc(doc ? doc.title : "")}" placeholder="예: 상가건물 임대차계약서" autocomplete="off" /></label>
        <div class="wt-tools">${toolBtns}</div>
        <!-- 빈칸만 이름을 먼저 묻는다. 본문에 {{이름}} 을 넣고 그걸 고쳐 쓰게 하면,
             이어서 친 글자가 괄호 **안쪽**에 들어가 "{{보증금 원으로 한다.}}" 가 된다. -->
        <div class="wt-blankask" id="wtBlankAsk" hidden>
          <label>빈칸 이름<input type="text" id="wtBlankName" maxlength="30" placeholder="예: 보증금" autocomplete="off" /></label>
          <button type="button" class="btn btn-primary btn-sm" id="wtBlankAdd">넣기</button>
          <button type="button" class="btn btn-ghost btn-sm" id="wtBlankCancel">취소</button>
        </div>
        <p class="wt-hint">커서가 있는 자리에 넣습니다. <b>조</b>와 <b>항</b>은 앞의 번호를 보고 다음 번호를 스스로 붙입니다.</p>
        <label class="wt-bodylabel">본문<textarea id="wtBody" rows="24" spellcheck="false" placeholder="맨 윗줄에 계약서 이름을 쓰면 표제가 됩니다.&#10;예) 상가건물 임대차계약서">${esc(startBody)}</textarea></label>
        <p class="wt-count" id="wtCount"></p>
      </div>
      <div class="write-right">
        <div class="wt-previewhead"><b>지면 미리보기</b><span id="wtPages"></span></div>
        <div class="paper-wrap" id="wtPreview"></div>
        <p class="wt-hint">실제 계약서와 <b>같은 자리에서 줄이 끊깁니다</b> — 서명 자리는 이 지면 위에 놓입니다.</p>
        <!-- 링크는 늘 있고, 저장 전에만 숨긴다. 처음 저장한 순간 스크립트가 켠다 —
             화면을 새로 고쳐야만 나타나면 아무도 못 찾는다. -->
        <a class="btn btn-ghost btn-sm wt-fields" id="wtFields"
           href="${doc ? `${base}/admin/documents/${doc.id}/fields` : "#"}"${doc ? "" : " hidden"}>서명 자리 놓기${fieldN ? ` (${fieldN}칸)` : ""} →</a>
        <p class="wt-hint">${!doc ? "서명 자리는 <b>임시저장</b> 후에 놓을 수 있습니다."
          : blanks.length ? `아래 <b>빈칸 ${blanks.length}개</b>를 먼저 채우세요. 나중에 채우면 글자 수가 달라져 지면의 줄이 밀리고, 놓아 둔 서명 자리가 어긋납니다.`
          : "서명·도장·날짜 자리를 지면 위에 직접 놓습니다. <b>보내기 전에</b> 놓아 두면 각자 자기 자리만 채웁니다."}</p>
      </div>
    </div>
    ${blankPanel}
    <form method="post" action="${base}/admin/documents/${doc ? doc.id : 0}/publish" class="panel wt-send" id="wtSendForm">
      <h2 class="panel-title">보내기</h2>
      <p class="panel-hint">보내면 계약이 됩니다 — 서명 요청이 나가고, 계약당 과금이면 이때 한 번 청구됩니다.
        <b>보내기 전에는 몇 번을 고쳐도 아무 일도 일어나지 않습니다.</b></p>
      <div class="form-two"><label>서명 기한 (선택)<input type="date" name="due_date" /></label>
        <label class="check check-inline"><input type="checkbox" name="ordered" value="1" /> 순차 서명</label></div>
      ${slots.length ? `<div class="form-divider">당사자</div>
        <p class="panel-hint">서명 자리를 <b>${Math.max(...slots)}명 몫</b>으로 놓아 두었습니다. 그 자리가 각각 누구인지 정해 주세요.
          외부 상대방에게는 보내는 즉시 서명 링크가 나갑니다.</p>
        <div class="wt-parties">${partyRows}</div>`
      : `<div class="form-divider">서명 대상</div>
        <label class="check"><input type="radio" name="target" value="all" checked /> 전체 회원</label>
        <label class="check"><input type="radio" name="target" value="select" /> 특정 회원</label>
        <div class="member-picker">${memberChecks}</div>`}
      <button class="btn btn-primary" id="wtSend"${doc ? "" : " disabled"}>계약서 보내기</button>
      ${doc ? `<a class="btn btn-ghost btn-sm" href="${base}/admin/documents/${doc.id}/bulk">여러 명에게 한꺼번에 →</a>` : ""}
      ${doc ? `<button type="submit" class="btn btn-ghost btn-sm" formaction="${base}/admin/documents/${doc.id}/draft-delete" formnovalidate data-confirm="작성 중인 이 계약서를 지울까요? 되돌릴 수 없습니다.">초안 지우기</button>` : ""}
      ${doc ? "" : `<p class="panel-hint">먼저 <b>임시저장</b>을 눌러 주세요. 저장해야 보낼 수 있습니다.</p>`}
    </form>
    </div></section>`;
  return html(layout({ title: "계약서 쓰기", assoc, base, user, body, csrf,
    scripts: `<script src="${assetUrl("/js/write.js")}" defer></script>` }));
}

// ---------- 대량 발송 ----------
// 같은 계약서를 명단대로 각각 한 부씩. 여기서는 **아직 아무것도 나가지 않는다** —
// 명단을 읽고, 틀린 줄을 보여 주고, 누가 어느 자리에 앉는지만 정한다.
export async function adminDocBulk(ctx) {
  const { db, assoc, base, user, params, query, csrf } = ctx;
  const d = await docOf(ctx, params.id);
  if (!d || d.association_id !== assoc.id) return notFoundResponse(ctx);
  if (!d.draft) return redirect(`${base}/admin/documents/${d.id}`);
  const blanks = extractVars(d.body);
  const slots = await D.usedSlots(db, d.id);
  const partyNames = await D.listDocParties(db, d.id);
  const members = await D.listSignerCandidates(db, assoc.id, assoc.kind);
  const fieldN = await D.countFields(db, d.id);
  const memberOpts = members.map((m) => `<option value="${m.id}">${esc(m.name)}${m.email ? ` (${esc(m.email)})` : ""}</option>`).join("");
  const need = slots.length ? Math.max(...slots) : 0;

  // 당사자 자리가 있으면 '명단의 사람은 어느 자리인가' 를 반드시 정해야 한다.
  const partyRows = need
    ? Array.from({ length: need }, (_, i) => {
        const n = i + 1;
        return `<div class="wt-party bulk-party">
          <div class="wt-party-no">${esc(D.partyLabel(partyNames, n))}</div>
          <label class="check check-inline"><input type="radio" name="to_slot" value="${n}"${n === need ? " checked" : ""} /> 명단의 사람</label>
          <select name="party_${n}" data-fixed="${n}">
            <option value="">— 우리 쪽 사람 —</option>${memberOpts}
          </select></div>`;
      }).join("")
    : "";

  const blankList = blanks.length
    ? `<p class="panel-hint">이 계약서의 빈칸은 <b>${blanks.map((b) => esc(b)).join("</b> · <b>")}</b> 입니다.
       명단 머리글에 이 이름을 그대로 쓰면 사람마다 다른 값이 들어갑니다.</p>`
    : `<p class="panel-hint">이 계약서에는 사람마다 달라지는 빈칸이 없습니다 — 모두 같은 내용으로 나갑니다.</p>`;

  const batches = (await D.listBatches(db, assoc.id, 10, { assoc, user })).filter((b) => b.source_id === d.id);
  const history = batches.length
    ? `<section class="panel"><h2 class="panel-title">지난 명단</h2>
       <div class="table-scroll"><table class="admin-table"><thead><tr><th>이름</th><th>진행</th><th>만든 날</th><th></th></tr></thead><tbody>
       ${batches.map((b) => `<tr><td>${titleWithSlots(b.title)}</td>
         <td>${b.sent}/${b.total} 보냄${b.failed ? ` · <span class="txt-warn">실패 ${b.failed}</span>` : ""}</td>
         <td>${esc(kstStamp(b.created_at, { year: false }))}</td>
         <td><a class="btn btn-ghost btn-sm" href="${base}/admin/bulk/${b.id}">열기</a></td></tr>`).join("")}
       </tbody></table></div></section>`
    : "";

  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><h1 class="dash-title">여러 명에게 한꺼번에 보내기</h1>
      <p class="dash-sub"><a href="${base}/admin/documents/write?doc=${d.id}">← ${esc(d.title)}</a></p></div></div>
    ${flashOf(query)}
    ${fieldN ? "" : `<div class="flash flash-warn">서명 자리를 아직 놓지 않았습니다.
      <a href="${base}/admin/documents/${d.id}/fields">먼저 놓아 두시면</a> 받는 사람마다 자기 자리에서 바로 서명합니다.</div>`}
    <form method="post" action="${base}/admin/documents/${d.id}/bulk" enctype="multipart/form-data" class="panel bulk-form">
      <h2 class="panel-title">1. 명단</h2>
      ${blankList}
      <p class="panel-hint">첫 줄은 머리글입니다 — <b>이름 · 휴대폰 · 이메일 · 상호</b>${blanks.length ? ` · <b>${blanks.map((b) => esc(b)).join("</b> · <b>")}</b>` : ""}.
        휴대폰과 이메일은 <b>둘 중 하나만 있어도</b> 됩니다. 한 번에 ${BULK_MAX}명까지.</p>
      <p><a class="btn btn-ghost btn-sm" href="${base}/admin/documents/${d.id}/bulk/sample">명단 양식 내려받기 (CSV)</a></p>
      <label class="bulk-file">명단 파일 (CSV)<input type="file" name="roster" accept=".csv,text/csv,text/plain" /></label>
      <p class="panel-hint">엑셀의 기본 '.csv' 는 한글이 깨집니다 — <b>[다른 이름으로 저장 → CSV UTF-8]</b> 로 저장하시거나,
        엑셀에서 칸을 <b>복사해 아래에 붙여넣기</b> 하세요. 붙여넣기가 가장 확실합니다.</p>
      <label>붙여넣기<textarea name="paste" rows="8" spellcheck="false" placeholder="이름&#9;휴대폰&#9;이메일${blanks.length ? `&#9;${blanks.join("&#9;")}` : ""}&#10;홍길동&#9;010-1234-5678&#9;hong@example.com"></textarea></label>

      <h2 class="panel-title">2. 누가 어느 자리에 앉나</h2>
      ${need ? `<p class="panel-hint">서명 자리를 <b>${need}명 몫</b>으로 놓아 두었습니다.
          명단의 사람이 앉을 자리 하나를 고르고, 나머지 자리는 <b>모든 계약서에서 같은 사람</b>이 맡습니다.</p>
        <div class="wt-parties">${partyRows}</div>`
        : `<p class="panel-hint">당사자 자리를 나누지 않았습니다 — 명단의 사람이 그대로 서명자가 됩니다.</p>`}

      <h2 class="panel-title">3. 보내기 조건</h2>
      <div class="form-two">
        <label>계약서 제목<input type="text" name="title" maxlength="200" value="${esc(d.title)}" autocomplete="off" /></label>
        <label>서명 기한 (선택)<input type="date" name="due_date" /></label>
      </div>
      <p class="panel-hint">제목에 <b>{{이름}}</b> 또는 <b>{{상호}}</b> 를 쓰면 받는 사람마다 채워집니다 — 목록에서 구분하기 쉬워집니다.</p>
      ${need > 1 ? `<label class="check check-inline"><input type="checkbox" name="ordered" value="1" /> 순차 서명 (앞 사람이 서명해야 다음 사람 차례)</label>` : ""}
      <button class="btn btn-primary">명단 확인하기</button>
      <p class="panel-hint">여기서는 아직 아무것도 나가지 않습니다. 다음 화면에서 명단을 보고 보내기를 누릅니다.</p>
    </form>
    ${history}
    </div></section>`;
  return html(layout({ title: "여러 명에게 보내기", assoc, base, user, body, csrf,
    scripts: `<script src="${assetUrl("/js/bulk.js")}" defer></script>` }));
}

const BULK_ROW_LABEL = { pending: "대기", sent: "보냄", failed: "실패" };
// 010-1234-5678. 붙여 쓴 열한 자리는 눈으로 훑어 대조하기 어렵다.
const phoneText = (v) => String(v || "").replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
// 제목의 {{상호}} 는 사람마다 채워지는 자리다. 날것으로 두면 '고장난 화면' 으로 읽히므로
// 괄호를 벗기고 자리인 것이 보이게 칠한다.
const titleWithSlots = (t) =>
  esc(String(t || "")).replace(/\{\{([^}]+)\}\}/g, (_, n) => `<i class="bulk-slot">${n}</i>`);

// 명단 한 장 — 여기서 실제로 보낸다. 몇 명씩 나눠 보내므로 진행률이 함께 움직인다.
export async function adminBulkView(ctx) {
  const { db, assoc, base, user, params, query, csrf } = ctx;
  const b = await D.getBatch(db, Number(params.bid));
  if (!D.canSeeBatch(assoc, user, b)) return notFoundResponse(ctx);
  const rows = await D.listBatchRows(db, b.id);
  const c = await D.batchCounts(db, b.id);
  const src = await D.getDocument(db, b.source_id);
  const partyNames = src ? await D.listDocParties(db, b.source_id) : {};
  const done = c.sent + c.failed;
  const pct = c.total ? Math.round((done / c.total) * 100) : 0;
  const started = done > 0;

  const rowHtml = rows.map((r) => {
    const vars = (() => { try { return JSON.parse(r.vars || "{}"); } catch { return {}; } })();
    const varTxt = Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join(" · ");
    return `<tr data-row="${r.id}" class="bulk-row is-${esc(r.status)}">
      <td class="bulk-seq">${r.seq}</td>
      <td>${esc(r.name)}${r.org ? `<br /><small>${esc(r.org)}</small>` : ""}</td>
      <td class="bulk-to"><small>${esc(phoneText(r.phone) || r.email || "—")}</small></td>
      <td><small>${esc(varTxt)}</small></td>
      <td class="bulk-stat"><span class="badge badge-${r.status === "sent" ? "ok" : r.status === "failed" ? "no" : "wait"}">${BULK_ROW_LABEL[r.status] || r.status}</span></td>
      <td class="bulk-note"><small>${esc(r.note)}</small>${r.document_id ? `<a href="${base}/admin/documents/${r.document_id}">계약서 열기 →</a>` : ""}</td>
    </tr>`;
  }).join("");

  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><h1 class="dash-title">${titleWithSlots(b.title)}</h1>
      <p class="dash-sub"><a href="${base}/admin/documents">← 문서 목록</a> · 명단 ${c.total}명${b.due_date ? ` · 기한 ${esc(b.due_date)}` : ""}${b.ordered ? " · 순차 서명" : ""}</p></div></div>
    ${flashOf(query)}
    ${src ? "" : `<div class="flash flash-warn">원본 계약서(초안)가 지워졌습니다. 남은 사람에게는 보낼 수 없습니다.</div>`}
    <section class="panel bulk-run" id="bulkRun"
      data-run="${base}/admin/bulk/${b.id}/run" data-csrf="${esc(csrf)}" data-chunk="${BULK_CHUNK}">
      <h2 class="panel-title">보내기</h2>
      <div class="bulk-bar"><i style="width:${pct}%"></i></div>
      <p class="bulk-count" id="bulkCount" aria-live="polite">
        보냄 <b>${c.sent}</b> · 실패 <b>${c.failed}</b> · 남음 <b>${c.pending}</b> / 전체 ${c.total}</p>
      ${c.pending && src ? `<button class="btn btn-primary" id="bulkGo">${started ? "이어서 보내기" : `${c.pending}명에게 보내기`}</button>
        <p class="panel-hint">한 번에 ${BULK_CHUNK}명씩 보냅니다 — 창을 열어 두시면 끝까지 이어집니다.
          중간에 닫아도 <b>보낸 사람에게 다시 가지 않습니다.</b> 다시 들어와 이어서 보내세요.</p>`
        : c.pending ? "" : `<p class="panel-hint">이 명단은 다 보냈습니다.</p>`}
      <p class="bulk-msg" id="bulkMsg" role="status"></p>
    </section>
    <section class="panel">
      <h2 class="panel-title">명단</h2>
      ${b.slot ? `<p class="panel-hint">명단의 사람은 <b>${esc(D.partyLabel(partyNames, b.slot))}</b> 자리에 앉습니다.</p>` : ""}
      <div class="table-scroll"><table class="admin-table bulk-table"><thead><tr>
        <th>줄</th><th>이름</th><th>연락처</th><th>빈칸</th><th>상태</th><th>비고</th></tr></thead>
        <tbody id="bulkRows">${rowHtml}</tbody></table></div>
    </section>
    <form method="post" action="${base}/admin/bulk/${b.id}/delete">
      <button class="btn btn-ghost btn-sm" data-confirm="이 명단을 목록에서 지울까요? 이미 보낸 계약서는 그대로 남습니다.">명단 지우기</button>
    </form>
    </div></section>`;
  // 브라우저 탭 제목에는 {{ }} 를 벗겨서 — 탭 이름에 괄호가 박히면 무엇인지 알 수 없다
  return html(layout({ title: b.title.replace(/\{\{([^}]+)\}\}/g, "$1"), assoc, base, user, body, csrf,
    scripts: `<script src="${assetUrl("/js/bulk.js")}" defer></script>` }));
}
