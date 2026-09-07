// 게시판 등급제 — 일반 상인회원 vs 상인회 임원.
//
// 여기서 재는 것은 "안 보인다" 가 아니라 **어느 길로도 못 본다** 입니다.
// 목록에서만 숨기면 주소를 직접 치는 순간 보이고, 그러면 안 숨긴 것과 같습니다.
// 임원 게시판에는 회비 미납 명단·임대료 협상 같은 것이 올라갑니다.
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
async function member(env, a, email, name) {
  const p = await hashPassword("pw12345678");
  const u = await D.createUser(env.DB, { email, passwordHash: p.hash, salt: p.salt, name, role: "MERCHANT", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: name + "네", category: "음식점" });
  await D.setBusinessStatus(env.DB, b.id, "approved");
  const j = jar();
  await post(env, j, "/login", { email, password: "pw12345678" });
  return { u, b, j };
}
async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회" });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: ad.hash, salt: ad.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const aj = jar();
  await post(env, aj, "/login", { email: "a@bb.kr", password: "admin1234" });
  return { a, aj };
}

test("임원 글은 일반 회원의 목록에도, 총 건수에도 들어가지 않는다", async () => {
  const env = makeEnv();
  const { a, aj } = await seed(env);
  const kim = await member(env, a, "kim@bb.kr", "김일반");
  await post(env, aj, "/t/bb/board", { title: "정기총회 안내", body: "모두 오세요", audience: "all" }, "/t/bb/board");
  await post(env, aj, "/t/bb/board", { title: "회비 미납 명단", body: "3곳", audience: "officer" }, "/t/bb/board");

  const html = await (await get(env, kim.j, "/t/bb/board")).text();
  assert.match(html, /정기총회 안내/);
  assert.ok(!html.includes("회비 미납 명단"), "임원 글이 목록에 보이면 안 된다");
  assert.match(html, /글 1개/, "총 건수도 1개여야 한다 — 2개라 적히면 '하나가 사라졌다' 가 된다");
});

test("주소를 직접 쳐도 못 본다 — 없는 글처럼 답한다", async () => {
  const env = makeEnv();
  const { a, aj } = await seed(env);
  const kim = await member(env, a, "kim@bb.kr", "김일반");
  await post(env, aj, "/t/bb/board", { title: "회비 미납 명단", body: "3곳", audience: "officer" }, "/t/bb/board");
  const p = (await D.listPostsPaged(env.DB, a.id, { officer: true })).items[0];

  const r = await get(env, kim.j, `/t/bb/board/${p.id}`);
  assert.equal(r.status, 404, "목록에서만 숨기면 안 숨긴 것과 같다");
  const body = await r.text();
  assert.ok(!body.includes("회비 미납 명단"), "제목조차 새면 안 된다");
  assert.ok(!/임원/.test(body), "'임원 전용입니다' 라고 알리면 무슨 글이 있다는 사실이 샌다");
  // 고치기도 안 된다
  assert.equal((await get(env, kim.j, `/t/bb/board/${p.id}/edit`)).status, 404);
  await post(env, kim.j, `/t/bb/board/${p.id}/edit`, { title: "가로채기", body: "x" }, "/t/bb/board");
  assert.equal((await D.getPost(env.DB, p.id)).title, "회비 미납 명단", "못 보는 글을 고칠 수는 없어야 한다");
});

test("임원으로 지정하면 그때부터 보인다 — 내리면 다시 안 보인다", async () => {
  const env = makeEnv();
  const { a, aj } = await seed(env);
  const lee = await member(env, a, "lee@bb.kr", "이임원");
  await post(env, aj, "/t/bb/board", { title: "임대료 협상", body: "내용", audience: "officer" }, "/t/bb/board");

  assert.ok(!(await (await get(env, lee.j, "/t/bb/board")).text()).includes("임대료 협상"));
  await post(env, aj, `/t/bb/admin/user/${lee.u.id}/officer`, { on: "1" }, `/t/bb/admin/business/${lee.b.id}`);
  assert.match(await (await get(env, lee.j, "/t/bb/board")).text(), /임대료 협상/, "임원이 되면 보여야 한다");
  await post(env, aj, `/t/bb/admin/user/${lee.u.id}/officer`, { on: "0" }, `/t/bb/admin/business/${lee.b.id}`);
  assert.ok(!(await (await get(env, lee.j, "/t/bb/board")).text()).includes("임대료 협상"), "내리면 다시 안 보여야 한다");
});

