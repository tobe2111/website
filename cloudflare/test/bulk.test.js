// 대량 발송 — 한 계약서를 명단대로 각각 한 부씩.
//
// 여기서 지켜야 하는 것은 세 가지다.
//   1. 사람마다 빈칸 값이 다르면 **글자 수가 달라져 지면의 줄이 밀린다.** 그 위에 놓아 둔
//      서명 자리가 함께 따라가지 않으면, 100명 중 뒤쪽 사람들은 엉뚱한 자리에 서명하게 된다.
//   2. 같은 사람에게 두 번 가지 않는다. 창을 닫았다 다시 들어와도 마찬가지다.
//   3. 명단의 한 줄이 틀렸다고 나머지가 멈추지 않고, 그 한 줄이 조용히 사라지지도 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { contentHash } from "../src/esign.js";
import { parseTable, toCsv, decodeUtf8, headerRole } from "../src/csv.js";
import { parseRoster, BULK_MAX, BULK_CHUNK } from "../src/api.js";
import { remapFields, paginate, PAGE, LINE_H, LINES_PER_PAGE } from "../src/paper.js";

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
const msgOf = (r) => decodeURIComponent((/[?&]msg=([^&]*)/.exec(r.headers.get("location") || "") || [])[1] || "");

async function seed() {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "law", name: "한빛법무법인", kind: "esign" });
  const pw = await hashPassword("pass1234");
  const admin = await D.createUser(env.DB, { email: "ad@law.kr", passwordHash: pw.hash, salt: pw.salt, name: "담당", role: "ADMIN", associationId: a.id });
  const j = jar();
  await post(env, j, "/login", { email: "ad@law.kr", password: "pass1234" });
  return { env, a, admin, j };
}

// 본문이 두 쪽을 넘도록 길게 — 줄이 밀리면 쪽까지 넘어가는지 보려면 짧은 본문으로는 안 된다.
const LONG = Array.from({ length: 40 }, (_, i) => `제${i + 1}조 (조항) 이 조항의 내용은 다음과 같다.`).join("\n");
const BODY = `용역 계약서\n${LONG}\n대금은 {{대금}} 으로 한다.\n본 계약을 증명하기 위하여 2부를 작성한다.`;

async function draftWithFields(env, a, admin, body = BODY) {
  const d = await D.createDocument(env.DB, {
    associationId: a.id, title: "용역 계약서", body, contentHash: await contentHash(body), createdBy: admin.id, draft: 1 });
  await D.replaceFields(env.DB, d.id, [
    { kind: "name", label: "성명", page: 1, x: 0.1, y: 0.7, w: 0.2, h: 0.032, slot: 1, required: 1 },
    { kind: "sign", label: "서명", page: 1, x: 0.4, y: 0.69, w: 0.22, h: 0.05, slot: 1, required: 1 },
  ]);
  await D.replaceDocParties(env.DB, d.id, { 1: "수급인" });
  return d;
}

// ── 표 읽기 ─────────────────────────────────────────────
test("표 읽기: 엑셀에서 복사한 탭 구분도, 파일로 내보낸 쉼표도 똑같이 읽는다", () => {
  const tab = parseTable("이름\t휴대폰\n홍길동\t010-1234-5678");
  const csv = parseTable("이름,휴대폰\n홍길동,010-1234-5678");
  assert.deepEqual(tab, csv);
  assert.deepEqual(tab[1], ["홍길동", "010-1234-5678"]);
});

test("표 읽기: 따옴표 안의 쉼표는 한 칸이다 (주소에 쉼표가 흔하다)", () => {
  const t = parseTable('이름,주소\n홍길동,"서울 서초구 서초대로, 3층"');
  assert.equal(t[1].length, 2);
  assert.equal(t[1][1], "서울 서초구 서초대로, 3층");
});

test('표 읽기: 따옴표 두 개("")는 따옴표 한 개다', () => {
  assert.equal(parseTable('a\n"그는 ""안녕"" 이라 했다"')[1][0], '그는 "안녕" 이라 했다');
});

