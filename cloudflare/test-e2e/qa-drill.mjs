// 판매 전 QA — 다른 검사가 못 잡는 '불변식' 만 본다.
//
// 단위 테스트는 기능 하나하나가 맞는지 보고, 이 파일은 **여러 기능이 섞인 뒤에도
// 절대 깨지면 안 되는 것**을 본다. 그런 건 기능별 테스트로는 잡히지 않는다.
//
//   1. 회계 항등식 — 원장 합계와 잔액이 언제나 같은가
//   2. 라우트 전수 — 200줄짜리 표에서 auth 를 빠뜨린 줄이 없는가
//   3. 개인정보 — 화면 HTML 에 비밀번호 해시·시크릿·원본 번호가 새지 않는가
//   4. 크론 — 코드와 wrangler.toml 이 글자까지 같은가 (한쪽만 고치면 조용히 멈춘다)
//
// 실행: npm run qa
import { readFileSync } from "node:fs";
import worker, { GLOBAL, TENANT } from "../src/index.js";
import { makeEnv } from "../test/shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { contentHash } from "../src/esign.js";
import { CRON } from "../src/scheduled.js";

const B = "http://localhost";
let ok = 0, bad = 0;
const fails = [];
function chk(name, cond, note = "") {
  if (cond) { ok++; console.log(`  ✓ ${name}${note ? `  ${note}` : ""}`); }
  else { bad++; fails.push(name); console.log(`  ✗ ${name}${note ? `  ${note}` : ""}`); }
}

const env = makeEnv();
let ipN = 0;
const f = (p, i = {}) => worker.fetch(new Request(B + p, { redirect: "manual", ...i,
  headers: { "user-agent": "Mozilla/5.0", "cf-connecting-ip": `203.0.113.${++ipN % 250}`, ...(i.headers || {}) } }),
  env, { waitUntil() {}, passThroughOnException() {} });
const jarOf = (r) => (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
const csrfIn = (h) => (/name="_csrf" value="([^"]+)"/.exec(h) || [])[1];
async function login(email) {
  const g = await f("/login"); const seed = jarOf(g);
  const r = await f("/login", { method: "POST", headers: { cookie: seed, origin: B, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrfIn(await g.text()), email, password: "pass1234" }) });
  return [seed, jarOf(r)].filter(Boolean).join("; ");
}

const pw = await hashPassword("pass1234");
const mk = (e, n, role, aid) => D.createUser(env.DB, { email: e, passwordHash: pw.hash, salt: pw.salt, name: n, role, associationId: aid });
const law = await D.createAssociation(env.DB, { slug: "law", name: "한빛법무법인", kind: "esign" });
const mart = await D.createAssociation(env.DB, { slug: "seocho", name: "서초구 상인회", kind: "merchant" });
await mk("super@p.kr", "운영자", "SUPERADMIN", null);
await mk("ad@law.kr", "대표", "ADMIN", law.id);
await mk("st@law.kr", "담당", "STAFF", law.id);
await mk("ad@seocho.kr", "회장", "ADMIN", mart.id);
const superJar = await login("super@p.kr");
const lawJar = await login("ad@law.kr");
const staffJar = await login("st@law.kr");

