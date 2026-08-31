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

// ---------- 문단의 역할 ----------
// 계약서 본문은 줄글이 아니다. 표제가 있고, 조(條) 아래 항(項)이 있고, 목적물 표시는 표에 가깝고,
// 맨 끝에는 "본 계약을 증명하기 위하여…" 라는 말미 문구가 온다.
// 지금까지는 이 구조가 글자 크기 하나로 뭉개져 나와 계약서로 읽히지 않았다.
//
// ⚠️ 줄바꿈 계산은 건드리지 않는다. 필드는 "2쪽의 y=0.78" 처럼 지면 비율로 저장돼 있어서,
//    줄 수가 한 줄이라도 달라지면 이미 배치된 서명 자리가 통째로 어긋난다.
//    그래서 여기서는 **이미 끊긴 줄에 역할만 붙이고**, 보이는 방식만 CSS 로 달리한다.
const RE_ARTICLE = /^\s*제\s*\d+\s*조/;               // 제1조 (목적물)
const RE_CLAUSE = /^\s*[①-⑳]/;                        // ① 항
const RE_ITEM = /^\s*(?:\d{1,2}[.)]|[가-힣][.)])\s/;    // 1. / 가. 호
const RE_CLOSING = /^\s*(?:본|이)\s*계약(?:을|의)/;      // 본 계약을 증명하기 위하여…
// "  소재지   서울 서초구…" — 짧은 이름표와 값이 공백 두 칸 이상으로 갈린 줄.
// 계약서의 목적물 표시가 이 모양인데, 비례 글꼴에서는 공백으로 칸이 맞지 않는다.
const RE_LABEL = /^(\s{1,8})(\S[^\s]{0,11})\s{2,}(\S.*)$/;

// 표제로 볼 만한 첫 줄인가 — "상가건물 임대차계약서" 는 맞고, "제1조 (목적물)" 이나
// 문장으로 끝나는 줄은 아니다. 애매하면 표제로 보지 않는다(잘못 키우는 쪽이 더 나쁘다).
const looksLikeTitle = (t) => {
  const s = t.trim();
  return !!s && s.length <= 30 && !RE_ARTICLE.test(s) && !RE_CLAUSE.test(s)
    && !/[.。]$/.test(s) && !/(?:한다|합니다|된다|입니다)$/.test(s) && !s.includes("{{");
};

function roleOf(para, isFirstText) {
  if (!para.trim()) return "blank";
  if (isFirstText && looksLikeTitle(para)) return "title";
  if (RE_ARTICLE.test(para)) return "article";
  if (RE_CLOSING.test(para)) return "closing";
  if (RE_CLAUSE.test(para)) return "clause";
  if (RE_ITEM.test(para)) return "item";
  if (RE_LABEL.test(para)) return "label";
  return "plain";
}

// 본문 → 페이지 배열. 각 페이지는 LINES_PER_PAGE 줄.
// 줄은 { t: 글자, role: 역할, cont: 이어지는 줄인가 } 이다.
export function paginate(body) {
  const lines = [];
  let seenText = false;
  for (const para of String(body ?? "").split("\n")) {
    const role = roleOf(para, !seenText);
    if (para.trim()) seenText = true;
    // 이어지는 줄은 원문의 들여쓰기를 잃는다. 그 자리를 CSS 로 되돌려
    // 항(項) 번호 아래가 아니라 글자 아래에 맞춘다(내어쓰기).
    // 폭은 22px 을 넘기지 않는다 — 줄바꿈은 이미 끝난 뒤라 더 밀면 오른쪽으로 넘친다.
    const ind = Math.min(22, Math.round((/^\s*/.exec(para)[0].length) * 4.5) + (role === "clause" || role === "item" ? 14 : 0));
    const wrapped = wrapLine(para);
    wrapped.forEach((t, i) => lines.push({ t, role, cont: i > 0, ind }));
  }
  const pages = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) pages.push(lines.slice(i, i + LINES_PER_PAGE));
  return pages.length ? pages : [[{ t: "", role: "blank", cont: false }]];
}

