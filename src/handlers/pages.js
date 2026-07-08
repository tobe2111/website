// 서버 사이드 렌더링 페이지 핸들러 (GET) — 멀티테넌트
import { html, esc, redirect, send } from "../http.js";
import { layout, flash, statusBadge, hueFor } from "../render.js";
import { ROLES } from "../auth.js";
import * as M from "../models.js";
import * as A from "../associations.js";
import * as storage from "../storage.js";
import { parseLayout, defaultLayout, SECTION_CATALOG, renderHome } from "../homeLayout.js";
import { config } from "../config.js";
import { verifySignature } from "../esign.js";

// 테넌트의 절대/상대 베이스 URL (서브도메인 모드 지원). 호스트 간 이동(로그인 후 리다이렉트)에 사용.
export function tenantBase(assoc, req) {
  if (config.baseDomain) {
    const scheme = (req && req.headers["x-forwarded-proto"]) || config.publicScheme;
    return `${scheme}://${assoc.slug}.${config.baseDomain}`;
  }
  return `/t/${assoc.slug}`;
}

const CATEGORIES = ["음식점", "카페·디저트", "생활·서비스", "패션·잡화", "농수축산", "교육·문화", "기타"];
// 서버가 요청별로 assoc._base 를 주입 (서브도메인 모드는 "", 경로 모드는 "/t/:slug").
const baseOf = (assoc) => (assoc && assoc._base != null ? assoc._base : `/t/${assoc.slug}`);

// 절대 URL (SEO/OG용)
function origin(req) {
  const scheme = req.headers["x-forwarded-proto"] || (config.baseDomain ? config.publicScheme : "http");
  return `${scheme}://${req.headers.host || "localhost"}`;
}
const absUrl = (req, p) => origin(req) + p;
function absMedia(req, key) {
  if (!key) return "";
  const u = storage.publicUrl(key);
  return /^https?:\/\//.test(u) ? u : absUrl(req, u);
}
const clip = (s, n = 160) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

function mediaThumb(m) {
  const url = storage.publicUrl(m.filename);
  return m.kind === "video"
    ? `<video src="${url}" controls preload="metadata" playsinline></video>`
    : `<img src="${url}" alt="${esc(m.caption || "업체 사진")}" loading="lazy" />`;
}

// 뷰어(라이트박스)로 열리는 클릭 가능한 갤러리 타일. 세로/가로 자동 대응.
function galleryItem(m, { showCaption = true } = {}) {
  const url = storage.publicUrl(m.filename);
  const posterUrl = m.poster ? storage.publicUrl(m.poster) : "";
  const cap = esc(m.caption || "");
  let inner;
  if (m.kind === "video") {
    const thumb = posterUrl
      ? `<img src="${posterUrl}" alt="${cap || "영상 미리보기"}" loading="lazy" />`
      : `<video src="${url}#t=0.1" preload="metadata" muted playsinline></video>`;
    inner = `${thumb}<span class="play-badge" aria-hidden="true">▶</span>`;
  } else {
    inner = `<img src="${url}" alt="${cap || "업체 사진"}" loading="lazy" />`;
  }
  return `<button type="button" class="gallery-item${m.kind === "video" ? " is-video" : ""}" data-src="${url}" data-kind="${m.kind}" data-poster="${posterUrl}" data-caption="${cap}" aria-label="${cap || (m.kind === "video" ? "영상 보기" : "사진 보기")}">
    ${inner}${showCaption && cap ? `<figcaption>${cap}</figcaption>` : ""}</button>`;
}

function businessCard(assoc, b) {
  const base = baseOf(assoc);
  const hue = hueFor(b.category + b.name);
  const cover = M.listMedia(b.id).find((m) => m.kind === "image");
  const thumb = cover
    ? `<img src="${storage.publicUrl(cover.filename)}" alt="${esc(b.name)}" loading="lazy" />`
    : `<span>${esc(b.name.slice(0, 2))}</span>`;
  return `<article class="market-card">
    <a href="${base}/business/${esc(b.slug)}" class="market-thumb" style="--hue:${hue}">${thumb}</a>
    <div class="market-body">
      <span class="chip">${esc(b.category)}</span>
      <h3><a href="${base}/business/${esc(b.slug)}">${esc(b.name)}</a></h3>
      <p>${esc(b.description || "소개가 곧 등록됩니다.")}</p>
      <ul class="market-meta">${b.address ? `<li>📍 ${esc(b.address)}</li>` : ""}${b.phone ? `<li>☎ ${esc(b.phone)}</li>` : ""}</ul>
    </div></article>`;
}

function noticeRowsHtml(assoc, notices) {
  const base = baseOf(assoc);
  return notices.length
    ? notices
        .map(
          (n) => `<li><a href="${base}/notices/${n.id}">
        <span class="notice-tag${n.pinned ? " tag-important" : ""}">${esc(n.tag)}</span>
        <span class="notice-title">${esc(n.title)}</span>
        <time>${esc(n.created_at.slice(0, 10).replace(/-/g, "."))}</time></a></li>`
        )
        .join("")
    : `<li class="empty">등록된 공지가 없습니다.</li>`;
}
function eventCardsHtml(events) {
  return events.length
    ? events
        .map((e) => {
          const d = e.event_date.slice(8, 10), mo = Number(e.event_date.slice(5, 7)) + "월";
          return `<article class="event-card"><div class="event-date"><span class="d">${d}</span><span class="m">${mo}</span></div>
        <div class="event-info"><h3>${esc(e.title)}</h3><p>${esc(e.description)}</p>
        <span class="event-place">📍 ${esc(e.place)}</span></div></article>`;
        })
        .join("")
    : `<p class="empty">예정된 행사가 없습니다.</p>`;
}

// ================= 플랫폼 (테넌트 없음) =================
export function platformIndex(req, res) {
  const assocs = A.listActiveAssociations();
  const cards = assocs.length
    ? assocs
        .map((a) => {
          const hue = hueFor(a.name);
          const badge = a.logo
            ? `<span class="assoc-badge has-logo"><img src="${esc(storage.publicUrl(a.logo))}" alt="" /></span>`
            : `<span class="assoc-badge" style="background:${esc(a.brand_color)}">${esc(a.name.slice(0, 1))}</span>`;
          return `<a class="assoc-card" href="/t/${esc(a.slug)}" style="--hue:${hue}">
        ${badge}
        <h3>${esc(a.name)}</h3>
        <p>${esc(a.tagline)}</p>
        <span class="assoc-meta">등록 업체 ${a.biz_count}곳 →</span></a>`;
        })
        .join("")
    : `<p class="empty">아직 등록된 상인회가 없습니다.</p>`;

  const body = `
  <section class="hero"><div class="hero-bg" aria-hidden="true"></div>
    <div class="container hero-inner">
      <p class="hero-eyebrow">여러 상인회를 위한 웹사이트 플랫폼</p>
      <h1 class="hero-title">우리 동네 상권,<br /><span>하나의 플랫폼</span>에서</h1>
      <p class="hero-desc">각 상인회가 자신만의 홈페이지를 갖고 업체·공지·행사를 관리합니다. 아래에서 상인회를 선택하세요.</p>
    </div></section>
  <section class="section"><div class="container">
    <div class="section-head"><p class="section-eyebrow">ASSOCIATIONS</p>
      <h2 class="section-title">참여 상인회</h2></div>
    <div class="assoc-grid">${cards}</div>
  </div></section>`;
  html(res, layout({ title: "상인회 플랫폼", user: req.user, body }));
}

