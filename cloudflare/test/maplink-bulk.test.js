// 명부의 가게들을 지도에 한꺼번에 붙인다.
//
// 상호만 있어도 지도에는 그 가게가 거의 다 있다. 한 번 붙여 두면 그 하나에
// 좌표(지도 핀)·가게 대표번호·도로명주소·대표사진 가져오기·검색 노출이 전부 딸려 온다.
//
// 그런데 이 기능의 진짜 위험은 "안 붙는 것" 이 아니라 **틀리게 붙는 것** 이다.
// 엉뚱한 가게에 연결되면 손님이 그 핀을 보고 다른 가게로 걸어가고, 대표사진도 남의 가게
// 것이 걸린다. 그런데 화면에는 멀쩡한 가게 하나가 보여서 **아무도 눈치채지 못한다.**
// 그래서 이 파일의 대부분은 "붙는가" 가 아니라 **"안 붙어야 할 때 안 붙는가"** 를 잰다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { pickPlace, placeQuery, roadKey } from "../src/placeMatch.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
const get = async (env, j, p) => { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; };
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
const MAP = "/t/bb/admin/members/map";

// 카카오 로컬을 가로챈다 — 실제 지도에 붙지 않고 우리가 정한 답을 준다.
function stubKakao(docs) {
  const real = globalThis.fetch;
  globalThis.fetch = async (req, init) => {
    const u = String(req && req.url ? req.url : req);
    // 상인회 주소로 '우리 골목이 어디인가' 를 묻는 창구. 가게 검색과 다른 곳이다.
    if (u.includes("dapi.kakao.com") && u.includes("search/address.json"))
      return new Response(JSON.stringify({ documents: [{ x: "126.99", y: "37.48" }] }),
        { headers: { "content-type": "application/json" } });
    if (u.includes("dapi.kakao.com")) {
      const q = decodeURIComponent(new URL(u).searchParams.get("query") || "");
      return new Response(JSON.stringify({ documents: docs(q) }), { headers: { "content-type": "application/json" } });
    }
    if (u.includes("openapi.naver.com")) return new Response(JSON.stringify({ items: [] }), { headers: { "content-type": "application/json" } });
    return real(req, init);
  };
  return () => { globalThis.fetch = real; };
}
const doc = (name, road, phone, id) => ({
  place_name: name, road_address_name: road, address_name: road, phone: phone || "",
  category_name: "음식점 > 한식", x: "126.99", y: "37.48", place_url: `http://place.map.kakao.com/${id || 1}`,
});

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회", kind: "merchant" });
  // 우리 골목이 어디인지는 **상인회 주소**로 정한다. 이게 없으면 중심 없이 전국 검색이 되고,
  // 같은 상호의 다른 지점(부천·성수)에 붙는다. 실제로 그렇게 붙은 적이 있다.
  await D.updateAssociation(env.DB, a.id, { name: a.name, tagline: "", brand_color: "#1F6CFF",
    phone: "", email: "", address: "서울 서초구 방배중앙로 166", logo: "", hero_image: "" }).catch(() => {});
  a.address = "서울 서초구 방배중앙로 166";
  const p = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: p.hash, salt: p.salt, name: "회장", role: "ADMIN", associationId: a.id });
  return a;
}
const login = async (env) => {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/login")).text()) || [])[1];
  await worker.fetch(new Request(B + "/t/bb/login", { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, login: "a@bb.kr", password: "admin1234" }).toString() }), env)
    .then((r) => absorb(j, r));
  return j;
};
async function biz(env, a, f) {
  const p = await hashPassword("owner1234");
  const u = await D.createUser(env.DB, { email: `o${Math.random()}@x.kr`, passwordHash: p.hash, salt: p.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: f.name, category: f.category || "음식점" });
  await D.updateBusiness(env.DB, b.id, { name: f.name, category: f.category || "음식점", description: "",
    phone: f.phone || "", address: f.address || "", hours: f.hours || "", lat: null, lng: null, mapUrl: "" });
  return D.getBusinessById(env.DB, b.id);
}

// ── 고르는 규칙 ──────────────────────────────────────────────────────────
test("주소에서 도로명과 번지만 뽑는다", () => {
  assert.deepEqual(roadKey("서울 서초구 방배중앙로25길 16, 2층"), { road: "방배중앙로25길", no: "16" });
  assert.deepEqual(roadKey("서울 서초구 방배동 769-10"), { road: "방배동", no: "769-10" });
  assert.equal(roadKey(""), null);
});

