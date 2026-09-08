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
  assert.ok(!/bangbae-union/.test(head), "올린 로고가 있는데 꾸러미가 이겼다");
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
