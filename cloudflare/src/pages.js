// 공개/인증 페이지 핸들러 (async). ctx = { env, db, assoc, base, user, url, query, csrf, params }
import * as D from "./db.js";
import { esc, clip, openBadge } from "./util.js";
import { layout, flash, statusBadge, pager, mediaUrl } from "./render.js";
import { html, notFoundResponse, back } from "./http.js";
import { galleryItem } from "./media-render.js";
import { providerLabel } from "./embed.js";
import { verifySignature, publicKeyJwk, algorithm } from "./esign.js";
import { text } from "./http.js";
import { parseLayout, renderHome, SECTION_CATALOG } from "./homeLayout.js";
import { turnstileWidget, turnstileScript } from "./turnstile.js";
import { otpauthUri } from "./totp.js";

const CATEGORIES = ["음식점", "카페·디저트", "생활·서비스", "패션·잡화", "농수축산", "교육·문화", "기타"];
const NOTICE_CATEGORIES = ["안내", "공지", "소식", "행사", "혜택", "긴급"];
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v != null && v !== "" && !(k === "page" && v === 1)) p.set(k, v); const s = p.toString(); return s ? "?" + s : ""; };
const canModerate = (user, assoc) => user && (user.role === "SUPERADMIN" || (user.role === "ADMIN" && user.association_id === assoc.id));

async function businessCard(db, base, b) {
  const cover = await D.getCoverImage(db, b.id);
  const thumb = cover ? `<img src="${esc(mediaUrl(cover.thumb || cover.filename))}" alt="${esc(b.name)}" loading="lazy" />` : `<span>${esc(b.name.slice(0, 2))}</span>`;
  return `<article class="market-card">
    <a href="${base}/business/${esc(b.slug)}" class="market-thumb">${thumb}</a>
    <div class="market-body"><span class="chip">${esc(b.category)}</span>${openBadge(b.hours)}
      <h3><a href="${base}/business/${esc(b.slug)}">${esc(b.name)}</a></h3>
      <p>${esc(b.description || "소개가 곧 등록됩니다.")}</p>
      <ul class="market-meta">${b.address ? `<li>📍 ${esc(b.address)}</li>` : ""}${b.phone ? `<li>☎ ${esc(b.phone)}</li>` : ""}</ul>
    </div></article>`;
}

