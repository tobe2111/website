// 프랜차이즈 가맹점 모집 랜딩 프리뷰 (디자인 확인용).
// 목업이 아니라 실제 워커를 메모리 DB 위에서 돌려 진짜 화면을 뽑습니다.
//
//   node --experimental-sqlite scripts/preview-franchise.mjs public/__franchise.html
//
// 브라우저로 열면 CSS·JS 가 같은 폴더 기준으로 로드됩니다. 확인 후 파일은 지우세요.
import { writeFileSync } from "node:fs";
import worker from "../src/index.js";
import { makeEnv } from "../test/shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { serializeLandingLayout } from "../src/franchise.js";

const out = process.argv[2] || "public/__franchise.html";
const env = makeEnv();
// 계정이 하나도 없으면 워커가 설치 마법사(/setup)로 보냅니다 — 미리보기용 계정을 하나 둡니다.
const pw = await hashPassword("preview1234");
await D.createUser(env.DB, { email: "preview@example.kr", passwordHash: pw.hash, salt: pw.salt, name: "미리보기", role: "SUPERADMIN", associationId: null });
const a = await D.createAssociation(env.DB, { slug: "dapong", name: "다뽕고", kind: "franchise" });
await D.updateAssociation(env.DB, a.id, {
  name: "다뽕고", tagline: "삼겹살 창업, 결국 쉬워야 합니다", brand_color: "#e8b400",
  phone: "1600-9280", email: "hq@example.kr", address: "서울 서초구 강남대로 1", logo: "", hero_image: "",
});

// 기본 구성 위에 예시 콘텐츠만 얹습니다 (실제 관리자가 채웠을 때의 밀도를 보기 위해).
const { defaultLandingLayout } = await import("../src/franchise.js");
const lay = defaultLandingLayout("다뽕고").map((s) => {
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
  if (s.type === "ticker") return { ...s, items: "가맹점 240호점\n창업비용 4,900만원부터\n본사 직영 물류\n1:1 전담 슈퍼바이저\n오픈 동행 지원" };
  return s;
});
await D.saveLandingLayout(env.DB, a.id, serializeLandingLayout(lay));

const res = await worker.fetch(new Request("http://localhost/t/dapong"), env);
writeFileSync(out, (await res.text()).replace(/\?v=dev/g, ""));
console.log(`${out} 생성 (status ${res.status})`);