// ================= 테넌트 홈 =================
export function home(req, res, { assoc }) {
  const base = baseOf(assoc);
  const s = M.stats(assoc.id);
  const notices = M.listNotices(assoc.id, 5);
  const events = M.listEvents(assoc.id, true).slice(0, 3);
  const businesses = M.listBusinesses(assoc.id, {}).slice(0, 6);

  const layoutArr = parseLayout(assoc.home_layout, assoc.name);
  const bizHtml = businesses.length
    ? businesses.map((b) => businessCard(assoc, b)).join("")
    : `<p class="empty">등록된 업체가 없습니다. 첫 번째 업체가 되어보세요!</p>`;

  const body = renderHome(layoutArr, {
    assoc, base, stats: s,
    businessesHtml: bizHtml,
    noticesHtml: noticeRowsHtml(assoc, notices),
    eventsHtml: eventCardsHtml(events),
  });
  const canonical = absUrl(req, base + "/");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: assoc.name,
    description: assoc.tagline,
    url: canonical,
    logo: absMedia(req, assoc.logo) || undefined,
    telephone: assoc.phone || undefined,
    email: assoc.email || undefined,
    address: assoc.address ? { "@type": "PostalAddress", streetAddress: assoc.address, addressCountry: "KR" } : undefined,
  };
  html(res, layout({
    title: "홈", user: req.user, assoc, base, activeNav: base + "/", body,
    description: assoc.tagline, canonical, ogImage: absMedia(req, assoc.logo), jsonLd,
  }));
}

// 페이지 네비게이션 렌더러
function pager(urlFor, page, pages) {
  if (pages <= 1) return "";
  let out = '<nav class="pager" aria-label="페이지 이동">';
  out += page > 1 ? `<a class="pg" href="${urlFor(page - 1)}" rel="prev">‹ 이전</a>` : `<span class="pg disabled">‹ 이전</span>`;
  for (let i = 1; i <= pages; i++) {
    out += i === page ? `<span class="pg cur" aria-current="page">${i}</span>` : `<a class="pg" href="${urlFor(i)}">${i}</a>`;
  }
  out += page < pages ? `<a class="pg" href="${urlFor(page + 1)}" rel="next">다음 ›</a>` : `<span class="pg disabled">다음 ›</span>`;
  return out + "</nav>";
}
function qsBuild(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v != null && v !== "" && !(k === "page" && v === 1)) p.set(k, v);
  const s = p.toString();
  return s ? "?" + s : "";
}

// ================= 업체 목록 (검색 + 페이지네이션) =================
export function businesses(req, res, { assoc, query }) {
  const base = baseOf(assoc);
  const cat = query.get("category");
  const q = (query.get("q") || "").trim().slice(0, 60);
  const page = parseInt(query.get("page") || "1", 10) || 1;
  const { items, total, page: cur, pages } = M.listBusinessesPaged(assoc.id, { category: cat, q, page });
  const cats = M.distinctCategories(assoc.id);

  const filterChips =
    `<a href="${base}/businesses${qsBuild({ q })}" class="chip-filter${!cat ? " active" : ""}">전체</a>` +
    cats.map((c) => `<a href="${base}/businesses${qsBuild({ category: c.category, q })}" class="chip-filter${cat === c.category ? " active" : ""}">${esc(c.category)} <em>${c.n}</em></a>`).join("");

  const grid = items.length ? items.map((b) => businessCard(assoc, b)).join("")
    : `<p class="empty">${q ? `'${esc(q)}' 검색 결과가 없습니다.` : "해당 조건의 업체가 없습니다."}</p>`;
  const urlFor = (i) => `${base}/businesses${qsBuild({ category: cat, q, page: i })}`;

  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><p class="section-eyebrow">MEMBERS</p><h2 class="section-title">업체 안내</h2>
      <p class="section-lead">${esc(assoc.name)} 소속 업체 ${total}곳${q ? ` · '${esc(q)}' 검색` : ""}</p></div>
    <form class="search-bar" method="get" action="${base}/businesses" role="search">
      ${cat ? `<input type="hidden" name="category" value="${esc(cat)}" />` : ""}
      <input type="search" name="q" value="${esc(q)}" placeholder="업체명·소개·업종 검색" aria-label="업체 검색" />
      <button class="btn btn-primary btn-sm" type="submit">검색</button>
      ${q ? `<a class="btn btn-ghost btn-sm" href="${base}/businesses${qsBuild({ category: cat })}">초기화</a>` : ""}
    </form>
    <div class="chip-filters">${filterChips}</div>
    <div class="market-grid">${grid}</div>
    ${pager(urlFor, cur, pages)}
  </div></section>`;
  html(res, layout({ title: "업체 안내", user: req.user, assoc, base, activeNav: base + "/businesses", body }));
}

// ================= 업체 상세 =================
export function businessDetail(req, res, { assoc, params }) {
  const base = baseOf(assoc);
  const b = M.getBusinessBySlug(assoc.id, params.slug);
  const canSee = b && (b.status === "approved" || (req.user && (req.user.id === b.owner_id || req.user.role === ROLES.SUPERADMIN || (req.user.role === ROLES.ADMIN && req.user.association_id === assoc.id))));
  if (!canSee) return notFound(req, res, { assoc });
  const media = M.listMedia(b.id);
  const images = media.filter((m) => m.kind === "image");
  const videos = media.filter((m) => m.kind === "video");
  const hue = hueFor(b.category + b.name);
  const gallery = (items) => items.length
    ? `<div class="gallery">${items.map(galleryItem).join("")}</div>` : "";
  const pending = b.status !== "approved" ? `<div class="flash flash-warn">이 페이지는 ${statusBadge(b.status)} 상태입니다. 관리자 승인 후 일반에 공개됩니다.</div>` : "";
  const body = `
  <section class="biz-hero" style="--hue:${hue}"><div class="container">${pending}
    <span class="chip chip-light">${esc(b.category)}</span>
    <h1>${esc(b.name)}</h1>
    <p class="biz-desc">${esc(b.description || "소개가 곧 등록됩니다.")}</p>
    <ul class="biz-contact">
      ${b.address ? `<li><span aria-hidden="true">📍</span> ${esc(b.address)}</li>` : ""}
      ${b.phone ? `<li><span aria-hidden="true">☎️</span> <a href="tel:${esc(b.phone)}">${esc(b.phone)}</a></li>` : ""}
      ${b.hours ? `<li><span aria-hidden="true">🕘</span> ${esc(b.hours)}</li>` : ""}
    </ul></div></section>
  <section class="section"><div class="container">
    ${images.length ? `<h2 class="biz-section-title">사진</h2>${gallery(images)}` : ""}
    ${videos.length ? `<h2 class="biz-section-title">영상</h2>${gallery(videos)}` : ""}
    ${!media.length ? `<p class="empty">아직 등록된 사진·영상이 없습니다.</p>` : ""}
    <div class="section-more"><a href="${base}/businesses" class="btn btn-ghost btn-sm">← 다른 업체 보기</a></div>
  </div></section>`;
  const canonical = absUrl(req, `${base}/business/${b.slug}`);
  const cover = images[0] || null;
  const ogImage = cover ? absMedia(req, cover.filename) : absMedia(req, assoc.logo);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: b.name,
    description: clip(b.description, 300) || undefined,
    telephone: b.phone || undefined,
    address: b.address ? { "@type": "PostalAddress", streetAddress: b.address, addressCountry: "KR" } : undefined,
    image: ogImage || undefined,
    url: canonical,
    memberOf: { "@type": "Organization", name: assoc.name },
  };
  html(res, layout({
    title: b.name, user: req.user, assoc, base, activeNav: base + "/businesses", body,
    description: clip(b.description) || `${assoc.name} 소속 ${b.category} · ${b.name}`,
    ogImage, canonical, jsonLd,
    scripts: `<script src="/js/viewer.js" defer></script>`,
  }));
}

// ================= 점포 지도 =================
export function mapPage(req, res, { assoc, query }) {
  const base = baseOf(assoc);
  const cat = query.get("category");
  const markers = M.listBusinessMarkers(assoc.id).filter((m) => !cat || m.category === cat);
  const cats = M.distinctCategories(assoc.id);
  const naverEnabled = !!config.naverMapClientId;

  const markerData = markers.map((m) => ({
    name: m.name, slug: m.slug, category: m.category,
    lat: m.lat, lng: m.lng, address: m.address || "", phone: m.phone || "",
  }));

  const filterChips =
    `<a href="${base}/map" class="chip-filter${!cat ? " active" : ""}">전체</a>` +
    cats.map((c) => `<a href="${base}/map?category=${encodeURIComponent(c.category)}" class="chip-filter${cat === c.category ? " active" : ""}">${esc(c.category)}</a>`).join("");

  // 목록(폴백 + 프로그레시브): 지도 미지원/키 없음에도 항상 유용
  const listRows = markers.length
    ? markers.map((m) => `<li class="map-store" data-lat="${m.lat}" data-lng="${m.lng}">
        <a href="${base}/business/${esc(m.slug)}" class="map-store-name">${esc(m.name)}</a>
        <span class="chip">${esc(m.category)}</span>
        ${m.address ? `<span class="map-store-addr">📍 ${esc(m.address)}</span>` : ""}
        <a class="map-store-link" href="https://map.naver.com/p/search/${encodeURIComponent(m.address || m.name)}" target="_blank" rel="noopener">네이버 지도에서 열기 →</a>
      </li>`).join("")
    : `<li class="empty">지도에 표시할 좌표가 등록된 업체가 없습니다. (업체가 대시보드에서 위치를 지정하면 표시됩니다)</li>`;

  const mapEl = naverEnabled
    ? `<div id="storeMap" class="store-map"
         data-center-lat="${assoc.map_lat}" data-center-lng="${assoc.map_lng}" data-zoom="${assoc.map_zoom}"
         data-base="${esc(base)}"></div>`
    : `<div class="map-fallback"><p>🗺️ 인터랙티브 지도는 관리자가 <b>네이버 지도 API 키</b>를 설정하면 표시됩니다. 아래 목록에서 각 점포의 네이버 지도를 열 수 있습니다.</p></div>`;

  const naverLoader = naverEnabled
    ? `<script src="https://oapi.map.naver.com/openapi/v3/maps.js?${esc(config.naverMapParam)}=${esc(config.naverMapClientId)}"></script><script src="/js/map.js" defer></script>`
    : "";

  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><p class="section-eyebrow">MAP</p><h2 class="section-title">가입 점포 지도</h2>
      <p class="section-lead">${esc(assoc.name)} 가입 점포 ${markers.length}곳을 지도에서 확인하세요.</p></div>
    <div class="chip-filters">${filterChips}</div>
    ${mapEl}
    <ul class="map-list">${listRows}</ul>
    <script type="application/json" id="mapData">${JSON.stringify(markerData).replace(/</g, "\\u003c")}</script>
  </div></section>`;
  html(res, layout({ title: "점포 지도", user: req.user, assoc, base, activeNav: base + "/map", body, scripts: naverLoader }));
}

