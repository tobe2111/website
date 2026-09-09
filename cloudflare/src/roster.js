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
import { cap, slugify } from "./util.js";
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

// ---------- 머리글이 아예 없을 때 ----------
//
// 엑셀에서 **몸통만** 긁어 붙이는 일이 훨씬 흔합니다. 명부의 머리글은 병합된 칸이거나
// 위에 제목 줄이 얹혀 있어서, 그냥 첫 가게 줄부터 드래그하게 됩니다.
// 그때 "머리글이 없습니다" 로 돌려보내면 회장님은 엑셀로 돌아가 머리글을 만들어 다시
// 복사해야 합니다. 거기서 대부분 그만둡니다 — 그러라고 만든 화면이 아닙니다.
//
// 그래서 **칸의 내용을 보고** 무슨 칸인지 알아냅니다. 확실한 것부터 집습니다.
//   ① 연번     — "1 2 3 …" 이 올라가기만 하는 칸은 자료가 아닙니다. 먼저 빼 둡니다.
//   ② 상호     — 남은 것 중 가장 왼쪽. 명부에서 상호는 연번 다음 첫 칸입니다.
//   ③ 전화번호 — 숫자 9~11자리가 줄줄이 있는 칸은 그것 말고 없습니다.
//   ④ 주소     — "769-10" 같은 지번이나 "…로 174" 가 늘어선 칸.
//   ⑤ 업종     — 남은 칸 중 우리 분류에 걸리는 말이 대부분인 칸.
//   ⑥ 대표자   — 그러고도 남은 칸 중 두세 글자 한글 이름만 있는 칸.
//
// 상호를 **가장 먼저** 자리에 앉히는 것이 중요합니다. 내용으로 겨루게 두면 상호가
// 업종에 집니다 — "박사부동산" "컴포즈커피" 같은 상호는 업종 낱말을 품고 있어서
// 업종 칸과 점수가 같아집니다. 그러면 상호가 비어 아무것도 못 넣습니다.
//
// 알아낸 결과는 **미리보기 표 위에 적어 보여 줍니다.** 조용히 넘겨짚지 않습니다.
const cellsOf = (rows, i) => rows.map((r) => String(r[i] ?? "").trim()).filter(Boolean);
const frac = (arr, f) => (arr.length ? arr.filter(f).length / arr.length : 0);

const isPhoneCell = (s) => /^[\d\s().+-]+$/.test(s) && s.replace(/\D/g, "").length >= 9
  && s.replace(/\D/g, "").length <= 11;
// 지번("769-10") · 도로명("방배중앙로 174") · 아직 안 알아본 칸("?")
const isAddrCell = (s) => s === "?" || /^\d{1,5}(-\d{1,4})?$/.test(s)
  || /(대?로|길|동|가|읍|면|리)\s*\d/.test(s);
const isPersonCell = (s) => s === "?" || /^[가-힣]{2,4}$/.test(s);

// 연번 칸 — "1 2 3 …" 처럼 1(이나 2)부터 하나씩 올라가기만 하는 정수 칸.
// 지번 주소("2233" "3282")를 여기에 걸리게 하면 안 되므로 **올라가기만 할 것**과
// **1~2 에서 시작할 것**을 함께 봅니다. 지번은 그 두 가지를 함께 만족하지 않습니다.
function isSeqColumn(c) {
  if (c.length < 3 || !c.every((v) => /^\d{1,4}$/.test(v))) return false;
  const n = c.map(Number);
  if (n[0] > 2) return false;
  for (let i = 1; i < n.length; i++) if (n[i] <= n[i - 1]) return false;
  return true;
}

export function inferRosterColumns(body) {
  const sample = body.slice(0, 40);
  const width = sample.reduce((n, r) => Math.max(n, r.length), 0);
  const idx = { name: -1, owner: -1, phone: -1, address: -1, cat: -1 };
  if (!width) return idx;

  const cols = [];
  for (let i = 0; i < width; i++) cols.push(cellsOf(sample, i));
  const taken = new Set();
  for (let i = 0; i < width; i++) if (!cols[i].length || isSeqColumn(cols[i])) taken.add(i);

  const pick = (role, score, min) => {
    let best = -1, bestScore = 0;
    for (let i = 0; i < width; i++) {
      if (taken.has(i)) continue;
      const s = score(cols[i]);
      if (s > bestScore) { bestScore = s; best = i; }
    }
    if (best >= 0 && bestScore >= min) { idx[role] = best; taken.add(best); }
  };

  for (let i = 0; i < width; i++) if (!taken.has(i)) { idx.name = i; taken.add(i); break; }
  pick("phone", (c) => frac(c, isPhoneCell), 0.6);
  pick("address", (c) => frac(c, isAddrCell), 0.6);
  pick("cat", (c) => frac(c, (v) => mapCategory(v) !== "기타"), 0.5);
  pick("owner", (c) => frac(c, isPersonCell), 0.7);
  return idx;
}

