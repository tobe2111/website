// 병원 홈페이지 빌더 — 원고(JSON) 몇 개를 받아 완성된 정적 사이트 한 벌을 만든다.
//
//   node clinic/build.mjs cheonsaem          → clinic/dist/cheonsaem/
//
// 서버도 DB 도 없다. 결과물은 HTML·CSS 파일뿐이라 어떤 정적 호스팅에 올려도 그대로 뜨고,
// 고장 날 곳이 없다. 병원마다 다른 것은 clinic/sites/<병원>/ 안의 원고와 색 몇 개뿐이다.
//
// 빌드가 대신 지키는 것:
//   · 의료광고 금지 표현이 원고에 있으면 멈춘다 (lib/adlint.mjs)
//   · 페이지마다 제목·설명·대표 주소·공유 썸네일·검색엔진용 병원 정보를 넣는다
//   · 사이트 지도·크롤러 안내·AI 검색용 요약(llms.txt)을 만든다
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintTree } from "./lib/adlint.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ───────────────────────── 작은 도구 ─────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const br = (s) => esc(s).replace(/\n/g, "<br />");
const paras = (s) => String(s || "").split(/\n{2,}/).map((p) => `<p>${br(p.trim())}</p>`).join("");
const telHref = (p) => "tel:" + String(p || "").replace(/[^0-9+]/g, "");
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
const DAY = { Mo: "Monday", Tu: "Tuesday", We: "Wednesday", Th: "Thursday", Fr: "Friday", Sa: "Saturday", Su: "Sunday" };

// 사진 자리. 사진이 있으면 그림을, 없으면 규격을 적은 빈 칸을 그린다 —
// 시안을 본 병원이 "여기엔 이 크기 사진이 들어간다"를 바로 알게.
function figure(img, { ratio = "3/2", className = "", eager = false, mobile = null } = {}) {
  const alt = esc(img?.alt || "");
  if (img?.src) {
    const m = mobile?.src ? `<source media="(max-width: 720px)" srcset="${esc(mobile.src)}" />` : "";
    return `<picture class="fig ${className}" style="aspect-ratio:${ratio}">${m}<img src="${esc(img.src)}" alt="${alt}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" /></picture>`;
  }
  return `<div class="fig ph ${className}" style="aspect-ratio:${ratio}" role="img" aria-label="${alt || "사진 자리"}"><span>${esc(img?.spec || "사진")}${alt ? `<small>${alt}</small>` : ""}</span></div>`;
}

// ───────────────────────── 읽기 ─────────────────────────
export function loadSite(id) {
  const dir = path.join(ROOT, "sites", id);
  const read = (f, fb) => (existsSync(path.join(dir, f)) ? JSON.parse(readFileSync(path.join(dir, f), "utf8")) : fb);
  const site = read("site.json");
  const treatments = read("treatments.json", []);
  const notices = read("notices.json", []).sort((a, b) => b.date.localeCompare(a.date));
  site.siteUrl = String(site.siteUrl || "").replace(/\/$/, "");
  return { id, site, treatments, notices };
}

// ───────────────────────── 공통 틀 ─────────────────────────
function themeStyle(t = {}) {
  // 병원마다 바뀌는 건 이 몇 줄뿐이다. 나머지 모양은 site.css 가 정한다.
  const presets = {
    calm: { bg: "#F6F4EF", surface: "#FFFFFF", ink: "#1C2326", muted: "#5B6468", line: "#E2DDD3" },
    clean: { bg: "#FFFFFF", surface: "#F5F7F8", ink: "#15191C", muted: "#596168", line: "#E3E7EA" },
  };
  const p = presets[t.preset] || presets.calm;
  const accent = /^#[0-9a-f]{6}$/i.test(t.accent || "") ? t.accent : "#2B5F6B";
  return `<style>:root{--bg:${p.bg};--surface:${p.surface};--ink:${p.ink};--muted:${p.muted};--line:${p.line};--accent:${accent}}</style>`;
}

const NAV = [
  ["/about/", "병원 소개"],
  ["/doctors/", "의료진"],
  ["/treatments/", "진료 과목"],
  ["/location/", "오시는 길"],
  ["/notice/", "공지사항"],
];

