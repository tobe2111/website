// 전역 스크립트: 모바일 내비게이션 + 헤더 스크롤 효과
(function () {
  "use strict";
  var header = document.getElementById("siteHeader");
  var toggle = document.getElementById("navToggle");
  var nav = document.getElementById("mainNav");

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  // 다크 모드 토글 (localStorage 유지, data-theme 로 전환)
  try {
    var saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") document.documentElement.setAttribute("data-theme", saved);
  } catch (e) {}
  var themeBtn = document.getElementById("themeToggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
      var next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
    });
  }

  if (header) {
    var onScroll = function () {
      header.classList.toggle("scrolled", (window.scrollY || 0) > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // data-confirm: CSP 안전한 확인 다이얼로그 (인라인 onsubmit/onclick 대체)
  document.addEventListener("submit", function (e) {
    var el = e.target.closest && e.target.closest("form[data-confirm]");
    if (el && !window.confirm(el.getAttribute("data-confirm"))) e.preventDefault();
  });
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("button[data-confirm]");
    if (btn && !window.confirm(btn.getAttribute("data-confirm"))) { e.preventDefault(); e.stopPropagation(); }
    var pr = e.target.closest && e.target.closest("[data-print]");
    if (pr) { e.preventDefault(); window.print(); }
  });
})();

// PWA: 서비스 워커 등록 (실패해도 무해)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
}

// 닫으면 다시 안 뜨는 배너 (localStorage 기억)
(function () {
  "use strict";
  var els = document.querySelectorAll("[data-dismiss-key]");
  Array.prototype.forEach.call(els, function (el) {
    var key = "dis-" + el.getAttribute("data-dismiss-key");
    try { if (localStorage.getItem(key)) return; } catch (e) {}
    el.hidden = false;
    var btn = el.querySelector("[data-dismiss]");
    if (btn) btn.addEventListener("click", function () {
      try { localStorage.setItem(key, "1"); } catch (e) {}
      el.hidden = true;
    });
  });
})();

// 폰트 CSS 비차단 활성화 (media=print 로 내려받은 뒤 전체 적용 — CDN 지연이 첫 화면을 막지 않음)
(function () {
  var f = document.getElementById("fontCss");
  if (!f) return;
  function apply() { f.media = "all"; }
  if (f.sheet) apply(); else f.addEventListener("load", apply);
  setTimeout(apply, 3000); // 로드 이벤트 유실 대비
})();
