// 이용료 결제 — 토스페이먼츠 카드 등록창을 연다.
// 단추의 data- 값(클라이언트 키·고객 번호·돌아올 주소)은 서버가 채운다. 카드번호는 토스 창에만 들어가고
// 이 페이지는 한 글자도 보지 못한다. 등록이 끝나면 토스가 success 주소로 authKey 를 붙여 돌려보낸다.
(function () {
  var btns = document.querySelectorAll("[data-toss-billing]");
  if (!btns.length) return;
  Array.prototype.forEach.call(btns, function (b) {
    b.addEventListener("click", function () {
      var need = b.getAttribute("data-need-agree");
      if (need) {
        var box = document.getElementById(need);
        if (box && !box.checked) { alert("자동결제 안내를 확인하고 동의에 표시해 주세요."); box.focus(); return; }
      }
      if (typeof window.TossPayments !== "function") {
        alert("결제 창을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요. (광고 차단 프로그램이 막고 있을 수 있습니다)");
        return;
      }
      var origin = location.origin;
      var opts = {
        method: "CARD",
        successUrl: origin + b.getAttribute("data-success"),
        failUrl: origin + b.getAttribute("data-fail"),
      };
      var email = b.getAttribute("data-email"), name = b.getAttribute("data-name");
      if (email) opts.customerEmail = email;
      if (name) opts.customerName = name;
      b.disabled = true;
      try {
        var payment = window.TossPayments(b.getAttribute("data-ck")).payment({ customerKey: b.getAttribute("data-customer") });
        Promise.resolve(payment.requestBillingAuth(opts)).catch(function (e) {
          b.disabled = false;
          if (e && (e.code === "USER_CANCEL" || e.code === "PAY_PROCESS_CANCELED")) return;
          alert((e && e.message) || "카드 등록 창을 열지 못했습니다.");
        });
      } catch (e) {
        b.disabled = false;
        alert((e && e.message) || "카드 등록 창을 열지 못했습니다.");
      }
    });
  });
})();
