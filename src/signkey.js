// 전자서명 봉인용 Ed25519 키페어 관리 (자체 발급·영속).
// HMAC(대칭) 대비 장점: 서버 비밀 없이 공개키만으로 누구나 독립 검증 가능(부인방지↑).
// 개인키는 data/sign_key.json 에 영속(gitignore). 운영에선 SIGN_PRIVATE_KEY(PEM) env 권장.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

let privateKey, publicKey;

function init() {
  if (process.env.SIGN_PRIVATE_KEY) {
    privateKey = crypto.createPrivateKey(process.env.SIGN_PRIVATE_KEY);
    publicKey = crypto.createPublicKey(privateKey);
    return;
  }
  const file = path.join(path.dirname(config.dbFile), "sign_key.json");
  try {
    if (fs.existsSync(file)) {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      privateKey = crypto.createPrivateKey(j.privateKey);
      publicKey = crypto.createPublicKey(privateKey);
      return;
    }
  } catch { /* 손상 시 재발급 */ }
  const kp = crypto.generateKeyPairSync("ed25519");
  privateKey = kp.privateKey;
  publicKey = kp.publicKey;
  try {
    fs.writeFileSync(file, JSON.stringify({ privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) }), { mode: 0o600 });
  } catch (e) { console.error("[signkey] 키 저장 실패:", e.message); }
}
init();

export function sign(data) {
  return crypto.sign(null, Buffer.from(data, "utf8"), privateKey).toString("base64");
}
export function verify(data, sigB64) {
  try { return crypto.verify(null, Buffer.from(data, "utf8"), publicKey, Buffer.from(sigB64, "base64")); }
  catch { return false; }
}
export function publicKeyPem() {
  return publicKey.export({ type: "spki", format: "pem" });
}
export const algorithm = "Ed25519";
