// 공개 API (/api/v1) — 인증·조직 격리·문서 생성·웹훅 서명
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import { hashPassword, hmacSign } from "../src/crypto.js";
import * as D from "../src/db.js";
import { newApiKey, hashApiKey, KEY_PREFIX, deliverWebhooks } from "../src/apiv1.js";
import { makeExtToken, resolveExtToken } from "../src/extsign.js";
import { verifySignature } from "../src/esign.js";

let env, db, a, other, key, otherKey, docId;
const BASE = "http://localhost";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const api = (method, path, { token = key, body = null } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const init = { method, headers, redirect: "manual" };
  if (body) { headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  return worker.fetch(new Request(BASE + path, init), env);
};
const json = async (r) => JSON.parse(await r.text());

before(async () => {
  env = makeEnv(); db = env.DB;
  a = await D.createAssociation(db, { slug: "s", name: "서초 상인회" });
  other = await D.createAssociation(db, { slug: "o", name: "다른 조직" });
  const h = await hashPassword("admin1234");
  await D.createUser(db, { email: "ad@x.kr", passwordHash: h.hash, salt: h.salt, name: "관리자", role: "ADMIN", associationId: a.id });
  key = newApiKey();
  await D.createApiKey(db, { associationId: a.id, name: "테스트 키", prefix: key.slice(0, KEY_PREFIX.length + 6),
    keyHash: await hashApiKey(key), webhookUrl: "", webhookSecret: "whsec_test" });
  otherKey = newApiKey();
  await D.createApiKey(db, { associationId: other.id, name: "남의 키", prefix: otherKey.slice(0, KEY_PREFIX.length + 6),
    keyHash: await hashApiKey(otherKey), webhookSecret: "whsec_other" });
});

// ---------- 인증 ----------
test("문서 페이지는 키 없이도 열린다 (연동 전에 읽어봐야 하므로)", async () => {
  const r = await api("GET", "/api/v1/docs", { token: null });
  assert.equal(r.status, 200);
  const j = await json(r);
  assert.ok(j.endpoints.length >= 8);
  assert.match(j.example, /curl -X POST/);
  assert.equal(j.pricing.api, "무료");
});

test("키가 없거나 틀리면 401", async () => {
  assert.equal((await api("GET", "/api/v1/me", { token: null })).status, 401);
  assert.equal((await api("GET", "/api/v1/me", { token: "sk_live_nonexistent" })).status, 401);
  const j = await json(await api("GET", "/api/v1/me", { token: "sk_live_nonexistent" }));
  assert.equal(j.error.code, "invalid_key");
});

test("폐기한 키는 즉시 막힌다", async () => {
  const k2 = newApiKey();
  const rec = await D.createApiKey(db, { associationId: a.id, name: "폐기용", prefix: k2.slice(0, 14), keyHash: await hashApiKey(k2) });
  assert.equal((await api("GET", "/api/v1/me", { token: k2 })).status, 200);
  await D.revokeApiKey(db, rec.id, a.id);
  assert.equal((await api("GET", "/api/v1/me", { token: k2 })).status, 401);
});

test("키는 자기 조직만 본다", async () => {
  const mine = await json(await api("GET", "/api/v1/me"));
  assert.equal(mine.organization.slug, "s");
  const theirs = await json(await api("GET", "/api/v1/me", { token: otherKey }));
  assert.equal(theirs.organization.slug, "o");
});

test("API 경로는 CSRF 검사를 받지 않는다 (폼이 아니므로)", async () => {
  // 쿠키·CSRF 토큰 없이 POST 해도 403 이 아니라 정상 처리로 들어가야 한다
  const r = await api("POST", "/api/v1/documents", { body: { title: "x" } });
  assert.notEqual(r.status, 403);
  assert.equal(r.status, 400, "본문 검증 단계까지 도달해야 함");
});

// ---------- 문서 생성 ----------
test("서식 목록에 표준 서식과 빈칸이 함께 나온다", async () => {
  const j = await json(await api("GET", "/api/v1/templates"));
  const lease = j.templates.find((t) => t.id === "b-lease");
  assert.ok(lease, "표준 임대차 서식");
  assert.ok(lease.variables.includes("보증금"));
  assert.deepEqual(lease.parties, ["임대인(갑)", "임차인(을)"]);
  assert.ok(lease.fields > 0);
});

test("서식 + 빈칸 값으로 계약서를 만들고 서명 링크를 받는다", async () => {
  const r = await api("POST", "/api/v1/documents", { body: {
    title: "○○상가 임대차", template: "b-lease",
    variables: { 임대인: "김갑", 임차인: "이을", 보증금: "50,000,000", 소재지: "서초대로 1" },
    signers: [{ name: "김갑", email: "gap@example.com" }, { name: "이을", phone: "010-1234-5678" }],
    ordered: true, send: false,
  } });
  assert.equal(r.status, 201);
  const j = await json(r);
  docId = j.document.id;
  assert.equal(j.document.signers.length, 2);
  assert.match(j.document.signers[0].sign_url, /\/esign\//, "가입 없이 서명할 링크");
  assert.equal(j.document.signers[0].order, 1);

  const doc = await D.getDocument(db, docId);
  assert.match(doc.body, /김갑/, "빈칸이 채워져야 함");
  assert.doesNotMatch(doc.body, /\{\{/);
  const fields = await D.listFields(db, docId);
  assert.ok(fields.length >= 8, "서식의 서명 자리가 함께 배치되어야 함");
  const exts = await D.listExternalSigners(db, docId);
  assert.ok(fields.some((f) => f.assignee === -exts[0].id), "1번 당사자 자리");
  assert.ok(fields.some((f) => f.assignee === -exts[1].id), "2번 당사자 자리");
});

test("API 가 발급한 링크로 실제 서명이 완료된다", async () => {
  const exts = await D.listExternalSigners(db, docId);
  const t = await makeExtToken(env.SESSION_SECRET, exts[0].id, docId);
  assert.ok(await resolveExtToken(db, env.SESSION_SECRET, t));

  const page = await worker.fetch(new Request(`${BASE}/esign/${t}`), env);
  const cookie = (page.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const html = await page.text();
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(html) || [])[1];
  const fields = await D.listFields(db, docId);
  const my = fields.filter((f) => f.assignee === -exts[0].id);
  const values = {};
  for (const f of my) values[f.id] = f.kind === "sign" || f.kind === "stamp" ? { image: PNG }
    : f.kind === "check" ? { value: "1" } : { value: f.kind === "date" ? "2026-08-11" : "김갑" };
  const r = await worker.fetch(new Request(`${BASE}/esign/${t}`, {
    method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, consent: "1", signer_name: "김갑", fields: JSON.stringify(values) }).toString(),
  }), env);
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/, "서명이 성공해야 함");
  const sig = (await D.listSignatures(db, docId))[0];
  assert.equal((await verifySignature(env, sig, await D.getDocument(db, docId))).valid, true);
});

test("진행 상태 조회에 서명자·확인서 링크가 나온다", async () => {
  const j = await json(await api("GET", `/api/v1/documents/${docId}`));
  assert.equal(j.progress.total, 2);
  assert.equal(j.progress.signed, 1);
  assert.equal(j.progress.state, "in_progress");
  assert.equal(j.signers.length, 2);
  assert.equal(j.signers[0].kind, "external");
  assert.equal(j.signatures.length, 1);
  assert.match(j.signatures[0].certificate_url, /\/certificate\//);
  assert.equal(j.signers[0].phone, null, "이메일만 준 사람은 번호가 없다");
  assert.equal(j.signers[1].phone, D.maskPhone("01012345678"), "번호는 마스킹해서 돌려준다");
  assert.doesNotMatch(j.signers[1].phone, /1234/, "가운데가 가려져야 함");
});

test("증적 패키지를 API 로 내려받을 수 있다", async () => {
  const r = await api("GET", `/api/v1/documents/${docId}/evidence`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/zip");
  const bytes = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b], "ZIP 시그니처");
});

// ---------- 격리 ----------
test("다른 조직의 문서는 보이지도, 건드려지지도 않는다", async () => {
  assert.equal((await api("GET", `/api/v1/documents/${docId}`, { token: otherKey })).status, 404);
  assert.equal((await api("POST", `/api/v1/documents/${docId}/close`, { token: otherKey })).status, 404);
  assert.equal((await api("POST", `/api/v1/documents/${docId}/signers`, { token: otherKey, body: { name: "침입", email: "x@x.kr" } })).status, 404);
  assert.equal((await api("GET", `/api/v1/documents/${docId}/evidence`, { token: otherKey })).status, 404);
  const list = await json(await api("GET", "/api/v1/documents", { token: otherKey }));
  assert.equal(list.documents.length, 0);
});

test("다른 조직의 서식은 쓸 수 없다", async () => {
  const t = await D.createTemplate(db, { associationId: other.id, title: "남의 서식", body: "본문", fields: [], parties: ["갑"], ordered: 0 });
  const r = await api("POST", "/api/v1/documents", { body: {
    title: "훔치기", template: String(t.id), signers: [{ name: "누구", email: "a@b.kr" }], send: false } });
  assert.equal(r.status, 403);
  assert.equal((await json(r)).error.code, "forbidden_template");
});

// ---------- 입력 검증 ----------
test("잘못된 입력은 코드와 함께 400 으로 돌아온다", async () => {
  const cases = [
    [{ body: "본문", signers: [{ name: "가", email: "a@b.kr" }] }, "missing_title"],
    [{ title: "제목", signers: [{ name: "가", email: "a@b.kr" }] }, "missing_body"],
    [{ title: "제목", body: "본문" }, "missing_signers"],
    [{ title: "제목", body: "본문", signers: [{ email: "a@b.kr" }] }, "bad_signer"],
    [{ title: "제목", body: "본문", signers: [{ name: "가", email: "이상한주소" }] }, "bad_email"],
    [{ title: "제목", body: "본문", signers: [{ name: "가" }] }, "no_contact"],
    [{ title: "제목", body: "본문", due_date: "2026/12/31", signers: [{ name: "가", email: "a@b.kr" }] }, "bad_due_date"],
  ];
  for (const [payload, code] of cases) {
    const r = await api("POST", "/api/v1/documents", { body: payload });
    assert.equal(r.status, 400, JSON.stringify(payload));
    assert.equal((await json(r)).error.code, code, JSON.stringify(payload));
  }
});

test("없는 경로는 안내와 함께 404", async () => {
  const j = await json(await api("GET", "/api/v1/없는것"));
  assert.equal(j.error.code, "no_route");
  assert.match(j.error.message, /\/api\/v1\/docs/);
});

// ---------- 웹훅 ----------
test("서명이 나면 웹훅이 큐에 쌓이고, 완료되면 completed 도 함께 쌓인다", async () => {
  const wk = newApiKey();
  const rec = await D.createApiKey(db, { associationId: a.id, name: "웹훅 키", prefix: wk.slice(0, 14),
    keyHash: await hashApiKey(wk), webhookUrl: "https://hooks.example.com/e", webhookSecret: "whsec_abc" });
  // 남은 한 명이 서명 → signed + completed
  const exts = await D.listExternalSigners(db, docId);
  const last = exts.find((e) => !e.signed);
  const t = await makeExtToken(env.SESSION_SECRET, last.id, docId);
  const page = await worker.fetch(new Request(`${BASE}/esign/${t}`), env);
  const cookie = (page.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(await page.text()) || [])[1];
  const fields = (await D.listFields(db, docId)).filter((f) => f.assignee === -last.id);
  const values = {};
  for (const f of fields) values[f.id] = f.kind === "sign" || f.kind === "stamp" ? { image: PNG }
    : f.kind === "check" ? { value: "1" } : { value: f.kind === "date" ? "2026-08-11" : "이을" };
  await worker.fetch(new Request(`${BASE}/esign/${t}`, { method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, consent: "1", signer_name: "이을", fields: JSON.stringify(values) }).toString() }), env);

  const q = await D.listWebhooks(db, rec.id, 20);
  const events = q.map((w) => w.event);
  assert.ok(events.includes("document.signed"), `signed 이벤트: ${events}`);
  assert.ok(events.includes("document.completed"), `completed 이벤트: ${events}`);
  const st = await json(await api("GET", `/api/v1/documents/${docId}`));
  assert.equal(st.progress.state, "completed");
});