// ---------- 본문이 바뀌면 놓아 둔 자리를 따라 옮긴다 ----------
//
// 원칙은 여전히 "본문이 확정된 뒤에 서명 자리를 놓는다" 이다. 딱 한 곳만 예외다 —
// **대량 발송**. 같은 계약서를 100명에게 보내면서 {{보증금}} 만 사람마다 다르게 넣으면,
// 글자 수가 달라져 줄이 밀리고 그 위의 서명 자리가 통째로 어긋난다.
//
// 그래서 자리를 '몇 쪽의 y' 가 아니라 **'몇 번째 문단의 몇 번째 줄'** 로 되돌린 다음,
// 바뀐 본문에서 그 문단이 간 자리로 다시 깐다. 빈칸을 채워도 문단 수는 그대로이므로
// (fillVars 는 줄바꿈을 넣지 않는다) 문단 번호는 변하지 않는다.
const paraMap = (body) => {
  const paras = [];
  let n = 0;
  for (const para of String(body ?? "").split("\n")) {
    const c = wrapLine(para).length;
    paras.push({ at: n, n: c });
    n += c;
  }
  return { paras, total: n };
};
export function remapFields(fromBody, toBody, fields) {
  const A = paraMap(fromBody), B = paraMap(toBody);
  const rows = (fields || []).map((f) => ({ ...f }));
  if (A.total === B.total) return rows;          // 줄 수가 같으면 옮길 것이 없다
  const maxPage = Math.max(0, paginate(toBody).length - 1);
  return rows.map((f) => {
    const h = Number(f.h) || 0.04;
    const abs = (f.page | 0) * LINES_PER_PAGE + (clamp01(f.y) * PAGE.h - PAGE.pad) / LINE_H;
    const L = Math.floor(abs), frac = abs - L;    // 줄 안에서의 미세한 위치는 그대로 지킨다
    let L2;
    if (L < 0) L2 = L;
    else if (L >= A.total) {
      // 본문이 끝난 아래 — 서명란이 여기 온다. 끝에서부터의 거리를 지켜야 서명란이 본문을 덮지 않는다.
      L2 = B.total + (L - A.total);
    } else {
      let k = 0;
      while (k + 1 < A.paras.length && A.paras[k + 1].at <= L) k++;
      const j = L - A.paras[k].at;
      const b = B.paras[k] || B.paras[B.paras.length - 1];
      L2 = b.at + Math.min(j, Math.max(0, b.n - 1));
    }
    let page = Math.floor(L2 / LINES_PER_PAGE);
    let row = L2 - page * LINES_PER_PAGE;
    // 새 본문이 더 짧아 그 쪽이 아예 없으면 마지막 쪽 안으로 끌어온다 —
    // 없는 쪽에 놓인 자리는 화면에 나오지 않고, 그러면 아무도 서명하지 못한다.
    if (page > maxPage) { row += (page - maxPage) * LINES_PER_PAGE; page = maxPage; }
    if (page < 0) { page = 0; row = 0; }
    const y = Math.min(1 - h - 0.005, Math.max(0, (PAGE.pad + (row + frac) * LINE_H) / PAGE.h));
    return { ...f, page, y: round4(y) };
  });
}

// 한 줄을 HTML 로. 이름표+값 줄만 두 칸으로 갈라 세로줄을 맞춘다 —
// 공백으로 맞춘 칸은 비례 글꼴에서 어긋나 표로 읽히지 않는다.
function lineHtml(ln) {
  const cls = `pl pl-${ln.role}${ln.cont ? " is-cont" : ""}`;
  if (ln.role === "label" && !ln.cont) {
    const m = RE_LABEL.exec(ln.t);
    if (m) return `<div class="${cls}"><span class="pl-ind">${esc(m[1])}</span><span class="pl-k">${esc(m[2])}</span><span class="pl-v">${esc(m[3])}</span></div>`;
  }
  const pad = ln.cont && ln.ind ? ` style="padding-left:${ln.ind}px"` : "";
  return `<div class="${cls}"${pad}>${esc(ln.t) || "&#8203;"}</div>`;
}
export const pageCount = (body) => paginate(body).length;

