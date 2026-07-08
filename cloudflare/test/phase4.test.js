// CF 개선: 홈 편집기·sitemap·비번찾기·전기기로그아웃·Turnstile·PWA
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const BASE = "http://localhost";
let env, seocho;
before(async () => {
  env = makeEnv();
  seocho = await D.createAssociation(env.DB, { slug: "seocho", name: "서초구 상인회", tagline: "서초 상권" });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "admin@s.kr", passwordHash: ad.hash, salt: ad.salt, name: "관리자", role: "ADMIN", associationId: seocho.id });
});
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(j, p) { const r = await worker.fetch(new Request(BASE + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function tok(j) { return (/name="_csrf" value="([^"]+)"/.exec(await (await get(j, "/login")).text()) || [])[1]; }
async function post(j, p, f) { const t = await tok(j); const b = new URLSearchParams({ _csrf: t, ...f }); const r = await worker.fetch(new Request(BASE + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: b.toString() }), env); absorb(j, r); return r; }

test("PWA: manifest + service worker + head 링크", async () => {
  const m = await get(jar(), "/manifest.webmanifest");
  assert.equal(m.status, 200);
  const sw = await get(jar(), "/sw.js");
  assert.equal(sw.status, 200);
  const home = await (await get(jar(), "/t/seocho")).text();
  assert.match(home, /rel="manifest"/);
  assert.match(home, /theme-color/);
});

test("SEO: sitemap.xml + robots.txt", async () => {
  const sm = await get(jar(), "/sitemap.xml");
  assert.equal(sm.status, 200);
  assert.match(sm.headers.get("content-type"), /xml/);
  assert.match(await sm.text(), /\/t\/seocho/);
  const rb = await get(jar(), "/robots.txt");
  assert.equal(rb.status, 200);
  assert.match(await rb.text(), /Sitemap:/);
});

test("비밀번호 찾기: 관리자 알림 생성(이메일 없이)", async () => {
  // 회원 하나 생성
  const pw = await hashPassword("merchant1234");
  await D.createUser(env.DB, { email: "mm@ex.kr", passwordHash: pw.hash, salt: pw.salt, name: "회원", role: "MERCHANT", associationId: seocho.id });
  const before = await D.unreadCount(env.DB, seocho.id);
  const r = await post(jar(), "/forgot", { email: "mm@ex.kr" });
  assert.equal(r.status, 303);
  assert.equal(await D.unreadCount(env.DB, seocho.id), before + 1, "관리자 알림 1건 증가");
});

test("전 기기 로그아웃: session_version 증가", async () => {
  const j = jar(); await post(j, "/login", { email: "admin@s.kr", password: "admin1234" });
  const before = (await D.getUserByEmail(env.DB, "admin@s.kr")).session_version;
  const r = await post(j, "/account/logout-all", {});
  assert.equal(r.status, 303);
  assert.equal((await D.getUserByEmail(env.DB, "admin@s.kr")).session_version, before + 1);
});

test("홈페이지 구성 편집: 저장 → 홈 반영, 초기화", async () => {
  const j = jar(); await post(j, "/login", { email: "admin@s.kr", password: "admin1234" });
  // hero 제목을 바꿔 저장 (order=0 hero only, enabled)
  const r = await post(j, "/t/seocho/admin/layout", { order: "0", ty_0: "hero", en_0: "1", f_0_title: "우리 상권 특별합니다", f_0_eyebrow: "eyebrow", f_0_highlight: "", f_0_subtitle: "설명", f_0_primaryLabel: "등록", f_0_showStats: "1" });
  assert.equal(r.status, 303);
  const home = await (await get(jar(), "/t/seocho")).text();
  assert.match(home, /우리 상권 특별합니다/);
  // 초기화
  const r2 = await post(j, "/t/seocho/admin/layout/reset", {});
  assert.equal(r2.status, 303);
  assert.equal((await D.getAssociationBySlug(env.DB, "seocho")).home_layout, null);
});

test("Turnstile: 시크릿 설정 시 토큰 없으면 로그인 차단", async () => {
  const env2 = makeEnv({ TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET: "always-fail" });
  const s = await D.createAssociation(env2.DB, { slug: "seocho", name: "서초" });
  const ad = await hashPassword("admin1234");
  await D.createUser(env2.DB, { email: "admin@s.kr", passwordHash: ad.hash, salt: ad.salt, name: "관리자", role: "ADMIN", associationId: s.id });
  // 로그인 폼에 위젯 노출
  const j = { c: {} };
  const form = await (await (async () => { const r = await worker.fetch(new Request(BASE + "/login"), env2); for (const c of r.headers.getSetCookie?.() || []) { const kv = c.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } return r; })()).text();
  assert.match(form, /cf-turnstile/);
  const t = (/name="_csrf" value="([^"]+)"/.exec(form) || [])[1];
  // 토큰 없이 로그인 → 실제 siteverify 는 네트워크(테스트 환경에선 실패) → 차단(err)
  const r = await worker.fetch(new Request(BASE + "/login", { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, email: "admin@s.kr", password: "admin1234" }).toString() }), env2);
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /err=1/);
});
