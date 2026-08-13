// 슈퍼 콘솔 탭 — 한 화면에 쏟아지던 패널을 묶음 단위로 하나씩만 보여준다.
// JS 가 없으면 아무것도 숨기지 않는다(전부 이어진 긴 문서로 그대로 동작).
(function () {
  "use strict";
  var nav = document.getElementById("superNav");
  var groups = document.querySelectorAll(".sgroup");
  if (!nav || !groups.length) return;
  document.documentElement.classList.add("has-supertabs");

  var KEY = "super-tab";
  function show(tab, push) {
    var found = false;
    groups.forEach(function (g) {
      var on = g.dataset.tab === tab;
      g.classList.toggle("on", on);
      if (on) found = true;
    });
    if (!found) return show(groups[0].dataset.tab, push);
    nav.querySelectorAll("a").forEach(function (a) { a.classList.toggle("on", a.dataset.tab === tab); });
    try { sessionStorage.setItem(KEY, tab); } catch (e) {}
    if (push && location.hash !== "#s-" + tab) history.replaceState(null, "", "#s-" + tab);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  // 저장·삭제 후 폼이 되돌아와도 보고 있던 묶음으로 복귀한다
  var initial = (location.hash || "").replace(/^#s-/, "");
  if (!initial) { try { initial = sessionStorage.getItem(KEY) || ""; } catch (e) {} }
  show(initial || groups[0].dataset.tab, false);

  // 사이드 메뉴 + 본문 안의 바로가기 링크 모두 같은 동작
  document.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-tab], a[data-goto]");
    if (!a) return;
    var tab = a.dataset.tab || a.dataset.goto;
    if (!tab) return;
    e.preventDefault();
    show(tab, true);
  });
  window.addEventListener("hashchange", function () {
    var t = (location.hash || "").replace(/^#s-/, "");
    if (t) show(t, false);
  });
})();

// 시크릿 값 복사 — 값을 화면에 그리지 않는다.
// 운영자가 /super 화면을 캡처해 남에게 보내는 일이 실제로 있다. 눈에 보이면 새어 나간다.
// 그래서 값은 data-copy 속성에만 두고, 버튼은 클립보드로만 넘긴다.
(function () {
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
    return Promise.resolve();
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-copy]");
    if (!b) return;
    e.preventDefault();
    var v = b.getAttribute("data-copy");
    if (!v) return;
    copy(v).then(function () {
      var old = b.textContent;
      b.textContent = "복사됨 ✓";
      b.disabled = true;
      setTimeout(function () { b.textContent = old; b.disabled = false; }, 2000);
    });
  });
})();
