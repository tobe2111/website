// 공개/인증 페이지 핸들러 (async). ctx = { env, db, assoc, base, user, url, query, csrf, params }
import * as D from "./db.js";
import { esc, clip, openBadge, fmtBytes } from "./util.js";
import { layout, flash, statusBadge, pager, mediaUrl, STOREFRONT_SVG } from "./render.js";
import { html, notFoundResponse, back } from "./http.js";
import { galleryItem } from "./media-render.js";
import { providerLabel } from "./embed.js";
import { verifySignature, publicKeyJwk, algorithm } from "./esign.js";
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
  "뷰티·건강": _ic('<circle cx="6.5" cy="7" r="2.5"/><circle cx="6.5" cy="17" r="2.5"/><path d="M8.7 8.5 20 20M8.7 15.5 20 4"/>'),
  "학원·교육": _ic('<path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 0 2 2h13"/><path d="M9 7h6"/>'),
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
function businessCard(base, b, cover) {
  const thumb = cover
    ? `<img src="${esc(mediaUrl(cover.thumb || cover.filename))}" alt="" loading="lazy" />`
    : `<span class="thumb-mono" aria-hidden="true">${esc(b.name.slice(0, 1))}</span>`;
  const open = openBadge(b.hours);
  return `<article class="market-card">
    <a href="${base}/business/${esc(b.slug)}" class="market-thumb${cover ? " has-img" : ""}">
      ${thumb}
      <span class="market-cat">${esc(b.category)}</span>
      ${open ? `<span class="market-open">${open}</span>` : ""}
    </a>
    <div class="market-body">
      <h3><a href="${base}/business/${esc(b.slug)}">${esc(b.name)}</a></h3>
      <p>${esc(b.description || "소개가 곧 등록됩니다.")}</p>
      ${b.address || b.phone ? `<ul class="market-meta">${b.address ? `<li>${PIN_SVG}${esc(b.address)}</li>` : ""}${b.phone ? `<li>${PHONE_SVG}${esc(b.phone)}</li>` : ""}</ul>` : ""}
    </div></article>`;
}

export async function home(ctx) {
  const { db, assoc, base, user, csrf } = ctx;
  const lay = parseLayout(assoc.home_layout, assoc.name);
  const { items } = await D.listBusinessesPaged(db, assoc.id, { perPage: 6 });
  const covers = await D.coverImagesFor(db, items.map((b) => b.id));
  const businessesHtml = items.map((b) => businessCard(base, b, covers.get(b.id))).join("") || `<p class="empty">등록된 점포가 곧 표시됩니다.</p>`;
  const notices = await D.listNotices(db, assoc.id, 5);
  const events = await D.listEvents(db, assoc.id, true);
  const stats = await D.stats(db, assoc.id);
  const cats = await D.distinctCategories(db, assoc.id);
  const catTiles = cats.length ? `<div class="cat-grid">${cats.map((c) => `<a class="cat-tile" href="${base}/businesses?category=${encodeURIComponent(c.category)}"><span class="cat-ico">${catIcon(c.category)}</span><span class="cat-name">${esc(c.category)}</span><span class="cat-count">${c.n}</span></a>`).join("")}<a class="cat-tile cat-all" href="${base}/businesses"><span class="cat-ico">${catIcon("전체")}</span><span class="cat-name">전체보기</span></a></div>` : "";
  const eventsHtml = events.length ? events.map((e) => {
    const d = e.event_date.slice(8, 10), mo = Number(e.event_date.slice(5, 7)) + "월";
    return `<article class="event-card"><div class="event-date"><span class="d">${d}</span><span class="m">${mo}</span></div>
      <div class="event-info"><h3>${esc(e.title)}</h3><p>${esc(e.description)}</p><span class="event-place">${PIN_SVG}${esc(e.place)}</span></div></article>`;
  }).join("") : `<p class="empty">예정된 행사가 없습니다.</p>`;
  const body = renderHome(lay, { assoc, base, stats, businessesHtml, catTiles, noticesHtml: noticeRows(base, notices), eventsHtml, loggedIn: !!user });
  return html(layout({ title: "", assoc, base, user, body, activeNav: `${base}/`, csrf, description: assoc.tagline }));
}

