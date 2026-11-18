// 월 구독 정기결제 — 토스페이먼츠 자동결제(빌링).
//
// ── 무엇을 하는가
//   홈페이지를 만들어 준 업체에서 **초기 제작비(한 번)** 와 **월 이용료(매달)** 를 카드로 받는다.
//   사장님은 관리 화면에서 카드를 한 번 등록한다. 그러면 토스가 카드번호 대신 '빌링키' 를 준다 —
//   그 열쇠로 다음 달에도 같은 카드에서 결제할 수 있다. 카드번호는 우리 서버에 한 번도 오지 않는다.
//
// ── 꼭 알아둘 것: 토스는 매달 알아서 빼 가지 않는다
//   "매달 ○일에 결제" 는 **우리 서버가** 그날 토스에 결제를 요청해야 일어난다.
//   그래서 매일 아침 정기 작업(scheduled.js → runDaily)이 이 파일의 runBilling 을 부른다.
//   정기 작업이 멈추면 결제도 멈춘다 — /super 의 '정기 작업' 표시가 그걸 보여 준다.
//
// ── 같은 달을 두 번 빼지 않는 장치 (돈이 걸린 곳이라 둘 다 둔다)
//   1) 결제마다 주문번호를 '조직·결제일·몇 번째 시도' 로 정해서 만든다. 같은 날 정기 작업이 두 번
//      돌아도 주문번호가 같다. 결제 기록 표의 주문번호 칸은 겹칠 수 없게(UNIQUE) 걸어 두었다.
//   2) 토스에 같은 주문번호를 Idempotency-Key 로 함께 보낸다. 응답이 중간에 끊겨 우리가 결과를
//      모르는 채로 다시 요청해도, 토스는 새로 빼지 않고 **처음 결과를 돌려준다**(15일간 유효).
//   그래서 "응답이 안 왔다" 는 실패로 치지 않는다 — 시도 횟수를 올리지 않고 다음 날 같은 번호로 다시 묻는다.
//
// ── 실패하면
//   카드 한도·정지 등으로 실패하면 3일 뒤 다시 시도하고, 모두 3번 실패하면 자동결제를 멈추고
//   요금제를 무료로 내린다. **사이트를 닫지는 않는다** — 닫을지는 운영사가 사람 판단으로 정한다.
//
// 외부 의존성 없음: 토스 API 는 fetch 한 번이고, 브라우저 쪽만 토스 SDK 스크립트를 받는다.
import { randomHex, b64uFromBytes, bytesFromB64u } from "./crypto.js";
import { kstToday } from "./db.js";
import { PLANS } from "./plans.js";

const API = "https://api.tosspayments.com";
const TIMEOUT_MS = 10000;
export const MAX_TRIES = 3;      // 같은 달 결제를 몇 번까지 시도할지
export const RETRY_DAYS = 3;     // 실패 뒤 며칠 있다가 다시 시도할지
export const TOSS_SDK = "https://js.tosspayments.com/v2/standard";

// ---------- 열쇠 ----------
// 자동결제에는 'API 개별 연동 키'(test_ck_/live_ck_ · test_sk_/live_sk_)가 필요하다.
// 결제위젯 키(gck/gsk)로는 카드 등록창이 안 뜬다 — 그래서 keys.js 의 입력 칸이 ck/sk 만 받는다.
export function tossKeys(env) {
  const ck = String((env && env.TOSS_CLIENT_KEY) || "").trim();
  const sk = String((env && env.TOSS_SECRET_KEY) || "").trim();
  return { ck, sk, ready: !!(ck && sk), test: ck.startsWith("test_") || sk.startsWith("test_") };
}

