// 정확한 매장을 고를 수 있는가.
//
// "카카오맵에는 없는 매장이 많다" 는 말이 실제로 맞습니다 — 소상공인은 네이버 스마트플레이스에만
// 등록한 경우가 흔합니다. 그래서 두 곳을 함께 묻고, 같은 가게면 한 줄로 합칩니다.
// 여기서 재는 것은 "검색된다" 가 아니라 **관리자가 우리 가게를 알아볼 수 있는가** 입니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, p) { const r = await worker.fetch(new Request("http://localhost" + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request("http://localhost" + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
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
// 두 지도의 응답을 가로챈다 — 남의 서버에 기대는 검사는 남의 사정으로 빨개진다
function intercept({ kakao = [], naver = [], fail = "" } = {}) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    seen.push(url);
    if (url.includes("dapi.kakao.com")) {
      if (fail === "kakao") return new Response("no", { status: 500 });
      return new Response(JSON.stringify({ documents: kakao }), { headers: { "content-type": "application/json" } });
    }
    if (url.includes("openapi.naver.com")) {
      if (fail === "naver") return new Response("no", { status: 401 });
      return new Response(JSON.stringify({ items: naver }), { headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { headers: { "content-type": "application/json" } });
  };
  return { seen, stop: () => { globalThis.fetch = real; } };
}
const KEYS = { KAKAO_REST_KEY: "k", NAVER_SEARCH_ID: "n", NAVER_SEARCH_SECRET: "s" };
const NAVER_ITEM = { title: "<b>너나들이</b> 칼국수,만두", category: "음식점>한식>칼국수",
  telephone: "0507-1455-0153", roadAddress: "서울특별시 서초구 방배중앙로 145-1",
  address: "서울특별시 서초구 방배동 000", mapx: "1269845670", mapy: "374840120", link: "https://m.place.naver.com/1" };

test("카카오에 없는 가게가 네이버에서 나온다", async () => {
  const env = makeEnv(KEYS);
  const { j } = await seed(env);
  const it = intercept({ kakao: [], naver: [NAVER_ITEM] });
  try {
    const d = await (await get(env, j, "/t/bb/admin/place-search?q=너나들이")).json();
    assert.equal(d.places.length, 1, "카카오가 못 찾아도 네이버 결과가 나와야 한다");
    const p = d.places[0];
    assert.equal(p.name, "너나들이 칼국수,만두", "<b> 태그를 벗긴 이름이어야 한다");
    assert.equal(p.address, "서울특별시 서초구 방배중앙로 145-1", "도로명을 쓴다");
    assert.equal(p.phone, "0507-1455-0153");
    assert.deepEqual(p.sources, ["네이버"], "어느 지도에서 왔는지 밝힌다");
  } finally { it.stop(); }
});

test("네이버 좌표를 옳게 읽는다 — 잘못 읽으면 지도 핀이 엉뚱한 곳에 찍힌다", async () => {
  const env = makeEnv(KEYS);
  const { j } = await seed(env);
  const it = intercept({ naver: [NAVER_ITEM] });
  try {
    const p = (await (await get(env, j, "/t/bb/admin/place-search?q=너나들이")).json()).places[0];
    assert.ok(Math.abs(p.lng - 126.984567) < 0.0001, `경도가 틀립니다: ${p.lng}`);
    assert.ok(Math.abs(p.lat - 37.484012) < 0.0001, `위도가 틀립니다: ${p.lat}`);
  } finally { it.stop(); }
});

test("같은 가게가 두 곳에서 오면 한 줄로 합치고, 빈 칸을 서로 메운다", async () => {
  const env = makeEnv(KEYS);
  const { j } = await seed(env);
  const it = intercept({
    // 카카오: 좌표는 있는데 도로명이 비어 있다
    kakao: [{ place_name: "너나들이", address_name: "서울 서초구 방배동", road_address_name: "",
      phone: "0507-1455-0153", category_name: "음식점 > 한식", x: "126.984567", y: "37.484012",
      place_url: "https://place.map.kakao.com/1" }],
    naver: [NAVER_ITEM],
  });
  try {
    const d = await (await get(env, j, "/t/bb/admin/place-search?q=너나들이")).json();
    assert.equal(d.places.length, 1, "같은 가게가 두 줄로 보이면 어느 쪽인지 모른다");
    const p = d.places[0];
    assert.deepEqual(p.sources.sort(), ["네이버", "카카오"], "두 곳 다 있다고 알려 준다");
    assert.equal(p.address, "서울 서초구 방배동", "먼저 온 값을 지키고");
    assert.ok(p.lat && p.lng, "좌표는 카카오 쪽에서 채워진다");
  } finally { it.stop(); }
});

