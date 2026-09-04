// 제품 유형(kind) 레지스트리 — 한 엔진 위에서 여러 제품을 굽기 위한 단일 정의 지점.
//
// 예전에는 `assoc.kind === "esign"` 같은 분기가 pages·api·render·db 에 흩어져 있었다.
// 제품을 하나 더 만들 때마다 열 군데를 고쳐야 했고, 한 군데를 빠뜨리면 그 화면만 남의 제품처럼
// 보였다. 이제 화면 구성의 판단은 전부 여기서 내리고, 나머지 파일은 이 표를 읽기만 한다.
//
// ── 새 제품 유형을 추가하려면 ────────────────────────────────────────────
//   1) 아래 KINDS 에 항목 하나를 더한다 (라벨·메뉴·콘솔 스위치·기본 문구).
//   2) 랜딩형(lead 수집) 제품이면 PRESETS 에 업종 문구 한 벌을 더한다. 그게 전부다.
//   문서: docs/새-제품-유형-추가하기.md
// ─────────────────────────────────────────────────────────────────────

// 랜딩형 제품의 업종 프리셋 — 화면 구조는 같고 '말'만 다르다.
// terms 는 메뉴·버튼·관리자 화면 문구에 그대로 쓰인다("가맹 상담" ↔ "입학 상담").
export const PRESETS = {
  franchise: {
    label: "프랜차이즈 가맹점 모집",
    terms: { consult: "가맹 상담", unit: "가맹점", store: "매장", applicant: "예비 점주", cost: "가맹 비용", process: "가맹 절차" },
    tagline: "함께 성장할 가맹점주를 찾습니다",
    hero: { eyebrow: "가맹점 모집", title: "창업, 결국\n쉬워야 합니다", highlight: "쉬워야",
      subtitle: "{name}는 어려운 과정을 본사가 대신합니다. 점주는 매장에만 집중하세요.",
      ctaLabel: "가맹 상담 신청하기", note: "상담은 무료이며, 남겨주신 연락처로만 연락드립니다." },
    ticker: "본사 직영 물류\n오픈 전 교육 지원\n상권 분석 무료\n1:1 전담 슈퍼바이저",
    why: { title: "왜 {name}일까요?",
      body: "유행을 따라가는 브랜드는 유행과 함께 사라집니다.\n{name}는 오래 버티는 매장을 만드는 데 필요한 것만 남겼습니다.\n\n적은 인원으로 돌아가는 동선, 흔들리지 않는 원가, 그리고 문을 연 뒤에도 계속되는 본사의 관리 — 창업의 성패를 가르는 건 결국 이 세 가지입니다." },
    strengths: { title: "창업의 벽을 낮추는 네 가지",
      items: "1인 운영 설계 | 동선과 공정을 줄여 최소 인원으로 돌아갑니다\n검증된 레시피 | 짧은 교육으로 어느 매장에서나 같은 품질이 나옵니다\n본사 직배송 | 원가가 고정되어 마진이 계절을 타지 않습니다\n오픈 후 관리 | 슈퍼바이저가 매출·재고·인력까지 함께 봅니다" },
    reviews: { title: "점주님들이 직접 말씀해 주셨습니다", lead: "실제 운영 중인 가맹점의 이야기입니다." },
    menu: { title: "메뉴 라인업" },
    process: { title: "가맹 절차", lead: "상담부터 오픈까지 평균 6~8주가 걸립니다.",
      items: "가맹 상담 | 전화·방문 상담으로 조건과 예산을 확인합니다\n상권 분석 | 후보 자리의 유동인구·경쟁 현황을 함께 봅니다\n가맹 계약 | 조건을 확정하고 계약서를 씁니다\n매장 공사 | 설계·시공·간판까지 본사가 붙습니다\n교육 · 오픈 준비 | 운영을 교육하고 시뮬레이션합니다\n오픈 · 사후 관리 | 오픈 동행 후 슈퍼바이저가 정기 방문합니다" },
    cost: { title: "가맹 비용", note: "위 금액은 표준 기준이며 매장 면적·지역·현장 여건에 따라 달라질 수 있습니다." },
    lead: { title: "가맹 상담 신청", lead: "연락처를 남겨주시면 담당자가 순차적으로 연락드립니다.",
      budgets: "5천만원 이하\n5천만원 ~ 1억원\n1억원 ~ 2억원\n2억원 이상\n아직 미정",
      regionLabel: "희망 지역", budgetLabel: "창업 예산" },
    stores: { title: "매장 안내" },
    faq: { items: "외식업 경험이 없어도 되나요? | 대부분의 점주님이 첫 창업입니다. 교육과 오픈 동행으로 시작하니 경험이 없어도 괜찮습니다.\n창업 비용은 얼마나 드나요? | 매장 면적과 지역에 따라 달라집니다. 상담을 신청하시면 조건에 맞춘 견적을 보내드립니다.\n상담을 신청하면 바로 계약해야 하나요? | 아닙니다. 상담은 정보를 확인하는 자리이며 계약과는 무관합니다." },
    cta: { title: "지금이 가장 빠른 때입니다", body: "고민하는 사이에도 좋은 자리는 나갑니다. 상담은 무료입니다." },
  },
  academy: {
    label: "학원 · 교습소 상담",
    terms: { consult: "입학 상담", unit: "캠퍼스", store: "캠퍼스", applicant: "학부모", cost: "수강료", process: "등록 절차" },
    tagline: "아이에게 맞는 공부를 찾아드립니다",
    hero: { eyebrow: "신입생 모집", title: "성적은\n방법이 바꿉니다", highlight: "방법이",
      subtitle: "{name}는 아이마다 다른 구멍을 먼저 찾습니다. 진도가 아니라 이해가 기준입니다.",
      ctaLabel: "상담 신청하기", note: "상담은 무료이며, 남겨주신 연락처로만 연락드립니다." },
    ticker: "1:1 학습 진단\n담임 선생님 배정\n주간 학습 리포트\n소수 정예 수업",
    why: { title: "왜 {name}일까요?",
      body: "같은 수업을 들어도 결과가 다른 이유는 출발점이 다르기 때문입니다.\n{name}는 시작 전에 아이가 어디서 막히는지부터 확인합니다.\n\n진단 → 맞춤 커리큘럼 → 주간 점검. 이 흐름이 반복되면 성적은 따라옵니다." },
    strengths: { title: "{name}가 다른 네 가지",
      items: "학습 진단 | 시작 전에 아이가 막히는 지점을 정확히 찾습니다\n소수 정예 | 선생님 한 명이 보는 학생 수를 제한합니다\n주간 리포트 | 무엇을 했고 무엇이 남았는지 매주 알려드립니다\n담임제 | 진도·태도·컨디션까지 한 사람이 이어서 봅니다" },
    reviews: { title: "학부모님들이 직접 남겨주셨습니다", lead: "재원 중인 학생 가정의 이야기입니다." },
    menu: { title: "개설 강좌" },
    process: { title: "등록 절차", lead: "상담부터 첫 수업까지 보통 일주일이면 됩니다.",
      items: "상담 신청 | 학년과 고민을 알려주세요\n학습 진단 | 현재 수준과 막히는 지점을 확인합니다\n반 배정 안내 | 아이에게 맞는 반과 시간표를 제안합니다\n수업 참관 | 원하시면 한 차시를 직접 보실 수 있습니다\n등록 · 첫 수업 | 교재와 학습 계획을 함께 드립니다" },
    cost: { title: "수강료 안내", note: "학년·과목·주당 횟수에 따라 다릅니다. 형제 할인과 교재비 포함 여부는 상담 시 안내드립니다." },
    lead: { title: "입학 상담 신청", lead: "연락처를 남겨주시면 상담 선생님이 연락드립니다.",
      budgets: "초등\n중등\n고등\n재수·N수\n기타",
      regionLabel: "거주 지역", budgetLabel: "학년" },
    stores: { title: "캠퍼스 안내" },
    faq: { items: "중간에 반을 바꿀 수 있나요? | 가능합니다. 진단 결과와 수업 반응을 보고 담임 선생님과 함께 조정합니다.\n수강료는 어떻게 되나요? | 학년·과목·횟수에 따라 다릅니다. 상담 시 정확한 금액을 안내드립니다.\n결석하면 보강이 되나요? | 사전에 알려주시면 보강 일정을 잡아드립니다." },
    cta: { title: "지금 학년이 가장 빠른 때입니다", body: "다음 시험이 아니라 지금 구멍부터 막아야 합니다. 상담은 무료입니다." },
  },
  fitness: {
    label: "헬스장 · 필라테스 회원 모집",
    terms: { consult: "등록 상담", unit: "지점", store: "지점", applicant: "회원", cost: "이용 요금", process: "등록 절차" },
    tagline: "오래 다니는 운동을 시작하세요",
    hero: { eyebrow: "회원 모집", title: "운동은\n버티는 사람이 이깁니다", highlight: "버티는",
      subtitle: "{name}는 3개월 뒤에도 나오게 만드는 것에 집중합니다.",
      ctaLabel: "등록 상담 신청하기", note: "상담은 무료이며, 남겨주신 연락처로만 연락드립니다." },
    ticker: "1:1 체형 분석\n전문 트레이너 상주\n샤워실·주차 완비\n첫 방문 체험" },
  clinic: {
    label: "병원 · 클리닉 상담",
    terms: { consult: "진료 상담", unit: "지점", store: "지점", applicant: "환자", cost: "비용 안내", process: "진료 절차" },
    tagline: "충분히 듣고, 정확히 봅니다",
    hero: { eyebrow: "진료 안내", title: "설명이\n치료의 절반입니다", highlight: "설명이",
      subtitle: "{name}는 무엇을 왜 하는지 먼저 설명합니다.",
      ctaLabel: "상담 예약하기", note: "남겨주신 연락처로만 연락드리며, 진료 목적 외에 사용하지 않습니다." },
    ticker: "충분한 상담 시간\n최신 장비\n예약제 운영\n주차 가능" },
  realestate: {
    label: "분양 · 부동산 문의",
    terms: { consult: "분양 상담", unit: "현장", store: "현장", applicant: "수요자", cost: "분양가", process: "청약 절차" },
    tagline: "좋은 자리는 먼저 움직인 사람에게 갑니다",
    hero: { eyebrow: "분양 안내", title: "입지가\n전부입니다", highlight: "입지가",
      subtitle: "{name}의 위치·구성·조건을 한 장에 정리했습니다.",
      ctaLabel: "분양 상담 신청하기", note: "상담은 무료이며, 남겨주신 연락처로만 연락드립니다." },
    ticker: "역세권 입지\n특화 설계\n계약 조건 상담\n현장 방문 안내" },
};
export const PRESET_KEYS = Object.keys(PRESETS);
export const DEFAULT_PRESET = "franchise";
export const presetOf = (id) => PRESETS[id] || PRESETS[DEFAULT_PRESET];
// 프리셋이 문구를 안 채운 섹션은 대표 프리셋(프랜차이즈)의 것을 빌려 쓴다.
// 업종 하나 추가하려고 스무 개 문단을 다 쓰게 만들면 아무도 추가하지 않는다.
export const presetText = (id, path, fallback = "") => {
  const [sec, key] = path.split(".");
  const p = presetOf(id), base = PRESETS[DEFAULT_PRESET];
  const v = (p[sec] && p[sec][key]) ?? (base[sec] && base[sec][key]);
  return v === undefined || v === null ? fallback : v;
};
export const termsOf = (id) => ({ ...PRESETS[DEFAULT_PRESET].terms, ...(presetOf(id).terms || {}) });

