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

test("전체 백업 JSON", async () => {
  const env = makeEnv();
  await seed(env);
  const j = jar();
  await post(env, j, "/login", { email: "adm@s.kr", password: "admin1234" }, "/login");
  // 시작 체크리스트·참여 계측은 뺐다 — 처음 보는 사람에게 화면만 늘렸다
  const adminHtml = await (await get(env, j, "/t/seocho/admin")).text();
  assert.ok(!/시작 체크리스트|참여 계측/.test(adminHtml));
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

test("성능 계측: Server-Timing 헤더 (D1 쿼리 수·시간)", async () => {
  const env = makeEnv();
  await seed(env);
  const r = await get(env, jar(), "/t/seocho");
  const st = r.headers.get("server-timing") || "";
  assert.match(st, /db;dur=\d+;desc="D1 \d+ queries"/);
  assert.match(st, /app;dur=\d+/);
  const n = Number(/D1 (\d+) queries/.exec(st)[1]);
  assert.ok(n > 0 && n < 40, `홈 쿼리 수 상한 확인 — 콜드스타트 DDL 포함 (${n})`);
});

// ── 홈 첫 화면 배경 영상
// 영상은 '있으면 좋은 것'이다. 사진이 poster 로 깔려 있어야 영상이 뜨기 전에도,
// 데이터를 아끼거나 움직임을 꺼 둔 방문자에게도 첫 화면이 비지 않는다.
// 빈 DB 는 첫 실행으로 보고 /setup 으로 보낸다 — 공개 화면을 보려면 계정이 하나 있어야 한다
async function seeded() {
  const e = makeEnv();
  const pw = await hashPassword("x12345678");
  await D.createUser(e.DB, { email: "seed@a.kr", passwordHash: pw.hash, salt: pw.salt, name: "운영", role: "SUPERADMIN", associationId: null });
  return e;
}
const heroOf = async (e, slug) => (await worker.fetch(new Request("https://x.test/t/" + slug + "/"), e, { waitUntil() {}, passThroughOnException() {} })).text();

test("배경 영상을 넣으면 사진이 poster 로 함께 깔린다", async () => {
  const e = await seeded();
  const a = await D.createAssociation(e.DB, { slug: "vid", name: "영상 상인회", kind: "merchant" });
  await D.updateAssociation(e.DB, a.id, { name: a.name, tagline: "", brand_color: "#0a7d40",
    phone: "", email: "", address: "", logo: "", hero_image: "photo.webp", hero_video: "clip.mp4" });
  const html = await heroOf(e, "vid");
  assert.match(html, /<video class="hp-video"[^>]*autoplay[^>]*muted[^>]*loop[^>]*playsinline/, "무음 자동재생 반복이어야 배경으로 쓸 수 있다");
  assert.match(html, /poster="[^"]*photo\.webp"/, "사진이 poster 로 깔려야");
  assert.match(html, /<source src="[^"]*clip\.mp4"/);
  assert.match(html, /class="hero-pro has-photo has-video"/);
});

test("영상이 없으면 예전처럼 사진만 쓴다", async () => {
  const e = await seeded();
  const a = await D.createAssociation(e.DB, { slug: "img", name: "사진 상인회", kind: "merchant" });
  await D.updateAssociation(e.DB, a.id, { name: a.name, tagline: "", brand_color: "#0a7d40",
    phone: "", email: "", address: "", logo: "", hero_image: "photo.webp", hero_video: "" });
  const html = await heroOf(e, "img");
  assert.ok(!/hp-video/.test(html));
  assert.match(html, /hp-photo/);
});

test("따옴표가 섞인 파일명이 와도 배경 속성을 깨뜨리지 않는다", async () => {
  // 파일명에 따옴표가 섞이면 style="background-image:url('…')" 나 poster="…" 가
  // 중간에서 끊기고, 그 뒤가 속성으로 읽힌다. 읽는 자리에서 걷어내는지 본다.
  const e = await seeded();
  const a = await D.createAssociation(e.DB, { slug: "esc", name: "따옴표", kind: "merchant" });
  await D.updateAssociation(e.DB, a.id, { name: a.name, tagline: "", brand_color: "#0a7d40",
    phone: "", email: "", address: "", logo: "", hero_image: `x'"y.webp`, hero_video: `v'"z.mp4` });
  const html = await heroOf(e, "esc");
  const tag = (/<video[^>]*>/.exec(html) || [""])[0];
  assert.ok(tag, "영상 태그가 있어야");
  assert.equal((tag.match(/"/g) || []).length % 2, 0, "속성 따옴표가 짝이 맞아야 (중간에 끊기면 홀수가 된다)");
  assert.ok(!html.includes(`v'"`) && !html.includes(`x'"`), "따옴표가 그대로 나가면 안 된다");
});

// 움직임을 꺼 둔 방문자에게는 영상을 감춘다 — 스타일에 그 장치가 있어야 한다.
test("움직임 최소화 설정이면 영상을 감추는 규칙이 있다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  const block = /@media\s*\(prefers-reduced-motion:reduce\)\s*\{[^}]*\.hp-video\s*\{\s*display:\s*none/;
  assert.match(css, block, "영상을 감추는 규칙이 있어야");
});

// ── 관리 화면 구조: 한 화면에 열두 덩어리가 쏟아지던 것을 하는 일별 묶음으로
// 처음 보는 사람이 "여기서 뭘 해야 하나"를 훑지 않고 고를 수 있어야 한다.
test("관리 화면은 하는 일별 탭으로 나뉜다", async () => {
  const e = await seeded();
  const a = await D.createAssociation(e.DB, { slug: "tabs", name: "탭 상인회", kind: "merchant" });
  const pw = await hashPassword("pass1234");
  await D.createUser(e.DB, { email: "t@a.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const B = "https://x.test";
  const f = (p, i) => worker.fetch(new Request(B + p, i), e, { waitUntil() {}, passThroughOnException() {} });
  const g = await f("/login");
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const lr = await f("/login", { method: "POST", headers: { cookie: seed, origin: B, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: tk, email: "t@a.kr", password: "pass1234" }) });
  const jar = [seed, ...(lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");
  const html = await (await f("/t/tabs/admin", { headers: { cookie: jar } })).text();

  const tabs = [...html.matchAll(/<div class="sgroup" id="s-(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ["home", "people", "content", "notify", "settings"]);
  assert.match(html, /id="consoleNav"/, "탭 장치가 붙을 자리가 있어야");
  assert.match(html, /super-tabs\.js/, "탭 장치를 싣어야");

  // 처음 보면 복잡해 보이던 두 가지는 뺐다
  assert.ok(!/시작 체크리스트/.test(html));
  assert.ok(!/참여 계측/.test(html));

  // 같은 패널이 두 군데 그려지면 어느 쪽이 진짜인지 헷갈린다
  assert.equal((html.match(/id="p-biz"/g) || []).length, 1, "업체 관리가 한 번만");
  assert.equal((html.match(/id="p-brand"/g) || []).length, 1, "브랜딩이 한 번만");
  assert.equal((html.match(/id="p-notify"/g) || []).length, 1, "알림톡이 한 번만");
});

// 파일을 고르면 그 자리에서 미리보기가 바뀌어야 한다 — 저장해야만 바뀌면 제대로 골랐는지 알 수 없다.
test("파일 미리보기 장치가 관리 화면에 실린다", async () => {
  const e = await seeded();
  const a = await D.createAssociation(e.DB, { slug: "pv", name: "미리보기", kind: "merchant" });
  const pw = await hashPassword("pass1234");
  await D.createUser(e.DB, { email: "p@a.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const B = "https://x.test";
  const f = (p, i) => worker.fetch(new Request(B + p, i), e, { waitUntil() {}, passThroughOnException() {} });
  const g = await f("/login");
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const lr = await f("/login", { method: "POST", headers: { cookie: seed, origin: B, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: tk, email: "p@a.kr", password: "pass1234" }) });
  const jar = [seed, ...(lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");
  const html = await (await f("/t/pv/admin", { headers: { cookie: jar } })).text();
  assert.match(html, /file-preview\.js/);
  assert.match(html, /name="hero_image"[^>]*accept="image\/\*"/);
  assert.match(html, /name="hero_video"[^>]*accept="video\/mp4,video\/webm"/);
});
