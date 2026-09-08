// 지도에 올라온 그 가게의 대표 사진 한 장.
//
// ── 왜 이렇게 가져오나
// 카카오 로컬 API(상호·주소·좌표를 채우는 그것)는 사진을 주지 않는다. 카카오는
// "장소 정보는 외부에서 임의로 활용할 수 없고 place_url 로 연결해서만 쓸 수 있다"고
// 못 박았다. 그래서 내부 JSON 주소를 몰래 부르지 않는다.
//
// 대신 그 place_url 페이지가 스스로 공개하는 `og:image` 를 읽는다. og 태그는 애초에
// **다른 사이트가 읽어 가라고 붙이는 것**이다 — 카톡·슬랙·검색엔진이 미리보기를 만들 때
// 하는 일과 똑같다. 열쇠도 필요 없고, 받아 오는 것은 4KB 짜리 HTML 한 장이다.
//
// ── 한 장뿐이다
// 갤러리 전체는 못 가져온다. 대표 사진 한 장이다. 그래도 "회색 상자" 보다는 낫고,
// 사장님 사진이 들어오면 바꾸면 된다.
//
// ── 이 사진은 남이 찍은 것이다
// 주소를 보면 알 수 있다: .../kakaomapPhoto/review/... — 손님이 올린 후기 사진이다.
// 그래서 담을 때 출처를 반드시 함께 남긴다(media.source_name·source_url). 내려 달라는
// 요청이 오면 어느 사진인지 찾을 수 있어야 한다.

const TIMEOUT_MS = 4000;
const MAX_HTML = 512 * 1024;   // 장소 페이지는 4KB 안팎이다. 그보다 크면 우리가 아는 그 페이지가 아니다.

// 사진이 실려도 되는 곳. 장소 페이지가 엉뚱한 주소를 og:image 로 들고 있어도
// 우리 서버가 아무 데나 찌르지 않게 막는다.
const PHOTO_HOSTS = /(^|\.)(kakaocdn\.net|daumcdn\.net|pstatic\.net)$/i;

// 카카오맵 장소 주소에서 번호만. place_url 은 http 로 오기도 한다.
export function kakaoPlaceId(url) {
  const m = /^https?:\/\/place\.map\.kakao\.com\/(\d{1,15})(?:[/?#]|$)/.exec(String(url || "").trim());
  return m ? m[1] : "";
}

// 지도 상세 주소인가. 사람이 손으로 아무 주소나 넣어 두었을 수 있다.
export function isPlaceUrl(url) {
  const s = String(url || "").trim();
  if (kakaoPlaceId(s)) return true;
  return /^https:\/\/(map\.naver\.com|naver\.me|m\.place\.naver\.com|place\.map\.kakao\.com|map\.kakao\.com)\//i.test(s);
}

const attr = (html, prop) => {
  // <meta property="og:image" content="…"> — 순서가 뒤바뀐 것도 받는다
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i");
  const tag = re.exec(String(html || ""));
  if (!tag) return "";
  const c = /content=["']([^"']+)["']/i.exec(tag[0]);
  return c ? c[1].trim() : "";
};

const absolutize = (u) => {
  const s = String(u || "").trim();
  if (!s) return "";
  if (s.startsWith("//")) return "https:" + s;      // 카카오는 //img1.kakaocdn.net/… 로 준다
  return /^https:\/\//i.test(s) ? s : "";           // http 사진은 받지 않는다
};

const allowedPhoto = (u) => {
  try { const x = new URL(u); return x.protocol === "https:" && PHOTO_HOSTS.test(x.hostname); }
  catch { return false; }
};

// 그 장소 페이지가 스스로 밝힌 대표 사진.
// 못 가져오면 빈 값을 준다 — 지도가 느리다고 우리 화면이 같이 죽으면 안 된다.
export async function placePhoto(mapUrl) {
  const url = String(mapUrl || "").trim();
  if (!isPlaceUrl(url)) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ac.signal, redirect: "follow",
      headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; MerchantSite/1.0)" },
    });
    if (!r.ok) return null;
    const len = Number(r.headers.get("content-length") || 0);
    if (len && len > MAX_HTML) return null;
    const html = (await r.text()).slice(0, MAX_HTML);
    const img = absolutize(attr(html, "og:image"));
    if (!img || !allowedPhoto(img)) return null;
    return {
      url: img,
      title: attr(html, "og:title") || "",
      // 출처는 사진 주소가 아니라 **사람이 열어 볼 수 있는 페이지**를 남긴다
      source: kakaoPlaceId(url) ? "카카오맵" : "네이버 지도",
      sourceUrl: attr(html, "og:url") || url,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 이 가게의 지도 주소로 쓸 만한 것.
//
// map_url 은 '장소 찾기' 로 가게를 고른 뒤에야 생긴다. 그런데 그 칸을 만들기 전에
// 등록된 가게가 이미 많고, 그중 상당수는 **네이버 플레이스 주소를 손으로 넣어 두었다**
// (sns_naver). 그걸 두고 "장소 찾기를 다시 하세요" 라고 하면 아무도 안 한다.
// 이미 있는 것을 먼저 쓴다.
export function placeSourceOf(b) {
  if (!b) return "";
  if (isPlaceUrl(b.map_url)) return String(b.map_url).trim();
  if (isPlaceUrl(b.sns_naver)) return String(b.sns_naver).trim();
  return "";
}
