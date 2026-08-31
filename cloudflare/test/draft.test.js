// 계약서 작성기 — 임시저장(초안)이 '계약'으로 새지 않는지.
//
// 초안은 서명 대상이 하나도 지정돼 있지 않다. 그래서 '대상이 없으면 회원 전체'
// 규칙에 그냥 걸리면, 쓰다 만 글이 조직 회원 전원에게 서명하라고 열린다.
// 이 파일은 그 구멍이 다시 열리지 않는지만 본다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { contentHash } from "../src/esign.js";

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

async function seed() {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "law", name: "한빛법무법인", kind: "esign" });
  const mk = async (e, n, role) => {
    const pw = await hashPassword("pass1234");
    return D.createUser(env.DB, { email: e, passwordHash: pw.hash, salt: pw.salt, name: n, role, associationId: a.id });
  };
  const admin = await mk("ad@law.kr", "담당", "ADMIN");
  const member = await mk("m@law.kr", "김서명", "MERCHANT");
  const j = jar();
  await post(env, j, "/login", { email: "ad@law.kr", password: "pass1234" });
  return { env, a, admin, member, j };
}

const draftOf = (env, a, admin, body = "제1조 (범위)\n  ① 아직 쓰는 중.") =>
  contentHash(body).then((h) => D.createDocument(env.DB, {
    associationId: a.id, title: "쓰다 만 계약서", body, contentHash: h, createdBy: admin.id, draft: 1,
  }));

test("초안은 회원의 서명 대기 목록에 뜨지 않는다 (대상 없는 문서 = 전체 공개 규칙의 사각지대)", async () => {
  const { env, a, admin, member } = await seed();
  const d = await draftOf(env, a, admin);
  const waiting = await D.listDocumentsToSign(env.DB, a.id, member.id, member.role);
  assert.equal(waiting.filter((x) => x.id === d.id).length, 0, "초안이 서명 대기에 보이면 안 된다");
});

test("초안은 서명 화면 자체가 열리지 않는다 (주소를 직접 쳐도)", async () => {
  const { env, a, admin, member } = await seed();
  const d = await draftOf(env, a, admin);
  assert.equal(await D.canReceiveSign(env.DB, d.id, member.id, member.role), false);
});

test("초안은 관리자 계약 목록에도 계약으로 세어지지 않는다", async () => {
  const { env, a, admin } = await seed();
  const d = await draftOf(env, a, admin);
  const docs = await D.listDocuments(env.DB, a.id);
  assert.equal(docs.filter((x) => x.id === d.id).length, 0);
  assert.equal((await D.listDrafts(env.DB, a.id)).length, 1, "대신 작성 중 목록에는 있어야 한다");
});

test("임시저장: 처음이면 새로 만들고, 두 번째부터는 같은 초안을 덮어쓴다", async () => {
  const { env, a, j } = await seed();
  const r1 = await post(env, j, "/t/law/admin/documents/draft", { title: "용역 계약서", body: "제1조 (범위)" }, "/t/law/admin/documents/write");
  const j1 = await r1.json();
  assert.equal(j1.ok, true);
  const r2 = await post(env, j, "/t/law/admin/documents/draft", { title: "용역 계약서", body: "제1조 (범위)\n제2조 (대금)", doc: String(j1.id) }, "/t/law/admin/documents/write");
  const j2 = await r2.json();
  assert.equal(j2.id, j1.id, "같은 초안을 이어 써야 한다 — 저장할 때마다 새 초안이 쌓이면 안 된다");
  assert.equal((await D.listDrafts(env.DB, a.id)).length, 1);
  assert.match((await D.getDocument(env.DB, j1.id)).body, /제2조/);
});

test("이미 보낸 계약서는 임시저장으로 되돌릴 수 없다 (봉인된 본문을 몰래 고치는 길)", async () => {
  const { env, a, admin, j } = await seed();
  const body = "제1조 (범위)";
  const sent = await D.createDocument(env.DB, { associationId: a.id, title: "보낸 계약", body, contentHash: await contentHash(body), createdBy: admin.id });
  const r = await post(env, j, "/t/law/admin/documents/draft", { title: "바꿔치기", body: "몰래 바꾼 본문", doc: String(sent.id) }, "/t/law/admin/documents/write");
  assert.equal(r.status, 409);
  assert.equal((await D.getDocument(env.DB, sent.id)).body, body, "본문이 그대로여야 한다");
});

