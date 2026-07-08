// HTTP 서버 + 멀티테넌트 라우터 (경로 기반 /t/:slug + 서브도메인 기반, 외부 의존성 없음)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { parseCookies, redirect } from "./http.js";
import { resolveUser, ROLES } from "./auth.js";
import * as csrf from "./csrf.js";
import * as A from "./associations.js";
import * as storage from "./storage.js";
import * as media from "./media.js";
import * as pages from "./handlers/pages.js";
import * as api from "./handlers/api.js";

// ----- 라우트 컴파일 -----
function compile(pattern) {
  const keys = [];
  const rx = new RegExp("^" + pattern.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return "([^/]+)"; }) + "/?$");
  return { rx, keys };
}
function mk(method, pattern, handler, auth = null) {
  return { method, ...compile(pattern), handler, auth };
}

// 전역(플랫폼) 라우트 — 호스트와 무관하게 pathname 으로 매칭
const globalRoutes = [
  mk("GET", "/sitemap.xml", pages.sitemap),
  mk("GET", "/robots.txt", pages.robots),
  mk("GET", "/login", pages.loginForm),
  mk("POST", "/login", api.login),
  mk("POST", "/logout", api.logout),
  mk("GET", "/account", pages.account, "USER"),
  mk("POST", "/account/password", api.changePassword, "USER"),
  mk("POST", "/account/logout-all", api.logoutAll, "USER"),
  mk("GET", "/super", pages.superConsole, "SUPERADMIN"),
  mk("POST", "/super/association", api.superCreateAssociation, "SUPERADMIN"),
  mk("POST", "/super/association/:id/toggle", api.superToggleAssociation, "SUPERADMIN"),
];

// 테넌트 라우트 — 서브패스로 매칭 (경로 모드는 /t/:slug 를 벗겨낸 뒤, 서브도메인 모드는 전체 경로)
const tenantRoutes = [
  mk("GET", "/", pages.home),
  mk("GET", "/businesses", pages.businesses),
  mk("GET", "/business/:slug", pages.businessDetail),
  mk("GET", "/notices", pages.notices),
  mk("GET", "/notices/:id", pages.noticeDetail),
  mk("GET", "/events", pages.events),
  mk("GET", "/register", pages.registerForm),
  mk("POST", "/register", api.register),
  mk("GET", "/dashboard", pages.dashboard, "MERCHANT"),
  mk("POST", "/dashboard/business", api.updateBusiness, "MERCHANT"),
  mk("POST", "/dashboard/media", api.uploadMedia, "MERCHANT"),
  mk("POST", "/dashboard/media/:id/delete", api.deleteMedia, "MERCHANT"),
  mk("GET", "/admin", pages.admin, "ADMIN"),
  mk("POST", "/admin/business/:id/status", api.adminBusinessStatus, "ADMIN"),
  mk("POST", "/admin/notice", api.adminCreateNotice, "ADMIN"),
  mk("POST", "/admin/notice/:id/delete", api.adminDeleteNotice, "ADMIN"),
  mk("POST", "/admin/event", api.adminCreateEvent, "ADMIN"),
  mk("POST", "/admin/event/:id/delete", api.adminDeleteEvent, "ADMIN"),
  mk("POST", "/admin/settings", api.adminSettings, "ADMIN"),
  mk("POST", "/admin/layout", api.adminSaveLayout, "ADMIN"),
  mk("POST", "/admin/layout/reset", api.adminResetLayout, "ADMIN"),
];

// 테넌트 컨텍스트 해석: {slug, subpath, base} 또는 null
function resolveTenant(hostname, pathname) {
  if (config.baseDomain && hostname.endsWith("." + config.baseDomain)) {
    const label = hostname.slice(0, hostname.length - config.baseDomain.length - 1);
    const first = label.split(".")[0];
    if (first && first !== "www") return { slug: first, subpath: pathname || "/", base: "" };
  }
  const m = /^\/t\/([^/]+)(\/.*)?$/.exec(pathname);
  if (m) return { slug: decodeURIComponent(m[1]), subpath: m[2] || "/", base: "/t/" + m[1] };
  return null;
}

// ----- 정적 파일 -----
const MIME = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".woff2": "font/woff2",
};
function serveStatic(res, filePath, { allowRange = false, req = null } = {}) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Not Found"); }
    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const range = allowRange && req && req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= stat.size) end = stat.size - 1;
      if (start > end) { res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }); return res.end(); }
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size, "Cache-Control": "public, max-age=3600", ...(allowRange ? { "Accept-Ranges": "bytes" } : {}) });
    fs.createReadStream(filePath).pipe(res);
  });
}

function authorize(user, auth, assoc) {
  if (!auth) return true;
  if (!user) return "/login?err=1&msg=" + encodeURIComponent("로그인이 필요합니다.");
  if (auth === "USER") return true;
  if (auth === "SUPERADMIN") return user.role === ROLES.SUPERADMIN;
  if (auth === "ADMIN") {
    if (user.role === ROLES.SUPERADMIN) return true;
    return user.role === ROLES.ADMIN && assoc && user.association_id === assoc.id;
  }
  if (auth === "MERCHANT") return user.role === ROLES.MERCHANT && assoc && user.association_id === assoc.id;
  return false;
}

