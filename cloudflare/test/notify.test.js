// 알림톡 선불 크레딧 · 발송 게이트 검증 (돈 계산이라 경계값까지 확인)
// 실행: node --experimental-sqlite --test cloudflare/test/*.test.js
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import * as N from "../src/notify.js";

let env, db, assoc;

before(async () => {
  env = makeEnv();
  db = env.DB;
  assoc = await D.createAssociation(db, { slug: "seocho", name: "서초구 상인회" });
});

test("휴대폰 정규화·검증·마스킹", () => {
  assert.equal(D.normalizePhone("010-1234-5678"), "01012345678");
  assert.equal(D.normalizePhone(" 010 1234 5678 "), "01012345678");
  assert.ok(D.isValidPhone("010-1234-5678"));
  assert.ok(!D.isValidPhone("02-555-1234"));   // 유선번호 거부
  assert.ok(!D.isValidPhone("0101234"));        // 너무 짧음
  assert.equal(D.maskPhone("01012345678"), "010****5678");
});

test("충전 → 잔액 증가 + 원장 기록", async () => {
  const r = await D.addCredit(db, assoc.id, 30000, { memo: "무통장 입금" });
  assert.equal(r.ok, true);
  assert.equal(r.balance, 30000);
  assert.equal(await D.getBalance(db, assoc.id), 30000);
  const led = await D.listLedger(db, assoc.id);
  assert.equal(led[0].kind, "charge");
  assert.equal(led[0].amount, 30000);
  assert.equal(led[0].balance_after, 30000);
});

test("차감 → 잔액 감소, 잔액보다 큰 차감은 거부(잔액 불변)", async () => {
  const before = await D.getBalance(db, assoc.id);
  const ok = await D.spendCredit(db, assoc.id, 22, "알림톡 1건");
  assert.equal(ok.ok, true);
  assert.equal(ok.balance, before - 22);

  const tooMuch = await D.spendCredit(db, assoc.id, before * 10, "과다");
  assert.equal(tooMuch.ok, false, "잔액 초과 차감은 실패해야 함");
  assert.equal(await D.getBalance(db, assoc.id), before - 22, "실패 시 잔액이 변하면 안 됨");
});

test("잔액 정확히 0까지 쓸 수 있고, 그 다음 건은 거부", async () => {
  const a = await D.createAssociation(db, { slug: "edge", name: "경계 상인회" });
  await D.addCredit(db, a.id, 44);                       // 정확히 2건치
  assert.equal((await D.spendCredit(db, a.id, 22)).ok, true);
  assert.equal((await D.spendCredit(db, a.id, 22)).ok, true);
  assert.equal(await D.getBalance(db, a.id), 0);
  assert.equal((await D.spendCredit(db, a.id, 22)).ok, false, "잔액 0에서 추가 발송 불가");
  assert.equal(await D.getBalance(db, a.id), 0);
});

test("판매단가: 기본값 + 슈퍼관리자 설정 반영", async () => {
  assert.equal(await N.priceOf(db, "alimtalk"), 22);
  await D.setSetting(db, "price_alimtalk", "18");
  assert.equal(await N.priceOf(db, "alimtalk"), 18);
  await D.setSetting(db, "price_alimtalk", "22"); // 원복
});

test("발송 설정(알리고 키) 없으면 차감 없이 실패 처리", async () => {
  const a = await D.createAssociation(db, { slug: "nokey", name: "키없음" });
  await D.addCredit(db, a.id, 1000);
  const r = await N.sendOne(env, db, { assoc: a, kind: "sign_request", to: "010-1111-2222", text: "테스트" });
  assert.equal(r.ok, false);
  assert.equal(await D.getBalance(db, a.id), 1000, "설정 없음은 과금되면 안 됨");
  const logs = await D.listMessages(db, a.id);
  assert.equal(logs[0].status, "failed");
  assert.equal(logs[0].cost, 0);
});

