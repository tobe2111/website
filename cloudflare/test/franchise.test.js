// 프랜차이즈 가맹점 모집 랜딩 + 상담 신청 DB (홈페이지 제작 서비스)
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
async function get(env, j, p, extra = {}) { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j), "user-agent": UA, ...extra } }), env); absorb(j, r); return r; }
// 실제 트래픽은 사람마다 IP 가 다르다. 기본은 요청마다 다른 IP 로 두고,
// 같은 사람의 반복(레이트리밋 검증)을 볼 때만 테스트가 IP 를 고정한다.
let ipSeq = 0;
const nextIp = () => `203.0.113.${(ipSeq++ % 250) + 1}`;
async function post(env, j, p, f, from, extra = {}) {
  const ip = extra["cf-connecting-ip"] || nextIp();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p, { "cf-connecting-ip": ip })).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded", "user-agent": UA, "cf-connecting-ip": ip, ...extra }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
const msgOf = (r) => decodeURIComponent((/[?&]msg=([^&#]*)/.exec(r.headers.get("location") || "") || [])[1] || "");

// 프랜차이즈 본사 하나 + 관리자. 슈퍼는 설치 마법사(/setup)를 넘기기 위해 함께 만든다.
async function seed(env, kind = "franchise") {
  const su = await hashPassword("super1234");
  await D.createUser(env.DB, { email: "s@p.kr", passwordHash: su.hash, salt: su.salt, name: "슈퍼", role: "SUPERADMIN", associationId: null });
  const a = await D.createAssociation(env.DB, { slug: "dapong", name: "다뽕고", kind });
  await D.updateAssociation(env.DB, a.id, {
    name: "다뽕고", tagline: "삼겹살 창업, 결국 쉬워야 합니다", brand_color: "#f2c200",
    phone: "1600-9280", email: "hq@dapong.kr", address: "서울 서초구", logo: "", hero_image: "",
  });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@dapong.kr", passwordHash: ad.hash, salt: ad.salt, name: "본사", role: "ADMIN", associationId: a.id });
  return await D.getAssociationById(env.DB, a.id);
}
const login = async (env, email = "a@dapong.kr", pw = "admin1234") => { const j = jar(); await post(env, j, "/login", { email, password: pw }); return j; };
const applyForm = { name: "김창업", phone: "010-1234-5678", region: "수원 영통", budget: "1억원 ~ 2억원", funnel: "네이버 검색", message: "상권 분석 받고 싶습니다", agree: "1" };

test("프랜차이즈 홈: 상인회 홈이 아니라 가맹 모집 랜딩이 나온다", async () => {
  const env = makeEnv();
  await seed(env);
  const html = await (await get(env, jar(), "/t/dapong")).text();
  // 기본 구성의 핵심 블록이 모두 서 있어야 한다 (관리자가 아무것도 안 채워도 팔리는 한 장)
  assert.match(html, /fr-hero/);
  assert.match(html, /가맹 상담 신청/);
  assert.match(html, /가맹 절차/);
  assert.match(html, /창업의 벽을 낮추는/);
  assert.match(html, /id="apply"/);
  assert.match(html, /action="\/t\/dapong\/lead"/);
  // 고정 하단 바 — 대표 전화가 있으면 전화 버튼도 함께
  assert.match(html, /fr-sticky/);
  assert.match(html, /1600-9280/);
  // 상인회 홈 조각은 한 줄도 섞이지 않는다
  assert.doesNotMatch(html, /동네 새소식/);
  assert.doesNotMatch(html, /입점 신청/);
  // 상단 메뉴도 모집형 (업종 중립적인 라벨 + 업종 문구가 섞인 항목)
  assert.match(html, /가맹 절차/);
  assert.match(html, /매장 안내/);
  assert.doesNotMatch(html, /회원 게시판/);
});

test("상담 신청: 저장 + 관리자 알림 + 성공 안내", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const r = await post(env, jar(), "/t/dapong/lead", applyForm, "/t/dapong");
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /#apply$/);
  assert.match(msgOf(r), /접수/);
  const leads = await D.listLeads(env.DB, a.id);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].name, "김창업");
  assert.equal(leads[0].phone, "010-1234-5678");
  assert.equal(leads[0].region, "수원 영통");
  assert.equal(leads[0].funnel, "네이버 검색");
  assert.equal(leads[0].status, "new");
  assert.equal(leads[0].agree_marketing, 0);
  const notifs = await D.listNotifications(env.DB, a.id, 5);
  assert.match(notifs[0].message, /가맹 상담/);
  assert.match(notifs[0].link, /\/admin\/leads$/);
});

test("상담 신청 검증: 동의·필수값·허니팟·중복 제출", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const bad = async (f) => msgOf(await post(env, jar(), "/t/dapong/lead", f, "/t/dapong"));
  assert.match(await bad({ ...applyForm, agree: "" }), /동의/);
  assert.match(await bad({ ...applyForm, name: "" }), /성함/);
  assert.match(await bad({ ...applyForm, phone: "" }), /성함|연락처/);
  assert.match(await bad({ ...applyForm, phone: "123" }), /연락처/);
  assert.equal((await D.listLeads(env.DB, a.id)).length, 0);
  // 허니팟: 봇에게는 성공처럼 보이되 저장하지 않는다
  const hp = await post(env, jar(), "/t/dapong/lead", { ...applyForm, website: "http://spam" }, "/t/dapong");
  assert.match(msgOf(hp), /접수/);
  assert.equal((await D.listLeads(env.DB, a.id)).length, 0);
  // 정상 1건 → 같은 번호로 즉시 재전송하면 새 건이 생기지 않는다 (하이픈을 빼고 다시 넣어도 같은 번호)
  await post(env, jar(), "/t/dapong/lead", applyForm, "/t/dapong");
  await post(env, jar(), "/t/dapong/lead", { ...applyForm, message: "다시 보냄" }, "/t/dapong");
  await post(env, jar(), "/t/dapong/lead", { ...applyForm, phone: "01012345678" }, "/t/dapong");
  assert.equal((await D.listLeads(env.DB, a.id)).length, 1);
});