test("표 읽기: BOM · 윈도우 줄바꿈 · 빈 줄이 섞여도 사람 수가 맞는다", () => {
  const t = parseTable("﻿이름,휴대폰\r\n홍길동,01012345678\r\n\r\n김철수,01098765432\r\n");
  assert.equal(t.length, 3, "머리글 1 + 사람 2");
});

test("머리글 알아보기: '성명'도 '연락처'도 사람이 쓰는 말 그대로 받는다", () => {
  assert.equal(headerRole("성명"), "name");
  assert.equal(headerRole("연 락 처"), "phone");
  assert.equal(headerRole("E-Mail"), "email");
  assert.equal(headerRole("회사명"), "org");
  assert.equal(headerRole("대금"), null, "계약서 빈칸 이름은 사람 정보가 아니다");
});

test("CSV 내보내기에는 BOM 이 붙는다 (없으면 엑셀에서 한글이 깨진다)", () => {
  assert.ok(toCsv([["이름"]]).startsWith("﻿"));
});

test("UTF-8 이 아닌 파일은 추측하지 않고 '어떻게 저장하라'고 말해 준다", () => {
  const cp949 = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]); // '한글' (CP949)
  const r = decodeUtf8(cp949);
  assert.equal(r.ok, false);
  assert.match(r.error, /CSV UTF-8/);
  assert.match(r.error, /붙여넣기/, "대안을 함께 알려 줘야 사람이 막히지 않는다");
});

// ── 명단 검사 ───────────────────────────────────────────
test("명단: 계약서 빈칸에 해당하는 칸이 없으면 그 이름을 짚어 알려 준다", () => {
  const r = parseRoster("이름,휴대폰\n홍길동,01012345678", ["대금"]);
  assert.match(r.error, /'대금'/);
});

test("명단: 링크 보낼 곳이 아예 없는 머리글은 받지 않는다", () => {
  assert.match(parseRoster("이름,상호\n홍길동,길동상회", []).error, /휴대폰.*이메일|이메일.*휴대폰/);
});

test("명단: 틀린 줄은 버리지 않고 '왜 못 보내는지'를 달아 남긴다", () => {
  const r = parseRoster([
    "이름,휴대폰,대금",
    "홍길동,010-1234-5678,300만원",
    ",010-2222-3333,100만원",          // 이름 없음
    "김철수,0999,200만원",              // 번호 형식
    "이영희,010-4444-5555,",            // 빈칸 비었음
  ].join("\n"), ["대금"]).rows;
  assert.equal(r.length, 4, "틀린 줄도 남아야 사람이 고칠 수 있다");
  assert.equal(r[0].status, "pending");
  assert.match(r[1].note, /이름/);
  assert.match(r[2].note, /휴대폰/);
  assert.match(r[3].note, /빈칸/);
  assert.equal(r.filter((x) => x.status === "pending").length, 1);
  assert.deepEqual(r.map((x) => x.seq), [1, 2, 3, 4], "줄 번호가 있어야 어느 줄을 고칠지 안다");
});

test("명단: 같은 연락처가 두 번 있으면 두 번째는 보내지 않는다 (계약서가 두 부 가는 사고)", () => {
  const r = parseRoster("이름,휴대폰\n홍길동,010-1234-5678\n홍길동,010-1234-5678", []).rows;
  assert.equal(r[0].status, "pending");
  assert.equal(r[1].status, "failed");
  assert.match(r[1].note, /같은 연락처/);
});

test("명단: 휴대폰이 없어도 이메일만 있으면 보낼 수 있다", () => {
  const r = parseRoster("이름,이메일\n홍길동,hong@example.com", []).rows;
  assert.equal(r[0].status, "pending");
});

test(`명단: ${BULK_MAX}명을 넘으면 받지 않는다 (한 번에 다 보낼 수 없다)`, () => {
  const rows = Array.from({ length: BULK_MAX + 1 }, (_, i) => `사람${i},010-1234-${String(1000 + i).slice(0, 4)}`);
  const r = parseRoster(["이름,휴대폰", ...rows].join("\n"), []);
  assert.match(r.error, new RegExp(String(BULK_MAX)));
});