// ── 제품 유형 ────────────────────────────────────────────────────────
// console: 관리자 콘솔에 어떤 패널을 띄울지. 새 제품은 이 스위치만 정하면 된다.
export const KINDS = {
  merchant: {
    id: "merchant", label: "상인회", badge: "badge-muted", orgWord: "상인회",
    createHint: "점포·지도·공지 홈페이지 + 전자계약",
    tagline: "함께 성장하는 우리 동네 상권",
    home: "merchant", nav: "merchant",
    selfRegister: true, usesLanding: false,
    console: { businesses: true, products: true, dues: true, homeLayout: true, content: true,
      polls: true, invite: true, proxyAdd: true, staff: false, landing: false, leads: false },
    dashTitle: "상인회 관리", siteWord: "홈페이지",
  },
  esign: {
    id: "esign", label: "전자계약", createLabel: "전자계약 전용", badge: "badge-info", orgWord: "조직",
    createHint: "계약만 (법무·부동산 등)",
    tagline: "종이 없이, 만나지 않고, 법적 효력 있는 계약",
    home: "esign", nav: "esign",
    selfRegister: false, usesLanding: false,
    console: { businesses: false, products: false, dues: false, homeLayout: false, content: false,
      polls: false, invite: false, proxyAdd: false, staff: true, landing: false, leads: false },
    dashTitle: "전자계약 관리", siteWord: "계약 창구",
  },
  franchise: {
    id: "franchise", label: "프랜차이즈", badge: "badge-brand", orgWord: "브랜드",
    createHint: "가맹점·회원 모집 랜딩페이지 + 상담 DB",
    tagline: "함께 성장할 가맹점주를 찾습니다",
    home: "landing", nav: "landing",
    selfRegister: false, usesLanding: true,
    console: { businesses: true, products: true, dues: false, homeLayout: false, content: true,
      polls: false, invite: true, proxyAdd: true, staff: false, landing: true, leads: true },
    dashTitle: "가맹 모집 관리", siteWord: "랜딩페이지",
  },
};
export const KIND_KEYS = Object.keys(KINDS);
export const DEFAULT_KIND = "merchant";
export const kindById = (id) => KINDS[id] || KINDS[DEFAULT_KIND];
export const kindOf = (assoc) => kindById(assoc && assoc.kind);
// 조직이 쓰는 업종 문구 (랜딩형이 아니면 프리셋은 의미가 없다)
export const assocTerms = (assoc) => termsOf(assoc && assoc.preset);

