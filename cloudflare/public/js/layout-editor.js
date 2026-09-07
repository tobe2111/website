// 홈페이지 구성 편집기: 섹션 순서 변경 (위/아래) — 저장 시 순서 반영
(function () {
  "use strict";
  var rows = document.getElementById("layoutRows");
  var orderInput = document.getElementById("layoutOrder");
  if (!rows || !orderInput) return;

  function syncOrder() {
    var idxs = [];
    rows.querySelectorAll(".layout-row").forEach(function (row) {
      idxs.push(row.getAttribute("data-index"));
    });
    orderInput.value = idxs.join(",");
  }

  rows.addEventListener("click", function (e) {
    var btn = e.target.closest(".move-btn");
    if (!btn) return;
    e.preventDefault();
    var row = btn.closest(".layout-row");
    if (!row) return;
    if (btn.getAttribute("data-dir") === "up") {
      var prev = row.previousElementSibling;
      if (prev) rows.insertBefore(row, prev);
    } else {
      var next = row.nextElementSibling;
      if (next) rows.insertBefore(next, row);
    }
    syncOrder();
  });

  syncOrder();
})();

// 줄 안의 조작칸(켜고 끄기·순서)은 줄을 펼치지 않는다.
// summary 안의 컨트롤을 그냥 두면 스위치를 누를 때마다 문구 칸이 함께 열려,
// 열여섯 개를 껐다 켜는 동안 화면이 계속 늘었다 줄었다 한다.
(function () {
  "use strict";
  var rows = document.getElementById("layoutRows");
  if (!rows) return;
  rows.addEventListener("click", function (e) {
    var sw = e.target.closest(".layout-row-head .switch");
    if (sw) {
      e.preventDefault();                     // details 가 열리지 않게
      var box = sw.querySelector("input[type=checkbox]");
      if (box) {
        box.checked = !box.checked;
        var row = sw.closest(".layout-row");
        var state = row && row.querySelector(".lstate");
        if (state) state.textContent = box.checked ? "켜짐" : "꺼짐";
        sw.title = box.checked ? "지금 켜져 있습니다" : "지금 꺼져 있습니다";
      }
      return;
    }
    if (e.target.closest(".layout-row-head .move-btn")) e.preventDefault();
  });
})();