// ================= 공지 =================
export function notices(req, res, { assoc, query }) {
  const base = baseOf(assoc);
  const page = parseInt(query.get("page") || "1", 10) || 1;
  const { items, page: cur, pages } = M.listNoticesPaged(assoc.id, { page });
  const urlFor = (i) => `${base}/notices${qsBuild({ page: i })}`;
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><p class="section-eyebrow">NOTICE</p><h2 class="section-title">공지사항</h2></div>
    <ul class="notice-list">${noticeRowsHtml(assoc, items)}</ul>
    ${pager(urlFor, cur, pages)}</div></section>`;
  html(res, layout({ title: "공지사항", user: req.user, assoc, base, activeNav: base + "/notices", body }));
}
export function noticeDetail(req, res, { assoc, params }) {
  const base = baseOf(assoc);
  const n = M.getNotice(Number(params.id));
  if (!n || n.association_id !== assoc.id) return notFound(req, res, { assoc });
  const body = `<section class="section page-top"><div class="container narrow">
    <a href="${base}/notices" class="back-link">← 공지 목록</a>
    <div class="article-head"><span class="notice-tag${n.pinned ? " tag-important" : ""}">${esc(n.tag)}</span>
      <time>${esc(n.created_at.slice(0, 10).replace(/-/g, "."))}</time></div>
    <h1 class="article-title">${esc(n.title)}</h1>
    <div class="article-body">${esc(n.body).replace(/\n/g, "<br />")}</div></div></section>`;
  html(res, layout({ title: n.title, user: req.user, assoc, base, activeNav: base + "/notices", body }));
}

// ================= 행사 =================
export function events(req, res, { assoc }) {
  const base = baseOf(assoc);
  const list = M.listEvents(assoc.id);
  const cards = list.length
    ? list.map((e) => {
        const d = e.event_date.slice(8, 10), mo = Number(e.event_date.slice(5, 7)) + "월";
        return `<article class="event-card"><div class="event-date"><span class="d">${d}</span><span class="m">${mo}</span></div>
        <div class="event-info"><h3>${esc(e.title)}</h3><p>${esc(e.description)}</p>
        <span class="event-place">📍 ${esc(e.place)} · ${esc(e.event_date)}</span></div></article>`;
      }).join("")
    : `<p class="empty">등록된 행사가 없습니다.</p>`;
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><p class="section-eyebrow">EVENTS</p><h2 class="section-title">행사·이벤트</h2></div>
    <div class="event-grid">${cards}</div></div></section>`;
  html(res, layout({ title: "행사·이벤트", user: req.user, assoc, base, activeNav: base + "/events", body }));
}

// ================= 인증 폼 =================
export function loginForm(req, res, { query }) {
  if (req.user) return redirect(res, postLoginPath(req.user, req));
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    <h1 class="auth-title">로그인</h1><p class="auth-sub">상인회 회원·관리자 로그인</p>
    ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", query.get("err") ? "err" : "ok")}
    <form method="post" action="/login" class="stack-form">
      <label>이메일<input type="email" name="email" required autocomplete="email" placeholder="you@example.com" /></label>
      <label>비밀번호<input type="password" name="password" required autocomplete="current-password" /></label>
      <button type="submit" class="btn btn-primary btn-block">로그인</button>
    </form>
    <p class="auth-alt"><a href="/forgot">비밀번호를 잊으셨나요?</a> · <a href="/">상인회 목록</a></p>
  </div></div></section>`;
  html(res, layout({ title: "로그인", user: req.user, body }));
}

export function forgotForm(req, res, { query }) {
  if (req.user) return redirect(res, postLoginPath(req.user, req));
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    <h1 class="auth-title">비밀번호 찾기</h1>
    <p class="auth-sub">가입한 이메일을 입력하면 상인회 관리자에게 재설정 요청이 전달됩니다.</p>
    ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", query.get("err") ? "err" : "ok")}
    <form method="post" action="/forgot" class="stack-form">
      <label>이메일<input type="email" name="email" required autocomplete="email" placeholder="you@example.com" /></label>
      <button type="submit" class="btn btn-primary btn-block">재설정 요청</button>
    </form>
    <p class="auth-note">보안을 위해 관리자가 임시 비밀번호를 발급해 안내합니다. 로그인 후 <b>계정 → 비밀번호 변경</b>에서 바꿔 주세요.</p>
    <p class="auth-alt"><a href="/login">← 로그인으로</a></p>
  </div></div></section>`;
  html(res, layout({ title: "비밀번호 찾기", user: req.user, body }));
}

