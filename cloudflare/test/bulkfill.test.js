// 130곳짜리 상인회를 실제로 채워 넣을 수 있는가.
//
// 방배동은 가게가 130곳이다. 한 곳당 드는 손이 곧 130배가 된다.
// 그래서 이 파일은 "한 곳이 되는가" 가 아니라 "130번 반복할 만한가" 를 본다.
//
// 두 가지가 막고 있었다:
//   ① 사장님 성함·연락처를 반드시 요구했다. 회장님이 130명의 번호를 미리 알 리가 없다.
//      지도에는 가게가 다 있는데 연락처를 모른다는 이유로 등록 자체가 막혔다.
//   ② 한 곳을 저장하면 목록으로 돌아가, 다음 줄을 눈으로 찾아야 했다. 130번.
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
const KAKAO = (n) => `https://place.map.kakao.com/${1000000 + n}`;

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회", kind: "merchant" });
  const ap = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: ap.hash, salt: ap.salt, name: "회장", role: "ADMIN", associationId: a.id });
  return a;
}
const login = async (env) => {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/login")).text()) || [])[1];
  await post(env, j, "/t/bb/login", { _csrf: t, login: "a@bb.kr", password: "admin1234" });
  return j;
};

test("사장님을 몰라도 지도에서 골라 가게만 먼저 등록된다", async () => {
  const env = makeEnv({}); const a = await seed(env);
  const j = await login(env);
  const t = await csrfOf(env, j, "/t/bb/admin");
  const r = await post(env, j, "/t/bb/admin/members/add",
    { _csrf: t, business_name: "너나들이", category: "음식점", address: "서울 서초구 방배동", map_url: KAKAO(1) });
  assert.equal(r.status, 303);
  assert.ok(!/err=1/.test(r.headers.get("location") || ""), decodeURIComponent(r.headers.get("location") || ""));
  const [biz] = await D.listAllBusinesses(env.DB, a.id);
  assert.ok(biz, "가게가 안 만들어졌다 — 130곳은 여기서 막힌다");
  assert.equal(biz.name, "너나들이");
  assert.equal(biz.map_url, KAKAO(1), "지도 연결도 함께 남아야 한다");
});

test("사장님을 모르면 임시 비밀번호를 불러 주겠다고 하지 않는다", async () => {
  const env = makeEnv({}); await seed(env);
  const j = await login(env);
  const t = await csrfOf(env, j, "/t/bb/admin");
  const r = await post(env, j, "/t/bb/admin/members/add", { _csrf: t, business_name: "너나들이" });
  const msg = decodeURIComponent(r.headers.get("location") || "");
  assert.ok(!/임시비번|임시 비밀번호 [A-Za-z0-9]/.test(msg), `전달할 상대가 없는데 비번을 불러 준다: ${msg}`);
  assert.ok(/사장님 정보는 아직 비어 있습니다/.test(msg), `다음에 뭘 하면 되는지를 말해야 한다: ${msg}`);
});

test("성함·휴대폰을 넣었으면 예전처럼 임시 비밀번호가 나온다", async () => {
  const env = makeEnv({}); await seed(env);
  const j = await login(env);
  const t = await csrfOf(env, j, "/t/bb/admin");
  const r = await post(env, j, "/t/bb/admin/members/add",
    { _csrf: t, business_name: "너나들이", name: "김사장", phone: "010-1234-5678" });
  const msg = decodeURIComponent(r.headers.get("location") || "");
  assert.ok(/임시비번/.test(msg), `연락처가 있으면 불러 줄 비번이 나와야 한다: ${msg}`);
});

test("성함만 있고 연락처가 없으면 예전처럼 막는다", async () => {
  // 이름을 적었다는 것은 '아는 사람' 이라는 뜻이다. 그런데 연락할 방법이 없으면
  // 로그인도 알림톡도 못 한다 — 그건 실수일 확률이 높으니 그대로 막는다.
  const env = makeEnv({}); await seed(env);
  const j = await login(env);
  const t = await csrfOf(env, j, "/t/bb/admin");
  const r = await post(env, j, "/t/bb/admin/members/add", { _csrf: t, business_name: "너나들이", name: "김사장" });
  assert.ok(/err=1/.test(r.headers.get("location") || ""), "연락처 없는 등록이 통과했다");
});

test("업체명은 여전히 없으면 안 된다", async () => {
  const env = makeEnv({}); await seed(env);
  const j = await login(env);
  const t = await csrfOf(env, j, "/t/bb/admin");
  const r = await post(env, j, "/t/bb/admin/members/add", { _csrf: t });
  assert.ok(/err=1/.test(r.headers.get("location") || ""), "이름 없는 가게가 만들어졌다");
});

