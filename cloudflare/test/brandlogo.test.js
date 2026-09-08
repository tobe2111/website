// 그 상인회의 간판은 그 상인회의 모든 화면에 나온다.
//
// 로그인 화면이 회색 상자 아이콘을 띄운 채 비밀번호를 받고 있었다. 머리말·바닥글은
// 연합회 로고인데 인증 카드만 아니었다 — 사장님 눈에는 "여기가 우리 상인회 맞나" 다.
// 원인은 authHead() 가 아이콘을 하드코딩한 것이었고, 그런 자리는 한 번 생기면
// 새 화면을 만들 때마다 다시 생긴다. 그래서 규칙을 한 곳(brandLogo)에 두고,
// 인증 화면 전부를 여기서 훑는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => {
  for (const s of r.headers.getSetCookie?.() || []) {
    const kv = s.split(";")[0]; const i = kv.indexOf("=");
    j.c[kv.slice(0, i)] = kv.slice(i + 1);
  }
};
async function get(env, j, p, hops = 0) {
  const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env);
  absorb(j, r);
  if (r.status >= 300 && r.status < 400 && hops < 3) return get(env, j, r.headers.get("location"), hops + 1);
  return r;
}

// 꾸러미 로고가 붙는 이름 (src/brandAssets.js 의 match 와 맞물린다)
const BUNDLED_NAME = "방배카페골목 상인회";

async function seed(env, name = BUNDLED_NAME, logo = "") {
  const a = await D.createAssociation(env.DB, { slug: "bb", name, kind: "merchant" });
  await D.updateAssociation(env.DB, a.id, { name, tagline: "t", brand_color: "#1B6B45",
    phone: "", email: "", address: "", logo, hero_image: "" });
  const pw = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: pw.hash, salt: pw.salt,
    name: "회장", role: "ADMIN", associationId: a.id });
  return a;
}

// 인증 카드가 있는 공개 화면들 — 손님·사장님이 로그인 전에 만나는 자리
const AUTH_PAGES = [
  ["/t/bb/login", "로그인"],
  ["/t/bb/register", "가입"],
  ["/t/bb/forgot", "비밀번호 찾기"],
  ["/t/bb/contact", "문의"],
];

test("인증 화면마다 그 상인회의 간판이 나온다", async () => {
  const env = makeEnv({}); await seed(env);
  for (const [path, label] of AUTH_PAGES) {
    const body = await (await get(env, jar(), path)).text();
    const i = body.indexOf('class="auth-head"');
    assert.ok(i > 0, `${label}: 인증 카드 머리를 찾지 못했다`);
    const head = body.slice(i, i + 500);
    assert.ok(/class="auth-brand"/.test(head), `${label}: 간판 자리가 없다`);
    assert.ok(/bangbae/.test(head), `${label}: 그 상인회의 로고가 아니다`);
    assert.ok(!/class="mark auth-mark"/.test(head), `${label}: 아직 기본 상자 아이콘이 남아 있다`);
  }
});

test("관리자가 직접 올린 로고가 꾸러미보다 앞선다", async () => {
  const env = makeEnv({}); await seed(env, BUNDLED_NAME, "uploaded-logo.png");
  const body = await (await get(env, jar(), "/t/bb/login")).text();
  const head = body.slice(body.indexOf('class="auth-head"'), body.indexOf('class="auth-head"') + 500);
  assert.ok(/uploaded-logo\.png/.test(head), "올린 로고가 안 쓰였다");
  assert.ok(!/bangbae-cafe/.test(head), "올린 로고가 있는데 꾸러미가 이겼다");
});

test("바닥글도 올린 로고를 쓴다 — 예전엔 꾸러미만 봤다", async () => {
  const env = makeEnv({}); await seed(env, BUNDLED_NAME, "uploaded-logo.png");
  const body = await (await get(env, jar(), "/t/bb/login")).text();
  const foot = body.slice(body.indexOf("foot-bottom"));
  assert.ok(/uploaded-logo\.png/.test(foot), "바닥글이 올린 로고를 무시했다");
});

test("간판이 없는 상인회는 기본 아이콘으로 돌아간다 (빈 자리로 두지 않는다)", async () => {
  const env = makeEnv({}); await seed(env, "이름없는 상인회", "");
  const body = await (await get(env, jar(), "/t/bb/login")).text();
  const head = body.slice(body.indexOf('class="auth-head"'), body.indexOf('class="auth-head"') + 500);
  assert.ok(/class="mark auth-mark"/.test(head), "간판도 아이콘도 없는 빈 카드가 됐다");
});

// ── 간판 색까지 로고에서 온다 ─────────────────────────────────────────────
//
// 로고는 주황인데 단추만 파란 화면은 "우리 홈페이지" 로 안 읽힌다. 그렇다고 배포 한 번에
// 관리자가 고른 색을 조용히 되돌려서도 안 된다. 그래서 **아직 아무도 안 고른 자리**만 채운다.
import { bundledBrandColor, PLATFORM_BRAND, bundledBrand } from "../src/brandAssets.js";
import { onBrandInk } from "../src/render.js";

