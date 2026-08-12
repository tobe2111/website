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

const DEFAULT_PRICE = { alimtalk: 22, sms: 33 }; // 판매가 기본값 (원/건, 정수)

// 원가는 소수점이 있다(알림톡 6.5원 등). 정수 '원'으로 반올림하면 1,000건에 500원이 어긋나므로
// 내부적으로 '전(錢) = 0.01원' 단위 정수로 보관·집계하고, 화면에만 원으로 환산해 보여준다.
const DEFAULT_COST_JEON = { alimtalk: 650, sms: 2000 }; // 6.50원 / 20.00원
export const jeonToWon = (j) => (Number(j) || 0) / 100;
export const wonToJeon = (w) => Math.round((Number(w) || 0) * 100);
// 원가(전 단위). 마진 계산·정산의 기준이며 발송 시점 값을 로그에 스냅샷으로 남긴다.
export async function costJeonOf(db, channel) {
  const v = await D.getSetting(db, channel === "sms" ? "cost_sms_jeon" : "cost_alimtalk_jeon");
  const n = parseInt(v || "", 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_COST_JEON[channel === "sms" ? "sms" : "alimtalk"];
}
// 화면 표시용 (원)
export const costOf = async (db, channel) => jeonToWon(await costJeonOf(db, channel));
// 대사(對査) 참조 — CPaaS 계정을 다른 서비스와 공유할 때, 이 플랫폼 발송을 식별하는 표식.
// 알리고 대시보드는 '템플릿 코드'로 필터할 수 있으므로 그 코드를 함께 남겨 대조 기준으로 삼는다.
export const REF_PREFIX = "SCM"; // Seocho/Sangin Commerce Messaging
// 단가 결정 순서: ① 상인회 전용 단가 → ② 플랫폼 기본가 → ③ 코드 기본값
export async function priceOf(db, channel, assocId = null) {
  if (assocId) {
    const own = await D.getUnitPrice(db, assocId);
    if (own > 0) return own;
  }
  const key = channel === "sms" ? "price_sms" : "price_alimtalk";
  const v = await D.getSetting(db, key);
  const n = parseInt(v || "", 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PRICE[channel === "sms" ? "sms" : "alimtalk"];
}
// ---------- 알림톡 템플릿 ----------
// ⚠️ 알림톡은 카카오에 사전 심사받은 문구와 '글자 하나까지' 일치해야 발송된다.
//    (변수 #{...} 자리만 값이 바뀔 수 있다.) 그래서 문구를 코드 밖에서 만들지 않고
//    여기 한 곳에 두고, 발송할 때 변수만 갈아 끼운다. 아래 body 를 그대로 복사해
//    카카오 비즈니스 채널에 등록하고, 받은 템플릿 코드를 슈퍼 콘솔에 입력하면 된다.
//
// 용도가 다르면 템플릿도 달라야 한다 — 인증번호를 '서명 요청' 템플릿으로 보내면
// 문구가 달라 발송이 거절된다(과거 이 문제로 OTP·완료 안내가 모두 실패했다).
export const TEMPLATES = {
  sign_request: {
    key: "tpl_sign_request", label: "전자서명 요청", button: "서명하러 가기",
    vars: ["상호", "이름", "문서명", "기한"],
    body: `[#{상호}] 전자서명 요청

#{이름}님, 아래 문서에 서명이 필요합니다.

▶ 문서: #{문서명}
▶ 기한: #{기한}

버튼을 눌러 내용을 확인하고 서명해 주세요.`,
  },
  sign_remind: {
    key: "tpl_sign_remind", label: "전자서명 미완료 안내", button: "서명하러 가기",
    vars: ["상호", "이름", "문서명", "기한"],
    body: `[#{상호}] 전자서명 미완료 안내

#{이름}님, 아직 서명이 완료되지 않았습니다.

▶ 문서: #{문서명}
▶ 기한: #{기한}

버튼을 눌러 서명을 완료해 주세요.`,
  },
  sign_done: {
    key: "tpl_sign_done", label: "전자서명 완료", button: "확인서 보기",
    vars: ["상호", "이름", "문서명", "검증코드"],
    body: `[#{상호}] 전자서명 완료

#{이름}님, '#{문서명}' 전자서명이 완료되었습니다.

▶ 검증코드: #{검증코드}

버튼을 눌러 전자서명 확인서를 확인하실 수 있습니다.`,
  },
  sign_otp: {
    key: "tpl_sign_otp", label: "전자서명 본인확인", button: "",
    vars: ["상호", "인증번호", "유효시간"],
    body: `[#{상호}] 전자서명 본인확인

인증번호는 #{인증번호} 입니다.
#{유효시간}분 안에 입력해 주세요.

본인이 요청하지 않았다면 이 번호를 입력하지 마세요.`,
  },
  lead_new: {
    key: "tpl_lead_new", label: "가맹 상담 신청 접수(담당자)", button: "상담 DB 열기",
    vars: ["상호", "이름", "연락처", "지역"],
    body: `[#{상호}] 새 가맹 상담 신청

▶ 성함: #{이름}
▶ 연락처: #{연락처}
▶ 희망 지역: #{지역}

버튼을 눌러 상담 내용을 확인해 주세요.`,
  },
  lead_ack: {
    key: "tpl_lead_ack", label: "가맹 상담 접수 안내(신청자)", button: "",
    vars: ["상호", "이름"],
    body: `[#{상호}] 가맹 상담 신청이 접수되었습니다

#{이름}님, 신청해 주셔서 감사합니다.
담당자가 확인 후 순차적으로 연락드리겠습니다.

문의: #{상호}`,
  },
  notice: {
    key: "tpl_notice", label: "상인회 공지", button: "자세히 보기",
    vars: ["상호", "제목", "내용"],
    body: `[#{상호}] #{제목}

#{내용}

자세한 내용은 버튼을 눌러 확인해 주세요.`,
  },
};
// 이전 이름 호환 (슈퍼 콘솔·설정 키 조회용)
export const TEMPLATE_KEYS = Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, t.key]));
export const templateCodeFor = (db, kind) => D.getSetting(db, (TEMPLATES[kind] || {}).key || "");

