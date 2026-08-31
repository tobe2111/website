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

test("아무것도 안 쓴 화면은 초안이 되지 않는다 (자동 저장이 3초마다 돈다)", async () => {
  const { env, a, j } = await seed();
  const r = await post(env, j, "/t/law/admin/documents/draft", { title: "", body: "   \n " }, "/t/law/admin/documents/write");
  assert.equal(r.status, 400);
  assert.equal((await D.listDrafts(env.DB, a.id)).length, 0, "작성기를 열어 두기만 해도 초안이 쌓이면 안 된다");

  // 제목만 써도 저장은 된다 — 쓰기 시작한 것이므로
  const ok = await post(env, j, "/t/law/admin/documents/draft", { title: "쓰기 시작", body: "" }, "/t/law/admin/documents/write");
  assert.equal((await ok.json()).ok, true);
  assert.equal((await D.listDrafts(env.DB, a.id)).length, 1);
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

// ---------- 보내기 전에 서명 자리 놓기 ----------
// 예전에는 계약서를 먼저 보내야 서명 자리를 놓을 수 있었다(담당자 목록이 서명 요청에서 나오므로).
// 그래서 상대방은 서명란이 하나도 없는 계약서를 먼저 받았다. 이제 순서가 뒤집혔다.
const placeSlots = (env, j, docId, list) =>
  post(env, j, `/t/law/admin/documents/${docId}/fields`,
    { fields: JSON.stringify(list.map((f) => ({ kind: f.kind || "sign", page: 0, x: 0.3, y: f.y ?? 0.8, w: 0.2, h: 0.05, assignee: f.who, required: 1 }))) },
    `/t/law/admin/documents/${docId}/fields`);

test("초안 위에는 사람 대신 '몇 번째 당사자' 로 자리를 놓는다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftOf(env, a, admin);
  const page = await get(env, j, `/t/law/admin/documents/${d.id}/fields`);
  const html = await page.text();
  assert.match(html, /1번째 당사자/, "초안에서는 자리 이름으로 고른다");
  assert.ok(!/누구나\(먼저 서명하는 사람\)<\/option>\s*<option value="\d/.test(html), "초안에는 사람 이름이 뜨지 않는다");

  await placeSlots(env, j, d.id, [{ who: "slot1", y: 0.8 }, { who: "slot2", y: 0.88 }]);
  const rows = await D.listFields(env.DB, d.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((f) => f.slot), [1, 2]);
  assert.deepEqual(rows.map((f) => f.assignee), [0, 0], "아직 사람이 아니다");
});

test("당사자 자리에 이름을 붙이면 지면·보내기 화면·안내가 모두 그 이름으로 말한다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftOf(env, a, admin);
  await post(env, j, `/t/law/admin/documents/${d.id}/fields`, {
    fields: JSON.stringify([
      { kind: "sign", page: 0, x: 0.3, y: 0.8, w: 0.2, h: 0.05, assignee: "slot1", required: 1 },
      { kind: "sign", page: 0, x: 0.3, y: 0.88, w: 0.2, h: 0.05, assignee: "slot2", required: 1 },
    ]),
    parties: JSON.stringify({ 1: "임대인", 2: "임차인" }),
  }, `/t/law/admin/documents/${d.id}/fields`);
  assert.deepEqual(await D.listDocParties(env.DB, d.id), { 1: "임대인", 2: "임차인" });

  const fp = await (await get(env, j, `/t/law/admin/documents/${d.id}/fields`)).text();
  assert.match(fp, /임대인/);
  assert.ok(!/1번째 당사자/.test(fp.split("id=\"partyNames\"")[0]) || /임대인/.test(fp), "이름을 붙인 자리는 번호로 부르지 않는다");

  const write = await (await get(env, j, `/t/law/admin/documents/write?doc=${d.id}`)).text();
  assert.match(write, /wt-party-no">임대인/);
  assert.match(write, /wt-party-no">임차인/);

  const r = await post(env, j, `/t/law/admin/documents/${d.id}/publish`, { party_0: "", party_1: "" }, "/t/law/admin/documents/write?doc=" + d.id);
  assert.match(decodeURIComponent(r.headers.get("Location") || ""), /임대인이 비어 있습니다/,
    "조사까지 맞아야 사람이 쓴 글로 읽힌다 — '임대인가' 가 아니다");
});

test("쓰지 않는 자리의 이름은 남지 않는다 (지운 당사자가 되살아나면 안 된다)", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftOf(env, a, admin);
  const save = (fields, parties) => post(env, j, `/t/law/admin/documents/${d.id}/fields`,
    { fields: JSON.stringify(fields), parties: JSON.stringify(parties) }, `/t/law/admin/documents/${d.id}/fields`);
  await save([
    { kind: "sign", page: 0, x: 0.3, y: 0.8, w: 0.2, h: 0.05, assignee: "slot1", required: 1 },
    { kind: "sign", page: 0, x: 0.3, y: 0.88, w: 0.2, h: 0.05, assignee: "slot2", required: 1 },
  ], { 1: "임대인", 2: "임차인" });
  // 두 번째 당사자 자리를 지우고 다시 저장
  await save([{ kind: "sign", page: 0, x: 0.3, y: 0.8, w: 0.2, h: 0.05, assignee: "slot1", required: 1 }],
    { 1: "임대인", 2: "임차인" });
  assert.deepEqual(await D.listDocParties(env.DB, d.id), { 1: "임대인" });
});

test("이름이 없으면 지금까지처럼 'N번째 당사자' 로 부른다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftOf(env, a, admin);
  await placeSlots(env, j, d.id, [{ who: "slot1" }]);
  const write = await (await get(env, j, `/t/law/admin/documents/write?doc=${d.id}`)).text();
  assert.match(write, /wt-party-no">1번째 당사자/);
});

test("이미 보낸 계약서에는 '몇 번째 당사자' 로 놓을 수 없다 (아무도 못 채우는 칸이 된다)", async () => {
  const { env, a, admin, member, j } = await seed();
  const body = "제1조 (범위)";
  const sent = await D.createDocument(env.DB, { associationId: a.id, title: "보낸 계약", body, contentHash: await contentHash(body), createdBy: admin.id });
  await D.createSignatureRequests(env.DB, sent.id, [member.id]);
  const r = await placeSlots(env, j, sent.id, [{ who: "slot1" }]);
  assert.match(r.headers.get("Location") || "", /err=1/);
  assert.equal(await D.countFields(env.DB, sent.id), 0);
});

test("자리를 놓아 둔 계약서는 당사자를 정해야 나간다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftOf(env, a, admin);
  await placeSlots(env, j, d.id, [{ who: "slot1" }, { who: "slot2" }]);

  const blank = await post(env, j, `/t/law/admin/documents/${d.id}/publish`, { party_0: "", party_1: "" }, "/t/law/admin/documents/write?doc=" + d.id);
  assert.match(decodeURIComponent(blank.headers.get("Location") || ""), /1번째 당사자가 비어 있습니다/);
  assert.equal((await D.listDrafts(env.DB, a.id)).length, 1, "보내지 않았으니 초안 그대로");
});

test("보내기: '몇 번째 당사자' 가 실제 사람으로 확정된다 (회원 + 외부 상대방)", async () => {
  const { env, a, admin, member, j } = await seed();
  const d = await draftOf(env, a, admin);
  await placeSlots(env, j, d.id, [{ who: "slot1", kind: "sign" }, { who: "slot1", kind: "stamp" }, { who: "slot2", kind: "sign" }]);

  const r = await post(env, j, `/t/law/admin/documents/${d.id}/publish`, {
    party_0: String(member.id), party_1: "ext", ext_name_1: "박외부", ext_email_1: "park@outside.kr",
  }, "/t/law/admin/documents/write?doc=" + d.id);
  assert.equal(r.status, 303);

  const ext = await D.listExternalSigners(env.DB, d.id);
  assert.equal(ext.length, 1);
  assert.equal(ext[0].name, "박외부");
  const rows = await D.listFields(env.DB, d.id);
  assert.deepEqual(rows.filter((f) => f.slot === 1).map((f) => f.assignee), [member.id, member.id]);
  assert.deepEqual(rows.filter((f) => f.slot === 2).map((f) => f.assignee), [-ext[0].id], "외부 서명자는 음수 ref");

  // 각자 자기 자리만 채운다
  assert.equal((await D.listFieldsFor(env.DB, d.id, member.id)).length, 2);
});

test("순차 서명 차례는 '몇 번째 당사자' 순서다 (외부가 1번이면 외부가 먼저)", async () => {
  const { env, a, admin, member, j } = await seed();
  const d = await draftOf(env, a, admin);
  await placeSlots(env, j, d.id, [{ who: "slot1" }, { who: "slot2" }]);
  const r = await post(env, j, `/t/law/admin/documents/${d.id}/publish`, {
    ordered: "1", party_0: "ext", ext_name_0: "박외부", ext_email_0: "park@outside.kr", party_1: String(member.id),
  }, "/t/law/admin/documents/write?doc=" + d.id);
  assert.equal(r.status, 303);
  const ext = (await D.listExternalSigners(env.DB, d.id))[0];
  const req = (await D.listRequestStatus(env.DB, d.id))[0];
  assert.equal(ext.sign_order, 1, "1번째 당사자인 외부 상대방이 먼저다");
  assert.equal(req.sign_order, 2, "회원을 먼저 다 넣어 버리면 순서가 뒤집힌다");
});

test("외부 상대방은 연락처가 없으면 보내지 않는다 (링크를 보낼 곳이 없다)", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftOf(env, a, admin);
  await placeSlots(env, j, d.id, [{ who: "slot1" }]);
  const r = await post(env, j, `/t/law/admin/documents/${d.id}/publish`, { party_0: "ext", ext_name_1: "", ext_name_0: "박외부" }, "/t/law/admin/documents/write?doc=" + d.id);
  assert.match(decodeURIComponent(r.headers.get("Location") || ""), /휴대폰 또는 이메일이 필요합니다/);
  assert.equal((await D.listExternalSigners(env.DB, d.id)).length, 0, "실패했으면 아무도 등록되지 않아야 한다");
  assert.equal((await D.listDrafts(env.DB, a.id)).length, 1);
});

