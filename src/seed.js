// 초기 데이터 시드: 관리자 계정 + 샘플 업체/공지/행사
// 사용: npm run seed   (이미 있으면 건너뜀)
//       npm run reset  (--reset: 기존 데이터 삭제 후 재생성)
import { db } from "./db.js";
import { createUser, getUserByEmail } from "./auth.js";
import * as M from "./models.js";

const RESET = process.argv.includes("--reset");

if (RESET) {
  console.log("기존 데이터를 삭제합니다...");
  db.exec("DELETE FROM media; DELETE FROM businesses; DELETE FROM users; DELETE FROM notices; DELETE FROM events;");
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@seocho-merchants.kr";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";

function ensureAdmin() {
  if (getUserByEmail(ADMIN_EMAIL)) {
    console.log(`관리자 계정 이미 존재: ${ADMIN_EMAIL}`);
    return;
  }
  createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "상인회 관리자", role: "ADMIN" });
  console.log(`관리자 계정 생성: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
}

function seedBusinesses() {
  if (M.listAllBusinesses().length > 0) {
    console.log("업체 데이터 이미 존재 — 건너뜀");
    return;
  }
  const samples = [
    { email: "jung@ex.kr", name: "김서초", biz: "서초정육점", cat: "농수축산",
      desc: "3대째 이어온 신선한 한우 전문점. 매일 아침 경매장에서 직접 고른 고기만 판매합니다.",
      phone: "02-585-1234", addr: "서초구 서초대로 12", hours: "매일 09:00 - 21:00" },
    { email: "cafe@ex.kr", name: "이방배", biz: "방배동 로스터리", cat: "카페·디저트",
      desc: "직접 로스팅한 스페셜티 원두와 수제 디저트를 즐길 수 있는 동네 카페입니다.",
      phone: "02-533-5678", addr: "서초구 방배로 45", hours: "화-일 10:00 - 22:00 (월 휴무)" },
    { email: "noodle@ex.kr", name: "박양재", biz: "양재천 손칼국수", cat: "음식점",
      desc: "직접 반죽해 뽑는 쫄깃한 손칼국수와 바지락 육수가 일품인 노포입니다.",
      phone: "02-577-9012", addr: "서초구 양재천로 78", hours: "매일 11:00 - 20:30" },
    { email: "flower@ex.kr", name: "최반포", biz: "반포 꽃정원", cat: "생활·서비스",
      desc: "기념일 꽃다발과 화분, 공간 플라워 데코를 정성껏 준비해 드립니다.",
      phone: "02-599-3456", addr: "서초구 반포대로 21", hours: "매일 10:00 - 20:00" },
  ];

  for (const s of samples) {
    const user = createUser({ email: s.email, password: "merchant1234", name: s.name, role: "MERCHANT" });
    const b = M.createBusiness({ ownerId: user.id, name: s.biz, category: s.cat });
    M.updateBusiness(b.id, { description: s.desc, phone: s.phone, address: s.addr, hours: s.hours });
    M.setBusinessStatus(b.id, "approved");
  }
  console.log(`샘플 업체 ${samples.length}곳 생성 (로그인: 각 이메일 / merchant1234)`);
}

function seedNotices() {
  if (M.listNotices().length > 0) return;
  M.createNotice({ title: "2026년 상반기 정기총회 및 사업설명회 개최 안내", tag: "중요", pinned: true,
    body: "서초구 상인회 정기총회를 아래와 같이 개최합니다.\n\n일시: 2026년 7월 15일 (화) 오후 3시\n장소: 서초구민회관 대강당\n안건: 상반기 사업 보고, 하반기 계획, 회비 안건\n\n많은 참석 부탁드립니다." });
  M.createNotice({ title: "소상공인 디지털 전환 지원사업 신청 접수 (선착순)", tag: "지원",
    body: "정부 지원 디지털 전환 사업 참여 업체를 모집합니다. 키오스크, 온라인 주문 시스템 도입 비용을 지원합니다." });
  M.createNotice({ title: "여름맞이 서초 상권 페스티벌 참여 점포 모집", tag: "행사",
    body: "7월 서초 상권 페스티벌에 참여할 점포를 모집합니다. 참가비 무료." });
  console.log("샘플 공지 3건 생성");
}

function seedEvents() {
  if (M.listEvents().length > 0) return;
  M.createEvent({ title: "여름 서초 상권 페스티벌", event_date: "2026-07-19", place: "서초중앙시장 일대",
    description: "먹거리 장터, 경품 추첨, 문화 공연이 어우러진 지역 최대 상권 축제." });
  M.createEvent({ title: "온누리상품권 페이백 위크", event_date: "2026-08-05", place: "서초구 전 가맹점",
    description: "가맹점에서 상품권 사용 시 최대 10% 페이백." });
  M.createEvent({ title: "소상공인 디지털 마케팅 세미나", event_date: "2026-09-12", place: "서초구민회관 강당",
    description: "SNS·배달앱·스마트스토어 실전 노하우를 배우는 무료 세미나." });
  console.log("샘플 행사 3건 생성");
}

ensureAdmin();
seedBusinesses();
seedNotices();
seedEvents();
console.log("\n시드 완료.\n");
