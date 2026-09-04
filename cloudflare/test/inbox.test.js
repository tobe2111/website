// 손님 문의함.
//
// 예전에는 문의가 알림함에 한 줄로만 남았다. 회장님이 그 줄을 한 번 읽고 지나가면
// 그 문의는 사실상 사라졌다 — 누가 물었는지, 답을 했는지를 나중에 알 방법이 없었다.
// 홈페이지에 문의 칸을 두고 답을 못 하면 안 두느니만 못하다.
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
async function get(env, j, p) { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "방배카페골목상인회" });
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  return { a };
}
const login = async (env) => { const j = jar(); await post(env, j, "/login", { login: "ad@s.kr", password: "pass1234" }); return j; };

test("손님이 보낸 문의가 문의함에 남는다 (알림 한 줄로 사라지지 않게)", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const vj = jar();
  const r = await post(env, vj, "/t/seocho/contact",
    { name: "박상철", contact: "010-2222-1111", message: "입점 문의드립니다. 주차가 되나요?", agree: "1" }, "/t/seocho/contact");
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);

  const rows = await D.listLeads(env.DB, a.id, { source: "contact" });
  assert.equal(rows.length, 1, "문의가 표에 남아야");
  assert.equal(rows[0].name, "박상철");
  assert.equal(rows[0].phone, "010-2222-1111");
  assert.equal(rows[0].email, "", "@ 가 없으면 전화로 넣는다");
  assert.equal(rows[0].status, "new");
  assert.match(rows[0].message, /주차가 되나요/);

  // 관리 화면 문의함에 보인다
  const j = await login(env);
  const html = await (await get(env, j, "/t/seocho/admin")).text();
  assert.match(html, /id="s-inbox"/, "문의 탭이 있어야");
  assert.match(html, /박상철/);
  assert.match(html, /주차가 되나요/, "내용까지 보여야 — 목록만 있으면 다시 물어봐야 한다");
  assert.match(html, /안 읽음/);
});

test("이메일로 남긴 연락처는 이메일 칸에 들어간다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  await post(env, jar(), "/t/seocho/contact",
    { name: "이수경", contact: "soo@example.kr", message: "상품권 문의", agree: "1" }, "/t/seocho/contact");
  const l = (await D.listLeads(env.DB, a.id, { source: "contact" }))[0];
  assert.equal(l.email, "soo@example.kr");
  assert.equal(l.phone, "");
});

test("답을 하면 상태를 바꾸고 메모를 남긴다 — 문의함으로 돌아온다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const l = await D.createLead(env.DB, { associationId: a.id, name: "정민", phone: "01033332222", message: "주차 관련", source: "contact" });
  const j = await login(env);

  const r1 = await post(env, j, `/t/seocho/admin/leads/${l.id}/status`, { status: "contacted" }, "/t/seocho/admin");
  assert.match(r1.headers.get("location") || "", /#s-inbox/, "상담 DB 가 아니라 문의함으로 돌아와야");
  assert.equal((await D.getLead(env.DB, l.id, a.id)).status, "contacted");

  const r2 = await post(env, j, `/t/seocho/admin/leads/${l.id}/memo`, { memo: "3/5 전화 드림 — 주차 안내" }, "/t/seocho/admin");
  assert.match(r2.headers.get("location") || "", /#s-inbox/);
  assert.equal((await D.getLead(env.DB, l.id, a.id)).memo, "3/5 전화 드림 — 주차 안내");

  const html = await (await get(env, j, "/t/seocho/admin")).text();
  assert.match(html, /답변함/);
  assert.match(html, /주차 안내/, "메모가 화면에 남아 있어야");
});

test("안 읽은 건수가 탭에 배지로 붙고, 다 읽으면 사라진다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  for (const n of ["가", "나", "다"])
    await D.createLead(env.DB, { associationId: a.id, name: n, phone: "01000000000", message: "문의", source: "contact" });
  const j = await login(env);
  let html = await (await get(env, j, "/t/seocho/admin")).text();
  // 차림표 항목은 `> 문의 <span class="side-badge">3</span>` 꼴로 그려진다(아이콘 자리가 비어 앞에 공백이 하나 붙는다)
  const tabOf = (h) => (/data-tab="inbox"[^>]*>\s*문의(?:\s*<span class="side-badge">(\d+)<\/span>)?/.exec(h) || [])[1];
  assert.equal(tabOf(html), "3", "안 읽은 3건이 배지로: " + (tabOf(html) || "없음"));

  for (const l of await D.listLeads(env.DB, a.id, { source: "contact" }))
    await D.setLeadStatus(env.DB, l.id, a.id, "contacted");
  html = await (await get(env, j, "/t/seocho/admin")).text();
  assert.equal(tabOf(html), undefined, "다 읽었으면 배지가 없어야");
});

test("상태로 걸러 본다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const a1 = await D.createLead(env.DB, { associationId: a.id, name: "안읽음이", phone: "0101", message: "m", source: "contact" });
  const a2 = await D.createLead(env.DB, { associationId: a.id, name: "답변함이", phone: "0102", message: "m", source: "contact" });
  await D.setLeadStatus(env.DB, a2.id, a.id, "contacted");
  const j = await login(env);
  const html = await (await get(env, j, "/t/seocho/admin?is=new")).text();
  const sec = html.slice(html.indexOf('id="s-inbox"'), html.indexOf('id="s-notify"'));
  assert.match(sec, /안읽음이/);
  assert.ok(!/답변함이/.test(sec), "거른 상태만 나와야");
  assert.equal(a1.status, "new");
});

test("모집 랜딩의 상담 신청은 상인회 문의함에 섞이지 않는다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  await D.createLead(env.DB, { associationId: a.id, name: "가맹문의", phone: "0103", message: "m", source: "landing" });
  await D.createLead(env.DB, { associationId: a.id, name: "손님문의", phone: "0104", message: "m", source: "contact" });
  const only = await D.listLeads(env.DB, a.id, { source: "contact" });
  assert.deepEqual(only.map((l) => l.name), ["손님문의"]);
  const j = await login(env);
  const html = await (await get(env, j, "/t/seocho/admin")).text();
  const sec = html.slice(html.indexOf('id="s-inbox"'), html.indexOf('id="s-notify"'));
  assert.ok(!/가맹문의/.test(sec), "남의 제품 데이터가 섞이면 안 된다");
});

test("점주는 문의함을 못 본다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "m@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const l = await D.createLead(env.DB, { associationId: a.id, name: "손님", phone: "0105", message: "m", source: "contact" });
  const j = jar(); await post(env, j, "/login", { login: "m@s.kr", password: "pass1234" });
  assert.equal((await get(env, j, "/t/seocho/admin")).status, 403);
  const r = await post(env, j, `/t/seocho/admin/leads/${l.id}/status`, { status: "drop" }, "/t/seocho/");
  assert.equal(r.status, 403);
  assert.equal((await D.getLead(env.DB, l.id, a.id)).status, "new");
});