// ══════════ 1. 회계 항등식 ══════════
console.log("\n═══ 돈이 맞는가 ═══\n");
{
  const ledgerSum = async (aid) =>
    (await env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM credit_ledger WHERE association_id=?").bind(aid).first()).n;

  // 충전 · 차감 · 실패환불 · 계약과금 · 시험발송을 섞는다
  await D.addCredit(env.DB, law.id, 100000, { kind: "topup", memo: "첫 충전" });
  await D.spendCredit(env.DB, law.id, 3000, "알림톡");
  await D.spendCredit(env.DB, law.id, 999999, "잔액보다 큰 차감");   // 거부되어야 한다
  await D.addCredit(env.DB, law.id, 3000, { kind: "refund", memo: "발송 실패 환불" });
  await D.spendCredit(env.DB, law.id, 500, "알림톡");
  await D.addCredit(env.DB, law.id, 20000, { kind: "topup", memo: "추가 충전" });
  await D.spendCredit(env.DB, law.id, 1200, "알림톡");

  const bal = await D.getBalance(env.DB, law.id);
  chk("원장 합계와 잔액이 같다", (await ledgerSum(law.id)) === bal, `원장 ${await ledgerSum(law.id)} · 잔액 ${bal}`);
  chk("잔액보다 큰 차감은 원장에 흔적을 남기지 않는다",
    !(await env.DB.prepare("SELECT 1 AS x FROM credit_ledger WHERE memo LIKE '%잔액보다 큰%'").first()));
  chk("잔액이 음수가 되지 않는다", bal >= 0, `${bal.toLocaleString()}원`);

  // 원장의 balance_after 가 그 시점의 잔액과 맞는가 — 정산 문의에 답하려면 이게 맞아야 한다
  const rows = (await env.DB.prepare("SELECT amount, balance_after FROM credit_ledger WHERE association_id=? ORDER BY id").bind(law.id).all()).results || [];
  let running = 0, drift = 0;
  for (const r of rows) { running += r.amount; if (running !== r.balance_after) drift++; }
  chk("원장의 '거래 후 잔액' 이 한 줄도 어긋나지 않는다", drift === 0, `${rows.length}줄 검사`);

  // 계약당 과금: 계약 1건에 딱 한 번만 청구된다 (리마인더를 여러 번 보내도)
  await D.setSetting(env.DB, "billing_mode", "per_doc");
  const before = await D.getBalance(env.DB, law.id);
  const lp = await (await f("/t/law/admin/documents", { headers: { cookie: lawJar } })).text();
  const r = await f("/t/law/admin/documents", { method: "POST",
    headers: { cookie: lawJar, origin: B, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrfIn(lp), title: "과금 확인용 계약", body: "제1조 …", target: "none" }) });
  const did = Number((decodeURIComponent(r.headers.get("location") || "").match(/documents\/(\d+)/) || [])[1]);
  const afterCreate = await D.getBalance(env.DB, law.id);
  const price = (await import("../src/notify.js")).priceOf && await (await import("../src/notify.js")).priceOf(env.DB, "alimtalk", law.id);
  chk("계약을 만들면 계약 요금이 한 번 빠진다", before - afterCreate === price, `${(before - afterCreate).toLocaleString()}원`);

  // 계약에 딸린 알림톡(요청·재알림·완료·본인확인)은 이미 계약 요금에 포함 — 또 받으면 이중 과금
  const { sendOne } = await import("../src/notify.js");
  for (const kind of ["sign_request", "sign_remind", "sign_done", "sign_otp"])
    await sendOne(env, env.DB, { assoc: await D.getAssociationById(env.DB, law.id), kind, to: "01011112222", text: "x" });
  chk("계약에 딸린 알림톡은 또 청구하지 않는다 (이중 과금 없음)",
    (await D.getBalance(env.DB, law.id)) === afterCreate, `${(afterCreate - await D.getBalance(env.DB, law.id)).toLocaleString()}원 추가 차감`);
  chk("계약당 과금에서도 원장과 잔액이 여전히 같다",
    (await ledgerSum(law.id)) === (await D.getBalance(env.DB, law.id)));
  await D.setSetting(env.DB, "billing_mode", "per_message");
  void did;
}

