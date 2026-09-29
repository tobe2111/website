// 카카오 로그인 — 비밀번호 없이 들어오는 문.
//
// 카카오 서버를 부를 수 없으므로 fetch 를 가로채 흉내 낸다. 확인하는 것은 두 가지다.
//   ① 누구인지 정하는 규칙이 정확한가 (모르는 사람을 들여보내지 않는가)
//   ② 남이 시작한 로그인을 가로채지 못하는가 (state 서명)
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { makeState, readState, normalizeKakaoPhone, resolveKakaoUser } from "../src/kakao.js";

const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, u) { const r = await worker.fetch(new Request(u, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, u, f, csrfFrom) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, csrfFrom)).text()) || [])[1];
  const r = await worker.fetch(new Request(u, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}

// 카카오 흉내 — 토큰 교환과 사용자 정보만 가로챈다.
function fakeKakao({ id = "888111", phone = "+82 10-3333-4444", name = "김사장", email = "" } = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = String(input && input.url ? input.url : input);
    if (u.startsWith("https://kauth.kakao.com/oauth/token"))
      return new Response(JSON.stringify({ access_token: "tok-abc", token_type: "bearer" }), { headers: { "content-type": "application/json" } });
    if (u.startsWith("https://kapi.kakao.com/v2/user/me"))
      return new Response(JSON.stringify({ id: Number(id), kakao_account: { phone_number: phone, name, email, profile: { nickname: name } } }), { headers: { "content-type": "application/json" } });
    return real ? real(input, init) : new Response("", { status: 404 });
  };
  return () => { globalThis.fetch = real; };
}

async function setup() {
  const env = makeEnv();
  env.KAKAO_REST_KEY = "0123456789abcdef0123456789abcdef";
  const a = await D.createAssociation(env.DB, { slug: "market", name: "방배카페골목상인회", kind: "merchant" });
  const p = await hashPassword("owner1234");
  const uid = await D.createUser(env.DB, { email: "boss@m.kr", passwordHash: p.hash, salt: p.salt, name: "김사장", role: "MERCHANT", associationId: a.id });
  await D.setUserPhone(env.DB, uid.id ?? uid, "01033334444");
  return { env, a, user: uid };
}

test("state 는 우리가 서명한 것만 돌아온다", async () => {
  const s = await makeState("secret-1", { base: "/t/market", next: "/polls", uid: 7 });
  const ok = await readState("secret-1", s);
  assert.deepEqual(ok, { base: "/t/market", next: "/polls", uid: 7 });
  assert.equal(await readState("secret-2", s), null, "다른 열쇠로 서명한 것은 받지 않는다");
  assert.equal(await readState("secret-1", s.replace(/\.[^.]+$/, ".bogus")), null, "서명을 바꾸면 거절");
  assert.equal(await readState("secret-1", "aaa"), null);
  assert.equal(await readState("secret-1", ""), null);
});

test("카카오가 주는 번호 꼴을 우리 명부 꼴로 바꾼다", () => {
  assert.equal(normalizeKakaoPhone("+82 10-1234-5678"), "01012345678");
  assert.equal(normalizeKakaoPhone("+82 10 1234 5678"), "01012345678");
  assert.equal(normalizeKakaoPhone("010-1234-5678"), "01012345678");
  assert.equal(normalizeKakaoPhone("+82 2-123-4567"), "", "집 전화는 받지 않는다");
  assert.equal(normalizeKakaoPhone(""), "");
});