test("프랜차이즈가 아닌 조직에서는 상담 신청을 받지 않는다", async () => {
  const env = makeEnv();
  const a = await seed(env, "merchant");
  // 상인회 홈에는 POST 폼이 없어 CSRF 토큰을 얻을 수 없다 — 토큰은 로그인 화면에서 받아 온다
  const r = await post(env, jar(), "/t/dapong/lead", applyForm, "/login");
  assert.match(msgOf(r), /받지 않습니다/);
  assert.equal((await D.listLeads(env.DB, a.id)).length, 0);
});

test("상담 DB 콘솔: 목록·상태·메모·CSV·삭제", async () => {
  const env = makeEnv();
  const a = await seed(env);
  await post(env, jar(), "/t/dapong/lead", applyForm, "/t/dapong");
  await post(env, jar(), "/t/dapong/lead", { ...applyForm, name: "이점주", phone: "010-2222-3333", funnel: "지인 소개" }, "/t/dapong");
  const j = await login(env);
  let html = await (await get(env, j, "/t/dapong/admin/leads")).text();
  assert.match(html, /김창업/);
  assert.match(html, /010-2222-3333/);
  assert.match(html, /지인 소개/);
  const id = (await D.listLeads(env.DB, a.id)).find((l) => l.name === "김창업").id;
  await post(env, j, `/t/dapong/admin/leads/${id}/status`, { status: "contract" }, "/t/dapong/admin/leads");
  assert.equal((await D.getLead(env.DB, id, a.id)).status, "contract");
  assert.match(msgOf(await post(env, j, `/t/dapong/admin/leads/${id}/status`, { status: "존재하지않음" }, "/t/dapong/admin/leads")), /잘못된 상태/);
  await post(env, j, `/t/dapong/admin/leads/${id}/memo`, { memo: "3/2 통화 완료" }, "/t/dapong/admin/leads");
  assert.equal((await D.getLead(env.DB, id, a.id)).memo, "3/2 통화 완료");
  // 상태 필터
  html = await (await get(env, j, "/t/dapong/admin/leads?status=new")).text();
  assert.doesNotMatch(html, /김창업/);
  // CSV — 첫 줄은 머리글, 개인정보가 그대로 들어간다
  const csv = await (await get(env, j, "/t/dapong/admin/leads.csv")).text();
  assert.match(csv, /성함,연락처/);
  assert.match(csv, /이점주/);
  // 삭제하면 정말 사라진다 (개인정보라 흔적을 남기지 않는다)
  await post(env, j, `/t/dapong/admin/leads/${id}/delete`, {}, "/t/dapong/admin/leads");
  assert.equal((await D.listLeads(env.DB, a.id)).length, 1);
});