export async function home(ctx) {
  const { db, assoc, base, user, csrf } = ctx;
  const lay = parseLayout(assoc.home_layout, assoc.name);
  const { items } = await D.listBusinessesPaged(db, assoc.id, { perPage: 6 });
  const businessesHtml = (await Promise.all(items.map((b) => businessCard(db, base, b)))).join("") || `<p class="empty">등록된 점포가 곧 표시됩니다.</p>`;
  const notices = await D.listNotices(db, assoc.id, 5);
  const events = await D.listEvents(db, assoc.id, true);
  const stats = await D.stats(db, assoc.id);
  const eventsHtml = events.length ? events.map((e) => {
    const d = e.event_date.slice(8, 10), mo = Number(e.event_date.slice(5, 7)) + "월";
    return `<article class="event-card"><div class="event-date"><span class="d">${d}</span><span class="m">${mo}</span></div>
      <div class="event-info"><h3>${esc(e.title)}</h3><p>${esc(e.description)}</p><span class="event-place">📍 ${esc(e.place)}</span></div></article>`;
  }).join("") : `<p class="empty">예정된 행사가 없습니다.</p>`;
  const body = renderHome(lay, { assoc, base, stats, businessesHtml, noticesHtml: noticeRows(base, notices), eventsHtml, loggedIn: !!user });
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
      <label class="check"><input type="checkbox" name="en_${i}" value="1"${sec.enabled ? " checked" : ""} /> <strong>${esc(cat.label)}</strong></label>
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
  const cards = (await Promise.all(items.map((b) => businessCard(db, base, b)))).join("") || `<p class="empty">${q ? "검색 결과가 없습니다." : "등록된 점포가 없습니다."}</p>`;
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
  const pending = b.status !== "approved" ? `<div class="flash flash-warn">이 페이지는 ${statusBadge(b.status)} 상태입니다.</div>` : "";
  const body = `
  <section class="biz-hero"><div class="container">${pending}
    <span class="chip chip-light">${esc(b.category)}</span>${openBadge(b.hours)}<h1>${esc(b.name)}</h1>
    <p class="biz-desc">${esc(b.description || "소개가 곧 등록됩니다.")}</p>
    <ul class="biz-contact">
      ${b.address ? `<li>📍 ${esc(b.address)}</li>` : ""}${b.phone ? `<li>☎️ <a href="tel:${esc(b.phone)}">${esc(b.phone)}</a></li>` : ""}${b.hours ? `<li>🕘 ${esc(b.hours)}</li>` : ""}
    </ul></div></section>
  <section class="section"><div class="container">
    ${images.length ? `<h2 class="biz-section-title">사진</h2>${gallery(images)}` : ""}
    ${vids.length ? `<h2 class="biz-section-title">영상</h2>${gallery(vids)}` : ""}
    ${!media.length ? `<p class="empty">아직 등록된 사진·영상이 없습니다.</p>` : ""}
    <div class="section-more"><a href="${base}/businesses" class="btn btn-ghost btn-sm">← 다른 점포 보기</a></div>
  </div></section>`;
  return html(layout({ title: b.name, assoc, base, user, body, activeNav: `${base}/businesses`, csrf,
    description: clip(b.description) || `${assoc.name} · ${b.category} · ${b.name}`,
    scripts: media.length ? `<script src="/js/viewer.js" defer></script>` : "" }));
}

