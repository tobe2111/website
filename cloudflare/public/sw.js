// 서비스 워커 — 정적 자산 캐시 우선 + 페이지 네트워크 우선(오프라인 폴백)
const CACHE = "scm-v1";
const CORE = ["/css/app.css", "/js/app.js", "/img/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // 미디어·관리 경로는 캐시하지 않음
  if (url.pathname.startsWith("/media/") || url.pathname.startsWith("/admin") || url.pathname.startsWith("/super") || url.pathname.startsWith("/dashboard")) return;
  // 정적 자산: 캐시 우선
  if (/\.(css|js|svg|png|jpe?g|webp|ico|woff2?)$/.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return res; })));
    return;
  }
  // 페이지: 네트워크 우선 → 실패 시 캐시 → 오프라인 안내
  e.respondWith(fetch(req).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return res; })
    .catch(() => caches.match(req).then((r) => r || new Response("<!doctype html><meta charset=utf-8><title>오프라인</title><body style='font-family:sans-serif;text-align:center;padding:80px'><h1>오프라인</h1><p>인터넷 연결을 확인해 주세요.</p>", { headers: { "content-type": "text/html; charset=utf-8" } }))));
});