test("나중에 성함·휴대폰을 넣으면 그 계정이 그대로 사장님 계정이 된다", async () => {
  // 새 계정을 만들어 갈아 끼우면 그동안 채운 사진·소개가 딸려 사라진다.
  const env = makeEnv({}); const a = await seed(env);
  const j = await login(env);
  const t = await csrfOf(env, j, "/t/bb/admin");
  await post(env, j, "/t/bb/admin/members/add", { _csrf: t, business_name: "너나들이" });
  const [biz] = await D.listAllBusinesses(env.DB, a.id);
  const before = biz.owner_id;
  const t2 = await csrfOf(env, j, `/t/bb/admin/business/${biz.id}`);
  await post(env, j, `/t/bb/admin/business/${biz.id}/owner-phone`, { _csrf: t2, phone: "010-1234-5678" });
  const after = await D.getBusinessById(env.DB, biz.id);
  assert.equal(after.owner_id, before, "계정이 갈아 끼워졌다 — 채워 둔 것이 사라질 수 있다");
  const u = await D.getUserById(env.DB, after.owner_id);
  assert.equal(D.normalizePhone(u.phone), "01012345678");
});

// ── 130번의 왕복을 없앤다 ────────────────────────────────────────────────
test("가게 화면이 '남은 일' 과 '다음 가게' 를 맨 위에서 쥐어 준다", async () => {
  const env = makeEnv({}); const a = await seed(env);
  const j = await login(env);
  const t = await csrfOf(env, j, "/t/bb/admin");
  for (const nm of ["너나들이", "옆집", "그옆집"]) await post(env, j, "/t/bb/admin/members/add", { _csrf: t, business_name: nm });
  const list = await D.listAllBusinesses(env.DB, a.id);
  const html = await (await get(env, j, `/t/bb/admin/business/${list[0].id}`)).text();
  assert.ok(html.includes("이 가게에 남은 일"), "무엇이 남았는지가 위에 없다");
  assert.ok(/아직 손이 덜 간 가게가 <b>\d+곳<\/b> 남았습니다/.test(html), "얼마나 남았는지를 안 알려 준다");
  assert.ok(html.includes("저장하고 다음 가게"), "다음 가게로 가는 길이 없다");
  // '남은 일' 은 폼보다 위에 있어야 한다 — 다 지나쳐 내려가야 알면 소용이 없다
  assert.ok(html.indexOf("이 가게에 남은 일") < html.indexOf("가게 정보"), "남은 일이 폼 아래에 있다");
});

test("[저장하고 다음 가게] 를 누르면 실제로 다음 가게 화면으로 간다", async () => {
  const env = makeEnv({}); const a = await seed(env);
  const j = await login(env);
  const t = await csrfOf(env, j, "/t/bb/admin");
  for (const nm of ["너나들이", "옆집"]) await post(env, j, "/t/bb/admin/members/add", { _csrf: t, business_name: nm });
  const list = await D.listAllBusinesses(env.DB, a.id);
  const [one, two] = [list[0], list[1]];
  const t2 = await csrfOf(env, j, `/t/bb/admin/business/${one.id}`);
  const r = await post(env, j, `/t/bb/admin/business/${one.id}`,
    { _csrf: t2, name: one.name, category: "음식점", description: "", phone: "", address: "", hours: "", lat: "", lng: "", next: String(two.id) });
  assert.equal(r.status, 303);
  assert.ok(r.headers.get("location").startsWith(`/t/bb/admin/business/${two.id}`),
    `다음 가게로 안 간다: ${r.headers.get("location")}`);
});

test("남의 상인회 가게 번호를 '다음' 으로 적어 보내도 따라가지 않는다", async () => {
  const env = makeEnv({}); const a = await seed(env);
  const zz = await D.createAssociation(env.DB, { slug: "zz", name: "남의 상인회", kind: "merchant" });
  const zp = await hashPassword("o1234567");
  const zu = await D.createUser(env.DB, { email: "z@zz.kr", passwordHash: zp.hash, salt: zp.salt, name: "남", role: "MERCHANT", associationId: zz.id });
  const theirs = await D.createBusiness(env.DB, { associationId: zz.id, ownerId: zu.id, name: "남의가게", category: "기타" });
  const j = await login(env);
  const t = await csrfOf(env, j, "/t/bb/admin");
  await post(env, j, "/t/bb/admin/members/add", { _csrf: t, business_name: "너나들이" });
  const [mine] = await D.listAllBusinesses(env.DB, a.id);
  const t2 = await csrfOf(env, j, `/t/bb/admin/business/${mine.id}`);
  const r = await post(env, j, `/t/bb/admin/business/${mine.id}`,
    { _csrf: t2, name: mine.name, category: "기타", description: "", phone: "", address: "", hours: "", lat: "", lng: "", next: String(theirs.id) });
  assert.ok(!r.headers.get("location").includes(`/business/${theirs.id}`),
    `남의 상인회 가게로 넘어갔다: ${r.headers.get("location")}`);
});

test("다 채운 가게만 남으면 '다음 가게' 를 권하지 않는다", async () => {
  const env = makeEnv({}); const a = await seed(env);
  const j = await login(env);
  const t = await csrfOf(env, j, "/t/bb/admin");
  await post(env, j, "/t/bb/admin/members/add", { _csrf: t, business_name: "너나들이" });
  const [only] = await D.listAllBusinesses(env.DB, a.id);
  const html = await (await get(env, j, `/t/bb/admin/business/${only.id}`)).text();
  // 자기 자신은 '다음' 이 될 수 없다 — 같은 화면을 다시 열면 끝없이 돈다
  assert.ok(!html.includes("저장하고 다음 가게"), "갈 데가 없는데 다음 가게를 권한다");
});
