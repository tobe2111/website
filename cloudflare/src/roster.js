// 상인회 회원 명부를 엑셀에서 그대로 옮겨 붙이기.
//
// 상인회는 이미 명부를 갖고 있습니다. 총회 자료로 쓰는 엑셀 한 장에 상호·대표자·전화번호·
// 주소·업종이 다 들어 있습니다. 그런데 지금까지는 그걸 두고도 **한 곳씩 손으로 다시 쳐야**
// 했습니다. 114곳이면 114번입니다. 거기서 대부분 그만둡니다.
//
// 그래서 붙여넣기 한 번으로 끝내되, **엑셀이 망가뜨려 놓은 것을 여기서 되돌립니다.**
// 그게 이 파일의 존재 이유입니다.
//
// ■ 엑셀이 전화번호 앞의 0 을 지웁니다
//
//   명부에 01099117118 이라고 적어도 엑셀은 그것을 숫자로 보고 1099117118 로 저장합니다.
//   실제로 받은 명부 114줄이 **전부** 그 모양이었습니다. 그대로 넣으면 114명 전원이
//   걸 수 없는 번호를 갖게 되고, 그건 화면 어디에도 오류로 안 뜹니다 — 손님이 전화를
//   걸었을 때 안 걸릴 뿐입니다.
//
// ■ 업종이 상인회마다 다른 말로 적혀 있습니다
//
//   받은 명부에는 업종이 27가지였습니다(음식업·주점·노래방·뜸/침·태권도 …).
//   손님 화면의 분류는 일곱 가지입니다. 27개를 그대로 두면 목록 위 분류 단추가 27개가 되어
//   아무도 안 누릅니다. 그래서 묶는데, **묶은 결과를 미리 보여 주고 넣습니다.**
//   조용히 바꾸면 회장님이 나중에 "왜 노래방이 생활·서비스지" 하고 놀라게 됩니다.
import { cap } from "./util.js";
import { normalizePhone, isValidPhone } from "./db.js";
import { parseTable } from "./csv.js";

export const IMPORT_MAX = 300;   // 한 번에 붙여넣을 수 있는 줄 수

// ---------- 머리글 알아보기 ----------
// 상인회마다 부르는 말이 다릅니다. 우리가 맞춥니다.
// 순서가 중요합니다 — '상호' 를 '대표자' 보다 먼저 봅니다. 명부에 '이름' 한 칸만 있으면
// 그건 가게 이름일 확률이 높지만, '상호' 와 '이름' 이 함께 있으면 '이름' 은 사람입니다.
const ALIAS = [
  ["name", ["상호", "상호명", "업체명", "업소명", "점포명", "가게명", "가게", "사업장", "사업장명", "매장명", "회원사"]],
  ["owner", ["대표자", "대표", "대표자명", "성명", "성함", "점주", "사장님", "사장", "회원명", "이름"]],
  ["phone", ["전화번호", "휴대폰", "휴대전화", "연락처", "전화", "핸드폰", "phone", "tel", "mobile"]],
  ["address", ["도로명주소", "지번주소", "주소", "소재지", "위치", "address"]],
  ["cat", ["업종", "업태", "종목", "분류", "카테고리", "category"]],
];
const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
export function rosterHeaderRole(cell) {
  const n = norm(cell);
  if (!n) return null;
  for (const [role, names] of ALIAS) if (names.some((a) => norm(a) === n)) return role;
  return null;
}

// ---------- 엑셀이 지운 0 을 되돌린다 ----------
//
// 규칙은 하나뿐입니다: **숫자만 남겼을 때 0 으로 시작하지 않으면 0 을 붙인다.**
// 한국 전화번호는 국번 없이 시작하는 것이 없습니다(010·02·031·1588 …).
// 1588·1600 같은 대표번호만 예외라 그건 건드리지 않습니다.
//
// 이미 올바른 01012345678 은 0 으로 시작하므로 손대지 않습니다 — 되돌리기가
// 멀쩡한 번호를 망가뜨리면 안 됩니다.
export function restorePhone(raw) {
  const d = String(raw ?? "").replace(/[^\d]/g, "");
  if (!d) return { phone: "", fixed: false };
  if (d.startsWith("0")) return { phone: normalizePhone(d), fixed: false };
  if (/^1[5-9]\d\d/.test(d)) return { phone: normalizePhone(d), fixed: false };  // 1588·1600 대표번호
  if (d.length === 9 || d.length === 10) return { phone: normalizePhone("0" + d), fixed: true };
  return { phone: normalizePhone(d), fixed: false };
}