function forbidden(res) {
  res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
  res.end('<h1>403 접근 권한이 없습니다.</h1><p><a href="/">홈으로</a></p>');
}

// 모든 응답에 보안 헤더 적용
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "font-src 'self'",
].join("; ");
function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (config.isProd) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

async function dispatch(route, req, res, { params, query, assoc }) {
  const decision = authorize(req.user, route.auth, assoc);
  if (decision !== true) {
    if (typeof decision === "string") return redirect(res, decision);
    return forbidden(res);
  }
  return route.handler(req, res, { params, query, assoc });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const hostname = (req.headers.host || "").split(":")[0].toLowerCase();
  setSecurityHeaders(res);
  req.cookies = parseCookies(req.headers.cookie || "");
  req.user = resolveUser(req);
  csrf.ensure(req, res);
  res.csrfToken = req.csrfToken; // html() 가 폼에 자동 주입

  try {
    // 업로드 미디어 (로컬 모드 서빙, Range 지원)
    if (pathname.startsWith(config.uploadUrlPrefix + "/")) {
      return serveStatic(res, storage.resolvePath(pathname.slice(config.uploadUrlPrefix.length + 1)), { allowRange: true, req });
    }
    // 정적 자산
    if (pathname.startsWith("/css/") || pathname.startsWith("/js/") || pathname === "/favicon.ico") {
      const rel = pathname === "/favicon.ico" ? "favicon.ico" : pathname.slice(1);
      const filePath = path.join(config.publicDir, rel);
      if (!filePath.startsWith(config.publicDir)) { res.writeHead(403); return res.end("Forbidden"); }
      return serveStatic(res, filePath, { req });
    }

    // 1) 전역 라우트 (호스트 무관)
    for (const r of globalRoutes) {
      if (r.method !== req.method) continue;
      const match = r.rx.exec(pathname);
      if (!match) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = match[i + 1]));
      return await dispatch(r, req, res, { params, query: url.searchParams, assoc: null });
    }

    // 2) 테넌트 컨텍스트
    const tenant = resolveTenant(hostname, pathname);
    if (tenant) {
      const assoc = A.getAssociationBySlug(tenant.slug);
      if (!assoc) return pages.notFound(req, res);
      const privileged = req.user && (req.user.role === ROLES.SUPERADMIN || (req.user.role === ROLES.ADMIN && req.user.association_id === assoc.id));
      if (!assoc.active && !privileged) return pages.notFound(req, res);
      assoc._base = tenant.base; // 렌더링용 베이스 주입

      for (const r of tenantRoutes) {
        if (r.method !== req.method) continue;
        const match = r.rx.exec(tenant.subpath);
        if (!match) continue;
        const params = {};
        r.keys.forEach((k, i) => (params[k] = match[i + 1]));
        return await dispatch(r, req, res, { params, query: url.searchParams, assoc });
      }
      return pages.notFound(req, res, { assoc });
    }

    // 3) 플랫폼 루트
    if (pathname === "/" && req.method === "GET") return pages.platformIndex(req, res);

    return pages.notFound(req, res);
  } catch (err) {
    console.error("[server error]", err);
    if (!res.headersSent) { res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" }); res.end("<h1>500 서버 오류</h1>"); }
  }
});

// ----- 시작 시 설정 검증 -----
(function validateConfig() {
  const errs = [], warns = [];
  if (config.isProd && config.sessionSecret === "dev-secret-change-me-in-production")
    errs.push("운영 환경에서 SESSION_SECRET 을 반드시 설정하세요.");
  if (config.storageDriver === "s3") {
    for (const k of ["bucket", "accessKeyId", "secretAccessKey"])
      if (!config.s3[k]) errs.push(`STORAGE_DRIVER=s3 인데 S3_${k.replace(/[A-Z]/g, (m) => "_" + m).toUpperCase()} 가 비어 있습니다.`);
  }
  if (config.baseDomain && /[\/:]/.test(config.baseDomain))
    warns.push("BASE_DOMAIN 에는 프로토콜/경로 없이 도메인만 입력하세요 (예: example.com).");
  if (!config.isProd && config.sessionSecret === "dev-secret-change-me-in-production")
    warns.push("개발용 SESSION_SECRET 사용 중 — 운영 배포 전 변경 필요.");
  warns.forEach((w) => console.warn("  ⚠ " + w));
  if (errs.length) { errs.forEach((e) => console.error("  ✖ " + e)); process.exit(1); }
})();

server.listen(config.port, config.host, () => {
  console.log(`\n  서초구 상인회 플랫폼 실행 중`);
  console.log(`  ▶ http://localhost:${config.port}`);
  console.log(`  스토리지: ${storage.driver}${config.baseDomain ? ` · 서브도메인: *.${config.baseDomain}` : " · 경로 기반(/t/:slug)"}`);
  console.log(`  미디어: ${media.info()}\n`);
});
