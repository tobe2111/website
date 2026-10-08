// 후보가 여럿인 투표 — 회장 선출처럼 "여럿 중 하나" 를 고르는 안건.
//
// 지금까지 투표는 찬성·반대·기권 셋뿐이었습니다. 안건 표결에는 맞지만 회장 선출에는 못
// 썼습니다 — 후보가 두 분이면 "찬성/반대" 로는 물을 수 없기 때문입니다. 그래서 안건마다
// 고를 것을 직접 적을 수 있게 했습니다.
//
// 여기서 재는 것은 네 가지입니다. ① 적은 대로 단추가 서고 표가 그 후보에게 쌓이는가,
// ② 비워 둔 안건은 **한 글자도 안 바뀌는가**(이미 올라간 안건들이 여기에 걸립니다),
// ③ 없는 후보에게 표를 넣을 수 없는가(화면이 아니라 서버가 막아야 합니다),
// ④ 표가 들어온 뒤에 후보 줄을 바꿀 수 없는가 — 줄 번호로 표를 세므로, 줄을 지우면
//    이미 들어온 표가 **다른 후보의 표**가 됩니다. 그건 고치는 게 아니라 표를 옮기는 것입니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const B = "http://localhost";
let ipN = 0;
const jar = () => ({ c: {}, ip: `10.9.0.${++ipN}` });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const hdr = (j) => ({ cookie: ch(j), "cf-connecting-ip": j.ip });
const absorb = (j, r) => {
  for (const s of r.headers.getSetCookie?.() || []) {
    const kv = s.split(";")[0]; const i = kv.indexOf("=");
    j.c[kv.slice(0, i)] = kv.slice(i + 1);
  }
};
const get = async (env, j, p) => { const r = await worker.fetch(new Request(B + p, { headers: hdr(j) }), env); absorb(j, r); return r; };
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST",
    headers: { ...hdr(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
const msg = (r) => decodeURIComponent((r.headers.get("location") || "").split("msg=")[1] || "");

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "market", name: "방배카페골목상인회", kind: "merchant" });
  const h = await hashPassword("pw12341234");
  const admin = await D.createUser(env.DB, { email: "ad@x.kr", passwordHash: h.hash, salt: h.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const members = [];
  for (let i = 0; i < 3; i++) {
    const u = await D.createUser(env.DB, { email: `m${i}@x.kr`, passwordHash: h.hash, salt: h.salt, name: `사장 ${i}`, role: "MERCHANT", associationId: a.id });
    members.push(u);
  }
  return { a, admin, members };
}
const login = async (env, email) => { const j = jar(); await post(env, j, "/login", { email, password: "pw12341234" }); return j; };

test("후보를 적으면 그 후보들이 단추가 되고, 비워 두면 찬성·반대·기권 그대로다", async () => {
  const env = makeEnv();
  await seed(env);
  const aj = await login(env, "ad@x.kr");
  await post(env, aj, "/t/market/admin/polls",
    { title: "제6대 회장 선출", body: "두 분이 나오셨습니다.", options: "기호 1번 김정숙\n기호 2번 이영수" }, "/t/market/admin");
  await post(env, aj, "/t/market/admin/polls", { title: "회비 인상안", body: "" }, "/t/market/admin");

  const html = await (await get(env, await login(env, "m0@x.kr"), "/t/market/polls")).text();
  // 선거형 — 적어 넣은 두 후보가 그대로 단추가 된다
  assert.ok(html.includes("기호 1번 김정숙") && html.includes("기호 2번 이영수"), "후보가 화면에 없다");
  assert.ok(/value="o0"/.test(html) && /value="o1"/.test(html), "후보 단추 값이 줄 번호여야 한다");
  assert.ok(html.includes("후보 2명 중 하나"), "선거형이라는 표시가 있어야 한다");
  // 안건형 — 지금까지와 똑같다
  assert.ok(/value="yes"/.test(html) && /value="no"/.test(html) && /value="abstain"/.test(html), "찬반 안건의 단추가 그대로여야 한다");
});

test("표는 고른 후보에게 쌓이고, 결과 막대도 후보별로 선다", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회장 선출", options: "김정숙\n이영수\n박철민" });
  const j0 = await login(env, "m0@x.kr"); await post(env, j0, `/t/market/polls/${p.id}/vote`, { choice: "o1" }, "/t/market/polls");
  const j1 = await login(env, "m1@x.kr"); await post(env, j1, `/t/market/polls/${p.id}/vote`, { choice: "o1" }, "/t/market/polls");
  const j2 = await login(env, "m2@x.kr"); await post(env, j2, `/t/market/polls/${p.id}/vote`, { choice: "o0" }, "/t/market/polls");

  const r = await D.pollResults(env.DB, p.id);
  assert.equal(r.o1, 2, "이영수 2표");
  assert.equal(r.o0, 1, "김정숙 1표");
  assert.equal(r.o2, 0, "박철민 0표");
  assert.equal(r.total, 3, "참여 3명");

  const html = await (await get(env, j0, "/t/market/polls")).text();
  assert.ok(html.includes("이영수 <b>2표</b>"), "후보별 막대에 득표가 적혀야 한다");
  assert.ok(html.includes("내 투표: <b>이영수</b>"), "내가 고른 후보가 이름으로 보여야 한다");

  // 목록 화면은 한 번에 모아 세는 길(pollResultsBulk)을 쓴다 — 여기도 후보를 알아야 한다
  const bulk = await D.pollResultsBulk(env.DB, a.id);
  assert.equal(bulk.get(p.id).o1, 2, "모아 센 결과도 후보별로 맞아야 한다");
});

