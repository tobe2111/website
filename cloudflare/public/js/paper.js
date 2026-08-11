// 계약서 지면 — 필드 배치(관리자)와 필드 채우기(서명자)를 한 파일에서 처리.
// 외부 라이브러리 없음. 좌표는 지면 대비 0~1 비율로만 다루므로 화면·인쇄 배율과 무관하다.
(function () {
  "use strict";
  var stack = document.querySelector(".paper-stack");
  if (!stack) return;
  var MODE = stack.dataset.mode || "view";
  var PW = +stack.dataset.pw || 794, PH = +stack.dataset.ph || 1123;

  // ---------- 반응형 배율 ----------
  // 지면은 항상 794×1123px 로 그리고, 화면 폭에 맞춰 통째로 축소한다.
  // (내부를 리플로우하지 않으므로 좌표가 절대 흔들리지 않는다)
  function fit() {
    var host = stack.parentElement;
    var avail = host ? host.clientWidth : PW;
    var s = Math.min(1, avail / PW);
    stack.style.setProperty("--ps", s);
    stack.style.height = (stack.querySelectorAll(".paper").length * (PH + 24) * s) + "px";
  }
  fit();
  window.addEventListener("resize", fit);

  var round4 = function (v) { return Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000; };
  var pageOf = function (el) { return el.closest(".paper"); };

  // ================= 배치 모드 (관리자) =================
  if (MODE === "edit") {
    var KINDS = JSON.parse(document.getElementById("fieldKinds").textContent);
    var out = document.getElementById("fieldsData");
    var form = document.getElementById("fieldsForm");
    var picked = "sign";
    var sel = null;

    document.querySelectorAll(".fp-item").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".fp-item").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        picked = b.dataset.kind;
      });
    });

    function select(el) {
      if (sel) sel.classList.remove("pf-sel");
      sel = el;
      var bar = document.getElementById("fieldProps");
      if (!el) { bar.hidden = true; return; }
      el.classList.add("pf-sel");
      bar.hidden = false;
      document.getElementById("fpKind").textContent = KINDS[el.dataset.kind].label;
      document.getElementById("fpLabel").value = el.dataset.label || "";
      document.getElementById("fpAssignee").value = el.dataset.assignee || "0";
      document.getElementById("fpReq").checked = el.dataset.req === "1";
    }
    document.getElementById("fpLabel").addEventListener("input", function () {
      if (!sel) return;
      sel.dataset.label = this.value;
      sel.querySelector(".pf-tag").textContent = KINDS[sel.dataset.kind].icon + " " + (this.value || KINDS[sel.dataset.kind].label);
    });
    document.getElementById("fpAssignee").addEventListener("change", function () {
      if (!sel) return;
      sel.dataset.assignee = this.value;
      var who = sel.querySelector(".pf-who");
      var name = this.options[this.selectedIndex].dataset.name || "";
      if (who) who.textContent = name;
    });
    document.getElementById("fpReq").addEventListener("change", function () {
      if (sel) sel.dataset.req = this.checked ? "1" : "0";
    });
    document.getElementById("fpDel").addEventListener("click", function () {
      if (!sel) return;
      sel.remove(); select(null);
    });

    function makeField(kind, page, x, y) {
      var k = KINDS[kind];
      var el = document.createElement("div");
      el.className = "pf pf-" + kind + " pf-empty pf-edit";
      el.dataset.kind = kind; el.dataset.req = "1"; el.dataset.assignee = "0"; el.dataset.label = "";
      el.style.left = (round4(x) * 100) + "%";
      el.style.top = (round4(y) * 100) + "%";
      el.style.width = (k.w * 100) + "%";
      el.style.height = (k.h * 100) + "%";
      el.innerHTML = '<span class="pf-tag">' + k.icon + " " + k.label + '</span><span class="pf-who"></span><i class="pf-grip"></i>';
      page.querySelector(".paper-layer").appendChild(el);
      return el;
    }

    // 지면 클릭 → 선택한 종류의 필드를 그 자리에 놓는다 (클릭 지점이 필드의 중심)
    stack.addEventListener("click", function (e) {
      if (e.target.closest(".pf")) return;
      var page = e.target.closest(".paper");
      if (!page) return;
      var r = page.getBoundingClientRect();
      var k = KINDS[picked];
      var x = (e.clientX - r.left) / r.width - k.w / 2;
      var y = (e.clientY - r.top) / r.height - k.h / 2;
      select(makeField(picked, page, x, y));
    });

    // 드래그 이동 + 우하단 그립으로 크기 조절
    var drag = null;
    stack.addEventListener("pointerdown", function (e) {
      var el = e.target.closest(".pf");
      if (!el) return;
      e.preventDefault();
      select(el);
      var page = pageOf(el), r = page.getBoundingClientRect();
      drag = {
        el: el, r: r, resize: !!e.target.closest(".pf-grip"),
        ox: (e.clientX - r.left) / r.width - parseFloat(el.style.left) / 100,
        oy: (e.clientY - r.top) / r.height - parseFloat(el.style.top) / 100,
      };
      el.setPointerCapture(e.pointerId);
    });
    stack.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var px = (e.clientX - drag.r.left) / drag.r.width, py = (e.clientY - drag.r.top) / drag.r.height;
      if (drag.resize) {
        var w = Math.max(0.02, px - parseFloat(drag.el.style.left) / 100);
        var h = Math.max(0.012, py - parseFloat(drag.el.style.top) / 100);
        drag.el.style.width = (round4(w) * 100) + "%";
        drag.el.style.height = (round4(h) * 100) + "%";
      } else {
        drag.el.style.left = (round4(px - drag.ox) * 100) + "%";
        drag.el.style.top = (round4(py - drag.oy) * 100) + "%";
      }
    });
    stack.addEventListener("pointerup", function () { drag = null; });
    stack.addEventListener("pointercancel", function () { drag = null; });

    // 저장 — 모든 필드를 JSON 한 덩어리로
    form.addEventListener("submit", function () {
      var list = [];
      stack.querySelectorAll(".paper").forEach(function (p) {
        var pg = +p.dataset.page;
        p.querySelectorAll(".pf").forEach(function (el) {
          list.push({
            kind: el.dataset.kind, label: el.dataset.label || "", page: pg,
            x: round4(parseFloat(el.style.left) / 100), y: round4(parseFloat(el.style.top) / 100),
            w: round4(parseFloat(el.style.width) / 100), h: round4(parseFloat(el.style.height) / 100),
            assignee: +el.dataset.assignee || 0, required: el.dataset.req === "1" ? 1 : 0,
          });
        });
      });
      out.value = JSON.stringify(list);
    });
    return;
  }

  // ================= 채우기 모드 (서명자) =================
  if (MODE !== "fill") return;
  var valuesOut = document.getElementById("fieldValues");
  var signerName = (document.getElementById("signerName") || {}).value || "";
  var values = {}; // fieldId -> { value } | { image: dataURL }

  var dlg = document.getElementById("fieldDialog");
  var dlgBody = document.getElementById("fdBody");
  var dlgTitle = document.getElementById("fdTitle");
  var current = null;

  function openDialog(el) {
    current = el;
    var kind = el.dataset.kind;
    dlgTitle.textContent = (el.querySelector(".pf-tag") ? el.querySelector(".pf-tag").textContent.trim() : "입력");
    dlgBody.innerHTML = "";
    if (kind === "sign") drawPad(dlgBody, 560, 200);
    else if (kind === "stamp") stampMaker(dlgBody);
    else if (kind === "check") { setValue(el, { value: "1" }); close(); return; }
    else {
      var input = document.createElement("input");
      input.type = kind === "date" ? "date" : "text";
      input.className = "fd-input";
      input.maxLength = 100;
      if (kind === "name") input.value = signerName;
      if (kind === "date") input.value = new Date().toISOString().slice(0, 10);
      dlgBody.appendChild(input);
      dlgBody._get = function () { return input.value.trim() ? { value: input.value.trim() } : null; };
      setTimeout(function () { input.focus(); }, 30);
    }
    dlg.hidden = false;
  }
  function close() { dlg.hidden = true; current = null; }
  document.getElementById("fdCancel").addEventListener("click", close);
  document.getElementById("fdOk").addEventListener("click", function () {
    if (!current) return;
    var v = dlgBody._get ? dlgBody._get() : null;
    if (!v) { alert("입력해 주세요."); return; }
    setValue(current, v);
    close();
  });

  function setValue(el, v) {
    values[el.dataset.id] = v;
    el.classList.remove("pf-empty");
    el.classList.add("pf-filled");
    if (v.image) el.innerHTML = '<img src="' + v.image + '" alt="" />';
    else if (el.dataset.kind === "check") el.innerHTML = '<span class="pf-check">✔</span>';
    else el.innerHTML = '<span class="pf-val">' + v.value.replace(/[<&]/g, function (c) { return c === "<" ? "&lt;" : "&amp;"; }) + "</span>";
    progress();
  }
  // 체크는 다시 누르면 해제
  function clearValue(el) {
    delete values[el.dataset.id];
    el.classList.add("pf-empty"); el.classList.remove("pf-filled");
    el.innerHTML = '<span class="pf-tag">' + (el.dataset.tag || "입력") + "</span>";
    progress();
  }

  stack.querySelectorAll(".pf-mine").forEach(function (el) {
    var t = el.querySelector(".pf-tag");
    el.dataset.tag = t ? t.textContent.trim() : "입력";
    el.addEventListener("click", function () {
      if (el.dataset.kind === "check" && values[el.dataset.id]) return clearValue(el);
      openDialog(el);
    });
  });

  // 남은 필드 안내 + 다음 필드로 스크롤
  var counter = document.getElementById("fieldProgress");
  var jump = document.getElementById("fieldJump");
  function pending() {
    return Array.prototype.filter.call(stack.querySelectorAll('.pf-mine[data-req="1"]'), function (el) { return !values[el.dataset.id]; });
  }
  function progress() {
    var need = stack.querySelectorAll('.pf-mine[data-req="1"]').length;
    var left = pending().length;
    if (counter) counter.textContent = left ? "남은 필수 항목 " + left + "개 / " + need + "개" : "필수 항목을 모두 채웠습니다 ✓";
    if (counter) counter.className = left ? "field-progress" : "field-progress done";
    if (jump) jump.hidden = left === 0;
    var submit = document.getElementById("signSubmit");
    if (submit) submit.disabled = left > 0;
  }
  if (jump) jump.addEventListener("click", function () {
    var p = pending()[0];
    if (p) { p.scrollIntoView({ block: "center", behavior: "smooth" }); p.classList.add("pf-blink"); setTimeout(function () { p.classList.remove("pf-blink"); }, 1200); }
  });
  progress();

  var form = document.getElementById("signForm");
  if (form) form.addEventListener("submit", function (e) {
    if (pending().length) { e.preventDefault(); alert("필수 항목을 모두 채워 주세요."); return; }
    valuesOut.value = JSON.stringify(values);
    // 서명 필드가 있으면 그 그림을 대표 서명 이미지로 쓴다
    var sigEl = stack.querySelector('.pf-mine[data-kind="sign"]');
    var hidden = document.getElementById("signatureData");
    if (sigEl && hidden && values[sigEl.dataset.id] && values[sigEl.dataset.id].image) hidden.value = values[sigEl.dataset.id].image;
  });

  // ---------- 서명 그리기 패드 ----------
  function drawPad(host, w, h) {
    var tabs = document.createElement("div");
    tabs.className = "fd-tabs";
    tabs.innerHTML = '<button type="button" class="fd-tab on" data-t="draw">직접 그리기</button><button type="button" class="fd-tab" data-t="type">이름으로 만들기</button>';
    host.appendChild(tabs);
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h; cv.className = "fd-pad";
    host.appendChild(cv);
    var typeWrap = document.createElement("div");
    typeWrap.className = "fd-type"; typeWrap.hidden = true;
    typeWrap.innerHTML = '<input type="text" class="fd-input" maxlength="20" placeholder="성명" value="' + signerName.replace(/"/g, "&quot;") + '" />' +
      '<div class="fd-fonts"><button type="button" class="fd-font on" data-f="\'Nanum Pen Script\', cursive">필기체</button>' +
      '<button type="button" class="fd-font" data-f="serif">명조</button><button type="button" class="fd-font" data-f="sans-serif">고딕</button></div>';
    host.appendChild(typeWrap);
    var clear = document.createElement("button");
    clear.type = "button"; clear.className = "btn btn-ghost btn-xs"; clear.textContent = "지우기";
    host.appendChild(clear);

    var ctx = cv.getContext("2d");
    var drawn = false, font = "'Nanum Pen Script', cursive", mode = "draw";
    ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111";
    var last = null;
    function pos(e) { var r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) }; }
    cv.addEventListener("pointerdown", function (e) { if (mode !== "draw") return; e.preventDefault(); cv.setPointerCapture(e.pointerId); last = pos(e); drawn = true; });
    cv.addEventListener("pointermove", function (e) {
      if (mode !== "draw" || !last) return;
      var p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p;
    });
    cv.addEventListener("pointerup", function () { last = null; });
    cv.addEventListener("pointercancel", function () { last = null; });
    clear.addEventListener("click", function () { ctx.clearRect(0, 0, cv.width, cv.height); drawn = false; if (mode === "type") renderTyped(); });

    function renderTyped() {
      var name = typeWrap.querySelector("input").value.trim();
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (!name) { drawn = false; return; }
      ctx.fillStyle = "#111";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var size = Math.min(96, Math.floor(cv.width / Math.max(2, name.length) * 1.4));
      ctx.font = size + "px " + font;
      ctx.fillText(name, cv.width / 2, cv.height / 2);
      drawn = true;
    }
    tabs.addEventListener("click", function (e) {
      var b = e.target.closest(".fd-tab"); if (!b) return;
      tabs.querySelectorAll(".fd-tab").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      mode = b.dataset.t;
      typeWrap.hidden = mode !== "type";
      ctx.clearRect(0, 0, cv.width, cv.height); drawn = false;
      if (mode === "type") renderTyped();
    });
    typeWrap.addEventListener("input", renderTyped);
    typeWrap.addEventListener("click", function (e) {
      var b = e.target.closest(".fd-font"); if (!b) return;
      typeWrap.querySelectorAll(".fd-font").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on"); font = b.dataset.f; renderTyped();
    });
    host._get = function () { return drawn ? { image: cv.toDataURL("image/png") } : null; };
  }

  // ---------- 도장 만들기 ----------
  // 한국식 원형 인장을 캔버스로 생성한다(붉은 테두리 + 이름). 파일 업로드도 지원.
  function stampMaker(host) {
    var wrap = document.createElement("div");
    wrap.className = "fd-stamp";
    wrap.innerHTML = '<input type="text" class="fd-input" maxlength="6" placeholder="성명 또는 상호" value="' + signerName.replace(/"/g, "&quot;") + '" />' +
      '<div class="fd-shapes"><button type="button" class="fd-shape on" data-s="circle">원형</button><button type="button" class="fd-shape" data-s="square">사각</button></div>' +
      '<label class="fd-upload">보유한 도장 이미지 올리기<input type="file" accept="image/png,image/jpeg" /></label>';
    host.appendChild(wrap);
    var cv = document.createElement("canvas");
    cv.width = 280; cv.height = 280; cv.className = "fd-stamp-pad";
    host.appendChild(cv);
    var ctx = cv.getContext("2d"), shape = "circle", uploaded = null;
    var RED = "#c0272d";

    function draw() {
      var name = wrap.querySelector("input[type=text]").value.trim();
      ctx.clearRect(0, 0, 280, 280);
      if (uploaded) { ctx.drawImage(uploaded, 0, 0, 280, 280); return; }
      if (!name) return;
      ctx.strokeStyle = RED; ctx.fillStyle = RED;
      ctx.lineWidth = 12;
      if (shape === "circle") { ctx.beginPath(); ctx.arc(140, 140, 128, 0, Math.PI * 2); ctx.stroke(); }
      else { ctx.strokeRect(12, 12, 256, 256); }
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      // 2자=가로, 3자=세로, 4자=2×2 — 전통 인장 배치를 따른다
      var chars = Array.from(name).slice(0, 4);
      var f = "'Nanum Myeongjo', serif";
      if (chars.length <= 2) {
        ctx.font = "bold 108px " + f;
        chars.forEach(function (c, i) { ctx.fillText(c, chars.length === 1 ? 140 : (i ? 196 : 84), 140); });
      } else if (chars.length === 3) {
        ctx.font = "bold 76px " + f;
        chars.forEach(function (c, i) { ctx.fillText(c, 140, 66 + i * 74); });
      } else {
        ctx.font = "bold 84px " + f;
        chars.forEach(function (c, i) { ctx.fillText(c, i % 2 ? 190 : 90, i < 2 ? 92 : 190); });
      }
    }
    wrap.addEventListener("input", function (e) {
      if (e.target.type === "file") {
        var f = e.target.files[0];
        if (!f || f.size > 2 * 1024 * 1024) { alert("2MB 이하 이미지를 올려 주세요."); return; }
        var img = new Image();
        img.onload = function () { uploaded = img; draw(); };
        img.src = URL.createObjectURL(f);
        return;
      }
      uploaded = null; draw();
    });
    wrap.addEventListener("click", function (e) {
      var b = e.target.closest(".fd-shape"); if (!b) return;
      wrap.querySelectorAll(".fd-shape").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on"); shape = b.dataset.s; uploaded = null; draw();
    });
    draw();
    host._get = function () {
      var name = wrap.querySelector("input[type=text]").value.trim();
      return (name || uploaded) ? { image: cv.toDataURL("image/png") } : null;
    };
  }
})();