test("발송 실패 시 크레딧 자동 환불 (차감 → 실패 → 환불로 잔액 복구)", async () => {
  const a = await D.createAssociation(db, { slug: "refund", name: "환불검증" });
  await D.addCredit(db, a.id, 1000);
  await D.setSetting(db, "tpl_sign_request", "TPL_TEST_01");
  // 알리고 키는 주되, fetch 를 실패시켜 발송 실패 경로를 태운다
  const envFail = { ...env, ALIGO_API_KEY: "k", ALIGO_USER_ID: "u", ALIGO_SENDER_KEY: "s", ALIGO_SENDER: "0212345678" };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("네트워크 오류"); };
  try {
    const r = await N.sendOne(envFail, db, { assoc: a, kind: "sign_request", to: "010-1111-2222", text: "테스트" });
    assert.equal(r.ok, false);
  } finally { globalThis.fetch = origFetch; }
  assert.equal(await D.getBalance(db, a.id), 1000, "실패했으면 잔액이 원복되어야 함");
  const led = await D.listLedger(db, a.id);
  assert.equal(led[0].kind, "refund", "환불이 원장에 남아야 함");
  assert.equal(led[1].kind, "spend");
  const logs = await D.listMessages(db, a.id);
  assert.equal(logs[0].status, "failed");
  assert.equal(logs[0].cost, 0, "실패 건은 매출로 잡히면 안 됨");
});

test("발송 성공 시 차감 확정 + 매출 로그 (수신번호는 마스킹 저장)", async () => {
  const a = await D.createAssociation(db, { slug: "sendok", name: "발송성공" });
  await D.addCredit(db, a.id, 1000);
  await D.setSetting(db, "tpl_sign_request", "TPL_TEST_01");
  const envOk = { ...env, ALIGO_API_KEY: "k", ALIGO_USER_ID: "u", ALIGO_SENDER_KEY: "s", ALIGO_SENDER: "0212345678" };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true, status: 200,
    json: async () => String(url).includes("token/create")
      ? { code: 0, token: "T" }
      : { code: 0, message: "성공", info: { mid: 123 } },
  });
  let r;
  try { r = await N.sendOne(envOk, db, { assoc: a, kind: "sign_request", to: "010-9876-5432", text: "테스트" }); }
  finally { globalThis.fetch = origFetch; }
  assert.equal(r.ok, true);
  assert.equal(r.cost, 22);
  assert.equal(await D.getBalance(db, a.id), 978);
  const logs = await D.listMessages(db, a.id);
  assert.equal(logs[0].status, "sent");
  assert.equal(logs[0].cost, 22);
  assert.equal(logs[0].recipient, "010****5432", "수신번호는 마스킹되어야 함");
  assert.ok(!logs[0].recipient.includes("9876"), "원본 번호가 로그에 남으면 안 됨");
});

test("잔액 소진 시 남은 인원 발송을 멈추고 보고", async () => {
  const a = await D.createAssociation(db, { slug: "bulk", name: "대량발송" });
  await D.addCredit(db, a.id, 44); // 2건치
  await D.setSetting(db, "tpl_sign_remind", "TPL_REMIND_01");
  const envOk = { ...env, ALIGO_API_KEY: "k", ALIGO_USER_ID: "u", ALIGO_SENDER_KEY: "s", ALIGO_SENDER: "0212345678" };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true, status: 200,
    json: async () => String(url).includes("token/create") ? { code: 0, token: "T" } : { code: 0, info: { mid: 1 } },
  });
  let res;
  try {
    res = await N.sendMany(envOk, db, {
      assoc: a, kind: "sign_remind",
      recipients: [{ phone: "01011112222" }, { phone: "01033334444" }, { phone: "01055556666" }],
      textFor: () => "서명 부탁드립니다",
    });
  } finally { globalThis.fetch = origFetch; }
  assert.equal(res.sent, 2);
  assert.equal(res.stopped, true, "잔액 소진 시 중단 플래그");
  assert.equal(res.cost, 44);
  assert.equal(await D.getBalance(db, a.id), 0);
});