test("명부에 있는 번호면 첫 로그인부터 통과한다", async () => {
  const { env } = await setup();
  const done = fakeKakao({ phone: "+82 10-3333-4444" });
  try {
    const j = jar();
    const start = await get(env, j, "http://localhost/t/market/auth/kakao");
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get("location"));
    assert.equal(to.origin + to.pathname, "https://kauth.kakao.com/oauth/authorize");
    assert.equal(to.searchParams.get("redirect_uri"), "http://localhost/auth/kakao/callback");
    const state = to.searchParams.get("state");

    const cb = await get(env, j, `http://localhost/auth/kakao/callback?code=xyz&state=${encodeURIComponent(state)}`);
    assert.equal(cb.status, 303);
    assert.match(cb.headers.get("location"), /dashboard/, "사장님 화면으로 들어간다");
    // 두 번째부터는 번호가 아니라 이어 둔 카카오로 곧장 통과한다
    const u = await D.getUserByKakaoId(env.DB, "888111");
    assert.ok(u, "카카오가 계정에 이어졌다");
    assert.equal(u.email, "boss@m.kr");
  } finally { done(); }
});

test("명부에 없는 번호면 들여보내지 않고 계정도 만들지 않는다", async () => {
  const { env } = await setup();
  const done = fakeKakao({ id: "999222", phone: "+82 10-7777-8888" });
  try {
    const j = jar();
    const start = await get(env, j, "http://localhost/t/market/auth/kakao");
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const cb = await get(env, j, `http://localhost/auth/kakao/callback?code=xyz&state=${encodeURIComponent(state)}`);
    assert.equal(cb.status, 303);
    const loc = decodeURIComponent(cb.headers.get("location"));
    assert.match(loc, /err=1/);
    assert.match(loc, /등록된 회원이 없습니다/);
    assert.equal(await D.getUserByKakaoId(env.DB, "999222"), null, "계정을 새로 만들지 않는다");
  } finally { done(); }
});

test("카카오가 번호를 안 주면 로그인한 사람만 연결할 수 있다", async () => {
  const { env } = await setup();
  const done = fakeKakao({ id: "555444", phone: "" });     // 비즈니스 앱 전환 전
  try {
    // ① 로그인하지 않은 채로는 막힌다
    let j = jar();
    let start = await get(env, j, "http://localhost/t/market/auth/kakao");
    let state = new URL(start.headers.get("location")).searchParams.get("state");
    let cb = await get(env, j, `http://localhost/auth/kakao/callback?code=c&state=${encodeURIComponent(state)}`);
    assert.match(decodeURIComponent(cb.headers.get("location")), /휴대폰 번호를 받지 못해/);
    assert.equal(await D.getUserByKakaoId(env.DB, "555444"), null);

    // ② 먼저 비밀번호로 들어온 뒤에는 이어 붙는다
    j = jar();
    await post(env, j, "http://localhost/t/market/login", { login: "boss@m.kr", password: "owner1234" }, "http://localhost/t/market/login");
    start = await get(env, j, "http://localhost/t/market/auth/kakao");
    state = new URL(start.headers.get("location")).searchParams.get("state");
    cb = await get(env, j, `http://localhost/auth/kakao/callback?code=c&state=${encodeURIComponent(state)}`);
    assert.equal(cb.status, 303);
    assert.match(decodeURIComponent(cb.headers.get("location")), /카카오 계정을 연결했습니다/);
    const u = await D.getUserByKakaoId(env.DB, "555444");
    assert.ok(u && u.email === "boss@m.kr");
  } finally { done(); }
});

test("같은 번호를 쓰는 계정이 둘이면 아무도 통과시키지 않는다", async () => {
  const { env, a } = await setup();
  const p2 = await hashPassword("other1234");
  const u2 = await D.createUser(env.DB, { email: "other@m.kr", passwordHash: p2.hash, salt: p2.salt, name: "이사장", role: "MERCHANT", associationId: a.id });
  await D.setUserPhone(env.DB, u2.id ?? u2, "01033334444");   // 같은 번호
  const done = fakeKakao({ id: "777333", phone: "+82 10-3333-4444" });
  try {
    const j = jar();
    const start = await get(env, j, "http://localhost/t/market/auth/kakao");
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const cb = await get(env, j, `http://localhost/auth/kakao/callback?code=c&state=${encodeURIComponent(state)}`);
    assert.match(decodeURIComponent(cb.headers.get("location")), /err=1/);
    assert.equal(await D.getUserByKakaoId(env.DB, "777333"), null, "누구인지 모르면 아무에게도 잇지 않는다");
  } finally { done(); }
});