function layout(ctx, { path: p, title, description, body, jsonLd = [], ogImage = "" }) {
  const { site, assetV } = ctx;
  const url = site.siteUrl + p;
  const fullTitle = p === "/" ? `${site.name} | ${site.tagline}` : `${title} | ${site.name}`;
  const og = ogImage || site.ogImage || "";
  const navHtml = NAV.map(([href, label]) => `<a href="${href}"${p.startsWith(href) ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(url)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${esc(site.name)}" />
<meta property="og:title" content="${esc(fullTitle)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:locale" content="ko_KR" />
${og ? `<meta property="og:image" content="${esc(og.startsWith("http") ? og : site.siteUrl + og)}" />\n<meta name="twitter:card" content="summary_large_image" />` : ""}
<meta name="theme-color" content="${esc(site.theme?.accent || "#2B5F6B")}" />
${site.naverVerification ? `<meta name="naver-site-verification" content="${esc(site.naverVerification)}" />` : ""}
${site.googleVerification ? `<meta name="google-site-verification" content="${esc(site.googleVerification)}" />` : ""}
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
<link rel="stylesheet" href="/assets/site.css?v=${assetV}" />
${themeStyle(site.theme)}
${jsonLd.map(ld).join("\n")}
</head>
<body>
<a class="skip" href="#main">본문 바로가기</a>
<header class="hd">
  <div class="wrap hd-in">
    <a class="logo" href="/" aria-label="${esc(site.name)} 홈">${site.logo ? `<img src="${esc(site.logo)}" alt="" />` : ""}<span>${esc(site.name)}</span></a>
    <nav class="gnb" aria-label="주 메뉴">${navHtml}</nav>
    <div class="hd-act">
      <a class="hd-tel" href="${telHref(site.phone)}">${esc(site.phone)}</a>
      <a class="btn btn-sm" href="/reservation/">상담 예약</a>
    </div>
    <details class="mnav">
      <summary aria-label="메뉴 열기"><span></span><span></span><span></span></summary>
      <nav aria-label="모바일 메뉴">${navHtml}<a href="/reservation/">상담 예약</a></nav>
    </details>
  </div>
</header>
<main id="main">
${body}
</main>
${footer(ctx)}
<div class="dock" aria-label="빠른 연락">
  <a href="${telHref(site.phone)}">전화하기</a>
  <a href="/reservation/" class="on">상담 예약</a>
</div>
</body>
</html>
`;
}

function hoursTable(site) {
  const rows = site.hours.map((h) => `<tr><th scope="row">${esc(h.label)}</th><td>${esc(h.open)} – ${esc(h.close)}${h.note ? ` <em>${esc(h.note)}</em>` : ""}</td></tr>`).join("");
  return `<table class="hours"><tbody>${rows}${site.lunch ? `<tr><th scope="row">점심시간</th><td>${esc(site.lunch)}</td></tr>` : ""}</tbody></table>
  ${site.closed ? `<p class="hours-off">${esc(site.closed)}</p>` : ""}`;
}

function footer({ site }) {
  return `<footer class="ft">
  <div class="wrap ft-in">
    <div class="ft-brand">
      <strong>${esc(site.name)}</strong>
      <p>${esc(site.address.full)}<br />대표전화 <a href="${telHref(site.phone)}">${esc(site.phone)}</a></p>
      ${site.bizInfo ? `<p class="ft-biz">${esc(site.bizInfo)}</p>` : ""}
    </div>
    <div class="ft-hours"><h2>진료 시간</h2>${hoursTable(site)}</div>
    <nav class="ft-nav" aria-label="바닥 메뉴">${NAV.map(([h, l]) => `<a href="${h}">${l}</a>`).join("")}<a href="/privacy/"><b>개인정보처리방침</b></a></nav>
  </div>
  <div class="wrap ft-note">
    <p>이 홈페이지의 의료 정보는 이해를 돕기 위한 일반적인 안내이며, 진료와 진단을 대신하지 않습니다. 치료 방법과 경과는 개인에 따라 다를 수 있습니다.</p>
    <p>© ${new Date().getFullYear()} ${esc(site.legalName || site.name)}</p>
  </div>
</footer>`;
}

function pageHead({ eyebrow, title, lead, crumbs = [] }) {
  const c = crumbs.length
    ? `<nav class="crumb" aria-label="현재 위치"><a href="/">홈</a>${crumbs.map(([h, l]) => (h ? `<a href="${h}">${esc(l)}</a>` : `<span aria-current="page">${esc(l)}</span>`)).join("")}</nav>`
    : "";
  return `<section class="phd"><div class="wrap">${c}${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ""}<h1>${br(title)}</h1>${lead ? `<p class="lead">${br(lead)}</p>` : ""}</div></section>`;
}

function crumbLd(site, items) {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [["/", "홈"], ...items].map(([h, n], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: site.siteUrl + h })) };
}

function cta(site, title = "증상이 언제부터, 어디가 불편하신지 알려주세요") {
  return `<section class="cta"><div class="wrap cta-in">
    <h2>${esc(title)}</h2>
    <p>예약하시면 대기 시간이 줄어듭니다. 진료 전에 궁금한 점도 미리 여쭤보세요.</p>
    <div class="cta-act"><a class="btn btn-lg btn-inv" href="/reservation/">상담 예약하기</a><a class="btn btn-lg btn-ghost-inv" href="${telHref(site.phone)}">전화 ${esc(site.phone)}</a></div>
  </div></section>`;
}

