// 당사자로 '외부 상대방'을 고르면 이름·연락처 칸이 그 자리에서 열린다.
// JS 가 꺼져 있어도 칸은 보이기만 할 뿐(hidden 이 풀리지 않아도 서버가 값을 읽는다) 막히지 않는다.
(function () {
  var picks = document.querySelectorAll(".party-pick");
  if (!picks.length) return;
  function sync(sel) {
    var box = document.querySelector('.party-ext[data-party="' + sel.dataset.party + '"]');
    if (!box) return;
    var on = sel.value === "ext";
    box.hidden = !on;
    // 안 쓰는 칸이 필수로 남아 제출을 막는 일이 없게, 열릴 때만 필수로 만든다
    var name = box.querySelector('input[name^="ext_name_"]');
    if (name) name.required = on;
  }
  for (var i = 0; i < picks.length; i++) {
    (function (sel) {
      sel.addEventListener("change", function () { sync(sel); });
      sync(sel);
    })(picks[i]);
  }
})();