test("한쪽 지도가 죽어도 다른 쪽 결과는 나온다", async () => {
  const env = makeEnv(KEYS);
  const { j } = await seed(env);
  const it = intercept({ naver: [NAVER_ITEM], fail: "kakao" });
  try {
    const d = await (await get(env, j, "/t/bb/admin/place-search?q=너나들이")).json();
    assert.equal(d.places.length, 1, "카카오가 500 이어도 네이버 결과로 일이 된다");
  } finally { it.stop(); }
});

test("이미 등록된 가게들의 한가운데를 검색 중심으로 쓴다 — 같은 상호는 전국에 있다", async () => {
  const env = makeEnv(KEYS);
  const { a, j } = await seed(env);
  const p = await hashPassword("owner1234");
  const o = await D.createUser(env.DB, { email: "o@bb.kr", passwordHash: p.hash, salt: p.salt, name: "사장", role: "OWNER", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: o.id, name: "달빛한스푼", category: "카페·디저트" });
  await D.updateBusiness(env.DB, b.id, { name: "달빛한스푼", category: "카페·디저트", description: "", phone: "",
    address: "서울 서초구 방배중앙로 100", hours: "", lat: 37.4840, lng: 126.9845 });
  await D.setBusinessStatus(env.DB, b.id, "approved");
  const it = intercept({ kakao: [] });
  try {
    await get(env, j, "/t/bb/admin/place-search?q=너나들이");
    const call = it.seen.find((u) => u.includes("dapi.kakao.com"));
    assert.match(call, /radius=20000/, "반경을 걸어야 한다");
    assert.match(call, /sort=distance/, "가까운 순으로 봐야 골목 것이 위로 온다");
    assert.match(call, /y=37\.484/, "우리 골목 좌표가 중심이어야 한다");
  } finally { it.stop(); }
});

test("열쇠가 하나도 없으면 창구가 닫힌다", async () => {
  const env = makeEnv();
  const { j } = await seed(env);
  assert.equal((await get(env, j, "/t/bb/admin/place-search?q=너나들이")).status, 503);
});

test("네이버 열쇠만 있어도 검색이 된다 — 카카오 없이도 돌아간다", async () => {
  const env = makeEnv({ NAVER_SEARCH_ID: "n", NAVER_SEARCH_SECRET: "s" });
  const { j } = await seed(env);
  const it = intercept({ naver: [NAVER_ITEM] });
  try {
    const r = await get(env, j, "/t/bb/admin/place-search?q=너나들이");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).places.length, 1);
    assert.ok(!it.seen.some((u) => u.includes("dapi.kakao.com")), "없는 열쇠로 카카오를 두드리지 않는다");
  } finally { it.stop(); }
});

// 지도가 아픈 것과 가게가 없는 것은 다릅니다.
// 빈 목록을 200 으로 돌려주면 관리자는 "그런 가게가 없다" 고 읽고 상호만 계속 고쳐 칩니다.
test("물어본 지도가 모두 아프면 빈 목록이 아니라 오류로 말한다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k", NAVER_SEARCH_ID: "n", NAVER_SEARCH_SECRET: "s" });
  const { j } = await seed(env);
  const it = intercept({ fail: "kakao" });
  // 카카오는 500, 네이버는 401 로 둘 다 실패시킨다
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response("no", { status: 500 });
  try {
    const r = await get(env, j, "/t/bb/admin/place-search?q=너나들이");
    assert.equal(r.status, 502, "둘 다 아프면 502 로 말해야 한다");
    assert.match((await r.json()).message, /연결하지 못했습니다/);
  } finally { globalThis.fetch = real; it.stop(); }
});

test("카카오만 있고 그것이 아프면 — 빈 목록이 아니라 오류다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });   // 네이버 열쇠 없음
  const { j } = await seed(env);
  const it = intercept({ fail: "kakao" });
  try {
    const r = await get(env, j, "/t/bb/admin/place-search?q=너나들이");
    assert.equal(r.status, 502, "묻지도 않은 네이버를 '성공' 으로 쳐서 200 을 내면 안 된다");
  } finally { it.stop(); }
});
