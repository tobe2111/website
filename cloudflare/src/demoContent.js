// 데모 콘텐츠 — 상인회 한 곳을 "실제로 운영 중인 상권"처럼 채웁니다.
// 영업 소개용 샘플 사이트를 만들 때 슈퍼 관리자가 버튼 하나로 실행합니다.
// 문구는 실제 상인회가 쓸 법한 내용으로 작성 (자리표시자·로렘입숨 없음).
import { hashPassword } from "./crypto.js";
import { slugify } from "./util.js";
import * as D from "./db.js";
import { contentHash, sealRecord, newVerifyCode } from "./esign.js";

// 날짜는 실행 시점 기준 상대값 — 언제 돌려도 행사가 '다가오는' 상태로 보입니다.
const DAY = 86400000;
const ymd = (o) => new Date(Date.now() + o * DAY).toISOString().slice(0, 10);
const at = (o) => new Date(Date.now() + o * DAY).toISOString().slice(0, 19).replace("T", " ");
// 서명 시각 — 저장은 UTC 지만 사람이 보는 건 KST 입니다. 새벽 3시에 줄줄이 서명한 기록이
// 남아 있으면 만들어 낸 티가 나므로, 낮 시간대(KST 09~20시)로 흩뜨립니다.
const signedAtIso = (dayOffset, k) => {
  const d = new Date(Date.now() + dayOffset * DAY);
  d.setUTCHours(((k * 5 + 3) % 12), (k * 17 + 11) % 60, (k * 13) % 60, 0); // UTC 0~11시 = KST 9~20시
  return d.toISOString();
};

export const DEMO_PASSWORD = "demo1234";

