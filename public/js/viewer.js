// 미디어 뷰어 (라이트박스) — 사진 확대 + 세로/가로 영상(릴스) 전체화면 재생
(function () {
  "use strict";
  var tiles = Array.prototype.slice.call(document.querySelectorAll(".gallery-item"));
  if (!tiles.length) return;

  var items = tiles.map(function (t) {
    return { src: t.getAttribute("data-src"), kind: t.getAttribute("data-kind"), caption: t.getAttribute("data-caption") || "" };
  });

  // 오버레이 DOM 구성
  var overlay = document.createElement("div");
  overlay.className = "viewer";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML =
    '<button class="viewer-close" aria-label="닫기">✕</button>' +
    '<button class="viewer-nav viewer-prev" aria-label="이전">‹</button>' +
    '<div class="viewer-stage" role="dialog" aria-modal="true"></div>' +
    '<button class="viewer-nav viewer-next" aria-label="다음">›</button>' +
    '<div class="viewer-caption"></div>' +
    '<div class="viewer-count"></div>';
  document.body.appendChild(overlay);

  var stage = overlay.querySelector(".viewer-stage");
  var capEl = overlay.querySelector(".viewer-caption");
  var countEl = overlay.querySelector(".viewer-count");
  var idx = 0;

  function clearStage() {
    var v = stage.querySelector("video");
    if (v) { try { v.pause(); } catch (e) {} v.removeAttribute("src"); v.load && v.load(); }
    stage.innerHTML = "";
  }

  function render() {
    clearStage();
    var it = items[idx];
    var el;
    if (it.kind === "video") {
      el = document.createElement("video");
      el.src = it.src;
      el.controls = true;
      el.autoplay = true;
      el.playsInline = true;
      el.setAttribute("playsinline", "");
      el.preload = "metadata";
    } else {
      el = document.createElement("img");
      el.src = it.src;
      el.alt = it.caption || "사진";
    }
    // 세로/가로 판별 → 클래스 부여 (세로=릴스 스타일)
    el.addEventListener(it.kind === "video" ? "loadedmetadata" : "load", function () {
      var w = it.kind === "video" ? el.videoWidth : el.naturalWidth;
      var h = it.kind === "video" ? el.videoHeight : el.naturalHeight;
      stage.classList.toggle("portrait", h > w);
      stage.classList.toggle("landscape", w >= h);
    });
    stage.appendChild(el);
    capEl.textContent = it.caption || "";
    capEl.style.display = it.caption ? "" : "none";
    countEl.textContent = (idx + 1) + " / " + items.length;
    var multi = items.length > 1;
    overlay.querySelector(".viewer-prev").style.display = multi ? "" : "none";
    overlay.querySelector(".viewer-next").style.display = multi ? "" : "none";
  }

  function open(i) {
    idx = i;
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    render();
  }
  function close() {
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    clearStage();
  }
  function go(delta) {
    idx = (idx + delta + items.length) % items.length;
    render();
  }

  tiles.forEach(function (t, i) {
    t.addEventListener("click", function (e) { e.preventDefault(); open(i); });
  });
  overlay.querySelector(".viewer-close").addEventListener("click", close);
  overlay.querySelector(".viewer-prev").addEventListener("click", function () { go(-1); });
  overlay.querySelector(".viewer-next").addEventListener("click", function () { go(1); });
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", function (e) {
    if (!overlay.classList.contains("open")) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
  });

  // 모바일 스와이프
  var sx = 0, sy = 0;
  stage.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener("touchend", function (e) {
    var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  }, { passive: true });
})();