// ══════════ 2. 라우트 전수 — auth 를 빠뜨린 줄이 없는가 ══════════
console.log("\n═══ 잠기지 않은 문이 있는가 ═══\n");
{
  // 로그인 없이 GET 을 두드린다. 관리·대시보드·운영사 경로가 200 이면 그 줄에 auth 가 빠진 것이다.
  const PRIVATE = /^\/(admin|super|dashboard|account|documents|sign)\b/;
  const sample = (p) => p.replace(/:code/g, "abc").replace(/:token/g, "abc").replace(/:slug/g, "x")
    .replace(/:sid|:bid|:cid|:id/g, "1");
  const open = [];
  for (const [method, pattern, , auth] of GLOBAL) {
    if (method !== "GET" || !PRIVATE.test(pattern)) continue;
    const r = await f(sample(pattern));
    if (r.status === 200 && !auth) open.push(`${pattern} → 200 (auth 없음)`);
  }
  for (const [method, pattern, , auth] of TENANT) {
    if (method !== "GET" || !PRIVATE.test(pattern)) continue;
    const r = await f("/t/law" + sample(pattern));
    if (r.status === 200 && !auth) open.push(`/t/law${pattern} → 200 (auth 없음)`);
  }
  chk("비로그인으로 열리는 관리 경로가 없다", open.length === 0, open.join(" · ") || `GET 관리 경로 전수 확인`);

  // auth 가 붙은 줄은 실제로 막히는가 — 표에만 적어 두고 라우터가 안 읽으면 소용없다
  const leaked = [];
  for (const [method, pattern, , auth] of [...GLOBAL, ...TENANT]) {
    if (method !== "GET" || !auth) continue;
    const p = (TENANT.some((t) => t[1] === pattern) ? "/t/law" : "") + sample(pattern);
    const r = await f(p);
    if (r.status === 200) leaked.push(`${p} (${auth})`);
  }
  chk("auth 가 붙은 경로는 비로그인에게 200 을 주지 않는다", leaked.length === 0, leaked.join(" · ") || "전수 확인");

  // 담당자(STAFF)는 설정·과금·API 키에 못 들어간다 — 이게 뚫리면 '권한 분리' 가 말뿐이다
  const staffBlocked = [];
  for (const p of ["/t/law/admin", "/t/law/admin/api"]) {
    const r = await f(p, { headers: { cookie: staffJar } });
    if (r.status === 200) staffBlocked.push(p);
  }
  chk("담당자는 설정·API 키 화면에 못 들어간다", staffBlocked.length === 0, staffBlocked.join(" · ") || "403 확인");

  // 남의 조직 관리 화면
  const cross = await f("/t/seocho/admin", { headers: { cookie: lawJar } });
  chk("남의 조직 관리 화면에 못 들어간다", cross.status !== 200, `HTTP ${cross.status}`);
}

