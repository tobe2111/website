// 지도에서 골라 등록했으면 그 연결이 남아야 한다.
//
// 회원 추가 화면은 '지도에서 찾아 자동 입력' 으로 가게를 고르는데, 화면에 map_url 을
// 실어 보낼 칸이 없어서 **그 값이 버려지고 있었다.** 상호·주소·전화·좌표만 저장되고
// "어느 장소를 골랐는지" 는 사라졌다.
//
// 그래서 지도로 찾아 등록한 가게조차 [지도에서 사진 가져오기] 단추가 영영 안 떴다.
// 회장님이 "지도와 연결이 된 상태여야 하잖아" 라고 한 그 말이 맞았다.
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
const csrfOf = async (env, j, p) => (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, p)).text()) || [])[1];

const KAKAO_PLACE = "https://place.map.kakao.com/26338954";

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회", kind: "merchant" });
  const ap = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: ap.hash, salt: ap.salt, name: "회장", role: "ADMIN", associationId: a.id });
  return a;
}
const login = async (env, email, pw) => {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/login")).text()) || [])[1];
  await post(env, j, "/t/bb/login", { _csrf: t, login: email, password: pw });
  return j;
};

test("회원 추가 화면에 지도 주소를 실어 보낼 칸이 있다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" }); await seed(env);
  const j = await login(env, "a@bb.kr", "admin1234");
  const html = await (await get(env, j, "/t/bb/admin")).text();
  // 이 칸이 없으면 place.js 가 채운 값이 갈 데가 없어 조용히 사라진다
  assert.ok(/name="map_url"[^>]*data-place="map_url"|data-place="map_url"[^>]*name="map_url"/.test(html),
    "회원 추가 폼에 map_url 칸이 없다 — 지도에서 골라도 연결이 안 남는다");
});

test("지도에서 골라 등록하면 그 장소 주소가 저장된다", async () => {
  const env = makeEnv({}); const a = await seed(env);
  const j = await login(env, "a@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/admin");
  await post(env, j, "/t/bb/admin/members/add", {
    _csrf: t, name: "김사장", phone: "010-1234-5678", business_name: "너나들이",
    category: "음식점", address: "서울 서초구 방배동", map_url: KAKAO_PLACE,
  });
  const [biz] = await D.listAllBusinesses(env.DB, a.id);
  assert.ok(biz, "가게가 안 만들어졌다");
  assert.equal(biz.map_url, KAKAO_PLACE, "지도 주소가 버려졌다");
});

test("지도 주소가 있으면 [지도에서 사진 가져오기] 가 뜬다", async () => {
  const env = makeEnv({}); const a = await seed(env);
  const j = await login(env, "a@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/admin");
  await post(env, j, "/t/bb/admin/members/add", {
    _csrf: t, name: "김사장", phone: "010-1234-5678", business_name: "너나들이", map_url: KAKAO_PLACE,
  });
  const [biz] = await D.listAllBusinesses(env.DB, a.id);
  const html = await (await get(env, j, `/t/bb/admin/business/${biz.id}`)).text();
  assert.ok(html.includes("지도에서 사진 가져오기"), "연결됐는데 사진 가져오기가 없다");
  assert.ok(!html.includes("먼저 지도에서 이 가게 찾기"), "연결됐는데 연결하라고 한다");
});

test("연결이 없으면 링크만 던지지 않고 '먼저 연결하라' 고 길을 준다", async () => {
  const env = makeEnv({}); const a = await seed(env);
  const j = await login(env, "a@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/admin");
  await post(env, j, "/t/bb/admin/members/add",
    { _csrf: t, name: "김사장", phone: "010-1234-5678", business_name: "연결안된가게" });
  const [biz] = await D.listAllBusinesses(env.DB, a.id);
  const html = await (await get(env, j, `/t/bb/admin/business/${biz.id}`)).text();
  assert.ok(html.includes("먼저 지도에서 이 가게 찾기"), "할 수 있는 일을 알려 주지 않는다");
  assert.ok(html.includes("아직 지도와 연결돼 있지 않습니다"), "왜 안 되는지를 말하지 않는다");
  assert.ok(!html.includes("지도에서 사진 가져오기"), "못 하는 일의 단추가 떠 있다");
});

