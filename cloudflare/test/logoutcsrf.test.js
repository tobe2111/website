// 로그아웃이 403 으로 튕기던 사고 — 머리말 안의 폼에는 CSRF 토큰이 안 붙었다.
//
// 토큰 주입은 본문(body)에만 걸려 있었는데, 로그아웃 단추는 머리말에서 따로 만들어지는 폼이라
// 어느 화면에서 눌러도 '403 잘못된 요청(CSRF)' 이 떴다. 라이브에서 관리자가 로그아웃을 못 했다.
//
// 그래서 두 가지를 함께 못 박는다.
//  ① 화면에 그려지는 모든 POST 폼에는 토큰이 붙는다 (본문이든 머리말이든 바닥글이든)
//  ② 그렇다고 검사가 헐거워지지는 않는다 — 토큰 없는 POST 는 여전히 403
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
const get = async (env, j, p) => {
  const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env);
  absorb(j, r); return r;
};
const post = async (env, j, p, f) => {
  const r = await worker.fetch(new Request(B + p, {
    method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(f).toString(),
  }), env);
  absorb(j, r); return r;
};

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회", kind: "merchant" });
  const pw = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/login")).text()) || [])[1];
  await post(env, j, "/login", { _csrf: t, email: "a@bb.kr", password: "admin1234" });
  return { a, j };
}

test("화면에 그려진 POST 폼에는 빠짐없이 CSRF 토큰이 붙는다 (머리말·바닥글 포함)", async () => {
  const env = makeEnv(); const { j } = await seed(env);
  for (const p of ["/t/bb/admin", "/t/bb/", "/t/bb/notices"]) {
    const html = await (await get(env, j, p)).text();
    const forms = [...html.matchAll(/<form\b[^>]*\bmethod\s*=\s*["']post["'][^>]*>([\s\S]*?)<\/form>/gi)];
    assert.ok(forms.length, `${p} 에 POST 폼이 있어야 검사가 의미가 있다`);
    const bare = forms.filter((f) => !f[1].includes('name="_csrf"'));
    assert.equal(bare.length, 0, `${p} 에 토큰 없는 폼 ${bare.length}개 — 누르면 403 이 된다`);
  }
});

test("관리자가 로그아웃을 누르면 실제로 로그아웃된다", async () => {
  const env = makeEnv(); const { j } = await seed(env);
  const html = await (await get(env, j, "/t/bb/admin")).text();
  // 머리말의 로그아웃 폼에 실제로 박힌 토큰만 쓴다 — 다른 데서 가져오면 사고를 못 잡는다
  const tok = (/<form[^>]*action="\/t\/bb\/logout"[^>]*>\s*<input type="hidden" name="_csrf" value="([^"]+)"/.exec(html) || [])[1];
  assert.ok(tok, "로그아웃 폼 안에 토큰이 있어야");
  const out = await post(env, j, "/t/bb/logout", { _csrf: tok });
  assert.equal(out.status, 303, "403 이 아니라 정상 이동이어야");
  const after = await get(env, j, "/t/bb/admin");
  assert.equal(after.status, 303, "로그아웃 뒤에는 관리자 화면에 못 들어간다");
  assert.match(after.headers.get("location") || "", /\/login/);
});

test("토큰 없는 POST 는 그대로 막힌다 — 고치면서 검사를 풀지 않았다", async () => {
  const env = makeEnv(); const { j } = await seed(env);
  const r = await post(env, j, "/t/bb/logout", {});
  assert.equal(r.status, 403, "토큰이 없으면 403");
  const bad = await post(env, j, "/t/bb/logout", { _csrf: "aaaaaaaaaaaaaaaaaaaa" });
  assert.equal(bad.status, 403, "남의 토큰·가짜 토큰도 403");
});
