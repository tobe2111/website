// 들어온 문으로 들어간다.
//
// 방배카페골목 로그인 화면에서 비밀번호를 넣었는데 리스터코퍼레이션 운영사 콘솔이
// 열리면, 로그인한 사람 눈에는 남의 회사로 튕긴 것이다. 실패했을 때도 마찬가지 —
// 비밀번호를 한 번 틀렸더니 갑자기 남의 회사 로그인 화면이 뜨면 안 된다.
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
  await D.createUser(env.DB, { email: "s@x.kr", passwordHash: sp.hash, salt: sp.salt, name: "플랫폼 운영자", role: "SUPERADMIN", associationId: null });
  const ap = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: ap.hash, salt: ap.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const mp = await hashPassword("owner1234");
  const o = await D.createUser(env.DB, { email: "o@bb.kr", passwordHash: mp.hash, salt: mp.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  await D.createBusiness(env.DB, { associationId: a.id, ownerId: o.id, name: "너나들이", category: "음식점" });
  return a;
}
// 로그인 화면(from)에서 폼을 채워 보낸다 — 그 화면의 CSRF 토큰을 그대로 쓴다.
async function tryLogin(env, from, login, password) {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + from, { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, login, password }).toString() }), env);
  absorb(j, r);
  return { status: r.status, to: r.headers.get("location") || "", jar: j };
}

test("상인회 화면에서 운영사 계정으로 들어오면 그 상인회 관리 화면으로", async () => {
  const env = makeEnv({}); await seed(env);
  const r = await tryLogin(env, "/t/bb/login", "s@x.kr", "super1234");
  assert.equal(r.to, "/t/bb/admin", `운영사 콘솔로 튕겼다: ${r.to}`);
});

test("공용 로그인에서 운영사 계정으로 들어오면 운영사 콘솔로 (기존 동작)", async () => {
  const env = makeEnv({}); await seed(env);
  const r = await tryLogin(env, "/login", "s@x.kr", "super1234");
  assert.equal(r.to, "/super", r.to);
});

test("상인회 관리자·사장님은 종전 그대로", async () => {
  const env = makeEnv({}); await seed(env);
  assert.equal((await tryLogin(env, "/t/bb/login", "a@bb.kr", "admin1234")).to, "/t/bb/admin");
  assert.equal((await tryLogin(env, "/t/bb/login", "o@bb.kr", "owner1234")).to, "/t/bb/dashboard");
});

test("비밀번호를 틀려도 그 상인회 로그인 화면에 남는다", async () => {
  const env = makeEnv({}); await seed(env);
  const r = await tryLogin(env, "/t/bb/login", "a@bb.kr", "틀린비밀번호");
  assert.ok(r.to.startsWith("/t/bb/login"), `남의 회사 로그인으로 보냈다: ${r.to}`);
});

test("상인회 콘솔 머리말에 '플랫폼 운영자' 라고 쓰지 않는다", async () => {
  // 임원이 옆에서 함께 보는 화면이다. 거기 맨 위에 운영사 이름표가 뜨면
  // "이 홈페이지는 남의 시스템" 으로 읽힌다.
  const env = makeEnv({}); await seed(env);
  const { jar: j } = await tryLogin(env, "/t/bb/login", "s@x.kr", "super1234");
  const html = await (await get(env, j, "/t/bb/admin")).text();
  const head = html.slice(html.indexOf('<header class="site-header"'), html.indexOf("</header>"));
  assert.ok(head.length > 0);
  assert.ok(!head.includes("플랫폼 운영자"), "머리말에 운영사 이름표가 있다");
  assert.ok(head.includes("내 계정"), "계정으로 가는 길이 사라졌다");
});

test("회장님 화면에는 자기 이름이 그대로 뜬다", async () => {
  const env = makeEnv({}); await seed(env);
  const { jar: j } = await tryLogin(env, "/t/bb/login", "a@bb.kr", "admin1234");
  const html = await (await get(env, j, "/t/bb/admin")).text();
  const head = html.slice(html.indexOf('<header class="site-header"'), html.indexOf("</header>"));
  assert.ok(head.includes("회장"), "관리자 본인 이름이 사라졌다");
});
