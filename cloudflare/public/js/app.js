// 전역 스크립트: 모바일 내비게이션 + 헤더 스크롤 효과
(function () {
  "use strict";
  var header = document.getElementById("siteHeader");
  var toggle = document.getElementById("navToggle");
  var nav = document.getElementById("mainNav");
  // 하단 탭의 '전체메뉴' 는 새 메뉴를 만들지 않고 상단 햄버거를 연다 — 메뉴가 둘이면 서로 어긋난다
  var bm = document.querySelector("[data-bnav-menu]");
  if (bm && toggle) bm.addEventListener("click", function () { toggle.click(); window.scrollTo({ top: 0, behavior: "smooth" }); });

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  if (header) {
    var onScroll = function () {
      header.classList.toggle("scrolled", (window.scrollY || 0) > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // data-confirm: CSP 안전한 확인 다이얼로그 (인라인 onsubmit/onclick 대체)
  document.addEventListener("submit", function (e) {
    var el = e.target.closest && e.target.closest("form[data-confirm]");
    if (el && !window.confirm(el.getAttribute("data-confirm"))) e.preventDefault();
  });
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("button[data-confirm]");
    if (btn && !window.confirm(btn.getAttribute("data-confirm"))) { e.preventDefault(); e.stopPropagation(); }
    var pr = e.target.closest && e.target.closest("[data-print]");
    if (pr) { e.preventDefault(); window.print(); }
    var sel = e.target.closest && e.target.closest("[data-select-all]");
    if (sel && sel.select) sel.select();
  });
  // CSP 가 인라인 onchange 를 막으므로 위임으로 처리 (회비 장부 월 선택 등)
  document.addEventListener("change", function (e) {
    var el = e.target.closest && e.target.closest("[data-autosubmit]");
    if (el && el.form) { if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit(); }
  });

  // 중복 제출 방지 — 제출된 폼의 버튼을 잠가 느린 네트워크에서 두 번 눌리는 것을 막는다
  // (data-confirm 리스너보다 나중에 등록 → 취소된 제출(e.defaultPrevented)은 건너뜀)
  function unlockForm(f) {
    delete f.dataset.busy;
    f.querySelectorAll(".is-busy").forEach(function (b) { b.disabled = false; b.classList.remove("is-busy"); });
  }
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (!f || e.defaultPrevented) return;
    if (f.dataset.busy) { e.preventDefault(); return; }
    f.dataset.busy = "1";
    // 버튼 값 직렬화가 끝난 뒤 잠그도록 다음 틱에 disabled 처리
    setTimeout(function () {
      f.querySelectorAll('button[type="submit"],button:not([type]),input[type="submit"]').forEach(function (b) { b.disabled = true; b.classList.add("is-busy"); });
    }, 0);
    setTimeout(function () { unlockForm(f); }, 10000); // 응답이 오래 없으면 잠금 해제(안전망)
  });
  // 뒤로가기(bfcache)로 돌아왔을 때 잠금 해제
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) document.querySelectorAll("form[data-busy]").forEach(unlockForm);
  });
})();

// PWA: 서비스 워커 등록 (실패해도 무해)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
}

// 닫으면 다시 안 뜨는 배너 (localStorage 기억)
(function () {
  "use strict";
  var els = document.querySelectorAll("[data-dismiss-key]");
  Array.prototype.forEach.call(els, function (el) {
    var key = "dis-" + el.getAttribute("data-dismiss-key");
    try { if (localStorage.getItem(key)) return; } catch (e) {}
    el.hidden = false;
    var btn = el.querySelector("[data-dismiss]");
    if (btn) btn.addEventListener("click", function () {
      try { localStorage.setItem(key, "1"); } catch (e) {}
      el.hidden = true;
    });
  });
})();

// 폰트 CSS 비차단 활성화 (media=print 로 내려받은 뒤 전체 적용 — CDN 지연이 첫 화면을 막지 않음)
(function () {
  var f = document.getElementById("fontCss");
  if (!f) return;
  function apply() { f.media = "all"; }
  if (f.sheet) apply(); else f.addEventListener("load", apply);
  setTimeout(apply, 3000); // 로드 이벤트 유실 대비
})();

// 스크롤 리빌(섹션이 아래에서 떠오르며 페이드인)은 걷어냈다.
// 절마다 0.8초씩 떠오르는 연출은 '기계가 만든 랜딩페이지' 의 표시이기도 하지만,
// 그보다 손님이 보려는 것을 0.8초씩 늦춘다. 가게를 찾으러 온 사람에게는 방해다.
// 내용은 스크롤하는 순간 이미 거기 있어야 한다.

