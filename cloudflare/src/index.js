// Cloudflare Worker 진입점 — 라우팅 · 테넌트 해석 · 인증 · CSRF · 보안헤더
import { parseCookies } from "./util.js";
import { SESSION_COOKIE, CSRF_COOKIE, ensureCsrfSeed, csrfToken, csrfValid, userFromToken, ROLES } from "./auth.js";
import * as D from "./db.js";
import * as pages from "./pages.js";
import * as api from "./api.js";
import { setMediaBase, layout } from "./render.js";
import { html, text, redirect, notFoundResponse, forbidden } from "./http.js";
import { esc } from "./util.js";
import { ensureSchema } from "./schema.js";
import { resolveSessionSecret } from "./secrets.js";

const _schemaReady = new WeakSet(); // DB 별 스키마 준비 캐시
const _usersConfirmed = new WeakSet(); // DB 별 "계정 존재" 확인 캐시

// 라우트: [method, pattern, handler, auth]
const GLOBAL = [
  ["GET", "/login", pages.loginForm],
  ["POST", "/login", api.login],
  ["POST", "/logout", api.logout, "USER"],
  ["GET", "/account", pages.account, "USER"],
  ["POST", "/account/password", api.changePassword, "USER"],
  ["POST", "/account/logout-all", api.logoutAll, "USER"],
  ["POST", "/account/2fa/setup", api.twofaSetup, "USER"],
  ["POST", "/account/2fa/enable", api.twofaEnable, "USER"],
  ["POST", "/account/2fa/disable", api.twofaDisable, "USER"],
  ["GET", "/setup", pages.setupForm],
  ["POST", "/setup", api.setupSubmit],
  ["GET", "/forgot", pages.forgotForm],
  ["POST", "/forgot", api.forgotPassword],
  ["GET", "/sitemap.xml", pages.sitemap],
  ["GET", "/robots.txt", pages.robots],
  ["GET", "/verify", pages.verifyPage],
  ["GET", "/verify/:code", pages.verifyPage],
  ["GET", "/super", pages.superConsole, "SUPERADMIN"],
  ["POST", "/super/association", api.superCreateAssociation, "SUPERADMIN"],
  ["POST", "/super/association/:id/toggle", api.superToggleAssociation, "SUPERADMIN"],
  ["POST", "/super/association/:id/domain", api.superSetDomain, "SUPERADMIN"],
];
const TENANT = [
  ["GET", "/", pages.home],
  ["GET", "/businesses", pages.businesses],
  ["GET", "/business/:slug", pages.businessDetail],
  ["GET", "/map", pages.mapPage],
  ["GET", "/notices", pages.notices],
  ["GET", "/notices/:id", pages.noticeDetail],
  ["GET", "/events", pages.events],
  ["GET", "/register", pages.registerForm],
  ["POST", "/register", api.register],
  ["GET", "/board", pages.board, "MEMBER"],
  ["POST", "/board", api.createPost, "MEMBER"],
  ["GET", "/board/:id", pages.postDetail, "MEMBER"],
  ["GET", "/board/:id/edit", pages.editPost, "MEMBER"],
  ["POST", "/board/:id/edit", api.updatePost, "MEMBER"],
  ["POST", "/board/:id/comment", api.createComment, "MEMBER"],
  ["POST", "/board/:id/comment/:cid/delete", api.deleteComment, "MEMBER"],
  ["POST", "/board/:id/delete", api.deletePost, "MEMBER"],
  ["POST", "/board/:id/pin", api.pinPost, "MEMBER"],
  ["GET", "/dashboard", pages.dashboard, "MERCHANT"],
  ["POST", "/dashboard/business", api.updateBusiness, "MERCHANT"],
  ["POST", "/dashboard/media", api.uploadMedia, "MERCHANT"],
  ["POST", "/dashboard/media/embed", api.addVideoEmbed, "MERCHANT"],
  ["POST", "/dashboard/media/:id/delete", api.deleteMedia, "MERCHANT"],
  ["GET", "/sign", pages.signList, "MERCHANT"],
  ["GET", "/sign/:id", pages.signForm, "MERCHANT"],
  ["POST", "/sign/:id", api.memberSign, "MERCHANT"],
  ["GET", "/admin", pages.admin, "ADMIN"],
  ["POST", "/admin/business/:id/status", api.adminBusinessStatus, "ADMIN"],
  ["POST", "/admin/notice", api.adminCreateNotice, "ADMIN"],
  ["POST", "/admin/notice/:id/delete", api.adminDeleteNotice, "ADMIN"],
  ["POST", "/admin/event", api.adminCreateEvent, "ADMIN"],
  ["POST", "/admin/event/:id/delete", api.adminDeleteEvent, "ADMIN"],
  ["POST", "/admin/settings", api.adminSettings, "ADMIN"],
  ["POST", "/admin/layout", api.adminSaveLayout, "ADMIN"],
  ["POST", "/admin/layout/reset", api.adminResetLayout, "ADMIN"],
  ["POST", "/admin/notifications/read", api.adminReadNotifications, "ADMIN"],
  ["POST", "/admin/user/:id/reset-password", api.adminResetUserPassword, "ADMIN"],
  ["GET", "/admin/members.csv", pages.adminExportMembers, "ADMIN"],
  ["GET", "/admin/documents", pages.adminDocuments, "ADMIN"],
  ["POST", "/admin/documents", api.adminCreateDocument, "ADMIN"],
  ["GET", "/admin/documents/:id", pages.adminDocumentDetail, "ADMIN"],
  ["POST", "/admin/documents/:id/close", api.adminCloseDocument, "ADMIN"],
];