test("전화번호가 같으면 그것으로 끝난다", () => {
  const r = pickPlace({ name: "너나들이", address: "", phone: "0212345678" },
    [{ name: "전혀다른이름", address: "서울 강남구 어딘가 1", phone: "02-1234-5678", url: "u" }]);
  assert.equal(r.confidence, "high");
  assert.match(r.why, /전화번호/);
});

test("도로명·번지가 맞고 상호가 스치면 붙인다", () => {
  const shop = { name: "버들카페", address: "서울 서초구 방배중앙로 174" };
  const r = pickPlace(shop, [
    { name: "버들카페 방배점", address: "서울 서초구 방배중앙로 174", phone: "", url: "u" },
    { name: "버들카페", address: "서울 강남구 테헤란로 5", phone: "", url: "v" },
  ]);
  assert.equal(r.confidence, "high");
  assert.equal(r.place.url, "u", "번지가 맞는 쪽이 아니라 이름만 같은 쪽을 골랐다");
});

test("같은 상호가 전국에 여럿이면 붙이지 않는다", () => {
  // "GS더프레시" 는 전국에 수백 곳이다. 주소가 안 맞으면 아무거나 붙여선 안 된다.
  const r = pickPlace({ name: "GS더프레시", address: "서울 서초구 동광로 35" }, [
    { name: "GS더프레시", address: "서울 노원구 상계로 1", phone: "", url: "a" },
    { name: "GS더프레시", address: "부산 해운대구 해운대로 2", phone: "", url: "b" },
  ]);
  assert.equal(r.confidence, "low", "같은 이름 여럿을 확신해서 붙였다");
});

// 여기가 이 파일에서 가장 위험한 자리다. "노브랜드버거" 처럼 전국 어디에나 있는 상호는
// 후보가 하나로 좁혀져도 그게 **우리 가게라는 근거가 되지 못한다.**
// 실제로 이 규칙 때문에 방배동 가게들이 부천·광명·성수에 붙었다.
test("상호가 정확히 같고 우리 골목 안이면 주소가 없어도 붙인다", () => {
  const r = pickPlace({ name: "너나들이", address: "" },
    [{ name: "너나들이", address: "서울 서초구 방배중앙로 9", phone: "", url: "u", lat: 37.4838, lng: 126.9905 }],
    { center: { lat: 37.4840, lng: 126.9900 } });
  assert.equal(r.confidence, "high");
});

test("상호가 같아도 골목에서 멀면 붙이지 않는다", () => {
  // 방배동 상인회인데 부천 소사구 지점이 나온 경우. 이름은 똑같다.
  const r = pickPlace({ name: "노브랜드버거", address: "" },
    [{ name: "노브랜드버거", address: "경기 부천시 소사구 경인로 1", phone: "", url: "u", lat: 37.4820, lng: 126.7920 }],
    { center: { lat: 37.4840, lng: 126.9900 } });
  assert.equal(r.confidence, "low", "20km 밖의 다른 지점을 확신해서 붙였다");
  assert.match(r.why, /km/, "왜 안 붙였는지 거리로 말해 줘야 회장님이 판단한다");
});

test("우리 골목이 어디인지 모르면 이름만 보고 붙이지 않는다", () => {
  const r = pickPlace({ name: "너나들이", address: "" },
    [{ name: "너나들이", address: "서울 서초구 방배중앙로 9", phone: "", url: "u", lat: 37.4838, lng: 126.9905 }]);
  assert.equal(r.confidence, "low", "중심을 모르면 이름이 같다는 것만으로는 근거가 안 된다");
});

test("명부는 지번인데 지도는 도로명이어도 같은 자리면 붙인다", () => {
  // 상인회 명부의 주소는 대개 "방배동 769-10" 같은 지번이고, 지도는 도로명을 준다.
  // 이 짝이 안 맞으면 주소 규칙이 통째로 안 걸려, 이름만 보고 고르는 위험한 길로 떨어진다.
  const r = pickPlace({ name: "2001호텔", address: "서울 서초구 방배동 769-10" },
    [{ name: "2001호텔 방배점", address: "서울 서초구 방배중앙로 174",
       addressJibun: "서울 서초구 방배동 769-10", phone: "", url: "u", lat: 37.4841, lng: 126.9901 }],
    { center: { lat: 37.4840, lng: 126.9900 } });
  assert.equal(r.confidence, "high", "명부의 지번과 지도의 지번이 같으면 같은 자리다");
  assert.match(r.why, /주소/);
});

