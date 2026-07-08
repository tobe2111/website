// TOTP (RFC 6238) — 2단계 인증. Web Crypto HMAC-SHA1 + base32.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes) {
  let bits = 0, val = 0, out = "";
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0, val = 0; const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    val = (val << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

export function generateSecret() {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

// 지정 시각(ms)의 6자리 코드
export async function totpAt(secret, timeMs, step = 30, digits = 6) {
  const key = base32Decode(secret);
  const counter = Math.floor(timeMs / 1000 / step);
  const buf = new ArrayBuffer(8); const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, buf));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

// 현재(±window step) 코드 검증
export async function totpVerify(secret, code, timeMs = Date.now(), window = 1) {
  code = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code) || !secret) return false;
  for (let w = -window; w <= window; w++) {
    if (await totpAt(secret, timeMs + w * 30 * 1000) === code) return true;
  }
  return false;
}

export function otpauthUri(secret, label, issuer) {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(label)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
