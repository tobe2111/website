// 블로그 조회수 창구 (Cloudflare Pages). /api/views 만 여기서 처리하고, 나머지 주소는 _routes.json 때문에
// 이 파일을 거치지 않고 평소처럼 정적 파일로 나간다.
// 저장소: Pages 프로젝트 설정 → 바인딩에 KV 이름 공간을 'VIEWS' 로 연결해야 실제로 센다(연결 전엔 0으로 답한다).
//   GET  /api/views        → { "글주소": 실제조회수, ... }  (5분 동안 가장자리 캐시)
//   POST /api/views?s=글주소 → 그 글 조회수 +1
const OK = (s) => /^(en\/)?[0-9a-z-]{5,120}$/.test(s);
const J = (o, cache) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache || "no-store" } });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
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