test("같은 사람을 두 당사자로 지정할 수 없다", async () => {
  const { env, a, admin, member, j } = await seed();
  const d = await draftOf(env, a, admin);
  await placeSlots(env, j, d.id, [{ who: "slot1" }, { who: "slot2" }]);
  const r = await post(env, j, `/t/law/admin/documents/${d.id}/publish`,
    { party_0: String(member.id), party_1: String(member.id) }, "/t/law/admin/documents/write?doc=" + d.id);
  assert.match(decodeURIComponent(r.headers.get("Location") || ""), /같은 사람을 두 당사자로/);
});

test("자리를 안 놓은 계약서는 지금까지처럼 전체·특정 회원으로 나간다", async () => {
  const { env, a, admin, member, j } = await seed();
  const d = await draftOf(env, a, admin);
  const r = await post(env, j, `/t/law/admin/documents/${d.id}/publish`, { target: "all" }, "/t/law/admin/documents/write?doc=" + d.id);
  assert.equal(r.status, 303);
  assert.equal(await D.canReceiveSign(env.DB, d.id, member.id, member.role), true);
});

// ---------- 빈칸 {{}} ----------
// 계약마다 달라지는 값(보증금·기간·상호)을 자리로 두고, 보내기 전에 한꺼번에 채운다.
const VAR_BODY = "제1조 (보증금)\n  ① 보증금은 금 {{보증금}} 원으로 한다.\n  ② 월 차임은 금 {{월세}} 원으로 한다.";

