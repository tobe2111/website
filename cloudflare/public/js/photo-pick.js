// 웹에서 가게 사진을 찾아 고르는 칸 (관리자 대행 입력).
//
// 지도(로컬) 검색은 사진을 주지 않는다. 사진은 **이미지 검색**이라는 별개의 창구에서 온다.
// 그런데 거기서 오는 것은 '그 가게의 공식 사진' 이 아니라 **웹에서 그 이름으로 검색된 사진**이다.
// 다른 지점, 남의 블로그 후기, 아예 상관없는 사진이 섞인다.
//
// 그래서 이 화면은 **고르게 만드는 것이 목적**이다. 한 번에 담기지 않는다:
// 눈으로 보고, 최대 다섯 장까지, 사람이 누른다. 저장은 서버가 다시 검증한다.
(function () {
  "use strict";
  if (!window.fetch) return;
  var MAX = 5;

  function setup(form) {
    var base = location.pathname.replace(/\/admin\/business\/\d+.*$/, "");
    var q = form.querySelector("[data-pick-q]");
    var sent = form.querySelector("[data-pick-q-sent]");
    var go = form.querySelector("[data-pick-go]");
    var list = form.querySelector("[data-pick-list]");
    var msg = form.querySelector("[data-pick-msg]");
    var save = form.querySelector("[data-pick-save]");
    if (!q || !go || !list || !msg || !save) return;
    var busy = false;

    function say(t) { msg.textContent = t; msg.hidden = !t; }

    function picked() { return form.querySelectorAll('input[name="url"]:checked'); }
    function sync() {
      var n = picked().length;
      // 다섯 장을 넘기지 못하게 **누르기 전에** 막는다. 누르고 나서 "안 됩니다" 는 늦다.
      var boxes = form.querySelectorAll('input[name="url"]');
      for (var i = 0; i < boxes.length; i++) boxes[i].disabled = !boxes[i].checked && n >= MAX;
      save.hidden = !n;
      save.textContent = n ? "고른 사진 " + n + "장 담기" : "고른 사진 담기";
      if (n >= MAX) say("최대 " + MAX + "장까지 담을 수 있습니다.");
    }

    function render(images) {
      list.textContent = "";
      images.forEach(function (im, i) {
        var li = document.createElement("li");
        var lab = document.createElement("label");
        lab.className = "pick-item";
        var cb = document.createElement("input");
        cb.type = "checkbox"; cb.name = "url"; cb.value = im.url;
        cb.addEventListener("change", sync);
        var img = document.createElement("img");
        img.src = im.thumb; img.loading = "lazy";
        // 무엇이 찍힌 사진인지 우리는 모른다. 읽어 주는 프로그램에는 출처만 정직하게 말한다.
        img.alt = (im.site ? im.site + " 에 실린 사진" : "검색된 사진") + " " + (i + 1);
        var cap = document.createElement("small");
        cap.textContent = im.site || "출처 미상";
        lab.appendChild(cb); lab.appendChild(img); lab.appendChild(cap);
        li.appendChild(lab);
        list.appendChild(li);
      });
      list.hidden = !images.length;
      sync();
    }

    function search() {
      var term = (q.value || "").trim();
      if (busy) return;
      if (term.length < 2) { say("가게 이름을 두 글자 이상 적어 주세요."); return; }
      busy = true; go.disabled = true; say("찾는 중…"); list.hidden = true; save.hidden = true;
      fetch(base + "/admin/image-search?q=" + encodeURIComponent(term), { credentials: "same-origin" })
        .then(function (r) { return r.json().catch(function () { return { error: "bad" }; }); })
        .then(function (d) {
          if (d && d.error) { say(d.message || "찾지 못했습니다."); return; }
          var images = (d && d.images) || [];
          if (!images.length) { say("그 이름으로는 사진을 찾지 못했습니다. 상호를 조금 더 정확히 적어 보세요."); return; }
          // 서버는 **같은 검색어로 다시 검색해서** 그 결과에 있는 주소만 받아 준다.
          // 그래서 화면이 보낸 검색어와 저장할 때의 검색어가 같아야 한다.
          if (sent) sent.value = term;
          say("담을 사진을 고르세요 (최대 " + MAX + "장). 다른 가게 사진이 섞여 있을 수 있습니다.");
          render(images);
        })
        .catch(function () { say("찾지 못했습니다. 잠시 후 다시 시도해 주세요."); })
        .then(function () { busy = false; go.disabled = false; });
    }

    go.addEventListener("click", search);
    q.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); search(); } });
    form.addEventListener("submit", function (e) {
      if (!picked().length) { e.preventDefault(); say("담을 사진을 하나 이상 골라 주세요."); }
    });
  }

  var forms = document.querySelectorAll("[data-photo-pick]");
  for (var i = 0; i < forms.length; i++) setup(forms[i]);
})();
