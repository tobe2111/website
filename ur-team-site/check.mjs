// 유어팀 홈페이지 검사 — 빌드한 뒤 돌린다:  node ur-team-site/build.mjs && node ur-team-site/check.mjs
// 사이트 안 링크·사진·영상·글꼴 경로가 모두 실제 파일을 가리키는지, 예전 주소가 다 이어지는지 본다.
// 하나라도 끊기면 실패(종료 코드 1)로 끝난다 — GitHub 자동 검사가 이걸 돌린다.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
const site = JSON.parse(readFileSync(join(ROOT, "site.json"), "utf8"));
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
}
for (const [from, to] of Object.entries(site.redirects)) {
  if (!existsSync(join(DIST, from, "index.html"))) bad.push(`예전 주소 ${from} 가 이어지지 않음`);
  if (!existsSync(resolve(to))) bad.push(`예전 주소 ${from} → ${to} 의 새 페이지가 없음`);
}
for (const css of walk(join(DIST, "assets")).filter((x) => x.endsWith(".css"))) {
  const c = readFileSync(css, "utf8");
  if (c.split("{").length !== c.split("}").length) bad.push(`${css.slice(DIST.length)}: 여는 { 와 닫는 } 개수가 다름`);
}

if (bad.length) {
  console.error(`검사 실패 ${bad.length}건`);
  for (const b of bad) console.error("  - " + b);
  process.exit(1);
}
console.log(`검사 통과 — 페이지 ${pages}개, 경로 ${refs}개, 예전 주소 ${Object.keys(site.redirects).length}개`);