function matchRoute(routes, method, path) {
  for (const [m, pattern, handler, auth] of routes) {
    if (m !== method) continue;
    const params = matchPath(pattern, path);
    if (params) return { handler, auth, params };
  }
  return null;
}
function matchPath(pattern, path) {
  const pp = pattern.split("/"), sp = path.split("/");
  if (pp.length !== sp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
    else if (pp[i] !== sp[i]) return null;
  }
  return params;
}

function resolveTenant(env, hostname, pathname) {
  const bd = (env.BASE_DOMAIN || "").toLowerCase();
  if (bd && hostname.endsWith("." + bd)) {
    const label = hostname.slice(0, -(bd.length + 1)).split(".")[0];
    if (label && label !== "www") return { slug: label, subpath: pathname || "/", base: "" };
  }
  const m = /^\/t\/([^/]+)(\/.*)?$/.exec(pathname);
  if (m) return { slug: decodeURIComponent(m[1]), subpath: m[2] || "/", base: "/t/" + m[1] };
  return null;
}

function securityHeaders(env) {
  const naver = env.NAVER_MAP_CLIENT_ID ? " https://oapi.map.naver.com" : "";
  const naverImg = env.NAVER_MAP_CLIENT_ID ? " https://*.pstatic.net https://*.map.naver.com" : "";
  const ts = env.TURNSTILE_SITE_KEY ? " https://challenges.cloudflare.com" : "";
  const cfa = env.CF_ANALYTICS_TOKEN ? " https://static.cloudflareinsights.com" : "";
  const cfaConn = env.CF_ANALYTICS_TOKEN ? " https://cloudflareinsights.com" : "";
  const csp = [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'self'", "form-action 'self'",
    `script-src 'self'${naver}${ts}${cfa}`, "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:", "media-src 'self' https:",
    `frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://www.instagram.com https://tv.naver.com${ts}`,
    `connect-src 'self'${naver}${naverImg}${ts}${cfaConn}`, "font-src 'self'",
  ].join("; ");
  return {
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "Content-Security-Policy": csp,
  };
}

function authorize(user, auth, assoc) {
  if (!auth) return true;
  if (!user) return "/login?err=1&msg=" + encodeURIComponent("로그인이 필요합니다.");
  if (auth === "USER") return true;
  if (auth === "SUPERADMIN") return user.role === ROLES.SUPERADMIN;
  if (auth === "ADMIN") return user.role === ROLES.SUPERADMIN || (user.role === ROLES.ADMIN && assoc && user.association_id === assoc.id);
  if (auth === "MERCHANT") return user.role === ROLES.MERCHANT && assoc && user.association_id === assoc.id;
  if (auth === "MEMBER") return user.role === ROLES.SUPERADMIN || (assoc && user.association_id === assoc.id);
  return false;
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      return html(`<h1>500</h1><pre>${esc(String(e && e.stack || e))}</pre>`, 500);
    }
  },
};

