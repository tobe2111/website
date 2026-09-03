// 관리자가 점포 정보를 대신 채운다 — 상인회장이 명단을 먼저 세팅하는 실제 시작 방식.
// 그리고 지도(카카오)에서 한 곳을 찾아 폼에 채우는 경로.
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
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "방배카페골목상인회" });
  const other = await D.createAssociation(env.DB, { slug: "other", name: "다른상인회" });
  const mk = async (e, n, role, aid) => { const h = await hashPassword("pass1234"); return D.createUser(env.DB, { email: e, passwordHash: h.hash, salt: h.salt, name: n, role, associationId: aid }); };
  await mk("ad@s.kr", "회장", "ADMIN", a.id);
  await mk("ad@o.kr", "남의회장", "ADMIN", other.id);
  const u = await mk("m@s.kr", "김순자", "MERCHANT", a.id);
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "모둠분식", category: "음식점", source: "proxy" });
  const ou = await mk("m@o.kr", "남의사장", "MERCHANT", other.id);
  const ob = await D.createBusiness(env.DB, { associationId: other.id, ownerId: ou.id, name: "남의가게", category: "카페" });
  return { a, other, u, b, ob };
}
const login = async (env, email) => { const j = jar(); await post(env, j, "/login", { email, password: "pass1234" }); return j; };

test("대행 등록한 점포에 무엇이 비었는지, 그래서 손님에게 어떻게 보이는지 적는다", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const j = await login(env, "ad@s.kr");
  const html = await (await get(env, j, `/t/seocho/admin/business/${b.id}`)).text();
  assert.match(html, /모둠분식/);
  // 숫자가 아니라 결과로 말한다 — '주소 없음' 이 아니라 '지도에 뜨지 않습니다'
  assert.match(html, /지도에 뜨지 않습니다/);
  assert.match(html, /전화를 걸 수 없습니다/);
  assert.match(html, /'지금 문 연 곳'에 안 뜹니다/);
  assert.match(html, /name="address"/, "주소 칸이 관리자에게 열려 있어야");
  assert.match(html, /name="hours"/);
});

test("관리자가 채운 주소·전화가 저장되고, 점주 화면에도 같은 값이 보인다", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const j = await login(env, "ad@s.kr");
  const r = await post(env, j, `/t/seocho/admin/business/${b.id}`, {
    name: "모둠분식", category: "음식점", phone: "02-585-1234",
    address: "서울 서초구 방배로 33", hours: "10:00-21:00 · 일요일 휴무",
    description: "떡볶이와 순대", lat: "37.4835", lng: "126.9976",
  }, `/t/seocho/admin/business/${b.id}`);
  assert.equal(r.status, 303);
  const saved = await D.getBusinessById(env.DB, b.id);
  assert.equal(saved.address, "서울 서초구 방배로 33");
  assert.equal(saved.phone, "02-585-1234");
  assert.equal(saved.hours, "10:00-21:00 · 일요일 휴무");
  assert.equal(Number(saved.lat).toFixed(4), "37.4835");

  // 같은 레코드다 — 사장님이 로그인하면 이어서 고칠 수 있어야 한다
  const mj = await login(env, "m@s.kr");
  const dash = await (await get(env, mj, "/t/seocho/dashboard")).text();
  assert.match(dash, /방배로 33/, "점주 화면에 관리자가 채운 주소가 보여야");

  // 다 채웠으면 '덜 채운 것' 경고가 사라진다
  const again = await (await get(env, j, `/t/seocho/admin/business/${b.id}`)).text();
  assert.ok(!/지도에 뜨지 않습니다/.test(again), "채운 뒤에는 그 경고가 없어야");
});

test("관리자 화면이 점주의 SNS 링크를 지우지 않는다 (안 그리는 칸을 빈 값으로 덮어쓰면 안 된다)", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  await D.updateBusiness(env.DB, b.id, { name: "모둠분식", category: "음식점", description: "", phone: "", address: "",
    hours: "", lat: null, lng: null, snsInstagram: "https://instagram.com/modum", snsYoutube: "", snsBlog: "", snsKakao: "", snsNaver: "" });
  const j = await login(env, "ad@s.kr");
  await post(env, j, `/t/seocho/admin/business/${b.id}`, { name: "모둠분식", category: "음식점", address: "서울 서초구 방배로 33" },
    `/t/seocho/admin/business/${b.id}`);
  assert.equal((await D.getBusinessById(env.DB, b.id)).sns_instagram, "https://instagram.com/modum");
});