// ---------- 필드 ----------
export const FIELD_KINDS = {
  sign:  { label: "서명",   w: 0.22, h: 0.05 },
  stamp: { label: "도장",   w: 0.09, h: 0.064 },
  text:  { label: "텍스트", w: 0.24, h: 0.032 },
  date:  { label: "날짜",   w: 0.16, h: 0.032 },
  name:  { label: "성명",   w: 0.18, h: 0.032 },
  check: { label: "체크",   w: 0.035, h: 0.025 },
  // 한국 B2B 계약의 절반은 "사업자등록증 첨부해 주세요" 로 끝난다. 그 자리가 없으면
  // 계약은 전자로 하고 서류는 이메일로 따로 받게 된다 — 그 순간 증적이 두 곳으로 갈라진다.
  file:  { label: "파일 첨부", w: 0.26, h: 0.042 },
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
export function renderPaper(body, { mode = "view", fieldsFor = () => "", watermark = "", scans = null, mediaUrl = (k) => k } = {}) {
  // 올린 양식(PDF 를 쪽 그림으로 구운 것)이 있으면 그것이 지면이다.
  // 좌표계는 그대로다 — 필드는 여전히 '몇 쪽의 x·y 비율' 이라, 배치·서명·증적이 전부 그대로 동작한다.
  if (scans && scans.length) return renderScanPaper(scans, { mode, fieldsFor, watermark, mediaUrl });
  const pages = paginate(body);
  const n = pages.length;
  return `<div class="paper-stack" data-mode="${esc(mode)}" data-pw="${PAGE.w}" data-ph="${PAGE.h}">${pages
    .map((lines, i) => `<div class="paper" data-page="${i}" style="width:${PAGE.w}px;height:${PAGE.h}px">
      ${watermark ? `<div class="paper-wm">${esc(watermark)}</div>` : ""}
      <div class="paper-text" style="padding:${PAGE.pad}px;font-size:${FONT_PX}px;line-height:${LINE_H}px">${lines.map(lineHtml).join("")}</div>
      <div class="paper-layer">${fieldsFor(i)}</div>
      ${pageNoHtml(i, n)}
    </div>`).join("")}</div>`;
}

// 지면 가로는 A4 폭(794)으로 고정하고 세로만 그림 비율로 정한다.
// 쪽마다 크기가 다른 PDF 도 있지만(가로쪽 섞임), 화면 축소 배율은 한 값이어야 하므로
// **첫 쪽 비율**을 문서 전체의 지면으로 삼고, 나머지 쪽 그림은 그 안에 맞춰 넣는다.
export const scanPageSize = (scans) => {
  const f = scans[0] || {};
  const ratio = f.w > 0 && f.h > 0 ? f.h / f.w : PAGE.h / PAGE.w;
  return { w: PAGE.w, h: Math.round(PAGE.w * Math.min(3, Math.max(0.3, ratio))) };
};
function renderScanPaper(scans, { mode, fieldsFor, watermark, mediaUrl }) {
  const { w, h } = scanPageSize(scans);
  const n = scans.length;
  return `<div class="paper-stack is-scan" data-mode="${esc(mode)}" data-pw="${w}" data-ph="${h}">${scans
    .map((p, i) => `<div class="paper" data-page="${i}" style="width:${w}px;height:${h}px">
      <img class="paper-scan" src="${esc(mediaUrl(p.media))}" alt="계약서 ${i + 1}쪽" loading="${i < 2 ? "eager" : "lazy"}" draggable="false" />
      ${watermark ? `<div class="paper-wm">${esc(watermark)}</div>` : ""}
      <div class="paper-layer">${fieldsFor(i)}</div>
      ${pageNoHtml(i, n)}
    </div>`).join("")}</div>`;
}

// 필드 한 칸의 HTML. val = { value, imageUrl } (없으면 빈 자리)
export function fieldBox(f, { mode = "view", val = null, mine = false, assigneeName = "" } = {}) {
  const k = FIELD_KINDS[f.kind] || FIELD_KINDS.text;
  const style = `left:${round4(f.x) * 100}%;top:${round4(f.y) * 100}%;width:${round4(f.w) * 100}%;height:${round4(f.h) * 100}%`;
  const filled = !!(val && (val.value || val.imageUrl));
  const cls = ["pf", `pf-${esc(f.kind)}`, filled ? "pf-filled" : "pf-empty", mine ? "pf-mine" : "",
    mode === "edit" ? "pf-edit" : "", f.auto === "seal" ? "pf-seal" : ""].filter(Boolean).join(" ");
  let inner = "";
  // 배치 화면에서는 채워져 있어도 **편집 손잡이가 먼저**다. 우리 직인은 놓는 즉시 찍히는데,
  // 그림만 그려 버리면 그 자리를 다시 옮기거나 크기를 고칠 방법이 사라진다.
  if (mode === "edit") {
    const bg = val && val.imageUrl ? `<img class="pf-bg" src="${esc(val.imageUrl)}" alt="" />` : "";
    inner = `${bg}<span class="pf-tag">${esc(f.label || k.label)}</span>${assigneeName ? `<span class="pf-who">${esc(assigneeName)}</span>` : ""}<i class="pf-grip"></i>`;
  } else if (filled) {
    inner = f.kind === "file"
      // 첨부는 그림이 아니다 — 파일 이름과 받는 길을 보여 준다(PDF 도 들어온다)
      ? `<a class="pf-file" href="${esc(val.imageUrl || "#")}" target="_blank" rel="noopener">📎 ${esc(val.value || "첨부")}</a>`
      : val.imageUrl ? `<img src="${esc(val.imageUrl)}" alt="${esc(k.label)}" />`
      : f.kind === "check" ? `<span class="pf-check">✔</span>` : `<span class="pf-val">${esc(val.value)}</span>`;
  } else if (f.kind === "stamp") {
    // 계약서에서 도장 자리는 "도장" 이라고 쓰지 않는다 — (인) 이다.
    inner = `<span class="pf-tag${mine ? "" : " pf-other"}">(인)</span>`;
  } else if (mine) {
    inner = `<span class="pf-tag">${esc(f.label || k.label)}${f.required ? " *" : ""}</span>`;
  } else {
    inner = `<span class="pf-tag pf-other">${esc(f.label || assigneeName || k.label)}</span>`;
  }
  // 담당자 값은 문자열이다. 사람이 정해진 뒤에는 숫자(회원 id / -외부 id)지만,
  // 보내기 전 초안에서는 아직 사람이 없어 'slot1'(첫 번째 당사자)처럼 자리만 가리킨다.
  // 사람이 정해지면 그 사람이 이긴다 — 보낸 뒤에도 slot 값은 기록으로 남기 때문이다.
  const who = f.assignee ? String(f.assignee) : f.slot > 0 ? `slot${f.slot}` : "0";
  const attrs = `data-id="${f.id}" data-kind="${esc(f.kind)}" data-req="${f.required ? 1 : 0}" data-assignee="${esc(who)}" data-auto="${esc(f.auto || "")}"`;
  return `<div class="${cls}" ${attrs} style="${style}">${inner}</div>`;
}
