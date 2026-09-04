// 지도에서 가게를 찾아 폼에 채운다 (관리자 대행 입력).
//
// 채우기만 하고 저장하지 않는다. 지도의 전화번호·영업시간은 늘 최신이 아니고,
// 무엇보다 이 가게가 상인회 회원인지는 사람만 안다 — 확인하고 직접 저장을 누른다.
//
// 한 화면에 두 군데(회원 추가 · 점포 정보)가 있으므로 아이디가 아니라 **자리(구역)** 로 찾는다.
// 채울 칸은 data-place="name|address|phone|category|lat|lng" 로 표시한다.
(function () {
  "use strict";
  if (!window.fetch) return;
  var base = location.pathname.replace(/\/admin(\/business\/\d+)?.*$/, "");

  // 카카오의 갈래('음식점 > 카페 > 커피전문점')를 우리 업종 목록으로 옮긴다.
  // 맨 끝 낱말만 보면 '커피전문점' 이 카페인지 알 수 없어 전체 갈래를 받는다.
  var MAP = [
    [/카페|디저트|베이커리|제과|빵|커피|찻집|아이스크림/, "카페·디저트"],
    [/음식|식당|한식|중식|일식|양식|분식|치킨|주점|술집|고기|국밥|피자|햄버거/, "음식점"],
    [/학원|교육|서점|문화|공방|체육|스포츠/, "교육·문화"],
    [/의류|패션|잡화|신발|가방|안경|액세서리/, "패션·잡화"],
    [/농산|수산|축산|정육|청과|반찬|마트|편의점/, "농수축산"],
    [/미용|헤어|네일|세탁|수선|부동산|병원|약국|사진|인쇄|수리/, "생활·서비스"],
  ];

  function setup(box) {
    var scope = box.closest("section") || document;
    var q = box.querySelector("[data-place-q]");
    var btn = box.querySelector("[data-place-go]");
    var list = scope.querySelector("[data-place-list]");
    var msg = scope.querySelector("[data-place-msg]");
    if (!q || !btn || !list || !msg) return;
    var busy = false;

    function say(text) { msg.textContent = text; msg.hidden = !text; }
    function field(key) { return scope.querySelector('[data-place="' + key + '"]'); }
    function set(key, value) {
      var el = field(key);
      if (!el || value == null || value === "") return;
      el.value = String(value);
    }
    function setCategory(path) {
      var sel = field("category");
      if (!sel || !path) return;
      for (var i = 0; i < MAP.length; i++) {
        if (!MAP[i][0].test(path)) continue;
        if (sel.tagName === "SELECT") {
          for (var j = 0; j < sel.options.length; j++) {
            if (sel.options[j].value === MAP[i][1]) { sel.selectedIndex = j; return; }
          }
        } else { sel.value = MAP[i][1]; }
        return;
      }
    }
    function fill(p) {
      set("name", p.name);
      set("address", p.address);
      set("phone", p.phone);
      set("lat", p.lat);
      set("lng", p.lng);
      setCategory(p.categoryPath || p.category);
      list.hidden = true;
      say("채웠습니다. 확인하고 저장을 눌러 주세요. 영업시간은 지도에 없어 직접 적으셔야 합니다.");
    }
    function render(places) {
      list.textContent = "";
      places.forEach(function (p) {
        var li = document.createElement("li");
        var b = document.createElement("button");
        b.type = "button";
        b.className = "place-pick";
        var t = document.createElement("b");
        t.textContent = p.name;
        var s = document.createElement("small");
        s.textContent = [p.address, p.phone, p.category].filter(Boolean).join(" · ") || "주소 정보 없음";
        b.appendChild(t); b.appendChild(s);
        b.addEventListener("click", function () { fill(p); });
        li.appendChild(b);
        list.appendChild(li);
      });
      list.hidden = !places.length;
    }
    function search() {
      var term = (q.value || "").trim();
      if (busy) return;
      if (term.length < 2) { say("가게 이름을 두 글자 이상 적어 주세요."); return; }
      busy = true; btn.disabled = true; say("찾는 중…"); list.hidden = true;
      // 지금 좌표가 있으면 그 근처를 먼저 본다 — 같은 상호가 전국에 있다
      var lat = (field("lat") || {}).value;
      var lng = (field("lng") || {}).value;
      fetch(base + "/admin/place-search?q=" + encodeURIComponent(term)
        + (lat && lng ? "&x=" + encodeURIComponent(lng) + "&y=" + encodeURIComponent(lat) : ""), { credentials: "same-origin" })
        .then(function (r) { return r.json().catch(function () { return { error: "bad" }; }); })
        .then(function (d) {
          if (d && d.error) { say(d.message || "찾지 못했습니다."); return; }
          var places = (d && d.places) || [];
          if (!places.length) { say("그 이름으로는 찾지 못했습니다. 상호를 조금 더 정확히 적어 보세요."); return; }
          say("아래에서 맞는 가게를 눌러 주세요.");
          render(places);
        })
        .catch(function () { say("찾지 못했습니다. 잠시 후 다시 시도해 주세요."); })
        .then(function () { busy = false; btn.disabled = false; });
    }
    btn.addEventListener("click", search);
    // 폼 안의 칸이라 엔터를 누르면 폼이 제출된다 — 그 전에 가로채 검색으로 돌린다
    q.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); search(); } });
  }

  var boxes = document.querySelectorAll("[data-place-find]");
  for (var i = 0; i < boxes.length; i++) setup(boxes[i]);
})();
