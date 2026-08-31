// 파일을 고르면 그 자리에서 미리보기를 바꿔 준다.
// 예전에는 저장을 눌러야 바뀌어서, 고른 뒤에도 옛 사진이 그대로 보였다 —
// 제대로 골랐는지 확인할 방법이 없어 같은 파일을 몇 번씩 다시 고르게 된다.
(function () {
  "use strict";
  if (!window.URL || !URL.createObjectURL) return;

  function boxFor(input) {
    // 입력칸 뒤에 오는 첫 미리보기 상자를 찾는다(없으면 만들어 붙인다)
    var label = input.closest("label") || input;
    var el = label.nextElementSibling;
    while (el && !el.classList.contains("hero-img-cur")) {
      if (el.tagName === "LABEL" || el.tagName === "BUTTON") break;
      el = el.nextElementSibling;
    }
    if (el && el.classList.contains("hero-img-cur")) return el;
    var made = document.createElement("div");
    made.className = "hero-img-cur";
    label.insertAdjacentElement("afterend", made);
    return made;
  }

  function show(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    var box = boxFor(input);
    var old = box.querySelector("img, video");
    var isVideo = /^video\//.test(file.type) || /\.(mp4|webm)$/i.test(file.name);
    var node = document.createElement(isVideo ? "video" : "img");
    var url = URL.createObjectURL(file);
    node.src = url;
    if (isVideo) { node.muted = true; node.playsInline = true; node.preload = "metadata"; node.style.maxWidth = "220px"; node.style.borderRadius = "8px"; }
    else { node.alt = "고르신 사진 미리보기"; }
    node.addEventListener("load", function () { URL.revokeObjectURL(url); });
    node.addEventListener("loadeddata", function () { URL.revokeObjectURL(url); });
    if (old) old.replaceWith(node); else box.insertBefore(node, box.firstChild);

    // 아직 저장 전이라는 걸 분명히 한다 — 안 그러면 저장한 줄 알고 넘어간다
    var tag = box.querySelector(".pv-note");
    if (!tag) {
      tag = document.createElement("p");
      tag.className = "pv-note";
      box.insertBefore(tag, node.nextSibling);
    }
    tag.textContent = "고르신 파일입니다 — 아직 저장되지 않았습니다. 아래 저장 버튼을 눌러 주세요.";
    // 새로 고른 파일이 있으면 '제거' 체크는 뜻이 없다
    var clear = box.querySelector('input[type=checkbox][name$="_clear"]');
    if (clear) { clear.checked = false; }
  }

  Array.prototype.forEach.call(
    document.querySelectorAll('input[type=file][accept*="image"], input[type=file][accept*="video"]'),
    function (input) { input.addEventListener("change", function () { show(input); }); }
  );
})();

// 우리말 단추로 감싼 파일 칸 — 고른 파일 이름을 단추 옆에 적어 준다.
// 기본 입력칸을 숨겼기 때문에, 안 적으면 골랐는지 아닌지 알 수 없다.
(function () {
  Array.prototype.forEach.call(document.querySelectorAll(".file-inline input[type=file]"), function (input) {
    var name = input.parentNode.querySelector(".fi-name");
    if (!name) return;
    input.addEventListener("change", function () {
      var n = input.files ? input.files.length : 0;
      name.textContent = !n ? "" : n > 1 ? ` — ${n}장 고름` : ` — ${input.files[0].name}`;
    });
  });
})();
