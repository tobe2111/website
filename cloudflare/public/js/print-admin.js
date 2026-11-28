// 3D프린팅 운영자 화면 — 회신 메일 초안 복사 버튼
(function () {
  var btn = document.querySelector("[data-print-copy]");
  var box = document.querySelector("[data-print-mail]");
  if (!btn || !box) return;
  var done = function () { btn.textContent = "복사했습니다"; setTimeout(function () { btn.textContent = "복사하기"; }, 2000); };
  // 클립보드 권한이 없거나 HTTP 면 글을 선택해 복사하고, 그것도 안 되면 직접 복사하도록 띄운다
  var fallback = function () {
    box.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    if (ok) done(); else window.prompt("Ctrl+C 로 복사하세요", box.value);
  };
  btn.addEventListener("click", function () {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(box.value).then(done, fallback);
    else fallback();
  });
})();
