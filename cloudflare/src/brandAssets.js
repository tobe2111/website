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
    mark: "/img/brand/bangbae-mark.svg",        // 돛 + 물결 (머리말 28px · 즐겨찾기 아이콘)
    icon: "/img/brand/bangbae-mark-180.png",    // 홈 화면 아이콘
    wide: "/img/brand/bangbae-union.svg",       // 돛 + 「방배동카페골목상가연합회」 (바닥글)
    og: "/img/brand/bangbae-union-og.png",      // 카카오톡·SNS 공유 미리보기 (1200×630)
    wordmark: "/img/brand/bangbae-cafe.svg",    // 「방배카페골목 BANGBAE CAFE STREET」 가로형 워드마크
  },
];

export function bundledBrand(assoc) {
  if (!assoc || !assoc.name) return null;
  return BUNDLED_BRANDS.find((b) => b.match.test(String(assoc.name))) || null;
}
