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
