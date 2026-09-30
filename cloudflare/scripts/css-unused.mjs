// 어디서도 쓰이지 않는 CSS 클래스 찾기 — 6천 줄에서 아무도 못 지우는 줄을 걷어낸다.
//
//   node scripts/css-unused.mjs            # 후보만 보여 준다 (아무것도 고치지 않는다)
//   node scripts/css-unused.mjs --names    # 이름만 한 줄로 (지울 때 쓰기 편하게)
//
// 왜 필요한가.
// app.css 는 한 파일 6천 줄이다. 화면을 갈아엎을 때마다 옛 클래스가 CSS 에만 남는데,
// 지우려고 보면 "혹시 어디서 쓰나" 를 확인할 방법이 없어 아무도 손대지 않는다.
// 그렇게 남은 줄이 다음 사람의 판단을 흐린다 — 안 쓰는 규칙이 쓰는 규칙처럼 보이고,
// 충돌을 풀 때 어느 쪽이 살아 있는 쪽인지 알 수 없다.
//
// ── 이 검사가 틀리는 방향 ──────────────────────────────────────────────
// 일부러 **한쪽으로만** 틀리게 만들었다: 쓰이는 것을 죽었다고 말하는 일이 없어야 한다.
// 그래서 클래스 이름이 소스 어딘가에 **글자로 들어 있기만 하면** 살아 있다고 본다.
//   · `class="badge badge-ok"` 처럼 통째로 쓴 것            → 찾는다
//   · `"badge badge-" + kind` 처럼 이어 붙인 것             → 'badge-' 조각이 있으면 살린다
//   · 자바스크립트가 classList.add("is-on") 하는 것          → 찾는다
// 반대로 진짜 죽었는데 이름이 우연히 다른 곳(주석·문구)에 있으면 놓친다. 그 편이 낫다 —
// 놓친 줄은 그대로 남을 뿐이고, 잘못 지운 줄은 화면을 깨뜨린다.
//
// 그래서 이 스크립트의 결과는 **지울 목록이 아니라 볼 목록**이다. 눈으로 한 번 보고 지운다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSS = path.join(ROOT, "public/css/app.css");

// 클래스 이름이 나타날 수 있는 모든 곳. 화면을 만드는 코드와 브라우저에서 도는 코드 전부.
const HAYSTACK_DIRS = [
  { dir: path.join(ROOT, "src"), ext: [".js"] },
  { dir: path.join(ROOT, "public/js"), ext: [".js"] },
  { dir: path.join(ROOT, "scripts"), ext: [".mjs"] },
  { dir: path.join(ROOT, "test"), ext: [".js"] },
  { dir: path.join(ROOT, "test-e2e"), ext: [".mjs"] },
];

const read = (f) => fs.readFileSync(f, "utf8");
function gather() {
  let out = "";
  for (const { dir, ext } of HAYSTACK_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!ext.some((e) => name.endsWith(e))) continue;
      out += read(path.join(dir, name)) + "\n";
    }
  }
  return out;
}

const css = read(CSS);
// 주석을 지운다 — 주석 안의 예시 선택자를 진짜 규칙으로 세면 안 된다.
const body = css.replace(/\/\*[\s\S]*?\*\//g, " ");

// 선택자에 쓰인 클래스 이름을 모은다. 값(content:".x") 안의 점은 세지 않도록
// 규칙 본문 {...} 을 먼저 들어낸다.
const selectorsOnly = body.replace(/\{[^{}]*\}/g, "{}");
const used = new Set();
for (const m of selectorsOnly.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) used.add(m[1]);

const hay = gather();

// 이름이 소스에 글자로 들어 있는가. 이어 붙여 만드는 이름을 살리기 위해
// 앞에서부터 한 글자씩 줄여 가며 '조각' 으로도 찾아본다(세 글자까지).
//   'badge-ok' 가 없으면 'badge-o', 'badge-', … 순으로 본다.
// 조각으로 걸리면 '이어 붙여 만들었을 수 있음' 으로 따로 표시한다.
function look(name) {
  if (hay.includes(name)) return "그대로";
  for (let n = name.length - 1; n >= 3; n--) {
    const piece = name.slice(0, n);
    if (/[-_]$/.test(piece) && hay.includes(piece)) return `조각(${piece}…)`;
  }
  return null;
}

const dead = [];
const maybe = [];
for (const name of [...used].sort()) {
  const hit = look(name);
  if (!hit) dead.push(name);
  else if (hit !== "그대로") maybe.push([name, hit]);
}

// 이름이 나오는 줄 번호 — 지울 때 어디를 볼지 바로 알 수 있게.
function linesOf(name) {
  const re = new RegExp("\\." + name.replace(/[-]/g, "\\-") + "(?![\\w-])");
  const out = [];
  css.split("\n").forEach((l, i) => { if (re.test(l.replace(/\/\*[\s\S]*?\*\//g, " "))) out.push(i + 1); });
  return out;
}

if (process.argv.includes("--names")) {
  console.log(dead.join(" "));
  process.exit(0);
}

console.log(`\n■ ${path.relative(ROOT, CSS)} — 선택자에 쓰인 클래스 ${used.size}개\n`);
if (!dead.length) {
  console.log("✓ 어디서도 안 쓰이는 클래스 없음");
} else {
  console.log(`쓰이는 곳을 못 찾은 클래스 ${dead.length}개 — 지우기 전에 눈으로 한 번 보세요:\n`);
  for (const name of dead) {
    const ls = linesOf(name);
    console.log(`  .${name}`.padEnd(34) + `${ls.length}곳  ${ls.slice(0, 6).join(", ")}${ls.length > 6 ? " …" : ""}`);
  }
}
if (maybe.length) {
  console.log(`\n이어 붙여 만들었을 수 있어 살려 둔 것 ${maybe.length}개 (참고용):`);
  for (const [name, why] of maybe.slice(0, 20)) console.log(`  .${name}`.padEnd(34) + why);
  if (maybe.length > 20) console.log(`  … 외 ${maybe.length - 20}개`);
}
console.log("");
