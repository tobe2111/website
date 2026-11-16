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
// 머리말 · 꼬리말은 그 언어의 partials/ 에서 끼워 넣는다. assets/ 는 그대로 복사한다.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, cpSync, rmSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");
const site = JSON.parse(readFileSync(join(ROOT, "site.json"), "utf8"));
const BASE = site.url.replace(/\/$/, "");

const LANGS = {
  ko: { dir: SRC, prefix: "", hreflang: "ko" },
  en: { dir: join(SRC, "en"), prefix: "/en", hreflang: "en" },
};
// 언어마다 다른 문구 (site.json 의 i18n 이 기본값을 덮는다)
const T = (lang) => ({ ...site, ...(site.i18n?.[lang] || {}) });

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const partial = (lang, name) => {
  const f = join(LANGS[lang].dir, "partials", name + ".html");
  if (!existsSync(f)) throw new Error(`${lang}: partials/${name}.html 이 없습니다 (언어마다 따로 둡니다)`);
  return readFileSync(f, "utf8");
};

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
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

// 두 언어에 어떤 경로가 있는지 먼저 모은다 (서로 잇기 위해)
const pagesOf = (lang) => walk(join(LANGS[lang].dir, "pages")).filter((f) => f.endsWith(".html")).sort();
const postsOf = (lang) => posts(lang).map((p) => `/blog/${p.slug}/`);
const PATHS = Object.fromEntries(Object.keys(LANGS).map((l) => [l, new Set([...pagesOf(l).map((f) => routeOf(f, l).path), ...postsOf(l)])]));
const altUrl = (path, lang) => LANGS[lang].prefix + (PATHS[lang].has(path) ? path : "/");
// 영어판 첫 화면이 아직 없으면 언어 단추를 감춘다 (없는 곳으로 보내지 않게)
const ENGLISH_READY = PATHS.en.has("/");

function render(file, lang) {
  return renderRaw(readFileSync(file, "utf8"), file, routeOf(file, lang), lang);
}

