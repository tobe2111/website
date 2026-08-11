// 계약서 "지면(紙面)" — 서명·도장·입력 자리를 좌표로 못 박기 위한 결정적 페이지 모델.
//
// 왜 줄바꿈까지 서버에서 끊는가:
//   필드는 "2페이지의 x=0.62, y=0.78 자리" 처럼 지면 비율로 저장된다. 지면이 브라우저·폰트에
//   따라 다르게 흐르면 관리자가 놓은 자리와 서명자가 보는 자리가 어긋나고, 완성본은 또 달라진다.
//   그래서 본문을 서버에서 고정 폭으로 하드랩하고 각 줄을 고정 높이로 깔아 y 좌표를 고정한다.
//   글꼴이 달라져도 '몇 번째 줄인가'는 변하지 않으므로 배치가 흔들리지 않는다.
import { esc } from "./util.js";

export const PAGE = { w: 794, h: 1123, pad: 64 }; // A4 @96dpi
export const FONT_PX = 15;
export const LINE_H = 30;
const CONTENT_W = PAGE.w - PAGE.pad * 2; // 666
const CONTENT_H = PAGE.h - PAGE.pad * 2 - 34; // 하단 페이지 번호 자리 제외
export const LINES_PER_PAGE = Math.max(1, Math.floor(CONTENT_H / LINE_H)); // 32

// 글자 폭 근사(0.1em 단위): 한글·한자·전각 = 10, 그 외 = 6.
// 넉넉히 잡아 실제 글꼴이 조금 넓어도 넘치지 않게 하고, 그래도 넘치면 CSS 로 잘라낸다.
const LIMIT = Math.floor((CONTENT_W / FONT_PX) * 10 * 0.96); // 426
const isWide = (c) =>
  (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) ||
  (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
  (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6);
export const charUnits = (ch) => (isWide(ch.codePointAt(0)) ? 10 : 6);

// 한 문단을 지면 폭에 맞춰 여러 줄로 자른다. 라틴 문자는 단어 단위, CJK 는 글자 단위로 끊는다.
export function wrapLine(text) {
  const s = String(text ?? "").replace(/\t/g, "    ");
  if (!s) return [""];
  const out = [];
  let buf = "", used = 0, lastSpace = -1;
  for (const ch of s) {
    const w = charUnits(ch);
    if (used + w > LIMIT && buf) {
      // 라틴 단어 중간이면 마지막 공백까지 되돌려 끊는다
      if (lastSpace > 0 && !isWide(ch.codePointAt(0)) && ch !== " ") {
        out.push(buf.slice(0, lastSpace));
        buf = buf.slice(lastSpace + 1);
        used = 0;
        for (const c of buf) used += charUnits(c);
      } else {
        out.push(buf);
        buf = ""; used = 0;
      }
      lastSpace = -1;
    }
    if (ch === " ") lastSpace = buf.length;
    buf += ch; used += w;
  }
  out.push(buf);
  return out;
}

// 본문 → 페이지 배열. 각 페이지는 LINES_PER_PAGE 줄.
export function paginate(body) {
  const lines = [];
  for (const para of String(body ?? "").split("\n")) lines.push(...wrapLine(para));
  const pages = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) pages.push(lines.slice(i, i + LINES_PER_PAGE));
  return pages.length ? pages : [[""]];
}
export const pageCount = (body) => paginate(body).length;

// ---------- 필드 ----------
export const FIELD_KINDS = {
  sign:  { label: "서명",   w: 0.22, h: 0.05, icon: "✍️" },
  stamp: { label: "도장",   w: 0.09, h: 0.064, icon: "🔴" },
  text:  { label: "텍스트", w: 0.24, h: 0.032, icon: "🔤" },
  date:  { label: "날짜",   w: 0.16, h: 0.032, icon: "📅" },
  name:  { label: "성명",   w: 0.18, h: 0.032, icon: "🪪" },
  check: { label: "체크",   w: 0.035, h: 0.025, icon: "☑️" },
};
export const isFieldKind = (k) => Object.prototype.hasOwnProperty.call(FIELD_KINDS, k);

