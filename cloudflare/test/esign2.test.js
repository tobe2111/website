// 전자계약 보강분 검증 — 거절(반려)·순차 진행·리마인더 대상·확인서
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { contentHash } from "../src/esign.js";

let env, db, a, u1, u2, u3, doc;

before(async () => {
  env = makeEnv(); db = env.DB;
  a = await D.createAssociation(db, { slug: "s", name: "상인회" });
  const mk = async (e, n, phone = "") => D.createUser(db, { email: e, passwordHash: "h", salt: "s", name: n, role: "MERCHANT", associationId: a.id, phone });
  u1 = await mk("a@x.kr", "김일", "01011111111");
  u2 = await mk("b@x.kr", "이이", "01022222222");
  u3 = await mk("c@x.kr", "박삼"); // 번호 없음
  doc = await D.createDocument(db, { associationId: a.id, title: "동의서", body: "본문", contentHash: await contentHash("본문"), createdBy: u1.id, ordered: 1, dueDate: "" });
  await D.createSignatureRequests(db, doc.id, [u1.id, u2.id, u3.id]);
});

test("거절하면 사유가 남고 본인 서명 대기에서 사라진다", async () => {
  await D.declineSign(db, doc.id, u1.id, "3조 동의 불가");
  const d = await D.getDeclineOf(db, doc.id, u1.id);
  assert.equal(d.decline_reason, "3조 동의 불가");
  assert.ok(d.declined_at, "거절 시각이 기록되어야 함");
  assert.equal((await D.listDocumentsToSign(db, a.id, u1.id)).length, 0);
});

test("순차 서명: 앞사람이 거절해도 뒷사람이 막히지 않는다 (데드락 방지)", async () => {
  assert.equal(await D.canSignNow(db, doc, u2.id), true, "1번이 거절했으면 2번은 서명할 수 있어야 함");
  assert.equal((await D.listDocumentsToSign(db, a.id, u2.id)).length, 1, "목록에도 떠야 함");
});

test("리마인더 대상 = 미서명 + 미거절 (거절자는 다시 조르지 않는다)", async () => {
  const t = await D.listUnsigned(db, doc.id);
  const ids = t.map((x) => x.id);
  assert.ok(!ids.includes(u1.id), "거절자는 제외");
  assert.deepEqual(ids.sort(), [u2.id, u3.id].sort());
  assert.equal(t.find((x) => x.id === u3.id).phone, "", "번호 없는 회원도 대상엔 포함(이메일 폴백)");
});

test("서명 현황에 거절 상태·사유가 함께 보인다", async () => {
  const rows = await D.listRequestStatus(db, doc.id);
  const r1 = rows.find((r) => r.id === u1.id);
  assert.ok(r1.declined_at);
  assert.equal(r1.decline_reason, "3조 동의 불가");
  assert.equal(r1.signed, 0);
});

test("첨부 PDF 해시가 문서 해시에 묶여 봉인이 첨부까지 보호한다", async () => {
  const bodyOnly = await contentHash("본문");
  const withAtt = await contentHash("본문\n--attachment--\nDEADBEEF");
  assert.notEqual(bodyOnly, withAtt, "첨부가 있으면 해시가 달라져야 함");
  const tampered = await contentHash("본문\n--attachment--\nCAFEBABE");
  assert.notEqual(withAtt, tampered, "첨부가 바뀌면 해시가 달라져 검증에서 걸러진다");
});

test("문서 첨부 저장·조회", async () => {
  await D.setDocumentAttachment(db, doc.id, "abc123.pdf", "임대차계약서.pdf");
  const d = await D.getDocument(db, doc.id);
  assert.equal(d.attachment, "abc123.pdf");
  assert.equal(d.attachment_name, "임대차계약서.pdf");
});

// ----- 보안: 봉인 사슬 · OTP -----
test("서명 사슬: 중간 기록을 지우면 끊긴 지점이 드러난다", async () => {
  const { verifyChain } = await import("../src/esign.js");
  const rows = [
    { id: 1, record_hash: "H1", prev_hash: "", seal_ver: 2 },
    { id: 2, record_hash: "H2", prev_hash: "H1", seal_ver: 2 },
    { id: 3, record_hash: "H3", prev_hash: "H2", seal_ver: 2 },
  ];
  assert.equal(verifyChain(rows).ok, true);
  const broken = [rows[0], rows[2]]; // 2번 삭제
  const r = verifyChain(broken);
  assert.equal(r.ok, false);
  assert.equal(r.brokenAt, 3);
});

test("서명 사슬: 구버전(v1) 서명은 사슬 검사 대상에서 제외돼 계속 유효", async () => {
  const { verifyChain } = await import("../src/esign.js");
  const mixed = [
    { id: 1, record_hash: "H1", prev_hash: "", seal_ver: 1 },
    { id: 2, record_hash: "H2", prev_hash: "H1", seal_ver: 2 },
  ];
  assert.equal(verifyChain(mixed).ok, true, "v1 이 섞여 있어도 사슬이 깨졌다고 하면 안 됨");
});

