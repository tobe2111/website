// 서버 사이드 렌더링 페이지 핸들러 (GET)
import { html, esc, redirect } from "../http.js";
import { layout, flash, statusBadge, hueFor } from "../render.js";
import * as M from "../models.js";
import * as storage from "../storage.js";
import { config } from "../config.js";

const CATEGORIES = ["음식점", "카페·디저트", "생활·서비스", "패션·잡화", "농수축산", "교육·문화", "기타"];

function mediaThumb(m) {
  const url = storage.publicUrl(m.filename);
  if (m.kind === "video") {
    return `<video src="${url}" controls preload="metadata" playsinline></video>`;
  }
  return `<img src="${url}" alt="${esc(m.caption || "업체 사진")}" loading="lazy" />`;
}

// ---------- 홈 ----------
export function home(req, res) {
  const s = M.stats();
  const notices = M.listNotices(5);
  const events = M.listEvents(true).slice(0, 3);
  const businesses = M.listBusinesses({}).slice(0, 6);

  const noticeRows = notices.length
    ? notices
        .map(
          (n) => `<li><a href="/notices/${n.id}">
            <span class="notice-tag${n.pinned ? " tag-important" : ""}">${esc(n.tag)}</span>
            <span class="notice-title">${esc(n.title)}</span>
            <time>${esc(n.created_at.slice(0, 10).replace(/-/g, "."))}</time></a></li>`
        )
        .join("")
    : `<li class="empty">등록된 공지가 없습니다.</li>`;

  const eventCards = events.length
    ? events
        .map((e) => {
          const d = e.event_date.slice(8, 10);
          const mo = Number(e.event_date.slice(5, 7)) + "월";
          return `<article class="event-card">
            <div class="event-date"><span class="d">${d}</span><span class="m">${mo}</span></div>
            <div class="event-info"><h3>${esc(e.title)}</h3><p>${esc(e.description)}</p>
            <span class="event-place">📍 ${esc(e.place)}</span></div></article>`;
        })
        .join("")
    : `<p class="empty">예정된 행사가 없습니다.</p>`;

  const bizCards = businesses.length
    ? businesses.map(businessCard).join("")
    : `<p class="empty">등록된 업체가 없습니다. 첫 번째 업체가 되어보세요!</p>`;

  const body = `
  <section class="hero" id="home">
    <div class="hero-bg" aria-hidden="true"></div>
    <div class="container hero-inner">
      <p class="hero-eyebrow">서초구 지역 상권 공식 커뮤니티</p>
      <h1 class="hero-title">함께 성장하는<br /><span>서초 상권</span>을 만듭니다</h1>
      <p class="hero-desc">서초구 상인회는 지역 상인 여러분의 든든한 동반자입니다.<br class="br-pc" />
        업체 소개, 사진·영상 홍보, 공동 마케팅으로 활기찬 상권을 함께 만들어갑니다.</p>
      <div class="hero-actions">
        <a href="/register" class="btn btn-primary">우리 업체 등록하기</a>
        <a href="/businesses" class="btn btn-ghost">업체 둘러보기</a>
      </div>
      <dl class="hero-stats">
        <div><dt>등록 업체</dt><dd>${s.businesses}<span>곳</span></dd></div>
        <div><dt>진행 행사</dt><dd>${s.events}<span>건</span></dd></div>
        <div><dt>홍보 미디어</dt><dd>${s.mediaCount}<span>개</span></dd></div>
      </dl>
    </div>
  </section>

  <section class="section" id="businesses-preview">
    <div class="container">
      <div class="section-head">
        <p class="section-eyebrow">MEMBERS</p>
        <h2 class="section-title">서초의 우리 동네 업체</h2>
        <p class="section-lead">상인회에 소속된 업체들을 만나보세요. 각 업체의 사진과 영상도 확인할 수 있습니다.</p>
      </div>
      <div class="market-grid">${bizCards}</div>
      <div class="section-more"><a href="/businesses" class="btn btn-ghost btn-sm">전체 업체 보기</a></div>
    </div>
  </section>

  <section class="section section-alt" id="notice">
    <div class="container">
      <div class="section-head"><p class="section-eyebrow">NOTICE</p>
        <h2 class="section-title">공지사항</h2>
        <p class="section-lead">상인회의 최신 소식을 확인하세요.</p></div>
      <ul class="notice-list">${noticeRows}</ul>
      <div class="section-more"><a href="/notices" class="btn btn-ghost btn-sm">공지사항 전체보기</a></div>
    </div>
  </section>

  <section class="section" id="events">
    <div class="container">
      <div class="section-head"><p class="section-eyebrow">EVENTS</p>
        <h2 class="section-title">다가오는 행사·이벤트</h2>
        <p class="section-lead">상권을 활기차게 만드는 다양한 행사에 함께해 주세요.</p></div>
      <div class="event-grid">${eventCards}</div>
    </div>
  </section>

  <section class="section section-dark" id="join">
    <div class="container cta-inner">
      <h2 class="section-title">아직 상인회 회원이 아니신가요?</h2>
      <p class="section-lead">지금 업체를 등록하면 나만의 업체 페이지에 사진·영상을 올리고 서초 상권 홍보에 함께할 수 있습니다.</p>
      <a href="/register" class="btn btn-primary">무료로 업체 등록하기</a>
    </div>
  </section>`;

  html(res, layout({ title: "홈", user: req.user, activeNav: "/", body }));
}

