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
export function pickPlace(shop, places) {
  const list = Array.isArray(places) ? places.filter((p) => p && p.name) : [];
  if (!list.length) return { place: null, confidence: null, why: "지도에서 못 찾았습니다" };

  const mine = roadKey(shop.address);
  const myTel = digits(shop.phone);

  const scored = list.map((p) => {
    const addrHit = sameRoad(mine, roadKey(p.address));
    const nHit = nameHit(shop.name, p.name);
    const telHit = !!(myTel && myTel.length >= 9 && digits(p.phone) === myTel);
    return { p, addrHit, nHit, telHit };
  });

  // ① 전화번호가 같다 — 더 볼 것이 없습니다
  const byTel = scored.find((s) => s.telHit);
  if (byTel) return { place: byTel.p, confidence: "high", why: "전화번호가 같습니다" };

  // ② 도로명·번지가 같다. 같은 번지에 여러 가게가 있을 수 있으므로(상가 건물),
  //    그중 이름이 스치는 것이 하나면 그것, 아니면 사람에게 넘깁니다.
  const byAddr = scored.filter((s) => s.addrHit);
  if (byAddr.length) {
    const named = byAddr.filter((s) => s.nHit > 0);
    if (named.length === 1) return { place: named[0].p, confidence: "high", why: "주소와 상호가 맞습니다" };
    if (byAddr.length === 1 && named.length === 0)
      return { place: byAddr[0].p, confidence: "low", why: "주소는 맞는데 상호가 다릅니다" };
    if (named.length > 1) return { place: named[0].p, confidence: "low", why: "같은 번지에 비슷한 이름이 여럿입니다" };
    return { place: byAddr[0].p, confidence: "low", why: "같은 번지에 가게가 여럿입니다" };
  }

  // ③ 주소가 안 맞을 때 — 이름이 정확히 같고 그런 후보가 하나뿐이어야 붙입니다.
  //    명부 주소가 비었거나("?"), 지도가 도로명 대신 지번을 준 가게가 여기로 옵니다.
  const exact = scored.filter((s) => s.nHit === 3);
  if (exact.length === 1) return { place: exact[0].p, confidence: "high", why: "상호가 정확히 같고 후보가 하나입니다" };
  if (exact.length > 1) return { place: exact[0].p, confidence: "low", why: "같은 상호가 여럿입니다" };

  const loose = scored.filter((s) => s.nHit === 2);
  if (loose.length) return { place: loose[0].p, confidence: "low", why: "이름이 비슷한 곳을 찾았습니다" };

  return { place: list[0], confidence: "low", why: "확실한 것이 없습니다" };
}

// 지도에 물어볼 말. 상호만 던지면 전국에서 같은 이름이 쏟아지므로 동네를 함께 붙입니다.
// 번지까지 붙이면 오히려 못 찾습니다 — 지도는 '이름 + 지역' 으로 찾는 창구입니다.
export function placeQuery(shop) {
  const area = String(shop.address || "").trim().split(/\s+/).filter(Boolean);
  // "서울 서초구 방배중앙로 174" → "서초구 방배중앙로" (구 + 도로명)
  const hint = area.filter((t) => /(구|군|시)$/.test(t) || /(대?로|길|동)$/.test(t)).slice(0, 2).join(" ");
  return [shop.name, hint].filter(Boolean).join(" ").trim();
}
