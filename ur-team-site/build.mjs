// 유어팀 통합 홈페이지 빌드 — 외부 의존성 없음 (node 만 있으면 된다)
//
//   node ur-team-site/build.mjs          → ur-team-site/dist/
//
// 언어는 완전히 나뉜다. 한국어가 기본이다.
//   한국어: src/pages/   + src/partials/   + src/posts/    → /…
//   영어  : src/en/pages/ + src/en/partials/ + src/en/posts/ → /en/…
// 같은 경로에 두 언어 페이지가 다 있으면 서로를 '다른 언어 판'으로 잇는다
// (머리말의 KR · EN 단추, 검색엔진용 hreflang). 한쪽에만 있으면 그 언어의 첫 화면으로 보낸다.
//
// 페이지 한 장 = HTML 파일 하나. 맨 위 주석에 제목 · 설명을 적는다:
//   <!-- {"title": "국내 유통", "description": "…", "nav": "distribution"} -->
//   (선택) "name": 빵부스러기(홈 > 마케팅 > …)와 구조화 데이터에 쓸 짧은 이름. 없으면 제목에서 만든다.
// 머리말 · 꼬리말은 그 언어의 partials/ 에서 끼워 넣는다. assets/ 는 그대로 복사한다.
//
// 검색엔진 · AI 검색용으로 함께 만드는 것 (README 의 '검색 노출' 절):
//   페이지마다 구조화 데이터(JSON-LD), sitemap.xml(수정일 · 언어 짝), robots.txt(AI 수집기 허용),
//   llms.txt · llms-full.txt(AI 가 읽는 회사 요약), 블로그 RSS(/blog/rss.xml, /en/blog/rss.xml)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, cpSync, rmSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");
const site = JSON.parse(readFileSync(join(ROOT, "site.json"), "utf8"));

const BASE = site.url.replace(/\/$/, "");
const TODAY = new Date().toISOString().slice(0, 10);

