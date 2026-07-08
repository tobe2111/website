// CSRF 방어 — double-submit 쿠키 패턴 (외부 의존성 없음)
// 폼에 자동 주입되는 토큰과 쿠키 값을 비교. SameSite=Lax 와 함께 심층 방어를 제공.
import crypto from "node:crypto";
import { config } from "./config.js";

const COOKIE = "sc_csrf";
const RE = /^[a-f0-9]{64}$/;

// 요청마다 CSRF 쿠키 보장 + req.csrfToken 설정
export function ensure(req, res) {
  let tok = req.cookies[COOKIE];
  if (!tok || !RE.test(tok)) {
    tok = crypto.randomBytes(32).toString("hex");
    const parts = [`${COOKIE}=${tok}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${config.sessionMaxAgeSec}`];
    if (config.isProd) parts.push("Secure");
    const prev = res.getHeader("Set-Cookie");
    const val = parts.join("; ");
    res.setHeader("Set-Cookie", prev ? (Array.isArray(prev) ? [...prev, val] : [prev, val]) : val);
    req.cookies[COOKIE] = tok; // 이번 요청에서 즉시 사용 가능
  }
  req.csrfToken = tok;
  return tok;
}

export function valid(req, submitted) {
  const tok = req.cookies[COOKIE];
  if (!tok || !submitted || typeof submitted !== "string") return false;
  const a = Buffer.from(tok), b = Buffer.from(submitted);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function token(req) {
  return req.csrfToken || req.cookies[COOKIE] || "";
}
