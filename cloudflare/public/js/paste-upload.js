// 사진을 Ctrl+C · Ctrl+V 로 붙여 올린다.
//
// 회장님은 사장님이 카톡으로 보낸 사진을 PC 카톡에서 복사해 둔다. 그걸 파일로 저장했다가
// '사진 선택' 으로 다시 찾아 고르는 것이 한 장당 네댓 번의 클릭이다. 붙여넣기면 한 번이다.
// 클립보드에 사진이 있으면(여러 장이면 여러 장) 화면의 사진 칸에 넣고, 몇 장 들어왔는지
// 그 자리에 적는다. 올리기는 여전히 단추를 눌러야 한다 — 실수로 붙인 것이 바로 올라가면 안 된다.
// 파일을 끌어다 놓아도 같은 길로 들어온다. 자바스크립트가 없어도 '사진 선택' 은 그대로다.
(function () {
  "use strict";
  if (!("DataTransfer" in window)) return;

  function inputs() {
    return Array.prototype.filter.call(document.querySelectorAll('input[type=file][accept*="image"]'), function (i) {
      return i.multiple;   // 한 장짜리 칸(제품 사진 등)은 붙여넣기 대상이 아니다
    });
  }
  // 어느 칸에 넣나: 접힌 <details> 안이면 펼치고, 보이는 칸이 여럿이면 첫 번째
  function target() {
    var all = inputs();
    if (!all.length) return null;
    var open = all.filter(function (i) { var d = i.closest("details"); return !d || d.open; });
    return open[0] || all[0];
  }
  function note(input, n) {
    var label = input.closest("label");
    var t = label && label.querySelector(".file-drop-text");
    if (t) t.textContent = n + "장 붙여넣었습니다 — 아래 '사진 올리기' 를 누르세요";
    var d = input.closest("details");
    if (d && !d.open) d.open = true;
    (label || input).scrollIntoView({ block: "center", behavior: "smooth" });
    var form = input.closest("form");
    var btn = form && form.querySelector("button[type=submit], button:not([type])");
    if (btn) btn.classList.add("is-armed");
  }
  function add(input, files) {
    var dt = new DataTransfer();
    Array.prototype.forEach.call(input.files || [], function (f) { dt.items.add(f); });
    var n = 0;
    files.forEach(function (f, i) {
      if (!/^image\//.test(f.type)) return;
      // 클립보드 사진은 이름이 'image.png' 뿐이라 겹친다 — 순번을 붙인다
      dt.items.add(new File([f], "붙여넣기-" + Date.now() + "-" + (i + 1) + "." + (f.type.split("/")[1] || "png").replace("jpeg", "jpg"), { type: f.type }));
      n++;
    });
    if (!n) return;
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));   // 축소(upload-resize) 가 이걸 듣는다
    note(input, dt.files.length);
  }

  document.addEventListener("paste", function (e) {
    var t = e.target;
    if (t && t.matches && t.matches("input:not([type=file]), textarea, [contenteditable]")) return;   // 글 쓰는 중이면 손대지 않는다
    var items = e.clipboardData && e.clipboardData.files;
    if (!items || !items.length) return;
    var input = target();
    if (!input) return;
    e.preventDefault();
    add(input, Array.prototype.slice.call(items));
  });

  // 끌어다 놓기 — 점선 칸 위에서
  Array.prototype.forEach.call(document.querySelectorAll(".file-drop"), function (drop) {
    var input = drop.querySelector('input[type=file]');
    if (!input) return;
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("drag"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove("drag"); }); });
    drop.addEventListener("drop", function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      e.preventDefault();
      if (input.multiple) add(input, Array.prototype.slice.call(files));
      else { var dt = new DataTransfer(); dt.items.add(files[0]); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); }
    });
  });
})();