test("충전 신청 → 승인 시에만 잔액 반영", async () => {
  const a = await D.createAssociation(db, { slug: "order", name: "충전신청" });
  const o = await D.createCreditOrder(db, { associationId: a.id, amount: 50000, depositor: "홍길동" });
  assert.equal(o.status, "pending");
  assert.equal(await D.getBalance(db, a.id), 0, "승인 전에는 잔액 0");
  const pend = await D.listPendingCreditOrders(db);
  assert.ok(pend.some((p) => p.id === o.id));
  // 승인 처리
  await D.setCreditOrderStatus(db, o.id, "approved");
  await D.addCredit(db, a.id, o.amount, { memo: `충전 승인 #${o.id}` });
  assert.equal(await D.getBalance(db, a.id), 50000);
});

test("기존 배포 DB(구버전) → 자동 마이그레이션으로 알림톡 표·컬럼 생성", async () => {
  // 실서버는 이미 v16 으로 올라가 있다. 버전이 같으면 패스트패스로 건너뛰므로
  // 반드시 버전이 올라가야 새 표가 생긴다 — 그 경로를 그대로 재현한다.
  const { makeD1 } = await import("./shim.js");
  const { ensureSchema } = await import("../src/schema.js");
  const old = makeD1(); // 현행 스키마로 생성
  // v16 배포 상태 흉내: 알림톡 표·컬럼을 제거하고 버전을 16 으로 기록
  for (const t of ["notify_wallet", "credit_ledger", "credit_orders", "message_log"]) old._db.exec(`DROP TABLE IF EXISTS ${t}`);
  old._db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')");
  old._db.exec("INSERT INTO settings (key,value) VALUES ('schema_version','16') ON CONFLICT(key) DO UPDATE SET value='16'");

  await ensureSchema(old);

  const names = old._db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ["notify_wallet", "credit_ledger", "credit_orders", "message_log"]) {
    assert.ok(names.includes(t), `${t} 표가 생성되어야 함`);
  }
  const ucols = old._db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  assert.ok(ucols.includes("phone"), "users.phone 컬럼이 생겨야 함");
  const ver = old._db.prepare("SELECT value FROM settings WHERE key='schema_version'").get();
  assert.ok(Number(ver.value) > 16, `버전이 올라가야 다음 콜드스타트에서 건너뛴다 (현재 ${ver.value})`);
});

test("상인회별 단가: 전용가 우선, 0이면 플랫폼 기본가", async () => {
  const big = await D.createAssociation(db, { slug: "big2", name: "대형" });
  const sm = await D.createAssociation(db, { slug: "sm2", name: "소규모" });
  await D.setSetting(db, "price_alimtalk", "22");
  assert.equal(await N.priceOf(db, "alimtalk", big.id), 22, "미설정이면 기본가");
  await D.setUnitPrice(db, big.id, 15);
  assert.equal(await N.priceOf(db, "alimtalk", big.id), 15, "전용가가 우선");
  assert.equal(await N.priceOf(db, "alimtalk", sm.id), 22, "다른 상인회는 영향 없음");
  await D.setUnitPrice(db, big.id, 0);
  assert.equal(await N.priceOf(db, "alimtalk", big.id), 22, "0이면 기본가로 복귀");
});

