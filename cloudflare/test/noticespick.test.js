// 공개 공지 목록에서 관리자가 그 자리에서 지우고 고정한다.
//
// 지금까지는 목록을 보다가 지우려면 관리 화면으로 건너가 같은 목록을 다시 찾아야 했다.
// 손님과 같은 화면을 보다가 "이건 지난 공지네" 하고 바로 치우는 것이 자연스럽다.
//
// 다만 이 화면은 손님도 보는 화면이다. 고르기 칸과 도구줄은 관리자에게만 그려져야 하고,
// 서버는 화면이 무엇을 그렸든 상관없이 권한과 소속을 다시 확인해야 한다.
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

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회", kind: "merchant" });
  const other = await D.createAssociation(env.DB, { slug: "zz", name: "남의 상인회", kind: "merchant" });
  const ap = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: ap.hash, salt: ap.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const mp = await hashPassword("owner1234");
  await D.createUser(env.DB, { email: "o@bb.kr", passwordHash: mp.hash, salt: mp.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const ns = [];
  for (const t of ["9월 정기총회", "가로등 교체", "회비 안내"]) ns.push(await D.createNotice(env.DB, { associationId: a.id, title: t, body: "본문", tag: "안내" }));
  const theirs = await D.createNotice(env.DB, { associationId: other.id, title: "남의 공지", body: "본문", tag: "안내" });
  return { a, ns, theirs };
}
const login = async (env, email, password) => {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/login")).text()) || [])[1];
  await post(env, j, "/t/bb/login", { _csrf: t, login: email, password });
  return j;
};
const csrfOf = async (env, j, p) => (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, p)).text()) || [])[1];

test("손님에게는 고르기 칸도 도구줄도 보이지 않는다", async () => {
  const env = makeEnv({}); await seed(env);
  const body = await (await get(env, jar(), "/t/bb/notices")).text();
  assert.ok(!body.includes('id="noticePick"'), "손님 화면에 관리 도구줄이 있다");
  assert.ok(!body.includes('name="ids"'), "손님 화면에 고르기 칸이 있다");
  assert.ok(body.includes("9월 정기총회"), "공지는 손님에게도 보여야 한다");
});

test("사장님(MERCHANT)에게도 보이지 않는다", async () => {
  const env = makeEnv({}); await seed(env);
  const j = await login(env, "o@bb.kr", "owner1234");
  const body = await (await get(env, j, "/t/bb/notices")).text();
  assert.ok(!body.includes('id="noticePick"'));
});

test("관리자에게는 도구줄과 줄마다 고르기 칸이 보인다", async () => {
  const env = makeEnv({}); const { ns } = await seed(env);
  const j = await login(env, "a@bb.kr", "admin1234");
  const body = await (await get(env, j, "/t/bb/notices")).text();
  assert.ok(body.includes('id="noticePick"'), "도구줄이 없다");
  for (const n of ns) assert.ok(body.includes(`value="${n.id}"`), `${n.id} 고르기 칸이 없다`);
  assert.ok(body.includes("bulk-select.js"), "고른 건수를 세는 스크립트가 없다");
});

test("공지 목록에서 지우면 공지 목록으로 돌아온다", async () => {
  const env = makeEnv({}); const { ns } = await seed(env);
  const j = await login(env, "a@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/notices");
  const r = await post(env, j, "/t/bb/admin/notices/bulk",
    { _csrf: t, back: "/t/bb/notices", act: "delete", ids: String(ns[0].id) });
  assert.equal(r.status, 303);
  assert.ok(r.headers.get("location").startsWith("/t/bb/notices?"), r.headers.get("location"));
  assert.ok(!await D.getNotice(env.DB, ns[0].id), "공지가 지워지지 않았다");
});

test("돌아갈 자리를 안 주면 관리 화면으로 간다 (기존 동작 유지)", async () => {
  const env = makeEnv({}); const { ns } = await seed(env);
  const j = await login(env, "a@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/admin");
  const r = await post(env, j, "/t/bb/admin/notices/bulk", { _csrf: t, act: "delete", ids: String(ns[1].id) });
  // 안내(msg)는 조각(#) **앞**에 붙어야 한다 — 뒤에 붙으면 브라우저가 서버에 안 보내
  // 성공 안내가 통째로 사라진다("눌렀는데 아무 반응이 없다").
  const loc = r.headers.get("location");
  assert.ok(loc.startsWith("/t/bb/admin?"), loc);
  assert.ok(loc.endsWith("#s-content"), loc);
  assert.ok(/[?&]msg=/.test(loc.split("#")[0]), `안내가 조각 안으로 들어갔다: ${loc}`);
});

test("돌아갈 자리로 남의 사이트를 적어 보내도 따라가지 않는다", async () => {
  const env = makeEnv({}); const { ns } = await seed(env);
  const j = await login(env, "a@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/notices");
  for (const bad of ["https://evil.example/x", "//evil.example/x", "/t/zz/notices"]) {
    const r = await post(env, j, "/t/bb/admin/notices/bulk",
      { _csrf: t, back: bad, act: "pin", ids: String(ns[2].id) });
    const loc = r.headers.get("location");
    assert.ok(loc.startsWith("/t/bb/admin?") && loc.endsWith("#s-content"), `${bad} → ${loc}`);
  }
});

test("사장님이 폼을 흉내 내 보내도 막힌다", async () => {
  const env = makeEnv({}); const { ns } = await seed(env);
  const j = await login(env, "o@bb.kr", "owner1234");
  const t = await csrfOf(env, j, "/t/bb/notices");
  const r = await post(env, j, "/t/bb/admin/notices/bulk",
    { _csrf: t, back: "/t/bb/notices", act: "delete", ids: String(ns[0].id) });
  assert.ok(r.status === 303 || r.status === 403, `상태 ${r.status}`);
  if (r.status === 303) assert.ok(!/msg=.*삭제했습니다/.test(r.headers.get("location") || ""));
  assert.ok(await D.getNotice(env.DB, ns[0].id), "사장님이 공지를 지웠다");
});

test("남의 상인회 공지 번호를 보내도 그 공지는 그대로다", async () => {
  const env = makeEnv({}); const { theirs } = await seed(env);
  const j = await login(env, "a@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/notices");
  await post(env, j, "/t/bb/admin/notices/bulk",
    { _csrf: t, back: "/t/bb/notices", act: "delete", ids: String(theirs.id) });
  assert.ok(await D.getNotice(env.DB, theirs.id), "남의 상인회 공지가 지워졌다");
});