test("OTP: 해시로만 저장되고 만료·시도 제한이 걸린다", async () => {
  const { sha256Hex } = await import("../src/crypto.js");
  const doc = await D.createDocument(db, { associationId: a.id, title: "T2", body: "b", contentHash: await contentHash("b"), createdBy: u1.id });
  const code = "123456";
  await D.upsertSignOtp(db, { documentId: doc.id, userId: u1.id, codeHash: await sha256Hex(`otp|${doc.id}|${u1.id}|${code}`), phone: "01011111111" });
  const rec = await D.getSignOtp(db, doc.id, u1.id);
  assert.ok(!String(rec.code_hash).includes(code), "인증번호 평문이 저장되면 안 됨");
  assert.equal(rec.attempts, 0);
  assert.equal(rec.verified_at, "");
  assert.equal(await D.otpVerifiedRecently(db, doc.id, u1.id), false, "확인 전에는 통과로 보면 안 됨");
  await D.markOtpVerified(db, rec.id);
  assert.equal(await D.otpVerifiedRecently(db, doc.id, u1.id), true);
  // 재발송하면 확인 상태가 초기화되어야 함(새 코드로 다시 확인 필요)
  await D.upsertSignOtp(db, { documentId: doc.id, userId: u1.id, codeHash: "new", phone: "01011111111" });
  assert.equal(await D.otpVerifiedRecently(db, doc.id, u1.id), false, "재발송 시 확인 상태 초기화");
});

test("알림톡 개통 전 안전장치: 이메일 폴백 + 수단 없으면 본인확인 못 켬", async () => {
  const api = await import("../src/api.js");
  // ① 이메일만 있는 상태 → OTP 가 이메일로 나가고 크레딧은 안 깎인다
  const e1 = makeEnv({ RESEND_API_KEY: "k", MAIL_FROM: "a@b.c" });
  const of = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ id: "1" }) });
  try {
    const a1 = await D.createAssociation(e1.DB, { slug: "fb", name: "폴백" });
    const m = await D.createUser(e1.DB, { email: "m@x.kr", passwordHash: "h", salt: "s", name: "김", role: "MERCHANT", associationId: a1.id, phone: "01011112222" });
    const doc = await D.createDocument(e1.DB, { associationId: a1.id, title: "T", body: "b", contentHash: await contentHash("b"), createdBy: m.id });
    await D.addCredit(e1.DB, a1.id, 1000);
    const r = await api.signOtpSend({ db: e1.DB, env: e1, base: "/t/fb", assoc: a1, user: m, params: { id: String(doc.id) } });
    assert.match(decodeURIComponent(r.headers.get("location") || ""), /이메일을 보냈습니다/);
    assert.equal(await D.getBalance(e1.DB, a1.id), 1000, "이메일 폴백은 크레딧을 쓰지 않는다");
  } finally { globalThis.fetch = of; }

  // ② 알림톡·이메일 모두 없는데 본인확인을 켜면 서명이 전면 차단되므로 막아야 한다
  const e0 = makeEnv({});
  const r2 = await api.superEsignSettings({ db: e0.DB, env: e0, form: new URLSearchParams({ esign_otp: "1" }), user: { id: 1, name: "슈퍼", role: "SUPERADMIN" } });
  assert.match(r2.headers.get("location") || "", /err=1/, "발송 수단 없이 켜지면 안 됨");
  assert.notEqual(await D.getSetting(e0.DB, "esign_otp"), "1");
});

// ── 전자계약 조직의 관리 화면은 '계약'을 먼저 보여줘야 한다.
// 예전엔 알림함·담당자·브랜딩이 첫 화면을 차지해서, 매일 하는 일
// (누가 아직 서명 안 했나)을 보려면 다른 화면으로 들어가야 했다.
// 기한 판정이 하루라도 어긋나면 "기한 지남" 이 잘못 떠서 아무도 안 믿게 된다.
test("기한 판정: 오늘까지는 안 지난 것, 어제까지면 지난 것", async () => {
  const { isOverdue } = await import("../src/pages.js");
  const kst = (offsetDays = 0) =>
    new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
  assert.equal(isOverdue({ closed: 0, due_date: kst(0) }), false, "오늘이 기한이면 아직 안 지난 것");
  assert.equal(isOverdue({ closed: 0, due_date: kst(1) }), false, "내일이 기한이면 당연히 안 지난 것");
  assert.equal(isOverdue({ closed: 0, due_date: kst(-1) }), true);
  assert.equal(isOverdue({ closed: 1, due_date: kst(-1) }), false, "체결된 계약은 기한을 따지지 않는다");
  assert.equal(isOverdue({ closed: 0, due_date: "" }), false, "기한이 없으면 지날 수도 없다");
});