test("상담 DB 는 남의 조직에서 열리지 않는다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  await post(env, jar(), "/t/dapong/lead", applyForm, "/t/dapong");
  const id = (await D.listLeads(env.DB, a.id))[0].id;
  // 다른 프랜차이즈 본사의 관리자
  const other = await D.createAssociation(env.DB, { slug: "other", name: "타사", kind: "franchise" });
  const p = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "b@other.kr", passwordHash: p.hash, salt: p.salt, name: "타사", role: "ADMIN", associationId: other.id });
  const j2 = await login(env, "b@other.kr");
  assert.equal((await get(env, j2, "/t/dapong/admin/leads")).status, 403);
  // 자기 조직 경로로 남의 건 id 를 찔러도 잡히지 않는다
  assert.match(msgOf(await post(env, j2, `/t/other/admin/leads/${id}/status`, { status: "drop" }, "/t/other/admin/landing")), /찾을 수 없/);
  assert.equal((await D.getLead(env.DB, id, a.id)).status, "new");
  // 로그인하지 않은 방문자는 목록 자체를 못 본다
  assert.equal((await get(env, jar(), "/t/dapong/admin/leads")).status, 303);
});

test("랜딩 편집: 문구 저장 → 공개 화면 반영, 초기화하면 되돌아간다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = await login(env);
  const editor = await (await get(env, j, "/t/dapong/admin/landing")).text();
  assert.match(editor, /랜딩페이지 편집/);
  assert.match(editor, /상담 신청 폼/); // 업종 중립 라벨 (학원·병원도 같은 편집기를 쓴다)
  // 문구를 바꾸고, 가맹 절차 섹션은 스위치를 끈다 (en_2 를 보내지 않으면 꺼진 것)
  await post(env, j, "/t/dapong/admin/landing", {
    order: "0,1,2",
    ty_0: "hero", en_0: "1", f_0_title: "삼겹살 창업의 정답", f_0_highlight: "정답", f_0_ctaLabel: "지금 상담받기",
    ty_1: "lead", en_1: "1", f_1_title: "가맹 상담 신청", f_1_buttonLabel: "신청서 보내기", f_1_budgets: "5천 이하\n5천~1억",
    ty_2: "process", f_2_title: "가맹 절차",
  }, "/t/dapong/admin/landing");
  // 저장은 초안까지만 — 아직 손님 화면은 그대로다
  assert.doesNotMatch(await (await get(env, jar(), "/t/dapong")).text(), /삼겹살 창업의/);
  await post(env, j, "/t/dapong/admin/landing/publish", {}, "/t/dapong/admin/landing");
  const html = await (await get(env, jar(), "/t/dapong")).text();
  assert.match(html, /삼겹살 창업의/);
  assert.match(html, /class="fr-hl">정답</); // 강조 단어만 색이 바뀐다
  assert.match(html, /지금 상담받기/);
  assert.match(html, /신청서 보내기/);
  assert.match(html, /5천~1억/);
  assert.doesNotMatch(html, /fr-step-grid/); // 끈 섹션(가맹 절차)은 본문에서 사라진다
  await post(env, j, "/t/dapong/admin/landing/reset", {}, "/t/dapong/admin/landing");
  assert.equal((await D.getAssociationById(env.DB, a.id)).landing_layout, null);
  assert.match(await (await get(env, jar(), "/t/dapong")).text(), /fr-step-grid/);
});

