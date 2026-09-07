// 상인회 안에서 로그인·로그아웃하면 상인회 안에 머물러야 한다.
//
// 라이브에서 상인회 관리자가 로그아웃했더니 플랫폼 첫 화면("리스터코퍼레이션")으로 튕겼다.
// 로그인이 필요할 때도 공용 로그인으로 보내서, 남의 회사 로고와 이름이 뜬 화면에서
// 비밀번호를 치라고 요구하고 있었다. 손님·사장님 눈에는 다른 사이트로 넘어간 것과 같다.
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
const post = async (env, j, p, f) => {
  const r = await worker.fetch(new Request(B + p, { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(f).toString() }), env);
  absorb(j, r); return r;
};

async function seed(env) {
  const sp = await hashPassword("super1234");
  await D.createUser(env.DB, { email: "s@x.kr", passwordHash: sp.hash, salt: sp.salt, name: "운영", role: "SUPERADMIN", associationId: null });
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회", kind: "merchant" });
  const pw = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  return a;
}
const login = async (env) => {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/login")).text()) || [])[1];
  await post(env, j, "/t/bb/login", { _csrf: t, login: "a@bb.kr", password: "admin1234" });
  return j;
};

test("로그인이 필요하면 그 상인회의 로그인으로 보낸다", async () => {
  const env = makeEnv(); await seed(env);
  const r = await get(env, jar(), "/t/bb/admin");
  const to = r.headers.get("location") || "";
  assert.ok(to.startsWith("/t/bb/login"), `공용 로그인이 아니라 상인회 로그인이어야: ${to}`);
  assert.match(to, /next=%2Ft%2Fbb%2Fadmin/, "로그인 뒤 원래 자리로 돌아가야");
});

test("상인회 로그인 화면에는 그 상인회가 보인다 — 남의 회사 이름이 아니라", async () => {
  const env = makeEnv(); await seed(env);
  const html = await (await get(env, jar(), "/t/bb/login")).text();
  assert.match(html, /방배카페골목/, "상인회 이름이 떠야");
  assert.doesNotMatch(html, /리스터코퍼레이션/, "플랫폼 이름이 뜨면 다른 사이트로 넘어간 것처럼 보인다");
  assert.match(html, /\/t\/bb\/register/, "가입 길이 같은 상인회 안에 있어야");
  assert.match(html, /action="\/t\/bb\/login"/, "로그인도 상인회 주소로 보내야");
});

test("로그아웃하면 플랫폼이 아니라 그 상인회 홈으로 돌아간다", async () => {
  const env = makeEnv(); await seed(env);
  const j = await login(env);
  const html = await (await get(env, j, "/t/bb/admin")).text();
  const tok = (/<form[^>]*action="\/t\/bb\/logout"[^>]*>\s*<input type="hidden" name="_csrf" value="([^"]+)"/.exec(html) || [])[1];
  assert.ok(tok, "머리말의 로그아웃 폼이 상인회 주소여야");
  const out = await post(env, j, "/t/bb/logout", { _csrf: tok });
  assert.equal(out.status, 303);
  assert.equal(out.headers.get("location"), "/t/bb/", "상인회 홈으로 돌아가야");
});

test("플랫폼 화면에서는 그대로 공용 로그인·첫 화면을 쓴다", async () => {
  const env = makeEnv(); await seed(env);
  const r = await get(env, jar(), "/super");
  assert.ok((r.headers.get("location") || "").startsWith("/login"), "테넌트 밖에서는 공용 로그인");
});