test("없는 후보에게는 표를 넣을 수 없다 — 화면이 아니라 서버가 막는다", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회장 선출", options: "김정숙\n이영수" });
  const j = await login(env, "m0@x.kr");
  // 후보는 둘(o0·o1)뿐이다. 주소로 직접 보낸 요청도 걸려야 한다.
  for (const bad of ["o2", "yes", "abstain", "", "__proto__", "total"]) {
    await post(env, j, `/t/market/polls/${p.id}/vote`, { choice: bad }, "/t/market/polls");
    assert.equal((await D.pollResults(env.DB, p.id)).total, 0, `'${bad}' 가 표로 들어갔다`);
  }
  // 찬반 안건에는 반대로 o0 이 들어가면 안 된다
  const q = await D.createPoll(env.DB, { associationId: a.id, title: "회비 인상" });
  await post(env, j, `/t/market/polls/${q.id}/vote`, { choice: "o0" }, "/t/market/polls");
  assert.equal((await D.pollResults(env.DB, q.id)).total, 0, "찬반 안건에 후보 표가 들어갔다");
});

test("표가 들어온 뒤에는 후보 줄을 바꿀 수 없다 — 바꾸면 남의 표가 된다", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회장 선출", options: "김정숙\n이영수" });
  const j = await login(env, "m0@x.kr");
  await post(env, j, `/t/market/polls/${p.id}/vote`, { choice: "o1" }, "/t/market/polls");

  const aj = await login(env, "ad@x.kr");
  const r = await post(env, aj, `/t/market/admin/polls/${p.id}`, { title: "회장 선출", options: "이영수" }, "/t/market/polls");
  assert.match(msg(r), /고를 것들은 그대로/, "바꾸지 않았다고 알려야 한다");
  const after = await D.getPoll(env.DB, p.id);
  assert.equal(D.pollOptionLines(after).length, 2, "후보 줄이 그대로여야 한다");
  assert.equal((await D.pollResults(env.DB, p.id)).o1, 1, "이영수의 표가 그대로여야 한다");

  // 표가 없으면 바꿀 수 있다
  const q = await D.createPoll(env.DB, { associationId: a.id, title: "감사 선출", options: "가\n나" });
  await post(env, aj, `/t/market/admin/polls/${q.id}`, { title: "감사 선출", options: "가\n나\n다" }, "/t/market/polls");
  assert.equal(D.pollOptionLines(await D.getPoll(env.DB, q.id)).length, 3, "표가 없으면 후보를 늘릴 수 있어야 한다");
});

test("비밀 선거도 된다 — 누가 어느 후보를 골랐는지는 남지 않는다", async () => {
  const env = makeEnv();
  const { a, members } = await seed(env);
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회장 선출", options: "김정숙\n이영수", secret: 1 });
  const j0 = await login(env, "m0@x.kr"); await post(env, j0, `/t/market/polls/${p.id}/vote`, { choice: "o0" }, "/t/market/polls");
  const j1 = await login(env, "m1@x.kr"); await post(env, j1, `/t/market/polls/${p.id}/vote`, { choice: "o1" }, "/t/market/polls");

  const r = await D.pollResults(env.DB, p.id);
  assert.equal(r.o0, 1); assert.equal(r.o1, 1); assert.equal(r.total, 2);
  // 사람 줄에는 선택이 비어 있어야 한다
  for (const m of members.slice(0, 2))
    assert.equal(await D.userVote(env.DB, p.id, m.id), null, "비밀 선거인데 사람 줄에 선택이 남았다");
});

