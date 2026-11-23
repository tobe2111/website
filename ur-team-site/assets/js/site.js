// 유어팀 홈페이지 — 움직임 · 메뉴 · 상담 신청. 라이브러리 없이 동작한다.
(() => {
  const d = document, root = d.documentElement;
  root.classList.add("js");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // 화면 문구는 페이지 언어를 따른다 (한국어가 기본)
  const EN = root.lang === "en";
  const L = EN ? {
    menuOpen: "Open menu", menuClose: "Close menu",
    needName: "Please enter your company and name.", needPhone: "Please enter your phone number.",
    needAgree: "Please agree to the collection and use of personal information.",
    off: "Online submissions are not open yet. Please reach us by KakaoTalk or phone.", sending: "Sending…",
    done: "Thank you. We received your request and will contact you within one business day.", fail: "Sending failed. Please try again, or reach us by KakaoTalk or phone.", submit: "Send",
    fileBig: "The file is larger than {n}MB. Please paste a share link instead, or send it by KakaoTalk or email.",
  } : {
    menuOpen: "메뉴 열기", menuClose: "메뉴 닫기",
    needName: "업체명 · 담당자를 적어 주세요.", needPhone: "연락처를 적어 주세요.",
    needAgree: "개인정보 수집 · 이용에 동의해 주세요.",
    off: "지금은 온라인 접수 준비 중입니다. 카카오톡이나 전화로 문의해 주세요.", sending: "보내는 중…",
    done: "상담 신청이 접수되었습니다. 영업일 기준 1일 안에 연락드리겠습니다.", fail: "보내지 못했습니다. 다시 한 번 눌러 주시거나 카카오톡 · 전화로 문의해 주세요.", submit: "상담 신청하기",
    fileBig: "첨부 파일이 {n}MB 를 넘습니다. 공유 링크를 붙여 주시거나 카카오톡 · 이메일로 보내 주세요.",
  };

  // ── 머리말: 어두운 첫 화면 위에서는 투명, 지나가면 흰 바탕. 빨리 내리면 숨고 올리면 나타난다
  const hd = d.querySelector("[data-hd]");
  const float = d.querySelector(".float");
  if (float) {
    const up = d.createElement("button");
    up.type = "button"; up.className = "totop";
    up.setAttribute("aria-label", EN ? "Back to top" : "맨 위로");
    up.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    up.addEventListener("click", () => scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
    float.prepend(up);
  }
  const darkTop = d.querySelector(".hero, .phero--media");
  if (darkTop && hd) {
    new IntersectionObserver(([en]) => hd.classList.toggle("is-over", en.isIntersecting && !d.body.classList.contains("menu-open")),
      { rootMargin: `-${hd.offsetHeight}px 0px 0px 0px`, threshold: 0.02 }).observe(darkTop);
  }
  let lastY = 0, ticking = false;
  addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY;
      if (!d.body.classList.contains("menu-open")) hd?.classList.toggle("is-hidden", y > 500 && y > lastY + 4);
      if (y < lastY - 4) hd?.classList.remove("is-hidden");
      float?.classList.toggle("is-off", y < 300);
      lastY = y; ticking = false;
    });
  }, { passive: true });
  float?.classList.add("is-off");

  // ── 모바일 메뉴
  const burger = d.querySelector("[data-burger]");
  const mnav = d.getElementById("mnav");
  const setMenu = (open) => {
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? L.menuClose : L.menuOpen);
    mnav.hidden = !open;
    d.body.classList.toggle("menu-open", open);
    hd.classList.toggle("is-over", false);
    if (open) [...mnav.children].forEach((a, i) => a.style.setProperty("--i", i));
  };
  burger?.addEventListener("click", () => setMenu(burger.getAttribute("aria-expanded") !== "true"));
  mnav?.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !mnav?.hidden) { setMenu(false); burger.focus(); } });

  // ── 첫 화면 글자가 한 줄씩 올라온다
  const hero = d.querySelector(".hero");
  if (hero) {
    hero.querySelectorAll(".ln > span").forEach((s, i) => s.style.setProperty("--i", i));
    requestAnimationFrame(() => requestAnimationFrame(() => hero.classList.add("is-ready")));
  }

  // ── 분류 버튼: 마케팅 상품은 고른 분류만 또렷하게, 블로그는 고른 주제만 남긴다
  d.querySelectorAll(".pfilter").forEach((bar) => {
    const list = bar.parentElement.querySelector("[data-prods]");
    if (!list) return;
    const hide = list.hasAttribute("data-hide");
    const cards = [...list.querySelectorAll("[data-cat]")];
    // 블로그 목록: 주제 + 검색어에 맞는 글을 12편씩 보여 준다
    const step = +list.dataset.page || 0;
    const box = bar.parentElement;
    const q = box.querySelector("[data-psearch]"), more = box.querySelector("[data-pmore]"), count = box.querySelector("[data-pcount]"), empty = box.querySelector("[data-pempty]");
    let f = "all", shown = step;
    const text = new Map();
    const apply = () => {
      const words = q ? q.value.trim().toLowerCase().split(/\s+/).filter(Boolean) : [];
      let n = 0;
      cards.forEach((p) => {
        let ok = f === "all" || p.dataset.cat === f;
        if (ok && words.length) {
          if (!text.has(p)) text.set(p, p.textContent.toLowerCase());
          ok = words.every((w) => text.get(p).includes(w));
        }
        if (ok) n++;
        const off = !ok || (step && n > shown);
        if (hide) p.hidden = off; else p.classList.toggle("is-dim", off);
      });
      if (more) { more.parentElement.hidden = n <= shown; more.textContent = more.dataset.label + " (" + Math.min(shown, n) + " / " + n + ")"; }
      if (count) count.textContent = words.length ? n + (list.dataset.unit || "") : "";
      if (empty) empty.hidden = n > 0;
    };
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-f]");
      if (!b) return;
      bar.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      f = b.dataset.f; shown = step;
      apply();
      // 고른 주제를 주소에 남겨, 그 주제만 보이는 화면을 공유 · 즐겨찾기할 수 있게
      if (hide) try { history.replaceState(null, "", f === "all" ? location.pathname : "#" + encodeURIComponent(f)); } catch (_) {}
    });
    if (q) q.addEventListener("input", () => { shown = step; apply(); });
    if (more) more.addEventListener("click", () => { shown += step; apply(); });
    // 주소에 주제가 적혀 들어왔으면 그 주제를 눌러 둔다
    let pre = null;
    if (hide && location.hash.length > 1) {
      let want = ""; try { want = decodeURIComponent(location.hash.slice(1)); } catch (_) {}
      pre = [...bar.querySelectorAll("button[data-f]")].find((x) => x.dataset.f === want);
    }
    if (pre) pre.click(); else if (step) apply();
  });

  // ── 블로그 글: 공유하기 · 주소 복사
  d.querySelectorAll("[data-share]").forEach((b) => {
    if (!navigator.share) { b.hidden = true; return; }
    b.addEventListener("click", () => { navigator.share({ title: d.title, url: location.href }).catch(() => {}); });
  });
  d.querySelectorAll("[data-copy]").forEach((b) => {
    const label = b.textContent;
    b.addEventListener("click", () => {
      const done = () => { b.textContent = b.dataset.done; setTimeout(() => { b.textContent = label; }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(done).catch(() => {});
    });
  });

  // ── 옆으로 밀리는 표: 키보드로도 좌우로 움직일 수 있게 (넘칠 때만)
  d.querySelectorAll(".tbl-wrap, .bro__table, .prose table").forEach((t) => {
    if (t.scrollWidth > t.clientWidth + 1) { t.tabIndex = 0; if (!t.hasAttribute("aria-label")) t.setAttribute("aria-label", d.documentElement.lang === "en" ? "Table, scroll sideways" : "표, 좌우로 밀어서 보기"); }
  });

  // ── 오른쪽 마우스(우클릭) 메뉴와 사진 끌어다 저장하기를 막는다
  // 글자 입력 칸에서는 붙여넣기 등을 위해 그대로 둔다
  const editable = (t) => t && t.closest && t.closest("input, textarea, [contenteditable]");
  d.addEventListener("contextmenu", (e) => { if (!editable(e.target)) e.preventDefault(); });
  d.addEventListener("dragstart", (e) => { if (e.target && e.target.tagName === "IMG") e.preventDefault(); });

  // ── 블로그 조회수: 시작 숫자(data-base) + 날마다 늘어나는 수 + 글을 연 횟수
  const vEls = [...d.querySelectorAll("[data-views]")];
  if (vEls.length && location.protocol.startsWith("http")) {
    const word = EN ? "Views" : "조회";
    // 시작 숫자 + 기준일부터 지난 날수 × 하루 증가분 + 실제로 센 조회수(저장 공간을 연결했을 때만)
    const grown = (el) => (+el.dataset.base || 0) + Math.max(0, Math.floor((Date.now() - (+el.dataset.t0 || Date.now())) / 864e5)) * (+el.dataset.rate || 0);
    const show = (m) => vEls.forEach((el) => { el.textContent = word + " " + (grown(el) + (m[el.dataset.views] || 0)).toLocaleString("en-US"); });
    // 글을 열 때마다 +1. 저장 공간(VIEWS)이 연결돼 있으면 모두가 함께 보는 숫자에 더해지고,
    // 연결 전에는 이 브라우저에 적어 두어 다시 열 때 늘어난 숫자가 보이게 한다
    const local = (k) => { try { return +localStorage.getItem("ut_vl_" + k) || 0; } catch { return 0; } };
    const me = d.querySelector("[data-views-hit]");
    let hit = Promise.resolve({});
    if (me) {
      const k = me.dataset.views;
      try { localStorage.setItem("ut_vl_" + k, String(local(k) + 1)); } catch { /* 적지 못해도 화면은 뜬다 */ }
      hit = fetch("/api/views?s=" + encodeURIComponent(k), { method: "POST" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    }
    const withLocal = (m) => { vEls.forEach((el) => { const k = el.dataset.views; if (!m[k]) m[k] = local(k); }); return m; };
    show(withLocal({}));
    // 뒤로 가기로 목록에 돌아오면 브라우저가 저장해 둔 옛 화면을 그대로 꺼내므로, 그때 다시 계산한다
    let last = {};
    addEventListener("pageshow", (e) => { if (e.persisted) show(withLocal({ ...last })); });
    Promise.all([fetch("/api/views").then((r) => (r.ok ? r.json() : {})).catch(() => ({})), hit]).then(([all, mine]) => {
      for (const [k, n] of Object.entries(mine)) all[k] = Math.max(all[k] || 0, n);
      last = all;
      show(withLocal({ ...all }));
    });
  }

  // ── 흐르는 로고 줄: 내용을 한 번 더 붙여 끊김 없이 돈다
  d.querySelectorAll(".marquee__track").forEach((t) => {
    t.append(...[...t.children].map((c) => { const k = c.cloneNode(true); k.setAttribute("aria-hidden", "true"); return k; }));
  });

  // ── 숫자가 0부터 올라간다: <b data-count="43">43</b>
  const countUp = (el) => {
    const end = parseFloat(el.dataset.count);
    const dec = (el.dataset.count.split(".")[1] || "").length;
    const fmt = (v) => v.toLocaleString("ko-KR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    if (reduce) { el.textContent = fmt(end); return; }
    const t0 = performance.now(), dur = 1600, run = (el._run = (el._run || 0) + 1);
    const tick = (t) => {
      if (run !== el._run) return; // 다시 들어와 새로 시작했으면 이전 것은 멈춘다
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      el.textContent = fmt(end * e);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  // ── 화면에 들어오면 나타나기
  const groups = d.querySelectorAll("[data-stagger]");
  groups.forEach((g) => [...g.children].forEach((c, i) => { if (!c.hasAttribute("data-reveal")) c.setAttribute("data-reveal", g.dataset.stagger || ""); c.style.setProperty("--i", Math.min(i, 8)); }));
  d.querySelectorAll(".bubbles").forEach((g) => [...g.children].forEach((c, i) => c.style.setProperty("--i", i)));
  // 화면 밖으로 완전히 나가면 처음 상태로 되돌려, 다시 스크롤해 오면 또 움직인다
  // (움직임 줄이기 설정이면 한 번 보여 준 뒤 그대로 둔다)
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const el = en.target;
      const counts = el.matches("[data-count]") ? [el] : [...el.querySelectorAll("[data-count]")];
      if (en.isIntersecting) {
        if (el.classList.contains("is-in")) continue;
        el.classList.add("is-in");
        counts.forEach(countUp);
        if (reduce) io.unobserve(el);
      } else if (el.classList.contains("is-in")) {
        el.classList.remove("is-in");
        counts.forEach((c) => { c._run = (c._run || 0) + 1; });
      }
    }
  }, { rootMargin: "0px 0px 20% 0px", threshold: 0 });
  d.querySelectorAll("[data-reveal], [data-wipe], .bubbles, .steps, .bars, .funnel, .flow, .principle, .slogan, [data-count]").forEach((el) => io.observe(el));

  // ── 첫 화면 영상: 움직임 줄이기 설정이면 멈춘다
  d.querySelectorAll("video[autoplay]").forEach((v) => { if (reduce) v.pause(); });

  // ── 상담 신청: 담당자 메일(FormSubmit) 또는 엔진의 상담 DB(/lead-in/<조직>)로 보낸다
  d.querySelectorAll("form[data-lead]").forEach((f) => {
    const out = f.querySelector("[data-msg]");
    const say = (text, ok) => { if (!out) return; out.textContent = text; out.className = "msg " + (ok ? "ok" : "err"); out.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" }); };
    const q = new URLSearchParams(location.search);
    // ?topic=병원 마케팅 처럼 들어오면 관심 분야를 미리 체크해 둔다 (어느 페이지에서 왔는지)
    const topic = q.get("topic");
    if (topic) { const want = topic.split(","); f.querySelectorAll('[data-msg-part][type="checkbox"]').forEach((el) => { if (want.includes(el.value)) el.checked = true; }); }
    // 블로그 글의 상담 버튼으로 들어오면 어떤 글을 읽고 왔는지 상담 내용에 함께 남긴다
    const from = q.get("from"), fromEl = f.querySelector("[data-from]");
    if (from && fromEl) fromEl.value = from.slice(0, 120);
    // '더 자세히' 안에서는 고른 분야에 맞는 질문만 보인다 (아무것도 안 골랐으면 둘 다)
    const interest = [...f.querySelectorAll('fieldset:not([data-for]) input[type="checkbox"]')];
    const DIST = ["국내 유통", "해외 수출", "Domestic Distribution", "Global Export"];
    const syncMore = () => {
      const on = interest.filter((el) => el.checked).map((el) => el.value);
      const dist = on.some((v) => DIST.includes(v)), mk = on.some((v) => !DIST.includes(v));
      const none = !on.length;
      f.querySelectorAll('fieldset[data-for="dist"]').forEach((x) => { x.hidden = !(none || dist); });
      f.querySelectorAll('fieldset[data-for="mk"]').forEach((x) => { x.hidden = !(none || mk); });
    };
    interest.forEach((el) => el.addEventListener("change", syncMore));
    syncMore();
    if (q.get("sent")) say(q.get("sent"), true);
    if (q.get("err")) say(q.get("err"), false);
    // 어디서 왔는지(광고 링크의 utm, 들어오기 전 페이지) — 어떤 광고가 상담을 만들었는지 보려고
    for (const k of ["utm_source", "utm_medium", "utm_campaign"]) {
      const v = q.get(k) || sessionStorageGet(k);
      if (v) { sessionStorageSet(k, v); const el = f.querySelector(`[name="${k}"]`); if (el) el.value = v; }
    }
    const ref = f.querySelector('[name="referrer"]');
    if (ref && d.referrer && !d.referrer.startsWith(location.origin)) ref.value = d.referrer.slice(0, 200);
    f.addEventListener("submit", (e) => {
      const need = [["name", L.needName], ["phone", L.needPhone]];
      for (const [n, m] of need) {
        const el = f.querySelector(`[name="${n}"]`);
        if (el && !el.value.trim()) { e.preventDefault(); say(m, false); el.focus(); return; }
      }
      const agree = f.querySelector('[name="agree"]');
      if (agree && !agree.checked) { e.preventDefault(); say(L.needAgree, false); agree.focus(); return; }
      // 첨부 파일(견적 문의): 메일 전달 서비스가 받는 크기를 넘으면 보내기 전에 알린다
      const fileEl = f.querySelector('input[type="file"]'), picked = fileEl && fileEl.files && fileEl.files[0];
      const maxMb = Number(fileEl?.dataset.maxMb) || 5;
      if (picked && picked.size > maxMb * 1024 * 1024) { e.preventDefault(); say(L.fileBig.replace("{n}", maxMb), false); fileEl.focus(); return; }
      // 여러 칸(관심 분야 · URL · 문제점 · 강점 · 희망 채널)을 상담 내용 한 칸으로 묶는다
      const groups = new Map();
      f.querySelectorAll("[data-msg-part]").forEach((el) => {
        if ((el.type === "checkbox" || el.type === "radio") && !el.checked) return;
        const v = (el.value || "").trim();
        if (!v) return;
        const k = el.dataset.msgPart;
        groups.set(k, [...(groups.get(k) || []), v]);
      });
      const msg = f.querySelector('[name="message"]');
      if (msg) msg.value = [...groups].map(([k, v]) => `[${k}] ${v.join(", ")}`).join("\n").slice(0, 2000);
      if (f.getAttribute("action") === "#") {
        e.preventDefault();
        say(L.off, false);
        return;
      }
      const btn = f.querySelector('button[type="submit"]');
      const label = btn?.textContent;
      if (btn) { btn.disabled = true; btn.textContent = L.sending; }
      // 메일로 받을 때(FormSubmit): 페이지를 떠나지 않고 보내고, 여기서 접수 완료를 알린다
      if (/^https:\/\/formsubmit\.co\/ajax\//.test(f.action)) {
        const v = (n) => (f.querySelector(`[name="${n}"]`)?.value || "").trim();
        if (v("website")) { e.preventDefault(); f.reset(); say(L.done, true); return; } // 사람 눈에 안 보이는 칸이 채워졌으면 스팸 로봇
        // 파일이 붙었으면 JSON 으로는 못 보낸다 — 같은 서비스의 일반 접수 주소로 폼째 보내고(파일 포함), 끝나면 이 페이지로 돌아와 접수 완료를 알린다
        if (picked) {
          const hid = (n, val) => { let el = f.querySelector(`input[type="hidden"][name="${n}"]`); if (!el) { el = d.createElement("input"); el.type = "hidden"; el.name = n; f.appendChild(el); } el.value = val; };
          const topic = (f.querySelector('input[type="hidden"][data-msg-part]')?.value || "").trim();
          hid("_subject", `[유어팀 상담] ${topic ? topic + " · " : ""}${v("name")} (파일 첨부)`);
          hid("_template", "box"); hid("_captcha", "false");
          hid("_next", location.origin + location.pathname + "?sent=" + encodeURIComponent(L.done));
          if (v("email")) hid("_replyto", v("email"));
          f.querySelectorAll("input:not([type=file]), textarea").forEach((el) => { if (el.name && !el.value) el.disabled = true; }); // 빈 칸은 메일에 안 나오게
          f.action = f.action.replace("/ajax/", "/");
          f.enctype = "multipart/form-data";
          return; // 브라우저가 폼을 그대로 보낸다
        }
        e.preventDefault();
        const utm = ["utm_source", "utm_medium", "utm_campaign"].map(v).filter(Boolean).join(" / ");
        // 메일은 대표님이 읽기 쉽게: 한국어 항목 이름, 빈 칸은 빼고, 중요한 것부터
        const KO = { "Areas of interest": "관심 분야", "Inquiry": "문의 내용", "Company URL": "회사 URL", "Marketing services": "마케팅 상품",
          "Preferred channels": "희망 채널", "Current challenges": "업체 문제점", "Strengths": "업체 차별점" };
        const part = new Map([...groups].map(([k, list]) => [KO[k] || k, list.join(", ")]));
        const interest = part.get("관심 분야") || "";
        const rows = [
          ["업체명 · 담당자", v("name")], ["연락처", v("phone")], ["이메일", v("email")],
          ["관심 분야", interest], ["문의 내용", part.get("문의 내용")],
          ["월 광고 예산", v("budget")], ["회사 URL", part.get("회사 URL")], ["마케팅 상품", part.get("마케팅 상품")],
          ["희망 채널", part.get("희망 채널")], ["업체 문제점", part.get("업체 문제점")], ["업체 차별점", part.get("업체 차별점")],
          ["읽고 온 글", part.get("읽고 온 글")], ["알게 된 경로", v("funnel")],
        ];
        const where = [location.pathname + (EN ? " (영어 페이지)" : ""), utm && "광고: " + utm, v("referrer") && "이전: " + v("referrer")].filter(Boolean).join(" · ");
        const data = { _subject: `[유어팀 상담] ${interest ? interest + " · " : ""}${v("name")}${EN ? " (영어)" : ""}`, _template: "box", _captcha: "false" };
        for (const [k, val] of rows) if (val) data[k] = val;
        // 위 표에 없는 칸(견적 문의의 수량 · 크기 · 파일 링크 등)도 빠짐없이 싣는다
        for (const [k, val] of part) if (val && !(k in data)) data[k] = val;
        data["접수 경로"] = where;
        if (v("email")) data._replyto = v("email");
        fetch(f.action, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data) })
          .then((r) => r.json().catch(() => ({})).then((j) => { if (!r.ok || String(j.success) !== "true") throw new Error(j.message || r.status); }))
          .then(() => { f.reset(); say(L.done, true); })
          .catch(() => say(L.fail, false))
          .finally(() => { if (btn) { btn.disabled = false; btn.textContent = label || L.submit; } });
      }
    });
  });
  // ── 3D프린팅: 3D 모델 뷰어 (WebGL2, 라이브러리 없음). 화면에 들어올 때 모델을 받아 오고, 끌면 돌아간다
  d.querySelectorAll("[data-p3-viewer]").forEach((box) => {
    const cv = box.querySelector("canvas"), sec = box.closest("section") || d;
    const tabs = [...sec.querySelectorAll("[data-p3-model]")];
    const gl = cv.getContext("webgl2", { antialias: true, alpha: true });
    const solo = box.dataset.p3Src || "", zoom = Number(box.dataset.p3Zoom) || 1;
    if (!gl || (!tabs.length && !solo)) { box.classList.add("is-off"); return; }
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
      in vec3 aP; in float aL; uniform vec3 uMin, uSc, uC; uniform float uInv, uYaw, uPitch, uAsp; out vec3 vP; out float vL;
      void main() { vec3 p = (aP * uSc + uMin - uC) * uInv; float c = cos(uYaw), s = sin(uYaw); p = vec3(c * p.x + s * p.z, p.y, c * p.z - s * p.x);
        c = cos(uPitch); s = sin(uPitch); p = vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); p.z -= 3.4; vP = p; vL = aL;
        float f = 2.6; gl_Position = vec4(p.x * f / max(uAsp, 1.0), p.y * f * min(uAsp, 1.0), (p.z * 10.5 + 10.0) / -9.5, -p.z); }`));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; in vec3 vP; in float vL; out vec4 o;
      void main() { vec3 n = normalize(cross(dFdx(vP), dFdy(vP))); if (n.z < 0.0) n = -n;
        float k = .34 + .62 * max(dot(n, normalize(vec3(.35, .65, .68))), 0.0) + .16 * max(dot(n, normalize(vec3(-.7, .1, .5))), 0.0);
        vec3 base = vL > 4.5 && vL < 5.5 ? vec3(.13, .14, .16) : (vL > 3.5 ? vec3(.62, .64, .68) : vec3(.93, .89, .80));
        o = vec4(base * k, 1.0); }`));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { box.classList.add("is-off"); return; }
    gl.useProgram(prog); gl.enable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 0);
    const U = (n) => gl.getUniformLocation(prog, n), aP = gl.getAttribLocation(prog, "aP"), aL = gl.getAttribLocation(prog, "aL");
    const cache = new Map();
    let cur = null, yaw = 1.05, pitch = 0.12, drag = null, seen = false, idle = 0, raf = 0, want = "";
    const load = (url) => {
      if (cache.has(url)) return Promise.resolve(cache.get(url));
      return fetch(url).then((r) => { if (!r.ok) throw 0; return r.arrayBuffer(); }).then((buf) => {
        const h = new DataView(buf), n = h.getUint32(0, true), m = h.getUint32(4, true), f = (i) => h.getFloat32(8 + i * 4, true);
        const mn = [f(0), f(1), f(2)], sc = [f(3), f(4), f(5)], ext = sc.map((v) => v * 65535);
        const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Uint16Array(buf, 32, n * 3), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 3, gl.UNSIGNED_SHORT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(buf, 32 + n * 6, n), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(aL); gl.vertexAttribPointer(aL, 1, gl.UNSIGNED_BYTE, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(buf, 32 + n * 7 + (n % 2), m * 3), gl.STATIC_DRAW);
        const mdl = { vao, count: m * 3, mn, sc, c: mn.map((v, i) => v + ext[i] / 2), inv: 2 / Math.hypot(ext[0], ext[1], ext[2]) * 1.15 };
        cache.set(url, mdl); return mdl;
      });
    };
    const draw = () => {
      raf = 0;
      if (!cur) return;
      const r = Math.min(devicePixelRatio || 1, 2), w = Math.round(cv.clientWidth * r), h = Math.round(cv.clientHeight * r);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.bindVertexArray(cur.vao);
      gl.uniform3fv(U("uMin"), cur.mn); gl.uniform3fv(U("uSc"), cur.sc); gl.uniform3fv(U("uC"), cur.c);
      gl.uniform1f(U("uInv"), cur.inv * zoom); gl.uniform1f(U("uYaw"), yaw); gl.uniform1f(U("uPitch"), pitch); gl.uniform1f(U("uAsp"), w / h);
      gl.drawElements(gl.TRIANGLES, cur.count, gl.UNSIGNED_SHORT, 0);
      if (seen && !drag && !reduce && performance.now() > idle) { yaw += 0.006; kick(); }
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(draw); };
    const pick = (t) => {
      tabs.forEach((x) => x.setAttribute("aria-selected", String(x === t)));
      for (const k of ["name", "sci", "size"]) { const el = box.querySelector(`[data-p3-${k}]`); if (el) el.textContent = t.dataset[k] || ""; }
      want = t.dataset.p3Model;
      if (!seen) return;
      const url = want;
      load(url).then((m) => { if (url !== want) return; cur = m; box.classList.add("is-ready"); kick(); }).catch(() => { if (!cur) box.classList.add("is-off"); });
    };
    tabs.forEach((t) => t.addEventListener("click", () => pick(t)));
    cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", (e) => { if (!drag) return; yaw += (e.clientX - drag.x) * 0.01; pitch = Math.max(-0.6, Math.min(0.9, pitch + (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; kick(); });
    const up = () => { drag = null; idle = performance.now() + 2500; kick(); };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    addEventListener("resize", kick);
    new IntersectionObserver((es) => { seen = es[0].isIntersecting; if (seen) { cur ? kick() : tabs.length ? pick(tabs.find((t) => t.getAttribute("aria-selected") === "true") || tabs[0]) : load(solo).then((m) => { cur = m; box.classList.add("is-ready"); kick(); }).catch(() => box.classList.add("is-off")); } }, { rootMargin: "200px" }).observe(box);
    want = tabs.length ? tabs[0].dataset.p3Model : solo;
  });
  // ── 홈페이지 제작: 창 안의 실제 화면을 업종별로 갈아 끼운다(5초마다, 누르면 그 업종에서 멈춤)
  d.querySelectorAll("[data-hp-stage]").forEach((st) => {
    const tabs = [...st.querySelectorAll("[data-hp-tab]")], url = st.querySelector("[data-hp-url]");
    const DUR = 5000;
    st.style.setProperty("--hp-dur", DUR / 1000 + "s");
    const toast = st.querySelector("[data-hp-toast]");
    let i = 0, timer = 0, paused = reduce, toastT = 0, count = 2;
    if (paused) st.classList.add("is-paused");
    const show = (n) => {
      i = (n + tabs.length) % tabs.length;
      const k = tabs[i].dataset.hpTab;
      tabs.forEach((t, j) => t.setAttribute("aria-selected", String(j === i)));
      st.querySelectorAll("[data-hp-shot]").forEach((im) => {
        const on = im.dataset.hpShot === k;
        if (on && im.loading === "lazy") im.loading = "eager";
        im.classList.toggle("is-on", on);
      });
      if (url) url.textContent = tabs[i].dataset.url || "";
      // 화면이 바뀌고 조금 뒤 "새 신청" 알림이 뜬다 — 문의가 쌓이는 홈페이지라는 뜻
      if (toast) {
        toast.classList.remove("is-show"); clearTimeout(toastT);
        toastT = setTimeout(() => {
          toast.querySelector("[data-hp-toast-t]").textContent = tabs[i].dataset.toastT || "";
          toast.querySelector("[data-hp-toast-d]").textContent = tabs[i].dataset.toastD || "";
          const n = toast.querySelector("[data-hp-toast-n]"); n.textContent = String(++count);
          toast.classList.add("is-show");
        }, reduce ? 0 : 1300);
      }
    };
    const loop = () => { clearTimeout(timer); if (!paused) timer = setTimeout(() => { show(i + 1); loop(); }, DUR); };
    tabs.forEach((t, j) => t.addEventListener("click", () => { paused = true; st.classList.add("is-paused"); clearTimeout(timer); show(j); }));
    // 화면 밖에 있으면 돌리지 않는다
    let first = true;
    new IntersectionObserver(([en]) => { if (en.isIntersecting) { if (first) { first = false; show(0); } loop(); } else clearTimeout(timer); }).observe(st);
    // 다음 화면을 미리 받아 둔다(바뀔 때 빈 창이 보이지 않게)
    addEventListener("load", () => st.querySelectorAll('img[loading="lazy"]').forEach((im) => { im.loading = "eager"; }), { once: true });
  });

  // ── 홈페이지 제작: 관리 화면에 글자를 치고 저장하면 홈페이지 공지가 바뀐다
  d.querySelectorAll("[data-hp-demo]").forEach((box) => {
    const typeEl = box.querySelector("[data-hp-type]"), out = box.querySelector("[data-hp-out]"), save = box.querySelector("[data-hp-save]");
    const LINES = ["이번 주 토요일 골목 장터 열려요", "12월 진료 시간이 바뀝니다", "신메뉴 출시 기념 가맹 상담 이벤트"];
    if (reduce) { typeEl.textContent = LINES[0]; out.textContent = LINES[0]; return; }
    let n = 0, running = false, alive = false;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const run = async () => {
      if (running) return; running = true;
      while (alive) {
        const text = LINES[n++ % LINES.length];
        typeEl.textContent = "";
        for (const ch of text) { if (!alive) break; typeEl.textContent += ch; await wait(70); }
        await wait(500);
        save.classList.add("is-press"); await wait(160); save.classList.remove("is-press");
        out.textContent = text; out.classList.add("is-new");
        await wait(900); out.classList.remove("is-new");
        await wait(1800);
      }
      running = false;
    };
    new IntersectionObserver(([en]) => { alive = en.isIntersecting; if (alive) run(); }, { threshold: 0.3 }).observe(box);
  });

  // ── 유통 · 수출 페이지: 위의 두 카드와 탭 줄이 아래 내용(국내 유통 / 해외 수출)을 바꾼다
  // 자바스크립트가 없으면 두 내용이 차례로 다 보인다. 주소 끝 #export(또는 그 안의 #rt3 같은 칸)로 들어오면 수출이 열린다.
  (function bizTabs() {
    const panels = [...document.querySelectorAll("[data-bizpanel]")];
    if (panels.length < 2) return;
    const tabs = [...document.querySelectorAll("[data-biztab]")];
    const bar = document.querySelector(".bx-tabs");
    const which = (hash) => {
      const id = decodeURIComponent((hash || "").slice(1));
      if (!id) return null;
      const el = document.getElementById(id);
      const p = el && (el.matches("[data-bizpanel]") ? el : el.closest("[data-bizpanel]"));
      return p ? { key: p.dataset.bizpanel, el, inner: el !== p } : null;
    };
    function show(key) {
      panels.forEach((p) => { p.hidden = p.dataset.bizpanel !== key; });
      tabs.forEach((t) => {
        const on = t.dataset.biztab === key;
        if (t.getAttribute("role") === "tab") t.setAttribute("aria-selected", on ? "true" : "false");
        else if (on) t.setAttribute("aria-current", "true"); else t.removeAttribute("aria-current");
        t.classList.toggle("is-on", on);
      });
    }
    const goTop = () => { const y = (bar ? bar.getBoundingClientRect().top + scrollY : 0) - (parseInt(getComputedStyle(document.documentElement).getPropertyValue("--hd")) || 68); scrollTo({ top: Math.max(0, y), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); };
    tabs.forEach((t) => t.addEventListener("click", (e) => {
      e.preventDefault();
      show(t.dataset.biztab);
      history.replaceState(null, "", t.dataset.biztab === "export" ? "#export" : location.pathname + location.search);
      goTop();
    }));
    function fromHash(scroll) {
      const w = which(location.hash);
      show(w ? w.key : "domestic");
      if (w && scroll) requestAnimationFrame(() => (w.inner ? w.el.scrollIntoView() : goTop()));
    }
    // 같은 페이지 안의 #export · #domestic 링크(자주 묻는 질문 속 링크 등)
    document.addEventListener("click", (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a || a.hasAttribute("data-biztab")) return;
      const w = which(a.getAttribute("href"));
      if (!w) return;
      e.preventDefault();
      show(w.key);
      history.replaceState(null, "", a.getAttribute("href"));
      requestAnimationFrame(() => (w.inner ? w.el.scrollIntoView({ behavior: "smooth" }) : goTop()));
    });
    addEventListener("hashchange", () => fromHash(true));
    fromHash(!!location.hash);
  })();

  function sessionStorageGet(k) { try { return sessionStorage.getItem("ut_" + k); } catch { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem("ut_" + k, v); } catch { /* 저장 못 해도 접수는 된다 */ } }
})();