test("가맹 비용 표: 가려 두면 금액이 HTML 에도 실리지 않는다", async () => {
  const env = makeEnv();
  await seed(env);
  const j = await login(env);
  const save = async (locked) => {
    await post(env, j, "/t/dapong/admin/landing", {
      order: "0", ty_0: "cost", en_0: "1", f_0_title: "가맹 비용",
      f_0_items: "가맹비 | 1,000만원 | 부가세 별도", ...(locked ? { f_0_locked: "1" } : {}),
    }, "/t/dapong/admin/landing");
    await post(env, j, "/t/dapong/admin/landing/publish", {}, "/t/dapong/admin/landing");
  };
  await save(true);
  let html = await (await get(env, jar(), "/t/dapong")).text();
  assert.match(html, /가맹비/);
  assert.doesNotMatch(html, /1,000만원/); // 소스를 열어도 안 보여야 가린 것이다
  await save(false);
  html = await (await get(env, jar(), "/t/dapong")).text();
  assert.match(html, /1,000만원/);
});

test("랜딩 섹션은 HTML 을 심을 수 없고, 이미지 주소는 안전한 것만 통과한다", async () => {
  const env = makeEnv();
  await seed(env);
  const j = await login(env);
  await post(env, j, "/t/dapong/admin/landing", {
    order: "0,1", ty_0: "hero", en_0: "1", f_0_title: "<script>alert(1)</script>", f_0_image: "javascript:alert(1)",
    ty_1: "why", en_1: "1", f_1_title: "소개", f_1_image: "https://cdn.example.com/a.jpg",
  }, "/t/dapong/admin/landing");
  await post(env, j, "/t/dapong/admin/landing/publish", {}, "/t/dapong/admin/landing");
  const html = await (await get(env, jar(), "/t/dapong")).text();
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /javascript:alert/);
  assert.match(html, /https:\/\/cdn\.example\.com\/a\.jpg/);
});

test("프랜차이즈 조직에는 셀프 점포 가입이 없다", async () => {
  const env = makeEnv();
  await seed(env);
  assert.equal((await get(env, jar(), "/t/dapong/register")).status, 404);
  assert.match(msgOf(await post(env, jar(), "/t/dapong/register",
    { name: "몰래", email: "x@x.kr", password: "12345678", business_name: "가짜점", agree: "1" }, "/t/dapong")), /받지 않습니다/);
});

test("홈페이지 제작 서비스 소개(/homepage): 상인회·전자계약 간판이 걸리지 않는다", async () => {
  const env = makeEnv();
  await seed(env);
  const r = await get(env, jar(), "/homepage");
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /가맹점 모집 홈페이지/);
  assert.match(html, /상담 신청이 쌓이는 방식/);
  assert.match(html, /제작 문의/);
  assert.doesNotMatch(html, /상인회 플랫폼/);
});

test("슈퍼 콘솔: 프랜차이즈 유형으로 만들고, 유형을 바꿔도 데이터는 남는다", async () => {
  const env = makeEnv();
  const a = await seed(env, "merchant");
  const j = await login(env, "s@p.kr", "super1234");
  await post(env, j, "/super/association", {
    name: "육쌈냉면", kind: "franchise", admin_email: "hq@yuk.kr", admin_password: "admin1234", admin_name: "본사",
  }, "/super");
  const made = (await D.listAllAssociations(env.DB)).find((x) => x.name === "육쌈냉면");
  assert.equal(made.kind, "franchise");
  assert.match(await (await get(env, jar(), `/t/${made.slug}`)).text(), /fr-hero/);
  // 유형 전환 — 상인회로 만든 조직을 프랜차이즈로
  await post(env, j, `/super/association/${a.id}/kind`, { kind: "franchise" }, "/super");
  assert.equal((await D.getAssociationById(env.DB, a.id)).kind, "franchise");
  // 아는 유형이 아니면 상인회로 떨어진다 (임의 문자열이 들어와도 화면이 깨지지 않는다)
  await post(env, j, `/super/association/${a.id}/kind`, { kind: "haxx" }, "/super");
  assert.equal((await D.getAssociationById(env.DB, a.id)).kind, "merchant");
});

