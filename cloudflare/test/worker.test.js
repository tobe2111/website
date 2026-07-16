// Cloudflare 워커 로직 검증 (D1/R2/ASSETS 에뮬레이터 사용) — node:test
// 실행: node --experimental-sqlite --test cloudflare/test/*.test.js
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const BASE = "http://localhost";
let env, seocho, bizSlug;

before(async () => {
  env = makeEnv();
  const db = env.DB;
  seocho = await D.createAssociation(db, { slug: "seocho", name: "서초구 상인회", tagline: "함께 성장하는 서초 상권" });
  const adminPw = await hashPassword("admin1234");
  await D.createUser(db, { email: "admin@seocho.kr", passwordHash: adminPw.hash, salt: adminPw.salt, name: "관리자", role: "ADMIN", associationId: seocho.id });
  const merPw = await hashPassword("merchant1234");
  const mer = await D.createUser(db, { email: "jung@ex.kr", passwordHash: merPw.hash, salt: merPw.salt, name: "김서초", role: "MERCHANT", associationId: seocho.id });
  const biz = await D.createBusiness(db, { associationId: seocho.id, ownerId: mer.id, name: "서초정육점", category: "농수축산" });
  await D.updateBusiness(db, biz.id, { name: "서초정육점", category: "농수축산", description: "3대째 한우 전문점", phone: "02-585-1234", address: "서초대로 12", hours: "매일 09-21", lat: 37.49, lng: 127.01 });
  await D.setBusinessStatus(db, biz.id, "approved");
  await env.MEDIA.put("img1.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]), { httpMetadata: { contentType: "image/png" } });
  await D.addMedia(db, { businessId: biz.id, kind: "image", filename: "img1.png", caption: "대표사진" });
  bizSlug = biz.slug;
});

const req = (method, path, { cookie = "", body = null } = {}) => {
  const headers = {}; if (cookie) headers.cookie = cookie;
  let init = { method, headers };
  if (body) { headers["content-type"] = "application/x-www-form-urlencoded"; init.body = new URLSearchParams(body).toString(); }
  return worker.fetch(new Request(BASE + path, init), env);
};
const setCookieSeed = (res) => {
  for (const c of res.headers.getSetCookie?.() || []) if (c.startsWith("sc_csrf_seed=")) return c.split(";")[0];
  return "";
};

test("테넌트 홈 200 + 히어로", async () => {
  const r = await req("GET", "/t/seocho");
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.match(h, /hi-title/); // 일러스트 히어로 타이틀
  assert.match(h, /hero-illus/);
});

test("보안 헤더(CSP·nosniff) + 임베드 frame-src", async () => {
  const r = await req("GET", "/t/seocho");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  const csp = r.headers.get("content-security-policy") || "";
  assert.match(csp, /frame-src[^;]*youtube-nocookie\.com/);
});

test("가입 점포 목록 + 상세(R2 이미지)", async () => {
  let r = await req("GET", "/t/seocho/businesses");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /서초정육점/);
  r = await req("GET", "/t/seocho/business/" + encodeURIComponent(bizSlug));
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.match(h, /3대째 한우 전문점/);
  assert.match(h, /\/media\/img1\.png/);
});

test("R2 미디어 서빙", async () => {
  const r = await req("GET", "/media/img1.png");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
});

test("로그인 폼 + CSRF 시드 쿠키", async () => {
  const r = await req("GET", "/login");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /name="_csrf"/);
  assert.ok(setCookieSeed(r), "csrf 시드 쿠키 발급");
});

test("로그인 성공 → 관리자 리다이렉트 (CSRF 통과)", async () => {
  const g = await req("GET", "/login");
  const seed = setCookieSeed(g);
  const token = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const r = await req("POST", "/login", { cookie: seed, body: { _csrf: token, email: "admin@seocho.kr", password: "admin1234" } });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/t/seocho/admin");
  // 세션 쿠키 발급 확인
  assert.ok((r.headers.getSetCookie?.() || []).some((c) => c.startsWith("sc_session=")));
});

test("로그인 실패 → err 리다이렉트", async () => {
  const g = await req("GET", "/login");
  const seed = setCookieSeed(g);
  const token = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const r = await req("POST", "/login", { cookie: seed, body: { _csrf: token, email: "admin@seocho.kr", password: "WRONG" } });
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /err=1/);
});

test("CSRF 없는 POST 는 403", async () => {
  const r = await req("POST", "/login", { body: { email: "x@y.z", password: "z" } });
  assert.equal(r.status, 403);
});

test("존재하지 않는 테넌트 404", async () => {
  const r = await req("GET", "/t/nope");
  assert.equal(r.status, 404);
});

test("정적 자산(css) ASSETS 서빙", async () => {
  const r = await req("GET", "/css/app.css");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /text\/css/);
});
