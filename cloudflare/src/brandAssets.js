// 고객사 브랜드 자산 꾸러미
//
// 상인회가 로고 원본(ai 파일)을 보내오면 우리가 SVG·PNG 로 변환해 배포에 싣는다.
// 관리자 화면의 '로고 올리기' 는 그대로 살아 있다 — 거기서 직접 올린 로고(assoc.logo)가 있으면 그것이 이긴다.
// 여기 있는 것은 "올린 것이 없을 때 쓰는 기본 로고" 다.
//
// 왜 DB 에 넣지 않고 코드에 두나: 로고는 파일 하나가 아니라 한 벌(머리말용 마크 · 가로형 · 공유 미리보기 ·
// 홈 화면 아이콘)이고, 배포마다 같이 움직여야 한다. 조직 이름으로 찾는 이유는 라이브 DB 의 slug 를
// 코드가 알 필요가 없기 때문이다 — 이름을 바꾸면 자연히 떨어지고, 그때는 관리자가 직접 올린다.

export const BUNDLED_BRANDS = [
  {
    id: "bangbae",
    match: /방배\s*(동)?\s*카페\s*골목/,
    // 로고에 실제로 쓰인 주황. 로고 파일 안의 색이고, 화면 색을 정할 때의 기준이다.
    logoInk: "#EA5515",
    // 화면(단추·띠·강조)에 쓰는 색. **로고 주황보다 한 단계 어둡다.**
    //
    // 로고 주황을 그대로 깔았더니 접근성 실측에서 11건이 떴다 — 흰 글자를 얹으면 대비가
    // 3.62 로 기준(4.5)에 못 미친다. 눈으로는 "예쁜데?" 로 보이고, 안 읽히는 사람만 안 읽힌다.
    // 그래서 같은 색상(hue)을 유지한 채 명도만 낮춘 형제 색을 쓴다(흰 글자 대비 5.12).
    // 로고는 원본 그대로 나가므로 나란히 놓아도 다른 색으로 보이지 않는다.
    brand: "#C24310",
    mark: "/img/brand/bangbae-house.svg",       // 로고 속 집 한 채 (즐겨찾기 아이콘 · 16px 에서도 읽힌다)
    icon: "/img/brand/bangbae-house-180.png",   // 홈 화면 아이콘
    wide: "/img/brand/bangbae-cafe.svg",        // 가로형 「방배카페골목 BANGBAE CAFE STREET」 — 머리말·바닥글
    tall: "/img/brand/bangbae-cafe-tall.svg",   // 세로형 (좁은 자리·인쇄물)
    og: "/img/brand/bangbae-cafe-og.png",       // 카카오톡·SNS 공유 미리보기 (1200×630)
  },
];

// 플랫폼 기본색. 상인회가 색을 고른 적이 없으면 이 값이 들어 있다.
export const PLATFORM_BRAND = "#1F6CFF";

// 이 조직이 쓸 대표 색. 상인회가 직접 고른 색이 언제나 이긴다 —
// 꾸러미 색은 **아직 아무도 안 고른 자리**만 채운다. 안 그러면 관리자가 고른 색을
// 배포 한 번에 조용히 되돌려 버리게 된다.
export function bundledBrandColor(assoc) {
  const b = bundledBrand(assoc);
  if (!b || !b.brand) return "";
  const cur = String((assoc && assoc.brand_color) || "").trim().toLowerCase();
  return !cur || cur === PLATFORM_BRAND.toLowerCase() ? b.brand : "";
}

export function bundledBrand(assoc) {
  if (!assoc || !assoc.name) return null;
  return BUNDLED_BRANDS.find((b) => b.match.test(String(assoc.name))) || null;
}
