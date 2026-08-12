// 가맹 상담 폼 — 광고 출처 보강.
// 서버가 주소의 utm_* 를 이미 심어 두었고, 여기서는 자바스크립트가 있어야만 알 수 있는 값을 채운다:
//   ① 유입 페이지(document.referrer) ② 주소에 utm 이 있는데 서버 값이 비어 있는 경우(캐시된 HTML)
// 실패해도 폼은 그대로 동작해야 한다 — 계측이 접수를 막으면 본말전도다.
(function () {
  "use strict";
  try {
    var form = document.getElementById("leadForm");
    if (!form) return;
    var set = function (name, value) {
      var el = form.querySelector('[data-track="' + name + '"]');
      if (el && !el.value && value) el.value = String(value).slice(0, 200);
    };
    var q = new URLSearchParams(location.search);
    set("utm_source", q.get("utm_source"));
    set("utm_medium", q.get("utm_medium"));
    set("utm_campaign", q.get("utm_campaign"));
    // 같은 사이트 안에서 넘어온 이동은 '유입'이 아니다 — 외부에서 온 것만 기록한다.
    var ref = document.referrer || "";
    if (ref && ref.indexOf(location.origin) !== 0) set("referrer", ref);
  } catch (e) { /* 계측 실패는 조용히 넘어간다 */ }
})();
