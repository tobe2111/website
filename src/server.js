// HTTP 서버 + 멀티테넌트 라우터 (외부 의존성 없음)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { parseCookies, redirect } from "./http.js";
import { resolveUser, ROLES } from "./auth.js";
import * as A from "./associations.js";
import * as storage from "./storage.js";
import * as pages from "./handlers/pages.js";
import * as api from "./handlers/api.js";

// ----- 라우트 정의 -----
// auth: null | 'MERCHANT' | 'ADMIN' | 'SUPERADMIN'
// tenant 라우트는 pattern 이 "/t/:assoc" 로 시작합니다.
const routes = [];
function route(method, pattern, handler, { auth = null } = {}) {
  const tenant = pattern.startsWith("/t/:assoc");
  const keys = [];
  const rx = new RegExp(
    "^" + pattern.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return "([^/]+)"; }) + "/?$"
  );
  routes.push({ method, rx, keys, handler, auth, tenant });
}

// 전역(플랫폼) 라우트
route("GET", "/", pages.platformIndex);
route("GET", "/login", pages.loginForm);
route("POST", "/login", api.login);
route("POST", "/logout", api.logout);
route("GET", "/super", pages.superConsole, { auth: "SUPERADMIN" });
route("POST", "/super/association", api.superCreateAssociation, { auth: "SUPERADMIN" });
route("POST", "/super/association/:id/toggle", api.superToggleAssociation, { auth: "SUPERADMIN" });

// 테넌트 공개 페이지
route("GET", "/t/:assoc", pages.home);
route("GET", "/t/:assoc/businesses", pages.businesses);
route("GET", "/t/:assoc/business/:slug", pages.businessDetail);
route("GET", "/t/:assoc/notices", pages.notices);
route("GET", "/t/:assoc/notices/:id", pages.noticeDetail);
route("GET", "/t/:assoc/events", pages.events);
route("GET", "/t/:assoc/register", pages.registerForm);
route("POST", "/t/:assoc/register", api.register);

// 테넌트 회원(업체)
route("GET", "/t/:assoc/dashboard", pages.dashboard, { auth: "MERCHANT" });
route("POST", "/t/:assoc/dashboard/business", api.updateBusiness, { auth: "MERCHANT" });
route("POST", "/t/:assoc/dashboard/media", api.uploadMedia, { auth: "MERCHANT" });
route("POST", "/t/:assoc/dashboard/media/:id/delete", api.deleteMedia, { auth: "MERCHANT" });

// 테넌트 관리자
route("GET", "/t/:assoc/admin", pages.admin, { auth: "ADMIN" });
route("POST", "/t/:assoc/admin/business/:id/status", api.adminBusinessStatus, { auth: "ADMIN" });
route("POST", "/t/:assoc/admin/notice", api.adminCreateNotice, { auth: "ADMIN" });
route("POST", "/t/:assoc/admin/notice/:id/delete", api.adminDeleteNotice, { auth: "ADMIN" });
route("POST", "/t/:assoc/admin/event", api.adminCreateEvent, { auth: "ADMIN" });
route("POST", "/t/:assoc/admin/event/:id/delete", api.adminDeleteEvent, { auth: "ADMIN" });
route("POST", "/t/:assoc/admin/settings", api.adminSettings, { auth: "ADMIN" });
route("POST", "/t/:assoc/admin/layout", api.adminSaveLayout, { auth: "ADMIN" });
route("POST", "/t/:assoc/admin/layout/reset", api.adminResetLayout, { auth: "ADMIN" });

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

// 권한 검사: true 통과, 문자열 반환 시 그 경로로 리다이렉트, false 는 403
function authorize(user, auth, assoc) {
  if (!auth) return true;
  if (!user) return "/login?err=1&msg=" + encodeURIComponent("로그인이 필요합니다.");
  if (auth === "SUPERADMIN") return user.role === ROLES.SUPERADMIN ? true : false;
  if (auth === "ADMIN") {
    if (user.role === ROLES.SUPERADMIN) return true;
    return user.role === ROLES.ADMIN && assoc && user.association_id === assoc.id ? true : false;
  }
  if (auth === "MERCHANT") {
    return user.role === ROLES.MERCHANT && assoc && user.association_id === assoc.id ? true : false;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  req.cookies = parseCookies(req.headers.cookie || "");
  req.user = resolveUser(req);

  try {
    // 업로드 미디어 서빙 (Range 지원)
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

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const match = r.rx.exec(pathname);
      if (!match) continue;

      const params = {};
      r.keys.forEach((k, i) => (params[k] = match[i + 1]));

      // 테넌트 해석
      let assoc = null;
      if (r.tenant) {
        assoc = A.getAssociationBySlug(params.assoc);
        if (!assoc) return pages.notFound(req, res);
        // 중지된 상인회는 관리자/슈퍼관리자만 접근 가능
        const privileged = req.user && (req.user.role === ROLES.SUPERADMIN || (req.user.role === ROLES.ADMIN && req.user.association_id === assoc.id));
        if (!assoc.active && !privileged) return pages.notFound(req, res, { assoc: null });
        delete params.assoc;
      }

      // 권한
      const decision = authorize(req.user, r.auth, assoc);
      if (decision !== true) {
        if (typeof decision === "string") return redirect(res, decision);
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        return res.end("<h1>403 접근 권한이 없습니다.</h1><p><a href=\"/\">홈으로</a></p>");
      }

      return await r.handler(req, res, { params, query: url.searchParams, assoc });
    }

    return pages.notFound(req, res);
  } catch (err) {
    console.error("[server error]", err);
    if (!res.headersSent) { res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" }); res.end("<h1>500 서버 오류</h1>"); }
  }
});

server.listen(config.port, config.host, () => {
  console.log(`\n  서초구 상인회 플랫폼 실행 중`);
  console.log(`  ▶ http://localhost:${config.port}\n`);
});
