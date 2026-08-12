// 전역 스크립트: 모바일 내비게이션 + 헤더 스크롤 효과
(function () {
  "use strict";
  var header = document.getElementById("siteHeader");
  var toggle = document.getElementById("navToggle");
  var nav = document.getElementById("mainNav");

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

// 스크롤 리빌 — 섹션이 뷰포트에 들어오면 아래에서 떠오르며 페이드인 (고급 미세 모션)
// JS·IntersectionObserver 있을 때만 숨김 상태 적용(reveal-on) → JS 실패 시 FOUC 없음. 모션 최소화는 존중.
(function () {
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!("IntersectionObserver" in window)) return;
  var els = Array.prototype.slice.call(document.querySelectorAll("main > section"));
  if (els.length < 2) return; // 단일 섹션 페이지(로그인 등)는 생략
  document.documentElement.classList.add("reveal-on");
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  els.forEach(function (el, i) {
    if (i === 0) return; // 첫 섹션(히어로)은 즉시 노출
    el.classList.add("reveal");
    io.observe(el);
  });
  // 이미 화면에 보이는(스크롤 없이 보이는) 섹션 즉시 표시 (관찰 타이밍 사각 보정)
  setTimeout(function () {
    els.forEach(function (el) {
      if (!el.classList.contains("reveal")) return;
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.92) el.classList.add("in");
    });
  }, 60);
})();

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
