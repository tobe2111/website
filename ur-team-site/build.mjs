// 유어팀 통합 홈페이지 빌드 — 외부 의존성 없음 (node 만 있으면 된다)
//
//   node ur-team-site/build.mjs          → ur-team-site/dist/
//
// src/pages/ 아래 HTML 한 장 = 페이지 하나. 맨 위 주석에 제목·설명을 적는다:
//   <!-- {"title": "국내 유통", "description": "…", "nav": "distribution"} -->
// 머리말·꼬리말은 src/partials/ 에서 끼워 넣는다. assets/ 는 그대로 복사한다.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, cpSync, rmSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");
const site = JSON.parse(readFileSync(join(ROOT, "site.json"), "utf8"));

const partial = (name) => readFileSync(join(SRC, "partials", name + ".html"), "utf8");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// 페이지 파일 경로 → 주소. index.html 은 폴더 주소, 나머지는 이름 폴더 아래 index.html
function routeOf(file) {
  const rel = relative(join(SRC, "pages"), file).replace(/\\/g, "/").replace(/\.html$/, "");
  if (rel === "index") return { url: "/", out: "index.html" };
  if (rel.endsWith("/index")) {
    const base = rel.slice(0, -"/index".length);
    return { url: `/${base}/`, out: `${base}/index.html` };
  }
  return { url: `/${rel}/`, out: `${rel}/index.html` };
}

function render(file) {
  return renderRaw(readFileSync(file, "utf8"), file, routeOf(file));
}

