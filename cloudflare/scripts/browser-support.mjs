// 다양한 브라우저·OS 에서 도는가 — 최신 문법이 폴백 없이 쓰인 곳 찾기.
//
//   node scripts/browser-support.mjs
//
// 왜 필요한가.
// 발주 요구사항에 "다양한 브라우저 및 OS에서 서비스가 가능하여야 함" 이 있는데,
// 우리 자동 검사는 **크롬 한 종류로만** 돕니다. 크롬에서 멀쩡하면 통과합니다.
// 그런데 손님의 절반은 아이폰 사파리로 들어옵니다.
//
// 사파리·파이어폭스를 실제로 띄워 재는 것이 가장 좋지만, 이 실행 환경에는 그 엔진이
// 설치돼 있지 않습니다. 그래서 대신 **코드에서 위험한 문법을 찾습니다.**
// 실측만큼은 아니어도 "안 재봤다" 보다 훨씬 낫습니다.
//
// ■ 무엇이 진짜 위험한가
//
// CSS 는 모르는 문법을 만나면 **그 선언 한 줄만 조용히 버립니다.** 그래서
//
//     color: color-mix(in oklab, black 60%, white);     ← 사파리 15 는 이 줄을 버린다
//
// 이렇게만 써 두면 글자색이 정해지지 않아 **부모 색을 물려받습니다.** 흰 바탕에 흰 글자가
// 되면 그 화면은 통째로 못 읽습니다. 앞에 평범한 값을 한 줄 두면 그런 일이 없습니다:
//
//     color: #333;                                      ← 사파리 15 는 이걸 쓴다
//     color: color-mix(in oklab, black 60%, white);     ← 최신 브라우저는 이걸 쓴다
//
// 그래서 이 검사기가 **실패로 판정하는 것은 폴백 없는 최신 값 함수 하나뿐**입니다.
// 선택자(:has 등)나 at-규칙은 없으면 '멋이 덜한' 정도라 경고로만 알립니다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 우리가 받치기로 한 최소 브라우저. 한국 공공 사이트에 들어오는 실제 분포 기준으로,
// 아이폰은 몇 해 지난 기기까지, 윈도우는 회사 PC 에 남아 있는 크롬까지 받칩니다.
const BASELINE = { "크롬/엣지": 109, "사파리(iOS 포함)": 15.6, "파이어폭스 ESR": 115, "삼성인터넷": 21 };

