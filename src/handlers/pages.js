// 서버 사이드 렌더링 페이지 핸들러 (GET) — 멀티테넌트
import { html, esc, redirect } from "../http.js";
import { layout, flash, statusBadge, hueFor } from "../render.js";
import { ROLES } from "../auth.js";
import * as M from "../models.js";
import * as A from "../associations.js";
import * as storage from "../storage.js";
import { parseLayout, defaultLayout, SECTION_CATALOG, renderHome } from "../homeLayout.js";
import { config } from "../config.js";

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

function mediaThumb(m) {
  const url = storage.publicUrl(m.filename);
  return m.kind === "video"
    ? `<video src="${url}" controls preload="metadata" playsinline></video>`
    : `<img src="${url}" alt="${esc(m.caption || "업체 사진")}" loading="lazy" />`;
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
  html(res, layout({ title: "홈", user: req.user, assoc, base, activeNav: base + "/", body }));
}

// ================= 업체 목록 =================
export function businesses(req, res, { assoc, query }) {
  const base = baseOf(assoc);
  const cat = query.get("category");
  const list = M.listBusinesses(assoc.id, { category: cat });
  const cats = M.distinctCategories(assoc.id);
  const filterChips =
    `<a href="${base}/businesses" class="chip-filter${!cat ? " active" : ""}">전체</a>` +
    cats.map((c) => `<a href="${base}/businesses?category=${encodeURIComponent(c.category)}" class="chip-filter${cat === c.category ? " active" : ""}">${esc(c.category)} <em>${c.n}</em></a>`).join("");
  const grid = list.length ? list.map((b) => businessCard(assoc, b)).join("") : `<p class="empty">해당 조건의 업체가 없습니다.</p>`;
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><p class="section-eyebrow">MEMBERS</p><h2 class="section-title">업체 안내</h2>
      <p class="section-lead">${esc(assoc.name)} 소속 업체 ${list.length}곳을 소개합니다.</p></div>
    <div class="chip-filters">${filterChips}</div>
    <div class="market-grid">${grid}</div></div></section>`;
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
    ? `<div class="gallery">${items.map((m) => `<figure class="gallery-item">${mediaThumb(m)}${m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : "";
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
  html(res, layout({ title: b.name, user: req.user, assoc, base, activeNav: base + "/businesses", body }));
}

// ================= 공지 =================
export function notices(req, res, { assoc }) {
  const base = baseOf(assoc);
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><p class="section-eyebrow">NOTICE</p><h2 class="section-title">공지사항</h2></div>
    <ul class="notice-list">${noticeRowsHtml(assoc, M.listNotices(assoc.id))}</ul></div></section>`;
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
    <p class="auth-alt"><a href="/">← 상인회 목록으로</a></p>
  </div></div></section>`;
  html(res, layout({ title: "로그인", user: req.user, body }));
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
  const opts = CATEGORIES.map((c) => `<option value="${esc(c)}"${c === b.category ? " selected" : ""}>${esc(c)}</option>`).join("");
  const mediaGrid = media.length
    ? media.map((m) => `<figure class="media-tile">${mediaThumb(m)}<figcaption>
        <span class="media-kind">${m.kind === "video" ? "🎬 영상" : "🖼 사진"}</span>
        <form method="post" action="${base}/dashboard/media/${m.id}/delete" onsubmit="return confirm('삭제하시겠습니까?')"><button class="link-danger" type="submit">삭제</button></form>
      </figcaption></figure>`).join("")
    : `<p class="empty">아직 업로드한 사진·영상이 없습니다.</p>`;
  const body = `
  <section class="dash"><div class="container">
    <div class="dash-head"><div>
      <p class="section-eyebrow">MY BUSINESS</p>
      <h1 class="dash-title">${esc(b.name)} ${statusBadge(b.status)}</h1>
      <p class="dash-sub">공개 주소: <a href="${base}/business/${esc(b.slug)}" target="_blank">${base}/business/${esc(b.slug)}</a></p>
    </div><a href="${base}/business/${esc(b.slug)}" class="btn btn-ghost btn-sm" target="_blank">내 페이지 보기</a></div>
    ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", query.get("err") ? "err" : "ok")}
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
  html(res, layout({ title: "내 업체 관리", user: req.user, assoc, base, body, scripts: `<script src="/js/dashboard.js" defer></script>` }));
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
    <form method="post" action="${base}/admin/notice/${n.id}/delete" onsubmit="return confirm('삭제하시겠습니까?')"><button class="link-danger">삭제</button></form></li>`).join("") || `<li class="empty">공지가 없습니다.</li>`;
  const eventRows = events.map((e) => `<li><span class="event-mini-date">${esc(e.event_date)}</span>
    <span class="notice-title">${esc(e.title)}</span>
    <form method="post" action="${base}/admin/event/${e.id}/delete" onsubmit="return confirm('삭제하시겠습니까?')"><button class="link-danger">삭제</button></form></li>`).join("") || `<li class="empty">행사가 없습니다.</li>`;

  const superNote = req.user.role === ROLES.SUPERADMIN
    ? `<div class="flash flash-warn">슈퍼 관리자로 <strong>${esc(assoc.name)}</strong>의 관리 화면을 보고 있습니다. <a href="/super">← 슈퍼 관리자</a></div>` : "";

  const body = `
  <section class="dash"><div class="container">
    <div class="dash-head"><div>
      <p class="section-eyebrow">ADMIN · ${esc(assoc.name)}</p>
      <h1 class="dash-title">관리자 대시보드</h1>
      <p class="dash-sub">홈페이지 주소: <a href="${base}" target="_blank">${base}</a></p>
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
      <button type="submit" formaction="${base}/admin/layout/reset" class="btn btn-ghost btn-sm" onclick="return confirm('기본 구성으로 되돌리시겠습니까?')">기본 구성으로 초기화</button>
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

  const body = `
  <section class="dash"><div class="container">
    <div class="dash-head"><div>
      <p class="section-eyebrow">SUPER ADMIN</p>
      <h1 class="dash-title">슈퍼 관리자 콘솔</h1>
      <p class="dash-sub">플랫폼 전체와 상인회 사이트 복제를 관리합니다.</p>
    </div></div>
    ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", query.get("err") ? "err" : "ok")}
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

// ================= 404 =================
export function notFound(req, res, ctx = {}) {
  const assoc = ctx.assoc || null;
  const base = assoc ? baseOf(assoc) : "";
  const body = `<section class="section page-top"><div class="container center-block">
    <h1 class="big-404">404</h1><p class="section-lead">요청하신 페이지를 찾을 수 없습니다.</p>
    <a href="${base || "/"}" class="btn btn-primary">홈으로</a></div></section>`;
  html(res, layout({ title: "404", user: req.user, assoc, base, body }), 404);
}
