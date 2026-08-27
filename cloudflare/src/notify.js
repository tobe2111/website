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
// 알림톡 발송에 필요한 워커 변수 4종. 목록을 여기 한 곳에만 두어야
// 화면(개통 체크리스트)의 진단과 실제 판정이 어긋나지 않는다.
export const ALIGO_VARS = ["ALIGO_API_KEY", "ALIGO_USER_ID", "ALIGO_SENDER_KEY", "ALIGO_SENDER"];
// 대시보드에 값을 붙여넣을 때 줄바꿈·공백이 딸려 들어가는 일이 흔하다. 그대로 보내면
// 알리고가 "인증 실패"만 돌려줘 원인을 찾기 어렵다 — 읽는 지점에서 한 번 다듬는다.
const cfg = (env, key) => String(env[key] == null ? "" : env[key]).trim();
// 화면(개통 체크리스트)이 판정과 똑같은 잣대로 표시하도록 같은 함수를 쓴다.
export const hasCfg = (env, key) => !!cfg(env, key);
// 넷 중 하나라도 비면 발송 경로 전체가 꺼진다 — 부분 동작은 없다.
export const notifyEnabled = (env) => ALIGO_VARS.every((k) => !!cfg(env, k));

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
    key: "tpl_sign_request", label: "계약서 전자서명 요청", button: "계약서 확인하고 서명하기",
    vars: ["상호", "이름", "문서명", "기한"],
    body: `[#{상호}] 계약서 전자서명 요청 안내

#{이름}님, 계약 당사자로 지정되어 서명이 필요한 계약서가 도착했습니다.

▶ 계약서명: #{문서명}
▶ 서명 기한: #{기한}
▶ 요청 기관: #{상호}

아래 버튼을 눌러 계약 내용을 확인하신 후 전자서명해 주세요.
본 안내는 위 계약서의 서명 당사자로 지정되신 분께만 발송됩니다.`,
  },
  sign_remind: {
    key: "tpl_sign_remind", label: "계약서 전자서명 미완료 안내", button: "계약서 확인하고 서명하기",
    vars: ["상호", "이름", "문서명", "기한"],
    body: `[#{상호}] 계약서 전자서명 미완료 안내

#{이름}님, 앞서 요청드린 계약서에 아직 서명이 완료되지 않아 다시 안내드립니다.

▶ 계약서명: #{문서명}
▶ 서명 기한: #{기한}
▶ 요청 기관: #{상호}

기한이 지나면 서명 링크가 만료됩니다. 아래 버튼을 눌러 서명을 완료해 주세요.
본 안내는 서명 요청을 받으신 후 아직 서명하지 않으신 분께만 발송됩니다.`,
  },
  sign_done: {
    key: "tpl_sign_done", label: "계약서 전자서명 완료", button: "전자서명 확인서 보기",
    vars: ["상호", "이름", "문서명", "검증코드"],
    body: `[#{상호}] 계약서 전자서명 완료 안내

#{이름}님, 참여하신 계약서의 전자서명이 모두 완료되었습니다.

▶ 계약서명: #{문서명}
▶ 문서 검증번호: #{검증코드}
▶ 계약 기관: #{상호}

아래 버튼을 눌러 전자서명 확인서를 확인하고 보관하실 수 있습니다.
본 안내는 위 계약서에 전자서명을 완료하신 분께 발송됩니다.`,
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
    key: "tpl_lead_new", label: "가맹 상담 신청 접수(담당자)", button: "상담 신청 내용 확인하기",
    vars: ["상호", "이름", "연락처", "지역"],
    body: `[#{상호}] 신규 가맹 상담 신청 접수 (사내 업무용)

담당자님, 운영 중인 가맹점 모집 페이지로 새로운 상담 신청이 접수되었습니다.

▶ 신청자명: #{이름}
▶ 연락처: #{연락처}
▶ 희망 지역: #{지역}

아래 버튼을 눌러 신청 내용을 확인하시고 신청자에게 연락해 주세요.
본 안내는 #{상호}의 가맹 상담 담당자에게 발송되는 사내 업무용 메시지입니다.`,
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
    key: "tpl_notice", label: "회원 공지사항 안내", button: "공지 내용 확인하기",
    vars: ["상호", "이름", "제목", "내용"],
    body: `[#{상호}] 회원 공지사항 안내

#{이름}님, 가입하신 단체에서 새로운 공지사항을 등록하여 안내드립니다.

▶ 공지 제목: #{제목}
▶ 주요 내용: #{내용}

자세한 내용은 아래 버튼을 눌러 확인해 주세요.
본 안내는 #{상호} 회원으로 가입하신 분께 발송됩니다.`,
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
  const body = new URLSearchParams({ apikey: cfg(env, "ALIGO_API_KEY"), userid: cfg(env, "ALIGO_USER_ID") });
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
    apikey: cfg(env, "ALIGO_API_KEY"),
    userid: cfg(env, "ALIGO_USER_ID"),
    token,
    senderkey: cfg(env, "ALIGO_SENDER_KEY"),
    tpl_code: templateCode,
    sender: cfg(env, "ALIGO_SENDER"),
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

// ---------- 템플릿 코드 자동 채우기 ----------
// 심사가 끝나면 템플릿마다 코드가 나온다. 그걸 사람이 일곱 칸에 손으로 옮겨 적으면
// 오타 하나로 그 종류만 조용히 발송에 실패한다 — 계약 도중에야 알게 되는 실패다.
// 제공사에 등록된 목록을 그대로 받아와 문구로 대조해 채운다.
const squash = (t) => String(t || "").replace(/\s+/g, " ").trim();
// 응답 키 이름은 제공사 문서와 실제가 어긋나는 일이 잦다 — 있을 법한 이름을 모두 훑는다.
const pick = (row, names) => { for (const n of names) if (row && row[n] != null && row[n] !== "") return String(row[n]); return ""; };
export function normalizeProviderTemplate(row) {
  return {
    code: pick(row, ["templtCode", "tpl_code", "templateCode", "code"]),
    name: pick(row, ["templtName", "tpl_name", "templateName", "name"]),
    content: pick(row, ["templtContent", "tpl_content", "templateContent", "content"]),
    // APR=승인, REQ=심사중, REJ=반려 (문자열이 다를 수 있어 원문도 남긴다)
    inspection: pick(row, ["inspStatus", "inspectionStatus", "insp_status"]),
  };
}
export async function listProviderTemplates(env) {
  if (!notifyEnabled(env)) {
    const missing = ALIGO_VARS.filter((k) => !cfg(env, k));
    return { ok: false, error: `워커에 없는 값: ${missing.join(", ")}` };
  }
  let token;
  try { token = await aligoToken(env); }
  catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 200) }; }
  const body = new URLSearchParams({
    apikey: cfg(env, "ALIGO_API_KEY"), userid: cfg(env, "ALIGO_USER_ID"), token,
    senderkey: cfg(env, "ALIGO_SENDER_KEY"),
  });
  let j;
  try {
    const res = await fetch("https://kakaoapi.aligo.in/akv10/template/list/", { method: "POST", body });
    j = await res.json();
  } catch (e) { return { ok: false, error: "목록을 받아오지 못했습니다: " + String((e && e.message) || e).slice(0, 160) }; }
  if (String(j.code) !== "0") return { ok: false, error: j.message || "목록 조회 실패" };
  const raw = Array.isArray(j.list) ? j.list : Array.isArray(j.data) ? j.data : [];
  return { ok: true, list: raw.map(normalizeProviderTemplate).filter((t) => t.code) };
}
// 우리 문구와 제공사에 등록된 문구를 맞춰 본다.
// ① 문구가 그대로 같으면 확실하다(알림톡은 글자까지 같아야 발송되므로 이게 가장 강한 근거).
// ② 아니면 템플릿 이름이 우리 이름을 담고 있는지 본다.
// 어느 쪽도 아니면 채우지 않는다 — 엉뚱한 코드를 넣으면 그 종류가 통째로 실패한다.
export function matchTemplates(list) {
  const matched = {}, unmatched = [];
  for (const [kind, t] of Object.entries(TEMPLATES)) {
    const byBody = list.find((x) => squash(x.content) === squash(t.body));
    const byName = byBody || list.find((x) => x.name && squash(x.name) === squash(t.label));
    const loose = byName || list.find((x) => x.name && squash(x.name).includes(squash(t.label)));
    if (loose) matched[kind] = { code: loose.code, how: byBody ? "문구 일치" : "이름 일치", inspection: loose.inspection };
    else unmatched.push(t.label);
  }
  return { matched, unmatched };
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
// 운영자용 테스트 발송 — 템플릿 코드가 실제로 통하는지 지금 확인한다.
// 코드가 틀리면 실계약 도중에야 알게 되는데, 그때는 상대방이 이미 기다리고 있다.
// 제공사 오류 원문을 그대로 돌려준다 — "발송 실패" 다섯 글자로는 무엇을 고칠지 알 수 없다.
// 크레딧을 차감하지 않고 정산에도 넣지 않는다(운영사 자신의 점검이다). 원가는 실제로 발생한다.
export async function sendTest(env, db, { kind, to }) {
  const phone = D.normalizePhone(to);
  if (!D.isValidPhone(phone)) return { ok: false, error: "휴대폰 번호 형식이 올바르지 않습니다" };
  if (!notifyEnabled(env)) {
    const missing = ALIGO_VARS.filter((k) => !cfg(env, k));
    return { ok: false, error: `워커에 없는 값: ${missing.join(", ")}` };
  }
  const tpl = await templateCodeFor(db, kind);
  if (!tpl) return { ok: false, error: "이 종류의 템플릿 코드가 비어 있습니다" };
  const t = TEMPLATES[kind];
  // 심사받은 문구 그대로에 예시 값만 끼운다 — 문구가 다르면 카카오가 거절하므로 이게 진짜 시험이다
  const vars = {};
  for (const v of t.vars) vars[v] = { 상호: "테스트", 이름: "홍길동", 문서명: "테스트 계약서", 기한: "12월 31일",
    검증코드: "TEST1234", 인증번호: "123456", 유효시간: String(D.OTP_TTL_MIN), 연락처: "010-0000-0000",
    지역: "서울", 제목: "테스트 공지", 내용: "테스트 발송입니다." }[v] || "테스트";
  const text = renderTemplate(kind, vars);
  try {
    const r = await sendVia(env, { to: phone, templateCode: tpl, text, smsFallback: false });
    return r.ok ? { ok: true, tpl, to: D.maskPhone(phone) } : { ok: false, error: r.error, tpl };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 300), tpl };
  }
}