const LANGS = {
  ko: { dir: SRC, prefix: "", hreflang: "ko", locale: "ko_KR", rss: "ko-KR" },
  en: { dir: join(SRC, "en"), prefix: "/en", hreflang: "en", locale: "en_US", rss: "en-US" },
};
// 언어마다 다른 문구 (site.json 의 i18n 이 기본값을 덮는다)
const T = (lang) => ({ ...site, ...(site.i18n?.[lang] || {}) });

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const shopBtn = (url, name) => url
  ? `<a class="btn p3-shop" href="${esc(url)}" target="_blank" rel="noopener">${name} 쇼핑몰 가기 <span aria-hidden="true">↗</span></a>`
  : `<span class="btn p3-shop is-soon" aria-disabled="true">${name} 쇼핑몰 <small>준비 중</small></span>`;
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const partial = (lang, name) => {
  const f = join(LANGS[lang].dir, "partials", name + ".html");
  if (!existsSync(f)) throw new Error(`${lang}: partials/${name}.html 이 없습니다 (언어마다 따로 둡니다)`);
  return readFileSync(f, "utf8");
};
const FRONT = /^<!--\s*(\{[\s\S]*?\})\s*-->\s*/;
const metaOf = (raw, file) => {
  const m = raw.match(FRONT);
  if (!m) throw new Error(`${file}: 맨 위에 {"title": …} 주석이 없습니다`);
  return { meta: JSON.parse(m[1]), body: raw.slice(m[0].length) };
};
// 글자만 남기기 (요약 · llms-full.txt 용)
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", rarr: "→", larr: "←", nearr: "↗" };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (all, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? all);
const plain = (html) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// ── 수정일: git 에 마지막으로 올라간 날. 아직 안 올린(고치는 중인) 파일은 오늘 ─────────
const GIT = (() => {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = new Set(execFileSync("git", ["status", "--porcelain", "--", "."], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString().split("\n").filter(Boolean).map((l) => join(top, l.slice(3).replace(/^.* -> /, "").replace(/^"|"$/g, ""))));
    return { top, dirty };
  } catch { return null; }
})();
const modCache = new Map();
function lastmod(file) {
  if (modCache.has(file)) return modCache.get(file);
  let d = TODAY;
  if (GIT && !GIT.dirty.has(file)) {
    try {
      d = execFileSync("git", ["log", "-1", "--format=%cs", "--", file], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || TODAY;
    } catch { /* git 이 없으면 오늘 */ }
  }
  modCache.set(file, d);
  return d;
}

// 페이지 파일 → 언어 안의 경로("/marketing/naver/")와 실제 주소("/en/marketing/naver/")
function routeOf(file, lang) {
  const rel = relative(join(LANGS[lang].dir, "pages"), file).replace(/\\/g, "/").replace(/\.html$/, "");
  let path;
  if (rel === "index") path = "/";
  else if (rel.endsWith("/index")) path = `/${rel.slice(0, -"/index".length)}/`;
  else path = `/${rel}/`;
  const url = LANGS[lang].prefix + path;
  return { path, url, out: url.replace(/^\//, "") + "index.html" };
}

// ── 블로그 ────────────────────────────────────────────────
// <언어>/posts/ 아래 HTML 한 장 = 글 하나. 맨 위 주석에 제목 · 날짜 · 분류 · 요약 · 대표 사진을 적는다:
//   <!-- {"title": "…", "date": "2026-11-13", "category": "공지", "summary": "…", "cover": "/assets/img/…"} -->
//   (선택) "updated": "2026-12-01" — 글을 크게 고친 날. 검색엔진에 '수정일'로 알린다.
// 날짜가 최신인 글이 목록 맨 위에 온다. 날짜가 오늘보다 뒤인 글은 그날 전까지 빌드에서 빠진다(예약 글).
const postCache = {};
function posts(lang) {
  if (postCache[lang]) return postCache[lang];
  const dir = join(LANGS[lang].dir, "posts");
  if (!existsSync(dir)) return (postCache[lang] = []);
  return (postCache[lang] = readdirSync(dir).filter((n) => n.endsWith(".html")).map((n) => {
    const file = join(dir, n);
    const { meta, body } = metaOf(readFileSync(file, "utf8"), `${lang}/posts/${n}`);
    return { ...meta, slug: n.replace(/\.html$/, ""), body, file };
  }).filter((p) => p.date <= TODAY).sort((a, b) => (a.date < b.date ? 1 : -1)));
}

// 두 언어에 어떤 경로가 있는지 먼저 모은다 (서로 잇기 위해)
const pagesOf = (lang) => walk(join(LANGS[lang].dir, "pages")).filter((f) => f.endsWith(".html")).sort();

// 조회수: 글마다 정해진 시작 숫자(1,000~35,000, 오래된 글일수록 큰 편) + 실제로 센 조회수(_worker.js · /api/views)
// 시작 숫자는 글 주소로 정해지므로 빌드할 때마다 바뀌지 않는다
function viewsBase(slug, date) {
  let h = 2166136261; for (const c of slug) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const r = (h % 100000) / 100000;
  const t0 = Date.UTC(2021, 0, 1), t1 = Date.UTC(2026, 10, 18);
  const age = Math.min(1, Math.max(0, (t1 - Date.parse(date)) / (t1 - t0)));
  return Math.round(1000 + 34000 * Math.min(1, 0.5 * age + 0.5 * Math.pow(r, 1.4)));
}
// 하루에 늘어나는 수: 글마다 4~24회로 정해 둔다. 기준일(2026-11-18 또는 글이 올라간 날)부터 날마다 더해진다
const VIEWS_T0 = Date.UTC(2026, 10, 18);
function viewsRate(key) {
  let h = 5381; for (const c of key) h = (Math.imul(h, 33) ^ c.charCodeAt(0)) >>> 0;
  return 4 + (h % 21);
}
function viewsTag(p, lang, hit) {
  const key = (lang === "en" ? "en/" : "") + p.slug, base = viewsBase(key, p.date), rate = viewsRate(key);
  const t0 = Math.max(VIEWS_T0, Date.parse(p.date));
  const n = base + Math.max(0, Math.floor((Date.now() - t0) / 864e5)) * rate;
  return ` · <span class="views" data-views="${key}" data-base="${base}" data-rate="${rate}" data-t0="${t0}"${hit ? " data-views-hit" : ""}>${lang === "en" ? "Views" : "조회"} ${n.toLocaleString("en-US")}</span>`;
}

const postsOf = (lang) => posts(lang).map((p) => `/blog/${p.slug}/`);
const PATHS = Object.fromEntries(Object.keys(LANGS).map((l) => [l, new Set([...pagesOf(l).map((f) => routeOf(f, l).path), ...postsOf(l)])]));
const altUrl = (path, lang) => LANGS[lang].prefix + (PATHS[lang].has(path) ? path : "/");
// 영어판 첫 화면이 아직 없으면 언어 단추를 감춘다 (없는 곳으로 보내지 않게)
const ENGLISH_READY = PATHS.en.has("/");

// 경로별 머리말 (빵부스러기 · 서비스 목록 · llms.txt 에 쓴다)
const META = Object.fromEntries(Object.keys(LANGS).map((l) => [l, new Map([
  ...pagesOf(l).map((f) => [routeOf(f, l).path, metaOf(readFileSync(f, "utf8"), f).meta]),
  ...posts(l).map((p) => [`/blog/${p.slug}/`, { title: p.title, description: p.summary }]),
])]));
// 짧은 이름: "네이버 광고 · 마케팅 상품" → "네이버 광고"
const shortName = (meta, lang) => meta?.name || (meta?.title || T(lang).name).replace(/\s*·\s*(마케팅 상품|Marketing Services)$/, "");
const HOME_NAME = { ko: "홈", en: "Home" };
const BLOG_NAME = { ko: "유어팀 블로그", en: "UrTeam Insights" };

// ── 구조화 데이터 (JSON-LD) ───────────────────────────────
// 검색엔진 · AI 가 "누가 · 무엇을 · 어디서" 를 기계로 읽게 한다. 회사 정보는 site.json 의 org 에서 온다.
const SERVICE = /^\/(distribution|export|marketing)\/([\w-]+\/)?$/;
const AREA = {
  "/distribution/": { ko: ["대한민국", "미국", "인도", "중국", "동남아시아", "중동", "일본", "유럽"], en: ["South Korea", "United States", "India", "China", "Southeast Asia", "Middle East", "Japan", "Europe"] },
  "/marketing/global-patients/": { ko: ["대한민국", "중국"], en: ["South Korea", "China"] },
};
// 날짜만 적힌 글은 한국 시간 오전 9시로 알린다 (시간대가 없으면 Google 이 경고한다)
const kst = (d) => (/^\d{4}-\d\d-\d\d$/.test(d) ? `${d}T09:00:00+09:00` : d);
const intlPhone = (p) => "+82-" + String(p).replace(/^0/, "");
const ORG_ID = BASE + "/#organization";

function organization(lang) {
  const t = T(lang), o = site.org || {};
  const addr = (a) => a && { "@type": "PostalAddress", ...a, addressCountry: "KR" };
  return {
    "@type": "Organization", "@id": ORG_ID,
    name: t.name,
    alternateName: (o.alternateName || []).filter((n) => n !== t.name),
    legalName: lang === "en" ? o.legalNameEn || o.legalName : o.legalName,
    url: BASE + "/",
    logo: o.logo && { "@type": "ImageObject", url: BASE + o.logo.url, width: o.logo.width, height: o.logo.height },
    image: BASE + site.ogImage,
    description: t.description,
    email: site.email,
    telephone: intlPhone(site.phone),
    taxID: o.businessNumber,
    address: addr(o.address?.[lang]),
    location: o.logistics?.[lang] && { "@type": "Place", name: o.logistics[lang].name, address: addr(o.logistics[lang].address) },
    contactPoint: [{
      "@type": "ContactPoint", contactType: "customer service", telephone: intlPhone(site.phone), email: site.email,
      url: BASE + LANGS[lang].prefix + "/contact/", areaServed: "KR", availableLanguage: ["Korean", "English"],
    }],
    knowsAbout: [...META[lang]].filter(([p]) => SERVICE.test(p)).map(([, m]) => shortName(m, lang)),
    sameAs: [site.urdeal, site.kakao, ...(o.sameAs || [])].filter(Boolean),
  };
}

function jsonld(ctx) {
  const { lang, path, canonical, meta, image, post, modified, body = "" } = ctx;
  const t = T(lang), P = LANGS[lang].prefix;
  const siteId = BASE + P + "/#website", pageId = canonical + "#webpage";
  const graph = [organization(lang), {
    "@type": "WebSite", "@id": siteId, url: BASE + P + "/", name: t.name,
    alternateName: (site.org?.alternateName || []).filter((n) => n !== t.name),
    description: t.description, inLanguage: lang, publisher: { "@id": ORG_ID },
  }];
  const page = {
    "@type": path === "/blog/" ? "CollectionPage" : path === "/contact/" ? "ContactPage" : "WebPage",
    "@id": pageId, url: canonical, name: meta.title || t.fullTitle, description: meta.description || t.description,
    inLanguage: lang, isPartOf: { "@id": siteId },
    primaryImageOfPage: { "@type": "ImageObject", url: image },
    dateModified: modified,
  };
  if (path === "/") page.about = { "@id": ORG_ID };
  graph.push(page);

  // 빵부스러기: 홈 > 마케팅 > 네이버 광고
  if (path !== "/") {
    const segs = path.split("/").filter(Boolean);
    const items = [{ name: HOME_NAME[lang], url: BASE + P + "/" }];
    segs.forEach((_, i) => {
      const p = "/" + segs.slice(0, i + 1).join("/") + "/";
      if (p !== path && !META[lang].has(p)) return;
      items.push({ name: p === path ? (post ? post.title : shortName(meta, lang)) : shortName(META[lang].get(p), lang), url: BASE + P + p });
    });
    graph.push({
      "@type": "BreadcrumbList", "@id": canonical + "#breadcrumb",
      itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
    });
    page.breadcrumb = { "@id": canonical + "#breadcrumb" };
  }

  // 서비스 페이지: 국내 유통 · 해외 수출 · 마케팅/*
  if (SERVICE.test(path)) {
    const svc = {
      "@type": "Service", "@id": canonical + "#service", name: shortName(meta, lang), serviceType: shortName(meta, lang),
      description: meta.description, url: canonical, image, provider: { "@id": ORG_ID },
      areaServed: (AREA[path] || { ko: ["대한민국"], en: ["South Korea"] })[lang],
      availableChannel: { "@type": "ServiceChannel", serviceUrl: BASE + P + "/contact/", servicePhone: { "@type": "ContactPoint", telephone: intlPhone(site.phone), contactType: "customer service" } },
    };
    const kids = [...META[lang]].filter(([p]) => p !== path && p.startsWith(path) && SERVICE.test(p));
    if (kids.length) svc.hasOfferCatalog = {
      "@type": "OfferCatalog", name: shortName(meta, lang),
      itemListElement: kids.map(([p, m]) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: shortName(m, lang), url: BASE + P + p, description: m.description } })),
    };
    graph.push(svc);
    page.mainEntity = { "@id": svc["@id"] };
  }

  // 블로그 목록 · 글
  const blogId = BASE + P + "/blog/#blog";
  if (path === "/blog/") {
    graph.push({
      "@type": "Blog", "@id": blogId, url: canonical, name: BLOG_NAME[lang], description: meta.description,
      inLanguage: lang, publisher: { "@id": ORG_ID },
      blogPost: posts(lang).map((p) => ({ "@type": "BlogPosting", "@id": `${BASE}${P}/blog/${p.slug}/#article`, headline: p.title, url: `${BASE}${P}/blog/${p.slug}/`, datePublished: p.date })),
    });
    page.mainEntity = { "@id": blogId };
  }
  if (post) {
    graph.push({
      "@type": "BlogPosting", "@id": canonical + "#article", headline: post.title, description: meta.description,
      url: canonical, mainEntityOfPage: { "@id": pageId }, image: [image],
      datePublished: kst(post.date), dateModified: kst(modified),
      author: { "@id": ORG_ID }, publisher: { "@id": ORG_ID },
      inLanguage: lang, articleSection: post.category || t.blogDefaultCategory,
      ...(PATHS[lang].has("/blog/") ? { isPartOf: { "@id": blogId } } : {}),
    });
    page.mainEntity = { "@id": canonical + "#article" };
  }
  // 자주 묻는 질문(<section id="faq"> 안의 <details>)은 검색엔진이 질문 · 답으로 읽게 한다
  // 한 페이지에 질문 구역이 여럿이면(id="faq", id="faq-export") 모두 모은다
  const faqSecs = [...body.matchAll(/<section[^>]*id="faq[\w-]*"[\s\S]*?<\/section>/g)];
  if (faqSecs.length) {
    const text = (h) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const qa = [...faqSecs.map((m) => m[0]).join("").matchAll(/<summary>(?:<span[^>]*>[^<]*<\/span>)?([\s\S]*?)<\/summary>\s*<div class="acc__body">([\s\S]*?)<\/div>/g)]
      .map(([, q, a]) => ({ "@type": "Question", name: text(q), acceptedAnswer: { "@type": "Answer", text: text(a) } }));
    if (qa.length) graph.push({ "@type": "FAQPage", "@id": canonical + "#faq", inLanguage: lang, mainEntity: qa });
  }
  // 빈 값은 빼고, </script> 가 글 속에 있어도 깨지지 않게 '<' 를 바꿔 쓴다
  const clean = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, (k, v) =>
    v === undefined || v === "" || (Array.isArray(v) && !v.length) ? undefined : v);
  return `<script type="application/ld+json">${clean.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")}</script>`;
}