test("웹훅 전송에 HMAC 서명이 붙고, 성공하면 큐에서 빠진다", async () => {
  const captured = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), headers: init.headers, body: init.body });
    return new Response("ok", { status: 200 });
  };
  try {
    const r = await deliverWebhooks(env, db);
    assert.ok(r.ok >= 2, `전송 성공 ${r.ok}건`);
    assert.equal(r.failed, 0);
  } finally { globalThis.fetch = realFetch; }

  assert.ok(captured.length >= 2);
  const c = captured[0];
  assert.equal(c.url, "https://hooks.example.com/e");
  assert.ok(c.headers["x-esign-event"]);
  const ts = c.headers["x-esign-timestamp"];
  const expected = `v1=${await hmacSign("whsec_abc", `${ts}.${c.body}`)}`;
  assert.equal(c.headers["x-esign-signature"], expected, "수신 측이 같은 계산으로 검증할 수 있어야 함");
  const payload = JSON.parse(c.body);
  assert.ok(payload.event && payload.document_id);
});

test("전송이 실패하면 재시도로 남고, 6회면 포기한다", async () => {
  const wk = newApiKey();
  const rec = await D.createApiKey(db, { associationId: a.id, name: "실패 키", prefix: wk.slice(0, 14),
    keyHash: await hashApiKey(wk), webhookUrl: "https://down.example.com/e", webhookSecret: "s" });
  await D.queueWebhook(db, { keyId: rec.id, event: "test.event", payload: { a: 1 } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  try {
    const r = await deliverWebhooks(env, db);
    assert.equal(r.failed, 1);
  } finally { globalThis.fetch = realFetch; }
  const q = await D.listWebhooks(db, rec.id, 5);
  assert.equal(q[0].delivered_at, "", "전송되지 않은 채로 남아야 함");
  assert.equal(q[0].attempts, 1);
  assert.match(q[0].last_error, /500/);

  // 6회째면 포기 기록
  await D.markWebhookFailed(db, q[0].id, 6, "포기: HTTP 500");
  const q2 = await D.listWebhooks(db, rec.id, 5);
  assert.match(q2[0].last_error, /포기/);
});

test("웹훅을 등록하지 않은 키에는 아무것도 쌓이지 않는다", async () => {
  const plain = (await D.listApiKeys(db, a.id)).find((k) => k.name === "테스트 키");
  assert.equal((await D.listWebhooks(db, plain.id, 5)).length, 0);
});

// ---------- 잔액 ----------
test("잔액 조회로 몇 건 더 보낼 수 있는지 알 수 있다", async () => {
  await D.addCredit(db, a.id, 100000, { kind: "charge", memo: "테스트" });
  const j = await json(await api("GET", "/api/v1/balance"));
  assert.equal(j.balance, 100000);
  assert.ok(j.unit_price > 0);
  assert.equal(j.sendable, Math.floor(100000 / j.unit_price));
});
