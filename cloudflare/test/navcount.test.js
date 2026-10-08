// 차림표 옆 숫자와, 회비 장부를 제 탭으로 뺀 것.
//
// ── 왜 숫자가 필요한가 ──────────────────────────────────────────────────
// 서명 요청과 새 안건은 **문자나 이메일이 설정돼 있어야만** 알림이 나갑니다. 설정이 없으면
// (지금 대부분이 그렇습니다) 사장님은 아무 신호도 받지 못하고, 우연히 그 메뉴를 눌러 봐야
// 압니다. 보내 놓고 아무도 모르는 계약서는 안 보낸 것과 같습니다. 그래서 화면 자체가
// 신호가 되게 합니다.
//
// ── 왜 회비를 따로 빼는가 ───────────────────────────────────────────────
// 회비 장부는 '회원 관리' 가 아니라 돈 세는 일입니다. 같은 탭에 두었더니 회원 표 아래로
// 또 한 벌의 긴 표가 붙어, 가게 125곳에서 그 탭 하나가 14,299px — 다른 탭의 열 배였습니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { contentHash } from "../src/esign.js";

const B = "http://localhost";
let ipN = 0;
const jar = () => ({ c: {}, ip: `10.7.0.${++ipN}` });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const hdr = (j) => ({ cookie: ch(j), "cf-connecting-ip": j.ip });
const absorb = (j, r) => {
  for (const s of r.headers.getSetCookie?.() || []) {
    const kv = s.split(";")[0]; const i = kv.indexOf("=");
    j.c[kv.slice(0, i)] = kv.slice(i + 1);
  }
};
const get = async (env, j, p) => { const r = await worker.fetch(new Request(B + p, { headers: hdr(j) }), env); absorb(j, r); return r; };
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST",
    headers: { ...hdr(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}

async function seed(env, kind = "merchant", slug = "market") {
  const a = await D.createAssociation(env.DB, { slug, name: "방배카페골목상인회", kind });
  const h = await hashPassword("pw12341234");
  const admin = await D.createUser(env.DB, { email: `ad-${slug}@x.kr`, passwordHash: h.hash, salt: h.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const owner = await D.createUser(env.DB, { email: `ow-${slug}@x.kr`, passwordHash: h.hash, salt: h.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const biz = await D.createBusiness(env.DB, { associationId: a.id, ownerId: owner.id, name: "하나 세탁", category: "생활" });
  await D.setBusinessStatus(env.DB, biz.id, "approved");
  return { a, admin, owner };
}
const login = async (env, email) => { const j = jar(); await post(env, j, "/login", { email, password: "pw12341234" }); return j; };
// 차림표의 '내 서명 N' · '투표 N' 에서 숫자만 뽑는다
const countOf = (html, label) => {
  const m = new RegExp(label + '\\s*<em class="nav-count">(\\d+)</em>').exec(html);
  return m ? Number(m[1]) : 0;
};

test("서명할 계약서가 있으면 차림표에 건수가 붙는다 — 문자가 안 나가도 화면이 알린다", async () => {
  const env = makeEnv();
  const { a, admin, owner } = await seed(env);
  const j = await login(env, "ow-market@x.kr");
  // 아직 아무것도 없을 때는 숫자가 없다 — '내 서명 0' 은 할 일이 있는 것처럼 읽힌다
  let html = await (await get(env, j, "/t/market/")).text();
  assert.ok(html.includes("내 서명"), "메뉴 자체는 있어야 한다");
  assert.equal(countOf(html, "내 서명"), 0, "할 일이 없으면 숫자를 붙이지 않는다");

  const body = "공동 간판 정비사업 참여 동의서";
  const doc = await D.createDocument(env.DB, { associationId: a.id, title: "동의서", body,
    contentHash: await contentHash(body), createdBy: admin.id });
  await D.createSignatureRequests(env.DB, doc.id, [owner.id]);

  html = await (await get(env, j, "/t/market/")).text();
  assert.equal(countOf(html, "내 서명"), 1, "서명할 계약서 한 건이 숫자로 떠야 한다");
});

test("아직 안 넣은 안건이 숫자로 뜨고, 넣으면 줄어든다", async () => {
  const env = makeEnv();
  const { a, admin } = await seed(env);
  const p1 = await D.createPoll(env.DB, { associationId: a.id, title: "회비 인상안", createdBy: admin.id });
  await D.createPoll(env.DB, { associationId: a.id, title: "간판 정비", createdBy: admin.id });
  const j = await login(env, "ow-market@x.kr");

  let html = await (await get(env, j, "/t/market/")).text();
  assert.equal(countOf(html, "투표"), 2, "안 넣은 안건 둘");

  await post(env, j, `/t/market/polls/${p1.id}/vote`, { choice: "yes" }, "/t/market/polls");
  html = await (await get(env, j, "/t/market/")).text();
  assert.equal(countOf(html, "투표"), 1, "하나 넣었으면 하나로 줄어야 한다");
});

test("마감된 안건은 세지 않는다 — 할 수 없는 일을 할 일로 띄우면 안 된다", async () => {
  const env = makeEnv();
  const { a, admin } = await seed(env);
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "지난 안건", createdBy: admin.id });
  await D.closePoll(env.DB, p.id);
  const j = await login(env, "ow-market@x.kr");
  const html = await (await get(env, j, "/t/market/")).text();
  assert.equal(countOf(html, "투표"), 0, "마감된 안건이 숫자에 들어갔다");
});

test("남의 상인회 것은 세지 않는다", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const other = await seed(env, "merchant", "seorae");
  await D.createPoll(env.DB, { associationId: other.a.id, title: "서래 안건", createdBy: other.admin.id });
  const j = await login(env, "ow-market@x.kr");
  const html = await (await get(env, j, "/t/market/")).text();
  assert.equal(countOf(html, "투표"), 0, "옆 상인회 안건이 내 숫자에 들어갔다");
  assert.ok(a.id !== other.a.id);
});

test("로그인하지 않은 손님 화면에는 숫자도 메뉴도 없다", async () => {
  const env = makeEnv();
  const { a, admin } = await seed(env);
  await D.createPoll(env.DB, { associationId: a.id, title: "안건", createdBy: admin.id });
  const html = await (await get(env, jar(), "/t/market/")).text();
  assert.ok(!html.includes("nav-count"), "손님 화면에 숫자가 떴다");
  assert.ok(!html.includes("내 서명"), "손님 화면에 서명 메뉴가 떴다");
});

test("회비 장부는 제 탭에 선다 — 회원 표와 같은 자리에 쌓지 않는다", async () => {
  const env = makeEnv();
  await seed(env);
  const aj = await login(env, "ad-market@x.kr");
  const html = await (await get(env, aj, "/t/market/admin")).text();
  const tabs = [...html.matchAll(/<div class="sgroup" id="s-(\w+)"/g)].map((m) => m[1]);
  assert.ok(tabs.includes("dues"), "회비 탭이 없다");
  // 회비 패널이 회원 묶음 **안에** 있으면 안 된다
  const people = html.slice(html.indexOf('id="s-people"'), html.indexOf('id="s-dues"'));
  assert.ok(!people.includes('id="p-dues"'), "회비 장부가 아직 회원 탭 안에 있다");
  const dues = html.slice(html.indexOf('id="s-dues"'));
  assert.ok(dues.includes('id="p-dues"'), "회비 탭에 장부가 없다");
  assert.ok(/data-tab="dues"/.test(html), "옆 차림표에 회비 칸이 서야 한다");
});

test("회비를 걷지 않는 상인회에는 회비 탭이 아예 없다 — 안 쓰는 칸은 찾는 데 방해다", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  await env.DB.prepare("UPDATE associations SET uses_dues=0 WHERE id=?").bind(a.id).run();
  const aj = await login(env, "ad-market@x.kr");
  const html = await (await get(env, aj, "/t/market/admin")).text();
  const tabs = [...html.matchAll(/<div class="sgroup" id="s-(\w+)"/g)].map((m) => m[1]);
  assert.ok(!tabs.includes("dues"), "회비를 안 걷는데 회비 탭이 섰다");
  assert.ok(!/data-tab="dues"/.test(html), "차림표에도 회비 칸이 없어야 한다");
});