export function registerForm(req, res, { assoc, query }) {
  const base = baseOf(assoc);
  if (req.user) return redirect(res, postLoginPath(req.user, req));
  const opts = CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    <h1 class="auth-title">업체 등록</h1><p class="auth-sub">${esc(assoc.name)} 회원 가입 및 업체 페이지 개설</p>
    ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", "err")}
    <form method="post" action="${base}/register" class="stack-form">
      <label>사장님 성함<input type="text" name="name" required autocomplete="name" placeholder="홍길동" /></label>
      <label>이메일<input type="email" name="email" required autocomplete="email" placeholder="you@example.com" /></label>
      <label>비밀번호 <small>(8자 이상)</small><input type="password" name="password" required minlength="8" autocomplete="new-password" /></label>
      <div class="form-divider">업체 정보</div>
      <label>업체명<input type="text" name="business_name" required placeholder="OO상회" /></label>
      <label>업종<select name="category">${opts}</select></label>
      <button type="submit" class="btn btn-primary btn-block">가입하고 업체 페이지 만들기</button>
    </form>
    <p class="auth-alt">이미 회원이신가요? <a href="/login">로그인</a></p>
    <p class="auth-note">가입 후 관리자 승인을 거쳐 업체 페이지가 공개됩니다.</p>
  </div></div></section>`;
  html(res, layout({ title: "업체 등록", user: req.user, assoc, base, body }));
}

export function postLoginPath(user, req) {
  if (user.role === ROLES.SUPERADMIN) return "/super";
  if (!user.association_id) return "/";
  const a = A.getAssociationById(user.association_id);
  if (!a) return "/";
  const base = tenantBase(a, req);
  return user.role === ROLES.ADMIN ? base + "/admin" : base + "/dashboard";
}

// ================= 회원 대시보드 =================
export function dashboard(req, res, { assoc, query }) {
  const base = baseOf(assoc);
  const b = M.getBusinessByOwner(req.user.id);
  if (!b || b.association_id !== assoc.id) {
    return html(res, layout({ title: "대시보드", user: req.user, assoc, base, body: `<section class="section page-top"><div class="container"><p class="empty">연결된 업체가 없습니다.</p></div></section>` }));
  }
  const media = M.listMedia(b.id);
  const signCount = M.countDocumentsToSign(assoc.id, req.user.id);
  const opts = CATEGORIES.map((c) => `<option value="${esc(c)}"${c === b.category ? " selected" : ""}>${esc(c)}</option>`).join("");
  const mediaGrid = media.length
    ? media.map((m) => `<figure class="media-tile">${galleryItem(m, { showCaption: false })}<figcaption>
        <span class="media-kind">${m.kind === "video" ? "🎬 영상" : "🖼 사진"}</span>
        <form method="post" action="${base}/dashboard/media/${m.id}/delete" data-confirm="삭제하시겠습니까?"><button class="link-danger" type="submit">삭제</button></form>
      </figcaption></figure>`).join("")
    : `<p class="empty">아직 업로드한 사진·영상이 없습니다.</p>`;
  const body = `
  <section class="dash"><div class="container">
    <div class="dash-head"><div>
      <p class="section-eyebrow">MY BUSINESS</p>
      <h1 class="dash-title">${esc(b.name)} ${statusBadge(b.status)}</h1>
      <p class="dash-sub">공개 주소: <a href="${base}/business/${esc(b.slug)}" target="_blank">${base}/business/${esc(b.slug)}</a></p>
    </div><div class="dash-head-actions">
      <a href="${base}/sign" class="btn btn-ghost btn-sm">전자서명${signCount ? ` <span class="badge badge-wait">${signCount}</span>` : ""}</a>
      <a href="${base}/business/${esc(b.slug)}" class="btn btn-ghost btn-sm" target="_blank">내 페이지 보기</a>
    </div></div>
    ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", query.get("err") ? "err" : "ok")}
    ${signCount ? `<div class="flash flash-warn">서명이 필요한 문서가 <b>${signCount}건</b> 있습니다. <a href="${base}/sign">전자서명 하러 가기 →</a></div>` : ""}
    <div class="dash-grid">
      <section class="panel"><h2 class="panel-title">업체 정보</h2>
        <form method="post" action="${base}/dashboard/business" class="stack-form">
          <label>업체명<input type="text" name="name" value="${esc(b.name)}" required /></label>
          <label>업종<select name="category">${opts}</select></label>
          <label>소개<textarea name="description" rows="4">${esc(b.description)}</textarea></label>
          <div class="form-two">
            <label>전화번호<input type="tel" name="phone" value="${esc(b.phone)}" placeholder="02-000-0000" /></label>
            <label>영업시간<input type="text" name="hours" value="${esc(b.hours)}" placeholder="매일 10:00 - 22:00" /></label>
          </div>
          <label>주소<input type="text" name="address" value="${esc(b.address)}" /></label>
          <div class="form-divider">지도 위치 (점포 지도에 표시)</div>
          ${config.naverMapClientId ? `<div id="pickMap" class="pick-map" data-center-lat="${b.lat ?? assoc.map_lat}" data-center-lng="${b.lng ?? assoc.map_lng}" data-zoom="16"></div><p class="panel-hint">지도를 클릭하면 아래 좌표가 자동 입력됩니다.</p>` : `<p class="panel-hint">위도·경도를 입력하면 점포 지도에 표시됩니다. (<a href="https://map.naver.com" target="_blank" rel="noopener">네이버 지도</a>에서 내 위치 우클릭 → 좌표 확인)</p>`}
          <div class="form-two">
            <label>위도(lat)<input type="text" inputmode="decimal" name="lat" id="latInput" value="${b.lat != null ? esc(String(b.lat)) : ""}" placeholder="37.4837" /></label>
            <label>경도(lng)<input type="text" inputmode="decimal" name="lng" id="lngInput" value="${b.lng != null ? esc(String(b.lng)) : ""}" placeholder="127.0324" /></label>
          </div>
          <button type="submit" class="btn btn-primary">정보 저장</button>
        </form></section>
      <section class="panel"><h2 class="panel-title">사진·영상 업로드</h2>
        <form method="post" action="${base}/dashboard/media" enctype="multipart/form-data" class="upload-form" id="uploadForm">
          <label class="file-drop" id="fileDrop">
            <input type="file" name="files" id="fileInput" accept="image/*,video/*" multiple />
            <span class="file-drop-text">📁 클릭하거나 파일을 끌어다 놓으세요<br /><small>이미지 최대 8MB · 영상 최대 120MB</small></span>
          </label>
          <input type="text" name="caption" placeholder="설명 (선택)" class="caption-input" />
          <div id="fileList" class="file-list"></div>
          <button type="submit" class="btn btn-primary btn-block" id="uploadBtn">업로드</button>
        </form>
        <h3 class="panel-subtitle">등록된 미디어 (${media.length})</h3>
        <div class="media-grid">${mediaGrid}</div></section>
    </div></div></section>`;
  const naverPicker = config.naverMapClientId
    ? `<script src="https://oapi.map.naver.com/openapi/v3/maps.js?${esc(config.naverMapParam)}=${esc(config.naverMapClientId)}"></script><script src="/js/map.js" defer></script>`
    : "";
  html(res, layout({ title: "내 업체 관리", user: req.user, assoc, base, body, scripts: `<script src="/js/dashboard.js" defer></script><script src="/js/viewer.js" defer></script>${naverPicker}` }));
}

// ================= 상인회 관리자 대시보드 =================
export function admin(req, res, { assoc, query }) {
  const base = baseOf(assoc);
  const s = M.stats(assoc.id);
  const all = M.listAllBusinesses(assoc.id);
  const notices = M.listNotices(assoc.id);
  const events = M.listEvents(assoc.id);
  const layoutArr = parseLayout(assoc.home_layout, assoc.name);

  const bizRows = all.length
    ? all.map((b) => `<tr>
      <td><a href="${base}/business/${esc(b.slug)}" target="_blank">${esc(b.name)}</a><br /><small>${esc(b.category)}</small></td>
      <td>${esc(b.owner_name)}<br /><small>${esc(b.owner_email)}</small></td>
      <td>${statusBadge(b.status)}</td>
      <td class="actions-cell">
        ${b.status !== "approved" ? `<form method="post" action="${base}/admin/business/${b.id}/status"><input type="hidden" name="status" value="approved" /><button class="btn btn-xs btn-primary">승인</button></form>` : ""}
        ${b.status !== "rejected" ? `<form method="post" action="${base}/admin/business/${b.id}/status"><input type="hidden" name="status" value="rejected" /><button class="btn btn-xs btn-ghost">반려</button></form>` : ""}
      </td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">등록된 업체가 없습니다.</td></tr>`;

  const noticeRows = notices.map((n) => `<li><span class="notice-tag${n.pinned ? " tag-important" : ""}">${esc(n.tag)}</span>
    <span class="notice-title">${esc(n.title)}</span>
    <form method="post" action="${base}/admin/notice/${n.id}/delete" data-confirm="삭제하시겠습니까?"><button class="link-danger">삭제</button></form></li>`).join("") || `<li class="empty">공지가 없습니다.</li>`;
  const eventRows = events.map((e) => `<li><span class="event-mini-date">${esc(e.event_date)}</span>
    <span class="notice-title">${esc(e.title)}</span>
    <form method="post" action="${base}/admin/event/${e.id}/delete" data-confirm="삭제하시겠습니까?"><button class="link-danger">삭제</button></form></li>`).join("") || `<li class="empty">행사가 없습니다.</li>`;

  const notifs = M.listNotifications(assoc.id, { limit: 15 });
  const unread = M.unreadCount(assoc.id);
  const notifRows = notifs.length
    ? notifs.map((n) => `<li class="${n.is_read ? "" : "unread"}">
        <span class="notif-dot" aria-hidden="true"></span>
        <a href="${esc(n.link || base + "/admin")}" class="notif-msg">${esc(n.message)}</a>
        <time>${esc(n.created_at.slice(5, 16).replace("T", " "))}</time></li>`).join("")
    : `<li class="empty">알림이 없습니다.</li>`;

  const members = M.listUsersByAssociation(assoc.id, "MERCHANT");
  const memberRows = members.length
    ? members.map((m) => `<tr>
        <td>${esc(m.name)}<br /><small>${esc(m.email)}</small></td>
        <td>${esc(m.business_name || "-")}</td>
        <td class="actions-cell"><form method="post" action="${base}/admin/user/${m.id}/reset-password" data-confirm="${esc(m.name)}님의 임시 비밀번호를 발급하시겠습니까?"><button class="btn btn-xs btn-ghost">임시 비밀번호 발급</button></form></td>
      </tr>`).join("")
    : `<tr><td colspan="3" class="empty">회원이 없습니다.</td></tr>`;

  const superNote = req.user.role === ROLES.SUPERADMIN
    ? `<div class="flash flash-warn">슈퍼 관리자로 <strong>${esc(assoc.name)}</strong>의 관리 화면을 보고 있습니다. <a href="/super">← 슈퍼 관리자</a></div>` : "";

  const body = `
  <section class="dash"><div class="container">
    <div class="dash-head"><div>
      <p class="section-eyebrow">ADMIN · ${esc(assoc.name)}</p>
      <h1 class="dash-title">관리자 대시보드</h1>
      <p class="dash-sub">홈페이지 주소: <a href="${base}" target="_blank">${base}</a></p>
    </div><div class="dash-head-actions">
      <a href="${base}/admin/documents" class="btn btn-ghost btn-sm">전자서명 문서</a>
    </div></div>
    ${superNote}
    ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", query.get("err") ? "err" : "ok")}
    <div class="stat-cards">
      <div class="stat-card"><span class="stat-num">${s.businesses}</span><span class="stat-label">승인 업체</span></div>
      <div class="stat-card${s.pending ? " stat-alert" : ""}"><span class="stat-num">${s.pending}</span><span class="stat-label">승인 대기</span></div>
      <div class="stat-card"><span class="stat-num">${s.notices}</span><span class="stat-label">공지</span></div>
      <div class="stat-card"><span class="stat-num">${s.events}</span><span class="stat-label">행사</span></div>
      <div class="stat-card"><span class="stat-num">${s.mediaCount}</span><span class="stat-label">미디어</span></div>
    </div>

    <section class="panel"><div class="panel-head">
      <h2 class="panel-title">알림함${unread ? ` <span class="badge badge-wait">${unread} 새 알림</span>` : ""}</h2>
      ${unread ? `<form method="post" action="${base}/admin/notifications/read"><button class="btn btn-xs btn-ghost">모두 읽음</button></form>` : ""}
    </div>
      <p class="panel-hint">신규 업체 가입·비밀번호 재설정 요청 등이 여기에 표시됩니다(이메일 대체).</p>
      <ul class="notif-list">${notifRows}</ul>
    </section>

    <section class="panel"><h2 class="panel-title">회원 관리</h2>
      <p class="panel-hint">비밀번호를 잊은 회원에게 임시 비밀번호를 발급할 수 있습니다. 발급 시 회원의 기존 로그인은 모두 해제됩니다.</p>
      <div class="table-scroll"><table class="admin-table">
        <thead><tr><th>회원</th><th>업체</th><th>비밀번호</th></tr></thead>
        <tbody>${memberRows}</tbody></table></div>
    </section>

    <section class="panel"><h2 class="panel-title">홈페이지 구성 편집</h2>
      <p class="panel-hint">각 섹션을 켜고 끄거나, 순서를 바꾸고, 문구를 직접 수정할 수 있습니다. 상인회마다 다른 구조를 가질 수 있습니다.</p>
      ${layoutEditor(base, layoutArr)}
    </section>

    <section class="panel"><h2 class="panel-title">상인회 정보 · 브랜딩</h2>
      <form method="post" action="${base}/admin/settings" enctype="multipart/form-data" class="stack-form">
        <div class="logo-setting">
          <div class="logo-preview">${assoc.logo ? `<img src="${esc(storage.publicUrl(assoc.logo))}" alt="현재 로고" />` : `<span class="logo-placeholder" style="background:${esc(assoc.brand_color)}">${esc(assoc.name.slice(0, 1))}</span>`}</div>
          <div class="logo-fields">
            <label class="mini-label">로고 이미지 <small>(PNG·JPG·최대 2MB, 미선택 시 유지)</small>
              <input type="file" name="logo" accept="image/*" /></label>
            ${assoc.logo ? `<label class="check"><input type="checkbox" name="remove_logo" value="1" /> 로고 삭제(이니셜로 표시)</label>` : ""}
          </div>
        </div>
        <div class="form-two">
          <label>상인회 이름<input type="text" name="name" value="${esc(assoc.name)}" required /></label>
          <label>대표 색상<input type="color" name="brand_color" value="${esc(assoc.brand_color)}" /></label>
        </div>
        <label>한 줄 소개<input type="text" name="tagline" value="${esc(assoc.tagline)}" /></label>
        <div class="form-two">
          <label>대표 전화<input type="text" name="phone" value="${esc(assoc.phone)}" /></label>
          <label>이메일<input type="email" name="email" value="${esc(assoc.email)}" /></label>
        </div>
        <label>주소<input type="text" name="address" value="${esc(assoc.address)}" /></label>
        <button class="btn btn-primary btn-sm">브랜딩 저장</button>
      </form>
    </section>

    <section class="panel"><h2 class="panel-title">업체 관리</h2>
      <div class="table-scroll"><table class="admin-table">
        <thead><tr><th>업체</th><th>사장님</th><th>상태</th><th>처리</th></tr></thead>
        <tbody>${bizRows}</tbody></table></div></section>

    <div class="dash-grid">
      <section class="panel"><h2 class="panel-title">공지사항 관리</h2>
        <form method="post" action="${base}/admin/notice" class="stack-form compact">
          <input type="text" name="title" placeholder="공지 제목" required />
          <textarea name="body" rows="3" placeholder="내용"></textarea>
          <div class="form-two"><input type="text" name="tag" placeholder="태그" value="안내" />
            <label class="check"><input type="checkbox" name="pinned" value="1" /> 상단 고정</label></div>
          <button class="btn btn-primary btn-sm">공지 등록</button>
        </form><ul class="admin-list">${noticeRows}</ul></section>
      <section class="panel"><h2 class="panel-title">행사 관리</h2>
        <form method="post" action="${base}/admin/event" class="stack-form compact">
          <input type="text" name="title" placeholder="행사명" required />
          <div class="form-two"><input type="date" name="event_date" required /><input type="text" name="place" placeholder="장소" /></div>
          <textarea name="description" rows="2" placeholder="설명"></textarea>
          <button class="btn btn-primary btn-sm">행사 등록</button>
        </form><ul class="admin-list">${eventRows}</ul></section>
    </div>
  </div></section>`;
  html(res, layout({ title: "관리자 대시보드", user: req.user, assoc, base, body, scripts: `<script src="/js/layout-editor.js" defer></script>` }));
}

