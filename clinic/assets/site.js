// 병원 홈페이지 공통 동작 — 의존성 없음, 2KB 남짓.
//
// 원칙: 움직임은 '읽는 순서'를 알려줄 때만 쓴다. 장식으로 튀는 움직임은 넣지 않는다.
// 스크립트가 꺼져 있거나 '동작 줄이기'를 켠 사람에게는 모든 내용이 처음부터 그대로 보인다.
(() => {
  const root = document.documentElement;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.classList.add("js");
  if (!calm) root.classList.add("motion");

  // ── 1. 스크롤하면 구역이 차례로 떠오른다 ──
  // 같은 줄에 놓인 형제들은 조금씩 늦게(계단식) 나와 눈이 왼쪽→오른쪽으로 따라가게 한다.
  const REVEAL = ".sec-hd, .steps li, .cats li, .doc-hero > *, .visit > *, .notices li, .tgroup, .tlist li, .art-body > *, .art-body section > *, .cta-in > *, .phd .wrap > *, .gallery figure, .doc, .two > *, .map, .map-links, .form, .related";
  if (!calm && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    document.querySelectorAll(REVEAL).forEach((el) => {
      if (el.closest(".hero")) return;
      const sib = el.parentElement ? [...el.parentElement.children].indexOf(el) : 0;
      el.style.setProperty("--d", `${Math.min(sib, 5) * 70}ms`);
      el.classList.add("rv");
      io.observe(el);
    });
  }

  // ── 2. 머리: 내려가면 숨고, 올라오면 나타난다. 첫 화면 위에서는 투명하다 ──
  const hd = document.querySelector(".hd");
  const hero = document.querySelector(".hero");
  let lastY = scrollY, ticking = false;
  const onScroll = () => {
    const y = scrollY;
    if (hd) {
      hd.classList.toggle("scrolled", y > 8);
      const menuOpen = document.querySelector(".mnav[open]");
      hd.classList.toggle("hide", !menuOpen && y > 320 && y > lastY + 2);
      if (y < lastY - 2) hd.classList.remove("hide");
    }
    // 휴대폰 하단 전화·예약 바는 첫 화면을 지나서 올라온다 — 첫 화면의 큰 단추와 겹치지 않게
    const past = hero ? y > hero.offsetHeight * 0.6 : y > 120;
    document.body.classList.toggle("past-hero", past);
    lastY = y; ticking = false;
  };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  // ── 3. 휴대폰 메뉴: 열리면 뒤 화면을 잠그고, 메뉴를 누르면 닫는다 ──
  const mnav = document.querySelector(".mnav");
  if (mnav) {
    mnav.addEventListener("toggle", () => root.classList.toggle("lock", mnav.open));
    mnav.querySelectorAll("nav a").forEach((a) => a.addEventListener("click", () => { mnav.open = false; }));
    addEventListener("keydown", (e) => { if (e.key === "Escape" && mnav.open) { mnav.open = false; mnav.querySelector("summary").focus(); } });
  }

  // ── 4. 오늘 진료 상태 — "지금 진료 중 · 18:30까지" ──
  // 한국 시간 기준. 공휴일은 알 수 없으므로 밑줄에 늘 '공휴일 휴진'을 함께 적는다.
  const dataEl = document.getElementById("hours-data");
  if (dataEl) {
    const H = JSON.parse(dataEl.textContent);
    const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    const KO = { Su: "일", Mo: "월", Tu: "화", We: "수", Th: "목", Fr: "금", Sa: "토" };
    const min = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
    const kst = new Date(Date.now() + 9 * 3600e3);
    const todayCode = DAYS[kst.getUTCDay()];
    const now = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    const slot = (code) => H.hours.filter((h) => h.days.includes(code)).sort((a, b) => min(b.close) - min(a.close))[0];
    const next = () => {
      for (let i = 1; i <= 7; i++) {
        const c = DAYS[(kst.getUTCDay() + i) % 7], s = slot(c);
        if (s) return `${i === 1 ? "내일" : KO[c] + "요일"} ${s.open} 진료 시작`;
      }
      return "";
    };
    const lunch = (H.lunch || "").match(/(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})/);
    const s = slot(todayCode);
    let main, sub, state;
    if (!s) { main = "오늘은 휴진입니다"; sub = next(); state = "off"; }
    else if (now < min(s.open)) { main = `진료 전 · ${s.open} 시작`; sub = `오늘 ${s.close}까지`; state = "soon"; }
    else if (lunch && min(s.close) > min(lunch[2]) && now >= min(lunch[1]) && now < min(lunch[2])) { main = "점심시간입니다"; sub = `${lunch[2]}에 다시 진료합니다`; state = "soon"; }
    else if (now < min(s.close)) { main = "지금 진료 중"; sub = `오늘 ${s.close}까지${s.note ? ` · ${s.note}` : ""}`; state = "on"; }
    else { main = "오늘 진료가 끝났습니다"; sub = next(); state = "off"; }
    document.querySelectorAll("[data-today]").forEach((el) => {
      el.dataset.state = state;
      el.querySelector("[data-today-text]").textContent = main;
      el.querySelector("[data-today-sub]").textContent = sub + " · 공휴일 휴진";
    });
  }

  // ── 5. 진료 상세: 읽은 만큼 차오르는 막대 + 지금 읽는 목차 표시 ──
  const art = document.querySelector(".art-body");
  if (art) {
    const bar = document.createElement("div");
    bar.className = "progress"; bar.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span");
    bar.append(fill);
    document.body.append(bar);
    const links = new Map([...document.querySelectorAll(".toc a[href^='#']")].map((a) => [a.getAttribute("href").slice(1), a]));
    const secs = [...art.querySelectorAll("section[id]")];
    const update = () => {
      const r = art.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight * 0.6)));
      fill.style.transform = `scaleX(${p})`;
      let cur = secs[0];
      for (const s of secs) if (s.getBoundingClientRect().top < innerHeight * 0.35) cur = s;
      links.forEach((a, id) => a.classList.toggle("on", cur && id === cur.id));
    };
    addEventListener("scroll", () => requestAnimationFrame(update), { passive: true });
    update();
  }

  // ── 6. 첫 화면 영상: 데이터 절약 모드이거나 동작 줄이기면 틀지 않고 첫 장면 사진만 둔다 ──
  const v = document.querySelector(".hero video");
  if (v) {
    const save = navigator.connection && navigator.connection.saveData;
    if (calm || save) { v.removeAttribute("autoplay"); v.pause(); }
    else v.play().catch(() => {});
  }
})();
