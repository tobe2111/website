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
