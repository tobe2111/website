// 가로로 미는 카드 줄 — 화살표로 한 장씩 넘긴다.
//
// 화살표는 **스크립트가 붙었을 때만** 켠다(서버는 hidden 으로 그린다).
// 자바스크립트가 꺼져 있어도 줄은 손가락·트랙패드로 그대로 밀린다 — 버튼만 안 보인다.
(function () {
  "use strict";
  var rail = document.getElementById("bizRail");
  if (!rail) return;
  var nav = rail.parentNode.querySelector(".rail-nav");
  if (!nav) return;

  function step() {
    var card = rail.querySelector(".market-card");
    if (!card) return rail.clientWidth * 0.8;
    var gap = parseFloat(getComputedStyle(rail).columnGap || getComputedStyle(rail).gap) || 16;
    return card.getBoundingClientRect().width + gap;
  }
  function overflowing() { return rail.scrollWidth - rail.clientWidth > 4; }
  function sync() {
    if (!overflowing()) { nav.hidden = true; return; }
    nav.hidden = false;
    var max = rail.scrollWidth - rail.clientWidth;
    nav.querySelector('[data-rail="prev"]').disabled = rail.scrollLeft <= 2;
    nav.querySelector('[data-rail="next"]').disabled = rail.scrollLeft >= max - 2;
  }
  nav.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-rail]") : null;
    if (!btn) return;
    rail.scrollBy({ left: btn.getAttribute("data-rail") === "next" ? step() : -step(), behavior: "smooth" });
  });
  rail.addEventListener("scroll", sync, { passive: true });
  window.addEventListener("resize", sync);
  // 카드 사진이 늦게 뜨면 폭이 달라진다 — 다 뜬 뒤에 한 번 더 잰다
  window.addEventListener("load", sync);
  sync();
})();
