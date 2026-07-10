// 요금제(플랜) 한도 정의 — 슈퍼가 상인회별로 플랜을 지정. 결제 연동은 향후.
// 무료도 넉넉하게(소프트캡) 두어 기존 사이트가 막히지 않게 함. 필요 시 값만 조정.
export const PLANS = {
  free:  { label: "무료",   maxMembers: 1000,     maxPhotos: 50,       maxEmbeds: 30,       customDomain: true },
  basic: { label: "베이직", maxMembers: 5000,     maxPhotos: 200,      maxEmbeds: 100,      customDomain: true },
  pro:   { label: "프로",   maxMembers: Infinity, maxPhotos: Infinity, maxEmbeds: Infinity, customDomain: true },
};
export const PLAN_KEYS = Object.keys(PLANS);
export const planOf = (assoc) => PLANS[(assoc && assoc.plan)] || PLANS.free;
export const planLabel = (assoc) => planOf(assoc).label;
