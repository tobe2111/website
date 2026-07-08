// HTTP 서버 + 라우터 (외부 의존성 없음)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { parseCookies, redirect, esc } from "./http.js";
import { resolveUser } from "./auth.js";
import * as storage from "./storage.js";
import * as pages from "./handlers/pages.js";
import * as api from "./handlers/api.js";

// ----- 라우트 테이블 -----
// 각 항목: [method, pattern(정규식 or 문자열), handler, {auth}]
// pattern 내 :param 은 캡처됩니다.
const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const rx = new RegExp(
    "^" +
      pattern.replace(/:[a-zA-Z]+/g, (m) => {
        keys.push(m.slice(1));
        return "([^/]+)";
      }) +
      "/?$"
  );
  routes.push({ method, rx, keys, handler, opts });
}

// 공개 페이지
route("GET", "/", pages.home);
route("GET", "/businesses", pages.businesses);
route("GET", "/business/:slug", pages.businessDetail);
route("GET", "/notices", pages.notices);
route("GET", "/notices/:id", pages.noticeDetail);
route("GET", "/events", pages.events);
route("GET", "/login", pages.loginForm);
route("GET", "/register", pages.registerForm);

// 인증 액션
route("POST", "/register", api.register);
route("POST", "/login", api.login);
route("POST", "/logout", api.logout);

// 회원(업체) — 로그인 필요
route("GET", "/dashboard", pages.dashboard, { auth: "MERCHANT" });
route("POST", "/dashboard/business", api.updateBusiness, { auth: "MERCHANT" });
route("POST", "/dashboard/media", api.uploadMedia, { auth: "MERCHANT" });
route("POST", "/dashboard/media/:id/delete", api.deleteMedia, { auth: "MERCHANT" });

// 관리자 — ADMIN 필요
route("GET", "/admin", pages.admin, { auth: "ADMIN" });
route("POST", "/admin/business/:id/status", api.adminBusinessStatus, { auth: "ADMIN" });
route("POST", "/admin/notice", api.adminCreateNotice, { auth: "ADMIN" });
route("POST", "/admin/notice/:id/delete", api.adminDeleteNotice, { auth: "ADMIN" });
route("POST", "/admin/event", api.adminCreateEvent, { auth: "ADMIN" });
route("POST", "/admin/event/:id/delete", api.adminDeleteEvent, { auth: "ADMIN" });

// ----- 정적 파일 MIME -----
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".woff2": "font/woff2",
};

function serveStatic(res, filePath, { allowRange = false, req = null } = {}) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not Found");
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";

    // 동영상 Range 요청 지원 (스트리밍/시킹)
    const range = allowRange && req && req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= stat.size) end = stat.size - 1;
      if (start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        return res.end();
      }
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
      });
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }

    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      "Cache-Control": "public, max-age=3600",
      ...(allowRange ? { "Accept-Ranges": "bytes" } : {}),
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ----- 서버 -----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  req.cookies = parseCookies(req.headers.cookie || "");
  req.user = resolveUser(req);

  try {
    // 업로드된 미디어 서빙 (Range 지원)
    if (pathname.startsWith(config.uploadUrlPrefix + "/")) {
      const name = pathname.slice(config.uploadUrlPrefix.length + 1);
      return serveStatic(res, storage.resolvePath(name), { allowRange: true, req });
    }

    // 정적 자산 (/css, /js, /favicon 등)
    if (pathname.startsWith("/css/") || pathname.startsWith("/js/") || pathname === "/favicon.ico") {
      const rel = pathname === "/favicon.ico" ? "favicon.ico" : pathname.slice(1);
      const filePath = path.join(config.publicDir, rel);
      if (!filePath.startsWith(config.publicDir)) {
        res.writeHead(403); return res.end("Forbidden");
      }
      return serveStatic(res, filePath, { req });
    }

    // 라우트 매칭
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const match = r.rx.exec(pathname);
      if (!match) continue;

      // 권한 체크
      if (r.opts.auth) {
        if (!req.user) return redirect(res, `/login?err=1&msg=${encodeURIComponent("로그인이 필요합니다.")}`);
        if (r.opts.auth === "ADMIN" && req.user.role !== "ADMIN") {
          res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
          return res.end("<h1>403 접근 권한이 없습니다.</h1>");
        }
      }

      const params = {};
      r.keys.forEach((k, i) => (params[k] = match[i + 1]));
      return await r.handler(req, res, { params, query: url.searchParams });
    }

    // 미매칭 → 404
    return pages.notFound(req, res);
  } catch (err) {
    console.error("[server error]", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>500 서버 오류</h1>");
    }
  }
});

server.listen(config.port, config.host, () => {
  console.log(`\n  서초구 상인회 서버 실행 중`);
  console.log(`  ▶ http://localhost:${config.port}\n`);
});