// ── 줄 밀림 보정 ────────────────────────────────────────
test("줄 밀림: 빈칸을 길게 채워 줄이 밀려도 서명 자리가 같은 문단을 따라간다", () => {
  const from = "머리말\n대금은 {{대금}} 으로 한다.\n" + "가".repeat(500) + "\n끝.";
  const to = from.replace("{{대금}}", "일금 삼백만원정 (₩3,000,000) — 부가가치세 별도, 계약일로부터 30일 이내");
  // '끝.' 문단이 몇 번째 줄인지 — 채우기 전과 후
  const lineOf = (body, text) => {
    let n = 0;
    for (const p of body.split("\n")) { if (p === text) return n; n += paginate(p).flat().length; }
    return -1;
  };
  const yOf = (line) => (PAGE.pad + line * LINE_H) / PAGE.h;
  const before = lineOf(from, "끝.");
  const after = lineOf(to, "끝.");
  assert.notEqual(before, after, "이 시나리오는 줄이 실제로 밀려야 의미가 있다");
  const moved = remapFields(from, to, [{ kind: "sign", page: 0, x: 0.1, y: yOf(before), w: 0.2, h: 0.05 }]);
  const gotLine = Math.round((moved[0].y * PAGE.h - PAGE.pad) / LINE_H) + moved[0].page * LINES_PER_PAGE;
  assert.equal(gotLine, after, "서명 자리가 '끝.' 문단과 함께 움직여야 한다");
});

test("줄 밀림: 본문 아래(서명란)는 본문 끝에서부터의 거리를 지킨다", () => {
  const from = "가나다\n{{값}}";
  const to = from.replace("{{값}}", "라".repeat(600));   // 한 줄이 여러 줄로 늘어난다
  const lines = (b) => paginate(b).flat().length;
  const y = (PAGE.pad + (lines(from) + 2) * LINE_H) / PAGE.h;   // 본문 끝에서 두 줄 아래
  const moved = remapFields(from, to, [{ kind: "sign", page: 0, x: 0.1, y, w: 0.2, h: 0.05 }]);
  const absLine = moved[0].page * LINES_PER_PAGE + Math.round((moved[0].y * PAGE.h - PAGE.pad) / LINE_H);
  assert.ok(lines(to) > lines(from), "이 시나리오는 본문이 실제로 길어져야 의미가 있다");
  assert.equal(absLine, lines(to) + 2, "새 본문 끝에서도 두 줄 아래여야 서명란이 본문을 덮지 않는다");
});

test("줄 밀림: 줄 수가 그대로면 좌표를 손대지 않는다 (쓸데없이 움직이면 봉인 해시가 흔들린다)", () => {
  const f = [{ kind: "sign", page: 1, x: 0.1, y: 0.7, w: 0.2, h: 0.05 }];
  const moved = remapFields("가나\n다라", "마바\n사아", f);
  assert.equal(moved[0].page, 1);
  assert.equal(moved[0].y, 0.7);
});

test("줄 밀림: 새 본문에 없는 쪽으로는 보내지 않는다 (안 보이는 자리 = 아무도 못 하는 서명)", () => {
  const from = "머리\n" + "가".repeat(5000);        // 여러 쪽
  const to = "머리\n짧다";                            // 한 쪽
  const moved = remapFields(from, to, [{ kind: "sign", page: 3, x: 0.1, y: 0.5, w: 0.2, h: 0.05 }]);
  assert.ok(moved[0].page <= paginate(to).length - 1, "없는 쪽에 남으면 안 된다");
  assert.ok(moved[0].y + 0.05 <= 1, "지면 밖으로 나가면 안 된다");
});