test("마진 정산: 발송 시점 원가를 스냅샷해 나중에 원가를 바꿔도 과거가 흔들리지 않는다", async () => {
  const a1 = await D.createAssociation(db, { slug: "m1", name: "정산A" });
  const a2 = await D.createAssociation(db, { slug: "m2", name: "정산B" });
  await D.setSetting(db, "price_alimtalk", "22");
  await D.setSetting(db, "cost_alimtalk_jeon", "650"); // 6.5원
  await D.setSetting(db, "tpl_sign_request", "TPL_X");
  await D.setUnitPrice(db, a1.id, 15);            // 볼륨 할인 적용
  await D.addCredit(db, a1.id, 10000); await D.addCredit(db, a2.id, 10000);
  const envOk = { ...env, ALIGO_API_KEY: "k", ALIGO_USER_ID: "u", ALIGO_SENDER_KEY: "s", ALIGO_SENDER: "02" };
  const of = globalThis.fetch;
  globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => String(u).includes("token/create") ? { code: 0, token: "T" } : { code: 0, info: { mid: 1 } } });
  try {
    for (let i = 0; i < 4; i++) await N.sendOne(envOk, db, { assoc: a1, kind: "sign_request", to: "01011112222", text: "t" });
    for (let i = 0; i < 2; i++) await N.sendOne(envOk, db, { assoc: a2, kind: "sign_request", to: "01033334444", text: "t" });
  } finally { globalThis.fetch = of; }
  const month = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
  const rows = await D.monthlySettlement(db, month);
  const r1 = rows.find((r) => r.id === a1.id), r2 = rows.find((r) => r.id === a2.id);
  assert.equal(r1.revenue, 60, "전용가 15원 × 4건");
  assert.equal(r1.cost_base, 2600, "원가 6.5원 × 4건 = 26원 = 2600전");
  assert.equal(r2.revenue, 44, "기본가 22원 × 2건");
  assert.equal(r1.revenue - N.jeonToWon(r1.cost_base), 34, "마진 = 매출 60 − 원가 26 = 34원");

  // 원가를 올려도 이미 발송된 건의 원가는 그대로여야 한다
  await D.setSetting(db, "cost_alimtalk_jeon", "1200"); // 12원으로 인상
  const after = await D.monthlySettlement(db, month);
  assert.equal(after.find((r) => r.id === a1.id).cost_base, 2600, "과거 원가는 스냅샷이라 불변");

  // 실패 건은 매출·원가 어디에도 잡히지 않는다
  const before = (await D.monthlySettlement(db, month)).find((r) => r.id === a2.id).sent;
  globalThis.fetch = async () => { throw new Error("네트워크"); };
  try { await N.sendOne(envOk, db, { assoc: a2, kind: "sign_request", to: "01033334444", text: "t" }); }
  finally { globalThis.fetch = of; }
  assert.equal((await D.monthlySettlement(db, month)).find((r) => r.id === a2.id).sent, before, "실패 건은 정산에서 제외");
});

test("소수점 원가(6.5원)를 반올림 없이 정확히 집계한다", async () => {
  // 정수 '원'으로 저장하면 6.5→6 또는 7 로 반올림돼 1,000건에 500원이 어긋난다.
  assert.equal(N.wonToJeon(6.5), 650);
  assert.equal(N.jeonToWon(650), 6.5);
  const a = await D.createAssociation(db, { slug: "dec", name: "소수점" });
  await D.setSetting(db, "cost_alimtalk_jeon", "650");
  await D.setSetting(db, "price_alimtalk", "22");
  await D.setSetting(db, "tpl_sign_request", "TPL_D");
  await D.addCredit(db, a.id, 10000);
  const envOk = { ...env, ALIGO_API_KEY: "k", ALIGO_USER_ID: "u", ALIGO_SENDER_KEY: "s", ALIGO_SENDER: "02" };
  const of = globalThis.fetch;
  globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => String(u).includes("token/create") ? { code: 0, token: "T" } : { code: 0, info: { mid: 1 } } });
  try { for (let i = 0; i < 100; i++) await N.sendOne(envOk, db, { assoc: a, kind: "sign_request", to: "01011112222", text: "t" }); }
  finally { globalThis.fetch = of; }
  const month = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
  const row = (await D.monthlySettlement(db, month)).find((r) => r.id === a.id);
  assert.equal(row.sent, 100);
  assert.equal(row.revenue, 2200, "판매가 22원 × 100건");
  assert.equal(N.jeonToWon(row.cost_base), 650, "원가 6.5원 × 100건 = 650원 (반올림 손실 없음)");
  assert.equal(row.revenue - N.jeonToWon(row.cost_base), 1550, "마진 1,550원");
});

