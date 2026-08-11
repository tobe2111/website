// 공개/인증 페이지 핸들러 (async). ctx = { env, db, assoc, base, user, url, query, csrf, params }
import * as D from "./db.js";
import { esc, clip, openBadge, openNow, fmtBytes, kstStamp, kstDate, prettyPath } from "./util.js";
import { layout, flash, statusBadge, pager, mediaUrl, STOREFRONT_SVG, ORIGIN, assetUrl } from "./render.js";
import { verifyInviteToken, SALES_STAGES, otpRequired } from "./api.js"; // 초대 링크 검증 (api ↔ pages 순환 없음: api 는 pages 를 임포트하지 않음)
import { html, notFoundResponse, back } from "./http.js";
import { galleryItem } from "./media-render.js";
import { priceOf, costOf, jeonToWon, notifyEnabled, TEMPLATE_KEYS } from "./notify.js";
import { providerLabel } from "./embed.js";
import { verifySignature, publicKeyJwk, publicKeyFingerprint, keyStorage, algorithm, verifyChain, verifyAnchor } from "./esign.js";
import { renderPaper, fieldBox, FIELD_KINDS, paginate } from "./paper.js";
import { text } from "./http.js";
import { parseLayout, renderHome, SECTION_CATALOG } from "./homeLayout.js";
import { turnstileWidget, turnstileScript } from "./turnstile.js";
import { otpauthUri } from "./totp.js";
import { PLANS, PLAN_KEYS } from "./plans.js";
import { emailEnabled as emailOn } from "./email.js";

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
// 관리자 사이드바 아이콘 (18px 라인)
const _si = (inner) => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const SIDE_SVG = {
  stats: _si('<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>'),
  bell: _si('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>'),
  users: _si('<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M21 20c0-2.6-1.6-4.8-4-5.7"/>'),
  store: _si('<path d="M4 9l1.2-4.2A1 1 0 0 1 6.2 4h11.6a1 1 0 0 1 1 .8L20 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M9 20v-5h6v5"/>'),
  tag: _si('<path d="M20.6 13.4 12 22 2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.4"/>'),
  home: _si('<path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
  palette: _si('<path d="M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-1.5 3.3c.6.7.2 2.7-2.5 2.7z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/>'),
  mega: _si('<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M14 8a4 4 0 0 1 0 8M17 5a8 8 0 0 1 0 14"/>'),
  sign: _si('<path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17l-1 3z"/><path d="M14.5 6.5l3 3"/>'),
  ext: _si('<path d="M14 4h6v6M20 4l-9 9"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/>'),
};
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
// 업체 카드 (시안: 영업중 dot pill 좌상단 · 본문 = 카테고리 라벨/이름/한 줄 메타)
function businessCard(base, b, cover) {
  const thumb = cover
    ? `<img src="${esc(mediaUrl(cover.thumb || cover.filename))}" alt="" loading="lazy" />`
    : `<span class="thumb-ico" aria-hidden="true">${catIcon(b.category)}</span>`;
  const open = bizStatusBadge(b);
  const meta = [b.address, b.hours].filter(Boolean).join(" · ");
  return `<article class="market-card" data-slug="${esc(b.slug)}">
    <button type="button" class="fav-btn" data-fav="${esc(b.slug)}" aria-label="찜하기" hidden>♥</button>
    <a href="${base}/business/${esc(b.slug)}" class="market-thumb${cover ? " has-img" : ""}">
      ${thumb}
      ${open ? `<span class="market-open">${open}</span>` : ""}
    </a>
    <div class="market-body">
      <span class="mc-cat">${esc(b.category)}</span>
      <h3><a href="${base}/business/${esc(b.slug)}">${esc(b.name)}</a></h3>
      ${meta ? `<p class="mc-meta">${PIN_SVG}<span>${esc(meta)}</span></p>` : ""}
    </div></article>`;
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

export async function home(ctx) {
  const { db, assoc, base, user, csrf } = ctx;
  const lay = parseLayout(assoc.home_layout, assoc.name);
  // 독립 쿼리는 병렬로 — D1 은 쿼리마다 네트워크 왕복이라 직렬 대기가 TTFB 로 직결됨
  const [{ items }, notices, events, stats, cats, names, recentUpdates] = await Promise.all([
    D.listBusinessesPaged(db, assoc.id, { perPage: 8 }), // 4열 그리드에 맞춰 2줄이 꽉 차게 (6개는 마지막 줄이 비어 보임)
    D.listNotices(db, assoc.id, 5),
    D.listEvents(db, assoc.id, true),
    D.stats(db, assoc.id),
    D.distinctCategories(db, assoc.id),
    D.listBusinessNames(db, assoc.id),
    D.listAssocUpdates(db, assoc.id, 6),
  ]);
  const covers = await D.coverImagesFor(db, items.map((b) => b.id));
  const businessesHtml = items.map((b) => businessCard(base, b, covers.get(b.id))).join("");
  const catTiles = cats.length ? `<div class="cat-grid">${cats.map((c) => `<a class="cat-tile" href="${base}/businesses?category=${encodeURIComponent(c.category)}"><span class="cat-ico">${catIcon(c.category)}</span><span class="cat-name">${esc(c.category)}</span></a>`).join("")}<a class="cat-tile cat-all" href="${base}/businesses"><span class="cat-ico">${catIcon("전체")}</span><span class="cat-name">전체보기</span></a></div>` : "";
  const eventsHtml = events.map((e) => eventCard(base, e)).join("");
  const body = renderHome(lay, {
    assoc, base, stats, businessesHtml, catTiles, eventsHtml, loggedIn: !!user,
    heroImage: assoc.hero_image ? mediaUrl(assoc.hero_image) : "",
    noticesHtml: notices.length ? noticeRows(base, notices) : "",
    counts: { businesses: items.length, notices: notices.length, events: events.length },
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
  return html(layout({ title: "", assoc, base, user, body, activeNav: `${base}/`, csrf, description: assoc.tagline, jsonLd: [orgLd, siteLd],
    scripts: names.length ? `<script src="${assetUrl("/js/suggest.js")}" defer></script>` : "" }));
}

function layoutEditor(base, layoutArr) {
  const rows = layoutArr.map((sec, i) => {
    const cat = SECTION_CATALOG[sec.type];
    const fields = cat.fields.map((f) => {
      const val = sec[f.key], name = `f_${i}_${f.key}`;
      if (f.type === "bool") return `<label class="check"><input type="checkbox" name="${name}" value="1"${val ? " checked" : ""} /> ${esc(f.label)}</label>`;
      if (f.type === "textarea") return `<label class="mini-label">${esc(f.label)}<textarea name="${name}" rows="2">${esc(val || "")}</textarea></label>`;
      if (f.type === "select") {
        const cur = val || (f.options[0] && f.options[0][0]);
        return `<label class="mini-label">${esc(f.label)}<select name="${name}">${f.options.map(([ov, ol]) => `<option value="${esc(ov)}"${cur === ov ? " selected" : ""}>${esc(ol)}</option>`).join("")}</select></label>`;
      }
      return `<label class="mini-label">${esc(f.label)}<input type="text" name="${name}" value="${esc(val || "")}" /></label>`;
    }).join("");
    return `<div class="layout-row" data-index="${i}"><div class="layout-row-head">
      <div class="row-toggle"><label class="switch"><input type="checkbox" name="en_${i}" value="1"${sec.enabled ? " checked" : ""} /><span class="track"></span></label> <strong>${esc(cat.label)}</strong></div>
      <input type="hidden" name="ty_${i}" value="${esc(sec.type)}" />
      <span class="layout-move"><button type="button" class="move-btn" data-dir="up" aria-label="위로">▲</button><button type="button" class="move-btn" data-dir="down" aria-label="아래로">▼</button></span>
    </div><div class="layout-fields">${fields}</div></div>`;
  }).join("");
  return `<form method="post" action="${base}/admin/layout" class="layout-editor" id="layoutEditor">
    <input type="hidden" name="order" id="layoutOrder" value="${layoutArr.map((_, i) => i).join(",")}" />
    <div id="layoutRows">${rows}</div>
    <div class="layout-actions"><button type="submit" class="btn btn-primary btn-sm">홈페이지 구성 저장</button>
      <button type="submit" formaction="${base}/admin/layout/reset" class="btn btn-ghost btn-sm" data-confirm="기본 구성으로 되돌릴까요?">기본 구성으로 초기화</button></div></form>`;
}

export async function businesses(ctx) {
  const { db, assoc, base, user, query, csrf } = ctx;
  const cat = query.get("category"), q = (query.get("q") || "").trim().slice(0, 60);
  const openOnly = query.get("open") === "1";
  const page = parseInt(query.get("page") || "1", 10) || 1;
  // "지금 영업중" 필터: 영업시간 문자열 기반이라 서버에서 계산 — 페이지네이션 대신 넉넉히 가져와 거른다
  let { items, total, page: cur, pages } = await D.listBusinessesPaged(db, assoc.id, { category: cat, q, page: openOnly ? 1 : page, perPage: openOnly ? 1000 : 12 }); // open 필터는 서버 계산이라 넉넉히 (1000곳 초과 상권은 현실적으로 없음)
  if (openOnly) { items = items.filter((b) => openNow(b.hours) === true && !D.isDayOff(b)); total = items.length; cur = 1; pages = 1; }
  const cats = await D.distinctCategories(db, assoc.id);
  const chips = `<a href="${base}/businesses${qs({ q })}" class="chip-filter${!cat && !openOnly ? " active" : ""}">전체</a>` +
    `<a href="${base}/businesses${qs({ q, open: "1" })}" class="chip-filter chip-open${openOnly ? " active" : ""}">● 지금 영업중</a>` +
    `<button type="button" class="chip-filter chip-fav" id="favFilter" hidden>❤ 찜한 가게</button>` +
    cats.map((c) => `<a href="${base}/businesses${qs({ category: c.category, q })}" class="chip-filter${cat === c.category ? " active" : ""}">${esc(c.category)} <em>${c.n}</em></a>`).join("");
  const covers = await D.coverImagesFor(db, items.map((b) => b.id));
  const cards = items.map((b) => businessCard(base, b, covers.get(b.id))).join("") || `<p class="empty">${openOnly ? "지금 영업 중인 가게가 없습니다." : q ? "검색 결과가 없습니다." : "등록된 점포가 없습니다."}</p>`;
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><p class="section-eyebrow">MEMBERS</p><h2 class="section-title">가입 점포 안내</h2><p class="section-lead">총 ${total}곳</p></div>
    <form method="get" action="${base}/businesses" class="board-search"><input type="search" name="q" value="${esc(q)}" placeholder="점포·업종 검색" /><button class="btn btn-ghost btn-sm">검색</button></form>
    <div class="chip-filters">${chips}</div>
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
  const body = `
  <section class="biz-hero"><div class="container biz-hero-inner">${pending}
    <div class="biz-hero-lead">
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
  const { env, query, csrf } = ctx;
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    ${authHead("로그인", "상인회 회원·관리자 로그인")}
    ${flash(query.get("msg") || "", query.get("err") ? "err" : "ok")}
    <form method="post" action="/login" class="stack-form">
      <label>이메일<input type="email" name="email" required autocomplete="email" /></label>
      <label>비밀번호<input type="password" name="password" required autocomplete="current-password" /></label>
      <label class="totp-login">2단계 인증 코드 <small>(설정한 경우만)</small><input type="text" name="totp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" placeholder="000000" /></label>
      ${turnstileWidget(env)}
      <button class="btn btn-primary btn-block">로그인</button>
    </form>
    <p class="auth-note"><a href="/forgot">비밀번호를 잊으셨나요?</a></p></div></div></section>`;
  return html(layout({ title: "로그인", assoc: ctx.assoc, base: ctx.base, body, csrf, scripts: turnstileScript(env) }));
}

const flashOf = (q) => flash(q.get("msg") || "", q.get("err") ? "err" : "ok"); // get() 이 이미 디코드 — 이중 디코드는 %25 등에서 URIError
// 디자인 v2: 인증 카드 브랜드 아이콘 헤더
const authHead = (title, sub) => `<div class="auth-head"><span class="mark auth-mark">${STOREFRONT_SVG}</span><h1 class="auth-title">${esc(title)}</h1><p class="auth-sub">${esc(sub)}</p></div>`;

// ================= 점포 지도 =================
export async function mapPage(ctx) {
  const { db, env, assoc, base, user, query, csrf } = ctx;
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
    <div class="section-head"><p class="section-eyebrow">MAP</p><h2 class="section-title">가입 점포 지도</h2><p class="section-lead">${esc(assoc.name)} 가입 점포 ${markers.length}곳</p></div>
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
    <div class="section-head"><p class="section-eyebrow">NOTICE</p><h2 class="section-title">공지사항</h2><p class="section-lead">총 ${total}</p></div>
    <form method="get" action="${base}/notices" class="board-search">${tag ? `<input type="hidden" name="tag" value="${esc(tag)}">` : ""}<input type="search" name="q" value="${esc(q)}" placeholder="제목·내용 검색"><button class="btn btn-ghost btn-sm">검색</button></form>
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
    <div class="section-head"><p class="section-eyebrow">EVENTS</p><h2 class="section-title">행사·소식</h2>
      ${isMember ? `<p class="section-lead">회원은 행사별로 참가 신청을 할 수 있습니다. 명단은 관리자에게 전달됩니다.</p>` : ""}</div>
    ${flashOf(query)}
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
    <div class="section-head"><p class="section-eyebrow">VOTE</p><h2 class="section-title">안건 투표</h2>
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
    return `<li class="board-row${p.pinned ? " pinned" : ""}">${p.pinned ? `<span class="board-pin">📌</span>` : ""}
      ${thumb ? `<a href="${base}/board/${p.id}" class="board-thumb"><img src="${esc(mediaUrl(thumb))}" alt="" loading="lazy" /></a>` : ""}
      <a href="${base}/board/${p.id}" class="board-title">${esc(p.title)}${cnt ? ` <span class="board-clip">📎${cnt > 1 ? cnt : ""}</span>` : ""}</a>
      <span class="board-meta">${esc(p.author_name || "(탈퇴)")} · ${esc(kstDate(p.created_at, "."))}${p.comment_count ? ` · 💬 ${p.comment_count}` : ""}</span></li>`;
  }).join("") : `<li class="empty">${q ? "검색 결과가 없습니다." : "아직 게시글이 없습니다."}</li>`;
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><p class="section-eyebrow">BOARD</p><h2 class="section-title">회원 게시판</h2><p class="section-lead">글 ${total}</p></div>
    ${flashOf(query)}
    <form method="get" action="${base}/board" class="board-search"><input type="search" name="q" value="${esc(q)}" placeholder="제목·내용 검색"><button class="btn btn-ghost btn-sm">검색</button></form>
    <section class="panel"><h2 class="panel-title">새 글 쓰기</h2>
      <form method="post" action="${base}/board" class="stack-form compact" enctype="multipart/form-data">
        <input type="text" name="title" placeholder="제목" required maxlength="200" />
        <textarea name="body" rows="4" placeholder="내용" required></textarea>
        <label class="file-inline">📷 사진 첨부 (선택, 최대 6장)<input type="file" name="images" accept="image/*" multiple /></label>
        <button class="btn btn-primary btn-sm">등록</button></form></section>
    <ul class="board-list">${rows}</ul>
    ${pager((i) => `${base}/board${qs({ q, page: i })}`, cur, pages)}</div></section>`;
  return html(layout({ title: "회원 게시판", assoc, base, user, body, activeNav: `${base}/board`, csrf, scripts: `<script src="${assetUrl("/js/upload-resize.js")}" defer></script>` }));
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
      <label class="file-inline">📷 사진 추가 (총 6장까지)<input type="file" name="images" accept="image/*" multiple /></label>
      <div class="post-actions"><button class="btn btn-primary">저장</button><a href="${base}/board/${p.id}" class="btn btn-ghost">취소</a></div>
    </form></div></section>`;
  return html(layout({ title: "글 수정", assoc, base, user, body, activeNav: `${base}/board`, csrf, scripts: `<script src="${assetUrl("/js/upload-resize.js")}" defer></script>` }));
}

// ================= 회원가입 =================
export function registerForm(ctx) {
  const { env, assoc, base, query, csrf } = ctx;
  const opts = CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    ${authHead(assoc.name + " 가입", "점포 정보를 등록하고 사진·소식을 공유하세요.")}${flashOf(query)}
    <form method="post" action="${base}/register" class="stack-form">
      <label>대표자 성함<input type="text" name="name" required maxlength="60" /></label>
      <label>휴대폰 <small>(선택 · 서명 요청·공지를 카카오 알림톡으로 받습니다)</small><input type="tel" name="phone" maxlength="13" inputmode="numeric" placeholder="010-1234-5678" autocomplete="tel" /></label>
      <label>이메일<input type="email" name="email" required autocomplete="email" /></label>
      <label>비밀번호 (8자 이상)<input type="password" name="password" required minlength="8" autocomplete="new-password" /></label>
      <label>점포명<input type="text" name="business_name" required maxlength="100" /></label>
      <label>업종<select name="category">${opts}</select></label>
      <label class="check"><input type="checkbox" name="agree" value="1" required /> <a href="/privacy" target="_blank">개인정보 수집·이용</a>에 동의합니다.</label>
      ${turnstileWidget(env)}
      <button class="btn btn-primary btn-block">가입 신청</button>
    </form><p class="auth-note">가입 후 관리자 승인 시 일반에 공개됩니다.</p></div></div></section>`;
  return html(layout({ title: "가입", assoc, base, body, csrf, scripts: turnstileScript(env) }));
}

// ================= 초대 링크 가입 (관리자가 가게 정보를 미리 채움) =================
export async function invitePage(ctx) {
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
    <div class="section-head"><p class="section-eyebrow">PARTNER</p><h2 class="section-title">유어딜로 매출 만들기</h2>
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
    <p class="panel-hint" style="text-align:center">등록 문의: <a href="${base}/contact">상인회 문의하기</a> 또는 유어딜에서 직접 신청</p>
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
              <label>이름<input name="name" value="${esc(p.name)}" required></label>
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
      <label class="file-drop"><input type="file" name="image" accept="image/*" /><span class="file-drop-text">📷 제품 사진 (선택·최대 8MB)</span></label>
      <div class="form-two"><label>제품 이름<input name="name" required /></label><label>가격 <small>(선택)</small><input name="price" placeholder="예: 8,000원 · 시가 · 미표기" /></label></div>
      <label>한 줄 설명 <small>(선택)</small><input name="description" maxlength="300" /></label>
      <button class="btn btn-primary btn-sm">제품 추가</button></form></section>
    <section class="panel" id="d-updates"><h2 class="panel-title">가게 소식 <span class="badge badge-muted">${updates.length}</span></h2>
      <p class="panel-hint">"오늘 딸기 들어왔어요" 같은 한 줄 소식을 올리면 <strong>가게 페이지와 상인회 홈 첫 화면</strong>에 바로 노출됩니다. 자주 올릴수록 손님이 자주 봅니다.</p>
      <form method="post" action="${base}/dashboard/updates" enctype="multipart/form-data" class="stack-form compact">
        <label>오늘의 소식<input name="body" required maxlength="300" placeholder="예: 오늘 생딸기 크레페 한정 20개!" /></label>
        <label class="file-inline">📷 사진 1장 (선택)<input type="file" name="image" accept="image/*" /></label>
        <button class="btn btn-primary btn-sm">소식 올리기</button></form>
      ${updates.length ? `<ul class="update-feed compact">${updates.map((u) => `<li class="update-item">
        ${u.image ? `<img class="update-img" src="${esc(mediaUrl(u.image))}" alt="" loading="lazy" />` : ""}
        <div class="update-body"><p>${esc(u.body)}</p><time>${esc(kstDate(u.created_at, "."))}</time></div>
        <form method="post" action="${base}/dashboard/updates/${u.id}/delete" data-confirm="이 소식을 삭제할까요?"><button class="link-danger">삭제</button></form></li>`).join("")}</ul>` : ""}</section>
    <section class="panel" id="d-coupons"><h2 class="panel-title">쿠폰·혜택 <span class="badge badge-muted">${coupons.length}/5</span></h2>
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
        <button class="btn btn-primary btn-sm">쿠폰 등록</button></form></section>
    <section class="panel urdeal-promo">
      <span class="up-badge">운영사 서비스</span>
      <h2 class="panel-title">이용권·동네딜을 온라인으로 팔고 싶다면</h2>
      <p class="panel-hint">이곳의 쿠폰은 보여주기 혜택(결제 없음)입니다. 할인 이용권·기프티콘 교환권을 <strong>실제로 판매</strong>하려면 운영사의 커머스 <strong>유어딜</strong>과 함께하세요.</p>
      <span class="pill-row"><a class="btn btn-primary btn-sm" href="${base}/urdeal">연동 방법 보기</a>
      <a class="btn btn-ghost btn-sm" href="https://live.ur-team.com/" target="_blank" rel="noopener">유어딜 바로가기 →</a></span></section>
    <section class="panel"><h2 class="panel-title">가게 QR 코드</h2>
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
  const mSteps = [
    { done: !!(b.description || "").trim(), label: "가게 소개 쓰기", href: "#d-info" },
    { done: imgCount >= 3, label: `가게 사진 3장 올리기 (${Math.min(imgCount, 3)}/3)`, href: "#d-media" },
    { done: products.length >= 1, label: "제품·메뉴 1개 올리기", href: "#d-products" },
    { done: b.lat != null && b.lng != null, label: "지도에 위치 찍기", href: "#d-info" },
  ];
  const mRemain = mSteps.filter((x) => !x.done).length;
  const merchantOnboard = mRemain ? `<section class="panel onboard"><div class="panel-head"><h2 class="panel-title">우리 가게 채우기 <span class="badge badge-wait">${mSteps.length - mRemain}/${mSteps.length}</span></h2></div>
    <p class="panel-hint">4가지만 채우면 손님이 보는 가게 페이지가 완성됩니다.</p>
    <ul class="onboard-list">${mSteps.map((x) => `<li class="${x.done ? "done" : ""}"><span class="ob-check">${x.done ? "✓" : ""}</span><a href="${x.href}">${x.label}</a></li>`).join("")}</ul></section>` : "";
  const approveBanner = b.status === "approved" ? `<div class="approve-banner" data-dismiss-key="approved-${b.id}" hidden>
    <span class="ab-emoji" aria-hidden="true">🎉</span>
    <div class="ab-text"><strong>가게가 공개되었습니다!</strong><p>아래 QR을 인쇄해 계산대에 붙이고, 가게 페이지의 공유 버튼으로 카톡방에 알려보세요.</p></div>
    <span class="ab-actions"><a class="btn btn-sm btn-primary" href="${base}/business/${esc(b.slug)}" target="_blank">내 가게 보기</a><button type="button" class="btn btn-sm btn-ghost" data-dismiss>닫기</button></span>
  </div>` : "";
  const opts = CATEGORIES.map((c) => `<option value="${esc(c)}"${c === b.category ? " selected" : ""}>${esc(c)}</option>`).join("");
  const grid = media.length ? media.map((m) => `<figure class="media-tile">${galleryItem(m, { showCaption: false })}<figcaption>
      <span class="media-kind">${m.kind === "image" ? "🖼 사진" : (m.kind === "embed" ? "🎬 " + esc(providerLabel(m.provider)) : "🎬 영상")}</span>
      <form method="post" action="${base}/dashboard/media/${m.id}/delete" data-confirm="삭제?"><button class="link-danger">삭제</button></form></figcaption></figure>`).join("") : `<p class="empty">아직 등록한 사진·영상이 없습니다.</p>`;
  const naver = assoc.map_client_id || env.NAVER_MAP_CLIENT_ID; // 상인회 전용 지도 키 우선
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">MY BUSINESS</p><h1 class="dash-title">${esc(b.name)} ${statusBadge(b.status)}</h1>
      <p class="dash-sub">공개 주소: <a href="${base}/business/${esc(b.slug)}" target="_blank">${esc(prettyPath(base))}/business/${esc(b.slug)}</a></p></div>
      <div class="dash-head-actions">
        <form method="post" action="${base}/dashboard/dayoff" class="inline-form">
          <button class="btn btn-sm ${dayOff ? "btn-primary" : "btn-ghost"}" title="가게 카드에 '오늘 휴무'로 표시됩니다. 내일 자동 해제.">${dayOff ? "🚫 오늘 휴무 중 (해제)" : "오늘 임시휴무"}</button></form>
        <a href="${base}/sign" class="btn btn-ghost btn-sm">전자서명</a></div></div>
    ${flashOf(query)}
    ${approveBanner}
    ${merchantOnboard}
    <div class="dash-grid">
      <section class="panel" id="d-info"><h2 class="panel-title">업체 정보</h2>
        <form method="post" action="${base}/dashboard/business" class="stack-form">
          <label>업체명<input type="text" name="name" value="${esc(b.name)}" required /></label>
          <label>업종<select name="category">${opts}</select></label>
          <label>소개<textarea name="description" rows="4">${esc(b.description)}</textarea></label>
          <div class="form-two"><label>전화<input type="tel" name="phone" value="${esc(b.phone)}" /></label><label>영업시간<input type="text" name="hours" value="${esc(b.hours)}" /></label></div>
          <label>주소<input type="text" name="address" value="${esc(b.address)}" /></label>
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
          <button class="btn btn-primary">정보 저장</button></form></section>
      <section class="panel" id="d-media"><h2 class="panel-title">사진 업로드</h2>
        <form method="post" action="${base}/dashboard/media" enctype="multipart/form-data" class="upload-form">
          <label class="file-drop"><input type="file" name="files" accept="image/*" multiple /><span class="file-drop-text">📁 사진 선택 (최대 8MB)</span></label>
          <input type="text" name="caption" placeholder="설명 (선택)" class="caption-input" />
          <button class="btn btn-primary btn-block">업로드</button></form>
        <h3 class="panel-subtitle">🎬 영상 링크 추가</h3>
        <p class="panel-hint">유튜브·쇼츠·인스타 릴스·네이버TV 주소를 붙여넣으세요. <small>단축 주소(naver.me/…)는 안 됩니다 — 영상을 열어 주소창의 원래 주소를 복사해 주세요.</small></p>
        <form method="post" action="${base}/dashboard/media/embed" class="stack-form compact">
          <input type="url" name="url" placeholder="영상 주소(링크)" required /><input type="text" name="caption" placeholder="설명 (선택)" maxlength="200" />
          <button class="btn btn-primary btn-sm">영상 링크 추가</button></form>
        <h3 class="panel-subtitle">등록된 미디어 (${media.length})</h3><div class="media-grid">${grid}</div></section>
    </div>
    ${productPanel}
    </div></section>`;
  const picker = naver ? `<script src="https://oapi.map.naver.com/openapi/v3/maps.js?${esc(env.NAVER_MAP_PARAM || "ncpClientId")}=${esc(naver)}&submodules=geocoder"></script><script src="${assetUrl("/js/map.js")}" defer></script>` : "";
  return html(layout({ title: "내 업체 관리", assoc, base, user, body, csrf, scripts: `<script src="${assetUrl("/js/viewer.js")}" defer></script><script src="${assetUrl("/js/upload-resize.js")}" defer></script><script src="${assetUrl("/js/qr.js")}" defer></script><script src="${assetUrl("/js/qr-widget.js")}" defer></script>${picker}` }));
}

const docBody = (b) => esc(b).replace(/\n/g, "<br />");
// CSV 셀: 따옴표 이스케이프 + 수식 인젝션 방지(= + - @ 로 시작하면 \' 접두)
const csvCell = (v) => {
  let s = String(v == null ? "" : v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ================= 관리자 =================
export async function admin(ctx) {
  const { db, assoc, base, user, query, csrf } = ctx;
  // 독립 쿼리 병렬화 — D1 은 쿼리마다 왕복이라 직렬 대기가 관리자 TTFB 의 주범이었음
  const duePeriod0 = /^\d{4}-\d{2}$/.test(query.get("due_period") || "") ? query.get("due_period") : D.kstToday().slice(0, 7);
  const [s, all, notices, events, members, admins, notifs, unread, auditLog, met, assocProducts, allRsvps, dueRowsRaw] = await Promise.all([
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
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const lay = parseLayout(assoc.home_layout, assoc.name);
  // 핵심 가설 계측: "회원이 스스로 채운다"가 성립하는가. 셀프 등록률 30% 이상이면 성립 신호.
  const selfOk = met.total >= 5 && met.selfRate >= 30;
  const metricsPanel = `<section class="panel panel-accent"><div class="panel-head"><h2 class="panel-title">참여 계측 <span class="badge badge-brand">핵심 지표</span></h2>
      <span class="badge ${met.total < 5 ? "badge-neutral" : selfOk ? "badge-ok" : "badge-wait"}">${met.total < 5 ? "표본 부족" : selfOk ? "가설 성립 신호" : "관찰 중"}</span></div>
    <p class="panel-hint">사장님이 직접 채우는 살아있는 홈인지 재는 세 숫자입니다. 표본 ${met.total}곳 기준.</p>
    <div class="stat-cards">
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">셀프 등록률</span></div><span class="stat-num">${met.selfRate}%</span><div class="stat-delta ${met.selfRate >= 30 ? "up" : "mut"}">직접 ${met.selfCnt} · 대행 ${met.proxyCnt}</div></div>
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">정보 채움률</span></div><span class="stat-num">${met.filledRate}%</span><div class="stat-delta mut">소개·사진 있는 업체 ${met.filledCnt}곳</div></div>
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">최근 30일 갱신률</span></div><span class="stat-num">${met.refreshRate}%</span><div class="stat-delta mut">갱신 ${met.refreshedCnt}곳</div></div></div>
    <p class="panel-hint" style="margin-top:14px">판정 기준: 셀프 등록률 <strong>30%↑</strong> 이면 "회원이 채우는 서비스" 성립 → 확장 단계. 못 넘으면 "관리자가 쉽게 채우는 도구"로 포지셔닝.</p></section>`;
  const productModPanel = assocProducts.length ? `<section class="panel"><h2 class="panel-title">제품 진열 관리 <span class="badge badge-muted">${assocProducts.length}</span></h2>
    <p class="panel-hint">부적절한 제품은 숨길 수 있습니다. (사장님 화면에는 '관리자 숨김'으로 표시됩니다)</p>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>제품</th><th>점포</th><th>상태</th><th>처리</th></tr></thead><tbody>
    ${assocProducts.map((p) => `<tr><td>${esc(p.name)}${p.price ? `<br /><small>${esc(p.price)}</small>` : ""}</td>
      <td><a href="${base}/business/${esc(p.biz_slug)}" target="_blank">${esc(p.biz_name)}</a></td>
      <td>${p.hidden ? '<span class="badge badge-neutral">숨김</span>' : (p.sold_out ? '<span class="badge badge-no">품절</span>' : '<span class="badge badge-ok">노출</span>')}</td>
      <td class="actions-cell"><form method="post" action="${base}/admin/product/${p.id}/hide"><button class="btn btn-xs btn-ghost">${p.hidden ? "다시 노출" : "숨기기"}</button></form></td></tr>`).join("")}
    </tbody></table></div></section>` : "";
  const auditPanel = `<section class="panel"><h2 class="panel-title">감사 로그 <span class="badge badge-muted">최근 ${auditLog.length}</span></h2>
    <ul class="audit-list">${auditLog.length ? auditLog.map((a) => `<li><span class="audit-action">${esc(a.action)}</span> <span class="audit-detail">${esc(a.detail)}</span><span class="audit-meta">${esc(a.actor_name)} · ${esc(kstStamp(a.created_at, { year: false }))}</span></li>`).join("") : `<li class="empty">기록이 없습니다.</li>`}</ul></section>`;

  const bizRows = all.length ? all.map((b) => `<tr><td><a href="${base}/business/${esc(b.slug)}" target="_blank">${esc(b.name)}</a><br /><small>${esc(b.category)}</small></td>
    <td>${esc(b.owner_name)}<br /><small>${esc(b.owner_email)}</small></td><td>${statusBadge(b.status)}</td>
    <td class="actions-cell">${b.status !== "approved" ? `<form method="post" action="${base}/admin/business/${b.id}/status"><input type="hidden" name="status" value="approved"><button class="btn btn-xs btn-primary">승인</button></form>` : ""}
      ${b.status !== "rejected" ? `<form method="post" action="${base}/admin/business/${b.id}/status"><input type="hidden" name="status" value="rejected"><button class="btn btn-xs btn-ghost">반려</button></form>` : ""}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">등록된 업체가 없습니다.</td></tr>`;
  const memberRows = members.length ? members.map((m) => `<tr><td>${esc(m.name)}<br /><small>${esc(m.email)}</small></td><td>${esc(m.business_name || "-")}</td>
    <td class="actions-cell"><form method="post" action="${base}/admin/user/${m.id}/reset-password" data-confirm="임시 비밀번호를 발급할까요?"><button class="btn btn-xs btn-ghost">임시 비밀번호</button></form></td></tr>`).join("") : `<tr><td colspan="3" class="empty">회원이 없습니다.</td></tr>`;
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
  const notifyPanel = `<section class="panel" id="p-notify"><div class="panel-head">
      <h2 class="panel-title">알림톡 <span class="badge ${balance > 0 ? "badge-ok" : "badge-wait"}">잔액 ${balance.toLocaleString()}원</span></h2></div>
    <p class="panel-hint">서명 요청·리마인더를 카카오톡으로 보냅니다. 건당 <b>${unitPrice.toLocaleString()}원</b> — 지금 잔액으로 <b>약 ${sendable.toLocaleString()}건</b> 보낼 수 있습니다.
      알림 받을 회원은 <b>${withPhone}명</b>(휴대폰 등록 기준 · 전체 ${members.length}명)입니다.</p>
    ${balance < unitPrice ? `<div class="flash flash-warn">잔액이 부족해 알림톡이 발송되지 않습니다. 아래에서 충전을 신청해 주세요.</div>` : ""}
    <div class="form-two">
      <form method="post" action="${base}/admin/credit/order" class="stack-form compact">
        <label>충전 금액 <small>(1만원 이상 · 1,000원 단위)</small>
          <input type="number" name="amount" value="50000" min="10000" max="5000000" step="1000" required list="chargePresets" />
          <datalist id="chargePresets"><option value="30000"></option><option value="50000"></option><option value="100000"></option><option value="300000"></option></datalist></label>
        <p class="panel-hint">건당 ${unitPrice.toLocaleString()}원 기준 — 5만원이면 약 ${Math.floor(50000 / unitPrice).toLocaleString()}건입니다.</p>
        <label>입금자명<input type="text" name="depositor" maxlength="40" placeholder="예: 서초구상인회" /></label>
        <button class="btn btn-primary btn-sm">충전 신청</button></form>
      <div>${orderRows ? `<p class="mini-label">최근 충전 신청</p><ul class="admin-mini-list">${orderRows}</ul>` : `<p class="panel-hint">충전을 신청하면 운영사가 입금을 확인한 뒤 잔액에 반영합니다.</p>`}</div>
    </div>
    <div class="form-divider">발송 이력 <span class="badge badge-muted">누적 ${(msgStats.n || 0).toLocaleString()}건 · ${(msgStats.spent || 0).toLocaleString()}원${msgStats.failed ? ` · 실패 ${msgStats.failed}` : ""}</span></div>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>시각</th><th>종류</th><th>수신</th><th>상태</th><th>차감</th></tr></thead><tbody>${msgRows}</tbody></table></div>
    <p class="panel-hint">실패한 건은 자동으로 환불되어 잔액이 복구됩니다. 수신번호는 개인정보 보호를 위해 가려서 저장합니다.</p></section>`;

  const notifRows = notifs.length ? notifs.map((n) => `<li class="${n.is_read ? "" : "unread"}"><span class="notif-dot"></span><a href="${esc(n.link || base + "/admin")}" class="notif-msg">${esc(n.message)}</a><time>${esc(kstStamp(n.created_at, { year: false }))}</time></li>`).join("") : `<li class="empty">알림이 없습니다.</li>`;
  const noticeCats = NOTICE_CATEGORIES.map((c) => `<option value="${esc(c)}"${c === "안내" ? " selected" : ""}>${esc(c)}</option>`).join("");

  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">ADMIN · ${esc(assoc.name)}</p><h1 class="dash-title">관리자 대시보드</h1>
      <p class="dash-sub">홈페이지: <a href="${base}" target="_blank">${esc(prettyPath(base))}</a></p></div>
      <div class="dash-head-actions"><a href="${base}/admin/documents" class="btn btn-ghost btn-sm">전자서명 문서</a></div></div>
    ${flashOf(query)}
    <div class="console-grid">
    <aside class="console-side"><nav>
      <a href="#p-stats">${SIDE_SVG.stats} 현황</a><a href="#p-notif">${SIDE_SVG.bell} 알림함${unread ? ` <span class="side-badge">${unread}</span>` : ""}</a>
      <a href="#p-members">${SIDE_SVG.users} 회원</a><a href="#p-biz">${SIDE_SVG.store} 업체 승인${s.pending ? ` <span class="side-badge">${s.pending}</span>` : ""}</a>
      <a href="#p-products">${SIDE_SVG.tag} 제품</a><a href="#p-dues">${SIDE_SVG.stats} 회비 장부</a><a href="#p-home">${SIDE_SVG.home} 홈 구성</a><a href="#p-brand">${SIDE_SVG.palette} 브랜딩</a><a href="#p-content">${SIDE_SVG.mega} 공지·행사</a>
      <a href="#p-notify">${SIDE_SVG.bell} 알림톡</a>
      <a href="${base}/polls" class="side-ext">${SIDE_SVG.bell} 안건 투표</a><a href="${base}/admin/documents" class="side-ext">${SIDE_SVG.sign} 전자서명 문서</a><a href="${base}" target="_blank" class="side-ext">${SIDE_SVG.ext} 사이트 보기</a>
    </nav></aside>
    <div class="console-main">
    ${onboardPanel(base, assoc, s, members.length, notices.length)}
    <div class="stat-cards" id="p-stats">
      <div class="stat-card"><span class="stat-num">${s.businesses}</span><span class="stat-label">승인 업체</span></div>
      <div class="stat-card${s.pending ? " stat-alert" : ""}"><span class="stat-num">${s.pending}</span><span class="stat-label">승인 대기</span></div>
      <div class="stat-card"><span class="stat-num">${s.notices}</span><span class="stat-label">공지</span></div>
      <div class="stat-card"><span class="stat-num">${s.events}</span><span class="stat-label">행사</span></div>
      <div class="stat-card"><span class="stat-num">${s.mediaCount}</span><span class="stat-label">미디어</span></div></div>
    <section class="panel" id="p-notif"><div class="panel-head"><h2 class="panel-title">알림함${unread ? ` <span class="badge badge-wait">${unread}</span>` : ""}</h2>
      ${unread ? `<form method="post" action="${base}/admin/notifications/read"><button class="btn btn-xs btn-ghost">모두 읽음</button></form>` : ""}</div>
      <ul class="notif-list">${notifRows}</ul></section>
    ${metricsPanel}
    <section class="panel" id="p-members"><div class="panel-head"><h2 class="panel-title">회원 관리 <span class="badge badge-muted">${members.length}명</span></h2>
      <span class="pill-row">${members.length ? `<a class="btn btn-xs btn-ghost" href="${base}/admin/members.csv">명단 CSV</a>` : ""}<a class="btn btn-xs btn-ghost" href="${base}/admin/export.json">전체 백업(JSON)</a></span></div>
      <div class="table-scroll"><table class="admin-table"><thead><tr><th>회원</th><th>업체</th><th>비밀번호</th></tr></thead><tbody>${memberRows}</tbody></table></div>
      ${query.get("invite") ? `<div class="invite-box">
        <p class="invite-box-title">✅ 초대 링크가 만들어졌습니다 <small>(7일 유효)</small></p>
        <input type="text" class="invite-url" value="${esc(`${ORIGIN}${base}/invite?t=${encodeURIComponent(query.get("invite"))}`)}" readonly data-select-all />
        <span class="pill-row"><button type="button" class="btn btn-sm btn-primary" data-share data-share-url="${esc(`${ORIGIN}${base}/invite?t=${encodeURIComponent(query.get("invite"))}`)}" data-share-title="${esc(assoc.name)} 입점 초대">카톡으로 보내기 / 복사</button></span>
        <p class="panel-hint">사장님이 링크를 열어 이메일·비밀번호만 정하면 가게가 <b>승인 절차 없이 바로 공개</b>됩니다.</p></div>` : ""}
      <details class="help-box" style="margin-top:14px" ${query.get("invite") ? "" : "open"}><summary>📨 사장님 초대 링크 만들기 (가장 쉬운 온보딩)</summary>
        <div class="help-body"><p class="help-lead">가게 이름만 입력해 링크를 만들고 카톡으로 보내세요. 사장님은 이메일·비밀번호만 정하면 끝 — 가게가 바로 공개됩니다.</p>
        <form method="post" action="${base}/admin/invite" class="stack-form compact">
          <div class="form-two"><label>가게 이름<input type="text" name="biz_name" required maxlength="100" /></label><label>업종<select name="category">${CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select></label></div>
          <button class="btn btn-primary btn-sm">초대 링크 만들기</button></form></div></details>
      <details class="help-box" style="margin-top:14px"><summary>👥 부관리자 추가 (회장·총무 공동 운영)</summary>
        <div class="help-body"><p class="help-lead">관리자 권한 계정을 하나 더 발급합니다. 승인·공지·브랜딩 등 이 콘솔의 모든 기능을 함께 쓸 수 있으니 믿을 수 있는 분에게만 발급하세요.</p>
        ${admins.length > 1 ? `<p class="panel-hint">현재 관리자: ${admins.map((u) => esc(u.name || u.email)).join(", ")}</p>` : ""}
        <form method="post" action="${base}/admin/admins/add" class="stack-form compact">
          <div class="form-two"><label>성함<input type="text" name="name" required /></label><label>이메일<input type="email" name="email" required /></label></div>
          <button class="btn btn-primary btn-sm">부관리자 발급 + 임시 비번</button></form></div></details>
      <details class="help-box" style="margin-top:14px"><summary>사장님 대신 등록하기 (대행)</summary>
        <div class="help-body"><p class="help-lead">사장님이 직접 못 하실 때 총무가 대신 계정을 만들어 드립니다. 임시 비밀번호를 전달하세요. (대행 등록은 참여 계측에 '대행'으로 집계됩니다.)</p>
        <form method="post" action="${base}/admin/members/add" class="stack-form compact">
          <div class="form-two"><label>사장님 성함<input type="text" name="name" required /></label><label>이메일<input type="email" name="email" required /></label></div>
          <div class="form-two"><label>업체명<input type="text" name="business_name" required /></label><label>업종<input type="text" name="category" placeholder="예: 음식점" /></label></div>
          <button class="btn btn-primary btn-sm">대행 등록 + 임시 비번 발급</button></form></div></details></section>
    ${duesPanel}
    ${notifyPanel}
    ${auditPanel}
    <section class="panel" id="p-home"><h2 class="panel-title">홈페이지 구성 편집</h2>
      <p class="panel-hint">섹션을 켜고 끄거나 순서(▲▼)를 바꾸고 문구를 직접 수정할 수 있습니다.</p>
      ${layoutEditor(base, lay)}</section>
    <section class="panel" id="p-brand"><h2 class="panel-title">상인회 정보 · 브랜딩</h2>
      <form method="post" action="${base}/admin/settings" enctype="multipart/form-data" class="stack-form">
        <div class="form-two"><label>상인회 이름<input type="text" name="name" value="${esc(assoc.name)}" required /></label><label>대표 색상<input type="color" name="brand_color" value="${esc(assoc.brand_color)}" /></label></div>
        <label>한 줄 소개<input type="text" name="tagline" value="${esc(assoc.tagline)}" /></label>
        <div class="form-two"><label>대표 전화<input type="text" name="phone" value="${esc(assoc.phone)}" /></label><label>이메일<input type="email" name="email" value="${esc(assoc.email)}" /></label></div>
        <label>주소<input type="text" name="address" value="${esc(assoc.address)}" /></label>
        <label class="mini-label">로고 <small>(선택·이미지)</small><input type="file" name="logo" accept="image/*" /></label>
        <label class="mini-label">홈 히어로 배경 사진 <small>(선택·가로 이미지 권장·비우면 프리미엄 그라데이션 유지)</small><input type="file" name="hero_image" accept="image/*" /></label>
        ${assoc.hero_image ? `<div class="hero-img-cur"><img src="${esc(mediaUrl(assoc.hero_image))}" alt="현재 히어로 배경" loading="lazy" /><label class="check"><input type="checkbox" name="hero_image_clear" value="1" /> 현재 사진 제거하고 그라데이션으로</label></div>` : ""}
        <div class="form-divider">검색 노출 (선택) — 네이버·구글에 사이트를 등록할 때 발급받는 소유 확인 코드</div>
        <div class="form-two"><label>네이버 서치어드바이저 코드<input type="text" name="naver_verification" value="${esc(assoc.naver_verification || "")}" placeholder="content=&quot;…&quot; 안의 값만" /></label>
          <label>구글 서치콘솔 코드<input type="text" name="google_verification" value="${esc(assoc.google_verification || "")}" placeholder="content=&quot;…&quot; 안의 값만" /></label></div>
        <p class="panel-hint">입력하면 모든 페이지에 확인 메타 태그가 자동 삽입됩니다. 등록 후 사이트맵 <code>/sitemap.xml</code> 과 RSS <code>${esc(prettyPath(base))}/feed.xml</code> 을 제출하세요.</p>
        <button class="btn btn-primary btn-sm">브랜딩 저장</button></form></section>
    <section class="panel" id="p-biz"><h2 class="panel-title">업체 관리</h2><div class="table-scroll"><table class="admin-table">
      <thead><tr><th>업체</th><th>사장님</th><th>상태</th><th>처리</th></tr></thead><tbody>${bizRows}</tbody></table></div></section>
    <div id="p-products">${productModPanel}</div>
    <div class="dash-grid" id="p-content">
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
        <ul class="admin-mini-list">${eventRows}</ul></section>
    </div>
    </div></div></div></section>`;
  return html(layout({ title: "관리자", assoc, base, user, body, activeNav: `${base}/admin`, csrf, scripts: `<script src="${assetUrl("/js/layout-editor.js")}" defer></script><script src="${assetUrl("/js/upload-resize.js")}" defer></script><script src="${assetUrl("/js/share.js")}" defer></script>` }));
}

// 관리자 온보딩 체크리스트 (모두 완료되면 자동으로 사라짐)
function onboardPanel(base, assoc, stats, memberCount, noticeCount) {
  const steps = [
    { done: !!(assoc.tagline && assoc.tagline.trim()), label: "상인회 한 줄 소개 쓰기", href: "#p-brand" },
    { done: assoc.brand_color && assoc.brand_color !== "#0b6e4f" || !!assoc.logo, label: "대표 색·로고 정하기", href: "#p-brand" },
    { done: noticeCount > 0, label: "첫 공지 올리기", href: "#p-content" },
    { done: memberCount > 0, label: "회원(사장님) 모집 — 가입 링크 공유", href: base + "/register" },
    { done: stats.pending === 0, label: "가입 승인 대기 처리", href: "#p-biz" },
  ];
  const remain = steps.filter((x) => !x.done).length;
  if (!remain) return "";
  return `<section class="panel onboard"><div class="panel-head"><h2 class="panel-title">시작 체크리스트 <span class="badge badge-wait">${steps.length - remain}/${steps.length}</span></h2></div>
    <ul class="onboard-list">${steps.map((x) => `<li class="${x.done ? "done" : ""}">
      <span class="ob-check">${x.done ? "✓" : ""}</span><a href="${x.href}">${x.label}</a></li>`).join("")}</ul></section>`;
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
  const members = await D.listUsersByAssociation(db, assoc.id, "MERCHANT");
  const lines = [["이름", "이메일", "업체명", "역할"], ...members.map((m) => [m.name, m.email, m.business_name || "", m.role])];
  const csv = "﻿" + lines.map((r) => r.map(csvCell).join(",")).join("\r\n");
  return text(csv, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="members_${assoc.slug}.csv"`, "cache-control": "no-store" });
}

// ================= 전자서명 =================
export async function signList(ctx) {
  const { db, assoc, base, user, query, csrf } = ctx;
  const todo = await D.listDocumentsToSign(db, assoc.id, user.id);
  const all = await D.listDocuments(db, assoc.id);
  const signedFlags = await Promise.all(all.map((d) => D.hasSigned(db, d.id, user.id)));
  const todoRows = todo.length ? todo.map((d) => `<li><a href="${base}/sign/${d.id}"><span class="notice-tag tag-important">서명 필요</span>
    <span class="notice-title">${esc(d.title)}${d.ordered ? ' <span class="badge badge-info">순차</span>' : ""}${d.due_date ? ` <span class="badge badge-wait">~${esc(d.due_date)}</span>` : ""}</span><time>${esc(kstDate(d.created_at, "."))}</time></a></li>`).join("") : `<li class="empty">서명할 문서가 없습니다.</li>`;
  const doneRows = all.filter((_, i) => signedFlags[i]).map((d) => `<li><span class="notice-tag badge-ok">서명 완료</span><span class="notice-title">${esc(d.title)}</span></li>`).join("") || `<li class="empty">서명 내역이 없습니다.</li>`;
  const body = `<section class="section page-top"><div class="container narrow">
    <a href="${base}/dashboard" class="back-link">← 내 업체</a>
    <div class="section-head" style="text-align:left"><p class="section-eyebrow">E-SIGN</p><h1 class="section-title">전자서명</h1></div>${flashOf(query)}
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
  if (!(await D.canReceiveSign(db, d.id, user.id))) return back(base + "/sign", "이 문서의 서명 대상이 아닙니다.", true);
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
  // 지면에 배치된 필드가 있으면 "계약서 위에서 직접 채우는" 방식으로, 없으면 종래의 단일 서명란으로.
  const fields = await D.listFieldsWithValues(db, d.id);
  const reqs = fields.length ? await D.listRequestStatus(db, d.id) : [];
  const nameOf = (id) => { const u = reqs.find((r) => r.id === id); return u ? u.name : ""; };
  const myFields = fields.filter((f) => !f.value && !f.image && (f.assignee === user.id || f.assignee === 0));
  const hasSignField = myFields.some((f) => f.kind === "sign");
  const docView = fields.length
    ? `<div class="paper-wrap">${renderPaper(d.body, { mode: otpDone ? "fill" : "view", fieldsFor: fieldsRenderer(fields, { mode: otpDone ? "fill" : "view", myId: user.id, nameOf }) })}</div>`
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
    ${docView}
    ${d.attachment ? `<p class="doc-attach">📎 계약서 원문: <a href="${esc(mediaUrl(d.attachment))}" target="_blank" rel="noopener">${esc(d.attachment_name || "계약서.pdf")}</a> <small>— 이 파일의 내용도 해시에 포함되어 봉인됩니다</small></p>` : ""}
    <p class="doc-hash">문서 해시: <code>${esc(d.content_hash)}</code></p>
    ${otpDone ? `${needOtp ? '<p class="otp-ok">✅ 휴대폰 본인확인 완료 — 이 서명에는 본인확인 기록이 함께 남습니다.</p>' : ""}
    <form method="post" action="${base}/sign/${d.id}" class="stack-form sign-form" id="signForm">
      ${padBlock}
      <input type="hidden" name="signature" id="signatureData" />
      <input type="hidden" name="fields" id="fieldValues" />
      <label>서명자 성명<input type="text" name="signer_name" id="signerName" value="${esc(user.name)}" required /></label>
      <label class="check"><input type="checkbox" name="consent" value="1" required /> 위 내용을 확인했으며 본인이 전자서명하는 데 동의합니다.</label>
      <button class="btn btn-primary btn-block" id="signSubmit">전자서명 제출</button></form>` : ""}
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
  const today = new Date().toISOString().slice(0, 10);
  const docs = await D.listDocuments(db, assoc.id);
  const rows = docs.length ? docs.map((d) => `<tr><td><a href="${base}/admin/documents/${d.id}">${esc(d.title)}</a>
    ${d.ordered ? '<span class="badge badge-info">순차</span>' : ""}${d.due_date ? `<span class="badge ${d.due_date < today ? "badge-no" : "badge-wait"}">기한 ${esc(d.due_date)}</span>` : ""}<br /><small>${esc(kstStamp(d.created_at))}</small></td>
    <td>${d.sign_count}명</td><td>${d.closed ? '<span class="badge badge-no">마감</span>' : '<span class="badge badge-ok">진행중</span>'}</td>
    <td class="actions-cell"><a class="btn btn-xs btn-ghost" href="${base}/admin/documents/${d.id}">보기</a>${d.closed ? "" : `<form method="post" action="${base}/admin/documents/${d.id}/close" data-confirm="마감할까요?"><button class="btn btn-xs btn-ghost">마감</button></form>`}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">문서가 없습니다.</td></tr>`;
  const members = await D.listUsersByAssociation(db, assoc.id, "MERCHANT");
  const checks = members.length ? members.map((m) => `<label class="check member-check"><input type="checkbox" name="members" value="${m.id}" /> ${esc(m.name)} <small>${esc(m.email)}</small></label>`).join("") : `<p class="empty">회원이 없습니다.</p>`;
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">E-SIGN · ${esc(assoc.name)}</p><h1 class="dash-title">전자서명 문서</h1>
      <p class="dash-sub"><a href="${base}/admin">← 관리자</a></p></div></div>${flashOf(query)}
    <section class="panel panel-accent"><h2 class="panel-title">➕ 서명 문서 만들기</h2>
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
        <button class="btn btn-primary">문서 생성 및 서명 요청</button></form></section>
    <section class="panel"><h2 class="panel-title">문서 목록</h2><div class="table-scroll"><table class="admin-table">
      <thead><tr><th>문서</th><th>서명</th><th>상태</th><th>관리</th></tr></thead><tbody>${rows}</tbody></table></div></section></div></section>`;
  return html(layout({ title: "전자서명 문서", assoc, base, user, body, csrf }));
}
export async function adminDocumentDetail(ctx) {
  const { db, env, assoc, base, user, params, csrf } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  if (!d || d.association_id !== assoc.id) return notFoundResponse(ctx);
  const sigs = await D.listSignatures(db, d.id);
  const verds = await Promise.all(sigs.map((sig) => verifySignature(env, sig, d)));
  const rows = sigs.length ? sigs.map((sig, i) => { const v = verds[i]; const badge = v.valid ? '<span class="badge badge-ok">유효</span>' : '<span class="badge badge-no">위변조 의심</span>';
    return `<tr><td>${esc(sig.signer_name)}<br /><small>${esc(sig.signer_email)}</small></td>
      <td>${sig.signature_image ? `<img src="${esc(mediaUrl(sig.signature_image))}" alt="서명" class="sig-thumb" />` : "-"}</td>
      <td><small>${esc(kstStamp(sig.signed_at))} <span class="tz">KST</span><br />IP ${esc(sig.ip)}</small></td>
      <td>${badge}<br /><a href="/certificate/${esc(sig.verify_code)}" target="_blank"><small>확인서</small></a> · <a href="/verify/${esc(sig.verify_code)}" target="_blank"><small>검증</small></a></td></tr>`; }).join("") : `<tr><td colspan="4" class="empty">아직 서명이 없습니다.</td></tr>`;
  const rc = await D.requestCounts(db, d.id);
  const reqStatus = await D.listRequestStatus(db, d.id);
  const fieldN = await D.countFields(db, d.id);
  const pct = rc.total ? Math.round((rc.signed / rc.total) * 100) : 0;
  const nextTurn = d.ordered ? reqStatus.find((u) => !u.signed && !u.declined_at) : null;
  const reqPanel = rc.total ? `<section class="panel"><h2 class="panel-title">서명 현황 <span class="badge ${rc.signed === rc.total ? "badge-ok" : "badge-wait"}">${rc.signed}/${rc.total} (${pct}%)</span>${d.ordered ? ' <span class="badge badge-info">순차</span>' : ""}</h2>
    <div class="progress"><span style="width:${pct}%"></span></div>
    <ul class="req-list">${reqStatus.map((u) => `<li>${d.ordered ? `<span class="req-order">${u.sign_order}</span>` : ""}<span class="req-name">${esc(u.name)}</span> <small>${esc(u.email)}</small> ${u.signed ? '<span class="badge badge-ok">완료</span>' : u.declined_at ? `<span class="badge badge-no">거절</span><br /><small class="decline-why">사유: ${esc(u.decline_reason || "")}</small>` : (d.ordered ? (nextTurn && nextTurn.id === u.id ? '<span class="badge badge-wait">서명 차례</span>' : '<span class="badge badge-muted">대기</span>') : '<span class="badge badge-wait">미서명</span>')}</li>`).join("")}</ul>
    ${d.ordered && nextTurn ? `<p class="panel-hint">현재 <b>${esc(nextTurn.name)}</b>님 차례입니다.</p>` : ""}</section>` : `<section class="panel"><p class="panel-hint">전체 공개 문서(누구나 서명 가능).</p></section>`;
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">E-SIGN</p><h1 class="dash-title">${esc(d.title)} ${d.closed ? '<span class="badge badge-no">마감</span>' : ""}${d.ordered ? ' <span class="badge badge-info">순차</span>' : ""}${d.due_date ? `<span class="badge ${D.isPastDue(d) ? "badge-no" : "badge-wait"}">기한 ${esc(d.due_date)}</span>` : ""}</h1>
      <p class="dash-sub"><a href="${base}/admin/documents">← 문서 목록</a> · 서명 ${sigs.length}명</p></div>
      <div class="dash-head-actions">
        ${d.closed ? "" : `<form method="post" action="${base}/admin/documents/${d.id}/remind" class="inline-form" data-confirm="미서명자에게 알림톡·이메일로 리마인더를 보낼까요? (알림톡은 잔액이 차감됩니다)"><button class="btn btn-primary btn-sm">미서명자 재알림</button></form>`}
        <a href="${base}/documents/${d.id}/paper" class="btn btn-ghost btn-sm">📄 완성본 보기</a>
        <a href="${base}/admin/documents/${d.id}/fields" class="btn btn-ghost btn-sm">🖊 필드 배치${fieldN ? ` (${fieldN})` : ""}</a>
        <button type="button" class="btn btn-ghost btn-sm" data-print>🖨 인쇄/PDF</button></div></div>
    ${reqPanel}
    <section class="panel"><h2 class="panel-title">문서 본문</h2><div class="doc-body">${docBody(d.body)}</div>
      ${d.attachment ? `<p class="doc-attach">📎 <a href="${esc(mediaUrl(d.attachment))}" target="_blank" rel="noopener">${esc(d.attachment_name || "계약서.pdf")}</a></p>` : ""}
      <p class="doc-hash">해시: <code>${esc(d.content_hash)}</code></p></section>
    <section class="panel"><h2 class="panel-title">서명 내역</h2><div class="table-scroll"><table class="admin-table">
      <thead><tr><th>서명자</th><th>서명</th><th>일시·IP</th><th>검증</th></tr></thead><tbody>${rows}</tbody></table></div></section></div></section>`;
  return html(layout({ title: d.title, assoc, base, user, body, csrf }));
}

// 지면에 놓인 필드를 페이지별로 뿌리는 헬퍼. fields 는 값(value/image)이 붙어 있을 수 있다.
function fieldsRenderer(fields, { mode, myId = 0, nameOf = () => "" }) {
  return (page) => fields.filter((f) => f.page === page).map((f) => {
    const val = f.value || f.image ? { value: f.value || "", imageUrl: f.image ? mediaUrl(f.image) : "" } : null;
    return fieldBox(f, { mode, val, mine: mode === "fill" && !val && (f.assignee === myId || f.assignee === 0), assigneeName: nameOf(f.assignee) });
  }).join("");
}

// 필드 배치 편집기 — "여기에 서명, 여기에 도장" 을 관리자가 직접 지면 위에 놓는다.
export async function adminDocFields(ctx) {
  const { db, assoc, base, user, params, query, csrf } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  if (!d || d.association_id !== assoc.id) return notFoundResponse(ctx);
  const sigs = await D.requestCounts(db, d.id);
  const signedAny = (await D.listSignatures(db, d.id)).length > 0;
  const reqs = await D.listRequestStatus(db, d.id);
  const fields = await D.listFields(db, d.id);
  const nameOf = (id) => { const u = reqs.find((r) => r.id === id); return u ? u.name : ""; };
  const paper = renderPaper(d.body, { mode: "edit", fieldsFor: fieldsRenderer(fields, { mode: "edit", nameOf }) });
  // 이미 서명이 시작된 문서는 지면을 바꿀 수 없다 — 서명자가 본 화면과 달라지면 봉인의 의미가 사라진다
  if (signedAny) {
    const b = `<section class="dash"><div class="container">
      <div class="dash-head"><div><p class="section-eyebrow">E-SIGN</p><h1 class="dash-title">필드 배치 — ${esc(d.title)}</h1></div></div>
      <div class="flash flash-warn">이미 서명이 시작된 문서입니다. 서명자가 확인한 지면이 바뀌면 안 되므로 배치를 수정할 수 없습니다.</div>
      <p><a href="${base}/admin/documents/${d.id}" class="btn btn-ghost btn-sm">← 문서로</a></p>
      <div class="paper-wrap">${renderPaper(d.body, { fieldsFor: fieldsRenderer(fields, { mode: "view", nameOf }) })}</div></div></section>`;
    return html(layout({ title: "필드 배치", assoc, base, user, body: b, csrf, scripts: `<script src="${assetUrl("/js/paper.js")}" defer></script>` }));
  }
  const palette = Object.entries(FIELD_KINDS).map(([k, v], i) =>
    `<button type="button" class="fp-item${i === 0 ? " on" : ""}" data-kind="${esc(k)}">${v.icon} ${esc(v.label)}</button>`).join("");
  const assigneeOpts = `<option value="0" data-name="">누구나(먼저 서명하는 사람)</option>` +
    reqs.map((r) => `<option value="${r.id}" data-name="${esc(r.name)}">${esc(r.name)}</option>`).join("");
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">E-SIGN · 필드 배치</p><h1 class="dash-title">${esc(d.title)}</h1>
      <p class="dash-sub"><a href="${base}/admin/documents/${d.id}">← 문서로</a> · 서명 대상 ${sigs.total}명</p></div></div>
    ${flashOf(query)}
    <section class="panel">
      <p class="fp-hint">놓을 종류를 고른 뒤 <b>계약서 위를 클릭</b>하면 그 자리에 필드가 생깁니다. 드래그로 옮기고, 오른쪽 아래 손잡이로 크기를 조절하세요.
        각 필드는 <b>누가 채울지</b> 지정할 수 있습니다.</p>
      <div class="fp-bar">${palette}</div>
      <div class="fp-props" id="fieldProps" hidden>
        <span class="badge badge-info" id="fpKind"></span>
        <label>이름표<input type="text" id="fpLabel" maxlength="20" placeholder="예: 임차인 서명" /></label>
        <label>담당 서명자<select id="fpAssignee">${assigneeOpts}</select></label>
        <label class="check-inline"><input type="checkbox" id="fpReq" checked /> 필수</label>
        <button type="button" class="btn btn-ghost btn-sm" id="fpDel">삭제</button>
      </div>
      <form method="post" action="${base}/admin/documents/${d.id}/fields" id="fieldsForm">
        <input type="hidden" name="fields" id="fieldsData" />
        <button class="btn btn-primary">배치 저장</button></form>
    </section>
    <div class="paper-wrap">${paper}</div>
    <script type="application/json" id="fieldKinds">${JSON.stringify(FIELD_KINDS)}</script>
    </div></section>`;
  return html(layout({ title: "필드 배치", assoc, base, user, body, csrf, scripts: `<script src="${assetUrl("/js/paper.js")}" defer></script>` }));
}

// 완성본 — 채워진 값이 모두 박힌 계약서. 브라우저 인쇄(PDF로 저장)로 그대로 받을 수 있다.
export async function documentPaper(ctx) {
  const { db, assoc, base, user, params, csrf } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  if (!d || d.association_id !== assoc.id) return notFoundResponse(ctx);
  const isAdmin = user.role !== "MERCHANT";
  if (!isAdmin && !(await D.canReceiveSign(db, d.id, user.id))) return notFoundResponse(ctx);
  const fields = await D.listFieldsWithValues(db, d.id);
  const reqs = await D.listRequestStatus(db, d.id);
  const rc = await D.requestCounts(db, d.id);
  const done = rc.total > 0 && rc.signed === rc.total;
  const nameOf = (id) => { const u = reqs.find((r) => r.id === id); return u ? u.name : ""; };
  const paper = renderPaper(d.body, {
    fieldsFor: fieldsRenderer(fields, { mode: "view", nameOf }),
    watermark: done ? "" : "미완성",
  });
  const backTo = isAdmin ? `${base}/admin/documents/${d.id}` : `${base}/sign`;
  const body = `<section class="section page-top"><div class="container">
    <div class="dash-head no-print"><div><p class="section-eyebrow">E-SIGN · 완성본</p><h1 class="dash-title">${esc(d.title)}</h1>
      <p class="dash-sub"><a href="${backTo}">← 돌아가기</a> · 서명 ${rc.signed}/${rc.total}${done ? " · 체결 완료" : " · 진행 중"}</p></div>
      <div class="dash-head-actions"><button type="button" class="btn btn-primary btn-sm" data-print>🖨 인쇄 / PDF로 저장</button></div></div>
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
  const verifyUrl = `${ORIGIN}/verify/${encodeURIComponent(sig.verify_code)}`;
  const row = (k, val) => `<tr><th>${esc(k)}</th><td>${val}</td></tr>`;
  const body = `<section class="section page-top"><div class="container narrow cert-sheet">
    <div class="cert-head">
      <p class="section-eyebrow">CERTIFICATE OF ELECTRONIC SIGNATURE</p>
      <h1 class="article-title">전자서명 확인서</h1>
      <p class="cert-issuer">${esc(assoc ? assoc.name : "")}</p>
      <p class="cert-verdict">${v.valid
        ? '<span class="badge badge-ok">유효 — 봉인·본문 모두 무결</span>'
        : '<span class="badge badge-no">위변조 의심 — 아래 항목을 확인하세요</span>'}</p>
    </div>
    <table class="verify-table cert-table">
      ${row("문서 제목", esc(doc ? doc.title : "(삭제됨)"))}
      ${row("서명자", esc(sig.signer_name))}
      ${row("서명 일시", esc(kstStamp(sig.signed_at)))}
      ${row("본인확인 수준", { identity: '실명 본인확인 <span class="badge badge-ok">최상</span>', otp: '휴대폰 인증번호 확인 <span class="badge badge-ok">강화</span>' }[sig.verify_level] || '계정 로그인 <span class="badge badge-muted">기본</span>')}
      ${row("서명 IP", esc(sig.ip))}
      ${row("서명 기기", `<small>${esc((sig.user_agent || "").slice(0, 120))}</small>`)}
      ${row("문서 해시 (SHA-256)", `<code class="cert-hash">${esc(sig.content_hash)}</code>`)}
      ${row("봉인값 (Ed25519)", `<code class="cert-hash">${esc(sig.record_hash)}</code>`)}
      ${row("본문 무결성", v.contentOk ? "원본과 일치 ✅" : "변경됨 ❌")}
      ${row("봉인 무결성", v.sealOk ? "무결 ✅" : "손상 ❌")}
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
        문서 본문이 한 글자라도 바뀌면 해시가 달라져 “변경됨”으로 표시됩니다.</p>
    </div>
    <div class="cert-actions no-print"><button type="button" class="btn btn-primary btn-sm" data-print>🖨 인쇄 / PDF 저장</button>
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
      <form method="get" action="/verify" class="stack-form"><label>검증 코드<input type="text" name="code" value="${esc(code)}" /></label><button class="btn btn-primary btn-sm">검증</button></form>`;
  } else {
    const doc = await D.getDocument(db, sig.document_id);
    const v = await verifySignature(env, sig, doc);
    const badge = v.valid ? '<span class="badge badge-ok">유효한 서명</span>' : '<span class="badge badge-no">위변조 의심</span>';
    inner = `<div class="verify-result">${badge}
      <table class="verify-table"><tr><th>문서</th><td>${esc(doc ? doc.title : "(삭제됨)")}</td></tr>
      <tr><th>서명자</th><td>${esc(sig.signer_name)}</td></tr><tr><th>서명 시각</th><td>${esc(kstStamp(sig.signed_at))} <span class="tz">KST</span></td></tr>
      <tr><th>봉인(Ed25519)</th><td>${v.sealOk ? "무결 ✅" : "손상 ❌"}</td></tr><tr><th>문서 본문</th><td>${v.contentOk ? "원본 일치 ✅" : "변경됨 ❌"}</td></tr>
      <tr><th>알고리즘</th><td>${esc(algorithm)}</td></tr></table></div>`;
  }
  const body = `<section class="section page-top"><div class="container narrow"><h1 class="article-title">전자서명 검증</h1>${inner}</div></section>`;
  return html(layout({ title: "서명 검증", body, csrf }));
}

// ================= 슈퍼관리자 =================
export async function superConsole(ctx) {
  const { db, env, user, query, csrf } = ctx;
  const ps = await D.platformStats(db);
  const list = await D.listAllAssociations(db);
  const auditLog = await D.listAudit(db, null, 15);
  const pendingApps = await D.listApplications(db, "pending");
  const usage = await D.usageByAssociation(db);
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
  const demoSeeded = new Map((await soft("데모 적용 시각", () => D.demoSeedStamps(db), [])).map((r) => [r.aid, r.seeded_at]));
  const appNotes = await soft("영업 기록", () => D.listApplicationNotes(db), []);
  const lastAct = new Map((await soft("마지막 활동", () => D.lastActivityByAssociation(db), [])).map((r) => [r.aid, r.last_at]));
  const adminsBy = new Map();
  for (const u of await soft("관리자 계정", () => D.listAllAdmins(db), [])) {
    if (!adminsBy.has(u.association_id)) adminsBy.set(u.association_id, []);
    adminsBy.get(u.association_id).push(u);
  }
  const platformMode = (await D.getSetting(db, "platform_mode")) === "1";
  const siteName = (await D.getSetting(db, "site_name")) || "상인회 플랫폼";
  const operator = (await D.getSetting(db, "operator")) || "";
  const contactEmail = (await D.getSetting(db, "contact_email")) || "";
  const contactPhone = (await D.getSetting(db, "contact_phone")) || "";
  // 선택 연동 점검 — 무엇이 아직 안 켜졌는지 한눈에. 값 자체는 보여 주지 않습니다(시크릿).
  const wired = [
    ["사진 직접 서빙", !!env.MEDIA_PUBLIC_BASE, "MEDIA_PUBLIC_BASE", "R2 버킷에 공개 도메인을 켜고 그 주소를 워커 변수에 넣으면 사진이 워커를 거치지 않고 CDN 직행합니다."],
    ["방문 통계", !!env.CF_ANALYTICS_TOKEN, "CF_ANALYTICS_TOKEN", "Cloudflare Web Analytics 에서 사이트를 추가하고 발급된 토큰을 넣으면 모든 페이지에 자동 삽입됩니다."],
    ["이메일 자동 발송", !!(env.RESEND_API_KEY && env.MAIL_FROM), "RESEND_API_KEY · MAIL_FROM", "비밀번호 재설정·입점 승인 안내가 자동 발송됩니다. 없으면 화면 안내로 대체됩니다."],
    ["네이버 지도", !!env.NAVER_MAP_CLIENT_ID, "NAVER_MAP_CLIENT_ID", "지도가 안 뜨면 Maps 콘솔의 Web 서비스 URL 에 이 사이트 도메인이 등록됐는지 확인하세요."],
    ["봇 차단(캡차)", !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET), "TURNSTILE_SITE_KEY · TURNSTILE_SECRET", "가입·문의 폼에 Cloudflare Turnstile 이 붙습니다. 없어도 폼은 정상 동작합니다."],
  ];
  const supers = await soft("슈퍼 계정 목록", () => D.listSuperAdmins(db), []);
  const superPanel = `<section class="panel"><h2 class="panel-title">이 콘솔에 접근 가능한 계정 <span class="badge ${supers.length > 1 ? "badge-wait" : "badge-ok"}">${supers.length}개</span></h2>
    <p class="panel-hint">슈퍼 관리자만 이 화면과 상인회 생성·삭제를 쓸 수 있습니다. 상인회 관리자·사장님 계정으로는 주소를 직접 입력해도 들어올 수 없습니다.
      ${supers.length > 1 ? " <b>계정이 둘 이상입니다 — 모르는 계정이 있으면 즉시 확인하세요.</b>" : ""}</p>
    <ul class="wire-list">${supers.map((u) => `<li class="is-on"><span class="wire-dot" aria-hidden="true"></span>
      <div><b>${esc(u.email)}</b> <span class="badge ${u.totp_enabled ? "badge-ok" : "badge-muted"}">${u.totp_enabled ? "2단계 인증 사용" : "2단계 인증 없음"}</span>
        <p>${esc(u.name || "")} · 생성 ${esc(kstDate(u.created_at))}</p></div></li>`).join("")}</ul>
    ${supers.some((u) => !u.totp_enabled) ? `<p class="panel-hint">이 계정 하나가 뚫리면 모든 상인회 데이터가 열립니다. <a href="/account">계정 설정</a>에서 2단계 인증을 켜 두시길 권합니다.</p>` : ""}</section>`;
  const wiredPanel = `<section class="panel"><h2 class="panel-title">선택 연동 점검 <span class="badge ${wired.every((w) => w[1]) ? "badge-ok" : "badge-muted"}">${wired.filter((w) => w[1]).length}/${wired.length} 켜짐</span></h2>
    <p class="panel-hint">모두 선택 사항입니다. 꺼져 있어도 사이트는 정상 동작하며, 값은 <b>Workers &amp; Pages → 이 워커 → Settings → Variables</b> 에서 넣습니다.</p>
    <ul class="wire-list">${wired.map(([label, on, keys, help]) => `<li class="${on ? "is-on" : ""}">
      <span class="wire-dot" aria-hidden="true"></span>
      <div><b>${esc(label)}</b> <span class="badge ${on ? "badge-ok" : "badge-muted"}">${on ? "켜짐" : "안 켜짐"}</span>
        <p>${esc(help)}</p><code>${esc(keys)}</code></div></li>`).join("")}</ul></section>`;
  // ----- 알림톡 재판매: 판매단가·템플릿·충전 승인·매출 -----
  const [pendCredits, notifyUsage, unitPrice] = await Promise.all([
    D.listPendingCreditOrders(db), D.platformMessageUsage(db), priceOf(db, "alimtalk"),
  ]);
  const tplVals = await Promise.all(Object.values(TEMPLATE_KEYS).map((k) => D.getSetting(db, k)));
  const tplInputs = Object.entries(TEMPLATE_KEYS).map(([kind, key], i) =>
    `<label class="mini-label">${esc({ sign_request: "서명 요청", sign_remind: "서명 리마인더", notice: "공지" }[kind] || kind)} 템플릿코드
      <input type="text" name="${esc(key)}" value="${esc(tplVals[i] || "")}" maxlength="60" placeholder="카카오 심사 통과 코드" /></label>`).join("");
  const creditRows = pendCredits.length ? pendCredits.map((o) => `<tr><td>${esc(o.assoc_name)}</td><td>${o.amount.toLocaleString()}원</td>
    <td>${esc(o.depositor || "-")}<br /><small>${esc(kstStamp(o.created_at, { year: false }))}</small></td>
    <td class="actions-cell">
      <form method="post" action="/super/credit/${o.id}" class="inline-form" data-confirm="입금을 확인했습니다. ${o.amount.toLocaleString()}원을 충전할까요?"><input type="hidden" name="action" value="approve" /><button class="btn btn-xs btn-primary">입금 확인·충전</button></form>
      <form method="post" action="/super/credit/${o.id}" class="inline-form" data-confirm="반려할까요?"><input type="hidden" name="action" value="reject" /><button class="btn btn-xs btn-ghost">반려</button></form></td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">대기 중인 충전 신청이 없습니다.</td></tr>`;
  const totalRevenue = notifyUsage.reduce((a, u) => a + (u.revenue || 0), 0);
  const totalCharged = notifyUsage.reduce((a, u) => a + (u.charged || 0), 0);
  const totalSent = notifyUsage.reduce((a, u) => a + (u.sent || 0), 0);
  const notifyRows = notifyUsage.map((u) => `<tr><td>${esc(u.name)}</td>
    <td>${(u.sent || 0).toLocaleString()}건</td><td>${(u.revenue || 0).toLocaleString()}원</td>
    <td>${(u.charged || 0).toLocaleString()}원</td><td>${(u.balance || 0).toLocaleString()}원</td>
    <td><form method="post" action="/super/association/${u.id}/unit-price" class="inline-form price-form">
      <input type="number" name="unit_price" value="${u.unit_price || 0}" min="0" max="1000" step="1" aria-label="${esc(u.name)} 단가" />
      <button class="btn btn-xs btn-ghost">저장</button></form>
      <small>${u.unit_price ? `전용 ${u.unit_price}원` : `기본 ${unitPrice}원`}</small></td></tr>`).join("")
    || `<tr><td colspan="6" class="empty">상인회가 없습니다.</td></tr>`;
  // ----- 전자서명 키·사슬 상태 (보안) -----
  const keyMode = keyStorage(env);
  const keyFp = await publicKeyFingerprint(env).catch(() => "(확인 불가)");
  const chain = verifyChain(await D.listSignatureChain(db));
  const otpOn = (await D.getSetting(db, "esign_otp")) === "1";
  const anchor = await D.lastAnchor(db);
  const securityPanel = `<section class="panel ${keyMode === "secret" ? "" : "panel-warn"}"><h2 class="panel-title">전자서명 보안
      ${keyMode === "secret" ? '<span class="badge badge-ok">키 안전 보관</span>' : '<span class="badge badge-no">키가 DB에 있음</span>'}
      ${chain.ok ? '<span class="badge badge-ok">서명 사슬 정상</span>' : '<span class="badge badge-no">사슬 끊김</span>'}</h2>
    ${keyMode === "secret"
      ? '<p class="panel-hint">서명 개인키가 Cloudflare Secret 에 있습니다. DB 가 유출되어도 봉인을 위조할 수 없습니다.</p>'
      : `<div class="flash flash-warn"><b>서명 개인키가 데이터베이스에 저장되어 있습니다.</b>
          D1 을 읽을 수 있는 사람은 과거 서명을 위조할 수 있습니다. 아래 순서로 옮기세요.
          <ol class="hint-steps">
            <li><code>node cloudflare/scripts/gen-sign-key.mjs</code> 로 키를 새로 만들거나, 현행 키를 그대로 옮기려면 D1 의 <code>settings.sign_key</code> 값을 복사합니다.</li>
            <li>Workers &amp; Pages → 이 워커 → Settings → Variables 에 <code>SIGN_PRIVATE_KEY</code> 를 <b>Secret</b> 으로 등록합니다.</li>
            <li>등록 후 D1 에서 <code>DELETE FROM settings WHERE key='sign_key'</code> 로 사본을 지웁니다.</li>
          </ol>
          <b>주의:</b> 키를 <u>새로 만들면</u> 기존 서명은 검증에 실패합니다. 이미 받은 서명이 있으면 반드시 현행 키를 그대로 옮기세요.</div>`}
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
        인증번호 1건도 알림톡 크레딧에서 차감됩니다(상인회 부담). 계정 도용·대리 서명을 막는 가장 효과적인 수단입니다.</p></form>
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
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">매출</span></div><span class="stat-num">${sT.rev.toLocaleString()}</span><div class="stat-delta mut">원 · 상인회 차감액</div></div>
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">원가</span></div><span class="stat-num">${sT.base.toLocaleString()}</span><div class="stat-delta mut">원 · 건당 ${unitCost}원 기준</div></div>
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">마진</span></div><span class="stat-num">${margin.toLocaleString()}</span><div class="stat-delta ${margin > 0 ? "up" : "mut"}">원 (${marginPct}%)</div></div>
    </div>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>상인회</th><th>발송</th><th>매출</th><th>원가</th><th>마진</th><th>마진율</th></tr></thead><tbody>${settleRows}</tbody></table></div>
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
    <tr><th>발송 참조 코드</th><td><code>SCM-{상인회id}-{템플릿}</code> — 발송 로그에 함께 기록됩니다</td></tr></table></section>`;

  const notifySuperPanel = `<section class="panel panel-accent"><h2 class="panel-title">알림톡 판매 <span class="badge badge-brand">건당 ${unitPrice.toLocaleString()}원</span>${pendCredits.length ? ` <span class="badge badge-wait">충전 대기 ${pendCredits.length}</span>` : ""}</h2>
    <p class="panel-hint">상인회가 선불로 충전하고 발송할 때마다 차감됩니다. <b>판매단가 − 원가 = 마진</b>이며, 발송 실패는 자동 환불되어 매출로 잡히지 않습니다.
      ${notifyEnabled(env) ? "" : '<b class="txt-warn">아직 알리고 키가 설정되지 않아 실제 발송은 되지 않습니다.</b>'}</p>
    <div class="stat-cards">
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">누적 발송</span></div><span class="stat-num">${totalSent.toLocaleString()}</span><div class="stat-delta mut">건</div></div>
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">발송 매출</span></div><span class="stat-num">${totalRevenue.toLocaleString()}</span><div class="stat-delta mut">원 (차감 확정분)</div></div>
      <div class="stat-card left"><div class="stat-top"><span class="stat-label">누적 충전</span></div><span class="stat-num">${totalCharged.toLocaleString()}</span><div class="stat-delta mut">원 (입금 기준)</div></div>
    </div>
    <div class="form-divider">충전 신청 (입금 확인 후 승인)</div>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>상인회</th><th>금액</th><th>입금자·신청</th><th>처리</th></tr></thead><tbody>${creditRows}</tbody></table></div>
    <div class="form-divider">상인회별 사용</div>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>상인회</th><th>발송</th><th>매출</th><th>충전</th><th>잔액</th><th>단가(원/건)</th></tr></thead><tbody>${notifyRows}</tbody></table></div>
    <p class="panel-hint">단가를 <b>0</b> 으로 두면 플랫폼 기본가(${unitPrice.toLocaleString()}원)를 씁니다. 규모가 큰 상인회에 낮은 단가를, 소규모엔 기본가를 적용하는 식으로 상인회마다 다르게 받을 수 있습니다.</p>
    <div class="form-divider">단가·템플릿 설정</div>
    <form method="post" action="/super/notify-settings" class="stack-form">
      <label class="mini-label">알림톡 판매단가 (원/건)<input type="number" name="price_alimtalk" value="${unitPrice}" min="0" max="1000" required /></label>
      <div class="form-two">${tplInputs}</div>
      <p class="panel-hint">템플릿 코드는 플랫폼 카카오 채널에 등록·심사 통과된 값이어야 합니다. 비어 있으면 해당 종류는 발송되지 않습니다.</p>
      <button class="btn btn-primary btn-sm">알림톡 설정 저장</button></form></section>`;

  const usagePanel = `<section class="panel"><h2 class="panel-title">상인회별 사용량 <span class="badge badge-muted">R2 총 ${fmtBytes(ps.storage)}</span></h2>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>상인회</th><th>회원</th><th>미디어</th><th>저장용량</th><th>플랜</th></tr></thead><tbody>
      ${usage.length ? usage.map((u) => `<tr><td>${esc(u.name)}</td><td>${u.members}명</td><td>${u.media_count}개</td><td>${fmtBytes(u.storage)}</td><td>${esc((PLANS[u.plan] || PLANS.free).label)}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">데이터 없음</td></tr>`}
    </tbody></table></div>
    <p class="panel-hint">R2 무료 한도 10GB 기준 사용량입니다. 사진은 업로드 시 자동 축소(WebP)되어 저장됩니다.</p></section>`;
  const planOpts = (cur) => PLAN_KEYS.map((k) => `<option value="${k}"${k === cur ? " selected" : ""}>${esc(PLANS[k].label)}</option>`).join("");
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
        <form method="post" action="/super/application/${a.id}/approve" data-confirm="'${esc(a.assoc_name)}' 을(를) 승인하고 상인회·관리자 계정을 발급할까요?"><button class="btn btn-xs btn-primary">승인·발급</button></form>
        <form method="post" action="/super/application/${a.id}/reject" data-confirm="반려할까요? 목록에서 사라집니다."><button class="btn btn-xs btn-ghost">반려</button></form></div>
    </article>`;
  }).join("");
  const appsPanel = `<section class="panel panel-accent"><div class="panel-head"><h2 class="panel-title">영업 파이프라인 <span class="badge ${pendingApps.length ? "badge-wait" : "badge-muted"}">${pendingApps.length}건 진행</span>${dueSoon ? ` <span class="badge badge-no">연락할 때 ${dueSoon}건</span>` : ""}</h2></div>
    <p class="panel-hint">공개 신청(<a href="/apply" target="_blank">/apply</a>)으로 들어온 건과 직접 발굴한 상인회를 함께 관리합니다. 승인하면 홈과 관리자 계정이 바로 발급됩니다.</p>
    ${pendingApps.length ? `<div class="stage-strip">${Object.entries(SALES_STAGES).map(([k, v]) => `<span class="stage-chip stage-${k}">${esc(v)} <b>${stageCount(k)}</b></span>`).join("")}</div>
    <div class="lead-grid">${appCards}</div>` : `<p class="panel-hint">진행 중인 건이 없습니다.</p>`}
    <details class="lead-add"><summary class="btn btn-ghost btn-sm">＋ 직접 발굴한 상인회 추가</summary>
      <form method="post" action="/super/prospect" class="stack-form compact">
        <div class="form-two"><label>상인회 이름<input type="text" name="assoc_name" required maxlength="100" placeholder="예: 방배동 먹자골목 상인회" /></label>
          <label>담당자<input type="text" name="contact_name" maxlength="60" placeholder="예: 김회장" /></label></div>
        <div class="form-two"><label>이메일 (선택)<input type="email" name="contact_email" /></label>
          <label>연락처 (선택)<input type="text" name="contact_phone" maxlength="40" /></label></div>
        <label>메모<textarea name="message" rows="2" maxlength="2000" placeholder="어디서 알게 됐는지, 규모, 관심사 등"></textarea></label>
        <button class="btn btn-primary btn-sm">영업 목록에 추가</button></form></details></section>`;
  const rows = list.map((a) => `<tr><td><a href="/t/${esc(a.slug)}" target="_blank">${esc(a.name)}</a><br /><small>/t/${esc(a.slug)}</small>
      <ul class="admin-mini">${(adminsBy.get(a.id) || []).map((u) => `<li><span title="${esc(u.name)}">${esc(u.email)}</span>
        <form method="post" action="/super/admin/${u.id}/reset-password" data-confirm="${esc(u.email)} 의 임시 비밀번호를 발급할까요?&#10;기존 비밀번호는 즉시 무효가 됩니다."><button class="btn btn-xs btn-ghost" title="로그인이 안 될 때 임시 비밀번호를 발급합니다">임시 비번</button></form></li>`).join("") || `<li class="admin-none">관리자 계정 없음</li>`}</ul></td>
    <td><form method="post" action="/super/association/${a.id}/domain" class="domain-form">
      <input type="text" name="domain" value="${esc(a.custom_domain || "")}" placeholder="예: seocho-market.kr" />
      <button class="btn btn-xs btn-ghost">저장</button></form>
      ${a.custom_domain ? `<small class="domain-hint">✅ <a href="https://${esc(a.custom_domain)}" target="_blank">${esc(a.custom_domain)}</a></small>` : ""}
      <form method="post" action="/super/association/${a.id}/mapkey" class="domain-form" style="margin-top:4px" title="이 상인회만 다른 Maps 앱을 쓰게 할 때 (비우면 공용 키)">
      <input type="text" name="map_client_id" value="${esc(a.map_client_id || "")}" placeholder="지도 키(선택·공용이면 비움)" />
      <button class="btn btn-xs btn-ghost">저장</button></form></td>
    <td><form method="post" action="/super/association/${a.id}/plan" class="plan-form"><select name="plan">${planOpts(a.plan || "free")}</select><button class="btn btn-xs btn-ghost">변경</button></form></td>
    <td>${a.active ? '<span class="badge badge-ok">활성</span>' : '<span class="badge badge-no">비활성</span>'}
      ${(() => { const t = lastAct.get(a.id); if (!t) return `<small class="act-stamp is-cold">활동 없음</small>`;
        const days = Math.floor((Date.now() - Date.parse(t.includes("T") ? t : t.replace(" ", "T") + "Z")) / 86400000);
        return `<small class="act-stamp${days >= 30 ? " is-cold" : ""}" title="점포·공지·행사·게시글·서명을 통틀어 마지막으로 움직인 시각">${days <= 0 ? "오늘 활동" : `${days}일 전 활동`}</small>`; })()}</td>
    <td class="actions-cell"><a class="btn btn-xs btn-ghost" href="/t/${esc(a.slug)}/admin">관리</a>
      <form method="post" action="/super/association/${a.id}/toggle"><button class="btn btn-xs btn-ghost">${a.active ? "비활성화" : "활성화"}</button></form>
      <form method="post" action="/super/association/${a.id}/starter" data-confirm="'${esc(a.name)}' 에 시작 세트를 넣을까요?&#10;&#10;첫 공지 3건과 가입 동의서를 넣습니다. 이미 있는 것은 건드리지 않습니다."><button class="btn btn-xs btn-ghost" title="실전용 — 비어 있는 항목만 채웁니다(가짜 점포·회원 없음)">시작 세트</button></form>
      <span class="demo-cell">${demoSeeded.has(a.id)
        ? `<small class="demo-stamp" title="마지막으로 데모 콘텐츠를 채운 시각">✓ 데모 적용 ${esc(kstStamp(demoSeeded.get(a.id), { year: false }))}</small>`
        : `<small class="demo-stamp is-none">데모 미적용</small>`}
      <form method="post" action="/super/association/${a.id}/demo" data-confirm="'${esc(a.name)}' 을(를) 데모용 샘플 사이트로 채웁니다.&#10;&#10;⚠️ 이 상인회의 기존 점포·공지·행사·게시글이 모두 삭제되고 데모 콘텐츠로 대체됩니다. (다른 상인회는 영향 없음)&#10;&#10;계속할까요?"><button class="btn btn-xs btn-ghost" title="영업 소개용 샘플 콘텐츠(점포 25곳·메뉴·공지·행사·게시판·투표·전자서명)를 한 번에 채웁니다">${demoSeeded.has(a.id) ? "데모 다시 채우기" : "데모 채우기"}</button></form></span>
      <details class="danger-del"><summary class="btn btn-xs btn-ghost">삭제</summary>
        <form method="post" action="/super/association/${a.id}/delete" data-confirm="정말 '${esc(a.name)}' 을(를) 삭제할까요?&#10;&#10;⚠️ 점포·회원 계정·공지·게시글·서명 기록이 모두 사라지며 되돌릴 수 없습니다.">
          <p class="del-warn">되돌릴 수 없습니다. 확인용으로 주소 <code>${esc(a.slug)}</code> 를 입력하세요.</p>
          <input type="text" name="confirm_slug" placeholder="${esc(a.slug)}" required autocomplete="off" />
          <button class="btn btn-xs btn-danger">영구 삭제</button></form></details></td></tr>`).join("") || `<tr><td colspan="5" class="empty">상인회가 없습니다.</td></tr>`;
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">SUPER</p><h1 class="dash-title">플랫폼 관리</h1></div>
      <div class="dash-head-actions"><form method="post" action="/logout"><button class="btn btn-ghost btn-sm">로그아웃</button></form></div></div>${flashOf(query)}
    ${loadWarnings.length ? `<div class="flash flash-err"><b>일부 정보를 불러오지 못했습니다.</b> 나머지 기능은 그대로 쓰실 수 있습니다.<br />${loadWarnings.map((w) => esc(w)).join("<br />")}</div>` : ""}
    <div class="promo"><div class="promo-inner"><span class="mark" style="width:56px;height:56px;font-size:1.7rem;background:rgba(255,255,255,.18)">＋</span>
      <div><h2>새 상인회 사이트를 5분 만에</h2><p>클릭 한 번으로 상인회 홈·관리자 계정을 발급합니다. 운영 중 ${ps.associations}곳 · 가입 점포 ${ps.businesses}곳.</p></div>
      <a href="#new-assoc" class="btn btn-lg">새 사이트 만들기</a></div></div>
    ${appsPanel}
    <section class="panel"><h2 class="panel-title">플랫폼 설정</h2>
      <form method="post" action="/super/platform-mode" class="stack-form compact">
        <div class="row-toggle"><label class="switch"><input type="checkbox" name="on" value="1"${platformMode ? " checked" : ""} /><span class="track"></span></label>
          <span>루트(첫 화면)를 <b>플랫폼 소개 랜딩</b>으로 표시 <small style="color:var(--muted)">(끄면 상인회가 1곳일 때 그 홈으로 바로 이동)</small></span></div>
        <button class="btn btn-ghost btn-sm">저장</button></form>
      <div class="form-divider">플랫폼/운영자 정보 (약관·개인정보처리방침·푸터에 표시)</div>
      <form method="post" action="/super/platform-info" class="stack-form compact">
        <div class="form-two"><label>플랫폼/서비스명<input type="text" name="site_name" value="${esc(siteName)}" maxlength="60" /></label>
          <label>운영자(사업자)명<input type="text" name="operator" value="${esc(operator)}" maxlength="80" /></label></div>
        <div class="form-two"><label>문의 이메일<input type="email" name="contact_email" value="${esc(contactEmail)}" /></label>
          <label>문의 전화(선택)<input type="text" name="contact_phone" value="${esc(contactPhone)}" maxlength="40" /></label></div>
        <button class="btn btn-ghost btn-sm">정보 저장</button></form>
      <p class="panel-hint">공개 신청: <a href="/apply" target="_blank">/apply</a> · 약관: <a href="/terms" target="_blank">/terms</a> · 개인정보처리방침: <a href="/privacy" target="_blank">/privacy</a></p></section>
    <div class="stat-cards"><div class="stat-card"><span class="stat-num">${ps.associations}</span><span class="stat-label">상인회</span></div>
      <div class="stat-card"><span class="stat-num">${ps.businesses}</span><span class="stat-label">승인 업체</span></div>
      <div class="stat-card"><span class="stat-num">${ps.users}</span><span class="stat-label">사용자</span></div>
      <div class="stat-card"><span class="stat-num">${ps.media}</span><span class="stat-label">미디어</span></div></div>
    <section class="panel panel-accent" id="new-assoc"><h2 class="panel-title">➕ 새 상인회 (사이트 복제)</h2>
      <form method="post" action="/super/association" class="stack-form">
        <div class="form-two"><label>상인회 이름<input type="text" name="name" required /></label><label>대표 색상<input type="color" name="brand_color" value="#0b6e4f" /></label></div>
        <label>한 줄 소개<input type="text" name="tagline" /></label>
        <div class="form-divider">관리자 계정</div>
        <div class="form-two"><label>관리자 이름<input type="text" name="admin_name" /></label><label>관리자 이메일<input type="email" name="admin_email" required /></label></div>
        <label>관리자 비밀번호 (8자 이상)<input type="password" name="admin_password" required minlength="8" /></label>
        <button class="btn btn-primary">상인회 생성</button></form></section>
    <details class="panel ops-guide"><summary class="panel-title">🧭 운영 가이드 — 도메인·지도·이메일 설정 위치</summary>
      <div class="ops-body">
      <h3>네이버 지도 (도메인 바뀔 때마다!)</h3>
      <ol>
        <li><a href="https://console.ncloud.com" target="_blank" rel="noopener">네이버 클라우드 콘솔</a> → Maps → Application 목록 → 해당 앱 <b>[변경]</b></li>
        <li><b>Web 서비스 URL</b> 에 지도가 표시될 도메인을 <b>추가</b> (예: <code>https://website.tobe211167.workers.dev</code>, 개별 도메인 연결 시 그 도메인도)</li>
        <li>기존 주소는 지우지 말 것 — 미등록 도메인에선 지도가 "인증 실패" 회색 화면이 됩니다</li>
        <li>URL 은 앱당 <b>최대 10개</b> — 초과 시 Maps 앱을 하나 더 만들고, 아래 상인회 목록의 <b>지도 키</b> 칸에 새 앱의 Client ID 를 넣으면 그 상인회만 새 앱을 사용합니다</li>
        <li>사장님 대시보드의 <b>"주소로 찾기"</b>(주소→좌표 자동 변환)를 쓰려면 같은 Maps 앱에서 <b>Geocoding</b> 서비스도 체크해 주세요 — 미활성이어도 지도 클릭 방식은 그대로 동작합니다</li>
      </ol>
      <h3>개별 도메인 연결 (상인회 1곳당)</h3>
      <ol>
        <li>도메인을 이 Cloudflare 계정에 추가 (Domains → Add)</li>
        <li>Workers &amp; Pages → 이 워커 → Settings → <b>Domains &amp; Routes → Add → Custom Domain</b></li>
        <li>아래 상인회 목록의 <b>개별 도메인</b> 칸에 같은 도메인 입력·저장</li>
        <li>네이버 지도 사용 시 → 위의 Web 서비스 URL 에도 추가</li>
      </ol>
      <h3>이메일 자동 발송 (비번 재설정·입점 승인 메일)</h3>
      <ol>
        <li><a href="https://resend.com" target="_blank" rel="noopener">Resend</a> 가입 → API 키 발급 (무료 월 3,000통)</li>
        <li>Workers &amp; Pages → 이 워커 → Settings → Variables 에 <code>RESEND_API_KEY</code>(Secret), <code>MAIL_FROM</code> 등록</li>
        <li>미설정 시에도 사이트는 정상 — 수동 안내 방식으로 동작합니다</li>
      </ol>
      <h3>사진 직접 서빙 (설정 완료 ✓)</h3>
      <p>R2 버킷 공개 도메인(r2.dev) → 워커 변수 <code>MEDIA_PUBLIC_BASE</code>. 트래픽 커지면 커스텀 도메인으로 값만 교체.</p>
      </div></details>
    <section class="panel"><h2 class="panel-title">상인회 목록</h2>
      <p class="panel-hint">개별 도메인: 도메인을 입력·저장한 뒤 <b>Cloudflare 대시보드 → 이 워커 → Settings → Domains &amp; Routes → Add → Custom Domain</b> 으로 같은 도메인을 추가해야 실제 접속됩니다(그 도메인이 이 Cloudflare 계정에 등록되어 있어야 함).</p>
      <div class="table-scroll"><table class="admin-table">
      <thead><tr><th>상인회</th><th>개별 도메인</th><th>플랜</th><th>상태</th><th>관리</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    ${securityPanel}
    ${notifySuperPanel}
    ${settlementPanel}
    ${usagePanel}
    ${superPanel}
    ${wiredPanel}
    <section class="panel"><h2 class="panel-title">감사 로그 (플랫폼)</h2>
      <ul class="audit-list">${auditLog.length ? auditLog.map((a) => `<li><span class="audit-action">${esc(a.action)}</span> <span class="audit-detail">${esc(a.detail)}</span><span class="audit-meta">${esc(a.actor_name)} · ${esc(kstStamp(a.created_at, { year: false }))}</span></li>`).join("") : `<li class="empty">기록이 없습니다.</li>`}</ul></section></div></section>`;
  return html(layout({ title: "슈퍼 관리자", user, body, csrf }));
}

// ================= 계정 =================
export function account(ctx) {
  const { assoc, base, user, query, csrf } = ctx;
  // 2FA 상태별 UI
  let twofa;
  if (user.totp_enabled) {
    twofa = `<p class="panel-hint">✅ 2단계 인증이 <b>사용 중</b>입니다. 로그인 시 인증 앱의 6자리 코드가 필요합니다.</p>
      <form method="post" action="/account/2fa/disable" class="stack-form compact">
        <label>해제하려면 현재 인증 코드 입력<input type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" placeholder="000000" required /></label>
        <button class="btn btn-ghost btn-sm">2단계 인증 해제</button></form>`;
  } else if (user.totp_secret) {
    const uri = otpauthUri(user.totp_secret, user.email, assoc ? assoc.name : "상인회");
    twofa = `<p class="panel-hint">인증 앱(Google Authenticator, Authy 등)에 아래 키를 등록한 뒤, 앱에 표시된 6자리 코드를 입력해 <b>활성화</b>하세요.</p>
      <div class="totp-setup"><p>설정 키: <code class="totp-key">${esc(user.totp_secret)}</code></p>
      <details><summary>otpauth 링크(수동 등록용)</summary><code class="totp-uri">${esc(uri)}</code></details></div>
      <form method="post" action="/account/2fa/enable" class="stack-form compact">
        <label>앱에 표시된 6자리 코드<input type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" placeholder="000000" required /></label>
        <button class="btn btn-primary btn-sm">2단계 인증 활성화</button></form>
      <form method="post" action="/account/2fa/setup" class="stack-form compact"><button class="btn btn-ghost btn-xs">키 새로 생성</button></form>`;
  } else {
    twofa = `<p class="panel-hint">인증 앱으로 로그인을 한 단계 더 보호합니다. (관리자 계정 권장)</p>
      <form method="post" action="/account/2fa/setup"><button class="btn btn-primary btn-sm">2단계 인증 설정 시작</button></form>`;
  }
  // 슈퍼 콘솔 입구는 여기 둡니다 — 상인회 사이트 메뉴에 두면 그 상인회의 기능처럼 보입니다.
  const superLink = user.role === "SUPERADMIN"
    ? `<section class="panel panel-accent"><h2 class="panel-title">플랫폼 운영</h2>
        <p class="panel-hint">상인회 개설·영업 관리·사용량은 슈퍼 콘솔에서 봅니다. 상인회 홈페이지와는 별개의 화면입니다.</p>
        <a class="btn btn-primary btn-sm" href="/super">슈퍼 콘솔 열기</a></section>`
    : "";
  const body = `<section class="section page-top"><div class="container narrow">
    <h1 class="article-title">계정 설정</h1>${flashOf(query)}
    ${superLink}
    <section class="panel"><h2 class="panel-title">알림 받을 휴대폰</h2>
      <p class="panel-hint">서명 요청·공지를 카카오 알림톡으로 받습니다. 비워 두면 이메일로만 안내됩니다.</p>
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
    ${authHead("비밀번호 찾기", auto ? "가입한 이메일로 재설정 링크를 보내드립니다." : "가입한 이메일을 입력하면 상인회 관리자에게 재설정 요청이 전달됩니다.")}
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
      <label>상인회 이름<input type="text" name="assoc_name" required maxlength="100" placeholder="예: 서초구 상인회" /></label>
      <div class="form-divider">상인회 관리자 (ADMIN)</div>
      <label>관리자 이메일<input type="email" name="admin_email" required /></label>
      <label>관리자 비밀번호 (8자 이상)<input type="password" name="admin_password" required minlength="8" /></label>
      <div class="form-divider">슈퍼 관리자 (플랫폼 전체 · 사이트 복제 권한)</div>
      <label>슈퍼 이메일<input type="email" name="super_email" required /></label>
      <label>슈퍼 비밀번호 (8자 이상)<input type="password" name="super_password" required minlength="8" /></label>
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
    <span class="tc-band" style="background:linear-gradient(135deg,${safeColor(a.brand_color)},${safeColor(a.brand_color)}cc)"><span class="tc-glow" aria-hidden="true"></span></span>
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
  </div></section>
  <section class="section" id="features"><div class="container">
    <div class="section-head"><p class="section-eyebrow">FEATURES</p><h2 class="section-title">상인회에 필요한 모든 것</h2></div>
    <div class="feature-grid">
      ${[["🏪", "가입 점포 안내", "점포별 소개·사진·영상(유튜브·릴스 링크)"], ["🗺️", "점포 지도", "네이버 지도에 우리 상권 점포를 한눈에"], ["📢", "공지·소식", "카테고리·검색되는 공지 게시판"], ["💬", "회원 게시판", "회원 전용 소통·다중 사진"], ["✍️", "전자 동의서", "동의서·계약 전자서명(순차·검증)"], ["📱", "모바일 앱", "홈 화면 추가·설치형(PWA)"]].map(([i, t, d]) => `<div class="feature-card"><span class="feature-ico">${i}</span><h3>${t}</h3><p>${d}</p></div>`).join("")}
    </div></div></section>
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
  return html(layout({ title: "상인회 홈페이지 플랫폼", body, csrf, description: "상인회·번영회를 위한 홈페이지를 서버·개발 없이 5분 만에. 점포 안내·지도·공지·게시판·전자서명." }));
}

// 셀프 입점 신청 폼 (공개)
export function applyForm(ctx) {
  const { env, query, csrf } = ctx;
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    ${authHead("홈페이지 신청", "간단히 신청하면 검토 후 관리자 계정을 발급해 드립니다. (무료)")}${flashOf(query)}
    <form method="post" action="/apply" class="stack-form">
      <label>상인회·모임 이름<input type="text" name="assoc_name" required maxlength="100" placeholder="예: 강남시장 상인회" /></label>
      <label>담당자 성함<input type="text" name="contact_name" maxlength="60" /></label>
      <label>연락받을 이메일<input type="email" name="contact_email" required /></label>
      <label>연락처(선택)<input type="tel" name="contact_phone" maxlength="40" /></label>
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
    <h2>제1조 (목적)</h2><p>본 약관은 <b>${esc(info.siteName)}</b>(이하 "서비스")가 제공하는 상인회·소상공인 홈페이지 및 관련 기능의 이용 조건과 절차, 이용자와 운영자의 권리·의무를 규정함을 목적으로 합니다.</p>
    <h2>제2조 (정의)</h2><p>"이용자"란 서비스에 접속하여 이 약관에 따라 서비스를 이용하는 상인회·회원·방문자를 말합니다. "회원"이란 계정을 등록한 이용자를 말합니다.</p>
    <h2>제3조 (서비스의 제공)</h2><p>서비스는 점포 안내·지도, 공지·소식, 회원 게시판, 전자 동의서(전자서명) 등을 제공합니다. 운영자는 서비스 내용을 변경하거나 중단할 수 있으며, 중대한 변경 시 사전에 공지합니다.</p>
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
    <h2>1. 수집하는 개인정보 항목</h2><p>회원가입·입점신청 시 <b>이름, 이메일, 연락처, 점포 정보</b>를 수집합니다. 서비스 이용 과정에서 접속 IP·기기 정보·서비스 이용 기록이 자동 생성·수집될 수 있습니다. 전자서명 시 서명자·시각·IP·기기 정보가 기록됩니다.</p>
    <h2>2. 수집·이용 목적</h2><p>회원 식별 및 관리, 서비스 제공(점포 안내·공지·게시판·전자서명), 문의 응대, 부정 이용 방지를 위해 이용합니다.</p>
    <h2>3. 보유·이용 기간</h2><p>수집·이용 목적 달성 시 지체 없이 파기합니다. 다만 관련 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다. 회원 탈퇴 시 계정 정보는 삭제되며, 전자서명 기록은 법적 효력·분쟁 대비를 위해 별도 기간 보관될 수 있습니다.</p>
    <h2>4. 제3자 제공·처리위탁</h2><p>서비스는 원칙적으로 개인정보를 외부에 제공하지 않습니다. 지도(네이버) 및 영상(유튜브·인스타그램·네이버TV)은 이용자가 직접 링크·연동하는 외부 서비스이며, 해당 서비스의 정책이 적용됩니다. 서비스 인프라는 Cloudflare를 통해 운영됩니다.</p>
    <h2>5. 이용자의 권리</h2><p>이용자는 언제든지 본인의 개인정보 열람·정정·삭제·처리정지를 요청할 수 있으며, 계정 설정 또는 문의처를 통해 행사할 수 있습니다.</p>
    <h2>6. 안전성 확보 조치</h2><p>비밀번호는 복호화 불가능한 방식(PBKDF2)으로 저장하고, 통신은 HTTPS로 암호화합니다. 2단계 인증(2FA)을 제공합니다.</p>
    <h2>7. 개인정보 보호책임자·문의</h2><p>${esc(info.operator)}${info.email ? ` (이메일 ${esc(info.email)})` : ""}${info.phone ? ` (전화 ${esc(info.phone)})` : ""}</p>`;
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
    "/*.csv$", "/*.ics$",
  ].map((p) => `Disallow: ${p}`).join("\n");
  return text(`User-agent: *\nAllow: /\n${disallow}\nSitemap: ${o}/sitemap.xml\n`);
}
