// 표 붙여넣기 / CSV 읽기.
//
// 왜 직접 쓰는가: 대량 발송의 입력은 결국 엑셀이다. 라이브러리를 하나 붙이면 번들이 커지고
// (워커 1MB 한도), 정작 필요한 건 "따옴표 안의 쉼표"와 "탭인지 쉼표인지" 두 가지뿐이다.
//
// ⚠️ 한국 엑셀의 기본 '.csv' 는 CP949 다. 워커의 TextDecoder 는 UTF-8 만 안다 —
//    그래서 파일을 읽을 때는 fatal 로 걸러 내고 "CSV UTF-8 로 저장해 주세요" 라고 말해 준다.
//    붙여넣기 칸을 함께 두는 이유가 이것이다: 엑셀에서 칸을 복사하면 언제나 UTF-8 탭 구분이다.

// 첫 줄에 탭이 쉼표보다 많으면 탭 구분표(엑셀에서 복사한 것)로 본다.
const delimOf = (firstLine) =>
  (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? "\t" : ",";

// 텍스트 → 2차원 배열. 빈 줄은 버리고, 칸의 앞뒤 공백은 없앤다.
export function parseTable(text) {
  const s = String(text ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!s.trim()) return [];
  const d = delimOf(s.split("\n", 1)[0]);
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') { cell += c; continue; }
      if (s[i + 1] === '"') { cell += '"'; i++; continue; }   // "" = 따옴표 한 개
      quoted = false;
      continue;
    }
    if (c === '"' && cell === "") { quoted = true; continue; }
    if (c === d) { row.push(cell); cell = ""; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows
    .map((r) => r.map((v) => v.trim()))
    .filter((r) => r.some((v) => v !== ""));
}

// 배열 → CSV 글자. 엑셀이 한글을 깨뜨리지 않게 BOM 을 앞에 붙인다.
export function toCsv(rows, { bom = true } = {}) {
  const cell = (v) => {
    let s = String(v ?? "");
    // 수식 인젝션 방지 — '=' 로 시작하는 칸을 엑셀은 수식으로 실행한다.
    // 이 파일의 머리글은 계약서에 사람이 써 넣은 빈칸 이름에서 온다.
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (bom ? "﻿" : "") + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

// 업로드된 파일 바이트 → 글자. UTF-8 이 아니면 그렇게 말해 준다(추측해서 깨진 글자를 넣지 않는다).
export function decodeUtf8(bytes) {
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, error: "글자가 UTF-8 이 아닙니다. 엑셀에서 [다른 이름으로 저장 → CSV UTF-8]로 저장하시거나, 엑셀에서 칸을 복사해 아래 붙여넣기 칸에 붙여 주세요." };
  }
}

// ---------- 머리글 알아보기 ----------
// 사람은 '이름' 이라고도 '성명' 이라고도 쓴다. 우리가 맞춰 준다.
const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
const ALIAS = {
  name: ["이름", "성명", "수신자", "받는사람", "name"],
  phone: ["휴대폰", "휴대전화", "전화", "전화번호", "연락처", "핸드폰", "phone", "mobile", "tel"],
  email: ["이메일", "메일", "email", "e-mail", "mail"],
  org: ["상호", "회사", "회사명", "소속", "업체", "업체명", "org", "company"],
};
// 머리글 한 칸이 무엇인가 — 사람 정보이면 그 이름, 아니면 null(= 빈칸 이름으로 본다).
export function headerRole(cell) {
  const n = norm(cell);
  for (const [role, names] of Object.entries(ALIAS)) if (names.some((a) => norm(a) === n)) return role;
  return null;
}