// 홈 구성 편집 UI
function layoutEditor(base, layoutArr) {
  const rows = layoutArr.map((sec, i) => {
    const cat = SECTION_CATALOG[sec.type];
    const fields = cat.fields.map((f) => {
      const val = sec[f.key];
      const name = `f_${i}_${f.key}`;
      if (f.type === "bool") {
        return `<label class="check"><input type="checkbox" name="${name}" value="1"${val ? " checked" : ""} /> ${esc(f.label)}</label>`;
      }
      if (f.type === "textarea") {
        return `<label class="mini-label">${esc(f.label)}<textarea name="${name}" rows="2">${esc(val || "")}</textarea></label>`;
      }
      return `<label class="mini-label">${esc(f.label)}<input type="text" name="${name}" value="${esc(val || "")}" /></label>`;
    }).join("");
    return `<div class="layout-row" data-index="${i}">
      <div class="layout-row-head">
        <label class="check"><input type="checkbox" name="en_${i}" value="1"${sec.enabled ? " checked" : ""} /> <strong>${esc(cat.label)}</strong></label>
        <input type="hidden" name="ty_${i}" value="${esc(sec.type)}" />
        <span class="layout-move"><button type="button" class="move-btn" data-dir="up" aria-label="위로">▲</button><button type="button" class="move-btn" data-dir="down" aria-label="아래로">▼</button></span>
      </div>
      <div class="layout-fields">${fields}</div>
    </div>`;
  }).join("");
  return `<form method="post" action="${base}/admin/layout" class="layout-editor" id="layoutEditor">
    <input type="hidden" name="order" id="layoutOrder" value="${layoutArr.map((_, i) => i).join(",")}" />
    <div id="layoutRows">${rows}</div>
    <div class="layout-actions">
      <button type="submit" class="btn btn-primary btn-sm">홈페이지 구성 저장</button>
      <button type="submit" formaction="${base}/admin/layout/reset" class="btn btn-ghost btn-sm" data-confirm="기본 구성으로 되돌리시겠습니까?">기본 구성으로 초기화</button>
    </div>
  </form>`;
}

