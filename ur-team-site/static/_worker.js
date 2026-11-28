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

// ── 관리자(매입 · 매출 장부) — https://ur-team.com/admin/
// 비밀번호는 저장소에 원문으로 두지 않는다. 소금(salt)을 친 PBKDF2 결과의 해시만 둔다.
// 장부 · 바뀐 비밀번호는 KV(ADMIN, 없으면 VIEWS)에 저장. KV 가 연결되지 않으면 장부는 브라우저에만 남는다.
const ADMIN_ID = "tobe2111";
const ADMIN_SALT = "0030348a2960434f806c2607d32c97a0";
const ADMIN_VERIFY = "5ca0586fe750820ec9ef1f07fc52fbc9986ce49d7ab802e636232c16ae9159da";
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function derive(pw, salt) {
  const k = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(salt), iterations: 100000 }, k, 256);
}
const sha = async (b) => hex(await crypto.subtle.digest("SHA-256", b));
async function hmac(keyBytes, msg) {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const store = (env) => env.ADMIN || env.VIEWS || null;
async function creds(env) {
  const kv = store(env);
  if (kv) { try { const c = await kv.get("admin:cred", "json"); if (c && c.salt && c.verify) return c; } catch {} }
  return { salt: ADMIN_SALT, verify: ADMIN_VERIFY };
}
// 쿠키 = 서명 열쇠(비밀번호에서 나온 값의 해시) 로 만든 서명. 비밀번호가 바뀌면 이전 쿠키는 모두 무효가 된다.
async function sessKey(env) { const c = await creds(env); return unhex(c.verify); }
async function authed(req, env) {
  const m = /(?:^|;\s*)ut_admin=([^;]+)/.exec(req.headers.get("cookie") || "");
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return same(sig, await hmac(await sessKey(env), "admin|" + exp));
}
const tries = new Map();
const HTML_HEAD = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "x-frame-options": "DENY", "referrer-policy": "same-origin" };
const loginPage = (msg) => new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>관리자 로그인 | 유어팀</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f7;font:15px/1.5 Pretendard,system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#0f1216}
form{width:min(360px,calc(100% - 32px));background:#fff;border:1px solid #dfe3e8;padding:28px}h1{font-size:19px;margin:0 0 18px}label{display:grid;gap:4px;font-size:13px;font-weight:600;margin-bottom:12px;color:#353b44}
input{min-height:44px;padding:0 12px;border:1px solid #c9ced6;border-radius:4px;font:inherit}button{width:100%;min-height:46px;border:0;border-radius:4px;background:#1747e6;color:#fff;font:inherit;font-weight:700;cursor:pointer}
p{color:#a32020;font-size:14px;margin:0 0 12px}</style></head><body><form method="post" action="/admin/login"><h1>유어팀 관리자</h1>${msg ? `<p role="alert">${msg}</p>` : ""}
<label>아이디<input name="id" autocomplete="username" required autofocus></label><label>비밀번호<input name="pw" type="password" autocomplete="current-password" required></label><button>로그인</button></form></body></html>`,
  { status: msg ? 401 : 200, headers: HTML_HEAD });
async function admin(req, env, url) {
  const kv = store(env), p = url.pathname, ip = req.headers.get("cf-connecting-ip") || "0";
  if (p === "/admin/login" && req.method === "POST") {
    const now = Date.now(), t = (tries.get(ip) || []).filter((x) => now - x < 15 * 60e3);
    let kvFails = 0;
    if (kv) { try { kvFails = parseInt(await kv.get("admin:fail:" + ip), 10) || 0; } catch {} }
    if (t.length >= 8 || kvFails >= 8) return loginPage("로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요.");
    const f = await req.formData().catch(() => null);
    const id = String((f && f.get("id")) || "").trim(), pw = String((f && f.get("pw")) || "");
    const c = await creds(env);
    const ok = same(id, ADMIN_ID) && pw.length > 0 && pw.length < 200 && same(await sha(await derive(pw, c.salt)), c.verify);
    if (!ok) {
      t.push(now); tries.set(ip, t);
      if (kv) { try { await kv.put("admin:fail:" + ip, String(kvFails + 1), { expirationTtl: 900 }); } catch {} }
      return loginPage("아이디 또는 비밀번호가 맞지 않습니다.");
    }
    tries.delete(ip);
    const exp = String(now + 12 * 3600e3);
    const sig = await hmac(unhex(c.verify), "admin|" + exp);
    return new Response(null, { status: 303, headers: { location: "/admin/", "set-cookie": `ut_admin=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`, "cache-control": "no-store" } });
  }
  if (p === "/admin/logout") return new Response(null, { status: 303, headers: { location: "/admin/", "set-cookie": "ut_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0", "cache-control": "no-store" } });
  if (!(await authed(req, env))) return p.startsWith("/api/") ? new Response('{"error":"login"}', { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } }) : loginPage("");
  if (p === "/api/admin/data") {
    if (req.method === "GET") {
      if (!kv) return J({ kv: false });
      return J({ kv: true, data: await kv.get("admin:ledger", "json") });
    }
    if (req.method === "PUT") {
      if (!kv) return J({ kv: false });
      const body = await req.text();
      if (body.length > 5e6) return new Response('{"error":"big"}', { status: 413 });
      let d; try { d = JSON.parse(body); } catch { return new Response('{"error":"json"}', { status: 400 }); }
      if (!d || !Array.isArray(d.rows)) return new Response('{"error":"json"}', { status: 400 });
      const prev = await kv.get("admin:ledger");
      if (prev) await kv.put("admin:ledger:prev", prev);
      await kv.put("admin:ledger", body);
      return J({ ok: true });
    }
    return new Response("", { status: 405 });
  }
  if (p === "/api/admin/password" && req.method === "POST") {
    if (!kv) return new Response('{"error":"kv"}', { status: 400, headers: { "content-type": "application/json" } });
    const b = await req.json().catch(() => ({}));
    const c = await creds(env);
    if (!same(await sha(await derive(String(b.current || ""), c.salt)), c.verify)) return new Response('{"error":"current"}', { status: 400, headers: { "content-type": "application/json" } });
    const next = String(b.next || "");
    if (next.length < 10 || next.length > 200) return new Response('{"error":"short"}', { status: 400, headers: { "content-type": "application/json" } });
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    await kv.put("admin:cred", JSON.stringify({ salt, verify: await sha(await derive(next, salt)) }));
    return J({ ok: true });
  }
  if (p.startsWith("/api/")) return new Response("", { status: 404 });
  const page = await env.ASSETS.fetch(new Request(new URL("/admin/", url.origin), { headers: req.headers }));
  const h = new Headers(page.headers);
  for (const [k, v] of Object.entries(HTML_HEAD)) h.set(k, v);
  h.delete("content-length");
  return new Response(page.body, { status: page.status, headers: h });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.hostname === BRIDGE_HOST) {
      try { return await bridge(req, url); }
      catch { return new Response("잠시 후 다시 시도해 주세요.", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } }); }
    }
    if (url.pathname === "/admin") return Response.redirect(url.origin + "/admin/", 301);
    if (url.pathname.startsWith("/admin/") || url.pathname.startsWith("/api/admin/")) return admin(req, env, url);
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
