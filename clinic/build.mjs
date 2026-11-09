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
import { optimizeMedia } from "./lib/media.mjs";
import { illust } from "./lib/illust.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ───────────────────────── 작은 도구 ─────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const br = (s) => esc(s).replace(/\n/g, "<br />");
const paras = (s) => String(s || "").split(/\n{2,}/).map((p) => `<p>${br(p.trim())}</p>`).join("");
// 제목을 줄마다 감싼다 — 화면에 들어올 때 한 줄씩 아래에서 올라온다(동작 줄이기면 그냥 보인다)
const lns = (t) => String(t).split("\n").map((l, i) => `<span class="ln" style="--i:${i}"><span>${esc(l)}</span></span>`).join("");
const telHref = (p) => "tel:" + String(p || "").replace(/[^0-9+]/g, "");
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
const DAY = { Mo: "Monday", Tu: "Tuesday", We: "Wednesday", Th: "Thursday", Fr: "Friday", Sa: "Saturday", Su: "Sunday" };

// 빌드 중 변환된 사진 목록 ("/media/a.jpg" → 폭별 WebP). build() 가 채운다.
let MEDIA = new Map();
// <img> 하나 — 변환본이 있으면 폭별 WebP 를 함께 내서 브라우저가 화면에 맞는 것만 받게 한다
function img(src, alt, { eager = false, sizes = "(max-width: 720px) 100vw, 760px", mobile = "" } = {}) {
  const m = MEDIA.get(src), mm = mobile ? MEDIA.get(mobile) : null;
  const set = (x) => x.webp.map(([w, u]) => `${u} ${w}w`).join(", ");
  const wh = m ? ` width="${m.w}" height="${m.h}"` : "";
  const mob = mobile ? (mm ? `<source media="(max-width: 720px)" type="image/webp" srcset="${set(mm)}" sizes="100vw" />` : `<source media="(max-width: 720px)" srcset="${esc(mobile)}" />`) : "";
  const web = m ? `<source type="image/webp" srcset="${set(m)}" sizes="${sizes}" />` : "";
  return `<picture>${mob}${web}<img src="${esc(src)}" alt="${esc(alt)}"${wh} ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" /></picture>`;
}

// 사진 자리. 사진이 있으면 그림을, 없으면 규격을 적은 빈 칸을 그린다 —
// 시안을 본 병원이 "여기엔 이 크기 사진이 들어간다"를 바로 알게.
function figure(pic, { ratio = "3/2", className = "", eager = false, mobile = null, sizes } = {}) {
  const alt = esc(pic?.alt || "");
  if (pic?.src) return `<div class="fig ${className}" style="aspect-ratio:${ratio}">${img(pic.src, pic.alt || "", { eager, mobile: mobile?.src, sizes })}</div>`;
  return `<div class="fig ph ${className}" style="aspect-ratio:${ratio}" role="img" aria-label="${alt || "사진 자리"}"><span>${esc(pic?.spec || "사진")}${alt ? `<small>${alt}</small>` : ""}</span></div>`;
}

// ───────────────────────── 읽기 ─────────────────────────
export function loadSite(id) {
  const dir = path.join(ROOT, "sites", id);
  const read = (f, fb) => (existsSync(path.join(dir, f)) ? JSON.parse(readFileSync(path.join(dir, f), "utf8")) : fb);
  const site = read("site.json");
  // 시안·견본 사이트는 다른 병원의 진료 원고를 빌려 쓸 수 있다 ("contentFrom": "cheonsaem")
  const from = site.contentFrom ? path.join(ROOT, "sites", site.contentFrom) : dir;
  const readFrom = (f, fb) => (existsSync(path.join(dir, f)) ? read(f, fb) : existsSync(path.join(from, f)) ? JSON.parse(readFileSync(path.join(from, f), "utf8")) : fb);
  const treatments = readFrom("treatments.json", []);
  const notices = readFrom("notices.json", []).sort((a, b) => b.date.localeCompare(a.date));
  site.siteUrl = String(site.siteUrl || "").replace(/\/$/, "");
  return { id, site, treatments, notices };
}

