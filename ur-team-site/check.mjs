// 유어팀 홈페이지 검사 — 빌드한 뒤 돌린다:  node ur-team-site/build.mjs && node ur-team-site/check.mjs
// 사이트 안 링크·사진·영상·글꼴 경로가 모두 실제 파일을 가리키는지, 예전 주소가 다 이어지는지 본다.
// 검색 노출(정식 주소 · 설명 · 구조화 데이터 · sitemap · robots · llms.txt)도 함께 본다.
// 하나라도 끊기면 실패(종료 코드 1)로 끝난다 — GitHub 자동 검사가 이걸 돌린다.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
const site = JSON.parse(readFileSync(join(ROOT, "site.json"), "utf8"));
const BASE = site.url.replace(/\/$/, "");
const indexable = new Map(); // 검색에 내보내는 주소 → { where, title, desc }
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const resolve = (u) => {
  const p = decodeURI(u.split(/[?#]/)[0]);
  if (p.endsWith("/")) return join(DIST, p, "index.html");
  return existsSync(join(DIST, p)) && statSync(join(DIST, p)).isFile() ? join(DIST, p) : join(DIST, p, "index.html");
};

const bad = [];
let pages = 0, refs = 0;
for (const f of walk(DIST).filter((x) => x.endsWith(".html"))) {
  pages++;
  const html = readFileSync(f, "utf8");
  const where = f.slice(DIST.length);
  for (const m of html.matchAll(/\b(?:href|src|poster)="(\/[^"]*)"/g)) {
    if (m[1].startsWith("//")) continue;
    refs++;
    if (!existsSync(resolve(m[1]))) bad.push(`${where}: 없는 경로 ${m[1]}`);
  }
  for (const m of html.matchAll(/url\(["']?(\/[^"')]+)/g)) {
    refs++;
    if (!existsSync(resolve(m[1]))) bad.push(`${where}: 없는 배경 그림 ${m[1]}`);
  }
  if (/\{\{\w+\}\}/.test(html)) bad.push(`${where}: 채워지지 않은 {{…}} 자리표시`);
  if (/<!--@/.test(html)) bad.push(`${where}: 끼워 넣지 못한 <!--@ …--> 조각`);
  if (/imweb\.me|framerusercontent\.com/.test(html)) bad.push(`${where}: 예전 사이트(아임웹·프레이머) 파일을 아직 불러옴`);
  if (!/<title>[^<]+<\/title>/.test(html)) bad.push(`${where}: 제목(title) 없음`);
  seo(where, html);
}

// ── 검색 노출 검사 ──────────────────────────────────────────
// 검색에 내보내는 페이지(noindex 가 아닌 것)는 정식 주소(canonical) 하나, 설명, 읽히는 구조화 데이터(JSON-LD)가 있어야 한다.
// 제목 · 설명이 다른 페이지와 똑같으면 검색엔진이 한 장만 보여 주므로 겹치지 않게 한다.
function seo(where, html) {
  const head = html.split(/<\/head>/i)[0];
  const noindex = /<meta name="robots" content="[^"]*noindex/i.test(head);
  const canon = [...head.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]);
  if (noindex) {
    if (canon.length > 1) bad.push(`${where}: 정식 주소(canonical)가 ${canon.length}개`);
    return;
  }
  if (canon.length !== 1) return bad.push(`${where}: 정식 주소(canonical)가 ${canon.length}개 (꼭 1개)`);
  if (!canon[0].startsWith(BASE + "/")) bad.push(`${where}: 정식 주소가 ${BASE} 로 시작하지 않음 (${canon[0]})`);
  const expect = BASE + where.replace(/index\.html$/, "");
  if (canon[0] !== expect) bad.push(`${where}: 정식 주소가 자기 주소가 아님 (${canon[0]} ≠ ${expect})`);
  const desc = head.match(/<meta name="description" content="([^"]*)"/)?.[1] || "";
  if (!desc.trim()) bad.push(`${where}: 설명(meta description) 없음`);
  const title = head.match(/<title>([^<]*)<\/title>/)?.[1] || "";
  const lds = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!lds.length) bad.push(`${where}: 구조화 데이터(JSON-LD) 없음`);
  for (const m of lds) {
    try {
      const j = JSON.parse(m[1]);
      if (j["@context"] !== "https://schema.org") bad.push(`${where}: JSON-LD 의 @context 가 schema.org 가 아님`);
      const nodes = j["@graph"] || [j];
      for (const n of nodes) if (!n["@type"]) bad.push(`${where}: JSON-LD 에 @type 이 빠진 항목`);
      if (!nodes.some((n) => n["@type"] === "Organization")) bad.push(`${where}: JSON-LD 에 회사(Organization) 정보 없음`);
    } catch (e) { bad.push(`${where}: JSON-LD 를 읽을 수 없음 — ${e.message}`); }
  }
  if (!/<link rel="alternate" hreflang="/.test(head)) bad.push(`${where}: 언어 짝(hreflang) 없음`);
  if (!/<meta property="og:image" content="https:\/\//.test(head)) bad.push(`${where}: 공유 그림(og:image) 없음`);
  indexable.set(expect, { where, title, desc });
}
const englishReady = existsSync(join(DIST, "en", "index.html"));
for (let [from, to] of Object.entries(site.redirects)) {
  if (!englishReady && to.startsWith("/en/")) to = "/"; // 영어판이 올라가기 전에는 한국어 첫 화면으로 보낸다
  if (!existsSync(join(DIST, from, "index.html"))) bad.push(`예전 주소 ${from} 가 이어지지 않음`);
  if (!existsSync(resolve(to))) bad.push(`예전 주소 ${from} → ${to} 의 새 페이지가 없음`);
}
// 제목 · 설명 겹침
for (const key of ["title", "desc"]) {
  const seen = new Map();
  for (const v of indexable.values()) {
    if (seen.has(v[key])) bad.push(`${v.where}: ${key === "title" ? "제목" : "설명"}이 ${seen.get(v[key])} 와 똑같음`);
    else seen.set(v[key], v.where);
  }
}
// 예전 주소 이동 페이지는 검색 결과에 나오면 안 된다
for (const from of Object.keys(site.redirects)) {
  const f = join(DIST, from, "index.html");
  if (existsSync(f) && !/name="robots" content="[^"]*noindex/.test(readFileSync(f, "utf8")) && !indexable.has(BASE + from + "/"))
    bad.push(`예전 주소 ${from} 이동 페이지에 noindex 가 없음`);
}
// sitemap.xml 은 검색에 내보내는 페이지와 정확히 같아야 한다
const smPath = join(DIST, "sitemap.xml");
if (!existsSync(smPath)) bad.push("sitemap.xml 없음");
else {
  const sm = readFileSync(smPath, "utf8");
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const u of locs) if (!indexable.has(u)) bad.push(`sitemap.xml: ${u} 는 없는 페이지이거나 noindex 페이지`);
  for (const u of indexable.keys()) if (!locs.includes(u)) bad.push(`sitemap.xml 에 ${u} 가 빠짐`);
  if ((sm.match(/<url>/g) || []).length !== (sm.match(/<lastmod>\d{4}-\d\d-\d\d<\/lastmod>/g) || []).length) bad.push("sitemap.xml: 수정일(lastmod)이 빠진 주소가 있음");
}
for (const f of ["robots.txt", "llms.txt", "llms-full.txt", "blog/rss.xml"]) if (!existsSync(join(DIST, f))) bad.push(`${f} 없음`);
if (existsSync(join(DIST, "robots.txt")) && !/^Sitemap: https?:\/\//m.test(readFileSync(join(DIST, "robots.txt"), "utf8"))) bad.push("robots.txt 에 Sitemap 줄이 없음");

for (const css of walk(join(DIST, "assets")).filter((x) => x.endsWith(".css"))) {
  const c = readFileSync(css, "utf8");
  if (c.split("{").length !== c.split("}").length) bad.push(`${css.slice(DIST.length)}: 여는 { 와 닫는 } 개수가 다름`);
}

// 갈래를 합치다 겹친 자리에 남는 표시(<<<<<<< · >>>>>>>)가 원본에 남아 있으면 실패.
// 이 표시가 스타일 · 스크립트에 섞여 올라가면 그 아래가 조용히 무시된다.
for (const f of [...walk(join(ROOT, "src")), ...walk(join(ROOT, "assets", "css")), ...walk(join(ROOT, "assets", "js")), join(ROOT, "build.mjs"), join(ROOT, "site.json")]) {
  if (!/\.(html|css|js|mjs|json)$/.test(f)) continue;
  const m = readFileSync(f, "utf8").split("\n").findIndex((l) => /^(<<<<<<<|>>>>>>>) /.test(l));
  if (m >= 0) bad.push(`${f.slice(ROOT.length)}: ${m + 1}번째 줄에 합치다 남은 표시가 있음`);
}

if (bad.length) {
  console.error(`검사 실패 ${bad.length}건`);
  for (const b of bad) console.error("  - " + b);
  process.exit(1);
}
console.log(`검사 통과 — 페이지 ${pages}개(검색 노출 ${indexable.size}개), 경로 ${refs}개, 예전 주소 ${Object.keys(site.redirects).length}개`);
