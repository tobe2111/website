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

  // 다크 모드 토글 (초기 적용은 head 의 theme.js 가 담당 — 저장값 > OS 설정 > 라이트)
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

  // 중복 제출 방지 — 제출된 폼의 버튼을 잠가 느린 네트워크에서 두 번 눌리는 것을 막는다
  // (data-confirm 리스너보다 나중에 등록 → 취소된 제출(e.defaultPrevented)은 건너뜀)
  function unlockForm(f) {
    delete f.dataset.busy;
    f.querySelectorAll(".is-busy").forEach(function (b) { b.disabled = false; b.classList.remove("is-busy"); });
  }
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (!f || e.defaultPrevented) return;
    if (f.dataset.busy) { e.preventDefault(); return; }
    f.dataset.busy = "1";
    // 버튼 값 직렬화가 끝난 뒤 잠그도록 다음 틱에 disabled 처리
    setTimeout(function () {
      f.querySelectorAll('button[type="submit"],button:not([type]),input[type="submit"]').forEach(function (b) { b.disabled = true; b.classList.add("is-busy"); });
    }, 0);
    setTimeout(function () { unlockForm(f); }, 10000); // 응답이 오래 없으면 잠금 해제(안전망)
  });
  // 뒤로가기(bfcache)로 돌아왔을 때 잠금 해제
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) document.querySelectorAll("form[data-busy]").forEach(unlockForm);
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