// ── 실제 발송 ───────────────────────────────────────────
const ROSTER = ["이름\t휴대폰\t상호\t대금",
  "홍길동\t010-1111-2222\t길동상회\t300만원",
  "김철수\t010-3333-4444\t철수마트\t500만원",
  "이영희\t010-5555-6666\t영희상사\t700만원"].join("\n");

async function prepare(env, j, d, extra = {}) {
  return post(env, j, `/t/law/admin/documents/${d.id}/bulk`,
    { paste: ROSTER, to_slot: "1", title: "용역 계약서 ({{상호}})", ...extra },
    `/t/law/admin/documents/${d.id}/bulk`);
}

test("대량 발송: 명단을 올려도 아직 아무것도 나가지 않는다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftWithFields(env, a, admin);
  const r = await prepare(env, j, d);
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /\/admin\/bulk\/\d+$/);
  assert.equal((await D.listDocuments(env.DB, a.id)).length, 0, "이 단계에서 계약서가 생기면 안 된다");
  const bid = Number(/\/bulk\/(\d+)/.exec(r.headers.get("location"))[1]);
  const c = await D.batchCounts(env.DB, bid);
  assert.equal(c.total, 3);
  assert.equal(c.pending, 3);
});

test("대량 발송: 사람마다 자기 값이 들어간 계약서가 한 부씩 생긴다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftWithFields(env, a, admin);
  const bid = Number(/\/bulk\/(\d+)/.exec((await prepare(env, j, d)).headers.get("location"))[1]);
  const run = await post(env, j, `/t/law/admin/bulk/${bid}/run`, {}, `/t/law/admin/bulk/${bid}`);
  const out = await run.json();
  assert.equal(out.ok, true);
  assert.equal(out.sent, 3);
  assert.equal(out.pending, 0);

  const docs = await D.listDocuments(env.DB, a.id);
  assert.equal(docs.length, 3);
  const titles = docs.map((x) => x.title).sort();
  assert.deepEqual(titles, ["용역 계약서 (길동상회)", "용역 계약서 (영희상사)", "용역 계약서 (철수마트)"]);
  for (const doc of docs) {
    const full = await D.getDocument(env.DB, doc.id);
    assert.equal(full.draft, 0, "보낸 계약이어야 한다");
    assert.doesNotMatch(full.body, /\{\{/, "빈칸이 그대로 박힌 계약서가 나가면 안 된다");
  }
  const one = docs.find((x) => x.title.includes("길동상회"));
  assert.match((await D.getDocument(env.DB, one.id)).body, /300만원/);
});

test("대량 발송: 받는 사람이 당사자 자리에 앉고, 서명 자리가 그 사람 몫으로 확정된다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftWithFields(env, a, admin);
  const bid = Number(/\/bulk\/(\d+)/.exec((await prepare(env, j, d)).headers.get("location"))[1]);
  await post(env, j, `/t/law/admin/bulk/${bid}/run`, {}, `/t/law/admin/bulk/${bid}`);
  const doc = (await D.listDocuments(env.DB, a.id))[0];
  const ext = await D.listExternalSigners(env.DB, doc.id);
  assert.equal(ext.length, 1);
  const fields = await D.listFields(env.DB, doc.id);
  assert.equal(fields.length, 2, "서명 자리가 함께 복사돼야 한다");
  for (const f of fields) assert.equal(f.assignee, -ext[0].id, "자리가 그 사람 몫으로 확정돼야 한다");
  const parties = await D.listDocParties(env.DB, doc.id);
  assert.equal(parties[1], "수급인", "당사자 이름표도 함께 간다");
});