// ---------- 업종을 손님 화면의 일곱 분류로 ----------
//
// 앞에 있는 것부터 봅니다. 적힌 말에 그 낱말이 들어 있으면 그 분류입니다.
// 겹치는 말은 더 좁은 쪽을 위에 둡니다 — '정육식당' 은 식당이지 정육점이 아니고,
// '정육점' 은 파는 곳이라 농수축산입니다.
const CAT_RULES = [
  ["음식점", ["음식", "식당", "한식", "중식", "일식", "양식", "분식", "고깃집", "정육식당", "치킨", "피자", "국밥", "칼국수", "횟집", "주점", "호프", "술집", "포차", "이자카야", "바(bar)", "요리"]],
  ["카페·디저트", ["카페", "커피", "디저트", "제과", "제빵", "베이커리", "빵", "떡", "아이스크림", "빙수", "차(茶)", "전통찻집"]],
  ["농수축산", ["정육", "청과", "수산", "건어물", "농산", "축산", "반찬", "젓갈", "쌀"]],
  ["교육·문화", ["학원", "교습", "공부방", "독서실", "태권도", "합기도", "검도", "미술", "음악", "피아노", "무용", "서점", "공방", "화실", "스포츠", "헬스", "필라테스", "요가", "체육", "골프", "당구", "볼링"]],
  ["패션·잡화", ["의류", "옷", "패션", "안경", "신발", "구두", "가방", "잡화", "액세서리", "화장품", "문구", "완구", "선물", "꽃", "화원", "귀금속", "시계", "침구", "가구"]],
  ["생활·서비스", ["노래", "부동산", "공인중개", "미용", "뷰티", "네일", "피부", "이용원", "이발", "세탁", "수선", "철물", "열쇠", "자동차", "카센터", "정비", "세차", "사진", "인화", "동물병원", "약국", "의원", "병원", "한의", "치과", "침", "뜸", "마사지", "안마", "인테리어", "설비", "통신", "휴대폰", "편의점", "마트", "슈퍼", "숙박", "호텔", "모텔", "여관", "고시원", "세무", "법무", "회계", "노무", "제조", "유통", "물류", "택배", "인쇄", "복사", "은행", "보험", "카센타", "pc방", "피시방", "오락"]],
];
export function mapCategory(raw) {
  const s = norm(raw);
  if (!s) return "기타";
  for (const [cat, keys] of CAT_RULES) if (keys.some((k) => s.includes(norm(k)))) return cat;
  return "기타";
}

// ---------- 주소 앞머리 ----------
//
// 상인회 명부의 주소는 대개 "방배중앙로 174" 처럼 **동네 안에서만 통하는 주소**입니다.
// 그대로 넣으면 지도가 못 찾습니다 — 전국에 같은 이름의 길이 있습니다.
// 그래서 시·구를 앞에 붙이는데, 이미 붙어 있으면 두 번 붙이지 않습니다.
export function withPrefix(address, prefix) {
  const a = String(address || "").trim();
  const p = String(prefix || "").trim();
  if (!a || !p) return a;
  const last = p.split(/\s+/).filter(Boolean).pop() || p;   // "서울특별시 서초구" → "서초구"
  return a.includes(last) ? a : `${p} ${a}`;
}
// 상인회 자기 주소에서 시·구를 뽑아 기본값으로 씁니다. 회장님이 화면에서 고칠 수 있습니다.
export function guessPrefix(address) {
  const t = String(address || "").trim().split(/\s+/).filter(Boolean);
  if (t.length < 2) return "";
  return /(시|도)$/.test(t[0]) && /(구|군|시)$/.test(t[1]) ? `${t[0]} ${t[1]}` : "";
}