// 좌표 정규화 — 0~1 범위, 소수점 4자리로 고정(봉인 해시가 부동소수점 표기에 흔들리지 않게)
export const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
export const round4 = (v) => Math.round(clamp01(v) * 10000) / 10000;

// 필드 값 봉인 문자열 — 서명자가 어느 자리에 무엇을 채웠는지까지 봉인에 포함시킨다.
// 좌표까지 넣는 이유: 값은 그대로 두고 자리만 옮기는 조작("서명란"을 "거절란" 위로)을 막기 위함.
export function fieldsCanonical(rows) {
  if (!rows || !rows.length) return "";
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  return sorted.map((f) => [
    f.id, f.kind, f.page, round4(f.x), round4(f.y), round4(f.w), round4(f.h),
    String(f.value ?? "").replace(/[\r\n\t]/g, " "), f.image_hash || "",
  ].join("\t")).join("\n");
}

// ---------- 지면 렌더 ----------
const pageNoHtml = (i, n) => `<div class="paper-no">${i + 1} / ${n}</div>`;

// mode: "view"(읽기) | "edit"(관리자 배치) | "fill"(서명자 입력)
// fieldsFor(pageIndex) → 그 페이지에 놓을 필드 박스 HTML
export function renderPaper(body, { mode = "view", fieldsFor = () => "", watermark = "" } = {}) {
  const pages = paginate(body);
  const n = pages.length;
  return `<div class="paper-stack" data-mode="${esc(mode)}" data-pw="${PAGE.w}" data-ph="${PAGE.h}">${pages
    .map((lines, i) => `<div class="paper" data-page="${i}" style="width:${PAGE.w}px;height:${PAGE.h}px">
      ${watermark ? `<div class="paper-wm">${esc(watermark)}</div>` : ""}
      <div class="paper-text" style="padding:${PAGE.pad}px;font-size:${FONT_PX}px;line-height:${LINE_H}px">${esc(lines.join("\n"))}</div>
      <div class="paper-layer">${fieldsFor(i)}</div>
      ${pageNoHtml(i, n)}
    </div>`).join("")}</div>`;
}

// 필드 한 칸의 HTML. val = { value, imageUrl } (없으면 빈 자리)
export function fieldBox(f, { mode = "view", val = null, mine = false, assigneeName = "" } = {}) {
  const k = FIELD_KINDS[f.kind] || FIELD_KINDS.text;
  const style = `left:${round4(f.x) * 100}%;top:${round4(f.y) * 100}%;width:${round4(f.w) * 100}%;height:${round4(f.h) * 100}%`;
  const filled = !!(val && (val.value || val.imageUrl));
  const cls = ["pf", `pf-${esc(f.kind)}`, filled ? "pf-filled" : "pf-empty", mine ? "pf-mine" : "", mode === "edit" ? "pf-edit" : ""].filter(Boolean).join(" ");
  let inner = "";
  if (filled) {
    inner = val.imageUrl
      ? `<img src="${esc(val.imageUrl)}" alt="${esc(k.label)}" />`
      : f.kind === "check" ? `<span class="pf-check">✔</span>` : `<span class="pf-val">${esc(val.value)}</span>`;
  } else if (mode === "edit") {
    inner = `<span class="pf-tag">${k.icon} ${esc(f.label || k.label)}</span>${assigneeName ? `<span class="pf-who">${esc(assigneeName)}</span>` : ""}<i class="pf-grip"></i>`;
  } else if (mine) {
    inner = `<span class="pf-tag">${k.icon} ${esc(f.label || k.label)}${f.required ? " *" : ""}</span>`;
  } else {
    inner = `<span class="pf-tag pf-other">${esc(assigneeName || k.label)}</span>`;
  }
  const attrs = `data-id="${f.id}" data-kind="${esc(f.kind)}" data-req="${f.required ? 1 : 0}" data-assignee="${f.assignee || 0}"`;
  return `<div class="${cls}" ${attrs} style="${style}">${inner}</div>`;
}
