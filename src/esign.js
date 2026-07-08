// 전자서명 무결성 모듈 — 문서 해시 + 서명 기록 HMAC 봉인 + 검증 (외부 의존성 없음)
// 개정 전자서명법(2020) 하 일반 전자서명: 서명자 확인(로그인 계정) + 서명 의사(동의) +
// 위변조 방지(해시/봉인) + 감사추적(시각·IP·기기)을 자체 구현.
import crypto from "node:crypto";
import { config } from "./config.js";

// 서명 봉인용 비밀키 (기본은 세션 시크릿, 별도 지정 권장)
const SIGN_SECRET = process.env.SIGN_SECRET || config.sessionSecret;

// 문서 본문의 고정 해시 (서명 대상 식별)
export function contentHash(body) {
  return crypto.createHash("sha256").update(String(body ?? ""), "utf8").digest("hex");
}

// 서명 기록의 정규화 문자열 → HMAC 봉인
function canonical({ documentId, userId, signerName, contentHash: ch, signedAt, ip }) {
  return [documentId, userId, signerName, ch, signedAt, ip].join("");
}
export function sealRecord(rec) {
  return crypto.createHmac("sha256", SIGN_SECRET).update(canonical(rec), "utf8").digest("hex");
}

export function newVerifyCode() {
  return crypto.randomBytes(8).toString("hex"); // 16자
}

function hexEqual(a, b) {
  const ba = Buffer.from(String(a), "hex"), bb = Buffer.from(String(b), "hex");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// 서명 기록 검증: 봉인 무결성 + 문서 본문 불변 여부
export function verifySignature(sig, doc) {
  const expectedSeal = sealRecord({
    documentId: sig.document_id, userId: sig.user_id, signerName: sig.signer_name,
    contentHash: sig.content_hash, signedAt: sig.signed_at, ip: sig.ip,
  });
  const sealOk = hexEqual(expectedSeal, sig.record_hash);
  const contentOk = doc ? contentHash(doc.body) === sig.content_hash : false;
  return { sealOk, contentOk, valid: sealOk && contentOk };
}
