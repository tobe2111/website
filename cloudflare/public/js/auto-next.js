// "다음 여덟 곳" 을 사람이 열다섯 번 누르게 하지 않는다.
//
// 명부 114곳을 지도에 연결하려면 여덟 곳씩 열다섯 번을 돌려야 한다. 회장님이 그걸
// 열다섯 번 누르고 있을 이유가 없다. 화면에 [data-auto-next] 폼이 있으면 잠깐 뒤에
// 스스로 보낸다 — 서버가 "더 없다" 고 하면 그 폼을 안 그리므로 저절로 멈춘다.
//
// 자바스크립트가 죽어 있어도 길이 끊기지 않는다. 그때는 그냥 단추가 남아 있고,
// 회장님이 누르면 한 묶음씩 나아간다. 자동은 편의지 조건이 아니다.
(function () {
  var f = document.querySelector("form[data-auto-next]");
  if (!f) return;
  var btn = f.querySelector("button");
  // 사람이 중간에 멈출 수 있어야 한다 — 멈추고 싶은데 화면이 계속 도는 것만큼 답답한 것이 없다.
  var stop = document.createElement("button");
  stop.type = "button";
  stop.className = "btn btn-ghost btn-sm";
  stop.textContent = "여기서 멈추기";
  var timer = setTimeout(function () { if (btn) btn.disabled = false; f.submit(); }, 700);
  stop.addEventListener("click", function () {
    clearTimeout(timer);
    stop.remove();
    if (btn) { btn.disabled = false; btn.textContent = btn.textContent.replace(/^계속 찾는 중… /, ""); }
  });
  if (btn) {
    btn.disabled = true;                       // 두 번 눌러 두 묶음이 겹쳐 도는 것을 막는다
    btn.textContent = "계속 찾는 중… " + btn.textContent;
  }
  f.appendChild(stop);
})();