function businessCard(b) {
  const hue = hueFor(b.category + b.name);
  const cover = M.listMedia(b.id).find((m) => m.kind === "image");
  const thumb = cover
    ? `<img src="${storage.publicUrl(cover.filename)}" alt="${esc(b.name)}" loading="lazy" />`
    : `<span>${esc(b.name.slice(0, 2))}</span>`;
  return `<article class="market-card">
    <a href="/business/${esc(b.slug)}" class="market-thumb" style="--hue:${hue}" aria-hidden="false">${thumb}</a>
    <div class="market-body">
      <span class="chip">${esc(b.category)}</span>
      <h3><a href="/business/${esc(b.slug)}">${esc(b.name)}</a></h3>
      <p>${esc(b.description || "소개가 곧 등록됩니다.")}</p>
      <ul class="market-meta">${b.address ? `<li>📍 ${esc(b.address)}</li>` : ""}${b.phone ? `<li>☎ ${esc(b.phone)}</li>` : ""}</ul>
    </div></article>`;
}

// ---------- 업체 목록 ----------
export function businesses(req, res, { query }) {
  const cat = query.get("category");
  const list = M.listBusinesses({ category: cat });
  const cats = M.distinctCategories();

  const filterChips =
    `<a href="/businesses" class="chip-filter${!cat ? " active" : ""}">전체</a>` +
    cats
      .map(
        (c) =>
          `<a href="/businesses?category=${encodeURIComponent(c.category)}" class="chip-filter${cat === c.category ? " active" : ""}">${esc(c.category)} <em>${c.n}</em></a>`
      )
      .join("");

  const grid = list.length
    ? list.map(businessCard).join("")
    : `<p class="empty">해당 조건의 업체가 없습니다.</p>`;

  const body = `
  <section class="section page-top">
    <div class="container">
      <div class="section-head"><p class="section-eyebrow">MEMBERS</p>
        <h2 class="section-title">업체 안내</h2>
        <p class="section-lead">서초구 상인회 소속 업체 ${list.length}곳을 소개합니다.</p></div>
      <div class="chip-filters">${filterChips}</div>
      <div class="market-grid">${grid}</div>
    </div>
  </section>`;
  html(res, layout({ title: "업체 안내", user: req.user, activeNav: "/businesses", body }));
}

