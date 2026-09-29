// 물품 지급대장 — 한 사람에 한 장씩 받고, 관리자가 대장으로 모아 찍는다.
//
// 이 검사가 지키는 것은 하나다: **양식이 바뀌지 않는 것**.
// 재단이 내려준 종이의 문구·칸 이름이 한 글자라도 달라지면 제출본이 반려되고,
// 이미 받아 둔 동의도 "다른 내용에 동의한 것" 이 되어 쓸 수 없게 된다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { BUILTIN, extractVars, fillVars } from "../src/templates.js";
import { contentHash } from "../src/esign.js";

const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, u) { const r = await worker.fetch(new Request(u, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, u, f, csrfFrom) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, csrfFrom)).text()) || [])[1];
  const r = await worker.fetch(new Request(u, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}

// 재단 양식에서 그대로 옮겨 온 문구 — 이 목록이 곧 계약이다.
const 원문 = [
  "물품(쿠폰, 경품, 기념품) 지급대장",
  "개인정보 수집·이용·제공동의서",
  "본 사업의 추진을 위하여 아래와 같이 개인정보를 수집·이용·제공하고자 합니다.",
  "아래의 내용을 확인하신 후 동의여부를 결정하여 주시기 바랍니다.",
  "※수집된 정보는 수집 목적 외에 사용하지 않습니다.",
  "◆개인정보의 수집·이용에 관한 사항",
  "◆개인정보의 제3자 제공에 관한 사항",
  "서울신용보증재단(수탁자 ㈜0000)",
  "서울시, 자치구",
  "성명,휴대번호,생년월일",
  "물품지급관리 및 사업 결과보고",
  "사업지원종료 후 5년간",
];

test("지급 동의서 서식 — 재단 문구가 한 글자도 바뀌지 않았다", () => {
  const t = BUILTIN.find((x) => x.id === "b-payout");
  assert.ok(t, "b-payout 서식이 있어야 한다");
  assert.equal(t.only, "merchant", "상인회에서만 보인다");
  for (const line of 원문.slice(1)) assert.ok(t.body.includes(line), `빠진 문구: ${line}`);
  // 거부 문구는 줄바꿈이 들어가므로 두 토막으로 확인한다
  assert.ok(t.body.includes("※개인정보 수집·이용·제공에 대해 거부할 권리가 있습니다."), "거부 권리 안내");
  assert.ok(t.body.includes("지급받으실 수 없습니다."), "거부 시 결과 안내");
  // 사람마다 달라지는 값
  assert.deepEqual(extractVars(t.body), ["상권명", "사업명", "품목", "지급일", "성명", "연락처", "생년월일", "수량"]);
  // 동의는 두 갈래를 따로 받아야 한다 — 하나로 묶으면 제3자 제공까지 한 번에 동의시킨 것이 된다
  const checks = t.fields.filter((f) => f.kind === "check");
  assert.equal(checks.length, 2, "수집·이용 / 제3자 제공 각각");
  assert.ok(checks.every((c) => c.required === 1));
  assert.ok(t.fields.some((f) => f.kind === "sign"), "수령자 서명란");
});

test("대장: 서명한 사람만 연번 순으로, 여덟 줄마다 장을 넘긴다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "market", name: "방배카페골목상인회", kind: "merchant" });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "office@m.kr", passwordHash: ad.hash, salt: ad.salt, name: "총무", role: "ADMIN", associationId: a.id });
  const tpl = BUILTIN.find((x) => x.id === "b-payout");

  // 아홉 사람 — 여덟 줄이 한 장이므로 두 장이 나와야 한다. 그중 한 명은 아직 서명 전.
  const people = Array.from({ length: 9 }, (_, i) => ({
    name: `수령자${i + 1}`, phone: `0101000${String(1000 + i)}`, birth: `9001${String(10 + i)}`, qty: "1",
  }));
  const batch = await D.createBatch(env.DB, { associationId: a.id, sourceId: 0, title: "물품 지급 동의서", ordered: 0, dueDate: "", slot: 1, fixed: [], createdBy: null, teamId: 0 });
  let seq = 0;
  for (const p of people) {
    seq++;
    const vars = { 상권명: "방배카페골목", 사업명: "2026 상권활성화 사업", 품목: "온누리상품권", 지급일: "`26.09.01", 성명: p.name, 연락처: "010-1000-" + String(1000 + seq), 생년월일: p.birth, 수량: p.qty };
    const doc = await D.createDocument(env.DB, { associationId: a.id, title: `물품 지급 동의서 — ${p.name}`,
      body: fillVars(tpl.body, vars), contentHash: await contentHash(fillVars(tpl.body, vars)), createdBy: null, draft: 0 });
    await D.addBatchRow(env.DB, batch.id, { seq, name: p.name, phone: p.phone, email: "", org: "", vars, status: "sent", note: "" });
    const rows = await D.listBatchRows(env.DB, batch.id);
    await D.setBatchRow(env.DB, rows[rows.length - 1].id, { status: "sent", documentId: doc.id, note: "" });
    // 마지막 한 사람만 서명하지 않은 채로 둔다
    if (seq === 9) continue;
    await D.replaceFields(env.DB, doc.id, [
      { kind: "check", label: "개인정보 수집·이용 동의", page: 0, x: 0.1, y: 0.6, w: 0.03, h: 0.02, assignee: 0, slot: 1, auto: "", required: 1, sort: 0 },
      { kind: "check", label: "개인정보 제3자 제공 동의", page: 0, x: 0.1, y: 0.66, w: 0.03, h: 0.02, assignee: 0, slot: 1, auto: "", required: 1, sort: 1 },
      { kind: "sign", label: "수령자 서명", page: 0, x: 0.36, y: 0.75, w: 0.24, h: 0.05, assignee: 0, slot: 1, auto: "", required: 1, sort: 2 },
    ]);
    const fs = await D.listFields(env.DB, doc.id);
    for (const f of fs) {
      // 세 번째 사람은 제3자 제공에 동의하지 않았다 — 대장에 그대로 나와야 한다
      if (f.kind === "check" && /제3자/.test(f.label) && seq === 3) continue;
      await D.setFieldValue(env.DB, { fieldId: f.id, documentId: doc.id, userId: 0,
        value: f.kind === "sign" ? "" : "1", image: f.kind === "sign" ? `sign-${seq}.png` : "", imageHash: "" });
    }
  }

  const j = jar();
  await post(env, j, "http://localhost/t/market/login", { email: "office@m.kr", password: "admin1234" }, "http://localhost/t/market/login");
  const r = await get(env, j, `http://localhost/t/market/admin/bulk/${batch.id}/ledger`);
  assert.equal(r.status, 200);
  const h = await r.text();

  // ① 양식 문구가 대장에도 그대로 있다
  for (const line of 원문) assert.ok(h.includes(line), `대장에 빠진 문구: ${line}`);
  assert.ok(h.includes("연번") && h.includes("지급일") && h.includes("생년월일") && h.includes("수량"),
    "대장 표 머리글");
  assert.ok(h.includes("수집․이용 동의여부"), "가운뎃점(U+2024)까지 원본 그대로");

  // ② 서명한 여덟 명만 올라간다 (아홉째는 서명 전)
  assert.ok(h.includes("수령자8"), "여덟째까지 올라간다");
  assert.ok(!h.includes("수령자9"), "서명하지 않은 사람은 대장에 없다");
  assert.match(h, /서명을 마친 8곳/);

  // ③ 동의 여부가 사람마다 따로 찍힌다
  assert.ok(h.includes("☑동  의"), "동의한 칸");
  assert.ok(h.includes("☑미동의"), "동의하지 않은 칸 — 세 번째 사람의 제3자 제공");

  // ④ 여덟 줄이 한 장 — 여덟 명이면 한 장이다
  assert.equal((h.match(/class="paper lg-paper"/g) || []).length, 1, "여덟 명은 한 장");
  assert.match(h, /1장/);
});

