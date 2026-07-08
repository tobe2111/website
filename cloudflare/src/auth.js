// 세션(무상태 HMAC 서명 쿠키) + CSRF (이중 제출, 시드 서명)
import { hmacSign, hmacVerify, b64uFromBytes, bytesFromB64u, randomHex } from "./crypto.js";
import { getUserById } from "./db.js";

export const ROLES = { SUPERADMIN: "SUPERADMIN", ADMIN: "ADMIN", MERCHANT: "MERCHANT" };
export const SESSION_COOKIE = "sc_session";
export const CSRF_COOKIE = "sc_csrf_seed";
const MAX_AGE = 60 * 60 * 24 * 7;

const enc = (o) => b64uFromBytes(new TextEncoder().encode(JSON.stringify(o)));
const dec = (s) => JSON.parse(new TextDecoder().decode(bytesFromB64u(s)));

// user → 서명 토큰
export async function sessionTokenForUser(user, secret) {
  const payload = enc({ uid: user.id, sv: user.session_version, exp: Math.floor(Date.now() / 1000) + MAX_AGE });
  const sig = await hmacSign(secret, payload);
  return payload + "." + sig;
}

// 토큰 → user (검증: 서명·만료·세션버전)
export async function userFromToken(db, token, secret) {
  if (!token || token.indexOf(".") === -1) return null;
  const [payload, sig] = token.split(".");
  if (!(await hmacVerify(secret, payload, sig))) return null;
  let data;
  try { data = dec(payload); } catch { return null; }
  if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
  const user = await getUserById(db, data.uid);
  if (!user || user.session_version !== data.sv) return null;
  return user;
}

export function sessionCookie(token, isProd) {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${MAX_AGE}`];
  if (isProd) parts.push("Secure");
  return parts.join("; ");
}
export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ----- CSRF (시드 쿠키 + HMAC 토큰) -----
export function ensureCsrfSeed(cookies, isProd, addCookie) {
  let seed = cookies[CSRF_COOKIE];
  if (!seed) {
    seed = randomHex(16);
    const parts = [`${CSRF_COOKIE}=${seed}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${MAX_AGE}`];
    if (isProd) parts.push("Secure");
    addCookie(parts.join("; "));
  }
  return seed;
}
export const csrfToken = (seed, secret) => hmacSign(secret, "csrf:" + seed);
export async function csrfValid(seed, token, secret) {
  if (!seed || !token) return false;
  return hmacVerify(secret, "csrf:" + seed, token);
}
