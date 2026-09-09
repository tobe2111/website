// 순수 유틸 (Node/Workers 공통)
import { romanize, coreName } from "./roman.js";
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function cap(s, n) {
  return String(s == null ? "" : s).slice(0, n);
}
// 주소에 쓸 짧은 영문 이름.
// 한글을 그대로 두면 `/t/서초구-상인회` 가 복사될 때 `/t/%EC%84%9C…` 로 늘어난다
// (한 글자 = 9바이트). 알림톡 버튼·명함·구두 안내 어디에도 쓰기 어렵다.
// 그래서 로마자로 옮기고, 조직 형태를 나타내는 흔한 말(상인회·법무법인…)은 떼고,
// 24자에서 자른다. "서초구 상인회" → seochogu, "한빛법무법인" → hanbit
const SLUG_MAX = 24;
export function slugify(name) {
  const core = coreName(name);
  const full = romanize(core).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (full.length <= SLUG_MAX) return full || "biz";
  // 길면 낱말 경계에서 자른다 — 한가운데서 자르면 뜻 없는 조각이 남는다("…-seochog")
  let out = "";
  for (const w of full.split("-")) {
    if (!out) { out = w.slice(0, SLUG_MAX); continue; }
    if (out.length + 1 + w.length > SLUG_MAX) break;
    out += "-" + w;
  }
  return out.replace(/-+$/g, "") || "biz";
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

// 화면에 '주소'로 보여 주는 경로는 사람이 읽을 수 있게 되돌립니다.
// 한글 slug 테넌트는 base 가 /t/%EB%A6%AC%EC%8A%A4… 처럼 인코딩돼 있어서
// 그대로 찍으면 사장님 화면의 '공개 주소'가 알아볼 수 없는 문자열이 됩니다.
// (링크의 href 는 인코딩된 원본을 그대로 써야 하므로 표시용으로만 씁니다.)
export function prettyPath(p) {
  try { return decodeURIComponent(String(p ?? "")); } catch { return String(p ?? ""); }
}

// 저장된 시각은 모두 UTC 입니다(D1 의 datetime('now') 도, 앱이 남기는 ISO 도).
// 그대로 찍으면 한국 사용자에게 9시간 어긋난 시각이 보이므로 화면에는 KST 로 환산해 보여 줍니다.
// month=true 면 "08-04 14:30", 아니면 "2026-08-04 14:30".
export function kstStamp(v, { year = true } = {}) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const norm = s.includes("T") ? s : s.replace(" ", "T");
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(norm) ? norm : norm + "Z");
  if (Number.isNaN(t)) return s;
  const d = new Date(t + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  const date = `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  return `${year ? d.getUTCFullYear() + "-" : ""}${date} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// 날짜만 보여 줄 때. UTC 자정 근처 글은 KST 로 바꾸면 날짜가 하루 넘어갑니다.
// sep 로 구분자를 바꿉니다 ("2026-08-05" / "2026.08.05").
export function kstDate(v, sep = "-") {
  const s = kstStamp(v);
  return s ? s.slice(0, 10).replace(/-/g, sep) : "";
}

// 영업시간 문자열에 적힌 정기휴무 요일이 오늘인지 (KST 기준).
// "09:00-21:30 · 매주 일요일 휴무" 처럼 시간과 휴무일이 한 줄에 같이 적히는 경우가 많은데,
// 시간만 보고 판단하면 일요일에도 '영업중'으로 표시돼 손님에게 잘못된 정보가 나갑니다.
const WEEK = "일월화수목금토";
export function closedToday(hours, nowMs = Date.now()) {
  const s = String(hours || "");
  if (!/휴무|휴점|정기휴일/.test(s)) return false; // '연중무휴' 는 '무휴' 라 여기 걸리지 않습니다
  const dow = new Date(nowMs + 9 * 3600 * 1000).getUTCDay();
  // '휴무' 라는 낱말 바로 앞 구간만 봅니다. 구분자로 자르면 "토·일 휴무" 처럼
  // 가운뎃점이 요일 구분에도 쓰이는 표기에서 앞 요일을 놓칩니다.
  for (const m of s.matchAll(/휴무|휴점|정기휴일/g)) {
    const before = s.slice(Math.max(0, m.index - 12), m.index);
    if (/주말/.test(before) && (dow === 0 || dow === 6)) return true;
    if (/평일/.test(before) && dow >= 1 && dow <= 5) return true;
    for (const d of before.match(/[월화수목금토일](?=요일|[·,/\s])/g) || [])
      if (WEEK.indexOf(d) === dow) return true;
  }
  return false;
}

// 영업시간 문자열에서 "HH:MM - HH:MM" 을 찾아 현재(KST) 영업 여부 판단. 없으면 null.
export function openNow(hours, nowMs = Date.now()) {
  const s = String(hours || "");
  if (/휴무|휴점|closed/i.test(s) && !/\d/.test(s)) return false;
  if (closedToday(s, nowMs)) return false;
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

// 카드에 적을 한 줄. "영업중"만으로는 손님이 지금 나가도 되는지 알 수 없다 —
// 열려 있으면 몇 시에 닫는지, 닫혀 있으면 몇 시에 여는지가 실제로 필요한 정보다.
export function hoursLine(hours, nowMs = Date.now()) {
  const s = String(hours || "");
  const st = openNow(s, nowMs);
  if (st === null) return { state: "", label: "" };
  const m = /(\d{1,2}):(\d{2})\s*[-~–—]\s*(\d{1,2}):(\d{2})/.exec(s);
  const pad = (h, mi) => `${String(+h).padStart(2, "0")}:${mi}`;
  if (!m) return { state: st ? "open" : "shut", label: st ? "영업중" : "영업종료" };
  return st
    ? { state: "open", label: `${pad(m[3], m[4])} 마감` }
    : { state: "shut", label: `${pad(m[1], m[2])} 오픈` };
}

// ── 사장님이 폰에서 고른 값 ↔ 한 줄 문자열 ─────────────────────────────
//
// 영업시간은 지도가 주지 않는 유일한 값이다. 상호·주소·전화·좌표·대표사진은 지도에서
// 딸려 오는데 영업시간만 안 온다. 그래서 가게 수만큼 누군가 손으로 적어야 하는데,
// 그 '누군가' 를 회장님으로 두면 130번이 된다. 사장님이 폰에서 직접 적게 한다.
//
// 다만 사장님께 "09:00-21:30 · 일요일 휴무" 라고 **글로 적어 달라고 하면 안 된다.**
// 폰 자판으로 콜론과 하이픈을 정확히 치는 일이고, 한 글자만 어긋나면 openNow() 가
// 못 읽어 '지금 문 연 곳' 에서 그대로 빠진다. 그래서 화면에서는 시각 두 개와 쉬는 요일만
// 고르게 하고, **읽을 수 있는 한 줄은 여기서 만든다.**
const WEEK_ORDER = ["월", "화", "수", "목", "금", "토", "일"];
export function composeHours({ open, close, off } = {}) {
  const hm = (v) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || "").trim());
    if (!m) return "";
    return (+m[1]) > 23 || (+m[2]) > 59 ? "" : `${String(+m[1]).padStart(2, "0")}:${m[2]}`;
  };
  const a = hm(open), b = hm(close);
  // 시각 없이 "일요일 휴무" 만 남으면 openNow() 가 숫자를 못 찾아 **늘 닫힘**으로 읽는다.
  // 쉬는 날만 적고 보내면 그 가게가 영영 안 뜨게 되므로, 시각 둘이 없으면 아무것도 안 만든다.
  if (!a || !b) return "";
  const days = WEEK_ORDER.filter((d) => (off || []).includes(d));
  // '매주' 를 붙이지 않는다. closedToday() 는 '휴무' 앞 12글자만 훑는데,
  // 세 글자를 더 쓰면 요일을 서너 개 고른 가게에서 앞 요일이 창 밖으로 밀려난다.
  return days.length ? `${a}-${b} · ${days.join("·")}요일 휴무` : `${a}-${b}`;
}
// 위가 만든 모양이면 되돌려 준다(고치러 다시 들어온 사장님께 고른 값을 그대로 보여주려고).
// 모양이 다르면 null — 사람이 자유롭게 적은 줄이므로 칸에 억지로 끼워 넣지 않는다.
export function decomposeHours(s) {
  const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})(?: · ([월화수목금토일]+(?:·[월화수목금토일])*)요일 휴무)?$/.exec(String(s || "").trim());
  if (!m) return null;
  return { open: m[1], close: m[2], off: m[3] ? m[3].split("·") : [] };
}