// ---------- 알림 자동화 스위치 ----------
// 조직마다 켜고 끈다. 꺼져 있으면 이 조직 이름으로는 한 통도 자동으로 나가지 않는다 —
// 관리자가 서명 링크를 카톡·문자로 직접 보내는 방식으로 계약이 진행된다.
//
// 왜 켜는 걸 기본으로 두지 않는가:
//   ① 알림톡은 건당 돈이 나간다. 모르는 새 시작되면 남의 크레딧이 줄어든다.
//   ② 심사가 끝나지 않은 템플릿으로 보내면 실패만 쌓이고 그 이유는 관리자에게 보이지 않는다.
//   ③ 손으로 보내도 계약은 똑같이 끝난다 — 자동은 편의지 필수가 아니다.
// 그래서 관리 화면에서 명시적으로 한 번 켠 조직에만 자동 발송이 붙는다.
export const autoNotifyOn = (assoc) => !!(assoc && assoc.notify_auto);
// 이 조직이 지금 실제로 자동 발송을 할 수 있는가 — 운영사 설정(키)과 조직 스위치가 모두 켜져야 한다.
// 화면에서 '자동으로 나갑니다' 라고 쓰기 전에는 반드시 이걸 본다.
export const canAutoSend = (env, assoc) => notifyEnabled(env) && autoNotifyOn(assoc);
// 자동 발송을 건너뛴 것은 '실패'가 아니다 — 발송 내역에 실패로 남기면
// 관리자가 고칠 것이 없는 붉은 줄을 매일 보게 된다. 조용히 건너뛰고 그렇게 알린다.
const SKIPPED = { ok: false, skipped: true, error: "알림 자동화가 꺼져 있습니다" };

export async function sendOne(env, db, { assoc, kind, to, text, buttonName, buttonUrl, templateCode }) {
  if (!autoNotifyOn(assoc)) return SKIPPED;
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
  if (!autoNotifyOn(assoc)) return { sent: 0, failed: 0, cost: 0, stopped: false, skipped: true, total: recipients.length };
  let sent = 0, failed = 0, cost = 0, stopped = false;
  const tpl = await templateCodeFor(db, kind);
  for (const m of recipients) {
    const r = await sendOne(env, db, { assoc, kind, to: m.phone, text: textFor(m), buttonName, buttonUrl, templateCode: tpl });
    if (r.ok) { sent++; cost += r.cost; }
    else { failed++; if (r.insufficient) { stopped = true; break; } }
  }
  return { sent, failed, cost, stopped, total: recipients.length };
}
