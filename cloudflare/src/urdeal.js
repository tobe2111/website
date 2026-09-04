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
// ── 없는 것
//   지역·상인회 단위 조회, 여러 가게 한 번에 조회, 웹훅.
//   그래서 가게마다 한 번씩 부른다. 점포가 늘면 호출도 느는 구조라 캐시가 필수다.
//
// 나중에 유어딜에 seller_ids=1,2,3 같은 필터가 생기면 이 파일만 고치면 된다.

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
    sellerId: Number(sellerId) || num(raw.seller_id),
  };
}

async function fetchSeller(env, sellerId, signal) {
  const url = `${urdealBase(env)}/api/products?deal_only=1&seller_id=${Number(sellerId)}&limit=${PER_SELLER}&sort=discount`;
  const r = await fetch(url, { signal, headers: { accept: "application/json" }, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) return [];
  const j = await r.json();
  const rows = Array.isArray(j && j.data) ? j.data : [];
  return rows.map((x) => normalize(x, sellerId)).filter(Boolean);
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
