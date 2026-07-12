// 손님 찜(즐겨찾기) — 로그인 없이 localStorage. 가입 점포 목록에서 하트로 저장/필터.
(function () {
  "use strict";
  var KEY = "favs:" + (document.querySelector(".market-card[data-slug]") ? location.pathname.split("/businesses")[0] : location.pathname);
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }

  var btns = document.querySelectorAll(".fav-btn[data-fav]");
  if (!btns.length) return;
  var favs = load();
  function paint() {
    btns.forEach(function (b) {
      var on = favs.indexOf(b.getAttribute("data-fav")) >= 0;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.hidden = false;
    });
  }
  paint();
  btns.forEach(function (b) {
    b.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var slug = b.getAttribute("data-fav");
      var i = favs.indexOf(slug);
      if (i >= 0) favs.splice(i, 1); else favs.push(slug);
      save(favs); paint(); applyFilter();
    });
  });

  // "찜한 가게" 필터 칩 — 찜이 하나라도 있으면 노출
  var chip = document.getElementById("favFilter");
  var grid = document.getElementById("bizGrid");
  var filtering = false;
  function applyFilter() {
    if (!chip || !grid) return;
    chip.hidden = favs.length === 0;
    if (favs.length === 0) filtering = false;
    chip.classList.toggle("active", filtering);
    grid.querySelectorAll(".market-card[data-slug]").forEach(function (card) {
      card.style.display = !filtering || favs.indexOf(card.getAttribute("data-slug")) >= 0 ? "" : "none";
    });
  }
  if (chip) chip.addEventListener("click", function () { filtering = !filtering; applyFilter(); });
  applyFilter();
})();