async function handle(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const db = env.DB;
  const isProd = (env.PUBLIC_SCHEME || "https") === "https";
  setMediaBase(env.MEDIA_PUBLIC_BASE || "");

  // 정적 자산 (css/js/img/아이콘/PWA)
  if (/^\/(css|js|img|favicon)/.test(pathname) || pathname === "/manifest.webmanifest" || pathname === "/sw.js") {
    if (env.ASSETS) return env.ASSETS.fetch(request);
  }
  // R2 미디어 서빙 (퍼블릭 base 미설정 시 워커 경유)
  if (pathname.startsWith("/media/")) return serveMedia(env, pathname.slice("/media/".length));

  // 최초 실행: 표 자동 생성 + 세션 시크릿 자동 확보 (시크릿·스키마 명령 불필요)
  if (!_schemaReady.has(db)) { await ensureSchema(db); _schemaReady.add(db); }
  env = { ...env, SESSION_SECRET: await resolveSessionSecret(env) };

  // 설치 마법사 게이트: 계정이 하나도 없으면 /setup 으로 유도
  if (!_usersConfirmed.has(db)) {
    if ((await D.countUsers(db)) > 0) _usersConfirmed.add(db);
    else if (pathname !== "/setup") return finalize(redirect("/setup"), [], env);
  }

  const cookies = parseCookies(request.headers.get("cookie") || "");
  const setCookies = [];
  const addCookie = (c) => setCookies.push(c);
  const seed = ensureCsrfSeed(cookies, isProd, addCookie);
  const csrf = await csrfToken(seed, env.SESSION_SECRET);
  const user = await userFromToken(db, cookies[SESSION_COOKIE], env.SESSION_SECRET);
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "?";

  // 폼 파싱(POST)
  let form = null;
  if (request.method === "POST") {
    try { form = await request.formData(); } catch { form = new FormData(); }
    if (!(await csrfValid(seed, form.get("_csrf"), env.SESSION_SECRET)))
      return finalize(html("<h1>403 잘못된 요청(CSRF)</h1>", 403), setCookies, env);
  }

  const baseCtx = { env, db, url, query: url.searchParams, user, csrf, form, addCookie, isProd, ip, request };

  // 테넌트 라우트 — ① BASE_DOMAIN 서브도메인/경로(/t/:slug) ② 상인회별 개별 도메인(custom_domain)
  let t = resolveTenant(env, url.hostname, pathname);
  let assocPre = null;
  if (!t) {
    assocPre = await D.getAssociationByDomain(db, url.hostname);
    if (assocPre) t = { slug: assocPre.slug, subpath: pathname || "/", base: "" };
  }
  if (t) {
    const assoc = assocPre || (await D.getAssociationBySlug(db, t.slug));
    if (!assoc || (!assoc.active && !(user && user.role === ROLES.SUPERADMIN)))
      return finalize(notFoundResponse({ base: t.base }), setCookies, env);
    assoc._base = t.base;
    const route = matchRoute(TENANT, request.method, t.subpath);
    if (route) {
      const ok = authorize(user, route.auth, assoc);
      if (ok !== true) return finalize(typeof ok === "string" ? redirect(ok) : forbidden(), setCookies, env);
      const res = await route.handler({ ...baseCtx, assoc, base: t.base, params: route.params });
      return finalize(res, setCookies, env);
    }
    // 테넌트 경로에 없으면 전역 라우트 폴백 (개별 도메인·서브도메인에서 /login, /verify, /sitemap.xml 등)
    const gt = matchRoute(GLOBAL, request.method, t.subpath);
    if (gt) {
      const ok = authorize(user, gt.auth, assoc);
      if (ok !== true) return finalize(typeof ok === "string" ? redirect(ok) : forbidden(), setCookies, env);
      const res = await gt.handler({ ...baseCtx, assoc, base: t.base, params: gt.params });
      return finalize(res, setCookies, env);
    }
    return finalize(notFoundResponse({ assoc, base: t.base }), setCookies, env);
  }

  // 전역 라우트
  const g = matchRoute(GLOBAL, request.method, pathname);
  if (g) {
    const res = await g.handler({ ...baseCtx, params: g.params });
    return finalize(res, setCookies, env);
  }

  // 루트: 상인회 목록 / 단일이면 리다이렉트
  if (pathname === "/") return finalize(await platformIndex(baseCtx), setCookies, env);

  return finalize(notFoundResponse({}), setCookies, env);
}

async function platformIndex(ctx) {
  const list = await D.listActiveAssociations(ctx.db);
  if (list.length === 1) return redirect(`/t/${list[0].slug}`);
  const cards = list.map((a) => `<li><a class="btn btn-ghost" href="/t/${esc(a.slug)}">${esc(a.name)}</a></li>`).join("") || "<li class='empty'>등록된 상인회가 없습니다.</li>";
  const body = `<section class="section page-top"><div class="container">
    <div class="section-head"><h1 class="section-title">참여 상인회</h1></div>
    <ul class="assoc-list">${cards}</ul></div></section>`;
  return html(layout({ title: "상인회 플랫폼", body, csrf: ctx.csrf }));
}

async function serveMedia(env, key) {
  if (!env.MEDIA) return new Response("Not Found", { status: 404 }); // R2 미연결 시
  key = key.replace(/[^A-Za-z0-9._-]/g, "");
  if (!key) return new Response("Not Found", { status: 404 });
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response("Not Found", { status: 404 });
  const headers = new Headers();
  if (obj.httpMetadata && obj.httpMetadata.contentType) headers.set("content-type", obj.httpMetadata.contentType);
  headers.set("cache-control", "public, max-age=86400");
  return new Response(obj.body, { headers });
}

// 보안 헤더 + 쿠키 부착 (+ 선택: Cloudflare Web Analytics 주입)
async function finalize(res, setCookies, env) {
  const headers = new Headers(res.headers);
  const sec = securityHeaders(env);
  for (const [k, v] of Object.entries(sec)) headers.set(k, v);
  for (const c of setCookies) headers.append("set-cookie", c);
  let body = res.body;
  if (env.CF_ANALYTICS_TOKEN && (headers.get("content-type") || "").includes("text/html")) {
    const beacon = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${env.CF_ANALYTICS_TOKEN}"}'></script>`;
    const t = await res.text();
    body = t.includes("</body>") ? t.replace("</body>", beacon + "</body>") : t + beacon;
    headers.delete("content-length");
  }
  return new Response(body, { status: res.status, headers });
}
