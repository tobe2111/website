// 데모/샘플 상인회 콘텐츠 SQL 생성기
// 한 테넌트를 "실제로 운영 중인 상인회"처럼 채워, 영업 소개용 샘플 페이지로 쓰기 위한 것입니다.
// 점포·메뉴·쿠폰·소식·공지·행사·게시판·투표를 한 번에 넣습니다.
//
// 사용:
//   node scripts/gen-demo-sql.mjs > demo.sql
//   wrangler d1 execute seocho-db --remote --file=demo.sql
//
// 옵션(환경변수):
//   SLUG      대상 상인회 slug           (기본: 리스터코퍼레이션)
//   NAME      상인회 표시 이름           (기본: SLUG 와 동일)
//   PASSWORD  데모 계정 공통 비밀번호    (기본: demo1234)
//   KEEP=1    기존 데이터를 지우지 않음  (기본: 대상 상인회 데이터를 비우고 새로 넣음)
//
// ⚠️ KEEP=1 이 아니면 **대상 상인회의 기존 점포·공지·행사·게시글이 모두 삭제**됩니다.
//    삭제 범위는 해당 상인회로 한정되며 다른 상인회는 건드리지 않습니다.
import { hashPassword } from "../src/crypto.js";

const SLUG = process.env.SLUG || "리스터코퍼레이션";
const NAME = process.env.NAME || SLUG;
const PASSWORD = process.env.PASSWORD || "demo1234";
const KEEP = process.env.KEEP === "1";

