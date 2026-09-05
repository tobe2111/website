// 미납 회비 독촉.
//
// 미납 명단은 뽑히는데 사람이 하나씩 보내야 했다. 스무 명이면 스무 번이라,
// 총무는 결국 단톡방에 "회비 내세요" 한 줄을 던지고 만다 — 그러면 이미 낸 사람도 같이 읽는다.
// 상인회에서 실제로 감정이 상하는 자리가 거기다.
//
// 이 화면에서 가장 위험한 실패는 "안 나갔는데 나갔다고 말하는 것" 이다.
// 총무는 회원들이 받은 줄 알고 기다리고, 회비는 계속 안 들어온다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import * as N from "../src/notify.js";
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

const ALIGO = { ALIGO_API_KEY: "K", ALIGO_USER_ID: "U", ALIGO_SENDER_KEY: "S", ALIGO_SENDER: "0212345678" };
const PERIOD = D.kstToday().slice(0, 7);

// 알리고로 실제로 나갈 요청을 통째로 붙잡는다.
function intercept() {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("token/create")) return new Response(JSON.stringify({ code: 0, token: "T" }), { headers: { "content-type": "application/json" } });
    if (u.includes("alimtalk/send")) {
      sent.push(Object.fromEntries(init.body.entries()));
      return new Response(JSON.stringify({ code: 0, info: { mid: sent.length } }), { headers: { "content-type": "application/json" } });
    }
    return new Response("ok");
  };
  return { sent, restore: () => { globalThis.fetch = real; } };
}