test("대량 발송: 서명 자리가 사람마다 다른 쪽·다른 높이로 따라 옮겨진다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftWithFields(env, a, admin);
  // 대금 길이를 크게 다르게 — 짧은 사람과 아주 긴 사람
  const roster = ["이름\t휴대폰\t대금", "짧은이\t010-1111-2222\t백만원",
    `긴이\t010-3333-4444\t${"금".repeat(900)}`].join("\n");
  const r = await post(env, j, `/t/law/admin/documents/${d.id}/bulk`, { paste: roster, to_slot: "1" }, `/t/law/admin/documents/${d.id}/bulk`);
  const bid = Number(/\/bulk\/(\d+)/.exec(r.headers.get("location"))[1]);
  await post(env, j, `/t/law/admin/bulk/${bid}/run`, {}, `/t/law/admin/bulk/${bid}`);
  const rows = await D.listBatchRows(env.DB, bid);
  assert.equal(rows.filter((x) => x.status === "sent").length, 2);
  const [shortDoc, longDoc] = await Promise.all(rows.map((x) => D.getDocument(env.DB, x.document_id)));
  const [fs, fl] = await Promise.all([D.listFields(env.DB, shortDoc.id), D.listFields(env.DB, longDoc.id)]);
  // 긴 쪽은 본문이 길어졌으니 서명 자리가 더 아래(또는 다음 쪽)로 가야 한다
  const abs = (f) => f.page * LINES_PER_PAGE + (f.y * PAGE.h - PAGE.pad) / LINE_H;
  assert.ok(abs(fl[0]) > abs(fs[0]), "본문이 길어진 계약서는 서명 자리도 아래로 내려가야 한다");
  // 그리고 어느 쪽도 지면 밖으로 나가지 않는다
  for (const f of [...fs, ...fl]) {
    assert.ok(f.y >= 0 && f.y + f.h <= 1, "지면 안에 있어야 한다");
    assert.ok(f.page >= 0, "쪽 번호가 음수면 안 된다");
  }
});

test("대량 발송: 나눠 보내도 같은 사람에게 두 번 가지 않는다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftWithFields(env, a, admin);
  const bid = Number(/\/bulk\/(\d+)/.exec((await prepare(env, j, d)).headers.get("location"))[1]);
  // 한 번 돌리고, 또 돌리고, 또 돌린다 (브라우저가 반복해서 부르는 상황)
  for (let i = 0; i < 4; i++) await post(env, j, `/t/law/admin/bulk/${bid}/run`, {}, `/t/law/admin/bulk/${bid}`);
  assert.equal((await D.listDocuments(env.DB, a.id)).length, 3, "세 명이면 계약서도 딱 세 부");
  const phones = (await D.listBatchRows(env.DB, bid)).map((r) => r.phone);
  assert.equal(new Set(phones).size, 3);
});

test(`대량 발송: 한 번의 요청에서 ${BULK_CHUNK}명까지만 보낸다 (한 요청에 다 보내려다 죽는다)`, async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftWithFields(env, a, admin, "간단 계약서\n내용은 {{값}} 이다.");
  const many = Array.from({ length: BULK_CHUNK + 3 }, (_, i) => `사람${i}\t010-1111-${String(2000 + i)}\t값${i}`);
  const r = await post(env, j, `/t/law/admin/documents/${d.id}/bulk`,
    { paste: ["이름\t휴대폰\t값", ...many].join("\n"), to_slot: "1" }, `/t/law/admin/documents/${d.id}/bulk`);
  const bid = Number(/\/bulk\/(\d+)/.exec(r.headers.get("location"))[1]);
  const one = await (await post(env, j, `/t/law/admin/bulk/${bid}/run`, {}, `/t/law/admin/bulk/${bid}`)).json();
  assert.equal(one.ran, BULK_CHUNK);
  assert.equal(one.pending, 3);
});

test("대량 발송: 틀린 줄은 실패로 남고, 나머지는 그대로 나간다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftWithFields(env, a, admin);
  const roster = ["이름\t휴대폰\t대금", "홍길동\t010-1111-2222\t300만원", "\t010-3333-4444\t500만원"].join("\n");
  const r = await post(env, j, `/t/law/admin/documents/${d.id}/bulk`, { paste: roster, to_slot: "1" }, `/t/law/admin/documents/${d.id}/bulk`);
  const bid = Number(/\/bulk\/(\d+)/.exec(r.headers.get("location"))[1]);
  const out = await (await post(env, j, `/t/law/admin/bulk/${bid}/run`, {}, `/t/law/admin/bulk/${bid}`)).json();
  assert.equal(out.sent, 1);
  assert.equal(out.failed, 1);
  assert.equal((await D.listDocuments(env.DB, a.id)).length, 1);
});

