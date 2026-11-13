// 유어팀 홈페이지 — 움직임 · 메뉴 · 상담 신청. 라이브러리 없이 동작한다.
(() => {
  const d = document, root = d.documentElement;
  root.classList.add("js");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── 머리말: 내리면 반투명, 빠르게 내리면 숨고 올리면 나타난다
  const hd = d.querySelector("[data-hd]");
  const float = d.querySelector(".float");
  let lastY = 0;
  const onScroll = () => {
    const y = scrollY;
    hd?.classList.toggle("is-scrolled", y > 20);
    if (!d.body.classList.contains("menu-open")) hd?.classList.toggle("is-hidden", y > 400 && y > lastY + 4);
    if (y < lastY - 4) hd?.classList.remove("is-hidden");
    float?.classList.toggle("is-off", y < 300);
    lastY = y;
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ── 모바일 메뉴
  const burger = d.querySelector("[data-burger]");
  const mnav = d.getElementById("mnav");
  const setMenu = (open) => {
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
    mnav.hidden = !open;
    d.body.classList.toggle("menu-open", open);
    hd.classList.add("is-scrolled");
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
    const t0 = performance.now(), dur = 1600;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      el.textContent = fmt(end * e);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  // ── 화면에 들어오면 나타나기
  const groups = d.querySelectorAll("[data-stagger]");
  groups.forEach((g) => [...g.children].forEach((c, i) => { if (!c.hasAttribute("data-reveal")) c.setAttribute("data-reveal", g.dataset.stagger || ""); c.style.setProperty("--i", i); }));
  d.querySelectorAll(".bubbles").forEach((g) => [...g.children].forEach((c, i) => c.style.setProperty("--i", i)));
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const el = en.target;
      el.classList.add("is-in");
      el.querySelectorAll("[data-count]").forEach(countUp);
      if (el.matches("[data-count]")) countUp(el);
      io.unobserve(el);
    }
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
  d.querySelectorAll("[data-reveal], .bubbles, .steps, [data-count]").forEach((el) => io.observe(el));

  // ── 카드 위 빛이 마우스를 따라온다
  d.querySelectorAll(".bizcard").forEach((c) => c.addEventListener("pointermove", (e) => {
    const r = c.getBoundingClientRect();
    c.style.setProperty("--mx", `${e.clientX - r.left}px`);
    c.style.setProperty("--my", `${e.clientY - r.top}px`);
  }));

  // ── 첫 화면 영상: 움직임 줄이기 설정이면 멈춘다
  d.querySelectorAll("video[autoplay]").forEach((v) => { if (reduce) v.pause(); });

  // ── 살짝 따라 움직이는 그림 (data-parallax="0.15")
  const par = [...d.querySelectorAll("[data-parallax]")];
  if (par.length && !reduce) {
    const step = () => {
      const vh = innerHeight;
      for (const el of par) {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) continue;
        const k = parseFloat(el.dataset.parallax) || 0.1;
        el.style.transform = `translate3d(0, ${((r.top + r.height / 2 - vh / 2) * -k).toFixed(1)}px, 0)`;
      }
    };
    addEventListener("scroll", () => requestAnimationFrame(step), { passive: true });
    step();
  }

  // ── 상담 신청: 엔진의 상담 DB(/lead-in/<조직>)로 보낸다
  d.querySelectorAll("form[data-lead]").forEach((f) => {
    const out = f.querySelector("[data-msg]");
    const say = (text, ok) => { if (!out) return; out.textContent = text; out.className = "msg " + (ok ? "ok" : "err"); out.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" }); };
    const q = new URLSearchParams(location.search);
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
      const need = [["name", "업체명 · 담당자를 적어 주세요."], ["phone", "연락처를 적어 주세요."]];
      for (const [n, m] of need) {
        const el = f.querySelector(`[name="${n}"]`);
        if (el && !el.value.trim()) { e.preventDefault(); say(m, false); el.focus(); return; }
      }
      const agree = f.querySelector('[name="agree"]');
      if (agree && !agree.checked) { e.preventDefault(); say("개인정보 수집 · 이용에 동의해 주세요.", false); agree.focus(); return; }
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
        say("지금은 온라인 접수 준비 중입니다. 카카오톡이나 전화로 문의해 주세요.", false);
        return;
      }
      const btn = f.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = "보내는 중…"; }
    });
  });
  function sessionStorageGet(k) { try { return sessionStorage.getItem("ut_" + k); } catch { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem("ut_" + k, v); } catch { /* 저장 못 해도 접수는 된다 */ } }
})();