test("옛 배포 DB 도 자동 마이그레이션으로 상담 DB 를 갖춘다", async () => {
  const env = makeEnv({ bare: true });
  await worker.fetch(new Request(B + "/setup"), env); // 첫 요청에서 스키마 생성
  const cols = env.DB._db.prepare("PRAGMA table_info(associations)").all();
  assert.ok(cols.some((c) => c.name === "landing_layout"));
  const t = env.DB._db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='leads'").get();
  assert.ok(t);
});

// ===== 성과 계측 · 사진 · 사본 · 발행 · 파기 =====

test("광고 출처: 주소의 utm 이 폼에 심기고 신청에 그대로 저장된다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const html = await (await get(env, jar(), "/t/dapong?utm_source=naver&utm_medium=cpc&utm_campaign=%EB%B4%84%EB%AA%A8%EC%A7%91")).text();
  assert.match(html, /name="utm_source" value="naver"/);
  assert.match(html, /name="utm_campaign" value="봄모집"/);
  await post(env, jar(), "/t/dapong/lead",
    { ...applyForm, utm_source: "naver", utm_medium: "cpc", utm_campaign: "봄모집", referrer: "https://search.naver.com/x" }, "/t/dapong");
  const l = (await D.listLeads(env.DB, a.id))[0];
  assert.equal(l.utm_source, "naver");
  assert.equal(l.utm_medium, "cpc");
  assert.equal(l.utm_campaign, "봄모집");
  assert.match(l.referrer, /naver\.com/);
  // 상담 DB 화면과 CSV 에도 출처가 나온다
  const j = await login(env);
  assert.match(await (await get(env, j, "/t/dapong/admin/leads")).text(), /naver\/cpc/);
  assert.match(await (await get(env, j, "/t/dapong/admin/leads.csv")).text(), /광고출처/);
});

test("전환율: 사람의 방문만 세고, 봇·연타·미리보기는 세지 않는다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  // 서로 다른 방문자 4명 (같은 IP 연타는 아래에서 따로 확인)
  for (let i = 0; i < 4; i++) await get(env, jar(), "/t/dapong", { "cf-connecting-ip": `1.2.3.${i}` });
  assert.equal(await D.landingViewsSince(env.DB, a.id, 30), 4);
  // 같은 사람이 새로고침을 연타해도 한 번 (D1 쓰기 폭주·전환율 부풀리기 차단)
  for (let i = 0; i < 5; i++) await get(env, jar(), "/t/dapong", { "cf-connecting-ip": "9.9.9.9" });
  assert.equal(await D.landingViewsSince(env.DB, a.id, 30), 5);
  // 크롤러는 손님이 아니다 — 세면 분모만 부풀어 광고 판단이 틀어진다
  await get(env, jar(), "/t/dapong", { "cf-connecting-ip": "8.8.8.8", "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" });
  assert.equal(await D.landingViewsSince(env.DB, a.id, 30), 5);
  await post(env, jar(), "/t/dapong/lead", applyForm, "/t/dapong");
  const j = await login(env);
  const html = await (await get(env, j, "/t/dapong/admin/leads")).text();
  assert.match(html, /30일 전환율/);
  assert.match(html, /방문 \d+ · 신청 1/);
  // 미리보기는 관리자 자신의 조회라 방문 수에 넣지 않는다
  const before = await D.landingViewsSince(env.DB, a.id, 30);
  await get(env, j, "/t/dapong/admin/landing/preview");
  assert.equal(await D.landingViewsSince(env.DB, a.id, 30), before);
});

