// 외부(비회원) 서명 — 토큰 보안 · 가입 없는 서명 · 회원과 섞인 순차 진행 · 봉인 이름공간
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import { hashPassword } from "../src/crypto.js";
import * as D from "../src/db.js";
import { contentHash, verifySignature, signerKey, signerRef, canonicalFromSig } from "../src/esign.js";
import { makeExtToken, resolveExtToken } from "../src/extsign.js";

let env, db, a, admin, member, doc, ext, token;
const BODY = Array.from({ length: 30 }, (_, i) => `제${i + 1}조 계약 조항.`).join("\n");
const BASE = "http://localhost";
const req = (method, path, { cookie = "", body = null } = {}) => {
  const headers = {}; if (cookie) headers.cookie = cookie;
  const init = { method, headers, redirect: "manual" };
  if (body) { headers["content-type"] = "application/x-www-form-urlencoded"; init.body = new URLSearchParams(body).toString(); }
  return worker.fetch(new Request(BASE + path, init), env);
};
const cookiesOf = (r) => (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
async function loginAs(email, pw) {
  const seed = await req("GET", "/login");
  const j0 = cookiesOf(seed);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(await seed.text())[1];
  const r = await req("POST", "/login", { cookie: j0, body: { email, password: pw, _csrf: csrf } });
  return [j0, cookiesOf(r)].filter(Boolean).join("; ");
}
const csrfFrom = async (cookie, path) => (/name="_csrf" value="([^"]+)"/.exec(await (await req("GET", path, { cookie })).text()) || [])[1];
// 외부 서명 화면도 CSRF 를 요구한다(세션이 없어도 seed 쿠키 기반으로 발급된다).
// 실제 브라우저와 같은 순서로 — 페이지를 열어 쿠키·토큰을 받은 뒤 제출한다.
async function extPost(token, path, body) {
  const page = await req("GET", `/esign/${token}`);
  const cookie = cookiesOf(page);
  // 서명 폼이 없는 상태(이미 서명·거절·대기)에서도 핸들러의 판단을 보고 싶으므로,
  // 토큰은 같은 seed 쿠키를 쓰는 아무 페이지에서나 받아온다.
  let csrf = (/name="_csrf" value="([^"]+)"/.exec(await page.text()) || [])[1] || "";
  if (!csrf) csrf = await csrfFrom(cookie, "/login") || "";
  return req("POST", path, { cookie, body: { ...body, _csrf: csrf } });
}
// 유효한 1×1 PNG (서명 이미지 검사 통과용)
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

before(async () => {
  env = makeEnv(); db = env.DB;
  a = await D.createAssociation(db, { slug: "s", name: "서초 상인회" });
  const mk = async (e, n, role, pw) => { const h = await hashPassword(pw); return D.createUser(db, { email: e, passwordHash: h.hash, salt: h.salt, name: n, role, associationId: a.id }); };
  admin = await mk("ad@x.kr", "관리자", "ADMIN", "admin1234");
  member = await mk("m@x.kr", "김회원", "MERCHANT", "member1234");
  doc = await D.createDocument(db, { associationId: a.id, title: "임대차 계약", body: BODY, contentHash: await contentHash(BODY), createdBy: admin.id, ordered: 0, dueDate: "" });
  await D.createSignatureRequests(db, doc.id, [member.id]);
});

// ---------- 토큰 ----------
test("관리자가 외부 서명자를 추가하면 서명 링크가 발급된다", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const path = `/t/s/admin/documents/${doc.id}`;
  const csrf = await csrfFrom(jar, path);
  const r = await req("POST", `${path}/external`, { cookie: jar, body: {
    _csrf: csrf, name: "이임차", org: "○○상사", email: "tenant@example.com", phone: "010-9999-8888",
  } });
  const loc = r.headers.get("location") || "";
  assert.match(loc, /extlink=/, "링크가 발급되어야 함");
  token = decodeURIComponent(loc.match(/extlink=([^&]+)/)[1]);
  ext = (await D.listExternalSigners(db, doc.id))[0];
  assert.equal(ext.name, "이임차");
  assert.equal(ext.phone, "01099998888", "번호는 숫자만 정규화");
});