const BIZ = [
  { slug: "goeul-gukbap", name: "고을돼지국밥", cover: "gukbap", cat: "음식점", owner: "김정식",
    desc: "23년째 같은 자리에서 가마솥으로 우려낸 국물을 냅니다. 점심에는 줄이 길어 11시 30분 전에 오시길 권합니다.",
    addr: "서울 서초구 서초대로 78길 12", tel: "02-9410-1284", hours: "09:00-21:30 · 매주 일요일 휴무",
    lat: 37.4923, lng: 127.0292,
    products: [["돼지국밥", "9,000원", "24시간 끓인 사골 육수. 밥 추가 무료."],
               ["수육백반", "13,000원", "앞다리살 수육에 국밥 한 그릇."],
               ["순대국밥", "9,000원", "국내산 순대만 씁니다."],
               ["모둠수육 (2인)", "28,000원", "미리 전화 주시면 준비해 둡니다."]],
    coupons: [["공기밥 무제한", "국밥류 주문 시", 90]],
    updates: ["오늘 김치를 새로 담갔습니다. 아삭할 때 드시러 오세요.", "이번 주 토요일은 재료 준비로 오후 3시에 문 엽니다."] },

  { slug: "seocho-bakehouse", name: "서초 베이크하우스", cover: "bakery", cat: "카페·디저트", owner: "이현주",
    desc: "매일 새벽 4시에 반죽을 시작합니다. 당일 구운 빵만 판매하고 남은 빵은 다음 날로 넘기지 않습니다.",
    addr: "서울 서초구 반포대로 30길 8", tel: "02-9410-7742", hours: "08:00-20:00",
    lat: 37.4871, lng: 127.0141, insta: "https://instagram.com/seocho_bakehouse",
    products: [["소금버터롤", "3,200원", "오전 10시, 오후 4시 두 번 구워 나옵니다."],
               ["통밀 캄파뉴", "8,500원", "우리밀 통밀 30%. 하루 12개 한정."],
               ["무화과 크림치즈", "5,500원", "제철 무화과가 들어갑니다."],
               ["드립커피", "4,000원", "주 단위로 원두가 바뀝니다."]],
    coupons: [["아메리카노 1,000원 할인", "빵 2개 이상 구매 시", 60]],
    updates: ["내일 아침 캄파뉴 굽습니다. 오전 10시쯤 나와요.", "여름 한정 복숭아 타르트 시작했습니다."] },

  { slug: "mirae-sewing", name: "미래수선", cover: "sewing", cat: "생활·서비스", owner: "박순자",
    desc: "옷 수선, 지퍼 교체, 기장 수선까지 30년 경력으로 봐 드립니다. 급한 건은 당일도 가능합니다.",
    addr: "서울 서초구 서초중앙로 24길 5", tel: "02-9410-9038", hours: "09:30-19:00 · 일요일 휴무",
    lat: 37.4948, lng: 127.0163,
    products: [["바지 기장 수선", "5,000원", "당일 가능."],
               ["지퍼 교체", "8,000원~", "지퍼 종류에 따라 다릅니다."],
               ["코트 소매 줄임", "20,000원~", "안감 유무에 따라 달라집니다."]],
    coupons: [],
    updates: ["장마철 눅눅해진 겨울옷, 지금 맡기시면 여유 있게 봐 드립니다."] },

  { slug: "nampo-fish", name: "남포수산", cover: "fish", cat: "농수축산", owner: "정만석",
    desc: "새벽 노량진에서 직접 보고 떼 옵니다. 회는 주문 후에 뜨고, 손질은 무료입니다.",
    addr: "서울 서초구 방배로 42길 3", tel: "02-9410-6620", hours: "10:00-21:00",
    lat: 37.4816, lng: 127.0007,
    products: [["광어회 (小)", "28,000원", "2~3인분. 초장·상추 포함."],
               ["연어회 300g", "22,000원", "노르웨이산."],
               ["손질 갈치 (2마리)", "18,000원", "제주산. 내장 손질해 드립니다."],
               ["모둠회 (大)", "55,000원", "그날 좋은 것으로 5종."]],
    coupons: [["매운탕거리 서비스", "회 3만원 이상 구매 시", 120]],
    updates: ["오늘 전복 좋은 게 들어왔습니다.", "추석 선물세트 예약 받습니다. 전화 주세요."] },

  { slug: "banpo-hair", name: "반포 헤어살롱", cover: "hair", cat: "생활·서비스", owner: "최유진",
    desc: "예약제로 운영해 기다리지 않으셔도 됩니다. 두피 상태를 먼저 보고 시술을 정합니다.",
    addr: "서울 서초구 신반포로 45길 11", tel: "02-9410-2211", hours: "10:00-20:00 · 월요일 휴무",
    lat: 37.5041, lng: 127.0113, insta: "https://instagram.com/banpo_hair",
    products: [["커트", "25,000원", "샴푸·드라이 포함."],
               ["뿌리 염색", "60,000원", "새치 커버 가능."],
               ["두피 스케일링", "35,000원", "커트와 함께 하면 5,000원 할인."]],
    coupons: [["첫 방문 20% 할인", "예약 후 방문 시 1회 한정", 180]],
    updates: ["9월 예약 열렸습니다. 주말은 빨리 마감돼요."] },

  { slug: "chaekbang-seocho", name: "동네책방 서초", cover: "book", cat: "교육·문화", owner: "한지원",
    desc: "작은 서점입니다. 매주 목요일 저녁에 독서모임을 하고, 원하시는 책은 주문해 드립니다.",
    addr: "서울 서초구 효령로 31길 7", tel: "02-9410-4409", hours: "11:00-21:00 · 화요일 휴무",
    lat: 37.4879, lng: 127.0203,
    products: [["이달의 책 꾸러미", "25,000원", "책 1권 + 책방지기 편지."],
               ["독서모임 참가비", "10,000원", "매주 목요일 저녁 7시 30분."]],
    coupons: [],
    updates: ["이번 달 독서모임 책은 『아무튼, 계단』입니다. 두 자리 남았어요."] },

  { slug: "jeil-mart", name: "제일마트", cover: "mart", cat: "농수축산", owner: "오경택",
    desc: "동네 슈퍼입니다. 과일은 매일 아침 들어오고, 무거운 건 근처는 배달해 드립니다.",
    addr: "서울 서초구 사평대로 20길 4", tel: "02-9410-3311", hours: "08:00-23:00",
    lat: 37.4962, lng: 127.0248,
    products: [["제철 과일 모둠", "15,000원", "그날 좋은 것으로 담습니다."],
               ["계란 한 판", "7,900원", "무항생제."]],
    coupons: [["2만원 이상 무료 배달", "반경 1km 이내", 365]],
    updates: ["복숭아 들어왔습니다. 지금이 제일 답니다.", "생수 6개들이 행사합니다."] },

  { slug: "sonmat-banchan", name: "손맛반찬", cover: "banchan", cat: "음식점", owner: "윤미경",
    desc: "매일 아침 만든 반찬만 진열합니다. 조미료를 쓰지 않아 간이 세지 않습니다.",
    addr: "서울 서초구 서초대로 50길 9", tel: "02-9410-7788", hours: "09:00-20:00 · 일요일 휴무",
    lat: 37.4901, lng: 127.0119,
    products: [["멸치볶음", "5,000원", "국물용 아닌 볶음용 멸치만 씁니다."],
               ["장조림", "9,000원", "홍두깨살."],
               ["오이소박이", "7,000원", "여름에만 담급니다."],
               ["모둠 반찬 5종", "22,000원", "그날 있는 것으로 구성."]],
    coupons: [["반찬 1종 서비스", "2만원 이상 구매 시", 60]],
    updates: ["오이소박이 담갔습니다. 이번 주까지만 나갑니다."] },

  { slug: "seoraebeol-cafe", name: "서래벌 커피", cover: "cafe", cat: "카페·디저트", owner: "장수민",
    desc: "원두를 주 단위로 볶아 씁니다. 자리가 여덟 석뿐이라 조용히 앉아 계시기 좋습니다.",
    addr: "서울 서초구 서래로 12", tel: "02-9410-2280", hours: "08:30-21:00",
    lat: 37.4958, lng: 127.0055,
    products: [["핸드드립 (싱글)", "5,500원", "당일 로스팅 원두 세 종 중 선택."],
               ["플랫화이트", "5,000원", "우유 비율을 낮춰 진하게."],
               ["원두 200g", "16,000원", "그날 볶은 것만 판매."]],
    coupons: [["열 잔 마시면 한 잔", "적립 카드 발급", 365]],
    updates: ["에티오피아 예가체프 볶았습니다. 산미 좋아하시는 분께 추천드려요."] },

  { slug: "hyoryeong-meat", name: "효령정육점", cover: "meat", cat: "농수축산", owner: "배동식",
    desc: "한우는 등급표를 붙여 놓습니다. 구이용은 두께를 말씀하시면 맞춰 썰어 드립니다.",
    addr: "서울 서초구 효령로 44길 9", tel: "02-9410-5512", hours: "09:00-20:30 · 일요일 휴무",
    lat: 37.4867, lng: 127.0231,
    products: [["한우 등심 100g", "13,900원", "1++ 등급. 등급표 확인 가능."],
               ["삼겹살 500g", "16,000원", "국내산 냉장."],
               ["양념 불고기 1kg", "24,000원", "당일 양념."]],
    coupons: [["5만원 이상 국거리 서비스", "당일 구매분에 한함", 60]],
    updates: ["명절 선물세트 예약 시작했습니다."] },

  { slug: "banpo-flower", name: "반포꽃집", cover: "flower", cat: "생활·서비스", owner: "신다혜",
    desc: "꽃다발과 화분을 만듭니다. 예산을 말씀해 주시면 그 안에서 제일 좋은 것으로 맞춰 드립니다.",
    addr: "서울 서초구 신반포로 19길 4", tel: "02-9410-3377", hours: "09:00-20:00",
    lat: 37.5028, lng: 127.0091,
    products: [["계절 꽃다발", "35,000원~", "예산 말씀 주시면 맞춰 드립니다."],
               ["개업 화분", "60,000원~", "리본 문구 무료."],
               ["드라이플라워 스탠드", "28,000원", "오래 두고 보실 수 있습니다."]],
    coupons: [], updates: ["작약 들어왔습니다. 이번 주가 마지막이에요."] },

  { slug: "seocho-fashion", name: "서초 편집숍 온", cover: "fashion", cat: "패션·잡화", owner: "권세라",
    desc: "국내 소규모 브랜드 위주로 들여옵니다. 사이즈가 애매하면 편하게 입어보고 가세요.",
    addr: "서울 서초대로 46길 15", tel: "02-9410-8890", hours: "11:00-20:00 · 월요일 휴무",
    lat: 37.4934, lng: 127.0104, insta: "https://instagram.com/on_seocho",
    products: [["린넨 셔츠", "68,000원", "여름용. 3색."],
               ["가죽 카드지갑", "42,000원", "이니셜 각인 가능."]],
    coupons: [["첫 구매 10% 할인", "매장 방문 시", 120]],
    updates: ["가을 신상 입고됐습니다."] },

  { slug: "kkalkkeut-laundry", name: "깔끔세탁", cover: "laundry", cat: "생활·서비스", owner: "문재호",
    desc: "드라이·물세탁 모두 합니다. 급하시면 말씀해 주세요. 근처는 수거·배달해 드립니다.",
    addr: "서울 서초구 방배중앙로 27", tel: "02-9410-4041", hours: "07:30-21:00 · 일요일 휴무",
    lat: 37.4842, lng: 127.0028,
    products: [["와이셔츠", "2,500원", "당일 오전 접수 시 저녁 완료."],
               ["코트 드라이", "12,000원", "울·캐시미어 별도."],
               ["이불 세탁", "18,000원~", "크기에 따라 다릅니다."]],
    coupons: [["와이셔츠 10장 이상 20% 할인", "한 번에 맡기실 때", 90]],
    updates: [] },

  { slug: "hangbok-pharmacy", name: "행복약국", cover: "pharmacy", cat: "기타", owner: "서정민",
    desc: "처방 조제와 상담을 합니다. 복약 지도는 시간을 들여 설명해 드립니다.",
    addr: "서울 서초구 서초중앙로 62", tel: "02-9410-1190", hours: "08:30-21:00 · 일요일 휴무",
    lat: 37.4956, lng: 127.0141,
    products: [], coupons: [],
    updates: ["환절기 상비약 상담 받습니다. 편하게 들러 주세요."] },

  { slug: "dongmun-chicken", name: "동문통닭", cover: "gukbap", cat: "음식점", owner: "노상철",
    desc: "가마솥에 튀깁니다. 포장 손님이 많아 저녁에는 미리 전화 주시는 편이 빠릅니다.",
    addr: "서울 서초구 사평대로 55길 7", tel: "02-9410-6677", hours: "15:00-24:00",
    lat: 37.4979, lng: 127.0209,
    products: [["옛날통닭", "18,000원", "가마솥 튀김. 소금 곁들임."],
               ["양념반후라이드반", "20,000원", "양념은 맵기 조절 가능."],
               ["닭똥집 튀김", "9,000원", "술안주로 많이 찾으십니다."]],
    coupons: [["포장 시 2,000원 할인", "전화 예약 포함", 90]],
    updates: ["금요일 저녁은 대기가 깁니다. 미리 전화 주세요."] },

  { slug: "namu-gongbang", name: "나무공방 결", cover: "book", cat: "교육·문화", owner: "임태섭",
    desc: "원데이 클래스와 주문 제작을 합니다. 도마·트레이는 당일에 만들어 가실 수 있습니다.",
    addr: "서울 서초구 방배로 18길 22", tel: "02-9410-7120", hours: "10:00-19:00 · 월요일 휴무",
    lat: 37.4829, lng: 127.0044,
    products: [["도마 만들기 클래스", "45,000원", "2시간. 재료비 포함."],
               ["주문 제작 선반", "120,000원~", "치수 상담 후 제작."]],
    coupons: [], updates: ["주말 클래스 자리 두 개 남았습니다."] },

  { slug: "seorae-tteok", name: "서래떡방", cover: "banchan", cat: "음식점", owner: "황보경",
    desc: "떡은 새벽에 쪄서 오전에 다 나갑니다. 답례떡·이바지떡은 사흘 전 예약 부탁드립니다.",
    addr: "서울 서초구 서래로 6길 3", tel: "02-9410-2255", hours: "06:00-19:00 · 일요일 휴무",
    lat: 37.4944, lng: 127.0061,
    products: [["백설기 (1되)", "12,000원", "당일 아침 제조."],
               ["모둠 절편", "9,000원", "쑥·백년초·호박."],
               ["답례떡 세트", "3,500원/개", "사흘 전 예약."]],
    coupons: [["10만원 이상 주문 시 배송 무료", "서초구 내", 180]],
    updates: ["송편 예약 받기 시작했습니다."] },

  { slug: "chorok-vegetable", name: "초록채소", cover: "mart", cat: "농수축산", owner: "구민아",
    desc: "매일 새벽 가락시장에서 봅니다. 소량 포장도 해 드리니 편하게 말씀하세요.",
    addr: "서울 서초구 서초대로 30길 11", tel: "02-9410-9911", hours: "07:00-21:00",
    lat: 37.4889, lng: 127.0088,
    products: [["시금치 한 단", "3,500원", "당일 입고."],
               ["방울토마토 500g", "6,900원", "대저 산."],
               ["모둠 쌈채소", "5,000원", "네 가지 이상."]],
    coupons: [], updates: ["옥수수 들어왔습니다. 삶아서도 팝니다."] },

  { slug: "hanbit-optical", name: "한빛안경원", cover: "fashion", cat: "패션·잡화", owner: "조영표",
    desc: "시력 검사 후 렌즈를 고릅니다. 검사는 무료이고 시간은 20분쯤 걸립니다.",
    addr: "서울 서초구 서초중앙로 34", tel: "02-9410-5050", hours: "10:00-20:00 · 일요일 휴무",
    lat: 37.4951, lng: 127.0157,
    products: [["시력 검사", "무료", "20분 소요. 예약 불필요."],
               ["누진다초점 렌즈", "180,000원~", "적응 기간 무료 조정."]],
    coupons: [["안경테 구매 시 렌즈 30% 할인", "동시 구매 시", 120]],
    updates: [] },

  { slug: "mokwoo-gogi", name: "목우한우식당", cover: "meat", cat: "음식점", owner: "천경수",
    desc: "정육식당입니다. 옆 정육점에서 받은 고기를 상차림비만 받고 구워 드립니다.",
    addr: "서울 서초구 효령로 44길 12", tel: "02-9410-5533", hours: "11:30-22:00 · 일요일 휴무",
    lat: 37.4869, lng: 127.0235,
    products: [["상차림 (1인)", "5,000원", "쌈·찌개·밑반찬 포함."],
               ["한우 모둠 400g", "68,000원", "등심·치마살·부채살."],
               ["된장찌개", "4,000원", "고기 주문 시 3,000원."]],
    coupons: [["4인 이상 음료 서비스", "평일 점심 제외", 60]],
    updates: ["단체 예약은 이틀 전에 말씀해 주세요."] },

  { slug: "areum-nail", name: "아름네일", cover: "hair", cat: "생활·서비스", owner: "지수현",
    desc: "1인 숍이라 예약제로 운영합니다. 손톱 상태를 보고 무리한 시술은 권하지 않습니다.",
    addr: "서울 서초구 서래로 28길 6, 2층", tel: "02-9410-8282", hours: "10:30-20:00 · 화요일 휴무",
    lat: 37.4966, lng: 127.0048, insta: "https://instagram.com/areum_nail",
    products: [["젤 원컬러", "35,000원", "제거 포함."],
               ["케어 + 영양", "25,000원", "시술 없이 관리만."]],
    coupons: [["평일 낮 10% 할인", "오전 10시~오후 2시", 90]],
    updates: [] },

  { slug: "onnuri-stationery", name: "온누리문구", cover: "book", cat: "교육·문화", owner: "표진우",
    desc: "학교 앞 문구점입니다. 준비물은 웬만하면 다 있고, 없으면 다음 날까지 구해 놓습니다.",
    addr: "서울 서초구 효령로 27길 5", tel: "02-9410-3030", hours: "08:00-20:00",
    lat: 37.4884, lng: 127.0189,
    products: [["학년별 준비물 세트", "12,000원~", "학교별로 다릅니다. 문의 주세요."]],
    coupons: [], updates: ["개학 준비물 미리 챙겨 두었습니다."] },

  { slug: "yetnal-bunsik", name: "옛날분식", cover: "gukbap", cat: "음식점", owner: "석말순",
    desc: "떡볶이와 튀김을 합니다. 아이들 하교 시간에는 자리가 없을 수 있습니다.",
    addr: "서울 서초구 효령로 31길 2", tel: "02-9410-4747", hours: "10:30-20:00 · 일요일 휴무",
    lat: 37.4877, lng: 127.0197,
    products: [["떡볶이 (1인)", "4,000원", "맵기 조절 가능."],
               ["모둠튀김", "5,000원", "오징어·야채·고구마."],
               ["김밥", "3,500원", "당일 재료로만."]],
    coupons: [["1만원 이상 어묵국물 무료 포장", "포장 시", 60]],
    updates: ["오늘 순대 삶았습니다."] },

  { slug: "cheongsol-tea", name: "청솔찻집", cover: "cafe", cat: "카페·디저트", owner: "여운형",
    desc: "전통차와 한과를 냅니다. 조용해서 어르신 모임이 많습니다.",
    addr: "서울 서초구 효령로 51", tel: "02-9410-6060", hours: "10:00-22:00 · 월요일 휴무",
    lat: 37.4858, lng: 127.0246,
    products: [["대추차", "7,000원", "직접 고아 냅니다."],
               ["쌍화차", "8,000원", "계란 노른자 선택."],
               ["한과 모둠", "9,000원", "두 분이 드시기 넉넉합니다."]],
    coupons: [], updates: ["햇대추로 차 새로 고았습니다."] },

  { slug: "seocho-shoe", name: "서초구두수선", cover: "sewing", cat: "생활·서비스", owner: "마동철",
    desc: "굽갈이·밑창 교체·염색까지 합니다. 오래된 구두도 가져오시면 봐 드립니다.",
    addr: "서울 서초구 서초대로 78길 3", tel: "02-9410-7373", hours: "09:00-19:30 · 일요일 휴무",
    lat: 37.4919, lng: 127.0285,
    products: [["굽갈이", "8,000원~", "당일 가능."],
               ["밑창 교체", "25,000원~", "이틀 정도 걸립니다."],
               ["가죽 염색", "30,000원~", "색 상담 후 진행."]],
    coupons: [], updates: [] },
];