test("초안·발행: 저장은 초안까지, 발행해야 손님에게 보인다 (미리보기·되돌리기 포함)", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = await login(env);
  const save = (title) => post(env, j, "/t/dapong/admin/landing",
    { order: "0", ty_0: "hero", en_0: "1", f_0_title: title }, "/t/dapong/admin/landing");
  await save("초안 제목");
  assert.equal((await D.getAssociationById(env.DB, a.id)).landing_layout, null); // 발행본은 아직 비어 있다
  assert.doesNotMatch(await (await get(env, jar(), "/t/dapong")).text(), /초안 제목/);
  // 관리자는 미리보기로 확인할 수 있다
  const pv = await (await get(env, j, "/t/dapong/admin/landing/preview")).text();
  assert.match(pv, /초안 제목/);
  assert.match(pv, /발행되지 않은 초안/);
  // 편집 화면은 발행 대기 상태를 알려준다
  assert.match(await (await get(env, j, "/t/dapong/admin/landing")).text(), /발행되지 않은 수정본 있음/);
  await post(env, j, "/t/dapong/admin/landing/publish", {}, "/t/dapong/admin/landing");
  assert.match(await (await get(env, jar(), "/t/dapong")).text(), /초안 제목/);
  // 새 초안을 쓰다가 버리면 발행본으로 돌아간다
  await save("버릴 제목");
  await post(env, j, "/t/dapong/admin/landing/discard", {}, "/t/dapong/admin/landing");
  assert.equal((await D.getAssociationById(env.DB, a.id)).landing_draft, null);
  assert.match(await (await get(env, jar(), "/t/dapong")).text(), /초안 제목/);
});

test("캠페인 사본: /l/주소 로 열리고, 신청·방문이 사본별로 집계된다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = await login(env);
  await post(env, j, "/t/dapong/admin/landing", { order: "0", ty_0: "hero", en_0: "1", f_0_title: "기본 문구" }, "/t/dapong/admin/landing");
  await post(env, j, "/t/dapong/admin/landing/publish", {}, "/t/dapong/admin/landing");
  await post(env, j, "/t/dapong/admin/landing/variant", { name: "인스타 광고용", slug: "insta" }, "/t/dapong/admin/landing");
  // 사본만 다른 문구로 바꿔 발행 — 기본 랜딩은 그대로여야 한다
  await post(env, j, "/t/dapong/admin/landing?v=insta",
    { order: "0,1", ty_0: "hero", en_0: "1", f_0_title: "인스타 전용 문구", ty_1: "lead", en_1: "1", f_1_title: "상담 신청" }, "/t/dapong/admin/landing?v=insta");
  await post(env, j, "/t/dapong/admin/landing/publish?v=insta", {}, "/t/dapong/admin/landing?v=insta");
  const vHtml = await (await get(env, jar(), "/t/dapong/l/insta")).text();
  assert.match(vHtml, /인스타 전용 문구/);
  assert.match(await (await get(env, jar(), "/t/dapong")).text(), /기본 문구/);
  assert.equal((await get(env, jar(), "/t/dapong/l/none")).status, 404);
  // 사본에서 낸 신청은 사본으로 기록되고, 신청 후에도 그 사본으로 돌아온다
  const r = await post(env, jar(), "/t/dapong/lead", { ...applyForm, variant: "insta" }, "/t/dapong/l/insta");
  assert.match(r.headers.get("location"), /\/l\/insta\?/);
  assert.equal((await D.listLeads(env.DB, a.id))[0].variant, "insta");
  assert.match(await (await get(env, j, "/t/dapong/admin/leads")).text(), /랜딩별 성과/);
  // 사본을 지워도 이미 받은 신청은 남는다
  await post(env, j, "/t/dapong/admin/landing/variant/insta/delete", {}, "/t/dapong/admin/landing");
  assert.equal((await D.listLeads(env.DB, a.id)).length, 1);
  assert.equal((await get(env, jar(), "/t/dapong/l/insta")).status, 404);
});

