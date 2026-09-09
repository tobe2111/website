// 명부의 한 줄이 지도의 어느 장소인가.
//
// 명부에는 상호와 주소가 있고 지도에는 후보가 여럿 옵니다. 그중 하나를 골라야 하는데,
// **틀리게 고르는 것이 안 고르는 것보다 훨씬 나쁩니다.** 엉뚱한 가게에 연결되면
// 손님이 그 핀을 보고 다른 가게로 걸어가고, 대표사진도 남의 가게 것이 걸립니다.
// 그리고 그건 아무도 눈치채지 못합니다 — 화면에는 멀쩡한 가게 하나가 보이니까요.
//
// 그래서 규칙은 하나입니다: **확실할 때만 붙이고, 애매하면 사람에게 넘긴다.**
//
// ■ 무엇이 '확실한가'
//
//   주소가 이깁니다. 상호는 전국에 같은 것이 널려 있지만("GS더프레시"), 도로명+번지는
//   그 자리에 하나뿐입니다. 그래서 **명부의 도로명·번지가 지도의 주소와 맞으면** 그것으로
//   충분하고, 이름은 서로 스쳐도 됩니다(간판과 등록상호가 다른 가게가 흔합니다).
//
//   주소가 안 맞으면 이름이 정확히 같고 후보가 그것 하나뿐일 때만 붙입니다.
//   그 밖에는 전부 사람이 고릅니다.