test("남이 넣은 아무 주소나 지도 연결로 받아 주지는 않는다", async () => {
  const env = makeEnv({}); const a = await seed(env);
  const j = await login(env, "a@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/admin");
  await post(env, j, "/t/bb/admin/members/add", {
    _csrf: t, name: "김사장", phone: "010-1234-5678", business_name: "너나들이",
    map_url: "https://evil.example/steal",
  });
  const [biz] = await D.listAllBusinesses(env.DB, a.id);
  assert.equal(biz.map_url, "", `지도가 아닌 주소가 저장됐다: ${biz.map_url}`);
});

// ── 손님 화면에서 바로 고치러 가기 ───────────────────────────────────────
test("손님에게는 '고치기' 줄이 아예 그려지지 않는다", async () => {
  const env = makeEnv({}); const a = await seed(env);
  const biz = await D.createBusiness(env.DB, { associationId: a.id, ownerId: null, name: "너나들이", category: "음식점" })
    .catch(async () => {
      const h = await hashPassword("o1234567");
      const u = await D.createUser(env.DB, { email: "o@bb.kr", passwordHash: h.hash, salt: h.salt, name: "사장", role: "MERCHANT", associationId: a.id });
      return D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "너나들이", category: "음식점" });
    });
  await D.setBusinessStatus(env.DB, biz.id, "approved");
  const html = await (await get(env, jar(), `/t/bb/business/${biz.slug}`)).text();
  assert.ok(!html.includes("가게 정보 고치기"), "손님 화면에 관리자용 줄이 있다");
  assert.ok(!html.includes(`/admin/business/${biz.id}`), "손님 화면에 관리 주소가 새어 나온다");
});

test("관리자로 로그인하면 그 자리에서 고치러 갈 수 있다", async () => {
  const env = makeEnv({}); const a = await seed(env);
  const h = await hashPassword("o1234567");
  const u = await D.createUser(env.DB, { email: "o@bb.kr", passwordHash: h.hash, salt: h.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const biz = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "너나들이", category: "음식점" });
  await D.setBusinessStatus(env.DB, biz.id, "approved");
  const j = await login(env, "a@bb.kr", "admin1234");
  const html = await (await get(env, j, `/t/bb/business/${biz.slug}`)).text();
  assert.ok(html.includes("이 가게 정보 고치기"), "관리자인데 고치러 갈 길이 없다");
  assert.ok(html.includes(`${"/t/bb"}/admin/business/${biz.id}`), "고치기 주소가 없다");
  // 무엇이 비어 있는지도 그 자리에서 말해 준다 — 안 그러면 뭘 고쳐야 하는지 모른다
  assert.ok(/사진|소개|주소/.test(html), "무엇이 비었는지 알려 주지 않는다");
});

test("그 가게 사장님도 자기 가게는 고치러 갈 수 있다", async () => {
  const env = makeEnv({}); const a = await seed(env);
  const h = await hashPassword("o1234567");
  const u = await D.createUser(env.DB, { email: "o@bb.kr", passwordHash: h.hash, salt: h.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const biz = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "너나들이", category: "음식점" });
  await D.setBusinessStatus(env.DB, biz.id, "approved");
  const j = await login(env, "o@bb.kr", "o1234567");
  const html = await (await get(env, j, `/t/bb/business/${biz.slug}`)).text();
  assert.ok(html.includes("내 가게 정보 고치기"), "자기 가게인데 고치러 갈 길이 없다");
});