test("빈칸이 남아 있으면 계약서가 나가지 않는다 ('{{보증금}}' 이 박힌 화면에서 서명하게 둘 수 없다)", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftOf(env, a, admin, VAR_BODY);
  const r = await post(env, j, `/t/law/admin/documents/${d.id}/publish`, { target: "all" }, "/t/law/admin/documents/write?doc=" + d.id);
  const loc = decodeURIComponent(r.headers.get("Location") || "");
  assert.match(loc, /빈칸이 2개/);
  assert.match(loc, /보증금/);
  assert.equal((await D.listDrafts(env.DB, a.id)).length, 1);
});

test("빈칸은 채운 것만 바뀌고, 못 채운 칸은 이름을 그대로 지킨다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftOf(env, a, admin, VAR_BODY);
  await post(env, j, `/t/law/admin/documents/${d.id}/fill`, { var_보증금: "오천만", var_월세: "" }, "/t/law/admin/documents/write?doc=" + d.id);
  const body = (await D.getDocument(env.DB, d.id)).body;
  assert.match(body, /금 오천만 원/);
  assert.match(body, /\{\{월세\}\}/, "못 채운 칸이 밑줄로 뭉개지면 다음에 무엇을 채울지 알 수 없다");

  await post(env, j, `/t/law/admin/documents/${d.id}/fill`, { var_월세: "삼백" }, "/t/law/admin/documents/write?doc=" + d.id);
  const done = (await D.getDocument(env.DB, d.id)).body;
  assert.ok(!/\{\{/.test(done));
  const r = await post(env, j, `/t/law/admin/documents/${d.id}/publish`, { target: "all" }, "/t/law/admin/documents/write?doc=" + d.id);
  assert.equal(r.status, 303, "다 채웠으면 나간다");
});

test("빈칸을 채우면 본문 해시도 함께 바뀐다 (봉인이 옛 본문을 가리키면 안 된다)", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftOf(env, a, admin, VAR_BODY);
  const before = (await D.getDocument(env.DB, d.id)).content_hash;
  await post(env, j, `/t/law/admin/documents/${d.id}/fill`, { var_보증금: "오천만", var_월세: "삼백" }, "/t/law/admin/documents/write?doc=" + d.id);
  const after = await D.getDocument(env.DB, d.id);
  assert.notEqual(after.content_hash, before);
  assert.equal(after.content_hash, await contentHash(after.body));
});