const q = (s) => "'" + String(s ?? "").replace(/'/g, "''") + "'";
const A = `(SELECT id FROM associations WHERE slug=${q(SLUG)})`;
const B = (slug) => `(SELECT id FROM businesses WHERE association_id=${A} AND slug=${q(slug)})`;
const U = (email) => `(SELECT id FROM users WHERE email=${q(email)})`;

// 날짜는 실행 시점 기준으로 계산 — 행사가 항상 '다가오는' 상태로 보이게
const day = 86400000;
const now = Date.now();
const ymd = (offset) => new Date(now + offset * day).toISOString().slice(0, 10);
const stamp = (offset) => new Date(now + offset * day).toISOString().slice(0, 19).replace("T", " ");

// ───────────────────────── 점포 ─────────────────────────
// 서초역·교대역 일대 좌표로 흩뿌려 지도에서도 자연스럽게 보이도록.
const BIZ = [
  { slug: "hanam-gukbap", name: "하남돼지국밥", cat: "음식점", owner: "김정식",
    desc: "23년째 같은 자리에서 가마솥으로 우려낸 국물을 냅니다. 점심에는 줄이 길어 11시 30분 전에 오시길 권합니다.",
    addr: "서울 서초구 서초대로 78길 12", tel: "02-533-1284", hours: "09:00-21:30", off: "매주 일요일 휴무",
    lat: 37.4923, lng: 127.0292,
    products: [["돼지국밥", "9,000원", "24시간 끓인 사골 육수. 밥 추가 무료."],
               ["수육백반", "13,000원", "앞다리살 수육에 국밥 한 그릇."],
               ["순대국밥", "9,000원", "국내산 순대만 씁니다."],
               ["모둠수육 (2인)", "28,000원", "미리 전화 주시면 준비해 둡니다."]],
    coupons: [["공기밥 무제한", "국밥류 주문 시", 90]],
    updates: ["오늘 김치를 새로 담갔습니다. 아삭할 때 드시러 오세요.", "이번 주 토요일은 재료 준비로 오후 3시에 문 엽니다."] },

  { slug: "seocho-bakehouse", name: "서초 베이크하우스", cat: "카페·디저트", owner: "이현주",
    desc: "매일 새벽 4시에 반죽을 시작합니다. 당일 구운 빵만 판매하고 남은 빵은 다음 날로 넘기지 않습니다.",
    addr: "서울 서초구 반포대로 30길 8", tel: "02-586-7742", hours: "08:00-20:00", off: "",
    lat: 37.4871, lng: 127.0141, insta: "https://instagram.com/seocho_bakehouse",
    products: [["소금버터롤", "3,200원", "오전 10시, 오후 4시 두 번 구워 나옵니다."],
               ["통밀 캄파뉴", "8,500원", "우리밀 통밀 30%. 하루 12개 한정."],
               ["무화과 크림치즈", "5,500원", "제철 무화과가 들어갑니다."],
               ["드립커피", "4,000원", "주 단위로 원두가 바뀝니다."]],
    coupons: [["아메리카노 1,000원 할인", "빵 2개 이상 구매 시", 60]],
    updates: ["내일 아침 캄파뉴 굽습니다. 오전 10시쯤 나와요.", "여름 한정 복숭아 타르트 시작했습니다."] },

  { slug: "mirae-sewing", name: "미래수선", cat: "생활·서비스", owner: "박순자",
    desc: "옷 수선, 지퍼 교체, 기장 수선까지 30년 경력으로 봐 드립니다. 급한 건은 당일도 가능합니다.",
    addr: "서울 서초구 서초중앙로 24길 5", tel: "02-522-9038", hours: "09:30-19:00", off: "일요일 휴무",
    lat: 37.4948, lng: 127.0163,
    products: [["바지 기장 수선", "5,000원", "당일 가능."],
               ["지퍼 교체", "8,000원~", "지퍼 종류에 따라 다릅니다."],
               ["코트 소매 줄임", "20,000원~", "안감 유무에 따라 달라집니다."]],
    coupons: [], updates: ["장마철 눅눅해진 겨울옷, 지금 맡기시면 여유 있게 봐 드립니다."] },

  { slug: "nampo-fish", name: "남포수산", cat: "농수축산", owner: "정만석",
    desc: "새벽 노량진에서 직접 보고 떼 옵니다. 회는 주문 후에 뜨고, 손질은 무료입니다.",
    addr: "서울 서초구 방배로 42길 3", tel: "02-591-6620", hours: "10:00-21:00", off: "",
    lat: 37.4816, lng: 127.0007,
    products: [["광어회 (小)", "28,000원", "2~3인분. 초장·상추 포함."],
               ["연어회 300g", "22,000원", "노르웨이산."],
               ["손질 갈치 (2마리)", "18,000원", "제주산. 내장 손질해 드립니다."],
               ["모둠회 (大)", "55,000원", "그날 좋은 것으로 5종."]],
    coupons: [["매운탕거리 서비스", "회 3만원 이상 구매 시", 120]],
    updates: ["오늘 전복 좋은 게 들어왔습니다.", "추석 선물세트 예약 받습니다. 전화 주세요."] },

  { slug: "banpo-hair", name: "반포 헤어살롱", cat: "생활·서비스", owner: "최유진",
    desc: "예약제로 운영해 기다리지 않으셔도 됩니다. 두피 상태를 먼저 보고 시술을 정합니다.",
    addr: "서울 서초구 신반포로 45길 11", tel: "02-535-2211", hours: "10:00-20:00", off: "월요일 휴무",
    lat: 37.5041, lng: 127.0113, insta: "https://instagram.com/banpo_hair",
    products: [["커트", "25,000원", "샴푸·드라이 포함."],
               ["뿌리 염색", "60,000원", "새치 커버 가능."],
               ["두피 스케일링", "35,000원", "커트와 함께 하면 5,000원 할인."]],
    coupons: [["첫 방문 20% 할인", "예약 후 방문 시 1회 한정", 180]],
    updates: ["9월 예약 열렸습니다. 주말은 빨리 마감돼요."] },

  { slug: "chaekbang-seocho", name: "동네책방 서초", cat: "교육·문화", owner: "한지원",
    desc: "작은 서점입니다. 매주 목요일 저녁에 독서모임을 하고, 원하시는 책은 주문해 드립니다.",
    addr: "서울 서초구 효령로 31길 7", tel: "02-583-4409", hours: "11:00-21:00", off: "화요일 휴무",
    lat: 37.4879, lng: 127.0203,
    products: [["이달의 책 꾸러미", "25,000원", "책 1권 + 책방지기 편지."],
               ["독서모임 참가비", "10,000원", "매주 목요일 저녁 7시 30분."]],
    coupons: [], updates: ["이번 달 독서모임 책은 『아무튼, 계단』입니다. 두 자리 남았어요."] },

  { slug: "jeil-mart", name: "제일마트", cat: "농수축산", owner: "오경택",
    desc: "동네 슈퍼입니다. 과일은 매일 아침 들어오고, 무거운 건 근처는 배달해 드립니다.",
    addr: "서울 서초구 사평대로 20길 4", tel: "02-596-3311", hours: "08:00-23:00", off: "",
    lat: 37.4962, lng: 127.0248,
    products: [["제철 과일 모둠", "15,000원", "그날 좋은 것으로 담습니다."],
               ["계란 한 판", "7,900원", "무항생제."]],
    coupons: [["2만원 이상 무료 배달", "반경 1km 이내", 365]],
    updates: ["복숭아 들어왔습니다. 지금이 제일 답니다.", "생수 6개들이 행사합니다."] },

  { slug: "sonmat-banchan", name: "손맛반찬", cat: "음식점", owner: "윤미경",
    desc: "매일 아침 만든 반찬만 진열합니다. 조미료를 쓰지 않아 간이 세지 않습니다.",
    addr: "서울 서초구 서초대로 50길 9", tel: "02-521-7788", hours: "09:00-20:00", off: "일요일 휴무",
    lat: 37.4901, lng: 127.0119,
    products: [["멸치볶음", "5,000원", "국물용 아닌 볶음용 멸치만 씁니다."],
               ["장조림", "9,000원", "홍두깨살."],
               ["오이소박이", "7,000원", "여름에만 담급니다."],
               ["모둠 반찬 5종", "22,000원", "그날 있는 것으로 구성."]],
    coupons: [["반찬 1종 서비스", "2만원 이상 구매 시", 60]],
    updates: ["오이소박이 담갔습니다. 이번 주까지만 나갑니다."] },
];

// ───────────────────────── 공지 ─────────────────────────
const NOTICES = [
  { t: "2026년 하반기 정기총회 안내", tag: "공지", pin: 1, d: 2,
    b: "회원 여러분 안녕하세요.\n\n2026년 하반기 정기총회를 아래와 같이 엽니다.\n\n일시: 8월 28일(금) 저녁 7시\n장소: 상인회 사무실 2층 회의실\n안건: 하반기 사업계획, 공동판촉 예산, 임원 보선\n\n참석이 어려우신 분은 사무실로 미리 연락 주시면 서면으로 의견 받겠습니다." },
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

// ───────────────────────── 행사 ─────────────────────────
const EVENTS = [
  { t: "여름 골목 야시장", d: 11, place: "중앙골목 일대",
    desc: "저녁 6시부터 10시까지 골목을 차 없는 거리로 운영합니다. 참여 점포는 부스를 내고, 가게마다 야시장 한정 메뉴를 준비합니다." },
  { t: "우리 동네 반값 장보기 주간", d: 24, place: "가입 점포 전체",
    desc: "일주일 동안 각 점포가 대표 품목 하나를 반값에 내놓습니다. 참여 품목은 행사 전주에 공지로 알려 드립니다." },
  { t: "추석맞이 합동 선물세트 판매", d: 47, place: "상인회 사무실 앞 특설 매대",
    desc: "여러 점포 상품을 묶어 선물세트로 판매합니다. 참여를 원하시는 점포는 사무실로 신청해 주세요." },
];

// ───────────────────────── 게시판 ─────────────────────────
const POSTS = [
  { t: "야시장 부스 배치 어떻게 할까요?", pin: 1, d: 1, by: "kim",
    b: "야시장 부스 자리를 어떻게 나눌지 의견 모읍니다.\n\n작년처럼 추첨으로 할지, 업종별로 묶을지 고민입니다. 먹거리끼리 붙여 놓으면 손님 동선은 좋은데 연기가 몰린다는 이야기가 있었습니다.\n\n편하게 의견 남겨 주세요.",
    comments: [["lee", "업종별로 묶되 먹거리는 골목 입구 쪽에 두면 어떨까요. 연기가 빠집니다."],
               ["jeong", "추첨이 제일 말이 없습니다. 작년에도 별 탈 없었고요."],
               ["han", "저는 업종별 찬성입니다. 손님이 돌아보기 편해요."]] },
  { t: "간판 조명 같이 바꾸실 분 계신가요", pin: 0, d: 4, by: "choi",
    b: "지원사업으로 간판 조명을 바꾸려는데, 여러 집이 같이 하면 시공비를 깎아 준다고 합니다.\n\n세 집 이상이면 견적 다시 받아 보겠습니다. 관심 있으시면 댓글이나 사무실로 알려 주세요.",
    comments: [["oh", "저희도 관심 있습니다. 견적 나오면 공유해 주세요."],
               ["yoon", "저희 가게도 넣어 주세요."]] },
  { t: "주차장 뒤편 무단투기 사진 올립니다", pin: 0, d: 8, by: "park",
    b: "아침마다 주차장 뒤에 종량제 봉투가 아닌 쓰레기가 쌓입니다.\n\n우리 상권 사람은 아닌 것 같은데, CCTV 달았으니 좀 나아지길 바랍니다. 혹시 목격하시면 사무실로 알려 주세요.",
    comments: [["jeong", "저도 새벽에 본 적 있습니다. 옆 골목에서 들고 오더군요."]] },
  { t: "점심시간 배달 오토바이 속도 문제", pin: 0, d: 13, by: "yoon",
    b: "점심때 골목 안에서 속도를 내는 오토바이가 많습니다. 어르신들 다니시는 길이라 걱정됩니다.\n\n안내 표지판이라도 세우면 좋겠는데 어떻게 생각하시나요.",
    comments: [["kim", "찬성합니다. 구청에 요청하면 표지판은 지원해 줍니다."],
               ["choi", "과속방지턱도 같이 알아보면 좋겠습니다."]] },
];

const POLLS = [
  { t: "야시장 부스 배치 방식", b: "여름 골목 야시장 부스 자리를 어떤 방식으로 정할까요? 게시판 의견을 모아 안건으로 올립니다.", close: 6, open: 1 },
  { t: "공동 판촉 예산 500만원 편성", b: "하반기 공동 판촉 예산을 500만원으로 편성하는 안건입니다. 총회 전 사전 의견 수렴입니다.", close: -3, open: 0 },
];

// ───────────────────────── SQL 조립 ─────────────────────────
const out = [];
const p = (s) => out.push(s);

const adminEmail = `admin@${SLUG === "리스터코퍼레이션" ? "lister" : "demo"}.kr`;
const admHash = await hashPassword(PASSWORD);
const ownerEmail = (i) => `owner${i + 1}@demo.kr`;
const ownerHashes = await Promise.all(BIZ.map(() => hashPassword(PASSWORD)));
const byKey = { kim: 0, lee: 1, park: 2, jeong: 3, choi: 4, han: 5, oh: 6, yoon: 7 };

p(`-- ${NAME} 데모 콘텐츠 (생성: ${new Date().toISOString().slice(0, 10)})`);
p(`-- 데모 계정 비밀번호: ${PASSWORD}`);
p(`--   관리자  ${adminEmail}   → ${"/t/" + SLUG + "/admin"}`);
p(`--   사장님  ${ownerEmail(0)}      → ${"/t/" + SLUG + "/dashboard"}`);
p(`-- ⚠️ 실제 서비스에 쓰려면 데모 계정 비밀번호를 반드시 바꾸세요.`);
p("");
p(`INSERT OR IGNORE INTO associations (slug, name) VALUES (${q(SLUG)}, ${q(NAME)});`);
p(`UPDATE associations SET
  name=${q(NAME)},
  tagline='골목마다 사람이 있고, 가게마다 이야기가 있습니다',
  phone='02-585-1004', email='office@lister.kr',
  address='서울 서초구 서초대로 78길 22, 2층',
  map_lat=37.4903, map_lng=127.0176, map_zoom=16
 WHERE slug=${q(SLUG)};`);

if (!KEEP) {
  p("");
  p(`-- 기존 데모 데이터 정리 (이 상인회에 한정)`);
  for (const t of ["comments", "post_images"])
    p(`DELETE FROM ${t} WHERE post_id IN (SELECT id FROM posts WHERE association_id=${A});`);
  p(`DELETE FROM poll_votes WHERE poll_id IN (SELECT id FROM polls WHERE association_id=${A});`);
  for (const t of ["posts", "polls", "notices", "events", "products", "coupons", "updates", "notifications"])
    p(`DELETE FROM ${t} WHERE association_id=${A};`);
  p(`DELETE FROM media WHERE business_id IN (SELECT id FROM businesses WHERE association_id=${A});`);
  p(`DELETE FROM businesses WHERE association_id=${A};`);
  p(`DELETE FROM users WHERE association_id=${A} AND role='MERCHANT';`);
}

p("");
p(`-- 상인회 관리자`);
p(`INSERT OR IGNORE INTO users (association_id, email, password_hash, salt, name, role)
 VALUES (${A}, ${q(adminEmail)}, ${q(admHash.hash)}, ${q(admHash.salt)}, '상인회 사무국', 'ADMIN');`);

p("");
p(`-- 점포 ${BIZ.length}곳`);
BIZ.forEach((b, i) => {
  const em = ownerEmail(i), h = ownerHashes[i];
  p(`INSERT INTO users (association_id, email, password_hash, salt, name, role)
 VALUES (${A}, ${q(em)}, ${q(h.hash)}, ${q(h.salt)}, ${q(b.owner)}, 'MERCHANT');`);
  const hours = b.off ? `${b.hours} · ${b.off}` : b.hours;
  p(`INSERT INTO businesses (association_id, owner_id, name, slug, category, description, phone, address, hours, lat, lng, status, sns_instagram, source, created_at, updated_at)
 VALUES (${A}, ${U(em)}, ${q(b.name)}, ${q(b.slug)}, ${q(b.cat)}, ${q(b.desc)}, ${q(b.tel)}, ${q(b.addr)}, ${q(hours)}, ${b.lat}, ${b.lng}, 'approved', ${q(b.insta || "")}, 'self', ${q(stamp(-60 + i * 3))}, ${q(stamp(-i))});`);
  b.products.forEach(([n, price, d], j) =>
    p(`INSERT INTO products (business_id, association_id, name, price, description, sort_order) VALUES (${B(b.slug)}, ${A}, ${q(n)}, ${q(price)}, ${q(d)}, ${j});`));
  b.coupons.forEach(([t, terms, valid]) =>
    p(`INSERT INTO coupons (business_id, association_id, title, terms, valid_until) VALUES (${B(b.slug)}, ${A}, ${q(t)}, ${q(terms)}, ${q(ymd(valid))});`));
  b.updates.forEach((u, j) =>
    p(`INSERT INTO updates (business_id, association_id, body, created_at) VALUES (${B(b.slug)}, ${A}, ${q(u)}, ${q(stamp(-(i + j)))});`));
});

p("");
p(`-- 공지 ${NOTICES.length}건`);
NOTICES.forEach((n) =>
  p(`INSERT INTO notices (association_id, title, body, tag, pinned, created_at) VALUES (${A}, ${q(n.t)}, ${q(n.b)}, ${q(n.tag)}, ${n.pin}, ${q(stamp(-n.d))});`));

p("");
p(`-- 행사 ${EVENTS.length}건`);
EVENTS.forEach((e) =>
  p(`INSERT INTO events (association_id, title, event_date, place, description) VALUES (${A}, ${q(e.t)}, ${q(ymd(e.d))}, ${q(e.place)}, ${q(e.desc)});`));

p("");
p(`-- 회원 게시판`);
POSTS.forEach((post) => {
  p(`INSERT INTO posts (association_id, author_id, title, body, pinned, created_at) VALUES (${A}, ${U(ownerEmail(byKey[post.by]))}, ${q(post.t)}, ${q(post.b)}, ${post.pin}, ${q(stamp(-post.d))});`);
  post.comments.forEach(([who, body], j) =>
    p(`INSERT INTO comments (post_id, author_id, body, created_at) VALUES ((SELECT id FROM posts WHERE association_id=${A} AND title=${q(post.t)}), ${U(ownerEmail(byKey[who]))}, ${q(body)}, ${q(stamp(-post.d + (j + 1) * 0.2))});`));
});

p("");
p(`-- 투표`);
POLLS.forEach((pl) =>
  p(`INSERT INTO polls (association_id, title, body, closes_at, closed, created_at) VALUES (${A}, ${q(pl.t)}, ${q(pl.b)}, ${q(ymd(pl.close))}, ${pl.open ? 0 : 1}, ${q(stamp(-7))});`));

console.log(out.join("\n"));
