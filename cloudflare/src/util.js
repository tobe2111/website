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