test("이미 보낸 계약서의 빈칸은 채울 수 없다", async () => {
  const { env, a, admin, j } = await seed();
  const sent = await D.createDocument(env.DB, { associationId: a.id, title: "보낸 계약", body: VAR_BODY, contentHash: await contentHash(VAR_BODY), createdBy: admin.id });
  // 보낸 문서의 작성 화면은 문서 화면으로 넘겨 버리므로, 토큰은 목록 화면에서 받는다
  const r = await post(env, j, `/t/law/admin/documents/${sent.id}/fill`, { var_보증금: "몰래" }, "/t/law/admin/documents");
  assert.match(decodeURIComponent(r.headers.get("Location") || ""), /이미 보낸 계약서/);
  assert.equal((await D.getDocument(env.DB, sent.id)).body, VAR_BODY);
});

test("작성 화면에 빈칸 채우기 칸이 뜬다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftOf(env, a, admin, VAR_BODY);
  const html = await (await get(env, j, `/t/law/admin/documents/write?doc=${d.id}`)).text();
  assert.match(html, /name="var_보증금"/);
  assert.match(html, /name="var_월세"/);
  assert.match(html, /빈칸 채우기/);
});

// ---------- 우리 직인 ----------
// 회사는 계약마다 서명하지 않는다 — 직인이 찍힌 계약서를 보내고 상대방만 서명한다.
const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
async function upSeal(env, j, bytes = PNG_1x1) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/law/admin/documents")).text()) || [])[1];
  const fd = new FormData();
  fd.set("_csrf", t);
  fd.set("seal", new File([bytes], "seal.png", { type: "image/png" }));
  const r = await worker.fetch(new Request(B + "/t/law/admin/seal", { method: "POST", headers: { cookie: ch(j) }, body: fd }), env);
  absorb(j, r); return r;
}
const sealField = (docId) => ({ kind: "stamp", page: 0, x: 0.6, y: 0.8, w: 0.09, h: 0.064, assignee: "0", auto: "seal", required: 1 });

test("직인을 등록하면 도장 자리에 자동으로 찍힌다 (그림은 계약서마다 사본을 둔다)", async () => {
  const { env, a, admin, j } = await seed();
  await upSeal(env, j);
  const assoc = await D.getAssociationBySlug(env.DB, "law");
  assert.ok(assoc.seal_media, "직인이 조직에 등록돼야 한다");

  const d = await draftOf(env, a, admin);
  await post(env, j, `/t/law/admin/documents/${d.id}/fields`, { fields: JSON.stringify([sealField(d.id)]) }, `/t/law/admin/documents/${d.id}/fields`);
  const rows = await D.listFieldsWithValues(env.DB, d.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].auto, "seal");
  assert.ok(rows[0].image, "저장하는 순간 찍혀 있어야 한다");
  assert.notEqual(rows[0].image, assoc.seal_media,
    "계약서에는 사본이 들어가야 한다 — 원본을 가리키면 나중에 직인을 바꿀 때 지난 계약서의 도장까지 바뀐다");
});

test("직인을 바꿔도 이미 찍힌 계약서의 도장은 그대로다", async () => {
  const { env, a, admin, j } = await seed();
  await upSeal(env, j);
  const d = await draftOf(env, a, admin);
  await post(env, j, `/t/law/admin/documents/${d.id}/fields`, { fields: JSON.stringify([sealField(d.id)]) }, `/t/law/admin/documents/${d.id}/fields`);
  const before = (await D.listFieldsWithValues(env.DB, d.id))[0].image;
  await upSeal(env, j, Buffer.concat([PNG_1x1, Buffer.from("x")]));
  const after = (await D.listFieldsWithValues(env.DB, d.id))[0].image;
  assert.equal(before, after);
});

test("직인 자리는 서명자에게 요구하지 않는다 (이미 우리가 찍은 자리다)", async () => {
  const { env, a, admin, member, j } = await seed();
  await upSeal(env, j);
  const d = await draftOf(env, a, admin);
  await post(env, j, `/t/law/admin/documents/${d.id}/fields`, {
    fields: JSON.stringify([sealField(d.id), { kind: "sign", page: 0, x: 0.3, y: 0.8, w: 0.2, h: 0.05, assignee: "slot1", required: 1 }]),
  }, `/t/law/admin/documents/${d.id}/fields`);
  await post(env, j, `/t/law/admin/documents/${d.id}/publish`, { party_0: String(member.id) }, "/t/law/admin/documents/write?doc=" + d.id);
  const mine = await D.listFieldsFor(env.DB, d.id, member.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].kind, "sign", "서명 자리만 남고 직인은 빠진다");
});

test("직인은 도장 자리에만 찍을 수 있다", async () => {
  const { env, a, admin, j } = await seed();
  await upSeal(env, j);
  const d = await draftOf(env, a, admin);
  const r = await post(env, j, `/t/law/admin/documents/${d.id}/fields`, {
    fields: JSON.stringify([{ kind: "sign", page: 0, x: 0.3, y: 0.8, w: 0.2, h: 0.05, assignee: "0", auto: "seal", required: 1 }]),
  }, `/t/law/admin/documents/${d.id}/fields`);
  assert.match(decodeURIComponent(r.headers.get("Location") || ""), /도장 자리에만/);
  assert.equal(await D.countFields(env.DB, d.id), 0);
});