// ───────────────────────── 공통 틀 ─────────────────────────
function themeStyle(t = {}) {
  // 병원마다 바뀌는 건 이 몇 줄뿐이다. 나머지 모양은 site.css 가 정한다.
  const presets = {
    calm: { bg: "#F6F4EF", surface: "#FFFFFF", ink: "#1C2326", muted: "#5B6468", line: "#E2DDD3" },
    clean: { bg: "#FFFFFF", surface: "#F5F7F8", ink: "#15191C", muted: "#596168", line: "#E3E7EA" },
    ivory: { bg: "#FBF8F2", surface: "#FFFFFF", ink: "#26221E", muted: "#6B635A", line: "#E8E1D5" },
  };
  const p = presets[t.preset] || presets.calm;
  const accent = /^#[0-9a-f]{6}$/i.test(t.accent || "") ? t.accent : "#2B5F6B";
  return `<style>:root{--bg:${p.bg};--surface:${p.surface};--ink:${p.ink};--muted:${p.muted};--line:${p.line};--accent:${accent}}</style>`;
}

// 병원마다 '색'만 다르면 결국 다 같은 사이트로 보인다. 배치·글꼴도 고를 수 있게 한다.
//   type   : sans(고딕) | serif(제목만 명조)
//   layout : a(칸 나열형) | b(목록·잡지형)
const bodyClass = (t = {}) => [`t-${t.type === "serif" ? "serif" : "sans"}`, `L-${t.layout === "b" ? "b" : "a"}`].join(" ");

const NAV = [
  ["/about/", "병원 소개"],
  ["/doctors/", "의료진"],
  ["/treatments/", "진료 과목"],
  ["/guide/", "이용 안내"],
  ["/location/", "오시는 길"],
  ["/notice/", "공지사항"],
];