// ── 알림톡을 못 쓰는 동안에도 안내는 나가야 한다 (개통 직후 · 잔액 0 상황)
test("리마인더: 알리고가 없어도 이메일로 나간다", async () => {
  const env = makeEnv({ PUBLIC_ORIGIN: "https://x.kr", RESEND_API_KEY: "re_t", MAIL_FROM: "a@b.kr" });
  const mails = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u, i = {}) => {
    if (/resend/.test(String(u))) { mails.push(JSON.parse(String(i.body))); return new Response("{}", { status: 200 }); }
    if (/aligo/.test(String(u))) throw new Error("알림톡이 호출되면 안 된다");
    return new Response("ok");
  };
  try {
    const a = await D.createAssociation(env.DB, { slug: "eo", name: "조직", kind: "esign" });
    const due = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const { contentHash } = await import("../src/esign.js");
    const d = await D.createDocument(env.DB, { associationId: a.id, title: "계약", body: "본문",
      contentHash: await contentHash("본문"), createdBy: null, ordered: 0, dueDate: due });
    await D.addExternalSigner(env.DB, { documentId: d.id, name: "상대", email: "ext@x.kr", signOrder: 1 });
    const { runSignReminders } = await import("../src/scheduled.js");
    const r = await runSignReminders(env);
    assert.equal(r.skipped, 0, "잔액 0이라고 통째로 건너뛰면 안 된다");
    assert.equal(r.sent, 1, "이메일 한 통은 나가야 한다");
    assert.equal(mails[0].to[0], "ext@x.kr");
  } finally { globalThis.fetch = real; }
});

test("잔액이 없어도 계약 상대방에게는 이메일이 간다", async () => {
  const env = makeEnv({ ALIGO_API_KEY: "k", ALIGO_USER_ID: "u", ALIGO_SENDER_KEY: "s", ALIGO_SENDER: "0212345678",
    RESEND_API_KEY: "re_t", MAIL_FROM: "a@b.kr" });
  const mails = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (u, i = {}) => {
    const s = String(u);
    if (/resend/.test(s)) { mails.push(JSON.parse(String(i.body))); return new Response("{}", { status: 200 }); }
    if (/token\/create/.test(s)) return new Response(JSON.stringify({ code: 0, token: "t" }), { headers: { "content-type": "application/json" } });
    if (/alimtalk\/send/.test(s)) return new Response(JSON.stringify({ code: 0 }), { headers: { "content-type": "application/json" } });
    return new Response("ok");
  };
  try {
    const a = await D.createAssociation(env.DB, { slug: "eo2", name: "조직2", kind: "esign" });
    await D.setSetting(env.DB, "tpl_sign_request", "TPL_A"); // 템플릿은 있고 잔액만 0
    const { contentHash } = await import("../src/esign.js");
    const d = await D.createDocument(env.DB, { associationId: a.id, title: "계약", body: "본문",
      contentHash: await contentHash("본문"), createdBy: null, ordered: 0, dueDate: "" });
    const s = await D.addExternalSigner(env.DB, { documentId: d.id, name: "상대",
      email: "both@x.kr", phone: "010-1111-2222", signOrder: 1 });
    const { sendSignLink } = await import("../src/extsign.js");
    const via = await sendSignLink(env, env.DB, { assoc: a, doc: d, signer: s, origin: "https://x.kr" });
    assert.equal(via, "email", "알림톡이 잔액으로 막히면 이메일로라도 가야 한다");
    assert.equal(mails.length, 1);
    // 관리자는 여전히 '잔액 부족'을 발송 이력에서 본다
    const logs = await D.listMessages(env.DB, a.id, 5);
    assert.ok(logs.some((l) => l.status === "failed" && /잔액/.test(l.detail || "")), "잔액 부족이 이력에 남아야");
  } finally { globalThis.fetch = real; }
});

