// 랜딩 트래픽을 "셀 것인가" 판단하는 한 곳.
//
// 방문 수와 전화 클릭은 둘 다 전환율의 재료라, 잣대가 다르면 숫자끼리 비교가 안 된다.
// 그래서 판단 규칙을 여기 한 벌만 두고 페이지(GET)와 집계 엔드포인트(POST)가 함께 쓴다.
//
// ① 검색·SNS 크롤러는 손님이 아니다 — 세면 전환율의 분모만 부풀어 광고 판단이 틀어진다.
// ② 새로고침 연타·스크립트 반복은 한 번으로 본다. 창을 짧게(1분) 잡은 이유가 있다 —
//    국내 모바일은 CGNAT 라 IP 하나를 여러 사람이 쓴다. 길게 잡으면 서로 다른 방문자가
//    한 명으로 합쳐져 분모가 줄고, 전환율이 실제보다 좋아 보인다.
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