// ================= 슈퍼 관리자 =================
export function superConsole(req, res, { query }) {
  const ps = M.platformStats();
  const assocs = A.listAssociations();
  const rows = assocs.length
    ? assocs.map((a) => `<tr>
      <td><a href="/t/${esc(a.slug)}" target="_blank"><span class="dot" style="background:${esc(a.brand_color)}"></span>${esc(a.name)}</a><br /><small>/t/${esc(a.slug)}</small></td>
      <td>${a.biz_count}곳</td><td>${a.user_count}명</td>
      <td>${a.active ? '<span class="badge badge-ok">운영중</span>' : '<span class="badge badge-no">중지</span>'}</td>
      <td class="actions-cell">
        <a href="/t/${esc(a.slug)}/admin" class="btn btn-xs btn-ghost">관리</a>
        <form method="post" action="/super/association/${a.id}/toggle"><button class="btn btn-xs ${a.active ? "btn-ghost" : "btn-primary"}">${a.active ? "중지" : "재개"}</button></form>
      </td></tr>`).join("")
    : `<tr><td colspan="5" class="empty">아직 상인회가 없습니다.</td></tr>`;

  const notifs = M.listAllNotifications({ limit: 20 });
  const unread = M.unreadCountAll();
  const notifRows = notifs.length
    ? notifs.map((n) => `<li class="${n.is_read ? "" : "unread"}">
        <span class="notif-dot" aria-hidden="true"></span>
        <a href="${esc(n.link || "/super")}" class="notif-msg">${n.assoc_name ? `<b>[${esc(n.assoc_name)}]</b> ` : ""}${esc(n.message)}</a>
        <time>${esc(n.created_at.slice(5, 16).replace("T", " "))}</time></li>`).join("")
    : `<li class="empty">알림이 없습니다.</li>`;

  const admins = M.listAdmins();
  const adminRows = admins.length
    ? admins.map((a) => `<tr>
        <td>${esc(a.name)}<br /><small>${esc(a.email)}</small></td>
        <td>${esc(a.assoc_name)}</td>
        <td class="actions-cell"><form method="post" action="/super/user/${a.id}/reset-password" data-confirm="${esc(a.name)} 관리자의 임시 비밀번호를 발급하시겠습니까?"><button class="btn btn-xs btn-ghost">임시 비밀번호 발급</button></form></td>
      </tr>`).join("")
    : `<tr><td colspan="3" class="empty">관리자가 없습니다.</td></tr>`;

  const body = `
  <section class="dash"><div class="container">
    <div class="dash-head"><div>
      <p class="section-eyebrow">SUPER ADMIN</p>
      <h1 class="dash-title">슈퍼 관리자 콘솔</h1>
      <p class="dash-sub">플랫폼 전체와 상인회 사이트 복제를 관리합니다.</p>
    </div></div>
    ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", query.get("err") ? "err" : "ok")}
    <section class="panel"><div class="panel-head">
      <h2 class="panel-title">알림함${unread ? ` <span class="badge badge-wait">${unread} 새 알림</span>` : ""}</h2>
      ${unread ? `<form method="post" action="/super/notifications/read"><button class="btn btn-xs btn-ghost">모두 읽음</button></form>` : ""}
    </div>
      <ul class="notif-list">${notifRows}</ul>
    </section>
    <section class="panel"><h2 class="panel-title">관리자 계정 · 비밀번호 재설정</h2>
      <div class="table-scroll"><table class="admin-table">
        <thead><tr><th>관리자</th><th>상인회</th><th>비밀번호</th></tr></thead>
        <tbody>${adminRows}</tbody></table></div>
    </section>
    <div class="stat-cards">
      <div class="stat-card"><span class="stat-num">${ps.associations}</span><span class="stat-label">상인회</span></div>
      <div class="stat-card"><span class="stat-num">${ps.activeAssociations}</span><span class="stat-label">운영중</span></div>
      <div class="stat-card"><span class="stat-num">${ps.businesses}</span><span class="stat-label">전체 업체</span></div>
      <div class="stat-card"><span class="stat-num">${ps.users}</span><span class="stat-label">전체 회원</span></div>
      <div class="stat-card"><span class="stat-num">${ps.media}</span><span class="stat-label">전체 미디어</span></div>
    </div>

    <section class="panel panel-accent"><h2 class="panel-title">➕ 새 상인회 사이트 만들기 (복제)</h2>
      <p class="panel-hint">새 상인회를 추가하면 동일한 구조의 홈페이지가 생성되고, 해당 상인회 관리자 계정이 함께 발급됩니다. 이후 각 상인회는 자신의 홈페이지 구조와 브랜딩을 자유롭게 바꿀 수 있습니다.</p>
      <form method="post" action="/super/association" class="stack-form">
        <div class="form-two">
          <label>상인회 이름<input type="text" name="name" required placeholder="예: 강남구 상인회" /></label>
          <label>대표 색상<input type="color" name="brand_color" value="#0b6e4f" /></label>
        </div>
        <label>한 줄 소개<input type="text" name="tagline" placeholder="함께 성장하는 우리 동네 상권" /></label>
        <div class="form-divider">관리자 계정</div>
        <div class="form-two">
          <label>관리자 이름<input type="text" name="admin_name" placeholder="홍길동" /></label>
          <label>관리자 이메일<input type="email" name="admin_email" required placeholder="admin@example.com" /></label>
        </div>
        <label>관리자 비밀번호 <small>(8자 이상)</small><input type="password" name="admin_password" required minlength="8" /></label>
        <label class="check"><input type="checkbox" name="seed" value="1" checked /> 예시 공지·행사 자동 생성</label>
        <button class="btn btn-primary">상인회 사이트 생성</button>
      </form>
    </section>

    <section class="panel"><h2 class="panel-title">상인회 목록</h2>
      <div class="table-scroll"><table class="admin-table">
        <thead><tr><th>상인회</th><th>업체</th><th>회원</th><th>상태</th><th>관리</th></tr></thead>
        <tbody>${rows}</tbody></table></div></section>
  </div></section>`;
  html(res, layout({ title: "슈퍼 관리자", user: req.user, body }));
}

