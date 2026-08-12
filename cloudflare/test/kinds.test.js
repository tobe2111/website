// 제품 유형 레지스트리 · 업종 프리셋 · 사이트 복제
// "새 제품을 하나 더 만들 때 열 군데를 고치지 않아도 된다"는 약속을 지키는지 확인한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { KINDS, KIND_KEYS, PRESETS, PRESET_KEYS, kindById, termsOf, presetText } from "../src/kinds.js";
import { defaultLandingLayout } from "../src/franchise.js";
import { seedStarter } from "../src/starterContent.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
async function get(env, j, p, extra = {}) { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j), "user-agent": UA, ...extra } }), env); absorb(j, r); return r; }
// 실제 트래픽은 사람마다 IP 가 다르다. 기본은 요청마다 다른 IP 로 두고,
// 같은 사람의 반복(레이트리밋 검증)을 볼 때만 테스트가 IP 를 고정한다.
let ipSeq = 0;
const nextIp = () => `203.0.113.${(ipSeq++ % 250) + 1}`;
async function post(env, j, p, f, from, extra = {}) {
  const ip = extra["cf-connecting-ip"] || nextIp();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p, { "cf-connecting-ip": ip })).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded", "user-agent": UA, "cf-connecting-ip": ip, ...extra }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