test("사진 보관함: 올린 사진이 목록에 남고 지우면 R2 에서도 사라진다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = await login(env);
  // 1x1 PNG
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd4000000004945", "hex");
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/dapong/admin/landing")).text()) || [])[1];
  const fd = new FormData();
  fd.set("_csrf", t);
  fd.append("images", new File([png], "menu.png", { type: "image/png" }));
  const up = await worker.fetch(new Request(B + "/t/dapong/admin/landing/asset", { method: "POST", headers: { cookie: ch(j) }, body: fd }), env);
  assert.equal(up.status, 303);
  const assets = await D.listLandingAssets(env.DB, a.id);
  assert.equal(assets.length, 1);
  assert.ok(env.MEDIA._store.has(assets[0].filename));
  assert.match(await (await get(env, j, "/t/dapong/admin/landing")).text(), /asset-card/);
  await post(env, j, `/t/dapong/admin/landing/asset/${assets[0].id}/delete`, {}, "/t/dapong/admin/landing");
  assert.equal((await D.listLandingAssets(env.DB, a.id)).length, 0);
  assert.ok(!env.MEDIA._store.has(assets[0].filename));
});

test("보관 기간: 처리 끝난 건만 자동 파기되고 진행 중인 건은 남는다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = await login(env);
  await post(env, j, "/t/dapong/admin/landing/retention", { days: "30" }, "/t/dapong/admin/landing");
  assert.equal(await D.getSetting(env.DB, `lead_retention:${a.id}`), "30");
  const mk = async (name, status) => {
    const l = await D.createLead(env.DB, { associationId: a.id, name, phone: "010-0000-000" + name.length });
    env.DB._db.prepare("UPDATE leads SET status=?, created_at=datetime('now','-100 days'), updated_at=datetime('now','-100 days') WHERE id=?").run(status, l.id);
    return l.id;
  };
  await mk("계약자", "contract");
  await mk("보류자", "drop");
  const keep = await mk("진행중", "contacted");
  const { runLeadPurge } = await import("../src/scheduled.js");
  const r = await runLeadPurge(env);
  assert.equal(r.deleted, 2);
  const left = await D.listLeads(env.DB, a.id);
  assert.equal(left.length, 1);
  assert.equal(left[0].id, keep);
});

test("하위 페이지에서도 상담으로 가는 길이 열려 있다 (업무 화면은 예외)", async () => {
  const env = makeEnv();
  await seed(env);
  for (const p of ["/t/dapong/businesses", "/t/dapong/notices"]) {
    const html = await (await get(env, jar(), p)).text();
    assert.match(html, /fr-sticky/, `${p} 에 고정 바가 있어야`);
    assert.match(html, /href="\/t\/dapong\/#apply"/, `${p} 에서 신청으로 갈 수 있어야`);
  }
  // 관리자 콘솔은 손님 화면이 아니다 — 고정 바가 표를 가리면 안 된다
  const j = await login(env);
  for (const p of ["/t/dapong/admin/leads", "/t/dapong/admin/landing", "/t/dapong/admin"])
    assert.doesNotMatch(await (await get(env, j, p)).text(), /fr-sticky/, `${p} 에는 고정 바가 없어야`);
});

test("공유 미리보기: 첫 화면 사진이 og:image 로 나간다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = await login(env);
  await post(env, j, "/t/dapong/admin/landing",
    { order: "0", ty_0: "hero", en_0: "1", f_0_title: "제목", f_0_image: "https://cdn.example.com/hero.jpg" }, "/t/dapong/admin/landing");
  await post(env, j, "/t/dapong/admin/landing/publish", {}, "/t/dapong/admin/landing");
  assert.match(await (await get(env, jar(), "/t/dapong")).text(), /og:image" content="https:\/\/cdn\.example\.com\/hero\.jpg"/);
});

test("상담 DB: 50건 넘으면 쪽수로 나누고, 계약서로 바로 이어진다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  for (let i = 0; i < 55; i++) await D.createLead(env.DB, { associationId: a.id, name: `신청자${i}`, phone: `010-1111-${String(1000 + i)}` });
  const j = await login(env);
  const p1 = await (await get(env, j, "/t/dapong/admin/leads")).text();
  assert.match(p1, /class="pager"/);
  const p2 = await (await get(env, j, "/t/dapong/admin/leads?page=2")).text();
  assert.match(p2, /신청자0</);       // 오래된 건이 2쪽에
  assert.doesNotMatch(p1, /신청자0</);
  // 상담 건에서 계약서 만들기 → 서식 화면이 그 신청자를 물고 간다
  const id = (await D.listLeads(env.DB, a.id))[0].id;
  const tpl = await (await get(env, j, `/t/dapong/admin/templates?lead=${id}`)).text();
  assert.match(tpl, /상담 신청자 <b>신청자54<\/b>/);
  assert.match(tpl, new RegExp(`documents/new\\?tpl=[^"]*&lead=${id}`));
});