test("짧은 이름이 남의 긴 이름에 우연히 들어간 것을 같다고 하지 않는다", () => {
  // "본" 이 "본죽" 에 들어간다고 같은 가게가 아니다
  const r = pickPlace({ name: "본", address: "서울 서초구 방배중앙로 1" },
    [{ name: "본죽 방배점", address: "서울 서초구 다른길 9", phone: "", url: "u" }]);
  assert.equal(r.confidence, "low");
});

test("후보가 하나도 없으면 없다고 말한다", () => {
  const r = pickPlace({ name: "없는가게", address: "" }, []);
  assert.equal(r.confidence, null);
  assert.equal(r.place, null);
});

test("지도에 물어볼 말에 동네를 붙인다", () => {
  // 상호만 던지면 전국에서 같은 이름이 쏟아진다
  assert.equal(placeQuery({ name: "버들카페", address: "서울 서초구 방배중앙로 174" }), "버들카페 서초구 방배중앙로");
  assert.equal(placeQuery({ name: "버들카페", address: "" }), "버들카페");
});

// ── 실제로 돌려 보기 ─────────────────────────────────────────────────────
test("확실한 가게는 붙고, 애매한 가게는 그대로 남는다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const a = await seed(env);
  const sure = await biz(env, a, { name: "버들카페", address: "서울 서초구 방배중앙로 174" });
  const vague = await biz(env, a, { name: "GS더프레시", address: "서울 서초구 동광로 35" });
  const un = stubKakao((q) => q.startsWith("버들카페")
    ? [doc("버들카페", "서울 서초구 방배중앙로 174", "", 11)]
    : [doc("GS더프레시", "서울 노원구 상계로 1", "", 21), doc("GS더프레시", "부산 해운대구 해운대로 2", "", 22)]);
  try {
    const j = await login(env);
    const html = await (await post(env, j, MAP, { after: "0" }, MAP)).text();
    assert.ok(html.includes("연결했습니다"), html.slice(0, 400));
    const after1 = await D.getBusinessById(env.DB, sure.id);
    assert.equal(after1.map_url, "http://place.map.kakao.com/11");
    assert.ok(after1.lat && after1.lng, "지도 핀이 찍힐 좌표가 안 들어갔다");
    const after2 = await D.getBusinessById(env.DB, vague.id);
    assert.equal(after2.map_url || "", "", "확신도 없이 붙였다");
    assert.ok(html.includes("직접 고르세요"));
  } finally { un(); }
});

test("회장님이 채워 둔 값을 지도가 덮어쓰지 않는다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const a = await seed(env);
  const b = await biz(env, a, { name: "버들카페", address: "서울 서초구 방배중앙로 174",
    phone: "02-000-0000", hours: "09:00-21:00" });
  const un = stubKakao(() => [doc("버들카페", "서울 서초구 방배중앙로 174", "02-999-9999", 11)]);
  try {
    const j = await login(env);
    await post(env, j, MAP, { after: "0" }, MAP);
    const after = await D.getBusinessById(env.DB, b.id);
    assert.equal(after.phone, "02-000-0000", "회장님이 적은 전화번호가 지워졌다");
    assert.equal(after.hours, "09:00-21:00", "영업시간이 날아갔다 — 사장님이 보내 주신 값이다");
    assert.equal(after.map_url, "http://place.map.kakao.com/11", "연결은 돼야 한다");
  } finally { un(); }
});

test("비어 있던 가게 대표번호는 지도가 채운다", async () => {
  // 이 번호는 지도에 공개돼 있는 가게 번호라 손님 화면에 띄워도 된다.
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const a = await seed(env);
  const b = await biz(env, a, { name: "버들카페", address: "서울 서초구 방배중앙로 174" });
  const un = stubKakao(() => [doc("버들카페", "서울 서초구 방배중앙로 174", "02-999-9999", 11)]);
  try {
    const j = await login(env);
    await post(env, j, MAP, { after: "0" }, MAP);
    assert.equal((await D.getBusinessById(env.DB, b.id)).phone, "02-999-9999");
  } finally { un(); }
});

test("이미 붙은 가게는 다시 묻지 않는다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const a = await seed(env);
  const b = await biz(env, a, { name: "버들카페", address: "서울 서초구 방배중앙로 174" });
  await D.updateBusiness(env.DB, b.id, { name: b.name, category: b.category, description: "",
    phone: "", address: b.address, hours: "", lat: null, lng: null, mapUrl: "http://place.map.kakao.com/99" });
  let asked = 0;
  const un = stubKakao(() => { asked++; return []; });
  try {
    const j = await login(env);
    await post(env, j, MAP, { after: "0" }, MAP);
    assert.equal(asked, 0, "이미 연결된 가게를 또 물었다 — 114곳이면 그만큼 낭비다");
    assert.equal((await D.getBusinessById(env.DB, b.id)).map_url, "http://place.map.kakao.com/99");
  } finally { un(); }
});

