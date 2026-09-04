// 회비를 금액으로 적는다.
//
// 예전에는 '냈다/안 냈다' 체크뿐이었다. 그러면 임원이 총회에서 읽어야 할 두 줄
// (얼마 걷혔나 · 누가 안 냈나)을 만들 수 없어서, 결국 엑셀을 따로 쓴다.
// 장부가 둘이면 반드시 어긋난다 — 그게 이 기능의 이유다.
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
const PERIOD = "2026-09";
async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "방배카페골목상인회" });
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const mk = async (name, i, phone) => {
    const u = await D.createUser(env.DB, { email: `m${i}@x.kr`, passwordHash: pw.hash, salt: pw.salt, name, role: "MERCHANT", associationId: a.id, phone });
    await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: name + "네 가게", category: "음식점" });
    return u;
  };
  return { a, u1: await mk("김순자", 1, "01011112222"), u2: await mk("박기석", 2, "01033334444"), u3: await mk("이도현", 3, "") };
}
const login = async (env) => { const j = jar(); await post(env, j, "/login", { login: "ad@s.kr", password: "pass1234" }); return j; };

test("기본 월 회비를 정해 두면 체크할 때 그 금액이 들어간다", async () => {
  const env = makeEnv(); const { a, u1 } = await seed(env);
  const j = await login(env);
  await post(env, j, "/t/seocho/admin/dues/amount", { dues_amount: "30,000" }, "/t/seocho/admin");
  assert.equal((await D.getAssociationBySlug(env.DB, "seocho")).dues_amount, 30000, "쉼표를 넣어도 받아야");

  // 금액을 안 적어 보내면 기본값이 들어간다
  await post(env, j, "/t/seocho/admin/dues", { period: PERIOD, user_id: String(u1.id), on: "1" }, "/t/seocho/admin");
  const rows = await D.listDuesForPeriod(env.DB, a.id, PERIOD);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 30000);
});

test("사람마다 다른 금액을 그 자리에서 적는다", async () => {
  const env = makeEnv(); const { a, u1, u2 } = await seed(env);
  const j = await login(env);
  await post(env, j, "/t/seocho/admin/dues/amount", { dues_amount: "30000" }, "/t/seocho/admin");
  await post(env, j, "/t/seocho/admin/dues", { period: PERIOD, user_id: String(u1.id), on: "1", amount: "30000" }, "/t/seocho/admin");
  await post(env, j, "/t/seocho/admin/dues", { period: PERIOD, user_id: String(u2.id), on: "1", amount: "15,000" }, "/t/seocho/admin");
  const sum = await D.duesSummary(env.DB, a.id, PERIOD, 30000);
  assert.equal(sum.collected, 45000, "걷힌 돈은 실제로 적은 금액의 합이어야");
  assert.equal(sum.paid, 2);
  assert.equal(sum.unpaid, 1);
  assert.equal(sum.expected, 90000, "받을 것 = 기본 회비 × 회원 수");
});

test("금액을 다시 적으면 고쳐진다 — 지웠다 다시 넣게 하지 않는다", async () => {
  const env = makeEnv(); const { a, u1 } = await seed(env);
  const j = await login(env);
  await post(env, j, "/t/seocho/admin/dues", { period: PERIOD, user_id: String(u1.id), on: "1", amount: "30000" }, "/t/seocho/admin");
  await D.setDuePaid(env.DB, a.id, u1.id, PERIOD, 25000);
  const rows = await D.listDuesForPeriod(env.DB, a.id, PERIOD);
  assert.equal(rows.length, 1, "줄이 늘면 안 된다");
  assert.equal(rows[0].amount, 25000);
});

test("숫자가 아닌 금액은 거절하고 원래 값을 지킨다", async () => {
  const env = makeEnv(); const { a, u1 } = await seed(env);
  const j = await login(env);
  const r = await post(env, j, "/t/seocho/admin/dues", { period: PERIOD, user_id: String(u1.id), on: "1", amount: "삼만원" }, "/t/seocho/admin");
  assert.match(decodeURIComponent(r.headers.get("location") || ""), /숫자만/);
  assert.equal((await D.listDuesForPeriod(env.DB, a.id, PERIOD)).length, 0, "거절했으면 기록도 안 남아야");

  const r2 = await post(env, j, "/t/seocho/admin/dues/amount", { dues_amount: "3만원" }, "/t/seocho/admin");
  assert.match(decodeURIComponent(r2.headers.get("location") || ""), /숫자만/);
  assert.equal((await D.getAssociationBySlug(env.DB, "seocho")).dues_amount, 0);
});