// ───────────────────────── 검색엔진용 병원 정보 ─────────────────────────
// 검색엔진과 AI 는 화면이 아니라 이 정보를 읽고 "이곳은 정형외과, 진료시간은 몇 시, 위치는 어디" 를 안다.
function clinicLd(ctx) {
  const { site } = ctx;
  return {
    "@context": "https://schema.org",
    "@type": "MedicalClinic",
    "@id": site.siteUrl + "/#clinic",
    name: site.name,
    legalName: site.legalName,
    url: site.siteUrl + "/",
    description: site.description,
    telephone: site.phone,
    medicalSpecialty: site.specialty,
    image: site.ogImage ? site.siteUrl + site.ogImage : undefined,
    address: { "@type": "PostalAddress", streetAddress: site.address.street, addressLocality: site.address.locality,
      addressRegion: site.address.region, postalCode: site.address.postal, addressCountry: "KR" },
    geo: site.geo ? { "@type": "GeoCoordinates", latitude: site.geo.lat, longitude: site.geo.lng } : undefined,
    openingHoursSpecification: site.hours.map((h) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: h.days.map((d) => DAY[d]), opens: h.open, closes: h.close })),
    sameAs: [site.naverPlace, site.kakaoMap].filter(Boolean),
    employee: site.doctors.map((d) => ({ "@id": `${site.siteUrl}/doctors/#${d.name}` })),
  };
}
function doctorLd(site, d) {
  return { "@type": "Physician", "@id": `${site.siteUrl}/doctors/#${d.name}`, name: d.name, jobTitle: `${d.role} · ${d.title}`,
    medicalSpecialty: site.specialty, worksFor: { "@id": site.siteUrl + "/#clinic" } };
}

// ───────────────────────── 페이지들 ─────────────────────────
function home(ctx) {
  const { site, treatments, notices } = ctx;
  const h = site.hero;
  const variant = site.theme?.hero === "full" ? "full" : "split";
  const heroImg = figure(h.image, { ratio: variant === "full" ? "2/1" : "1/1", className: "hero-fig", eager: true, mobile: h.imageMobile });
  const hero = `<section class="hero hero-${variant}"><div class="wrap hero-in">
    <div class="hero-txt">
      <p class="eyebrow">${esc(h.eyebrow)}</p>
      <h1>${br(h.title)}</h1>
      <p class="lead">${esc(h.body)}</p>
      <div class="hero-act"><a class="btn btn-lg" href="/reservation/">상담 예약하기</a><a class="btn btn-lg btn-line" href="/treatments/">진료 과목 보기</a></div>
    </div>
    ${heroImg}
  </div></section>`;

  const principles = `<section class="sec"><div class="wrap">
    <div class="sec-hd"><p class="eyebrow">진료 원칙</p><h2>${esc(site.name)}는<br />이렇게 진료합니다</h2></div>
    <ol class="steps">${site.principles.map(([t, d], i) => `<li><span class="num">${String(i + 1).padStart(2, "0")}</span><h3>${esc(t)}</h3><p>${esc(d)}</p></li>`).join("")}</ol>
  </div></section>`;

  const cats = `<section class="sec sec-alt"><div class="wrap">
    <div class="sec-hd row"><div><p class="eyebrow">진료 과목</p><h2>어디가 불편하신가요?</h2></div><a class="more" href="/treatments/">전체 보기</a></div>
    <ul class="cats">${site.categories.map((c) => {
      const list = treatments.filter((t) => t.category === c.id);
      return `<li><a href="/treatments/#${c.id}"><h3>${esc(c.name)}</h3><p>${esc(c.lead)}</p><span class="cat-list">${list.map((t) => esc(t.name)).join(" · ")}</span></a></li>`;
    }).join("")}</ul>
  </div></section>`;

  const d = site.doctors[0];
  const doc = d ? `<section class="sec"><div class="wrap doc-hero">
    ${figure({ ...d.photo, alt: `${d.name} ${d.role}` }, { ratio: "4/5", className: "doc-fig" })}
    <div><p class="eyebrow">의료진</p><h2>${esc(d.name)} <small>${esc(d.role)}</small></h2><p class="doc-title">${esc(d.title)}</p>
      <blockquote>${br(site.greeting.body.split(/\n{2,}/)[0])}</blockquote>
      <a class="more" href="/doctors/">의료진 소개</a></div>
  </div></section>` : "";

  const visit = `<section class="sec sec-alt"><div class="wrap visit">
    <div><p class="eyebrow">진료 시간</p><h2>오늘 진료하나요?</h2>${hoursTable(site)}</div>
    <div><p class="eyebrow">오시는 길</p><h2>${esc(site.address.locality)}에 있습니다</h2><p class="addr">${esc(site.address.full)}</p>
      <dl class="transit">${site.transit.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      <a class="more" href="/location/">지도 보기</a></div>
  </div></section>`;

  const news = notices.length ? `<section class="sec"><div class="wrap">
    <div class="sec-hd row"><div><p class="eyebrow">공지사항</p><h2>병원 소식</h2></div><a class="more" href="/notice/">전체 보기</a></div>
    <ul class="notices">${notices.slice(0, 3).map((n) => `<li><a href="/notice/${n.slug}/"><time datetime="${n.date}">${n.date.replace(/-/g, ".")}</time><span>${esc(n.title)}</span></a></li>`).join("")}</ul>
  </div></section>` : "";

  const website = { "@context": "https://schema.org", "@type": "WebSite", name: site.name, url: site.siteUrl + "/", inLanguage: "ko-KR" };
  return layout(ctx, { path: "/", title: site.name, description: site.description,
    body: hero + principles + cats + doc + visit + news + cta(site),
    jsonLd: [clinicLd(ctx), website] });
}