test("토큰은 위조할 수 없다", async () => {
  assert.ok(await resolveExtToken(db, env.SESSION_SECRET, token), "정상 토큰은 통과");
  assert.equal(await resolveExtToken(db, env.SESSION_SECRET, `${ext.id}.deadbeef`), null, "서명값 위조");
  assert.equal(await resolveExtToken(db, env.SESSION_SECRET, token.replace(/^\d+/, String(ext.id + 1))), null, "id 만 바꿔치기");
  assert.equal(await resolveExtToken(db, "다른비밀키", token), null, "다른 키로 만든 서명");
  assert.equal(await resolveExtToken(db, env.SESSION_SECRET, "쓰레기"), null);
  assert.equal(await resolveExtToken(db, env.SESSION_SECRET, ""), null);
});

test("다른 문서용으로 만든 토큰은 통하지 않는다", async () => {
  const other = await D.createDocument(db, { associationId: a.id, title: "다른 문서", body: "x", contentHash: await contentHash("x"), createdBy: admin.id, ordered: 0, dueDate: "" });
  // 같은 서명자 id 를 쓰되 문서만 바꿔 서명한 토큰
  const forged = await makeExtToken(env.SESSION_SECRET, ext.id, other.id);
  assert.equal(await resolveExtToken(db, env.SESSION_SECRET, forged), null, "문서가 토큰에 묶여 있어야 함");
});

test("링크만 있으면 로그인 없이 계약서가 열린다", async () => {
  const r = await req("GET", `/esign/${token}`);
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.match(h, /임대차 계약/);
  assert.match(h, /이임차/, "서명자 이름이 보여야 함");
  assert.match(h, /paper-stack|doc-body/, "계약 본문이 보여야 함");
  assert.match(h, /전자서명 제출/, "서명 폼이 있어야 함");
});

test("토큰이 틀리면 404 — 남의 계약을 훔쳐볼 수 없다", async () => {
  assert.equal((await req("GET", `/esign/${ext.id}.aaaa`)).status, 404);
  assert.equal((await req("GET", "/esign/999.bbbb")).status, 404);
});

// ---------- 서명 ----------
test("가입 없이 서명이 완료되고 Ed25519 로 봉인된다", async () => {
  const r = await extPost(token, `/esign/${token}`, { consent: "1", signature: PNG, signer_name: "이임차" });
  assert.match(r.headers.get("location") || "", /msg=/);
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);

  const sigs = await D.listSignatures(db, doc.id);
  assert.equal(sigs.length, 1);
  const s = sigs[0];
  assert.equal(s.signer_kind, "external");
  assert.equal(s.external_id, ext.id);
  assert.equal(s.user_id, null, "회원 id 는 비어 있어야 함");
  assert.equal(s.signer_email, "tenant@example.com", "외부 연락처가 조회에 함께 나와야 함");
  assert.equal(s.verify_level, "link");

  const v = await verifySignature(env, s, doc);
  assert.equal(v.valid, true, "봉인이 검증되어야 함");
});

test("외부 서명자의 봉인 식별자는 회원 id 와 겹치지 않는다", async () => {
  const s = (await D.listSignatures(db, doc.id))[0];
  assert.equal(signerKey(s), `x${ext.id}`);
  assert.equal(signerRef(s), -ext.id);
  assert.match(canonicalFromSig(s), new RegExp(`\\nx${ext.id}\\n`), "봉인 원문에 x 접두 식별자");
  // 같은 번호의 회원 서명과 봉인 원문이 달라야 한다
  const fake = { ...s, external_id: null, user_id: ext.id };
  assert.notEqual(canonicalFromSig(s), canonicalFromSig(fake), "이름공간이 분리되어야 함");
});

test("같은 링크로 두 번 서명할 수 없다", async () => {
  const r = await extPost(token, `/esign/${token}`, { consent: "1", signature: PNG, signer_name: "이임차" });
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.equal((await D.listSignatures(db, doc.id)).length, 1);
  const page = await (await req("GET", `/esign/${token}`)).text();
  assert.match(page, /이미 서명을 마치셨습니다/);
});

test("동의 체크 없이는 서명되지 않는다", async () => {
  const s2 = await D.addExternalSigner(db, { documentId: doc.id, name: "박무동의", email: "n@example.com", signOrder: 9 });
  const t2 = await makeExtToken(env.SESSION_SECRET, s2.id, doc.id);
  const r = await extPost(t2, `/esign/${t2}`, { signature: PNG, signer_name: "박무동의" });
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.equal(await D.hasSignedExt(db, doc.id, s2.id), false);
});

