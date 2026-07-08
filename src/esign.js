// 전자서명 무결성 모듈 — 문서 해시 + 서명 기록 Ed25519 디지털 서명 + 검증.
// 개정 전자서명법(2020) 하 일반 전자서명: 서명자 확인(로그인 계정) + 서명 의사(동의) +
// 위변조 방지(해시/디지털서명) + 감사추적(시각·IP·기기)을 자체 구현.
// 봉인은 Ed25519 비대칭 서명 → 공개키(+ canonical 규칙)만으로 제3자 독립 검증 가능.
import crypto from "node:crypto";
import * as signkey from "./signkey.js";

// 서명 대상 필드 구분자 (명시적·가시적). 이 규칙을 공개하면 누구나 canonical 을 재현·검증 가능.
export const SEP = "\n";

// 문서 본문의 고정 해시 (서명 대상 식별)
export function contentHash(body) {
  return crypto.createHash("sha256").update(String(body ?? ""), "utf8").digest("hex");
}

// 서명 대상 정규화 문자열: documentId | userId | signerName | contentHash | signedAt | ip
export function canonicalString({ documentId, userId, signerName, contentHash: ch, signedAt, ip }) {
  return [documentId, userId, signerName, ch, signedAt, ip].join(SEP);
}
// 저장된 서명 행(sig)으로부터 canonical 재구성
export function canonicalFromSig(sig) {
  return canonicalString({
    documentId: sig.document_id, userId: sig.user_id, signerName: sig.signer_name,
    contentHash: sig.content_hash, signedAt: sig.signed_at, ip: sig.ip,
  });
}

// 기록 봉인 → Ed25519 서명(base64)
export function sealRecord(rec) {
  return signkey.sign(canonicalString(rec));
}

export function newVerifyCode() {
  return crypto.randomBytes(8).toString("hex"); // 16자
}

export function publicKeyPem() {
  return signkey.publicKeyPem();
}
export const algorithm = signkey.algorithm;

// 서명 기록 검증: 디지털서명 무결성 + 문서 본문 불변 여부
export function verifySignature(sig, doc) {
  const sealOk = signkey.verify(canonicalFromSig(sig), sig.record_hash);
  const contentOk = doc ? contentHash(doc.body) === sig.content_hash : false;
  return { sealOk, contentOk, valid: sealOk && contentOk };
}