function about(ctx) {
  const { site } = ctx;
  const body = pageHead({ eyebrow: "병원 소개", title: site.tagline, crumbs: [[null, "병원 소개"]] }) +
    `<section class="sec"><div class="wrap two">
      <div><p class="eyebrow">${esc(site.greeting.title)}</p><div class="prose">${paras(site.greeting.body)}</div>
        ${site.doctors[0] ? `<p class="sign">${esc(site.name)} ${esc(site.doctors[0].role)} <b>${esc(site.doctors[0].name)}</b></p>` : ""}</div>
      ${figure({ ...site.doctors[0]?.photo, alt: "원장 사진" }, { ratio: "4/5" })}
    </div></section>
    <section class="sec sec-alt"><div class="wrap">
      <div class="sec-hd"><p class="eyebrow">진료 원칙</p><h2>네 가지를 지킵니다</h2></div>
      <ol class="steps">${site.principles.map(([t, d], i) => `<li><span class="num">${String(i + 1).padStart(2, "0")}</span><h3>${esc(t)}</h3><p>${esc(d)}</p></li>`).join("")}</ol>
    </div></section>
    ${site.gallery?.length ? `<section class="sec"><div class="wrap"><div class="sec-hd"><p class="eyebrow">둘러보기</p><h2>병원 공간</h2></div>
      <div class="gallery">${site.gallery.map((g) => `<figure>${figure(g, { ratio: "3/2" })}<figcaption>${esc(g.alt)}</figcaption></figure>`).join("")}</div></div></section>` : ""}
    ${cta(site)}`;
  return layout(ctx, { path: "/about/", title: "병원 소개", description: `${site.name} 소개 — ${site.tagline}`, body,
    jsonLd: [clinicLd(ctx), crumbLd(site, [["/about/", "병원 소개"]])] });
}

