// 상인회별 개별 도메인(custom_domain) 라우팅 + 슈퍼 설정 + 기존 DB 컬럼 마이그레이션
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv, makeD1 } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { ensureSchema } from "../src/schema.js";

const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, u) { const r = await worker.fetch(new Request(u, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, u, f, csrfFrom) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, csrfFrom)).text()) || [])[1];
  const r = await worker.fetch(new Request(u, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}

test("개별 도메인: 슈퍼가 연결 → 그 도메인으로 홈·로그인 접속", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "서초구 상인회", tagline: "서초 상권" });
  const su = await hashPassword("super1234");
  await D.createUser(env.DB, { email: "super@p.kr", passwordHash: su.hash, salt: su.salt, name: "슈퍼", role: "SUPERADMIN", associationId: null });

  // 슈퍼 로그인 → 도메인 연결
  const j = jar();
  await post(env, j, "http://localhost/login", { email: "super@p.kr", password: "super1234" }, "http://localhost/login");
  let r = await post(env, j, `http://localhost/super/association/${a.id}/domain`, { domain: "https://Seocho-Market.KR/" }, "http://localhost/super");
  assert.equal(r.status, 303);
  assert.equal((await D.getAssociationById(env.DB, a.id)).custom_domain, "seocho-market.kr", "정리(소문자·프로토콜 제거)되어 저장");

  // 그 도메인(호스트)으로 접속 → 상인회 홈
  r = await worker.fetch(new Request("http://seocho-market.kr/"), env);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /서초구 상인회/);
  // 개별 도메인에서 전역 경로(/login) 폴백 동작
  r = await worker.fetch(new Request("http://seocho-market.kr/login"), env);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /로그인/);
  // 미연결 도메인은 플랫폼 루트(단일 상인회 → 리다이렉트)
  r = await worker.fetch(new Request("http://unknown-host.kr/"), env);
  assert.equal(r.status, 303);

  // 중복 연결 차단
  const b = await D.createAssociation(env.DB, { slug: "gangnam", name: "강남 상인회" });
  r = await post(env, j, `http://localhost/super/association/${b.id}/domain`, { domain: "seocho-market.kr" }, "http://localhost/super");
  assert.match(r.headers.get("location"), /err=1/);
});

test("기존 DB(구버전) → custom_domain 컬럼 자동 마이그레이션", async () => {
  const db = makeD1(true); // 빈 DB
  // 구버전 associations 표(컬럼 없음) 시뮬레이션
  await db.prepare("CREATE TABLE associations (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL)").run();
  await ensureSchema(db);
  const cols = (await db.prepare("PRAGMA table_info(associations)").all()).results.map((c) => c.name);
  assert.ok(cols.includes("custom_domain"), "컬럼 자동 추가");
});
