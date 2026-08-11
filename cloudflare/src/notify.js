// 카카오 알림톡 발송 + 선불 크레딧 과금 (재판매 모델)
//
// 구조:  플랫폼(운영사)이 카카오 채널·템플릿·CPaaS 계정을 보유 → 상인회는 크레딧을 충전해 사용.
//        판매단가(price_alimtalk/price_sms)는 슈퍼관리자가 설정하며, 원가와의 차액이 플랫폼 마진.
//
// 제공사 교체:  sendVia() 안의 어댑터만 바꾸면 됩니다(현재 알리고). 상위 로직은 제공사 무관.
//
// ⚠️ 운영 전 확인:  ① 알리고 계약이 '재판매(리셀)'를 허용하는지 ② 알림톡 템플릿 사전 심사 통과
//                  ③ 알림톡은 정보성 메시지만 허용(광고성은 친구톡·별도 수신동의)
import * as D from "./db.js";

// ---------- 설정 ----------
export const notifyEnabled = (env) => !!(env.ALIGO_API_KEY && env.ALIGO_USER_ID && env.ALIGO_SENDER_KEY && env.ALIGO_SENDER);

const DEFAULT_PRICE = { alimtalk: 22, sms: 33 }; // 원/건 (슈퍼관리자가 변경 가능)
export async function priceOf(db, channel) {
  const key = channel === "sms" ? "price_sms" : "price_alimtalk";
  const v = await D.getSetting(db, key);
  const n = parseInt(v || "", 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PRICE[channel === "sms" ? "sms" : "alimtalk"];
}
// 알림톡 템플릿 코드 — 플랫폼 카카오 채널에 사전 등록·심사된 코드를 슈퍼관리자가 저장
export const TEMPLATE_KEYS = {
  sign_request: "tpl_sign_request",
  sign_remind: "tpl_sign_remind",
  notice: "tpl_notice",
};
export const templateCodeFor = (db, kind) => D.getSetting(db, TEMPLATE_KEYS[kind] || "");

// ---------- 제공사 어댑터 (알리고) ----------
// 알리고는 발송 전 토큰 발급이 필요합니다. 토큰은 짧게 캐시해 재사용.
let tokenCache = { token: "", exp: 0 };
async function aligoToken(env) {
  const now = Date.now();
  if (tokenCache.token && tokenCache.exp > now) return tokenCache.token;
  const body = new URLSearchParams({ apikey: env.ALIGO_API_KEY, userid: env.ALIGO_USER_ID });
  const res = await fetch("https://kakaoapi.aligo.in/akv10/token/create/30/s/", { method: "POST", body });
  const j = await res.json().catch(() => ({}));
  if (String(j.code) !== "0" || !j.token) throw new Error("토큰 발급 실패: " + (j.message || res.status));
  tokenCache = { token: j.token, exp: now + 25 * 1000 }; // 30초 토큰 → 25초만 신뢰
  return j.token;
}

// 한 건 발송. 성공 시 {ok:true}, 실패 시 {ok:false, error}
// smsFallback: 알림톡 수신 불가(미가입·차단) 시 문자로 대체 발송 — 알리고 failover 사용
async function sendVia(env, { to, templateCode, text, smsFallback = true, buttonName = "", buttonUrl = "" }) {
  const token = await aligoToken(env);
  const body = new URLSearchParams({
    apikey: env.ALIGO_API_KEY,
    userid: env.ALIGO_USER_ID,
    token,
    senderkey: env.ALIGO_SENDER_KEY,
    tpl_code: templateCode,
    sender: env.ALIGO_SENDER,
    receiver_1: to,
    subject_1: "알림",
    message_1: text,
    failover: smsFallback ? "Y" : "N",
  });
  if (smsFallback) body.set("fmessage_1", text.slice(0, 90));
  if (buttonUrl && buttonName) {
    body.set("button_1", JSON.stringify({ button: [{ name: buttonName, linkType: "WL", linkTypeName: "웹링크", linkMo: buttonUrl, linkPc: buttonUrl }] }));
  }
  const res = await fetch("https://kakaoapi.aligo.in/akv10/alimtalk/send/", { method: "POST", body });
  const j = await res.json().catch(() => ({}));
  if (String(j.code) !== "0") return { ok: false, error: j.message || `HTTP ${res.status}` };
  return { ok: true, id: j.info && j.info.mid ? String(j.info.mid) : "" };
}

// ---------- 과금 게이트 ----------
// 발송 1건 = 잔액 확인 → 선차감 → 발송 → 실패 시 환불. 순서를 이렇게 두면 중복 차감이 없다.
export async function sendOne(env, db, { assoc, kind, to, text, buttonName, buttonUrl, templateCode }) {
  const phone = D.normalizePhone(to);
  const masked = D.maskPhone(phone);
  if (!D.isValidPhone(phone)) {
    await D.logMessage(db, { associationId: assoc.id, kind, recipient: masked, status: "failed", cost: 0, detail: "휴대폰 번호 형식 오류" });
    return { ok: false, error: "번호 형식 오류" };
  }
  if (!notifyEnabled(env)) {
    await D.logMessage(db, { associationId: assoc.id, kind, recipient: masked, status: "failed", cost: 0, detail: "발송 설정(알리고 키) 없음" });
    return { ok: false, error: "발송이 설정되지 않았습니다" };
  }
  const tpl = templateCode || (await templateCodeFor(db, kind));
  if (!tpl) {
    await D.logMessage(db, { associationId: assoc.id, kind, recipient: masked, status: "failed", cost: 0, detail: "템플릿 코드 미설정" });
    return { ok: false, error: "템플릿 코드가 설정되지 않았습니다" };
  }
  const price = await priceOf(db, "alimtalk");
  const paid = await D.spendCredit(db, assoc.id, price, `알림톡 ${kind}`);
  if (!paid.ok) {
    await D.logMessage(db, { associationId: assoc.id, kind, recipient: masked, status: "failed", cost: 0, detail: "잔액 부족" });
    return { ok: false, error: "크레딧 잔액이 부족합니다", insufficient: true };
  }
  let r;
  try { r = await sendVia(env, { to: phone, templateCode: tpl, text, buttonName, buttonUrl }); }
  catch (e) { r = { ok: false, error: String(e && e.message || e).slice(0, 200) }; }
  if (!r.ok) {
    await D.addCredit(db, assoc.id, price, { kind: "refund", memo: `발송 실패 환불 (${kind})` });
    await D.logMessage(db, { associationId: assoc.id, kind, recipient: masked, status: "failed", cost: 0, detail: r.error });
    return { ok: false, error: r.error };
  }
  await D.logMessage(db, { associationId: assoc.id, kind, recipient: masked, status: "sent", cost: price, detail: "" });
  return { ok: true, cost: price };
}

// 여러 명에게 발송. 잔액이 떨어지면 그 지점에서 멈추고 남은 인원을 알려준다(부분 성공 허용).
export async function sendMany(env, db, { assoc, kind, recipients, textFor, buttonName, buttonUrl }) {
  let sent = 0, failed = 0, cost = 0, stopped = false;
  const tpl = await templateCodeFor(db, kind);
  for (const m of recipients) {
    const r = await sendOne(env, db, { assoc, kind, to: m.phone, text: textFor(m), buttonName, buttonUrl, templateCode: tpl });
    if (r.ok) { sent++; cost += r.cost; }
    else { failed++; if (r.insufficient) { stopped = true; break; } }
  }
  return { sent, failed, cost, stopped, total: recipients.length };
}