// ---------- 빌링키 잠금 ----------
// 빌링키가 새면 그 열쇠로 남의 카드에서 결제를 일으킬 수 있다(우리 시크릿 키가 함께 새야 하지만).
// DB 사본·백업이 새어도 그대로 쓰이지 않게 잠가서 저장한다.
// 잠금 열쇠는 BILLING_SECRET(있으면) → SESSION_SECRET 순. 세션 시크릿을 바꾸면 저장된 빌링키를
// 못 열게 되어 고객이 카드를 다시 등록해야 한다 — 바꿀 계획이 있으면 BILLING_SECRET 을 따로 두라.
async function lockKey(env) {
  const secret = String(env.BILLING_SECRET || env.SESSION_SECRET || "");
  if (!secret) throw new Error("잠금 열쇠가 없습니다(SESSION_SECRET).");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("billing-key|" + secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function sealBillingKey(env, billingKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await lockKey(env), new TextEncoder().encode(billingKey)));
  const out = new Uint8Array(12 + ct.length); out.set(iv, 0); out.set(ct, 12);
  return "v1." + b64uFromBytes(out);
}
export async function openBillingKey(env, sealed) {
  const s = String(sealed || "");
  if (!s.startsWith("v1.")) return "";
  const buf = bytesFromB64u(s.slice(3));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, await lockKey(env), buf.slice(12));
  return new TextDecoder().decode(pt);
}