test("대장: 아홉 명이 서명하면 두 장이 되고, 두 장 모두 머리가 붙는다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "market", name: "방배카페골목상인회", kind: "merchant" });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "office@m.kr", passwordHash: ad.hash, salt: ad.salt, name: "총무", role: "ADMIN", associationId: a.id });
  const tpl = BUILTIN.find((x) => x.id === "b-payout");
  const batch = await D.createBatch(env.DB, { associationId: a.id, sourceId: 0, title: "지급", ordered: 0, dueDate: "", slot: 1, fixed: [], createdBy: null, teamId: 0 });
  for (let i = 1; i <= 9; i++) {
    const vars = { 상권명: "방배카페골목", 사업명: "사업", 품목: "상품권", 지급일: "`26.09.01", 성명: `수령자${i}`, 연락처: "010-0000-0000", 생년월일: "900101", 수량: "1" };
    const doc = await D.createDocument(env.DB, { associationId: a.id, title: `동의서 ${i}`, body: fillVars(tpl.body, vars), contentHash: await contentHash(fillVars(tpl.body, vars)), createdBy: null, draft: 0 });
    await D.addBatchRow(env.DB, batch.id, { seq: i, name: `수령자${i}`, phone: "", email: "", org: "", vars, status: "sent", note: "" });
    const rows = await D.listBatchRows(env.DB, batch.id);
    await D.setBatchRow(env.DB, rows[rows.length - 1].id, { status: "sent", documentId: doc.id, note: "" });
    await D.replaceFields(env.DB, doc.id, [{ kind: "sign", label: "수령자 서명", page: 0, x: 0.36, y: 0.75, w: 0.24, h: 0.05, assignee: 0, slot: 1, auto: "", required: 1, sort: 0 }]);
    const fs = await D.listFields(env.DB, doc.id);
    await D.setFieldValue(env.DB, { fieldId: fs[0].id, documentId: doc.id, userId: 0, value: "", image: `s${i}.png`, imageHash: "" });
  }
  const j = jar();
  await post(env, j, "http://localhost/t/market/login", { email: "office@m.kr", password: "admin1234" }, "http://localhost/t/market/login");
  const h = await (await get(env, j, `http://localhost/t/market/admin/bulk/${batch.id}/ledger`)).text();
  assert.equal((h.match(/class="paper lg-paper"/g) || []).length, 2, "아홉 명이면 두 장");
  // 장마다 머리를 다시 얹는다 — 장이 흩어져도 각 장이 그대로 완결되어야 한다
  assert.equal((h.match(/물품\(쿠폰, 경품, 기념품\) 지급대장/g) || []).length, 2);
  assert.equal((h.match(/◆개인정보의 제3자 제공에 관한 사항/g) || []).length, 2);
  assert.match(h, /9곳 · 2장/);
});
