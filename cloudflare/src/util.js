// 순수 유틸 (Node/Workers 공통)
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function cap(s, n) {
  return String(s == null ? "" : s).slice(0, n);
}
export function slugify(name) {
  const base = String(name).trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return base || "biz";
}
export function parseCookies(header = "") {
  const out = {};
  String(header).split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    if (k) out[k] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}
// LIKE 와일드카드 이스케이프
export function likeParam(q) {
  return "%" + String(q).replace(/[%_\\]/g, (c) => "\\" + c) + "%";
}
export const clip = (s, n = 160) => {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

// 매직바이트로 이미지 형식 판별 (선언 MIME 불신). Uint8Array 입력.
export function sniffImage(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// 바이트 → 사람이 읽는 크기
export function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

// 영업시간 문자열에서 "HH:MM - HH:MM" 을 찾아 현재(KST) 영업 여부 판단. 없으면 null.
export function openNow(hours, nowMs = Date.now()) {
  const s = String(hours || "");
  if (/휴무|휴점|closed/i.test(s) && !/\d/.test(s)) return false;
  const m = /(\d{1,2}):(\d{2})\s*[-~–—]\s*(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return null;
  const start = (+m[1]) * 60 + (+m[2]);
  let end = (+m[3]) * 60 + (+m[4]);
  const kst = new Date(nowMs + 9 * 3600 * 1000); // UTC+9
  const cur = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  if (end <= start) return cur >= start || cur < end; // 자정 넘김
  return cur >= start && cur < end;
}
export function openBadge(hours) {
  const st = openNow(hours);
  if (st === null) return "";
  return st ? '<span class="badge badge-open">영업중</span>' : '<span class="badge badge-muted">영업종료</span>';
}
