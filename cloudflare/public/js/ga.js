// 구글 애널리틱스(GA4) 설정.
//
// 이 파일이 따로 있는 이유: 이 사이트의 보안 정책(CSP)은 페이지 안에 직접 써 넣은 스크립트를
// 실행하지 않습니다. 구글이 안내하는 설치 코드는 인라인이라 그대로는 동작하지 않고,
// 동작시키려면 'unsafe-inline' 을 열어야 하는데 그러면 사이트 전체의 XSS 방어가 무너집니다.
// 그래서 설정만 이 파일로 옮겨, 측정 ID 는 script 태그의 data 속성으로 받습니다.
(function () {
  "use strict";
  var el = document.currentScript || document.querySelector("script[data-ga-id]");
  var id = el && el.getAttribute("data-ga-id");
  if (!id) return;
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  // 개인정보: IP 를 익명화해서 보냅니다. 이 사이트는 손님 로그인이 없고,
  // 주문·결제도 없어 개인을 식별하는 값을 애널리틱스로 보낼 일이 없습니다.
  gtag("config", id, { anonymize_ip: true });
})();
