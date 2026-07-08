// 전자서명 무결성 (Ed25519 via Web Crypto). 개인키는 env.SIGN_PRIVATE_KEY (JWK 문자열).
// 키 생성: `node cloudflare/scripts/gen-sign-key.mjs` → 출력을 wrangler secret 으로 등록.
import { sha256Hex, b64uFromBytes, bytesFromB64u, randomHex } from "./crypto.js";
const encNL = "\n";
const te = new TextEncoder();

export const SEP = encNL;
export const contentHash = (body) => sha256Hex(String(body ?? ""));
export function canonicalString({ documentId, userId, signerName, contentHash: ch, signedAt, ip }) {
  return [documentId, userId, signerName, ch, signedAt, ip].join(SEP);
}
export function canonicalFromSig(s) {
  return canonicalString({ documentId: s.document_id, userId: s.user_id, signerName: s.signer_name, contentHash: s.content_hash, signedAt: s.signed_at, ip: s.ip });
}
export const newVerifyCode = () => randomHex(8);
export const algorithm = "Ed25519";

let cache = null;
async function keys(env) {
  // env 우선, 없으면 D1 settings 에 자동 생성·영속 (배포 시 수동 등록 불필요)
  let secret = env.SIGN_PRIVATE_KEY;
  if (!secret) {
    const { getSetting, setSetting } = await import("./db.js");
    secret = await getSetting(env.DB, "sign_key");
    if (!secret) {
      const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
      secret = JSON.stringify(await crypto.subtle.exportKey("jwk", kp.privateKey));
      await setSetting(env.DB, "sign_key", secret);
    }
  }
  if (cache && cache.secret === secret) return cache;
  const jwk = JSON.parse(secret);
  const priv = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
  const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
  const pub = await crypto.subtle.importKey("jwk", pubJwk, { name: "Ed25519" }, true, ["verify"]);
  cache = { secret, priv, pub, pubJwk };
  return cache;
}

export async function sealRecord(env, rec) {
  const { priv } = await keys(env);
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, priv, te.encode(canonicalString(rec)));
  return b64uFromBytes(sig);
}
export async function verifySignature(env, sig, doc) {
  const { pub } = await keys(env);
  let sealOk = false;
  try { sealOk = await crypto.subtle.verify({ name: "Ed25519" }, pub, bytesFromB64u(sig.record_hash), te.encode(canonicalFromSig(sig))); } catch {}
  const contentOk = doc ? (await contentHash(doc.body)) === sig.content_hash : false;
  return { sealOk, contentOk, valid: sealOk && contentOk };
}
export async function publicKeyJwk(env) {
  return (await keys(env)).pubJwk;
}