function renderRaw(raw, file, route, lang) {
  const m = raw.match(/^<!--\s*(\{[\s\S]*?\})\s*-->\s*/);
  if (!m) throw new Error(`${file}: 맨 위에 {"title": …} 주석이 없습니다`);
  const meta = JSON.parse(m[1]);
  const t = T(lang);
  // <!--@ team --> 처럼 적으면 그 언어의 partials/team.html 을 끼워 넣는다
  let body = raw.slice(m[0].length).replace(/<!--@\s*([\w-]+)\s*-->/g, (_, n) => partial(lang, n));
  // 마케팅 상품 탭: 지금 보고 있는 상품에 표시
  if (meta.tab) body = body.replace(`data-tab="${meta.tab}"`, `data-tab="${meta.tab}" aria-current="page"`);
  const { path, url, out } = route;
  const title = meta.title ? `${meta.title} | ${t.name}` : t.fullTitle;
  const desc = meta.description || t.description;
  const image = BASE + (meta.image || site.ogImage);
  // 다른 언어 판 (검색엔진용)
  const alternates = Object.keys(LANGS).filter((l) => PATHS[l].has(path))
    .map((l) => `<link rel="alternate" hreflang="${LANGS[l].hreflang}" href="${BASE}${LANGS[l].prefix}${path}">`)
    .concat(PATHS.ko.has(path) ? [`<link rel="alternate" hreflang="x-default" href="${BASE}${path}">`] : []).join("\n");
  const vars = {
    lang, title: esc(title), description: esc(desc), canonical: BASE + url, image, alternates,
    ogLocale: lang === "en" ? "en_US" : "ko_KR",
    langKo: altUrl(path, "ko"), langEn: altUrl(path, "en"),
    home: LANGS[lang].prefix + "/",
    year: String(new Date().getFullYear()),
    formAction: esc(site.form?.endpoint || "#"),
    formOff: site.form?.endpoint ? "" : `<p class="msg err" id="form-off">${t.formOffText}</p>`,
    turnstile: site.form?.endpoint && site.form?.turnstileSiteKey
      ? `<div class="cf-turnstile" data-sitekey="${esc(site.form.turnstileSiteKey)}" data-language="${lang}" data-theme="light"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
      : "",
    retention: String(site.form?.retentionDays || 365),
    blogList: blogList(lang),
  };
  const fill = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? t[k] ?? "");
  // 지금 보고 있는 메뉴에 표시
  let header = partial(lang, "header");
  if (!ENGLISH_READY) header = header.replace(/<nav class="lang"[\s\S]*?<\/nav>\n?/, "").replace(/<p class="mnav__lang">[\s\S]*?<\/p>\n?/, "");
  if (meta.nav) header = header.replaceAll(`data-nav="${meta.nav}"`, `data-nav="${meta.nav}" aria-current="page"`);
  const html = fill(partial(lang, "head")) + fill(header) + `<main id="main">\n${fill(body)}\n</main>\n` + fill(partial(lang, "footer"));
  const dest = join(DIST, out);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, html);
  return url;
}

// ── 블로그 ────────────────────────────────────────────────
// <언어>/posts/ 아래 HTML 한 장 = 글 하나. 맨 위 주석에 제목 · 날짜 · 분류 · 요약 · 대표 사진을 적는다:
//   <!-- {"title": "…", "date": "2026-11-13", "category": "공지", "summary": "…", "cover": "/assets/img/…"} -->
// 날짜가 최신인 글이 목록 맨 위에 온다. 날짜가 오늘보다 뒤인 글은 그날 전까지 빌드에서 빠진다(예약 글).
function posts(lang) {
  const dir = join(LANGS[lang].dir, "posts");
  if (!existsSync(dir)) return [];
  const today = new Date().toISOString().slice(0, 10);
  return readdirSync(dir).filter((n) => n.endsWith(".html")).map((n) => {
    const raw = readFileSync(join(dir, n), "utf8");
    const m = raw.match(/^<!--\s*(\{[\s\S]*?\})\s*-->\s*/);
    if (!m) throw new Error(`${lang}/posts/${n}: 맨 위에 {"title": …} 주석이 없습니다`);
    return { ...JSON.parse(m[1]), slug: n.replace(/\.html$/, ""), body: raw.slice(m[0].length) };
  }).filter((p) => p.date <= today).sort((a, b) => (a.date < b.date ? 1 : -1));
}

function blogList(lang) {
  const t = T(lang);
  const list = posts(lang);
  if (!list.length) return `<p class="empty">${t.blogEmpty}</p>`;
  return `<div class="posts" data-stagger>` + list.map((p) => `
      <a class="post-card" href="${LANGS[lang].prefix}/blog/${p.slug}/">
        <div class="post-card__img">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : ""}</div>
        <div class="post-card__tx"><span class="k">${esc(p.category || t.blogDefaultCategory)} · <time datetime="${p.date}">${p.date.replace(/-/g, ".")}</time></span>
        <b>${esc(p.title)}</b><p>${esc(p.summary || "")}</p></div>
      </a>`).join("") + `\n    </div>`;
}

function renderPosts(lang) {
  const t = T(lang);
  const tpl = partial(lang, "post");
  return posts(lang).map((p) => {
    const file = join(LANGS[lang].dir, "posts", p.slug + ".html");
    const page = `<!-- ${JSON.stringify({ title: p.title, description: p.summary, nav: "blog", image: p.cover })} -->\n` +
      tpl.replace(/\{\{post(\w+)\}\}/g, (_, k) => ({ Title: esc(p.title), Date: p.date, DateDot: p.date.replace(/-/g, "."),
        Category: esc(p.category || t.blogDefaultCategory), Body: p.body, Cover: p.cover ? `<img class="post__cover" src="${esc(p.cover)}" alt="">` : "" })[k] ?? "");
    const path = `/blog/${p.slug}/`, url = LANGS[lang].prefix + path;
    return renderRaw(page, file, { path, url, out: url.replace(/^\//, "") + "index.html" }, lang);
  });
}

// 예전 주소(아임웹 · 프레이머) → 새 주소. 검색엔진 · 명함 · 광고에 남은 링크가 끊기지 않게 한다.
function redirects() {
  const lines = [];
  for (let [from, to] of Object.entries(site.redirects)) {
    // 영어판이 아직 없으면 영어 주소는 한국어 첫 화면으로
    if (!ENGLISH_READY && to.startsWith("/en/")) to = "/";
    lines.push(`${from} ${to} 301`);
    const dest = join(DIST, from.replace(/^\//, ""), "index.html");
    if (existsSync(dest)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${site.name}</title>` +
      `<link rel="canonical" href="${to}"><meta http-equiv="refresh" content="0; url=${to}">` +
      `<p><a href="${to}">새 주소로 이동합니다 · Moving to the new address</a></p></html>`);
  }
  writeFileSync(join(DIST, "_redirects"), lines.join("\n") + "\n");
}

function sitemap(urls) {
  writeFileSync(join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${BASE}${u}</loc></url>`).join("\n") + `\n</urlset>\n`);
  writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap.xml\n`);
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(join(ROOT, "assets"), join(DIST, "assets"), { recursive: true });
// static/ 은 사이트 맨 위에 그대로 놓는다 (_headers: 사진 보관 기간 등)
if (existsSync(join(ROOT, "static"))) cpSync(join(ROOT, "static"), DIST, { recursive: true });
const urls = [];
for (const lang of Object.keys(LANGS)) {
  urls.push(...pagesOf(lang).map((f) => render(f, lang)), ...renderPosts(lang));
}
redirects();
sitemap(urls);
console.log(`페이지 ${urls.length}개 → ${relative(process.cwd(), DIST) || DIST}`);
for (const lang of Object.keys(LANGS)) console.log(`  ${lang}: ${urls.filter((u) => (LANGS[lang].prefix ? u.startsWith(LANGS[lang].prefix + "/") : !u.startsWith("/en/"))).length}개`);