test("여덟 곳씩 끊어 돌고, 이어서 돌면 그 뒤부터 간다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const a = await seed(env);
  for (let i = 0; i < 10; i++) await biz(env, a, { name: `가게${i}`, address: `서울 서초구 방배중앙로 ${i + 1}` });
  const un = stubKakao((q) => {
    const m = /가게(\d+)/.exec(q);
    return m ? [doc(`가게${m[1]}`, `서울 서초구 방배중앙로 ${Number(m[1]) + 1}`, "", 100 + Number(m[1]))] : [];
  });
  try {
    const j = await login(env);
    const h1 = await (await post(env, j, MAP, { after: "0" }, MAP)).text();
    assert.equal(await D.countUnlinkedBusinesses(env.DB, a.id), 2, "한 번에 여덟 곳만 돌아야 한다");
    // 화면이 다음 묶음을 이어서 돌 커서를 쥐고 있어야 한다
    const cur = (/name="after" value="(\d+)"/.exec(h1) || [])[1];
    assert.ok(Number(cur) > 0, "다음에 어디서부터 이어갈지를 화면이 안 들고 있다");
    await post(env, j, MAP, { after: cur }, MAP);
    assert.equal(await D.countUnlinkedBusinesses(env.DB, a.id), 0);
  } finally { un(); }
});

test("지도가 죽어 있으면 그 자리에서 멈추고 그렇게 말한다", async () => {
  // 조용히 "못 찾음" 으로 넘기면 114곳을 다 헛돌고 나서야 알게 된다.
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const a = await seed(env);
  for (let i = 0; i < 3; i++) await biz(env, a, { name: `가게${i}`, address: "서울 서초구 방배중앙로 1" });
  const real = globalThis.fetch;
  globalThis.fetch = async (req, init) => {
    const u = String(req && req.url ? req.url : req);
    if (u.includes("dapi.kakao.com")) return new Response("nope", { status: 500 });
    return real(req, init);
  };
  try {
    const j = await login(env);
    const html = await (await post(env, j, MAP, { after: "0" }, MAP)).text();
    assert.ok(/지도 검색에 연결하지 못했습니다/.test(html), "지도가 아픈 것을 아프다고 말하지 않는다");
    assert.equal(await D.countUnlinkedBusinesses(env.DB, a.id), 3);
  } finally { globalThis.fetch = real; }
});

test("남의 상인회 가게는 건드리지 않는다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const a = await seed(env);
  const zz = await D.createAssociation(env.DB, { slug: "zz", name: "남의 상인회", kind: "merchant" });
  const theirs = await biz(env, zz, { name: "버들카페", address: "서울 서초구 방배중앙로 174" });
  const un = stubKakao(() => [doc("버들카페", "서울 서초구 방배중앙로 174", "", 11)]);
  try {
    const j = await login(env);
    await post(env, j, MAP, { after: "0" }, MAP);
    assert.equal((await D.getBusinessById(env.DB, theirs.id)).map_url || "", "", "남의 상인회 가게에 손댔다");
  } finally { un(); }
});

test("열쇠가 없으면 헛돌지 않고 운영사에 문의하라고 한다", async () => {
  const env = makeEnv({});
  const a = await seed(env);
  await biz(env, a, { name: "버들카페", address: "서울 서초구 방배중앙로 174" });
  const j = await login(env);
  const html = await (await get(env, j, MAP)).text();
  assert.ok(html.includes("지도 검색 열쇠가 아직 등록되지 않았습니다"), "왜 안 되는지를 안 말한다");
  assert.ok(!html.includes("자동으로 찾기 시작"), "눌러도 아무 일 안 나는 단추를 띄운다");
});

test("회원·점포 목록과 명부 등록 화면에서 이 화면으로 가는 길이 있다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  await seed(env);
  const j = await login(env);
  const home = await (await get(env, j, "/t/bb/admin")).text();
  assert.ok(home.includes("/admin/members/map"), "기능이 있어도 못 찾으면 없는 것과 같다");
  assert.ok(home.includes("지도에 한꺼번에 연결"));
});

