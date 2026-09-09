// 오래 걸리는 단추를 두 번 누르지 못하게 한다.
//
// 명부 114곳을 넣는 데는 시간이 걸린다. 그동안 화면은 아무 말이 없다 — 그러면 사람은
// 안 눌린 줄 알고 한 번 더 누른다. 이상한 행동이 아니라 당연한 행동이다.
// 그런데 그 두 번째 누름이 114곳을 통째로 한 번 더 만들거나, 서버에서 부딪혀 오류를 냈다.
//
// 서버 쪽은 따로 막아 뒀다(같은 상호는 표가 두 번 받지 않는다). 여기서는 **애초에 두 번
// 눌리지 않게** 하고, 무엇보다 **지금 하는 중이라고 말해 준다.** 기다리는 줄 알면 안 누른다.
//
// 자바스크립트가 없어도 기능은 그대로다. 그때는 단추가 두 번 눌릴 수 있을 뿐이고,
// 그 경우는 서버가 받아 낸다. 여기는 편의지 안전장치가 아니다.
(function () {
  var busy = false;
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (!f || !f.matches || !f.matches("form[data-once]")) return;
    if (busy) { e.preventDefault(); return; }   // 두 번째 누름은 아예 보내지 않는다
    busy = true;
    // e.submitter 를 못 읽는 브라우저가 있어 폼 안의 단추를 모두 잠근다.
    var btns = f.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      // disabled 로 만들면 그 단추의 name/value 가 서버에 안 간다(confirm=1 이 사라진다).
      // 그래서 '누를 수 없게' 만 하고 값은 그대로 둔다.
      b.setAttribute("aria-disabled", "true");
      b.classList.add("is-busy");
      if (b === (e.submitter || btns[0])) b.textContent = "등록하는 중… 잠시만 기다려 주세요";
    }
  });
})();
