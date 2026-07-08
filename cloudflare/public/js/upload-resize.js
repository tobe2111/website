// 업로드 전 브라우저에서 이미지 축소 (ffmpeg 없는 Workers 환경의 썸네일 대체).
// 긴 변 최대 1600px, JPEG 품질 0.82 → 휴대폰 원본(수 MB)을 수백 KB로 줄여 저장·전송 절감.
(function () {
  "use strict";
  if (!("DataTransfer" in window) || !document.createElement("canvas").toBlob) return;
  var MAX = 1600, Q = 0.82;

  function resize(file) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type) || file.type === "image/gif") { resolve(file); return; }
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h || Math.max(w, h) <= MAX) { resolve(file); return; }
        var s = MAX / Math.max(w, h), cw = Math.round(w * s), ch = Math.round(h * s);
        var c = document.createElement("canvas"); c.width = cw; c.height = ch;
        c.getContext("2d").drawImage(img, 0, 0, cw, ch);
        c.toBlob(function (blob) {
          resolve(blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file);
        }, "image/jpeg", Q);
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
