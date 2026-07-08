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

export function createUser({ email, password, name, role = "MERCHANT", associationId = null }) {
  const { hash, salt } = hashPassword(password);
  const info = db
    .prepare(
      "INSERT INTO users (email, password_hash, salt, name, role, association_id) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(email.toLowerCase().trim(), hash, salt, name.trim(), role, associationId);
  return getUserById(info.lastInsertRowid);
}

// 역할 상수 및 판별 헬퍼
export const ROLES = { SUPERADMIN: "SUPERADMIN", ADMIN: "ADMIN", MERCHANT: "MERCHANT" };
export const isSuperAdmin = (u) => !!u && u.role === ROLES.SUPERADMIN;
export const isAdmin = (u) => !!u && (u.role === ROLES.ADMIN || u.role === ROLES.SUPERADMIN);

// 사용자가 특정 상인회를 관리할 수 있는지 (슈퍼관리자는 전체, 관리자는 소속만)
export function canManageAssociation(user, associationId) {
  if (!user) return false;
  if (user.role === ROLES.SUPERADMIN) return true;
  if (user.role === ROLES.ADMIN) return user.association_id === associationId;
  return false;
}

// 사용자용 세션 토큰 (세션 버전 포함 → 버전 증가 시 무효화)
export function sessionTokenForUser(user) {
  return createSessionToken({ uid: user.id, sv: user.session_version || 0 });
}

// 모든 세션 무효화(로그아웃 전체/비밀번호 변경 시)
export function bumpSessionVersion(userId) {
  db.prepare("UPDATE users SET session_version = session_version + 1 WHERE id = ?").run(userId);
}

// 요청에서 현재 사용자 해석 (라우터가 req.user 로 주입)
export function resolveUser(req) {
  const token = req.cookies[config.sessionCookie];
  const payload = verifySessionToken(token);
  if (!payload) return null;
  const user = getUserById(payload.uid);
  if (!user) return null;
  // 세션 버전 불일치 → 무효화된 토큰
  if ((payload.sv || 0) !== (user.session_version || 0)) return null;
  return user;
}