// 한국식 날짜 표기 (요일 포함) — 공지 본문이 실제 달력과 어긋나지 않게
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const kdate = (o) => { const d = new Date(Date.now() + o * DAY); return `${d.getMonth() + 1}월 ${d.getDate()}일(${WD[d.getDay()]})`; };

const NOTICES = [
  { t: "하반기 정기총회 안내", tag: "공지", pin: 1, d: 2,
    b: `회원 여러분 안녕하세요.\n\n하반기 정기총회를 아래와 같이 엽니다.\n\n일시: ${kdate(20)} 저녁 7시\n장소: 상인회 사무실 2층 회의실\n안건: 하반기 사업계획, 공동판촉 예산, 임원 보선\n\n참석이 어려우신 분은 사무실로 미리 연락 주시면 서면으로 의견 받겠습니다.` },
  { t: "여름철 쓰레기 배출 시간 변경 안내", tag: "안내", pin: 0, d: 5,
    b: "무더위로 악취 민원이 늘어 8월 한 달간 배출 시간을 조정합니다.\n\n기존: 저녁 7시 이후 → 변경: 저녁 8시 이후\n\n음식물은 반드시 전용 용기에 담아 내주시고, 상자는 접어서 묶어 주세요. 협조 부탁드립니다." },
  { t: "소상공인 시설개선 지원사업 신청 접수", tag: "혜택", pin: 0, d: 9,
    b: "서초구청에서 간판·조명·냉난방기 교체 비용을 최대 300만원까지 지원합니다.\n\n신청 기간: 8월 말까지\n대상: 상인회 가입 점포 중 사업자등록 1년 이상\n\n서류 작성이 어려우시면 사무실에서 도와드립니다. 편하게 들러 주세요." },
  { t: "상권 CCTV 2대 추가 설치 완료", tag: "소식", pin: 0, d: 14,
    b: "골목 안쪽 사각지대에 CCTV 2대를 추가로 달았습니다.\n\n설치 위치: 중앙골목 입구, 주차장 뒤편\n\n영상 열람이 필요한 일이 생기면 사무실로 연락 주세요. 절차를 안내해 드립니다." },
  { t: "카드 수수료 인하 관련 안내문 배부", tag: "안내", pin: 0, d: 20,
    b: "영세·중소 가맹점 수수료 조정 내용을 정리한 안내문을 각 점포에 돌렸습니다.\n\n본인 가맹점이 어느 구간인지 확인이 필요하시면 카드사 고객센터 또는 사무실로 문의 주세요." },
  { t: "봄맞이 골목 대청소 후기", tag: "소식", pin: 0, d: 46,
    b: "지난 대청소에 서른두 분이 함께해 주셨습니다.\n\n간판 물청소, 화단 정비, 폐기물 수거까지 반나절 만에 끝났습니다. 나와 주신 사장님들께 감사드립니다." },
];

