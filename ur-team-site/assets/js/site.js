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
      hd?.classList.toggle("is-scrolled", y > 8);
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
    // 3D 파일 변환기에서 넘어왔으면 크기 · 물건을 미리 채운다
    try { const pre = JSON.parse(sessionStorage.getItem("p3-prefill") || "null");
      if (pre) for (const [k, v] of [["크기", pre.size], ["Size", pre.size], ["만들 물건", pre.item], ["Item", pre.item]]) { const el = f.querySelector(`[data-msg-part="${k}"]`); if (el && !el.value && v) el.value = v; }
    } catch (e) {}
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
        const KO = { "Service needed": "필요한 일", "Item": "만들 물건", "Quantity": "수량", "Size": "크기", "Needed by": "필요한 날짜", "File link": "파일 링크", "Areas of interest": "관심 분야", "Inquiry": "문의 내용", "Company URL": "회사 URL", "Marketing services": "마케팅 상품",
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
  // ── 3D프린팅 첫 화면: 슬라이서처럼 만든 출력 미리보기 (WebGL2, 라이브러리 없음)
  //    FDM: 출력판 위에 기어 세트가 한 층씩 쌓인다 — 잘린 면에 외벽과 속 채움, 노즐이 지나간 경로, 움직이는 프린터 헤드, 바닥 그림자
  //    SLA: 수지 수조 위로 플랫폼이 올라가며 부품이 거꾸로 자란다 — 서포트 · 래프트, 수조 바닥의 빛
  //    형상은 assets/models/ 의 fdm-* · sla-* 파일(계산해 만든 예시 형상)
  d.querySelectorAll("[data-p3-slicer]").forEach((box) => {
    const cv = box.querySelector("canvas"), $ = (q) => box.querySelector(q);
    const range = $("[data-p3-layer]"), outN = $("[data-p3-n]"), outH = $("[data-p3-h]"), outT = $("[data-p3-total]"), playBtn = $("[data-p3-play]");
    const tabs = [...box.querySelectorAll("[data-p3-tab]")];
    const sliceCv = $("[data-p3-slice]"), sctx = sliceCv ? sliceCv.getContext("2d") : null, cmp = d.querySelector("[data-p3-cmp]"); let slices = null;
    const gl = cv.getContext("webgl2", { antialias: true, alpha: true, stencil: true });
    if (!gl) { box.classList.add("is-ready"); return; }
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
      in vec3 aP; in float aL; uniform vec3 uMin, uSc, uC, uOff; uniform float uInv, uYaw, uPitch, uAsp, uFlip, uLift, uShadow; out vec3 vP; out vec3 vW; out float vY; out float vL;
      void main() { vec3 m = aP * uSc + uMin; vec3 w = vec3(m.x, uFlip * m.y + uLift, m.z); vec3 off = uOff; if (aL > 13.5 && aL < 14.5) off.x = 0.0; w += off; vY = w.y;
        if (uShadow > .5) { w.x += w.y * .34; w.z -= w.y * .26; w.y = .08; }
        vW = w; vec3 p = (w - uC) * uInv; float c = cos(uYaw), s = sin(uYaw); p = vec3(c * p.x + s * p.z, p.y, c * p.z - s * p.x);
        c = cos(uPitch); s = sin(uPitch); p = vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); p.z -= 3.4; vP = p; vL = aL;
        float f = 2.6; gl_Position = vec4(p.x * f / max(uAsp, 1.0), p.y * f * min(uAsp, 1.0), (p.z * 10.5 + 10.0) / -9.5, -p.z); }`));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; in vec3 vP; in vec3 vW; in float vY; in float vL; out vec4 o;
      uniform int uMode, uOnly; uniform vec2 uClip; uniform float uRidge, uTime; uniform vec3 uGlow;
      bool is(float a) { return abs(vL - a) < .5; }
      void main() {
        bool part = is(1.) || is(20.) || is(21.);
        if (uOnly > 0 ? !is(float(uOnly)) : (uOnly < 0 && (is(31.) || is(34.)))) discard;
        if (part && (vY < uClip.x || vY > uClip.y)) discard;
        if (uMode == 1) { if (!part) discard; o = vec4(0.); return; }                              // 잘린 면 세기
        if (uMode == 2) { o = vec4(.20, .42, 1., 1.); return; }                                    // 잘린 면: 외벽
        if (uMode == 3) {                                                                          // 잘린 면: 속 채움(격자)
          vec2 q = vec2(vW.x + vW.z, vW.x - vW.z) * .7071; float g = min(abs(fract(q.x / 5.) - .5), abs(fract(q.y / 5.) - .5)) * 5.;
          o = vec4(g < .42 ? vec3(.33, .52, 1.) : vec3(.035, .075, .21), 1.); return; }
        if (uMode == 4) { if (!is(1.)) discard; o = vec4(0., 0., 0., .2); return; }               // 출력판 위 그림자
        if (uMode == 5) {                                                                          // 수조 바닥의 빛
          float r = length(vW.xz - uGlow.xy) / uGlow.z, scan = .55 + .45 * sin(vW.x * .9 - uTime * 9.);
          if (r > 1.3) discard; float g = smoothstep(1.3, .1, r) * (uGlow.z < 10. ? 1.6 : scan * .7); o = vec4(vec3(.52, .42, 1.) * g, g * .6); return; }
        if (uMode == 6) { o = vec4(1., .97, .82, 1.); return; }                                    // 방금 짜낸 줄
        vec3 n = normalize(cross(dFdx(vP), dFdy(vP))); if (n.z < 0.) n = -n;
        vec3 L = normalize(vec3(.38, .72, .58)); float df = max(dot(n, L), 0.), fill = max(dot(n, normalize(vec3(-.7, .15, .5))), 0.);
        float sp = pow(max(dot(n, normalize(L + vec3(0., 0., 1.))), 0.), 42.);
        vec3 base = vec3(.5); float gloss = .18, a = 1.;
        if (is(1.)) { base = vec3(.09, .30, .95); gloss = .30; }
        else if (is(5.)) { base = vec3(.17, .18, .20); gloss = .10;
          if (vY > -.05) { vec2 g = abs(fract(vW.xz / 10. + .5) - .5) * 10., G = abs(fract(vW.xz / 50. + .5) - .5) * 50.;
            if (min(G.x, G.y) < .35) base = vec3(.40, .42, .46); else if (min(g.x, g.y) < .16) base = vec3(.27, .28, .31); } }
        else if (is(6.)) base = vec3(.09, .095, .11);
        else if (is(10.)) { base = vec3(.14, .15, .17); gloss = .25; }
        else if (is(11.)) { base = vec3(.74, .76, .79); gloss = .7; }
        else if (is(12.)) { base = vec3(.83, .64, .26); gloss = .8; }
        else if (is(13.)) { base = vec3(.88, .90, .93); gloss = .2; }
        else if (is(14.)) { base = vec3(.52, .55, .59); gloss = .55; }
        else if (is(15.)) { base = vec3(.62, .17, .12); gloss = .1; }
        else if (is(20.)) { base = vec3(.80, .82, .86); gloss = .45; }
        else if (is(21.)) { base = vec3(.70, .73, .78); gloss = .35; }
        else if (is(30.)) { base = vec3(.12, .13, .15); gloss = .3; }
        else if (is(32.)) { base = vec3(.34, .36, .40); gloss = .6; }
        else if (is(33.)) { base = vec3(.22, .24, .27); gloss = .3; }
        else if (is(35.)) { base = vec3(.42, .40, .36); gloss = .5; }
        else if (is(31.)) { base = vec3(1., .55, .12); a = .13; gloss = .9; }
        else if (is(34.)) { base = vec3(.80, .42, .06); a = .36; gloss = .4; }
        float k = .34 + .60 * df + .16 * fill;
        if (part && uRidge > 0.) { float fw = fwidth(vY) / uRidge; k *= 1. - .11 * (.5 + .5 * cos(vY / uRidge * 6.2832)) * clamp(1. - fw * 1.6, 0., 1.); }
        if (is(1.) && uClip.y < 1e5 && uClip.y - vY < .4) base = vec3(.62, .76, 1.);              // 지금 쌓는 층
        o = vec4(base * k + sp * gloss, a); }`));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { box.classList.add("is-ready"); return; }
    gl.useProgram(prog); gl.clearColor(0, 0, 0, 0);
    const loc = {}, U = (n) => loc[n] || (loc[n] = gl.getUniformLocation(prog, n)), aP = gl.getAttribLocation(prog, "aP"), aL = gl.getAttribLocation(prog, "aL");
    const mesh = (pos, type, lab, idx) => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao); const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 3, type, false, 0, 0);
      if (lab) { gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, lab, gl.STATIC_DRAW); gl.enableVertexAttribArray(aL); gl.vertexAttribPointer(aL, 1, gl.UNSIGNED_BYTE, false, 0, 0); }
      if (idx) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); }
      return { vao, vb, count: idx ? idx.length : 0, lab: !!lab, mn: [0, 0, 0], sc: [1, 1, 1] };
    };
    const loadBin = (url) => fetch(url).then((r) => { if (!r.ok) throw 0; return r.arrayBuffer(); }).then((buf) => {
      const hd = new DataView(buf), n = hd.getUint32(0, true), m = hd.getUint32(4, true), f = (i) => hd.getFloat32(8 + i * 4, true);
      const o = mesh(new Uint16Array(buf, 32, n * 3), gl.UNSIGNED_SHORT, new Uint8Array(buf, 32 + n * 6, n), new Uint16Array(buf, 32 + n * 7 + (n % 2), m * 3));
      o.mn = [f(0), f(1), f(2)]; o.sc = [f(3), f(4), f(5)]; return o;
    });
    const quad = mesh(new Float32Array([-400, 0, -400, 400, 0, -400, 400, 0, 400, -400, 0, 400]), gl.FLOAT, null, new Uint16Array([0, 1, 2, 0, 2, 3]));
    const trail = mesh(new Float32Array(6 * 400), gl.FLOAT, null, null);
    const B = "/assets/models/", M = {};
    const SC = {
      fdm: { files: ["fdm-part", "fdm-inner", "fdm-head"], c: [18, 6, 2], span: 112, yaw: 0.55, pitch: 0.66, ridge: 1.0 },
      sla: { files: ["sla-part", "sla-rig", "sla-plat"], c: [0, 22, -6], span: 100, yaw: 0.62, pitch: 0.26, ridge: 0.5 },
    };
    let mode = "fdm", N = 100, LH = 0.2, layer = reduce ? N : 0, playing = !reduce, touched = false, last = 0, hold = 0, shown = -1, raf = 0, seen = true, drag = null;
    let yaw = SC.fdm.yaw, pitch = SC.fdm.pitch, path = null, travel = 0;
    const ready = (k) => SC[k].files.every((f) => M[f]) && (k !== "fdm" || path);
    const fetchScene = (k) => SC[k].p || (SC[k].p = Promise.all(SC[k].files.map((f) => M[f] ? 0 : loadBin(B + f + ".bin").then((m) => { M[f] = m; })).concat(
      k === "fdm" ? fetch(B + "fdm-path.json").then((r) => r.json()).then((j) => {
        // 외곽선을 선분 목록으로: 노즐이 일정한 속도로 따라 돌 수 있게 누적 길이를 함께 둔다
        path = j.sections.map((s) => { const seg = []; let len = 0;
          for (const lp of s.loops) for (let i = 0; i + 3 < lp.length; i += 2) { const d0 = Math.hypot(lp[i + 2] - lp[i], lp[i + 3] - lp[i + 1]); seg.push([lp[i], lp[i + 1], lp[i + 2], lp[i + 3], len, d0]); len += d0; }
          return { y0: s.y0, y1: s.y1, loops: s.loops, seg, len }; });
      }) : fetch(B + "sla-slices.json").then((r) => r.json()).then((j) => { slices = j; }))));
    // 이번 층 단면(위에서 본 모양). FDM: 외벽과 속 채움, SLA: 빛을 쬐는 영역(흰색)
    const drawSlice = () => {
      if (!sctx) return; const W = sliceCv.width, H2 = layer * LH; sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.fillStyle = "#12161b"; sctx.fillRect(0, 0, W, W);
      const ring = (lp) => { sctx.moveTo(lp[0], lp[1]); for (let i = 2; i < lp.length; i += 2) sctx.lineTo(lp[i], lp[i + 1]); sctx.closePath(); };
      if (mode === "fdm" && path) {
        if (layer <= 0) return; const sec = path.find((x) => H2 > x.y0 && H2 <= x.y1) || path[path.length - 1], k = W / 124;
        sctx.setTransform(k, 0, 0, k, W / 2 - 18 * k, W / 2); sctx.beginPath(); sec.loops.forEach(ring);
        const solid = H2 - sec.y0 < 0.85 || sec.y1 - H2 < 0.85;
        sctx.fillStyle = solid ? "#2f5bff" : "#0b1436"; sctx.fill("evenodd");
        if (!solid) { sctx.save(); sctx.clip("evenodd"); sctx.strokeStyle = "#4f74ff"; sctx.lineWidth = 0.5; sctx.beginPath(); for (let v = -160; v < 160; v += 5) { sctx.moveTo(v - 100, -100); sctx.lineTo(v + 100, 100); sctx.moveTo(v + 100, -100); sctx.lineTo(v - 100, 100); } sctx.stroke(); sctx.restore(); }
        sctx.beginPath(); sec.loops.forEach(ring); sctx.strokeStyle = "#7f9bff"; sctx.lineWidth = 1.5; sctx.stroke();
      } else if (mode === "sla" && slices) {
        if (layer <= 0 || layer >= N) return; const i = Math.max(0, Math.min(slices.slices.length - 1, Math.round((H2 - slices.u0) / slices.step))), k = W / 36;
        sctx.setTransform(k, 0, 0, k, W / 2, W / 2); sctx.beginPath(); slices.slices[i].forEach(ring); sctx.fillStyle = "#f4f1ff"; sctx.fill("evenodd");
      }
    };
    const paintUi = () => {
      const n = Math.round(layer); if (n === shown) return; shown = n;
      if (outN) outN.textContent = n; if (outH) outH.textContent = (n * LH).toFixed(1); if (range && d.activeElement !== range) range.value = n;
      drawSlice();
    };
    const setPlaying = (v) => { playing = v; box.classList.toggle("is-playing", v); if (playBtn) playBtn.setAttribute("aria-label", v ? playBtn.dataset.labelPause : playBtn.dataset.labelPlay); last = 0; kick(); };
    const setMode = (k, auto) => {
      mode = k; const t = tabs.find((x) => x.dataset.p3Tab === k);
      tabs.forEach((x) => x.setAttribute("aria-selected", String(x === t)));
      box.querySelectorAll("[data-p3-panel]").forEach((el) => { el.hidden = el.dataset.p3Panel !== k; });
      if (cmp) cmp.dataset.on = k;
      N = Number(t.dataset.layers); LH = Number(t.dataset.lh); if (range) range.max = N; if (outT) outT.textContent = N;
      const fe = $("[data-p3-file]"), se = $("[data-p3-size]"); if (fe) fe.textContent = t.dataset.file; if (se) se.textContent = t.dataset.size;
      layer = reduce ? N : 0; hold = 0; shown = -1; yaw = SC[k].yaw; pitch = SC[k].pitch;
      fetchScene(k).then(() => { box.classList.add("is-ready"); if (!auto || !reduce) setPlaying(!reduce); kick(); }).catch(() => box.classList.add("is-ready"));
      kick();
    };
    const drawM = (m, o) => {
      gl.bindVertexArray(m.vao); if (!m.lab) gl.vertexAttrib1f(aL, o.lab || 0);
      gl.uniform3fv(U("uMin"), m.mn); gl.uniform3fv(U("uSc"), m.sc); gl.uniform1i(U("uMode"), o.mode || 0); gl.uniform1i(U("uOnly"), o.only || 0);
      gl.uniform3fv(U("uOff"), o.off || [0, 0, 0]); gl.uniform1f(U("uFlip"), o.flip || 1); gl.uniform1f(U("uLift"), o.lift || 0); gl.uniform1f(U("uShadow"), o.shadow ? 1 : 0);
      gl.uniform2fv(U("uClip"), o.clip || [-1e6, 1e6]);
      if (o.lines) gl.drawArrays(gl.LINES, 0, o.lines); else gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
    };
    const capPass = (solid, clip, capMode, y) => {   // 잘린 부품의 앞 · 뒷면을 모두 세어 홀수 번 겹친 곳(속)에만 판을 그린다
      gl.clear(gl.STENCIL_BUFFER_BIT); gl.enable(gl.STENCIL_TEST); gl.disable(gl.DEPTH_TEST); gl.colorMask(false, false, false, false); gl.depthMask(false);
      gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT); drawM(solid, { mode: 1, clip });
      gl.colorMask(true, true, true, true); gl.depthMask(true); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.stencilFunc(gl.NOTEQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP); drawM(quad, { mode: capMode, off: [0, y, 0] });
      gl.disable(gl.STENCIL_TEST);
    };
    const draw = (t) => {
      raf = 0; if (!ready(mode)) return;
      const dt = last ? Math.min(80, t - last) : 0; last = t;
      if (playing) {
        if (layer >= N) { hold += dt; if (hold > 2800) { hold = 0; if (!touched) return setMode(mode === "fdm" ? "sla" : "fdm", true); layer = 0; } }
        else layer = Math.min(N, layer + dt * N / 18000);
        travel += dt * 0.26;
      }
      paintUi();
      const r = Math.min(devicePixelRatio || 1, 2), w = Math.round(cv.clientWidth * r), h = Math.round(cv.clientHeight * r);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true); gl.disable(gl.BLEND);
      const S0 = SC[mode], done = layer >= N, H = layer * LH;
      gl.uniform3fv(U("uC"), S0.c); gl.uniform1f(U("uInv"), 2 / S0.span * Math.min(1, 0.5 + 0.27 * (w / h))); gl.uniform1f(U("uYaw"), yaw); gl.uniform1f(U("uPitch"), pitch); gl.uniform1f(U("uAsp"), w / h);
      gl.uniform1f(U("uRidge"), S0.ridge); gl.uniform1f(U("uTime"), (t || 0) / 1000);
      if (mode === "fdm") {
        const clip = [-1e6, done ? 1e6 : H];
        drawM(M["fdm-part"], { clip });
        if (H > 0.3) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); drawM(M["fdm-part"], { mode: 4, shadow: 1, clip }); gl.depthMask(true); gl.disable(gl.BLEND); }
        if (!done && layer > 0) {
          const sec0 = path.find((x) => H >= x.y0 && H < x.y1) || path[path.length - 1];
          capPass(M["fdm-part"], clip, 2, H); if (H - sec0.y0 >= 0.85 && sec0.y1 - H >= 0.85) capPass(M["fdm-inner"], clip, 3, H + 0.01);
          // 노즐: 지금 층의 외곽선을 따라 돌고, 방금 지나온 길은 밝은 줄로 남는다
          const sec = path.find((s) => H >= s.y0 && H < s.y1) || path[path.length - 1], pos = travel % sec.len;
          let lo = 0, hi = sec.seg.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (sec.seg[mid][4] <= pos) lo = mid; else hi = mid - 1; }
          const sg = sec.seg[lo], f = sg[5] ? (pos - sg[4]) / sg[5] : 0, nx = sg[0] + (sg[2] - sg[0]) * f, nzz = sg[1] + (sg[3] - sg[1]) * f;
          const buf = new Float32Array(6 * 400); let c = 0, back = 46;
          buf.set([sg[0], 0, sg[1], nx, 0, nzz], 0); c = 2;
          for (let i = lo - 1; i >= 0 && pos - sec.seg[i][4] < back && c < 798; i--) { const q = sec.seg[i]; if (Math.hypot(q[2] - sec.seg[i + 1][0], q[3] - sec.seg[i + 1][1]) > 0.6) break; buf.set([q[0], 0, q[1], q[2], 0, q[3]], c * 3); c += 2; }
          gl.bindBuffer(gl.ARRAY_BUFFER, trail.vb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.subarray(0, c * 3));
          gl.depthFunc(gl.LEQUAL); drawM(trail, { mode: 6, off: [0, H + 0.06, 0], lines: c }); gl.depthFunc(gl.LESS);
          drawM(M["fdm-head"], { off: [nx, H + 0.3, nzz] });
        }
      } else {
        const lift = H, clip = [0, 1e6];
        drawM(M["sla-rig"], { only: -1 });
        drawM(M["sla-part"], { flip: -1, lift, clip });
        drawM(M["sla-plat"], { off: [0, lift, 0] });
        gl.enable(gl.BLEND); gl.depthMask(false);
        if (!done) { gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); const ga = (t || 0) / 1000 * 3.1; gl.uniform3f(U("uGlow"), 11 * Math.cos(ga), 11 * Math.sin(ga), 6); drawM(quad, { mode: 5, off: [0, 0.25, 0] }); gl.uniform3f(U("uGlow"), 0, 0, 19); drawM(quad, { mode: 5, off: [0, 0.2, 0] }); }
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        drawM(M["sla-rig"], { only: 34 }); drawM(M["sla-rig"], { only: 31 });
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      if (seen && playing) kick();
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(draw); };
    const touch = () => { touched = true; };
    tabs.forEach((t) => t.addEventListener("click", () => { touch(); setMode(t.dataset.p3Tab); }));
    if (range) range.addEventListener("input", () => { touch(); layer = Number(range.value); hold = 0; if (playing) setPlaying(false); shown = -1; kick(); });
    if (playBtn) playBtn.addEventListener("click", () => { touch(); if (!playing && layer >= N) layer = 0; setPlaying(!playing); });
    cv.addEventListener("pointerdown", (e) => { touch(); drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", (e) => { if (!drag) return; yaw += (e.clientX - drag.x) * 0.01; pitch = Math.max(0.08, Math.min(1.35, pitch + (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; kick(); });
    const up = () => { drag = null; }; cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    addEventListener("resize", kick);
    new IntersectionObserver((es) => { seen = es[0].isIntersecting; last = 0; if (seen) kick(); }).observe(box);
    setMode("fdm", true); fetchScene("fdm").then(() => fetchScene("sla")).catch(() => {});
  });
  // ── 3D프린팅: 온등 실조명 미리보기. 노즐이 지나가는 길(선분)을 직접 계산해 그린다
  //    형상 계산은 '온등 실조명 공방'의 것을 옮겼다: 다각형 고리 3층 + 그 사이를 지그재그로 건너는 실 3층을 한 단으로 쌓고, 단마다 조금씩 돌린다
  d.querySelectorAll("[data-p3-lamp]").forEach((box) => {
    const cv = box.querySelector("canvas"), ctx = cv.getContext("2d"), D2R = Math.PI / 180;
    const SIZES = { s: { outerD: 150, innerD: 90, height: 149.4, shape: "straight", amt: 0 }, m: { outerD: 190, innerD: 110, height: 180, shape: "barrel", amt: 14 }, l: { outerD: 170, innerD: 100, height: 196.2, shape: "hourglass", amt: 10 } };
    const build = (o) => {
      const N = 16, G = 3, lh = 0.3, step = 360 / N, cycH = 2 * G * lh, cycles = Math.max(2, Math.round(o.height / cycH)), twist = 3, sr = 22, B = Math.max(1, Math.round(9 / cycH));
      const out = []; let X = 0, Y = 0, Z = lh;
      const pt = (r, a) => [r * Math.cos(a * D2R), r * Math.sin(a * D2R)];
      const ext = (x, y) => { out.push(X, Y, Z, x, y, Z); X = x; Y = y; };
      const trav = (x, y, z) => { X = x; Y = y; Z = z; };
      const prof = (t) => o.shape === "barrel" ? o.outerD / 2 - o.amt * (1 - Math.sin(Math.PI * t)) : o.shape === "hourglass" ? o.outerD / 2 - o.amt * Math.sin(Math.PI * t) : o.outerD / 2;
      const Ro = [], ang = []; let a = step;
      for (let c = 0; c <= cycles; c++) { Ro.push(prof(Math.min(1, c / (cycles - 1)))); ang.push(a); a += twist; }
      const ring = (R, a0, z1) => { const [sx, sy] = pt(R, a0); for (let j = 0; j < G; j++) { trav(sx, sy, z1 + j * lh); for (let k = 1; k <= N; k++) { const q = pt(R, a0 + k * step); ext(q[0], q[1]); } } };
      const zig = (rA, aA, rB, aB, z1) => { const [sx, sy] = pt(rA, aA); for (let j = 0; j < G; j++) { trav(sx, sy, z1 + j * lh); for (let k = 0; k < N; k++) { let q = pt(rB, aB + k * step); ext(q[0], q[1]); q = pt(rA, aA + (k + 1) * step); ext(q[0], q[1]); } } };
      const Ri = o.innerD / 2;
      for (let c = 0; c < cycles; c++) {
        const zB = c * cycH, z1 = zB + lh, zTop = zB + (G + 1) * lh;
        ring(Ro[c], ang[c], z1); ring(Ri, ang[c], z1);
        if (c < B) for (let j = 0; j < G; j++) for (const r of [sr + 0.4, sr, sr - 0.4]) { trav(r, 0, z1 + j * lh); for (let k = 1; k <= 48; k++) { const q = pt(r, k * 7.5); ext(q[0], q[1]); } }
        if (c < B - 1) zig(sr - 0.4, ang[c], Ri + 1, ang[c] + 0.1 / D2R, zTop);
        const aS = ang[c + 1] + 0.4375; zig(Ri - 2, aS, Ro[c + 1] + 0.5, aS, zTop);
      }
      return { segs: new Float32Array(out), n: out.length / 6, H: cycles * cycH, R: Math.max(...Ro) + 0.5 };
    };
    let L = null, yaw = 0.5, pitch = 1.12, lit = true, prog = 1, drag = null, seen = false, dirty = true, last = 0, raf = 0;
    const draw = () => {
      const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = "#0b0d12"; ctx.fillRect(0, 0, w, h);
      if (!L) return;
      const H = L.H, R = L.R, cy0 = Math.cos(yaw), sy0 = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const ex = Math.max(H * sp + 2 * R * cp, 2 * R) * 1.08, sc = Math.min(w / (2 * R * 1.12), (h - 46) / ex), ox = w / 2, oy = (h - 30) / 2 + (H / 2 * sp) * sc, cam = Math.max(H, R * 2) * 3.2;
      if (lit) { const gy = oy - (H * 0.5 * sp) * sc, gr = ctx.createRadialGradient(ox, gy, 2, ox, gy, R * sc * 1.5); gr.addColorStop(0, "rgba(255,214,150,.55)"); gr.addColorStop(.25, "rgba(255,170,80,.20)"); gr.addColorStop(1, "rgba(255,150,60,0)"); ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h); }
      ctx.globalCompositeOperation = "lighter"; ctx.lineWidth = Math.max(.6, 0.45 * sc * .7); ctx.lineCap = "round"; ctx.strokeStyle = lit ? "rgba(255,205,150,.17)" : "rgba(255,122,48,.42)";
      const n = Math.floor(L.n * prog), sg = L.segs;
      for (let i = 0; i < n; i += 96) { ctx.beginPath(); const e = Math.min(n, i + 96);
        for (let j = i; j < e; j++) { const o = j * 6;
          let x = sg[o], y = sg[o + 1], z = sg[o + 2], Xr = x * cy0 - y * sy0, Yr = x * sy0 + y * cy0, k = cam / (cam - Yr * cp * 0.5); ctx.moveTo(ox + Xr * sc * k, oy - (z * sp - Yr * cp) * sc * k);
          x = sg[o + 3]; y = sg[o + 4]; z = sg[o + 5]; Xr = x * cy0 - y * sy0; Yr = x * sy0 + y * cy0; k = cam / (cam - Yr * cp * 0.5); ctx.lineTo(ox + Xr * sc * k, oy - (z * sp - Yr * cp) * sc * k); }
        ctx.stroke(); }
    };
    const loop = (t) => { raf = 0; if (!seen) return; if (!reduce && !drag) { yaw += Math.min(50, t - last) * 0.00018; dirty = true; } last = t; if (dirty) { dirty = false; draw(); } if (!reduce || dirty) raf = requestAnimationFrame(loop); };
    const kick = () => { dirty = true; if (!raf && seen) raf = requestAnimationFrame(loop); };
    const pick = (k) => { box.querySelectorAll("[data-p3-lamp-size]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.p3LampSize === k))); L = build(SIZES[k]); kick(); };
    box.querySelectorAll("[data-p3-lamp-size]").forEach((b) => b.addEventListener("click", () => pick(b.dataset.p3LampSize)));
    const litBtn = box.querySelector("[data-p3-lamp-lit]"); if (litBtn) litBtn.addEventListener("click", () => { lit = !lit; litBtn.setAttribute("aria-pressed", String(lit)); kick(); });
    const pr = box.querySelector("[data-p3-lamp-prog]"), po = box.querySelector("[data-p3-lamp-pct]"); if (pr) pr.addEventListener("input", () => { prog = pr.value / 100; if (po) po.textContent = pr.value + "%"; kick(); });
    cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", (e) => { if (!drag) return; yaw += (e.clientX - drag.x) * 0.008; pitch = Math.max(0.15, Math.min(1.5, pitch + (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; kick(); });
    const up = () => { drag = null; }; cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    addEventListener("resize", kick);
    new IntersectionObserver((es) => { seen = es[0].isIntersecting; if (seen) { if (!L) pick("m"); last = performance.now(); kick(); } }, { rootMargin: "200px" }).observe(box);
  });
  // ── 3D프린팅: 3D 모델 뷰어 (WebGL2, 라이브러리 없음). 화면에 들어올 때 모델을 받아 오고, 끌면 돌아간다
  d.querySelectorAll("[data-p3-viewer]").forEach((box) => {
    const cv = box.querySelector("canvas"), sec = box.closest("section") || d;
    const tabs = [...sec.querySelectorAll("[data-p3-model]")];
    const gl = cv.getContext("webgl2", { antialias: true, alpha: true });
    const solo = box.dataset.p3Src || "", zoom = Number(box.dataset.p3Zoom) || 1, build = box.hasAttribute("data-p3-build") && !reduce;
    const pct = build ? (box.closest(".p3-slicer") || d).querySelector("[data-p3-pct]") : null; let t0 = 0, lastPct = -1;
    if (!gl || (!tabs.length && !solo)) { box.classList.add("is-off"); return; }
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
      in vec3 aP; in float aL; uniform vec3 uMin, uSc, uC; uniform float uInv, uYaw, uPitch, uAsp; out vec3 vP; out float vL; out float vH;
      void main() { vec3 p = (aP * uSc + uMin - uC) * uInv; float c = cos(uYaw), s = sin(uYaw); p = vec3(c * p.x + s * p.z, p.y, c * p.z - s * p.x);
        c = cos(uPitch); s = sin(uPitch); p = vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); p.z -= 3.4; vP = p; vL = aL; vH = aP.y / 65535.0;
        float f = 2.6; gl_Position = vec4(p.x * f / max(uAsp, 1.0), p.y * f * min(uAsp, 1.0), (p.z * 10.5 + 10.0) / -9.5, -p.z); }`));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; in vec3 vP; in float vL; in float vH; uniform float uClip; out vec4 o;
      void main() { if (vH > uClip) discard; vec3 n = normalize(cross(dFdx(vP), dFdy(vP))); if (n.z < 0.0) n = -n;
        float k = .34 + .62 * max(dot(n, normalize(vec3(.35, .65, .68))), 0.0) + .16 * max(dot(n, normalize(vec3(-.7, .1, .5))), 0.0);
        vec3 base = vL > 7.5 ? vec3(.96, .62, .22) : vL > 6.5 ? vec3(.16, .36, .95) : vL > 4.5 && vL < 5.5 ? vec3(.13, .14, .16) : (vL > 3.5 ? vec3(.62, .64, .68) : vec3(.93, .89, .80));
        if (uClip < 1.0 && uClip - vH < .02) base = mix(base, vec3(1.0), .55); // 지금 쌓이는 층
        o = vec4(base * k, 1.0); }`));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { box.classList.add("is-off"); return; }
    gl.useProgram(prog); gl.enable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 0);
    const U = (n) => gl.getUniformLocation(prog, n), aP = gl.getAttribLocation(prog, "aP"), aL = gl.getAttribLocation(prog, "aL");
    const cache = new Map();
    let cur = null, yaw = 1.05, pitch = Number(box.dataset.p3Pitch) || 0.12, drag = null, seen = false, idle = 0, raf = 0, want = "";
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
      // 출력 미리보기: 7초 동안 아래에서 위로 쌓이고, 3초 동안 다 된 모습으로 머문다
      let clip = 2;
      if (build) { if (!t0) t0 = performance.now(); clip = Math.min(1, ((performance.now() - t0) % 10000) / 7000); if (clip >= 1) clip = 2; const n = Math.round(Math.min(1, clip) * 100); if (pct && n !== lastPct) { lastPct = n; pct.textContent = n; } }
      gl.uniform1f(U("uClip"), clip);
      gl.drawElements(gl.TRIANGLES, cur.count, gl.UNSIGNED_SHORT, 0);
      if (seen && !drag && !reduce && performance.now() > idle) { yaw += 0.006; kick(); } else if (seen && build) kick();
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