test("직인이 등록되지 않았으면 그 사실을 알린다 (조용히 빈 자리로 두지 않는다)", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftOf(env, a, admin);
  const r = await post(env, j, `/t/law/admin/documents/${d.id}/fields`, { fields: JSON.stringify([sealField(d.id)]) }, `/t/law/admin/documents/${d.id}/fields`);
  const loc = decodeURIComponent(r.headers.get("Location") || "");
  assert.match(loc, /등록된 직인이 없습니다/);
  assert.match(loc, /err=1/);
  assert.equal(await D.countFields(env.DB, d.id), 1, "배치 자체는 남는다 — 직인만 올리면 되니까");
});

test("직인 날인은 증적에 '보내는 쪽이 찍은 것' 으로 남는다 (서명자의 봉인과 섞이지 않는다)", async () => {
  const { env, a, admin, j } = await seed();
  await upSeal(env, j);
  const d = await draftOf(env, a, admin);
  await post(env, j, `/t/law/admin/documents/${d.id}/fields`, { fields: JSON.stringify([sealField(d.id)]) }, `/t/law/admin/documents/${d.id}/fields`);
  const events = await D.listDocEvents(env.DB, d.id);
  assert.equal(events.filter((e) => e.kind === "sealed").length, 1);
  assert.equal((await D.listSignatures(env.DB, d.id)).length, 0, "직인은 전자서명이 아니다");
});

test("직인이 서명이 아님을 완성본·확인서·증적이 모두 말한다", async () => {
  const { env, a, admin, member, j } = await seed();
  await upSeal(env, j);
  const d = await draftOf(env, a, admin);
  await post(env, j, `/t/law/admin/documents/${d.id}/fields`, {
    fields: JSON.stringify([sealField(d.id), { kind: "sign", page: 0, x: 0.3, y: 0.8, w: 0.2, h: 0.05, assignee: "slot1", required: 1 }]),
  }, `/t/law/admin/documents/${d.id}/fields`);
  await post(env, j, `/t/law/admin/documents/${d.id}/publish`, { party_0: String(member.id) }, "/t/law/admin/documents/write?doc=" + d.id);

  // ① 완성본 — 도장을 서명으로 읽지 않게
  const mj = jar();
  await post(env, mj, "/login", { email: "m@law.kr", password: "pass1234" });
  const paper = await (await get(env, mj, `/t/law/documents/${d.id}/paper`)).text();
  assert.match(paper, /seal-note/);
  assert.match(paper, /상대방의 전자서명이 아니며/);

  // ② 증적 — 어느 도장이 발신자 것인지 기계도 읽을 수 있게
  const { buildEvidence } = await import("../src/evidence.js");
  const ev = await buildEvidence(env, env.DB, await D.getDocument(env.DB, d.id), await D.getAssociationBySlug(env.DB, "law"));
  assert.ok(ev.count > 0);
  const fileOf = (n) => String((ev.files.find((f) => f.name.includes(n)) || {}).data || "");
  const rec = fileOf("증적.json");
  assert.match(rec, /"채운주체": "발신자직인"/, "어느 도장이 발신자 것인지 기계도 읽을 수 있어야 한다");
  assert.match(rec, /"채운주체": "서명자"/, "서명자 자리와 구분돼야 한다");
  assert.match(fileOf("감사추적.csv"), /직인 날인 \(보내는 쪽\)/, "언제 찍혔는지 남아야 한다");
  assert.match(fileOf("검증방법.txt"), /발신자직인[\s\S]*전자서명이 아닙니다/,
    "받은 사람이 읽는 안내에도 '이 도장은 서명이 아니다' 가 있어야 한다");
});

test("직인은 관리자만 올린다 — 담당자(STAFF)는 못 올린다", async () => {
  const { env, a } = await seed();
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "st@law.kr", passwordHash: pw.hash, salt: pw.salt, name: "직원", role: "STAFF", associationId: a.id });
  const sj = jar();
  await post(env, sj, "/login", { email: "st@law.kr", password: "pass1234" });
  const r = await upSeal(env, sj);
  assert.notEqual(r.status, 303);
  assert.ok(!(await D.getAssociationBySlug(env.DB, "law")).seal_media);
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