// 전화 클릭 집계 — 모바일 랜딩에서 통화 버튼은 상담 폼만큼 큰 전환 경로인데,
// 링크를 눌러 앱이 뜨는 순간 페이지가 사라져 보통 집계에서 빠진다.
// sendBeacon 은 페이지가 사라져도 전송을 보장하고, 실패해도 전화 연결에는 영향이 없다.
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-track-tel]");
  if (!a || !navigator.sendBeacon) return;
  try {
    const d = document.body.dataset;
    if (!d.csrf) return;                       // 집계는 못 해도 전화는 걸려야 한다
    const fd = new FormData();
    fd.append("_csrf", d.csrf);
    const v = new URLSearchParams(location.search).get("v")
      || (location.pathname.match(/\/l\/([^/?#]+)/) || [])[1] || "";
    navigator.sendBeacon(`${d.base || ""}/track/call${v ? `?v=${encodeURIComponent(v)}` : ""}`, fd);
  } catch { /* 집계 실패가 전화를 막아서는 안 된다 */ }
}, { capture: true });

// 상담 폼 임시 보관.
//
// 검증에 걸리면(동의 미체크·연락처 오타·봇 방지 실패) 서버가 redirect 로 돌려보내는데,
// 그때 채워 둔 값이 전부 사라진다. 문의 내용을 길게 쓴 사람일수록 손해가 크고,
// 그런 사람이 가장 진지한 신청자다. 다시 치게 만들면 그냥 나간다.
//
// 값은 브라우저 밖으로 내보내지 않는다. URL 로 되돌리면 이름·전화번호가 서버 로그와
// 브라우저 기록에 남는다 — 개인정보를 주소창에 실어 나르는 셈이라 하면 안 된다.
(() => {
  const form = document.querySelector("form[data-draft]");
  if (!form || !window.sessionStorage) return;
  const KEY = "draft:" + form.getAttribute("action");
  // 동의 체크는 복원하지 않는다. 본인이 직접 체크해야 동의다.
  // 봇 방지 토큰·허니팟·CSRF 도 값이 아니라 장치라 건드리지 않는다.
  const skip = new Set(["_csrf", "cf-turnstile-response", "website", "agree", "agree_marketing"]);
  const fields = () => [...form.elements].filter((el) => el.name && !skip.has(el.name) && el.type !== "checkbox" && el.type !== "hidden");

  const params = new URLSearchParams(location.search);
  if (params.get("msg") && !params.get("err")) {
    sessionStorage.removeItem(KEY);                 // 접수됐으면 남겨 둘 이유가 없다
  } else if (params.get("err")) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) || "{}");
      let restored = 0;
      for (const el of fields()) if (saved[el.name] != null && !el.value) { el.value = saved[el.name]; restored++; }
      if (restored) {
        const first = form.querySelector('[name="agree"]') || form;
        first.focus?.({ preventScroll: true });
      }
    } catch { /* 복원 실패가 신청을 막아서는 안 된다 */ }
  }

  form.addEventListener("submit", () => {
    try {
      const out = {};
      for (const el of fields()) if (el.value) out[el.name] = el.value;
      sessionStorage.setItem(KEY, JSON.stringify(out));
    } catch { /* 저장 실패는 조용히 넘긴다 */ }
  });
})();

// 올리기 전에 사진을 줄인다.
//
// 관리자는 폰으로 찍은 사진을 그대로 고른다 — 4000px, 3~5MB. 그게 히어로 배경이 되면
// 광고로 들어온 사람 전부가 그 무게를 지고 첫 화면을 기다린다(실측: 411KB 사진 하나로
// LCP 1.12초 → 2.57초). 서버에는 이미지 라이브러리가 없고 Workers 무료 티어에 넣을 수도 없다.
// 브라우저는 이미 캔버스를 갖고 있으니 여기서 줄여 보낸다.
//
// 줄이기가 실패하면 원본을 그대로 보낸다 — 사진을 못 올리는 것보다 무거운 사진이 낫다.
(function () {
  var MAX_EDGE = 1600, QUALITY = 0.82, SKIP_UNDER = 300 * 1024;
  if (!window.DataTransfer || !window.createImageBitmap) return;

  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return null;   // GIF 는 움직임이 죽는다
    var bmp;
    // 폰 사진은 EXIF 로 회전 정보를 담는다. 그대로 그리면 옆으로 누운 사진이 된다.
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { return null; }
    var edge = Math.max(bmp.width, bmp.height);
    if (file.size < SKIP_UNDER && edge <= MAX_EDGE) { bmp.close && bmp.close(); return null; }
    var scale = Math.min(1, MAX_EDGE / edge);
    var c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    var g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    var blob = await new Promise(function (r) { c.toBlob(r, "image/jpeg", QUALITY); });
    if (!blob || blob.size >= file.size) return null;               // 되레 커지면 의미 없다
    var name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  }

  document.addEventListener("change", async function (e) {
    var input = e.target;
    if (!input.matches || !input.matches('input[type="file"][accept*="image"]')) return;
    if (input.dataset.noShrink != null || input.dataset.shrinking != null || !input.files || !input.files.length) return;
    input.dataset.shrinking = "1";
    var before = 0, after = 0, list = new DataTransfer(), changed = false;
    for (var i = 0; i < input.files.length; i++) {
      var f = input.files[i];
      before += f.size;
      var small = null;
      try { small = await shrink(f); } catch { small = null; }
      if (small) changed = true;
      list.items.add(small || f);
      after += (small || f).size;
    }
    if (changed) {
      input.files = list.files;
      var kb = function (n) { return n < 1024 * 1024 ? Math.round(n / 1024) + "KB" : (n / 1024 / 1024).toFixed(1) + "MB"; };
      var tip = input.parentNode && input.parentNode.querySelector(".shrink-tip");
      if (!tip && input.parentNode) {
        tip = document.createElement("small");
        tip.className = "shrink-tip";
        input.parentNode.appendChild(tip);
      }
      if (tip) tip.textContent = "사진을 " + kb(before) + " → " + kb(after) + " 로 줄여서 올립니다 (화면에서는 차이가 보이지 않습니다)";
    }
    delete input.dataset.shrinking;
  }, false);
})();

