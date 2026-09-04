// 글자 대비 — 브라우저 없이 스타일시트만 읽고 잡는다.
//
// scripts/a11y.mjs 가 실제 화면을 띄워 재는 쪽이지만, 그건 크로미움이 있어야 돌아서
// 배포 검사(npm test)에 못 들어간다. 그 사이로 "우리 골목 이용권" 단추가
// 3.1:1 로 나간 적이 있다 — 주황(#FF5A3C) 위의 흰 글씨였다.
//
// 여기서는 한 규칙 안에서 글자색과 배경색이 **둘 다 단색으로 딱 적힌** 경우만 본다.
// 반투명(rgba)·그러데이션·이미지 위 글자는 이 방법으로 못 재니 건너뛴다 —
// 그건 여전히 scripts/a11y.mjs 몫이다. 좁게 재는 대신, 걸리면 확실히 틀린 것만 걸린다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");

// :root 에 적힌 색 토큰을 모아 둔다 (--brand: #1F6CFF 같은 것).
const TOKENS = new Map();
for (const m of CSS.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) {
  if (!TOKENS.has(m[1])) TOKENS.set(m[1], m[2].toLowerCase());
}

/** 값이 단색이면 #rrggbb 로, 아니면 null (= 못 재니 건너뛴다). */
function solid(value) {
  const v = value.trim();
  const varRef = /^var\((--[\w-]+)(?:\s*,\s*(#[0-9a-fA-F]{6}))?\)$/.exec(v);
  if (varRef) return TOKENS.get(varRef[1]) || (varRef[2] ? varRef[2].toLowerCase() : null);
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#fff$/i.test(v)) return "#ffffff";
  if (/^#000$/i.test(v)) return "#000000";
  return null;
}

const luminance = (hex) => {
  const ch = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// 글자가 아니라 아이콘(선 그림)만 들어가는 칸. 그림은 3:1 이면 된다 (WCAG 1.4.11).
const ICON_ONLY = [/^\.notice-ico/];

function findPairs() {
  const out = [];
  for (const rule of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim().split("\n").pop().trim();
    const body = rule[2];
    const fgRaw = /(?:^|;)\s*color\s*:\s*([^;!]+)/.exec(body);
    const bgRaw = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;!]+)/.exec(body);
    if (!fgRaw || !bgRaw) continue;
    const fg = solid(fgRaw[1]);
    const bg = solid(bgRaw[1]);
    if (!fg || !bg) continue;
    out.push({ selector, fg, bg, ratio: contrast(fg, bg) });
  }
  return out;
}

test("단색끼리 겹친 글자는 모두 4.5:1 이상 (아이콘 칸은 3:1)", () => {
  const failed = findPairs().filter((p) => {
    const floor = ICON_ONLY.some((re) => re.test(p.selector)) ? 3 : 4.5;
    return p.ratio < floor;
  });
  assert.deepEqual(
    failed.map((p) => `${p.selector} — ${p.fg} on ${p.bg} = ${p.ratio.toFixed(2)}:1`),
    [],
  );
});

test("이용권 단추는 테두리색(--deal)이 아니라 글자용 색(--deal-btn)을 쓴다", () => {
  const rule = /\.btn-deal\{([^}]*)\}/.exec(CSS);
  assert.ok(rule, ".btn-deal 규칙이 있어야 한다");
  assert.match(rule[1], /background:var\(--deal-btn\)/);
  assert.ok(contrast(TOKENS.get("--deal-btn"), "#ffffff") >= 4.5,
    "--deal-btn 위의 흰 글씨가 4.5:1 에 못 미친다");
  assert.ok(contrast(TOKENS.get("--deal"), "#ffffff") < 4.5,
    "--deal 이 밝은 강조색이 아니게 됐다면 이 시험의 전제를 다시 봐야 한다");
});

test("쪽 번호는 손님 화면(.pg)과 콘솔 표(a/span) 양쪽 다 손가락 크기 규칙에 걸린다", () => {
  const touch = /@media \(hover:none\),\(pointer:coarse\)\{[^}]*\.pager[^}]*min-height:44px[^}]*\}/s.exec(CSS);
  assert.ok(touch, "손가락 크기 규칙을 못 찾았다");
  assert.match(touch[0], /\.pager \.pg/);
  assert.match(touch[0], /\.pager a/);
});
