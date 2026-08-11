// 한글 → 로마자. 주소(slug)를 짧은 영문으로 만들기 위한 것.
//
// 왜 필요한가: 슬러그에 한글을 두면 `/t/서초구-상인회` 가 링크로 복사될 때
// `/t/%EC%84%9C%EC%B4%88%EA%B5%AC-...` 로 늘어난다. 한 글자가 9바이트다.
// 알림톡 버튼·명함·구두 안내 어디에도 쓰기 어렵다.
//
// 국어의 로마자 표기법(2000)을 따르되, 자음동화·구개음화 같은 발음 변화는
// 적용하지 않는다. 슬러그는 '읽는 법'이 아니라 '안정적인 식별자'가 우선이라
// 같은 글자가 언제나 같은 철자로 나오는 편이 낫다.

// 초성 19 / 중성 21 / 종성 28 — 유니코드 한글 음절의 조합 순서 그대로
const CHO = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const JUNG = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
// 28개(받침 없음 + 27종). 개수가 하나라도 어긋나면 이후 글자가 통째로 밀린다 —
// ㅇ(ng)이 t 로 나오면 '강남'이 'gatnam' 이 된다.
const JONG = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l",
  "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];

const BASE = 0xac00, LAST = 0xd7a3;

// 자모 단독 입력(ㄱ, ㅏ 등)도 흔하다 — 호환 자모 영역을 개별로 받아 둔다
const COMPAT_CHO = { "ㄱ": "g", "ㄲ": "kk", "ㄴ": "n", "ㄷ": "d", "ㄸ": "tt", "ㄹ": "r", "ㅁ": "m", "ㅂ": "b",
  "ㅃ": "pp", "ㅅ": "s", "ㅆ": "ss", "ㅇ": "ng", "ㅈ": "j", "ㅉ": "jj", "ㅊ": "ch", "ㅋ": "k", "ㅌ": "t", "ㅍ": "p", "ㅎ": "h" };
const COMPAT_JUNG = { "ㅏ": "a", "ㅐ": "ae", "ㅑ": "ya", "ㅒ": "yae", "ㅓ": "eo", "ㅔ": "e", "ㅕ": "yeo", "ㅖ": "ye",
  "ㅗ": "o", "ㅘ": "wa", "ㅙ": "wae", "ㅚ": "oe", "ㅛ": "yo", "ㅜ": "u", "ㅝ": "wo", "ㅞ": "we", "ㅟ": "wi",
  "ㅠ": "yu", "ㅡ": "eu", "ㅢ": "ui", "ㅣ": "i" };

export function romanizeChar(ch) {
  const code = ch.codePointAt(0);
  if (code >= BASE && code <= LAST) {
    const i = code - BASE;
    return CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28];
  }
  return COMPAT_CHO[ch] || COMPAT_JUNG[ch] || "";
}

// 한글이 섞인 문자열을 로마자로. 한글이 아닌 글자(영문·숫자·기호)는 그대로 통과시킨다.
export function romanize(s) {
  let out = "";
  for (const ch of String(s ?? "")) {
    const code = ch.codePointAt(0);
    const isHangul = (code >= BASE && code <= LAST) || (code >= 0x3131 && code <= 0x318e);
    out += isHangul ? romanizeChar(ch) : ch;
  }
  return out;
}

// 조직 이름에서 슬러그로 쓸 알맹이만 남긴다.
// "서초구 상인회" → "seochogu" : 뒤에 붙는 조직 형태(상인회·법무법인·주식회사…)는
// 어느 조직에나 붙는 말이라 주소를 길게만 만들고 구별에는 도움이 안 된다.
// 다만 이걸 떼면 이름이 통째로 사라지는 경우(예: "상인회")에는 떼지 않는다.
const NOISE = [
  "주식회사", "유한회사", "유한책임회사", "합자회사", "합명회사", "사단법인", "재단법인", "협동조합",
  "법무법인", "회계법인", "세무법인", "노무법인", "특허법인", "의료법인", "학교법인",
  "상인회", "번영회", "상가번영회", "상점가", "상인연합회", "시장상인회", "협회", "조합", "센터",
  "공인중개사사무소", "공인중개사", "부동산중개", "컨설팅", "파트너스", "그룹",
];
export function coreName(name) {
  let s = String(name ?? "").trim();
  for (const w of NOISE) {
    if (!s.includes(w)) continue;
    const stripped = s.split(w).join(" ").trim();
    if (stripped.replace(/\s+/g, "")) s = stripped; // 다 지워지면 원래대로 둔다
  }
  return s.trim() || String(name ?? "").trim();
}