// since: 그 기능이 처음 들어간 버전. 우리 기준선보다 높으면 그 브라우저에서 안 됩니다.
const CSS_VALUES = [   // ← 폴백이 없으면 **실패**. 선언이 통째로 버려지기 때문.
  { re: /color-mix\s*\(/i, name: "color-mix()", since: { "사파리(iOS 포함)": 16.2, "파이어폭스 ESR": 113, "크롬/엣지": 111 } },
  { re: /\boklch\s*\(/i, name: "oklch()", since: { "사파리(iOS 포함)": 15.4, "파이어폭스 ESR": 113, "크롬/엣지": 111 } },
  { re: /\boklab\s*\(/i, name: "oklab()", since: { "사파리(iOS 포함)": 15.4, "파이어폭스 ESR": 113, "크롬/엣지": 111 } },
  { re: /\blight-dark\s*\(/i, name: "light-dark()", since: { "사파리(iOS 포함)": 17.5, "파이어폭스 ESR": 120, "크롬/엣지": 123 } },
  { re: /\bround\s*\(|\bmod\s*\(|\brem\s*\(/i, name: "round()/mod()/rem()", since: { "사파리(iOS 포함)": 15.4, "파이어폭스 ESR": 118, "크롬/엣지": 125 } },
  { re: /:\s*[^;{]*\b\d+(dvh|svh|lvh|dvw|svw|lvw)\b/i, name: "dvh/svh/lvh 단위", since: { "사파리(iOS 포함)": 15.4, "파이어폭스 ESR": 101, "크롬/엣지": 108 } },
  { re: /field-sizing\s*:/i, name: "field-sizing", since: { "사파리(iOS 포함)": 999, "파이어폭스 ESR": 999, "크롬/엣지": 123 } },
];
const CSS_OTHER = [    // ← 없으면 '멋이 덜한' 정도. 경고로만.
  // 버려지면 줄바꿈이 평범해질 뿐이다. 글이 안 보이거나 배치가 깨지지 않으므로 경고로만 둔다.
  { re: /text-wrap\s*:\s*(balance|pretty)/i, name: "text-wrap: balance/pretty", kind: "속성", since: { "사파리(iOS 포함)": 17.5, "파이어폭스 ESR": 121, "크롬/엣지": 114 } },
  { re: /:has\s*\(/i, name: ":has()", kind: "선택자", since: { "사파리(iOS 포함)": 15.4, "파이어폭스 ESR": 121, "크롬/엣지": 105 } },
  { re: /@container\b/i, name: "@container", kind: "at-규칙", since: { "사파리(iOS 포함)": 16, "파이어폭스 ESR": 110, "크롬/엣지": 105 } },
  { re: /@layer\b/i, name: "@layer", kind: "at-규칙", since: { "사파리(iOS 포함)": 15.4, "파이어폭스 ESR": 97, "크롬/엣지": 99 } },
  { re: /@starting-style\b/i, name: "@starting-style", kind: "at-규칙", since: { "사파리(iOS 포함)": 17.5, "파이어폭스 ESR": 129, "크롬/엣지": 117 } },
  { re: /\bsubgrid\b/i, name: "subgrid", kind: "값", since: { "사파리(iOS 포함)": 16, "파이어폭스 ESR": 71, "크롬/엣지": 117 } },
  { re: /:user-(in)?valid\b/i, name: ":user-valid", kind: "선택자", since: { "사파리(iOS 포함)": 16.5, "파이어폭스 ESR": 88, "크롬/엣지": 119 } },
  { re: /content-visibility\s*:/i, name: "content-visibility", kind: "속성", since: { "사파리(iOS 포함)": 18, "파이어폭스 ESR": 125, "크롬/엣지": 85 } },
  { re: /anchor-name\s*:|position-anchor\s*:/i, name: "앵커 배치", kind: "속성", since: { "사파리(iOS 포함)": 999, "파이어폭스 ESR": 999, "크롬/엣지": 125 } },
];
const JS_RISKS = [
  { re: /\(\?<[=!]/, name: "정규식 lookbehind", since: { "사파리(iOS 포함)": 16.4, "파이어폭스 ESR": 78, "크롬/엣지": 62 },
    why: "구형 사파리는 **문법 오류로 파일 전체를 버립니다** — 그 스크립트가 통째로 안 돕니다" },
  { re: /Object\.groupBy|Map\.groupBy/, name: "Object.groupBy", since: { "사파리(iOS 포함)": 17.4, "파이어폭스 ESR": 119, "크롬/엣지": 117 }, why: "함수가 없어 그 자리에서 멈춥니다" },
  { re: /Promise\.withResolvers/, name: "Promise.withResolvers", since: { "사파리(iOS 포함)": 17.4, "파이어폭스 ESR": 121, "크롬/엣지": 119 }, why: "함수가 없어 그 자리에서 멈춥니다" },
  { re: /\.checkVisibility\s*\(/, name: "checkVisibility()", since: { "사파리(iOS 포함)": 17.4, "파이어폭스 ESR": 125, "크롬/엣지": 105 }, why: "함수가 없어 그 자리에서 멈춥니다" },
  { re: /AbortSignal\.timeout/, name: "AbortSignal.timeout", since: { "사파리(iOS 포함)": 16, "파이어폭스 ESR": 100, "크롬/엣지": 103 }, why: "함수가 없어 그 자리에서 멈춥니다" },
  { re: /structuredClone\s*\(/, name: "structuredClone()", since: { "사파리(iOS 포함)": 15.4, "파이어폭스 ESR": 94, "크롬/엣지": 98 }, why: "함수가 없어 그 자리에서 멈춥니다" },
  { re: /\?\.\s*\(|\?\?=/, name: "옵셔널 호출 / ??=", since: { "사파리(iOS 포함)": 14, "파이어폭스 ESR": 79, "크롬/엣지": 85 }, why: "구형에서 문법 오류" },
];

const failing = (since) => Object.entries(since)
  .filter(([b, v]) => BASELINE[b] !== undefined && v > BASELINE[b])
  .map(([b, v]) => `${b} ${v}+ 필요 (우리 기준 ${BASELINE[b]})`);

// ── CSS: 주석을 지우되 줄 수는 유지한다 (몇째 줄인지 말해 줘야 고칠 수 있다) ──
const cssPath = path.join(ROOT, "public/css/app.css");
const cssRaw = fs.readFileSync(cssPath, "utf8");
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
const lineAt = (i) => css.slice(0, i).split("\n").length;

// 규칙 덩어리를 모은다 — 같은 덩어리 안에 폴백이 있는지 봐야 하기 때문
const blocks = [];
{
  let depth = 0, start = -1;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") { if (depth === 0) start = i + 1; depth++; }
    else if (css[i] === "}") { depth--; if (depth === 0 && start >= 0) { blocks.push({ at: start, body: css.slice(start, i) }); start = -1; } }
  }
}

const dead = [], warn = [];
for (const f of CSS_VALUES) {
  const need = failing(f.since);
  if (!need.length) continue;
  for (const b of blocks) {
    for (const decl of b.body.split(";")) {
      if (!f.re.test(decl)) continue;
      const ci = decl.indexOf(":");
      if (ci < 0) continue;
      const prop = decl.slice(0, ci).trim().toLowerCase();
      if (!prop || prop.startsWith("--")) continue;   // 변수 자체는 쓰이는 자리에서 판정된다
      // 같은 덩어리 안에서 **이 선언보다 앞에** 같은 속성의 평범한 값이 있는가
      const before = b.body.slice(0, b.body.indexOf(decl));
      const hasFallback = new RegExp(`(^|;)\\s*${prop.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*:`, "i").test(before);
      const at = b.at + b.body.indexOf(decl);
      (hasFallback ? warn : dead).push({
        name: f.name, prop, line: lineAt(at), need,
        text: decl.trim().replace(/\s+/g, " ").slice(0, 76),
        why: hasFallback ? "앞에 폴백이 있어 구형에서도 색/값이 정해집니다" : null,
      });
    }
  }
}
for (const f of CSS_OTHER) {
  const need = failing(f.since);
  if (!need.length) continue;
  let m; const re = new RegExp(f.re.source, "gi");
  while ((m = re.exec(css))) warn.push({ name: f.name, kind: f.kind, line: lineAt(m.index), need, soft: true });
}

// ── JS ──
const jsHits = [];
const jsDir = path.join(ROOT, "public/js");
for (const file of fs.readdirSync(jsDir).filter((f) => f.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(jsDir, file), "utf8");
  for (const f of JS_RISKS) {
    const need = failing(f.since);
    if (!need.length || !f.re.test(src)) continue;
    const line = src.slice(0, src.search(f.re)).split("\n").length;
    jsHits.push({ file, name: f.name, line, need, why: f.why });
  }
}

// ── 보고 ──
const base = Object.entries(BASELINE).map(([b, v]) => `${b} ${v}`).join(" · ");
console.log(`\n받치기로 한 최소 브라우저: ${base}\n`);

const uniq = (a) => [...new Map(a.map((x) => [x.name + (x.line || "") + (x.file || ""), x])).values()];
const softs = uniq(warn.filter((w) => w.soft));
if (softs.length) {
  console.log(`△ 구형에서 '멋이 덜해지는' 문법 ${softs.length}건 — 없으면 기본 모양으로 보일 뿐, 못 쓰게 되지는 않습니다\n`);
  const byName = new Map();
  for (const w of softs) { if (!byName.has(w.name)) byName.set(w.name, { ...w, n: 0, lines: [] }); const e = byName.get(w.name); e.n++; if (e.lines.length < 6) e.lines.push(w.line); }
  for (const [, w] of byName)
    console.log(`  ${w.name} (${w.kind}) — ${w.n}곳 · ${w.lines.join(", ")}줄${w.n > w.lines.length ? " …" : ""}\n    ${w.need.join(" / ")}\n`);
}
const okFallback = uniq(warn.filter((w) => !w.soft));
if (okFallback.length) {
  console.log(`✓ 폴백이 붙어 있는 최신 값 ${okFallback.length}건 — 구형에서도 값이 정해집니다`);
  for (const w of okFallback) console.log(`  ${w.line}줄  ${w.prop}: … ${w.name}`);
  console.log("");
}
if (jsHits.length) {
  console.log(`✗ 구형에서 스크립트가 멈추는 문법 ${jsHits.length}건\n`);
  for (const h of jsHits) console.log(`  js/${h.file}:${h.line}  ${h.name}\n    ${h.why}\n    ${h.need.join(" / ")}\n`);
}
if (!dead.length && !jsHits.length) {
  console.log(`✓ 폴백 없이 쓴 최신 값 없음 · 스크립트를 멈추는 문법 없음`);
  console.log(`  (${blocks.length}개 규칙 덩어리 · ${fs.readdirSync(jsDir).filter((f) => f.endsWith(".js")).length}개 스크립트 검사)\n`);
  process.exit(0);
}
console.log(`\n✗ 폴백 없이 쓴 최신 값 ${dead.length}건 — 구형에서 이 선언이 통째로 버려집니다\n`);
for (const d of uniq(dead))
  console.log(`  ${d.line}줄  ${d.prop}\n    ${d.text}\n    ${d.need.join(" / ")}\n    고치는 법: 바로 앞 줄에 평범한 값으로 같은 속성을 한 번 더 쓰세요\n`);
process.exit(1);