// ================= 계정 보안 =================
export function account(req, res, { query }) {
  const u = req.user;
  const roleLabel = u.role === ROLES.SUPERADMIN ? "슈퍼 관리자" : u.role === ROLES.ADMIN ? "상인회 관리자" : "업체 회원";
  const backTo = postLoginPath(u, req);
  const body = `<section class="section page-top"><div class="container narrow">
    <a href="${esc(backTo)}" class="back-link">← 대시보드</a>
    <div class="section-head" style="text-align:left;margin-bottom:28px">
      <p class="section-eyebrow">ACCOUNT</p><h1 class="section-title">계정 보안</h1>
      <p class="section-lead">${esc(u.name)} · ${esc(u.email)} · ${roleLabel}</p></div>
    ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", query.get("err") ? "err" : "ok")}
    <div class="panel"><h2 class="panel-title">비밀번호 변경</h2>
      <form method="post" action="/account/password" class="stack-form">
        <label>현재 비밀번호<input type="password" name="current" required autocomplete="current-password" /></label>
        <label>새 비밀번호 <small>(8자 이상)</small><input type="password" name="new" required minlength="8" autocomplete="new-password" /></label>
        <label>새 비밀번호 확인<input type="password" name="confirm" required minlength="8" autocomplete="new-password" /></label>
        <button class="btn btn-primary">비밀번호 변경</button>
      </form>
      <p class="panel-hint" style="margin-top:14px">변경 시 다른 모든 기기의 로그인 세션이 자동 해제됩니다.</p>
    </div>
    <div class="panel"><h2 class="panel-title">모든 기기에서 로그아웃</h2>
      <p class="panel-hint">공용 PC 사용 또는 계정 도용이 의심될 때, 모든 기기의 세션을 즉시 무효화합니다.</p>
      <form method="post" action="/account/logout-all" data-confirm="모든 기기에서 로그아웃하시겠습니까?">
        <button class="btn btn-ghost">모든 기기에서 로그아웃</button>
      </form>
    </div>
  </div></section>`;
  html(res, layout({ title: "계정 보안", user: u, body }));
}

// ================= 전자서명 =================
const docBody = (b) => esc(b).replace(/\n/g, "<br />");

// 회원: 서명할 문서 목록 + 내 서명 내역
export function signList(req, res, { assoc, query }) {
  const base = baseOf(assoc);
  const b = M.getBusinessByOwner(req.user.id);
  const todo = M.listDocumentsToSign(assoc.id, req.user.id);
  const all = M.listDocuments(assoc.id);
  const signedIds = new Set(all.filter((d) => M.hasSigned(d.id, req.user.id)).map((d) => d.id));

  const todoRows = todo.length
    ? todo.map((d) => `<li><a href="${base}/sign/${d.id}"><span class="notice-tag tag-important">서명 필요</span>
        <span class="notice-title">${esc(d.title)}</span><time>${esc(d.created_at.slice(0, 10).replace(/-/g, "."))}</time></a></li>`).join("")
    : `<li class="empty">서명할 문서가 없습니다.</li>`;
  const doneRows = all.filter((d) => signedIds.has(d.id))
    .map((d) => `<li><span class="notice-tag badge-ok">서명 완료</span><span class="notice-title">${esc(d.title)}</span></li>`).join("") || `<li class="empty">서명 내역이 없습니다.</li>`;

  const body = `<section class="section page-top"><div class="container narrow">
    <a href="${base}/dashboard" class="back-link">← 내 업체 관리</a>
    <div class="section-head" style="text-align:left"><p class="section-eyebrow">E-SIGN</p><h1 class="section-title">전자서명</h1>
      <p class="section-lead">상인회 동의서·계약 등에 전자서명합니다.</p></div>
    ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", query.get("err") ? "err" : "ok")}
    <h2 class="biz-section-title">서명 대기 (${todo.length})</h2>
    <ul class="notice-list">${todoRows}</ul>
    <h2 class="biz-section-title" style="margin-top:32px">서명 완료</h2>
    <ul class="notice-list">${doneRows}</ul>
  </div></section>`;
  html(res, layout({ title: "전자서명", user: req.user, assoc, base, body }));
}

// 회원: 서명 폼
export function signForm(req, res, { assoc, params, query }) {
  const base = baseOf(assoc);
  const d = M.getDocument(Number(params.id));
  if (!d || d.association_id !== assoc.id) return notFound(req, res, { assoc });
  if (M.hasSigned(d.id, req.user.id)) return redirect(res, base + "/sign?msg=" + encodeURIComponent("이미 서명한 문서입니다."));
  if (d.closed) return redirect(res, base + "/sign?err=1&msg=" + encodeURIComponent("마감된 문서입니다."));

  const body = `<section class="section page-top"><div class="container narrow">
    <a href="${base}/sign" class="back-link">← 서명 목록</a>
    <h1 class="article-title">${esc(d.title)}</h1>
    <div class="doc-body">${docBody(d.body)}</div>
    <p class="doc-hash">문서 해시(SHA-256): <code>${esc(d.content_hash)}</code></p>
    ${flash(query.get("err") ? decodeURIComponent(query.get("msg") || "입력을 확인하세요.") : "", "err")}
    <form method="post" action="${base}/sign/${d.id}" class="stack-form sign-form" id="signForm">
      <label>서명 (아래 칸에 마우스/손가락으로 서명)
        <div class="sign-pad-wrap">
          <canvas id="signPad" class="sign-pad" width="600" height="200" aria-label="서명 입력란"></canvas>
          <button type="button" class="btn btn-ghost btn-xs sign-clear" id="signClear">지우기</button>
        </div>
      </label>
      <input type="hidden" name="signature" id="signatureData" />
      <label>서명자 성명<input type="text" name="signer_name" value="${esc(req.user.name)}" required /></label>
      <label class="check"><input type="checkbox" name="consent" value="1" required /> 위 문서 내용을 확인했으며, 본인이 전자서명하는 데 동의합니다.</label>
      <button type="submit" class="btn btn-primary btn-block" id="signSubmit">전자서명 제출</button>
    </form>
    <p class="auth-note">서명 시 서명자·시각·IP·기기 정보와 문서 해시가 기록되고, HMAC로 봉인되어 위변조를 방지합니다.</p>
  </div></section>`;
  html(res, layout({ title: `서명: ${d.title}`, user: req.user, assoc, base, body, scripts: `<script src="/js/sign.js" defer></script>` }));
}