test("주간 백업에 상담 DB 가 포함된다 (이 제품에서 가장 잃으면 안 되는 자산)", async () => {
  const env = makeEnv();
  const a = await seed(env);
  await D.createLead(env.DB, { associationId: a.id, name: "백업될 사람", phone: "010-9999-8888" });
  const { runBackup, decryptBackup } = await import("../src/scheduled.js");
  const r = await runBackup(env);
  assert.ok(r.key, "백업 파일이 만들어져야");
  const obj = await env.MEDIA.get(r.key);
  const dump = JSON.parse(await decryptBackup(env.SESSION_SECRET, new Uint8Array(await obj.arrayBuffer())));
  assert.equal(dump.tables.leads.length, 1);
  assert.equal(dump.tables.leads[0].name, "백업될 사람");
  for (const t of ["landing_variants", "landing_views", "landing_assets"])
    assert.ok(Array.isArray(dump.tables[t]), `${t} 도 백업에 있어야`);
});

// ===== 보안 검토에서 나온 결함들 (재발 방지) =====

test("공개 폼으로 남의 번호에 알림톡을 무한히 쏠 수 없다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  // 같은 IP 에서 반복 제출하면 막힌다 (봇 방지 시크릿이 없는 배포에서도 유일한 방벽이 남아야)
  let blocked = 0;
  for (let i = 0; i < 26; i++) {
    const r = await post(env, jar(), "/t/dapong/lead",
      { ...applyForm, phone: `010-5555-${String(1000 + i)}` }, "/t/dapong", { "cf-connecting-ip": "6.6.6.6" });
    if (/잠시 후/.test(msgOf(r))) blocked++;
  }
  assert.ok(blocked > 0, "반복 제출은 어느 시점에 막혀야");
  // 실제 사람 몫(모바일 CGNAT)은 넉넉히 통과해야 한다
  assert.ok((await D.listLeads(env.DB, a.id)).length >= 15, "정상 신청까지 막으면 안 된다");
});

test("상담 신청을 지우면 알림함·감사기록에도 이름·번호가 남지 않는다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  await post(env, jar(), "/t/dapong/lead", applyForm, "/t/dapong");
  // 알림함은 파기 대상이 아니다 — 여기에 개인정보를 적으면 '지웠다'는 약속이 깨진다
  const notifs = await D.listNotifications(env.DB, a.id, 5);
  const notifText = notifs.map((n) => n.message).join(" ");
  assert.doesNotMatch(notifText, /김창업/);
  assert.doesNotMatch(notifText, /010-1234-5678/);
  assert.match(notifText, /가맹 상담/); // 무슨 일이 있었는지는 알 수 있어야
  const j = await login(env);
  const id = (await D.listLeads(env.DB, a.id))[0].id;
  await post(env, j, `/t/dapong/admin/leads/${id}/status`, { status: "contract" }, "/t/dapong/admin/leads");
  await post(env, j, `/t/dapong/admin/leads/${id}/delete`, {}, "/t/dapong/admin/leads");
  const audit = (await D.listAudit(env.DB, a.id, 20)).map((x) => `${x.action} ${x.detail}`).join(" ");
  assert.doesNotMatch(audit, /김창업/, "감사 로그에 이름이 남으면 안 된다");
  assert.doesNotMatch(audit, /010-1234-5678/);
  assert.match(audit, /상담상태변경|상담신청삭제/, "무엇을 했는지는 남아야");
});

test("없는 캠페인 사본 이름을 지어내 보내도 성과표를 어지럽히지 못한다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  await post(env, jar(), "/t/dapong/lead", { ...applyForm, variant: "지어낸사본" }, "/t/dapong");
  assert.equal((await D.listLeads(env.DB, a.id))[0].variant, "", "실제 있는 사본만 기록한다");
});
