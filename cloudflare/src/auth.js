// 세션(무상태 HMAC 서명 쿠키) + CSRF (이중 제출, 시드 서명)
import { hmacSign, hmacVerify, b64uFromBytes, bytesFromB64u, randomHex } from "./crypto.js";
import { getUserById } from "./db.js";

// 역할.
//  SUPERADMIN 플랫폼 운영자
//  ADMIN      조직 관리자(소유자) — 설정·브랜딩·API 키·과금·담당자 관리 + 담당자가 하는 것 전부
//  STAFF      담당자 — 계약서 작성·발송·서식·외부 서명자. 설정과 돈은 못 건드린다.
//  MERCHANT   점포주(상인회) / 내부 서명자
// users.role 은 CHECK 제약이 없고 기본값이 MERCHANT 라, 값을 늘려도 마이그레이션이 필요 없다.
export const ROLES = { SUPERADMIN: "SUPERADMIN", ADMIN: "ADMIN", STAFF: "STAFF", MERCHANT: "MERCHANT" };
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
