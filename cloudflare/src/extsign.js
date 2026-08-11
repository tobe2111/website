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

// 링크에 쓸 절대 주소를 정한다. 상대 경로를 알림톡 버튼에 넣으면 눌러도 아무 데도 가지 않는다.
//  ① 상인회 개별 도메인 → ② 워커 변수 PUBLIC_ORIGIN → ③ 요청에서 학습해 저장해 둔 값
// 크론(정기 작업)에는 요청이 없으므로 ③ 이 없으면 발송을 아예 건너뛴다(깨진 링크를 보내느니 안 보낸다).
export async function originFor(env, db, assoc) {
  if (assoc && assoc.custom_domain) return `https://${assoc.custom_domain}`;
  if (env.PUBLIC_ORIGIN) return String(env.PUBLIC_ORIGIN).replace(/\/+$/, "");
  const saved = await D.getSetting(db, "public_origin");
  return saved ? saved.replace(/\/+$/, "") : "";
}
// 요청이 들어올 때마다 주소를 기억해 둔다 — 크론이 쓸 값을 여기서 확보한다.
// 값이 같으면 쓰지 않으므로 평상시 DB 쓰기는 없다.
export async function rememberOrigin(db, origin) {
  if (!origin || !/^https?:\/\//.test(origin)) return;
  const cur = await D.getSetting(db, "public_origin");
  if (cur !== origin) await D.setSetting(db, "public_origin", origin);
}


// 서명 요청·재알림 링크 보내기 — 외부 서명자는 각자 자기 토큰이 붙은 링크를 받아야 한다.
// 회원처럼 공용 /sign 주소를 보낼 수 없으므로, 발송을 이 한 곳으로 모아 둔다.
// 반환: 보낸 수단("alimtalk" | "email") 또는 null(보낼 수단이 없거나 실패)
export async function sendSignLink(env, db, { assoc, doc, signer, origin, remind = false }) {
  const { sendOne, notifyEnabled, renderTemplate, templateButton } = await import("./notify.js");
  const { sendEmail, emailEnabled, mailShell, mailButton } = await import("./email.js");
  const { esc } = await import("./util.js");
  if (!origin) return null; // 절대 주소를 모르면 깨진 링크가 된다 — 보내지 않는다
  const token = await makeExtToken(env.SESSION_SECRET, signer.id, doc.id);
  const link = extSignUrl(origin, token);
  // 문구는 심사받은 템플릿 그대로여야 한다 — 여기서 변수만 갈아 끼운다
  const kind = remind ? "sign_remind" : "sign_request";
  const text = renderTemplate(kind, { 상호: assoc.name, 이름: signer.name, 문서명: doc.title, 기한: doc.due_date || "미지정" });

  if (D.isValidPhone(signer.phone || "") && notifyEnabled(env)) {
    const r = await sendOne(env, db, { assoc, kind, to: signer.phone, text,
      buttonName: templateButton(kind), buttonUrl: link });
    if (r.ok) return "alimtalk";
    if (r.insufficient) return null; // 잔액 부족 — 이메일로 우회하지 않고 그대로 알린다
  }
  if (signer.email && emailEnabled(env)) {
    await sendEmail(env, { to: signer.email,
      subject: `[${assoc.name}] ${remind ? "전자서명 미완료 안내" : "전자서명 요청"} — ${doc.title}`,
      html: mailShell(`${esc(assoc.name)} 전자서명`,
        `<p>${esc(signer.name)}님, ${remind ? "아직 서명하지 않은 계약서가 있습니다." : "서명이 필요한 계약서가 도착했습니다."}</p>
         <p><b>${esc(doc.title)}</b>${doc.due_date ? ` (기한: ${esc(doc.due_date)})` : ""}</p>
         ${mailButton(link, "계약서 확인하고 서명하기")}
         <p style="font-size:12px;color:#888">가입 없이 이 링크로 바로 서명하실 수 있습니다.</p>`) }).catch(() => {});
    return "email";
  }
  return null;
}

// 아직 서명하지 않은(거절하지 않은) 외부 서명자에게 재알림. 순차 문서면 지금 차례인 사람만.
export async function remindExternals(env, db, { assoc, doc, origin }) {
  const pending = (await D.listExternalSigners(db, doc.id)).filter((e) => !e.signed && !e.declined_at);
  let sent = 0, skipped = 0;
  for (const e of pending) {
    if (doc.ordered && !(await D.canSignNowAny(db, doc, { externalId: e.id }))) { skipped++; continue; }
    const via = await sendSignLink(env, db, { assoc, doc, signer: e, origin, remind: true });
    if (via) sent++; else skipped++;
  }
  return { sent, skipped, total: pending.length };
}