// ---------- 계약 목록: 찾을 수 있어야 목록이다 ----------
// 계약이 쌓이면 날짜순 한 덩어리로는 아무것도 못 한다. 상태가 한 낱말이어야 하고,
// 그 낱말이 화면마다 같아야 한다(그래서 상태는 SQL 한 군데에서만 정한다).
async function docWith(env, a, admin, { title, due = "", closed = 0, signers = [], ext = null, sign = 0, decline = 0 }) {
  const body = "제1조 (범위)";
  const d = await D.createDocument(env.DB, { associationId: a.id, title, body, contentHash: await contentHash(body),
    createdBy: admin.id, dueDate: due });
  if (signers.length) await D.createSignatureRequests(env.DB, d.id, signers);
  if (ext) await D.addExternalSigner(env.DB, d.id ? { documentId: d.id, name: ext, signOrder: 9 } : {});
  if (sign) for (const uid of signers.slice(0, sign)) {
    await D.run(env.DB, `INSERT INTO signatures (document_id, user_id, signer_name, content_hash, verify_code, record_hash, ip)
      VALUES (?,?,?,?,?,?,?)`, d.id, uid, "서명자", "h", "code" + d.id + uid, "r", "1.1.1.1");
  }
  if (decline) await D.run(env.DB, "UPDATE signature_requests SET declined_at=datetime('now') WHERE document_id=? AND user_id=?", d.id, signers[0]);
  if (closed) await D.closeDocument(env.DB, d.id);
  return d;
}

test("상태는 다섯 낱말로 정해진다 — 진행 중·기한 지남·반려·완료·마감", async () => {
  const { env, a, admin, member } = await seed();
  const yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await docWith(env, a, admin, { title: "진행중건", signers: [member.id] });
  await docWith(env, a, admin, { title: "기한지남건", signers: [member.id], due: yday });
  await docWith(env, a, admin, { title: "반려건", signers: [member.id], decline: 1 });
  await docWith(env, a, admin, { title: "완료건", signers: [member.id], sign: 1 });
  await docWith(env, a, admin, { title: "마감건", signers: [member.id], closed: 1 });

  const c = await D.documentCounts(env.DB, a.id);
  assert.equal(c.all, 5);
  assert.deepEqual([c.open, c.overdue, c.declined, c.done, c.closed], [1, 1, 1, 1, 1]);

  const byStatus = async (s) => (await D.listDocumentsPage(env.DB, a.id, { status: s })).map((d) => d.title);
  assert.deepEqual(await byStatus("overdue"), ["기한지남건"]);
  assert.deepEqual(await byStatus("declined"), ["반려건"]);
  assert.deepEqual(await byStatus("done"), ["완료건"]);
  assert.deepEqual(await byStatus("closed"), ["마감건"]);
});

test("기한이 지나도 이미 다 받았으면 '기한 지남' 이 아니다", async () => {
  const { env, a, admin, member } = await seed();
  const yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await docWith(env, a, admin, { title: "늦었지만 완료", signers: [member.id], due: yday, sign: 1 });
  const c = await D.documentCounts(env.DB, a.id);
  assert.equal(c.done, 1);
  assert.equal(c.overdue, 0, "다 받은 계약을 붉게 칠하면 매일 거짓 경보를 본다");
});

test("제목으로도, 서명자 이름으로도 찾는다", async () => {
  const { env, a, admin, member } = await seed();
  await docWith(env, a, admin, { title: "용역 위탁 계약서", signers: [member.id] });
  const withExt = await docWith(env, a, admin, { title: "임대차" });
  await D.addExternalSigner(env.DB, { documentId: withExt.id, name: "박외부", org: "○○상사", signOrder: 1 });

  const t = async (q) => (await D.listDocumentsPage(env.DB, a.id, { q })).map((d) => d.title);
  assert.deepEqual(await t("위탁"), ["용역 위탁 계약서"]);
  assert.deepEqual(await t("김서명"), ["용역 위탁 계약서"], "회원 이름으로도 찾아야 한다");
  assert.deepEqual(await t("박외부"), ["임대차"], "외부 상대방 이름으로도 찾아야 한다");
  assert.deepEqual(await t("○○상사"), ["임대차"], "상호로도 찾아야 한다");
  assert.deepEqual(await t("없는말"), []);
  assert.equal((await D.documentCounts(env.DB, a.id, "위탁")).all, 1, "건수도 검색어를 따라야 한다");
});

test("검색어에 %와 _ 를 넣어도 전부 뜨지 않는다 (LIKE 와일드카드)", async () => {
  const { env, a, admin } = await seed();
  await docWith(env, a, admin, { title: "정상 계약" });
  assert.deepEqual((await D.listDocumentsPage(env.DB, a.id, { q: "%" })).map((d) => d.title), []);
  assert.deepEqual((await D.listDocumentsPage(env.DB, a.id, { q: "_" })).map((d) => d.title), []);
});

test("목록은 쪽으로 나뉜다 — 초안은 여기 섞이지 않는다", async () => {
  const { env, a, admin } = await seed();
  for (let i = 0; i < 23; i++) await docWith(env, a, admin, { title: `계약 ${i}` });
  await draftOf(env, a, admin);
  assert.equal((await D.documentCounts(env.DB, a.id)).all, 23, "초안은 보낸 계약이 아니다");
  assert.equal((await D.listDocumentsPage(env.DB, a.id, { limit: 20, offset: 0 })).length, 20);
  assert.equal((await D.listDocumentsPage(env.DB, a.id, { limit: 20, offset: 20 })).length, 3);
});