// 검색엔진 소유 확인 코드 — site.json 의 verification 에 적은 것만 넣는다
const VERIFY = { google: "google-site-verification", naver: "naver-site-verification", bing: "msvalidate.01" };
const verifyTags = () => Object.entries(VERIFY).filter(([k]) => site.verification?.[k])
  .map(([k, n]) => `<meta name="${n}" content="${esc(site.verification[k])}">`).join("\n");


// 파일 내용이 바뀌면 주소 끝의 ?v= 값도 바뀐다 → 브라우저 · Cloudflare 가 예전 CSS · 사진 · PDF 를 붙잡지 않는다
const VERSIONS = new Map();
function versioned(html) {
  return html.replace(/(["'(])(\/assets\/[^"'()?#\s]+)(?=["')])/g, (m, q, url) => {
    if (!VERSIONS.has(url)) {
      const file = join(ROOT, decodeURIComponent(url));
      VERSIONS.set(url, existsSync(file) ? createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 8) : "");
    }
    const v = VERSIONS.get(url);
    return v ? `${q}${url}?v=${v}` : m;
  });
}

// 휴대폰은 작은 사진만: tools/resize.py 가 만든 '이름.w800.webp' 가 있으면 <img> 에 srcset 을 단다
const WIDTHS = existsSync(join(ROOT, "tools", "img-widths.json")) ? JSON.parse(readFileSync(join(ROOT, "tools", "img-widths.json"), "utf8")) : {};
const ver = (url) => { versioned(`"${url}"`); const v = VERSIONS.get(url); return v ? `${url}?v=${v}` : url; };
// 예시 화면(.shot) 사진: 원래 크기보다 키우지 않으면서도, 사진이 뜨기 전에 제 자리 높이를
// 미리 비워 두게 한다 (안 그러면 사진이 뜨는 순간 아래 내용이 밀려 내려간다)
function shotSize(html) {
  return html.replace(/(<figure\b[^>]*class="([^"]*\bshot\b[^"]*)"[^>]*>\s*<img\b)([^>]*>)/g, (m, head, cls, rest) => {
    const w = +(rest.match(/\swidth="(\d+)"/) || [])[1], h = +(rest.match(/\sheight="(\d+)"/) || [])[1];
    if (!w || !h || /\sstyle=/.test(rest)) return m;
    const cap = /pblock__media/.test(cls) ? Math.min(w, Math.round(540 * w / h)) : w; // 칸 안 사진은 높이 540px 까지
    return `${head} style="max-width:min(100%,${cap}px)"${rest}`;
  });
}

function responsive(html) {
  return html.replace(/<img\b([^>]*?)\ssrc="(\/assets\/img\/[^"?]+)"([^>]*)>/g, (m, a, url, b, off, all) => {
    const w = WIDTHS[url];
    if (!w || /\ssrcset=/.test(a + b)) return m;
    const small = url.replace(/\.(webp|jpe?g|png)$/i, ".w800.webp");
    if (!existsSync(join(ROOT, small))) return m;
    // 화면 전체 배경(첫 화면)은 화면 폭 그대로, 나머지는 휴대폰 100% · PC 절반 기준
    const before = all.slice(Math.max(0, off - 80), off);
    const sizes = /(phero__bg|hero__bg|bizcard__img)[^<]*$/.test(before) || /phero__bg|hero__bg/.test(before) ? "100vw" : "(max-width: 760px) 100vw, 50vw";
    return `<img${a} src="${url}" srcset="${ver(small)} 800w, ${ver(url)} ${w}w" sizes="${sizes}"${b}>`;
  });
}

const PAGES = []; // 검색엔진에 내보내는 페이지 (sitemap · llms.txt · RSS 가 쓴다)

function render(file, lang) {
  return renderRaw(readFileSync(file, "utf8"), file, routeOf(file, lang), lang);
}