test("색을 고른 적이 없으면 로고 색이 화면 전체에 깔린다", async () => {
  const env = makeEnv({});
  const a = await seed(env);
  await D.updateAssociation(env.DB, a.id, { name: BUNDLED_NAME, tagline: "", brand_color: PLATFORM_BRAND,
    phone: "", email: "", address: "", logo: "", hero_image: "" });
  const body = await (await get(env, jar(), "/t/bb/login")).text();
  assert.ok(/--brand:#C24310/i.test(body), "로고는 주황인데 화면은 남의 색이다");
  assert.ok(!/--brand:#1F6CFF/i.test(body));
});

test("상인회가 고른 색은 배포가 덮어쓰지 않는다", () => {
  assert.equal(bundledBrandColor({ name: BUNDLED_NAME, brand_color: "#1B6B45" }), "",
    "관리자가 고른 색을 꾸러미가 밀어냈다");
  assert.equal(bundledBrandColor({ name: BUNDLED_NAME, brand_color: PLATFORM_BRAND }), "#C24310");
  assert.equal(bundledBrandColor({ name: BUNDLED_NAME, brand_color: "" }), "#C24310");
  assert.equal(bundledBrandColor({ name: "남의 상인회", brand_color: "" }), "", "남의 조직에 우리 색을 발랐다");
});

test("화면에 쓰는 주황은 흰 글자가 읽히는 색이다", () => {
  // 로고 주황(#EA5515)을 그대로 깔면 흰 글자 대비가 3.62 로 기준(4.5)에 못 미친다.
  // 눈으로는 "예쁜데?" 로 보이고, 안 읽히는 사람만 안 읽는다. 그래서 한 단계 어두운 형제 색을 쓴다.
  const b = bundledBrand({ name: BUNDLED_NAME });
  const cr = (hex) => {
    const lum = (h) => { const v = [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    return 1.05 / (lum(hex) + 0.05);
  };
  assert.ok(cr(b.logoInk) < 4.5, "로고 주황이 이미 통과한다면 어둡게 할 이유가 없다 — 전제가 바뀌었다");
  assert.ok(cr(b.brand) >= 4.5, `화면 주황 위 흰 글자가 안 읽힌다 (${cr(b.brand).toFixed(2)}:1)`);
  assert.equal(onBrandInk(b.brand), "#fff", "흰 글자가 읽히는데 먹 글자를 골랐다");
  // 같은 색으로 보여야 한다 — 로고 옆에 다른 주황이 놓이면 그게 더 이상하다
  const hue = (h) => { const [r, g, bb] = [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16));
    return Math.round(Math.atan2(Math.sqrt(3) * (g - bb), 2 * r - g - bb) * 180 / Math.PI); };
  assert.ok(Math.abs(hue(b.brand) - hue(b.logoInk)) <= 6, "어둡게 하다가 색상 자체가 달라졌다");
});

test("설정 화면 맨 앞에 '우리 로고 색' 이 있다", async () => {
  const env = makeEnv({}); await seed(env);
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/login")).text()) || [])[1];
  await worker.fetch(new Request(B + "/t/bb/login", { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, login: "a@bb.kr", password: "admin1234" }).toString() }), env)
    .then((r) => absorb(j, r));
  const html = await (await get(env, j, "/t/bb/admin")).text();
  const i = html.indexOf("theme-swatches");
  assert.ok(i > 0, "색 고르는 자리를 못 찾았다");
  assert.ok(html.slice(i, i + 400).includes("우리 로고 색"), "간판 색을 눈으로 맞춰 고르게 두고 있다");
  assert.ok(html.slice(i, i + 400).includes("#C24310"));
});

test("머리말·바닥글·인증카드·파비콘이 모두 새 주황 로고를 쓴다", async () => {
  const env = makeEnv({}); await seed(env);
  const body = await (await get(env, jar(), "/t/bb/login")).text();
  for (const [where, pat] of [
    ["즐겨찾기 아이콘", /rel="icon" href="\/img\/brand\/bangbae-house\.svg"/],
    ["홈 화면 아이콘", /apple-touch-icon" href="\/img\/brand\/bangbae-house-180\.png"/],
    ["공유 미리보기", /og:image" content="[^"]*\/img\/brand\/bangbae-cafe-og\.png"/],
    ["가로형 로고", /\/img\/brand\/bangbae-cafe\.svg/],
  ]) assert.ok(pat.test(body), `${where} 가 아직 옛 로고다`);
  assert.ok(!/bangbae-union|bangbae-mark/.test(body), "옛 연합회 로고가 아직 남아 있다");
});

test("로고 꾸러미가 가리키는 파일이 실제로 있다", async () => {
  // 경로 오타는 배포 뒤 '깨진 이미지' 로만 드러난다 — 그때는 이미 손님이 본 뒤다.
  const { readFileSync } = await import("node:fs");
  const b = bundledBrand({ name: BUNDLED_NAME });
  for (const k of ["mark", "icon", "wide", "tall", "og"]) {
    const f = new URL("../public" + b[k], import.meta.url);
    assert.ok(readFileSync(f).length > 200, `${k}: ${b[k]} 가 없거나 비었다`);
  }
});

test("가로형 로고에 흰 바탕이 깔려 있지 않다", async () => {
  // 누끼가 안 따져 있으면 어두운 바닥글 위에서 흰 네모가 그대로 보인다.
  const { readFileSync } = await import("node:fs");
  const svg = readFileSync(new URL("../public/img/brand/bangbae-cafe.svg", import.meta.url), "utf8");
  assert.ok(!/fill="#?(fff|ffffff)"/i.test(svg), "로고에 흰 배경이 남아 있다");
  assert.ok(/#ea5615|#EA5615/i.test(svg), "로고 주황이 없다 — 엉뚱한 파일이다");
});