test("일반 회원은 임원 전용으로 글을 쓸 수 없다 — 폼을 고쳐 보내도", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const kim = await member(env, a, "kim@bb.kr", "김일반");
  const html = await (await get(env, kim.j, "/t/bb/board")).text();
  assert.ok(!html.includes('name="audience"'), "고를 칸 자체가 안 보여야 한다");

  // 화면에 칸이 없는 것은 안내이지 방어가 아니다 — 직접 보내 본다
  await post(env, kim.j, "/t/bb/board", { title: "몰래 임원글", body: "x", audience: "officer" }, "/t/bb/board");
  const p = (await D.listPostsPaged(env.DB, a.id, { officer: true })).items.find((x) => x.title === "몰래 임원글");
  assert.equal(p.audience, "all", "일반 회원이 보낸 officer 는 무시해야 한다");
});

test("일반 회원이 자기 글을 고쳐도 임원 여부가 뒤집히지 않는다", async () => {
  const env = makeEnv();
  const { a, aj } = await seed(env);
  const lee = await member(env, a, "lee@bb.kr", "이임원");
  await post(env, aj, `/t/bb/admin/user/${lee.u.id}/officer`, { on: "1" }, `/t/bb/admin/business/${lee.b.id}`);
  await post(env, lee.j, "/t/bb/board", { title: "임원 메모", body: "x", audience: "officer" }, "/t/bb/board");
  const p = (await D.listPostsPaged(env.DB, a.id, { officer: true })).items[0];
  assert.equal(p.audience, "officer");

  // 임원에서 내린 뒤 본인이 글을 고친다 — audience 를 안 보내면 'all' 로 떨어져 조용히 공개될 수 있다
  await post(env, aj, `/t/bb/admin/user/${lee.u.id}/officer`, { on: "0" }, `/t/bb/admin/business/${lee.b.id}`);
  await post(env, lee.j, `/t/bb/board/${p.id}/edit`, { title: "임원 메모", body: "고침" }, "/t/bb/board");
  assert.equal((await D.getPost(env.DB, p.id)).audience, "officer",
    "볼 수 없는 사람이 고쳤다고 임원 글이 공개되면 안 된다");
});

test("회장은 표시가 없어도 임원 글을 본다", async () => {
  const env = makeEnv();
  const { a, aj } = await seed(env);
  await post(env, aj, "/t/bb/board", { title: "임원 회의록", body: "x", audience: "officer" }, "/t/bb/board");
  assert.match(await (await get(env, aj, "/t/bb/board")).text(), /임원 회의록/,
    "회장이 자기가 쓴 글을 못 보면 그건 버그로 신고된다");
  assert.ok(a);
});

test("남의 상인회 임원은 우리 임원 글을 못 본다", async () => {
  const env = makeEnv();
  const { a, aj } = await seed(env);
  const other = await D.createAssociation(env.DB, { slug: "gn", name: "강남 상인회" });
  const p2 = await hashPassword("pw12345678");
  const spy = await D.createUser(env.DB, { email: "s@gn.kr", passwordHash: p2.hash, salt: p2.salt, name: "남", role: "MERCHANT", associationId: other.id });
  await D.setUserOfficer(env.DB, spy.id, other.id, 1);   // 저쪽에서는 임원이다
  const sj = jar();
  await post(env, sj, "/login", { email: "s@gn.kr", password: "pw12345678" });
  await post(env, aj, "/t/bb/board", { title: "우리 회비 명단", body: "x", audience: "officer" }, "/t/bb/board");
  const post1 = (await D.listPostsPaged(env.DB, a.id, { officer: true })).items[0];
  assert.ok((await get(env, sj, `/t/bb/board/${post1.id}`)).status !== 200, "남의 조직 임원에게 열리면 안 된다");
});

test("임원 표시는 읽기 범위만 바꾼다 — 관리 권한은 그대로다", async () => {
  const env = makeEnv();
  const { a, aj } = await seed(env);
  const lee = await member(env, a, "lee@bb.kr", "이임원");
  await post(env, aj, `/t/bb/admin/user/${lee.u.id}/officer`, { on: "1" }, `/t/bb/admin/business/${lee.b.id}`);
  for (const p of ["/t/bb/admin", "/t/bb/admin/settings", "/t/bb/admin/members.csv"]) {
    const r = await get(env, lee.j, p);
    assert.ok(r.status !== 200, `임원이 관리 화면(${p})에 들어가면 안 된다 (${r.status})`);
  }
  assert.ok(a);
});

test("남의 조직 회원을 임원으로 지정하지 못한다", async () => {
  const env = makeEnv();
  const { aj } = await seed(env);
  const other = await D.createAssociation(env.DB, { slug: "gn", name: "강남 상인회" });
  const p2 = await hashPassword("pw12345678");
  const u = await D.createUser(env.DB, { email: "x@gn.kr", passwordHash: p2.hash, salt: p2.salt, name: "남", role: "MERCHANT", associationId: other.id });
  await post(env, aj, `/t/bb/admin/user/${u.id}/officer`, { on: "1" }, "/t/bb/admin");
  assert.notEqual(Number((await D.getUserById(env.DB, u.id)).officer), 1);
});
