// 서비스 워커 — v2: 캐시명 교체(구버전 CSS 박제 퍼지) + 재검증 전략
// CSS/JS 는 배포마다 주소가 바뀌므로(?v=배포ID) 캐시 우선이 안전하고,
// 응답 후 백그라운드 재검증(stale-while-revalidate)로 이중 안전망.
const CACHE = "scm-v2";
const CORE = ["/img/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// 같은 경로의 옛 버전(?v=이전배포) 캐시 청소
async function putAndClean(cache, req, res) {
  const path = new URL(req.url).pathname;
  const keys = await cache.keys();
  await Promise.all(keys.filter((k) => new URL(k.url).pathname === path && k.url !== req.url).map((k) => cache.delete(k)));
  await cache.put(req, res);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/media/") || url.pathname.startsWith("/admin") || url.pathname.startsWith("/super") || url.pathname.startsWith("/dashboard")) return;
  // 정적 자산: 캐시 응답 + 백그라운드 재검증
  if (/\.(css|js|svg|png|jpe?g|webp|ico|woff2?)$/.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const refresh = fetch(req).then((res) => { if (res.ok) putAndClean(c, req, res.clone()); return res; }).catch(() => null);
      return hit || refresh.then((r) => r || new Response("", { status: 504 }));
    }));
    return;
  }
  // 페이지: 네트워크 우선 → 실패 시 캐시 → 오프라인 안내
  e.respondWith(fetch(req).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return res; })
    .catch(() => caches.match(req).then((r) => r || new Response("<!doctype html><meta charset=utf-8><title>오프라인</title><body style='font-family:sans-serif;text-align:center;padding:80px'><h1>오프라인</h1><p>인터넷 연결을 확인해 주세요.</p>", { headers: { "content-type": "text/html; charset=utf-8" } }))));
});