export function loginForm(ctx) {
  const { env, query, csrf } = ctx;
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    <h1 class="auth-title">로그인</h1><p class="auth-sub">상인회 회원·관리자 로그인</p>
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
      ${m.address ? `<span class="map-store-addr">📍 ${esc(m.address)}</span>` : ""}
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
function noticeRows(base, list) {
  return list.length ? list.map((n) => `<li${n.image ? ' class="has-thumb"' : ""}><a href="${base}/notices/${n.id}">
    ${n.image ? `<img class="notice-thumb" src="${esc(mediaUrl(n.image))}" alt="" loading="lazy" />` : ""}
    <span class="notice-tag${n.pinned ? " tag-important" : ""}">${esc(n.tag)}</span>
    <span class="notice-title">${esc(n.title)}</span><time>${esc(n.created_at.slice(0, 10).replace(/-/g, "."))}</time></a></li>`).join("")
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
  return html(layout({ title: n.title, assoc, base, user, body, activeNav: `${base}/notices`, csrf, description: clip(n.body) || n.title }));
}

// ================= 행사 =================
export async function events(ctx) {
  const { db, assoc, base, user, csrf } = ctx;
  const list = await D.listEvents(db, assoc.id);
  const cards = list.length ? list.map((e) => {
    const d = e.event_date.slice(8, 10), mo = Number(e.event_date.slice(5, 7)) + "월";
    return `<article class="event-card"><div class="event-date"><span class="d">${d}</span><span class="m">${mo}</span></div>
      <div class="event-info"><h3>${esc(e.title)}</h3><p>${esc(e.description)}</p><span class="event-place">📍 ${esc(e.place)}</span></div></article>`;
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
    <h1 class="auth-title">${esc(assoc.name)} 가입</h1><p class="auth-sub">점포 정보를 등록하고 사진·소식을 공유하세요.</p>${flashOf(query)}
    <form method="post" action="${base}/register" class="stack-form">
      <label>대표자 성함<input type="text" name="name" required maxlength="60" /></label>
      <label>이메일<input type="email" name="email" required /></label>
      <label>비밀번호 (8자 이상)<input type="password" name="password" required minlength="8" /></label>
      <label>점포명<input type="text" name="business_name" required maxlength="100" /></label>
      <label>업종<select name="category">${opts}</select></label>
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
    </div></div></section>`;
  const picker = naver ? `<script src="https://oapi.map.naver.com/openapi/v3/maps.js?${esc(env.NAVER_MAP_PARAM || "ncpClientId")}=${esc(naver)}"></script><script src="/js/map.js" defer></script>` : "";
  return html(layout({ title: "내 업체 관리", assoc, base, user, body, csrf, scripts: `<script src="/js/viewer.js" defer></script><script src="/js/upload-resize.js" defer></script>${picker}` }));
}

const docBody = (b) => esc(b).replace(/\n/g, "<br />");
const csvCell = (v) => { const s = String(v == null ? "" : v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

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
    <div class="stat-cards">
      <div class="stat-card"><span class="stat-num">${s.businesses}</span><span class="stat-label">승인 업체</span></div>
      <div class="stat-card${s.pending ? " stat-alert" : ""}"><span class="stat-num">${s.pending}</span><span class="stat-label">승인 대기</span></div>
      <div class="stat-card"><span class="stat-num">${s.notices}</span><span class="stat-label">공지</span></div>
      <div class="stat-card"><span class="stat-num">${s.events}</span><span class="stat-label">행사</span></div>
      <div class="stat-card"><span class="stat-num">${s.mediaCount}</span><span class="stat-label">미디어</span></div></div>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">알림함${unread ? ` <span class="badge badge-wait">${unread}</span>` : ""}</h2>
      ${unread ? `<form method="post" action="${base}/admin/notifications/read"><button class="btn btn-xs btn-ghost">모두 읽음</button></form>` : ""}</div>
      <ul class="notif-list">${notifRows}</ul></section>
    <section class="panel"><div class="panel-head"><h2 class="panel-title">회원 관리 <span class="badge badge-muted">${members.length}명</span></h2>
      ${members.length ? `<a class="btn btn-xs btn-ghost" href="${base}/admin/members.csv">⬇ 명단 CSV</a>` : ""}</div>
      <div class="table-scroll"><table class="admin-table"><thead><tr><th>회원</th><th>업체</th><th>비밀번호</th></tr></thead><tbody>${memberRows}</tbody></table></div></section>
    ${auditPanel}
    <section class="panel"><h2 class="panel-title">홈페이지 구성 편집</h2>
      <p class="panel-hint">섹션을 켜고 끄거나 순서(▲▼)를 바꾸고 문구를 직접 수정할 수 있습니다.</p>
      ${layoutEditor(base, lay)}</section>
    <section class="panel"><h2 class="panel-title">상인회 정보 · 브랜딩</h2>
      <form method="post" action="${base}/admin/settings" enctype="multipart/form-data" class="stack-form">
        <div class="form-two"><label>상인회 이름<input type="text" name="name" value="${esc(assoc.name)}" required /></label><label>대표 색상<input type="color" name="brand_color" value="${esc(assoc.brand_color)}" /></label></div>
        <label>한 줄 소개<input type="text" name="tagline" value="${esc(assoc.tagline)}" /></label>
        <div class="form-two"><label>대표 전화<input type="text" name="phone" value="${esc(assoc.phone)}" /></label><label>이메일<input type="email" name="email" value="${esc(assoc.email)}" /></label></div>
        <label>주소<input type="text" name="address" value="${esc(assoc.address)}" /></label>
        <label class="mini-label">로고 <small>(선택·이미지)</small><input type="file" name="logo" accept="image/*" /></label>
        <button class="btn btn-primary btn-sm">브랜딩 저장</button></form></section>
    <section class="panel"><h2 class="panel-title">업체 관리</h2><div class="table-scroll"><table class="admin-table">
      <thead><tr><th>업체</th><th>사장님</th><th>상태</th><th>처리</th></tr></thead><tbody>${bizRows}</tbody></table></div></section>
    <div class="dash-grid">
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
    </div></div></section>`;
  return html(layout({ title: "관리자", assoc, base, user, body, activeNav: `${base}/admin`, csrf, scripts: `<script src="/js/layout-editor.js" defer></script><script src="/js/upload-resize.js" defer></script>` }));
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
  const rows = list.map((a) => `<tr><td><a href="/t/${esc(a.slug)}" target="_blank">${esc(a.name)}</a><br /><small>/t/${esc(a.slug)}</small></td>
    <td>${a.active ? '<span class="badge badge-ok">활성</span>' : '<span class="badge badge-no">비활성</span>'}</td>
    <td class="actions-cell"><a class="btn btn-xs btn-ghost" href="/t/${esc(a.slug)}/admin">관리</a>
      <form method="post" action="/super/association/${a.id}/toggle"><button class="btn btn-xs btn-ghost">${a.active ? "비활성화" : "활성화"}</button></form></td></tr>`).join("") || `<tr><td colspan="3" class="empty">상인회가 없습니다.</td></tr>`;
  const body = `<section class="dash"><div class="container">
    <div class="dash-head"><div><p class="section-eyebrow">SUPER</p><h1 class="dash-title">플랫폼 관리</h1></div>
      <div class="dash-head-actions"><form method="post" action="/logout"><button class="btn btn-ghost btn-sm">로그아웃</button></form></div></div>${flashOf(query)}
    <div class="stat-cards"><div class="stat-card"><span class="stat-num">${ps.associations}</span><span class="stat-label">상인회</span></div>
      <div class="stat-card"><span class="stat-num">${ps.businesses}</span><span class="stat-label">승인 업체</span></div>
      <div class="stat-card"><span class="stat-num">${ps.users}</span><span class="stat-label">사용자</span></div>
      <div class="stat-card"><span class="stat-num">${ps.media}</span><span class="stat-label">미디어</span></div></div>
    <section class="panel panel-accent"><h2 class="panel-title">➕ 새 상인회 (사이트 복제)</h2>
      <form method="post" action="/super/association" class="stack-form">
        <div class="form-two"><label>상인회 이름<input type="text" name="name" required /></label><label>대표 색상<input type="color" name="brand_color" value="#0b6e4f" /></label></div>
        <label>한 줄 소개<input type="text" name="tagline" /></label>
        <div class="form-divider">관리자 계정</div>
        <div class="form-two"><label>관리자 이름<input type="text" name="admin_name" /></label><label>관리자 이메일<input type="email" name="admin_email" required /></label></div>
        <label>관리자 비밀번호 (8자 이상)<input type="password" name="admin_password" required minlength="8" /></label>
        <button class="btn btn-primary">상인회 생성</button></form></section>
    <section class="panel"><h2 class="panel-title">상인회 목록</h2><div class="table-scroll"><table class="admin-table">
      <thead><tr><th>상인회</th><th>상태</th><th>관리</th></tr></thead><tbody>${rows}</tbody></table></div></section>
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
  const { query, csrf } = ctx;
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    <h1 class="auth-title">비밀번호 찾기</h1><p class="auth-sub">가입한 이메일을 입력하면 상인회 관리자에게 재설정 요청이 전달됩니다.</p>
    ${flashOf(query)}
    <form method="post" action="/forgot" class="stack-form"><label>이메일<input type="email" name="email" required /></label>
      <button class="btn btn-primary btn-block">재설정 요청</button></form>
    <p class="auth-note">보안을 위해 이메일 존재 여부와 관계없이 동일하게 안내됩니다. 관리자가 확인 후 임시 비밀번호를 발급합니다.</p></div></div></section>`;
  return html(layout({ title: "비밀번호 찾기", assoc: ctx.assoc, base: ctx.base, body, csrf }));
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