// 템플릿 코드가 틀렸는지는 보내 봐야 안다. 실계약 중에 알게 되면 상대방이 기다리는 상태가 된다.
test("시험 발송: 크레딧을 차감하지 않고 정산에도 잡히지 않는다", async () => {
  const a = await D.createAssociation(db, { slug: "t1", name: "시험" });
  await D.setSetting(db, "tpl_sign_request", "TPL_OK");
  await D.addCredit(db, a.id, 10000);
  const envOk = { ...env, ALIGO_API_KEY: "k", ALIGO_USER_ID: "u", ALIGO_SENDER_KEY: "s", ALIGO_SENDER: "0212345678" };
  const of = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = async (u, init) => {
    if (!String(u).includes("token/create")) sentBody = init.body;
    return { ok: true, status: 200, json: async () => String(u).includes("token/create") ? { code: 0, token: "T" } : { code: 0, info: { mid: 9 } } };
  };
  let r;
  try { r = await N.sendTest(envOk, db, { kind: "sign_request", to: "010-1111-2222" }); }
  finally { globalThis.fetch = of; }
  assert.equal(r.ok, true);
  assert.equal(await D.getBalance(db, a.id), 10000, "잔액이 그대로여야");
  const month = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
  assert.equal(((await D.monthlySettlement(db, month)).find((x) => x.id === a.id) || { sent: 0 }).sent, 0, "정산에 안 잡혀야");
  assert.equal(sentBody.get("failover"), "N", "문자 대체발송은 꺼서 알림톡 자체를 시험한다");
  assert.equal(sentBody.get("tpl_code"), "TPL_OK");
});

test("시험 발송: 실패하면 제공사 오류 문구를 그대로 돌려준다", async () => {
  await D.setSetting(db, "tpl_sign_done", "TPL_BAD");
  const envOk = { ...env, ALIGO_API_KEY: "k", ALIGO_USER_ID: "u", ALIGO_SENDER_KEY: "s", ALIGO_SENDER: "0212345678" };
  const of = globalThis.fetch;
  globalThis.fetch = async (u) => ({ ok: true, status: 200,
    json: async () => String(u).includes("token/create") ? { code: 0, token: "T" } : { code: -101, message: "템플릿을 찾을 수 없습니다" } });
  let r;
  try { r = await N.sendTest(envOk, db, { kind: "sign_done", to: "01011112222" }); }
  finally { globalThis.fetch = of; }
  assert.equal(r.ok, false);
  assert.match(r.error, /템플릿을 찾을 수 없습니다/, "'발송 실패' 다섯 글자로는 고칠 수 없다");
});

test("시험 발송: 코드가 비어 있으면 보내기 전에 알려준다", async () => {
  const envOk = { ...env, ALIGO_API_KEY: "k", ALIGO_USER_ID: "u", ALIGO_SENDER_KEY: "s", ALIGO_SENDER: "0212345678" };
  const r = await N.sendTest(envOk, db, { kind: "notice", to: "01011112222" });
  assert.equal(r.ok, false);
  assert.match(r.error, /템플릿 코드가 비어/);
});

test("시험 발송: 워커에 없는 값을 이름으로 짚어준다", async () => {
  const r = await N.sendTest({ ...env, ALIGO_API_KEY: "k", ALIGO_USER_ID: "u" }, db, { kind: "sign_request", to: "01011112222" });
  assert.equal(r.ok, false);
  assert.match(r.error, /ALIGO_SENDER_KEY/);
  assert.match(r.error, /ALIGO_SENDER/);
});