const EVENTS = [
  { t: "여름 골목 야시장", d: 11, place: "중앙골목 일대",
    desc: "저녁 6시부터 10시까지 골목을 차 없는 거리로 운영합니다. 참여 점포는 부스를 내고, 가게마다 야시장 한정 메뉴를 준비합니다." },
  { t: "우리 동네 반값 장보기 주간", d: 24, place: "가입 점포 전체",
    desc: "일주일 동안 각 점포가 대표 품목 하나를 반값에 내놓습니다. 참여 품목은 행사 전주에 공지로 알려 드립니다." },
  { t: "추석맞이 합동 선물세트 판매", d: 47, place: "상인회 사무실 앞 특설 매대",
    desc: "여러 점포 상품을 묶어 선물세트로 판매합니다. 참여를 원하시는 점포는 사무실로 신청해 주세요." },
];

const POSTS = [
  { t: "야시장 부스 배치 어떻게 할까요?", pin: 1, d: 1, by: 0, images: ["yasijang-layout"],
    b: "야시장 부스 자리를 어떻게 나눌지 의견 모읍니다.\n\n작년처럼 추첨으로 할지, 업종별로 묶을지 고민입니다. 먹거리끼리 붙여 놓으면 손님 동선은 좋은데 연기가 몰린다는 이야기가 있었습니다.\n\n편하게 의견 남겨 주세요.",
    comments: [[1, "업종별로 묶되 먹거리는 골목 입구 쪽에 두면 어떨까요. 연기가 빠집니다."],
               [3, "추첨이 제일 말이 없습니다. 작년에도 별 탈 없었고요."],
               [5, "저는 업종별 찬성입니다. 손님이 돌아보기 편해요."]] },
  { t: "간판 조명 같이 바꾸실 분 계신가요", pin: 0, d: 4, by: 4, images: ["signage-quote"],
    b: "지원사업으로 간판 조명을 바꾸려는데, 여러 집이 같이 하면 시공비를 깎아 준다고 합니다.\n\n세 집 이상이면 견적 다시 받아 보겠습니다. 관심 있으시면 댓글이나 사무실로 알려 주세요.",
    comments: [[6, "저희도 관심 있습니다. 견적 나오면 공유해 주세요."],
               [7, "저희 가게도 넣어 주세요."]] },
  { t: "주차장 뒤편 무단투기, 어떻게 할까요", pin: 0, d: 8, by: 2,
    b: "아침마다 주차장 뒤에 종량제 봉투가 아닌 쓰레기가 쌓입니다.\n\n우리 상권 사람은 아닌 것 같은데, CCTV 달았으니 좀 나아지길 바랍니다. 혹시 목격하시면 사무실로 알려 주세요.",
    comments: [[3, "저도 새벽에 본 적 있습니다. 옆 골목에서 들고 오더군요."]] },
  { t: "점심시간 배달 오토바이 속도 문제", pin: 0, d: 13, by: 7,
    b: "점심때 골목 안에서 속도를 내는 오토바이가 많습니다. 어르신들 다니시는 길이라 걱정됩니다.\n\n안내 표지판이라도 세우면 좋겠는데 어떻게 생각하시나요.",
    comments: [[0, "찬성합니다. 구청에 요청하면 표지판은 지원해 줍니다."],
               [4, "과속방지턱도 같이 알아보면 좋겠습니다."]] },
];