test("보내기: 초안이 계약이 되고, 그때부터 회원에게 열린다", async () => {
  const { env, a, admin, member, j } = await seed();
  const d = await draftOf(env, a, admin, "제1조 (범위)\n  ① 을은 업무를 수행한다.");
  const r = await post(env, j, `/t/law/admin/documents/${d.id}/publish`, { target: "all" }, "/t/law/admin/documents/write?doc=" + d.id);
  assert.equal(r.status, 303);
  assert.equal((await D.listDrafts(env.DB, a.id)).length, 0);
  assert.equal((await D.listDocuments(env.DB, a.id)).length, 1);
  assert.equal(await D.canReceiveSign(env.DB, d.id, member.id, member.role), true);
});

test("빈 본문은 보내지지 않는다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftOf(env, a, admin, "   \n  ");
  const r = await post(env, j, `/t/law/admin/documents/${d.id}/publish`, { target: "all" }, "/t/law/admin/documents/write?doc=" + d.id);
  assert.match(decodeURIComponent(r.headers.get("Location") || ""), /본문이 비어 있습니다/);
  assert.equal((await D.listDrafts(env.DB, a.id)).length, 1, "초안은 남아 있어야 한다 — 쓴 게 사라지면 안 된다");
});

test("남의 조직 초안은 보이지도, 보내지지도, 지워지지도 않는다", async () => {
  const { env, j } = await seed();
  const b = await D.createAssociation(env.DB, { slug: "other", name: "다른 법인", kind: "esign" });
  const pw = await hashPassword("pass1234");
  const bAdmin = await D.createUser(env.DB, { email: "x@o.kr", passwordHash: pw.hash, salt: pw.salt, name: "남", role: "ADMIN", associationId: b.id });
  const body = "남의 초안";
  const d = await D.createDocument(env.DB, { associationId: b.id, title: "남의 것", body, contentHash: await contentHash(body), createdBy: bAdmin.id, draft: 1 });

  const list = await get(env, j, "/t/law/admin/documents");
  assert.ok(!(await list.text()).includes("남의 것"));
  await post(env, j, `/t/law/admin/documents/${d.id}/publish`, { target: "all" }, "/t/law/admin/documents");
  await post(env, j, `/t/law/admin/documents/${d.id}/draft-delete`, {}, "/t/law/admin/documents");
  const still = await D.getDocument(env.DB, d.id);
  assert.ok(still, "남의 초안이 지워지면 안 된다");
  assert.equal(still.draft, 1, "남의 초안이 발송되면 안 된다");
});

test("초안 지우기: 내 조직 것은 지워진다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftOf(env, a, admin);
  await post(env, j, `/t/law/admin/documents/${d.id}/draft-delete`, {}, "/t/law/admin/documents");
  assert.ok(!(await D.getDocument(env.DB, d.id)), "초안이 남아 있으면 안 된다");
});

test("미리보기는 서버 조판을 그대로 돌려준다 (화면과 실제 계약서가 같은 자리에서 끊긴다)", async () => {
  const { env, j } = await seed();
  const body = "용역 위탁 계약서\n\n제1조 (범위)\n  ① 을은 업무를 수행한다.";
  const r = await post(env, j, "/t/law/admin/documents/preview", { body }, "/t/law/admin/documents/write");
  const html = await r.text();
  assert.match(r.headers.get("content-type") || "", /text\/html/);
  assert.match(html, /pl-title/, "표제 줄을 알아봐야 한다");
  assert.match(html, /pl-article/, "조문 줄을 알아봐야 한다");
  assert.match(html, /pl-clause/, "항 줄을 알아봐야 한다");
});

test("작성기 화면에는 STAFF 도 들어갈 수 있고, 일반 회원은 못 들어간다", async () => {
  const { env } = await seed();
  const pw = await hashPassword("pass1234");
  const a = (await D.getAssociationBySlug(env.DB, "law"));
  await D.createUser(env.DB, { email: "st@law.kr", passwordHash: pw.hash, salt: pw.salt, name: "직원", role: "STAFF", associationId: a.id });
  const sj = jar();
  await post(env, sj, "/login", { email: "st@law.kr", password: "pass1234" });
  assert.equal((await get(env, sj, "/t/law/admin/documents/write")).status, 200);

  const mj = jar();
  await post(env, mj, "/login", { email: "m@law.kr", password: "pass1234" });
  assert.notEqual((await get(env, mj, "/t/law/admin/documents/write")).status, 200);
});
