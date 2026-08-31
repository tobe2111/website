// 계약서 작성기 — 규칙을 버튼이 대신 써 준다.
//
// 계약서에는 규칙이 있다(조·항·호·목적물 표시·말미 문구). 그 규칙을 아는 사람만
// 제대로 된 계약서를 쓸 수 있었고, 모르는 사람은 줄글을 넣고 줄글을 받았다.
//
// 저장되는 건 여전히 평문이다. 자유 편집기(굵게·표·글꼴)를 넣지 않은 이유가 이것이다 —
// 지면 줄바꿈이 흔들리면 그 위에 놓은 서명 자리가 어긋난다.
(function () {
  "use strict";
  var ta = document.getElementById("wtBody");
  if (!ta) return;
  var title = document.getElementById("wtTitle");
  var preview = document.getElementById("wtPreview");
  var pagesLabel = document.getElementById("wtPages");
  var count = document.getElementById("wtCount");
  var saveBtn = document.getElementById("wtSave");
  var savedLabel = document.getElementById("wtSaved");
  var sendForm = document.getElementById("wtSendForm");
  var base = location.pathname.replace(/\/admin\/documents\/write.*$/, "");
  var docId = Number(new URLSearchParams(location.search).get("doc") || 0);
  var csrf = (document.querySelector('input[name="_csrf"]') || {}).value || "";

  // ---------- 넣기 ----------
  var CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

  function lineStart(pos) { var i = ta.value.lastIndexOf("\n", pos - 1); return i + 1; }
  function lineEnd(pos) { var i = ta.value.indexOf("\n", pos); return i < 0 ? ta.value.length : i; }
  function before(pos) { return ta.value.slice(0, pos); }

  // 앞에 나온 마지막 '제N조' 다음 번호
  function nextArticle(pos) {
    var m = before(pos).match(/제\s*(\d+)\s*조/g);
    if (!m || !m.length) return 1;
    return (parseInt(m[m.length - 1].replace(/\D/g, ""), 10) || 0) + 1;
  }
  // 지금 조문 안에서 마지막 항 다음 번호 (조가 바뀌면 다시 ①)
  function nextClause(pos) {
    var txt = before(pos);
    var lastArt = txt.lastIndexOf("제");
    var seg = txt;
    var am = txt.match(/제\s*\d+\s*조/g);
    if (am && am.length) seg = txt.slice(txt.lastIndexOf(am[am.length - 1]));
    var used = 0;
    for (var i = 0; i < CIRCLED.length; i++) if (seg.indexOf(CIRCLED[i]) >= 0) used = i + 1;
    return Math.min(used, CIRCLED.length - 1);   // 0-based 다음 자리
  }
  function nextItem(pos) {
    var txt = before(pos);
    var seg = txt;
    var cm = txt.match(/[①-⑳]/g);
    if (cm && cm.length) seg = txt.slice(txt.lastIndexOf(cm[cm.length - 1]));
    var nm = seg.match(/^\s*(\d+)\./gm);
    return nm && nm.length ? (parseInt(nm[nm.length - 1], 10) || 0) + 1 : 1;
  }

  // 넣을 글과, 넣은 뒤 커서가 잡아 줄 자리(고쳐 쓸 낱말).
  function pieceFor(kind, pos) {
    if (kind === "article") return { text: "제" + nextArticle(pos) + "조 (제목)\n", pick: "제목", block: true };
    if (kind === "clause") return { text: "  " + CIRCLED[nextClause(pos)] + " ", line: true };
    if (kind === "item") return { text: "  " + nextItem(pos) + ". ", line: true };
    if (kind === "label") return { text: "  이름표   값\n", pick: "이름표", line: true };
    if (kind === "closing") return { text: "본 계약을 증명하기 위하여 당사자는 아래에 전자서명한다.\n", block: true };
    return { text: "\n" };
  }

  function insert(kind) {
    // 단추는 **글을 지우지 않는다**. 방금 넣은 자리표시어(제목 등)가 잡혀 있을 때
    // 다른 단추를 누르면 그것을 덮어써서 "제1조 (" 만 남는 일이 생겼다.
    // 잡힌 것이 있으면 그 끝으로 비켜서 넣는다 — 지우는 건 사람이 타이핑할 때만.
    //
    // 그리고 조·항·호·표·말미는 모두 **제 줄에서 시작하는 것들**이다. 커서가 줄 한가운데
    // 있을 때(제목을 고쳐 쓴 직후엔 닫는 괄호 앞에 선다) 그 자리에 끼워 넣으면
    // "제1조 (업무의 범위" 로 잘리고 ")" 만 저 아래로 밀린다. 그래서 줄 끝으로 비킨다.
    var pos = lineEnd(Math.max(ta.selectionStart, ta.selectionEnd));
    var v = ta.value;
    var pc = pieceFor(kind, pos);
    var lead = "";
    if (pc.block) {
      // 조문과 말미 문구는 앞에 빈 줄을 하나 둔다 — 조판이 구역을 그 빈 줄로 가른다.
      // 이미 빈 줄이면 더 넣지 않는다(눌러 댈수록 사이가 벌어지면 안 된다).
      if (pos > 0) {
        var tail = v.slice(0, pos);
        if (!/\n\s*\n$/.test(tail)) lead = /\n$/.test(tail) ? "\n" : "\n\n";
      }
    } else if (pc.line) {
      // 항·호·표 줄은 반드시 줄 맨 앞에서 시작해야 조판이 알아본다
      if (pos !== lineStart(pos)) lead = "\n";
    }
    var txt = lead + pc.text;
    ta.setRangeText(txt, pos, pos, "end");
    // 고쳐 쓸 낱말이 있으면 그걸 잡아 준다 — 바로 타이핑하면 덮어써진다
    if (pc.pick) {
      var at = pos + txt.indexOf(pc.pick);
      if (at >= pos) ta.setSelectionRange(at, at + pc.pick.length);
    }
    ta.focus();
    changed();
  }
  document.querySelectorAll(".wt-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      if (b.dataset.ins === "blank") askBlank();
      else insert(b.dataset.ins);
    });
  });

  // ---------- 빈칸 ----------
  // 빈칸은 문장 한가운데 들어간다 — "보증금은 금 {{보증금}} 원으로 한다."
  // 그래서 이름을 **먼저** 묻는다. 본문에 자리표시어를 넣고 고쳐 쓰게 하면 이어서 친 글자가
  // 괄호 안쪽으로 들어가 "{{보증금 원으로 한다.}}" 같은 이름의 빈칸이 생긴다.
  var askBox = document.getElementById("wtBlankAsk");
  var askName = document.getElementById("wtBlankName");
  var blankAt = 0;
  function askBlank() {
    if (!askBox) return;
    blankAt = ta.selectionStart;
    askBox.hidden = false;
    askName.value = "";
    askName.focus();
  }
  function closeAsk() { if (askBox) askBox.hidden = true; ta.focus(); }
  function addBlank() {
    var name = (askName.value || "").replace(/[{}\n\r|]/g, "").trim();
    if (!name) { askName.focus(); return; }
    var txt = "{{" + name + "}}";
    ta.setRangeText(txt, blankAt, blankAt, "end");   // 커서는 닫는 괄호 **뒤**에 선다
    askBox.hidden = true;
    ta.focus();
    changed();
  }
  if (askBox) {
    document.getElementById("wtBlankAdd").addEventListener("click", addBlank);
    document.getElementById("wtBlankCancel").addEventListener("click", closeAsk);
    askName.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addBlank(); }
      else if (e.key === "Escape") { e.preventDefault(); closeAsk(); }
    });
  }

  // ---------- 당사자 고르기 ----------
  // '외부 상대방' 을 고른 자리에만 이름·연락처 칸을 편다. 늘 펴 두면 회원을 고른 자리에도
  // 빈 칸이 네 개씩 붙어 화면이 무슨 양식인지 알아볼 수 없다.
  document.querySelectorAll("[data-party]").forEach(function (sel) {
    var ext = document.querySelector('[data-ext="' + sel.dataset.party + '"]');
    if (!ext) return;
    var boxes = ext.querySelectorAll("input");
    function sync() {
      var on = sel.value === "ext";
      ext.hidden = !on;
      // 숨긴 칸에 required 가 남아 있으면 브라우저가 "보이지 않는 칸이 비었다" 며 제출을 막는다
      boxes.forEach(function (b) { if (b.name.indexOf("ext_name_") === 0) b.required = on; });
    }
    sel.addEventListener("change", sync); sync();
  });

  // ---------- 미리보기 ----------
  // 지면 줄바꿈은 서버가 확정한다. 화면에서 따로 그리면 미리보기와 실제 계약서가
  // 다른 자리에서 끊긴다 — 그러면 미리보기가 오히려 사람을 속인다.
  var timer = null, lastSent = null, inflight = false;
  function draw() {
    var body = ta.value;
    if (body === lastSent || inflight) return;
    inflight = true; lastSent = body;
    var fd = new FormData();
    fd.set("_csrf", csrf); fd.set("body", body);
    fetch(base + "/admin/documents/preview", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error(String(r.status))); })
      .then(function (h) {
        preview.innerHTML = h;
        var n = preview.querySelectorAll(".paper").length;
        if (pagesLabel) pagesLabel.textContent = n ? n + "쪽" : "";
        fitPaper();
      })
      .catch(function () { if (pagesLabel) pagesLabel.textContent = "미리보기를 못 그렸습니다"; })
      .finally(function () { inflight = false; if (ta.value !== lastSent) draw(); });
  }
  // 지면은 794px 로 그려져 있다 — 오른쪽 칸 폭에 맞춰 통째로 줄인다(paper.js 와 같은 방식).
  function fitPaper() {
    var stack = preview.querySelector(".paper-stack");
    if (!stack) return;
    var pw = +stack.dataset.pw || 794, ph = +stack.dataset.ph || 1123;
    var s = Math.min(1, preview.clientWidth / pw);
    stack.style.setProperty("--ps", s);
    stack.style.height = (stack.querySelectorAll(".paper").length * (ph + 24) * s) + "px";
  }
  window.addEventListener("resize", fitPaper);

  // byUser=false 는 화면을 처음 그릴 때다. 이때 dirty 를 세우면 안 된다 —
  // 작성기를 열어 두고 자리를 뜨는 것만으로 빈 초안이 생긴다.
  function changed(byUser) {
    if (count) {
      var lines = ta.value ? ta.value.split("\n").length : 0;
      count.textContent = ta.value.length.toLocaleString() + "자 · " + lines + "줄";
    }
    clearTimeout(timer);
    timer = setTimeout(draw, 400);
    if (byUser === false) return;
    dirty = true;
    // 타이핑이 멎으면 곧 저장한다. 예전에는 30초 간격이라 브라우저가 죽으면 최대 30초어치가
    // 날아갔다 — 한 조(條)를 쓰는 시간이다.
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { if (dirty) save(true); }, 3000);
  }
  ta.addEventListener("input", changed);
  changed(false);   // 처음 그릴 때는 글자 수만 세고, 저장 대상으로 잡지 않는다

  // ---------- 임시저장 ----------
  var dirty = false, savedId = docId, saveTimer = null, saving = false;
  function say(msg, kind) {
    if (!savedLabel) return;
    savedLabel.textContent = msg;
    savedLabel.className = "wt-saved" + (kind ? " is-" + kind : "");
  }
  function save(auto) {
    if (!dirty && auto) return Promise.resolve();
    // 저장이 아직 돌고 있는데 또 보내면, 첫 저장이 끝나기 전이라 doc 번호가 없어
    // **초안이 두 개** 만들어진다. 끝난 뒤에 이어서 한 번 더 한다.
    if (saving) { clearTimeout(saveTimer); saveTimer = setTimeout(function () { if (dirty) save(true); }, 400); return Promise.resolve(); }
    saving = true;
    var fd = new FormData();
    fd.set("_csrf", csrf);
    fd.set("title", (title && title.value) || "");
    fd.set("body", ta.value);
    if (savedId) fd.set("doc", String(savedId));
    say("저장 중…");
    return fetch(base + "/admin/documents/draft", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { say(j.error || "저장하지 못했습니다", "err"); return; }
        dirty = false;
        var first = !savedId;
        savedId = j.id;
        say("저장됨 " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }), "ok");
        // 처음 저장한 순간부터 보낼 수 있다 — 주소도 이어 쓰기용으로 바꿔 둔다
        if (first) {
          history.replaceState(null, "", base + "/admin/documents/write?doc=" + j.id);
          if (sendForm) sendForm.action = base + "/admin/documents/" + j.id + "/publish";
          var send = document.getElementById("wtSend");
          if (send) send.disabled = false;
          // 서명 자리 놓기 — 저장 전에는 놓을 문서가 없어 숨겨 두었다
          var fl = document.getElementById("wtFields");
          if (fl) { fl.href = base + "/admin/documents/" + j.id + "/fields"; fl.hidden = false; }
        }
      })
      .catch(function () { say("저장하지 못했습니다 — 연결을 확인해 주세요", "err"); })
      .finally(function () { saving = false; });
  }
  if (saveBtn) saveBtn.addEventListener("click", function () { save(false); });
  // 제목만 고치고 본문은 안 건드리는 경우도 있다
  if (title) title.addEventListener("input", changed);
  // 화면을 벗어나거나(탭 전환·앱 전환) 오래 놔둘 때도 한 번 붙잡아 둔다.
  // 휴대폰은 탭을 떠나는 순간 그대로 잠들 수 있어, 이때 저장하지 않으면 그대로 사라진다.
  document.addEventListener("visibilitychange", function () { if (document.hidden && dirty) save(true); });
  window.addEventListener("pagehide", function () { if (dirty) save(true); });
  // 보내기 전에는 반드시 지금 화면의 내용이 저장돼 있어야 한다 —
  // 안 그러면 방금 고친 문장이 빠진 채로 계약이 나간다.
  if (sendForm) {
    sendForm.addEventListener("submit", function (e) {
      if (!dirty || e.submitter && e.submitter.formNoValidate) return;
      e.preventDefault();
      save(false).then(function () { sendForm.submit(); });
    });
  }
  window.addEventListener("beforeunload", function (e) {
    if (!dirty) return;
    e.preventDefault(); e.returnValue = "";
  });
})();