test("남의 가게에는 사장님에게도 고치기가 안 뜬다", async () => {
  const env = makeEnv({}); const a = await seed(env);
  const mk = async (email) => {
    const h = await hashPassword("o1234567");
    return D.createUser(env.DB, { email, passwordHash: h.hash, salt: h.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  };
  const u1 = await mk("o1@bb.kr"), u2 = await mk("o2@bb.kr");
  await D.createBusiness(env.DB, { associationId: a.id, ownerId: u1.id, name: "내가게", category: "음식점" });
  const theirs = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u2.id, name: "남의가게", category: "음식점" });
  await D.setBusinessStatus(env.DB, theirs.id, "approved");
  const j = await login(env, "o1@bb.kr", "o1234567");
  const html = await (await get(env, j, `/t/bb/business/${theirs.slug}`)).text();
  assert.ok(!html.includes("가게 정보 고치기"), "남의 가게를 고치러 갈 수 있다고 보여 준다");
});

// ── 같은 실수를 세 번째로 하지 않기 위한 시험 ────────────────────────────
//
// map_url 칸이 빠져 있으면 place.js 가 채운 값이 갈 데가 없어 **조용히 사라진다.**
// 오류도, 경고도 없다. 저장은 성공하고, 다만 연결만 안 남는다.
//
// 회원 추가에서 한 번 났고, 고친 뒤 점포 상세에서 또 났다 —
// "저장했는데 계속 지도와 연결 안 됐다고 뜬다". 그래서 사람이 기억하는 대신
// **지도 검색칸이 있는 모든 화면**을 여기서 훑는다.
const SCREENS = [
  ["관리 홈 (회원 추가)", "/t/bb/admin"],
  ["점포 상세 (가게 정보)", null],   // 아래에서 가게를 만들어 주소를 채운다
];

test("지도 검색칸이 있는 화면에는 반드시 map_url 칸이 함께 있다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" }); const a = await seed(env);
  const h = await hashPassword("o1234567");
  const u = await D.createUser(env.DB, { email: "o@bb.kr", passwordHash: h.hash, salt: h.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const biz = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "너나들이", category: "음식점" });
  SCREENS[1][1] = `/t/bb/admin/business/${biz.id}`;
  const j = await login(env, "a@bb.kr", "admin1234");

  for (const [label, path] of SCREENS) {
    const html = await (await get(env, j, path)).text();
    assert.ok(html.includes("data-place-find"), `${label}: 지도 검색칸이 없다 (시험 전제가 깨졌다)`);
    assert.ok(/data-place="map_url"/.test(html),
      `${label}: 지도 검색칸은 있는데 map_url 을 받을 칸이 없다 — 골라도 연결이 조용히 사라진다`);
    // place.js 는 검색칸이 든 <section> 안에서만 채울 칸을 찾는다.
    // 다른 구역에 있으면 있으나 마나다.
    const sections = html.split("<section");
    const withBox = sections.filter((x) => x.includes("data-place-find"));
    assert.ok(withBox.length >= 1, `${label}: 구역을 못 찾았다`);
    assert.ok(withBox.some((x) => /data-place="map_url"/.test(x)),
      `${label}: map_url 칸이 지도 검색칸과 다른 구역에 있다 — place.js 가 못 찾는다`);
  }
});

test("점포 상세에서 지도로 찾아 저장하면 연결이 남는다", async () => {
  const env = makeEnv({}); const a = await seed(env);
  const h = await hashPassword("o1234567");
  const u = await D.createUser(env.DB, { email: "o@bb.kr", passwordHash: h.hash, salt: h.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const biz = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "너나들이", category: "음식점" });
  const j = await login(env, "a@bb.kr", "admin1234");
  const t = await csrfOf(env, j, `/t/bb/admin/business/${biz.id}`);
  await post(env, j, `/t/bb/admin/business/${biz.id}`, {
    _csrf: t, name: "너나들이", category: "음식점", description: "", phone: "02-000-0000",
    address: "서울 서초구 방배동", hours: "", lat: "", lng: "", map_url: KAKAO_PLACE,
  });
  const after = await D.getBusinessById(env.DB, biz.id);
  assert.equal(after.map_url, KAKAO_PLACE, "점포 상세에서 저장했는데 지도 연결이 안 남았다");
  const html = await (await get(env, j, `/t/bb/admin/business/${biz.id}`)).text();
  assert.ok(html.includes("지도에서 사진 가져오기"), "연결됐는데도 계속 '연결 안 됨' 으로 보인다");
});