test("미납 명단을 엑셀로 뽑는다 — 이 명단으로 전화를 돈다", async () => {
  const env = makeEnv(); const { a, u1 } = await seed(env);
  const j = await login(env);
  await D.setDuePaid(env.DB, a.id, u1.id, PERIOD, 30000);

  const res = await get(env, j, `/t/seocho/admin/dues/unpaid.csv?period=${PERIOD}`);
  assert.equal(res.status, 200);
  const bytes = new Uint8Array(await res.clone().arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "엑셀이 한글을 깨뜨리지 않게 BOM");
  const csv = await res.text();
  assert.match(csv, /가게,사장님,연락처/);
  assert.match(csv, /박기석/, "안 낸 사람이 있어야");
  assert.match(csv, /010-3333-4444/, "전화를 걸어야 하므로 번호가 필요하다");
  assert.ok(!/김순자/.test(csv), "낸 사람은 명단에 없어야");
});

test("화면에 걷힌 금액과 미납 인원이 보인다", async () => {
  const env = makeEnv(); const { a, u1 } = await seed(env);
  const j = await login(env);
  await post(env, j, "/t/seocho/admin/dues/amount", { dues_amount: "30000" }, "/t/seocho/admin");
  await D.setDuePaid(env.DB, a.id, u1.id, D.kstToday().slice(0, 7), 30000);
  const html = await (await get(env, j, "/t/seocho/admin")).text();
  const sec = html.slice(html.indexOf('id="p-dues"'), html.indexOf('id="p-dues"') + 4000);
  assert.match(sec, /30,000원/, "걷힌 금액이 사람이 읽는 꼴로");
  assert.match(sec, /걷힘/);
  assert.match(sec, /2명/, "미납 인원");
  assert.match(sec, /명단 CSV로 받기/);
  assert.match(sec, /기본 월 회비/);
});

test("옛 기록(금액 없이 체크만)은 '냈다'로는 세되 금액에 더하지 않는다", async () => {
  const env = makeEnv(); const { a, u1, u2 } = await seed(env);
  await D.setDuePaid(env.DB, a.id, u1.id, PERIOD, 0);        // 옛 방식
  await D.setDuePaid(env.DB, a.id, u2.id, PERIOD, 30000);
  const sum = await D.duesSummary(env.DB, a.id, PERIOD, 30000);
  assert.equal(sum.paid, 2, "옛 기록도 납부로는 세야 한다 — 지우면 안 된다");
  assert.equal(sum.collected, 30000, "금액을 안 적은 것을 지어내지 않는다");
  const j = await login(env);
  const html = await (await get(env, j, `/t/seocho/admin?due_period=${PERIOD}`)).text();
  assert.match(html, /금액 없음/, "화면에도 '모른다'고 적어야");
});

test("남의 상인회 미납 명단은 못 받는다", async () => {
  const env = makeEnv(); await seed(env);
  const other = await D.createAssociation(env.DB, { slug: "other", name: "다른상인회" });
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "o@x.kr", passwordHash: pw.hash, salt: pw.salt, name: "남의사장", role: "MERCHANT", associationId: other.id, phone: "01099998888" });
  const j = await login(env);
  const csv = await (await get(env, j, `/t/seocho/admin/dues/unpaid.csv?period=${PERIOD}`)).text();
  assert.ok(!/남의사장/.test(csv), "남의 상인회 회원이 섞이면 안 된다");
});

test("점주는 회비 장부를 못 건드린다", async () => {
  const env = makeEnv(); const { a, u1 } = await seed(env);
  const j = jar(); await post(env, j, "/login", { login: "m1@x.kr", password: "pass1234" });
  const r = await post(env, j, "/t/seocho/admin/dues", { period: PERIOD, user_id: String(u1.id), on: "1", amount: "1" }, "/t/seocho/");
  assert.equal(r.status, 403);
  assert.equal((await D.listDuesForPeriod(env.DB, a.id, PERIOD)).length, 0);
  assert.equal((await get(env, j, "/t/seocho/admin/dues/unpaid.csv")).status, 403);
});