test("목록 화면에 상태 칩과 검색창이 나온다", async () => {
  const { env, a, admin, member, j } = await seed();
  const yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await docWith(env, a, admin, { title: "기한지남건", signers: [member.id], due: yday });
  const h = await (await get(env, j, "/t/law/admin/documents")).text();
  assert.match(h, /doc-chips/);
  assert.match(h, /기한 지남 <b>1<\/b>/);
  assert.match(h, /name="q"/);
  const filtered = await (await get(env, j, "/t/law/admin/documents?stat=done")).text();
  assert.ok(!/기한지남건/.test(filtered), "다른 상태를 고르면 그 계약은 안 보여야 한다");
});

// ---------- 기한이 지난 계약은 스스로 닫힌다 ----------
// 기한이 지나면 서명은 이미 막혀 있다. 그런데 상태가 '진행 중' 으로 남으면 아무도 손대지 않는
// 계약이 목록에 계속 쌓이고, 그러면 목록을 아무도 안 보게 된다.
test("기한이 지난 미완료 계약은 크론이 마감하고 알림을 남긴다", async () => {
  const { env, a, admin, member } = await seed();
  const yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const tmr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const late = await docWith(env, a, admin, { title: "지난 계약", signers: [member.id], due: yday });
  const soon = await docWith(env, a, admin, { title: "아직 남은 계약", signers: [member.id], due: tmr });
  const doneLate = await docWith(env, a, admin, { title: "늦었지만 완료", signers: [member.id], due: yday, sign: 1 });

  const { runExpireOverdue } = await import("../src/scheduled.js");
  assert.deepEqual(await runExpireOverdue(env), { closed: 1 });

  assert.equal((await D.getDocument(env.DB, late.id)).closed, 1);
  assert.equal((await D.getDocument(env.DB, soon.id)).closed, 0, "기한이 남았으면 건드리지 않는다");
  assert.equal((await D.getDocument(env.DB, doneLate.id)).closed, 0, "다 받은 계약을 마감으로 덮으면 '체결 완료' 가 사라진다");

  const ev = await D.listDocEvents(env.DB, late.id);
  assert.equal(ev.filter((e) => e.kind === "expired").length, 1, "왜 닫혔는지 증적에 남아야 한다");
  const notes = await D.listNotifications(env.DB, a.id);
  assert.match(notes.map((n) => n.message).join(" "), /기한이 지나 마감했습니다 — 지난 계약/);

  // 두 번 돌려도 다시 닫지 않는다 (알림이 매일 쌓이면 아무도 안 읽는다)
  assert.deepEqual(await runExpireOverdue(env), { closed: 0 });
  assert.equal((await D.listNotifications(env.DB, a.id)).length, notes.length);
});

// ---------- 파일 첨부 자리 ----------
// "사업자등록증 첨부해 주세요" 를 이메일로 받으면 증적이 두 곳으로 갈라진다.
// 계약서 안에서 받고, 그 해시가 서명 봉인에 함께 들어가야 한 벌이 된다.
const PDF_BYTES = () => {
  const head = new TextEncoder().encode("%PDF-1.7\n");
  const tail = new TextEncoder().encode("\n%%EOF\n");
  const mid = new Uint8Array(600).fill(0x20);
  const out = new Uint8Array(head.length + mid.length + tail.length);
  out.set(head, 0); out.set(mid, head.length); out.set(tail, head.length + mid.length);
  return out;
};
async function signWithFile(env, a, member, doc, file) {
  const mj = jar();
  await post(env, mj, "/login", { email: "m@law.kr", password: "pass1234" });
  const page = await (await get(env, mj, `/t/law/sign/${doc.id}`)).text();
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(page) || [])[1];
  const fields = await D.listFieldsFor(env.DB, doc.id, member.id);
  const fileF = fields.find((f) => f.kind === "file");
  const fd = new FormData();
  fd.set("_csrf", csrf); fd.set("consent", "1"); fd.set("signer_name", "김서명");
  fd.set("fields", JSON.stringify({}));
  // 이 문서에는 서명 자리를 따로 두지 않았으므로 서명판 그림이 필요하다 —
  // 계약서에 첨부만 있고 서명이 없으면 그건 계약이 아니다.
  fd.set("signature", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
  if (file) fd.set(`file_${fileF.id}`, new File([file.bytes], file.name, { type: file.type }));
  const r = await worker.fetch(new Request(B + `/t/law/sign/${doc.id}`, { method: "POST", headers: { cookie: ch(mj) }, body: fd }), env);
  return { r, fileF, page };
}
async function docWithFile(env, a, admin, member, { required = 1 } = {}) {
  const body = "제1조 (범위)";
  const d = await D.createDocument(env.DB, { associationId: a.id, title: "첨부 계약", body,
    contentHash: await contentHash(body), createdBy: admin.id });
  await D.createSignatureRequests(env.DB, d.id, [member.id]);
  await D.replaceFields(env.DB, d.id, [
    { kind: "file", label: "사업자등록증", page: 0, x: 0.3, y: 0.8, w: 0.26, h: 0.042, assignee: member.id, required },
  ]);
  return d;
}

