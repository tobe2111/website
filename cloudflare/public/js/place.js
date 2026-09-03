// 지도에서 가게를 찾아 폼에 채운다 (관리자 대행 입력).
//
// 채우기만 하고 저장하지 않는다. 지도의 전화번호·영업시간은 늘 최신이 아니고,
// 무엇보다 이 가게가 상인회 회원인지는 사람만 안다 — 확인하고 직접 저장을 누른다.
(function () {
  "use strict";
  var q = document.getElementById("placeQ");
  var btn = document.getElementById("placeBtn");
  var list = document.getElementById("placeList");
  var msg = document.getElementById("placeMsg");
  if (!q || !btn || !list || !msg || !window.fetch) return;
  var base = location.pathname.replace(/\/admin\/business\/\d+.*$/, "");
  var busy = false;

  function say(text) { msg.textContent = text; msg.hidden = !text; }
  function set(id, value) {
    var el = document.getElementById(id);
    if (!el || value == null || value === "") return;
    el.value = String(value);
  }
  // 업종은 우리 목록에 있는 값만 고른다 — 카카오의 '한식' 을 그대로 넣으면 필터에서 빠진다
  function setCategory(kakaoCategory) {
    var sel = document.getElementById("bizCategory");
    if (!sel || !kakaoCategory) return;
    var map = [[/카페|디저트|베이커리|제과|빵|커피|차,|찻집|아이스크림/, "카페·디저트"],
      [/음식|식당|한식|중식|일식|양식|분식|치킨|주점|술집|고기|국밥|피자|햄버거/, "음식점"],
      [/학원|교육|서점|문화|공방|체육|스포츠/, "교육·문화"], [/의류|패션|잡화|신발|가방|안경|액세서리/, "패션·잡화"],
      [/농산|수산|축산|정육|청과|반찬|마트|편의점/, "농수축산"], [/미용|헤어|네일|세탁|수선|부동산|병원|약국|사진|인쇄|수리/, "생활·서비스"]];
    for (var i = 0; i < map.length; i++) {
      if (!map[i][0].test(kakaoCategory)) continue;
      for (var j = 0; j < sel.options.length; j++) {
        if (sel.options[j].value === map[i][1]) { sel.selectedIndex = j; return; }
      }
    }
  }

  function fill(p) {
    set("bizName", p.name);
    set("bizAddress", p.address);
    set("bizPhone", p.phone);
    set("bizLat", p.lat);
    set("bizLng", p.lng);
    setCategory(p.categoryPath || p.category);
    list.hidden = true;
    say("채웠습니다. 확인하고 아래 [저장]을 눌러 주세요. 영업시간은 지도에 없어 직접 적으셔야 합니다.");
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
    var lat = (document.getElementById("bizLat") || {}).value;
    var lng = (document.getElementById("bizLng") || {}).value;
    var url = base + "/admin/place-search?q=" + encodeURIComponent(term)
      + (lat && lng ? "&x=" + encodeURIComponent(lng) + "&y=" + encodeURIComponent(lat) : "");
    fetch(url, { credentials: "same-origin" })
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
  // 폼 안이 아니라 옆에 있는 칸이지만, 엔터로 폼이 제출되는 것처럼 느껴지지 않게 막는다
  q.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); search(); } });
})();