// ══════════ 3. 개인정보·시크릿이 화면으로 새는가 ══════════
console.log("\n═══ 새면 안 되는 것 ═══\n");
{
  const u = await D.getUserByEmail(env.DB, "ad@law.kr");
  const SECRETS = [
    ["비밀번호 해시", u.password_hash],
    ["비밀번호 소금(salt)", u.salt],
    ["세션 시크릿", env.SESSION_SECRET],
  ].filter(([, v]) => v && String(v).length > 8);

  const pages = ["/t/law/admin", "/t/law/admin/documents", "/t/law/admin/api", "/t/law/admin/templates", "/account"];
  const found = [];
  for (const p of pages) {
    const body = await (await f(p, { headers: { cookie: lawJar } })).text();
    for (const [name, val] of SECRETS) if (body.includes(val)) found.push(`${p}: ${name}`);
  }
  const sup = await (await f("/super", { headers: { cookie: superJar } })).text();
  for (const [name, val] of SECRETS) if (sup.includes(val)) found.push(`/super: ${name}`);
  chk("화면 어디에도 비밀번호 해시·소금·세션 시크릿이 없다", found.length === 0, found.join(" · ") || `${pages.length + 1}개 화면 검사`);

  // 알리고 키를 넣은 상태로도 값이 화면에 그려지지 않아야 한다 (운영자가 화면을 캡처해 보낸다)
  const env2 = { ...env, ALIGO_API_KEY: "AK-비밀값-1234567890", ALIGO_USER_ID: "urteam", ALIGO_SENDER_KEY: "SK-비밀값-0987654321", ALIGO_SENDER: "0212345678" };
  const r2 = await worker.fetch(new Request(B + "/super", { headers: { cookie: superJar } }), env2, { waitUntil() {} });
  const sup2 = await r2.text();
  const leakedKeys = ["AK-비밀값-1234567890", "SK-비밀값-0987654321"].filter((v) => sup2.includes(v));
  chk("알리고 키 값 자체가 운영사 화면에 그려지지 않는다", leakedKeys.length === 0, leakedKeys.join(" · ") || "값 없음 확인");

  // 발송 이력의 수신번호는 마스킹되어야 한다.
  // 실제로 한 건 보내야 이력이 남는다 — 알림톡을 켜고 알리고 응답을 가로챈다.
  const { sendOne } = await import("../src/notify.js");
  await D.setNotifyAuto(env.DB, law.id, 1);
  await D.setSetting(env.DB, "tpl_notice", "TPL_QA_01");
  await D.addCredit(env.DB, law.id, 5000, { kind: "topup", memo: "QA" });
  const envSend = { ...env, ALIGO_API_KEY: "k", ALIGO_USER_ID: "u", ALIGO_SENDER_KEY: "s", ALIGO_SENDER: "0212345678" };
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, status: 200,
    json: async () => String(url).includes("token/create") ? { code: 0, token: "T" } : { code: 0, info: { mid: 1 } } });
  let sent;
  try { sent = await sendOne(envSend, env.DB, { assoc: await D.getAssociationById(env.DB, law.id), kind: "notice", to: "010-9876-5432", text: "x" }); }
  finally { globalThis.fetch = orig; }
  const logs = (await env.DB.prepare("SELECT recipient FROM message_log WHERE association_id=? AND channel!='contract' ORDER BY id").bind(law.id).all()).results || [];
  const last = logs.length ? logs[logs.length - 1].recipient : "";
  chk("발송 이력에 원본 휴대폰 번호가 저장되지 않는다",
    !!sent && sent.ok && logs.length > 0 && !logs.some((l) => /9876/.test(l.recipient)) && /\*/.test(last),
    `마지막 이력: ${last || "(빈 값)"}`);
}

// ══════════ 3-2. 공개 폼으로 우리 발송 한도를 태울 수 있는가 ══════════
{
  // 비밀번호 재설정은 로그인 없이 누구나 부를 수 있다. 횟수가 안 막히면 남의 메일함을 채우고,
  // 우리 발송 한도를 태운다 — 알림톡 심사 전에는 이메일이 유일한 발송 수단이라 전 조직이 멈춘다.
  const envMail = { ...env, RESEND_API_KEY: "re_test", MAIL_FROM: "QA <no-reply@example.com>" };
  let outbound = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.resend.com")) { outbound++; return { ok: true, status: 200, json: async () => ({ id: "e" }) }; }
    return orig(url, init);
  };
  try {
    for (let i = 0; i < 12; i++) {
      const g = await worker.fetch(new Request(B + "/forgot", { headers: { "cf-connecting-ip": "198.51.100.7" } }), envMail, { waitUntil() {} });
      await worker.fetch(new Request(B + "/forgot", { method: "POST", redirect: "manual",
        headers: { cookie: jarOf(g), origin: B, "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "198.51.100.7" },
        body: new URLSearchParams({ _csrf: csrfIn(await g.text()), email: "ad@law.kr" }) }), envMail, { waitUntil() {} });
    }
  } finally { globalThis.fetch = orig; }
  chk("재설정 메일을 연타해도 한 통만 나간다 (메일 폭탄 · 발송 한도 소진 방지)",
    outbound <= 1, `12번 눌러 ${outbound}통 나감`);
  const logged = (await env.DB.prepare("SELECT COUNT(*) AS n FROM message_log WHERE kind='password_reset'").first()).n;
  chk("재설정 메일이 발송 이력에 남는다 (상한 밖에서 몰래 나가지 않는다)", logged >= 1, `${logged}건 기록`);
}