test("남의 상인회 점포는 열리지도, 고쳐지지도 않는다", async () => {
  const env = makeEnv();
  const { ob } = await seed(env);
  const j = await login(env, "ad@s.kr");
  assert.equal((await get(env, j, `/t/seocho/admin/business/${ob.id}`)).status, 404);
  const r = await post(env, j, `/t/seocho/admin/business/${ob.id}`, { name: "훔치기", address: "덮어쓰기" }, "/t/seocho/admin");
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.equal((await D.getBusinessById(env.DB, ob.id)).name, "남의가게");
});

test("점주는 남의 점포 정보 화면에 못 들어간다", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const mj = await login(env, "m@s.kr");
  const r = await get(env, mj, `/t/seocho/admin/business/${b.id}`);
  assert.ok(r.status !== 200, `점주에게 열리면 안 됨 (${r.status})`);
  assert.equal(r.status, 403, "관리자 전용이므로 거절이 분명해야 한다");
});

// ── 지도에서 찾아 채우기 ──
test("카카오 키가 없으면 그 사실을 말해 주고, 화면도 그 기능을 내걸지 않는다", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const j = await login(env, "ad@s.kr");
  const html = await (await get(env, j, `/t/seocho/admin/business/${b.id}`)).text();
  assert.ok(!/id="placeQ"/.test(html), "키가 없으면 찾기 칸을 그리지 않는다");
  assert.match(html, /운영사가 카카오 키를 등록하면/);

  const r = await get(env, j, "/t/seocho/admin/place-search?q=버들카페");
  assert.equal(r.status, 503);
  assert.match((await r.json()).message, /카카오 REST 키/);
});

test("지도 검색은 카카오가 준 값만 넘기고, 업종은 맨 끝 낱말만 쓴다", async () => {
  const env = makeEnv();
  env.KAKAO_REST_KEY = "test-key";
  const { b } = await seed(env);
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), auth: (init && init.headers && init.headers.Authorization) || "" });
    return new Response(JSON.stringify({ documents: [
      { place_name: "버들카페", road_address_name: "서울 서초구 방배로 33", address_name: "서초동 1-2",
        phone: "02-585-1234", category_name: "음식점 > 카페 > 커피전문점", x: "126.9976", y: "37.4835",
        place_url: "http://place.map.kakao.com/1234" },
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const j = await login(env, "ad@s.kr");
    const html = await (await get(env, j, `/t/seocho/admin/business/${b.id}`)).text();
    assert.match(html, /id="placeQ"/, "키가 있으면 찾기 칸이 열린다");

    const r = await get(env, j, "/t/seocho/admin/place-search?q=버들카페");
    assert.equal(r.status, 200);
    const { places } = await r.json();
    assert.equal(places.length, 1);
    assert.equal(places[0].name, "버들카페");
    assert.equal(places[0].address, "서울 서초구 방배로 33", "도로명 주소를 먼저 쓴다");
    assert.equal(places[0].phone, "02-585-1234");
    assert.equal(places[0].category, "커피전문점", "'음식점 > 카페 > 커피전문점' 에서 맨 끝만");
    assert.equal(places[0].lat, 37.4835);
    assert.equal(places[0].lng, 126.9976);
    // 키는 헤더로만 나간다 — 주소창에 실리면 로그·리퍼러에 남는다
    assert.match(calls[0].auth, /^KakaoAK test-key$/);
    assert.ok(!calls[0].url.includes("test-key"), "키가 주소에 실리면 안 된다");
    assert.match(calls[0].url, /dapi\.kakao\.com/);
  } finally { globalThis.fetch = realFetch; }
});

test("두 글자가 안 되면 카카오를 부르지 않는다 (호출 낭비·요금)", async () => {
  const env = makeEnv();
  env.KAKAO_REST_KEY = "test-key";
  await seed(env);
  let called = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { called++; return new Response("{}", { status: 200 }); };
  try {
    const j = await login(env, "ad@s.kr");
    const r = await get(env, j, "/t/seocho/admin/place-search?q=버");
    assert.deepEqual((await r.json()).places, []);
    assert.equal(called, 0);
  } finally { globalThis.fetch = realFetch; }
});

test("지도 검색은 로그인한 관리자만 부를 수 있다", async () => {
  const env = makeEnv();
  env.KAKAO_REST_KEY = "test-key";
  const { b } = await seed(env);
  let called = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { called++; return new Response(JSON.stringify({ documents: [] }), { status: 200 }); };
  try {
    const anon = await get(env, jar(), "/t/seocho/admin/place-search?q=버들카페");
    assert.ok(anon.status === 302 || anon.status === 303, "비로그인은 로그인으로");
    const mj = await login(env, "m@s.kr");
    const asMerchant = await get(env, mj, "/t/seocho/admin/place-search?q=버들카페");
    assert.ok(asMerchant.status !== 200, "점주는 부를 수 없다");
    assert.equal(called, 0, "권한이 없으면 카카오를 부르지도 않는다");
    void b;
  } finally { globalThis.fetch = realFetch; }
});
