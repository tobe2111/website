// 슈퍼 콘솔 운영 기능 — 상인회 삭제 · 관리자 비밀번호 재발급 · 영업 파이프라인 · 마지막 활동일
// 실행: node --experimental-sqlite --test cloudflare/test/*.test.js
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const BASE = "http://localhost";
let env, cookie, token;

const req = (method, path, { cookie = "", body = null } = {}) => {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  const init = { method, headers };
  if (body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    headers.origin = BASE;
    init.body = new URLSearchParams(body);
  }
  return worker.fetch(new Request(BASE + path, init), env, { waitUntil() {}, passThroughOnException() {} });
};
const db = () => env.DB;

async function login(email, password) {
  const g = await req("GET", "/login");
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const r = await req("POST", "/login", { cookie: seed, body: { _csrf: tk, email, password } });
  const loc = r.headers.get("location") || "";
  // 로그인 실패도 303 으로 돌아오므로(/login?err=1) 성공 여부는 목적지로 판별합니다.
  return { status: r.status, ok: r.status === 303 && !loc.startsWith("/login"), loc, tk,
    jar: [seed, ...(r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ") };
}

before(async () => {
  env = makeEnv();
  const pw = await hashPassword("super1234");
  await D.createUser(db(), { email: "super@platform.kr", passwordHash: pw.hash, salt: pw.salt, name: "운영자", role: "SUPERADMIN", associationId: null });
  const l = await login("super@platform.kr", "super1234");
  assert.ok(l.ok, "슈퍼 로그인");
  cookie = l.jar; token = l.tk;
});

// 테스트용 상인회 한 곳을 콘텐츠와 함께 만듭니다.
async function makeAssoc(slug) {
  const a = await D.createAssociation(db(), { slug, name: slug });
  const pw = await hashPassword("admin1234");
  const admin = await D.createUser(db(), { email: `admin-${slug}@demo.kr`, passwordHash: pw.hash, salt: pw.salt, name: `${slug} 관리자`, role: "ADMIN", associationId: a.id });
  const mp = await hashPassword("merch1234");
  const owner = await D.createUser(db(), { email: `owner-${slug}@demo.kr`, passwordHash: mp.hash, salt: mp.salt, name: "사장님", role: "MERCHANT", associationId: a.id });
  await db().prepare(`INSERT INTO businesses (association_id, owner_id, name, slug, status) VALUES (?,?,?,?,'approved')`).bind(a.id, owner.id, "가게", "shop").run();
  await db().prepare(`INSERT INTO notices (association_id, title, body) VALUES (?,?,?)`).bind(a.id, "공지", "본문").run();
  return { a, admin, owner };
}

// ── 상인회 삭제
test("주소를 잘못 입력하면 삭제되지 않는다", async () => {
  const { a } = await makeAssoc("del-guard");
  const r = await req("POST", `/super/association/${a.id}/delete`, { cookie, body: { _csrf: token, confirm_slug: "틀린주소" } });
  assert.equal(r.status, 303);
  assert.ok(await D.getAssociationById(db(), a.id), "그대로 남아 있어야 함");
});

test("주소를 정확히 입력하면 상인회와 딸린 데이터가 모두 지워진다", async () => {
  const { a, admin, owner } = await makeAssoc("del-go");
  const keep = await makeAssoc("del-keep");
  const r = await req("POST", `/super/association/${a.id}/delete`, { cookie, body: { _csrf: token, confirm_slug: "del-go" } });
  assert.equal(r.status, 303);

  assert.equal(await D.getAssociationById(db(), a.id), null, "상인회가 사라져야 함");
  const left = db()._db.prepare(`SELECT
    (SELECT COUNT(*) FROM businesses WHERE association_id=?) b,
    (SELECT COUNT(*) FROM notices WHERE association_id=?) n,
    (SELECT COUNT(*) FROM users WHERE association_id=?) u`).get(a.id, a.id, a.id);
  assert.deepEqual({ ...left }, { b: 0, n: 0, u: 0 }, "점포·공지·계정이 남으면 안 됨");
  assert.equal(db()._db.prepare(`SELECT COUNT(*) n FROM users WHERE id IN (?,?)`).get(admin.id, owner.id).n, 0);

  const other = db()._db.prepare(`SELECT COUNT(*) n FROM businesses WHERE association_id=?`).get(keep.a.id);
  assert.equal(other.n, 1, "다른 상인회는 그대로여야 함");
  assert.equal((await req("GET", "/t/del-go")).status, 404, "공개 주소도 사라져야 함");
});

test("삭제는 슈퍼 관리자만 할 수 있다", async () => {
  const { a } = await makeAssoc("del-auth");
  const r = await req("POST", `/super/association/${a.id}/delete`, { body: { _csrf: token, confirm_slug: "del-auth" } });
  assert.notEqual(r.status, 303, "비로그인 요청이 통과하면 안 됨");
  assert.ok(await D.getAssociationById(db(), a.id));
});

// ── 관리자 비밀번호 재발급
test("관리자 임시 비밀번호를 발급하면 그 비밀번호로 로그인된다", async () => {
  const { admin } = await makeAssoc("pw-reset");
  const r = await req("POST", `/super/admin/${admin.id}/reset-password`, { cookie, body: { _csrf: token } });
  assert.equal(r.status, 303);
  const temp = (new URL(r.headers.get("location"), BASE).searchParams.get("msg") || "").match(/임시 비밀번호: (\w+)/)?.[1];
  assert.ok(temp, "임시 비밀번호가 화면에 안내돼야 함");

  assert.equal((await login(admin.email, "admin1234")).ok, false, "옛 비밀번호는 더 이상 안 통해야 함");
  assert.ok((await login(admin.email, temp)).ok, "새 임시 비밀번호로 로그인");
});

test("사장님 계정은 이 경로로 재발급되지 않는다", async () => {
  const { owner } = await makeAssoc("pw-merchant");
  const r = await req("POST", `/super/admin/${owner.id}/reset-password`, { cookie, body: { _csrf: token } });
  assert.equal(r.status, 303);
  assert.ok((await login(owner.email, "merch1234")).ok, "사장님 비밀번호는 그대로여야 함");
});

// ── 영업 파이프라인
test("직접 발굴한 상인회를 영업 목록에 올린다", async () => {
  const r = await req("POST", "/super/prospect", { cookie,
    body: { _csrf: token, assoc_name: "방배동 먹자골목 상인회", contact_name: "김회장", contact_phone: "010-1234-5678", message: "구청 소개로 연결" } });
  assert.equal(r.status, 303);
  const html = await (await req("GET", "/super", { cookie })).text();
  assert.match(html, /방배동 먹자골목 상인회/);
  assert.match(html, /직접 발굴/, "신청 건과 구분돼야 함");
  assert.match(html, /구청 소개로 연결/);
});

test("단계와 다음 연락일을 바꾸면 화면에 반영된다", async () => {
  const app = await D.createProspect(db(), { assocName: "단계테스트 상인회" });
  const r = await req("POST", `/super/application/${app.id}/stage`, { cookie, body: { _csrf: token, stage: "meeting", next_action_at: "2030-01-15" } });
  assert.equal(r.status, 303);
  const row = await D.getApplication(db(), app.id);
  assert.equal(row.stage, "meeting");
  assert.equal(row.next_action_at, "2030-01-15");
  const html = await (await req("GET", "/super", { cookie })).text();
  assert.match(html, /다음 연락 2030-01-15/);
});

test("잘못된 단계 값은 거부한다", async () => {
  const app = await D.createProspect(db(), { assocName: "잘못된단계" });
  await req("POST", `/super/application/${app.id}/stage`, { cookie, body: { _csrf: token, stage: "hacked" } });
  assert.equal((await D.getApplication(db(), app.id)).stage, "new", "단계가 바뀌면 안 됨");
});

test("연락 기록을 남기면 그 자리에 시간순으로 쌓인다", async () => {
  const app = await D.createProspect(db(), { assocName: "기록테스트 상인회" });
  await req("POST", `/super/application/${app.id}/note`, { cookie, body: { _csrf: token, body: "회장님 통화 — 다음 주 화요일 방문 약속" } });
  await req("POST", `/super/application/${app.id}/note`, { cookie, body: { _csrf: token, body: "총무님께 견적 전달" } });
  const html = await (await req("GET", "/super", { cookie })).text();
  assert.match(html, /회장님 통화 — 다음 주 화요일 방문 약속/);
  assert.match(html, /총무님께 견적 전달/);
  assert.match(html, /운영자/, "누가 남겼는지 보여야 함");
});

test("빈 메모는 기록되지 않는다", async () => {
  const app = await D.createProspect(db(), { assocName: "빈메모" });
  await req("POST", `/super/application/${app.id}/note`, { cookie, body: { _csrf: token, body: "   " } });
  assert.equal(db()._db.prepare(`SELECT COUNT(*) n FROM application_notes WHERE application_id=?`).get(app.id).n, 0);
});

test("승인하면 파이프라인에서 빠지고 상인회가 발급된다", async () => {
  const app = await D.createProspect(db(), { assocName: "승인테스트 상인회", contactEmail: "new-owner@demo.kr" });
  const r = await req("POST", `/super/application/${app.id}/approve`, { cookie, body: { _csrf: token } });
  assert.equal(r.status, 303);
  assert.equal((await D.getApplication(db(), app.id)).status, "approved");
  assert.ok(await D.getUserByEmail(db(), "new-owner@demo.kr"), "관리자 계정이 발급돼야 함");
  const html = await (await req("GET", "/super", { cookie })).text();
  assert.doesNotMatch(html, /승인테스트 상인회<\/h3>/, "승인 후에는 파이프라인 카드에서 빠져야 함");
});

// ── 마지막 활동일
test("상인회 목록에 마지막 활동 시점이 보인다", async () => {
  const { a } = await makeAssoc("act-fresh");
  await db().prepare(`UPDATE notices SET created_at=datetime('now') WHERE association_id=?`).bind(a.id).run();
  const html = await (await req("GET", "/super", { cookie })).text();
  assert.match(html, /오늘 활동|\d+일 전 활동/, "활동 시점 표시");
});

test("오래 잠든 상인회는 눈에 띄게 표시된다", async () => {
  const { a } = await makeAssoc("act-cold");
  for (const t of ["notices", "businesses"])
    await db().prepare(`UPDATE ${t} SET created_at='2020-01-01 00:00:00' WHERE association_id=?`).bind(a.id).run();
  await db().prepare(`UPDATE businesses SET updated_at='2020-01-01 00:00:00' WHERE association_id=?`).bind(a.id).run();
  const html = await (await req("GET", "/super", { cookie })).text();
  assert.match(html, /class="act-stamp is-cold"/, "30일 넘게 조용하면 강조돼야 함");
});

// ── 실전용 시작 세트 (빈 곳만 채움 · 가짜 점포/회원 없음)
test("새 상인회를 만들면 시작 세트가 함께 들어간다", async () => {
  const r = await req("POST", "/super/association", { cookie, body: { _csrf: token,
    name: "새길 상인회", admin_email: "new@saegil.kr", admin_password: "saegil12345", admin_name: "사무국" } });
  assert.equal(r.status, 303);
  const a = await D.getAssociationBySlug(db(), "새길-상인회");
  assert.ok(a, "상인회가 생성돼야 함");
  const n = db()._db.prepare(`SELECT
    (SELECT COUNT(*) FROM notices WHERE association_id=?) n,
    (SELECT COUNT(*) FROM documents WHERE association_id=?) d,
    (SELECT COUNT(*) FROM businesses WHERE association_id=?) b,
    (SELECT COUNT(*) FROM users WHERE association_id=? AND role='MERCHANT') m`).get(a.id, a.id, a.id, a.id);
  assert.equal(n.n, 3, "첫 공지 3건");
  assert.equal(n.d, 1, "가입 동의서 1건");
  assert.equal(n.b, 0, "가짜 점포를 만들면 안 됨");
  assert.equal(n.m, 0, "가짜 회원을 만들면 안 됨");
});

test("시작 세트 공지에 상인회 이름이 실제로 들어간다", async () => {
  const a = await D.getAssociationBySlug(db(), "새길-상인회");
  const row = db()._db.prepare(`SELECT title, body FROM notices WHERE association_id=? AND pinned=1`).get(a.id);
  assert.match(row.title, /새길 상인회/, "자리표시자가 아니라 실제 이름");
  const doc = db()._db.prepare(`SELECT body FROM documents WHERE association_id=?`).get(a.id);
  assert.match(doc.body, /새길 상인회에 가입을 신청하며/);
  assert.doesNotMatch(doc.body + row.body, /\{\{|OOO|○○○/, "자리표시자가 남으면 안 됨");
});

test("시작 세트는 이미 있는 내용을 덮어쓰지 않는다", async () => {
  const a = await D.getAssociationBySlug(db(), "새길-상인회");
  await db().prepare(`UPDATE notices SET title='상인회가 직접 고친 공지' WHERE association_id=? AND pinned=1`).bind(a.id).run();
  const r = await req("POST", `/super/association/${a.id}/starter`, { cookie, body: { _csrf: token } });
  assert.equal(r.status, 303);
  const n = db()._db.prepare(`SELECT COUNT(*) n FROM notices WHERE association_id=?`).get(a.id);
  assert.equal(n.n, 3, "다시 눌러도 늘어나지 않아야 함");
  assert.ok(db()._db.prepare(`SELECT 1 x FROM notices WHERE association_id=? AND title='상인회가 직접 고친 공지'`).get(a.id),
    "고쳐 쓴 공지가 살아 있어야 함");
});

test("신청을 승인해도 시작 세트가 함께 들어간다", async () => {
  const app = await D.createProspect(db(), { assocName: "시작세트 상인회", contactEmail: "start@demo.kr" });
  const r = await req("POST", `/super/application/${app.id}/approve`, { cookie, body: { _csrf: token } });
  assert.equal(r.status, 303);
  const a = await D.getAssociationBySlug(db(), "시작세트-상인회");
  const n = db()._db.prepare(`SELECT
    (SELECT COUNT(*) FROM notices WHERE association_id=?) n,
    (SELECT COUNT(*) FROM documents WHERE association_id=?) d`).get(a.id, a.id);
  assert.equal(n.n, 3);
  assert.equal(n.d, 1);
  assert.equal((await req("GET", "/t/" + encodeURIComponent("시작세트-상인회"))).status, 200, "개설 직후 홈이 비어 있지 않아야 함");
});

// ── 선택 연동 점검
test("연동 점검 패널이 켜짐/안 켜짐을 보여 준다", async () => {
  const html = await (await req("GET", "/super", { cookie })).text();
  assert.match(html, /선택 연동 점검/);
  assert.match(html, /방문 통계/);
  assert.match(html, /MEDIA_PUBLIC_BASE/);
  assert.match(html, /안 켜짐/, "설정 안 된 항목은 그렇게 표시");
});

test("연동 값이 있으면 켜짐으로 바뀌고 값 자체는 안 보인다", async () => {
  const env2 = makeEnv({ CF_ANALYTICS_TOKEN: "abc123", MEDIA_PUBLIC_BASE: "https://pub-x.r2.dev" });
  const pw = await hashPassword("super1234");
  await D.createUser(env2.DB, { email: "s2@platform.kr", passwordHash: pw.hash, salt: pw.salt, name: "운영자", role: "SUPERADMIN", associationId: null });
  const fetch2 = (path, init) => worker.fetch(new Request(BASE + path, init), env2, { waitUntil() {}, passThroughOnException() {} });
  const g = await fetch2("/login");
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const lr = await fetch2("/login", { method: "POST", headers: { cookie: seed, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: tk, email: "s2@platform.kr", password: "super1234" }) });
  const jar = [seed, ...(lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");
  const html = await (await fetch2("/super", { headers: { cookie: jar } })).text();
  assert.match(html, /2\/5 켜짐/, "설정한 두 항목이 켜짐으로 세어져야 함");
  // 값 자체는 패널에 찍지 않습니다. (CF 방문 통계 토큰은 비콘 스크립트에 들어가는 공개 값이라
  //  페이지 다른 곳에는 정상적으로 나타납니다 — 그래서 패널 구간만 잘라 확인합니다.)
  const panel = html.slice(html.indexOf("선택 연동 점검")).split("</section>")[0];
  assert.doesNotMatch(panel, /abc123|pub-x\.r2\.dev/, "값 자체는 패널에 노출되면 안 됨");
});

// ── 영상 링크: 실제로 들어오는 주소 형태를 받아 주는지 (외부 접속 없이 파서만 검증)
import { parseEmbed } from "../src/embed.js";

test("사장님이 실제로 복사하는 영상 주소 형태를 모두 받는다", () => {
  const ok = {
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ": "youtube",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s": "youtube",
    "https://youtu.be/dQw4w9WgXcQ?si=abcdef": "youtube",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ": "youtube",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ": "youtube",
    "https://tv.naver.com/v/12345678": "navertv",
    "https://m.tv.naver.com/v/12345678": "navertv",
    "https://www.instagram.com/reel/CxYz12abc/": "instagram",
  };
  for (const [url, provider] of Object.entries(ok)) {
    const r = parseEmbed(url);
    assert.ok(r, `받아야 하는 주소: ${url}`);
    assert.equal(r.provider, provider, url);
  }
});

test("단축 주소는 왜 안 되는지 알려 준다", async () => {
  const a = await D.createAssociation(db(), { slug: "vid", name: "영상테스트" });
  const pw = await hashPassword("merch1234");
  const owner = await D.createUser(db(), { email: "vid@demo.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장님", role: "MERCHANT", associationId: a.id });
  await db().prepare(`INSERT INTO businesses (association_id, owner_id, name, slug, status) VALUES (?,?,?,?,'approved')`).bind(a.id, owner.id, "가게", "shop").run();
  const l = await login("vid@demo.kr", "merch1234");
  const r = await req("POST", "/t/vid/dashboard/media/embed", { cookie: l.jar, body: { _csrf: l.tk, url: "https://naver.me/xAbCdEf" } });
  const msg = new URL(r.headers.get("location"), BASE).searchParams.get("msg") || "";
  assert.match(msg, /단축 주소/, "그냥 '지원 안 함' 이 아니라 이유를 알려 줘야 함");
  assert.equal(parseEmbed("https://naver.me/xAbCdEf"), null);
});
