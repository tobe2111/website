// 운영사가 콘솔에서 붙여넣는 지도 열쇠.
//
// 카카오 REST 키를 받아 놓고도 Cloudflare 대시보드를 못 찾아 며칠을 못 넣었다.
// 그래서 운영사 콘솔에 붙여넣는 칸을 두었다. 워커 Secret 이 있으면 그쪽이 이긴다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { withStoredKeys, readStoredKeys, forgetStoredKeys } from "../src/keys.js";

const BASE = "http://localhost";
const KEY = "5dd74bccb797640b0efd070467f3baff";   // 모양만 같은 가짜 열쇠

function stubKakao(status = 200) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, init) => {
    const url = String(u && u.url ? u.url : u);
    if (url.includes("dapi.kakao.com")) {
      calls.push(init && init.headers && init.headers.Authorization);
      return new Response(JSON.stringify({ documents: [], meta: { total_count: 0 } }), { status, headers: { "content-type": "application/json" } });
    }
    return real(u, init);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

async function superJar(env) {
  const pw = await hashPassword("super1234");
  await D.createUser(env.DB, { email: "s@platform.kr", passwordHash: pw.hash, salt: pw.salt, name: "운영자", role: "SUPERADMIN", associationId: null });
  const f = (path, init) => worker.fetch(new Request(BASE + path, init), env, { waitUntil() {}, passThroughOnException() {} });
  const g = await f("/login");
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const lr = await f("/login", { method: "POST", headers: { cookie: seed, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: tk, email: "s@platform.kr", password: "super1234" }) });
  const cookie = [seed, ...(lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");
  const post = async (path, fields) => {
    const t = (/name="_csrf" value="([^"]+)"/.exec(await (await f("/super", { headers: { cookie } })).text()) || [])[1];
    return f(path, { method: "POST", headers: { cookie, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: t, ...fields }) });
  };
  return { f, cookie, post };
}

test("콘솔에 붙여넣은 카카오 열쇠가 저장되고, 화면에는 앞 네 글자만 남는다", async () => {
  const env = makeEnv(); const s = await superJar(env);
  const k = stubKakao(200);
  try {
    const before = await (await s.f("/super", { headers: { cookie: s.cookie } })).text();
    assert.match(before, /지도 열쇠 넷은 아래 칸에/);
    assert.match(before, /name="KAKAO_REST_KEY"/);
    const r = await s.post("/super/keys", { KAKAO_REST_KEY: ` ${KEY}\n` });
    assert.equal(r.status, 303);
    const msg = decodeURIComponent(r.headers.get("location"));
    assert.match(msg, /카카오 REST API 키 저장/);
    assert.match(msg, /카카오가 열쇠를 확인해 주었습니다/);
    assert.equal(k.calls.length, 1, "저장 전에 카카오에 한 번 물어본다");
    assert.equal(k.calls[0], `KakaoAK ${KEY}`, "공백·줄바꿈을 떼고 묻는다");
    assert.equal(await D.getSetting(env.DB, "key_KAKAO_REST_KEY"), KEY);
    const after = await (await s.f("/super", { headers: { cookie: s.cookie } })).text();
    assert.match(after, /저장됨 5dd7…/);
    assert.ok(!after.includes(KEY), "열쇠 전체는 화면에 다시 보이지 않는다");
    // '있으면 좋은 것' 이 켜짐으로 센다
    const at = after.indexOf("있으면 좋은 것");
    assert.match(after.slice(at, at + 200), /1\/6 켜짐/);
  } finally { k.restore(); }
});

test("저장된 열쇠로 관리자 화면의 카카오 검색이 실제로 켜진다", async () => {
  const env = makeEnv(); const s = await superJar(env);
  const k = stubKakao(200);
  try {
    await s.post("/super/keys", { KAKAO_REST_KEY: KEY });
    const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목상인회", kind: "merchant" });
    const pw = await hashPassword("admin1234");
    await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
    const jar = () => ({ c: {} });
    const j = jar();
    const ch = () => Object.entries(j.c).map(([kk, v]) => `${kk}=${v}`).join("; ");
    const absorb = (r) => { for (const c of r.headers.getSetCookie?.() || []) { const kv = c.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
    const g = await worker.fetch(new Request(BASE + "/t/bb/login"), env); absorb(g);
    const t = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
    absorb(await worker.fetch(new Request(BASE + "/t/bb/login", { method: "POST", headers: { cookie: ch(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: t, login: "a@bb.kr", password: "admin1234" }).toString() }), env));
    const map = await (await worker.fetch(new Request(BASE + "/t/bb/admin/members/map", { headers: { cookie: ch() } }), env)).text();
    assert.match(map, /카카오 <b>있음<\/b>|카카오 있음/, map.slice(map.indexOf("지도 열쇠"), map.indexOf("지도 열쇠") + 120));
  } finally { k.restore(); }
});

test("워커 Secret 이 있으면 그쪽이 이기고, 지우기를 켜면 저장한 값이 사라진다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "env-wins-0000000000000000000000" });
  await D.setSetting(env.DB, "key_KAKAO_REST_KEY", KEY);
  const merged = await withStoredKeys(env, env.DB, null);
  assert.equal(merged.KAKAO_REST_KEY, "env-wins-0000000000000000000000");
  const env2 = makeEnv();
  await D.setSetting(env2.DB, "key_KAKAO_REST_KEY", KEY);
  assert.equal((await withStoredKeys(env2, env2.DB, null)).KAKAO_REST_KEY, KEY);
  const s = await superJar(env2);
  const r = await s.post("/super/keys", { clear_KAKAO_REST_KEY: "1" });
  assert.match(decodeURIComponent(r.headers.get("location")), /카카오 REST API 키 지움/);
  assert.equal(await D.getSetting(env2.DB, "key_KAKAO_REST_KEY"), null);
});

test("모양이 틀리거나 카카오가 거절한 열쇠는 저장하지 않는다", async () => {
  const env = makeEnv(); const s = await superJar(env);
  const r1 = await s.post("/super/keys", { KAKAO_REST_KEY: "not-a-key" });
  assert.match(decodeURIComponent(r1.headers.get("location")), /받지 않은 값: 카카오 REST API 키/);
  const k = stubKakao(401);
  try {
    const r2 = await s.post("/super/keys", { KAKAO_REST_KEY: KEY });
    assert.match(decodeURIComponent(r2.headers.get("location")), /카카오가 거절한 열쇠/);
  } finally { k.restore(); }
  assert.equal(await D.getSetting(env.DB, "key_KAKAO_REST_KEY"), null);
  // 빈 칸으로 저장하면 아무것도 안 바뀐다
  const r3 = await s.post("/super/keys", {});
  assert.match(decodeURIComponent(r3.headers.get("location")), /바뀐 것이 없습니다/);
});

test("읽은 값은 잠깐 기억하고, 저장하면 곧바로 잊는다", async () => {
  const env = makeEnv();
  const raw = {};
  assert.deepEqual(await readStoredKeys(env.DB, raw), {});
  await D.setSetting(env.DB, "key_NAVER_SEARCH_ID", "abcd1234");
  assert.deepEqual(await readStoredKeys(env.DB, raw), {}, "1분 안에는 기억한 값을 준다");
  forgetStoredKeys(raw);
  assert.deepEqual(await readStoredKeys(env.DB, raw), { NAVER_SEARCH_ID: "abcd1234" });
});
