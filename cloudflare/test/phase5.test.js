// CF 개선2: 감사 로그 · 2FA(TOTP) · 영업중 배지 · 웹 분석
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { totpAt } from "../src/totp.js";
import { openNow } from "../src/util.js";

const BASE = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, p) { const r = await worker.fetch(new Request(BASE + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function tok(env, j) { return (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/login")).text()) || [])[1]; }
async function post(env, j, p, f) { const t = await tok(env, j); const r = await worker.fetch(new Request(BASE + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env); absorb(j, r); return r; }

async function seed() {
  const env = makeEnv();
  const s = await D.createAssociation(env.DB, { slug: "seocho", name: "서초구 상인회" });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "admin@s.kr", passwordHash: ad.hash, salt: ad.salt, name: "관리자", role: "ADMIN", associationId: s.id });
  return { env, s };
}

test("영업시간 → 영업중 판단 (openNow, KST)", () => {
  const H = "매일 10:00 - 22:00";
  assert.equal(openNow(H, Date.UTC(2026, 0, 1, 6, 0)), true);   // KST 15:00 → 영업중
  assert.equal(openNow(H, Date.UTC(2026, 0, 1, 23, 0)), false); // KST 08:00 → 종료
  assert.equal(openNow("매일 22:00 - 02:00", Date.UTC(2026, 0, 1, 16, 0)), true); // KST 01:00 자정넘김
  assert.equal(openNow("연중무휴"), null); // 시간 불명 → 배지 없음
});

test("감사 로그: 관리자 공지 등록이 기록됨", async () => {
  const { env, s } = await seed();
  const j = jar(); await post(env, j, "/login", { email: "admin@s.kr", password: "admin1234" });
  await post(env, j, "/t/seocho/admin/notice", { title: "감사 테스트 공지", body: "x", tag: "공지" });
  const log = await D.listAudit(env.DB, s.id, 10);
  assert.ok(log.some((a) => a.action === "공지등록" && a.detail === "감사 테스트 공지"), "공지등록 기록");
  assert.match(await (await get(env, j, "/t/seocho/admin")).text(), /감사 로그/);
});

test("2FA: 설정 → 활성화 → 로그인에 코드 필요", async () => {
  const { env } = await seed();
  const j = jar(); await post(env, j, "/login", { email: "admin@s.kr", password: "admin1234" });
  await post(env, j, "/account/2fa/setup", {});
  const acc = await (await get(env, j, "/account")).text();
  const secret = (/totp-key">([A-Z2-7]+)</.exec(acc) || [])[1];
  assert.ok(secret && secret.length >= 16, "시크릿 발급");
  // 활성화
  const code = await totpAt(secret, Date.now());
  let r = await post(env, j, "/account/2fa/enable", { code });
  assert.equal(r.status, 303);
  assert.equal((await D.getUserByEmail(env.DB, "admin@s.kr")).totp_enabled, 1, "2FA 활성");
  // 코드 없이 로그인 → 실패
  const j2 = jar();
  r = await post(env, j2, "/login", { email: "admin@s.kr", password: "admin1234" });
  assert.match(r.headers.get("location"), /err=1/);
  // 코드와 함께 로그인 → 성공
  const j3 = jar();
  const code2 = await totpAt(secret, Date.now());
  r = await post(env, j3, "/login", { email: "admin@s.kr", password: "admin1234", totp: code2 });
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /\/admin/);
});

test("웹 분석: 토큰 설정 시 beacon 주입 + CSP 허용", async () => {
  const env = makeEnv({ CF_ANALYTICS_TOKEN: "tok123" });
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "서초" });
  const pw = await hashPassword("x12345678");
  await D.createUser(env.DB, { email: "a@a.kr", passwordHash: pw.hash, salt: pw.salt, name: "관리자", role: "ADMIN", associationId: a.id });
  const r = await worker.fetch(new Request(BASE + "/t/seocho"), env);
  const html = await r.text();
  assert.match(html, /static\.cloudflareinsights\.com\/beacon\.min\.js/);
  assert.match(html, /tok123/);
  assert.match(r.headers.get("content-security-policy"), /cloudflareinsights\.com/);
});