// 저장하면 저장됐다고 말해 준다 — 화면이 길면 맨 위 안내문은 눈에 안 들어온다.
// 성공 안내는 떠오르는 알림으로 바꿔 보여 주고(3.5초 뒤 사라짐),
// 오류는 그 자리에 남겨 둔다(읽고 고쳐야 하는 내용이라 사라지면 안 된다).
(function () {
  // ⚠️ 저장 결과일 때만 손댄다.
  //    예전에는 화면의 첫 .flash 를 무조건 집어 들었는데, 안내문을 .flash 로 그려 둔 패널이
  //    여럿 있다(운영사 콘솔의 알림톡 키 안내 등). 그 안내가 제자리에서 뜯겨 나와
  //    화면 한가운데에 검은 상자로 떠 있었고, 성공 알림이 아니라 사라지지도 않았다.
  //    저장·삭제의 결과는 언제나 ?msg= 로 돌아오므로, 그것만 알림으로 바꾼다.
  var q;
  try { q = new URL(location.href).searchParams; } catch (e) { return; }
  if (!q.has("msg")) return;
  var box = document.querySelector("main .flash");
  if (!box) return;
  var msg = (box.textContent || "").trim();
  if (!msg) return;
  var isErr = box.classList.contains("flash-err");

  if (isErr) { box.scrollIntoView({ block: "center", behavior: "smooth" }); return; }

  box.remove();
  var t = document.createElement("div");
  t.className = "toast-save";
  t.setAttribute("role", "status");
  t.setAttribute("aria-live", "polite");
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(function () { t.classList.add("on"); });
  setTimeout(function () {
    t.classList.remove("on");
    setTimeout(function () { t.remove(); }, 320);
  }, 3500);
  // 주소창에 남은 ?msg= 를 지운다 — 새로고침할 때마다 같은 알림이 다시 뜨면 거짓말이 된다
  try {
    var u = new URL(location.href);
    if (u.searchParams.has("msg")) {
      u.searchParams.delete("msg"); u.searchParams.delete("err");
      history.replaceState(null, "", u.pathname + (u.search ? u.search : "") + u.hash);
    }
  } catch (e) {}
})();

// 채우다 만 폼을 두고 나가려 하면 한 번 물어본다.
// 사장님이 가게 소개를 길게 쓰다 뒤로 가기를 눌러 통째로 날리는 일이 실제로 생긴다.
// 저장을 누른 경우는 묻지 않는다(그게 나가는 정상 경로다).
// 브라우저의 비밀번호 자동 채움도 input 이벤트를 낸다 — 운영사 콘솔의 '새 조직' 폼에
// 이메일·비밀번호 칸이 있어, 화면을 열자마자 '고치던 중'으로 잡혀 고객사를 누를 때마다
// 경고가 떴다. 사람이 손댄 칸은 그 순간 포커스를 갖고 있으니, 그 경우에만 더럽혀진 것으로 본다.
(function () {
  var dirty = false, saving = false;
  var forms = document.querySelectorAll("form.stack-form, form.upload-form");
  if (!forms.length) return;
  Array.prototype.forEach.call(forms, function (f) {
    f.addEventListener("input", function (e) { if (e.target === document.activeElement) dirty = true; });
    f.addEventListener("submit", function () { saving = true; });
  });
  window.addEventListener("beforeunload", function (e) {
    if (!dirty || saving) return;
    e.preventDefault();
    e.returnValue = ""; // 문구는 브라우저가 정한다 — 우리가 넣어도 무시된다
  });
})();
