// 확인서 QR — 종이로 출력해도 휴대폰으로 바로 재검증할 수 있게 검증 주소를 QR 로 넣는다.
// (CSP 상 인라인 스크립트를 못 쓰므로 정적 파일로 분리)
(function () {
  "use strict";
  var box = document.getElementById("certQr");
  if (!box || !window.QR) return;
  var url = box.getAttribute("data-url") || "";
  if (!url) return;
  try { box.innerHTML = window.QR.svg(url, { cell: 4, quiet: 2 }); }
  catch (e) { box.textContent = ""; }
})();