// ---------- 토스 API ----------
// 돌려주는 모양: { ok:true, data } | { ok:false, code, message, unknown }
//   unknown=true 는 "결과를 모른다" 다(시간 초과·망 오류·토스 5xx). 돈이 빠졌을 수도 있으므로
//   실패로 치면 안 된다 — 같은 주문번호로 다시 물으면 토스가 처음 결과를 알려 준다.
async function toss(env, path, body, idem = "") {
  const { sk } = tossKeys(env);
  if (!sk) return { ok: false, code: "NO_KEY", message: "토스 시크릿 키가 등록되지 않았습니다." };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(API + path, {
      method: "POST", signal: ac.signal,
      headers: {
        Authorization: "Basic " + btoa(sk + ":"),
        "Content-Type": "application/json",
        ...(idem ? { "Idempotency-Key": idem } : {}),
      },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    if (r.ok && data) return { ok: true, data };
    if (r.status >= 500 || !data) return { ok: false, unknown: true, code: `HTTP_${r.status}`, message: "토스 서버가 응답하지 않았습니다." };
    return { ok: false, code: String(data.code || `HTTP_${r.status}`), message: String(data.message || "결제가 거절되었습니다.").slice(0, 200) };
  } catch (e) {
    return { ok: false, unknown: true, code: "NETWORK", message: "토스에 닿지 못했습니다(시간 초과)." };
  } finally { clearTimeout(timer); }
}

// 카드 등록창에서 돌아온 authKey 를 빌링키로 바꾼다.
export async function issueBillingKey(env, { authKey, customerKey }) {
  const r = await toss(env, "/v1/billing/authorizations/issue", { authKey, customerKey });
  if (!r.ok) return r;
  const d = r.data || {};
  const card = d.card || {};
  if (!d.billingKey) return { ok: false, code: "NO_BILLING_KEY", message: "토스가 빌링키를 돌려주지 않았습니다." };
  return { ok: true, billingKey: String(d.billingKey), cardLabel: cardLabel(d.cardCompany, card.number || d.cardNumber) };
}

// 등록된 카드에서 결제 한 번.
export async function chargeBilling(env, { billingKey, customerKey, amount, orderId, orderName, customerEmail = "", customerName = "" }) {
  const body = { customerKey, amount, orderId, orderName: String(orderName).slice(0, 100) };
  if (customerEmail) body.customerEmail = customerEmail;
  if (customerName) body.customerName = String(customerName).slice(0, 100);
  const r = await toss(env, `/v1/billing/${encodeURIComponent(billingKey)}`, body, orderId);
  if (!r.ok) return r;
  const d = r.data || {};
  if (d.status !== "DONE") return { ok: false, code: String(d.status || "NOT_DONE"), message: "결제가 완료 상태가 아닙니다." };
  return { ok: true, paymentKey: String(d.paymentKey || ""), receiptUrl: String((d.receipt && d.receipt.url) || ""), approvedAt: String(d.approvedAt || "") };
}

// "신한 4330****" — 화면에 보여 줄 만큼만. 토스가 준 번호도 이미 가려져 있다.
export function cardLabel(company, number) {
  const n = String(number || "").replace(/[^0-9*]/g, "").slice(0, 8);
  return [String(company || "").trim(), n ? `${n.slice(0, 4)}****` : ""].filter(Boolean).join(" ") || "등록된 카드";
}

// 토스 오류 코드 → 사장님이 알아들을 말. 모르는 코드는 토스가 준 문장을 그대로 쓴다.
const FRIENDLY = {
  REJECT_CARD_PAYMENT: "카드사가 결제를 거절했습니다. 한도·정지 여부를 카드사에 확인해 주세요.",
  EXCEED_MAX_DAILY_PAYMENT_COUNT: "오늘 이 카드의 결제 횟수 한도를 넘었습니다.",
  EXCEED_MAX_PAYMENT_AMOUNT: "카드 한도를 넘었습니다.",
  INVALID_CARD_EXPIRATION: "카드 유효기간이 지났습니다. 새 카드를 등록해 주세요.",
  INVALID_STOPPED_CARD: "정지된 카드입니다. 다른 카드를 등록해 주세요.",
  NOT_SUPPORTED_CARD_TYPE: "자동결제를 지원하지 않는 카드입니다. 다른 카드를 등록해 주세요.",
  PAY_PROCESS_CANCELED: "카드 등록을 취소하셨습니다.",
  USER_CANCEL: "카드 등록을 취소하셨습니다.",
  NO_KEY: "결제 준비가 아직 끝나지 않았습니다(운영사 설정 중).",
};
export const friendlyError = (code, message) => FRIENDLY[code] || message || "결제에 실패했습니다.";

// ---------- 날짜 (모두 한국 날짜 'YYYY-MM-DD') ----------
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
// 다음 결제일 — 결제일이 31일인 고객은 30일까지인 달엔 30일에, 2월엔 말일에 낸다.
export function nextMonthDate(dateStr, billingDay) {
  const [y, m] = String(dateStr).split("-").map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const d = Math.min(Math.max(1, billingDay || 1), daysIn(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export function addDays(dateStr, n) {
  const t = Date.parse(dateStr + "T00:00:00Z") + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
// 이 결제가 덮는 기간 — 결제일부터 다음 결제일 전날까지. 영수증 이름에 들어간다.
export function periodOf(start, billingDay) {
  const end = addDays(nextMonthDate(start, billingDay), -1);
  return { start, end, label: `${md(start)}~${md(end)}` };
}

// ---------- DB ----------
const first = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();

export const SUB_STATUS = {
  offered: ["결제 안내 중", "badge-wait"],   // 운영사가 금액을 정했고, 고객이 아직 카드를 안 넣었다
  active: ["이용 중", "badge-ok"],
  past_due: ["결제 실패", "badge-no"],       // 재시도 중 — 요금제는 아직 그대로
  canceled: ["해지 예약", "badge-muted"],    // 이번 달 끝까지는 쓰고, 다음 결제일부터 안 뺀다
  ended: ["종료", "badge-muted"],
};

export const getSubscription = (db, aid) => first(db, "SELECT * FROM subscriptions WHERE association_id=?", aid);
export const getSubscriptionByCustomer = (db, ck) => first(db, "SELECT * FROM subscriptions WHERE customer_key=?", ck);
export const listSubscriptions = (db) => all(db,
  "SELECT s.*, a.name AS assoc_name, a.slug AS assoc_slug FROM subscriptions s JOIN associations a ON a.id=s.association_id ORDER BY CASE s.status WHEN 'past_due' THEN 0 WHEN 'offered' THEN 1 WHEN 'active' THEN 2 ELSE 3 END, s.next_charge_on");
export const listPayments = (db, aid, limit = 24) => all(db,
  "SELECT * FROM billing_payments WHERE association_id=? ORDER BY id DESC LIMIT ?", aid, limit);
export const revenueSince = async (db, since) => (await first(db,
  "SELECT COALESCE(SUM(amount),0) AS sum, COUNT(*) AS n FROM billing_payments WHERE status='done' AND created_at >= ?", since)) || { sum: 0, n: 0 };

// 운영사가 금액을 정한다(=결제 안내를 연다). 이미 쓰는 중이면 다음 결제부터 새 금액이 적용된다.
export async function saveOffer(db, aid, { plan, monthly, setup }) {
  const cur = await getSubscription(db, aid);
  if (!cur) {
    await run(db, `INSERT INTO subscriptions (association_id, plan, monthly_amount, setup_amount, status, customer_key)
      VALUES (?,?,?,?, 'offered', ?)`, aid, plan, monthly, setup, "c_" + randomHex(16));
  } else {
    // 이미 받은 제작비는 다시 받지 않는다 — 금액 칸을 고쳐도 setup_paid_at 이 있으면 무시된다.
    // 끝난 구독에 새 안내를 열면 다시 '결제 안내 중' 으로 돌아간다.
    await run(db, `UPDATE subscriptions SET plan=?, monthly_amount=?, setup_amount=?,
      status=CASE WHEN status='ended' THEN 'offered' ELSE status END, updated_at=datetime('now') WHERE association_id=?`,
      plan, monthly, setup, aid);
  }
  return getSubscription(db, aid);
}

export const setCard = (db, aid, sealed, label) => run(db,
  "UPDATE subscriptions SET billing_key=?, card_label=?, updated_at=datetime('now') WHERE association_id=?", sealed, label, aid);

export const cancelSubscription = (db, aid) => run(db,
  "UPDATE subscriptions SET status='canceled', canceled_at=datetime('now'), updated_at=datetime('now') WHERE association_id=? AND status IN ('active','past_due')", aid);
export const resumeSubscription = (db, aid) => run(db,
  "UPDATE subscriptions SET status='active', canceled_at='', updated_at=datetime('now') WHERE association_id=? AND status='canceled'", aid);
// 운영사가 즉시 끝낸다(계약 종료 등). 카드 열쇠도 지운다 — 다시 시작하려면 고객이 새로 등록한다.
export async function endSubscription(db, aid) {
  await run(db, "UPDATE subscriptions SET status='ended', billing_key='', next_charge_on='', retry_on='', updated_at=datetime('now') WHERE association_id=?", aid);
  await run(db, "UPDATE associations SET plan='free' WHERE id=?", aid);
}

// 결제 한 줄을 '먼저' 적는다 — 이게 같은 달 두 번 결제를 막는 자물쇠다.
// 이미 같은 주문번호가 있으면 그 줄을 돌려준다(이미 끝났는지 보고 판단하라고).
async function claimPayment(db, { aid, orderId, kind, amount, period, orderName }) {
  await run(db, `INSERT OR IGNORE INTO billing_payments (association_id, order_id, kind, amount, period, order_name)
    VALUES (?,?,?,?,?,?)`, aid, orderId, kind, amount, period, orderName);
  return first(db, "SELECT * FROM billing_payments WHERE order_id=?", orderId);
}
const finishPayment = (db, orderId, r) => run(db,
  `UPDATE billing_payments SET status=?, payment_key=?, receipt_url=?, error=?, approved_at=? WHERE order_id=?`,
  r.ok ? "done" : r.unknown ? "unknown" : "failed", r.paymentKey || "", r.receiptUrl || "",
  r.ok ? "" : `${r.code || ""} ${r.message || ""}`.trim().slice(0, 300), r.approvedAt || "", orderId);

// 결제 한 번(첫 결제·매달 결제 공통). 성공이면 { ok:true, payment }.
async function chargeOnce(env, sub, { orderId, kind, amount, orderName, period, payer }) {
  const db = env.DB;
  const row = await claimPayment(db, { aid: sub.association_id, orderId, kind, amount, period, orderName });
  if (row && row.status === "done") return { ok: true, already: true, payment: row };
  if (row && row.status === "failed") return { ok: false, code: "ALREADY_FAILED", message: row.error || "이미 실패한 결제입니다." };
  const billingKey = await openBillingKey(env, sub.billing_key).catch(() => "");
  if (!billingKey) {
    const r = { ok: false, code: "NO_CARD", message: "등록된 카드를 열 수 없습니다. 카드를 다시 등록해 주세요." };
    await finishPayment(db, orderId, r);
    return r;
  }
  const r = await chargeBilling(env, { billingKey, customerKey: sub.customer_key, amount, orderId, orderName,
    customerEmail: (payer && payer.email) || "", customerName: (payer && payer.name) || "" });
  await finishPayment(db, orderId, r);
  return r.ok ? { ...r, payment: await first(db, "SELECT * FROM billing_payments WHERE order_id=?", orderId) } : r;
}

// 결제 영수증에 들어갈 이름. 카드 명세서에도 이 이름이 찍힌다.
const NAME = (assoc) => `${String(assoc.name || "").slice(0, 30)} 홈페이지`;

// ---------- 첫 결제 (카드를 등록한 바로 그 자리에서) ----------
// 제작비가 남아 있으면 제작비 + 첫 달을 **한 번에** 뺀다. 둘로 나누면 하나만 성공하는 경우가 생기고,
// 그러면 "제작비는 냈는데 사이트가 안 열렸다" 같은 반쪽 상태를 사람이 풀어야 한다.
export async function startSubscription(env, assoc, payer, now = Date.now()) {
  const db = env.DB;
  const sub = await getSubscription(db, assoc.id);
  if (!sub) return { ok: false, message: "결제 안내가 없습니다." };
  const today = kstToday(now);
  const day = Number(today.slice(8, 10));
  const setup = sub.setup_paid_at ? 0 : Math.max(0, sub.setup_amount || 0);
  const monthly = Math.max(0, sub.monthly_amount || 0);
  const amount = setup + monthly;
  const p = periodOf(today, day);
  if (amount > 0) {
    const orderName = setup ? `${NAME(assoc)} 제작비+이용료(${p.label})` : `${NAME(assoc)} 이용료(${p.label})`;
    // 같은 날 다시 눌러도(새로고침 등) 같은 번호 → 두 번 빠지지 않는다
    const orderId = `s${assoc.id}-${today.replace(/-/g, "")}-${(sub.fail_count || 0) + 1}`;
    const r = await chargeOnce(env, sub, { orderId, kind: setup ? "setup+monthly" : "monthly", amount, orderName, period: `${p.start}~${p.end}`, payer });
    if (!r.ok) {
      // 첫 결제가 안 됐으면 구독을 시작하지 않는다. 시도 횟수만 올려 다음 시도가 새 번호를 쓰게 한다
      // (결과를 모르는 경우는 올리지 않는다 — 같은 번호로 다시 물어야 두 번 안 빠진다).
      if (!r.unknown) await run(db, "UPDATE subscriptions SET fail_count=fail_count+1, last_error=?, updated_at=datetime('now') WHERE association_id=?",
        friendlyError(r.code, r.message), assoc.id);
      return { ok: false, unknown: !!r.unknown, message: friendlyError(r.code, r.message) };
    }
  }
  await run(db, `UPDATE subscriptions SET status='active', billing_day=?, next_charge_on=?, retry_on='', fail_count=0, last_error='',
    setup_paid_at=CASE WHEN ?>0 AND setup_paid_at='' THEN datetime('now') ELSE setup_paid_at END,
    started_at=CASE WHEN started_at='' THEN datetime('now') ELSE started_at END, canceled_at='', updated_at=datetime('now')
    WHERE association_id=?`, day, nextMonthDate(today, day), setup, assoc.id);
  if (PLANS[sub.plan]) await run(db, "UPDATE associations SET plan=? WHERE id=?", sub.plan, assoc.id);
  return { ok: true, amount, setup, monthly };
}

// 결제가 밀린 고객이 카드를 바꾸면 바로 한 번 더 시도한다 — 기다리게 할 이유가 없다.
export async function retryNow(env, assoc, payer, now = Date.now()) {
  const sub = await getSubscription(env.DB, assoc.id);
  if (!sub || sub.status !== "past_due") return { ok: false, skipped: true };
  return chargeDue(env, { ...sub, assoc_name: assoc.name }, payer, now);
}

// ---------- 매달 결제 (정기 작업) ----------
async function chargeDue(env, sub, payer, now) {
  const db = env.DB;
  const today = kstToday(now);
  const due = sub.next_charge_on;
  const p = periodOf(due, sub.billing_day);
  const tries = sub.fail_count || 0;
  const orderId = `m${sub.association_id}-${due.replace(/-/g, "")}-${tries + 1}`;
  const assoc = { id: sub.association_id, name: sub.assoc_name || "" };
  const r = await chargeOnce(env, sub, { orderId, kind: "monthly", amount: sub.monthly_amount,
    orderName: `${NAME(assoc)} 이용료(${p.label})`, period: `${p.start}~${p.end}`, payer });
  if (r.ok) {
    await run(db, `UPDATE subscriptions SET status='active', next_charge_on=?, retry_on='', fail_count=0, last_error='', updated_at=datetime('now')
      WHERE association_id=?`, nextMonthDate(due, sub.billing_day), sub.association_id);
    if (PLANS[sub.plan]) await run(db, "UPDATE associations SET plan=? WHERE id=?", sub.plan, sub.association_id);
    return { ok: true, amount: sub.monthly_amount };
  }
  if (r.unknown) return { ok: false, unknown: true }; // 내일 같은 번호로 다시 묻는다
  const n = tries + 1;
  const why = friendlyError(r.code, r.message);
  if (n >= MAX_TRIES) {
    await run(db, `UPDATE subscriptions SET status='ended', fail_count=?, last_error=?, retry_on='', updated_at=datetime('now') WHERE association_id=?`,
      n, why, sub.association_id);
    await run(db, "UPDATE associations SET plan='free' WHERE id=?", sub.association_id);
    return { ok: false, ended: true, message: why };
  }
  await run(db, `UPDATE subscriptions SET status='past_due', fail_count=?, last_error=?, retry_on=?, updated_at=datetime('now') WHERE association_id=?`,
    n, why, addDays(today, RETRY_DAYS), sub.association_id);
  return { ok: false, message: why, tries: n };
}

// 정기 작업 진입점. notify(aid, message, link) 는 그 조직 관리 화면의 알림으로 남긴다.
export async function runBilling(env, { now = Date.now(), notify = async () => {}, payerOf = async () => null } = {}) {
  const db = env.DB;
  const today = kstToday(now);
  const out = { charged: 0, amount: 0, failed: 0, ended: 0, unknown: 0, closed: 0, skipped: !tossKeys(env).ready };
  // 해지 예약 → 다음 결제일이 오면 끝낸다(그날까지는 낸 만큼 쓴다)
  for (const s of await all(db, "SELECT * FROM subscriptions WHERE status='canceled' AND next_charge_on<>'' AND next_charge_on<=?", today)) {
    await run(db, "UPDATE subscriptions SET status='ended', billing_key='', next_charge_on='', updated_at=datetime('now') WHERE association_id=?", s.association_id);
    await run(db, "UPDATE associations SET plan='free' WHERE id=?", s.association_id);
    await notify(s.association_id, "해지하신 홈페이지 이용이 끝났습니다. 이번 달부터 결제되지 않습니다.", "billing").catch(() => {});
    out.closed++;
  }
  if (out.skipped) return out; // 열쇠가 없으면 결제는 건너뛴다(해지 정리는 위에서 했다)
  const due = await all(db, `SELECT s.*, a.name AS assoc_name FROM subscriptions s JOIN associations a ON a.id=s.association_id
    WHERE s.billing_key<>'' AND s.monthly_amount>0 AND (
      (s.status='active' AND s.next_charge_on<>'' AND s.next_charge_on<=?) OR
      (s.status='past_due' AND s.retry_on<>'' AND s.retry_on<=?))`, today, today);
  for (const s of due) {
    const r = await chargeDue(env, s, await payerOf(s.association_id).catch(() => null), now).catch((e) => ({ ok: false, unknown: true, message: String(e) }));
    if (r.ok) { out.charged++; out.amount += r.amount || 0; continue; }
    if (r.unknown) { out.unknown++; continue; }
    if (r.ended) {
      out.ended++;
      await notify(s.association_id, `월 이용료가 ${MAX_TRIES}번 결제되지 않아 자동결제가 멈췄습니다 — ${r.message} 카드를 등록하시면 다시 시작됩니다.`, "billing").catch(() => {});
    } else {
      out.failed++;
      await notify(s.association_id, `월 이용료 결제에 실패했습니다 — ${r.message} ${RETRY_DAYS}일 뒤 다시 시도합니다. 그 전에 카드를 바꾸시면 바로 다시 결제합니다.`, "billing").catch(() => {});
    }
  }
  return out;
}
