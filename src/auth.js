// 인증: 비밀번호 해시(scrypt) + HMAC 서명 세션 쿠키
import crypto from "node:crypto";
import { db } from "./db.js";
import { config } from "./config.js";

// ----- 비밀번호 해시 -----
export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ----- 서명 세션 토큰 (자체 구현 JWT 유사, HS256) -----
function sign(data) {
  return crypto
    .createHmac("sha256", config.sessionSecret)
    .update(data)
    .digest("base64url");
}

export function createSessionToken(payload) {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + config.sessionMaxAgeSec })
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = sign(body);
  // 타이밍 안전 비교
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ----- 사용자 조회 -----
export function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

export function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email);
}

export function createUser({ email, password, name, role = "MERCHANT" }) {
  const { hash, salt } = hashPassword(password);
  const info = db
    .prepare(
      "INSERT INTO users (email, password_hash, salt, name, role) VALUES (?, ?, ?, ?, ?)"
    )
    .run(email.toLowerCase().trim(), hash, salt, name.trim(), role);
  return getUserById(info.lastInsertRowid);
}

// 요청에서 현재 사용자 해석 (라우터가 req.user 로 주입)
export function resolveUser(req) {
  const token = req.cookies[config.sessionCookie];
  const payload = verifySessionToken(token);
  if (!payload) return null;
  const user = getUserById(payload.uid);
  if (!user) return null;
  return user;
}