// ── 상권 색 테마 ───────────────────────────────────────────────────────
//
// 예전에는 관리자 화면에 색 고르는 네모 하나만 있었습니다. 그 네모는 1,600만 가지를 고를 수 있고,
// 어느 것이 우리 골목에 어울리는지는 아무 말도 해 주지 않습니다. 실제로 상인회 담당자가
// 고르기 좋은 것은 "우리는 카페 골목이다" 같은 **상권의 성격**이지 색 이름이 아닙니다.
//
// 그래서 상권 유형별로 한 벌씩 골라 둡니다. 모두 흰 글자를 얹었을 때 WCAG AA(4.5:1)를 넘습니다
// — 나머지 밝기 단계와 글자색은 이 색에서 자동으로 파생되므로(app.css · render.js),
// 여기 있는 색을 고르는 한 화면 어디에서도 글자가 안 읽히는 일이 생기지 않습니다.
// 색 네모는 그대로 남습니다. 이건 고르기 어려운 사람을 위한 출발점입니다.
export const AREA_THEMES = [
  { id: "cafe", color: "#6F4423", label: "카페 골목", hint: "원두빛 갈색 — 카페·디저트가 많은 골목" },
  { id: "caramel", color: "#8A5A33", label: "베이커리 · 캐러멜", hint: "밝은 갈색 — 빵집·브런치가 많은 거리" },
  { id: "market", color: "#B4442B", label: "전통시장", hint: "차양 주홍 — 장이 서는 활기찬 시장" },
  { id: "food", color: "#8E2F3E", label: "먹자골목", hint: "짙은 팥색 — 식당이 모인 골목" },
  { id: "culture", color: "#14655F", label: "문화 · 예술거리", hint: "이끼 청록 — 공방·책방·갤러리" },
  { id: "green", color: "#1F6B3F", label: "동네 상점가", hint: "솔잎 초록 — 생활 밀착 근린상권" },
  { id: "city", color: "#1F6CFF", label: "도심 상권", hint: "앱 블루 — 오피스가·신도시 (기본값)" },
  { id: "ink", color: "#2F3437", label: "차분한 먹빛", hint: "색을 앞세우지 않는 단정한 화면" },
];
