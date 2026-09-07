// 운영사 콘솔로 가는 문은 고객사(상인회) 관리 화면에 두지 않는다.
//
// 이 화면은 그 상인회의 관리 화면이고, 상인회 임원이 옆에서 함께 보는 화면이기도 하다.
// 거기 상단에 "운영사 콘솔" 이 떠 있으면 "이 홈페이지는 우리 것이 아니라 남의 시스템"
// 으로 읽힌다. 운영자는 계정 설정에 있는 입구로 간다.
//
// 문을 옮긴 것이지 없앤 것이 아니므로, 계정 설정에는 반드시 남아 있어야 한다 —
// 그러지 않으면 운영자가 자기 콘솔로 돌아갈 길이 사라진다.
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
const get = async (env, j, p) => { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; };

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회", kind: "merchant" });
  const sp = await hashPassword("super1234");
  await D.createUser(env.DB, { email: "s@x.kr", passwordHash: sp.hash, salt: sp.salt, name: "운영", role: "SUPERADMIN", associationId: null });
  const ap = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: ap.hash, salt: ap.salt, name: "회장", role: "ADMIN", associationId: a.id });
  return a;
}

const login = async (env, email, password) => {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/login")).text()) || [])[1];
  const r = await worker.fetch(new Request(B + "/t/bb/login", { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, login: email, password }).toString() }), env);
  absorb(j, r); return j;
};

// 상단 줄(머리글)만 떼어 본다. 본문에 '운영사' 라는 낱말이 설명으로 나올 수는 있으므로
// 페이지 전체에서 찾으면 엉뚱한 곳을 잡는다.
const headerOf = (html) => {
  const i = html.indexOf('<header class="site-header"');
  return i < 0 ? "" : html.slice(i, html.indexOf("</header>", i));
};

test("운영사 계정이 상인회 콘솔을 봐도 상단에 '운영사 콘솔' 이 없다", async () => {
  const env = makeEnv({});
  await seed(env);
  const j = await login(env, "s@x.kr", "super1234");
  const head = headerOf(await (await get(env, j, "/t/bb/admin")).text());
  assert.ok(head.length > 0, "머리글을 찾지 못했다 — 검사가 헛돌고 있다");
  assert.ok(!/href="\/super"/.test(head), "상인회 콘솔 상단에 운영사 콘솔 링크가 있다");
  assert.ok(!head.includes("운영사 콘솔"), "상인회 콘솔 상단에 '운영사 콘솔' 글자가 있다");
  assert.ok(head.includes("홈페이지 보기"), "'홈페이지 보기' 는 그대로 있어야 한다");
});

test("상인회 관리자에게도 당연히 없다", async () => {
  const env = makeEnv({});
  await seed(env);
  const j = await login(env, "a@bb.kr", "admin1234");
  const head = headerOf(await (await get(env, j, "/t/bb/admin")).text());
  assert.ok(!/href="\/super"/.test(head));
});

test("운영사 콘솔 입구는 계정 설정에 그대로 남아 있다", async () => {
  const env = makeEnv({});
  await seed(env);
  const j = await login(env, "s@x.kr", "super1234");
  const body = await (await get(env, j, "/account")).text();
  assert.ok(body.includes("운영사 콘솔 열기"), "운영자가 자기 콘솔로 돌아갈 길이 사라졌다");
  assert.ok(/href="\/super"/.test(body));
});

test("상인회 관리자의 계정 설정에는 그 입구가 없다", async () => {
  const env = makeEnv({});
  await seed(env);
  const j = await login(env, "a@bb.kr", "admin1234");
  const body = await (await get(env, j, "/account")).text();
  assert.ok(!body.includes("운영사 콘솔 열기"));
});
