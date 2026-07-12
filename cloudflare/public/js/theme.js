// 테마 부트스트랩 — head 에서 본문 렌더 전에 실행되어 라이트→다크 깜빡임(FOUC)을 막는다
// 우선순위: 사용자가 토글로 고른 값(localStorage) > OS 다크 모드 설정 > 라이트
(function () {
  try {
    var t = localStorage.getItem("theme");
    if (t !== "dark" && t !== "light") t = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "";
    if (t) document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
