// 홈 팝업 — 관리자가 띄운 안내창을 여닫습니다.
//
// 이 파일이 없거나 자바스크립트가 꺼져 있으면 팝업은 아예 뜨지 않습니다(서버가 hidden 으로 그립니다).
// 화면을 가로막아 놓고 닫을 수단이 없는 상태보다, 안 뜨는 편이 낫기 때문입니다.
//
// 지키는 것:
//   · '오늘 하루 보지 않기' 는 이 브라우저에만 남습니다(localStorage). 서버로 아무것도 보내지 않습니다.
//   · ESC · 배경 클릭 · 닫기 단추 — 닫는 길을 셋 다 둡니다.
//   · 키보드 초점을 창 안에 가두고, 닫으면 원래 있던 자리로 돌려놓습니다.
//   · 저장소를 막아 둔 브라우저(사생활 보호 모드 등)에서도 조용히 동작합니다.
(function () {
  "use strict";
  var layer = document.getElementById("popupLayer");
  if (!layer) return;
  var cards = [].slice.call(layer.querySelectorAll("[data-popup]"));
  if (!cards.length) return;

  // 오늘 날짜(한국 기준) — 서버가 노출 기간을 KST 로 판단하므로 여기서도 맞춥니다.
  function today() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function key(id) { return "popup-hide-" + id; }
  function hiddenToday(id) {
    try { return localStorage.getItem(key(id)) === today(); } catch (e) { return false; }
  }
  function hideToday(id) {
    try { localStorage.setItem(key(id), today()); } catch (e) { /* 저장소가 막혀 있으면 이번 방문만 닫힙니다 */ }
  }

  var open = cards.filter(function (c) { return !hiddenToday(c.getAttribute("data-popup")); });
  if (!open.length) return;

  var restoreTo = document.activeElement;
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])';

  function closeCard(card) {
    var box = card.querySelector("[data-popup-today]");
    if (box && box.checked) hideToday(card.getAttribute("data-popup"));
    card.hidden = true;
    if (!layer.querySelector("[data-popup]:not([hidden])")) {
      layer.hidden = true;
      document.body.classList.remove("popup-open");
      document.removeEventListener("keydown", onKey, true);
      if (restoreTo && restoreTo.focus) restoreTo.focus();
    }
  }
  function topCard() { return layer.querySelector("[data-popup]:not([hidden])"); }

  function onKey(e) {
    var card = topCard();
    if (!card) return;
    if (e.key === "Escape") { e.preventDefault(); closeCard(card); return; }
    if (e.key !== "Tab") return;
    // 초점 가두기 — 팝업 밖으로 탭이 새면 뒤 화면을 더듬게 됩니다.
    var items = [].slice.call(card.querySelectorAll(FOCUSABLE)).filter(function (el) { return el.offsetParent !== null; });
    if (!items.length) return;
    var firstEl = items[0], lastEl = items[items.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
  }

  layer.addEventListener("click", function (e) {
    var hit = e.target.closest ? e.target.closest("[data-popup-close]") : null;
    if (!hit) return;
    var card = hit.closest("[data-popup]") || topCard();
    if (card) closeCard(card);
  });

  layer.hidden = false;
  document.body.classList.add("popup-open");
  open.forEach(function (c) { c.hidden = false; });
  document.addEventListener("keydown", onKey, true);
  var first = open[0].querySelector(FOCUSABLE);
  if (first) first.focus();
})();
