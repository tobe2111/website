// 개선 4종: 카톡 OG 태그 · 이메일 비번 재설정 · 전체 백업 · 온보딩 체크리스트
import { test, after } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

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

// Resend API 스텁 (발송 메일 캡처)
const realFetch = globalThis.fetch;
const outbox = [];
globalThis.fetch = async (input, init) => {
  const u = typeof input === "string" ? input : input.url;
  if (u.startsWith("https://api.resend.com/")) {
    outbox.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "test" }), { status: 200 });
  }
  return realFetch(input, init);
};
after(() => { globalThis.fetch = realFetch; });

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "서초 상인회" });
  const pw = await hashPassword("merchant1234");
  const u = await D.createUser(env.DB, { email: "hong@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "홍사장", role: "MERCHANT", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "홍가네분식", category: "음식점" });
  await D.setBusinessStatus(env.DB, b.id, "approved");
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "adm@s.kr", passwordHash: ad.hash, salt: ad.salt, name: "총무", role: "ADMIN", associationId: a.id });
  return { a, u, b };
}

test("OG 태그: 홈·업체 상세에 카톡 미리보기 메타 출력", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const home = await (await get(env, jar(), "/t/seocho")).text();
  assert.match(home, /property="og:title"/);
  assert.match(home, /property="og:site_name" content="서초 상인회"/);
  // 업체 상세: 사진 있으면 og:image 절대 URL
  await D.addMedia(env.DB, { businessId: b.id, kind: "image", filename: "test.webp", size: 10 });
  const detail = await (await get(env, jar(), `/t/seocho/business/${b.slug}`)).text();
  assert.match(detail, /property="og:image" content="http:\/\/localhost\/media\/test\.webp"/);
});

test("이메일 재설정: 링크 발송 → 토큰으로 새 비밀번호 설정 → 로그인", async () => {
  const env = makeEnv({ RESEND_API_KEY: "re_test", MAIL_FROM: "테스트 <no-reply@t.kr>" });
  await seed(env);
  outbox.length = 0;
  let r = await post(env, jar(), "/forgot", { email: "hong@s.kr" });
  assert.match(decodeURIComponent(r.headers.get("location")), /재설정 링크를 보냈습니다/);
  assert.equal(outbox.length, 1, "메일 1통 발송");
  const link = /href="([^"]*\/reset\?token=[^"]+)"/.exec(outbox[0].html)[1];
  const token = new URL(link).searchParams.get("token");
  // 새 비밀번호 설정
  const j = jar();
  r = await post(env, j, "/reset", { token, password: "newpass9999" }, "/reset?token=" + encodeURIComponent(token));
  assert.equal(r.status, 303);
  assert.match(decodeURIComponent(r.headers.get("location")), /변경되었습니다/);
  // 새 비번 로그인 OK
  r = await post(env, jar(), "/login", { email: "hong@s.kr", password: "newpass9999" }, "/login");
  assert.match(r.headers.get("location") || "", /dashboard/);
  // 위조 토큰 거부
  r = await post(env, jar(), "/reset", { token: token.slice(0, -2) + "xx", password: "hacked9999" }, "/forgot");
  assert.match(decodeURIComponent(r.headers.get("location")), /만료되었거나 올바르지 않습니다/);
});

test("이메일 미설정 폴백: 관리자 알림 경로 유지", async () => {
  const env = makeEnv(); // 키 없음
  await seed(env);
  const r = await post(env, jar(), "/forgot", { email: "hong@s.kr" });
  assert.match(decodeURIComponent(r.headers.get("location")), /관리자가 확인 후/);
});

test("전체 백업 JSON + 온보딩 체크리스트", async () => {
  const env = makeEnv();
  await seed(env);
  const j = jar();
  await post(env, j, "/login", { email: "adm@s.kr", password: "admin1234" }, "/login");
  // 온보딩: 소개·공지 미완료 → 체크리스트 노출
  const adminHtml = await (await get(env, j, "/t/seocho/admin")).text();
  assert.match(adminHtml, /시작 체크리스트/);
  // 백업 JSON
  const r = await get(env, j, "/t/seocho/admin/export.json");
  assert.equal(r.status, 200);
  const dump = JSON.parse(await r.text());
  assert.equal(dump.association.slug, "seocho");
  assert.equal(dump.counts.businesses, 1);
  assert.equal(dump.members[0].email, "hong@s.kr");
});

test("자산 캐시버스터: CSS/JS 주소에 배포 버전 부착 + 캐시 헤더", async () => {
  const env = makeEnv({ CF_VERSION_METADATA: { id: "deploy1234abcd" } });
  await seed(env);
  const h = await (await get(env, jar(), "/t/seocho")).text();
  assert.match(h, /\/css\/app\.css\?v=deploy123/);
  assert.match(h, /\/js\/app\.js\?v=deploy123/);
  // 버전 주소 = 불변 캐시, 무버전 = 재검증
  const va = await worker.fetch(new Request(B + "/css/app.css?v=deploy1234"), env);
  assert.match(va.headers.get("cache-control") || "", /immutable/);
  const nv = await worker.fetch(new Request(B + "/css/app.css"), env);
  assert.equal(nv.headers.get("cache-control"), "no-cache");
});

test("플로우: 승인 순간 → 사장님 메일 + 대시보드 축하 배너 + 채우기 체크리스트", async () => {
  const env = makeEnv({ RESEND_API_KEY: "re_test", MAIL_FROM: "테스트 <no-reply@t.kr>" });
  const a = await D.createAssociation(env.DB, { slug: "s2", name: "S2상인회" });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "adm2@s.kr", passwordHash: ad.hash, salt: ad.salt, name: "총무", role: "ADMIN", associationId: a.id });
  // 사장님 셀프 가입 (승인 대기)
  const jm = jar();
  await post(env, jm, "/t/s2/register", { name: "김사장", email: "kim2@s.kr", password: "merchant1234", business_name: "김분식", category: "음식점", agree: "1" }, "/t/s2/register");
  const biz = await D.getBusinessByOwner(env.DB, (await D.getUserByEmail(env.DB, "kim2@s.kr")).id);
  // 대시보드: 채우기 체크리스트 노출 (0/4)
  let dash = await (await get(env, jm, "/t/s2/dashboard")).text();
  assert.match(dash, /우리 가게 채우기/);
  assert.ok(!dash.includes("approve-banner"), "승인 전엔 배너 없음");
  // 관리자 승인 → 메일 발송
  outbox.length = 0;
  const ja = jar();
  await post(env, ja, "/login", { email: "adm2@s.kr", password: "admin1234" }, "/login");
  const r = await post(env, ja, `/t/s2/admin/business/${biz.id}/status`, { status: "approved" }, "/t/s2/admin");
  assert.equal(r.status, 303);
  assert.equal(outbox.length, 1, "승인 메일 1통");
  assert.match(outbox[0].subject, /공개되었습니다/);
  assert.equal(outbox[0].to[0], "kim2@s.kr");
  // 대시보드에 축하 배너
  dash = await (await get(env, jm, "/t/s2/dashboard")).text();
  assert.match(dash, /가게가 공개되었습니다/);
  // 재승인(동일 상태 변경) 시 메일 중복 발송 없음
  outbox.length = 0;
  await post(env, ja, `/t/s2/admin/business/${biz.id}/status`, { status: "approved" }, "/t/s2/admin");
  assert.equal(outbox.length, 0, "중복 메일 없음");
});
