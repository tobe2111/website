// 공개/인증 페이지 핸들러 (async). ctx = { env, db, assoc, base, user, url, query, csrf, params }
import * as D from "./db.js";
import { esc, clip } from "./util.js";
import { layout, flash, statusBadge, pager, mediaUrl } from "./render.js";
import { html, notFoundResponse } from "./http.js";

const CATEGORIES = ["음식점", "카페·디저트", "생활·서비스", "패션·잡화", "농수축산", "교육·문화", "기타"];

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
  const { galleryItem } = await import("./media-render.js");
  const gallery = (arr) => arr.length ? `<div class="gallery">${arr.map(galleryItem).join("")}</div>` : "";
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