function renderRaw(raw, file, route) {
  const m = raw.match(/^<!--\s*(\{[\s\S]*?\})\s*-->\s*/);
  if (!m) throw new Error(`${file}: 맨 위에 {"title": …} 주석이 없습니다`);
  const meta = JSON.parse(m[1]);
  // <!--@ team --> 처럼 적으면 src/partials/team.html 을 끼워 넣는다 (여러 페이지가 같은 칸을 쓸 때)
  let body = raw.slice(m[0].length).replace(/<!--@\s*([\w-]+)\s*-->/g, (_, n) => partial(n));
  // 마케팅 상품 탭: 지금 보고 있는 상품에 표시
  if (meta.tab) body = body.replace(`data-tab="${meta.tab}"`, `data-tab="${meta.tab}" aria-current="page"`);
  const { url, out } = route;
  const title = meta.title ? `${meta.title} | ${site.name}` : site.fullTitle;
  const desc = meta.description || site.description;
  const canonical = site.url.replace(/\/$/, "") + url;
  const image = site.url.replace(/\/$/, "") + (meta.image || site.ogImage);
  const vars = {
    title: esc(title), description: esc(desc), canonical, image,
    bodyClass: meta.theme === "light" ? "theme-light" : "theme-dark",
    year: String(new Date().getFullYear()),
    formAction: esc(site.form?.endpoint || "#"),
    formOff: site.form?.endpoint ? "" : `<p class="msg err" id="form-off">온라인 접수는 준비 중입니다. 지금은 카카오톡이나 전화(${site.phone})로 문의해 주세요.</p>`,
    turnstile: site.form?.endpoint && site.form?.turnstileSiteKey
      ? `<div class="cf-turnstile" data-sitekey="${esc(site.form.turnstileSiteKey)}" data-language="ko" data-theme="light"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
      : "",
    retention: String(site.form?.retentionDays || 365),
    blogList: blogList(),
  };
  const fill = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? site[k] ?? "");
  // 지금 보고 있는 메뉴에 표시
  let header = partial("header");
  if (meta.nav) header = header.replace(`data-nav="${meta.nav}"`, `data-nav="${meta.nav}" aria-current="page"`);
  const html = fill(partial("head")) + fill(header) + `<main id="main">\n${fill(body)}\n</main>\n` + fill(partial("footer"));
  const dest = join(DIST, out);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, html);
  return url;
}

// ── 블로그 ────────────────────────────────────────────────
// src/posts/ 아래 HTML 한 장 = 글 하나. 맨 위 주석에 제목·날짜·분류·요약·대표 사진을 적는다:
//   <!-- {"title": "…", "date": "2026-11-13", "category": "공지", "summary": "…", "cover": "/assets/img/…"} -->
// 날짜가 최신인 글이 목록 맨 위에 온다. 날짜가 오늘보다 뒤인 글은 그날 전까지 빌드에서 빠진다(예약 글).
function posts() {
  const dir = join(SRC, "posts");
  if (!existsSync(dir)) return [];
  const today = new Date().toISOString().slice(0, 10);
  return readdirSync(dir).filter((n) => n.endsWith(".html")).map((n) => {
    const raw = readFileSync(join(dir, n), "utf8");
    const m = raw.match(/^<!--\s*(\{[\s\S]*?\})\s*-->\s*/);
    if (!m) throw new Error(`posts/${n}: 맨 위에 {"title": …} 주석이 없습니다`);
    return { ...JSON.parse(m[1]), slug: n.replace(/\.html$/, ""), body: raw.slice(m[0].length) };
  }).filter((p) => p.date <= today).sort((a, b) => (a.date < b.date ? 1 : -1));
}

function blogList() {
  const list = posts();
  if (!list.length) return `<p class="empty">아직 올라온 글이 없습니다. 곧 유어팀의 이야기를 전해 드릴게요.</p>`;
  return `<div class="posts" data-stagger>` + list.map((p) => `
      <a class="post-card" href="/blog/${p.slug}/">
        <div class="post-card__img">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : ""}</div>
        <div class="post-card__tx"><span class="k">${esc(p.category || "소식")} · <time datetime="${p.date}">${p.date.replace(/-/g, ".")}</time></span>
        <b>${esc(p.title)}</b><p>${esc(p.summary || "")}</p></div>
      </a>`).join("") + `\n    </div>`;
}

function renderPosts() {
  const tpl = readFileSync(join(SRC, "partials", "post.html"), "utf8");
  return posts().map((p) => {
    const file = join(SRC, "posts", p.slug + ".html");
    const page = `<!-- ${JSON.stringify({ title: p.title, description: p.summary, nav: "blog", image: p.cover })} -->\n` +
      tpl.replace(/\{\{post(\w+)\}\}/g, (_, k) => ({ Title: esc(p.title), Date: p.date, DateDot: p.date.replace(/-/g, "."),
        Category: esc(p.category || "소식"), Body: p.body, Cover: p.cover ? `<img class="post__cover" src="${esc(p.cover)}" alt="">` : "" })[k] ?? "");
    return renderRaw(page, file, { url: `/blog/${p.slug}/`, out: `blog/${p.slug}/index.html` });
  });
}

// 예전 주소(아임웹·프레이머) → 새 주소. 검색엔진·명함·광고에 남은 링크가 끊기지 않게 한다.
function redirects() {
  const lines = [];
  for (const [from, to] of Object.entries(site.redirects)) {
    lines.push(`${from} ${to} 301`);
    const dest = join(DIST, from.replace(/^\//, ""), "index.html");
    if (existsSync(dest)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${site.name}</title>` +
      `<link rel="canonical" href="${to}"><meta http-equiv="refresh" content="0; url=${to}">` +
      `<p><a href="${to}">새 주소로 이동합니다</a></p></html>`);
  }
  writeFileSync(join(DIST, "_redirects"), lines.join("\n") + "\n");
}

function sitemap(urls) {
  const base = site.url.replace(/\/$/, "");
  writeFileSync(join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join("\n") + `\n</urlset>\n`);
  writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(join(ROOT, "assets"), join(DIST, "assets"), { recursive: true });
const urls = walk(join(SRC, "pages")).filter((f) => f.endsWith(".html")).sort().map(render);
urls.push(...renderPosts());
redirects();
sitemap(urls);
console.log(`페이지 ${urls.length}개 → ${relative(process.cwd(), DIST) || DIST}`);
for (const u of urls) console.log("  " + u);
