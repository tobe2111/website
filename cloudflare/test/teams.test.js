// 부서 경계 — 인사팀의 인사팀 전용 문서가 영업팀 화면에 뜨지 않는가.
//
// 이 파일이 지키는 것은 하나다: **계약을 여는 길이 여럿인데, 그 전부가 잠겨 있는가.**
// 목록만 걸러 놓고 상세 주소를 직접 치면 열리는 것이 이런 기능에서 가장 흔한 사고다.
// 그래서 아래는 화면 하나하나가 아니라 '문 전부' 를 하나씩 두드려 본다.
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

// 인사팀 한 명 · 영업팀 한 명 · 부서 없는 담당자 한 명 · 관리자.
async function seed({ scope = true } = {}) {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "law", name: "한빛법무법인", kind: "esign" });
  const pw = await hashPassword("pass1234");
  const mk = (e, n, role) => D.createUser(env.DB, { email: e, passwordHash: pw.hash, salt: pw.salt, name: n, role, associationId: a.id });
  const admin = await mk("ad@law.kr", "관리자", "ADMIN");
  const hr = await mk("hr@law.kr", "인사담당", "STAFF");
  const sales = await mk("sa@law.kr", "영업담당", "STAFF");
  const loose = await mk("lo@law.kr", "무소속", "STAFF");
  const tHr = await D.createTeam(env.DB, a.id, "인사팀");
  const tSales = await D.createTeam(env.DB, a.id, "영업팀");
  await D.setUserTeam(env.DB, hr.id, a.id, tHr.id);
  await D.setUserTeam(env.DB, sales.id, a.id, tSales.id);
  if (scope) await D.setTeamScope(env.DB, a.id, 1);
  // createUser 가 돌려준 것은 부서를 배정하기 **전**의 모습이다. 다시 읽어야 team_id 가 들어 있다.
  const fresh = async (u) => D.getUserById(env.DB, u.id);
  const login = async (email) => { const j = jar(); await post(env, j, "/login", { email, password: "pass1234" }); return j; };
  const doc = async (title, by, teamId, draft = 0) => {
    const body = `${title}\n제1조 (목적) 이 계약의 목적은 다음과 같다.`;
    return D.createDocument(env.DB, { associationId: a.id, title, body, contentHash: await contentHash(body),
      createdBy: by.id, teamId, draft });
  };
  return { env, a, admin, hr: await fresh(hr), sales: await fresh(sales), loose, tHr, tSales, login, doc,
    assoc: async () => D.getAssociationById(env.DB, a.id) };
}

test("부서를 켜지 않으면 아무것도 달라지지 않는다 (쓰던 조직의 화면이 갑자기 비면 사고다)", async () => {
  const s = await seed({ scope: false });
  await s.doc("인사팀 전용 문서", s.hr, s.tHr.id);
  const j = await s.login("sa@law.kr");
  const h = await (await get(s.env, j, "/t/law/admin/documents")).text();
  assert.match(h, /인사팀 전용 문서/, "끄면 지금까지처럼 조직의 계약을 모두 본다");
});

test("켜면 남의 부서 계약이 목록에서 사라진다", async () => {
  const s = await seed();
  await s.doc("인사팀 전용 문서", s.hr, s.tHr.id);
  await s.doc("영업팀 전용 문서", s.sales, s.tSales.id);
  const h = await (await get(s.env, await s.login("sa@law.kr"), "/t/law/admin/documents")).text();
  assert.doesNotMatch(h, /인사팀 전용 문서/, "인사팀 계약이 영업팀 화면에 보이면 안 된다");
  assert.match(h, /영업팀 전용 문서/, "자기 부서 계약은 보여야 한다");
});

test("부서를 정하지 않은 계약은 그대로 모두가 본다 (켠다고 지난 계약이 사라지면 안 된다)", async () => {
  const s = await seed();
  await s.doc("옛날 계약서", s.hr, 0);   // team_id=0 — 부서가 생기기 전에 만든 계약
  const h = await (await get(s.env, await s.login("sa@law.kr"), "/t/law/admin/documents")).text();
  assert.match(h, /옛날 계약서/);
});

