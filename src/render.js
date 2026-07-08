// 공용 HTML 레이아웃 렌더러 (서버 사이드 템플릿)
import { esc } from "./http.js";

export function layout({ title, user, body, activeNav = "", head = "", scripts = "" }) {
  const navItems = [
    ["/", "홈"],
    ["/businesses", "업체 안내"],
    ["/notices", "공지사항"],
    ["/events", "행사·이벤트"],
  ];

  const nav = navItems
    .map(
      ([href, label]) =>
        `<li><a href="${href}"${activeNav === href ? ' class="active"' : ""}>${label}</a></li>`
    )
    .join("");

  let userArea;
  if (user) {
    const dash = user.role === "ADMIN" ? "/admin" : "/dashboard";
    userArea = `
      <div class="user-area">
        <a href="${dash}" class="btn btn-sm btn-ghost">${user.role === "ADMIN" ? "관리자 대시보드" : "내 업체 관리"}</a>
        <form method="post" action="/logout" class="inline-form">
          <button type="submit" class="btn btn-sm btn-primary">로그아웃</button>
        </form>
      </div>`;
  } else {
    userArea = `
      <div class="user-area">
        <a href="/login" class="btn btn-sm btn-ghost">로그인</a>
        <a href="/register" class="btn btn-sm btn-primary">업체 등록</a>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#0b6e4f" />
  <title>${esc(title)} | 서초구 상인회</title>
  <link rel="stylesheet" href="/css/app.css" />
  ${head}
</head>
<body>
  <a class="skip-link" href="#main">본문 바로가기</a>
  <header class="site-header" id="siteHeader">
    <div class="container header-inner">
      <a href="/" class="brand" aria-label="서초구 상인회 홈">
        <span class="brand-mark" aria-hidden="true">상</span>
        <span class="brand-text"><strong>서초구 상인회</strong><em>Seocho Merchants</em></span>
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
        <span class="brand-mark" aria-hidden="true">상</span>
        <div><strong>서초구 상인회</strong><p>함께 성장하는 서초 상권</p></div>
      </div>
      <nav class="footer-nav" aria-label="바닥글 메뉴">
        <a href="/businesses">업체 안내</a>
        <a href="/notices">공지사항</a>
        <a href="/events">행사·이벤트</a>
        <a href="/login">로그인</a>
      </nav>
      <p class="footer-copy">© ${new Date().getFullYear()} 서초구 상인회 (Seocho Merchants Association). All rights reserved.<br />서울특별시 서초구 서초대로 000, 상인회관 · 대표전화 02-1234-5678</p>
    </div>
  </footer>
  <script src="/js/app.js" defer></script>
  ${scripts}
</body>
</html>`;
}

// 알림 배너 (쿼리스트링 flash 메시지)
export function flash(msg, type = "ok") {
  if (!msg) return "";
  return `<div class="flash flash-${type}" role="status">${esc(msg)}</div>`;
}

export function statusBadge(status) {
  const map = {
    approved: ["승인됨", "badge-ok"],
    pending: ["승인 대기", "badge-wait"],
    rejected: ["반려됨", "badge-no"],
  };
  const [label, cls] = map[status] || [status, ""];
  return `<span class="badge ${cls}">${label}</span>`;
}

// 카테고리별 색상 hue (썸네일 그라디언트)
export function hueFor(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
