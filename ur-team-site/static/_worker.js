// 블로그 조회수 창구 (Cloudflare Pages) + homepage.ur-team.com 다리.
// _routes.json 이 정적 페이지 폴더(/blog/*, /marketing/* …)는 빼고 나머지만 이 파일을 거치게 한다.
// 다리는 주소(호스트)로 갈라야 해서 경로만으로는 못 가르지만, 홈페이지 제작 엔진이 쓰지 않는 폴더는 빼도 된다.
// 그래야 방문 대부분(블로그 · 사업 페이지)이 이 프로그램을 거치지 않아 무료 한도(하루 10만 번)를 아낀다.
// 엔진이 쓰는 경로(/, /service, /apply, /login, /css, /js, /img, /api …)는 빼면 안 된다.
// ur-team.com 의 /api/views 외 요청은 곧바로 정적 파일(env.ASSETS)로 넘긴다.
// 저장소: Pages 프로젝트 설정 → 바인딩에 KV 이름 공간을 'VIEWS' 로 연결해야 실제로 센다(연결 전엔 0으로 답한다).
//   GET  /api/views        → { "글주소": 실제조회수, ... }  (5분 동안 가장자리 캐시)
//   POST /api/views?s=글주소 → 그 글 조회수 +1
const OK = (s) => /^(en\/)?[0-9a-z-]{5,120}$/.test(s);
const J = (o, cache) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache || "no-store" } });

// ── homepage.ur-team.com → 홈페이지 제작 서비스 사이트(결제가 일어나는 엔진)로 이어 주는 다리
// 결제대행사(카드사) 심사는 주소에 dev · test 가 들어가면 반려한다. 엔진의 기본 주소가 *.workers.dev 라서,
// 이 Pages 프로젝트에 homepage.ur-team.com 을 연결하고 그 주소로 온 요청만 엔진으로 넘긴다.
// ur-team.com 본 사이트는 이 분기를 타지 않는다(주소가 다르면 아래 원래 흐름 그대로).
const BRIDGE_HOST = "homepage.ur-team.com";
const UPSTREAM = "https://website.tobe211167.workers.dev";
const BRIDGE_MAP = { "/": "/service", "/terms": "/service/terms", "/refund": "/service/refund", "/privacy": "/service/privacy", "/order": "/service/order" };
async function bridge(req, url) {
  const here = url.origin;
  const path = BRIDGE_MAP[url.pathname] || url.pathname;
  const headers = new Headers(req.headers);
  headers.delete("host");
  const init = { method: req.method, headers, redirect: "manual" };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.arrayBuffer();
  const res = await fetch(UPSTREAM + path + url.search, init);
  const out = new Headers(res.headers);
  const loc = out.get("location");
  if (loc) out.set("location", loc.split(UPSTREAM).join(here));
  if ((out.get("content-type") || "").includes("text/html")) {
    const html = (await res.text()).split(UPSTREAM).join(here);
    out.delete("content-length");
    return new Response(html, { status: res.status, headers: out });
  }
  return new Response(res.body, { status: res.status, headers: out });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.hostname === BRIDGE_HOST) {
      try { return await bridge(req, url); }
      catch { return new Response("잠시 후 다시 시도해 주세요.", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } }); }
    }
    if (url.pathname !== "/api/views") return env.ASSETS.fetch(req);
    const kv = env.VIEWS;
    if (req.method === "POST") {
      const s = url.searchParams.get("s") || "";
      if (!OK(s)) return J({}, null);
      if (!kv) return J({ [s]: 0 });
      const n = (parseInt(await kv.get("v:" + s), 10) || 0) + 1;
      await kv.put("v:" + s, String(n), { metadata: { n } });
      return J({ [s]: n });
    }
    if (req.method !== "GET") return new Response("", { status: 405 });
    if (!kv) return J({}, "public, max-age=300");
    const cache = caches.default, key = new Request(url.origin + "/api/views");
    const hit = await cache.match(key);
    if (hit) return hit;
    const out = {};
    let cursor;
    do {
      const page = await kv.list({ prefix: "v:", cursor });
      for (const k of page.keys) out[k.name.slice(2)] = (k.metadata && k.metadata.n) || 0;
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    const res = J(out, "public, max-age=300");
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  },
};