function doctors(ctx) {
  const { site } = ctx;
  const body = pageHead({ eyebrow: "의료진", title: "진료하는 사람", lead: "진료는 정형외과 전문의가 직접 합니다.", crumbs: [[null, "의료진"]] }) +
    `<section class="sec"><div class="wrap">${site.doctors.map((d) => `<article class="doc" id="${esc(d.name)}">
      ${figure({ ...d.photo, alt: `${d.name} ${d.role}` }, { ratio: "4/5", className: "doc-fig" })}
      <div><h2>${esc(d.name)} <small>${esc(d.role)}</small></h2><p class="doc-title">${esc(d.title)}</p>
        ${d.focus?.length ? `<p class="tags">${d.focus.map((f) => `<span>${esc(f)}</span>`).join("")}</p>` : ""}
        <h3>약력</h3><ul class="career">${d.career.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>
    </article>`).join("")}</div></section>${cta(site)}`;
  return layout(ctx, { path: "/doctors/", title: "의료진", description: `${site.name} 의료진 — ${site.doctors.map((d) => `${d.name} ${d.role}(${d.title})`).join(", ")}`, body,
    jsonLd: [{ "@context": "https://schema.org", "@graph": site.doctors.map((d) => doctorLd(site, d)) }, crumbLd(site, [["/doctors/", "의료진"]])] });
}

function treatmentIndex(ctx) {
  const { site, treatments } = ctx;
  const body = pageHead({ eyebrow: "진료 과목", title: "증상으로 찾아보세요", lead: "각 페이지는 증상 · 원인 · 진단 · 치료 · 회복 순서로 정리했습니다.", crumbs: [[null, "진료 과목"]] }) +
    `<section class="sec"><div class="wrap">${site.categories.map((c) => {
      const list = treatments.filter((t) => t.category === c.id);
      if (!list.length) return "";
      return `<div class="tgroup" id="${c.id}"><div class="tgroup-hd"><h2>${esc(c.name)}</h2><p>${esc(c.lead)}</p></div>
        <ul class="tlist">${list.map((t) => `<li><a href="/treatments/${t.slug}/"><h3>${esc(t.name)}${t.also ? `<small>${esc(t.also)}</small>` : ""}</h3><p>${esc(t.summary)}</p><span class="arrow" aria-hidden="true">→</span></a></li>`).join("")}</ul></div>`;
    }).join("")}</div></section>${cta(site)}`;
  return layout(ctx, { path: "/treatments/", title: "진료 과목", description: `${site.name} 진료 과목 — ${treatments.map((t) => t.name).join(", ")}`, body,
    jsonLd: [crumbLd(site, [["/treatments/", "진료 과목"]])] });
}

function treatmentPage(ctx, t) {
  const { site, treatments } = ctx;
  const cat = site.categories.find((c) => c.id === t.category) || { name: "진료" };
  const doc = site.doctors[0];
  const p = `/treatments/${t.slug}/`;
  const toc = [["symptoms", "이런 증상이 있다면"], ["causes", "원인"], ["diagnosis", "진단"], ["treatment", "치료"], ["recovery", "회복과 주의사항"], ["faq", "자주 묻는 질문"]];
  const related = treatments.filter((x) => x.category === t.category && x.slug !== t.slug);
  const body = pageHead({ eyebrow: cat.name, title: t.name + (t.also ? ` (${t.also})` : ""), lead: t.summary, crumbs: [["/treatments/", "진료 과목"], [null, t.name]] }) +
    `<div class="wrap art">
      <aside class="toc" aria-label="이 페이지 목차"><p>목차</p><ol>${toc.map(([id, l]) => `<li><a href="#${id}">${l}</a></li>`).join("")}</ol>
        <a class="btn btn-sm" href="/reservation/">상담 예약</a></aside>
      <article class="art-body">
        ${figure(t.image || { spec: "시술 대표 이미지 1600×1000", alt: t.name }, { ratio: "16/10" })}
        <section id="symptoms"><h2><span>01</span>이런 증상이 있다면</h2><ul class="check">${t.symptoms.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></section>
        <section id="causes"><h2><span>02</span>왜 생기나요?</h2><p>${esc(t.causes)}</p></section>
        <section id="diagnosis"><h2><span>03</span>어떻게 진단하나요?</h2><p>${esc(t.diagnosis)}</p></section>
        <section id="treatment"><h2><span>04</span>어떻게 치료하나요?</h2>
          <ol class="tx">${t.treatments.map(([a, b]) => `<li><h3>${esc(a)}</h3><p>${esc(b)}</p></li>`).join("")}</ol></section>
        <section id="recovery"><h2><span>05</span>회복과 주의사항</h2><p>${esc(t.recovery)}</p></section>
        <section id="faq"><h2><span>06</span>자주 묻는 질문</h2>
          <div class="faq">${t.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div></section>
        ${doc ? `<p class="reviewed">이 글은 <b>${esc(doc.name)} ${esc(doc.role)}</b>(${esc(doc.title)})가 감수했습니다.${site.contentUpdated ? ` · 최종 수정 <time datetime="${site.contentUpdated}">${site.contentUpdated.replace(/-/g, ".")}</time>` : ""}</p>` : ""}
        ${related.length ? `<nav class="related" aria-label="같은 진료 과목"><h2>${esc(cat.name)}의 다른 진료</h2><ul>${related.map((r) => `<li><a href="/treatments/${r.slug}/">${esc(r.name)}<span aria-hidden="true">→</span></a></li>`).join("")}</ul></nav>` : ""}
      </article>
    </div>${cta(site, `${t.name} 증상이 걱정되신다면`)}`;
  const page = {
    "@context": "https://schema.org", "@type": "MedicalWebPage", name: `${t.name} | ${site.name}`, url: site.siteUrl + p, inLanguage: "ko-KR",
    description: t.summary, lastReviewed: site.contentUpdated || undefined,
    reviewedBy: doc ? doctorLd(site, doc) : undefined,
    publisher: { "@id": site.siteUrl + "/#clinic" },
    about: { "@type": t.category === "nonsurgical" ? "MedicalTherapy" : "MedicalCondition", name: t.name, alternateName: t.also || undefined,
      ...(t.category === "nonsurgical" ? {} : {
        signOrSymptom: t.symptoms.map((s) => ({ "@type": "MedicalSignOrSymptom", name: s })),
        possibleTreatment: t.treatments.map(([a]) => ({ "@type": "MedicalTherapy", name: a })) }) },
  };
  const faq = { "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: t.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  return layout(ctx, { path: p, title: t.name + (t.also ? ` (${t.also})` : ""), description: `${t.summary} ${site.name}에서 증상·원인·치료 방법을 안내합니다.`.slice(0, 155),
    body, jsonLd: [page, faq, crumbLd(site, [["/treatments/", "진료 과목"], [p, t.name]])] });
}