function layout(ctx, { path: p, title, description, body, jsonLd = [], ogImage = "", over = false, extraHead = "" }) {
  const { site, assetV } = ctx;
  const url = site.siteUrl + p;
  const fullTitle = p === "/" ? `${site.name} | ${site.tagline}` : `${title} | ${site.name}`;
  // 공유 썸네일: 페이지마다 만든 그림(ctx.og) > 원고에 지정한 그림 > 없음
  const ogKey = p === "/" ? "home" : p.replace(/^\/|\/$/g, "").replace(/\//g, "-");
  if (ctx.ogPlan) ctx.ogPlan.push({ key: ogKey, path: p, title: p === "/" ? site.tagline : title });
  const og = ogImage || (ctx.og ? `/og/${ogKey}.png` : "") || site.ogImage || "";
  const cur = (href) => (p.startsWith(href) ? ' aria-current="page"' : "");
  const navHtml = NAV.map(([href, label]) => `<a href="${href}"${cur(href)}>${label}</a>`).join("");
  // PC 상단 메뉴의 '진료 과목'은 올리면 과목별 진료가 펼쳐진다 — 병원 홈페이지에서 가장 많이 찾는 길이라 한 번에 닿게
  const mega = `<div class="mega"><div class="wrap mega-in">${site.categories.map((c) => {
    const list = ctx.treatments.filter((t) => t.category === c.id);
    return list.length ? `<div class="mega-col">${illust(c.id, "ill-sm")}<a class="mega-cat" href="/treatments/#${c.id}">${esc(c.name)}</a><ul>${list.map((t) => `<li><a href="/treatments/${t.slug}/">${esc(t.name)}</a></li>`).join("")}</ul></div>` : "";
  }).join("")}</div></div>`;
  const gnbHtml = NAV.map(([href, label]) => href === "/treatments/"
    ? `<div class="gnb-item"><a class="gl" href="${href}"${cur(href)}>${label}</a>${mega}</div>`
    : `<a class="gl" href="${href}"${cur(href)}>${label}</a>`).join("");
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
${site.theme?.type === "serif" ? `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500;600;700&display=swap" />` : ""}
<link rel="stylesheet" href="/assets/site.css?v=${assetV}" />
${themeStyle(site.theme)}
${jsonLd.map(ld).join("\n")}
${extraHead}
</head>
<body class="${bodyClass(site.theme)}">
<a class="skip" href="#main">본문 바로가기</a>
<header class="hd${over ? " hd-over" : ""}">
  <div class="wrap hd-in">
    <a class="logo" href="/" aria-label="${esc(site.name)} 홈">${site.logo ? `<img src="${esc(site.logo)}" alt="" />` : ""}<span>${esc(site.name)}</span></a>
    <nav class="gnb" aria-label="주 메뉴">${gnbHtml}</nav>
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
<script type="application/json" id="hours-data">${JSON.stringify({ hours: site.hours, lunch: site.lunch || "" }).replace(/</g, "\\u003c")}</script>
<script src="/assets/site.js?v=${assetV}" defer></script>
</body>
</html>
`;
}

function hoursTable(site) {
  const rows = site.hours.map((h) => `<tr data-days="${h.days.join(" ")}" data-close="${esc(h.close)}"><th scope="row">${esc(h.label)}</th><td>${esc(h.open)} – ${esc(h.close)}${h.note ? ` <em>${esc(h.note)}</em>` : ""}</td></tr>`).join("");
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
    <nav class="ft-nav" aria-label="바닥 메뉴">${NAV.map(([h, l]) => `<a href="${h}">${l}</a>`).join("")}<a href="/fees/">비급여 진료비</a><a href="/privacy/"><b>개인정보처리방침</b></a></nav>
  </div>
  <div class="wrap ft-note">
    <p>이 홈페이지의 의료 정보는 이해를 돕기 위한 일반적인 안내이며, 진료와 진단을 대신하지 않습니다. 치료 방법과 경과는 개인에 따라 다를 수 있습니다.</p>
    <p>© ${new Date().getFullYear()} ${esc(site.legalName || site.name)}</p>
  </div>
</footer>`;
}

function pageHead({ eyebrow, title, lead, crumbs = [], ill = "" }) {
  const c = crumbs.length
    ? `<nav class="crumb" aria-label="현재 위치"><a href="/">홈</a>${crumbs.map(([h, l]) => (h ? `<a href="${h}">${esc(l)}</a>` : `<span aria-current="page">${esc(l)}</span>`)).join("")}</nav>`
    : "";
  const art = ill ? illust(ill, "ill-lg") : "";
  return `<section class="phd${art ? " has-ill" : ""}"><div class="wrap">${c}<div class="phd-in"><div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ""}<h1 class="hl">${lns(title)}</h1>${lead ? `<p class="lead">${br(lead)}</p>` : ""}</div>${art ? `<div class="phd-ill">${art}</div>` : ""}</div></div></section>`;
}

function crumbLd(site, items) {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [["/", "홈"], ...items].map(([h, n], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: site.siteUrl + h })) };
}

