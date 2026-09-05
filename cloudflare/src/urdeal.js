// 유어딜(live.ur-team.com) 에서 우리 골목 가게의 이용권을 가져온다.
//
// 왜 이 파일이 따로 있는가 — 남의 서비스를 부르는 곳은 한 군데로 모은다.
// 그 서비스가 느려지거나 죽었을 때 우리 홈이 같이 죽으면 안 되고, 그 판단을
// 화면 코드 여기저기에 흩어 놓으면 어느 한 군데를 빠뜨리게 된다.
//
// ── 유어딜이 열어 둔 것 (인증 없이 GET · 유어딜 쪽 60초 캐시)
//   GET /api/products?deal_only=1&seller_id=<번호>&limit=<n>
//     → { success, data: [{ id, name, description, price, original_price,
//                           discount_rate, image_url, stock, seller_name, sold_count }] }
//
// ── 없는 것 (2026-09-05 실제 호출로 확인)
//   지역·상인회 단위 조회, 여러 가게 한 번에 조회, 웹훅.
//   그래서 가게마다 한 번씩 부른다. 점포가 늘면 호출도 느는 구조라 캐시가 필수다.
//
// ⚠️ 여기서 조심할 것 — **거르개가 조용히 무시된다.**
//   seller_id 에 숫자가 아닌 값을 주면(예: "1,2") 유어딜은 오류를 내지 않고
//   **거르지 않은 전체 목록**을 돌려준다. 실제로 재 봤다:
//     seller_id=1     → 0건
//     seller_id=1,2   → 100건 (남의 가게 것 전부)
//     seller_ids=1,2  → 100건 (그런 이름의 칸이 없어 그냥 무시)
//   그래서 "호출을 줄이자" 며 번호를 쉼표로 이어 붙이면, 상인회 홈에
//   **우리 골목과 아무 상관 없는 상품이 우리 가게 이름을 달고 걸린다.**
//   1) 주소를 만들기 전에 양의 정수인지 확인하고,
//   2) 돌아온 줄이 그 가게 것이 맞는지 다시 본다.
//   둘 다 둔다 — 하나는 우리 실수를 막고, 하나는 남의 변경을 막는다.
//
// 나중에 유어딜에 여러 가게를 한 번에 부르는 칸이 생기면 이 파일만 고치면 된다.
// 무엇이 필요한지는 docs/urdeal-api-request.md 에 적어 두었다.

const DEFAULT_BASE = "https://live.ur-team.com";
const CACHE_TTL = 600;        // 우리 쪽 10분. 이용권 값은 분 단위로 바뀌지 않는다.
const PER_SELLER = 3;         // 한 가게에서 몇 개까지 가져올지
const TIMEOUT_MS = 2500;      // 유어딜이 느리면 홈이 같이 느려진다 — 여기서 끊는다
const MAX_SELLERS = 12;       // 홈에 걸 카드는 어차피 몇 장이다. 호출을 무제한으로 늘리지 않는다

export const urdealBase = (env) => String((env && env.URDEAL_BASE) || DEFAULT_BASE).replace(/\/+$/, "");
// 손님이 이용권을 사러 가는 자리. 상품 상세가 우리가 아는 유일한 공개 주소다.
export const urdealProductUrl = (env, id) => `${urdealBase(env)}/products/${Number(id) || 0}`;
export const urdealSellerUrl = (env, id) => `${urdealBase(env)}/seller/${Number(id) || 0}`;