// 사람이 자유롭게 적은 영업시간 한 줄을 composeHours 가 만드는 모양으로 고친다.
//
// 회장님이 영업시간을 한꺼번에 적을 때 "10시~22시 일요일휴무", "10-22", "오전 11시 - 오후 9시"
// 처럼 제각각 적는다. 그대로 저장하면 저장은 되는데 openNow() 가 "HH:MM-HH:MM" 만 읽어서
// '지금 문 연 곳' 에서만 조용히 빠진다 — 오류도 경고도 없다. 그래서 여기서 규격으로 고치고,
// 여는 시각·닫는 시각 둘을 못 찾으면 "" 를 돌려줘 화면이 "못 읽었다" 고 말하게 한다.
export function normalizeHours(text) {
  const s = String(text || "").trim();
  if (!s) return "";
  const okClock = (t) => +t.slice(0, 2) < 24 && +t.slice(3) < 60;
  const d = decomposeHours(s);
  if (d) return okClock(d.open) && okClock(d.close) ? s : "";   // 이미 규격이면 그대로 — 25:00 같은 건 빼고
  const T = "(오전|오후|am|pm|낮|밤|새벽)?\\s*(\\d{1,2})(?::(\\d{2})|시\\s*(?:(\\d{1,2})\\s*분)?)?\\s*(오전|오후|am|pm)?";
  const m = new RegExp(`${T}\\s*(?:[-~–—]|부터|에서|to)\\s*${T}`, "i").exec(s);
  if (!m) return "";
  const clock = (pre, h, mm, mm2, post) => {
    let hour = +h;
    const mer = String(pre || post || "").toLowerCase();
    if (/오후|pm|밤/.test(mer) && hour < 12) hour += 12;
    if (/오전|am/.test(mer) && hour === 12) hour = 0;
    return { hour, min: +(mm || mm2 || 0) };
  };
  const a = clock(m[1], m[2], m[3], m[4], m[5]);
  const b = clock(m[6], m[7], m[8], m[9], m[10]);
  // "10-10" · "11-2" 처럼 오후를 안 적은 닫는 시각 — 여는 시각보다 앞이면 오후로 본다.
  // "18-2" 는 그래도 앞이니(새벽 2시) 그대로 둔다: 자정 넘김은 openNow 가 안다.
  if (!m[6] && !m[10] && b.hour <= a.hour && b.hour + 12 > a.hour && b.hour + 12 < 24) b.hour += 12;
  if (a.hour > 23 || b.hour > 23 || a.min > 59 || b.min > 59) return "";
  const pad = (n) => String(n).padStart(2, "0");
  // 쉬는 날. '매일' 의 '일' 을 일요일로 읽으면 안 되므로 앞글자 '매' 는 뺀다.
  const off = [];
  if (!/무휴/.test(s)) {
    for (const h of s.matchAll(/휴무|휴점|정기휴일|쉽니다|쉼/g)) {
      const before = s.slice(Math.max(0, h.index - 12), h.index);
      if (/주말/.test(before)) off.push("토", "일");
      if (/평일/.test(before)) off.push("월", "화", "수", "목", "금");
      for (const d of before.match(/(?<!매)[월화수목금토일](?=요일|[·,/\s휴]|$)/g) || []) off.push(d);
    }
  }
  return composeHours({ open: `${pad(a.hour)}:${pad(a.min)}`, close: `${pad(b.hour)}:${pad(b.min)}`, off: [...new Set(off)] });
}