function renderRaw(raw, file, route, lang, post) {
  const { meta, body: rawBody } = metaOf(raw, file);
  const t = T(lang);
  // <!--@ team --> 처럼 적으면 그 언어의 partials/team.html 을 끼워 넣는다
  // 관련 글은 상담 안내(공통 조각 또는 그 페이지가 직접 쓴 것) 바로 위에 놓는다
  const withTopic = (h) => {
    const add = topicPosts(route.path, lang);
    if (!add) return h;
    if (/<!--@\s*cta\s*-->/.test(h)) return h.replace(/<!--@\s*cta\s*-->/, (m) => add + m);
    const at = h.lastIndexOf('<section class="cta">');
    return at < 0 ? h : h.slice(0, at) + add + h.slice(at);
  };
  let body = (post ? rawBody : withTopic(rawBody))
    .replace(/<!--@\s*([\w-]+)\s*-->/g, (_, n) => partial(lang, n));
  // 마케팅 상품 탭: 지금 보고 있는 상품에 표시
  if (meta.tab) body = body.replace(`data-tab="${meta.tab}"`, `data-tab="${meta.tab}" aria-current="page"`);
  const { path, url, out } = route;
  const title = meta.title ? ((meta.title + " | " + t.name).length > 60 ? meta.title : `${meta.title} | ${t.name}`) : t.fullTitle;
  const desc = meta.description || t.description;
  // 공유 그림: tools/og.mjs 가 만들어 둔 것(로고 + 페이지 이름)이 있으면 그것을 쓴다
  const ogSlug = url.replace(/^\/|\/$/g, "").replace(/\//g, "-") || "home";
  const image = BASE + (existsSync(join(ROOT, "assets", "img", "og", ogSlug + ".jpg")) ? `/assets/img/og/${ogSlug}.jpg` : (meta.image || site.ogImage));
  const canonical = BASE + url;
  const modified = post ? (post.updated || post.date) : lastmod(file);
  // 다른 언어 판 (검색엔진용)
  const langsHere = Object.keys(LANGS).filter((l) => PATHS[l].has(path));
  const alternates = langsHere
    .map((l) => `<link rel="alternate" hreflang="${LANGS[l].hreflang}" href="${BASE}${LANGS[l].prefix}${path}">`)
    .concat(PATHS.ko.has(path) ? [`<link rel="alternate" hreflang="x-default" href="${BASE}${path}">`] : []).join("\n");
  const rss = PATHS[lang].has("/blog/")
    ? `<link rel="alternate" type="application/rss+xml" title="${esc(BLOG_NAME[lang])}" href="${LANGS[lang].prefix}/blog/rss.xml">` : "";
  const headExtra = [
    meta.noindex ? `<meta name="robots" content="noindex, follow">` : `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">`,
    verifyTags(),
    ...langsHere.filter((l) => l !== lang).map((l) => `<meta property="og:locale:alternate" content="${LANGS[l].locale}">`),
    `<meta property="og:image:alt" content="${esc(meta.title || t.fullTitle)}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${image}">`,
    post ? `<meta property="article:published_time" content="${kst(post.date)}">\n<meta property="article:modified_time" content="${kst(modified)}">` +
      (post.category ? `\n<meta property="article:section" content="${esc(post.category)}">` : "") : "",
    rss,
    jsonld({ lang, path, canonical, meta: { ...meta, description: desc }, image, post, modified, body }),
  ].filter(Boolean).join("\n");
  const vars = {
    lang, title: esc(title), description: esc(desc), canonical, image, alternates, headExtra,
    ogLocale: LANGS[lang].locale, ogType: post ? "article" : "website",
    langKo: altUrl(path, "ko"), langEn: altUrl(path, "en"),
    home: LANGS[lang].prefix + "/",
    year: String(new Date().getFullYear()),
    formAction: esc(site.form?.endpoint || "#"),
    formOff: site.form?.endpoint ? "" : `<p class="msg err" id="form-off">${t.formOffText}</p>`,
    turnstile: site.form?.endpoint && site.form?.turnstileSiteKey
      ? `<div class="cf-turnstile" data-sitekey="${esc(site.form.turnstileSiteKey)}" data-language="${lang}" data-theme="light"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
      : "",
    retention: String(site.form?.retentionDays || 365),
    // 자체 브랜드 쇼핑몰 버튼: site.json 의 shops 에 주소를 넣으면 링크가 되고, 비어 있으면 '준비 중' 으로 보인다
    adeukShop: shopBtn(site.shops?.adeuk, "아득"),
    ondeungShop: shopBtn(site.shops?.ondeung, "온등"),
    blogList: blogList(lang),
  };
  const fill = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? t[k] ?? "");
  // 지금 보고 있는 메뉴에 표시
  let header = partial(lang, "header");
  if (!ENGLISH_READY) header = header.replace(/<nav class="lang"[\s\S]*?<\/nav>\n?/, "").replace(/<p class="mnav__lang">[\s\S]*?<\/p>\n?/, "");
  if (meta.nav) header = header.replaceAll(`data-nav="${meta.nav}"`, `data-nav="${meta.nav}" aria-current="page"`);
  const main = fill(body);
  const html = fill(partial(lang, "head")) + fill(header) + `<main id="main">\n${main}\n</main>\n` + fill(partial(lang, "footer"));
  const dest = join(DIST, out);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, versioned(responsive(shotSize(html))));
  if (!meta.noindex) PAGES.push({ lang, path, url, canonical, meta: { ...meta, description: desc }, title, modified, post, main });
  return url;
}

// 상품 · 서비스 페이지 맨 아래(상담 안내 바로 위)에 그 주제의 최신 글 3편을 붙인다.
// [블로그 주제(전체 보기가 가는 곳), 이 페이지에 맞는 글을 고르는 조건]. 조건에 맞는 글이 3편이 안 되면 같은 주제의 최신 글로 채운다.
const PAGE_TOPIC = {
  "/marketing/": ["마케팅 전략 · 성과", (p) => p.category === "마케팅 전략 · 성과"],
  "/marketing/naver/": ["네이버 광고", (p) => p.category === "네이버 광고"],
  "/marketing/google/": ["구글 · 인스타그램 광고", (p) => /google|retargeting|search-ads-vs-display/.test(p.slug)],
  "/marketing/meta/": ["구글 · 인스타그램 광고", (p) => /meta-|instagram/.test(p.slug)],
  "/marketing/daangn/": ["당근 · 지역 마케팅", (p) => /daangn/.test(p.slug)],
  "/marketing/momcafe/": ["당근 · 지역 마케팅", (p) => /momcafe|blog-cafe/.test(p.slug)],
  "/marketing/place/": ["당근 · 지역 마케팅", (p) => /place|review/.test(p.slug) && p.category !== "병원 마케팅"],
  "/marketing/blog-marketing/": ["블로그 · 콘텐츠", (p) => /blog/.test(p.slug) && p.category === "블로그 · 콘텐츠"],
  "/marketing/experience/": ["블로그 · 콘텐츠", (p) => /experience|influencer/.test(p.slug)],
  "/marketing/press/": ["블로그 · 콘텐츠", (p) => /press/.test(p.slug)],
  "/marketing/hospital/": ["병원 마케팅", (p) => p.category === "병원 마케팅" && !/global-patient|foreign-patient|xiaohongshu/.test(p.slug)],
  "/marketing/global-patients/": ["병원 마케팅", (p) => /global-patient|foreign-patient|xiaohongshu|douyin|wanghong/.test(p.slug)],
  "/distribution/": [["국내 유통", (p) => p.category === "국내 유통"], ["해외 수출", (p) => p.category === "해외 수출"]],
};
function topicPosts(path, lang) {
  if (lang !== "ko" || !PAGE_TOPIC[path]) return "";
  // 한 페이지가 두 분야를 다루면(유통 · 수출) 분야마다 한 줄씩
  if (Array.isArray(PAGE_TOPIC[path][0])) return PAGE_TOPIC[path].map((tp) => topicSection(tp, lang)).join("");
  return topicSection(PAGE_TOPIC[path], lang);
}
function topicSection([topic, pickFn], lang) {
  const all = posts(lang);
  const same = all.filter((p) => p.category === topic);
  const pick = [...new Set([...all.filter(pickFn), ...same])].slice(0, 3);
  if (pick.length < 3) return "";
  return `<section class="sec sec--soft topicposts"><div class="wrap">
    <div class="topicposts__head"><div><p class="eyebrow">블로그</p><h2 class="h3">${esc(topic)}, 더 깊이 읽기</h2></div>
    <a class="btn btn--ghost" href="/blog/#${encodeURIComponent(topic)}">${esc(topic)} 글 ${same.length}편 모두 보기 →</a></div>
    <div class="posts">` + pick.map((x) => `
      <a class="post-card" href="/blog/${x.slug}/">
        <div class="post-card__img">${x.cover ? `<img src="${esc(x.cover)}" alt="" loading="lazy">` : ""}</div>
        <div class="post-card__tx"><span class="k">${esc(x.category)} · <time datetime="${x.date}">${x.date.replace(/-/g, ".")}</time>${viewsTag(x, "ko")}</span>
        <b>${esc(x.title)}</b></div>
      </a>`).join("") + `\n    </div></div></section>\n\n`;
}

function blogList(lang) {
  const t = T(lang);
  const list = posts(lang);
  if (!list.length) return `<p class="empty">${t.blogEmpty}</p>`;
  // 분류 버튼: 글이 많아져도 원하는 주제만 골라 보게
  // 버튼 순서는 여기 적힌 대로(광고 → 지역 → 콘텐츠 → 전략 → 병원 → 유통 → 수출). 목록에 없는 분류는 뒤에 붙는다
  const ORDER = ["네이버 광고", "구글 · 인스타그램 광고", "당근 · 지역 마케팅", "블로그 · 콘텐츠", "마케팅 전략 · 성과", "병원 마케팅", "국내 유통", "해외 수출"];
  const rank = (c) => { const i = ORDER.indexOf(c); return i < 0 ? ORDER.length : i; };
  const cats = [...list.reduce((m, p) => m.set(p.category || t.blogDefaultCategory, (m.get(p.category || t.blogDefaultCategory) || 0) + 1), new Map())].sort((a, b) => rank(a[0]) - rank(b[0]));
  const bar = cats.length > 1 ? `<div class="pfilter" role="group" aria-label="${lang === "en" ? "Filter by topic" : "주제별로 보기"}"><button type="button" aria-pressed="true" data-f="all">${lang === "en" ? "All" : "전체"} <span>${list.length}</span></button>` +
    cats.map(([c, n]) => `<button type="button" aria-pressed="false" data-f="${esc(c)}">${esc(c)} <span>${n}</span></button>`).join("") + `</div>\n    ` : "";
  const en = lang === "en";
  const search = list.length > 12 ? `<div class="psearch"><label class="sr-only" for="psearch">${en ? "Search articles" : "글 검색"}</label><input id="psearch" type="search" placeholder="${en ? "Search articles" : "제목 · 내용으로 글 찾기"}" autocomplete="off" data-psearch><p class="psearch__n" data-pcount aria-live="polite"></p></div>\n    ` : "";
  const more = list.length > 12 ? `\n    <p class="pmore"><button type="button" class="btn btn--ghost" data-pmore data-label="${en ? "Show more" : "글 더 보기"}">${en ? "Show more" : "글 더 보기"}</button></p>\n    <p class="empty" data-pempty hidden>${en ? "No articles match." : "찾는 글이 없습니다. 다른 낱말로 찾아보세요."}</p>` : "";
  return bar + search + `<div class="posts" data-prods data-hide data-page="12" data-unit="${en ? "" : "편"}">` + list.map((p) => `
      <a class="post-card" data-cat="${esc(p.category || t.blogDefaultCategory)}" href="${LANGS[lang].prefix}/blog/${p.slug}/">
        <div class="post-card__img">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : ""}</div>
        <div class="post-card__tx"><span class="k">${esc(p.category || t.blogDefaultCategory)} · <time datetime="${p.date}">${p.date.replace(/-/g, ".")}</time>${viewsTag(p, lang)}</span>
        <b>${esc(p.title)}</b><p>${esc(p.summary || "")}</p></div>
      </a>`).join("") + `\n    </div>` + more;
}

// 요약이 없는 글은 본문 앞부분으로 설명을 만든다 (사이트 공통 설명이 글마다 겹치지 않게)
const excerpt = (html, n = 150) => { const s = plain(html); return [...s].length > n ? [...s].slice(0, n - 1).join("") + "…" : s; };

function renderPosts(lang) {
  const t = T(lang);
  const tpl = partial(lang, "post");
  const all = posts(lang);
  // 글 아래 '함께 읽으면 좋은 글' 세 편: 같은 분류의 글을 먼저, 모자라면 최신 글로 채운다
  const related = (p) => {
    const cat = (x) => x.category || t.blogDefaultCategory;
    // 제목에 같은 낱말이 많을수록, 같은 분야일수록, 날짜가 가까울수록 먼저 고른다 (글마다 다른 3편이 나오게)
    const words = (x) => new Set((x.title + " " + (x.summary || "")).replace(/[^0-9A-Za-z가-힣 ]/g, " ").split(/\s+/).filter((w) => w.length >= 2));
    const mine = words(p);
    const score = (x) => { let n = 0; for (const w of words(x)) if (mine.has(w)) n++; return n * 3 + (cat(x) === cat(p) ? 5 : 0) - Math.abs(Date.parse(x.date) - Date.parse(p.date)) / (864e5 * 365); };
    const rest = all.filter((x) => x.slug !== p.slug).map((x) => [score(x), x]).sort((a, b) => b[0] - a[0]).map(([, x]) => x);
    const pick = rest.slice(0, 3);
    if (!pick.length) return "";
    const same = all.filter((x) => cat(x) === cat(p)).length;
    const allLink = `<p class="post__more-all"><a class="btn btn--ghost" href="${LANGS[lang].prefix}/blog/#${encodeURIComponent(cat(p))}">${lang === "en" ? `All ${esc(cat(p))} articles (${same})` : `${esc(cat(p))} 글 ${same}편 모두 보기`} →</a></p>`;
    return `<section class="post__more"><div class="wrap"><h2 class="h3">${lang === "en" ? "Read next" : "함께 읽으면 좋은 글"}</h2><div class="posts">` + pick.map((x) => `
      <a class="post-card" href="${LANGS[lang].prefix}/blog/${x.slug}/">
        <div class="post-card__img">${x.cover ? `<img src="${esc(x.cover)}" alt="" loading="lazy">` : ""}</div>
        <div class="post-card__tx"><span class="k">${esc(cat(x))} · <time datetime="${x.date}">${x.date.replace(/-/g, ".")}</time>${viewsTag(x, lang)}</span>
        <b>${esc(x.title)}</b></div>
      </a>`).join("") + `\n    </div>${allLink}</div></section>`;
  };
  // 소제목에 번호표(id)를 달고 목차를 만든다. '참고한 자료'는 목차에서 뺀다
  const withToc = (html) => {
    const items = []; let i = 0;
    const body = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (m, inner) => {
      const id = "s" + (++i); if (!/참고한 자료|Sources/.test(inner)) items.push([id, plain(inner)]);
      return `<h2 id="${id}">${inner}</h2>`;
    });
    const toc = items.length >= 4 ? `<nav class="toc" aria-label="${lang === "en" ? "Contents" : "목차"}"><b>${lang === "en" ? "In this article" : "이 글의 순서"}</b><ol>` +
      items.map(([id, tx]) => `<li><a href="#${id}">${esc(tx)}</a></li>`).join("") + `</ol></nav>` : "";
    return { body, toc };
  };
  // 블로그 주제 → 상담 신청서에서 미리 체크할 칸(관심 분야, 마케팅 상품)
  const TOPIC_FORM = { "네이버 광고": "일반 마케팅,네이버 광고", "구글 · 인스타그램 광고": "일반 마케팅,구글 광고,메타(인스타그램) 광고",
    "당근 · 지역 마케팅": "일반 마케팅,당근마켓", "블로그 · 콘텐츠": "일반 마케팅,블로그 마케팅", "마케팅 전략 · 성과": "일반 마케팅",
    "병원 마케팅": "병원 마케팅", "국내 유통": "국내 유통", "해외 수출": "해외 수출" };
  const contactFor = (p) => `/contact/?${new URLSearchParams({ ...(TOPIC_FORM[p.category] ? { topic: TOPIC_FORM[p.category] } : {}), from: p.title })}`.replace(/&/g, "&amp;");
  // 글 끝 상담: 이름 · 연락처만 적으면 바로 접수되는 짧은 폼 + 카카오톡 · 전화
  // (상담 페이지로 한 번 더 넘어가지 않아도 되게. 접수 방식은 상담 페이지 폼과 같다)
  const EN_ = lang === "en";
  const aside = `<aside class="post__cta" id="ask">
      <div class="post__cta-tx"><b>${EN_ ? "How would this apply to your business?" : "이 주제, 우리 회사에는 어떻게 적용할까요?"}</b>
        <p>${EN_ ? "Leave your name and number and we will call you back. Consultations are free, and you get a full written quote before anything starts." : "이름과 연락처만 남기시면 담당자가 연락드립니다. 상담은 무료이고, 시작 전에 모든 비용이 적힌 견적서를 드립니다."}</p></div>
      <form class="qform" method="post" action="{{formAction}}" data-lead novalidate>
        <p class="msg" data-msg role="status" aria-live="polite"></p>
        <input type="hidden" name="message" value="">{{topicField}}
        <input type="hidden" data-msg-part="읽고 온 글" value="{{postTitle}}">
        <div class="qform__row">
          <label><span>${EN_ ? "Company · name" : "업체명 · 담당자"}</span><input name="name" required maxlength="60" autocomplete="organization" placeholder="${EN_ ? "e.g. UrTeam / Jane" : "예: 유어팀 / 홍길동"}"></label>
          <label><span>${EN_ ? "Phone" : "연락처"}</span><input name="phone" type="tel" required maxlength="20" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000"></label>
        </div>
        <label class="qform__q"><span>${EN_ ? "Question (optional)" : "궁금한 점 (선택)"}</span><input maxlength="300" data-msg-part="문의 내용" placeholder="${EN_ ? "e.g. Our ads cost too much per lead" : "예: 광고비 대비 문의가 적어요"}"></label>
        <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <label class="agree"><input type="checkbox" name="agree" value="1" required><span>${EN_ ? 'I agree to the collection and use of my details for this consultation (<a href="/en/privacy/" target="_blank">privacy policy</a>).' : '상담 회신을 위한 개인정보 수집 · 이용에 동의합니다 (<a href="/privacy/" target="_blank">개인정보처리방침</a>).'}</span></label>
        <button class="btn btn--blue btn--lg" type="submit">${EN_ ? "Request a free call" : "무료 상담 받기"} <span class="arr">→</span></button>
      </form>
      <p class="post__cta-alt"><span>${EN_ ? "Prefer to chat?" : "바로 물어보고 싶다면"}</span><a class="btn btn--kakao" href="${esc(site.kakao)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.8 5.3 4.6 6.7l-1 3.6c-.1.3.3.6.6.4l4.2-2.8c.5.1 1.1.1 1.6.1 5.5 0 10-3.6 10-8S17.5 3 12 3z"/></svg>${EN_ ? "KakaoTalk" : "카카오톡 상담"}</a><a class="btn btn--ghost" href="tel:${esc(site.phone)}">${EN_ ? "Call" : "전화"} ${esc(site.phone)}</a></p>
    </aside>
    <p class="post__share"><span>이 글 공유</span><button type="button" class="btn btn--ghost" data-share>공유하기</button><button type="button" class="btn btn--ghost" data-copy data-done="주소를 복사했습니다">주소 복사</button></p>`;
  return all.map((p) => {
    const { body: tocBody, toc } = withToc(p.body);
    const page = `<!-- ${JSON.stringify({ title: p.title, description: p.summary || excerpt(p.body), nav: "blog", image: p.cover })} -->\n` +
      tpl.replace(/\{\{post(\w+)\}\}/g, (_, k) => ({ Title: esc(p.title), Date: p.date, DateDot: p.date.replace(/-/g, "."), Views: viewsTag(p, lang, true),
        Category: esc(p.category || t.blogDefaultCategory), Body: tocBody, Toc: toc, Aside: aside.replace("{{postTitle}}", esc(p.title)).replace("{{topicField}}", !EN_ && TOPIC_FORM[p.category] ? TOPIC_FORM[p.category].split(",").map((v, i) => `<input type="hidden" data-msg-part="${i ? "마케팅 상품" : "관심 분야"}" value="${esc(v)}">`).join("") : ""), Cover: p.cover ? `<img class="post__cover" src="${esc(p.cover)}" alt="">` : "", Related: related(p) })[k] ?? "");
    const path = `/blog/${p.slug}/`, url = LANGS[lang].prefix + path;
    return renderRaw(page, p.file, { path, url, out: url.replace(/^\//, "") + "index.html" }, lang, p);
  });
}

// 예전 주소(아임웹 · 프레이머) → 새 주소. 검색엔진 · 명함 · 광고에 남은 링크가 끊기지 않게 한다.
// 이동 페이지는 검색 결과에 나오지 않게(noindex) 하고, 새 주소를 정식 주소(canonical)로 알린다.
function redirects() {
  const lines = [];
  for (let [from, to] of Object.entries(site.redirects)) {
    // 영어판이 아직 없으면 영어 주소는 한국어 첫 화면으로
    if (!ENGLISH_READY && to.startsWith("/en/")) to = "/";
    lines.push(`${from} ${to} 301`);
    // 끝에 / 를 붙여 들어와도 같은 곳으로 (안 그러면 이동 안내 페이지가 200 으로 먼저 열린다)
    if (!from.endsWith("/") && !site.redirects[from + "/"]) lines.push(`${from}/ ${to} 301`);
    const dest = join(DIST, from.replace(/^\//, ""), "index.html");
    if (existsSync(dest)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${site.name}</title>` +
      `<meta name="robots" content="noindex, follow"><link rel="canonical" href="${BASE}${to}"><meta http-equiv="refresh" content="0; url=${to}">` +
      `<p><a href="${to}">새 주소로 이동합니다 · Moving to the new address</a></p></html>`);
  }
  // 예전 아임웹 한국어 주소(/kr/…)는 위에서 따로 정하지 않은 것도 같은 이름의 새 주소로 보낸다 (Cloudflare 전용 규칙)
  lines.push("/kr/* /:splat 301");
  writeFileSync(join(DIST, "_redirects"), lines.join("\n") + "\n");
}

