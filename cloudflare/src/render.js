// SSR 레이아웃 + 공통 조각 (문자열 템플릿, 런타임 독립)
import { esc } from "./util.js";

// 디자인 시스템 v2 — 브랜드 매장 아이콘(스토어프론트)
export const STOREFRONT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l1.2-4.2A1 1 0 0 1 6.2 4h11.6a1 1 0 0 1 1 .8L20 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/></svg>';

// 전자계약 제품 아이콘 — 문서와 서명선. 상점 아이콘(STOREFRONT)을 쓰면 상인회 서비스로 읽힌다.
export const ESIGN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 16.5c1.2-2.4 2-2.4 2.6-1.2.5 1 1.2 1.2 2 .4"/></svg>';

// product: 상인회에 속하지 않은 '독립 제품' 화면(전자계약 랜딩·가입·검증)에서 쓰는 껍데기.
//   { name, nav } — 이걸 주면 브랜드 이름·아이콘·상단 메뉴가 전부 그 제품 것으로 바뀐다.
// 주지 않으면 종전과 같다(상인회 테넌트 화면 또는 플랫폼 공용 화면).
export function layout({ title, assoc, base = "", user = null, body, activeNav = "", description = "", scripts = "", csrf = "", ogImage = "", jsonLd = null, product = null }) {
  const nav = assoc ? navHtml(base, user, activeNav, assoc.kind)
    : product && product.nav !== false ? productNav(user, activeNav, product) : "";
  // 상인회에 속하지 않은 화면의 이름: 제품이 지정되면 그 제품, 아니면 운영사.
  // 예전 기본값("상인회 플랫폼")은 전자계약 고객에게 남의 서비스 간판으로 보였다.
  const brand = assoc ? esc(assoc.name) : product ? esc(product.name) : "리스터코퍼레이션";
  const mark = assoc || (product && product.mark === "storefront") || (!product && !assoc) ? STOREFRONT_SVG : ESIGN_SVG;
  const meta = description ? `<meta name="description" content="${esc(description)}" />` : "";
  // 카카오톡·SNS 공유 미리보기 (og:image 는 절대 URL 필수)
  // ogImage: R2 키 또는 URL. 미지정 시 상인회 로고 사용.
  const ogRaw = ogImage || (assoc && assoc.logo) || ""; // 제품 화면은 assoc 가 없으므로 상인회 로고가 붙지 않는다
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
  const brandColor = /^#[0-9a-fA-F]{3,8}$/.test((assoc && assoc.brand_color) || "") ? assoc.brand_color : "#0b8a46";
  // 모든 POST 폼에 CSRF 히든 필드 주입
  const injected = csrf
    ? String(body).replace(/(<form\b[^>]*\bmethod\s*=\s*["']post["'][^>]*>)/gi, `$1<input type="hidden" name="_csrf" value="${csrf}">`)
    : body;
  return `<!doctype html><html lang="ko" data-theme="light"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title ? title + " · " : "")}${brand}</title>${meta}${og}${ldScript}
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
<link rel="stylesheet" id="fontCss" media="print" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css" />
<noscript><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css" /></noscript>
<link rel="stylesheet" href="${assetUrl("/css/app.css")}" />
<style>:root{--brand:${brandColor}}</style>
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
    <a class="brand" href="${product ? product.home || "/esign" : base || "/"}">${assoc && assoc.logo ? `<img class="brand-logo" src="${esc(mediaUrl(assoc.logo))}" alt="" />` : `<span class="brand-mark">${mark}</span>`}<span>${brand}</span></a>
    <button class="nav-toggle" id="navToggle" aria-label="메뉴 열기" aria-expanded="false"><span></span><span></span><span></span></button>
    <nav class="main-nav" id="mainNav">${nav}</nav>
  </div>
</header>
<main id="main">${injected}</main>
${assoc && assoc.kind === "franchise" && !isConsole(body) ? stickyBar(assoc, base) : ""}
<footer class="site-footer"><div class="container">
  <div class="foot-top">
    <nav class="foot-policy"><a href="/privacy" class="strong">개인정보처리방침</a><span class="sep"></span><a href="/terms">이용약관</a>${assoc ? `<span class="sep"></span><a href="${base}/contact">문의하기</a>` : ""}</nav>
  </div>
  <div class="foot-bottom">
    <span class="foot-mark" aria-hidden="true">${mark}</span>
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

// 관리자·점주가 일하는 화면인가. 이 프로젝트의 콘솔 화면은 예외 없이 <section class="dash"> 로 시작한다.
// 손님용 고정 바를 업무 화면에 띄우면 표를 가리는 방해물일 뿐이라, 화면 종류로 갈라 준다.
// (페이지마다 플래그를 넘기는 방식은 새 콘솔 화면을 만들 때 빠뜨리기 쉬워 쓰지 않는다.)
const isConsole = (body) => /<section class="dash"/.test(String(body));

// 프랜차이즈 고정 하단 바 — 스크롤 어디에 있든 전화·신청이 한 번에 닿는다.
// 랜딩뿐 아니라 매장 안내·공지 같은 하위 페이지에도 붙인다: 거기서 마음먹은 사람이
// 갈 곳이 없으면 그대로 나간다. 신청 폼은 랜딩에만 있으므로 늘 랜딩의 #apply 로 보낸다.
function stickyBar(assoc, base) {
  const tel = String(assoc.phone || "").replace(/[^0-9+\-]/g, "");
  return `<div class="fr-sticky">
    ${tel ? `<a class="fr-sticky-tel" href="tel:${esc(tel)}"><span>가맹 문의</span><strong>${esc(assoc.phone)}</strong></a>` : ""}
    <a class="fr-sticky-cta" href="${base}/#apply">가맹 상담 신청</a>
  </div>`;
}

// 독립 제품 상단 메뉴 — 상인회 메뉴(점포·지도·게시판)는 한 줄도 들어가지 않는다.
// product.links / product.cta 를 주면 그 제품의 메뉴가 되고, 없으면 전자계약 메뉴(기본)를 쓴다.
function productNav(user, active, product = null) {
  const link = (href, label) => `<a href="${esc(href)}"${active === href ? ' class="active" aria-current="page"' : ""}>${esc(label)}</a>`;
  if (product && Array.isArray(product.links) && product.links.length) {
    const items = product.links.map(([href, label]) => link(href, label));
    if (user) {
      items.push(link("/account", "내 계정"));
      items.push(`<form method="post" action="/logout" class="nav-logout"><button class="btn btn-ghost btn-sm">로그아웃</button></form>`);
    } else {
      items.push(link("/login", "로그인"));
      if (product.cta) items.push(`<a href="${esc(product.cta[0])}" class="btn btn-primary btn-sm">${esc(product.cta[1])}</a>`);
    }
    return items.join("");
  }
  const items = [link("/esign", "소개"), link("/verify", "문서 진위확인")];
  if (user) {
    items.push(link("/account", "내 계정"));
    items.push(`<form method="post" action="/logout" class="nav-logout"><button class="btn btn-ghost btn-sm">로그아웃</button></form>`);
  } else {
    items.push(link("/login", "로그인"));
    items.push(`<a href="/esign/signup" class="btn btn-primary btn-sm">시작하기</a>`);
  }
  return items.join("");
}

function navHtml(base, user, active, kind = "merchant") {
  const link = (href, label) => `<a href="${href}"${active === href ? ' class="active" aria-current="page"' : ""}>${label}</a>`;
  // 전자계약 전용 조직에는 점포·지도·게시판이 없다 — 쓰지 않을 메뉴를 띄우면 제품이 흐려진다.
  const esign = kind === "esign";
  // 프랜차이즈 랜딩은 한 장짜리다. 메뉴를 여러 페이지로 흩뿌리면 신청 폼에서 멀어진다 —
  // 같은 페이지 안의 앵커로 보내고, 마지막 칸은 늘 '상담 신청' 버튼으로 둔다.
  const franchise = kind === "franchise";
  let items = franchise
    ? [link(`${base}/`, "브랜드 소개"), link(`${base}/#process`, "가맹 절차"), link(`${base}/businesses`, "매장 안내"), link(`${base}/notices`, "공지")]
    : esign
    ? [link(`${base}/`, "소개"), link(`${base}/notices`, "공지")]
    : [
      link(`${base}/`, "소개"),
      link(`${base}/businesses`, "가입 점포"),
      link(`${base}/map`, "점포 지도"),
      link(`${base}/notices`, "공지·소식"),
    ];
  if (user) {
    if (!esign && !franchise) {
      items.push(link(`${base}/board`, "회원 게시판"));
      items.push(link(`${base}/polls`, "투표"));
    }
    // 서명은 역할과 무관하다 — 계약을 만든 사람도 서명해야 한다.
    // 다만 상인회 메뉴는 건드리지 않는다(점포주만 보던 항목을 관리자에게 새로 띄우지 않음).
    if (user.role === "MERCHANT" || esign) items.push(link(`${base}/sign`, "내 서명"));
    // 운영 메뉴는 손님용 메뉴와 섞지 않고 오른쪽에 따로 묶습니다.
    // '슈퍼'(플랫폼 콘솔)는 이 상인회의 메뉴가 아니므로 여기 두지 않습니다 —
    // 상인회 홈페이지 위에 플랫폼 운영 도구가 얹혀 있는 것처럼 보입니다. 계정 화면에서 들어갑니다.
    const ops = [];
    if (user.role === "MERCHANT" && !esign) ops.push(link(`${base}/dashboard`, "내 업체"));
    if (franchise && (user.role === "ADMIN" || user.role === "SUPERADMIN")) ops.push(link(`${base}/admin/leads`, "상담 DB"));
    if (user.role === "ADMIN" || user.role === "SUPERADMIN") ops.push(link(`${base}/admin`, "관리자"));
    // 담당자는 /admin 이 403 이다 — 갈 수 있는 곳(계약서 목록)으로 보낸다
    else if (user.role === "STAFF") ops.push(link(`${base}/admin/documents`, "계약서"));
    if (ops.length) items.push(`<span class="nav-ops">${ops.join("")}</span>`);
    items.push(`<form method="post" action="/logout" class="nav-logout"><button class="btn btn-ghost btn-sm">로그아웃</button></form>`);
  } else {
    items.push(link(`/login`, "로그인"));
    if (franchise) items.push(`<a href="${base}/#apply" class="btn btn-primary btn-sm">가맹 상담</a>`);
    else if (!esign) items.push(`<a href="${base}/register" class="btn btn-primary btn-sm">가입</a>`);
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
  if (key.startsWith("/")) return key; // 워커에 함께 배포된 정적 이미지(/img/...) — R2 경유 없음
  return MEDIA_BASE ? `${MEDIA_BASE}/${key}` : `/media/${key}`;
}
