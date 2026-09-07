// 표에서 여러 줄을 골라 한 번에 처리한다 (공지 목록 등).
// 체크 상자는 표 안에 있고 단추는 표 위 도구줄에 있어 form 속성으로 이어 붙였다 —
// 그래서 "몇 건 골랐는지" 를 사람이 셀 수 없다. 그 숫자를 대신 세어 준다.
(function () {
  "use strict";
  document.querySelectorAll("[data-bulk]").forEach(function (bar) {
    var id = bar.id;
    if (!id) return;
    var all = bar.querySelector("[data-bulk-all]");
    var out = bar.querySelector("[data-bulk-count]");
    var boxes = function () {
      return Array.prototype.slice.call(document.querySelectorAll('input[type=checkbox][form="' + id + '"]'));
    };
    function sync() {
      var list = boxes();
      var n = list.filter(function (b) { return b.checked; }).length;
      if (out) out.textContent = n ? n + "건 고름" : "고른 것 없음";
      bar.classList.toggle("has-sel", n > 0);
      if (all) {
        all.checked = n > 0 && n === list.length;
        all.indeterminate = n > 0 && n < list.length;
      }
      // 아무것도 안 골랐으면 누를 수 없다 — 눌러 놓고 "고른 것이 없습니다" 를 보는 것보다 낫다
      bar.querySelectorAll("button[name=act]").forEach(function (b) { b.disabled = !n; });
    }
    if (all) all.addEventListener("change", function () {
      boxes().forEach(function (b) { b.checked = all.checked; });
      sync();
    });
    document.addEventListener("change", function (e) {
      if (e.target.matches && e.target.matches('input[type=checkbox][form="' + id + '"]')) sync();
    });
    sync();
  });
})();
