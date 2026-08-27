// 공유 버튼: 모바일 = OS 공유 시트(카톡 포함), PC = 링크 복사
(function () {
  "use strict";
  function toast(msg) {
    var t = document.createElement("div");
    t.className = "share-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("on"); }, 10);
    setTimeout(function () { t.classList.remove("on"); setTimeout(function () { t.remove(); }, 300); }, 2200);
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
    return Promise.resolve();
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-share]");
    if (!btn) return;
    var url = btn.getAttribute("data-share-url") || location.href;
    var title = btn.getAttribute("data-share-title") || document.title;
    // data-share-text 가 있으면 링크만이 아니라 '보낼 말' 한 통을 통째로 넘긴다.
    // 카톡 대화창에 붙여 넣었을 때 주소 한 줄만 덩그러니 가면 받는 사람이 무엇인지 모른다.
    var text = btn.getAttribute("data-share-text") || "";
    if (navigator.share) {
      navigator.share(text ? { title: title, text: text, url: url } : { title: title, url: url }).catch(function () {});
    } else {
      copy(text ? text + "\n" + url : url).then(function () {
        toast(text ? "보낼 메시지가 복사되었습니다" : "링크가 복사되었습니다");
      });
    }
  });
})();