// 심사받은 문구에 값만 끼워 넣는다. 빈 값은 "-" 로 채운다 —
// 카카오는 변수 자리가 비면 반려하는 경우가 있어 줄 구조를 무너뜨리지 않는 편이 안전하다.
export function renderTemplate(kind, vars = {}) {
  const t = TEMPLATES[kind];
  if (!t) return "";
  return t.body.replace(/#\{([^}]+)\}/g, (_, name) => {
    const v = vars[name.trim()];
    return v === undefined || v === null || v === "" ? "-" : String(v);
  });
}
export const templateButton = (kind) => (TEMPLATES[kind] || {}).button || "";

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

// ---------- 과금 방식 ----------
// per_send : 발송 1건마다 차감 (기본). 인원·재알림이 늘면 매출도 함께 는다.
// per_doc  : 계약 1건마다 한 번만 차감. 그 계약에서 나가는 서명 관련 발송은 모두 무료.
//            고객에게 설명하기 쉬운 대신, 서명자가 많거나 재알림이 잦으면 원가가 매출을 넘을 수 있다.
//            (2인 계약 6통 = 원가 39원. 5인이면 15통 = 97.5원으로 100원에 육박한다)
// 공지(notice)는 계약과 무관하므로 어느 모드에서든 발송당 과금이다.
export const BILLING_MODES = { per_send: "발송당", per_doc: "계약당" };
export async function billingMode(db) {
  return (await D.getSetting(db, "billing_mode")) === "per_doc" ? "per_doc" : "per_send";
}
// 계약 요금에 포함되는 발송 종류 — 이 종류들은 per_doc 모드에서 건별로 차감하지 않는다
const CONTRACT_KINDS = new Set(["sign_request", "sign_remind", "sign_done", "sign_otp"]);
export const isContractKind = (kind) => CONTRACT_KINDS.has(kind);

// 계약 1건 요금 청구 — per_doc 모드에서 문서를 만들 때 한 번 부른다.
// 매출을 message_log 에 'contract' 행으로 남겨야 기존 정산(매출=cost 합계)이 그대로 맞는다.
export async function chargeContract(db, assoc, { documentId, title }) {
  const price = await priceOf(db, "alimtalk", assoc.id);
  if (price <= 0) return { ok: true, cost: 0 }; // 무료 정책
  const paid = await D.spendCredit(db, assoc.id, price, `전자계약 ${title}`.slice(0, 100));
  if (!paid.ok) return { ok: false, error: "크레딧 잔액이 부족합니다", balance: paid.balance };
  await D.logMessage(db, { associationId: assoc.id, channel: "contract", kind: "contract",
    recipient: "", status: "sent", cost: price, costBase: 0,
    ref: `${REF_PREFIX}-${assoc.id}-DOC${documentId}`, detail: title.slice(0, 100) });
  return { ok: true, cost: price };
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
  const baseJeon = await costJeonOf(db, "alimtalk"); // 전 단위 — 반올림 손실 없음
  const ref = `${REF_PREFIX}-${assoc.id}-${tpl}`; // 대사용: 어느 플랫폼·상인회·템플릿인지
  // 계약당 과금이면 서명 관련 발송은 이미 계약 요금에 포함되어 있다 — 여기서 또 받으면 이중 과금이다.
  const perDoc = (await billingMode(db)) === "per_doc" && isContractKind(kind);
  const price = perDoc ? 0 : await priceOf(db, "alimtalk", assoc.id);
  if (!perDoc) {
    const paid = await D.spendCredit(db, assoc.id, price, `알림톡 ${kind}`);
    if (!paid.ok) {
      await D.logMessage(db, { associationId: assoc.id, kind, recipient: masked, status: "failed", cost: 0, ref, detail: "잔액 부족" });
      return { ok: false, error: "크레딧 잔액이 부족합니다", insufficient: true };
    }
  }
  let r;
  try { r = await sendVia(env, { to: phone, templateCode: tpl, text, buttonName, buttonUrl }); }
  catch (e) { r = { ok: false, error: String(e && e.message || e).slice(0, 200) }; }
  if (!r.ok) {
    if (price > 0) await D.addCredit(db, assoc.id, price, { kind: "refund", memo: `발송 실패 환불 (${kind})` });
    await D.logMessage(db, { associationId: assoc.id, kind, recipient: masked, status: "failed", cost: 0, ref, detail: r.error });
    return { ok: false, error: r.error };
  }
  // 원가를 함께 남겨야 나중에 단가를 바꿔도 과거 마진이 흔들리지 않는다
  await D.logMessage(db, { associationId: assoc.id, kind, recipient: masked, status: "sent", cost: price, costBase: baseJeon, ref, detail: r.id ? `mid:${r.id}` : "" });
  return { ok: true, cost: price, costBaseJeon: baseJeon };
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
