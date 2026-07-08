// Cloudflare 3단계 검증: 관리자·전자서명(Ed25519 순차·검증)·슈퍼 멀티테넌트
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const BASE = "http://localhost";
// 유효한 최소 PNG (89 50 4E 47 ... 64바이트 이상)
const PNG = new Uint8Array(80); PNG.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
const SIG_DATAURL = "data:image/png;base64," + Buffer.from(PNG).toString("base64");
let env, seocho, m1, m2;

before(async () => {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  env = makeEnv({ SIGN_PRIVATE_KEY: JSON.stringify(jwk) });
  seocho = await D.createAssociation(env.DB, { slug: "seocho", name: "서초구 상인회" });
  const su = await hashPassword("super1234");
  await D.createUser(env.DB, { email: "super@p.kr", passwordHash: su.hash, salt: su.salt, name: "슈퍼", role: "SUPERADMIN", associationId: null });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "admin@s.kr", passwordHash: ad.hash, salt: ad.salt, name: "관리자", role: "ADMIN", associationId: seocho.id });
  for (const [em, nm] of [["a@ex.kr", "가상인"], ["b@ex.kr", "나상인"]]) {
    const pw = await hashPassword("merchant1234");
    const u = await D.createUser(env.DB, { email: em, passwordHash: pw.hash, salt: pw.salt, name: nm, role: "MERCHANT", associationId: seocho.id });
    const b = await D.createBusiness(env.DB, { associationId: seocho.id, ownerId: u.id, name: nm + "가게", category: "기타" });
    await D.setBusinessStatus(env.DB, b.id, "approved");
    if (em === "a@ex.kr") m1 = u; else m2 = u;
  }
});

const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(j, p) { const r = await worker.fetch(new Request(BASE + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function tok(j) { return (/name="_csrf" value="([^"]+)"/.exec(await (await get(j, "/login")).text()) || [])[1]; }
async function post(j, p, fields) {
  const t = await tok(j);
  const b = new URLSearchParams({ _csrf: t }); for (const [k, v] of Object.entries(fields)) { if (Array.isArray(v)) v.forEach((x) => b.append(k, x)); else b.append(k, v); }
  const r = await worker.fetch(new Request(BASE + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: b.toString() }), env);
  absorb(j, r); return r;
}
async function login(j, email, pw) { return post(j, "/login", { email, password: pw }); }

test("관리자: 공지 생성 + 회원 CSV", async () => {
  const j = jar(); await login(j, "admin@s.kr", "admin1234");
  let r = await post(j, "/t/seocho/admin/notice", { title: "총회 안내", body: "3시 시작", tag: "공지" });
  assert.equal(r.status, 303);
  assert.match(await (await get(j, "/t/seocho/notices")).text(), /총회 안내/);
  r = await get(j, "/t/seocho/admin/members.csv");
  assert.match(r.headers.get("content-type"), /text\/csv/);
  assert.match(await r.text(), /a@ex\.kr/);
});

test("전자서명: 순차 문서 생성 → 순서대로만 서명 → Ed25519 검증", async () => {
  const admin = jar(); await login(admin, "admin@s.kr", "admin1234");
  // 순차 문서: 대상 = m1, m2 (순서대로)
  let r = await post(admin, "/t/seocho/admin/documents", { title: "연대 계약서", body: "동의합니다", target: "select", ordered: "1", members: [String(m1.id), String(m2.id)] });
  assert.equal(r.status, 303);
  const doc = (await D.listDocuments(env.DB, seocho.id))[0];

  // m2 는 아직 차례 아님 → 서명대기 0
  assert.equal(await D.countDocumentsToSign(env.DB, seocho.id, m2.id), 0, "2순위는 대기");
  assert.equal(await D.countDocumentsToSign(env.DB, seocho.id, m1.id), 1, "1순위는 서명 가능");

  // m1 서명
  const jm1 = jar(); await login(jm1, "a@ex.kr", "merchant1234");
  r = await post(jm1, "/t/seocho/sign/" + doc.id, { signer_name: "가상인", consent: "1", signature: SIG_DATAURL });
  assert.equal(r.status, 303);
  assert.match(decodeURIComponent(r.headers.get("location")), /검증 코드/);
  assert.ok(await D.hasSigned(env.DB, doc.id, m1.id), "m1 서명 완료");

  // 이제 m2 차례
  assert.equal(await D.countDocumentsToSign(env.DB, seocho.id, m2.id), 1, "1순위 완료 후 2순위 가능");
  const jm2 = jar(); await login(jm2, "b@ex.kr", "merchant1234");
  r = await post(jm2, "/t/seocho/sign/" + doc.id, { signer_name: "나상인", consent: "1", signature: SIG_DATAURL });
  assert.equal(r.status, 303);

  // Ed25519 봉인 검증 (관리자 문서 상세에 유효 배지)
  const detail = await (await get(admin, "/t/seocho/admin/documents/" + doc.id)).text();
  assert.match(detail, /유효/);
  assert.doesNotMatch(detail, /위변조 의심/);

  // 공개 검증 페이지
  const sig = (await D.listSignatures(env.DB, doc.id))[0];
  const vp = await (await get(jar(), "/verify/" + sig.verify_code)).text();
  assert.match(vp, /유효한 서명/);
  assert.match(vp, /Ed25519/);
});

test("전자서명: 본문 위변조 시 검증 실패", async () => {
  const doc = (await D.listDocuments(env.DB, seocho.id))[0];
  // DB 에서 본문을 몰래 변경 → content_hash 불일치 → contentOk=false
  await env.DB.prepare("UPDATE documents SET body='조작된 내용' WHERE id=?").bind(doc.id).run();
  const sig = (await D.listSignatures(env.DB, doc.id))[0];
  const vp = await (await worker.fetch(new Request(BASE + "/verify/" + sig.verify_code), env)).text();
  assert.match(vp, /위변조 의심/);
});

test("슈퍼: 새 상인회 생성(멀티테넌트) + 격리", async () => {
  const j = jar(); await login(j, "super@p.kr", "super1234");
  let r = await get(j, "/super");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /플랫폼 관리/);
  r = await post(j, "/super/association", { name: "강남 상인회", admin_email: "gadmin@x.kr", admin_password: "admin1234", admin_name: "강남관리자" });
  assert.equal(r.status, 303);
  const gangnam = await D.getAssociationBySlug(env.DB, "강남-상인회");
  assert.ok(gangnam, "새 상인회 생성");
  // 새 상인회 홈 접근
  assert.equal((await worker.fetch(new Request(BASE + "/t/강남-상인회"), env)).status, 200);
  // 격리: 서초 관리자는 강남 관리자 페이지 접근 불가(403)
  const sa = jar(); await login(sa, "admin@s.kr", "admin1234");
  assert.equal((await get(sa, "/t/강남-상인회/admin")).status, 403);
});

test("권한: 비관리자 admin 접근 차단", async () => {
  const j = jar(); await login(j, "a@ex.kr", "merchant1234");
  const r = await get(j, "/t/seocho/admin");
  assert.equal(r.status, 403);
});
