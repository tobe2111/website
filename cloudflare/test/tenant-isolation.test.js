// 테넌트 격리 점검 — A 상인회 계정으로 B 상인회의 데이터를 id 로 직접 건드릴 수 있는가.
// 화면에 링크가 없어도 주소·id 만 알면 요청은 보낼 수 있으므로, 서버가 막아야 합니다.
// 실행: node --experimental-sqlite --test cloudflare/test/*.test.js
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { contentHash } from "../src/esign.js";

const BASE = "http://localhost";
let env, A, B, adminA, merchA;

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
const one = (sql, ...a) => db()._db.prepare(sql).get(...a);

async function login(email, password) {
  const g = await req("GET", "/login");
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const r = await req("POST", "/login", { cookie: seed, body: { _csrf: tk, email, password } });
  return { tk, jar: [seed, ...(r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ") };
}

// 상인회 하나를 관리자·사장님·콘텐츠와 함께 구성
async function build(slug) {
  const a = await D.createAssociation(db(), { slug, name: slug });
  const pw = await hashPassword("pass12345");
  const admin = await D.createUser(db(), { email: `admin-${slug}@x.kr`, passwordHash: pw.hash, salt: pw.salt, name: "관리자", role: "ADMIN", associationId: a.id });
  const owner = await D.createUser(db(), { email: `owner-${slug}@x.kr`, passwordHash: pw.hash, salt: pw.salt, name: "사장님", role: "MERCHANT", associationId: a.id });
  const r = (sql, ...args) => db().prepare(sql).bind(...args).run();
  await r(`INSERT INTO businesses (association_id, owner_id, name, slug, status) VALUES (?,?,?,?,'pending')`, a.id, owner.id, `${slug} 가게`, "shop");
  const biz = one(`SELECT id FROM businesses WHERE association_id=?`, a.id);
  await r(`INSERT INTO products (business_id, association_id, name) VALUES (?,?,?)`, biz.id, a.id, "메뉴");
  await r(`INSERT INTO coupons (business_id, association_id, title) VALUES (?,?,?)`, biz.id, a.id, "쿠폰");
  await r(`INSERT INTO updates (business_id, association_id, body) VALUES (?,?,?)`, biz.id, a.id, "소식");
  await r(`INSERT INTO media (business_id, kind, filename) VALUES (?,'image',?)`, biz.id, "/img/x.png");
  await r(`INSERT INTO notices (association_id, title, body) VALUES (?,?,?)`, a.id, `${slug} 공지`, "본문");
  await r(`INSERT INTO events (association_id, title, event_date) VALUES (?,?,?)`, a.id, `${slug} 행사`, "2030-01-01");
  await r(`INSERT INTO posts (association_id, author_id, title, body) VALUES (?,?,?,?)`, a.id, owner.id, `${slug} 글`, "본문");
  const post = one(`SELECT id FROM posts WHERE association_id=?`, a.id);
  await r(`INSERT INTO comments (post_id, author_id, body) VALUES (?,?,?)`, post.id, owner.id, "댓글");
  await r(`INSERT INTO polls (association_id, title) VALUES (?,?)`, a.id, `${slug} 투표`);
  const body = `${slug} 문서 본문`;
  await D.createDocument(db(), { associationId: a.id, title: `${slug} 문서`, body, contentHash: await contentHash(body), createdBy: admin.id });
  return {
    a, admin, owner, bizId: biz.id, postId: post.id,
    noticeId: one(`SELECT id FROM notices WHERE association_id=?`, a.id).id,
    eventId: one(`SELECT id FROM events WHERE association_id=?`, a.id).id,
    pollId: one(`SELECT id FROM polls WHERE association_id=?`, a.id).id,
    docId: one(`SELECT id FROM documents WHERE association_id=?`, a.id).id,
    productId: one(`SELECT id FROM products WHERE association_id=?`, a.id).id,
    couponId: one(`SELECT id FROM coupons WHERE association_id=?`, a.id).id,
    updateId: one(`SELECT id FROM updates WHERE association_id=?`, a.id).id,
    mediaId: one(`SELECT m.id FROM media m JOIN businesses b ON b.id=m.business_id WHERE b.association_id=?`, a.id).id,
    commentId: one(`SELECT c.id FROM comments c JOIN posts p ON p.id=c.post_id WHERE p.association_id=?`, a.id).id,
  };
}

before(async () => {
  env = makeEnv();
  A = await build("aaa");
  B = await build("bbb");
  adminA = await login(A.admin.email, "pass12345");
  merchA = await login(A.owner.email, "pass12345");
});

// 남의 상인회 것이 바뀌지 않았는지 확인하는 도우미
const stillThere = (sql, ...a) => assert.ok(one(sql, ...a), "남의 상인회 데이터가 사라졌습니다");

test("A 관리자는 B 의 공지·행사를 지울 수 없다", async () => {
  await req("POST", `/t/aaa/admin/notice/${B.noticeId}/delete`, { cookie: adminA.jar, body: { _csrf: adminA.tk } });
  stillThere(`SELECT id FROM notices WHERE id=?`, B.noticeId);
  await req("POST", `/t/aaa/admin/event/${B.eventId}/delete`, { cookie: adminA.jar, body: { _csrf: adminA.tk } });
  stillThere(`SELECT id FROM events WHERE id=?`, B.eventId);
});

test("A 관리자는 B 의 점포를 승인·반려할 수 없다", async () => {
  await req("POST", `/t/aaa/admin/business/${B.bizId}/status`, { cookie: adminA.jar, body: { _csrf: adminA.tk, status: "approved" } });
  assert.equal(one(`SELECT status FROM businesses WHERE id=?`, B.bizId).status, "pending", "남의 점포 상태가 바뀌면 안 됨");
});

test("A 관리자는 B 의 제품을 숨길 수 없다", async () => {
  await req("POST", `/t/aaa/admin/product/${B.productId}/hide`, { cookie: adminA.jar, body: { _csrf: adminA.tk } });
  assert.equal(one(`SELECT hidden FROM products WHERE id=?`, B.productId).hidden, 0, "남의 제품이 숨겨지면 안 됨");
});

test("A 관리자는 B 의 투표를 마감할 수 없다", async () => {
  await req("POST", `/t/aaa/admin/polls/${B.pollId}/close`, { cookie: adminA.jar, body: { _csrf: adminA.tk } });
  assert.equal(one(`SELECT closed FROM polls WHERE id=?`, B.pollId).closed, 0, "남의 투표가 마감되면 안 됨");
});

test("A 관리자는 B 의 전자서명 문서를 열거나 마감할 수 없다", async () => {
  const r = await req("GET", `/t/aaa/admin/documents/${B.docId}`, { cookie: adminA.jar });
  assert.notEqual(r.status, 200, "남의 문서 내용이 보이면 안 됨");
  await req("POST", `/t/aaa/admin/documents/${B.docId}/close`, { cookie: adminA.jar, body: { _csrf: adminA.tk } });
  assert.equal(one(`SELECT closed FROM documents WHERE id=?`, B.docId).closed, 0, "남의 문서가 마감되면 안 됨");
});

test("A 관리자는 B 의 회원 비밀번호를 재발급할 수 없다", async () => {
  const before = one(`SELECT password_hash FROM users WHERE id=?`, B.owner.id).password_hash;
  await req("POST", `/t/aaa/admin/user/${B.owner.id}/reset-password`, { cookie: adminA.jar, body: { _csrf: adminA.tk } });
  assert.equal(one(`SELECT password_hash FROM users WHERE id=?`, B.owner.id).password_hash, before, "남의 회원 비밀번호가 바뀌면 안 됨");
});

test("A 회원은 B 의 게시글을 읽거나 지우거나 고정할 수 없다", async () => {
  const r = await req("GET", `/t/aaa/board/${B.postId}`, { cookie: merchA.jar });
  assert.notEqual(r.status, 200, "남의 상인회 글이 보이면 안 됨");
  await req("POST", `/t/aaa/board/${B.postId}/delete`, { cookie: merchA.jar, body: { _csrf: merchA.tk } });
  stillThere(`SELECT id FROM posts WHERE id=?`, B.postId);
  await req("POST", `/t/aaa/board/${B.postId}/pin`, { cookie: merchA.jar, body: { _csrf: merchA.tk } });
  assert.equal(one(`SELECT pinned FROM posts WHERE id=?`, B.postId).pinned, 0);
});

test("A 회원은 B 의 글에 댓글을 달거나 남의 댓글을 지울 수 없다", async () => {
  await req("POST", `/t/aaa/board/${B.postId}/comment`, { cookie: merchA.jar, body: { _csrf: merchA.tk, body: "침입 댓글" } });
  assert.equal(one(`SELECT COUNT(*) n FROM comments WHERE post_id=? AND body='침입 댓글'`, B.postId).n, 0);
  await req("POST", `/t/aaa/board/${B.postId}/comment/${B.commentId}/delete`, { cookie: merchA.jar, body: { _csrf: merchA.tk } });
  stillThere(`SELECT id FROM comments WHERE id=?`, B.commentId);
});

test("A 회원은 B 의 투표에 표를 넣을 수 없다", async () => {
  await req("POST", `/t/aaa/polls/${B.pollId}/vote`, { cookie: merchA.jar, body: { _csrf: merchA.tk, choice: "yes" } });
  assert.equal(one(`SELECT COUNT(*) n FROM poll_votes WHERE poll_id=?`, B.pollId).n, 0, "남의 투표에 표가 들어가면 안 됨");
});

test("A 회원은 B 의 행사에 참가 신청할 수 없다", async () => {
  await req("POST", `/t/aaa/events/${B.eventId}/rsvp`, { cookie: merchA.jar, body: { _csrf: merchA.tk } });
  assert.equal(one(`SELECT COUNT(*) n FROM event_rsvps WHERE event_id=?`, B.eventId).n, 0);
});

test("A 사장님은 B 점포의 제품·쿠폰·소식·사진을 지울 수 없다", async () => {
  const cases = [
    [`/t/aaa/dashboard/products/${B.productId}/delete`, `SELECT id FROM products WHERE id=?`, B.productId],
    [`/t/aaa/dashboard/coupons/${B.couponId}/delete`, `SELECT id FROM coupons WHERE id=?`, B.couponId],
    [`/t/aaa/dashboard/updates/${B.updateId}/delete`, `SELECT id FROM updates WHERE id=?`, B.updateId],
    [`/t/aaa/dashboard/media/${B.mediaId}/delete`, `SELECT id FROM media WHERE id=?`, B.mediaId],
  ];
  for (const [path, sql, id] of cases) {
    await req("POST", path, { cookie: merchA.jar, body: { _csrf: merchA.tk } });
    stillThere(sql, id);
  }
});

test("A 사장님은 B 점포의 제품을 품절 처리하거나 순서를 바꿀 수 없다", async () => {
  await req("POST", `/t/aaa/dashboard/products/${B.productId}/soldout`, { cookie: merchA.jar, body: { _csrf: merchA.tk } });
  assert.equal(one(`SELECT sold_out FROM products WHERE id=?`, B.productId).sold_out, 0);
  await req("POST", `/t/aaa/dashboard/products/${B.productId}`, { cookie: merchA.jar, body: { _csrf: merchA.tk, name: "탈취된 이름" } });
  assert.notEqual(one(`SELECT name FROM products WHERE id=?`, B.productId).name, "탈취된 이름");
});

test("A 사장님은 B 의 서명 문서를 열거나 서명할 수 없다", async () => {
  const r = await req("GET", `/t/aaa/sign/${B.docId}`, { cookie: merchA.jar });
  assert.notEqual(r.status, 200, "남의 문서 서명 화면이 열리면 안 됨");
  await req("POST", `/t/aaa/sign/${B.docId}`, { cookie: merchA.jar, body: { _csrf: merchA.tk, signer_name: "침입자", signature: "data:image/png;base64,iVBORw0KGgo=" } });
  assert.equal(one(`SELECT COUNT(*) n FROM signatures WHERE document_id=?`, B.docId).n, 0, "남의 문서에 서명이 남으면 안 됨");
});

test("공개 공지도 상인회를 넘어 보이지 않는다", async () => {
  const r = await req("GET", `/t/aaa/notices/${B.noticeId}`);
  assert.notEqual(r.status, 200, "다른 상인회 공지가 열리면 안 됨");
});

// ── CSRF · 세션
test("CSRF 토큰 없이는 어떤 변경도 통하지 않는다", async () => {
  const targets = [
    ["/t/aaa/admin/notice", { title: "무단 공지", body: "x" }],
    ["/t/aaa/board", { title: "무단 글", body: "x" }],
    [`/t/aaa/polls/${A.pollId}/vote`, { choice: "yes" }],
    ["/logout", {}],
  ];
  for (const [path, body] of targets) {
    const r = await req("POST", path, { cookie: adminA.jar, body }); // _csrf 없음
    assert.notEqual(r.status, 303, `${path} 가 토큰 없이 처리되면 안 됨`);
  }
  assert.equal(one(`SELECT COUNT(*) n FROM notices WHERE title='무단 공지'`).n, 0);
  assert.equal(one(`SELECT COUNT(*) n FROM posts WHERE title='무단 글'`).n, 0);
});

test("엉뚱한 CSRF 토큰도 거부한다", async () => {
  const r = await req("POST", "/t/aaa/admin/notice", { cookie: adminA.jar, body: { _csrf: "위조된토큰", title: "위조 공지", body: "x" } });
  assert.notEqual(r.status, 303);
  assert.equal(one(`SELECT COUNT(*) n FROM notices WHERE title='위조 공지'`).n, 0);
});

test("비밀번호를 바꾸면 기존 세션이 끊긴다", async () => {
  const pw = await hashPassword("newpass12345");
  await D.updateUserPassword(db(), A.owner.id, pw.hash, pw.salt); // session_version 증가
  const r = await req("GET", "/t/aaa/dashboard", { cookie: merchA.jar });
  assert.notEqual(r.status, 200, "옛 세션 쿠키가 계속 통하면 안 됨");
});