test("관리자는 늘 전부 본다", async () => {
  const s = await seed();
  await s.doc("인사팀 전용 문서", s.hr, s.tHr.id);
  await s.doc("영업팀 전용 문서", s.sales, s.tSales.id);
  const h = await (await get(s.env, await s.login("ad@law.kr"), "/t/law/admin/documents")).text();
  assert.match(h, /인사팀 전용 문서/);
  assert.match(h, /영업팀 전용 문서/);
});

test("자기가 만든 계약은 부서가 달라도 자기에게 보인다 (부서를 옮겨도 자기 일은 남는다)", async () => {
  const s = await seed();
  const d = await s.doc("내가 만든 계약", s.sales, s.tHr.id);   // 인사팀 몫으로 들어간 계약
  const h = await (await get(s.env, await s.login("sa@law.kr"), "/t/law/admin/documents")).text();
  assert.match(h, /내가 만든 계약/);
  assert.ok(d.id);
});

test("상태 칩의 숫자도 자기가 볼 수 있는 것만 센다 (숫자만 새면 제목이 없어도 다 안다)", async () => {
  const s = await seed();
  for (let i = 0; i < 3; i++) await s.doc(`인사 계약 ${i}`, s.hr, s.tHr.id);
  await s.doc("영업 계약", s.sales, s.tSales.id);
  const mine = await D.documentCounts(s.env.DB, s.a.id, "", { assoc: await s.assoc(), user: s.sales });
  assert.equal(mine.all, 1, "영업담당에게는 1건만 세어져야 한다");
  const all = await D.documentCounts(s.env.DB, s.a.id, "", { assoc: await s.assoc(), user: s.admin });
  assert.equal(all.all, 4);
});

// ── 목록만 막고 주소를 직접 치면 열리는 사고를 막는다 ──
test("주소를 직접 쳐도 남의 부서 계약은 열리지 않는다 — 모든 문", async () => {
  const s = await seed();
  const d = await s.doc("인사팀 전용 문서", s.hr, s.tHr.id);
  const j = await s.login("sa@law.kr");
  const gets = [
    `/t/law/admin/documents/${d.id}`,          // 계약 상세
    `/t/law/admin/documents/${d.id}/fields`,   // 서명 자리 배치
    `/t/law/documents/${d.id}/paper`,          // 완성본 지면
    `/t/law/documents/${d.id}/evidence`,       // 증적 패키지
  ];
  for (const u of gets) {
    const r = await get(s.env, j, u);
    assert.equal(r.status, 404, `${u} 가 열렸다 — 부서 경계가 새고 있다`);
  }
  // 고치는 문도 막혀 있어야 한다. 못 보는 계약을 닫거나 재촉할 수 있으면 그것도 유출이다.
  for (const u of [`/t/law/admin/documents/${d.id}/close`, `/t/law/admin/documents/${d.id}/remind`]) {
    const r = await post(s.env, j, u, {}, "/t/law/admin/documents");
    assert.match(r.headers.get("location") || "", /err=1/, `${u} 가 통과됐다`);
  }
});

test("관리자에게는 그 문이 다 열려 있다 (경계가 기능을 잠그면 안 된다)", async () => {
  const s = await seed();
  const d = await s.doc("인사팀 전용 문서", s.hr, s.tHr.id);
  const j = await s.login("ad@law.kr");
  for (const u of [`/t/law/admin/documents/${d.id}`, `/t/law/admin/documents/${d.id}/fields`, `/t/law/documents/${d.id}/paper`]) {
    assert.equal((await get(s.env, j, u)).status, 200, `${u} 가 관리자에게 막혔다`);
  }
});

test("서명자는 부서와 무관하게 자기 계약을 본다 (경계는 담당자용이지 서명자용이 아니다)", async () => {
  const s = await seed();
  const pw = await hashPassword("pass1234");
  const signer = await D.createUser(s.env.DB, { email: "sg@law.kr", passwordHash: pw.hash, salt: pw.salt,
    name: "서명자", role: "MERCHANT", associationId: s.a.id });
  const d = await s.doc("인사팀 전용 문서", s.hr, s.tHr.id);
  await D.createSignatureRequests(s.env.DB, d.id, [signer.id]);
  const j = await s.login("sg@law.kr");
  assert.equal((await get(s.env, j, `/t/law/sign/${d.id}`)).status, 200, "서명 화면이 열려야 한다");
  assert.equal((await get(s.env, j, `/t/law/documents/${d.id}/paper`)).status, 200, "자기 계약의 지면도 봐야 한다");
});

