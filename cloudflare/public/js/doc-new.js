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

// 본문을 고치면 오른쪽 미리보기도 따라간다 — 조판은 서버가 하는 그대로 받아 온다.
// 화면에서 자체적으로 줄을 나누면 실제 계약서와 다른 자리에서 쪽이 넘어가고,
// 그러면 "미리보기에선 한 장이었는데" 하는 일이 생긴다.
(function () {
  var ta = document.getElementById("tplBody");
  var preview = document.getElementById("tplPreview");
  if (!ta || !preview || !window.fetch) return;
  var base = location.pathname.replace(/\/admin\/documents\/new.*$/, "");
  var csrf = (document.querySelector('input[name="_csrf"]') || {}).value || "";
  var timer = null, last = ta.value, inflight = false;
  function draw() {
    if (inflight || ta.value === last) return;
    last = ta.value; inflight = true;
    var fd = new FormData();
    fd.set("_csrf", csrf);
    // 빈칸은 서버가 계약서를 만들 때와 같은 모양(밑줄)으로 보여 준다 — 값은 아직 안 넣는다
    fd.set("body", ta.value.replace(/\{\{\s*[^}\n]{1,30}?\s*\}\}/g, "____________"));
    fetch(base + "/admin/documents/preview", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (h) { if (h != null) { preview.innerHTML = h; fitPaper(); } })
      .catch(function () {})   // 미리보기가 안 떠도 계약서를 만드는 데는 지장이 없다
      .then(function () { inflight = false; if (ta.value !== last) draw(); });
  }
  // 지면은 794px 로 그려져 있다 — 오른쪽 칸 폭에 맞춰 통째로 줄인다(작성기·paper.js 와 같은 방식).
  // paper.js 는 처음 그린 지면만 붙잡고 있어서, 새로 받아 온 지면은 여기서 다시 맞춰야 한다.
  function fitPaper() {
    var stack = preview.querySelector(".paper-stack");
    if (!stack) return;
    var pw = +stack.dataset.pw || 794, ph = +stack.dataset.ph || 1123;
    var s = Math.min(1, preview.clientWidth / pw);
    stack.style.setProperty("--ps", s);
    stack.style.height = (stack.querySelectorAll(".paper").length * (ph + 24) * s) + "px";
  }
  ta.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(draw, 400); });
  window.addEventListener("resize", fitPaper);
  // 편집 칸을 열면 왼쪽이 넓어져 미리보기 칸이 좁아진다 — 그때 배율을 다시 잡지 않으면
  // 종이가 오른쪽으로 잘려 나간다(창 크기는 그대로라 resize 가 오지 않는다).
  var box = ta.closest("details");
  if (box) box.addEventListener("toggle", fitPaper);
})();
