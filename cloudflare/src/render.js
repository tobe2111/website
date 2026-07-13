// SSR 레이아웃 + 공통 조각 (문자열 템플릿, 런타임 독립)
import { esc } from "./util.js";

// 디자인 시스템 v2 — 브랜드 매장 아이콘(스토어프론트)
export const STOREFRONT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l1.2-4.2A1 1 0 0 1 6.2 4h11.6a1 1 0 0 1 1 .8L20 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/></svg>';
export const THEME_SUN_SVG = '<svg class="ico-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19"/></svg>';
export const THEME_MOON_SVG = '<svg class="ico-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5z"/></svg>';

export function layout({ title, assoc, base = "", user = null, body, activeNav = "", description = "", scripts = "", csrf = "", ogImage = "", jsonLd = null }) {
  const nav = assoc ? navHtml(base, user, activeNav) : "";
  const brand = assoc ? esc(assoc.name) : "상인회 플랫폼";
  const meta = description ? `<meta name="description" content="${esc(description)}" />` : "";
  // 카카오톡·SNS 공유 미리보기 (og:image 는 절대 URL 필수)
  // ogImage: R2 키 또는 URL. 미지정 시 상인회 로고 사용.
  const ogRaw = ogImage || (assoc && assoc.logo) || "";
  const ogUrl = ogRaw ? mediaUrl(ogRaw) : "";
  const ogImgAbs = ogUrl ? (/^https?:\/\//.test(ogUrl) ? ogUrl : ORIGIN + ogUrl) : "";
  const og = `
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${brand}" />
<meta property="og:title" content="${esc(title || "")}${title ? " · " : ""}${brand}" />
${description ? `<meta property="og:description" content="${esc(description)}" />` : ""}
${ogImgAbs ? `<meta property="og:image" content="${esc(ogImgAbs)}" />` : ""}
<meta name="twitter:card" content="${ogImgAbs ? "summary_large_image" : "summary"}" />`;
  // 검색엔진 구조화 데이터 (네이버·구글 리치 결과). ld+json 은 실행되지 않는 데이터 스크립트라 CSP 영향 없음.
  // JSON 안의 "<" 를 이스케이프해 </script> 조기 종료(HTML 인젝션)를 차단.
  const ldScript = jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>` : "";
  // 테넌트 대표색 하나로 사이트 전체 테마 전환 (900~50 스케일 자동 파생). CSS 주입 방지를 위해 HEX 만 허용.
  const brandColor = /^#[0-9a-fA-F]{3,8}$/.test((assoc && assoc.brand_color) || "") ? assoc.brand_color : "#0b6e4f";
  // 모든 POST 폼에 CSRF 히든 필드 주입
  const injected = csrf
    ? String(body).replace(/(<form\b[^>]*\bmethod\s*=\s*["']post["'][^>]*>)/gi, `$1<input type="hidden" name="_csrf" value="${csrf}">`)
    : body;
  return `<!doctype html><html lang="ko"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title ? title + " · " : "")}${brand}</title>${meta}${og}${ldScript}
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
<link rel="stylesheet" id="fontCss" media="print" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css" />
<noscript><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css" /></noscript>
<link rel="stylesheet" href="${assetUrl("/css/app.css")}" />
<style>:root{--brand:${brandColor}}</style>
<script src="${assetUrl("/js/theme.js")}"></script>
${assoc && assoc.naver_verification ? `<meta name="naver-site-verification" content="${esc(assoc.naver_verification)}" />` : ""}
${assoc && assoc.google_verification ? `<meta name="google-site-verification" content="${esc(assoc.google_verification)}" />` : ""}
${assoc ? `<link rel="alternate" type="application/rss+xml" title="${brand} 공지·소식" href="${base}/feed.xml" />` : ""}
<meta property="og:locale" content="ko_KR" />
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="${brandColor}" />
<link rel="icon" href="/img/icon.svg" />
<link rel="apple-touch-icon" href="/img/icon-180.png" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" /></head>
<body>
<a class="skip-link" href="#main">본문 바로가기</a>
<header class="site-header" id="siteHeader">
  <div class="container header-inner">
    <a class="brand" href="${base || "/"}">${assoc && assoc.logo ? `<img class="brand-logo" src="${esc(mediaUrl(assoc.logo))}" alt="" />` : `<span class="brand-mark">${STOREFRONT_SVG}</span>`}<span>${brand}</span></a>
    <button class="theme-toggle" id="themeToggle" type="button" aria-label="다크 모드 전환">${THEME_SUN_SVG}${THEME_MOON_SVG}</button>
    <button class="nav-toggle" id="navToggle" aria-label="메뉴 열기" aria-expanded="false"><span></span><span></span><span></span></button>
    <nav class="main-nav" id="mainNav">${nav}</nav>
  </div>
</header>
<main id="main">${injected}</main>
<footer class="site-footer"><div class="container">
  <div class="foot-top">
    <nav class="foot-policy"><a href="/privacy" class="strong">개인정보처리방침</a><span class="sep"></span><a href="/terms">이용약관</a>${assoc ? `<span class="sep"></span><a href="${base}/contact">문의하기</a>` : ""}</nav>
  </div>
  <div class="foot-bottom">
    <span class="foot-mark" aria-hidden="true">${STOREFRONT_SVG}</span>
    <div class="foot-info">
      <strong>${brand}</strong>
      ${assoc && (assoc.phone || assoc.address) ? `<p>${assoc.address ? esc(assoc.address) : ""}${assoc.phone ? `${assoc.address ? " · " : ""}문의 ${esc(assoc.phone)}` : ""}</p>` : ""}
      <p class="foot-copy">COPYRIGHT © ${new Date().getFullYear()} ${brand}. ALL RIGHTS RESERVED.</p>
    </div>
  </div>
</div></footer>
<script src="${assetUrl("/js/app.js")}" defer></script>${scripts}
</body></html>`;
}

function navHtml(base, user, active) {
  const link = (href, label) => `<a href="${href}"${active === href ? ' class="active" aria-current="page"' : ""}>${label}</a>`;
  let items = [
    link(`${base}/`, "소개"),
    link(`${base}/businesses`, "가입 점포"),
    link(`${base}/map`, "점포 지도"),
    link(`${base}/notices`, "공지·소식"),
  ];
  if (user) {
    items.push(link(`${base}/board`, "회원 게시판"));
    items.push(link(`${base}/polls`, "투표"));
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
// 요청 오리진 (og:image 등 절대 URL 조립용 — index 에서 요청마다 주입)
export let ORIGIN = "";
export function setOrigin(o) { ORIGIN = o || ""; }
// 정적 자산 버전 (배포마다 자동 변경 → 브라우저·CDN 의 옛 CSS/JS 캐시 무력화)
export let ASSET_VER = "dev";
export function setAssetVer(v) { if (v) ASSET_VER = String(v).slice(0, 12); }
export const assetUrl = (path) => `${path}?v=${ASSET_VER}`;
export function mediaUrl(key) {
  if (!key) return "";
  if (/^https?:\/\//.test(key)) return key;
  return MEDIA_BASE ? `${MEDIA_BASE}/${key}` : `/media/${key}`;
}
