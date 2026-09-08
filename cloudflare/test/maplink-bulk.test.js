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

test("상호가 정확히 같고 후보가 하나면 주소가 없어도 붙인다", () => {
  const r = pickPlace({ name: "너나들이", address: "" },
    [{ name: "너나들이", address: "서울 서초구 방배중앙로 9", phone: "", url: "u" }]);
  assert.equal(r.confidence, "high");
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
