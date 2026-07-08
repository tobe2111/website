/* =========================================================
   서초구 상인회 — Interactions
   ========================================================= */
(function () {
  "use strict";

  var header = document.getElementById("siteHeader");
  var navToggle = document.getElementById("navToggle");
  var mainNav = document.getElementById("mainNav");
  var toTop = document.getElementById("toTop");

  /* ---- Mobile nav toggle ---- */
  function closeNav() {
    mainNav.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "메뉴 열기");
  }
  function openNav() {
    mainNav.classList.add("open");
    navToggle.setAttribute("aria-expanded", "true");
    navToggle.setAttribute("aria-label", "메뉴 닫기");
  }
  navToggle.addEventListener("click", function () {
    if (mainNav.classList.contains("open")) closeNav();
    else openNav();
  });
  // Close menu after clicking a link (mobile)
  mainNav.addEventListener("click", function (e) {
    if (e.target.tagName === "A") closeNav();
  });
  // Close on Escape
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeNav();
  });

  /* ---- Header shadow + to-top visibility on scroll ---- */
  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    header.classList.toggle("scrolled", y > 8);
    if (y > 500) {
      toTop.hidden = false;
      requestAnimationFrame(function () { toTop.classList.add("show"); });
    } else {
      toTop.classList.remove("show");
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  toTop.addEventListener("transitionend", function () {
    if (!toTop.classList.contains("show")) toTop.hidden = true;
  });
  toTop.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* ---- Active nav link on scroll (scroll spy) ---- */
  var navLinks = Array.prototype.slice.call(mainNav.querySelectorAll("a"));
  var sections = navLinks
    .map(function (a) {
      var id = a.getAttribute("href");
      return id && id.charAt(0) === "#" ? document.querySelector(id) : null;
    })
    .filter(Boolean);

  if ("IntersectionObserver" in window && sections.length) {
    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var id = "#" + entry.target.id;
            navLinks.forEach(function (a) {
              a.classList.toggle("active", a.getAttribute("href") === id);
            });
          }
        });
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
    );
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ---- Reveal on scroll ---- */
  var revealTargets = document.querySelectorAll(
    ".feature-card, .market-card, .event-card, .notice-list, .benefits-card, .benefit-list, .contact-form, .section-head"
  );
  Array.prototype.forEach.call(revealTargets, function (el) { el.classList.add("reveal"); });

  if ("IntersectionObserver" in window) {
    var revealObs = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry, i) {
          if (entry.isIntersecting) {
            entry.target.style.transitionDelay = Math.min(i * 60, 240) + "ms";
            entry.target.classList.add("in");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    Array.prototype.forEach.call(revealTargets, function (el) { revealObs.observe(el); });
  } else {
    Array.prototype.forEach.call(revealTargets, function (el) { el.classList.add("in"); });
  }

  /* ---- Animated hero counters ---- */
  var counters = document.querySelectorAll(".hero-stats dd[data-count]");
  function animateCount(el) {
    var target = parseInt(el.getAttribute("data-count"), 10);
    var suffixEl = el.querySelector("span");
    var suffix = suffixEl ? suffixEl.outerHTML : "";
    var start = null;
    var dur = 1400;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      var val = Math.floor(target * eased);
      el.innerHTML = val.toLocaleString("ko-KR") + suffix;
      if (p < 1) requestAnimationFrame(step);
      else el.innerHTML = target.toLocaleString("ko-KR") + suffix;
    }
    requestAnimationFrame(step);
  }
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (counters.length && "IntersectionObserver" in window && !reduceMotion) {
    var countObs = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCount(entry.target);
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.6 }
    );
    Array.prototype.forEach.call(counters, function (el) { countObs.observe(el); });
  }

  /* ---- Contact form (demo, client-side only) ---- */
  var form = document.getElementById("contactForm");
  var status = document.getElementById("formStatus");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.name.value.trim();
      var phone = form.phone.value.trim();
      status.className = "form-status";

      if (!name || !phone) {
        status.textContent = "이름/상호와 연락처를 입력해 주세요.";
        status.classList.add("err");
        return;
      }
      var phoneOk = /^[0-9+\-\s()]{7,}$/.test(phone);
      if (!phoneOk) {
        status.textContent = "연락처 형식을 확인해 주세요.";
        status.classList.add("err");
        return;
      }
      status.textContent = name + "님, 문의가 접수되었습니다. 빠른 시일 내에 연락드리겠습니다.";
      status.classList.add("ok");
      form.reset();
    });
  }

  /* ---- Footer year ---- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
