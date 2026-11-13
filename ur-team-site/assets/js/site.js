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

  // ── 상담 신청: 엔진의 상담 DB(/lead-in/)로 보낸다
  d.querySelectorAll("form[data-lead]").forEach((f) => {
    const out = f.querySelector("[data-msg]");
    const q = new URLSearchParams(location.search);
    if (q.get("sent") && out) { out.textContent = q.get("sent"); out.className = "msg ok"; }
    if (q.get("err") && out) { out.textContent = q.get("err"); out.className = "msg err"; }
    f.addEventListener("submit", (e) => {
      // 여러 칸(문제점·강점·URL·관심 서비스)을 상담 내용 한 칸으로 묶는다
      const parts = [];
      f.querySelectorAll("[data-msg-part]").forEach((el) => {
        if ((el.type === "checkbox" || el.type === "radio") && !el.checked) return;
        const v = (el.value || "").trim();
        if (v) parts.push(`${el.dataset.msgPart}: ${v}`);
      });
      const msg = f.querySelector('[name="message"]');
      if (msg) msg.value = parts.join("\n");
      if (!f.action || f.getAttribute("action") === "#") {
        e.preventDefault();
        if (out) { out.textContent = "지금은 온라인 접수 준비 중입니다. 카카오톡이나 전화로 문의해 주세요."; out.className = "msg err"; }
      }
    });
  });
})();