test("의사록이 선거는 후보별 득표와 최다 득표로 적는다 — 찬성 0표로 적지 않는다", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회장 선출", options: "김정숙\n이영수" });
  const j0 = await login(env, "m0@x.kr"); await post(env, j0, `/t/market/polls/${p.id}/vote`, { choice: "o0" }, "/t/market/polls");
  const j1 = await login(env, "m1@x.kr"); await post(env, j1, `/t/market/polls/${p.id}/vote`, { choice: "o0" }, "/t/market/polls");
  const j2 = await login(env, "m2@x.kr"); await post(env, j2, `/t/market/polls/${p.id}/vote`, { choice: "o1" }, "/t/market/polls");

  const aj = await login(env, "ad@x.kr");
  const html = await (await get(env, aj, `/t/market/admin/polls/${p.id}/minutes`)).text();
  assert.ok(html.includes("최다 득표"), "최다 득표 줄이 있어야 한다");
  assert.ok(/최다 득표[\s\S]{0,200}김정숙/.test(html), "최다 득표자가 적혀야 한다");
  assert.ok(!/<th>찬성<\/th>/.test(html), "선거에 '찬성' 줄을 적으면 안 된다");
  assert.ok(html.includes("당선·낙선"), "선거는 가결·부결이 아니라 당선·낙선으로 적어야 한다");
  // 명세에는 누가 누구를 골랐는지가 후보 이름으로 적힌다
  assert.ok(html.includes(">김정숙<"), "명세에 후보 이름이 적혀야 한다");

  const csv = await (await get(env, aj, `/t/market/admin/polls/${p.id}/minutes.csv`)).text();
  assert.ok(csv.includes("김정숙") && csv.includes("이영수"), "CSV 에도 후보 이름이 적혀야 한다");
});

test("동점이면 한 사람을 고르지 않는다 — 종이가 적으면 그게 결정으로 읽힌다", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회장 선출", options: "김정숙\n이영수" });
  const j0 = await login(env, "m0@x.kr"); await post(env, j0, `/t/market/polls/${p.id}/vote`, { choice: "o0" }, "/t/market/polls");
  const j1 = await login(env, "m1@x.kr"); await post(env, j1, `/t/market/polls/${p.id}/vote`, { choice: "o1" }, "/t/market/polls");

  const aj = await login(env, "ad@x.kr");
  const html = await (await get(env, aj, `/t/market/admin/polls/${p.id}/minutes`)).text();
  assert.ok(html.includes("동점"), "동점이라고 적어야 한다");
  assert.ok(html.includes("최다 득표가 가려지지 않아"), "동점에서는 과반을 판단하지 않아야 한다");
});

test("단톡방 링크로 들어온 선거도 후보 단추가 뜨고 표가 들어간다", async () => {
  const env = makeEnv();
  const { a, members } = await seed(env);
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회장 선출", options: "김정숙\n이영수", rosterLink: 1 });
  const { makeVoteToken } = await import("../src/api.js");
  const token = await makeVoteToken(env.SESSION_SECRET, a.id, p.id, members[0].id, { how: "link" });
  const j = jar();
  const html = await (await get(env, j, `/t/market/vote/${token}`)).text();
  assert.ok(html.includes("김정숙") && html.includes("이영수"), "링크 화면에 후보가 떠야 한다");
  await post(env, j, `/t/market/vote/${token}`, { choice: "o1" });
  assert.equal((await D.pollResults(env.DB, p.id)).o1, 1, "링크로 넣은 표가 후보에게 가야 한다");
});

test("줄이 비거나 너무 많으면 다듬어 받는다 — 빈 줄 하나로 선거가 되면 안 된다", () => {
  assert.equal(D.normalizePollOptions("  \n\n  \n"), "", "빈 줄만 있으면 찬반 안건이다");
  assert.equal(D.pollIsElection({ options: D.normalizePollOptions("\n \n") }), false);
  assert.equal(D.normalizePollOptions(" 가 \n\n 나 ").split("\n").length, 2, "빈 줄은 버린다");
  const many = D.normalizePollOptions(Array.from({ length: 30 }, (_, i) => `후보${i}`).join("\n"));
  assert.equal(many.split("\n").length, D.POLL_MAX_OPTIONS, "줄 수를 자른다");
  assert.equal(D.normalizePollOptions("가".repeat(200)).length, 60, "한 줄 길이를 자른다");
});