test("로그인하지 않으면 열 수 없다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  await seed(env);
  const r = await get(env, jar(), MAP);
  assert.ok(r.status !== 200, `누구나 이 화면을 열 수 있다 (${r.status})`);
});

// ── 잘못 붙은 것을 푸는 길 ──────────────────────────────────────────────
//
// 실제로 난 사고입니다. 우리 골목이 어디인지 모른 채 이름만 보고 붙여서, 방배동 가게들이
// 부천·광명·성수 지점에 연결됐습니다. 규칙은 고쳤지만 **이미 붙어 버린 것은 스스로 안
// 풀립니다** — 지도 주소가 멀쩡히 들어 있어 '연결됨' 으로 세어지기 때문입니다.
async function withFar(env, a) {
  const p = await hashPassword("owner1234");
  const mk = async (name, lat, lng, phone) => {
    const u = await D.createUser(env.DB, { email: `${name}@bb.kr`, passwordHash: p.hash, salt: p.salt,
      name, role: "MERCHANT", associationId: a.id });
    const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name, category: "음식점" });
    await D.updateBusiness(env.DB, b.id, { name, category: "음식점", description: "",
      phone, address: "서울 서초구 방배동 769-10", hours: "", lat, lng,
      snsInstagram: "", snsYoutube: "", snsBlog: "", snsKakao: "", snsNaver: "",
      mapUrl: "http://place.map.kakao.com/1" });
    await D.setBusinessStatus(env.DB, b.id, "approved");
    return b.id;
  };
  return {
    near: await mk("버들카페", 37.4841, 126.9901, "02-111-1111"),
    far: await mk("노브랜드버거", 37.4820, 126.7920, "032-999-9999"),   // 부천 소사구
  };
}

test("골목에서 멀리 찍힌 가게를 화면이 먼저 짚어 준다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const a = await seed(env);
  const ids = await withFar(env, a);
  const j = await login(env);
  const stop = stubKakao(() => []);
  try {
    const html = await (await get(env, j, MAP)).text();
    assert.ok(html.includes("우리 골목에서 멀리 찍힌 가게"), "지도를 열어 눈으로 보고서야 아는 것은 너무 늦다");
    assert.ok(html.includes("노브랜드버거"));
    assert.ok(!html.includes(">버들카페<"), "골목 안 가게까지 잘못됐다고 하면 안 된다");
    assert.ok(ids.near && ids.far);
  } finally { stop(); }
});

test("연결 풀기는 먼 것만 푼다 — 골목 안 가게는 그대로 둔다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const a = await seed(env);
  const ids = await withFar(env, a);
  const j = await login(env);
  const stop = stubKakao(() => []);
  try {
    await post(env, j, MAP, { unlink: "1" }, MAP);
    const near = await D.getBusinessById(env.DB, ids.near);
    const far = await D.getBusinessById(env.DB, ids.far);
    assert.equal(far.map_url, "", "먼 연결이 안 풀렸다");
    assert.equal(far.lat, null);
    assert.equal(far.phone, "", "남의 가게 대표번호를 우리 화면에 남겨 두면 손님이 거기로 전화한다");
    assert.equal(far.address, "서울 서초구 방배동 769-10", "명부에서 온 주소는 우리 값이라 지우지 않는다");
    assert.equal(near.map_url, "http://place.map.kakao.com/1", "골목 안 가게까지 풀면 다 다시 해야 한다");
    assert.equal(near.phone, "02-111-1111");
  } finally { stop(); }
});

test("연결을 푼 가게는 다시 '아직 연결 안 됨' 으로 세어진다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const a = await seed(env);
  await withFar(env, a);
  const j = await login(env);
  const stop = stubKakao(() => []);
  try {
    assert.equal(await D.countUnlinkedBusinesses(env.DB, a.id), 0);
    await post(env, j, MAP, { unlink: "1" }, MAP);
    assert.equal(await D.countUnlinkedBusinesses(env.DB, a.id), 1, "풀어 놓고 다시 안 찾아 주면 푼 의미가 없다");
  } finally { stop(); }
});

