// SSR 레이아웃 + 공통 조각 (문자열 템플릿, 런타임 독립)
import { esc } from "./util.js";

// 디자인 시스템 v2 — 브랜드 매장 아이콘(스토어프론트)
export const STOREFRONT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l1.2-4.2A1 1 0 0 1 6.2 4h11.6a1 1 0 0 1 1 .8L20 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/></svg>';
export const THEME_SUN_SVG = '<svg class="ico-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19"/></svg>';
export const THEME_MOON_SVG = '<svg class="ico-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5z"/></svg>';

export function layout({ title, assoc, base = "", user = null, body, activeNav = "", description = "", scripts = "", csrf = "" }) {
  const nav = assoc ? navHtml(base, user, activeNav) : "";
  const brand = assoc ? esc(assoc.name) : "상인회 플랫폼";
  const meta = description ? `<meta name="description" content="${esc(description)}" />` : "";
  // 테넌트 대표색 하나로 사이트 전체 테마 전환 (900~50 스케일 자동 파생). CSS 주입 방지를 위해 HEX 만 허용.
  const brandColor = /^#[0-9a-fA-F]{3,8}$/.test((assoc && assoc.brand_color) || "") ? assoc.brand_color : "#0b6e4f";
  // 모든 POST 폼에 CSRF 히든 필드 주입
  const injected = csrf
    ? String(body).replace(/(<form\b[^>]*\bmethod\s*=\s*["']post["'][^>]*>)/gi, `$1<input type="hidden" name="_csrf" value="${csrf}">`)
    : body;
  return `<!doctype html><html lang="ko"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title ? title + " · " : "")}${brand}</title>${meta}
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css" />
<link rel="stylesheet" href="/css/app.css" />
<style>:root{--brand:${brandColor}}</style>
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="${brandColor}" />
<link rel="icon" href="/img/icon.svg" />
<link rel="apple-touch-icon" href="/img/icon.svg" />
<meta name="apple-mobile-web-app-capable" content="yes" /></head>
<body>
<header class="site-header" id="siteHeader">
  <div class="container header-inner">
    <a class="brand" href="${base || "/"}">${assoc && assoc.logo ? `<img class="brand-logo" src="${esc(mediaUrl(assoc.logo))}" alt="" />` : `<span class="brand-mark">${STOREFRONT_SVG}</span>`}<span>${brand}</span></a>
    <button class="theme-toggle" id="themeToggle" type="button" aria-label="다크 모드 전환">${THEME_SUN_SVG}${THEME_MOON_SVG}</button>
    <button class="nav-toggle" id="navToggle" aria-label="메뉴 열기" aria-expanded="false"><span></span><span></span><span></span></button>
    <nav class="main-nav" id="mainNav">${nav}</nav>
  </div>
</header>
<main>${injected}</main>
<footer class="site-footer"><div class="container">
  <p>© ${brand}</p>
  ${assoc && (assoc.phone || assoc.address) ? `<p class="foot-contact">${assoc.address ? esc(assoc.address) : ""}${assoc.phone ? " · " + esc(assoc.phone) : ""}</p>` : ""}
  <p class="foot-links"><a href="/terms">이용약관</a> · <a href="/privacy">개인정보처리방침</a></p>
</div></footer>
<script src="/js/app.js" defer></script>${scripts}
</body></html>`;
}

function navHtml(base, user, active) {
  const link = (href, label) => `<a href="${href}"${active === href ? ' class="active"' : ""}>${label}</a>`;
  let items = [
    link(`${base}/`, "소개"),
    link(`${base}/businesses`, "가입 점포"),
    link(`${base}/map`, "점포 지도"),
    link(`${base}/notices`, "공지·소식"),
  ];
  if (user) {
    items.push(link(`${base}/board`, "회원 게시판"));
    if (user.role === "MERCHANT") items.push(link(`${base}/dashboard`, "내 업체"));
    if (user.role === "ADMIN" || user.role === "SUPERADMIN") items.push(link(`${base}/admin`, "관리자"));
    if (user.role === "SUPERADMIN") items.push(link(`/super`, "슈퍼"));
    items.push(`<form method="post" action="/logout" class="nav-logout"><button class="btn btn-ghost btn-sm">로그아웃</button></form>`);
  } else {
    items.push(link(`/login`, "로그인"));
    items.push(`<a href="${base}/register" class="btn btn-primary btn-sm">가입</a>`);
  }
  return items.join("");
}

export function flash(msg, kind = "ok") {
  return msg ? `<div class="flash flash-${kind === "err" ? "err" : "ok"}">${esc(msg)}</div>` : "";
}
export function statusBadge(s) {
  return s === "approved" ? '<span class="badge badge-ok">승인</span>'
    : s === "rejected" ? '<span class="badge badge-no">반려</span>'
    : '<span class="badge badge-wait">승인 대기</span>';
}
export function pager(urlFor, page, pages) {
  if (pages <= 1) return "";
  let out = '<nav class="pager">';
  out += page > 1 ? `<a class="pg" href="${urlFor(page - 1)}">‹ 이전</a>` : `<span class="pg disabled">‹ 이전</span>`;
  for (let i = 1; i <= pages; i++) out += i === page ? `<span class="pg cur">${i}</span>` : `<a class="pg" href="${urlFor(i)}">${i}</a>`;
  out += page < pages ? `<a class="pg" href="${urlFor(page + 1)}">다음 ›</a>` : `<span class="pg disabled">다음 ›</span>`;
  return out + "</nav>";
}

// 미디어 공개 URL (index 에서 실제 base 를 주입; 기본은 /media/ 경유)
export let MEDIA_BASE = "";
export function setMediaBase(b) { MEDIA_BASE = b || ""; }
export function mediaUrl(key) {
  if (!key) return "";
  if (/^https?:\/\//.test(key)) return key;
  return MEDIA_BASE ? `${MEDIA_BASE}/${key}` : `/media/${key}`;
}
