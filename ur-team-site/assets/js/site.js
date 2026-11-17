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
  } : {
    menuOpen: "메뉴 열기", menuClose: "메뉴 닫기",
    needName: "업체명 · 담당자를 적어 주세요.", needPhone: "연락처를 적어 주세요.",
    needAgree: "개인정보 수집 · 이용에 동의해 주세요.",
    off: "지금은 온라인 접수 준비 중입니다. 카카오톡이나 전화로 문의해 주세요.", sending: "보내는 중…",
    done: "상담 신청이 접수되었습니다. 영업일 기준 1일 안에 연락드리겠습니다.", fail: "보내지 못했습니다. 다시 한 번 눌러 주시거나 카카오톡 · 전화로 문의해 주세요.", submit: "상담 신청하기",
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
        e.preventDefault();
        const v = (n) => (f.querySelector(`[name="${n}"]`)?.value || "").trim();
        if (v("website")) { f.reset(); say(L.done, true); return; } // 사람 눈에 안 보이는 칸이 채워졌으면 스팸 로봇
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
  function sessionStorageGet(k) { try { return sessionStorage.getItem("ut_" + k); } catch { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem("ut_" + k, v); } catch { /* 저장 못 해도 접수는 된다 */ } }
})();
