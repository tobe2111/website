// 대량 발송 — 명단 화면과 보내기 화면 두 곳에서 쓴다.
//
// 왜 브라우저가 반복해서 부르는가: 100건을 한 요청에 보낼 수 없다(워커의 시간·바깥 요청 한도).
// 서버는 부를 때마다 몇 명씩만 보내고 남은 수를 돌려준다. 여기서 0 이 될 때까지 다시 부른다.
// 창을 닫아도 서버에 '보냄' 으로 남으므로 같은 사람에게 두 번 가지 않는다.
(function () {
  "use strict";

  // ---- 1. 명단 화면: 명단의 사람이 앉는 자리는 우리 쪽 사람을 고르지 않는다 ----
  var slots = document.querySelectorAll('input[name="to_slot"]');
  if (slots.length) {
    var syncSlots = function () {
      var picked = document.querySelector('input[name="to_slot"]:checked');
      var n = picked ? picked.value : "";
      var sels = document.querySelectorAll("select[data-fixed]");
      for (var i = 0; i < sels.length; i++) {
        var mine = sels[i].getAttribute("data-fixed") === n;
        sels[i].disabled = mine;          // disabled 면 전송되지 않는다 — 서버도 이 자리를 무시한다
        sels[i].required = !mine;
        if (mine) sels[i].value = "";
      }
    };
    for (var s = 0; s < slots.length; s++) slots[s].addEventListener("change", syncSlots);
    syncSlots();
  }

  // ---- 2. 보내기 화면 ----
  var panel = document.getElementById("bulkRun");
  if (!panel) return;
  var go = document.getElementById("bulkGo");
  var msg = document.getElementById("bulkMsg");
  var count = document.getElementById("bulkCount");
  var bar = panel.querySelector(".bulk-bar i");
  var url = panel.getAttribute("data-run");
  var csrf = panel.getAttribute("data-csrf");
  if (!go) return;
  var running = false;

  function paint(d) {
    var done = (d.sent | 0) + (d.failed | 0);
    var total = d.total | 0;
    if (bar) bar.style.width = (total ? Math.round((done / total) * 100) : 0) + "%";
    if (count) count.innerHTML = "보냄 <b>" + (d.sent | 0) + "</b> · 실패 <b>" + (d.failed | 0) +
      "</b> · 남음 <b>" + (d.pending | 0) + "</b> / 전체 " + total;
  }

  function step() {
    var fd = new FormData();
    fd.append("_csrf", csrf);
    return fetch(url, { method: "POST", body: fd, credentials: "same-origin", headers: { accept: "application/json" } })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: "응답을 읽지 못했습니다." }; }); });
  }

  function loop() {
    step().then(function (d) {
      if (!d || !d.ok) {
        running = false;
        go.disabled = false;
        go.textContent = "다시 시도";
        msg.textContent = (d && d.error) || "보내지 못했습니다. 잠시 후 다시 눌러 주세요.";
        msg.className = "bulk-msg is-err";
        return;
      }
      paint(d);
      if (d.stopped) {
        running = false;
        go.disabled = false;
        go.textContent = "이어서 보내기";
        msg.textContent = d.stopped;
        msg.className = "bulk-msg is-err";
        return;
      }
      // ran 이 0 인데 남은 사람이 있으면 더 눌러도 진행되지 않는다 — 무한히 부르지 않는다.
      if (d.pending > 0 && d.ran > 0) { loop(); return; }
      running = false;
      go.disabled = d.pending === 0;
      go.textContent = d.pending ? "이어서 보내기" : "다 보냈습니다";
      msg.textContent = d.pending
        ? "남은 " + d.pending + "명은 보내지 못했습니다. 다시 눌러 주세요."
        : "다 보냈습니다. 아래에서 각 계약서를 열어 볼 수 있습니다." + (d.failed ? " 실패한 " + d.failed + "건은 비고를 확인해 주세요." : "");
      msg.className = "bulk-msg" + (d.pending ? " is-err" : " is-ok");
      // 상태 칸은 서버가 아는 것이 정확하다 — 다 끝나면 화면을 새로 읽는다.
      if (!d.pending) setTimeout(function () { location.reload(); }, 900);
    });
  }

  go.addEventListener("click", function (e) {
    e.preventDefault();
    if (running) return;
    running = true;
    go.disabled = true;
    go.textContent = "보내는 중…";
    msg.textContent = "보내는 중입니다. 이 창을 닫지 마세요.";
    msg.className = "bulk-msg";
    loop();
  });

  // 보내는 중에 창을 닫으려 하면 한 번 물어본다 — 닫아도 안전하지만, 모르고 닫는 것과는 다르다.
  window.addEventListener("beforeunload", function (e) {
    if (!running) return;
    e.preventDefault();
    e.returnValue = "";
  });
})();