async function seed(env, { ready = true } = {}) {
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "방배카페골목상인회", kind: "merchant" });
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const paid = await D.createUser(env.DB, { email: "p@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "낸사람", role: "MERCHANT", associationId: a.id, phone: "010-1111-2222" });
  const owe1 = await D.createUser(env.DB, { email: "o1@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "안낸하나", role: "MERCHANT", associationId: a.id, phone: "010-3333-4444" });
  const owe2 = await D.createUser(env.DB, { email: "o2@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "안낸둘", role: "MERCHANT", associationId: a.id });
  await D.setDuePaid(env.DB, a.id, paid.id, PERIOD, 30000);
  await D.setDuesAmount(env.DB, a.id, 30000);
  await D.setDuesAccount(env.DB, a.id, "국민 123456-01-789012 (방배카페골목상인회)");
  if (ready) {
    await D.setSetting(env.DB, N.TEMPLATE_KEYS.dues_remind, "TPL_DUES");
    await env.DB.prepare("UPDATE associations SET notify_auto=1 WHERE id=?").bind(a.id).run();
    await D.addCredit(env.DB, a.id, 10000, { kind: "charge", memo: "시험" });
  }
  return { a, paid, owe1, owe2 };
}
const login = async (env) => { const j = jar(); await post(env, j, "/login", { login: "ad@s.kr", password: "pass1234" }); return j; };

test("미납자에게만 나간다 — 이미 낸 사람에게는 가지 않는다", async () => {
  const env = makeEnv(ALIGO); await seed(env);
  const { sent, restore } = intercept();
  try {
    const j = await login(env);
    await post(env, j, "/t/seocho/admin/dues/remind", { period: PERIOD }, "/t/seocho/admin");
    assert.equal(sent.length, 1, "번호가 있는 미납자 한 명에게만");
    assert.equal(sent[0].receiver_1, "01033334444");
    assert.doesNotMatch(sent[0].message_1, /낸사람/);
  } finally { restore(); }
});

test("문구에 심사받은 원문 그대로 금액과 계좌가 들어간다", async () => {
  const env = makeEnv(ALIGO); await seed(env);
  const { sent, restore } = intercept();
  try {
    const j = await login(env);
    await post(env, j, "/t/seocho/admin/dues/remind", { period: PERIOD }, "/t/seocho/admin");
    const m = sent[0].message_1;
    assert.equal(sent[0].tpl_code, "TPL_DUES");
    assert.equal(m, N.renderTemplate("dues_remind", {
      상호: "방배카페골목상인회", 이름: "안낸하나", 납부월: PERIOD,
      금액: "30,000원", 계좌: "국민 123456-01-789012 (방배카페골목상인회)",
    }), "심사 문구와 한 글자도 달라지면 카카오가 반려한다");
    assert.match(m, /30,000원/);
    assert.match(m, /123456-01-789012/);
  } finally { restore(); }
});

test("계좌를 안 적어 뒀으면 '총무에게 문의' 로 나간다 (빈칸을 보내지 않는다)", async () => {
  const env = makeEnv(ALIGO); const { a } = await seed(env);
  await D.setDuesAccount(env.DB, a.id, "");
  const { sent, restore } = intercept();
  try {
    const j = await login(env);
    await post(env, j, "/t/seocho/admin/dues/remind", { period: PERIOD }, "/t/seocho/admin");
    assert.match(sent[0].message_1, /입금 계좌: 총무에게 문의/);
  } finally { restore(); }
});

test("보낼 길이 없으면 '보냈습니다' 라고 하지 않는다", async () => {
  const env = makeEnv();                       // 알리고 키 없음 · 이메일 없음
  await seed(env, { ready: false });
  const { sent, restore } = intercept();
  try {
    const j = await login(env);
    const r = await post(env, j, "/t/seocho/admin/dues/remind", { period: PERIOD }, "/t/seocho/admin");
    assert.equal(sent.length, 0);
    const loc = r.headers.get("location") || "";
    assert.match(loc, /err=1/, "실패로 되돌아와야 한다");
    assert.match(decodeURIComponent(loc), /한 건도 보내지 못했습니다/);
  } finally { restore(); }
});

test("템플릿 코드가 없으면 발송을 시도하지 않는다 (카카오에 아직 안 올린 문구)", async () => {
  const env = makeEnv(ALIGO); const { a } = await seed(env);
  await D.setSetting(env.DB, N.TEMPLATE_KEYS.dues_remind, "");
  await env.DB.prepare("UPDATE associations SET notify_auto=1 WHERE id=?").bind(a.id).run();
  const { sent, restore } = intercept();
  try {
    const j = await login(env);
    await post(env, j, "/t/seocho/admin/dues/remind", { period: PERIOD }, "/t/seocho/admin");
    assert.equal(sent.length, 0, "코드 없이 보내면 알리고가 거절한다 — 시도 자체를 안 한다");
  } finally { restore(); }
});

test("미납자가 없으면 아무것도 보내지 않고 그렇게 알린다", async () => {
  const env = makeEnv(ALIGO); const { a, owe1, owe2 } = await seed(env);
  await D.setDuePaid(env.DB, a.id, owe1.id, PERIOD, 30000);
  await D.setDuePaid(env.DB, a.id, owe2.id, PERIOD, 30000);
  const { sent, restore } = intercept();
  try {
    const j = await login(env);
    const r = await post(env, j, "/t/seocho/admin/dues/remind", { period: PERIOD }, "/t/seocho/admin");
    assert.equal(sent.length, 0);
    assert.match(decodeURIComponent(r.headers.get("location") || ""), /미납자가 없습니다/);
  } finally { restore(); }
});

test("회비 장부에 보내기 단추와 '막고 있는 것' 이 함께 뜬다", async () => {
  const env = makeEnv(); await seed(env, { ready: false });
  const j = await login(env);
  const html = await (await get(env, j, "/t/seocho/admin")).text();
  assert.match(html, /안내 보내기/);
  assert.match(html, /막고 있는 것/, "왜 못 보내는지가 화면에 있어야 한다");
  assert.match(html, /disabled/, "못 보내는데 눌리면 안 된다");
});

test("보낼 수 있는 상태면 단추가 살아 있고, 닿지 않는 사람 수를 미리 알려 준다", async () => {
  const env = makeEnv(ALIGO); await seed(env);
  const j = await login(env);
  const html = await (await get(env, j, "/t/seocho/admin")).text();
  assert.match(html, /미납 2명에게 안내 보내기/);
  assert.doesNotMatch(html, /막고 있는 것/, "보낼 수 있으면 막혔다고 하지 않는다");
  // 안낸둘은 번호가 없고 이메일 발송도 연결돼 있지 않다 — 그 사실을 미리 말해야 한다
  assert.match(html, /1명은 연락처가 없어 닿지 않습니다/);
});

test("회원은 독촉을 보낼 수 없다", async () => {
  const env = makeEnv(ALIGO); const { a } = await seed(env);
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "m@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회원", role: "MERCHANT", associationId: a.id });
  const { sent, restore } = intercept();
  try {
    const j = jar();
    await post(env, j, "/login", { login: "m@s.kr", password: "pass1234" });
    await post(env, j, "/t/seocho/admin/dues/remind", { period: PERIOD }, "/t/seocho/admin");
    assert.equal(sent.length, 0);
  } finally { restore(); }
});

test("회비 안내 문구는 목적이 제목에 고정값으로 드러난다 (카카오 반려 사유 반영)", () => {
  const t = N.TEMPLATES.dues_remind;
  assert.ok(t, "dues_remind 템플릿이 있어야");
  assert.equal(t.key, "tpl_dues_remind");
  assert.ok(t.body.startsWith("회비 납부 안내"), "말머리가 변수 뒤에 있으면 심사자가 제목으로 안 읽는다");
  assert.ok(t.pending, "아직 카카오에 올리지 않았다는 표시가 있어야 한다");
  for (const v of ["상호", "이름", "납부월", "금액", "계좌"]) assert.ok(t.body.includes(`#{${v}}`), `${v} 변수`);
});
