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
