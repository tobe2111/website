// 데모 콘텐츠 채우기 검증 — 슈퍼 콘솔 버튼 → 공개 페이지에 실제로 반영되는지.
// 실행: node --experimental-sqlite --test cloudflare/test/*.test.js
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const BASE = "http://localhost";
const SLUG = "리스터코퍼레이션";
const T = "/t/" + encodeURIComponent(SLUG);
let env, assoc, cookie, token;

const req = (method, path, { cookie = "", body = null } = {}) => {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let init = { method, headers };
  if (body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    headers.origin = BASE;
    init.body = new URLSearchParams(body);
  }
  return worker.fetch(new Request(BASE + path, init), env, { waitUntil() {}, passThroughOnException() {} });
};

function db() { return env.DB; }

before(async () => {
  env = makeEnv();
  assoc = await D.createAssociation(db(), { slug: SLUG, name: SLUG });
  const pw = await hashPassword("super1234");
  await D.createUser(db(), { email: "super@platform.kr", passwordHash: pw.hash, salt: pw.salt, name: "운영자", role: "SUPERADMIN", associationId: null });

  const g = await req("GET", "/login");
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  token = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const r = await req("POST", "/login", { cookie: seed, body: { _csrf: token, email: "super@platform.kr", password: "super1234" } });
  assert.equal(r.status, 303, "슈퍼 관리자 로그인");
  cookie = [seed, ...(r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");
});

test("슈퍼 콘솔에 '데모 채우기' 버튼이 있다", async () => {
  const r = await req("GET", "/super", { cookie });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /데모 채우기/);
});

test("데모 채우기는 슈퍼 관리자만 실행할 수 있다", async () => {
  const r = await req("POST", `/super/association/${assoc.id}/demo`, { body: { _csrf: token } });
  assert.notEqual(r.status, 303, "비로그인 요청이 통과하면 안 됨");
});

test("버튼을 누르면 콘텐츠가 채워지고 공개 페이지에 나온다", async () => {
  const r = await req("POST", `/super/association/${assoc.id}/demo`, { cookie, body: { _csrf: token } });
  assert.equal(r.status, 303, "리다이렉트");

  const counts = db()._db.prepare(`SELECT
    (SELECT COUNT(*) FROM businesses WHERE association_id=? AND status='approved') b,
    (SELECT COUNT(*) FROM products WHERE association_id=?) p,
    (SELECT COUNT(*) FROM notices WHERE association_id=?) n,
    (SELECT COUNT(*) FROM events WHERE association_id=?) e,
    (SELECT COUNT(*) FROM posts WHERE association_id=?) po,
    (SELECT COUNT(*) FROM users WHERE association_id=? AND role='MERCHANT') u`)
    .get(assoc.id, assoc.id, assoc.id, assoc.id, assoc.id, assoc.id);
  assert.equal(counts.b, 8, "점포 8곳");
  assert.ok(counts.p >= 20, "메뉴 20개 이상");
  assert.equal(counts.n, 6, "공지 6건");
  assert.equal(counts.e, 3, "행사 3건");
  assert.equal(counts.po, 4, "게시글 4개");
  assert.equal(counts.u, 8, "사장님 계정 8개");

  const home = await req("GET", T);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /고을돼지국밥/, "점포가 홈에 노출");
  assert.match(html, /정기총회/, "공지가 홈에 노출");
  assert.match(html, /야시장/, "행사가 홈에 노출");
  assert.match(html, /골목마다 사람이 있고/, "상인회 태그라인 반영");
});

test("행사는 항상 미래 날짜라 '다가오는 행사'에 남는다", () => {
  const today = new Date().toISOString().slice(0, 10);
  const past = db()._db.prepare(`SELECT COUNT(*) n FROM events WHERE association_id=? AND event_date < ?`).get(assoc.id, today);
  assert.equal(past.n, 0, "지난 행사가 없어야 함");
});

test("공개 페이지가 모두 200 으로 뜬다", async () => {
  for (const path of [T, T + "/businesses", T + "/map", T + "/notices", T + "/events", T + "/business/goeul-gukbap"]) {
    const r = await req("GET", path);
    assert.equal(r.status, 200, path);
  }
});

test("두 번 눌러도 데이터가 중복되지 않는다", async () => {
  const r = await req("POST", `/super/association/${assoc.id}/demo`, { cookie, body: { _csrf: token } });
  assert.equal(r.status, 303);
  const n = db()._db.prepare(`SELECT
    (SELECT COUNT(*) FROM businesses WHERE association_id=?) b,
    (SELECT COUNT(*) FROM notices WHERE association_id=?) n,
    (SELECT COUNT(*) FROM users WHERE association_id=? AND role='MERCHANT') u`).get(assoc.id, assoc.id, assoc.id);
  assert.equal(n.b, 8, "점포가 8곳 그대로");
  assert.equal(n.n, 6, "공지가 6건 그대로");
  assert.equal(n.u, 8, "사장님 계정이 8개 그대로");
});

test("다른 상인회의 데이터는 건드리지 않는다", async () => {
  const other = await D.createAssociation(db(), { slug: "other", name: "다른 상인회" });
  await db().prepare(`INSERT INTO notices (association_id, title, body) VALUES (?,?,?)`).bind(other.id, "남의 공지", "본문").run();
  const r = await req("POST", `/super/association/${assoc.id}/demo`, { cookie, body: { _csrf: token } });
  assert.equal(r.status, 303);
  const n = db()._db.prepare(`SELECT COUNT(*) n FROM notices WHERE association_id=?`).get(other.id);
  assert.equal(n.n, 1, "다른 상인회 공지가 그대로 남아야 함");
});
