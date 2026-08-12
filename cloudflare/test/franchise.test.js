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
async function get(env, j, p) { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
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
  // 상단 메뉴도 프랜차이즈용
  assert.match(html, /브랜드 소개/);
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
  assert.match(editor, /가맹 상담 신청 폼/);
  // 문구를 바꾸고, 가맹 절차 섹션은 스위치를 끈다 (en_2 를 보내지 않으면 꺼진 것)
  await post(env, j, "/t/dapong/admin/landing", {
    order: "0,1,2",
    ty_0: "hero", en_0: "1", f_0_title: "삼겹살 창업의 정답", f_0_highlight: "정답", f_0_ctaLabel: "지금 상담받기",
    ty_1: "lead", en_1: "1", f_1_title: "가맹 상담 신청", f_1_buttonLabel: "신청서 보내기", f_1_budgets: "5천 이하\n5천~1억",
    ty_2: "process", f_2_title: "가맹 절차",
  }, "/t/dapong/admin/landing");
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
  const save = (locked) => post(env, j, "/t/dapong/admin/landing", {
    order: "0", ty_0: "cost", en_0: "1", f_0_title: "가맹 비용",
    f_0_items: "가맹비 | 1,000만원 | 부가세 별도", ...(locked ? { f_0_locked: "1" } : {}),
  }, "/t/dapong/admin/landing");
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
