// 프랜차이즈 랜딩·관리자 화면 프리뷰 (디자인 확인용).
// 목업이 아니라 실제 워커를 메모리 DB 위에서 돌려 진짜 화면을 뽑습니다.
//
//   node --experimental-sqlite scripts/preview-franchise.mjs public/__x.html [landing|leads|editor] [업종]
//   업종: franchise(기본) · academy · fitness · clinic · realestate
//
// 브라우저로 열면 CSS·JS 가 같은 폴더 기준으로 로드됩니다. 확인 후 파일은 지우세요.
import { writeFileSync } from "node:fs";
import worker from "../src/index.js";
import { makeEnv } from "../test/shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { serializeLandingLayout, defaultLandingLayout } from "../src/franchise.js";

const out = process.argv[2] || "public/__franchise.html";
const which = process.argv[3] || "landing";
const preset = process.argv[4] || "franchise";
const env = makeEnv();
// 계정이 하나도 없으면 워커가 설치 마법사(/setup)로 보냅니다 — 미리보기용 계정을 둡니다.
const su = await hashPassword("preview1234");
await D.createUser(env.DB, { email: "preview@example.kr", passwordHash: su.hash, salt: su.salt, name: "미리보기", role: "SUPERADMIN", associationId: null });
const NAMES = { franchise: "다뽕고", academy: "한빛학원", fitness: "바디랩", clinic: "연세늘봄의원", realestate: "센트럴파크" };
const brandName = NAMES[preset] || "다뽕고";
const a = await D.createAssociation(env.DB, { slug: "dapong", name: brandName, kind: "franchise", preset });
await D.updateAssociation(env.DB, a.id, {
  name: brandName, tagline: (await import("../src/kinds.js")).PRESETS[preset]?.tagline || "", brand_color: preset === "academy" ? "#1f6feb" : "#e8b400",
  phone: "1600-9280", email: "hq@example.kr", address: "서울 서초구 강남대로 1", logo: "", hero_image: "",
});
const ad = await hashPassword("admin1234");
await D.createUser(env.DB, { email: "admin@example.kr", passwordHash: ad.hash, salt: ad.salt, name: "본사", role: "ADMIN", associationId: a.id });

// 기본 구성 위에 예시 콘텐츠만 얹습니다 (실제 관리자가 채웠을 때의 밀도를 보기 위해).
const lay = defaultLandingLayout(brandName, preset).map((s) => {
  if (s.type === "reviews" && preset !== "franchise") return s;
  if (s.type === "menu" && preset !== "franchise") return s;
  if (s.type === "cost" && preset !== "franchise") return s;
  if (s.type === "reviews") return { ...s, items: [
    "혼자서도 돌아가는 매장이라 첫 창업인데도 버틸 수 있었습니다 | 수원 영통점 김○○ 점주",
    "원가가 고정되니 계절이 바뀌어도 마진 계산이 흔들리지 않습니다 | 부산 서면점 이○○ 점주",
    "오픈 첫 주에 슈퍼바이저가 매일 나와 함께 돌려줬습니다 | 대구 동성로점 박○○ 점주",
  ].join("\n") };
  if (s.type === "menu") return { ...s, items: [
    "대표 삼겹살 | 12,000원", "목살 정식 | 13,000원", "된장찌개 | 8,000원", "냉면 | 9,000원",
    "볶음밥 | 5,000원", "계란찜 | 6,000원", "소주·맥주 | 5,000원", "음료 | 2,000원",
  ].join("\n") };
  if (s.type === "cost") return { ...s, items: [
    "가맹비 | 1,000만원 | 부가세 별도",
    "교육비 | 300만원 | 2인 기준",
    "인테리어 | 3,300만원 | 33㎡(10평) 기준",
    "주방 설비 | 1,800만원 | 표준 패키지",
    "간판·사인 | 400만원 | 지역별 상이",
  ].join("\n") };
  if (s.type === "ticker" && preset === "franchise") return { ...s, items: "가맹점 240호점\n창업비용 4,900만원부터\n본사 직영 물류\n1:1 전담 슈퍼바이저\n오픈 동행 지원" };
  return s;
});
await D.saveLandingLayout(env.DB, a.id, serializeLandingLayout(lay));

// 상담 DB 화면은 신청이 있어야 볼 게 있습니다.
const SAMPLE = [
  ["김창업", "010-1234-5678", "수원 영통", "1억원 ~ 2억원", "네이버 검색", "naver", "cpc", "봄모집"],
  ["이점주", "010-2222-3333", "부산 서면", "5천만원 ~ 1억원", "인스타그램·유튜브", "instagram", "feed", "릴스"],
  ["박사장", "010-4444-5555", "대구 동성로", "2억원 이상", "지인 소개", "", "", ""],
];
for (const [name, phone, region, budget, funnel, us, um, uc] of SAMPLE) {
  await D.createLead(env.DB, { associationId: a.id, name, phone, region, budget, funnel,
    utmSource: us, utmMedium: um, utmCampaign: uc, message: "상권 분석 먼저 받아보고 싶습니다." });
}
for (let i = 0; i < 120; i++) await D.bumpLandingView(env.DB, a.id, "");

const PATHS = { landing: "/t/dapong", leads: "/t/dapong/admin/leads", editor: "/t/dapong/admin/landing" };
const path = PATHS[which] || PATHS.landing;

// 관리자 화면은 로그인 쿠키가 필요합니다.
let cookie = "";
if (path.includes("/admin")) {
  const g = await worker.fetch(new Request("http://localhost/login"), env);
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const lr = await worker.fetch(new Request("http://localhost/login", {
    method: "POST", headers: { cookie: seed, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: tk, email: "admin@example.kr", password: "admin1234" }).toString(),
  }), env);
  cookie = [seed, ...(lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");
}
const res = await worker.fetch(new Request("http://localhost" + path, { headers: cookie ? { cookie } : {} }), env);
writeFileSync(out, (await res.text()).replace(/\?v=dev/g, ""));
console.log(`${out} 생성 (${path} · status ${res.status})`);