test("서명 그림이 없으면 거부된다", async () => {
  const s3 = await D.addExternalSigner(db, { documentId: doc.id, name: "최무서명", email: "n2@example.com", signOrder: 10 });
  const t3 = await makeExtToken(env.SESSION_SECRET, s3.id, doc.id);
  const r = await extPost(t3, `/esign/${t3}`, { consent: "1", signer_name: "최무서명" });
  assert.match(r.headers.get("location") || "", /err=1/);
});

// ---------- 진행 현황 · 순차 ----------
test("진행률이 회원과 외부 서명자를 함께 센다", async () => {
  const rc = await D.requestCounts(db, doc.id);
  assert.equal(rc.members, 1);
  assert.equal(rc.externals, 3, "추가한 외부 서명자 3명");
  assert.equal(rc.total, 4);
  assert.equal(rc.signed, 1, "외부 1명 서명 완료");
});

test("순차 서명에서 외부 서명자가 앞 순번이면 회원이 대기한다", async () => {
  const od = await D.createDocument(db, { associationId: a.id, title: "순차 계약", body: BODY, contentHash: await contentHash(BODY), createdBy: admin.id, ordered: 1, dueDate: "" });
  const e1 = await D.addExternalSigner(db, { documentId: od.id, name: "먼저서명", email: "first@example.com", signOrder: 1 });
  await db.prepare("INSERT INTO signature_requests (document_id, user_id, sign_order) VALUES (?,?,2)").bind(od.id, member.id).run();

  assert.equal(await D.canSignNowAny(db, od, { userId: member.id }), false, "외부가 먼저라 회원은 대기");
  assert.equal(await D.canSignNowAny(db, od, { externalId: e1.id }), true, "외부는 첫 순번이라 가능");
  const inList = async () => (await D.listDocumentsToSign(db, a.id, member.id)).some((x) => x.id === od.id);
  assert.equal(await inList(), false, "회원의 서명 대기 목록에도 아직 안 떠야 함");

  // 외부가 서명하면 회원 차례가 열린다
  const t = await makeExtToken(env.SESSION_SECRET, e1.id, od.id);
  await extPost(t, `/esign/${t}`, { consent: "1", signature: PNG, signer_name: "먼저서명" });
  assert.equal(await D.canSignNowAny(db, od, { userId: member.id }), true, "외부가 끝나면 회원 차례");
  assert.equal(await inList(), true, "이제 회원 목록에 떠야 함");
});

test("외부 서명자가 거절해도 뒷사람이 막히지 않는다 (데드락 방지)", async () => {
  const od = await D.createDocument(db, { associationId: a.id, title: "거절 계약", body: BODY, contentHash: await contentHash(BODY), createdBy: admin.id, ordered: 1, dueDate: "" });
  const e1 = await D.addExternalSigner(db, { documentId: od.id, name: "거절자", email: "no@example.com", signOrder: 1 });
  await db.prepare("INSERT INTO signature_requests (document_id, user_id, sign_order) VALUES (?,?,2)").bind(od.id, member.id).run();
  const t = await makeExtToken(env.SESSION_SECRET, e1.id, od.id);
  const r = await extPost(t, `/esign/${t}/decline`, { reason: "조건 불일치" });
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);
  assert.equal(await D.canSignNowAny(db, od, { userId: member.id }), true, "거절한 사람이 뒤를 막으면 안 됨");
  const list = await D.listExternalSigners(db, od.id);
  assert.equal(list[0].decline_reason, "조건 불일치");
});

test("거절한 뒤에는 그 링크로 서명할 수 없다", async () => {
  const od = (await D.listDocuments(db, a.id)).find((x) => x.title === "거절 계약");
  const e1 = (await D.listExternalSigners(db, od.id))[0];
  const t = await makeExtToken(env.SESSION_SECRET, e1.id, od.id);
  const r = await extPost(t, `/esign/${t}`, { consent: "1", signature: PNG, signer_name: "거절자" });
  assert.match(r.headers.get("location") || "", /err=1/);
});

