// 안건 투표를 고칠 수 있게.
//
// 공지·행사는 그 자리에서 고칠 수 있는데 투표만 안 됐다. 오타 하나 때문에 지우고 다시 만들면
// 이미 들어온 표가 함께 사라진다 — 회장님 입장에서 그건 "고쳤다" 가 아니라 "무르고 다시 물었다" 다.
// 총회 안건을 다시 묻는 일은 그 자체로 사고다.
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
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "방배카페골목상인회", kind: "merchant" });
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const mem = await D.createUser(env.DB, { email: "me@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회원", role: "MERCHANT", associationId: a.id });
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "가을 골목축제 부수 운영", body: "설명", closesAt: "" });
  return { a, p, mem };
}
const loginAdmin = async (env) => { const j = jar(); await post(env, j, "/login", { login: "ad@s.kr", password: "pass1234" }); return j; };
const loginMember = async (env) => { const j = jar(); await post(env, j, "/login", { login: "me@s.kr", password: "pass1234" }); return j; };

test("제목·설명·마감일을 고쳐도 이미 들어온 표는 그대로 남는다", async () => {
  const env = makeEnv(); const { a, p, mem } = await seed(env);
  await D.votePoll(env.DB, p.id, mem.id, "yes");
  const j = await loginAdmin(env);
  await post(env, j, `/t/seocho/admin/polls/${p.id}`,
    { title: "가을 골목축제 부스 운영", body: "고친 설명", closes_at: "2030-01-01" }, "/t/seocho/polls");
  const after = await D.getPoll(env.DB, p.id);
  assert.equal(after.title, "가을 골목축제 부스 운영", "오타가 고쳐져야");
  assert.equal(after.body, "고친 설명");
  assert.equal(after.closes_at, "2030-01-01");
  assert.equal((await D.pollResults(env.DB, p.id)).yes, 1, "표가 살아 있어야");
  assert.equal(await D.countPollVotes(env.DB, p.id), 1);
});

test("제목을 비우면 저장되지 않는다", async () => {
  const env = makeEnv(); const { p } = await seed(env);
  const j = await loginAdmin(env);
  await post(env, j, `/t/seocho/admin/polls/${p.id}`, { title: "  ", body: "x" }, "/t/seocho/polls");
  assert.equal((await D.getPoll(env.DB, p.id)).title, "가을 골목축제 부수 운영");
});

test("잘못 마감한 투표를 다시 열 수 있다 — 지난 마감일도 함께 지운다", async () => {
  const env = makeEnv(); const { p } = await seed(env);
  await D.updatePoll(env.DB, p.id, 1, { title: p.title, body: "", closesAt: "2020-01-01" });
  await D.closePoll(env.DB, p.id);
  assert.equal(D.isPollOpen(await D.getPoll(env.DB, p.id)), false);

  const j = await loginAdmin(env);
  await post(env, j, `/t/seocho/admin/polls/${p.id}/reopen`, {}, "/t/seocho/polls");
  const after = await D.getPoll(env.DB, p.id);
  assert.equal(after.closed, 0);
  assert.equal(after.closes_at, "", "지난 마감일이 남아 있으면 다시 열어도 닫힌 채다");
  assert.equal(D.isPollOpen(after), true);
});

test("앞으로 남은 마감일은 다시 열 때 지우지 않는다", async () => {
  const env = makeEnv(); const { p } = await seed(env);
  await D.updatePoll(env.DB, p.id, 1, { title: p.title, body: "", closesAt: "2099-12-31" });
  await D.closePoll(env.DB, p.id);
  await D.reopenPoll(env.DB, p.id);
  assert.equal((await D.getPoll(env.DB, p.id)).closes_at, "2099-12-31");
});

test("안건을 지우면 표도 함께 지워진다 (주인 없는 표를 남기지 않는다)", async () => {
  const env = makeEnv(); const { p, mem } = await seed(env);
  await D.votePoll(env.DB, p.id, mem.id, "no");
  const j = await loginAdmin(env);
  await post(env, j, `/t/seocho/admin/polls/${p.id}/delete`, {}, "/t/seocho/polls");
  assert.equal(await D.getPoll(env.DB, p.id), null);
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM poll_votes WHERE poll_id=?").bind(p.id).first();
  assert.equal(Number(left.n), 0);
});

test("회원은 안건을 고치거나 지울 수 없다", async () => {
  const env = makeEnv(); const { p } = await seed(env);
  const j = await loginMember(env);
  await post(env, j, `/t/seocho/admin/polls/${p.id}`, { title: "몰래 바꾼 안건" }, "/t/seocho/polls");
  await post(env, j, `/t/seocho/admin/polls/${p.id}/delete`, {}, "/t/seocho/polls");
  const after = await D.getPoll(env.DB, p.id);
  assert.ok(after, "회원이 지울 수 있으면 안 된다");
  assert.equal(after.title, "가을 골목축제 부수 운영");
});

test("옆 상인회 안건은 고칠 수 없다 (테넌트 격리)", async () => {
  const env = makeEnv(); await seed(env);
  const b = await D.createAssociation(env.DB, { slug: "other", name: "다른상인회", kind: "merchant" });
  const foreign = await D.createPoll(env.DB, { associationId: b.id, title: "남의 안건" });
  const j = await loginAdmin(env);
  await post(env, j, `/t/seocho/admin/polls/${foreign.id}`, { title: "가로챈 안건" }, "/t/seocho/polls");
  assert.equal((await D.getPoll(env.DB, foreign.id)).title, "남의 안건");
});

test("투표 화면에 고치기 서랍이 뜨고, 이미 투표한 사람 수를 경고로 알려 준다", async () => {
  const env = makeEnv(); const { p, mem } = await seed(env);
  await D.votePoll(env.DB, p.id, mem.id, "abstain");
  const j = await loginAdmin(env);
  const html = await (await get(env, j, "/t/seocho/polls")).text();
  assert.match(html, /안건 고치기/);
  assert.match(html, /이미 <b>1명<\/b>이 투표했습니다/);
  assert.match(html, /이 안건 지우기/);
});

test("회원 화면에는 고치기 서랍이 없다", async () => {
  const env = makeEnv(); await seed(env);
  const j = await loginMember(env);
  const html = await (await get(env, j, "/t/seocho/polls")).text();
  assert.doesNotMatch(html, /안건 고치기/);
  assert.doesNotMatch(html, /이 안건 지우기/);
});