// ---------- 업체 상세 ----------
export function businessDetail(req, res, { params }) {
  const b = M.getBusinessBySlug(params.slug);
  if (!b || (b.status !== "approved" && (!req.user || (req.user.id !== b.owner_id && req.user.role !== "ADMIN")))) {
    return notFound(req, res);
  }
  const media = M.listMedia(b.id);
  const images = media.filter((m) => m.kind === "image");
  const videos = media.filter((m) => m.kind === "video");
  const hue = hueFor(b.category + b.name);

  const gallery = (items) =>
    items.length
      ? `<div class="gallery">${items
          .map(
            (m) =>
              `<figure class="gallery-item">${mediaThumb(m)}${m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : ""}</figure>`
          )
          .join("")}</div>`
      : "";

  const pendingBanner =
    b.status !== "approved"
      ? `<div class="flash flash-warn">이 페이지는 ${statusBadge(b.status)} 상태입니다. 관리자 승인 후 일반에 공개됩니다.</div>`
      : "";

  const body = `
  <section class="biz-hero" style="--hue:${hue}">
    <div class="container">
      ${pendingBanner}
      <span class="chip chip-light">${esc(b.category)}</span>
      <h1>${esc(b.name)}</h1>
      <p class="biz-desc">${esc(b.description || "소개가 곧 등록됩니다.")}</p>
      <ul class="biz-contact">
        ${b.address ? `<li><span aria-hidden="true">📍</span> ${esc(b.address)}</li>` : ""}
        ${b.phone ? `<li><span aria-hidden="true">☎️</span> <a href="tel:${esc(b.phone)}">${esc(b.phone)}</a></li>` : ""}
        ${b.hours ? `<li><span aria-hidden="true">🕘</span> ${esc(b.hours)}</li>` : ""}
      </ul>
    </div>
  </section>
  <section class="section">
    <div class="container">
      ${images.length ? `<h2 class="biz-section-title">사진</h2>${gallery(images)}` : ""}
      ${videos.length ? `<h2 class="biz-section-title">영상</h2>${gallery(videos)}` : ""}
      ${!media.length ? `<p class="empty">아직 등록된 사진·영상이 없습니다.</p>` : ""}
      <div class="section-more"><a href="/businesses" class="btn btn-ghost btn-sm">← 다른 업체 보기</a></div>
    </div>
  </section>`;
  html(res, layout({ title: b.name, user: req.user, activeNav: "/businesses", body }));
}

// ---------- 공지 목록/상세 ----------
export function notices(req, res) {
  const list = M.listNotices();
  const rows = list.length
    ? list
        .map(
          (n) => `<li><a href="/notices/${n.id}">
        <span class="notice-tag${n.pinned ? " tag-important" : ""}">${esc(n.tag)}</span>
        <span class="notice-title">${esc(n.title)}</span>
        <time>${esc(n.created_at.slice(0, 10).replace(/-/g, "."))}</time></a></li>`
        )
        .join("")
    : `<li class="empty">등록된 공지가 없습니다.</li>`;
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><p class="section-eyebrow">NOTICE</p><h2 class="section-title">공지사항</h2></div>
    <ul class="notice-list">${rows}</ul></div></section>`;
  html(res, layout({ title: "공지사항", user: req.user, activeNav: "/notices", body }));
}

export function noticeDetail(req, res, { params }) {
  const n = M.getNotice(Number(params.id));
  if (!n) return notFound(req, res);
  const body = `<section class="section page-top"><div class="container narrow">
    <a href="/notices" class="back-link">← 공지 목록</a>
    <div class="article-head"><span class="notice-tag${n.pinned ? " tag-important" : ""}">${esc(n.tag)}</span>
      <time>${esc(n.created_at.slice(0, 10).replace(/-/g, "."))}</time></div>
    <h1 class="article-title">${esc(n.title)}</h1>
    <div class="article-body">${esc(n.body).replace(/\n/g, "<br />")}</div>
    </div></section>`;
  html(res, layout({ title: n.title, user: req.user, activeNav: "/notices", body }));
}

// ---------- 행사 목록 ----------
export function events(req, res) {
  const list = M.listEvents();
  const cards = list.length
    ? list
        .map((e) => {
          const d = e.event_date.slice(8, 10);
          const mo = Number(e.event_date.slice(5, 7)) + "월";
          return `<article class="event-card">
        <div class="event-date"><span class="d">${d}</span><span class="m">${mo}</span></div>
        <div class="event-info"><h3>${esc(e.title)}</h3><p>${esc(e.description)}</p>
        <span class="event-place">📍 ${esc(e.place)} · ${esc(e.event_date)}</span></div></article>`;
        })
        .join("")
    : `<p class="empty">등록된 행사가 없습니다.</p>`;
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><p class="section-eyebrow">EVENTS</p><h2 class="section-title">행사·이벤트</h2></div>
    <div class="event-grid">${cards}</div></div></section>`;
  html(res, layout({ title: "행사·이벤트", user: req.user, activeNav: "/events", body }));
}