// 주소에서 동네 이름만. 카드에 전체 주소를 넣으면 한가운데서 잘려
// 정보도 장식도 아닌 것이 남는다 — 손님이 카드에서 알고 싶은 건 "어느 동네냐" 하나다.
// 전체 주소는 가게 상세에서 그대로 보여준다.
export function dongOf(address) {
  const s = String(address || "").trim();
  if (!s) return "";
  const m = /([가-힣A-Za-z0-9]+(?:동|가|읍|면|리))(?=\s|$|\d)/.exec(s);
  if (m) return m[1];
  // 동 이름이 없는 도로명 주소면 길 이름을 쓴다. 한 상권 안에서는 구 이름이 모두 같아
  // "서초구"만 적으면 카드마다 같은 글자가 스물아홉 번 반복될 뿐 아무것도 알려주지 않는다.
  const r = /([가-힣A-Za-z0-9]+(?:대로|로|길))(?=\s|$|\d)/.exec(s);
  if (r) return r[1];
  // 시·군·구가 여럿이면 가장 좁은 쪽(뒤에 나온 것)을 쓴다 — "경기 성남시 분당구" 는 분당구다.
  const g = [...s.matchAll(/([가-힣]+(?:시|군|구))(?=\s|$)/g)];
  return g.length ? g[g.length - 1][1] : "";
}

// 이메일 마스킹 — 로그·화면에 원문을 남기지 않는다
export function maskEmail(e) {
  const [a, b] = String(e || "").split("@");
  if (!b) return "";
  return `${a.slice(0, 2)}${"*".repeat(Math.max(1, a.length - 2))}@${b}`;
}

// 로그인 뒤 돌아갈 자리로 쓸 수 있는 값인가.
// 같은 사이트 안의 경로 하나만 허용한다 — `//evil.example` 같은 값을 그대로 넘기면
// "로그인하세요" 를 미끼로 남의 사이트로 보내는 열린 리다이렉트가 된다.
export const safeNext = (p) => {
  const s = String(p || "");
  return /^\/[\w\-./%가-힣]*$/.test(s) && !s.startsWith("//") && s.length <= 300 ? s : "";
};
