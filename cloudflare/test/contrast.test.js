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

// ── 관리자 콘솔의 뼈대 —— 브라우저 없이 HTML 만 보고 잡히는 것들 ────────────────
//
// scripts/a11y.mjs 가 실제로 화면을 띄워 재지만 크로미움이 있어야 돌아,
// 배포 검사에 못 들어간다. 여기서는 마크업만 보면 판정되는 두 가지를 지킨다.
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

async function consoleHtml() {
  const env = makeEnv();
  await D.createAssociation(env.DB, { slug: "seocho", name: "방배카페골목상인회", kind: "merchant" });
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: 1 });
  const jar = {};
  const absorb = (r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); } };
  const ck = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  const g = await worker.fetch(new Request("http://localhost/login"), env); absorb(g);
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  absorb(await worker.fetch(new Request("http://localhost/login", { method: "POST",
    headers: { cookie: ck(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: tk, login: "ad@s.kr", password: "pass1234" }).toString() }), env));
  return (await worker.fetch(new Request("http://localhost/t/seocho/admin", { headers: { cookie: ck() } }), env)).text();
}

test("콘솔의 입력칸에는 모두 이름표가 있다 (placeholder 는 이름표가 아니다)", async () => {
  const html = await consoleHtml();
  // <label>…<input></label> 로 감싼 것은 통과. 그 밖에는 aria-label 이 있어야 한다.
  const wrapped = new Set();
  for (const m of html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g))
    for (const t of m[1].matchAll(/<(?:input|select|textarea)\b[^>]*/g)) wrapped.add(t[0]);
  const bad = [];
  for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*/g)) {
    const tag = m[0];
    if (/type=["']?(hidden|submit|button)/.test(tag)) continue;
    if (/aria-label=|aria-labelledby=|\btitle=/.test(tag)) continue;
    if (wrapped.has(tag)) continue;
    bad.push(tag.slice(0, 90));
  }
  assert.deepEqual(bad, []);
});

test("급한 일 덩어리의 제목은 h2 — h1 다음에 h3 이 오면 단계를 건너뛴다", async () => {
  const html = await consoleHtml();
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => +m[1]);
  assert.ok(levels.length, "제목이 하나는 있어야");
  let prev = 0;
  const skips = [];
  for (const lv of levels) { if (prev && lv > prev + 1) skips.push(`h${prev} → h${lv}`); prev = lv; }
  assert.deepEqual(skips, []);
});

test("접근성 실측 목록에 관리자 콘솔 화면이 들어 있다", () => {
  const src = readFileSync(new URL("../scripts/a11y.mjs", import.meta.url), "utf8");
  for (const tab of ["s-home", "s-people", "s-inbox", "s-stats"])
    assert.match(src, new RegExp(`"${tab}"`), `${tab} 탭이 측정 목록에서 빠졌다`);
  assert.match(src, /관리자 콘솔 · 현황 \(모바일\)/, "휴대폰 폭 측정이 빠졌다");
});
