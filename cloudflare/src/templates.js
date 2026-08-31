// 계약서 서식(템플릿) — 본문 + 필드 배치를 한 벌로 저장해 두고 찍어낸다.
//
// 변수:  본문에 {{임차인}} 처럼 쓰면 문서를 만들 때 그 값만 채우는 폼이 자동으로 생긴다.
//        서식은 한 번 만들고 계약은 수십 번 만든다 — 이게 실무에서 제일 큰 차이다.
//
// 필드 page 에 -1 을 쓰면 "마지막 페이지" 를 뜻한다. 본문 길이에 따라 쪽수가 달라지므로
// 서명란은 절대 쪽수가 아니라 '끝장'에 붙어야 한다.

import { paginate, PAGE, LINE_H } from "./paper.js";

// {{변수}} 추출 — 나온 순서대로, 중복 제거
export function extractVars(body) {
  const out = [];
  const re = /\{\{\s*([^}\n]{1,30}?)\s*\}\}/g;
  let m;
  while ((m = re.exec(String(body || "")))) {
    const name = m[1].trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

// 변수 치환. 값이 없으면 밑줄로 남겨 "빈칸"임이 종이에서도 보이게 한다.
export function applyVars(body, values = {}) {
  return String(body || "").replace(/\{\{\s*([^}\n]{1,30}?)\s*\}\}/g, (_, name) => {
    const v = values[name.trim()];
    return v === undefined || v === "" ? "____________" : String(v);
  });
}

// 서식의 필드 배치를 실제 쪽수에 맞춘다 (-1 → 마지막 쪽).
// body 를 함께 주면 서명란의 세로 자리도 **본문이 끝나는 자리 바로 아래**로 옮긴다 —
// 고정 좌표(0.60)에 두면 본문이 짧은 계약서에서 서명란이 허공에 400px 떠 있게 된다.
// 계약서는 "…아래에 서명한다" 바로 밑에서 서명이 시작돼야 계약서로 읽힌다.
export function resolveFieldPages(fields, pages, body = null) {
  const rows = (fields || []).map((f) => ({ ...f, page: f.page < 0 ? Math.max(0, pages + f.page) : Math.min(f.page, pages - 1) }));
  if (!body) return rows;
  const y0 = signStartY(body);
  if (y0 == null) return rows;
  // 원래 y 를 행 번호로 되돌려(0.60·0.71·…) 새 시작점부터 같은 간격으로 다시 깐다
  return rows.map((f) => {
    const row = Math.round((f.y - SIGN_Y0) / SIGN_GAP);
    if (row < 0 || Math.abs(SIGN_Y0 + row * SIGN_GAP - f.y) > 0.02) return f;   // 서명란 행이 아니면 그대로
    return { ...f, y: Math.min(0.94 - f.h, y0 + row * SIGN_GAP + (f.y - (SIGN_Y0 + row * SIGN_GAP))) };
  });
}
export const SIGN_Y0 = 0.60, SIGN_GAP = 0.11;
// 마지막 쪽에서 본문이 끝난 다음 줄의 세로 비율. 서명란이 들어갈 자리가 없으면 null.
function signStartY(body) {
  const pages = paginate(body);
  const last = pages[pages.length - 1];
  let lastText = -1;
  for (let i = last.length - 1; i >= 0; i--) if (last[i].t.trim()) { lastText = i; break; }
  const start = lastText + 3;                       // 말미 문구와 두 줄 띄운다
  const y = (PAGE.pad + start * LINE_H) / PAGE.h;
  return y > 0.80 ? null : Math.max(0.30, y);       // 두 당사자가 안 들어가면 원래 자리를 쓴다
}

// 서명·도장·날짜를 끝장 하단에 나란히 놓는 표준 배치 (당사자 수만큼)
// 서명란 이름표는 "당사자1" 이 아니라 계약서가 실제로 쓰는 말이어야 한다 —
// 임대차계약서라면 임대인(갑)·임차인(을) 이다. 서명하는 사람이 자기 자리를 찾을 수 있어야 한다.
const signRow = (i, who) => {
  const y = 0.60 + i * 0.11;
  const name = who || `당사자${i + 1}`;
  return [
    { kind: "name",  label: `${name} 성명`, page: -1, x: 0.10, y, w: 0.22, h: 0.032, party: i, required: 1 },
    { kind: "sign",  label: `${name} 서명`, page: -1, x: 0.36, y: y - 0.012, w: 0.24, h: 0.056, party: i, required: 1 },
    { kind: "stamp", label: "도장",         page: -1, x: 0.64, y: y - 0.016, w: 0.085, h: 0.06, party: i, required: 0 },
    { kind: "date",  label: "날짜",         page: -1, x: 0.76, y, w: 0.15, h: 0.032, party: i, required: 1 },
  ];
};
const partyRows = (parties) => parties.flatMap((who, i) => signRow(i, who));