// ---------- 인증 폼 ----------
export function loginForm(req, res, { query }) {
  if (req.user) return redirect(res, req.user.role === "ADMIN" ? "/admin" : "/dashboard");
  const body = `<section class="section page-top"><div class="container auth-wrap">
    <div class="auth-card">
      <h1 class="auth-title">로그인</h1>
      <p class="auth-sub">상인회 회원 및 관리자 로그인</p>
      ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", query.get("err") ? "err" : "ok")}
      <form method="post" action="/login" class="stack-form">
        <label>이메일<input type="email" name="email" required autocomplete="email" placeholder="you@example.com" /></label>
        <label>비밀번호<input type="password" name="password" required autocomplete="current-password" /></label>
        <button type="submit" class="btn btn-primary btn-block">로그인</button>
      </form>
      <p class="auth-alt">아직 회원이 아니신가요? <a href="/register">업체 등록하기</a></p>
    </div></div></section>`;
  html(res, layout({ title: "로그인", user: req.user, body }));
}

export function registerForm(req, res, { query }) {
  if (req.user) return redirect(res, "/dashboard");
  const opts = CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const body = `<section class="section page-top"><div class="container auth-wrap">
    <div class="auth-card">
      <h1 class="auth-title">업체 등록</h1>
      <p class="auth-sub">상인회 회원 가입 및 우리 업체 페이지 개설</p>
      ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", "err")}
      <form method="post" action="/register" class="stack-form">
        <label>사장님 성함<input type="text" name="name" required autocomplete="name" placeholder="홍길동" /></label>
        <label>이메일<input type="email" name="email" required autocomplete="email" placeholder="you@example.com" /></label>
        <label>비밀번호 <small>(8자 이상)</small><input type="password" name="password" required minlength="8" autocomplete="new-password" /></label>
        <div class="form-divider">업체 정보</div>
        <label>업체명<input type="text" name="business_name" required placeholder="OO상회" /></label>
        <label>업종<select name="category">${opts}</select></label>
        <button type="submit" class="btn btn-primary btn-block">가입하고 업체 페이지 만들기</button>
      </form>
      <p class="auth-alt">이미 회원이신가요? <a href="/login">로그인</a></p>
      <p class="auth-note">가입 후 관리자 승인을 거쳐 업체 페이지가 일반에 공개됩니다.</p>
    </div></div></section>`;
  html(res, layout({ title: "업체 등록", user: req.user, body }));
}