function location(ctx) {
  const { site } = ctx;
  const q = encodeURIComponent(site.name);
  const body = pageHead({ eyebrow: "오시는 길", title: site.address.full, crumbs: [[null, "오시는 길"]] }) +
    `<section class="sec"><div class="wrap">
      <div class="map ph" role="img" aria-label="지도 자리"><span>지도<small>실제 주소 확정 후 카카오·네이버 지도를 연결합니다</small></span></div>
      <p class="map-links"><a class="btn btn-line" href="${site.naverPlace || `https://map.naver.com/p/search/${q}`}" rel="noopener" target="_blank">네이버 지도에서 보기</a>
        <a class="btn btn-line" href="${site.kakaoMap || `https://map.kakao.com/?q=${q}`}" rel="noopener" target="_blank">카카오맵에서 보기</a></p>
      <div class="two visit-detail">
        <div><h2>교통 · 주차</h2><dl class="transit">${site.transit.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>
        <div><h2>진료 시간</h2>${hoursTable(site)}<p class="call">전화 <a href="${telHref(site.phone)}">${esc(site.phone)}</a></p></div>
      </div>
      ${site.exterior ? figure(site.exterior, { ratio: "3/2" }) : ""}
    </div></section>`;
  return layout(ctx, { path: "/location/", title: "오시는 길", description: `${site.name} 오시는 길 — ${site.address.full}. ${site.transit.map(([k, v]) => `${k}: ${v}`).join(" / ")}`.slice(0, 155),
    body, jsonLd: [clinicLd(ctx), crumbLd(site, [["/location/", "오시는 길"]])] });
}

function noticeIndex(ctx) {
  const { site, notices } = ctx;
  const body = pageHead({ eyebrow: "공지사항", title: "병원 소식", crumbs: [[null, "공지사항"]] }) +
    `<section class="sec"><div class="wrap narrow"><ul class="notices">${notices.map((n) => `<li><a href="/notice/${n.slug}/"><time datetime="${n.date}">${n.date.replace(/-/g, ".")}</time><span>${esc(n.title)}</span></a></li>`).join("") || "<li>등록된 공지가 없습니다.</li>"}</ul></div></section>`;
  return layout(ctx, { path: "/notice/", title: "공지사항", description: `${site.name} 공지사항 — 진료 일정과 병원 소식`, body, jsonLd: [crumbLd(site, [["/notice/", "공지사항"]])] });
}
function noticePage(ctx, n) {
  const { site } = ctx;
  const p = `/notice/${n.slug}/`;
  const body = pageHead({ eyebrow: "공지사항", title: n.title, crumbs: [["/notice/", "공지사항"], [null, n.title]] }) +
    `<section class="sec"><div class="wrap narrow"><p class="meta"><time datetime="${n.date}">${n.date.replace(/-/g, ".")}</time></p><div class="prose">${paras(n.body)}</div>
      <p><a class="more" href="/notice/">목록으로</a></p></div></section>`;
  return layout(ctx, { path: p, title: n.title, description: String(n.body).replace(/\s+/g, " ").slice(0, 150), body,
    jsonLd: [crumbLd(site, [["/notice/", "공지사항"], [p, n.title]])] });
}

function reservation(ctx) {
  const { site } = ctx;
  const ep = site.form?.endpoint || "";
  const parts = (site.form?.parts || []).map((x) => `<option>${esc(x)}</option>`).join("");
  const body = pageHead({ eyebrow: "상담 예약", title: "상담 예약", lead: "남겨주신 연락처로 확인 전화를 드립니다. 급한 통증은 전화로 먼저 문의해 주세요.", crumbs: [[null, "상담 예약"]] }) +
    `<section class="sec"><div class="wrap two resv">
      <div class="resv-call"><h2>전화 예약</h2><a class="big-tel" href="${telHref(site.phone)}">${esc(site.phone)}</a>${hoursTable(site)}
        <p class="warn">가슴 통증, 갑작스러운 마비, 심한 외상 등 응급 상황은 119 또는 가까운 응급실을 이용해 주세요.</p></div>
      <form class="form" method="post" ${ep ? `action="${esc(ep)}"` : ""} ${ep ? "" : 'aria-describedby="form-off"'}>
        <h2>온라인 상담 신청</h2>
        ${ep ? "" : `<p class="form-off" id="form-off">온라인 접수는 준비 중입니다. 지금은 전화로 예약해 주세요.</p>`}
        <div class="f2"><label>성함 <b aria-hidden="true">*</b><input name="name" required maxlength="40" autocomplete="name" /></label>
          <label>연락처 <b aria-hidden="true">*</b><input name="phone" type="tel" required maxlength="20" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000" /></label></div>
        <div class="f2"><label>불편한 부위<select name="part"><option value="">선택해 주세요</option>${parts}</select></label>
          <label>통화 가능한 시간<input name="time" maxlength="40" placeholder="예: 평일 오후 2시 이후" /></label></div>
        <label>증상 · 문의 내용<textarea name="message" rows="5" maxlength="1000" placeholder="언제부터, 어떤 자세에서 불편한지 적어 주시면 상담에 도움이 됩니다."></textarea></label>
        <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" />
        <label class="agree"><input type="checkbox" name="agree" value="1" required /> <span><a href="/privacy/" target="_blank">개인정보 수집·이용</a>에 동의합니다. <small>입력하신 증상은 건강 정보로, 상담 목적에만 사용하고 상담 후 지체 없이 파기합니다.</small></span></label>
        <button class="btn btn-lg btn-block" type="submit"${ep ? "" : " disabled"}>상담 신청하기</button>
      </form>
    </div></section>`;
  return layout(ctx, { path: "/reservation/", title: "상담 예약", description: `${site.name} 상담 예약 — 전화 ${site.phone} 또는 온라인으로 상담을 신청하세요.`, body,
    jsonLd: [crumbLd(site, [["/reservation/", "상담 예약"]])] });
}

function privacy(ctx) {
  const { site } = ctx;
  const body = pageHead({ title: "개인정보처리방침", crumbs: [[null, "개인정보처리방침"]] }) +
    `<section class="sec"><div class="wrap narrow prose">
      <p>${esc(site.legalName || site.name)}(이하 '병원')은 「개인정보 보호법」에 따라 이용자의 개인정보를 보호하고 관련 고충을 신속하게 처리하기 위하여 다음과 같이 처리방침을 둡니다.</p>
      <h2>1. 수집 항목과 목적</h2><p>상담 예약 시 성함·연락처·불편한 부위·통화 가능 시간·문의 내용을 수집하며, 상담 예약 확인 연락에만 사용합니다. 불편한 부위와 증상은 건강에 관한 정보(민감정보)로, 이용자의 별도 동의를 받아 처리합니다.</p>
      <h2>2. 보유 기간</h2><p>상담 목적이 끝나면 지체 없이 파기합니다. 진료가 이루어진 경우의 진료기록은 「의료법」에서 정한 기간 동안 별도로 보관합니다.</p>
      <h2>3. 제3자 제공</h2><p>법령에 근거가 있는 경우를 제외하고 이용자의 개인정보를 외부에 제공하지 않습니다.</p>
      <h2>4. 이용자의 권리</h2><p>이용자는 언제든지 자신의 개인정보 열람·정정·삭제·처리정지를 요구할 수 있습니다. 대표전화(${esc(site.phone)})로 요청해 주세요.</p>
      <h2>5. 개인정보 보호책임자</h2><p>${esc(site.privacyOfficer || "【확인 필요】 성명 · 직책 · 연락처")}</p>
      <p class="meta">시행일: ${esc(site.privacyDate || "【확인 필요】")}</p>
    </div></section>`;
  return layout(ctx, { path: "/privacy/", title: "개인정보처리방침", description: `${site.name} 개인정보처리방침 — 상담 예약 시 수집하는 정보와 보관 기간, 이용자의 권리를 안내합니다.`, body });
}

function notFound(ctx) {
  return layout(ctx, { path: "/404", title: "페이지를 찾을 수 없습니다", description: "요청하신 페이지를 찾을 수 없습니다.",
    body: pageHead({ title: "페이지를 찾을 수 없습니다", lead: "주소가 바뀌었거나 삭제된 페이지입니다." }) +
      `<section class="sec"><div class="wrap"><p><a class="btn" href="/">홈으로</a> <a class="btn btn-line" href="/treatments/">진료 과목 보기</a></p></div></section>` });
}

// AI 검색(ChatGPT·퍼플렉시티 등)이 사이트를 한 번에 이해하도록 요점만 담은 안내문.
function llmsTxt({ site, treatments }) {
  const h = site.hours.map((x) => `${x.label} ${x.open}–${x.close}${x.note ? ` (${x.note})` : ""}`).join(", ");
  return `# ${site.name}

> ${site.description}

- 주소: ${site.address.full}
- 전화: ${site.phone}
- 진료 시간: ${h}${site.lunch ? `, 점심시간 ${site.lunch}` : ""}. ${site.closed || ""}
- 의료진: ${site.doctors.map((d) => `${d.name} ${d.role} (${d.title})`).join(", ")}

## 진료 과목
${treatments.map((t) => `- [${t.name}${t.also ? ` (${t.also})` : ""}](${site.siteUrl}/treatments/${t.slug}/): ${t.summary}`).join("\n")}

## 안내
- [병원 소개](${site.siteUrl}/about/)
- [의료진](${site.siteUrl}/doctors/)
- [오시는 길](${site.siteUrl}/location/)
- [상담 예약](${site.siteUrl}/reservation/)
`;
}

// ───────────────────────── 조립 ─────────────────────────
export function build(id, { outDir } = {}) {
  const data = loadSite(id);
  const problems = lintTree({ site: data.site, treatments: data.treatments, notices: data.notices });
  if (problems.length) {
    const msg = problems.map((p) => `  · ${p.where}\n    "${p.word}" — ${p.why}\n    ${p.text}`).join("\n");
    throw new Error(`의료광고 금지 표현이 ${problems.length}건 있습니다. 고친 뒤 다시 빌드하세요.\n${msg}`);
  }
  const out = outDir || path.join(ROOT, "dist", id);
  rmSync(out, { recursive: true, force: true });
  const css = readFileSync(path.join(ROOT, "assets", "site.css"), "utf8");
  const ctx = { ...data, assetV: createHash("sha1").update(css).digest("hex").slice(0, 8) };

  const pages = new Map();
  pages.set("/", home(ctx));
  pages.set("/about/", about(ctx));
  pages.set("/doctors/", doctors(ctx));
  pages.set("/treatments/", treatmentIndex(ctx));
  for (const t of data.treatments) pages.set(`/treatments/${t.slug}/`, treatmentPage(ctx, t));
  pages.set("/location/", location(ctx));
  pages.set("/notice/", noticeIndex(ctx));
  for (const n of data.notices) pages.set(`/notice/${n.slug}/`, noticePage(ctx, n));
  pages.set("/reservation/", reservation(ctx));
  pages.set("/privacy/", privacy(ctx));

  const write = (rel, content) => { const f = path.join(out, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, content); };
  for (const [p, h] of pages) write(p === "/" ? "index.html" : `${p}index.html`, h);
  write("404.html", notFound(ctx));
  write("assets/site.css", css);

  const today = new Date().toISOString().slice(0, 10);
  const indexable = [...pages.keys()].filter((p) => p !== "/privacy/");
  write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map((p) => `  <url><loc>${data.site.siteUrl}${p}</loc><lastmod>${data.site.contentUpdated || today}</lastmod></url>`).join("\n")}\n</urlset>\n`);
  write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${data.site.siteUrl}/sitemap.xml\n`);
  write("llms.txt", llmsTxt(data));
  // 정적 호스팅(Cloudflare Pages)용 캐시 규칙 — CSS 는 주소에 해시가 붙으니 오래 두고, HTML 은 늘 새로
  write("_headers", `/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`);
  const initial = esc((data.site.shortName || data.site.name).slice(0, 1));
  write("favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${data.site.theme?.accent || "#2B5F6B"}"/><text x="32" y="44" font-family="sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="#fff">${initial}</text></svg>`);
  // 병원이 보낸 사진·로고 (sites/<병원>/media/ → /media/)
  const media = path.join(ROOT, "sites", id, "media");
  if (existsSync(media)) for (const f of readdirSync(media)) { mkdirSync(path.join(out, "media"), { recursive: true }); copyFileSync(path.join(media, f), path.join(out, "media", f)); }
  return { out, pages: [...pages.keys()] };
}

