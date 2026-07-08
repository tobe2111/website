// 공용 HTML 레이아웃 렌더러 (테넌트 브랜딩 지원)
import { esc } from "./http.js";
import { ROLES } from "./auth.js";
import * as storage from "./storage.js";

// 로고 이미지 또는 이니셜
export function brandMark(assoc, name) {
  if (assoc && assoc.logo) {
    return `<span class="brand-mark has-logo" aria-hidden="true"><img src="${esc(storage.publicUrl(assoc.logo))}" alt="" /></span>`;
  }
  return `<span class="brand-mark" aria-hidden="true">${esc((name || "상").slice(0, 1))}</span>`;
}

// ----- 브랜드 색상 유틸 -----
function clamp(n) { return Math.max(0, Math.min(255, Math.round(n))); }
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return { r: 11, g: 110, b: 79 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex({ r, g, b }) {
  return "#" + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("");
}
function mix(c, target, amt) {
  return { r: c.r + (target.r - c.r) * amt, g: c.g + (target.g - c.g) * amt, b: c.b + (target.b - c.b) * amt };
}
const WHITE = { r: 255, g: 255, b: 255 }, BLACK = { r: 0, g: 0, b: 0 };

// 브랜드 색에서 팔레트 도출 → CSS 변수 오버라이드
export function brandStyle(color) {
  if (!color || color.toLowerCase() === "#0b6e4f") return "";
  const base = hexToRgb(color);
  const v = {
    "--green-900": rgbToHex(mix(base, BLACK, 0.35)),
    "--green-700": rgbToHex(base),
    "--green-600": rgbToHex(mix(base, WHITE, 0.1)),
    "--green-500": rgbToHex(mix(base, WHITE, 0.22)),
    "--green-50": rgbToHex(mix(base, WHITE, 0.9)),
  };
  const decl = Object.entries(v).map(([k, val]) => `${k}:${val}`).join(";");
  return `<style>:root{${decl}}</style>`;
}

export function layout({ title, user, assoc = null, base = "", body, activeNav = "", head = "", scripts = "", description = "", ogImage = "", canonical = "", jsonLd = null }) {
  const brandName = assoc ? assoc.name : "상인회 플랫폼";
  const brandSub = assoc ? "Merchants Association" : "Merchants Platform";
  const homeHref = assoc ? base || "/" : "/";
  const desc = description || (assoc ? assoc.tagline : "여러 상인회가 각자의 홈페이지로 지역 상권을 운영하는 웹사이트 플랫폼");
  const fullTitle = `${title} | ${brandName}`;
  const jsonLdArr = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];
  const jsonLdHtml = jsonLdArr
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`)
    .join("\n  ");

  const navItems = assoc
    ? [
        [base + "/", "홈"],
        [base + "/businesses", "업체 안내"],
        [base + "/map", "점포 지도"],
        [base + "/notices", "공지사항"],
        [base + "/events", "행사·이벤트"],
        [base + "/board", "회원 게시판"],
      ]
    : [["/", "홈"]];

  const nav = navItems
    .map(([href, label]) => `<li><a href="${href}"${activeNav === href ? ' class="active"' : ""}>${esc(label)}</a></li>`)
    .join("");

  let userArea;
  if (user) {
    let dash = "/";
    let dashLabel = "대시보드";
    if (user.role === ROLES.SUPERADMIN) { dash = "/super"; dashLabel = "슈퍼 관리자"; }
    else if (user.role === ROLES.ADMIN) { dash = (assoc ? base : "") + "/admin"; dashLabel = "관리자 대시보드"; }
    else { dash = (assoc ? base : "") + "/dashboard"; dashLabel = "내 업체 관리"; }
    userArea = `<div class="user-area">
        <a href="${dash}" class="btn btn-sm btn-ghost">${dashLabel}</a>
        <a href="/account" class="btn btn-sm btn-ghost" aria-label="계정 보안">계정</a>
        <form method="post" action="/logout" class="inline-form"><button type="submit" class="btn btn-sm btn-primary">로그아웃</button></form>
      </div>`;
  } else {
    const reg = assoc ? `${base}/register` : "/";
    userArea = `<div class="user-area">
        <a href="/login" class="btn btn-sm btn-ghost">로그인</a>
        <a href="${reg}" class="btn btn-sm btn-primary">${assoc ? "업체 등록" : "상인회 둘러보기"}</a>
      </div>`;
  }

  const brandCss = assoc ? brandStyle(assoc.brand_color) : "";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="${assoc ? esc(assoc.brand_color) : "#0b6e4f"}" />
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(desc)}" />
  ${canonical ? `<link rel="canonical" href="${esc(canonical)}" />` : ""}
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${esc(brandName)}" />
  <meta property="og:title" content="${esc(fullTitle)}" />
  <meta property="og:description" content="${esc(desc)}" />
  ${canonical ? `<meta property="og:url" content="${esc(canonical)}" />` : ""}
  ${ogImage ? `<meta property="og:image" content="${esc(ogImage)}" />` : ""}
  <meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}" />
  <meta name="twitter:title" content="${esc(fullTitle)}" />
  <meta name="twitter:description" content="${esc(desc)}" />
  ${ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}" />` : ""}
  <link rel="stylesheet" href="/css/app.css" />
  ${brandCss}
  ${jsonLdHtml}
  ${head}
</head>
<body>
  <a class="skip-link" href="#main">본문 바로가기</a>
  <header class="site-header" id="siteHeader">
    <div class="container header-inner">
      <a href="${homeHref}" class="brand" aria-label="${esc(brandName)} 홈">
        ${brandMark(assoc, brandName)}
        <span class="brand-text"><strong>${esc(brandName)}</strong><em>${esc(brandSub)}</em></span>
      </a>
      <nav class="main-nav" id="mainNav" aria-label="주요 메뉴"><ul>${nav}</ul></nav>
      ${userArea}
      <button class="nav-toggle" id="navToggle" aria-label="메뉴 열기" aria-expanded="false" aria-controls="mainNav">
        <span></span><span></span><span></span>
      </button>
    </div>
  </header>
  <main id="main">${body}</main>
  <footer class="site-footer">
    <div class="container footer-inner">
      <div class="footer-brand">
        ${brandMark(assoc, brandName)}
        <div><strong>${esc(brandName)}</strong><p>${esc(assoc ? assoc.tagline : "여러 상인회를 위한 웹사이트 플랫폼")}</p></div>
      </div>
      <nav class="footer-nav" aria-label="바닥글 메뉴">
        ${assoc ? `<a href="${base}/businesses">업체 안내</a><a href="${base}/notices">공지사항</a><a href="${base}/events">행사·이벤트</a>` : ""}
        <a href="/login">로그인</a>
      </nav>
      <p class="footer-copy">© ${new Date().getFullYear()} ${esc(brandName)}. All rights reserved.${
        assoc && (assoc.address || assoc.phone) ? `<br />${esc(assoc.address)}${assoc.phone ? " · " + esc(assoc.phone) : ""}` : ""
      }</p>
    </div>
  </footer>
  <script src="/js/app.js" defer></script>
  ${scripts}
</body>
</html>`;
}

export function flash(msg, type = "ok") {
  if (!msg) return "";
  return `<div class="flash flash-${type}" role="status">${esc(msg)}</div>`;
}

export function statusBadge(status) {
  const map = { approved: ["승인됨", "badge-ok"], pending: ["승인 대기", "badge-wait"], rejected: ["반려됨", "badge-no"] };
  const [label, cls] = map[status] || [status, ""];
  return `<span class="badge ${cls}">${label}</span>`;
}

export function hueFor(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