// ---------- 회원(업체) 대시보드 ----------
export function dashboard(req, res, { query }) {
  const b = M.getBusinessByOwner(req.user.id);
  if (!b) {
    return html(res, layout({ title: "대시보드", user: req.user, body: `<section class="section page-top"><div class="container"><p class="empty">연결된 업체가 없습니다. 관리자에게 문의하세요.</p></div></section>` }));
  }
  const media = M.listMedia(b.id);
  const opts = CATEGORIES.map(
    (c) => `<option value="${esc(c)}"${c === b.category ? " selected" : ""}>${esc(c)}</option>`
  ).join("");

  const mediaGrid = media.length
    ? media
        .map(
          (m) => `<figure class="media-tile">
        ${mediaThumb(m)}
        <figcaption>
          <span class="media-kind">${m.kind === "video" ? "🎬 영상" : "🖼 사진"}</span>
          <form method="post" action="/dashboard/media/${m.id}/delete" onsubmit="return confirm('삭제하시겠습니까?')">
            <button class="link-danger" type="submit">삭제</button>
          </form>
        </figcaption></figure>`
        )
        .join("")
    : `<p class="empty">아직 업로드한 사진·영상이 없습니다.</p>`;

  const body = `
  <section class="dash">
    <div class="container">
      <div class="dash-head">
        <div>
          <p class="section-eyebrow">MY BUSINESS</p>
          <h1 class="dash-title">${esc(b.name)} ${statusBadge(b.status)}</h1>
          <p class="dash-sub">공개 주소: <a href="/business/${esc(b.slug)}" target="_blank">/business/${esc(b.slug)}</a></p>
        </div>
        <a href="/business/${esc(b.slug)}" class="btn btn-ghost btn-sm" target="_blank">내 페이지 보기</a>
      </div>
      ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", query.get("err") ? "err" : "ok")}

      <div class="dash-grid">
        <section class="panel">
          <h2 class="panel-title">업체 정보</h2>
          <form method="post" action="/dashboard/business" class="stack-form">
            <label>업체명<input type="text" name="name" value="${esc(b.name)}" required /></label>
            <label>업종<select name="category">${opts}</select></label>
            <label>소개<textarea name="description" rows="4" placeholder="업체 소개를 입력하세요.">${esc(b.description)}</textarea></label>
            <div class="form-two">
              <label>전화번호<input type="tel" name="phone" value="${esc(b.phone)}" placeholder="02-000-0000" /></label>
              <label>영업시간<input type="text" name="hours" value="${esc(b.hours)}" placeholder="매일 10:00 - 22:00" /></label>
            </div>
            <label>주소<input type="text" name="address" value="${esc(b.address)}" placeholder="서초구 ..." /></label>
            <button type="submit" class="btn btn-primary">정보 저장</button>
          </form>
        </section>

        <section class="panel">
          <h2 class="panel-title">사진·영상 업로드</h2>
          <form method="post" action="/dashboard/media" enctype="multipart/form-data" class="upload-form" id="uploadForm">
            <label class="file-drop" id="fileDrop">
              <input type="file" name="files" id="fileInput" accept="image/*,video/*" multiple />
              <span class="file-drop-text">📁 클릭하거나 파일을 끌어다 놓으세요<br /><small>이미지 최대 8MB · 영상 최대 120MB</small></span>
            </label>
            <input type="text" name="caption" placeholder="설명 (선택)" class="caption-input" />
            <div id="fileList" class="file-list"></div>
            <button type="submit" class="btn btn-primary btn-block" id="uploadBtn">업로드</button>
          </form>
          <h3 class="panel-subtitle">등록된 미디어 (${media.length})</h3>
          <div class="media-grid">${mediaGrid}</div>
        </section>
      </div>
    </div>
  </section>`;
  html(res, layout({ title: "내 업체 관리", user: req.user, body, scripts: `<script src="/js/dashboard.js" defer></script>` }));
}

