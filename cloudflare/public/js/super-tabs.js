// 콘솔 탭 — 한 화면에 쏟아지던 패널을 묶음 단위로 하나씩만 보여준다.
// 운영사 콘솔(/super)과 고객사 관리 화면(/admin) 이 같은 장치를 쓴다.
// JS 가 없으면 아무것도 숨기지 않는다(전부 이어진 긴 문서로 그대로 동작).
(function () {
  "use strict";
  var nav = document.getElementById("superNav") || document.getElementById("consoleNav");
  var groups = document.querySelectorAll(".sgroup");
  if (!nav || !groups.length) return;
  document.documentElement.classList.add("has-supertabs");

  // 운영사 콘솔과 고객사 관리 화면은 탭 이름이 다르다(설정·home 만 겹친다).
  // 한 열쇠를 같이 쓰면 /admin 설정 탭을 보다 /super 로 넘어갔을 때 엉뚱하게 설정 탭이 열린다.
  var KEY = "tab:" + (nav.id === "superNav" ? "super" : "admin");
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

  // 접힌 서랍으로 보내는 링크는 펴 준다.
  // 예전엔 '＋ 새 조직'을 눌러도 닫힌 '➕ 새 조직 만들기' 앞까지만 가서, 한 번 더 눌러야 했다.
  function reveal(id) {
    var el = id && document.getElementById(id);
    if (!el) return false;
    var g = el.closest(".sgroup");
    if (g && g.dataset.tab && !g.classList.contains("on")) show(g.dataset.tab, true);
    if (el.tagName === "DETAILS") el.open = true;
    var d = el.closest("details");
    while (d) { d.open = true; d = d.parentElement && d.parentElement.closest("details"); }
    el.scrollIntoView({ block: "start" });
    var focusable = el.querySelector("input:not([type=hidden]), select, textarea");
    if (focusable) focusable.focus({ preventScroll: true });
    return true;
  }

  // 사이드 메뉴 + 본문 안의 바로가기 링크 모두 같은 동작
  document.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-tab], a[data-goto], a[href^='#']");
    if (!a || a.classList.contains("skip-link")) return;
    var tab = a.dataset.tab || a.dataset.goto;
    var href = a.getAttribute("href") || "";
    var id = href.charAt(0) === "#" ? href.slice(1) : "";
    if (!tab && id.slice(0, 2) === "s-") tab = id.slice(2);
    if (tab) { e.preventDefault(); show(tab, true); }
    if (id && id.slice(0, 2) !== "s-" && reveal(id)) e.preventDefault();
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

// 새 조직 만들기 — '업종 문구'는 모집 랜딩에만 쓰이는데 늘 보여서
// "상인회면 뭘 골라야 하지?" 하고 멈추게 된다. 해당 유형일 때만 보여 준다.
(function () {
  var kind = document.getElementById("new-kind");
  if (!kind) return;
  var form = document.getElementById("new-assoc-form");
  var rows = form ? form.querySelectorAll(".only-landing") : [];
  function sync() {
    var opt = kind.options[kind.selectedIndex];
    var on = !!(opt && opt.dataset.landing);
    for (var i = 0; i < rows.length; i++) rows[i].hidden = !on;
  }
  kind.addEventListener("change", sync);
  sync();
})();
