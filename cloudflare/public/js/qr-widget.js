// 가게 QR 위젯: SVG 표시 + PNG 저장 (CSP: 인라인 스크립트 금지 → 정적 파일)
(function () {
  "use strict";
  var box = document.getElementById("qrWidget");
  if (!box || !window.QR) return;
  var path = box.getAttribute("data-url") || "/";
  var url = location.origin + path;
  var svgStr;
  try { svgStr = window.QR.svg(url, { cell: 8, quiet: 4 }); } catch (e) { box.textContent = "QR 생성 실패"; return; }
  var holder = box.querySelector(".qr-img");
  holder.innerHTML = svgStr;

  var dl = box.querySelector("[data-qr-png]");
  if (dl) dl.addEventListener("click", function () {
    var svg = holder.querySelector("svg");
    var xml = new XMLSerializer().serializeToString(svg);
    var img = new Image();
    img.onload = function () {
      var scale = 1024 / img.width;
      var canvas = document.createElement("canvas");
      canvas.width = 1024; canvas.height = 1024;
      var cx = canvas.getContext("2d");
      cx.imageSmoothingEnabled = false;
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, 1024, 1024);
      cx.scale(scale, scale); cx.drawImage(img, 0, 0);
      var a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = (box.getAttribute("data-name") || "qr") + "-QR.png";
      a.click();
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  });

  var cp = box.querySelector("[data-qr-copy]");
  if (cp) cp.addEventListener("click", function () {
    (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(url) : Promise.reject())
      .then(function () { cp.textContent = "복사됨 ✓"; setTimeout(function () { cp.textContent = "링크 복사"; }, 1800); })
      .catch(function () { prompt("주소를 복사하세요", url); });
  });
})();