// 투표는 결과가 있어야 기능으로 보입니다. yes/no/abstain 은 BIZ 인덱스.
// 진행 중인 안건에서 0번(데모 계정)은 빼 뒀습니다 — 시연 중에 직접 한 표 넣어 보시라고.
const POLLS = [
  { t: "야시장 부스 배치 방식", closed: 0, close: 6,
    b: "여름 골목 야시장 부스 자리를 어떤 방식으로 정할까요? 게시판 의견을 모아 안건으로 올립니다.",
    yes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], no: [14, 15, 16, 17], abstain: [18, 19] },
  { t: "공동 판촉 예산 500만원 편성", closed: 1, close: -3,
    b: "하반기 공동 판촉 예산을 500만원으로 편성하는 안건입니다. 총회 전 사전 의견 수렴입니다.",
    yes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], no: [17, 18, 19], abstain: [20, 21] },
];

// 행사 참가 신청 (BIZ 인덱스). 야시장은 0번을 빼 시연 때 '참가 신청'을 눌러 볼 수 있게 둡니다.
const RSVPS = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 19],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 15, 17, 18, 20, 21, 22, 24],
  [2, 4, 6, 8, 10, 12, 14, 16],
];

// 회비 장부 — [몇 달 전, 납부한 회원 수]. 이번 달은 일부러 걷히는 중인 상태로 둡니다.
const DUES = [[0, 19], [1, 25], [2, 24]];

// 승인 대기·반려 점포. 관리자 화면의 승인 흐름을 시연하려면 대기 건이 있어야 합니다.
// 공개 목록에는 승인된 점포만 나오므로 손님 화면에는 영향이 없습니다.
const APPLICANTS = [
  { slug: "modeum-tteokbokki", name: "모둠분식", cat: "음식점", owner: "허진영", status: "pending", days: 1,
    desc: "떡볶이와 순대를 합니다. 이번에 상인회에 가입하려고 신청드립니다.",
    addr: "서울 서초구 효령로 29길 8", tel: "02-9410-2626", hours: "11:00-21:00" },
  { slug: "seocho-bike", name: "서초자전거", cat: "생활·서비스", owner: "남기훈", status: "pending", days: 3,
    desc: "자전거 수리와 판매를 합니다. 골목 안쪽이라 상인회 지도에 꼭 실리고 싶습니다.",
    addr: "서울 서초구 방배로 33", tel: "02-9410-9494", hours: "10:00-19:30 · 일요일 휴무" },
  { slug: "unknown-shop", name: "(주)에스씨마케팅", cat: "기타", owner: "정보경", status: "rejected", days: 12,
    desc: "온라인 마케팅 대행업체입니다.",
    addr: "서울 강남구 테헤란로 152", tel: "02-9410-0001", hours: "09:00-18:00" },
];