test("작성 중인 초안도 부서 경계를 지킨다", async () => {
  const s = await seed();
  const d = await s.doc("인사팀 초안", s.hr, s.tHr.id, 1);
  const j = await s.login("sa@law.kr");
  const drafts = await D.listDrafts(s.env.DB, s.a.id, { assoc: await s.assoc(), user: s.sales });
  assert.equal(drafts.length, 0, "남의 부서 초안이 목록에 보이면 안 된다");
  // 작성기를 주소로 직접 열어도 남의 초안이 안 열려야 한다
  const h = await (await get(s.env, j, `/t/law/admin/documents/write?doc=${d.id}`)).text();
  assert.doesNotMatch(h, /인사팀 초안/, "작성기에 남의 초안 본문이 실리면 안 된다");
});

test("대량 발송 명단도 부서 경계를 지킨다", async () => {
  const s = await seed();
  const src = await s.doc("인사팀 초안", s.hr, s.tHr.id, 1);
  const b = await D.createBatch(s.env.DB, { associationId: s.a.id, sourceId: src.id, title: "인사팀 명단",
    createdBy: s.hr.id, teamId: s.tHr.id });
  const j = await s.login("sa@law.kr");
  assert.equal((await get(s.env, j, `/t/law/admin/bulk/${b.id}`)).status, 404);
  const run = await post(s.env, j, `/t/law/admin/bulk/${b.id}/run`, {}, "/t/law/admin/documents");
  assert.equal(run.status, 404, "못 보는 명단을 돌릴 수 있으면 계약이 나가 버린다");
  const mine = await D.listBatches(s.env.DB, s.a.id, 20, { assoc: await s.assoc(), user: s.sales });
  assert.equal(mine.length, 0);
});

test("새 계약은 만든 사람의 부서를 물려받는다", async () => {
  const s = await seed();
  const j = await s.login("hr@law.kr");
  await post(s.env, j, "/t/law/admin/documents/draft", { title: "새 계약", body: "제1조 (목적)" }, "/t/law/admin/documents/write");
  const drafts = await D.listDrafts(s.env.DB, s.a.id);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].team_id, s.tHr.id, "인사담당이 만들었으면 인사팀 계약이어야 한다");
});

test("사람이 부서를 옮겨도 이미 만든 계약은 따라가지 않는다", async () => {
  const s = await seed();
  const d = await s.doc("인사팀 계약", s.hr, s.tHr.id);
  await post(s.env, await s.login("ad@law.kr"), `/t/law/admin/user/${s.hr.id}/team`,
    { team: String(s.tSales.id) }, "/t/law/admin");
  assert.equal((await D.getDocument(s.env.DB, d.id)).team_id, s.tHr.id,
    "계약이 사람을 따라가면, 옮긴 순간 남의 부서 계약이 새 부서에 열린다");
  assert.equal((await D.getUserById(s.env.DB, s.hr.id)).team_id, s.tSales.id);
});

// ── 부서 관리 ──
test("부서를 없애도 계약과 사람은 남는다 — '부서 없음' 으로 돌아갈 뿐", async () => {
  const s = await seed();
  const d = await s.doc("인사팀 계약", s.hr, s.tHr.id);
  const r = await post(s.env, await s.login("ad@law.kr"), `/t/law/admin/teams/${s.tHr.id}/delete`, {}, "/t/law/admin");
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);
  assert.equal((await D.getDocument(s.env.DB, d.id)).team_id, 0, "계약이 지워지면 안 된다");
  assert.equal((await D.getUserById(s.env.DB, s.hr.id)).team_id, 0);
  assert.equal((await D.listTeams(s.env.DB, s.a.id)).length, 1);
  // '부서 없음' 이 됐으니 이제 영업담당에게도 보인다
  const h = await (await get(s.env, await s.login("sa@law.kr"), "/t/law/admin/documents")).text();
  assert.match(h, /인사팀 계약/);
});