test("남이 만든 code 를 밀어 넣어도 붙지 않는다 (state 없음·위조)", async () => {
  const { env } = await setup();
  const done = fakeKakao({ id: "444555", phone: "+82 10-3333-4444" });
  try {
    const j = jar();
    for (const q of ["code=x", "code=x&state=", "code=x&state=forged.sig"]) {
      const cb = await get(env, j, `http://localhost/auth/kakao/callback?${q}`);
      assert.equal(cb.status, 303);
      assert.match(decodeURIComponent(cb.headers.get("location")), /만료되었거나 올바르지 않습니다/);
    }
    assert.equal(await D.getUserByKakaoId(env.DB, "444555"), null);
  } finally { done(); }
});

test("열쇠가 없으면 단추도 없고 주소로 들어가도 막힌다", async () => {
  const { env } = await setup();
  delete env.KAKAO_REST_KEY;                 // 운영사가 아직 열쇠를 넣지 않은 상태
  const j = jar();
  const page = await (await get(env, j, "http://localhost/t/market/login")).text();
  assert.ok(!page.includes("카카오로 로그인"), "열쇠가 없으면 단추를 보이지 않는다");
  const r = await get(env, j, "http://localhost/t/market/auth/kakao");
  assert.equal(r.status, 303);
  assert.match(decodeURIComponent(r.headers.get("location")), /아직 준비되지 않았습니다/);
});

test("연결을 해제해도 계정은 남는다", async () => {
  const { env } = await setup();
  const done = fakeKakao({ id: "222111", phone: "+82 10-3333-4444" });
  try {
    const j = jar();
    const start = await get(env, j, "http://localhost/t/market/auth/kakao");
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    await get(env, j, `http://localhost/auth/kakao/callback?code=c&state=${encodeURIComponent(state)}`);
    assert.ok(await D.getUserByKakaoId(env.DB, "222111"));
    const r = await post(env, j, "http://localhost/account/kakao/unlink", {}, "http://localhost/account");
    assert.equal(r.status, 303);
    assert.equal(await D.getUserByKakaoId(env.DB, "222111"), null);
    const still = await D.getUserByEmail(env.DB, "boss@m.kr");
    assert.ok(still, "사람은 그대로 있다");
  } finally { done(); }
});

test("규칙 표 — 누구인지 정하는 네 갈래", async () => {
  const { env, a } = await setup();
  const me = await D.getUserByEmail(env.DB, "boss@m.kr");
  // ① 이미 이어 둔 카카오
  await D.setUserKakao(env.DB, me.id, "aaa");
  assert.equal((await resolveKakaoUser(env.DB, { id: "aaa", phone: "" }, {})).kind, "login");
  // ② 다른 카카오가 붙어 있는 계정에 또 붙이려 할 때
  assert.equal((await resolveKakaoUser(env.DB, { id: "bbb", phone: "" }, { uid: me.id })).kind, "already");
  await D.clearUserKakao(env.DB, me.id);
  // ③ 로그인한 채로 연결
  assert.equal((await resolveKakaoUser(env.DB, { id: "bbb", phone: "" }, { uid: me.id })).kind, "link");
  // ④ 번호로 찾기 / 못 찾기 / 번호 없음
  assert.equal((await resolveKakaoUser(env.DB, { id: "ccc", phone: "01033334444" }, { assocId: a.id })).kind, "link");
  assert.equal((await resolveKakaoUser(env.DB, { id: "ccc", phone: "01099990000" }, { assocId: a.id })).kind, "unknown");
  assert.equal((await resolveKakaoUser(env.DB, { id: "ccc", phone: "" }, {})).kind, "nophone");
});