// ---------- 관리자 대시보드 ----------
export function admin(req, res, { query }) {
  const s = M.stats();
  const all = M.listAllBusinesses();
  const notices = M.listNotices();
  const events = M.listEvents();

  const bizRows = all.length
    ? all
        .map(
          (b) => `<tr>
      <td><a href="/business/${esc(b.slug)}" target="_blank">${esc(b.name)}</a><br /><small>${esc(b.category)}</small></td>
      <td>${esc(b.owner_name)}<br /><small>${esc(b.owner_email)}</small></td>
      <td>${statusBadge(b.status)}</td>
      <td class="actions-cell">
        ${b.status !== "approved" ? `<form method="post" action="/admin/business/${b.id}/status"><input type="hidden" name="status" value="approved" /><button class="btn btn-xs btn-primary">승인</button></form>` : ""}
        ${b.status !== "rejected" ? `<form method="post" action="/admin/business/${b.id}/status"><input type="hidden" name="status" value="rejected" /><button class="btn btn-xs btn-ghost">반려</button></form>` : ""}
      </td></tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="empty">등록된 업체가 없습니다.</td></tr>`;

  const noticeRows = notices
    .map(
      (n) => `<li><span class="notice-tag${n.pinned ? " tag-important" : ""}">${esc(n.tag)}</span>
    <span class="notice-title">${esc(n.title)}</span>
    <form method="post" action="/admin/notice/${n.id}/delete" onsubmit="return confirm('삭제하시겠습니까?')"><button class="link-danger">삭제</button></form></li>`
    )
    .join("") || `<li class="empty">공지가 없습니다.</li>`;

  const eventRows = events
    .map(
      (e) => `<li><span class="event-mini-date">${esc(e.event_date)}</span>
    <span class="notice-title">${esc(e.title)}</span>
    <form method="post" action="/admin/event/${e.id}/delete" onsubmit="return confirm('삭제하시겠습니까?')"><button class="link-danger">삭제</button></form></li>`
    )
    .join("") || `<li class="empty">행사가 없습니다.</li>`;

  const body = `
  <section class="dash">
    <div class="container">
      <div class="dash-head"><div>
        <p class="section-eyebrow">ADMIN</p>
        <h1 class="dash-title">관리자 대시보드</h1>
        <p class="dash-sub">서초구 상인회 통합 관리</p>
      </div></div>
      ${flash(query.get("msg") ? decodeURIComponent(query.get("msg")) : "", query.get("err") ? "err" : "ok")}

      <div class="stat-cards">
        <div class="stat-card"><span class="stat-num">${s.businesses}</span><span class="stat-label">승인 업체</span></div>
        <div class="stat-card${s.pending ? " stat-alert" : ""}"><span class="stat-num">${s.pending}</span><span class="stat-label">승인 대기</span></div>
        <div class="stat-card"><span class="stat-num">${s.notices}</span><span class="stat-label">공지</span></div>
        <div class="stat-card"><span class="stat-num">${s.events}</span><span class="stat-label">행사</span></div>
        <div class="stat-card"><span class="stat-num">${s.mediaCount}</span><span class="stat-label">미디어</span></div>
      </div>

      <section class="panel">
        <h2 class="panel-title">업체 관리</h2>
        <div class="table-scroll"><table class="admin-table">
          <thead><tr><th>업체</th><th>사장님</th><th>상태</th><th>처리</th></tr></thead>
          <tbody>${bizRows}</tbody>
        </table></div>
      </section>

      <div class="dash-grid">
        <section class="panel">
          <h2 class="panel-title">공지사항 관리</h2>
          <form method="post" action="/admin/notice" class="stack-form compact">
            <input type="text" name="title" placeholder="공지 제목" required />
            <textarea name="body" rows="3" placeholder="내용"></textarea>
            <div class="form-two">
              <input type="text" name="tag" placeholder="태그 (예: 중요, 행사)" value="안내" />
              <label class="check"><input type="checkbox" name="pinned" value="1" /> 상단 고정</label>
            </div>
            <button class="btn btn-primary btn-sm">공지 등록</button>
          </form>
          <ul class="admin-list">${noticeRows}</ul>
        </section>

        <section class="panel">
          <h2 class="panel-title">행사 관리</h2>
          <form method="post" action="/admin/event" class="stack-form compact">
            <input type="text" name="title" placeholder="행사명" required />
            <div class="form-two">
              <input type="date" name="event_date" required />
              <input type="text" name="place" placeholder="장소" />
            </div>
            <textarea name="description" rows="2" placeholder="설명"></textarea>
            <button class="btn btn-primary btn-sm">행사 등록</button>
          </form>
          <ul class="admin-list">${eventRows}</ul>
        </section>
      </div>
    </div>
  </section>`;
  html(res, layout({ title: "관리자 대시보드", user: req.user, body }));
}

// ---------- 404 ----------
export function notFound(req, res) {
  const body = `<section class="section page-top"><div class="container center-block">
    <h1 class="big-404">404</h1>
    <p class="section-lead">요청하신 페이지를 찾을 수 없습니다.</p>
    <a href="/" class="btn btn-primary">홈으로</a></div></section>`;
  html(res, layout({ title: "404", user: req.user, body }), 404);
}
