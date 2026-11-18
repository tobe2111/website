// 월 구독 정기결제 (토스페이먼츠 자동결제).
//
// 돈이 걸린 곳에서 가장 나쁜 실패 둘:
//   ① 두 번 빠진다 — 정기 작업이 두 번 돌거나, 응답이 끊겨 다시 요청했을 때.
//   ② 안 빠졌는데 빠졌다고 말한다 — 사장님은 낸 줄 알고, 운영사는 받은 줄 안다.
// 여기서는 토스로 나갈 요청을 통째로 붙잡아 그 둘을 확인한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import * as B from "../src/billing.js";
import { runMonthlyBilling } from "../src/scheduled.js";
import { hashPassword } from "../src/crypto.js";

const BASE = "http://localhost";
const KEYS = { TOSS_CLIENT_KEY: "test_ck_abcdefgh12345678", TOSS_SECRET_KEY: "test_sk_abcdefgh12345678" };
const DAY = 86400000;

const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, p) { const r = await worker.fetch(new Request(BASE + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || "/login")).text()) || [])[1];
  const r = await worker.fetch(new Request(BASE + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
async function login(env, email, pass, at = "/login") {
  const j = jar();
  await post(env, j, at, { email, password: pass }, at);
  return j;
}

// 토스로 나가는 요청을 붙잡는다. charge 의 답은 테스트마다 바꿔 끼운다.
function intercept({ charge = () => ({ status: 200, body: { status: "DONE", paymentKey: "pk_1", approvedAt: "2026-11-18T09:00:00+09:00", receipt: { url: "https://dashboard.tosspayments.com/receipt/x" } } }) } = {}) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.startsWith("https://api.tosspayments.com/")) return new Response("ok");
    const body = JSON.parse(init.body || "{}");
    const h = new Headers(init.headers);
    calls.push({ url: u, body, auth: h.get("authorization"), idem: h.get("idempotency-key") || "" });
    if (u.endsWith("/v1/billing/authorizations/issue")) {
      return Response.json({ billingKey: "bk_secret_123", customerKey: body.customerKey, cardCompany: "신한", card: { number: "43301234****123*" } });
    }
    const r = charge(body, calls);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };
  return { calls, charges: () => calls.filter((c) => !c.url.endsWith("/issue")), restore: () => { globalThis.fetch = real; } };
}

async function seed(extra = {}) {
  const env = makeEnv({ ...KEYS, ...extra });
  const a = await D.createAssociation(env.DB, { slug: "brand", name: "맛있는치킨", kind: "franchise" });
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "boss@brand.kr", passwordHash: pw.hash, salt: pw.salt, name: "대표", role: "ADMIN", associationId: a.id });
  await D.createUser(env.DB, { email: "op@platform.kr", passwordHash: pw.hash, salt: pw.salt, name: "운영자", role: "SUPERADMIN", associationId: null });
  return { env, a };
}

// 운영사가 금액을 정하고 → 사장님이 카드를 등록해 첫 결제까지
async function startedSub({ monthly = 55000, setup = 330000, extra = {} } = {}) {
  const { env, a } = await seed(extra);
  const op = await login(env, "op@platform.kr", "pass1234");
  const r = await post(env, op, `/super/association/${a.id}/billing`, { plan: "pro", monthly: String(monthly), setup: String(setup) }, "/super");
  assert.equal(r.status, 303);
  const sub = await B.getSubscription(env.DB, a.id);
  const boss = await login(env, "boss@brand.kr", "pass1234", "/t/brand/login");
  return { env, a, sub, boss, op };
}

test("다음 결제일 — 31일 고객은 짧은 달엔 말일에, 해를 넘겨도 날짜가 맞는다", () => {
  assert.equal(B.nextMonthDate("2026-01-31", 31), "2026-02-28");
  assert.equal(B.nextMonthDate("2028-01-31", 31), "2028-02-29", "윤년");
  assert.equal(B.nextMonthDate("2026-02-28", 31), "2026-03-31", "말일로 밀렸다가 다음 달엔 원래 날짜로 돌아온다");
  assert.equal(B.nextMonthDate("2026-12-15", 15), "2027-01-15");
  assert.equal(B.periodOf("2026-11-18", 18).label, "11/18~12/17");
});

