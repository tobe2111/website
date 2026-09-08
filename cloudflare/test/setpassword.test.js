// 회장님이 비밀번호를 **직접 정한다**.
//
// 예전에는 [임시 비밀번호 발급] 하나뿐이었다. 임시 비밀번호는 화면에 딱 한 번 뜨는데,
// 그 줄을 놓치면(자주 놓친다) 다시 발급해야 하고 이미 알려 준 값이 또 무효가 된다.
// 전화로 불러 줄 값을 미리 정하는 편이 현실에서 훨씬 덜 꼬인다.
//
// 다만 남의 계정 비밀번호를 바꾸는 창구다. 누가 누구 것을 바꿀 수 있는지가 이 파일의 본론이다.
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

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회", kind: "merchant" });
  const zz = await D.createAssociation(env.DB, { slug: "zz", name: "남의 상인회", kind: "merchant" });
  const mk = async (email, name, role, assocId, pw = "start1234") => {
    const h = await hashPassword(pw);
    return D.createUser(env.DB, { email, passwordHash: h.hash, salt: h.salt, name, role, associationId: assocId });
  };
  return {
    a, zz,
    boss: await mk("boss@bb.kr", "회장", "ADMIN", a.id, "admin1234"),
    staff: await mk("chong@bb.kr", "총무", "ADMIN", a.id),
    owner: await mk("o@bb.kr", "사장", "MERCHANT", a.id),
    theirs: await mk("x@zz.kr", "남의 회장", "ADMIN", zz.id),
  };
}
const loginAs = async (env, slug, email, pw) => {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, `/t/${slug}/login`)).text()) || [])[1];
  await post(env, j, `/t/${slug}/login`, { _csrf: t, login: email, password: pw });
  return j;
};
// 그 비밀번호로 실제로 들어와지는지 — 화면 안내가 아니라 로그인으로 확인한다
async function canLogin(env, slug, email, pw) {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, `/t/${slug}/login`)).text()) || [])[1];
  const r = await post(env, j, `/t/${slug}/login`, { _csrf: t, login: email, password: pw });
  return r.status === 303 && !/err=1/.test(r.headers.get("location") || "");
}

test("정한 값으로 바뀌고, 그 값으로 실제 로그인된다", async () => {
  const env = makeEnv({}); const { staff } = await seed(env);
  const j = await loginAs(env, "bb", "boss@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/admin");
  const r = await post(env, j, `/t/bb/admin/user/${staff.id}/reset-password`, { _csrf: t, password: "12345678" });
  assert.equal(r.status, 303);
  assert.ok(!/err=1/.test(r.headers.get("location") || ""), r.headers.get("location"));
  assert.ok(await canLogin(env, "bb", "chong@bb.kr", "12345678"), "정한 비밀번호로 안 들어가진다");
  assert.ok(!await canLogin(env, "bb", "chong@bb.kr", "start1234"), "옛 비밀번호가 아직 살아 있다");
});

test("비우고 보내면 예전처럼 임시 비밀번호를 만들어 화면에 보여 준다", async () => {
  const env = makeEnv({}); const { staff } = await seed(env);
  const j = await loginAs(env, "bb", "boss@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/admin");
  const r = await post(env, j, `/t/bb/admin/user/${staff.id}/reset-password`, { _csrf: t, password: "" });
  const loc = decodeURIComponent(r.headers.get("location") || "");
  const temp = (/임시 비밀번호 (\S+)/.exec(loc) || [])[1];
  assert.ok(temp, `임시 비밀번호가 안내에 없다: ${loc}`);
  assert.ok(await canLogin(env, "bb", "chong@bb.kr", temp), "안내에 적힌 임시 비밀번호로 안 들어가진다");
});

test("직접 정한 값은 안내에 다시 적지 않는다 (주소창·방문기록에 남지 않게)", async () => {
  const env = makeEnv({}); const { staff } = await seed(env);
  const j = await loginAs(env, "bb", "boss@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/admin");
  const r = await post(env, j, `/t/bb/admin/user/${staff.id}/reset-password`, { _csrf: t, password: "hunter2hunter2" });
  const loc = decodeURIComponent(r.headers.get("location") || "");
  assert.ok(!loc.includes("hunter2hunter2"), `비밀번호가 주소에 실렸다: ${loc}`);
});