// ---------- 기본 서식 (코드 내장 — DB 시딩 불필요) ----------
// id 가 'b'로 시작하면 내장 서식, 숫자면 상인회가 저장한 서식이다.
export const BUILTIN = [
  {
    id: "b-lease",
    title: "상가건물 임대차계약서",
    summary: "점포 임대 — 보증금·월세·기간·특약",
    ordered: 1,
    body: `상가건물 임대차계약서

임대인 {{임대인}} (이하 "갑")과 임차인 {{임차인}} (이하 "을")은 아래 상가건물에 관하여 다음과 같이 임대차계약을 체결한다.

제1조 (목적물)
  소재지   {{소재지}}
  면적     {{면적}}
  용도     {{용도}}

제2조 (보증금 및 차임)
  ① 보증금은 금 {{보증금}} 원으로 한다.
  ② 월 차임은 금 {{월세}} 원으로 하며, 매월 {{납부일}} 일에 갑이 지정하는 계좌로 지급한다.
  ③ 관리비는 {{관리비}} 로 한다.

제3조 (임대차 기간)
  임대차 기간은 {{시작일}} 부터 {{종료일}} 까지로 한다.

제4조 (사용·수익)
  ① 을은 목적물을 제1조에 정한 용도로만 사용하여야 한다.
  ② 을은 갑의 서면 동의 없이 목적물의 구조를 변경하거나 전대할 수 없다.

제5조 (수선 및 원상회복)
  ① 목적물의 주요 설비에 대한 수선은 갑이 부담한다.
  ② 을의 고의·과실로 발생한 훼손은 을이 부담한다.
  ③ 계약 종료 시 을은 목적물을 원상으로 회복하여 갑에게 반환한다.

제6조 (계약의 해지)
  ① 을이 차임을 3기 이상 연체한 때에는 갑은 계약을 해지할 수 있다.
  ② 당사자 일방이 본 계약을 위반한 때에는 상대방은 상당한 기간을 정하여 이행을 최고하고, 그 기간 내에 이행되지 아니하면 계약을 해지할 수 있다.

제7조 (특약사항)
  {{특약사항}}

제8조 (분쟁의 해결)
  본 계약에 관한 분쟁은 목적물 소재지를 관할하는 법원을 관할법원으로 한다.

본 계약을 증명하기 위하여 당사자는 아래에 전자서명한다.`,
    parties: ["임대인(갑)", "임차인(을)"],
    fields: partyRows(["임대인(갑)", "임차인(을)"]),
  },
  {
    id: "b-service",
    title: "용역(업무위탁) 계약서",
    summary: "외주·위탁 — 업무범위·대금·기간",
    ordered: 1,
    body: `용역계약서

위탁자 {{위탁자}} (이하 "갑")과 수탁자 {{수탁자}} (이하 "을")은 다음과 같이 용역계약을 체결한다.

제1조 (용역의 내용)
  을은 갑에게 다음의 용역을 제공한다.
  {{업무내용}}

제2조 (계약기간)
  {{시작일}} 부터 {{종료일}} 까지로 한다.

제3조 (용역대금 및 지급)
  ① 용역대금은 금 {{용역대금}} 원(부가세 {{부가세포함여부}})으로 한다.
  ② 갑은 {{지급조건}} 에 따라 을이 지정한 계좌로 지급한다.
  ③ 지급이 지체된 경우 연 6퍼센트의 지연이자를 가산한다.

제4조 (을의 의무)
  ① 을은 선량한 관리자의 주의로 용역을 수행한다.
  ② 을은 갑의 사전 서면 동의 없이 용역의 전부를 제3자에게 재위탁할 수 없다.

제5조 (성과물의 귀속)
  본 용역의 결과로 작성된 산출물의 소유권 및 지식재산권은 대금 완납 시 갑에게 귀속한다.
  다만 을이 종전부터 보유한 기술·노하우는 그러하지 아니하다.

제6조 (비밀유지)
  당사자는 본 계약의 이행 과정에서 알게 된 상대방의 영업비밀을 계약 종료 후 3년간
  제3자에게 누설하지 아니한다.

제7조 (계약의 해지)
  당사자 일방이 본 계약을 위반하고 상당한 기간을 정한 최고에도 이를 시정하지 아니한 때,
  상대방은 계약을 해지하고 손해배상을 청구할 수 있다.

제8조 (기타)
  본 계약에 정하지 아니한 사항은 관계 법령 및 상관례에 따른다.

본 계약을 증명하기 위하여 당사자는 아래에 전자서명한다.`,
    parties: ["위탁자(갑)", "수탁자(을)"],
    fields: partyRows(["위탁자(갑)", "수탁자(을)"]),
  },
  {
    id: "b-nda",
    title: "비밀유지계약서 (NDA)",
    summary: "정보 제공 전 필수 — 범위·기간·반환",
    ordered: 1,
    body: `비밀유지계약서

{{당사자A}} (이하 "갑")과 {{당사자B}} (이하 "을")은 {{목적}} 과 관련하여 다음과 같이 합의한다.

제1조 (비밀정보의 정의)
  "비밀정보"란 본 계약의 목적과 관련하여 일방이 상대방에게 제공하는 기술·영업·재무상의
  일체의 정보로서 서면·구두·전자적 형태를 불문한다. 다만 다음 각 호는 제외한다.
  1. 제공 시점에 이미 공지된 정보
  2. 수령자의 귀책 없이 공지가 된 정보
  3. 수령자가 제3자로부터 적법하게 취득한 정보

제2조 (비밀유지 의무)
  ① 수령자는 비밀정보를 본 계약의 목적 외로 사용하지 아니한다.
  ② 수령자는 비밀정보를 제3자에게 공개·누설하지 아니한다.
  ③ 수령자는 업무상 필요한 임직원에 한하여 비밀정보를 접근하게 하며,
     그 임직원에게 본 계약과 동일한 의무를 부과한다.

제3조 (유효기간)
  본 계약은 {{시작일}} 부터 효력이 발생하며, 비밀유지 의무는 계약 종료 후 {{비밀유지기간}} 간 존속한다.

제4조 (반환 및 폐기)
  제공자의 요청이 있는 경우 수령자는 비밀정보가 기록된 일체의 자료를 지체 없이
  반환하거나 폐기하고 그 사실을 서면으로 확인한다.

제5조 (손해배상)
  본 계약을 위반한 당사자는 그로 인하여 상대방에게 발생한 손해를 배상한다.

본 계약을 증명하기 위하여 당사자는 아래에 전자서명한다.`,
    parties: ["갑", "을"],
    fields: partyRows(["갑(정보제공자)", "을(정보수령자)"]),
  },
  {
    id: "b-join",
    // 상인회 전용 — 법무법인·중개사에게 '상인회 가입 동의서'가 보이면 서비스를 잘못 이해한다
    only: "merchant",
    title: "상인회 가입 동의서",
    summary: "회원 가입 — 회칙 준수·개인정보 수집·이용 동의",
    ordered: 0,
    body: `상인회 가입 동의서

본인은 {{상인회명}} 의 회원으로 가입함에 있어 아래 사항에 동의합니다.

1. 회칙의 준수
   본인은 {{상인회명}} 의 회칙 및 총회·이사회의 결의사항을 성실히 준수합니다.

2. 회비의 납부
   본인은 월 회비 금 {{월회비}} 원을 매월 납부합니다.
   회비는 상인회 공동사업(공동구매·홍보·행사·환경개선 등)에 사용됩니다.

3. 개인정보의 수집·이용 동의
   가. 수집 항목  성명, 연락처, 이메일, 상호, 사업장 주소, 업종
   나. 수집 목적  회원 관리, 회비 정산, 공지·행사 안내, 상인회 홈페이지 게재
   다. 보유 기간  회원 자격 유지 기간 및 탈퇴 후 관계 법령이 정한 기간
   라. 동의를 거부할 권리가 있으나, 거부 시 회원 가입 및 회원 서비스 이용이 제한됩니다.

4. 홈페이지 게재 동의
   본인은 상호·업종·연락처·영업시간·사진이 상인회 홈페이지에 게재되는 것에 동의합니다.
   게재를 원하지 않는 항목은 언제든지 삭제를 요청할 수 있습니다.

5. 안내 수신 동의
   본인은 공지·행사·회비 안내를 문자·카카오 알림톡·이메일로 받는 것에 동의합니다.

가입 신청인   상호 {{상호}}   업종 {{업종}}

위 내용을 모두 확인하였으며, 이에 동의합니다.`,
    parties: ["가입 신청인"],
    fields: [
      { kind: "check", label: "위 내용에 동의합니다", page: -1, x: 0.10, y: 0.55, w: 0.035, h: 0.026, party: 0, required: 1 },
      ...partyRows(["가입 신청인"]),
    ],
  },
];

