// 홈 검색 자동완성 고도화 — 초성 검색("ㅎㄱㄴ" → 홍가네분식) + 커스텀 드롭다운
// JS 미동작 시엔 datalist(브라우저 기본 부분일치)가 그대로 폴백으로 남는다.
(function () {
  "use strict";
  var CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  function chosung(str) {
    var out = "";
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      out += c >= 0xac00 && c <= 0xd7a3 ? CHO[Math.floor((c - 0xac00) / 588)] : str[i];
    }
    return out;
  }
  function matches(name, q) {
    var n = name.toLowerCase(), s = q.toLowerCase();
    if (n.indexOf(s) >= 0) return true;
    // 자음만으로 이뤄진 질의 → 초성 매칭
    if (/^[ㄱ-ㅎ\s]+$/.test(q)) return chosung(name).replace(/\s/g, "").indexOf(q.replace(/\s/g, "")) >= 0;
    return false;
  }
  // 테스트/디버깅용 노출
  window.__storeSuggest = { chosung: chosung, matches: matches };

  var input = document.querySelector('.hero-search input[type="search"]');
  var dl = document.getElementById("storeSuggest");
  if (!input || !dl) return;
  var names = Array.prototype.map.call(dl.querySelectorAll("option"), function (o) { return o.value; });
  if (!names.length) return;
  input.removeAttribute("list"); // 브라우저 기본 드롭다운과 중복 방지
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("autocomplete", "off");

  var form = input.closest("form");
  var box = document.createElement("ul");
  box.className = "suggest-list";
  box.setAttribute("role", "listbox");
  box.hidden = true;
  form.appendChild(box);
  var active = -1;

  function close() { box.hidden = true; box.innerHTML = ""; active = -1; input.setAttribute("aria-expanded", "false"); }
  function render(q) {
    var hits = q ? names.filter(function (n) { return matches(n, q); }).slice(0, 8) : [];
    if (!hits.length) { close(); return; }
    box.innerHTML = hits.map(function (n) { return '<li role="option">' + n.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }) + "</li>"; }).join("");
    box.hidden = false; active = -1;
    input.setAttribute("aria-expanded", "true");
  }
  function pick(li) { input.value = li.textContent; close(); if (form.requestSubmit) form.requestSubmit(); else form.submit(); }

  input.addEventListener("input", function () { render(input.value.trim()); });
  input.addEventListener("keydown", function (e) {
    var items = box.querySelectorAll("li");
    if (box.hidden || !items.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = e.key === "ArrowDown" ? (active + 1) % items.length : (active - 1 + items.length) % items.length;
      items.forEach(function (li, i) { li.classList.toggle("is-active", i === active); });
    } else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[active]); }
    else if (e.key === "Escape") close();
  });
  box.addEventListener("mousedown", function (e) { var li = e.target.closest("li"); if (li) { e.preventDefault(); pick(li); } });
  document.addEventListener("click", function (e) { if (!form.contains(e.target)) close(); });
})();
