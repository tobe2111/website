// 전화번호를 치는 대로 010-1234-5678 모양으로 맞춰 준다.
//
// 왜 필요한가.
// 회장님·총무는 명단을 보고 번호를 그대로 옮겨 칩니다. 하이픈을 직접 넣는 분도 있고
// 숫자만 치는 분도 있어서, 저장된 명단이 `01012345678` 과 `010-1234-5678` 로 섞였습니다.
// 저장은 어차피 숫자만 하므로 데이터는 멀쩡한데, **화면에서 읽히지가 않습니다** —
// 열한 자리 숫자를 눈으로 끊어 읽어야 하고, 한 자리 빠진 것을 알아채지 못합니다.
//
// 그래서 치는 순간 끊어 줍니다. 사람이 규칙을 배우는 게 아니라 화면이 맞춥니다.
//
// 서버(db.js 의 formatPhone)와 **같은 규칙**이어야 합니다. 다르면 저장 전후로 모양이 바뀌어
// "내가 친 게 안 들어갔나" 싶어집니다.
(function () {
  "use strict";

  // 숫자만 뽑아 한국 번호 모양으로 끊는다.
  // 국제번호(+82…)는 손대지 않는다 — 우리가 아는 규칙이 아니다.
  function format(raw) {
    var d = String(raw || "").replace(/\D/g, "");
    if (!d) return "";

    // 서울(02)만 지역번호가 두 자리다
    if (d.slice(0, 2) === "02") {
      d = d.slice(0, 10);
      if (d.length <= 2) return d;
      if (d.length <= 5) return d.slice(0, 2) + "-" + d.slice(2);
      if (d.length <= 9) return d.slice(0, 2) + "-" + d.slice(2, 5) + "-" + d.slice(5);
      return d.slice(0, 2) + "-" + d.slice(2, 6) + "-" + d.slice(6);
    }
    // 대표번호(1588·1666·1899…) — 지역번호가 없고 4-4 로 끊는다
    if (/^1[5678]/.test(d)) {
      d = d.slice(0, 8);
      return d.length <= 4 ? d : d.slice(0, 4) + "-" + d.slice(4);
    }
    // 나머지는 세 자리 지역번호/휴대폰
    d = d.slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 7) return d.slice(0, 3) + "-" + d.slice(3);
    if (d.length <= 10) return d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6);
    return d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
  }

  // 글자를 가운데 고쳐도 커서가 튀지 않게 — 하이픈이 아니라 **숫자 몇 번째**를 기준으로 되돌린다.
  // (이걸 안 하면 번호 중간을 고칠 때마다 커서가 맨 끝으로 날아가 사실상 못 고칩니다)
  function caretByDigits(text, digits) {
    if (digits <= 0) return 0;
    var n = 0;
    for (var i = 0; i < text.length; i++) {
      if (/\d/.test(text[i]) && ++n === digits) return i + 1;
    }
    return text.length;
  }

  function apply(el) {
    if (el.value.indexOf("+") >= 0) return;          // 국제번호는 그대로 둔다
    var before = el.value, start = el.selectionStart;
    var typedDigits = before.slice(0, start == null ? before.length : start).replace(/\D/g, "").length;
    var next = format(before);
    if (next === before) return;
    el.value = next;
    if (start != null && el.setSelectionRange) {
      try { var c = caretByDigits(next, typedDigits); el.setSelectionRange(c, c); } catch (e) {}
    }
  }

  // ── 옆에 한 줄로 상태를 말해 주는 칸 (data-phone-help 가 붙은 칸만) ──
  // 처음 쓰는 분은 "몇 자리를 넣어야 하는지" 를 모릅니다. 다 치기 전에는 몇 개가 남았는지,
  // 다 치면 이 번호가 무엇에 쓰이는지 알려 줍니다. 틀렸다고 빨갛게 막지는 않습니다 —
  // 대신 무엇이 이상한지 말합니다.
  function help(el) {
    var box = document.getElementById(el.getAttribute("aria-describedby") || "");
    if (!box) return;
    var d = el.value.replace(/\D/g, "");
    var role = el.getAttribute("data-phone-help") || "";
    var msg = "", tone = "";
    if (!d) {
      msg = "숫자만 눌러도 자동으로 끊어집니다.";
    } else if (d.slice(0, 2) !== "01") {
      msg = "휴대폰 번호는 010 처럼 01 로 시작합니다.";
      tone = "warn";
    } else if (d.length < 10) {
      msg = "숫자 " + (10 - d.length) + "개 더 필요합니다.";
    } else {
      msg = role === "id"
        ? "이 번호가 사장님 로그인 아이디가 됩니다."
        : "카카오 알림톡이 이 번호로 갑니다.";
      tone = "ok";
    }
    box.textContent = msg;
    box.className = "field-help" + (tone ? " field-help-" + tone : "");
  }

  function wire(el) {
    if (el.dataset.phoneWired) return;
    el.dataset.phoneWired = "1";
    apply(el);                                        // 서버가 채워 준 값도 모양을 맞춘다
    el.addEventListener("input", function () { apply(el); help(el); });
    el.addEventListener("blur", function () { apply(el); help(el); });
    help(el);
  }

  function scan() {
    var els = document.querySelectorAll('input[type="tel"]');
    for (var i = 0; i < els.length; i++) wire(els[i]);
  }
  scan();
  // 접힌 칸을 펴거나 줄을 더 만들면 새 입력칸이 생긴다 — 그것들도 잡는다
  if (window.MutationObserver) {
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