// ── 전자계약의 기본은 '가입하지 않은 상대방'과 맺는 계약이다.
// 예전에는 만들기 화면에서 사내 회원만 고를 수 있어서, 계약서를 일단 만들고
// 상세 화면에 다시 들어가 외부 서명자를 붙여야 했다. 사내 회원이 하나도 없으면
// 버튼이 잠겨 계약을 시작조차 못 했다.
test("만들기 화면에서 외부 상대방을 바로 지정할 수 있다", async () => {
  const { default: worker } = await import("../src/index.js");
  const { hashPassword } = await import("../src/crypto.js");
  const e = makeEnv();
  const B = "https://x.test";
  const a = await D.createAssociation(e.DB, { slug: "law", name: "한빛법무법인", kind: "esign" });
  const pw = await hashPassword("pass1234");
  await D.createUser(e.DB, { email: "law@a.kr", passwordHash: pw.hash, salt: pw.salt, name: "김담당", role: "ADMIN", associationId: a.id });
  const f = (p, i) => worker.fetch(new Request(B + p, i), e, { waitUntil() {}, passThroughOnException() {} });
  const g = await f("/login");
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const lr = await f("/login", { method: "POST", headers: { cookie: seed, origin: B, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: tk, email: "law@a.kr", password: "pass1234" }) });
  const jar = [seed, ...(lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");

  const form = await (await f("/t/law/admin/documents/new?tpl=b-lease", { headers: { cookie: jar } })).text();
  assert.match(form, /외부 상대방 — 가입하지 않은 사람/, "만들기 화면에서 바로 고를 수 있어야");
  assert.match(form, /name="ext_phone_0"/);
  assert.ok(!/<button class="btn btn-primary btn-block" disabled>/.test(form), "사내 회원이 없어도 잠기면 안 된다");

  const csrf = (/name="_csrf" value="([^"]+)"/.exec(form) || [])[1];
  const res = await f("/t/law/admin/documents", { method: "POST",
    headers: { cookie: jar, origin: B, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, template: "b-lease", title: "○○상가 임대차계약",
      party_0: "ext", ext_name_0: "김갑", ext_phone_0: "010-1111-2222",
      party_1: "ext", ext_name_1: "이을", ext_phone_1: "010-3333-4444" }) });
  assert.equal(res.status, 303);

  const docs = await D.listDocuments(e.DB, a.id);
  assert.equal(docs.length, 1, "문서가 만들어져야");
  const ext = await D.listExternalSigners(e.DB, docs[0].id);
  assert.deepEqual(ext.map((x) => x.name), ["김갑", "이을"], "두 상대방이 서명자로 등록돼야");

  // 서식의 서명 자리가 각 상대방에게 붙어야 한다 — 안 붙으면 아무도 채울 수 없는 칸이 된다
  const fields = await D.listFields(e.DB, docs[0].id);
  assert.ok(fields.length, "서식 필드가 복사돼야");
  const owners = new Set(fields.map((f2) => f2.assignee).filter(Boolean));
  for (const x of ext) assert.ok(owners.has(-x.id), `${x.name} 의 서명 자리가 있어야 (담당자 -${x.id})`);
});

test("외부 상대방을 골랐는데 연락처가 없으면 만들지 않는다", async () => {
  const { default: worker } = await import("../src/index.js");
  const { hashPassword } = await import("../src/crypto.js");
  const e = makeEnv();
  const B = "https://x.test";
  const a = await D.createAssociation(e.DB, { slug: "law2", name: "두빛", kind: "esign" });
  const pw = await hashPassword("pass1234");
  await D.createUser(e.DB, { email: "l2@a.kr", passwordHash: pw.hash, salt: pw.salt, name: "담당", role: "ADMIN", associationId: a.id });
  const f = (p, i) => worker.fetch(new Request(B + p, i), e, { waitUntil() {}, passThroughOnException() {} });
  const g = await f("/login");
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const lr = await f("/login", { method: "POST", headers: { cookie: seed, origin: B, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: tk, email: "l2@a.kr", password: "pass1234" }) });
  const jar = [seed, ...(lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(await (await f("/t/law2/admin/documents/new?tpl=b-nda", { headers: { cookie: jar } })).text()) || [])[1];
  const res = await f("/t/law2/admin/documents", { method: "POST",
    headers: { cookie: jar, origin: B, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, template: "b-nda", title: "비밀유지약정", party_0: "ext", ext_name_0: "김갑" }) });
  assert.match(decodeURIComponent(res.headers.get("location") || ""), /휴대폰 또는 이메일이 필요합니다/);
  assert.equal((await D.listDocuments(e.DB, a.id)).length, 0, "반쪽짜리 문서가 남으면 안 된다");
});
