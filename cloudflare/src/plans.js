// 요금제(플랜) 한도 정의 — 슈퍼가 상인회별로 플랜을 지정. 결제 연동은 향후.
// 무료도 넉넉하게(소프트캡) 두어 기존 사이트가 막히지 않게 함. 필요 시 값만 조정.
export const PLANS = {
  free:  { label: "무료",   maxMembers: 1000,     maxPhotos: 50,       maxEmbeds: 30,       maxProducts: 20,       customDomain: true },
  basic: { label: "베이직", maxMembers: 5000,     maxPhotos: 200,      maxEmbeds: 100,      maxProducts: 60,       customDomain: true },
  pro:   { label: "프로",   maxMembers: Infinity, maxPhotos: Infinity, maxEmbeds: Infinity, maxProducts: Infinity, customDomain: true },
};
export const PLAN_KEYS = Object.keys(PLANS);
export const planOf = (assoc) => PLANS[(assoc && assoc.plan)] || PLANS.free;
export const planLabel = (assoc) => planOf(assoc).label;

// 월 요금은 코드에 박지 않는다 — 얼마에 팔지는 운영사가 정하는 일이고,
// 코드에 숫자를 넣어 두면 화면에는 뜨는데 실제로는 안 받는 값이 되기 쉽다.
// 운영사 콘솔에서 넣은 값만 화면에 나오고, 안 넣으면 요금 안내 자체가 나오지 않는다.
export const planPriceKey = (k) => `plan_price:${k}`;
export async function planPrices(getSetting, db) {
  const out = {};
  for (const k of PLAN_KEYS) {
    const raw = await getSetting(db, planPriceKey(k));
    const n = parseInt(raw || "", 10);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