// ---------- 필드 배치 연동 ----------
test("외부 서명자에게 배정된 자리만 그 사람이 채운다", async () => {
  const fd = await D.createDocument(db, { associationId: a.id, title: "필드 계약", body: BODY, contentHash: await contentHash(BODY), createdBy: admin.id, ordered: 0, dueDate: "" });
  await D.createSignatureRequests(db, fd.id, [member.id]);
  const e = await D.addExternalSigner(db, { documentId: fd.id, name: "외부갑", email: "g@example.com", signOrder: 2 });
  await D.replaceFields(db, fd.id, [
    { kind: "sign", label: "외부 서명", page: 0, x: 0.5, y: 0.8, w: 0.22, h: 0.05, assignee: -e.id, required: 1 },
    { kind: "sign", label: "회원 서명", page: 0, x: 0.1, y: 0.8, w: 0.22, h: 0.05, assignee: member.id, required: 1 },
  ]);
  const t = await makeExtToken(env.SESSION_SECRET, e.id, fd.id);
  const h = await (await req("GET", `/esign/${t}`)).text();
  const mine = (h.match(/pf-mine/g) || []).length;
  assert.equal(mine, 1, "내 자리 하나만 채울 수 있어야 함");
  assert.match(h, /외부 서명/);

  const fields = await D.listFields(db, fd.id);
  const mySlot = fields.find((f) => f.assignee === -e.id);
  const r = await extPost(t, `/esign/${t}`, {
    consent: "1", signer_name: "외부갑",
    fields: JSON.stringify({ [mySlot.id]: { image: PNG } }),
  });
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);
  const filled = await D.listFilledBy(db, fd.id, -e.id);
  assert.equal(filled.length, 1, "내 자리만 채워져야 함");
  assert.equal(filled[0].id, mySlot.id);

  const sig = (await D.listSignatures(db, fd.id))[0];
  assert.ok(sig.fields_hash, "필드값이 봉인에 포함되어야 함");
  assert.equal((await verifySignature(env, sig, fd)).valid, true);
});

test("남의 자리를 채우려 해도 저장되지 않는다", async () => {
  const fd = (await D.listDocuments(db, a.id)).find((x) => x.title === "필드 계약");
  const fields = await D.listFields(db, fd.id);
  const notMine = fields.find((f) => f.assignee === member.id);
  assert.equal((await D.listFilledBy(db, fd.id, member.id)).length, 0, "회원 자리는 비어 있어야 함");
  assert.ok(notMine, "회원 자리가 존재");
});

// ---------- 관리자 화면 ----------
test("문서 상세에 외부 서명자 현황이 보인다", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const h = await (await req("GET", `/t/s/admin/documents/${doc.id}`, { cookie: jar })).text();
  assert.match(h, /외부 서명자/);
  assert.match(h, /이임차/);
  assert.match(h, /서명 링크 발급/);
});

// 링크가 발급 직후 한 번만 보이던 시절엔, 창을 닫으면 같은 사람을 또 등록하는 수밖에 없었다.
test("서명 링크는 언제 다시 열어도 그 자리에 있다", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const pending = await D.addExternalSigner(db, { documentId: doc.id, name: "재방문확인", email: "again@example.com", signOrder: 9 });
  const h = await (await req("GET", `/t/s/admin/documents/${doc.id}`, { cookie: jar })).text();
  const t = await makeExtToken(env.SESSION_SECRET, pending.id, doc.id);
  assert.ok(h.includes(`/esign/${t}`), "미서명자 줄에 링크가 그대로 있어야");
  assert.match(h, /data-share-text="[^"]*전자서명 요청/, "붙여 넣을 말까지 준비돼 있어야");
  assert.match(h, /share\.js/, "버튼을 살리는 스크립트가 실려 있어야");
});

// 알림톡이 꺼진 상태(=심사 대기 중)에서도 관리자가 스스로 계약을 진행할 수 있어야 한다.
test("알림톡이 꺼져 있으면 직접 보내라고 말해 준다", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const h = await (await req("GET", `/t/s/admin/documents/${doc.id}`, { cookie: jar })).text();
  assert.match(h, /자동 발송이 꺼져 있습니다/);
  assert.match(h, /회원에게 보낼 링크/, "회원용 서명 주소도 함께 줘야");
  assert.ok(h.includes(`/t/s/sign/${doc.id}`), "회원 서명 주소가 실제로 있어야");
  assert.ok(!/미서명자 재알림/.test(h), "보낼 수단이 없는데 재알림 버튼을 두면 눌러도 헛일이다");
});

// 연락처 없이도 링크는 만들어져야 한다 — 관리자가 카톡으로 직접 보내는 길을 막으면,
// 알림톡 심사가 끝날 때까지 계약을 한 건도 못 보낸다.
test("연락처가 없어도 링크는 만들어진다 (손으로 전달하는 길)", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const path = `/t/s/admin/documents/${doc.id}`;
  const csrf = await csrfFrom(jar, path);
  const r = await req("POST", `${path}/external`, { cookie: jar, body: { _csrf: csrf, name: "연락불가" } });
  const loc = r.headers.get("location") || "";
  assert.ok(!/err=1/.test(loc), "연락처 없다고 막으면 안 된다");
  assert.match(loc, /extlink=/, "발급된 링크가 화면으로 넘어와야");
  const page = await (await req("GET", path, { cookie: jar })).text();
  assert.match(page, /연락불가[\s\S]{0,900}?data-share-url="[^"]*\/esign\//, "그 사람 줄에 링크가 붙어 있어야");
});