// ── 템플릿 코드 자동 채우기
// 심사가 끝나면 코드 일곱 개를 손으로 옮겨 적어야 했다. 오타 하나면 그 종류만
// 조용히 실패하고, 계약 도중에야 알게 된다. 목록을 받아 문구로 대조해 채운다.
test("문구가 같은 템플릿을 찾아 코드를 짝지운다", () => {
  const list = [
    { templtCode: "TPL_REQ", templtName: "아무 이름", templtContent: N.TEMPLATES.sign_request.body, inspStatus: "APR" },
    { templtCode: "TPL_OTP", templtName: "전자서명 본인확인", templtContent: "전혀 다른 문구", inspStatus: "REQ" },
    { templtCode: "TPL_ETC", templtName: "남의 서비스 템플릿", templtContent: "관계 없음", inspStatus: "APR" },
  ];
  const { matched, unmatched } = N.matchTemplates(list.map(N.normalizeProviderTemplate));
  assert.equal(matched.sign_request.code, "TPL_REQ");
  assert.equal(matched.sign_request.how, "문구 일치", "문구가 같으면 가장 확실한 근거");
  assert.equal(matched.sign_otp.code, "TPL_OTP");
  assert.equal(matched.sign_otp.how, "이름 일치");
  assert.equal(matched.sign_otp.inspection, "REQ", "심사 상태를 그대로 들고 와야 안내할 수 있다");
  assert.ok(unmatched.includes("계약서 전자서명 완료"), "못 찾은 것은 이름으로 알려야");
  assert.ok(!Object.values(matched).some((m) => m.code === "TPL_ETC"), "남의 템플릿을 끌어오면 안 된다");
});

test("줄바꿈·공백 차이는 같은 문구로 본다", () => {
  const body = N.TEMPLATES.notice.body.replace(/\n/g, "\r\n") + "  ";
  const { matched } = N.matchTemplates([{ code: "TPL_N", name: "", content: body, inspection: "APR" }]);
  assert.equal(matched.notice.code, "TPL_N");
});

test("키가 없으면 무엇이 없는지 이름으로 알려준다", async () => {
  const r = await N.listProviderTemplates({ ALIGO_API_KEY: "k" });
  assert.equal(r.ok, false);
  assert.match(r.error, /ALIGO_USER_ID/);
});

test("제공사가 오류를 주면 그 문구를 그대로 돌려준다", async () => {
  const env2 = { ALIGO_API_KEY: "k", ALIGO_USER_ID: "u", ALIGO_SENDER_KEY: "s", ALIGO_SENDER: "0212345678" };
  const of = globalThis.fetch;
  globalThis.fetch = async (u) => ({ ok: true, status: 200,
    json: async () => String(u).includes("token/create") ? { code: 0, token: "T" } : { code: -99, message: "발신프로필 없음" } });
  let r; try { r = await N.listProviderTemplates(env2); } finally { globalThis.fetch = of; }
  assert.equal(r.ok, false);
  assert.match(r.error, /발신프로필 없음/);
});

test("응답 키 이름이 달라도 읽어낸다", () => {
  const a = N.normalizeProviderTemplate({ templtCode: "A", templtName: "n", templtContent: "c", inspStatus: "APR" });
  const b = N.normalizeProviderTemplate({ tpl_code: "A", tpl_name: "n", tpl_content: "c", insp_status: "APR" });
  assert.deepEqual(a, b);
});