// ── sitemap.xml: 페이지마다 마지막 수정일과 다른 언어 판 ───────────────
function sitemap() {
  const rows = PAGES.map((p) => {
    const langs = Object.keys(LANGS).filter((l) => PATHS[l].has(p.path));
    const alts = langs.length > 1
      ? langs.map((l) => `\n    <xhtml:link rel="alternate" hreflang="${LANGS[l].hreflang}" href="${BASE}${LANGS[l].prefix}${p.path}"/>`).join("") +
        (PATHS.ko.has(p.path) ? `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${BASE}${p.path}"/>` : "")
      : "";
    return `  <url>\n    <loc>${xml(p.canonical)}</loc>\n    <lastmod>${p.post ? p.post.updated || p.post.date : p.modified}</lastmod>${alts}\n  </url>`;
  });
  writeFileSync(join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows.join("\n")}\n</urlset>\n`);
}

// ── robots.txt: 모두 허용. AI 검색 · 답변 서비스의 수집기도 이름을 불러 허용한다 ─────
const BOTS = [
  ["Googlebot", "Google 검색"], ["Bingbot", "Bing · ChatGPT 검색의 바탕"], ["Yeti", "네이버 검색"], ["Daumoa", "다음 검색"],
  ["GPTBot", "OpenAI"], ["OAI-SearchBot", "ChatGPT 검색"], ["ChatGPT-User", "ChatGPT 가 사용자 대신 읽을 때"],
  ["PerplexityBot", "Perplexity"], ["Perplexity-User", "Perplexity 가 사용자 대신 읽을 때"],
  ["ClaudeBot", "Anthropic Claude"], ["Claude-Web", "Anthropic Claude"], ["Claude-SearchBot", "Claude 검색"], ["Claude-User", "Claude 가 사용자 대신 읽을 때"],
  ["Google-Extended", "Gemini · Google AI"], ["Applebot", "Apple 검색 · Siri"], ["Applebot-Extended", "Apple Intelligence"],
];
function robots() {
  writeFileSync(join(DIST, "robots.txt"), `# 유어팀 ur-team.com — 검색엔진과 AI 검색 서비스 모두 환영합니다.\n# AI 가 읽기 좋은 요약: ${BASE}/llms.txt\n\n` +
    `User-agent: *\nAllow: /\n\n` + BOTS.map(([b, why]) => `# ${why}\nUser-agent: ${b}\nAllow: /\n`).join("\n") +
    `\nSitemap: ${BASE}/sitemap.xml\n`);
}

