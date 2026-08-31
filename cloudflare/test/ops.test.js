// 운영 고도화: 자동 백업(암호화)·초성 검색·행사 ics·부관리자·서명 메일 가드
import { test } from "node:test";
import assert from "node:assert/strict";
import { CRON } from "../src/scheduled.js";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { decryptBackup } from "../src/scheduled.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, p) { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
async function seed(env) {
  const su = await hashPassword("super1234");
  await D.createUser(env.DB, { email: "s@p.kr", passwordHash: su.hash, salt: su.salt, name: "슈퍼", role: "SUPERADMIN", associationId: null });
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "서초구 상인회" });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@s.kr", passwordHash: ad.hash, salt: ad.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const ev = await D.createEvent(env.DB, { associationId: a.id, title: "가을 골목축제", description: "먹거리 장터", event_date: "2026-10-10", place: "서초대로 일대" });
  return { a, ev };
}

test("주간 백업: scheduled → R2 에 암호화 저장, 복호화하면 원본 테이블 포함", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const waits = [];
  await worker.scheduled({ cron: CRON.weekly }, env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const manifest = JSON.parse(new TextDecoder().decode(await (await env.MEDIA.get("backups/index.json")).arrayBuffer()));
  assert.equal(manifest.length, 1);
  const enc = await (await env.MEDIA.get(manifest[0])).arrayBuffer();
  // 평문 저장 금지 확인 (공개 버킷 대비)
  assert.doesNotMatch(new TextDecoder().decode(enc.slice ? enc : enc), /서초구 상인회/);
  const json = JSON.parse(await decryptBackup("test-secret-cf", new Uint8Array(enc)));
  assert.equal(json.tables.associations[0].name, "서초구 상인회");
  assert.ok(Array.isArray(json.tables.users));
  assert.ok(Array.isArray(json.tables.coupons));
});

test("행사 ics: 캘린더 파일 + 카드에 추가 버튼", async () => {
  const env = makeEnv();
  const { ev } = await seed(env);
  const page = await (await get(env, jar(), "/t/seocho/events")).text();
  assert.match(page, /calendar\.ics/);
  const r = await worker.fetch(new Request(B + `/t/seocho/events/${ev.id}/calendar.ics`), env);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/calendar/);
  const ics = await r.text();
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261010/);
  assert.match(ics, /SUMMARY:가을 골목축제/);
  // 다른 상인회 행사는 404
  const b = await D.createAssociation(env.DB, { slug: "other", name: "다른회" });
  const r2 = await worker.fetch(new Request(B + `/t/other/events/${ev.id}/calendar.ics`), env);
  assert.equal(r2.status, 404);
});

test("초성 검색: 홈에 suggest.js 로드 + datalist 유지(폴백)", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const pw = await hashPassword("merchant1234");
  const u = await D.createUser(env.DB, { email: "m@x.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const biz = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "홍가네분식", category: "음식점" });
  await D.setBusinessStatus(env.DB, biz.id, "approved");
  const h = await (await get(env, jar(), "/t/seocho")).text();
  assert.match(h, /js\/suggest\.js/);
  assert.match(h, /datalist id="storeSuggest"/);
});

test("부관리자: 발급 → 새 관리자로 /admin 접근 가능", async () => {
  const env = makeEnv();
  await seed(env);
  const j = jar(); await post(env, j, "/login", { email: "a@s.kr", password: "admin1234" });
  const r = await post(env, j, "/t/seocho/admin/admins/add", { name: "총무", email: "cfo@s.kr" }, "/t/seocho/admin");
  assert.equal(r.status, 303);
  const temp = (/임시비번 (\w+)/.exec(decodeURIComponent(r.headers.get("location"))) || [])[1];
  assert.ok(temp, "임시 비번 발급");
  assert.equal((await D.getUserByEmail(env.DB, "cfo@s.kr")).role, "ADMIN");
  const j2 = jar(); await post(env, j2, "/login", { email: "cfo@s.kr", password: temp });
  const adm = await get(env, j2, "/t/seocho/admin");
  assert.equal(adm.status, 200);
  assert.match(await adm.text(), /상인회 관리/);   // "대시보드" 는 이 화면을 쓰는 사람의 말이 아니다
});

test("서명 문서 생성: 이메일 미설정이어도 정상 동작(발송 생략)", async () => {
  const env = makeEnv(); // RESEND 없음 → emailEnabled false
  await seed(env);
  const pw = await hashPassword("merchant1234");
  await D.createUser(env.DB, { email: "m@x.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장", role: "MERCHANT", associationId: (await D.getAssociationBySlug(env.DB, "seocho")).id });
  const j = jar(); await post(env, j, "/login", { email: "a@s.kr", password: "admin1234" });
  const r = await post(env, j, "/t/seocho/admin/documents", { title: "가을 협약", body: "동의합니다", target: "all" }, "/t/seocho/admin/documents");
  assert.equal(r.status, 303);
  const loc = decodeURIComponent(r.headers.get("location"));
  assert.match(loc, /문서를 만들었습니다/);
  // 목록이 아니라 그 문서로 보내야 한다 — 서명 링크가 거기 있다
  assert.match(loc, /\/t\/seocho\/admin\/documents\/\d+\?/);
  assert.match(loc, /보내기 · 복사/, "발송 수단이 없으면 어떻게 전달하는지 알려줘야");
});

// 새 표를 만들고 백업 목록에 넣는 걸 잊으면, 복원할 때가 되어서야 안다.
// 스키마와 백업 목록이 어긋나는 순간 여기서 걸린다.
test("백업 목록이 스키마의 모든 표를 덮는다", async () => {
  const { TABLES, BACKUP_SKIP } = await import("../src/scheduled.js");
  const env = makeEnv();
  const all = env.DB._db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map((r) => r.name);
  const missing = all.filter((t) => !TABLES.includes(t) && !BACKUP_SKIP.includes(t));
  assert.deepEqual(missing, [], `백업에서 빠진 표: ${missing.join(", ")} — TABLES 에 넣거나 BACKUP_SKIP 에 사유와 함께 적으세요`);
  const ghost = TABLES.filter((t) => !all.includes(t));
  assert.deepEqual(ghost, [], `스키마에 없는 표가 백업 목록에 있음: ${ghost.join(", ")}`);
  // 돈·계약·주소는 반드시 백업된다
  for (const t of ["signatures", "doc_fields", "doc_field_values", "credit_ledger", "credit_orders", "slug_aliases"])
    assert.ok(TABLES.includes(t), `${t} 는 반드시 백업 대상이어야 함`);
});
