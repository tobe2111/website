// 지도에서 가게 찾기 (카카오 로컬) — 관리자가 상호만 치면 주소·전화·업종·좌표가 채워지는 길.
//
// 여기서 재는 것은 "카카오가 답한다" 가 아니라, **카카오가 답했을 때 우리가 무엇을 하는가** 입니다.
// 실제 카카오로 나가지 않고 요청을 가로채서 잽니다 — 검사에 남의 서버와 실제 키를 끌어들이면
// 그 검사는 남의 사정으로 빨개지고, 결국 아무도 안 봅니다.
//
// 특히 중요한 것 둘:
//  · 키가 없을 때 **조용히 사라지지 않는다** — 없는 것과 꺼진 것은 다릅니다.
//  · 카카오가 준 값을 우리 업종으로 옮길 때 **끝 낱말이 아니라 전체 갈래**를 봅니다.
//    '커피전문점' 만 보면 카페인지 알 수 없지만 '음식점 > 카페 > 커피전문점' 이면 분명합니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, p) { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회" });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: ad.hash, salt: ad.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const j = jar();
  await post(env, j, "/login", { email: "a@bb.kr", password: "admin1234" });
  return { a, j };
}

// 카카오 대신 답하는 가짜 창구. 무엇을 물었는지도 함께 적어 둔다.
function interceptKakao(reply) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("dapi.kakao.com")) {
      seen.push({ url, auth: (init?.headers || {}).Authorization || "" });
      return reply(url);
    }
    return real(input, init);
  };
  return { seen, restore: () => { globalThis.fetch = real; } };
}
const ok = (docs) => new Response(JSON.stringify({ documents: docs }), { headers: { "content-type": "application/json" } });

test("키가 없으면 화면에서 사라지지 않고, 왜 안 되는지 말한다", async () => {
  const env = makeEnv();                       // KAKAO_REST_KEY 없음
  const { j } = await seed(env);
  const admin = await (await get(env, j, "/t/bb/admin")).text();
  assert.ok(!admin.includes("data-place-go"), "검색 칸은 뜨지 않는다");
  assert.match(admin, /지도에서 찾기<\/b>는 지금 꺼져 있습니다/,
    "그냥 사라지면 이런 기능이 있다는 것 자체를 관리자가 알 수 없다");

  const r = await get(env, j, "/t/bb/admin/place-search?q=버들카페");
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "not_configured");
});

test("키가 있으면 검색 칸이 뜨고, 카카오가 준 값이 그대로 넘어온다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "test-key" });
  const { j } = await seed(env);
  const admin = await (await get(env, j, "/t/bb/admin")).text();
  assert.match(admin, /data-place-go/, "찾기 단추가 뜬다");
  assert.match(admin, /js\/place\.js/, "채워 주는 스크립트가 함께 실린다");

  const spy = interceptKakao(() => ok([{
    place_name: "버들카페", road_address_name: "서울 서초구 방배로 42", address_name: "서울 서초구 방배동 1",
    phone: "02-533-0000", category_name: "음식점 > 카페 > 커피전문점",
    x: "127.0011", y: "37.4812", place_url: "http://place.map.kakao.com/123",
  }]));
  try {
    const d = await (await get(env, j, "/t/bb/admin/place-search?q=버들카페")).json();
    assert.equal(d.places.length, 1);
    const p = d.places[0];
    assert.equal(p.name, "버들카페");
    assert.equal(p.address, "서울 서초구 방배로 42", "도로명이 있으면 도로명을 쓴다");
    assert.equal(p.phone, "02-533-0000");
    assert.equal(p.lat, 37.4812);
    assert.equal(p.lng, 127.0011);
    assert.equal(p.category, "커피전문점", "화면에는 끝 낱말만");
    assert.equal(p.categoryPath, "음식점 > 카페 > 커피전문점", "업종을 고를 때는 전체 갈래가 필요하다");
    assert.match(spy.seen[0].auth, /^KakaoAK test-key$/, "키는 헤더로만 나간다");
    assert.ok(!spy.seen[0].url.includes("test-key"), "주소에 키가 실리면 로그에 남는다");
  } finally { spy.restore(); }
});

test("검색어는 두 글자부터 — 한 글자로 남의 서버를 두드리지 않는다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "test-key" });
  const { j } = await seed(env);
  const spy = interceptKakao(() => ok([]));
  try {
    const d = await (await get(env, j, "/t/bb/admin/place-search?q=버")).json();
    assert.deepEqual(d.places, []);
    assert.equal(spy.seen.length, 0, "카카오까지 가지 않는다");
  } finally { spy.restore(); }
});

// 지도가 둘이 되면서 "한쪽이 아프다" 는 더 이상 실패가 아니다 — 다른 쪽으로 일이 된다.
// 여기서는 **네이버 열쇠가 없는 조직**을 재므로, 카카오가 죽으면 기댈 곳이 없어 502 가 맞다.
test("기댈 지도가 하나뿐인데 그것이 아프면, 사장님 화면이 아니라 안내 문구로 끝난다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "test-key" });
  const { j } = await seed(env);
  for (const [reply, status] of [
    [() => new Response("nope", { status: 401 }), 502],
    [() => { throw new Error("network"); }, 502],
  ]) {
    const spy = interceptKakao(reply);
    try {
      const r = await get(env, j, "/t/bb/admin/place-search?q=버들카페");
      assert.equal(r.status, status);
      assert.ok((await r.json()).message, "무슨 일인지 한 줄로 말한다");
    } finally { spy.restore(); }
  }
});

test("로그인하지 않은 사람은 이 창구를 쓸 수 없다 — 우리 카카오 한도로 남이 검색한다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "test-key" });
  await seed(env);
  const spy = interceptKakao(() => ok([]));
  try {
    const r = await get(env, jar(), "/t/bb/admin/place-search?q=버들카페");
    assert.ok(r.status === 302 || r.status === 303 || r.status === 403 || r.status === 404,
      `막아야 함 (받은 상태: ${r.status})`);
    assert.equal(spy.seen.length, 0, "카카오까지 가지 않는다");
  } finally { spy.restore(); }
});

test("카카오가 준 글자에 <script> 가 있어도 글자로 나간다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "test-key" });
  const { j } = await seed(env);
  const spy = interceptKakao(() => ok([{ place_name: '<script>alert(1)</script>', category_name: "기타", x: "0", y: "0" }]));
  try {
    const d = await (await get(env, j, "/t/bb/admin/place-search?q=버들카페")).json();
    // 화면에 넣는 것은 place.js 가 textContent 로 하므로 여기서는 값이 그대로 와도 된다.
    // 다만 place_url 처럼 **주소로 쓰이는 값**은 http(s) 가 아니면 버려야 한다.
    assert.equal(d.places[0].url, "", "http(s) 가 아닌 주소는 버린다");
  } finally { spy.restore(); }
  const spy2 = interceptKakao(() => ok([{ place_name: "나쁜집", place_url: "javascript:alert(1)", category_name: "기타" }]));
  try {
    const d = await (await get(env, j, "/t/bb/admin/place-search?q=나쁜집")).json();
    assert.equal(d.places[0].url, "", "javascript: 주소는 버린다");
  } finally { spy2.restore(); }
});