// 감사 로그 — 사무국이 실제로 하는 일들. [며칠 전, 행위, 상세]
const AUDIT = [
  [1, "공지등록", "하반기 정기총회 안내"],
  [2, "업체승인", "초록채소 승인"],
  [4, "회비체크", "8월분 납부 19건 기록"],
  [5, "서명문서생성", "여름 골목 야시장 공동 운영 동의서"],
  [6, "행사등록", "여름 골목 야시장"],
  [9, "업체반려", "(주)에스씨마케팅 — 상권 내 점포가 아님"],
  [12, "임시비밀번호", "박순자님 임시 비밀번호 발급"],
  [16, "브랜딩변경", "대표색·로고 교체"],
];

// ───────── 전자서명 문서 ─────────
// to/signed 는 BIZ 인덱스입니다. 0번(고을돼지국밥 김정식 = 배포용 데모 계정 owner1)은
// 1번 문서에서 일부러 미서명으로 남기고, 2번 문서에서는 '서명 차례'가 되도록 배치했습니다.
// 데모 계정으로 로그인하면 실제로 서명해 볼 수 있는 문서가 남아 있어야 하기 때문입니다.
const YEAR = new Date().getFullYear();
const DOCS = [
  { title: "여름 골목 야시장 공동 운영 동의서", created: -6, due: 7, ordered: 0, closed: 0,
    to: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], signed: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    body: `여름 골목 야시장(이하 "행사")의 공동 운영에 관하여 아래 내용에 동의합니다.

1. 행사 기간에는 점포 앞 1.5m 이내에 적치물을 두지 않습니다.
2. 부스를 운영하는 점포는 소화기 1대를 비치하고, 화기를 쓸 때는 상인회 안전담당의 확인을 받습니다.
3. 행사 한정 메뉴의 가격은 평소 판매가를 넘지 않게 정합니다.
4. 공동 홍보물(현수막·전단·SNS)에 우리 점포의 상호와 대표 메뉴가 실리는 것에 동의합니다.
5. 영업 중 나온 쓰레기는 각 점포가 마감 후 직접 모아 지정 장소에 내놓습니다.

본 동의서는 행사 종료일까지 유효합니다. 서명 후 철회를 원하시면 상인회 사무실로 서면 통보해 주십시오.` },

  { title: "하반기 공동 판촉 예산 집행 위임장", created: -3, due: 10, ordered: 1, closed: 0,
    to: [3, 6, 9, 0, 12], signed: [3, 6, 9],
    body: `하반기 공동 판촉 예산(금 오백만원)의 집행을 아래와 같이 상인회 집행부에 위임합니다.

1. 위임 범위: 공동 전단 제작, 상권 지도 인쇄, 온라인 광고 집행에 한합니다.
2. 집행 한도: 건당 150만원, 총액 500만원을 넘지 않습니다.
3. 정산: 매월 말일 기준 집행 내역과 증빙을 회원에게 공개합니다.
4. 잔액: 회계연도가 끝났을 때 남은 금액은 다음 해 예산으로 넘깁니다.

본 위임은 하반기 정기총회 의결을 따르며, 총회에서 부결되면 효력을 잃습니다.
※ 순차 서명 문서입니다. 앞 순번의 서명이 끝난 뒤에 서명하실 수 있습니다.` },

  { title: `${YEAR}년 상반기 회계 결산 확인서`, created: -34, due: null, ordered: 0, closed: 1,
    to: [0, 1, 2, 3, 4], signed: [0, 1, 2, 3, 4],
    body: `상반기 회계 결산 내역을 확인하였으며, 아래 사항에 이의가 없음을 확인합니다.

수입  회비 12,600,000원 · 구청 보조금 8,000,000원 · 행사 수입 3,240,000원
지출  공동 판촉 6,480,000원 · 시설 유지(청소·CCTV) 5,120,000원 · 사무 운영 4,310,000원
잔액  7,930,000원 (상인회 명의 통장 보관)

감사에서 증빙이 빠진 건은 없었습니다. 세부 내역은 사무실에서 열람하실 수 있습니다.` },
];

// 서명 기록에 남는 접속 정보. IP 는 문서용으로 예약된 203.0.113.0/24(TEST-NET-3)만 씁니다 —
// 실제로 쓰이는 주소를 데모에 박아 두면 엉뚱한 가입자의 주소가 화면에 남습니다.
const SIGN_IP = (i) => "203.0.113." + (20 + i);
const SIGN_UA = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; SM-S926N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
];

/**
 * 대상 상인회를 데모 콘텐츠로 채웁니다.
 * 기존 콘텐츠(점포·공지·행사·게시글·투표)와 데모 사장님 계정은 먼저 지웁니다 —
 * 삭제 범위는 이 상인회로 한정되며 다른 상인회는 건드리지 않습니다.
 * 상인회 관리자(ADMIN)와 슈퍼 관리자 계정은 지우지 않습니다.
 */
