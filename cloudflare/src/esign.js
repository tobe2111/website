// 전자서명 무결성 (Ed25519 via Web Crypto). 개인키는 env.SIGN_PRIVATE_KEY (JWK 문자열).
// 키 생성: `node cloudflare/scripts/gen-sign-key.mjs` → 출력을 wrangler secret 으로 등록.
import { sha256Hex, sha256HexBytes, b64uFromBytes, bytesFromB64u, randomHex } from "./crypto.js";
import { fieldsCanonical } from "./paper.js";
const encNL = "\n";
const te = new TextEncoder();

export const SEP = encNL;
export const contentHash = (body) => sha256Hex(String(body ?? ""));

// 봉인 문자열 버전
//  v1: [문서, 사용자, 서명자명, 문서해시, 시각, IP]            (구버전 — 기존 서명 검증용으로 유지)
//  v2: v1 + 직전 서명의 봉인값(prevHash)  → 서명들이 사슬로 엮여
//      중간 기록을 지우거나 순서를 바꾸면 사슬이 끊겨 탐지된다(부인방지 강화).
//  v3: v2 + 필드값 해시(fieldsHash) → 서명자가 계약서의 '어느 자리에 무엇을 채웠는지'까지 봉인.
//      값만이 아니라 좌표도 해시에 들어가므로, 채운 내용을 그대로 두고 자리만 옮기는 조작도 탐지된다.
export const SEAL_VER = 3;
export function canonicalString({ documentId, userId, signerName, contentHash: ch, signedAt, ip, prevHash = "", fieldsHash = "", ver = SEAL_VER }) {
  const base = [documentId, userId, signerName, ch, signedAt, ip];
  if (Number(ver) >= 2) base.push(prevHash || "");
  if (Number(ver) >= 3) base.push(fieldsHash || "");
  return base.join(SEP);
}
// 서명자 식별자 — 회원은 숫자 id, 외부 서명자는 "x{id}".
// 서로 다른 이름공간을 써야 "회원 7번"과 "외부 서명자 7번"의 봉인이 겹치지 않는다.
// 필드 담당자 참조 — 회원은 양수 id, 외부 서명자는 음수(-id). doc_fields.assignee 와 같은 규칙.
export const signerRef = (s) => (s.external_id ? -s.external_id : s.user_id || 0);
export const signerKey = (s) =>
  s.external_id ? `x${s.external_id}` : String(s.user_id == null ? "" : s.user_id);