// ══════════ 4. 크론 — 코드와 배포 설정이 같은가 ══════════
console.log("\n═══ 정기 작업이 실제로 도는가 ═══\n");
{
  const toml = readFileSync(new URL("../../wrangler.toml", import.meta.url), "utf8");
  const inToml = [...toml.matchAll(/"([^"]*\*[^"]*)"/g)].map((m) => m[1]);
  const inCode = Object.values(CRON);
  const missing = inCode.filter((c) => !inToml.includes(c));
  chk("코드의 크론 표현식이 wrangler.toml 에 그대로 있다", missing.length === 0,
    missing.length ? `없는 것: ${missing.join(" · ")}` : inCode.join(" · "));
  // Cloudflare 는 요일 0 을 받지 않는다 — 하나라도 있으면 세 개가 통째로 등록 실패한다
  const zeroDow = inCode.filter((c) => /(^|\s)0(\s|$)/.test(c.split(" ").slice(4).join(" ")));
  chk("요일 자리에 0 이 없다 (있으면 크론 등록이 통째로 실패한다)", zeroDow.length === 0, zeroDow.join(" · ") || "확인");
}

// ══════════ 4-2. 이미 돌아가는 DB 가 새 버전으로 안전하게 올라가는가 ══════════
//
// 배포하면 실서비스 DB 가 첫 요청에서 마이그레이션을 돈다. 여기서 실패하면 사이트가 통째로 죽는다.
// 그래서 '어제 버전 DB' 를 만들어 놓고 실제로 올려 본다.
console.log("\n═══ 쓰던 DB 가 새 버전으로 올라가는가 ═══\n");
{
  const { makeEnv: mk2 } = await import("../test/shim.js");
  const old = mk2();
  const a2 = await D.createAssociation(old.DB, { slug: "old", name: "쓰던조직", kind: "esign" });
  const pw2 = await hashPassword("pass1234");
  await D.createUser(old.DB, { email: "old@x.kr", passwordHash: pw2.hash, salt: pw2.salt, name: "관리자", role: "ADMIN", associationId: a2.id });
  const ob = "쓰던 계약서\n제1조";
  await D.createDocument(old.DB, { associationId: a2.id, title: "쓰던 계약서", body: ob, contentHash: await contentHash(ob), createdBy: null });

  // 오늘 추가된 것들을 걷어내 '어제 배포본' 으로 되돌린다
  const drops = [
    "DROP TABLE IF EXISTS doc_batch_rows", "DROP TABLE IF EXISTS doc_batches", "DROP TABLE IF EXISTS teams",
    // 인덱스가 컬럼을 붙들고 있어 먼저 걷어야 한다 — 어제 배포본에는 이 인덱스도 없었다
    "DROP INDEX IF EXISTS idx_doc_team", "ALTER TABLE documents DROP COLUMN team_id", "ALTER TABLE users DROP COLUMN team_id",
    "ALTER TABLE associations DROP COLUMN team_scope",
  ];
  let dropped = 0;
  for (const q of drops) { try { await old.DB.prepare(q).run(); dropped++; } catch {} }
  await old.DB.prepare("UPDATE settings SET value='44' WHERE key='schema_version'").run();
  chk("어제 버전 DB 를 만들었다 (표·컬럼을 걷어냄)", dropped === drops.length, `${dropped}/${drops.length}`);

  // 첫 요청 = 마이그레이션. 죽지 않고 200 이어야 한다.
  const r1 = await worker.fetch(new Request(B + "/t/old/"), old, { waitUntil() {} });
  chk("올린 직후 첫 요청이 살아 있다", r1.status === 200, `HTTP ${r1.status}`);

  const has = async (t) => !!(await old.DB.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name=?").bind(t).first());
  chk("새 표가 만들어졌다 (teams · doc_batches · doc_batch_rows)",
    (await has("teams")) && (await has("doc_batches")) && (await has("doc_batch_rows")));
  const col = async (t, c) => ((await old.DB.prepare(`PRAGMA table_info(${t})`).all()).results || []).some((x) => x.name === c);
  chk("새 컬럼이 붙었다 (documents.team_id · users.team_id · associations.team_scope)",
    (await col("documents", "team_id")) && (await col("users", "team_id")) && (await col("associations", "team_scope")));

  // 가장 중요한 것 — 쓰던 데이터가 그대로 있고, 새 기능이 그걸 숨기지 않는다
  const kept = await D.listDocuments(old.DB, a2.id);
  chk("쓰던 계약이 그대로 남아 있다", kept.length === 1 && kept[0].title === "쓰던 계약서");
  chk("올린 직후에는 부서 경계가 꺼져 있다 (화면이 갑자기 비면 안 된다)",
    (await D.getAssociationById(old.DB, a2.id)).team_scope === 0);
  chk("옛 계약은 '부서 없음' 이라 모두에게 보인다", (await D.getDocument(old.DB, kept[0].id)).team_id === 0);

  // 두 번째 요청에서 마이그레이션이 또 돌아 깨지지 않는가
  const r2 = await worker.fetch(new Request(B + "/t/old/"), old, { waitUntil() {} });
  chk("두 번째 요청도 멀쩡하다 (마이그레이션이 두 번 돌아도 안전)", r2.status === 200, `HTTP ${r2.status}`);
}

// ══════════ 5. 계약이 법적으로 버티는가 ══════════
console.log("\n═══ 계약이 증거로 버티는가 ═══\n");
{
  const { verifySignature } = await import("../src/esign.js");
  const { buildEvidence } = await import("../src/evidence.js");
  const body = "용역 계약서\n제1조 (목적) 이 계약의 목적은 다음과 같다.";
  const signer = await mk("sg@law.kr", "서명자", "MERCHANT", law.id);
  const d = await D.createDocument(env.DB, { associationId: law.id, title: "증거 확인용 계약",
    body, contentHash: await contentHash(body), createdBy: null });
  await D.createSignatureRequests(env.DB, d.id, [signer.id]);
  const sjar = await login("sg@law.kr");
  const sp = await (await f(`/t/law/sign/${d.id}`, { headers: { cookie: sjar } })).text();
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const fd = new FormData();
  fd.set("_csrf", csrfIn(sp)); fd.set("consent", "1"); fd.set("signer_name", "서명자");
  fd.set("signature", PNG); fd.set("fields", "{}");
  await f(`/t/law/sign/${d.id}`, { method: "POST", headers: { cookie: sjar, origin: B }, body: fd });
  const sig = (await D.listSignatures(env.DB, d.id))[0];
  chk("서명이 남고 봉인이 유효하다", !!sig && (await verifySignature(env, sig, await D.getDocument(env.DB, d.id))).valid === true);

  // 본문을 한 글자 바꾸면 봉인이 깨져야 한다 — 이게 안 깨지면 전자계약이라 부를 수 없다
  await env.DB.prepare("UPDATE documents SET body=? WHERE id=?").bind(body + " (몰래 덧붙임)", d.id).run();
  chk("계약서를 한 글자라도 고치면 봉인이 깨진다",
    (await verifySignature(env, sig, await D.getDocument(env.DB, d.id))).valid === false);
  await env.DB.prepare("UPDATE documents SET body=? WHERE id=?").bind(body, d.id).run();

  const ev = await buildEvidence(env, env.DB, await D.getDocument(env.DB, d.id), await D.getAssociationById(env.DB, law.id));
  const names = (ev.files || []).map((x) => x.name);
  chk("증적 패키지에 검증 방법과 감사 추적이 함께 담긴다",
    names.some((n) => /검증방법/.test(n)) && names.some((n) => /감사|추적|이력/.test(n)),
    `${names.length}개 파일`);
  const pk = await (await f("/.well-known/esign-public-key")).json();
  chk("증적 패키지를 받는 사람이 공개키로 직접 확인할 수 있다",
    pk.algorithm === "Ed25519" && pk.key && pk.key.kty === "OKP" && !!pk.fingerprint,
    `지문 ${String(pk.fingerprint || "").slice(0, 12)}`);
}

console.log(`\n결과: ${ok} 통과 / ${bad} 실패`);
if (bad) { console.log("\n실패한 것:"); for (const n of fails) console.log(`  · ${n}`); }
process.exit(bad ? 1 : 0);
