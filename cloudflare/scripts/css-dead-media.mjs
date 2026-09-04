// 죽은 반응형 규칙 찾기 — "휴대폰에서 접기" 를 적어 놨는데 실제로는 안 접히는 곳.
//
//   node scripts/css-dead-media.mjs
//
// 왜 필요한가.
// app.css 는 오래 자라면서 뒤쪽에 "디자인 시스템 v3/v4" 재정의 블록이 붙었다.
// 그 블록이 앞쪽 @media 안의 규칙과 **같은 선택자·같은 속성**을 조건 없이 다시 쓰면,
// CSS 는 나중에 온 것을 택하므로 앞의 반응형 규칙이 통째로 죽는다.
// 화면은 조용히 깨지고, 코드에는 "휴대폰에서는 1열" 이라고 적혀 있으니 아무도 의심하지 않는다.
//
// 실제로 이 저장소에서 세 번 났다:
//   · 구역 제목 세 층(24/20/16px)이 전부 24px 로 — 홈이 아무것도 강조하지 못했다
//   · 가게 상세가 휴대폰에서 안 접혀 가게 이름이 "고/을/돼/지/국/밥" 로 세로로 쏟아졌다
//   · 소식 카드가 휴대폰에서 반 폭이 되어 글이 잘렸다
//
// 그래서 눈이 아니라 이 스크립트가 본다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = process.argv[2] || path.join(ROOT, "public/css/app.css");
const src = fs.readFileSync(FILE, "utf8");

// 주석을 같은 길이의 공백으로 바꿔 위치(offset)를 그대로 유지한다.
// ⚠️ 줄바꿈은 살려 둬야 한다 — 공백으로 뭉개면 아래에서 세는 줄 번호가 통째로 어긋난다.
const clean = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

// 선택자 한 개의 특정도 — (id, class/속성/의사클래스, 요소).
// 뒤에 온 규칙은 특정도가 **같거나 높을 때만** 앞 규칙을 이긴다.
function specificity(sel) {
  const s = sel.replace(/::[\w-]+/g, " ").trim();
  const id = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+(\([^)]*\))?/g) || []).length;
  const el = (s.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return id * 10000 + cls * 100 + el;
}
const cmp = (a, b) => (a > b ? 1 : a < b ? -1 : 0);

// 선언 덩어리 → { 속성: 값 }. 단축 표기는 따로 보지 않는다(아래 SHORTHAND 참고).
function decls(body) {
  const out = {};
  for (const part of body.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    if (!prop || prop.startsWith("--")) continue;
    out[prop] = part.slice(i + 1).trim();
  }
  return out;
}
// 단축 표기가 개별 속성을 덮는 경우도 잡는다 (예: `grid-template` 은 `grid-template-columns` 를 포함)
const SHORTHAND = {
  "grid-template": ["grid-template-columns", "grid-template-rows", "grid-template-areas"],
  grid: ["grid-template-columns", "grid-template-rows", "grid-template-areas", "grid-auto-flow"],
  flex: ["flex-grow", "flex-shrink", "flex-basis"],
  font: ["font-size", "font-weight", "font-family", "line-height"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  background: ["background-color", "background-image", "background-position", "background-size"],
  border: ["border-width", "border-style", "border-color"],
  inset: ["top", "right", "bottom", "left"],
  "place-items": ["align-items", "justify-items"],
  gap: ["row-gap", "column-gap"],
};
const covers = (prop, target) => prop === target || (SHORTHAND[prop] || []).includes(target);

// ── 아주 작은 스캐너: 최상위 규칙과 @media 블록을 위치와 함께 모은다 ──
const topRules = [];   // { sel, props:{}, at }
const mediaRules = []; // { sel, props:{}, at, cond }

function scanBlock(text, base, cond) {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const prelude = text.slice(i, open).trim();
    // 짝이 맞는 닫는 중괄호 찾기
    let depth = 1, j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    if (prelude.startsWith("@")) {
      const m = /^@media\s*(.+)$/is.exec(prelude);
      if (m) scanBlock(body, base + open + 1, (cond ? cond + " and " : "") + m[1].trim());
      // @supports 등 다른 at-rule 도 안을 훑는다
      else if (/^@(supports|layer)/i.test(prelude)) scanBlock(body, base + open + 1, cond);
    } else if (prelude) {
      for (const sel of prelude.split(",").map((x) => x.trim()).filter(Boolean)) {
        const rec = { sel, props: decls(body), at: base + open, cond };
        (cond ? mediaRules : topRules).push(rec);
      }
    }
    i = j;
  }
}
scanBlock(clean, 0, "");

// ── 판정: max-width 미디어 규칙보다 **뒤에** 오는 조건 없는 규칙이 같은 선택자·같은 속성을 다시 쓰는가 ──
const dead = [];
for (const mr of mediaRules) {
  if (!/max-width/i.test(mr.cond)) continue;      // 좁은 화면용 규칙만 본다
  const mspec = specificity(mr.sel);
  for (const prop of Object.keys(mr.props)) {
    for (const tr of topRules) {
      if (tr.at <= mr.at) continue;                // 뒤에 있어야 이긴다
      // 같은 선택자이거나, **그 선택자를 더 좁힌 것**(`.cat-tab` ↔ `.sec-v5 .cat-tab`)이면 이길 수 있다.
      // 뒤쪽에 `.sec-v5 .cat-tab{min-height:40px}` 를 두면 앞쪽 @media 의
      // `.cat-tab{min-height:44px}` 가 특정도로 밀려 죽는다 — 실제로 이 저장소에서 났다.
      const same = tr.sel === mr.sel;
      const narrows = !same && new RegExp("(^|[\\s>+~])" + mr.sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$").test(tr.sel);
      if (!same && !narrows) continue;
      if (same && specificity(tr.sel) < mspec) continue;   // 같은 선택자인데 특정도가 낮으면 못 이긴다
      const hit = Object.keys(tr.props).find((p) => covers(p, prop));
      if (!hit) continue;
      if (/!important/i.test(mr.props[prop]) && !/!important/i.test(tr.props[hit])) continue;
      // 덮어쓰는 값이 **똑같으면** 화면은 그대로다. 정리할 중복일 뿐 버그가 아니므로 알리지 않는다.
      const norm = (v) => String(v).replace(/\s+/g, " ").trim().toLowerCase();
      if (hit === prop && norm(tr.props[hit]) === norm(mr.props[prop])) continue;
      dead.push({ sel: mr.sel, prop, cond: mr.cond, bySel: tr.sel,
        mline: clean.slice(0, mr.at).split("\n").length,
        tline: clean.slice(0, tr.at).split("\n").length, by: hit });
      break;
    }
  }
}

const rel = path.relative(process.cwd(), FILE);
if (!dead.length) {
  console.log(`\n✓ ${rel} — 죽은 반응형 규칙 없음 (@media 규칙 ${mediaRules.length}개 검사)\n`);
  process.exit(0);
}
console.log(`\n✗ ${rel} — 뒤 규칙에 덮여 동작하지 않는 반응형 선언 ${dead.length}건\n`);
for (const d of dead) {
  console.log(`  ${d.sel} { ${d.prop} }`);
  console.log(`    ${d.mline}줄  @media ${d.cond}  ← 여기서 정한 것이`);
  console.log(`    ${d.tline}줄  \`${d.bySel}\` 의 ${d.by} 에 덮여 무시됩니다\n`);
}
console.log(`고치는 법: 덮는 규칙 **뒤에** @media 를 다시 쓰거나, 특정도를 한 단 올리세요.\n`);
process.exit(1);
