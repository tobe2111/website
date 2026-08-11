// Web Crypto 기반 암호 유틸 (Cloudflare Workers 런타임)
// 비밀번호: PBKDF2-SHA256 / 세션·CSRF: HMAC-SHA256 / 해시: SHA-256
const enc = new TextEncoder();

// ----- base64url -----
export function b64uFromBytes(bytes) {
  let s = "";
  const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function bytesFromB64u(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomHex(nBytes = 16) {
  const b = crypto.getRandomValues(new Uint8Array(nBytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(String(text ?? "")));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// 바이너리(첨부 PDF 등) 해시 — 문자열 변환 없이 원본 바이트를 그대로 해싱
export async function sha256HexBytes(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ----- 비밀번호 (PBKDF2) -----
const PBKDF2_ITERS = 100000;
export async function hashPassword(password, saltB64u) {
  const salt = saltB64u ? bytesFromB64u(saltB64u) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" }, key, 256);
  return { salt: b64uFromBytes(salt), hash: b64uFromBytes(bits) };
}
export async function verifyPassword(password, saltB64u, hashB64u) {
  const { hash } = await hashPassword(password, saltB64u);
  return timingSafeEqual(hash, hashB64u);
}

// ----- HMAC (세션·CSRF 서명) -----
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function hmacSign(secret, data) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(data));
  return b64uFromBytes(sig);
}
export async function hmacVerify(secret, data, sigB64u) {
  const expected = await hmacSign(secret, data);
  return timingSafeEqual(expected, sigB64u);
}

// 상수 시간 비교
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
