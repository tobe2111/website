// SSR 레이아웃 + 공통 조각 (문자열 템플릿, 런타임 독립)
import { esc } from "./util.js";
import { kindById, termsOf } from "./kinds.js";

// 디자인 시스템 v2 — 브랜드 매장 아이콘(스토어프론트)
export const STOREFRONT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l1.2-4.2A1 1 0 0 1 6.2 4h11.6a1 1 0 0 1 1 .8L20 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/></svg>';

// 전자계약 제품 아이콘 — 문서와 서명선. 상점 아이콘(STOREFRONT)을 쓰면 상인회 서비스로 읽힌다.
export const ESIGN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 16.5c1.2-2.4 2-2.4 2.6-1.2.5 1 1.2 1.2 2 .4"/></svg>';

// product: 상인회에 속하지 않은 '독립 제품' 화면(전자계약 랜딩·가입·검증)에서 쓰는 껍데기.
//   { name, nav } — 이걸 주면 브랜드 이름·아이콘·상단 메뉴가 전부 그 제품 것으로 바뀐다.
// 주지 않으면 종전과 같다(상인회 테넌트 화면 또는 플랫폼 공용 화면).
// 브랜드 색 위에 얹을 글자색을 고른다.
//
// 관리자는 자기 브랜드 색을 고른다 — 노랑·하늘색·연두일 수 있다. 그 위에 흰 글자를
// 고정으로 얹으면 대비가 2:1 아래로 떨어져 버튼 글씨가 사실상 안 보인다(실측 1.92:1).
// 이 화면의 이용자는 40~60대 예비 창업자다. 안 읽히는 버튼은 안 눌린다.
//
// 색을 바꾸지는 않는다 — 브랜드가 노랑이면 버튼도 노랑이어야 한다. 글자만 바꾼다.
// 흰색과 먹색 중 그 배경에서 대비가 더 나오는 쪽을 쓴다.
const BRAND_INK = "#121417";
export function onBrandInk(hex) {
  const h = String(hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#fff";
  const ch = (i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
  const onWhite = 1.05 / (L + 0.05);                       // 흰 글자를 얹었을 때
  const onInk = (L + 0.05) / (0.0136 + 0.05);              // 먹 글자(#121417)를 얹었을 때
  return onInk > onWhite ? BRAND_INK : "#fff";
}

// 브랜드 색을 '글자색'으로 쓸 때 쓸 값.
//
// 배경으로 쓸 때와 글자로 쓸 때는 요구 조건이 다르다. 노란 배경은 예쁘지만
// 흰 바탕 위의 노란 글자는 1.9:1 이라 사실상 안 보인다 — 강조하려고 준 색이
// 오히려 안 읽히는 색이 된다.
//
// 색상(hue)은 지키고 밝기만 낮춰 4.5:1 을 넘길 때까지 어둡게 한다.
// 이미 충분히 어두운 브랜드(기본 초록 등)는 한 톨도 바뀌지 않는다.
export function brandTextInk(hex) {
  const h = String(hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "var(--brand-700)";
  let rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const ratioOnWhite = (c) => 1.05 / (0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]) + 0.05);
  // 흰 바탕 기준 5.2 를 노린다. 이 색은 흰 바탕뿐 아니라 '브랜드 옅은 배경(tint)' 위에도
  // 자주 얹히는데, 흰 바탕으로 딱 4.5 를 맞추면 tint 위에서 4.3 으로 미끄러진다(실측).
  // 기본 블루(#1F6CFF)는 흰 바탕에서 4.52 라 여기서 조금 어두워진다(글자로 쓸 때만). 띠·단추 배경은 원색 그대로다.
  for (let i = 0; i < 40 && ratioOnWhite(rgb) < 5.2; i++) rgb = rgb.map((v) => Math.max(0, Math.round(v * 0.94)));
  return "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
}

// ⚠️ <link rel="manifest"> 를 일부러 걸지 않는다. 걸면 브라우저가 '앱 설치' 배너를 띄우는데,
// 이 서비스는 웹으로만 쓰고 설치를 권할 일이 없다(제품마다 간판도 달라 설치 이름이 남의 것이 된다).
// 아이콘·테마색은 아래 meta/link 로 충분하다. manifest.webmanifest 파일 자체는 남겨 두되
// display 를 browser 로 두어, 직접 열어 봐도 설치 대상이 되지 않는다.
export function layout({ title, assoc, base = "", user = null, body, activeNav = "", description = "", scripts = "", csrf = "", ogImage = "", preloadImage = "", jsonLd = null, product = null, console: consoleKind = "" }) {
  // 업무 화면(콘솔)에는 손님용 메뉴를 걸지 않는다.
  //
  // 예전에는 관리자 화면 맨 위에 공개 홈 메뉴(소개·가입 점포·점포 지도·게시판·투표)가,
  // 맨 아래에 마케팅 푸터(개인정보처리방침·이용약관·저작권)가 그대로 붙어 있었다.
  // 그러면 화면이 '관리 도구' 가 아니라 '관리자로 로그인한 홈페이지' 로 읽힌다 —
  // 업무용 콘솔에 회사 소개 푸터를 다는 서비스는 없다.
  const workScreen = isConsole(body);
  // 운영사 콘솔은 이미 자기 머리글을 갖고 있다 — 거기까지 바꾸지 않는다.
  const nav = consoleKind === "super" ? superNav()
    : workScreen ? consoleNav(assoc, base, user)
    : assoc ? navHtml(base, user, activeNav, assoc.kind, assoc.preset)
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
  // 기본 브랜드색은 app.css 의 --brand 와 같아야 한다 (디자인 시스템 v3 · 앱 컨셉 블루).
  const brandColor = /^#[0-9a-fA-F]{3,8}$/.test((assoc && assoc.brand_color) || "") ? assoc.brand_color : "#1F6CFF";
  const onBrand = onBrandInk(brandColor);
  const brandText = brandTextInk(brandColor);
  // 구글 애널리틱스(GA4) 측정 ID — 관리자가 넣은 값이 <script src> 의 쿼리로 나가므로
  // 규격('G-' + 영숫자)에 맞는 것만 통과시킵니다. 저장할 때도 거르지만, 나가는 자리에서 한 번 더 봅니다.
  const gaId = /^G-[A-Z0-9]{4,20}$/i.test((assoc && assoc.ga_measurement_id) || "") ? assoc.ga_measurement_id : "";
  // 하단 탭 — 휴대폰에서 손님이 쓰는 공개 화면에만. 업무 콘솔은 표를 가리고, 랜딩형은 이미 고정 바가 있다.
  const isDone = /<section class="done-screen"/.test(String(body));
  // 완료 화면·외부 서명자(로그인 없음) 화면에는 하단 탭을 그리지 않는다 — 그 사람은 이 조직의 손님이 아니다
  const bnav = assoc && !isConsole(body) && !isDone && !kindById(assoc.kind).usesLanding ? bottomNav(base, activeNav, assoc.kind, user) : "";
  // 어두운 '완료' 화면이면 머리·바닥도 같은 어둠으로 — 흰 띠가 남으면 화면이 둘로 갈린다
  const bodyClass = [bnav ? "has-bnav" : "", isDone ? "is-done" : "", workScreen ? "is-console" : ""].filter(Boolean).join(" ");
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
<!-- 표제는 명조로 받는데, 웹폰트를 내려받지 않는다. 한국어 명조 한 벌은 700 굵기만도 562KB —
     40~60대 소상공인이 휴대폰으로 여는 화면에 제목 글꼴 하나로 그 무게를 지울 수 없다.
     기기에 이미 깔린 명조(AppleMyungjo·바탕·Noto Serif CJK)를 쓴다. app.css 의 --font-display 참조. -->
<link rel="stylesheet" href="${assetUrl("/css/app.css")}" />
${preloadImage ? `<link rel="preload" as="image" fetchpriority="high" href="${esc(preloadImage)}" />` : ""}
<style>:root{--brand:${brandColor};--on-brand:${onBrand};--brand-text:${brandText}}</style>
${assoc && assoc.naver_verification ? `<meta name="naver-site-verification" content="${esc(assoc.naver_verification)}" />` : ""}
${assoc && assoc.google_verification ? `<meta name="google-site-verification" content="${esc(assoc.google_verification)}" />` : ""}
${gaId ? `<link rel="preconnect" href="https://www.googletagmanager.com" crossorigin />
<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(gaId)}"></script>
<script src="${assetUrl("/js/ga.js")}" data-ga-id="${esc(gaId)}" defer></script>` : ""}
${assoc ? `<link rel="alternate" type="application/rss+xml" title="${brand} 공지·소식" href="${base}/feed.xml" />` : ""}
<meta property="og:locale" content="ko_KR" />
<meta name="theme-color" content="${brandColor}" />
<link rel="icon" href="/img/icon.svg" />
<link rel="apple-touch-icon" href="/img/icon-180.png" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" /></head>
<body${consoleKind ? ` data-console="${esc(consoleKind)}"` : ""}${assoc && kindById(assoc.kind).usesLanding ? ` data-base="${esc(base)}" data-csrf="${esc(csrf || "")}"` : ""}${bodyClass ? ` class="${bodyClass}"` : ""}>
<a class="skip-link" href="#main">본문 바로가기</a>
${consoleKind === "super" ? `<div class="console-strip"><div class="container console-strip-in">
  <b>운영사 콘솔</b><span>여기서 하는 일은 <b>모든 고객사</b>에 적용됩니다</span></div></div>` : ""}
<header class="site-header" id="siteHeader">
  <div class="container header-inner">
    <a class="brand" href="${consoleKind === "super" ? "/super" : product ? product.home || "/esign" : base || "/"}">${assoc && assoc.logo ? `<img class="brand-logo" src="${esc(mediaUrl(assoc.logo))}" alt="" />` : `<span class="brand-mark">${mark}</span>`}<span>${brand}</span></a>
    <button class="nav-toggle" id="navToggle" aria-label="메뉴 열기" aria-expanded="false"><span></span><span></span><span></span></button>
    <nav class="main-nav" id="mainNav">${nav}</nav>
  </div>
</header>
<main id="main">${injected}</main>
${assoc && kindById(assoc.kind).usesLanding && !isConsole(body) ? stickyBar(assoc, base) : ""}
${bnav}
${workScreen ? "" : `<footer class="site-footer"><div class="container">
  <div class="foot-top">
    <nav class="foot-policy"><a href="/privacy" class="strong">개인정보처리방침</a><span class="sep"></span><a href="/terms">이용약관</a>${assoc ? `<span class="sep"></span><a href="${base}/contact">문의하기</a>` : ""}</nav>
  </div>
  <div class="foot-bottom">
    <span class="foot-mark" aria-hidden="true">${mark}</span>
    <div class="foot-info">
      <strong>${brand}</strong>
      ${assoc && (assoc.phone || assoc.address) ? `<p>${assoc.address ? esc(assoc.address) : ""}${assoc.phone ? `${assoc.address ? " · " : ""}문의 ${esc(assoc.phone)}` : ""}</p>` : ""}
      <p class="foot-copy">© ${new Date().getFullYear()} ${brand}</p>
    </div>
  </div>
</div></footer>`}
<script src="${assetUrl("/js/app.js")}" defer></script>${
  // 전화번호 칸이 있는 화면에서만 싣는다 — 없는 화면에 받게 하지 않는다.
  // 칸이 열다섯 군데에 흩어져 있어 화면마다 손으로 붙이면 반드시 빠뜨린다.
  /type="tel"/.test(body) ? `<script src="${assetUrl("/js/phone.js")}" defer></script>` : ""
}${scripts}
</body></html>`;
}

// 관리자·점주가 일하는 화면인가. 이 프로젝트의 콘솔 화면은 예외 없이 <section class="dash"> 로 시작한다.
// 손님용 고정 바를 업무 화면에 띄우면 표를 가리는 방해물일 뿐이라, 화면 종류로 갈라 준다.
// (페이지마다 플래그를 넘기는 방식은 새 콘솔 화면을 만들 때 빠뜨리기 쉬워 쓰지 않는다.)
const isConsole = (body) => /<section class="dash"/.test(String(body));

// 업무 화면의 상단 줄 — 손님용 메뉴 대신 '지금 어느 조직에서 일하는가' 와 나가는 길만.
// 화면 이동은 왼쪽 사이드바가 맡으므로 여기에 메뉴를 또 늘어놓지 않는다.
function consoleNav(assoc, base, user) {
  const out = [];
  // 관리자가 가장 자주 누르는 것은 "내 홈페이지 어떻게 보이나" 다. 글자 링크가 아니라 단추로 둔다.
  // (예전에는 제목 아래에 `홈페이지: /t/우리동네` 라고 주소를 적어 뒀는데, 관리자에게 주소 조각은
  //  아무 쓸모가 없고 누를 수 있는지도 잘 안 보였다. 그 줄을 지우고 이 단추 하나로 모았다.)
  if (assoc) out.push(`<a class="cnav-out" href="${base}/" target="_blank" rel="noopener">홈페이지 보기 <span aria-hidden="true">↗</span></a>`);
  if (user && user.role === "SUPERADMIN") out.push(`<a href="/super">운영사 콘솔</a>`);
  if (user) {
    out.push(`<a href="/account">${esc(user.name || "내 계정")}</a>`);
    out.push(`<form method="post" action="/logout" class="cnav-out-form"><button class="btn btn-ghost btn-xs">로그아웃</button></form>`);
  }
  return out.join("");
}

// 프랜차이즈 고정 하단 바 — 스크롤 어디에 있든 전화·신청이 한 번에 닿는다.
// 랜딩뿐 아니라 매장 안내·공지 같은 하위 페이지에도 붙인다: 거기서 마음먹은 사람이
// 갈 곳이 없으면 그대로 나간다. 신청 폼은 랜딩에만 있으므로 늘 랜딩의 #apply 로 보낸다.
function stickyBar(assoc, base) {
  const tel = String(assoc.phone || "").replace(/[^0-9+\-]/g, "");
  const T = termsOf(assoc.preset); // 업종에 따라 "가맹 상담" ↔ "입학 상담" ↔ "진료 상담"
  return `<div class="fr-sticky">
    ${tel ? `<a class="fr-sticky-tel" data-track-tel href="tel:${esc(tel)}"><span>${esc(T.consult)} 문의</span><strong>${esc(assoc.phone)}</strong></a>` : ""}
    <a class="fr-sticky-cta" href="${base}/#apply">${esc(T.consult)} 신청</a>
  </div>`;
}

// 독립 제품 상단 메뉴 — 상인회 메뉴(점포·지도·게시판)는 한 줄도 들어가지 않는다.
// product.links / product.cta 를 주면 그 제품의 메뉴가 되고, 없으면 전자계약 메뉴(기본)를 쓴다.
// 운영사 콘솔 헤더 오른쪽.
// 간판(로고)은 콘솔 안에서 '홈으로'여야 한다 — 예전엔 여기가 고객용 랜딩(/)으로 빠져서,
// 일하다 로고를 누르면 콘솔 밖으로 튕겨 나갔다. 랜딩은 따로 버튼을 준다.
function superNav() {
  return `<a href="/" class="nav-out" target="_blank" rel="noopener">랜딩페이지 ↗</a>`
    + `<form method="post" action="/logout" class="nav-logout"><button class="btn btn-ghost btn-sm">로그아웃</button></form>`;
}

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

// 휴대폰 하단 탭 — 레퍼런스(코레일톡)의 다섯 칸. 상인회는 홈·점포·지도·공지·전체메뉴,
// 전자계약 조직은 홈·공지·내 서명·전체메뉴. '전체메뉴' 는 상단 햄버거 메뉴를 그대로 연다.
const BNAV_ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
  store: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l1.2-4.2A1 1 0 0 1 6.2 4h11.6a1 1 0 0 1 1 .8L20 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M9 20v-6h6v6"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/></svg>',
  notice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11v2a1 1 0 0 0 1 1h2l6 4V6L7 10H5a1 1 0 0 0-1 1z"/><path d="M17 9a4 4 0 0 1 0 6"/></svg>',
  sign: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 16.5c1.2-2.4 2-2.4 2.6-1.2.5 1 1.2 1.2 2 .4"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/></svg>',
};
function bottomNav(base, active, kind = "merchant", user = null) {
  const K = kindById(kind);
  const item = (href, label, icon) => `<a href="${href}"${active === href ? ' class="on" aria-current="page"' : ""}>${BNAV_ICON[icon]}<span>${label}</span></a>`;
  const items = K.nav === "esign"
    ? [item(`${base}/`, "홈", "home"), item(`${base}/notices`, "공지", "notice"), ...(user ? [item(`${base}/sign`, "내 서명", "sign")] : [])]
    : [item(`${base}/`, "홈", "home"), item(`${base}/businesses`, "점포", "store"), item(`${base}/map`, "지도", "map"), item(`${base}/notices`, "공지", "notice")];
  items.push(`<button type="button" class="bnav-menu" data-bnav-menu aria-label="전체메뉴 열기">${BNAV_ICON.menu}<span>전체메뉴</span></button>`);
  return `<nav class="bnav" aria-label="하단 메뉴">${items.join("")}</nav>`;
}

function navHtml(base, user, active, kind = "merchant", preset = "") {
  const link = (href, label) => `<a href="${href}"${active === href ? ' class="active" aria-current="page"' : ""}>${label}</a>`;
  const K = kindById(kind);
  const T = termsOf(preset);
  // 전자계약 전용 조직에는 점포·지도·게시판이 없다 — 쓰지 않을 메뉴를 띄우면 제품이 흐려진다.
  const esign = K.nav === "esign";
  // 랜딩형은 한 장짜리다. 메뉴를 여러 페이지로 흩뿌리면 신청 폼에서 멀어진다 —
  // 같은 페이지 안의 앵커로 보내고, 마지막 칸은 늘 '상담 신청' 버튼으로 둔다.
  const franchise = K.nav === "landing";
  let items = franchise
    ? [link(`${base}/`, "소개"), link(`${base}/#process`, T.process), link(`${base}/businesses`, `${T.store} 안내`), link(`${base}/notices`, "공지")]
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
    if (franchise) items.push(`<a href="${base}/#apply" class="btn btn-primary btn-sm">${esc(T.consult)}</a>`);
    // "가입" 만으로는 회원가입인지 입점인지 알 수 없다. 이 버튼이 하는 일을 그대로 적는다 —
    // 상인회 홈이 이루려는 첫째 목표라, 어느 화면에서든 머리말에 늘 보여야 한다.
    else if (!esign) items.push(`<a href="${base}/register" class="btn btn-primary btn-sm">우리 가게 등록</a>`);
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
