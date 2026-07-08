// 공개/인증 페이지 핸들러 (async). ctx = { env, db, assoc, base, user, url, query, csrf, params }
import * as D from "./db.js";
import { esc, clip } from "./util.js";
import { layout, flash, statusBadge, pager, mediaUrl } from "./render.js";
import { html, notFoundResponse } from "./http.js";
import { galleryItem } from "./media-render.js";
import { providerLabel } from "./embed.js";

const CATEGORIES = ["음식점", "카페·디저트", "생활·서비스", "패션·잡화", "농수축산", "교육·문화", "기타"];
const NOTICE_CATEGORIES = ["안내", "공지", "소식", "행사", "혜택", "긴급"];
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v != null && v !== "" && !(k === "page" && v === 1)) p.set(k, v); const s = p.toString(); return s ? "?" + s : ""; };
const canModerate = (user, assoc) => user && (user.role === "SUPERADMIN" || (user.role === "ADMIN" && user.association_id === assoc.id));

async function businessCard(db, base, b) {
  const cover = await D.getCoverImage(db, b.id);
  const thumb = cover ? `<img src="${esc(mediaUrl(cover.thumb || cover.filename))}" alt="${esc(b.name)}" loading="lazy" />` : `<span>${esc(b.name.slice(0, 2))}</span>`;
  return `<article class="market-card">
    <a href="${base}/business/${esc(b.slug)}" class="market-thumb">${thumb}</a>
    <div class="market-body"><span class="chip">${esc(b.category)}</span>
      <h3><a href="${base}/business/${esc(b.slug)}">${esc(b.name)}</a></h3>
      <p>${esc(b.description || "소개가 곧 등록됩니다.")}</p>
      <ul class="market-meta">${b.address ? `<li>📍 ${esc(b.address)}</li>` : ""}${b.phone ? `<li>☎ ${esc(b.phone)}</li>` : ""}</ul>
    </div></article>`;
}

export async function home(ctx) {
  const { db, assoc, base, user, csrf } = ctx;
  const { items } = await D.listBusinessesPaged(db, assoc.id, { perPage: 6 });
  const cards = (await Promise.all(items.map((b) => businessCard(db, base, b)))).join("") || `<p class="empty">등록된 점포가 곧 표시됩니다.</p>`;
  const body = `
  <section class="hero"><div class="container">
    <p class="hero-eyebrow">${esc(assoc.name)}</p>
    <h1 class="hero-title">${esc(assoc.tagline)}</h1>
    <p class="hero-lead">우리 동네 상권을 한곳에서. 가입 점포 안내·지도, 공지·소식, 회원 게시판, 전자서명까지.</p>
    <div class="hero-actions">
      <a href="${base}/businesses" class="btn btn-primary">가입 점포 보기</a>
      <a href="${base}/map" class="btn btn-ghost">점포 지도</a>
    </div>
  </div></section>
  <section class="section"><div class="container">
    <div class="section-head"><p class="section-eyebrow">MEMBERS</p><h2 class="section-title">새로 가입한 점포</h2></div>
    <div class="market-grid">${cards}</div>
    <div class="section-more"><a href="${base}/businesses" class="btn btn-ghost btn-sm">전체 점포 보기 →</a></div>
  </div></section>`;
  return html(layout({ title: "", assoc, base, user, body, activeNav: `${base}/`, csrf, description: assoc.tagline }));
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
    <span class="chip chip-light">${esc(b.category)}</span><h1>${esc(b.name)}</h1>
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
  const { query, csrf } = ctx;
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    <h1 class="auth-title">로그인</h1><p class="auth-sub">상인회 회원·관리자 로그인</p>
    ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", query.get("err") ? "err" : "ok")}
    <form method="post" action="/login" class="stack-form">
      <label>이메일<input type="email" name="email" required /></label>
      <label>비밀번호<input type="password" name="password" required /></label>
      <button class="btn btn-primary btn-block">로그인</button>
    </form></div></div></section>`;
  return html(layout({ title: "로그인", assoc: ctx.assoc, base: ctx.base, body, csrf }));
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
  return html(layout({ title: "회원 게시판", assoc, base, user, body, activeNav: `${base}/board`, csrf }));
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
  return html(layout({ title: "글 수정", assoc, base, user, body, activeNav: `${base}/board`, csrf }));
}

// ================= 회원가입 =================
export function registerForm(ctx) {
  const { assoc, base, query, csrf } = ctx;
  const opts = CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const body = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
    <h1 class="auth-title">${esc(assoc.name)} 가입</h1><p class="auth-sub">점포 정보를 등록하고 사진·소식을 공유하세요.</p>${flashOf(query)}
    <form method="post" action="${base}/register" class="stack-form">
      <label>대표자 성함<input type="text" name="name" required maxlength="60" /></label>
      <label>이메일<input type="email" name="email" required /></label>
      <label>비밀번호 (8자 이상)<input type="password" name="password" required minlength="8" /></label>
      <label>점포명<input type="text" name="business_name" required maxlength="100" /></label>
      <label>업종<select name="category">${opts}</select></label>
      <button class="btn btn-primary btn-block">가입 신청</button>
    </form><p class="auth-note">가입 후 관리자 승인 시 일반에 공개됩니다.</p></div></div></section>`;
  return html(layout({ title: "가입", assoc, base, body, csrf }));
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
  return html(layout({ title: "내 업체 관리", assoc, base, user, body, csrf, scripts: `<script src="/js/viewer.js" defer></script>${picker}` }));
}

// ================= 계정 =================
export function account(ctx) {
  const { assoc, base, user, query, csrf } = ctx;
  const body = `<section class="section page-top"><div class="container narrow">
    <h1 class="article-title">계정 설정</h1>${flashOf(query)}
    <section class="panel"><h2 class="panel-title">비밀번호 변경</h2>
      <form method="post" action="/account/password" class="stack-form">
        <label>현재 비밀번호<input type="password" name="current" required /></label>
        <label>새 비밀번호 (8자 이상)<input type="password" name="new" required minlength="8" /></label>
        <label>새 비밀번호 확인<input type="password" name="confirm" required /></label>
        <button class="btn btn-primary btn-sm">변경</button></form></section></div></section>`;
  return html(layout({ title: "계정", assoc, base, user, body, csrf }));
}
