// 외부(비회원) 서명 링크 — 가입·로그인 없이 링크 하나로 계약에 서명한다.
//
// 토큰 설계:
//   `{externalId}.{HMAC}` 형태. 서명자 id 는 그대로 보이지만, HMAC 이 없으면 아무 의미가 없다.
//   id 를 1씩 바꿔 남의 계약을 열어 보려 해도 서명값이 맞지 않아 즉시 막힌다.
//   토큰에 만료를 박지 않는 이유: 계약 기한은 문서의 due_date 가 관리하고, 기한이 지나면
//   그쪽에서 막힌다. 토큰 자체에 만료를 두면 링크를 다시 보내야 하는 상황만 늘어난다.
//   유출된 링크가 걱정되면 본인확인(OTP)을 켠다 — 링크만으로는 서명이 완성되지 않는다.
import { hmacSign, hmacVerify } from "./crypto.js";
import * as D from "./db.js";

const PURPOSE = "extsign";

export async function makeExtToken(secret, externalId, documentId) {
  const raw = `${PURPOSE}|${documentId}|${externalId}`;
  return `${externalId}.${await hmacSign(secret, raw)}`;
}

// 토큰 → 외부 서명자 레코드. 위조·다른 문서용 토큰은 전부 null.
export async function resolveExtToken(db, secret, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const id = Number(parts[0]);
  if (!Number.isInteger(id) || id <= 0) return null;
  const signer = await D.getExternalSigner(db, id);
  if (!signer) return null;
  const raw = `${PURPOSE}|${signer.document_id}|${signer.id}`;
  if (!(await hmacVerify(secret, raw, parts[1]))) return null;
  return signer;
}

export const extSignUrl = (origin, token) => `${origin}/esign/${token}`;
