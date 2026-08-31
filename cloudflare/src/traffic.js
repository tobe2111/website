// 랜딩 트래픽을 "셀 것인가" 판단하는 한 곳.
//
// 방문 수와 전화 클릭은 둘 다 전환율의 재료라, 잣대가 다르면 숫자끼리 비교가 안 된다.
// 그래서 판단 규칙을 여기 한 벌만 두고 페이지(GET)와 집계 엔드포인트(POST)가 함께 쓴다.
//
// ① 검색·SNS 크롤러는 손님이 아니다 — 세면 전환율의 분모만 부풀어 광고 판단이 틀어진다.
// ② 새로고침 연타·스크립트 반복은 한 번으로 본다. 창을 짧게(1분) 잡은 이유가 있다 —
//    국내 모바일은 CGNAT 라 IP 하나를 여러 사람이 쓴다. 길게 잡으면 서로 다른 방문자가
//    한 명으로 합쳐져 분모가 줄고, 전환율이 실제보다 좋아 보인다.
import * as D from "./db.js";
import { parseCookies } from "./util.js";

const BOT_UA = /bot|crawler|spider|crawling|facebookexternalhit|slurp|bingpreview|headlesschrome|curl|wget|python-requests/i;
const DEDUPE_MS = 60 * 1000;
const seen = new Map();

// kind 로 방문·전화를 따로 센다. 같은 열쇠를 쓰면 랜딩을 연 뒤 곧바로 전화를 누른
// 정상 흐름에서 전화 클릭이 통째로 버려진다 — 그게 가장 흔한 경로인데도.
export function countable(ctx, variant, kind = "view") {
  let ua = "";
  try { ua = ctx.request.headers.get("user-agent") || ""; } catch {}
  if (!ua || BOT_UA.test(ua)) return false;
  const key = `${kind}|${ctx.assoc.id}|${variant}|${ctx.ip}`;
  const now = Date.now(), last = seen.get(key);
  if (last && now - last < DEDUPE_MS) return false;
  if (seen.size > 10000) seen.clear(); // 메모리 상한 — 정확도보다 안전이 먼저다
  seen.set(key, now);
  return true;
}

// ---------- 상인회 홈 A/B 귀속 ----------
// 손님은 홈에서 곧장 입점 신청하지 않는다. 가게를 눌러 보고, 검색해 보고, 며칠 뒤에 움직인다.
// 그 여정을 이어 붙이지 않으면 "어느 홈이 실제로 신청을 만들었나" 를 영원히 알 수 없다.
// 그래서 홈에 들어온 순간 '어느 사본이었는지' 한 조각만 30분 기억한다.
// 개인을 식별하는 값이 아니고, 그 조직 주소 안에서만 쓰이며, 30분 뒤 스스로 사라진다.
export const HOME_VARIANT_COOKIE = "sc_hv";
export const homeVariantCookie = (v, base, isProd) => {
  const path = base || "/";
  const flags = `Path=${path}; SameSite=Lax; Max-Age=1800${isProd ? "; Secure" : ""}`;
  return v ? `${HOME_VARIANT_COOKIE}=${encodeURIComponent(v)}; ${flags}`
           : `${HOME_VARIANT_COOKIE}=; Path=${path}; SameSite=Lax; Max-Age=0`;
};
// 지금 방문이 어느 사본에 속하는지. 없으면 기본 홈("").
export function homeVariantOf(ctx) {
  try {
    const raw = parseCookies(ctx.request.headers.get("cookie") || "")[HOME_VARIANT_COOKIE] || "";
    return decodeURIComponent(raw).slice(0, 40).replace(/[^a-z0-9-]/g, "");
  } catch { return ""; }
}
// 성과 하나를 지금 방문이 속한 사본 앞으로 적는다.
// 봇·연타를 거르는 잣대는 방문 수와 같은 것을 써야 비율끼리 비교가 된다.
export async function countHomeGoal(ctx, goal) {
  try {
    const v = homeVariantOf(ctx);
    if (countable(ctx, v, goal)) await D.bumpHomeGoal(ctx.db, ctx.assoc.id, v, goal);
  } catch {}
}
