// 바깥 홈페이지(병원 사이트 등)에서 오는 상담 신청 — /lead-in/:slug
//
// 우리 화면의 폼이 아니라 CSRF 토큰이 없다. 그래서 '등록된 주소에서 온 것만' 받는 문이 유일한 문턱이고,
// 그 문이 열려 있으면 아무 사이트나 우리 고객의 상담 DB 에 글을 쏟아부을 수 있다. 문이 닫혀 있는지를 본다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { normalizeOrigin } from "../src/api.js";

const B = "http://localhost";
let ipSeq = 0;
// 계정이 하나도 없으면 엔진이 모든 요청을 설치 화면(/setup)으로 보낸다 — 운영 중인 상태를 흉내 낸다
async function makeLiveEnv() {
  const env = makeEnv();
  await D.createUser(env.DB, { email: "s@p.kr", passwordHash: "x", salt: "x", name: "운영", role: "SUPERADMIN", associationId: null });
  return env;
}
async function setup() {
  const env = await makeLiveEnv();
  const a = await D.createAssociation(env.DB, { slug: "cheonsaem", name: "천샘정형외과", kind: "franchise", preset: "clinic" });
  await D.setSetting(env.DB, `lead_origins:${a.id}`, "https://www.cheonsaem.example");
  return { env, a };
}
function send(env, slug, fields, { origin = "https://www.cheonsaem.example", ip } = {}) {
  const headers = { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": ip || `198.51.100.${(ipSeq++ % 250) + 1}` };
  if (origin) headers.origin = origin;
  return worker.fetch(new Request(`${B}/lead-in/${slug}`, { method: "POST", headers, body: new URLSearchParams(fields).toString() }), env);
}
const OK = { name: "김환자", phone: "010-1234-5678", budget: "무릎·발목", region: "평일 오후", message: "계단 내려갈 때 무릎이 아파요", agree: "1" };

test("등록된 병원 홈페이지에서 온 신청은 상담 DB 에 들어가고, 그 홈페이지로 돌아간다", async () => {
  const { env, a } = await setup();
  const r = await send(env, "cheonsaem", OK);
  assert.equal(r.status, 303);
  const loc = r.headers.get("location");
  assert.ok(loc.startsWith("https://www.cheonsaem.example/reservation/?sent="), loc);
  const leads = await D.listLeads(env.DB, a.id, { limit: 10 });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].budget, "무릎·발목");
  assert.equal(leads[0].region, "평일 오후");
});

test("등록하지 않은 주소에서 온 신청은 받지 않는다", async () => {
  const { env, a } = await setup();
  for (const origin of ["https://evil.example", "http://www.cheonsaem.example", ""]) {
    const r = await send(env, "cheonsaem", OK, { origin });
    assert.equal(r.status, 403, `origin=${origin || "(없음)"}`);
  }
  assert.equal((await D.listLeads(env.DB, a.id, { limit: 10 })).length, 0);
});

test("돌아갈 화면은 등록된 주소 안의 경로만 — 남의 사이트로 튕기지 않는다", async () => {
  const { env } = await setup();
  for (const ret of ["//evil.example/x", "https://evil.example/", "javascript:alert(1)"]) {
    const loc = (await send(env, "cheonsaem", { ...OK, phone: `010-55${ipSeq}-0000`, return: ret })).headers.get("location");
    assert.ok(loc.startsWith("https://www.cheonsaem.example/reservation/"), `${ret} → ${loc}`);
  }
});

test("동의 없음·허니팟·GET·없는 조직은 저장하지 않는다", async () => {
  const { env, a } = await setup();
  const noAgree = await send(env, "cheonsaem", { ...OK, agree: "" });
  assert.match(noAgree.headers.get("location"), /\?err=/);
  await send(env, "cheonsaem", { ...OK, website: "http://spam" }); // 봇에게는 성공처럼 보이지만 저장하지 않는다
  assert.equal((await D.listLeads(env.DB, a.id, { limit: 10 })).length, 0);
  assert.equal((await worker.fetch(new Request(`${B}/lead-in/cheonsaem`), env)).status, 405);
  assert.equal((await send(env, "nope", OK)).status, 404);
});

test("상인회(랜딩을 쓰지 않는 조직)는 바깥 신청을 받지 않는다", async () => {
  const env = await makeLiveEnv();
  const m = await D.createAssociation(env.DB, { slug: "market", name: "상인회", kind: "merchant" });
  await D.setSetting(env.DB, `lead_origins:${m.id}`, "https://www.cheonsaem.example");
  assert.equal((await send(env, "market", OK)).status, 404);
});

test("주소 정리: https 만, 경로는 떼고, localhost 는 개발용으로 허용", () => {
  assert.equal(normalizeOrigin("https://www.a.kr/reservation/"), "https://www.a.kr");
  assert.equal(normalizeOrigin("http://www.a.kr"), "");
  assert.equal(normalizeOrigin("http://localhost:8790"), "http://localhost:8790");
  assert.equal(normalizeOrigin("javascript:alert(1)"), "");
  assert.equal(normalizeOrigin("아무말"), "");
});