test("8자 미만은 막는다 — 그리고 비밀번호는 그대로다", async () => {
  const env = makeEnv({}); const { staff } = await seed(env);
  const j = await loginAs(env, "bb", "boss@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/admin");
  const r = await post(env, j, `/t/bb/admin/user/${staff.id}/reset-password`, { _csrf: t, password: "1234567" });
  assert.ok(/err=1/.test(r.headers.get("location") || ""), "짧은 비밀번호가 통과했다");
  assert.ok(await canLogin(env, "bb", "chong@bb.kr", "start1234"), "막았는데 비밀번호가 바뀌었다");
});

test("남의 상인회 사람 번호를 보내도 바뀌지 않는다", async () => {
  const env = makeEnv({}); const { theirs } = await seed(env);
  const j = await loginAs(env, "bb", "boss@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/admin");
  await post(env, j, `/t/bb/admin/user/${theirs.id}/reset-password`, { _csrf: t, password: "12345678" });
  assert.ok(await canLogin(env, "zz", "x@zz.kr", "start1234"), "남의 상인회 회장 비밀번호가 바뀌었다");
  assert.ok(!await canLogin(env, "zz", "x@zz.kr", "12345678"));
});

test("사장님(MERCHANT)은 남의 비밀번호를 바꿀 수 없다", async () => {
  const env = makeEnv({}); const { staff } = await seed(env);
  const j = await loginAs(env, "bb", "o@bb.kr", "start1234");
  const t = await csrfOf(env, j, "/t/bb");
  const r = await post(env, j, `/t/bb/admin/user/${staff.id}/reset-password`, { _csrf: t, password: "12345678" });
  assert.ok(r.status === 303 || r.status === 403, `상태 ${r.status}`);
  assert.ok(await canLogin(env, "bb", "chong@bb.kr", "start1234"), "사장님이 총무 비밀번호를 바꿨다");
});

test("본인 비밀번호는 여기서 못 바꾼다 — 계정 설정으로 보낸다", async () => {
  const env = makeEnv({}); const { boss } = await seed(env);
  const j = await loginAs(env, "bb", "boss@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/admin");
  const r = await post(env, j, `/t/bb/admin/user/${boss.id}/reset-password`, { _csrf: t, password: "12345678" });
  assert.ok(/err=1/.test(r.headers.get("location") || ""));
  assert.ok(await canLogin(env, "bb", "boss@bb.kr", "admin1234"), "본인 비밀번호가 바뀌었다");
});

test("돌아갈 자리로 남의 사이트를 적어 보내도 따라가지 않는다", async () => {
  const env = makeEnv({}); const { staff } = await seed(env);
  const j = await loginAs(env, "bb", "boss@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/admin");
  for (const bad of ["https://evil.example/x", "//evil.example/x", "/t/zz/admin"]) {
    const r = await post(env, j, `/t/bb/admin/user/${staff.id}/reset-password`,
      { _csrf: t, password: "12345678", back: bad });
    assert.ok(r.headers.get("location").startsWith("/t/bb/admin"), `${bad} → ${r.headers.get("location")}`);
  }
});

test("관리자 목록이 아이디(이메일)를 그대로 보여 준다", async () => {
  const env = makeEnv({}); await seed(env);
  const j = await loginAs(env, "bb", "boss@bb.kr", "admin1234");
  const body = await (await get(env, j, "/t/bb/admin")).text();
  // 회장님이 "그 계정이 정확히 뭐냐" 를 물어보는 자리다. 이름만으로는 답이 안 된다.
  assert.ok(body.includes("boss@bb.kr"), "내 아이디가 안 보인다");
  assert.ok(body.includes("chong@bb.kr"), "다른 관리자 아이디가 안 보인다");
  assert.ok(body.includes('name="password"'), "비밀번호를 정할 칸이 없다");
});