test("업체 홈페이지가 지도 주소 칸에 들어 있으면 연결 안 된 것으로 본다", async () => {
  // 네이버 지역검색의 link 는 그 가게 홈페이지다. 예전에는 이게 지도 주소로 저장돼서
  // '연결됨' 으로 세어지는데 [지도에서 사진 가져오기] 는 영영 안 떴다.
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const a = await seed(env);
  const p = await hashPassword("owner1234");
  const u = await D.createUser(env.DB, { email: "o@bb.kr", passwordHash: p.hash, salt: p.salt,
    name: "사장", role: "MERCHANT", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "버들카페", category: "카페·디저트" });
  await D.updateBusiness(env.DB, b.id, { name: "버들카페", category: "카페·디저트", description: "",
    phone: "", address: "", hours: "", lat: 37.484, lng: 126.99,
    snsInstagram: "", snsYoutube: "", snsBlog: "", snsKakao: "", snsNaver: "",
    mapUrl: "https://www.beodeulcafe.co.kr" });
  assert.equal(await D.countUnlinkedBusinesses(env.DB, a.id), 1,
    "지도 페이지가 아닌 주소를 '연결됨' 으로 세면 그 가게는 영영 다시 안 찾아진다");
});

// ── 우리 골목 기준점을 어디서 얻는가 ────────────────────────────────────
//
// 실제로 난 사고: 상인회가 주소를 안 넣어 두면 schema 의 기본 지도중심(서울 어딘가)이
// 기준점이 됐는데, 그게 방배동에서 3.39km 였다. 자동 연결 한계가 3km 이라 **멀쩡한 우리
// 가게가 전부 거부**됐고, 화면에는 오류 하나 없이 "45곳에서 더 안 늘어난다" 로만 보였다.
import { commonArea, streetCenter } from "../src/api.js";

test("회원 가게 주소에서 우리 동네를 뽑아낸다", () => {
  assert.equal(commonArea([
    "서울 서초구 방배동 769-10", "서울 서초구 방배동 2233", "서울 서초구 방배동 3282",
    "서울 강남구 역삼동 1",
  ]), "서울 서초구 방배동");
});

test("몇 줄 안 되면 동네를 짐작하지 않는다", () => {
  assert.equal(commonArea(["서울 서초구 방배동 1", "서울 서초구 방배동 2"]), "",
    "두 줄로 골목을 정하면 그 두 줄이 틀렸을 때 전부 틀린다");
});

test("손대지 않은 기본 지도중심은 우리 골목으로 쓰지 않는다", async () => {
  // 이게 이 파일에서 가장 비싼 시험이다 — 이 한 줄 때문에 69곳이 안 붙었다.
  const env = makeEnv();                       // 지도 열쇠 없음 → 주소로 좌표를 못 구한다
  const a = await D.createAssociation(env.DB, { slug: "zz", name: "주소없는상인회", kind: "merchant" });
  const c = await streetCenter(env, env.DB, a);
  assert.equal(c, null, "기본값(서울 어딘가)을 골목으로 믿으면 우리 가게가 전부 거부된다");
});

test("관리자가 지도를 직접 옮겨 뒀으면 그건 쓴다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "yy", name: "옮긴상인회", kind: "merchant" });
  a.map_lat = 37.4816; a.map_lng = 126.9938;
  const c = await streetCenter(env, env.DB, a);
  assert.ok(c, "직접 옮긴 값은 자리표시가 아니라 뜻이 있는 값이다");
  assert.equal(c.how, "관리자가 정해 둔 지도 중심");
});

test("기준점을 모르면 화면이 그렇게 말하고 무엇을 하라고 알려 준다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회", kind: "merchant" });
  const p = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: p.hash, salt: p.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const j = await login(env);
  const stop = stubKakao(() => []);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (req, init) => {   // 주소 검색도 못 찾는 상황
    const u = String(req && req.url ? req.url : req);
    if (u.includes("dapi.kakao.com")) return new Response(JSON.stringify({ documents: [] }), { headers: { "content-type": "application/json" } });
    if (u.includes("openapi.naver.com")) return new Response(JSON.stringify({ items: [] }), { headers: { "content-type": "application/json" } });
    return realFetch(req, init);
  };
  try {
    const html = await (await get(env, j, MAP)).text();
    assert.ok(html.includes("우리 골목이 어디인지 몰라"), "조용히 다 거부하면 '왜 안 늘지' 로만 보인다");
    assert.ok(html.includes("상인회 주소"), "무엇을 하면 되는지를 말해 줘야 한다");
  } finally { globalThis.fetch = realFetch; stop(); }
});

test("기준점을 찾았으면 어디를 기준으로 삼았는지 적어 준다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const a = await seed(env);
  const j = await login(env);
  const stop = stubKakao(() => []);
  try {
    const html = await (await get(env, j, MAP)).text();
    assert.ok(html.includes("우리 골목 기준점"));
    assert.ok(html.includes("상인회 주소"));
  } finally { stop(); }
});
