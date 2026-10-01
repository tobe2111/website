// 조직 개설 — "버튼 한 번으로 바로 쓸 수 있는 사이트가 나오는가"
//
// 개설 화면에서 받은 것이 **그 자리에서 쓰이는지**를 본다.
// 연락처를 받아 놓고 시작 공지에 안 넣으면, 손님이 보는 첫 공지에 전화번호가 없다.
// 간편동의서 주소를 안내에 안 넣으면, 상인회는 명단 만들기를 어디서 시작하는지 모른다.
// 복제본에 원본 번호가 따라오면 남의 사무실로 전화가 간다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
let ipSeq = 0;
const nextIp = () => `203.0.113.${(ipSeq++ % 250) + 1}`;
async function get(env, j, p) { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j), "cf-connecting-ip": nextIp() } }), env); absorb(j, r); return r; }
async function post(env, j, p, f, from) {
  const ip = nextIp();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": ip }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
const msgOf = (r) => decodeURIComponent((/[?&]msg=([^&#]*)/.exec(r.headers.get("location") || "") || [])[1] || "");
async function superLogin(env) {
  const su = await hashPassword("super1234");
  await D.createUser(env.DB, { email: "s@p.kr", passwordHash: su.hash, salt: su.salt, name: "슈퍼", role: "SUPERADMIN", associationId: null });
  const j = jar(); await post(env, j, "/login", { email: "s@p.kr", password: "super1234" }); return j;
}
const found = async (env, name) => (await D.listAllAssociations(env.DB)).find((x) => x.name === name);
const noticesOf = async (env, aid) => (await env.DB.prepare("SELECT title, body FROM notices WHERE association_id=?").bind(aid).all()).results;

test("개설: 입력한 대표 전화가 시작 공지 안에 들어간다", async () => {
  const env = makeEnv();
  const j = await superLogin(env);
  const r = await post(env, j, "/super/association", {
    name: "서초제일상인회", admin_email: "a@seocho.kr", admin_password: "admin1234",
    phone: "02-586-1234", org_email: "Office@Seocho.KR", address: "서울 서초구 방배로 11",
  }, "/super");
  assert.match(msgOf(r), /생성되었습니다/);
  const made = await found(env, "서초제일상인회");
  assert.ok(made);
  // 연락처가 조직에 저장되고, 이메일은 소문자로 눕는다
  assert.equal(made.phone, "02-586-1234");
  assert.equal(made.email, "office@seocho.kr");
  assert.equal(made.address, "서울 서초구 방배로 11");
  // 그리고 **시작 공지 본문에 그 번호가 박혀 있어야** 한다 — 이게 이 기능의 전부다
  const ns = await noticesOf(env, made.id);
  assert.ok(ns.length >= 1, "시작 공지가 들어가야");
  assert.ok(ns.some((n) => n.body.includes("02-586-1234")), "공지에 대표 전화가 인용되어야");
});

test("개설: 연락처를 비워도 개설은 되고 공지는 번호 없이 나간다", async () => {
  const env = makeEnv();
  const j = await superLogin(env);
  await post(env, j, "/super/association", { name: "번호없는상인회", admin_email: "a@n.kr", admin_password: "admin1234" }, "/super");
  const made = await found(env, "번호없는상인회");
  assert.ok(made);
  assert.equal(made.phone, "");
  const ns = await noticesOf(env, made.id);
  assert.ok(ns.length >= 1);
  assert.ok(ns.every((n) => !/사무실\(\)/.test(n.body)), "빈 괄호가 공지에 나오면 안 된다");
});

test("개설: 안내에 적힌 간편동의서 주소가 실제로 열린다", async () => {
  const env = makeEnv();
  const j = await superLogin(env);
  const msg = msgOf(await post(env, j, "/super/association", {
    name: "동의서상인회", admin_email: "a@c.kr", admin_password: "admin1234",
  }, "/super"));
  const link = (/(\/t\/[\w-]+\/consent\/[0-9a-f]+)/.exec(msg) || [])[1];
  assert.ok(link, `안내에 간편동의서 주소가 있어야: ${msg}`);
  const r = await get(env, jar(), link);
  assert.equal(r.status, 200, "안내에 적힌 주소는 열려야 한다");
  const html = await r.text();
  assert.match(html, /동의서상인회/);
  assert.match(html, /noindex/, "공개 동의서 화면은 검색에 걸리지 않아야");
});

test("개설: 전자계약 조직에는 간편동의서를 만들지 않는다", async () => {
  const env = makeEnv();
  const j = await superLogin(env);
  const msg = msgOf(await post(env, j, "/super/association", {
    name: "법무법인가나", admin_email: "a@law.kr", admin_password: "admin1234", kind: "esign",
  }, "/super"));
  assert.doesNotMatch(msg, /간편동의서/, "점포가 없는 조직에 점포 명단용 링크를 쥐여 주면 안 된다");
  const made = await found(env, "법무법인가나");
  assert.equal((await D.listConsentForms(env.DB, made.id)).length, 0);
});

test("복제: 색상은 체크를 켜 두면 원본 그대로, 풀면 고른 색", async () => {
  const env = makeEnv();
  const j = await superLogin(env);
  const src = await D.createAssociation(env.DB, { slug: "origin", name: "원본상인회", brandColor: "#123456" });
  // 체크를 켠 채로 보내면 화면의 색 선택기 기본값(#0b6e4f)이 함께 올라오지만 무시된다
  await post(env, j, "/super/association/clone", {
    source_id: String(src.id), name: "색유지본", admin_email: "a@k.kr", admin_password: "admin1234",
    keep_color: "1", brand_color: "#0b6e4f",
  }, "/super");
  assert.equal((await found(env, "색유지본")).brand_color, "#123456", "체크를 켜면 원본 색이어야");
  // 체크를 풀면 고른 색이 적용된다
  await post(env, j, "/super/association/clone", {
    source_id: String(src.id), name: "색변경본", admin_email: "b@k.kr", admin_password: "admin1234",
    brand_color: "#ff8800",
  }, "/super");
  assert.equal((await found(env, "색변경본")).brand_color, "#ff8800", "체크를 풀면 고른 색이어야");
});

test("복제: 원본 연락처는 따라오지 않고, 입력한 연락처가 공지에 들어간다", async () => {
  const env = makeEnv();
  const j = await superLogin(env);
  const src = await D.createAssociation(env.DB, { slug: "origin", name: "방배카페골목상인회" });
  await D.setAssociationContact(env.DB, src.id, { phone: "02-111-1111", email: "old@a.kr", address: "서울 서초구 방배동 1" });
  await post(env, j, "/super/association/clone", {
    source_id: String(src.id), name: "양재천상인회", admin_email: "a@y.kr", admin_password: "admin1234",
    phone: "02-999-8888", address: "서울 서초구 양재천로 22",
  }, "/super");
  const made = await found(env, "양재천상인회");
  assert.equal(made.phone, "02-999-8888");
  assert.equal(made.address, "서울 서초구 양재천로 22");
  assert.equal(made.email, "", "안 넣은 칸은 원본에서 끌어오지 않는다");
  const ns = await noticesOf(env, made.id);
  assert.ok(ns.some((n) => n.body.includes("02-999-8888")), "복제본 공지도 새 번호를 인용해야");
  assert.ok(ns.every((n) => !n.body.includes("02-111-1111")), "원본 번호가 복제본 공지에 남으면 남의 사무실로 전화가 간다");
});

test("복제: 안내에 적힌 동의서 주소는 복제본의 것이고 원본과 다르다", async () => {
  const env = makeEnv();
  const j = await superLogin(env);
  const src = await D.createAssociation(env.DB, { slug: "origin", name: "원본상인회" });
  await D.createConsentForm(env.DB, { associationId: src.id, token: "aaaaaaaaaaa", title: "가입 동의서", body: "본문", askAddress: 1 });
  const msg = msgOf(await post(env, j, "/super/association/clone", {
    source_id: String(src.id), name: "복제상인회", admin_email: "a@c2.kr", admin_password: "admin1234",
  }, "/super"));
  const link = (/(\/t\/[\w-]+\/consent\/([0-9a-f]+))/.exec(msg) || []);
  assert.ok(link[1], `안내에 간편동의서 주소가 있어야: ${msg}`);
  assert.notEqual(link[2], "aaaaaaaaaaa", "원본에 뿌려 둔 주소가 복제본으로 열려선 안 된다");
  const made = await found(env, "복제상인회");
  assert.match(link[1], new RegExp(`^/t/${made.slug}/consent/`));
  const r = await get(env, jar(), link[1]);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /복제상인회/);
});

// ---- 개설 직후의 첫 화면 ----
// 문을 막 연 상인회의 관리 화면이 "지금 처리할 일이 없습니다" 를 띄우면
// 그게 이 제품에서 가장 큰 거짓말이다. 할 일이 없는 게 아니라 가장 중요한 일이
// 아직 시작도 안 된 상태다. 그리고 사장님이 적어 보낸 동의가 쌓여 있는데도
// 첫 화면이 조용하면 총무는 그게 와 있는 줄도 모른다.
async function adminOf(env, aid, email) {
  const pw = await hashPassword("admin1234");
  await D.createUser(env.DB, { email, passwordHash: pw.hash, salt: pw.salt, name: "총무", role: "ADMIN", associationId: aid });
  const j = jar(); await post(env, j, "/login", { email, password: "admin1234" }); return j;
}

test("첫 화면: 점포가 0곳이면 '할 일 없음' 대신 첫 단추를 띄운다", async () => {
  const env = makeEnv();
  const su = await superLogin(env);
  await post(env, su, "/super/association", { name: "갓개설상인회", admin_email: "x@g.kr", admin_password: "admin1234" }, "/super");
  const a = await found(env, "갓개설상인회");
  const j = await adminOf(env, a.id, "chief@g.kr");
  const html = await (await get(env, j, `/t/${a.slug}/admin`)).text();
  assert.doesNotMatch(html, /지금 처리할 일이 없습니다/, "문을 막 연 상인회에 '할 일 없음'은 거짓이다");
  assert.match(html, /첫 단추/);
  assert.match(html, /점포 명단/);
  // 개설 때 함께 만들어진 동의서 주소가 첫 화면에 그대로 보여야 한다 — 복사해서 바로 뿌릴 수 있게
  const forms = await D.listConsentForms(env.DB, a.id);
  assert.equal(forms.length, 1);
  assert.ok(html.includes(`/consent/${forms[0].token}`), "첫 화면에 동의서 주소가 보여야");
});

test("첫 화면: 점포가 생기면 첫 단추는 사라진다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "run", name: "운영중상인회" });
  const mp = await hashPassword("owner1234");
  const owner = await D.createUser(env.DB, { email: "owner@run.kr", passwordHash: mp.hash, salt: mp.salt, name: "사장님", role: "MERCHANT", associationId: a.id });
  await D.createBusiness(env.DB, { associationId: a.id, ownerId: owner.id, name: "김밥천국", category: "음식점" });
  const j = await adminOf(env, a.id, "chief@run.kr");
  const html = await (await get(env, j, `/t/${a.slug}/admin`)).text();
  assert.doesNotMatch(html, /첫 단추/, "이미 점포가 있으면 개설 안내가 계속 뜨면 안 된다");
});

test("첫 화면: 들어온 간편동의서가 오늘 할 일로 올라온다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "inbox", name: "동의들어온상인회" });
  const f = await D.createConsentForm(env.DB, { associationId: a.id, token: "bbbbbbbbbbb", title: "가입 동의서", body: "본문", askAddress: 1 });
  await D.createConsent(env.DB, { formId: f.id, associationId: a.id, bizName: "방배김밥", name: "홍길동", phone: "01012345678", bodyHash: "h" });
  const j = await adminOf(env, a.id, "chief@inbox.kr");
  const html = await (await get(env, j, `/t/${a.slug}/admin`)).text();
  assert.match(html, /들어온 간편동의서/);
  assert.match(html, /방배김밥/, "어느 가게가 보냈는지가 첫 화면에 보여야");
  assert.match(html, /010-1234-5678/, "전화번호는 걸 수 있는 모양으로");
  // 첫 화면에서 눈 감고 승인하게 만들면 안 된다 — 승인은 서명을 본 뒤에 하는 일이다
  assert.doesNotMatch(html.split("들어온 간편동의서")[1].slice(0, 1500), /consent\/\d+\/approve/,
    "첫 화면에 승인 버튼을 두면 서명을 안 보고 누른다");
  // 동의가 들어와 있으면 '첫 단추' 는 양보한다 (같은 말 두 번 하지 않는다)
  assert.doesNotMatch(html, /첫 단추/);
});

test("첫 화면: 전자계약 조직에는 동의서 이야기가 나오지 않는다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "law", name: "법무법인다라", kind: "esign" });
  const j = await adminOf(env, a.id, "chief@law.kr");
  const html = await (await get(env, j, `/t/${a.slug}/admin`)).text();
  assert.doesNotMatch(html, /첫 단추|들어온 간편동의서/, "점포가 없는 제품에 점포 명단 이야기는 소음이다");
});