// 공개 전에 병원에서 받아 채워야 할 자리 목록
export function pendingItems(id) {
  const { site, treatments, notices } = loadSite(id);
  const out = [];
  const walk = (v, p) => {
    if (typeof v === "string") { if (v.includes("【확인 필요】") || /○○|0{3}-0{3,4}/.test(v)) out.push(`${p}: ${v.replace("【확인 필요】", "").trim().slice(0, 40)}`); }
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!k.startsWith("_")) walk(x, p ? `${p}.${k}` : k);
  };
  walk(site, "site"); walk(treatments, "treatments"); walk(notices, "notices");
  if (/\.example$/.test(site.siteUrl)) out.push(`site.siteUrl: 실제 도메인으로 바꿔야 합니다 (${site.siteUrl})`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const id = process.argv[2];
  if (!id) { console.error("사용법: node clinic/build.mjs <병원 폴더 이름>   예) node clinic/build.mjs cheonsaem"); process.exit(1); }
  try {
    const { out, pages } = build(id);
    console.log(`✓ ${pages.length}개 페이지를 만들었습니다 → ${path.relative(process.cwd(), out)}`);
    // 공개 전에 채워야 할 자리(【확인 필요】)가 남아 있으면 알려준다 — 시안은 괜찮지만 공개하면 안 된다
    const todo = pendingItems(id);
    if (todo.length) console.log(`! 공개 전에 채울 자리 ${todo.length}곳:\n${todo.map((t) => "  · " + t).join("\n")}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
