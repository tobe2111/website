// HTTP 요청/응답 유틸리티
import zlib from "node:zlib";
import { config } from "./config.js";
import * as csrf from "./csrf.js";

// 텍스트 응답 압축 대상
const COMPRESSIBLE = /^(text\/|application\/(json|xml|javascript|ld\+json)|image\/svg)/i;

export function parseCookies(header = "") {
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

// 요청 본문을 버퍼로 수집 (크기 제한 포함)
export function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error("PAYLOAD_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function parseUrlEncoded(str = "") {
  const out = {};
  new URLSearchParams(str).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

// ----- 응답 헬퍼 -----
export function send(res, status, body, headers = {}) {
  // Accept-Encoding: gzip 이고 텍스트 응답이면 압축 (res.acceptsGzip 은 서버가 주입)
  const ct = headers["Content-Type"] || headers["content-type"] || "";
  if (res.acceptsGzip && typeof body === "string" && Buffer.byteLength(body) > 1024 && COMPRESSIBLE.test(ct)) {
    const gz = zlib.gzipSync(body);
    res.writeHead(status, { ...headers, "Content-Encoding": "gzip", Vary: "Accept-Encoding", "Content-Length": gz.length });
    return res.end(gz);
  }
  res.writeHead(status, headers);
  res.end(body);
}

export function html(res, body, status = 200, headers = {}) {
  // 모든 POST 폼에 CSRF 히든 필드 자동 주입 (res.csrfToken 은 서버에서 주입)
  const token = res.csrfToken;
  let out = body;
  if (token) {
    out = String(body).replace(
      /(<form\b[^>]*\bmethod\s*=\s*["']post["'][^>]*>)/gi,
      `$1<input type="hidden" name="_csrf" value="${token}">`
    );
  }
  send(res, status, out, { "Content-Type": "text/html; charset=utf-8", ...headers });
}

// urlencoded 폼 본문을 읽고 CSRF 를 검증. 실패 시 403 전송 후 null 반환.
export async function readForm(req, res, limitBytes = 64 * 1024) {
  let buf;
  try { buf = await readBody(req, limitBytes); }
  catch { send(res, 413, "요청이 너무 큽니다.", { "Content-Type": "text/plain; charset=utf-8" }); return null; }
  const fields = parseUrlEncoded(buf.toString("utf8"));
  if (!csrf.valid(req, fields._csrf)) {
    send(res, 403, "<h1>403 잘못된 요청(CSRF)</h1><p><a href=\"/\">홈으로</a></p>", { "Content-Type": "text/html; charset=utf-8" });
    return null;
  }
  return fields;
}

export function json(res, obj, status = 200, headers = {}) {
  send(res, status, JSON.stringify(obj), {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
}

export function redirect(res, location, status = 303) {
  // 한글 슬러그 등 비ASCII 는 퍼센트 인코딩(헤더는 ASCII만 허용)
  const loc = /[^\x00-\x7F]/.test(location) ? encodeURI(location) : location;
  send(res, status, "", { Location: loc });
}

export function setSessionCookie(res, token) {
  const parts = [
    `${config.sessionCookie}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${config.sessionMaxAgeSec}`,
  ];
  if (config.isProd) parts.push("Secure");
  appendHeader(res, "Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res) {
  appendHeader(
    res,
    "Set-Cookie",
    `${config.sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function appendHeader(res, name, value) {
  const existing = res.getHeader(name);
  if (!existing) res.setHeader(name, value);
  else if (Array.isArray(existing)) res.setHeader(name, [...existing, value]);
  else res.setHeader(name, [existing, value]);
}

// HTML 이스케이프 (XSS 방지)
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 입력 길이 제한 (초장문 입력 방지)
export function cap(s, n) {
  return String(s == null ? "" : s).slice(0, n);
}

// 슬러그 생성 (한글 보존, 공백/특수문자 정리)
export function slugify(name) {
  const base = String(name)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return base || "biz";
}