test("부서가 하나도 없으면 경계를 켤 수 없다 (켜자마자 아무도 아무것도 못 보게 된다)", async () => {
  const s = await seed({ scope: false });
  for (const t of await D.listTeams(s.env.DB, s.a.id)) await D.deleteTeam(s.env.DB, t.id, s.a.id);
  const r = await post(s.env, await s.login("ad@law.kr"), "/t/law/admin/teams/scope", { on: "1" }, "/t/law/admin");
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.equal((await s.assoc()).team_scope, 0);
});

test("같은 이름의 부서를 두 번 만들 수 없다", async () => {
  const s = await seed();
  const r = await post(s.env, await s.login("ad@law.kr"), "/t/law/admin/teams/add", { team_name: "인사팀" }, "/t/law/admin");
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.equal((await D.listTeams(s.env.DB, s.a.id)).length, 2);
});

test("담당자는 부서를 만들거나 경계를 끌 수 없다 (조직의 주인만 손댄다)", async () => {
  const s = await seed();
  const j = await s.login("hr@law.kr");
  // ⚠️ CSRF 로 막히면 '권한이 막았다' 를 증명하지 못한다 —
  //    담당자가 실제로 열 수 있는 화면에서 진짜 토큰을 받아 들고 두드린다.
  const token = (/name="_csrf" value="([^"]+)"/.exec(await (await get(s.env, j, "/t/law/admin/documents")).text()) || [])[1];
  assert.ok(token, "담당자도 계약 목록에서는 토큰을 받는다");
  for (const [u, f] of [["/t/law/admin/teams/add", { team_name: "몰래팀" }], ["/t/law/admin/teams/scope", { on: "0" }]]) {
    const r = await worker.fetch(new Request(B + u, { method: "POST",
      headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: token, ...f }).toString() }), s.env);
    assert.equal(r.status, 403, `${u} 가 담당자에게 뚫렸다`);
  }
  assert.equal((await s.assoc()).team_scope, 1);
  assert.equal((await D.listTeams(s.env.DB, s.a.id)).length, 2);
});

test("다른 조직의 부서는 지정할 수 없다", async () => {
  const s = await seed();
  const other = await D.createAssociation(s.env.DB, { slug: "other", name: "남의회사", kind: "esign" });
  const t = await D.createTeam(s.env.DB, other.id, "남의팀");
  const r = await post(s.env, await s.login("ad@law.kr"), `/t/law/admin/user/${s.hr.id}/team`,
    { team: String(t.id) }, "/t/law/admin");
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.equal((await D.getUserById(s.env.DB, s.hr.id)).team_id, s.tHr.id);
});

test("부서 관리 화면은 '켜기 전에는 달라지는 게 없다'고 분명히 말한다", async () => {
  const s = await seed({ scope: false });
  const h = await (await get(s.env, await s.login("ad@law.kr"), "/t/law/admin")).text();
  assert.match(h, /부서/);
  assert.match(h, /모두 봅니다|아직 안 나눔/, "지금 상태가 무엇인지 화면에 있어야 한다");
  assert.match(h, /사라지지 않습니다/, "지난 계약이 어떻게 되는지 켜기 전에 말해 줘야 한다");
});

test("담당자 표의 부서 칸이 지금 소속을 골라 놓고 있다 (매번 다시 고르게 하면 아무도 안 쓴다)", async () => {
  const s = await seed();
  const h = await (await get(s.env, await s.login("ad@law.kr"), "/t/law/admin")).text();
  // 인사담당 줄의 select 안에서 '인사팀' 이 selected 여야 한다
  const form = h.split(`/admin/user/${s.hr.id}/team`)[1] || "";
  const sel = form.slice(0, form.indexOf("</select>"));
  assert.match(sel, new RegExp(`value="${s.tHr.id}" selected`), "지금 부서가 골라져 있어야 한다");
  assert.doesNotMatch(sel, /value="0" selected/, "'부서 없음' 이 골라져 있으면 안 된다");
});