// 남의 서비스가 준 값이므로 우리가 쓰는 모양만 남기고 전부 다시 만든다.
// (그대로 화면에 흘리면 유어딜이 필드를 하나 늘릴 때 우리 화면이 같이 흔들린다.)
function normalize(raw, sellerId) {
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const id = num(raw && raw.id);
  const name = String((raw && raw.name) || "").trim().slice(0, 120);
  if (!id || !name) return null;
  const price = num(raw.price);
  const was = num(raw.original_price);
  return {
    id, name, price,
    was: was > price ? was : 0,                      // 정가가 판매가보다 낮으면 표시하지 않는다
    off: was > price ? Math.round((1 - price / was) * 100) : 0,
    image: /^https?:\/\//.test(String(raw.image_url || "")) ? String(raw.image_url).slice(0, 500) : "",
    shop: String(raw.seller_name || "").trim().slice(0, 60),
    sold: num(raw.sold_count),
    // 유어딜이 말한 번호를 먼저 믿는다. 우리가 요청에 쓴 번호를 그대로 붙이면,
    // 거르개가 무시됐을 때 남의 상품에 우리 가게 번호를 달게 된다.
    sellerId: num(raw.seller_id) || Number(sellerId) || 0,
  };
}

// 양의 정수만 통과. "1,2" 같은 값이 주소에 실리면 유어딜이 거르개를 통째로 무시한다.
const sellerNo = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : 0;
};
// 돌아온 줄이 정말 그 가게 것인가.
// 번호가 적혀 있는데 다르면 버린다 — 거르개가 무시된 응답이다.
// 번호가 비어 있으면(플랫폼 상품이 그렇다) 가게 것이 아니므로 역시 버린다.
export function belongsToSeller(raw, sellerId) {
  const want = sellerNo(sellerId);
  const got = sellerNo(raw && raw.seller_id);
  return !!want && got === want;
}

async function fetchSeller(env, sellerId, signal) {
  const id = sellerNo(sellerId);
  if (!id) return [];
  const url = `${urdealBase(env)}/api/products?deal_only=1&seller_id=${id}&limit=${PER_SELLER}&sort=discount`;
  const r = await fetch(url, { signal, headers: { accept: "application/json" }, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) return [];
  const j = await r.json();
  const rows = Array.isArray(j && j.data) ? j.data : [];
  return rows.filter((x) => belongsToSeller(x, id)).map((x) => normalize(x, id)).filter(Boolean);
}

// 여러 가게의 이용권을 한 벌로. 한 가게가 실패해도 나머지는 그대로 나온다 —
// 유어딜이 죽었다고 상인회 홈이 비면 안 된다.
export async function fetchDeals(env, sellerIds) {
  const ids = [...new Set((sellerIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))].slice(0, MAX_SELLERS);
  if (!ids.length) return [];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const chunks = await Promise.all(ids.map((id) => fetchSeller(env, id, ac.signal).catch(() => [])));
    // 할인율이 큰 것부터 — 손님이 먼저 보는 자리에 가장 값싼 것이 와야 한다
    return chunks.flat().sort((a, b) => b.off - a.off || b.sold - a.sold);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// 캐시를 씌운 것. 홈은 손님이 여는 화면이라 매번 남의 서버를 8번 부를 수 없다.
// Cache API 가 없는 환경(테스트·로컬)에서는 그냥 통과시킨다.
export async function deals(env, sellerIds, { ttl = CACHE_TTL } = {}) {
  const key = [...new Set((sellerIds || []).map(Number).filter(Boolean))].sort((a, b) => a - b).join(",");
  if (!key) return [];
  const cacheUrl = `https://urdeal.cache.local/deals?s=${encodeURIComponent(key)}`;
  let cache = null;
  try { cache = typeof caches !== "undefined" && caches.default ? caches.default : null; } catch { cache = null; }
  if (cache) {
    const hit = await cache.match(cacheUrl).catch(() => null);
    if (hit) { try { return await hit.json(); } catch { /* 깨진 캐시는 무시하고 다시 가져온다 */ } }
  }
  const out = await fetchDeals(env, sellerIds);
  // 빈 결과도 캐시한다 — 안 그러면 이용권이 하나도 없는 상인회가 홈을 열 때마다 8번씩 부른다.
  if (cache) {
    await cache.put(cacheUrl, new Response(JSON.stringify(out), {
      headers: { "content-type": "application/json", "cache-control": `max-age=${ttl}` },
    })).catch(() => {});
  }
  return out;
}