// ── 블로그 RSS ─────────────────────────────────────────────
const absUrls = (html) => html.replace(/\b(href|src|poster)="\/(?!\/)/g, `$1="${BASE}/`);
const rfc822 = (d) => new Date(`${d}T09:00:00+09:00`).toUTCString();
function rss(lang) {
  if (!PATHS[lang].has("/blog/")) return;
  const P = LANGS[lang].prefix, list = posts(lang), blog = META[lang].get("/blog/");
  const items = list.map((p) => {
    const link = `${BASE}${P}/blog/${p.slug}/`;
    return `    <item>\n      <title>${xml(p.title)}</title>\n      <link>${link}</link>\n      <guid isPermaLink="true">${link}</guid>\n` +
      `      <pubDate>${rfc822(p.date)}</pubDate>\n` + (p.category ? `      <category>${xml(p.category)}</category>\n` : "") +
      `      <description>${xml(p.summary || excerpt(p.body))}</description>\n` +
      `      <content:encoded><![CDATA[${absUrls(p.body).replace(/]]>/g, "]]]]><![CDATA[>")}]]></content:encoded>\n    </item>`;
  });
  const self = `${BASE}${P}/blog/rss.xml`;
  mkdirSync(join(DIST, P.replace(/^\//, ""), "blog"), { recursive: true });
  writeFileSync(join(DIST, P.replace(/^\//, ""), "blog", "rss.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">\n  <channel>\n` +
    `    <title>${xml(BLOG_NAME[lang])}</title>\n    <link>${BASE}${P}/blog/</link>\n    <description>${xml(blog?.description || T(lang).description)}</description>\n` +
    `    <language>${LANGS[lang].rss}</language>\n    <atom:link href="${self}" rel="self" type="application/rss+xml"/>\n` +
    `    <lastBuildDate>${rfc822(list[0]?.date || TODAY)}</lastBuildDate>\n` + (items.length ? items.join("\n") + "\n" : "") + `  </channel>\n</rss>\n`);
}