test("대량 발송: 이미 보낸 계약서에서는 시작할 수 없다 (서명·증적까지 복사될 뻔한다)", async () => {
  const { env, a, admin, j } = await seed();
  const body = "간단 계약서";
  const sent = await D.createDocument(env.DB, { associationId: a.id, title: "이미 보냄", body, contentHash: await contentHash(body), createdBy: admin.id });
  const r = await post(env, j, `/t/law/admin/documents/${sent.id}/bulk`, { paste: ROSTER }, `/t/law/admin/documents/${sent.id}`);
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.match(msgOf(r), /작성 중인 계약서/);
});

test("대량 발송: 다른 조직의 초안으로는 명단을 만들 수 없다", async () => {
  const { env, admin, j } = await seed();
  const other = await D.createAssociation(env.DB, { slug: "other", name: "남의회사", kind: "esign" });
  const body = "남의 계약서";
  const d = await D.createDocument(env.DB, { associationId: other.id, title: "남의 초안", body, contentHash: await contentHash(body), createdBy: admin.id, draft: 1 });
  const r = await post(env, j, `/t/law/admin/documents/${d.id}/bulk`, { paste: ROSTER }, "/t/law/admin/documents");
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.equal((await D.listBatches(env.DB, other.id)).length, 0);
});

test("대량 발송: 다른 조직의 명단은 열지도 돌리지도 못한다", async () => {
  const { env, a, admin, j } = await seed();
  const other = await D.createAssociation(env.DB, { slug: "other", name: "남의회사", kind: "esign" });
  const b = await D.createBatch(env.DB, { associationId: other.id, sourceId: 1, title: "남의 명단", createdBy: admin.id });
  assert.equal((await get(env, j, `/t/law/admin/bulk/${b.id}`)).status, 404);
  const run = await post(env, j, `/t/law/admin/bulk/${b.id}/run`, {}, "/t/law/admin/documents");
  assert.equal(run.status, 404);
  assert.ok(a.id !== other.id);
});

test("대량 발송: 명단을 지워도 이미 보낸 계약서는 남는다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftWithFields(env, a, admin);
  const bid = Number(/\/bulk\/(\d+)/.exec((await prepare(env, j, d)).headers.get("location"))[1]);
  await post(env, j, `/t/law/admin/bulk/${bid}/run`, {}, `/t/law/admin/bulk/${bid}`);
  const r = await post(env, j, `/t/law/admin/bulk/${bid}/delete`, {}, `/t/law/admin/bulk/${bid}`);
  assert.match(msgOf(r), /그대로 남아/);
  assert.equal(await D.getBatch(env.DB, bid), null);
  assert.equal((await D.listDocuments(env.DB, a.id)).length, 3, "계약은 남아야 한다");
});

test("대량 발송 화면: 계약서의 빈칸 이름이 그대로 명단 머리글로 안내된다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftWithFields(env, a, admin);
  const h = await (await get(env, j, `/t/law/admin/documents/${d.id}/bulk`)).text();
  assert.match(h, /대금/);
  assert.match(h, /수급인/, "당사자 이름표가 자리 선택에 나와야 누가 어디 앉는지 안다");
  assert.match(h, /CSV UTF-8/, "엑셀 저장 방법을 여기서 말해 줘야 한다");
});

test("명단 양식 내려받기: 머리글이 이 계약서의 빈칸과 정확히 같다", async () => {
  const { env, a, admin, j } = await seed();
  const d = await draftWithFields(env, a, admin);
  const r = await get(env, j, `/t/law/admin/documents/${d.id}/bulk/sample`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /text\/csv/);
  const head = parseTable(await r.text())[0];
  assert.deepEqual(head, ["이름", "휴대폰", "이메일", "상호", "대금"]);
});