test("빌링키는 잠긴 채로만 저장되고, 열쇠가 다르면 열리지 않는다", async () => {
  const env = { SESSION_SECRET: "s1" };
  const sealed = await B.sealBillingKey(env, "bk_abc");
  assert.ok(sealed.startsWith("v1.") && !sealed.includes("bk_abc"));
  assert.equal(await B.openBillingKey(env, sealed), "bk_abc");
  await assert.rejects(() => B.openBillingKey({ SESSION_SECRET: "other" }, sealed));
  assert.equal(await B.openBillingKey(env, ""), "");
});

test("결제 안내가 없으면 관리 화면에 결제 메뉴가 없다 — 열면 생긴다", async () => {
  const { env, a } = await seed();
  const boss = await login(env, "boss@brand.kr", "pass1234", "/t/brand/login");
  const before = await (await get(env, boss, "/t/brand/admin")).text();
  assert.ok(!before.includes("/admin/billing"), "안내 전에는 메뉴가 없다");
  await B.saveOffer(env.DB, a.id, { plan: "basic", monthly: 55000, setup: 0 });
  const after = await (await get(env, boss, "/t/brand/admin/leads")).text();
  assert.match(after, /admin\/billing"[^>]*>이용료 결제/);
});

test("결제 화면: 금액·결제일·해지 안내가 단추 위에 있고, 토스 창만 그 화면에서 허용한다", async () => {
  const { env, boss } = await startedSub();
  const r = await get(env, boss, "/t/brand/admin/billing");
  const h = await r.text();
  assert.equal(r.status, 200);
  assert.match(h, /지금 <b>385,000원<\/b>이 결제됩니다 — 초기 제작비 330,000원 \+ 첫 달 이용료 55,000원/);
  assert.match(h, /매달 \d+일<\/b>에 <b>55,000원<\/b>/);
  assert.match(h, /언제든 이 화면에서 해지/);
  assert.match(h, /data-need-agree="billAgree"/, "동의 표시 없이는 창이 안 열린다");
  assert.match(h, /테스트 모드/);
  assert.match(h, /js\.tosspayments\.com\/v2\/standard/);
  const csp = r.headers.get("content-security-policy");
  assert.match(csp, /script-src[^;]*tosspayments\.com/);
  assert.equal(r.headers.get("x-allow-toss"), null, "내부 표시는 바깥으로 나가지 않는다");
  // 다른 화면은 토스를 허용하지 않는다
  const other = await get(env, boss, "/t/brand/admin");
  assert.ok(!/tosspayments/.test(other.headers.get("content-security-policy")));
});

test("토스 열쇠가 없으면 단추가 잠기고 결제 스크립트도 안 싣는다", async () => {
  const { env, a } = await seed({ TOSS_CLIENT_KEY: "", TOSS_SECRET_KEY: "" });
  await B.saveOffer(env.DB, a.id, { plan: "basic", monthly: 55000, setup: 0 });
  const boss = await login(env, "boss@brand.kr", "pass1234", "/t/brand/login");
  const r = await get(env, boss, "/t/brand/admin/billing");
  const h = await r.text();
  assert.match(h, /결제 연결을 마무리하는 중/);
  assert.ok(!h.includes("data-toss-billing") && !h.includes("js.tosspayments.com"));
  assert.ok(!/tosspayments/.test(r.headers.get("content-security-policy")));
});

test("카드 등록 → 그 자리에서 제작비+첫 달을 한 번에, 요금제가 열리고 다음 결제일이 잡힌다", async () => {
  const { env, a, sub, boss } = await startedSub();
  const t = intercept();
  try {
    const r = await get(env, boss, `/t/brand/admin/billing/success?customerKey=${sub.customer_key}&authKey=ak_1`);
    assert.equal(r.status, 303);
    assert.match(decodeURIComponent(r.headers.get("location")), /결제가 끝났습니다 — 385,000원/);
    const [charge] = t.charges();
    assert.equal(t.charges().length, 1, "한 번에 뺀다");
    assert.equal(charge.body.amount, 385000);
    assert.equal(charge.url, "https://api.tosspayments.com/v1/billing/bk_secret_123");
    assert.equal(charge.auth, "Basic " + btoa(KEYS.TOSS_SECRET_KEY + ":"));
    assert.equal(charge.idem, charge.body.orderId, "주문번호를 Idempotency-Key 로 함께 보낸다");
    assert.equal(charge.body.customerEmail, "boss@brand.kr");
    const s = await B.getSubscription(env.DB, a.id);
    assert.equal(s.status, "active");
    assert.ok(s.setup_paid_at, "제작비 받음 표시");
    assert.equal(s.card_label, "신한 4330****");
    assert.ok(!s.billing_key.includes("bk_secret_123"), "빌링키는 잠겨 저장된다");
    const today = D.kstToday();
    assert.equal(s.next_charge_on, B.nextMonthDate(today, Number(today.slice(8))));
    assert.equal((await D.getAssociationById(env.DB, a.id)).plan, "pro");
    const pays = await B.listPayments(env.DB, a.id);
    assert.equal(pays.length, 1);
    assert.equal(pays[0].status, "done");
    assert.match(pays[0].receipt_url, /receipt/);
    // 결제 화면에 영수증이 보인다
    const h = await (await get(env, boss, "/t/brand/admin/billing")).text();
    assert.match(h, /이용 중/);
    assert.match(h, /영수증/);
    assert.match(h, /해지 신청/);
  } finally { t.restore(); }
});

test("남의 고객 번호로 돌아오면 카드를 등록하지 않는다(토스에 묻지도 않는다)", async () => {
  const { env, a, boss } = await startedSub();
  const t = intercept();
  try {
    const r = await get(env, boss, `/t/brand/admin/billing/success?customerKey=c_someoneelse&authKey=ak_1`);
    assert.equal(r.status, 303);
    assert.match(decodeURIComponent(r.headers.get("location")), /err=1/);
    assert.equal(t.calls.length, 0);
    assert.equal((await B.getSubscription(env.DB, a.id)).status, "offered");
  } finally { t.restore(); }
});

test("첫 결제가 거절되면 구독이 시작되지 않고, 거절 이유를 사람 말로 보여 준다", async () => {
  const { env, a, sub, boss } = await startedSub();
  const t = intercept({ charge: () => ({ status: 403, body: { code: "REJECT_CARD_PAYMENT", message: "한도초과 혹은 잔액부족" } }) });
  try {
    const r = await get(env, boss, `/t/brand/admin/billing/success?customerKey=${sub.customer_key}&authKey=ak_1`);
    assert.match(decodeURIComponent(r.headers.get("location")), /카드사가 결제를 거절했습니다/);
    const s = await B.getSubscription(env.DB, a.id);
    assert.equal(s.status, "offered");
    assert.equal(s.setup_paid_at, "");
    assert.equal((await D.getAssociationById(env.DB, a.id)).plan, "free", "요금제를 올리지 않는다");
  } finally { t.restore(); }
});

// 첫 결제까지 끝난 상태를 만든다
async function activeSub(opts) {
  const ctx = await startedSub(opts);
  const t = intercept();
  try { await get(ctx.env, ctx.boss, `/t/brand/admin/billing/success?customerKey=${ctx.sub.customer_key}&authKey=ak_1`); }
  finally { t.restore(); }
  return { ...ctx, sub: await B.getSubscription(ctx.env.DB, ctx.a.id) };
}
const nowOn = (dateStr) => Date.parse(dateStr + "T00:30:00Z"); // 그날 한국 09:30

test("매달 결제: 결제일에 월 이용료만 빠지고(제작비는 다시 안 받는다), 같은 날 두 번 돌아도 한 번만", async () => {
  const { env, a, sub } = await activeSub();
  const t = intercept();
  try {
    const due = sub.next_charge_on;
    const r1 = await runMonthlyBilling(env, nowOn(due));
    assert.equal(r1.charged, 1);
    assert.equal(t.charges().length, 1);
    assert.equal(t.charges()[0].body.amount, 55000);
    assert.match(t.charges()[0].body.orderName, /맛있는치킨 홈페이지 이용료/);
    const r2 = await runMonthlyBilling(env, nowOn(due) + 3600000);
    assert.equal(r2.charged, 0, "같은 날 두 번째는 빼지 않는다");
    assert.equal(t.charges().length, 1);
    const s = await B.getSubscription(env.DB, a.id);
    assert.equal(s.next_charge_on, B.nextMonthDate(due, s.billing_day));
    // 결제일 전날에는 아무것도 하지 않는다
    const r3 = await runMonthlyBilling(env, nowOn(B.addDays(s.next_charge_on, -1)));
    assert.equal(r3.charged, 0);
  } finally { t.restore(); }
});

test("응답이 끊기면 실패로 치지 않는다 — 다음 날 같은 주문번호로 다시 묻는다", async () => {
  const { env, a, sub } = await activeSub();
  let n = 0;
  const t = intercept({ charge: () => (++n === 1 ? { status: 502, body: {} } : { status: 200, body: { status: "DONE", paymentKey: "pk_2", receipt: { url: "u" } } }) });
  try {
    const due = sub.next_charge_on;
    const r1 = await runMonthlyBilling(env, nowOn(due));
    assert.equal(r1.unknown, 1);
    let s = await B.getSubscription(env.DB, a.id);
    assert.equal(s.fail_count, 0, "모르는 결과는 실패 횟수에 넣지 않는다");
    assert.equal(s.next_charge_on, due, "결제일도 그대로");
    const r2 = await runMonthlyBilling(env, nowOn(B.addDays(due, 1)));
    assert.equal(r2.charged, 1);
    const [c1, c2] = t.charges();
    assert.equal(c1.body.orderId, c2.body.orderId, "같은 주문번호 — 토스가 이미 뺐으면 새로 빼지 않는다");
    assert.equal(c1.idem, c2.idem);
    s = await B.getSubscription(env.DB, a.id);
    assert.equal(s.status, "active");
    assert.equal((await B.listPayments(env.DB, a.id)).filter((p) => p.status === "done").length, 2, "첫 결제 + 이번 달");
  } finally { t.restore(); }
});

test("세 번 실패하면 자동결제를 멈추고 무료로 내린다 — 사장님 화면에 알림이 남는다", async () => {
  const { env, a, sub } = await activeSub();
  const t = intercept({ charge: () => ({ status: 403, body: { code: "INVALID_STOPPED_CARD", message: "정지된 카드" } }) });
  try {
    const due = sub.next_charge_on;
    await runMonthlyBilling(env, nowOn(due));
    let s = await B.getSubscription(env.DB, a.id);
    assert.equal(s.status, "past_due");
    assert.equal(s.fail_count, 1);
    assert.equal(s.retry_on, B.addDays(due, B.RETRY_DAYS));
    assert.equal((await D.getAssociationById(env.DB, a.id)).plan, "pro", "재시도 기간엔 요금제를 그대로 둔다");
    // 재시도 날이 오기 전엔 다시 안 건드린다
    await runMonthlyBilling(env, nowOn(B.addDays(due, 1)));
    assert.equal(t.charges().length, 1);
    await runMonthlyBilling(env, nowOn(B.addDays(due, 3)));
    await runMonthlyBilling(env, nowOn(B.addDays(due, 6)));
    assert.equal(t.charges().length, 3);
    assert.equal(new Set(t.charges().map((c) => c.body.orderId)).size, 3, "시도마다 새 주문번호");
    s = await B.getSubscription(env.DB, a.id);
    assert.equal(s.status, "ended");
    assert.equal((await D.getAssociationById(env.DB, a.id)).plan, "free");
    assert.equal((await D.getAssociationById(env.DB, a.id)).active, 1, "사이트는 닫지 않는다");
    const notes = await D.listNotifications(env.DB, a.id, 10);
    assert.ok(notes.some((x) => /자동결제가 멈췄습니다/.test(x.message) && /정지된 카드/.test(x.message)));
  } finally { t.restore(); }
});

test("결제가 밀렸을 때 카드를 바꾸면 바로 다시 결제한다", async () => {
  const { env, a, sub, boss } = await activeSub();
  let fail = true;
  const t = intercept({ charge: () => (fail ? { status: 403, body: { code: "REJECT_CARD_PAYMENT", message: "x" } } : { status: 200, body: { status: "DONE", paymentKey: "pk", receipt: { url: "u" } } }) });
  try {
    await runMonthlyBilling(env, nowOn(sub.next_charge_on));
    assert.equal((await B.getSubscription(env.DB, a.id)).status, "past_due");
    const h = await (await get(env, boss, "/t/brand/admin/billing")).text();
    assert.match(h, /결제가 되지 않았습니다/);
    fail = false;
    const r = await get(env, boss, `/t/brand/admin/billing/success?customerKey=${sub.customer_key}&authKey=ak_2`);
    assert.match(decodeURIComponent(r.headers.get("location")), /밀린 이용료 55,000원을 결제했습니다/);
    assert.equal((await B.getSubscription(env.DB, a.id)).status, "active");
  } finally { t.restore(); }
});

test("해지: 다음 결제일까지 쓰고 그날 끝난다(빼지 않는다) · 그 전엔 취소할 수 있다", async () => {
  const { env, a, sub, boss } = await activeSub();
  const t = intercept();
  try {
    const r = await post(env, boss, "/t/brand/admin/billing/cancel", {}, "/t/brand/admin/billing");
    assert.match(decodeURIComponent(r.headers.get("location")), /해지를 예약했습니다/);
    assert.equal((await B.getSubscription(env.DB, a.id)).status, "canceled");
    await post(env, boss, "/t/brand/admin/billing/resume", {}, "/t/brand/admin/billing");
    assert.equal((await B.getSubscription(env.DB, a.id)).status, "active");
    await post(env, boss, "/t/brand/admin/billing/cancel", {}, "/t/brand/admin/billing");
    const r2 = await runMonthlyBilling(env, nowOn(sub.next_charge_on));
    assert.equal(r2.closed, 1);
    assert.equal(t.charges().length, 0, "해지한 고객은 결제일에 빼지 않는다");
    const s = await B.getSubscription(env.DB, a.id);
    assert.equal(s.status, "ended");
    assert.equal(s.billing_key, "", "카드 열쇠도 지운다");
    assert.equal((await D.getAssociationById(env.DB, a.id)).plan, "free");
  } finally { t.restore(); }
});

test("운영사 콘솔: 구독 목록·고객사 상세에 상태가 보이고, 금액 칸이 엉뚱하면 받지 않는다", async () => {
  const { env, a, op } = await activeSub();
  const sup = await (await get(env, op, "/super")).text();
  assert.match(sup, /월 구독 \(카드 자동결제\)/);
  assert.match(sup, /맛있는치킨/);
  assert.match(sup, /테스트 모드/);
  const org = await (await get(env, op, `/super/org/${a.id}`)).text();
  assert.match(org, /id="p-billing"/);
  assert.match(org, /신한 4330/);
  const bad = await post(env, op, `/super/association/${a.id}/billing`, { plan: "pro", monthly: "50", setup: "0", return: `/super/org/${a.id}` }, "/super");
  assert.match(decodeURIComponent(bad.headers.get("location")), /err=1/);
  assert.equal((await B.getSubscription(env.DB, a.id)).monthly_amount, 55000);
  // 이용 중 금액을 바꾸면 '다음 결제일부터' 라고 알려 준다
  const ok = await post(env, op, `/super/association/${a.id}/billing`, { plan: "pro", monthly: "66,000", setup: "330000", return: `/super/org/${a.id}` }, "/super");
  assert.match(decodeURIComponent(ok.headers.get("location")), /다음 결제일\(.+\)부터 새 금액/);
  const s = await B.getSubscription(env.DB, a.id);
  assert.equal(s.monthly_amount, 66000);
  assert.equal(s.status, "active");
});

test("토스 열쇠 입력 칸은 자동결제용 키(ck/sk)만 받는다", async () => {
  const { STORED_KEYS } = await import("../src/keys.js");
  const re = Object.fromEntries(STORED_KEYS.map(([n, , r]) => [n, r]));
  assert.ok(re.TOSS_CLIENT_KEY.test("test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq"));
  assert.ok(re.TOSS_SECRET_KEY.test("live_sk_zXLkKEypNArWmo50nX3lmeaxYG5R"));
  assert.ok(!re.TOSS_CLIENT_KEY.test("test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm"), "결제위젯 키는 자동결제가 안 된다");
  assert.ok(!re.TOSS_SECRET_KEY.test("test_ck_abcdefgh12345678"), "클라이언트 키를 시크릿 칸에 넣으면 거른다");
});