// 견줄 때는 공백·괄호·기호를 지웁니다. "(주)새롬상사" 와 "새롬상사" 는 같은 가게입니다.
const key = (s) => String(s || "").toLowerCase()
  .replace(/\(주\)|주식회사|\(유\)|유한회사/g, "")
  .replace(/[\s()[\]{}·.,'"`~!@#$%^&*_+=|\\/<>?-]/g, "");

// 주소에서 '도로명 + 번지' 만 뽑습니다. 시·구·동은 후보가 모두 같은 동네라 변별력이 없고,
// 층·호(4층 401호)는 지도가 안 적는 경우가 많아 빼야 맞습니다.
//
//   "서울 서초구 방배중앙로25길 16, 2층"  →  { road: "방배중앙로25길", no: "16" }
//   "서울 서초구 방배동 769-10"           →  { road: "방배동",        no: "769-10" }
export function roadKey(address) {
  const s = String(address || "").replace(/,.*$/, " ").trim();
  const m = /([가-힣A-Za-z0-9]+(?:대?로|길|동|가|읍|면|리))\s*([0-9]+(?:-[0-9]+)?)/.exec(s);
  if (!m) return null;
  return { road: key(m[1]), no: m[2] };
}
const sameRoad = (a, b) => !!(a && b && a.road === b.road && a.no === b.no);

// ── 우리 골목에서 얼마나 떨어져 있나
//
// 상가연합회는 **한 골목**입니다. 회원 가게가 부천이나 성수에 있을 리가 없습니다.
// 그런데 상호는 전국에 같은 것이 널려 있어서("노브랜드버거"), 이름만 보고 고르면
// 20km 밖의 다른 지점에 붙습니다. 실제로 그렇게 붙었고, 지도를 열었을 때
// 핀이 서울 전역에 흩어져 있었습니다.
//
// 그래서 **거리를 마지막 관문으로 둡니다.** 우리 골목 한가운데에서 이만큼 넘게 떨어진
// 후보는 아무리 이름이 같아도 자동으로 붙이지 않습니다 — 사람에게 넘깁니다.
export const NEAR_KM = 3;
export function kmApart(a, b) {
  if (!a || !b) return null;
  const [la, ga, lb, gb] = [a.lat, a.lng, b.lat, b.lng].map(Number);
  if (![la, ga, lb, gb].every(Number.isFinite)) return null;
  // 서울 위도에서 경도 1도는 위도 1도의 약 0.79 배. 몇 km 를 재는 데는 이 정도로 충분합니다.
  const dy = (la - lb) * 111, dx = (ga - gb) * 111 * 0.79;
  return Math.sqrt(dy * dy + dx * dx);
}

// 우리 골목 '안' — 상가연합회 한 골목은 길어야 몇백 미터입니다. ④ 규칙은 이 안에서만 씁니다.
export const STREET_KM = 0.8;

// 상호에서 업종 낱말과 회사 꼬리를 떼고 남는 '가게 이름'. "박사부동산" → "박사", "㈜아인종합기획" → "아인".
// 두 글자 미만이면 없는 것으로 봅니다 — "S헤어" 의 "s" 는 아무 데나 들어갑니다.
const TRADE_WORDS = ["공인중개사사무소", "공인중개사", "부동산", "세무사", "회계사", "법무사", "종합기획", "인테리어", "골프연습장", "골프",
  "미용실", "헤어샵", "헤어", "네일", "안경원", "안경", "정육식당", "식당", "초밥", "카페", "커피", "김밥", "샌드위치", "칼국수", "아구찜",
  "숯불갈비", "갈비", "노래빠", "노래방", "마사지", "약국", "의원", "한의원", "치과", "학원", "꽃집", "플라워", "베이커리", "제과점",
  "편의점", "마트", "슈퍼", "상사", "주식회사", "㈜", "(주)", "본점", "지점", "방배점", "방배"];
// 두 주소가 같은 구(區)인가. 한쪽에 구가 없으면 모른다고 보고 막지 않는다.
const guOf = (addr) => (String(addr || "").split(/\s+/).find((t) => /구$/.test(t) && t.length >= 2) || "");
export function sameGu(a, b) { const x = guOf(a), y = guOf(b); return !x || !y || x === y; }

export function coreName(name) {
  let k = key(name);
  for (const w of TRADE_WORDS) k = k.split(key(w) || w).join("");
  return k.length >= 2 ? k : "";
}

// 이름이 얼마나 같은가 — 3(똑같다) · 2(한쪽이 다른 쪽을 품는다) · 0(남남)
function nameHit(a, b) {
  const x = key(a), y = key(b);
  if (!x || !y) return 0;
  if (x === y) return 3;
  // 두 글자짜리 상호가 남의 긴 이름에 우연히 들어가는 일을 막습니다("본" ⊂ "본죽")
  const short = x.length < y.length ? x : y;
  if (short.length >= 3 && (x.includes(y) || y.includes(x))) return 2;
  return 0;
}

// 전화번호가 같으면 그 자리에서 끝입니다 — 같은 번호를 쓰는 다른 가게는 없습니다.
const digits = (s) => String(s || "").replace(/\D/g, "");

/**
 * 후보 중 하나를 고릅니다.
 * @returns {{place, confidence:"high"|"low"|null, why:string}}
 *   high — 저장해도 됩니다.  low — 후보는 있지만 사람이 골라야 합니다.  null — 후보가 없습니다.
 */
export function pickPlace(shop, places, { center = null } = {}) {
  const list = Array.isArray(places) ? places.filter((p) => p && p.name) : [];
  if (!list.length) return { place: null, confidence: null, why: "지도에서 못 찾았습니다" };

  const mine = roadKey(shop.address);
  const myTel = digits(shop.phone);

  const scored = list.map((p) => {
    // 명부에는 지번("방배동 769-10"), 지도에는 도로명("방배중앙로 174") 인 경우가 대부분입니다.
    // 둘 다 견줘야 이 흔한 짝이 맞습니다 — 한쪽만 보면 주소 규칙이 아예 안 걸리고,
    // 그러면 이름만 보고 고르는 아래 ③ 으로 떨어져 엉뚱한 지점에 붙습니다.
    const addrHit = sameRoad(mine, roadKey(p.address)) || sameRoad(mine, roadKey(p.addressJibun));
    const nHit = nameHit(shop.name, p.name);
    const telHit = !!(myTel && myTel.length >= 9 && digits(p.phone) === myTel);
    const km = kmApart(center, p);
    return { p, addrHit, nHit, telHit, far: km != null && km > NEAR_KM, km };
  });

  // 우리 골목에서 너무 먼 곳은 어떤 규칙으로도 자동으로 붙이지 않습니다.
  const near = (s2) => !s2.far;

  // ① 전화번호가 같다 — 더 볼 것이 없습니다. 같은 번호를 쓰는 다른 가게는 없으므로
  //    이것만은 거리를 따지지 않습니다(가게가 이사했을 수도 있습니다).
  const byTel = scored.find((s) => s.telHit);
  if (byTel) return { place: byTel.p, confidence: "high", why: "전화번호가 같습니다" };

  // 상호에서 업종 낱말을 뗀 '가게 이름' — ②·④ 가 함께 쓴다.
  const core = coreName(shop.name);

  // ② 도로명·번지가 같다. 같은 번지에 여러 가게가 있을 수 있으므로(상가 건물),
  //    그중 이름이 스치는 것이 하나면 그것, 아니면 사람에게 넘깁니다.
  const byAddr = scored.filter((s) => s.addrHit);
  if (byAddr.length) {
    const named = byAddr.filter((s) => s.nHit > 0);
    if (named.length === 1 && near(named[0]))
      return { place: named[0].p, confidence: "high", why: "주소와 상호가 맞습니다" };
    if (named.length === 1)
      return { place: named[0].p, confidence: "low", why: `주소·상호는 맞는데 골목에서 ${Math.round(named[0].km)}km 떨어져 있습니다` };
    // 번지가 같고 **가게 이름**(업종 낱말을 뗀 것)이 그 후보에 들어 있으면 그 가게입니다.
    // "박사부동산" 과 "박사공인중개사사무소" 가 같은 번지에 있는데 남남일 리 없습니다.
    // 실제 명부에서 가장 흔한 실패가 이것이었습니다 — 간판과 등록상호가 다른 가게.
    const cored = core ? byAddr.filter((s) => key(s.p.name).includes(core)) : [];
    if (named.length === 0 && cored.length === 1 && near(cored[0]))
      return { place: cored[0].p, confidence: "high", why: `주소가 같고 가게 이름(${core})이 들어 있습니다` };
    if (byAddr.length === 1 && named.length === 0)
      return { place: byAddr[0].p, confidence: "low", why: "주소는 맞는데 상호가 다릅니다" };
    if (named.length > 1) return { place: named[0].p, confidence: "low", why: "같은 번지에 비슷한 이름이 여럿입니다" };
    return { place: byAddr[0].p, confidence: "low", why: "같은 번지에 가게가 여럿입니다" };
  }

  // ③ 주소가 안 맞을 때 — 이름이 정확히 같고 그런 후보가 하나뿐이어야 붙입니다.
  //    명부 주소가 비었거나("?"), 지도가 도로명 대신 지번을 준 가게가 여기로 옵니다.
  //
  //    여기가 가장 위험한 자리입니다. "노브랜드버거" 처럼 전국 어디에나 있는 상호는
  //    후보가 하나로 좁혀져도 그게 **우리 가게라는 근거가 되지 못합니다.**
  //    그래서 우리 골목 한가운데를 알 때, 그리고 그 근처일 때만 붙입니다.
  const exact = scored.filter((s) => s.nHit === 3);
  const exactNear = exact.filter(near);
  if (center && exactNear.length === 1)
    return { place: exactNear[0].p, confidence: "high", why: "상호가 정확히 같고 우리 골목 안입니다" };
  if (exact.length === 1 && !center)
    return { place: exact[0].p, confidence: "low", why: "상호는 같은데 우리 골목인지 확인이 안 됩니다" };
  if (exact.length === 1)
    return { place: exact[0].p, confidence: "low", why: `상호는 같은데 골목에서 ${Math.round(exact[0].km)}km 떨어져 있습니다` };
  if (exactNear.length > 1) return { place: exactNear[0].p, confidence: "low", why: "같은 상호가 여럿입니다" };
  if (exact.length > 1) return { place: exact[0].p, confidence: "low", why: "같은 상호가 여럿입니다" };

  // ④ 간판 이름과 등록 이름이 다른 가게 — 실제 명부에서 가장 흔한 실패였습니다.
  //    "박사부동산" 은 지도에 "박사공인중개사사무소", "첼로카페" 는 "첼로", "글라시코안경" 은
  //    "글라시코옵티컬" 로 올라 있습니다. 업종 낱말(부동산·카페·안경…)만 다르고 **가게 이름
  //    자체(박사·첼로·글라시코)는 같습니다.** 그 이름이 우리 골목 안(800m) 후보 **하나에만**
  //    들어 있으면 붙입니다. 두 곳에 들어 있으면(제일공인중개사 ×3) 사람에게 넘기고,
  //    정확히 같은 상호가 골목 밖에 따로 있으면(씨티부동산 1.3km) 그쪽일 수도 있으니 안 붙입니다.
  //    그리고 **같은 구 안**이어야 합니다. 800m 는 구 경계를 넘기도 하는데(방배동 ↔ 동작구 사당동),
  //    "한우정육식당" 이 동작구의 "우리집한우정육식당" 에 붙은 일이 실측에서 실제로 났습니다.
  if (center && core) {
    const hits = scored.filter((s) => s.km != null && s.km < STREET_KM && key(s.p.name).includes(core)
      && sameGu(shop.address, s.p.address || s.p.addressJibun));
    if (hits.length === 1 && !exact.length)
      return { place: hits[0].p, confidence: "high", why: `가게 이름(${core})이 골목 안 후보 하나에만 들어 있습니다` };
  }

  const loose = scored.filter((s) => s.nHit === 2);
  if (loose.length) return { place: loose[0].p, confidence: "low", why: "이름이 비슷한 곳을 찾았습니다" };

  return { place: list[0], confidence: "low", why: "확실한 것이 없습니다" };
}

// 동(洞)이 빠진 주소를 고친다 — "서울 서초구 2233" → "서울 서초구 방배동 2233".
//
// 명부를 넣을 때 주소 앞말을 "서울 서초구" 까지만 적으면 번지만 남은 주소가 이렇게 된다.
// 이 모양은 지도가 못 읽는다: 좌표도 안 나오고(핀이 안 찍힌다) 번지 비교도 안 된다(가게를
// 못 특정한다). 실제 운영 화면이 그래서 125곳 중 85곳에서 멈춰 있었다. 우리 골목의 동은
// 골목 한가운데 좌표로 지도에 물어 안다(api.js dongOfCenter). 이미 동·로·길이 있으면 그대로.
export function repairAddress(address, dong) {
  const s = String(address || "").trim();
  if (!s || !dong) return s;
  const m = /^((?:\S+\s+)*?\S+(?:구|군|시))\s+(\d+(?:-\d+)?)(\s.*)?$/.exec(s);
  if (!m) return s;
  return `${m[1]} ${dong} ${m[2]}${m[3] || ""}`;
}

// 지도에 물어볼 말. 상호만 던지면 전국에서 같은 이름이 쏟아지므로 동네를 함께 붙입니다.
// 번지까지 붙이면 오히려 못 찾습니다 — 지도는 '이름 + 지역' 으로 찾는 창구입니다.
export function placeQuery(shop) {
  const area = String(shop.address || "").trim().split(/\s+/).filter(Boolean);
  // "서울 서초구 방배중앙로 174" → "서초구 방배중앙로" (구 + 도로명)
  const hint = area.filter((t) => /(구|군|시)$/.test(t) || /(대?로|길|동)$/.test(t)).slice(0, 2).join(" ");
  return [shop.name, hint].filter(Boolean).join(" ").trim();
}