export async function seedDemo(env, db, assoc, { emailDomain = "demo.kr" } = {}) {
  const aid = assoc.id;
  const run = (sql, ...args) => db.prepare(sql).bind(...args).run();
  const firstId = async (sql, ...args) => (await db.prepare(sql).bind(...args).first())?.id ?? null;

  // ---- 정리 (이 상인회 한정) ----
  // 서명·서명요청은 문서를 지우기 전에 먼저 지웁니다(외래키 CASCADE 에 기대지 않음).
  for (const t of ["signatures", "signature_requests"])
    await run(`DELETE FROM ${t} WHERE document_id IN (SELECT id FROM documents WHERE association_id=?)`, aid);
  await run(`DELETE FROM documents WHERE association_id=?`, aid);
  await run(`DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE association_id=?)`, aid);
  await run(`DELETE FROM post_images WHERE post_id IN (SELECT id FROM posts WHERE association_id=?)`, aid);
  await run(`DELETE FROM poll_votes WHERE poll_id IN (SELECT id FROM polls WHERE association_id=?)`, aid);
  for (const t of ["posts", "polls", "notices", "events", "products", "coupons", "updates", "notifications"])
    await run(`DELETE FROM ${t} WHERE association_id=?`, aid);
  await run(`DELETE FROM media WHERE business_id IN (SELECT id FROM businesses WHERE association_id=?)`, aid);
  await run(`DELETE FROM event_rsvps WHERE event_id IN (SELECT id FROM events WHERE association_id=?)`, aid);
  await run(`DELETE FROM businesses WHERE association_id=?`, aid);
  await run(`DELETE FROM dues WHERE association_id=?`, aid);
  // 감사 로그도 이 상인회 것만 비웁니다. 콘텐츠를 통째로 갈아 끼우는 자리라
  // 지워진 대상에 대한 기록만 남아 있으면 오히려 읽는 사람을 헷갈리게 합니다.
  await run(`DELETE FROM audit_log WHERE association_id=?`, aid);
  await run(`DELETE FROM users WHERE association_id=? AND role='MERCHANT'`, aid);

  // ---- 상인회 소개 정보 ----
  await run(`UPDATE associations SET tagline=?, phone=?, email=?, address=?, map_lat=?, map_lng=?, map_zoom=? WHERE id=?`,
    "골목마다 사람이 있고, 가게마다 이야기가 있습니다", "02-9410-1004", "office@demo.kr",
    "서울 서초구 서초대로 78길 22, 2층", 37.4903, 127.0176, 16, aid);
  // 히어로 배경은 비워 둡니다 — 커버 이미지를 배경으로 늘리면 건물 윤곽이 거대하게 잡혀 어색합니다.
  await run(`UPDATE associations SET hero_image='', logo=? WHERE id=?`, "/img/demo/logo.svg", aid);

  // ---- 점포 + 사장님 계정 ----
  const ownerIds = [];
  for (let i = 0; i < BIZ.length; i++) {
    const b = BIZ[i];
    const pw = await hashPassword(DEMO_PASSWORD);
    const email = `owner${i + 1}@${emailDomain}`;
    await run(`INSERT INTO users (association_id, email, password_hash, salt, name, role) VALUES (?,?,?,?,?,'MERCHANT')`,
      aid, email, pw.hash, pw.salt, b.owner);
    const uid = await firstId(`SELECT id FROM users WHERE email=?`, email);
    ownerIds.push(uid);

    // source: 사장님이 직접 등록했는지(self) 사무국이 대신 넣었는지(proxy).
    // 관리자 화면의 '셀프 등록률' 이 재는 값이라 전부 self 로 두면 100% 가 찍혀 계측이 무의미해집니다.
    // updated_at 도 흩뿌립니다 — 25곳이 모두 최근 갱신이면 '최근 30일 갱신률' 도 늘 100% 입니다.
    await run(`INSERT INTO businesses (association_id, owner_id, name, slug, category, description, phone, address, hours, lat, lng, status, sns_instagram, source, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?, 'approved', ?, ?, ?, ?)`,
      aid, uid, b.name, b.slug || slugify(b.name), b.cat, b.desc, b.tel, b.addr, b.hours,
      b.lat, b.lng, b.insta || "", i % 3 === 2 ? "proxy" : "self", at(-60 + i * 3), at(-Math.round(i * 2.4)));
    if (i === 4 || i === 17) await run(`UPDATE businesses SET day_off_date=? WHERE association_id=? AND slug=?`, ymd(0), aid, b.slug); // 두 곳은 '오늘 휴무' — 전부 영업중이면 오히려 가짜처럼 보임
    const bid = await firstId(`SELECT id FROM businesses WHERE association_id=? AND slug=?`, aid, b.slug);
    // 대표 이미지 — 워커에 함께 배포된 정적 커버(/img/demo/*.jpg). 외부 호스트 의존 없음.
    if (b.cover) await run(`INSERT INTO media (business_id, kind, filename, thumb, caption) VALUES (?,'image',?,?,?)`,
      bid, `/img/demo/${b.cover}.jpg`, `/img/demo/${b.cover}.jpg`, `${b.name} 대표 이미지`);

    for (let j = 0; j < b.products.length; j++) {
      const [n, price, d] = b.products[j];
      await run(`INSERT INTO products (business_id, association_id, name, price, description, sort_order) VALUES (?,?,?,?,?,?)`,
        bid, aid, n, price, d, j);
    }
    for (const [t, terms, valid] of b.coupons)
      await run(`INSERT INTO coupons (business_id, association_id, title, terms, valid_until) VALUES (?,?,?,?,?)`,
        bid, aid, t, terms, ymd(valid));
    for (let j = 0; j < b.updates.length; j++)
      await run(`INSERT INTO updates (business_id, association_id, body, created_at) VALUES (?,?,?,?)`,
        bid, aid, b.updates[j], at(-(i + j)));
  }

  // ---- 공지 · 행사 ----
  for (const n of NOTICES)
    await run(`INSERT INTO notices (association_id, title, body, tag, pinned, created_at) VALUES (?,?,?,?,?,?)`,
      aid, n.t, n.b, n.tag, n.pin, at(-n.d));
  for (let ei = 0; ei < EVENTS.length; ei++) {
    const e = EVENTS[ei];
    await run(`INSERT INTO events (association_id, title, event_date, place, description) VALUES (?,?,?,?,?)`,
      aid, e.t, ymd(e.d), e.place, e.desc);
    const evId = await firstId(`SELECT id FROM events WHERE association_id=? AND title=? ORDER BY id DESC LIMIT 1`, aid, e.t);
    for (const i of RSVPS[ei] || [])
      await run(`INSERT INTO event_rsvps (event_id, association_id, user_id, created_at) VALUES (?,?,?,?)`,
        evId, aid, ownerIds[i], at(-8 + i * 0.2));
  }

  // ---- 게시판 · 투표 ----
  for (const post of POSTS) {
    await run(`INSERT INTO posts (association_id, author_id, title, body, pinned, created_at) VALUES (?,?,?,?,?,?)`,
      aid, ownerIds[post.by], post.t, post.b, post.pin, at(-post.d));
    const pid = await firstId(`SELECT id FROM posts WHERE association_id=? AND title=? ORDER BY id DESC LIMIT 1`, aid, post.t);
    // 첨부는 '사진' 이 아니라 실제로 게시판에 올라오는 자료(배치도·견적 비교)입니다.
    for (const img of post.images || [])
      await run(`INSERT INTO post_images (post_id, filename, thumb) VALUES (?,?,?)`,
        pid, `/img/demo/post/${img}.png`, `/img/demo/post/${img}.png`);
    for (let j = 0; j < post.comments.length; j++) {
      const [who, body] = post.comments[j];
      await run(`INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?,?,?,?)`,
        pid, ownerIds[who], body, at(-post.d + (j + 1) * 0.2));
    }
  }
  for (const pl of POLLS) {
    await run(`INSERT INTO polls (association_id, title, body, closes_at, closed, created_at) VALUES (?,?,?,?,?,?)`,
      aid, pl.t, pl.b, ymd(pl.close), pl.closed, at(-7));
    const plId = await firstId(`SELECT id FROM polls WHERE association_id=? AND title=? ORDER BY id DESC LIMIT 1`, aid, pl.t);
    for (const [choice, list] of [["yes", pl.yes], ["no", pl.no], ["abstain", pl.abstain]])
      for (const i of list || [])
        await run(`INSERT INTO poll_votes (poll_id, user_id, choice, created_at) VALUES (?,?,?,?)`,
          plId, ownerIds[i], choice, at(-6 + i * 0.15));
  }

  // ---- 전자서명 ----
  // 데이터를 직접 밀어 넣지 않고 실제 서명 경로를 그대로 탑니다:
  // 본문 SHA-256 해시 → 서명 요청 생성 → 서명 레코드를 Ed25519 로 봉인.
  // 그래서 /verify/<코드> 에서 '유효' 로 검증되고, 본문을 한 글자라도 고치면 즉시 깨집니다.
  const adminId = await firstId(`SELECT id FROM users WHERE association_id=? AND role='ADMIN' ORDER BY id LIMIT 1`, aid);
  const tbase = "/t/" + encodeURIComponent(assoc.slug);
  const notis = [];
  let signCount = 0;
  for (let di = 0; di < DOCS.length; di++) {
    const spec = DOCS[di];
    const doc = await D.createDocument(db, {
      associationId: aid, title: spec.title, body: spec.body,
      contentHash: await contentHash(spec.body), createdBy: adminId,
      ordered: spec.ordered, dueDate: spec.due == null ? "" : ymd(spec.due),
    });
    // 생성 시각도 낮 시간대로 — 세 문서가 모두 같은 분(데모를 채운 그 순간)에 만들어져 있으면 티가 납니다.
    await run(`UPDATE documents SET created_at=? WHERE id=?`,
      signedAtIso(spec.created, di * 3).slice(0, 19).replace("T", " "), doc.id);
    await D.createSignatureRequests(db, doc.id, spec.to.map((i) => ownerIds[i]));

    for (let k = 0; k < spec.signed.length; k++) {
      const i = spec.signed[k];
      const rec = {
        documentId: doc.id, userId: ownerIds[i], signerName: BIZ[i].owner,
        contentHash: doc.content_hash, signedAt: signedAtIso(spec.created + 1 + Math.floor(k / 2), k), ip: SIGN_IP(i),
      };
      await D.createSignature(db, {
        ...rec,
        signatureImage: `/img/demo/sign/${i + 1}.png`,
        userAgent: SIGN_UA[(i + k) % SIGN_UA.length],
        verifyCode: newVerifyCode(),
        recordHash: await sealRecord(env, rec),
      });
      signCount++;
      notis.push([rec.signedAt, `${rec.signerName}님이 '${spec.title}'에 전자서명했습니다.`, `${tbase}/admin/documents/${doc.id}`]);
    }
    if (spec.closed) await D.closeDocument(db, doc.id);
  }
  // 알림함은 최근 서명 몇 건만 — 열일곱 건이 한꺼번에 쌓여 있으면 오히려 방치된 화면처럼 보입니다.
  for (const [ts, msg, link] of notis.sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 4))
    await run(`INSERT INTO notifications (association_id, kind, message, link, created_at) VALUES (?,'signed',?,?,?)`,
      aid, msg, link, ts.slice(0, 19).replace("T", " "));

  // ---- 승인 대기·반려 점포 ----
  for (let i = 0; i < APPLICANTS.length; i++) {
    const a = APPLICANTS[i];
    const pw = await hashPassword(DEMO_PASSWORD);
    const email = `applicant${i + 1}@${emailDomain}`;
    await run(`INSERT INTO users (association_id, email, password_hash, salt, name, role) VALUES (?,?,?,?,?,'MERCHANT')`,
      aid, email, pw.hash, pw.salt, a.owner);
    const uid = await firstId(`SELECT id FROM users WHERE email=?`, email);
    await run(`INSERT INTO businesses (association_id, owner_id, name, slug, category, description, phone, address, hours, status, source, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'self', ?, ?)`,
      aid, uid, a.name, a.slug, a.cat, a.desc, a.tel, a.addr, a.hours, a.status, at(-a.days), at(-a.days));
    if (a.status === "pending")
      await run(`INSERT INTO notifications (association_id, kind, message, link, created_at) VALUES (?,'business',?,?,?)`,
        aid, `${a.name} — 입점 신청이 들어왔습니다.`, `${tbase}/admin#p-biz`, at(-a.days));
  }

  // ---- 회비 장부 ----
  const now = new Date();
  for (const [back, paid] of DUES) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    for (let i = 0; i < Math.min(paid, ownerIds.length); i++)
      await run(`INSERT INTO dues (association_id, user_id, period, memo, created_at) VALUES (?,?,?,?,?)`,
        aid, ownerIds[i], period, "", at(-back * 30 + 4));
  }

  // ---- 감사 로그 ----
  for (const [days, action, detail] of AUDIT)
    await run(`INSERT INTO audit_log (association_id, user_id, actor_name, action, detail, created_at) VALUES (?,?,?,?,?,?)`,
      aid, adminId, "상인회 사무국", action, detail, at(-days));

  return {
    businesses: BIZ.length,
    products: BIZ.reduce((n, b) => n + b.products.length, 0),
    coupons: BIZ.reduce((n, b) => n + b.coupons.length, 0),
    updates: BIZ.reduce((n, b) => n + b.updates.length, 0),
    notices: NOTICES.length, events: EVENTS.length,
    posts: POSTS.length, polls: POLLS.length,
    documents: DOCS.length, signatures: signCount,
    ownerEmail: `owner1@${emailDomain}`, password: DEMO_PASSWORD,
  };
}