export const builtinById = (id) => BUILTIN.find((t) => t.id === id) || null;
// 조직 유형에 맞는 내장 서식만. only 가 없으면 어디서나 쓰는 범용 서식이다.
// (URL 로 직접 부른 경우까지 막지는 않는다 — 남의 조직 데이터가 아니라 빈 서식일 뿐이다)
export const builtinsFor = (kind) => BUILTIN.filter((t) => !t.only || t.only === (kind || "merchant"));
export const isBuiltinId = (id) => typeof id === "string" && id.startsWith("b-");

// 서식 → 화면에 보여줄 공통 모양 (내장·저장분을 한 목록으로 다루기 위함)
export function normalizeTemplate(t) {
  if (!t) return null;
  const builtin = isBuiltinId(t.id);
  let fields = [];
  if (builtin) fields = t.fields || [];
  else { try { fields = JSON.parse(t.fields || "[]"); } catch { fields = []; } }
  let parties = [];
  if (builtin) parties = t.parties || [];
  else { try { parties = JSON.parse(t.parties || "[]"); } catch { parties = []; } }
  return {
    id: t.id, title: t.title, body: t.body, ordered: t.ordered ? 1 : 0,
    summary: t.summary || "", builtin, fields, parties,
    vars: extractVars(t.body),
  };
}