test("첨부 자리는 서명 화면에 진짜 파일 입력으로 나오고, 폼은 multipart 다", async () => {
  const { env, a, admin, member } = await seed();
  const d = await docWithFile(env, a, admin, member);
  const mj = jar();
  await post(env, mj, "/login", { email: "m@law.kr", password: "pass1234" });
  const h = await (await get(env, mj, `/t/law/sign/${d.id}`)).text();
  assert.match(h, /enctype="multipart\/form-data"/, "파일은 JSON 에 실어 보내지 않는다");
  assert.match(h, /name="file_\d+"/);
});

test("첨부를 안 올리면 서명이 접수되지 않는다 (화면을 우회해도)", async () => {
  const { env, a, admin, member } = await seed();
  const d = await docWithFile(env, a, admin, member);
  const { r } = await signWithFile(env, a, member, d, null);
  assert.match(decodeURIComponent(r.headers.get("Location") || ""), /파일을 올려 주세요/);
  assert.equal((await D.listSignatures(env.DB, d.id)).length, 0);
});

test("이미지·PDF 만 받는다 (실행 파일이 섞이면 여는 사람이 위험해진다)", async () => {
  const { env, a, admin, member } = await seed();
  const d = await docWithFile(env, a, admin, member);
  const evil = new TextEncoder().encode("MZ\x90\x00실행파일");
  const { r } = await signWithFile(env, a, member, d, { bytes: evil, name: "나쁜것.exe", type: "application/octet-stream" });
  assert.match(decodeURIComponent(r.headers.get("Location") || ""), /이미지 또는 PDF/);
  assert.equal((await D.listSignatures(env.DB, d.id)).length, 0);
});

test("첨부하면 파일 이름과 해시가 남고, 그 해시가 서명 봉인에 들어간다", async () => {
  const { env, a, admin, member } = await seed();
  const { verifySignature } = await import("../src/esign.js");
  const d = await docWithFile(env, a, admin, member);
  const { r } = await signWithFile(env, a, member, d, { bytes: PDF_BYTES(), name: "사업자등록증.pdf", type: "application/pdf" });
  const loc = decodeURIComponent(r.headers.get("Location") || "");
  assert.ok(!/err=1/.test(loc), `서명이 접수되지 않았다: ${r.headers.get("Location")}`);

  const row = (await D.listFieldsWithValues(env.DB, d.id)).find((f) => f.kind === "file");
  assert.equal(row.value, "사업자등록증.pdf", "무슨 서류인지가 증적에서 중요하다");
  assert.ok(row.image, "R2 키가 있어야 다시 받을 수 있다");
  assert.match(row.image_hash, /^[0-9a-f]{64}$/);

  const sig = (await D.listSignatures(env.DB, d.id))[0];
  const doc = await D.getDocument(env.DB, d.id);
  assert.equal((await verifySignature(env, sig, doc)).valid, true);
  // 첨부만 바꿔치기해도 잡혀야 한다
  await D.run(env.DB, "UPDATE doc_field_values SET image_hash='deadbeef' WHERE field_id=?", row.id);
  assert.equal((await verifySignature(env, sig, doc)).valid, false, "첨부를 바꾸면 봉인이 깨져야 한다");
});

test("파일 이름의 경로 문자는 지운다 (증적 ZIP 에 그대로 들어간다)", async () => {
  const { env, a, admin, member } = await seed();
  const d = await docWithFile(env, a, admin, member);
  await signWithFile(env, a, member, d, { bytes: PDF_BYTES(), name: "../../etc/passwd.pdf", type: "application/pdf" });
  const row = (await D.listFieldsWithValues(env.DB, d.id)).find((f) => f.kind === "file");
  assert.ok(!/[\\/]/.test(row.value), `경로 문자가 남았다: ${row.value}`);
});

test("증적 ZIP 은 첨부를 원래 확장자로 담는다 (.png 로 저장하면 안 열린다)", async () => {
  const { env, a, admin, member } = await seed();
  const d = await docWithFile(env, a, admin, member);
  await signWithFile(env, a, member, d, { bytes: PDF_BYTES(), name: "사업자등록증.pdf", type: "application/pdf" });
  const { buildEvidence } = await import("../src/evidence.js");
  const ev = await buildEvidence(env, env.DB, await D.getDocument(env.DB, d.id), await D.getAssociationBySlug(env.DB, "law"));
  const names = ev.files.map((f) => f.name);
  assert.ok(names.some((n) => n.startsWith("6_이미지/") && n.endsWith(".pdf")), `PDF 가 안 담겼다: ${names.join(", ")}`);
});