const msgOf = (r) => decodeURIComponent((/[?&]msg=([^&#]*)/.exec(r.headers.get("location") || "") || [])[1] || "");
async function superLogin(env) {
  const su = await hashPassword("super1234");
  await D.createUser(env.DB, { email: "s@p.kr", passwordHash: su.hash, salt: su.salt, name: "슈퍼", role: "SUPERADMIN", associationId: null });
  const j = jar(); await post(env, j, "/login", { email: "s@p.kr", password: "super1234" }); return j;
}

test("레지스트리: 모든 유형이 화면 구성에 필요한 정의를 갖춘다", () => {
  for (const k of KIND_KEYS) {
    const K = KINDS[k];
    assert.equal(K.id, k, `${k}: id 가 키와 같아야`);
    for (const f of ["label", "badge", "orgWord", "home", "nav", "dashTitle", "siteWord", "createHint"])
      assert.ok(K[f], `${k}: ${f} 가 있어야`);
    assert.equal(typeof K.selfRegister, "boolean");
    for (const sw of ["businesses", "dues", "homeLayout", "content", "landing", "leads"])
      assert.equal(typeof K.console[sw], "boolean", `${k}: console.${sw} 스위치가 있어야`);
    // 랜딩을 쓰는 유형만 랜딩 콘솔을 켠다 (한쪽만 켜면 편집기는 있는데 화면이 안 나온다)
    assert.equal(K.usesLanding, K.console.landing, `${k}: usesLanding 과 console.landing 이 일치해야`);
  }
  assert.equal(kindById("없는유형").id, "merchant", "모르는 값은 상인회로 떨어져야");
});

test("업종 프리셋: 문구를 다 안 채워도 대표 프리셋에서 빌려 온다", () => {
  for (const p of PRESET_KEYS) {
    assert.ok(PRESETS[p].label, `${p}: 이름이 있어야`);
    const T = termsOf(p);
    for (const t of ["consult", "unit", "store", "process", "cost"]) assert.ok(T[t], `${p}: terms.${t}`);
    // fitness·clinic 처럼 일부만 쓴 프리셋도 빈 화면이 나오면 안 된다
    const lay = defaultLandingLayout("테스트브랜드", p);
    assert.ok(lay.length >= 12, `${p}: 섹션이 다 서야`);
    for (const sec of lay) assert.ok(sec.type && typeof sec.enabled === "boolean");
    assert.ok(lay.find((x) => x.type === "process").items.includes("|"), `${p}: 절차 문구가 채워져야`);
    assert.ok(lay.find((x) => x.type === "faq").items.includes("|"), `${p}: FAQ 가 채워져야`);
  }
  assert.match(presetText("academy", "hero.title"), /성적/);
  assert.match(presetText("clinic", "faq.items"), /\|/, "안 쓴 항목은 대표 프리셋에서 온다");
});

test("업종을 바꾸면 화면의 말이 바뀐다 (같은 엔진, 다른 제품)", async () => {
  const env = makeEnv();
  const j = await superLogin(env);
  await post(env, j, "/super/association", {
    name: "한빛학원", kind: "franchise", preset: "academy",
    admin_email: "hq@hanbit.kr", admin_password: "admin1234", admin_name: "원장",
  }, "/super");
  const a = (await D.listAllAssociations(env.DB)).find((x) => x.name === "한빛학원");
  assert.equal(a.preset, "academy");
  assert.match(a.tagline, /아이에게 맞는/, "업종 기본 한 줄 소개가 붙어야");
  const html = await (await get(env, jar(), `/t/${a.slug}`)).text();
  assert.match(html, /성적은/);          // 학원 히어로
  assert.match(html, /입학 상담 신청/);   // 학원 용어
  assert.match(html, /등록 절차/);
  assert.match(html, /학년/);            // 예산 칸이 '학년'으로
  assert.doesNotMatch(html, /가맹 상담 신청하기/);
  assert.doesNotMatch(html, /창업 예산/);
});

test("사이트 복제: 껍데기는 따라오고 남의 데이터는 따라오지 않는다", async () => {
  const env = makeEnv();
  const j = await superLogin(env);
  // 원본 — 프랜차이즈 + 캠페인 사본 + 상담 신청 1건 + 회원
  const src = await D.createAssociation(env.DB, { slug: "origin", name: "원본브랜드", kind: "franchise", preset: "fitness" });
  await D.saveLandingLayout(env.DB, src.id, JSON.stringify([{ type: "hero", enabled: true, title: "원본 히어로 문구" }]));
  await D.createLandingVariant(env.DB, { associationId: src.id, slug: "insta", name: "인스타", layout: JSON.stringify([{ type: "hero", enabled: true, title: "사본 문구" }]) });
  await D.createLead(env.DB, { associationId: src.id, name: "원본신청자", phone: "010-1111-2222" });
  const pw = await hashPassword("merchant1234");
  await D.createUser(env.DB, { email: "m@origin.kr", passwordHash: pw.hash, salt: pw.salt, name: "원본회원", role: "MERCHANT", associationId: src.id });

  const r = await post(env, j, "/super/association/clone", {
    source_id: String(src.id), name: "복제브랜드", admin_email: "new@copy.kr", admin_password: "admin1234", admin_name: "새관리자",
  }, "/super");
  assert.match(msgOf(r), /복제|만들었습니다/);
  const made = (await D.listAllAssociations(env.DB)).find((x) => x.name === "복제브랜드");
  assert.ok(made, "복제본이 생겨야");
  // 껍데기: 유형·업종·화면 구성·사본
  assert.equal(made.kind, "franchise");
  assert.equal(made.preset, "fitness");
  assert.match(made.landing_layout, /원본 히어로 문구/);
  assert.equal((await D.listLandingVariants(env.DB, made.id)).length, 1);
  assert.match(await (await get(env, jar(), `/t/${made.slug}`)).text(), /원본 히어로 문구/);
  // 남의 데이터: 상담 신청·회원은 절대 따라오지 않는다
  assert.equal((await D.listLeads(env.DB, made.id)).length, 0);
  assert.equal((await D.listUsersByAssociation(env.DB, made.id, "MERCHANT")).length, 0);
  // 원본은 그대로
  assert.equal((await D.listLeads(env.DB, src.id)).length, 1);
  // 새 관리자로 바로 들어갈 수 있어야
  const j2 = jar(); await post(env, j2, "/login", { email: "new@copy.kr", password: "admin1234" });
  assert.equal((await get(env, j2, `/t/${made.slug}/admin/landing`)).status, 200);
});

test("사이트 복제: 원본이 없거나 이메일이 겹치면 거절한다", async () => {
  const env = makeEnv();
  const j = await superLogin(env);
  const src = await D.createAssociation(env.DB, { slug: "origin", name: "원본", kind: "franchise" });
  assert.match(msgOf(await post(env, j, "/super/association/clone",
    { source_id: "99999", name: "x", admin_email: "a@b.kr", admin_password: "admin1234" }, "/super")), /원본/);
  const pw = await hashPassword("x12345678");
  await D.createUser(env.DB, { email: "dup@b.kr", passwordHash: pw.hash, salt: pw.salt, name: "기존", role: "ADMIN", associationId: src.id });
  assert.match(msgOf(await post(env, j, "/super/association/clone",
    { source_id: String(src.id), name: "새조직", admin_email: "dup@b.kr", admin_password: "admin1234" }, "/super")), /이미 사용 중/);
  assert.equal((await D.listAllAssociations(env.DB)).length, 1, "실패했으면 조직이 생기지 않아야");
});

test("시작 세트: 모집형은 발행된 랜딩과 모집형 공지로 문을 연다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "newbrand", name: "새브랜드", kind: "franchise", preset: "clinic" });
  const r = await seedStarter(env, env.DB, await D.getAssociationById(env.DB, a.id), {});
  assert.equal(r.landing, 1, "랜딩이 발행되어야");
  const after = await D.getAssociationById(env.DB, a.id);
  assert.ok(after.landing_layout, "발행본이 있어야 '초안 버리기'로 돌아갈 자리가 생긴다");
  const notices = await D.listNotices(env.DB, a.id, 10);
  assert.ok(notices.length >= 2);
  assert.match(notices.map((n) => n.title + n.body).join(" "), /진료 상담/);
  assert.doesNotMatch(notices.map((n) => n.title + n.body).join(" "), /회비|입점/, "상인회 공지가 섞이면 안 된다");
});

test("슈퍼 콘솔: 유형·업종 선택지가 레지스트리에서 자동으로 나온다", async () => {
  const env = makeEnv();
  const j = await superLogin(env);
  const html = await (await get(env, j, "/super")).text();
  for (const k of KIND_KEYS) assert.match(html, new RegExp(`value="${k}"`), `${k} 선택지가 있어야`);
  for (const p of PRESET_KEYS) assert.match(html, new RegExp(`value="${p}"`), `${p} 업종이 있어야`);
  assert.match(html, /기존 사이트 복제해서 만들기/);
});