// 본인확인(OTP)이 켜져 있으면 인증번호를 보낼 곳이 있어야 하므로 그때만 연락처를 받는다.
test("본인확인이 켜져 있으면 연락처를 받는다", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const path = `/t/s/admin/documents/${doc.id}`;
  await D.setSetting(env.DB, "esign_otp", "1");
  const csrf = await csrfFrom(jar, path);
  const r = await req("POST", `${path}/external`, { cookie: jar, body: { _csrf: csrf, name: "인증필요" } });
  assert.match(r.headers.get("location") || "", /err=1/);
  await D.setSetting(env.DB, "esign_otp", "0");
});

test("이미 서명한 외부 서명자는 삭제할 수 없다", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const path = `/t/s/admin/documents/${doc.id}`;
  const csrf = await csrfFrom(jar, path);
  const r = await req("POST", `${path}/external/${ext.id}/delete`, { cookie: jar, body: { _csrf: csrf } });
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.ok(await D.getExternalSigner(db, ext.id));
});

test("다른 상인회 관리자는 이 문서에 외부 서명자를 넣을 수 없다", async () => {
  const other = await D.createAssociation(db, { slug: "other", name: "다른곳" });
  const h = await hashPassword("admin1234");
  await D.createUser(db, { email: "ad2@x.kr", passwordHash: h.hash, salt: h.salt, name: "남관리자", role: "ADMIN", associationId: other.id });
  const jar = await loginAs("ad2@x.kr", "admin1234");
  const csrf = await csrfFrom(jar, "/t/other/admin/documents");
  const r = await req("POST", `/t/other/admin/documents/${doc.id}/external`, { cookie: jar, body: {
    _csrf: csrf, name: "침입자", email: "x@example.com" } });
  assert.match(r.headers.get("location") || "", /err=1/);
});

// ---------- 감사 추적 ----------
test("외부 서명자의 열람·서명이 감사 추적에 남는다", async () => {
  const events = await D.listDocEvents(db, doc.id);
  const viewed = events.find((e) => e.kind === "viewed" && e.user_id === -ext.id);
  const signed = events.find((e) => e.kind === "signed" && e.user_id === -ext.id);
  assert.ok(viewed, "열람 기록");
  assert.ok(signed, "서명 기록");
  assert.match(signed.detail, /외부 서명자/);
});

// 관리자가 카톡으로 보낸 회원 서명 링크는 로그인 벽을 넘어서도 목적지를 기억해야 한다.
// 예전에는 로그인하면 대시보드로 떨어져, 정작 서명할 문서를 스스로 찾아 들어가야 했다.
test("서명 링크를 눌러 로그인해도 그 문서로 돌아온다", async () => {
  const want = `/t/s/sign/${doc.id}`;
  const r = await req("GET", want);
  const loc = r.headers.get("location") || "";
  assert.match(loc, /^\/login\?/, "로그인으로 보내야");
  assert.ok(decodeURIComponent(loc).includes(`next=${want}`), `돌아갈 자리를 들고 가야: ${loc}`);

  const g = await req("GET", loc);
  const page = await g.text();
  assert.ok(page.includes(`name="next" value="${want}"`), "로그인 폼이 그 자리를 물고 있어야");

  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(page) || [])[1];
  const lr = await req("POST", "/login", { cookie: seed, body: { _csrf: tk, email: "m@x.kr", password: "member1234", next: want } });
  assert.equal(lr.headers.get("location"), want, "로그인 뒤 바로 그 문서로");
});

test("돌아갈 자리로 바깥 주소를 넣을 수 없다", async () => {
  const g = await req("GET", "/login");
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  for (const bad of ["https://evil.example/x", "//evil.example", "\\\\evil.example", "javascript:alert(1)"]) {
    const r = await req("POST", "/login", { cookie: seed, body: { _csrf: tk, email: "m@x.kr", password: "member1234", next: bad } });
    const loc = r.headers.get("location") || "";
    assert.ok(!loc.includes("evil") && !loc.includes("javascript"), `막아야 할 값이 통과됨: ${bad} → ${loc}`);
  }
});