// 관리자: 문서 목록 + 생성
export function adminDocuments(req, res, { assoc, query }) {
  const base = baseOf(assoc);
  const docs = M.listDocuments(assoc.id);
  const rows = docs.length
    ? docs.map((d) => `<tr>
        <td><a href="${base}/admin/documents/${d.id}">${esc(d.title)}</a><br /><small>${esc(d.created_at.slice(0, 16).replace("T", " "))}</small></td>
        <td>${d.sign_count}명</td>
        <td>${d.closed ? '<span class="badge badge-no">마감</span>' : '<span class="badge badge-ok">진행중</span>'}</td>
        <td class="actions-cell">
          <a class="btn btn-xs btn-ghost" href="${base}/admin/documents/${d.id}">서명 보기</a>
          ${d.closed ? "" : `<form method="post" action="${base}/admin/documents/${d.id}/close" data-confirm="더 이상 서명을 받지 않도록 마감할까요?"><button class="btn btn-xs btn-ghost">마감</button></form>`}
        </td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">문서가 없습니다.</td></tr>`;

  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">E-SIGN · ${esc(assoc.name)}</p>
      <h1 class="dash-title">전자서명 문서</h1>
      <p class="dash-sub"><a href="${base}/admin">← 관리자 대시보드</a></p></div></div>
    ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", query.get("err") ? "err" : "ok")}
    <section class="panel panel-accent"><h2 class="panel-title">➕ 서명 문서 만들기</h2>
      <p class="panel-hint">생성 후 본문은 무결성을 위해 변경할 수 없습니다. 회원 대시보드에 서명 요청으로 표시됩니다.</p>
      <form method="post" action="${base}/admin/documents" class="stack-form">
        <label>제목<input type="text" name="title" required placeholder="예: 2026년도 상인회 가입 동의서" /></label>
        <label>본문(약관·동의 내용)<textarea name="body" rows="10" required placeholder="동의 내용을 입력하세요."></textarea></label>
        <button class="btn btn-primary">문서 생성 및 서명 요청</button>
      </form>
    </section>
    <section class="panel"><h2 class="panel-title">문서 목록</h2>
      <div class="table-scroll"><table class="admin-table">
        <thead><tr><th>문서</th><th>서명</th><th>상태</th><th>관리</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </section>
  </div></section>`;
  html(res, layout({ title: "전자서명 문서", user: req.user, assoc, base, body }));
}

// 관리자: 문서별 서명 내역 + 검증
export function adminDocumentDetail(req, res, { assoc, params, query }) {
  const base = baseOf(assoc);
  const d = M.getDocument(Number(params.id));
  if (!d || d.association_id !== assoc.id) return notFound(req, res, { assoc });
  const sigs = M.listSignatures(d.id);
  const rows = sigs.length
    ? sigs.map((s) => {
        const v = verifySignature(s, d);
        const badge = v.valid ? '<span class="badge badge-ok">유효</span>' : '<span class="badge badge-no">위변조 의심</span>';
        return `<tr>
          <td>${esc(s.signer_name)}<br /><small>${esc(s.signer_email)}</small></td>
          <td>${s.signature_image ? `<img src="${esc(storage.publicUrl(s.signature_image))}" alt="서명" class="sig-thumb" />` : "-"}</td>
          <td><small>${esc(s.signed_at.slice(0, 16).replace("T", " "))}<br />IP ${esc(s.ip)}</small></td>
          <td>${badge}<br /><a href="/verify/${esc(s.verify_code)}" target="_blank"><small>검증 ${esc(s.verify_code.slice(0, 8))}…</small></a></td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="4" class="empty">아직 서명이 없습니다.</td></tr>`;

  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">E-SIGN</p>
      <h1 class="dash-title">${esc(d.title)} ${d.closed ? '<span class="badge badge-no">마감</span>' : ""}</h1>
      <p class="dash-sub"><a href="${base}/admin/documents">← 문서 목록</a> · 서명 ${sigs.length}명</p></div></div>
    <section class="panel"><h2 class="panel-title">문서 본문</h2>
      <div class="doc-body">${docBody(d.body)}</div>
      <p class="doc-hash">문서 해시: <code>${esc(d.content_hash)}</code></p>
    </section>
    <section class="panel"><h2 class="panel-title">서명 내역</h2>
      <div class="table-scroll"><table class="admin-table">
        <thead><tr><th>서명자</th><th>서명</th><th>일시·IP</th><th>검증</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    </section>
  </div></section>`;
  html(res, layout({ title: d.title, user: req.user, assoc, base, body }));
}

// 공개: 서명 검증 페이지
export function verifyPage(req, res, { params, query }) {
  const code = params.code || query.get("code") || "";
  const sig = code ? M.getSignatureByCode(code) : null;
  let inner;
  if (!sig) {
    inner = `<div class="flash flash-err">해당 검증 코드의 서명 기록을 찾을 수 없습니다.</div>
      <form method="get" action="/verify" class="stack-form"><label>검증 코드<input type="text" name="code" value="${esc(code)}" placeholder="검증 코드 입력" /></label><button class="btn btn-primary btn-sm">검증</button></form>`;
  } else {
    const d = M.getDocument(sig.document_id);
    const v = verifySignature(sig, d);
    const status = v.valid
      ? `<div class="flash flash-ok"><b>✓ 유효한 서명</b> — 봉인과 문서 본문이 서명 시점과 일치합니다.</div>`
      : `<div class="flash flash-err"><b>✗ 검증 실패</b> — ${v.sealOk ? "" : "봉인 불일치. "}${v.contentOk ? "" : "문서 본문이 변경되었습니다. "}위변조 가능성이 있습니다.</div>`;
    inner = `${status}
      <table class="verify-table">
        <tr><th>문서</th><td>${esc(d ? d.title : "(삭제됨)")}</td></tr>
        <tr><th>서명자</th><td>${esc(sig.signer_name)}</td></tr>
        <tr><th>서명 일시</th><td>${esc(sig.signed_at.replace("T", " "))} (UTC)</td></tr>
        <tr><th>문서 해시</th><td><code>${esc(sig.content_hash)}</code></td></tr>
        <tr><th>봉인(HMAC)</th><td><code>${esc(sig.record_hash.slice(0, 32))}…</code></td></tr>
        <tr><th>검증 코드</th><td><code>${esc(sig.verify_code)}</code></td></tr>
      </table>
      ${sig.signature_image ? `<div class="verify-sig"><img src="${esc(storage.publicUrl(sig.signature_image))}" alt="서명 이미지" /></div>` : ""}`;
  }
  const body = `<section class="section page-top"><div class="container narrow">
    <div class="section-head" style="text-align:left"><p class="section-eyebrow">VERIFY</p><h1 class="section-title">전자서명 검증</h1></div>
    ${inner}</div></section>`;
  html(res, layout({ title: "서명 검증", user: req.user, body }));
}

// ================= SEO: sitemap.xml / robots.txt =================
export function sitemap(req, res) {
  const o = origin(req);
  const urls = [];
  const push = (loc) => urls.push(`<url><loc>${esc(loc)}</loc></url>`);
  const addAssoc = (a, b) => {
    push(o + b + "/");
    push(o + b + "/businesses");
    push(o + b + "/notices");
    push(o + b + "/events");
    for (const biz of M.listBusinesses(a.id, {})) push(o + b + "/business/" + encodeURIComponent(biz.slug));
    for (const n of M.listNotices(a.id)) push(o + b + "/notices/" + n.id);
  };

  const host = (req.headers.host || "").split(":")[0].toLowerCase();
  let tenant = null;
  if (config.baseDomain && host.endsWith("." + config.baseDomain)) {
    const label = host.slice(0, host.length - config.baseDomain.length - 1).split(".")[0];
    if (label && label !== "www") tenant = A.getAssociationBySlug(label);
  }
  if (tenant) { if (tenant.active) addAssoc(tenant, ""); }
  else {
    push(o + "/");
    for (const a of A.listActiveAssociations()) addAssoc(a, "/t/" + a.slug);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
  send(res, 200, xml, { "Content-Type": "application/xml; charset=utf-8" });
}

export function robots(req, res) {
  const o = origin(req);
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /login",
    "Disallow: /super",
    "Disallow: /*/admin",
    "Disallow: /*/dashboard",
    "Disallow: /admin",
    "Disallow: /dashboard",
    `Sitemap: ${o}/sitemap.xml`,
    "",
  ].join("\n");
  send(res, 200, body, { "Content-Type": "text/plain; charset=utf-8" });
}

// ================= 404 =================
export function notFound(req, res, ctx = {}) {
  const assoc = ctx.assoc || null;
  const base = assoc ? baseOf(assoc) : "";
  const body = `<section class="section page-top"><div class="container center-block">
    <h1 class="big-404">404</h1><p class="section-lead">요청하신 페이지를 찾을 수 없습니다.</p>
    <a href="${base || "/"}" class="btn btn-primary">홈으로</a></div></section>`;
  html(res, layout({ title: "404", user: req.user, assoc, base, body }), 404);
}