function cta(site, title = "증상이 언제부터, 어디가 불편하신지 알려주세요") {
  return `<section class="cta"><div class="wrap cta-in">
    <div><h2>${esc(title)}</h2>
    <p>예약하시면 대기 시간이 줄어듭니다. 진료 전에 궁금한 점도 미리 여쭤보세요.</p></div>
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
  const variant = ["full", "editorial"].includes(site.theme?.hero) ? site.theme.hero : "split";
  // 제목은 줄마다 감싸 한 줄씩 떠오르게 한다 (동작 줄이기면 그냥 보인다)
  const lines = String(h.title).split("\n").map((l, i) => `<span class="ln" style="--i:${i}"><span>${esc(l)}</span></span>`).join("");
  const act = `<div class="hero-act"><a class="btn btn-lg" href="/reservation/">상담 예약하기<i aria-hidden="true">→</i></a><a class="btn btn-lg btn-line" href="/treatments/">진료 과목 보기</a></div>`;
  let hero;
  if (variant === "full") {
    // 첫 화면 전체를 사진·영상으로 채운다. 영상이 있으면 영상, 없으면 사진, 둘 다 없으면 규격을 적은 자리.
    const v = h.video?.src
      ? `<video class="hero-v" muted loop playsinline autoplay preload="metadata"${h.video.poster ? ` poster="${esc(h.video.poster)}"` : ""} aria-hidden="true"><source src="${esc(h.video.src)}" type="video/mp4" /></video>`
      : "";
    const photo = h.image?.src ? img(h.image.src, h.image.alt || "", { eager: true, sizes: "100vw", mobile: h.imageMobile?.src }) : "";
    const ph = !v && !photo ? `<span class="hero-spec">${esc(h.image?.spec || "메인 배너")}${h.video ? ` · ${esc(h.video.spec || "메인 영상 1920×1080")}` : ""}</span>` : "";
    hero = `<section class="hero hero-full">
    <div class="hero-media${!v && !photo ? " is-ph" : ""}">${v || photo}${ph}</div>
    <div class="hero-veil" aria-hidden="true"></div>
    <div class="wrap hero-in">
      <p class="eyebrow">${esc(h.eyebrow)}</p>
      <h1 class="hero-h">${lines}</h1>
      <p class="lead">${esc(h.body)}</p>
      ${act}
    </div>
    <a class="scroll-cue" href="#first" aria-label="아래로 이동"><span></span></a>
  </section>`;
  } else if (variant === "editorial") {
    // 잡지형: 큰 제목이 먼저, 그 아래 가로로 긴 사진이 막이 걷히듯 열린다. PC 배너(2:1)를 자르지 않고 그대로 쓴다.
    hero = `<section class="hero hero-ed"><div class="wrap">
    <p class="eyebrow">${esc(h.eyebrow)}</p>
    <h1 class="hero-h">${lines}</h1>
    <div class="ed-row"><p class="lead">${esc(h.body)}</p>${act}</div>
  </div>
  <div class="ed-media">${figure(h.image, { ratio: "2/1", className: "hero-fig", eager: true, mobile: h.imageMobile, sizes: "100vw" })}</div></section>`;
  } else {
    const heroImg = figure(h.image, { ratio: "1/1", className: "hero-fig", eager: true, mobile: h.imageMobile });
    hero = `<section class="hero hero-split"><div class="wrap hero-in">
    <div class="hero-txt"><p class="eyebrow">${esc(h.eyebrow)}</p><h1 class="hero-h">${lines}</h1><p class="lead">${esc(h.body)}</p>${act}</div>
    ${heroImg}
  </div></section>`;
  }
  // 첫 화면 바로 아래 빠른 안내 — 병원 홈페이지에 들어온 사람의 대부분은 이 네 가지 중 하나를 찾는다
  const quick = `<section class="quick" aria-label="빠른 안내"><div class="wrap quick-in">
    <a class="q q-today" href="/location/#hours" data-today><span class="q-k">오늘 진료</span><strong data-today-text>진료 시간 안내</strong><small data-today-sub>${esc(site.closed || "")}</small></a>
    <a class="q" href="${telHref(site.phone)}"><span class="q-k">전화 예약</span><strong>${esc(site.phone)}</strong><small>${esc(site.hours[0] ? `평일 ${site.hours[0].open} – ${site.hours[0].close}` : "")}</small></a>
    <a class="q" href="/reservation/"><span class="q-k">온라인 상담</span><strong>상담 예약하기</strong><small>확인 후 연락드립니다</small></a>
    <a class="q" href="/location/"><span class="q-k">오시는 길</span><strong>${esc(site.address.locality)}</strong><small>${esc((site.transit[0] || [])[1] || site.address.full)}</small></a>
  </div></section>`;

  const principles = `<section class="sec" id="first"><div class="wrap">
    <div class="sec-hd"><p class="eyebrow">진료 원칙</p><h2 class="hl">${lns(`${site.name}는\n이렇게 진료합니다`)}</h2></div>
    <ol class="steps">${site.principles.map(([t, d], i) => `<li><span class="num">${String(i + 1).padStart(2, "0")}</span><h3>${esc(t)}</h3><p>${esc(d)}</p></li>`).join("")}</ol>
  </div></section>`;

  const cats = `<section class="sec sec-alt"><div class="wrap">
    <div class="sec-hd row"><div><p class="eyebrow">진료 과목</p><h2 class="hl">${lns("어디가 불편하신가요?")}</h2></div><a class="more" href="/treatments/">전체 보기</a></div>
    <ul class="cats">${site.categories.map((c) => {
      const list = treatments.filter((t) => t.category === c.id);
      return `<li><a href="/treatments/#${c.id}"><span class="cat-no">${String(site.categories.indexOf(c) + 1).padStart(2, "0")}</span>${illust(c.id, "cat-ill")}<h3>${esc(c.name)}</h3><p>${esc(c.lead)}</p><span class="cat-list">${list.map((t) => esc(t.name)).join(" · ")}</span><i class="cat-go" aria-hidden="true">→</i></a></li>`;
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
    <div><p class="eyebrow">진료 시간</p><h2 class="hl">${lns("오늘 진료하나요?")}</h2>${hoursTable(site)}</div>
    <div><p class="eyebrow">오시는 길</p><h2 class="hl">${lns(`${site.address.locality}에 있습니다`)}</h2><p class="addr">${esc(site.address.full)}</p>
      <dl class="transit">${site.transit.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      <a class="more" href="/location/">지도 보기</a></div>
  </div></section>`;

  const news = notices.length ? `<section class="sec"><div class="wrap">
    <div class="sec-hd row"><div><p class="eyebrow">공지사항</p><h2 class="hl">${lns("병원 소식")}</h2></div><a class="more" href="/notice/">전체 보기</a></div>
    <ul class="notices">${notices.slice(0, 3).map((n) => `<li><a href="/notice/${n.slug}/"><time datetime="${n.date}">${n.date.replace(/-/g, ".")}</time><span>${esc(n.title)}</span></a></li>`).join("")}</ul>
  </div></section>` : "";

  const website = { "@context": "https://schema.org", "@type": "WebSite", name: site.name, url: site.siteUrl + "/", inLanguage: "ko-KR" };
  return layout(ctx, { path: "/", title: site.name, description: site.description,
    body: hero + quick + principles + cats + doc + visit + news + cta(site), over: variant === "full",
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
      <div class="sec-hd"><p class="eyebrow">진료 원칙</p><h2 class="hl">${lns("네 가지를 지킵니다")}</h2></div>
      <ol class="steps">${site.principles.map(([t, d], i) => `<li><span class="num">${String(i + 1).padStart(2, "0")}</span><h3>${esc(t)}</h3><p>${esc(d)}</p></li>`).join("")}</ol>
    </div></section>
    ${site.gallery?.length ? `<section class="sec"><div class="wrap"><div class="sec-hd"><p class="eyebrow">둘러보기</p><h2 class="hl">${lns("병원 공간")}</h2></div>
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
    `<div class="wrap fee-link"><a class="more" href="/fees/">비급여 진료비 보기</a></div>` +
    `<section class="sec"><div class="wrap">${site.categories.map((c) => {
      const list = treatments.filter((t) => t.category === c.id);
      if (!list.length) return "";
      return `<div class="tgroup" id="${c.id}"><div class="tgroup-hd">${illust(c.id, "ill-md")}<h2>${esc(c.name)}</h2><p>${esc(c.lead)}</p></div>
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
  const body = pageHead({ eyebrow: cat.name, title: t.name + (t.also ? `\n(${t.also})` : ""), lead: t.summary, crumbs: [["/treatments/", "진료 과목"], [null, t.name]], ill: t.category }) +
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

// 이용 안내(첫 방문) — 처음 오는 환자가 가장 많이 묻는 것: 무엇을 가져가나, 가면 무엇을 하나.
// 원고에 guide 가 없으면 어느 정형외과에나 맞는 기본 안내를 쓴다. 병원마다 다른 것(접수 마감 등)은 【확인 필요】로 둔다.
const DEFAULT_GUIDE = {
  steps: [
    ["접수", "신분증을 보여주시고, 처음 오셨다면 간단한 문진표를 작성합니다."],
    ["문진 · 진찰", "언제부터, 어떤 자세에서 아픈지 여쭙고 직접 진찰합니다."],
    ["검사", "필요한 경우에만 엑스레이·초음파 등 검사를 합니다."],
    ["진단 · 설명", "검사 결과를 함께 보며 원인과 치료 방법·기간·비용을 설명드립니다."],
    ["치료", "상태에 맞는 치료를 진행합니다."],
    ["수납 · 다음 예약", "필요하면 다음 진료를 예약하고, 서류가 필요하면 이때 말씀해 주세요."],
  ],
  bring: [
    ["신분증", "건강보험으로 진료받을 때 본인 확인을 합니다(2024년 5월부터). 모바일 신분증·모바일 건강보험증도 됩니다."],
    ["다른 병원 검사 결과", "엑스레이·MRI 영상(CD)이나 소견서가 있으면 가져오시면 검사를 줄일 수 있습니다."],
    ["복용 중인 약", "약 이름을 적어 오시거나 약 봉투를 사진으로 찍어 오세요. 혈액을 묽게 하는 약은 꼭 알려 주세요."],
  ],
  notes: [
    "예약하신 분을 먼저 진료하며, 예약 없이 오셔도 진료받으실 수 있습니다.",
    "【확인 필요】 접수 마감 시간 (예: 진료 종료 30분 전)",
    "실손보험 청구 서류(진료비 영수증·세부내역서 등)는 수납할 때 요청해 주세요.",
  ],
};
function guide(ctx) {
  const { site } = ctx;
  const G = { ...DEFAULT_GUIDE, ...(site.guide || {}) };
  const body = pageHead({ eyebrow: "이용 안내", title: "처음 오시는 분께", lead: "접수부터 진료가 끝날 때까지의 순서와, 오실 때 챙기시면 좋은 것을 정리했습니다.", crumbs: [[null, "이용 안내"]] }) +
    `<section class="sec"><div class="wrap">
      <div class="sec-hd"><p class="eyebrow">진료 순서</p><h2 class="hl">${lns("이렇게 진행됩니다")}</h2></div>
      <ol class="flow">${G.steps.map(([t, d], i) => `<li style="--n:${i}"><span class="flow-dot">${i + 1}</span><h3>${esc(t)}</h3><p>${esc(d)}</p></li>`).join("")}</ol>
    </div></section>
    <section class="sec sec-alt"><div class="wrap two">
      <div><div class="sec-hd"><p class="eyebrow">준비물</p><h2 class="hl">${lns("오실 때 챙겨 주세요")}</h2></div>
        <dl class="bring">${G.bring.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>
      <div><div class="sec-hd"><p class="eyebrow">알아두실 점</p><h2 class="hl">${lns("진료 전에 확인하세요")}</h2></div>
        <ul class="notes">${G.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
        <h3 class="mini-h">진료 시간</h3>${hoursTable(site)}</div>
    </div></section>${cta(site)}`;
  return layout(ctx, { path: "/guide/", title: "이용 안내", description: `${site.name} 이용 안내 — 처음 오시는 분을 위한 진료 순서와 준비물(신분증 등)을 안내합니다.`, body,
    jsonLd: [crumbLd(site, [["/guide/", "이용 안내"]])] });
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
        <div id="hours"><h2>진료 시간</h2>${hoursTable(site)}<p class="call">전화 <a href="${telHref(site.phone)}">${esc(site.phone)}</a></p></div>
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
      <div class="resv-call"><p class="today-pill" data-today><i aria-hidden="true"></i><strong data-today-text>진료 시간 안내</strong> <small data-today-sub></small></p><h2>전화 예약</h2><a class="big-tel" href="${telHref(site.phone)}">${esc(site.phone)}</a>${hoursTable(site)}
        <p class="warn">가슴 통증, 갑작스러운 마비, 심한 외상 등 응급 상황은 119 또는 가까운 응급실을 이용해 주세요.</p></div>
      <form class="form" id="form" method="post" ${ep ? `action="${esc(ep)}"` : ""} ${ep ? "" : 'aria-describedby="form-off"'}>
        <input type="hidden" name="return" value="/reservation/" />
        <h2>온라인 상담 신청</h2>
        ${ep ? "" : `<p class="form-off" id="form-off">온라인 접수는 준비 중입니다. 지금은 전화로 예약해 주세요.</p>`}
        <p class="form-msg" data-form-msg role="status" hidden></p>
        <div class="f2"><label>성함 <b aria-hidden="true">*</b><input name="name" required maxlength="40" autocomplete="name" /></label>
          <label>연락처 <b aria-hidden="true">*</b><input name="phone" type="tel" required maxlength="20" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000" /></label></div>
        <div class="f2"><label>불편한 부위<select name="budget"><option value="">선택해 주세요</option>${parts}</select></label>
          <label>통화 가능한 시간<input name="region" maxlength="40" placeholder="예: 평일 오후 2시 이후" /></label></div>
        <label>증상 · 문의 내용<textarea name="message" rows="5" maxlength="1000" placeholder="언제부터, 어떤 자세에서 불편한지 적어 주시면 상담에 도움이 됩니다."></textarea></label>
        <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" />
        <label class="agree"><input type="checkbox" name="agree" value="1" required /> <span><a href="/privacy/" target="_blank">개인정보 수집·이용</a>에 동의합니다. <small>입력하신 증상은 건강 정보로, 상담 목적에만 사용하고 상담 후 지체 없이 파기합니다.</small></span></label>
        ${ep && site.form?.turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${esc(site.form.turnstileSiteKey)}" data-language="ko"></div>` : ""}
        <button class="btn btn-lg btn-block" type="submit"${ep ? "" : " disabled"}>상담 신청하기</button>
      </form>
    </div></section>`;
  const ts = ep && site.form?.turnstileSiteKey ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : "";
  return layout(ctx, { path: "/reservation/", title: "상담 예약", extraHead: ts, description: `${site.name} 상담 예약 — 전화 ${site.phone} 또는 온라인으로 상담을 신청하세요.`, body,
    jsonLd: [crumbLd(site, [["/reservation/", "상담 예약"]])] });
}

// 비급여 진료비 안내 — 의료기관은 비급여 항목과 가격을 환자가 쉽게 볼 수 있게 알려야 하고,
// 홈페이지가 있으면 홈페이지에도 올려야 한다(의료법 제45조, 같은 법 시행규칙). 금액은 병원 내 게시와 같아야 한다.
function fees(ctx) {
  const { site } = ctx;
  const F = site.fees || { items: [] };
  const groups = [...new Set(F.items.map((r) => r[0]))];
  const body = pageHead({ eyebrow: "비용 안내", title: "비급여 진료비 안내", lead: "건강보험이 적용되지 않는 진료의 비용입니다. 병원 안에 게시한 금액과 같습니다.", crumbs: [[null, "비급여 진료비"]] }) +
    `<section class="sec"><div class="wrap narrow">
      ${F.items.length ? `<table class="fees"><caption>비급여 진료비 (단위: 원)</caption>
        <thead><tr><th scope="col">구분</th><th scope="col">항목</th><th scope="col">금액</th><th scope="col">비고</th></tr></thead>
        <tbody>${groups.map((g) => F.items.filter((r) => r[0] === g).map((r, i, arr) => `<tr>${i === 0 ? `<th scope="rowgroup" rowspan="${arr.length}">${esc(g)}</th>` : ""}<td>${esc(r[1])}</td><td class="num">${esc(r[2])}</td><td>${esc(r[3] || "")}</td></tr>`).join("")).join("")}</tbody></table>`
        : `<p>비급여 항목은 병원에 문의해 주세요. 대표전화 <a href="${telHref(site.phone)}">${esc(site.phone)}</a></p>`}
      <ul class="fee-notes">
        <li>위 금액은 「의료법」 제45조에 따라 고지하는 비급여 진료비용입니다.</li>
        <li>실제 비용은 진료 내용·횟수·부위에 따라 달라질 수 있으며, 진료 전에 미리 안내드립니다.</li>
        <li>실손보험 청구에 필요한 서류는 접수처에서 발급해 드립니다.</li>
      </ul>
      ${F.updated ? `<p class="meta">게시일: ${esc(F.updated)}</p>` : ""}
    </div></section>${cta(site)}`;
  return layout(ctx, { path: "/fees/", title: "비급여 진료비 안내", description: `${site.name} 비급여 진료비 안내 — 건강보험이 적용되지 않는 진료 항목과 비용을 안내합니다.`, body,
    jsonLd: [crumbLd(site, [["/fees/", "비급여 진료비"]])] });
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
export function build(id, { outDir, og = false } = {}) {
  const data = loadSite(id);
  const problems = lintTree({ site: data.site, treatments: data.treatments, notices: data.notices });
  if (problems.length) {
    const msg = problems.map((p) => `  · ${p.where}\n    "${p.word}" — ${p.why}\n    ${p.text}`).join("\n");
    throw new Error(`의료광고 금지 표현이 ${problems.length}건 있습니다. 고친 뒤 다시 빌드하세요.\n${msg}`);
  }
  const out = outDir || path.join(ROOT, "dist", id);
  rmSync(out, { recursive: true, force: true });
  const css = readFileSync(path.join(ROOT, "assets", "site.css"), "utf8");
  const js = readFileSync(path.join(ROOT, "assets", "site.js"), "utf8");
  MEDIA = optimizeMedia(path.join(ROOT, "sites", id, "media"), path.join(out, "media"), { cacheDir: path.join(ROOT, ".cache", id), log: console.log });
  const ctx = { ...data, og, ogPlan: [], assetV: createHash("sha1").update(css + js).digest("hex").slice(0, 8) };

  const pages = new Map();
  pages.set("/", home(ctx));
  pages.set("/about/", about(ctx));
  pages.set("/doctors/", doctors(ctx));
  pages.set("/treatments/", treatmentIndex(ctx));
  for (const t of data.treatments) pages.set(`/treatments/${t.slug}/`, treatmentPage(ctx, t));
  pages.set("/guide/", guide(ctx));
  pages.set("/location/", location(ctx));
  pages.set("/notice/", noticeIndex(ctx));
  for (const n of data.notices) pages.set(`/notice/${n.slug}/`, noticePage(ctx, n));
  pages.set("/reservation/", reservation(ctx));
  pages.set("/fees/", fees(ctx));
  pages.set("/privacy/", privacy(ctx));

  const write = (rel, content) => { const f = path.join(out, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, content); };
  for (const [p, h] of pages) write(p === "/" ? "index.html" : `${p}index.html`, h);
  write("404.html", notFound(ctx));
  write("assets/site.css", css);
  write("assets/site.js", js);

  const today = new Date().toISOString().slice(0, 10);
  const indexable = [...pages.keys()].filter((p) => p !== "/privacy/");
  write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map((p) => `  <url><loc>${data.site.siteUrl}${p}</loc><lastmod>${data.site.contentUpdated || today}</lastmod></url>`).join("\n")}\n</urlset>\n`);
  write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${data.site.siteUrl}/sitemap.xml\n`);
  write("llms.txt", llmsTxt(data));
  // 정적 호스팅(Cloudflare Pages)용 캐시 규칙 — CSS 는 주소에 해시가 붙으니 오래 두고, HTML 은 늘 새로
  write("_headers", `/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`);
  const initial = esc((data.site.shortName || data.site.name).slice(0, 1));
  write("favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${data.site.theme?.accent || "#2B5F6B"}"/><text x="32" y="44" font-family="sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="#fff">${initial}</text></svg>`);
  return { out, pages: [...pages.keys()], ogPlan: ctx.ogPlan.filter((x) => x.path !== "/404"), site: data.site };
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