// ---------- 명부 한 장 → 줄들 ----------
export function parseMemberRoster(text, { prefix = "" } = {}) {
  const table = parseTable(text);
  if (table.length < 2)
    return { error: "첫 줄에 머리글(상호·대표자·전화번호·주소·업종), 그 아래로 가게를 한 줄씩 붙여 주세요." };

  // 명부 맨 위에 "○○상가번영회 회원명부" 같은 제목 줄이 붙어 옵니다. 그 줄을 머리글로
  // 읽으면 전부 실패합니다. 그렇다고 "채워진 칸이 둘 미만이면 건너뛴다" 로 풀면
  // **상호 한 칸짜리 명부**가 통째로 사라집니다. 그래서 세는 대신 **알아보는** 쪽으로 합니다:
  // 앞쪽 다섯 줄 중 우리가 아는 머리글 낱말이 하나라도 있는 첫 줄이 머리글입니다.
  let h = 0;
  for (let i = 0; i < Math.min(table.length, 5); i++) {
    if (table[i].some((c) => rosterHeaderRole(c))) { h = i; break; }
  }
  const head = table[h] || [];
  const roles = head.map(rosterHeaderRole);
  const idx = { name: -1, owner: -1, phone: -1, address: -1, cat: -1 };
  for (let i = 0; i < roles.length; i++) if (roles[i] && idx[roles[i]] < 0) idx[roles[i]] = i;
  if (idx.name < 0)
    return { error: "머리글에 '상호' 칸이 없습니다. 첫 줄을 상호 · 대표자 · 전화번호 · 주소 · 업종 으로 적어 주세요." };

  const body = table.slice(h + 1);
  if (body.length > IMPORT_MAX)
    return { error: `한 번에 ${IMPORT_MAX}줄까지 넣을 수 있습니다. (붙여넣은 명부 ${body.length}줄) 나눠서 넣어 주세요.` };

  const rows = [];
  const seen = new Set();
  for (let r = 0; r < body.length; r++) {
    const c = body[r];
    const g = (i) => (i >= 0 ? cap(String(c[i] ?? "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 200) : "");
    const name = cap(g(idx.name), 100);
    const owner = cap(g(idx.owner), 60);
    const rawCat = g(idx.cat);
    const { phone, fixed } = restorePhone(g(idx.phone));
    const address = cap(withPrefix(g(idx.address), prefix), 200);
    const row = {
      seq: r + 1, name, owner, phone, phoneFixed: fixed, address,
      rawCat, category: mapCategory(rawCat), status: "ok", note: "",
    };
    // '?' 는 명부에서 "아직 안 알아봤다" 는 뜻으로 쓰입니다. 그 글자를 그대로 넣지 않습니다.
    if (row.owner === "?") row.owner = "";
    if (row.address.endsWith("?") || row.address === "?") row.address = "";
    if (!name) { row.status = "bad"; row.note = "상호가 비어 있습니다"; }
    else if (seen.has(norm(name))) { row.status = "bad"; row.note = "위에 같은 상호가 이미 있습니다"; }
    else if (phone && !isValidPhone(phone)) { row.status = "bad"; row.note = `전화번호를 확인해 주세요 (${phone})`; }
    if (row.status === "ok") seen.add(norm(name));
    rows.push(row);
  }
  return { rows, has: { owner: idx.owner >= 0, phone: idx.phone >= 0, address: idx.address >= 0, cat: idx.cat >= 0 } };
}

// 이미 등록된 상호는 건너뜁니다.
//
// 이게 이 기능의 안전장치입니다. 114줄을 넣다가 중간에 끊겨도, **같은 명부를 다시 붙여
// 넣으면** 들어간 것은 건너뛰고 못 들어간 것만 들어갑니다. 그래서 실패해도 잃을 것이 없고,
// 회장님이 "어디까지 들어갔지" 를 세지 않아도 됩니다.
export function markExisting(rows, existingNames) {
  const have = new Set([...existingNames].map(norm));
  for (const r of rows) {
    if (r.status !== "ok") continue;
    if (have.has(norm(r.name))) { r.status = "dup"; r.note = "이미 등록돼 있습니다"; }
  }
  return rows;
}