export function canonicalFromSig(s) {
  return canonicalString({
    documentId: s.document_id, userId: signerKey(s), signerName: s.signer_name,
    contentHash: s.content_hash, signedAt: s.signed_at, ip: s.ip,
    prevHash: s.prev_hash || "", fieldsHash: s.fields_hash || "", ver: s.seal_ver || 1,
  });
}
// 필드값 봉인 해시 — 채워진 값 + 좌표를 정규 문자열로 만들어 SHA-256.
// 아무것도 채우지 않았으면 빈 문자열(구조상 v2 와 동일한 효력).
export async function fieldsHashOf(rows) {
  const canon = fieldsCanonical(rows);
  return canon ? await sha256Hex(canon) : "";
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
// 문서의 진짜 해시 — 첨부가 있으면 R2 의 실제 파일 바이트를 다시 해싱해 합친다.
// 파일이 바꿔치기되면 해시가 달라져 검증에서 걸린다. R2 를 못 읽으면 저장된 해시로 폴백(약한 검증).
export async function documentHash(env, doc) {
  if (!doc) return { hash: "", attachmentChecked: false };
  if (!doc.attachment) return { hash: await contentHash(doc.body), attachmentChecked: false };
  let attHash = doc.attachment_hash || "";
  let checked = false;
  try {
    const obj = env && env.MEDIA ? await env.MEDIA.get(doc.attachment) : null;
    if (obj) {
      const buf = new Uint8Array(await obj.arrayBuffer());
      const live = await sha256HexBytes(buf);
      attHash = live; checked = true;
    }
  } catch {}
  return { hash: await contentHash(`${doc.body}\n--attachment--\n${attHash}`), attachmentChecked: checked };
}

export async function verifySignature(env, sig, doc) {
  const { pub } = await keys(env);
  let sealOk = false;
  try { sealOk = await crypto.subtle.verify({ name: "Ed25519" }, pub, bytesFromB64u(sig.record_hash), te.encode(canonicalFromSig(sig))); } catch {}
  let contentOk = false, attachmentChecked = false;
  if (doc) {
    const dh = await documentHash(env, doc);
    contentOk = dh.hash === sig.content_hash;
    attachmentChecked = dh.attachmentChecked;
  }
  // 봉인은 '기록된' 필드 해시를 검증할 뿐이므로, 저장된 값이 사후에 바뀌었는지는 따로 다시 계산해 대조한다.
  // (이게 없으면 DB 의 입력값·도장 이미지를 갈아끼워도 봉인은 계속 유효해 보인다)
  let fieldsOk = true, fieldsChecked = false;
  if ((sig.seal_ver || 1) >= 3 && env && env.DB) {
    try {
      const { listFilledBy } = await import("./db.js");
      const live = await fieldsHashOf(await listFilledBy(env.DB, sig.document_id, signerRef(sig)));
      fieldsOk = live === (sig.fields_hash || "");
      fieldsChecked = true;
    } catch { fieldsChecked = false; }
  }
  return { sealOk, contentOk, fieldsOk, fieldsChecked, valid: sealOk && contentOk && fieldsOk,
    attachmentChecked, hasAttachment: !!(doc && doc.attachment) };
}
export async function publicKeyJwk(env) {
  return (await keys(env)).pubJwk;
}
// 개인키가 어디에 있는지 — Secret(안전) vs D1 자동생성(위험).
// D1 에 있으면 DB 를 읽을 수 있는 사람이 과거 봉인을 위조할 수 있으므로 Secret 이전을 권고한다.
export const keyStorage = (env) => (env.SIGN_PRIVATE_KEY ? "secret" : "database");
// 공개키 지문 — 키가 바뀌었는지 한눈에 확인(운영자가 기록해 두면 무단 교체를 탐지)
export async function publicKeyFingerprint(env) {
  const { pubJwk } = await keys(env);
  const h = await sha256Hex(JSON.stringify(pubJwk));
  return h.slice(0, 32).replace(/(.{4})(?=.)/g, "$1-");
}

// 서명 사슬 무결성 검사 — 각 기록의 prev_hash 가 실제 직전 기록의 봉인값과 맞는지 확인.
// 중간 서명을 지우거나 순서를 바꾸면 여기서 끊긴 지점이 드러난다. (v1 구서명은 사슬 대상 제외)
export function verifyChain(rows) {
  let prev = "";
  for (const r of rows) {
    if ((r.seal_ver || 1) >= 2) {
      if ((r.prev_hash || "") !== prev) return { ok: false, brokenAt: r.id, expected: prev, found: r.prev_hash || "" };
    }
    prev = r.record_hash;
  }
  return { ok: true, length: rows.length };
}

// 사슬 앵커 봉인 문자열 — 앵커 자체도 Ed25519 로 봉인해 사후 조작을 막는다
export const anchorCanonical = ({ headHash, sigCount, anchoredAt }) => ["ANCHOR", headHash, sigCount, anchoredAt].join(SEP);
export async function sealAnchor(env, rec) {
  const { priv } = await keys(env);
  return b64uFromBytes(await crypto.subtle.sign({ name: "Ed25519" }, priv, te.encode(anchorCanonical(rec))));
}
export async function verifyAnchor(env, a) {
  const { pub } = await keys(env);
  try {
    return await crypto.subtle.verify({ name: "Ed25519" }, pub, bytesFromB64u(a.seal),
      te.encode(anchorCanonical({ headHash: a.head_hash, sigCount: a.sig_count, anchoredAt: a.anchored_at })));
  } catch { return false; }
}
