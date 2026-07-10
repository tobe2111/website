// 업로드 전 브라우저에서 이미지 축소 → R2 저장·전송 비용 절감.
// 긴 변 최대 1280px + WebP(지원 시, 미지원 시 JPEG). 휴대폰 원본(수 MB)을 보통 100~300KB로.
(function () {
  "use strict";
  if (!("DataTransfer" in window) || !document.createElement("canvas").toBlob) return;
  var MAX = 1280, Q = 0.8;
  // 이 브라우저가 WebP 인코딩을 지원하는가
  var WEBP = (function () { try { return document.createElement("canvas").toDataURL("image/webp").indexOf("image/webp") === 5; } catch (e) { return false; } })();
  var OUT = WEBP ? "image/webp" : "image/jpeg", EXT = WEBP ? ".webp" : ".jpg";

  function resize(file) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type) || file.type === "image/gif") { resolve(file); return; }
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth, h = img.naturalHeight;
        var big = Math.max(w, h) > MAX;
        if (!w || !h) { resolve(file); return; }
        var s = big ? MAX / Math.max(w, h) : 1, cw = Math.round(w * s), ch = Math.round(h * s);
        var c = document.createElement("canvas"); c.width = cw; c.height = ch;
        c.getContext("2d").drawImage(img, 0, 0, cw, ch);
        c.toBlob(function (blob) {
          // 결과가 원본보다 작을 때만 교체(작은 이미지는 원본 유지)
          if (blob && blob.size < file.size) resolve(new File([blob], file.name.replace(/\.\w+$/, "") + EXT, { type: OUT }));
          else resolve(file);
        }, OUT, Q);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  function attach(input) {
    input.addEventListener("change", function () {
      if (input._busy || !input.files || !input.files.length) return;
      var files = Array.prototype.slice.call(input.files);
      if (!files.some(function (f) { return /^image\//.test(f.type); })) return;
      Promise.all(files.map(resize)).then(function (out) {
        var dt = new DataTransfer();
        out.forEach(function (f) { dt.items.add(f); });
        input._busy = true; input.files = dt.files; input._busy = false;
      });
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[type=file][accept*="image"]'), attach);
})();
