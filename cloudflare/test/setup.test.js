// 원클릭 배포: 자동 스키마 생성 + 설치 마법사 + 자동 세션 시크릿
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";

const BASE = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, p) { const r = await worker.fetch(new Request(BASE + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, p, f) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/setup")).text()) || [])[1];
  const r = await worker.fetch(new Request(BASE + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}

test("빈 D1: 표 자동 생성 + 계정 없으면 /setup 리다이렉트 + 설치 → 로그인 가능", async () => {
  // bare=true → 스키마 미적용 상태의 D1 (배포 직후 상황)
  const env = makeEnv({ bare: true, SESSION_SECRET: "" });

  // 첫 요청: 표 자동 생성되고, 계정이 없어 /setup 으로
  const j = jar();
  let r = await worker.fetch(new Request(BASE + "/"), env);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/setup");
  // 표가 실제로 생성됐는지
  const tables = await D.all(env.DB, "SELECT name FROM sqlite_master WHERE type='table'");
  assert.ok(tables.some((t) => t.name === "associations"), "associations 표 자동 생성");
  assert.ok(tables.some((t) => t.name === "settings"), "settings 표 자동 생성");

  // 설치 폼 노출
  r = await get(env, j, "/setup");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /첫 설정/);

  // 설치 제출
  r = await post(env, j, "/setup", { assoc_name: "서초구 상인회", admin_email: "admin@s.kr", admin_password: "admin1234", super_email: "super@p.kr", super_password: "super1234" });
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /\/login/);

  // 계정·상인회 생성 확인
  assert.equal(await D.countUsers(env.DB), 2);
  assert.ok(await D.getAssociationBySlug(env.DB, "seochogu"), "상인회 생성");
  assert.equal((await D.getUserByEmail(env.DB, "super@p.kr")).role, "SUPERADMIN");

  // 세션 시크릿이 DB 에 자동 저장됐는지
  assert.ok(await D.getSetting(env.DB, "session_secret"), "세션 시크릿 자동 생성·저장");

  // 이제 홈 정상(더 이상 /setup 리다이렉트 아님)
  assert.equal((await worker.fetch(new Request(BASE + "/t/seochogu"), env)).status, 200);

  // 로그인 동작 (자동 생성된 시크릿으로 세션 서명·검증)
  const j2 = jar();
  const t2 = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j2, "/login")).text()) || [])[1];
  r = await worker.fetch(new Request(BASE + "/login", { method: "POST", headers: { cookie: ch(j2), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t2, email: "admin@s.kr", password: "admin1234" }).toString() }), env);
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /\/admin/);

  // 설치 후 /setup 재접근 시 잠김
  assert.match(await (await get(env, jar(), "/setup")).text(), /이미 설정/);
});

test("전자서명 키도 자동 생성(env 미설정)", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "s", name: "S" });
  const { hashPassword } = await import("../src/crypto.js");
  const ad = await hashPassword("admin1234");
  const u = await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: ad.hash, salt: ad.salt, name: "관리자", role: "ADMIN", associationId: a.id });
  // 서명 문서 생성 + 서명 → 키가 DB 에 자동 생성되어 봉인/검증까지 동작
  const { contentHash, sealRecord, verifySignature } = await import("../src/esign.js");
  const doc = await D.createDocument(env.DB, { associationId: a.id, title: "T", body: "본문", contentHash: await contentHash("본문"), createdBy: u.id });
  const rec = { documentId: doc.id, userId: u.id, signerName: "관리자", contentHash: doc.content_hash, signedAt: "2026-01-01T00:00:00Z", ip: "1.1.1.1" };
  const sealed = await sealRecord(env, rec);
  const sig = { document_id: doc.id, user_id: u.id, signer_name: "관리자", content_hash: doc.content_hash, signed_at: rec.signedAt, ip: rec.ip, record_hash: sealed, prev_hash: "", fields_hash: "", seal_ver: 3 };
  const v = await verifySignature(env, sig, doc);
  assert.equal(v.valid, true, "자동 생성 키로 봉인·검증 성공");
  assert.ok(await D.getSetting(env.DB, "sign_key"), "서명 키 DB 저장");
});
