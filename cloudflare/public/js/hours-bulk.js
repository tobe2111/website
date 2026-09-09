// 영업시간 한꺼번에 적기 — 두 단추.
//
// 골목 가게는 시간이 비슷하다. 123칸을 하나씩 치게 하면 안 친다. 그래서
//  · "빈 칸 모두 채우기": 맨 위 칸의 값을 비어 있는 칸 전부에 넣는다. 이미 적은 칸은 건드리지 않는다.
//  · "위와 같게": 바로 윗줄 값을 이 줄에 복사한다.
// 둘 다 화면 안에서만 움직이고, 저장은 '적은 것 모두 저장' 이 한다. 자바스크립트가 없으면
// 단추 둘이 안 움직일 뿐 손으로 적어 저장하는 길은 그대로다.
(function () {
  function inputs() { return Array.prototype.slice.call(document.querySelectorAll("[data-hours-input]")); }
  document.addEventListener("click", function (e) {
    var fill = e.target.closest && e.target.closest("[data-fill-empty]");
    if (fill) {
      var src = document.getElementById(fill.getAttribute("data-fill-empty"));
      var v = src ? src.value.trim() : "";
      if (!v) { if (src) src.focus(); return; }
      var n = 0;
      inputs().forEach(function (i) { if (!i.value.trim()) { i.value = v; n++; } });
      fill.textContent = n ? "빈 칸 " + n + "곳에 넣었습니다" : "빈 칸이 없습니다";
      return;
    }
    var same = e.target.closest && e.target.closest("[data-same-as-above]");
    if (same) {
      var all = inputs();
      var row = same.closest("tr");
      var mine = row && row.querySelector("[data-hours-input]");
      var idx = all.indexOf(mine);
      if (idx > 0) { mine.value = all[idx - 1].value; mine.focus(); }
    }
  });
})();