function layoutEditor(base, layoutArr) {
  const rows = layoutArr.map((sec, i) => {
    const cat = SECTION_CATALOG[sec.type];
    const fields = cat.fields.map((f) => {
      const val = sec[f.key], name = `f_${i}_${f.key}`;
      if (f.type === "bool") return `<label class="check"><input type="checkbox" name="${name}" value="1"${val ? " checked" : ""} /> ${esc(f.label)}</label>`;
      if (f.type === "textarea") return `<label class="mini-label">${esc(f.label)}<textarea name="${name}" rows="2">${esc(val || "")}</textarea></label>`;
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
  const page = parseInt(query.get("page") || "1", 10) || 1;
  const { items, total, page: cur, pages } = await D.listBusinessesPaged(db, assoc.id, { category: cat, q, page });
  const cats = await D.distinctCategories(db, assoc.id);
  const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) p.set(k, v); const s = p.toString(); return s ? "?" + s : ""; };
  const chips = `<a href="${base}/businesses${qs({ q })}" class="chip-filter${!cat ? " active" : ""}">전체</a>` +
    cats.map((c) => `<a href="${base}/businesses${qs({ category: c.category, q })}" class="chip-filter${cat === c.category ? " active" : ""}">${esc(c.category)} <em>${c.n}</em></a>`).join("");
  const covers = await D.coverImagesFor(db, items.map((b) => b.id));
  const cards = items.map((b) => businessCard(base, b, covers.get(b.id))).join("") || `<p class="empty">${q ? "검색 결과가 없습니다." : "등록된 점포가 없습니다."}</p>`;
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><p class="section-eyebrow">MEMBERS</p><h2 class="section-title">가입 점포 안내</h2><p class="section-lead">총 ${total}곳</p></div>
    <form method="get" action="${base}/businesses" class="board-search"><input type="search" name="q" value="${esc(q)}" placeholder="점포·업종 검색" /><button class="btn btn-ghost btn-sm">검색</button></form>
    <div class="chip-filters">${chips}</div>
    <div class="market-grid">${cards}</div>
    ${pager((i) => `${base}/businesses${qs({ category: cat, q, page: i })}`, cur, pages)}
  </div></section>`;
  return html(layout({ title: "가입 점포", assoc, base, user, body, activeNav: `${base}/businesses`, csrf }));
}

export async function businessDetail(ctx) {
  const { db, assoc, base, user, params, csrf } = ctx;
  const b = await D.getBusinessBySlug(db, assoc.id, params.slug);
  const canSee = b && (b.status === "approved" || (user && (user.id === b.owner_id || user.role === "SUPERADMIN" || (user.role === "ADMIN" && user.association_id === assoc.id))));
  if (!canSee) return notFoundResponse(ctx);
  const media = await D.listMedia(db, b.id);
  const images = media.filter((m) => m.kind === "image");
  const vids = media.filter((m) => m.kind === "video" || m.kind === "embed");
  const gallery = (arr) => arr.length ? `<div class="gallery">${arr.map((m) => galleryItem(m)).join("")}</div>` : "";
  const prods = await D.listProducts(db, b.id); // 공개: 비숨김만
  const productGrid = prods.length ? `<h2 class="biz-section-title">제품·메뉴</h2>
    <div class="product-grid">${prods.map((p) => `<figure class="product-card${p.sold_out ? " is-sold" : ""}">
      <div class="product-photo">${p.image ? `<img src="${esc(mediaUrl(p.image))}" alt="${esc(p.name)}" loading="lazy" />` : `<span class="product-noimg">${TAG_SVG}</span>`}${p.sold_out ? `<span class="product-sold">품절</span>` : ""}</div>
      <figcaption><div class="product-caption-top"><strong class="product-name">${esc(p.name)}</strong>${p.price ? `<span class="product-price">${esc(p.price)}</span>` : ""}</div>${p.description ? `<p class="product-desc">${esc(p.description)}</p>` : ""}</figcaption>
    </figure>`).join("")}</div>` : "";
  const pending = b.status !== "approved" ? `<div class="flash flash-warn">이 페이지는 ${statusBadge(b.status)} 상태입니다.</div>` : "";
  const body = `
  <section class="biz-hero"><div class="container">${pending}
    <span class="chip chip-light">${esc(b.category)}</span>${openBadge(b.hours)}<h1>${esc(b.name)}</h1>
    <p class="biz-desc">${esc(b.description || "소개가 곧 등록됩니다.")}</p>
    <ul class="biz-contact">
      ${b.address ? `<li>${PIN_SVG} ${esc(b.address)}</li>` : ""}${b.phone ? `<li>${PHONE_SVG} <a href="tel:${esc(b.phone)}">${esc(b.phone)}</a></li>` : ""}${b.hours ? `<li>${CLOCK_SVG} ${esc(b.hours)}</li>` : ""}
    </ul>
    <div class="biz-actions">
      <button type="button" class="btn btn-share" data-share data-share-title="${esc(b.name)} — ${esc(assoc.name)}">${SHARE_SVG} 가게 공유하기</button>
    </div></div></section>
  <section class="section"><div class="container">
    ${productGrid}
    ${images.length ? `<h2 class="biz-section-title">사진</h2>${gallery(images)}` : ""}
    ${vids.length ? `<h2 class="biz-section-title">영상</h2>${gallery(vids)}` : ""}
    ${!media.length && !prods.length ? `<p class="empty">아직 등록된 제품·사진이 없습니다.</p>` : ""}
    <div class="section-more"><a href="${base}/businesses" class="btn btn-ghost btn-sm">← 다른 점포 보기</a></div>
  </div></section>`;
  const cover = images[0] || null; // 카톡 공유 미리보기용 대표 사진
  return html(layout({ title: b.name, assoc, base, user, body, activeNav: `${base}/businesses`, csrf,
    description: clip(b.description) || `${assoc.name} · ${b.category} · ${b.name}`,
    ogImage: cover ? (cover.thumb || cover.filename) : "",
    scripts: `${media.length ? `<script src="/js/viewer.js" defer></script>` : ""}<script src="/js/share.js" defer></script>` }));
}

export function loginForm(ctx) {
  const { env, query, csrf } = ctx;
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    ${authHead("로그인", "상인회 회원·관리자 로그인")}
    ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", query.get("err") ? "err" : "ok")}
    <form method="post" action="/login" class="stack-form">
      <label>이메일<input type="email" name="email" required /></label>
      <label>비밀번호<input type="password" name="password" required /></label>
      <label class="totp-login">2단계 인증 코드 <small>(설정한 경우만)</small><input type="text" name="totp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" placeholder="000000" /></label>
      ${turnstileWidget(env)}
      <button class="btn btn-primary btn-block">로그인</button>
    </form>
    <p class="auth-note"><a href="/forgot">비밀번호를 잊으셨나요?</a></p></div></div></section>`;
  return html(layout({ title: "로그인", assoc: ctx.assoc, base: ctx.base, body, csrf, scripts: turnstileScript(env) }));
}

const flashOf = (q) => flash(q.get("msg") ? decodeURIComponent(q.get("msg")) : "", q.get("err") ? "err" : "ok");
// 디자인 v2: 인증 카드 브랜드 아이콘 헤더
const authHead = (title, sub) => `<div class="auth-head"><span class="mark auth-mark">${STOREFRONT_SVG}</span><h1 class="auth-title">${esc(title)}</h1><p class="auth-sub">${esc(sub)}</p></div>`;

// ================= 점포 지도 =================
export async function mapPage(ctx) {
  const { db, env, assoc, base, user, query, csrf } = ctx;
  const cat = query.get("category");
  let markers = await D.listBusinessMarkers(db, assoc.id);
  if (cat) markers = markers.filter((m) => m.category === cat);
  const cats = await D.distinctCategories(db, assoc.id);
  const naver = env.NAVER_MAP_CLIENT_ID;
  const chips = `<a href="${base}/map" class="chip-filter${!cat ? " active" : ""}">전체</a>` +
    cats.map((c) => `<a href="${base}/map?category=${encodeURIComponent(c.category)}" class="chip-filter${cat === c.category ? " active" : ""}">${esc(c.category)}</a>`).join("");
  const listRows = markers.length ? markers.map((m) => `<li class="map-store" data-lat="${m.lat}" data-lng="${m.lng}">
      <a href="${base}/business/${esc(m.slug)}" class="map-store-name">${esc(m.name)}</a><span class="chip">${esc(m.category)}</span>
      ${m.address ? `<span class="map-store-addr">${PIN_SVG} ${esc(m.address)}</span>` : ""}
      <a class="map-store-link" href="https://map.naver.com/p/search/${encodeURIComponent(m.address || m.name)}" target="_blank" rel="noopener">네이버 지도에서 열기 →</a></li>`).join("")
    : `<li class="empty">지도에 표시할 좌표가 등록된 점포가 없습니다.</li>`;
  const mapEl = naver
    ? `<div id="storeMap" class="store-map" data-center-lat="${assoc.map_lat}" data-center-lng="${assoc.map_lng}" data-zoom="${assoc.map_zoom}" data-base="${esc(base)}"></div>`
    : `<div class="map-fallback"><p>🗺️ 인터랙티브 지도는 관리자가 네이버 지도 키를 설정하면 표시됩니다. 아래 목록에서 각 점포의 네이버 지도를 열 수 있습니다.</p></div>`;
  const loader = naver ? `<script src="https://oapi.map.naver.com/openapi/v3/maps.js?${esc(env.NAVER_MAP_PARAM || "ncpClientId")}=${esc(naver)}"></script><script src="/js/map.js" defer></script>` : "";
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
function noticeRows(base, list) {
  return list.length ? list.map((n) => `<li><a href="${base}/notices/${n.id}">
    ${n.image ? `<img class="notice-ico notice-thumb-img" src="${esc(mediaUrl(n.image))}" alt="" loading="lazy" />` : `<span class="notice-ico${n.pinned ? " is-pinned" : ""}">${BELL_SVG}</span>`}
    <span class="notice-main">
      <span class="notice-title">${n.pinned ? '<em class="pin-mini">고정</em>' : ""}${esc(n.title)}</span>
      <span class="notice-meta">${esc(n.tag)} · ${esc(n.created_at.slice(0, 10).replace(/-/g, "."))}</span>
    </span>
    <span class="notice-chev">${CHEV_SVG}</span></a></li>`).join("")
    : `<li class="empty">등록된 공지가 없습니다.</li>`;
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
  return html(layout({ title: "공지사항", assoc, base, user, body, activeNav: `${base}/notices`, csrf }));
}
export async function noticeDetail(ctx) {
  const { db, assoc, base, user, params, csrf } = ctx;
  const n = await D.getNotice(db, Number(params.id));
  if (!n || n.association_id !== assoc.id) return notFoundResponse(ctx);
  const body = `<section class="section page-top"><div class="container narrow">
    <a href="${base}/notices" class="back-link">← 공지 목록</a>
    <div class="article-head"><span class="notice-tag${n.pinned ? " tag-important" : ""}">${esc(n.tag)}</span><time>${esc(n.created_at.slice(0, 10).replace(/-/g, "."))}</time></div>
    <h1 class="article-title">${esc(n.title)}</h1>
    ${n.image ? `<img class="article-image" src="${esc(mediaUrl(n.image))}" alt="${esc(n.title)}" />` : ""}
    <div class="article-body">${esc(n.body).replace(/\n/g, "<br />")}</div></div></section>`;
  return html(layout({ title: n.title, assoc, base, user, body, activeNav: `${base}/notices`, csrf, description: clip(n.body) || n.title, ogImage: n.image || "" }));
}

// ================= 행사 =================
export async function events(ctx) {
  const { db, assoc, base, user, csrf } = ctx;
  const list = await D.listEvents(db, assoc.id);
  const cards = list.length ? list.map((e) => {
    const d = e.event_date.slice(8, 10), mo = Number(e.event_date.slice(5, 7)) + "월";
    return `<article class="event-card"><div class="event-date"><span class="d">${d}</span><span class="m">${mo}</span></div>
      <div class="event-info"><h3>${esc(e.title)}</h3><p>${esc(e.description)}</p><span class="event-place">${PIN_SVG}${esc(e.place)}</span></div></article>`;
  }).join("") : `<p class="empty">예정된 행사가 없습니다.</p>`;
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><p class="section-eyebrow">EVENTS</p><h2 class="section-title">행사·소식</h2></div>
    <div class="event-list">${cards}</div></div></section>`;
  return html(layout({ title: "행사", assoc, base, user, body, activeNav: `${base}/notices`, csrf }));
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
      <span class="board-meta">${esc(p.author_name || "(탈퇴)")} · ${esc(p.created_at.slice(0, 10).replace(/-/g, "."))}${p.comment_count ? ` · 💬 ${p.comment_count}` : ""}</span></li>`;
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
  return html(layout({ title: "회원 게시판", assoc, base, user, body, activeNav: `${base}/board`, csrf, scripts: `<script src="/js/upload-resize.js" defer></script>` }));
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
      <time>${esc(c.created_at.slice(0, 16).replace("T", " "))}</time>
      ${(mod || (user && c.author_id === user.id)) ? `<form method="post" action="${base}/board/${p.id}/comment/${c.id}/delete" data-confirm="댓글 삭제?"><button class="link-danger">삭제</button></form>` : ""}</div>
      <div class="comment-body">${esc(c.body).replace(/\n/g, "<br />")}</div></li>`).join("") : `<li class="empty">첫 댓글을 남겨보세요.</li>`;
  const body = `<section class="section page-top"><div class="container narrow">
    <a href="${base}/board" class="back-link">← 게시판</a>
    <div class="article-head">${p.pinned ? `<span class="notice-tag tag-important">고정</span>` : ""}<time>${esc(p.created_at.slice(0, 16).replace("T", " "))}</time></div>
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
  return html(layout({ title: p.title, assoc, base, user, body, activeNav: `${base}/board`, csrf, scripts: tiles ? `<script src="/js/viewer.js" defer></script>` : "" }));
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
  return html(layout({ title: "글 수정", assoc, base, user, body, activeNav: `${base}/board`, csrf, scripts: `<script src="/js/upload-resize.js" defer></script>` }));
}

// ================= 회원가입 =================
export function registerForm(ctx) {
  const { env, assoc, base, query, csrf } = ctx;
  const opts = CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    ${authHead(assoc.name + " 가입", "점포 정보를 등록하고 사진·소식을 공유하세요.")}${flashOf(query)}
    <form method="post" action="${base}/register" class="stack-form">
      <label>대표자 성함<input type="text" name="name" required maxlength="60" /></label>
      <label>이메일<input type="email" name="email" required /></label>
      <label>비밀번호 (8자 이상)<input type="password" name="password" required minlength="8" /></label>
      <label>점포명<input type="text" name="business_name" required maxlength="100" /></label>
      <label>업종<select name="category">${opts}</select></label>
      <label class="check"><input type="checkbox" name="agree" value="1" required /> <a href="/privacy" target="_blank">개인정보 수집·이용</a>에 동의합니다.</label>
      ${turnstileWidget(env)}
      <button class="btn btn-primary btn-block">가입 신청</button>
    </form><p class="auth-note">가입 후 관리자 승인 시 일반에 공개됩니다.</p></div></div></section>`;
  return html(layout({ title: "가입", assoc, base, body, csrf, scripts: turnstileScript(env) }));
}

// ================= 대시보드 (내 업체) =================
export async function dashboard(ctx) {
  const { db, env, assoc, base, user, query, csrf } = ctx;
  const b = await D.getBusinessByOwner(db, user.id);
  if (!b || b.association_id !== assoc.id) return html(layout({ title: "대시보드", assoc, base, user, body: `<section class="section page-top"><div class="container"><p class="empty">연결된 업체가 없습니다.</p></div></section>`, csrf }));
  const media = await D.listMedia(db, b.id);
  const products = await D.listProducts(db, b.id, { includeHidden: true });
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
  const productPanel = `<section class="panel"><div class="panel-head"><h2 class="panel-title">제품·메뉴 진열 <span class="badge badge-muted">${products.length}/${prodMax}</span></h2></div>
    <p class="panel-hint">가게에서 파는 제품·메뉴를 사진과 함께 진열합니다. <strong>전시 전용</strong>이라 결제·주문 기능은 없습니다.</p>
    <div class="prod-list">${productRows}</div>
    <h3 class="panel-subtitle">제품 추가</h3>
    <form method="post" action="${base}/dashboard/products" enctype="multipart/form-data" class="stack-form compact">
      <label class="file-drop"><input type="file" name="image" accept="image/*" /><span class="file-drop-text">📷 제품 사진 (선택·최대 8MB)</span></label>
      <div class="form-two"><label>제품 이름<input name="name" required /></label><label>가격 <small>(선택)</small><input name="price" placeholder="예: 8,000원 · 시가 · 미표기" /></label></div>
      <label>한 줄 설명 <small>(선택)</small><input name="description" maxlength="300" /></label>
      <button class="btn btn-primary btn-sm">제품 추가</button></form></section>
    <section class="panel"><h2 class="panel-title">가게 QR 코드</h2>
      <p class="panel-hint">인쇄해서 계산대·출입문에 붙여보세요. 손님이 스캔하면 우리 가게 페이지가 열립니다.</p>
      <div id="qrWidget" class="qr-widget" data-url="${base}/business/${esc(b.slug)}" data-name="${esc(b.name)}">
        <div class="qr-img" aria-label="가게 QR 코드"></div>
        <div class="qr-actions">
          <button type="button" class="btn btn-primary btn-sm" data-qr-png>PNG 저장 (인쇄용)</button>
          <button type="button" class="btn btn-ghost btn-sm" data-qr-copy>링크 복사</button>
        </div>
      </div></section>`;
  const opts = CATEGORIES.map((c) => `<option value="${esc(c)}"${c === b.category ? " selected" : ""}>${esc(c)}</option>`).join("");
  const grid = media.length ? media.map((m) => `<figure class="media-tile">${galleryItem(m, { showCaption: false })}<figcaption>
      <span class="media-kind">${m.kind === "image" ? "🖼 사진" : (m.kind === "embed" ? "🎬 " + esc(providerLabel(m.provider)) : "🎬 영상")}</span>
      <form method="post" action="${base}/dashboard/media/${m.id}/delete" data-confirm="삭제?"><button class="link-danger">삭제</button></form></figcaption></figure>`).join("") : `<p class="empty">아직 등록한 사진·영상이 없습니다.</p>`;
  const naver = env.NAVER_MAP_CLIENT_ID;
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">MY BUSINESS</p><h1 class="dash-title">${esc(b.name)} ${statusBadge(b.status)}</h1>
      <p class="dash-sub">공개 주소: <a href="${base}/business/${esc(b.slug)}" target="_blank">${base}/business/${esc(b.slug)}</a></p></div>
      <div class="dash-head-actions"><a href="${base}/sign" class="btn btn-ghost btn-sm">전자서명</a></div></div>
    ${flashOf(query)}
    <div class="dash-grid">
      <section class="panel"><h2 class="panel-title">업체 정보</h2>
        <form method="post" action="${base}/dashboard/business" class="stack-form">
          <label>업체명<input type="text" name="name" value="${esc(b.name)}" required /></label>
          <label>업종<select name="category">${opts}</select></label>
          <label>소개<textarea name="description" rows="4">${esc(b.description)}</textarea></label>
          <div class="form-two"><label>전화<input type="tel" name="phone" value="${esc(b.phone)}" /></label><label>영업시간<input type="text" name="hours" value="${esc(b.hours)}" /></label></div>
          <label>주소<input type="text" name="address" value="${esc(b.address)}" /></label>
          <div class="form-divider">지도 위치</div>
          ${naver ? `<div id="pickMap" class="pick-map" data-center-lat="${b.lat ?? assoc.map_lat}" data-center-lng="${b.lng ?? assoc.map_lng}" data-zoom="16"></div><p class="panel-hint">지도를 클릭하면 좌표가 입력됩니다.</p>` : `<p class="panel-hint">위도·경도를 입력하면 지도에 표시됩니다.</p>`}
          <div class="form-two"><label>위도<input type="text" inputmode="decimal" name="lat" id="latInput" value="${b.lat != null ? esc(String(b.lat)) : ""}" /></label><label>경도<input type="text" inputmode="decimal" name="lng" id="lngInput" value="${b.lng != null ? esc(String(b.lng)) : ""}" /></label></div>
          <button class="btn btn-primary">정보 저장</button></form></section>
      <section class="panel"><h2 class="panel-title">사진 업로드</h2>
        <form method="post" action="${base}/dashboard/media" enctype="multipart/form-data" class="upload-form">
          <label class="file-drop"><input type="file" name="files" accept="image/*" multiple /><span class="file-drop-text">📁 사진 선택 (최대 8MB)</span></label>
          <input type="text" name="caption" placeholder="설명 (선택)" class="caption-input" />
          <button class="btn btn-primary btn-block">업로드</button></form>
        <h3 class="panel-subtitle">🎬 영상 링크 추가</h3>
        <p class="panel-hint">유튜브·쇼츠·인스타 릴스·네이버TV 주소를 붙여넣으세요.</p>
        <form method="post" action="${base}/dashboard/media/embed" class="stack-form compact">
          <input type="url" name="url" placeholder="영상 주소(링크)" required /><input type="text" name="caption" placeholder="설명 (선택)" maxlength="200" />
          <button class="btn btn-primary btn-sm">영상 링크 추가</button></form>
        <h3 class="panel-subtitle">등록된 미디어 (${media.length})</h3><div class="media-grid">${grid}</div></section>
    </div>
    ${productPanel}
    </div></section>`;
  const picker = naver ? `<script src="https://oapi.map.naver.com/openapi/v3/maps.js?${esc(env.NAVER_MAP_PARAM || "ncpClientId")}=${esc(naver)}"></script><script src="/js/map.js" defer></script>` : "";
  return html(layout({ title: "내 업체 관리", assoc, base, user, body, csrf, scripts: `<script src="/js/viewer.js" defer></script><script src="/js/upload-resize.js" defer></script><script src="/js/qr.js" defer></script><script src="/js/qr-widget.js" defer></script>${picker}` }));
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
  const s = await D.stats(db, assoc.id);
  const all = await D.listAllBusinesses(db, assoc.id);
  const notices = await D.listNotices(db, assoc.id);
  const events = await D.listEvents(db, assoc.id);
  const members = await D.listUsersByAssociation(db, assoc.id, "MERCHANT");
  const notifs = await D.listNotifications(db, assoc.id, 15);
  const unread = await D.unreadCount(db, assoc.id);
  const today = new Date().toISOString().slice(0, 10);
  const lay = parseLayout(assoc.home_layout, assoc.name);
  const auditLog = await D.listAudit(db, assoc.id, 12);
  const met = await D.engagementMetrics(db, assoc.id);
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
  const assocProducts = await D.listAssocProducts(db, assoc.id);
  const productModPanel = assocProducts.length ? `<section class="panel"><h2 class="panel-title">제품 진열 관리 <span class="badge badge-muted">${assocProducts.length}</span></h2>
    <p class="panel-hint">부적절한 제품은 숨길 수 있습니다. (사장님 화면에는 '관리자 숨김'으로 표시됩니다)</p>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>제품</th><th>점포</th><th>상태</th><th>처리</th></tr></thead><tbody>
    ${assocProducts.map((p) => `<tr><td>${esc(p.name)}${p.price ? `<br /><small>${esc(p.price)}</small>` : ""}</td>
      <td><a href="${base}/business/${esc(p.biz_slug)}" target="_blank">${esc(p.biz_name)}</a></td>
      <td>${p.hidden ? '<span class="badge badge-neutral">숨김</span>' : (p.sold_out ? '<span class="badge badge-no">품절</span>' : '<span class="badge badge-ok">노출</span>')}</td>
      <td class="actions-cell"><form method="post" action="${base}/admin/product/${p.id}/hide"><button class="btn btn-xs btn-ghost">${p.hidden ? "다시 노출" : "숨기기"}</button></form></td></tr>`).join("")}
    </tbody></table></div></section>` : "";
  const auditPanel = `<section class="panel"><h2 class="panel-title">감사 로그 <span class="badge badge-muted">최근 ${auditLog.length}</span></h2>
    <ul class="audit-list">${auditLog.length ? auditLog.map((a) => `<li><span class="audit-action">${esc(a.action)}</span> <span class="audit-detail">${esc(a.detail)}</span><span class="audit-meta">${esc(a.actor_name)} · ${esc(a.created_at.slice(5, 16).replace("T", " "))}</span></li>`).join("") : `<li class="empty">기록이 없습니다.</li>`}</ul></section>`;

  const bizRows = all.length ? all.map((b) => `<tr><td><a href="${base}/business/${esc(b.slug)}" target="_blank">${esc(b.name)}</a><br /><small>${esc(b.category)}</small></td>
    <td>${esc(b.owner_name)}<br /><small>${esc(b.owner_email)}</small></td><td>${statusBadge(b.status)}</td>
    <td class="actions-cell">${b.status !== "approved" ? `<form method="post" action="${base}/admin/business/${b.id}/status"><input type="hidden" name="status" value="approved"><button class="btn btn-xs btn-primary">승인</button></form>` : ""}
      ${b.status !== "rejected" ? `<form method="post" action="${base}/admin/business/${b.id}/status"><input type="hidden" name="status" value="rejected"><button class="btn btn-xs btn-ghost">반려</button></form>` : ""}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">등록된 업체가 없습니다.</td></tr>`;
  const memberRows = members.length ? members.map((m) => `<tr><td>${esc(m.name)}<br /><small>${esc(m.email)}</small></td><td>${esc(m.business_name || "-")}</td>
    <td class="actions-cell"><form method="post" action="${base}/admin/user/${m.id}/reset-password" data-confirm="임시 비밀번호를 발급할까요?"><button class="btn btn-xs btn-ghost">임시 비밀번호</button></form></td></tr>`).join("") : `<tr><td colspan="3" class="empty">회원이 없습니다.</td></tr>`;
  const noticeRows2 = notices.map((n) => `<li><span class="notice-tag${n.pinned ? " tag-important" : ""}">${esc(n.tag)}</span><span class="notice-title">${esc(n.title)}</span>
    <form method="post" action="${base}/admin/notice/${n.id}/delete" data-confirm="삭제?"><button class="link-danger">삭제</button></form></li>`).join("") || `<li class="empty">공지가 없습니다.</li>`;
  const eventRows = events.map((e) => `<li><span class="event-mini-date">${esc(e.event_date)}</span><span class="notice-title">${esc(e.title)}</span>
    <form method="post" action="${base}/admin/event/${e.id}/delete" data-confirm="삭제?"><button class="link-danger">삭제</button></form></li>`).join("") || `<li class="empty">행사가 없습니다.</li>`;
  const notifRows = notifs.length ? notifs.map((n) => `<li class="${n.is_read ? "" : "unread"}"><span class="notif-dot"></span><a href="${esc(n.link || base + "/admin")}" class="notif-msg">${esc(n.message)}</a><time>${esc(n.created_at.slice(5, 16).replace("T", " "))}</time></li>`).join("") : `<li class="empty">알림이 없습니다.</li>`;
  const noticeCats = NOTICE_CATEGORIES.map((c) => `<option value="${esc(c)}"${c === "안내" ? " selected" : ""}>${esc(c)}</option>`).join("");

  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">ADMIN · ${esc(assoc.name)}</p><h1 class="dash-title">관리자 대시보드</h1>
      <p class="dash-sub">홈페이지: <a href="${base}" target="_blank">${base}</a></p></div>
      <div class="dash-head-actions"><a href="${base}/admin/documents" class="btn btn-ghost btn-sm">전자서명 문서</a></div></div>
    ${flashOf(query)}
    <div class="console-grid">
    <aside class="console-side"><nav>
      <a href="#p-stats">${SIDE_SVG.stats} 현황</a><a href="#p-notif">${SIDE_SVG.bell} 알림함${unread ? ` <span class="side-badge">${unread}</span>` : ""}</a>
      <a href="#p-members">${SIDE_SVG.users} 회원</a><a href="#p-biz">${SIDE_SVG.store} 업체 승인${s.pending ? ` <span class="side-badge">${s.pending}</span>` : ""}</a>
      <a href="#p-products">${SIDE_SVG.tag} 제품</a><a href="#p-home">${SIDE_SVG.home} 홈 구성</a><a href="#p-brand">${SIDE_SVG.palette} 브랜딩</a><a href="#p-content">${SIDE_SVG.mega} 공지·행사</a>
      <a href="${base}/admin/documents" class="side-ext">${SIDE_SVG.sign} 전자서명 문서</a><a href="${base}" target="_blank" class="side-ext">${SIDE_SVG.ext} 사이트 보기</a>
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
      <details class="help-box" style="margin-top:14px"><summary>사장님 대신 등록하기 (대행)</summary>
        <div class="help-body"><p class="help-lead">사장님이 직접 못 하실 때 총무가 대신 계정을 만들어 드립니다. 임시 비밀번호를 전달하세요. (대행 등록은 참여 계측에 '대행'으로 집계됩니다.)</p>
        <form method="post" action="${base}/admin/members/add" class="stack-form compact">
          <div class="form-two"><label>사장님 성함<input type="text" name="name" required /></label><label>이메일<input type="email" name="email" required /></label></div>
          <div class="form-two"><label>업체명<input type="text" name="business_name" required /></label><label>업종<input type="text" name="category" placeholder="예: 음식점" /></label></div>
          <button class="btn btn-primary btn-sm">대행 등록 + 임시 비번 발급</button></form></div></details></section>
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
        <form method="post" action="${base}/admin/event" class="stack-form compact">
          <input type="text" name="title" placeholder="행사명" required /><input type="date" name="event_date" required />
          <input type="text" name="place" placeholder="장소" /><textarea name="description" rows="2" placeholder="설명"></textarea>
          <button class="btn btn-primary btn-sm">등록</button></form>
        <ul class="admin-mini-list">${eventRows}</ul></section>
    </div>
    </div></div></div></section>`;
  return html(layout({ title: "관리자", assoc, base, user, body, activeNav: `${base}/admin`, csrf, scripts: `<script src="/js/layout-editor.js" defer></script><script src="/js/upload-resize.js" defer></script>` }));
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
    <span class="notice-title">${esc(d.title)}${d.ordered ? ' <span class="badge badge-info">순차</span>' : ""}${d.due_date ? ` <span class="badge badge-wait">~${esc(d.due_date)}</span>` : ""}</span><time>${esc(d.created_at.slice(0, 10).replace(/-/g, "."))}</time></a></li>`).join("") : `<li class="empty">서명할 문서가 없습니다.</li>`;
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
  const meta = `${d.ordered ? '<span class="badge badge-info">순차 서명</span>' : ""}${d.due_date ? `<span class="badge badge-wait">기한 ${esc(d.due_date)}</span>` : ""}`;
  if (!(await D.canSignNow(db, d, user.id))) {
    const wb = `<section class="section page-top"><div class="container narrow"><a href="${base}/sign" class="back-link">← 서명 목록</a>
      <h1 class="article-title">${esc(d.title)}</h1><p>${meta}</p><div class="doc-body">${docBody(d.body)}</div>
      <div class="flash flash-warn">순차 서명 문서입니다. 앞 순번의 서명이 완료되면 서명하실 수 있습니다.</div></div></section>`;
    return html(layout({ title: d.title, assoc, base, user, body: wb, csrf }));
  }
  const body = `<section class="section page-top"><div class="container narrow"><a href="${base}/sign" class="back-link">← 서명 목록</a>
    <h1 class="article-title">${esc(d.title)}</h1>${meta ? `<p>${meta}</p>` : ""}
    <div class="doc-body">${docBody(d.body)}</div><p class="doc-hash">문서 해시: <code>${esc(d.content_hash)}</code></p>${flashOf(query)}
    <form method="post" action="${base}/sign/${d.id}" class="stack-form sign-form" id="signForm">
      <label>서명<div class="sign-pad-wrap"><canvas id="signPad" class="sign-pad" width="600" height="200"></canvas><button type="button" class="btn btn-ghost btn-xs sign-clear" id="signClear">지우기</button></div></label>
      <input type="hidden" name="signature" id="signatureData" />
      <label>서명자 성명<input type="text" name="signer_name" value="${esc(user.name)}" required /></label>
      <label class="check"><input type="checkbox" name="consent" value="1" required /> 위 내용을 확인했으며 본인이 전자서명하는 데 동의합니다.</label>
      <button class="btn btn-primary btn-block" id="signSubmit">전자서명 제출</button></form>
    <p class="auth-note">서명 시 서명자·시각·IP·기기·문서해시가 기록되고 Ed25519 디지털 서명으로 봉인됩니다.</p></div></section>`;
  return html(layout({ title: `서명: ${d.title}`, assoc, base, user, body, csrf, scripts: `<script src="/js/sign.js" defer></script>` }));
}

export async function adminDocuments(ctx) {
  const { db, assoc, base, user, query, csrf } = ctx;
  const today = new Date().toISOString().slice(0, 10);
  const docs = await D.listDocuments(db, assoc.id);
  const rows = docs.length ? docs.map((d) => `<tr><td><a href="${base}/admin/documents/${d.id}">${esc(d.title)}</a>
    ${d.ordered ? '<span class="badge badge-info">순차</span>' : ""}${d.due_date ? `<span class="badge ${d.due_date < today ? "badge-no" : "badge-wait"}">기한 ${esc(d.due_date)}</span>` : ""}<br /><small>${esc(d.created_at.slice(0, 16).replace("T", " "))}</small></td>
    <td>${d.sign_count}명</td><td>${d.closed ? '<span class="badge badge-no">마감</span>' : '<span class="badge badge-ok">진행중</span>'}</td>
    <td class="actions-cell"><a class="btn btn-xs btn-ghost" href="${base}/admin/documents/${d.id}">보기</a>${d.closed ? "" : `<form method="post" action="${base}/admin/documents/${d.id}/close" data-confirm="마감할까요?"><button class="btn btn-xs btn-ghost">마감</button></form>`}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">문서가 없습니다.</td></tr>`;
  const members = await D.listUsersByAssociation(db, assoc.id, "MERCHANT");
  const checks = members.length ? members.map((m) => `<label class="check member-check"><input type="checkbox" name="members" value="${m.id}" /> ${esc(m.name)} <small>${esc(m.email)}</small></label>`).join("") : `<p class="empty">회원이 없습니다.</p>`;
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">E-SIGN · ${esc(assoc.name)}</p><h1 class="dash-title">전자서명 문서</h1>
      <p class="dash-sub"><a href="${base}/admin">← 관리자</a></p></div></div>${flashOf(query)}
    <section class="panel panel-accent"><h2 class="panel-title">➕ 서명 문서 만들기</h2>
      <form method="post" action="${base}/admin/documents" class="stack-form">
        <label>제목<input type="text" name="title" required placeholder="예: 2026 가입 동의서" /></label>
        <label>본문<textarea name="body" rows="8" required></textarea></label>
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
      <td><small>${esc(sig.signed_at.slice(0, 16).replace("T", " "))}<br />IP ${esc(sig.ip)}</small></td>
      <td>${badge}<br /><a href="/verify/${esc(sig.verify_code)}" target="_blank"><small>검증 ${esc(sig.verify_code.slice(0, 8))}…</small></a></td></tr>`; }).join("") : `<tr><td colspan="4" class="empty">아직 서명이 없습니다.</td></tr>`;
  const rc = await D.requestCounts(db, d.id);
  const reqStatus = await D.listRequestStatus(db, d.id);
  const pct = rc.total ? Math.round((rc.signed / rc.total) * 100) : 0;
  const nextTurn = d.ordered ? reqStatus.find((u) => !u.signed) : null;
  const reqPanel = rc.total ? `<section class="panel"><h2 class="panel-title">서명 현황 <span class="badge ${rc.signed === rc.total ? "badge-ok" : "badge-wait"}">${rc.signed}/${rc.total} (${pct}%)</span>${d.ordered ? ' <span class="badge badge-info">순차</span>' : ""}</h2>
    <div class="progress"><span style="width:${pct}%"></span></div>
    <ul class="req-list">${reqStatus.map((u) => `<li>${d.ordered ? `<span class="req-order">${u.sign_order}</span>` : ""}<span class="req-name">${esc(u.name)}</span> <small>${esc(u.email)}</small> ${u.signed ? '<span class="badge badge-ok">완료</span>' : (d.ordered ? (nextTurn && nextTurn.id === u.id ? '<span class="badge badge-wait">서명 차례</span>' : '<span class="badge badge-muted">대기</span>') : '<span class="badge badge-wait">미서명</span>')}</li>`).join("")}</ul>
    ${d.ordered && nextTurn ? `<p class="panel-hint">현재 <b>${esc(nextTurn.name)}</b>님 차례입니다.</p>` : ""}</section>` : `<section class="panel"><p class="panel-hint">전체 공개 문서(누구나 서명 가능).</p></section>`;
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">E-SIGN</p><h1 class="dash-title">${esc(d.title)} ${d.closed ? '<span class="badge badge-no">마감</span>' : ""}${d.ordered ? ' <span class="badge badge-info">순차</span>' : ""}${d.due_date ? `<span class="badge ${D.isPastDue(d) ? "badge-no" : "badge-wait"}">기한 ${esc(d.due_date)}</span>` : ""}</h1>
      <p class="dash-sub"><a href="${base}/admin/documents">← 문서 목록</a> · 서명 ${sigs.length}명</p></div>
      <div class="dash-head-actions"><button type="button" class="btn btn-ghost btn-sm" data-print>🖨 인쇄/PDF</button></div></div>
    ${reqPanel}
    <section class="panel"><h2 class="panel-title">문서 본문</h2><div class="doc-body">${docBody(d.body)}</div><p class="doc-hash">해시: <code>${esc(d.content_hash)}</code></p></section>
    <section class="panel"><h2 class="panel-title">서명 내역</h2><div class="table-scroll"><table class="admin-table">
      <thead><tr><th>서명자</th><th>서명</th><th>일시·IP</th><th>검증</th></tr></thead><tbody>${rows}</tbody></table></div></section></div></section>`;
  return html(layout({ title: d.title, assoc, base, user, body, csrf }));
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
      <tr><th>서명자</th><td>${esc(sig.signer_name)}</td></tr><tr><th>서명 시각</th><td>${esc(sig.signed_at)}</td></tr>
      <tr><th>봉인(Ed25519)</th><td>${v.sealOk ? "무결 ✅" : "손상 ❌"}</td></tr><tr><th>문서 본문</th><td>${v.contentOk ? "원본 일치 ✅" : "변경됨 ❌"}</td></tr>
      <tr><th>알고리즘</th><td>${esc(algorithm)}</td></tr></table></div>`;
  }
  const body = `<section class="section page-top"><div class="container narrow"><h1 class="article-title">전자서명 검증</h1>${inner}</div></section>`;
  return html(layout({ title: "서명 검증", body, csrf }));
}

// ================= 슈퍼관리자 =================
export async function superConsole(ctx) {
  const { db, user, query, csrf } = ctx;
  const ps = await D.platformStats(db);
  const list = await D.listAllAssociations(db);
  const auditLog = await D.listAudit(db, null, 15);
  const pendingApps = await D.listApplications(db, "pending");
  const usage = await D.usageByAssociation(db);
  const platformMode = (await D.getSetting(db, "platform_mode")) === "1";
  const siteName = (await D.getSetting(db, "site_name")) || "상인회 플랫폼";
  const operator = (await D.getSetting(db, "operator")) || "";
  const contactEmail = (await D.getSetting(db, "contact_email")) || "";
  const contactPhone = (await D.getSetting(db, "contact_phone")) || "";
  const usagePanel = `<section class="panel"><h2 class="panel-title">상인회별 사용량 <span class="badge badge-muted">R2 총 ${fmtBytes(ps.storage)}</span></h2>
    <div class="table-scroll"><table class="admin-table"><thead><tr><th>상인회</th><th>회원</th><th>미디어</th><th>저장용량</th><th>플랜</th></tr></thead><tbody>
      ${usage.length ? usage.map((u) => `<tr><td>${esc(u.name)}</td><td>${u.members}명</td><td>${u.media_count}개</td><td>${fmtBytes(u.storage)}</td><td>${esc((PLANS[u.plan] || PLANS.free).label)}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">데이터 없음</td></tr>`}
    </tbody></table></div>
    <p class="panel-hint">R2 무료 한도 10GB 기준 사용량입니다. 사진은 업로드 시 자동 축소(WebP)되어 저장됩니다.</p></section>`;
  const planOpts = (cur) => PLAN_KEYS.map((k) => `<option value="${k}"${k === cur ? " selected" : ""}>${esc(PLANS[k].label)}</option>`).join("");
  const appsPanel = `<section class="panel panel-accent"><h2 class="panel-title">입점 신청 <span class="badge ${pendingApps.length ? "badge-wait" : "badge-muted"}">${pendingApps.length}건 대기</span></h2>
    ${pendingApps.length ? `<div class="table-scroll"><table class="admin-table"><thead><tr><th>상인회</th><th>연락처</th><th>메모</th><th>처리</th></tr></thead><tbody>
      ${pendingApps.map((a) => `<tr><td>${esc(a.assoc_name)}<br /><small>${esc(a.created_at.slice(0, 10))}</small></td>
        <td>${esc(a.contact_name || "-")}<br /><small>${esc(a.contact_email)}${a.contact_phone ? " · " + esc(a.contact_phone) : ""}</small></td>
        <td><small>${esc(clip(a.message, 80))}</small></td>
        <td class="actions-cell"><form method="post" action="/super/application/${a.id}/approve" data-confirm="승인하고 상인회·관리자 계정을 발급할까요?"><button class="btn btn-xs btn-primary">승인·발급</button></form>
          <form method="post" action="/super/application/${a.id}/reject" data-confirm="반려할까요?"><button class="btn btn-xs btn-ghost">반려</button></form></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="panel-hint">대기 중인 신청이 없습니다. 공개 신청 주소: <a href="/apply" target="_blank">/apply</a></p>`}</section>`;
  const rows = list.map((a) => `<tr><td><a href="/t/${esc(a.slug)}" target="_blank">${esc(a.name)}</a><br /><small>/t/${esc(a.slug)}</small></td>
    <td><form method="post" action="/super/association/${a.id}/domain" class="domain-form">
      <input type="text" name="domain" value="${esc(a.custom_domain || "")}" placeholder="예: seocho-market.kr" />
      <button class="btn btn-xs btn-ghost">저장</button></form>
      ${a.custom_domain ? `<small class="domain-hint">✅ <a href="https://${esc(a.custom_domain)}" target="_blank">${esc(a.custom_domain)}</a></small>` : ""}</td>
    <td><form method="post" action="/super/association/${a.id}/plan" class="plan-form"><select name="plan">${planOpts(a.plan || "free")}</select><button class="btn btn-xs btn-ghost">변경</button></form></td>
    <td>${a.active ? '<span class="badge badge-ok">활성</span>' : '<span class="badge badge-no">비활성</span>'}</td>
    <td class="actions-cell"><a class="btn btn-xs btn-ghost" href="/t/${esc(a.slug)}/admin">관리</a>
      <form method="post" action="/super/association/${a.id}/toggle"><button class="btn btn-xs btn-ghost">${a.active ? "비활성화" : "활성화"}</button></form></td></tr>`).join("") || `<tr><td colspan="5" class="empty">상인회가 없습니다.</td></tr>`;
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">SUPER</p><h1 class="dash-title">플랫폼 관리</h1></div>
      <div class="dash-head-actions"><form method="post" action="/logout"><button class="btn btn-ghost btn-sm">로그아웃</button></form></div></div>${flashOf(query)}
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
    <section class="panel"><h2 class="panel-title">상인회 목록</h2>
      <p class="panel-hint">개별 도메인: 도메인을 입력·저장한 뒤 <b>Cloudflare 대시보드 → 이 워커 → Settings → Domains &amp; Routes → Add → Custom Domain</b> 으로 같은 도메인을 추가해야 실제 접속됩니다(그 도메인이 이 Cloudflare 계정에 등록되어 있어야 함).</p>
      <div class="table-scroll"><table class="admin-table">
      <thead><tr><th>상인회</th><th>개별 도메인</th><th>플랜</th><th>상태</th><th>관리</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    ${usagePanel}
    <section class="panel"><h2 class="panel-title">감사 로그 (플랫폼)</h2>
      <ul class="audit-list">${auditLog.length ? auditLog.map((a) => `<li><span class="audit-action">${esc(a.action)}</span> <span class="audit-detail">${esc(a.detail)}</span><span class="audit-meta">${esc(a.actor_name)} · ${esc(a.created_at.slice(5, 16).replace("T", " "))}</span></li>`).join("") : `<li class="empty">기록이 없습니다.</li>`}</ul></section></div></section>`;
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
  const body = `<section class="section page-top"><div class="container narrow">
    <h1 class="article-title">계정 설정</h1>${flashOf(query)}
    <section class="panel"><h2 class="panel-title">비밀번호 변경</h2>
      <form method="post" action="/account/password" class="stack-form">
        <label>현재 비밀번호<input type="password" name="current" required /></label>
        <label>새 비밀번호 (8자 이상)<input type="password" name="new" required minlength="8" /></label>
        <label>새 비밀번호 확인<input type="password" name="confirm" required /></label>
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
    <form method="post" action="/forgot" class="stack-form"><label>이메일<input type="email" name="email" required /></label>
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
  const cards = list.map((a) => `<a class="landing-assoc" href="${a.custom_domain ? "https://" + esc(a.custom_domain) : "/t/" + esc(a.slug)}">
    <span class="landing-assoc-logo" style="background:${esc(a.brand_color)}">${a.logo ? `<img src="${esc(mediaUrl(a.logo))}" alt="" />` : esc(a.name.slice(0, 1))}</span>
    <span class="landing-assoc-name">${esc(a.name)}</span></a>`).join("") || `<p class="empty">첫 상인회를 기다리고 있어요.</p>`;
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
  const add = (loc) => urls.push(`<url><loc>${esc(loc)}</loc></url>`);
  add(o + "/");
  for (const a of await D.listActiveAssociations(db)) {
    const base = `${o}/t/${encodeURIComponent(a.slug)}`;
    ["", "/businesses", "/map", "/notices", "/events"].forEach((p) => add(base + p));
    for (const b of await D.listBusinessesPaged(db, a.id, { perPage: 200 }).then((r) => r.items)) add(`${base}/business/${encodeURIComponent(b.slug)}`);
    for (const n of await D.listNotices(db, a.id, 200)) add(`${base}/notices/${n.id}`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
export function robots(ctx) {
  const o = originOf(ctx);
  return text(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /super\nDisallow: /dashboard\nSitemap: ${o}/sitemap.xml\n`);
}