// ── 카카오 심사 기준 (2026-08 반려 사유에서 뽑은 것)
// 7개 중 5개가 반려됐고 이유가 셋으로 모였다. 문구를 손볼 때 같은 실수를 반복하지 않게 고정한다.
test("모든 템플릿에 고정 문장이 충분히 있다 (변수만으로 이루어지면 반려)", () => {
  for (const [kind, t] of Object.entries(N.TEMPLATES)) {
    const fixed = t.body.replace(/#\{[^}]+\}/g, "").replace(/\s+/g, "");
    assert.ok(fixed.length >= 40, `${kind}: 변수를 빼면 ${fixed.length}자뿐 — 발송 목적을 판단할 수 없다`);
  }
});

test("말머리(첫 줄)가 무슨 메시지인지 알 수 있을 만큼 구체적이다", () => {
  // '전자서명', '서명 요청' 처럼 넓은 말머리는 반려됐다.
  for (const [kind, t] of Object.entries(N.TEMPLATES)) {
    const head = t.body.split("\n")[0].replace(/#\{[^}]+\}/g, "").replace(/[\[\]]/g, "").trim();
    assert.ok(head.length >= 6, `${kind}: 말머리가 너무 짧다 — "${head}"`);
    assert.ok(!/^전자서명$|^서명 요청$/.test(head), `${kind}: 광범위한 말머리 — "${head}"`);
  }
});

test("수신자가 왜 이 메시지를 받는지 본문이 밝힌다", () => {
  // "수신 대상을 명확하게 확인하기 어렵다"가 반려 사유 중 하나였다.
  const 수신단서 = /본 안내는|담당자님|신청해 주셔서|본인이 요청/;
  for (const [kind, t] of Object.entries(N.TEMPLATES)) {
    assert.match(t.body, 수신단서, `${kind}: 수신 대상·계기를 밝히는 문장이 없다`);
  }
});

test("사내 담당자용 템플릿은 사내용임을 밝힌다", () => {
  // 사내 관리자 대상인지 물어보는 반려가 있었다.
  assert.match(N.TEMPLATES.lead_new.body, /사내 업무용/);
  assert.match(N.TEMPLATES.lead_new.body, /담당자님/);
});

// 손으로 쓴 문장을 보내면 카카오가 거절한다 — 재알림이 실제로 그 상태였다.
test("기한 재알림은 손글씨가 아니라 심사 문구로 나간다", async () => {
  const { runSignReminders } = await import("../src/scheduled.js");
  const a = await D.createAssociation(db, { slug: "rm", name: "리마인드", kind: "esign" });
  await D.setSetting(db, "tpl_sign_remind", "TPL_RM");
  await D.addCredit(db, a.id, 10000);
  const pw = { hash: "h", salt: "s" };
  const u = await D.createUser(db, { email: "m@a.kr", passwordHash: pw.hash, salt: pw.salt, name: "박회원", role: "MERCHANT", associationId: a.id });
  await D.setUserPhone(db, u.id, "01099998888");
  const doc = await D.createDocument(db, { associationId: a.id, title: "회비 납부 동의서", body: "b", contentHash: "h",
    createdBy: null, ordered: 0, dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10) });
  await D.createSignatureRequests(db, doc.id, [u.id]);

  const envOk = { ...env, DB: db, PUBLIC_ORIGIN: "https://x.test",
    ALIGO_API_KEY: "k", ALIGO_USER_ID: "u", ALIGO_SENDER_KEY: "s", ALIGO_SENDER: "0212345678" };
  const of = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (u2, init) => {
    if (!String(u2).includes("token/create")) bodies.push(Object.fromEntries(init.body.entries()));
    return { ok: true, status: 200, json: async () => String(u2).includes("token/create") ? { code: 0, token: "T" } : { code: 0, info: { mid: 1 } } };
  };
  try { await runSignReminders(envOk); } finally { globalThis.fetch = of; }

  const mine = bodies.find((b) => b.receiver_1 === "01099998888");
  assert.ok(mine, "회원에게 재알림이 나가야");
  assert.equal(mine.message_1, N.renderTemplate("sign_remind",
    { 상호: a.name, 이름: "박회원", 문서명: doc.title, 기한: doc.due_date }),
    "심사받은 문구 그대로여야 — 손으로 쓴 문장은 카카오가 거절한다");
});