// 머리글을 **못 알아봤을 뿐** 머리글이 있을 수 있습니다("연락처번호" 처럼 우리가 모르는 말).
// 전화번호 칸의 첫 줄에 숫자가 하나도 없으면 그 줄은 사람이 아니라 머리글입니다.
// 판정을 이 한 가지로만 좁힌 이유: 멀쩡한 첫 가게를 말없이 버리는 쪽이 훨씬 나쁩니다.
function looksLikeHeaderRow(row, idx) {
  if (idx.phone < 0) return false;
  const v = String(row[idx.phone] ?? "").trim();
  return !!v && !/\d/.test(v);
}

// 알아낸 칸을 사람 말로 — 미리보기 위에 적어 줍니다.
const ROLE_LABEL = { name: "상호", owner: "대표자", phone: "전화번호", address: "주소", cat: "업종" };
export function describeColumns(idx) {
  return Object.keys(ROLE_LABEL)
    .filter((r) => idx[r] >= 0)
    .sort((a, b) => idx[a] - idx[b])
    .map((r) => `${idx[r] + 1}번째 칸 = ${ROLE_LABEL[r]}`);
}

// ---------- 명부 한 장 → 줄들 ----------
export function parseMemberRoster(text, { prefix = "" } = {}) {
  const table = parseTable(text);
  if (!table.length)
    return { error: "첫 줄에 머리글(상호·대표자·전화번호·주소·업종), 그 아래로 가게를 한 줄씩 붙여 주세요." };

  // 명부 맨 위에 "○○상가번영회 회원명부" 같은 제목 줄이 붙어 옵니다. 그 줄을 머리글로
  // 읽으면 전부 실패합니다. 그렇다고 "채워진 칸이 둘 미만이면 건너뛴다" 로 풀면
  // **상호 한 칸짜리 명부**가 통째로 사라집니다. 그래서 세는 대신 **알아보는** 쪽으로 합니다:
  // 앞쪽 다섯 줄 중 우리가 아는 머리글 낱말이 하나라도 있는 첫 줄이 머리글입니다.
  let h = -1;
  for (let i = 0; i < Math.min(table.length, 5); i++) {
    if (table[i].some((c) => rosterHeaderRole(c))) { h = i; break; }
  }

  let idx, body, inferred = null;
  if (h >= 0) {
    const roles = (table[h] || []).map(rosterHeaderRole);
    idx = { name: -1, owner: -1, phone: -1, address: -1, cat: -1 };
    for (let i = 0; i < roles.length; i++) if (roles[i] && idx[roles[i]] < 0) idx[roles[i]] = i;
    // 머리글을 알아봤는데 그 안에 '상호' 가 없으면 넘겨짚지 않고 멈춥니다.
    // 머리글이 있다는 건 회장님이 칸 이름을 적었다는 뜻이고, 그러면 무엇을 고쳐야
    // 하는지 말해 주는 쪽이 낫습니다. 아래 '알아맞히기' 는 머리글이 아예 없을 때만 씁니다.
    if (idx.name < 0)
      return { error: "머리글에 '상호' 칸이 없습니다. 첫 줄을 상호 · 대표자 · 전화번호 · 주소 · 업종 으로 적어 주세요." };
    body = table.slice(h + 1);
  } else {
    // 머리글 없이 몸통만 붙여넣었습니다 — 칸의 내용을 보고 알아냅니다.
    body = table;
    idx = inferRosterColumns(body);
    if (idx.name < 0)
      return { error: "첫 줄에 머리글(상호·대표자·전화번호·주소·업종), 그 아래로 가게를 한 줄씩 붙여 주세요." };
    if (body.length > 1 && looksLikeHeaderRow(body[0], idx)) body = body.slice(1);
    inferred = idx;
  }
  if (!body.length)
    return { error: "머리글 아래에 가게가 한 줄도 없습니다. 가게를 한 줄씩 붙여 주세요." };

  if (body.length > IMPORT_MAX)
    return { error: `한 번에 ${IMPORT_MAX}줄까지 넣을 수 있습니다. (붙여넣은 명부 ${body.length}줄) 나눠서 넣어 주세요.` };

  const rows = [];
  const seen = new Set();
  // 이름은 다른데 **가게 주소(영문 주소)가 같아지는** 줄이 있습니다("본죽"/"본 죽").
  // 한 상인회 안에서 그 주소는 하나뿐이라 뒤엣것은 못 들어갑니다. 조용히 빠지면
  // 회장님은 113곳만 들어간 것을 세어 보고서야 아는데, 그때는 어느 줄인지 모릅니다.
  const seenSlug = new Set();
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
    else if (seenSlug.has(slugify(name))) {
      row.status = "bad";
      row.note = "위의 어느 상호와 인터넷 주소가 같아집니다 — 한쪽 이름을 조금 다르게 적어 주세요";
    }
    if (row.status === "ok") { seen.add(norm(name)); seenSlug.add(slugify(name)); }
    rows.push(row);
  }
  return {
    rows,
    has: { owner: idx.owner >= 0, phone: idx.phone >= 0, address: idx.address >= 0, cat: idx.cat >= 0 },
    inferred,   // 머리글 없이 알아낸 경우에만 채워집니다 — 화면이 "이렇게 읽었다" 고 적습니다
  };
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