// ── llms.txt · llms-full.txt: AI 가 유어팀을 바르게 소개 · 인용하도록 사이트 내용을 글로 정리 ──
// 숫자 · 고객사는 첫 화면 HTML 에서 그대로 읽어 온다 (페이지와 어긋나지 않게 — 따로 적지 않는다).
function homeFacts(lang) {
  const f = join(LANGS[lang].dir, "pages", "index.html");
  if (!existsSync(f)) return { facts: [], clients: [] };
  const html = readFileSync(f, "utf8");
  const seen = new Set(), facts = [];
  const add = (v, k) => { v = decode(v.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim(); k = plain(k); if (v && k && !seen.has(k)) { seen.add(k); facts.push(`${v} — ${k}`); } };
  const rec = html.match(/<aside class="hero__rec"[\s\S]*?<\/aside>/)?.[0] || "";
  for (const m of rec.matchAll(/<li[^>]*><b>([\s\S]*?)<\/b><span>([\s\S]*?)<\/span><\/li>/g)) add(m[1], m[2]);
  const nums = html.match(/<div class="nums[\s\S]*?<\/section>/)?.[0] || "";
  for (const m of nums.matchAll(/<div><b>([\s\S]*?)<\/b><span>([\s\S]*?)<\/span><\/div>/g)) add(m[1].replace(/<small>([^<]*)<\/small>/, (_, s) => (lang === "en" && s && !/^[+%]/.test(s) ? " " : "") + s), m[2]);
  const band = html.match(/<section class="logoband"[\s\S]*?<\/section>/)?.[0] || "";
  const clients = [...new Set([...band.matchAll(/alt="([^"]+)"/g)].map((m) => decode(m[1])))];
  return { facts, clients };
}

const L = {
  ko: {
    about: "회사 정보", facts: "숫자로 본 유어팀 (홈페이지에 적힌 실적)", clients: "함께한 기관과 브랜드", services: "사업 분야",
    marketing: "마케팅 상품", blog: "블로그 글", etc: "그 밖의 페이지", contact: "문의",
    legal: "상호", ceo: "대표자", biz: "사업자등록번호", hq: "본사", logi: "인천 물류센터", tel: "대표번호", mail: "이메일", kakao: "카카오톡 상담",
    family: "패밀리 사이트", familyNote: "유어딜 — 우리 동네 맛집 · 카페 · 뷰티 이용권 할인", more: "더 보기",
    full: "모든 페이지 본문 (AI 용 전문)", map: "사이트맵", feed: "블로그 RSS",
  },
  en: {
    about: "Company", facts: "UrTeam in numbers (as stated on the website)", clients: "Institutions and brands we have worked with", services: "Services",
    marketing: "Marketing services", blog: "Articles", etc: "Other pages", contact: "Contact",
    legal: "Company", ceo: "CEO", biz: "Business registration no.", hq: "Head office", logi: "Incheon logistics center", tel: "Phone", mail: "Email", kakao: "KakaoTalk chat",
    family: "Family site", familyNote: "UrDeal — local deals on restaurants, cafes and beauty", more: "More",
    full: "Full text of every page (for AI)", map: "Sitemap", feed: "Blog RSS",
  },
};
const addrLine = (a) => a && (a.lang === "en" ? [a.streetAddress, a.addressLocality, a.addressRegion, "Korea"] : [a.addressRegion, a.addressLocality, a.streetAddress]).filter(Boolean).join(a.lang === "en" ? ", " : " ");

// 마케팅 상품을 소개하는 순서 (홈페이지 문구 순서와 같게)
const MK_ORDER = ["hospital", "global-patients", "naver", "google", "meta", "blog-marketing", "daangn", "momcafe", "place", "experience", "press"];
// 한 언어의 페이지를 소개 순서대로 묶는다: 첫 화면 · 사업 분야 · 마케팅 상품 · 그 밖 · 블로그 글
function grouped(lang) {
  const pages = PAGES.filter((p) => p.lang === lang);
  const top = pages.filter((p) => /^\/(distribution|export|marketing)\/$/.test(p.path));
  const rank = (p) => { const i = MK_ORDER.indexOf(p.path.split("/")[2]); return i < 0 ? 99 : i; };
  const mk = pages.filter((p) => /^\/marketing\/[\w-]+\/$/.test(p.path)).sort((a, b) => rank(a) - rank(b));
  const blog = pages.filter((p) => p.post);
  const home = pages.filter((p) => p.path === "/");
  const etc = pages.filter((p) => !top.includes(p) && !mk.includes(p) && !blog.includes(p) && !home.includes(p));
  return { home, top, mk, blog, etc, all: [...home, ...top, ...mk, ...etc, ...blog] };
}
function llmsSection(lang, level) {
  const t = T(lang), l = L[lang], o = site.org || {}, P = LANGS[lang].prefix, h = "#".repeat(level - 1);
  const { all, top, mk, blog, etc } = grouped(lang);
  if (!all.length) return "";
  const link = (p) => `- [${p.post ? p.post.title : shortName(p.meta, lang)}](${p.canonical})${p.post ? ` (${p.post.date})` : ""}: ${p.meta.description}`;
  const { facts, clients } = homeFacts(lang);
  const ad = (k) => o.address?.[lang] && addrLine({ ...o.address[lang], lang });
  const lg = o.logistics?.[lang] && addrLine({ ...o.logistics[lang].address, lang });
  const out = [
    `${h}# ${l.about}`, "",
    o.legalName && `- ${l.legal}: ${lang === "en" ? o.legalNameEn || o.legalName : o.legalName}${lang === "ko" && o.legalNameEn ? ` (${o.legalNameEn})` : ""}`,
    o.ceo && `- ${l.ceo}: ${lang === "en" ? o.ceoEn || o.ceo : o.ceo}`,
    o.businessNumber && `- ${l.biz}: ${o.businessNumber}`,
    ad() && `- ${l.hq}: ${ad()}`, lg && `- ${l.logi}: ${lg}`,
    `- ${l.tel}: ${lang === "en" ? intlPhone(site.phone) : site.phone}`, `- ${l.mail}: ${site.email}`, `- ${l.kakao}: ${site.kakao}`,
    `- ${l.contact}: ${BASE}${P}/contact/`,
    site.urdeal && `- ${l.family}: ${l.familyNote} (${site.urdeal})`, "",
    facts.length && [`${h}# ${l.facts}`, "", ...facts.map((f) => `- ${f}`), ""].join("\n"),
    clients.length && [`${h}# ${l.clients}`, "", clients.join(", "), ""].join("\n"),
    `${h}# ${l.services}`, "", ...top.map(link), "",
    mk.length && [`${h}# ${l.marketing}`, "", ...mk.map(link), ""].join("\n"),
    blog.length && [`${h}# ${l.blog}`, "", ...blog.map(link), ""].join("\n"),
    etc.length && [`${h}# ${l.etc}`, "", ...etc.map(link), ""].join("\n"),
  ];
  return out.filter((x) => x !== undefined && x !== false && x !== null && x !== 0).join("\n");
}

// 본문 HTML → 읽기 쉬운 글 (제목은 ###, 목록은 -)
function htmlToText(html) {
  return decode(html
    .replace(/<(script|style|svg|form|noscript|video|template)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, s) => `\n\n${"#".repeat(Math.min(+n + 2, 6))} ${plain(s)}\n\n`)
    .replace(/<li[^>]*>/gi, "\n- ").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|ul|ol|table|tr|blockquote|figure|aside|header)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n- *\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function llms() {
  const ko = T("ko"), en = T("en");
  const head = [
    `# ${ko.name} (${en.name})`, "",
    `> ${ko.description}`, "",
    `${ko.fullTitle}. 국내 유통 · 해외 수출 · 마케팅(병원 마케팅 · 해외 환자 유치 · 네이버 · 구글 · 블로그 · 당근마켓 · 맘카페 · 플레이스 · 체험단 · 언론)을 한 팀이 맡습니다.`,
    `이 문서는 ${BASE} 의 내용을 AI 검색 · 답변 서비스가 정확히 소개하도록 정리한 것입니다. 사실은 홈페이지에 적힌 그대로이며, 자세한 내용은 각 링크를 기준으로 합니다.`, "",
  ].join("\n");
  const tail = (lang) => [`## ${L[lang].more}`, "", `- [${L[lang].full}](${BASE}/llms-full.txt)`, `- [${L[lang].map}](${BASE}/sitemap.xml)`,
    PATHS[lang].has("/blog/") && `- [${L[lang].feed}](${BASE}${LANGS[lang].prefix}/blog/rss.xml)`].filter((x) => x !== false).join("\n");
  const english = ENGLISH_READY ? `\n## English\n\n> ${en.description}\n\n${llmsSection("en", 3)}\n` : "";
  writeFileSync(join(DIST, "llms.txt"), `${head}\n${llmsSection("ko", 2)}\n${english}\n${tail("ko")}\n`);

  // 전문: 페이지마다 제목 · 주소 · 본문
  const full = (lang) => grouped(lang).all.map((p) =>
    `## ${p.title}\n\nURL: ${p.canonical}\n${p.post ? `Date: ${p.post.date}\n` : ""}Description: ${p.meta.description}\n\n${htmlToText(p.main)}\n`).join("\n---\n\n");
  writeFileSync(join(DIST, "llms-full.txt"), `${head}\n${llmsSection("ko", 2)}\n# 페이지 전문 (한국어)\n\n${full("ko")}\n` +
    (ENGLISH_READY ? `\n# Full text (English)\n\n${full("en")}\n` : ""));
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(join(ROOT, "assets"), join(DIST, "assets"), { recursive: true });
// static/ 은 사이트 맨 위에 그대로 놓는다 (_headers: 사진 보관 기간 등)
if (existsSync(join(ROOT, "static"))) cpSync(join(ROOT, "static"), DIST, { recursive: true });
// 디자인 파일(CSS)은 설명 글 · 빈칸을 걷어내 가볍게 내보낸다 (원본은 그대로 두고 dist 만)
for (const f of ["assets/css/site.css"]) {
  const out = join(DIST, f);
  if (!existsSync(out)) continue;
  const css = readFileSync(out, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ")
    .replace(/\s*([{};])\s*/g, "$1").replace(/;}/g, "}").trim();
  writeFileSync(out, css);
}
const urls = [];
for (const lang of Object.keys(LANGS)) {
  urls.push(...pagesOf(lang).map((f) => render(f, lang)), ...renderPosts(lang));
}
// 없는 주소로 들어오면 보여 줄 화면 (Cloudflare Pages 는 가장 가까운 404.html 을 쓴다)
for (const lang of Object.keys(LANGS)) {
  const src = join(LANGS[lang].dir, "404.html");
  if (existsSync(src)) renderRaw(readFileSync(src, "utf8"), src, { path: "/404/", url: LANGS[lang].prefix + "/404/", out: (LANGS[lang].prefix ? LANGS[lang].prefix.slice(1) + "/" : "") + "404.html" }, lang);
}
redirects();
sitemap();
robots();
for (const lang of Object.keys(LANGS)) rss(lang);
llms();
console.log(`페이지 ${urls.length}개 → ${relative(process.cwd(), DIST) || DIST}`);
for (const lang of Object.keys(LANGS)) console.log(`  ${lang}: ${urls.filter((u) => (LANGS[lang].prefix ? u.startsWith(LANGS[lang].prefix + "/") : !u.startsWith("/en/"))).length}개`);
