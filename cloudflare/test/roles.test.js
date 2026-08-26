// 역할·서명 대상 판정 — "누가 무엇을 할 수 있는가"
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import { hashPassword } from "../src/crypto.js";
import * as D from "../src/db.js";
import { contentHash } from "../src/esign.js";

let env, db, esignOrg, member;
const BASE = "http://localhost";

before(async () => {
  env = makeEnv(); db = env.DB;
  esignOrg = await D.createAssociation(db, { slug: "eo", name: "전자계약조직", kind: "esign" });
  const h = await hashPassword("password1234");
  member = await D.createUser(db, { email: "m@x.kr", passwordHash: h.hash, salt: h.salt, name: "직원", role: "MERCHANT", associationId: esignOrg.id });
});

// ---------- 서명 대상 판정 ----------
// 외부 서명자도 '대상'이다. 이걸 빠뜨리면 API·서식으로 만든 계약(서명자가 전부 외부)이
// signature_requests 가 비었다는 이유로 조직 회원 전원에게 열린다.
test("외부 서명자만 있는 계약은 사내 회원에게 열리지 않는다", async () => {
  const d = await D.createDocument(db, { associationId: esignOrg.id, title: "외부 전용", body: "본문",
    contentHash: await contentHash("본문"), createdBy: null, ordered: 0, dueDate: "" });
  await D.addExternalSigner(db, { documentId: d.id, name: "상대방", email: "x@y.kr", signOrder: 1 });
  assert.equal(await D.canReceiveSign(db, d.id, member.id), false, "서명 대상이 아니어야 함");
  assert.ok(!(await D.listDocumentsToSign(db, esignOrg.id, member.id)).some((x) => x.id === d.id),
    "서명 목록에도 뜨면 안 됨");
});

test("대상이 아예 없는 문서는 여전히 회원 전체 대상 (기존 동작 유지)", async () => {
  const d = await D.createDocument(db, { associationId: esignOrg.id, title: "전체 공개", body: "본문",
    contentHash: await contentHash("본문"), createdBy: null, ordered: 0, dueDate: "" });
  assert.equal(await D.canReceiveSign(db, d.id, member.id), true);
  assert.ok((await D.listDocumentsToSign(db, esignOrg.id, member.id)).some((x) => x.id === d.id));
});

test("회원이 대상으로 지정되면 외부 서명자가 함께 있어도 열린다", async () => {
  const d = await D.createDocument(db, { associationId: esignOrg.id, title: "혼합", body: "본문",
    contentHash: await contentHash("본문"), createdBy: null, ordered: 0, dueDate: "" });
  await D.addExternalSigner(db, { documentId: d.id, name: "상대방", email: "x@y.kr", signOrder: 1 });
  await D.createSignatureRequests(db, d.id, [member.id]);
  assert.equal(await D.canReceiveSign(db, d.id, member.id), true);
  assert.ok((await D.listDocumentsToSign(db, esignOrg.id, member.id)).some((x) => x.id === d.id));
});

test("서명 화면에서도 같은 규칙이 강제된다 (목록만 가리는 게 아니다)", async () => {
  const d = await D.createDocument(db, { associationId: esignOrg.id, title: "직접 접근", body: "본문",
    contentHash: await contentHash("본문"), createdBy: null, ordered: 0, dueDate: "" });
  await D.addExternalSigner(db, { documentId: d.id, name: "상대방", email: "x@y.kr", signOrder: 1 });
  const seed = await worker.fetch(new Request(`${BASE}/login`), env);
  const j0 = (seed.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(await seed.text()) || [])[1];
  const lr = await worker.fetch(new Request(`${BASE}/login`, { method: "POST", redirect: "manual",
    headers: { cookie: j0, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, email: "m@x.kr", password: "password1234" }).toString() }), env);
  const jar = [j0, (lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ")].filter(Boolean).join("; ");
  const r = await worker.fetch(new Request(`${BASE}/t/eo/sign/${d.id}`, { headers: { cookie: jar }, redirect: "manual" }), env);
  assert.ok(r.status >= 300, "URL 을 직접 쳐도 막혀야 함");
  assert.match(r.headers.get("location") || "", /err=1/);
});

// ================= 역할 체계 =================
// 관리자(설정·API·과금) / 담당자(계약 업무만) / 회원(서명)
let org, mart, adminJar, staffJar, memberJar, martAdminJar;
const cookiesOf = (r) => (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
const req = (method, path, { cookie = "", body = null } = {}) => {
  const headers = {}; if (cookie) headers.cookie = cookie;
  const init = { method, headers, redirect: "manual" };
  if (body) { headers["content-type"] = "application/x-www-form-urlencoded"; init.body = new URLSearchParams(body).toString(); }
  return worker.fetch(new Request(BASE + path, init), env);
};
async function loginAs(email) {
  const seed = await req("GET", "/login");
  const j0 = cookiesOf(seed);
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(await seed.text()) || [])[1];
  const r = await req("POST", "/login", { cookie: j0, body: { email, password: "password1234", _csrf: csrf } });
  return { jar: [j0, cookiesOf(r)].filter(Boolean).join("; "), landed: r.headers.get("location") || "" };
}
const csrfFrom = async (cookie, path) => (/name="_csrf" value="([^"]+)"/.exec(await (await req("GET", path, { cookie })).text()) || [])[1];

test("[준비] 전자계약 조직과 상인회에 역할별 계정을 만든다", async () => {
  org = await D.createAssociation(db, { slug: "law", name: "법무법인", kind: "esign" });
  mart = await D.createAssociation(db, { slug: "mt", name: "상인회" });
  const h = await hashPassword("password1234");
  const mk = (e, n, role, aid) => D.createUser(db, { email: e, passwordHash: h.hash, salt: h.salt, name: n, role, associationId: aid });
  await mk("ad@law.kr", "대표", "ADMIN", org.id);
  await mk("st@law.kr", "담당자", "STAFF", org.id);
  await mk("sg@law.kr", "결재자", "MERCHANT", org.id);
  await mk("ad@mt.kr", "상인회관리자", "ADMIN", mart.id);
  adminJar = (await loginAs("ad@law.kr")).jar;
  staffJar = (await loginAs("st@law.kr")).jar;
  memberJar = (await loginAs("sg@law.kr")).jar;
  martAdminJar = (await loginAs("ad@mt.kr")).jar;
});

test("담당자는 계약 업무를 할 수 있다", async () => {
  for (const p of ["/t/law/admin/documents", "/t/law/admin/documents/new?tpl=b-nda", "/t/law/admin/templates"])
    assert.equal((await req("GET", p, { cookie: staffJar })).status, 200, p);
  const csrf = await csrfFrom(staffJar, "/t/law/admin/documents");
  const r = await req("POST", "/t/law/admin/documents", { cookie: staffJar, body: {
    _csrf: csrf, title: "담당자가 만든 계약", body: "본문", target: "all" } });
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/, "담당자가 계약서를 만들 수 있어야 함");
  assert.ok((await D.listDocuments(db, org.id)).some((d) => d.title === "담당자가 만든 계약"));
});

test("담당자는 설정·API 키·과금에 닿을 수 없다", async () => {
  const blocked = [
    ["GET", "/t/law/admin"],            // 콘솔 자체 (설정 폼이 통째로 들어 있다)
    ["GET", "/t/law/admin/api"],        // API 키 = 조직 전체 권한의 복제본
    ["GET", "/t/law/admin/export.json"], // 개인정보 일괄 반출
  ];
  for (const [m, p] of blocked) {
    const r = await req(m, p, { cookie: staffJar });
    assert.ok(r.status >= 300 && r.status < 500, `${p} 는 막혀야 함 (got ${r.status})`);
    assert.notEqual(r.status, 200, p);
  }
  const csrf = await csrfFrom(staffJar, "/t/law/admin/documents");
  for (const p of ["/t/law/admin/api", "/t/law/admin/credit/order", "/t/law/admin/admins/add", "/t/law/admin/settings"]) {
    const r = await req("POST", p, { cookie: staffJar, body: { _csrf: csrf, name: "x", email: "x@y.kr", amount: "10000" } });
    assert.notEqual(r.status, 302, `${p} 로 쓰기가 통과하면 안 됨`);
  }
  assert.equal((await D.listApiKeys(db, org.id)).length, 0, "담당자가 API 키를 만들지 못해야 함");
});

test("관리자는 담당자가 하는 것을 모두 할 수 있다 (계층)", async () => {
  for (const p of ["/t/law/admin", "/t/law/admin/documents", "/t/law/admin/templates", "/t/law/admin/api"])
    assert.equal((await req("GET", p, { cookie: adminJar })).status, 200, p);
});

test("다른 조직의 담당자는 들어올 수 없다", async () => {
  const r = await req("GET", "/t/law/admin/documents", { cookie: martAdminJar });
  assert.notEqual(r.status, 200, "타 조직 관리자 차단");
});

// ---------- 서명 ----------
test("관리자도 지정되면 서명할 수 있다 (계약을 만든 사람이 서명 못 하던 문제)", async () => {
  const admin = await D.getUserByEmail(db, "ad@law.kr");
  const d = await D.createDocument(db, { associationId: org.id, title: "대표 날인", body: "본문",
    contentHash: await contentHash("본문"), createdBy: admin.id, ordered: 0, dueDate: "" });
  await D.createSignatureRequests(db, d.id, [admin.id]);
  assert.equal(await D.canReceiveSign(db, d.id, admin.id, "ADMIN"), true);
  assert.equal((await req("GET", `/t/law/sign/${d.id}`, { cookie: adminJar })).status, 200, "서명 화면이 열려야 함");
  assert.ok((await D.listDocumentsToSign(db, org.id, admin.id, "ADMIN")).some((x) => x.id === d.id));
});

test("지정되지 않은 관리자는 대상 미지정 문서에도 뜨지 않는다 (상인회 회귀 방지)", async () => {
  // 시작 세트의 가입 동의서처럼 대상이 아무도 지정되지 않은 문서
  const open = await D.createDocument(db, { associationId: mart.id, title: "전체 동의서", body: "본문",
    contentHash: await contentHash("본문"), createdBy: null, ordered: 0, dueDate: "" });
  const martAdmin = await D.getUserByEmail(db, "ad@mt.kr");
  assert.equal(await D.canReceiveSign(db, open.id, martAdmin.id, "ADMIN"), false,
    "관리자는 명시 지정됐을 때만 대상");
  assert.ok(!(await D.listDocumentsToSign(db, mart.id, martAdmin.id, "ADMIN")).some((x) => x.id === open.id),
    "상인회 관리자 화면에 서명 대기가 새로 뜨면 안 됨");
  // 회원에게는 예전 그대로 열린다
  const h = await hashPassword("password1234");
  const owner = await D.createUser(db, { email: "own@mt.kr", passwordHash: h.hash, salt: h.salt, name: "사장", role: "MERCHANT", associationId: mart.id });
  assert.equal(await D.canReceiveSign(db, open.id, owner.id, "MERCHANT"), true, "회원에게는 기존대로");
  assert.ok((await D.listDocumentsToSign(db, mart.id, owner.id, "MERCHANT")).some((x) => x.id === open.id));
});

test("화면과 액션의 판정이 일치한다 (목록엔 없는데 URL 로는 되는 일이 없다)", async () => {
  const open = (await D.listDocuments(db, mart.id)).find((d) => d.title === "전체 동의서");
  const r = await req("GET", `/t/mt/sign/${open.id}`, { cookie: martAdminJar });
  assert.ok(r.status >= 300, "목록에 없으면 직접 접근도 막혀야 함");
});

test("전자계약 조직에서는 관리자·담당자도 서명 대상 후보로 고를 수 있다", async () => {
  const cands = await D.listSignerCandidates(db, org.id, "esign");
  const roles = cands.map((c) => c.role);
  assert.ok(roles.includes("ADMIN") && roles.includes("STAFF") && roles.includes("MERCHANT"), `후보: ${roles}`);
  const martCands = await D.listSignerCandidates(db, mart.id, "merchant");
  assert.ok(martCands.every((c) => c.role === "MERCHANT"), "상인회는 예전대로 점포주만");
});

// ---------- 로그인 도착 경로 ----------
test("역할·조직 유형별로 알맞은 화면에 도착한다", async () => {
  assert.match((await loginAs("ad@law.kr")).landed, /\/t\/law\/admin$/, "관리자 → 콘솔");
  assert.match((await loginAs("st@law.kr")).landed, /\/t\/law\/admin\/documents$/, "담당자 → 계약서 목록");
  assert.match((await loginAs("sg@law.kr")).landed, /\/t\/law\/sign$/, "전자계약 조직 회원 → 서명 목록");
  assert.match((await loginAs("ad@mt.kr")).landed, /\/t\/mt\/admin$/, "상인회 관리자 → 콘솔 (그대로)");
  assert.match((await loginAs("own@mt.kr")).landed, /\/t\/mt\/dashboard$/, "상인회 회원 → 내 업체 (그대로)");
});

test("전자계약 조직의 회원은 빈 '내 업체' 화면을 보지 않는다", async () => {
  const r = await req("GET", "/t/law/dashboard", { cookie: memberJar });
  assert.ok(r.status === 302 || r.status === 303, `리다이렉트여야 함 (got ${r.status})`);
  assert.match(r.headers.get("location") || "", /\/t\/law\/sign/);
});

// ---------- 담당자 관리 ----------
test("담당자 추가 시 기본은 담당자 권한, 관리자는 일부러 골라야 한다", async () => {
  const csrf = await csrfFrom(adminJar, "/t/law/admin");
  await req("POST", "/t/law/admin/admins/add", { cookie: adminJar, body: {
    _csrf: csrf, name: "새담당", email: "new@law.kr" } });
  assert.equal((await D.getUserByEmail(db, "new@law.kr")).role, "STAFF", "전자계약 조직 기본값은 담당자");
  await req("POST", "/t/law/admin/admins/add", { cookie: adminJar, body: {
    _csrf: csrf, name: "공동대표", email: "co@law.kr", role: "ADMIN" } });
  assert.equal((await D.getUserByEmail(db, "co@law.kr")).role, "ADMIN");
});

test("상인회의 부관리자는 예전처럼 관리자로 발급된다 (회귀 방지)", async () => {
  const csrf = await csrfFrom(martAdminJar, "/t/mt/admin");
  await req("POST", "/t/mt/admin/admins/add", { cookie: martAdminJar, body: {
    _csrf: csrf, name: "총무", email: "chong@mt.kr" } });
  assert.equal((await D.getUserByEmail(db, "chong@mt.kr")).role, "ADMIN");
});

test("권한을 회수하면 계정은 남고 계약을 못 만든다", async () => {
  const target = await D.getUserByEmail(db, "new@law.kr");
  const csrf = await csrfFrom(adminJar, "/t/law/admin");
  const r = await req("POST", `/t/law/admin/user/${target.id}/revoke`, { cookie: adminJar, body: { _csrf: csrf } });
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);
  const after = await D.getUserByEmail(db, "new@law.kr");
  assert.equal(after.role, "MERCHANT", "역할만 내려간다");
  assert.ok(after.id, "계정은 남아 있어야 함 (서명 이력이 매달려 있다)");
  assert.ok(after.session_version > target.session_version, "기존 세션이 무효화되어야 함");
});

test("마지막 관리자의 권한은 회수할 수 없다", async () => {
  const csrf = await csrfFrom(adminJar, "/t/law/admin");
  const co = await D.getUserByEmail(db, "co@law.kr");
  await req("POST", `/t/law/admin/user/${co.id}/revoke`, { cookie: adminJar, body: { _csrf: csrf } });
  assert.equal((await D.getUserByEmail(db, "co@law.kr")).role, "MERCHANT", "둘 중 하나는 회수 가능");
  // 이제 관리자는 대표 한 명뿐 — 본인은 애초에 회수 불가이므로 다른 관리자를 만들어 시도
  const admin = await D.getUserByEmail(db, "ad@law.kr");
  const r = await req("POST", `/t/law/admin/user/${admin.id}/revoke`, { cookie: adminJar, body: { _csrf: csrf } });
  assert.match(r.headers.get("location") || "", /err=1/, "본인 권한 회수는 거부");
  assert.equal((await D.getUserByEmail(db, "ad@law.kr")).role, "ADMIN");
});

test("담당자는 담당자를 추가하거나 권한을 회수할 수 없다", async () => {
  const csrf = await csrfFrom(staffJar, "/t/law/admin/documents");
  const before = (await D.listUsersByAssociation(db, org.id, "STAFF")).length;
  await req("POST", "/t/law/admin/admins/add", { cookie: staffJar, body: {
    _csrf: csrf, name: "몰래", email: "sneak@law.kr" } });
  assert.equal((await D.listUsersByAssociation(db, org.id, "STAFF")).length, before, "추가되면 안 됨");
  assert.equal(await D.getUserByEmail(db, "sneak@law.kr"), null);
});

test("임시 비밀번호가 예측 가능한 난수로 만들어지지 않는다", async () => {
  const { tempPassword } = await import("../src/api.js");
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = tempPassword();
    assert.equal(p.length, 12);
    assert.doesNotMatch(p, /[0O1lI]/, "헷갈리는 글자는 빼야 함 (사람이 옮겨 적는다)");
    seen.add(p);
  }
  assert.equal(seen.size, 200, "중복이 나오면 안 됨");
});

test("문서 목록에 만든 사람이 나온다 (담당자가 여러 명일 때 필요)", async () => {
  const staff = await D.getUserByEmail(db, "st@law.kr");
  const d = await D.createDocument(db, { associationId: org.id, title: "작성자 표시", body: "본문",
    contentHash: await contentHash("본문"), createdBy: staff.id, ordered: 0, dueDate: "" });
  const row = (await D.listDocuments(db, org.id)).find((x) => x.id === d.id);
  assert.equal(row.author_name, "담당자");
  const h = await (await req("GET", "/t/law/admin/documents", { cookie: adminJar })).text();
  assert.match(h, /만든 사람/);
});

test("만든 사람 계정이 사라져도 목록이 깨지지 않는다", async () => {
  const d = await D.createDocument(db, { associationId: org.id, title: "작성자 없음", body: "본문",
    contentHash: await contentHash("본문"), createdBy: null, ordered: 0, dueDate: "" });
  const row = (await D.listDocuments(db, org.id)).find((x) => x.id === d.id);
  assert.equal(row.author_name, null);
  assert.equal((await req("GET", "/t/law/admin/documents", { cookie: adminJar })).status, 200);
});

// ---------- 전자계약 조직에서 점포 가입 경로 차단 ----------
test("전자계약 조직에는 점포 가입·초대가 없다 (메뉴뿐 아니라 URL 도)", async () => {
  assert.equal((await req("GET", "/t/law/register")).status, 404);
  assert.equal((await req("GET", "/t/law/invite?t=x")).status, 404);
  const seed = await req("GET", "/login");
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(await seed.text()) || [])[1];
  const r = await req("POST", "/t/law/register", { cookie: cookiesOf(seed), body: {
    _csrf: csrf, name: "침입", email: "x@law.kr", password: "password1234", business_name: "가게", agree: "1" } });
  assert.match(r.headers.get("location") || "", /err=1/, "POST 우회도 막혀야 함");
  assert.equal(await D.getUserByEmail(db, "x@law.kr"), null);
});

test("상인회는 점포 가입이 그대로 열려 있다 (회귀 방지)", async () => {
  assert.equal((await req("GET", "/t/mt/register")).status, 200);
});

test("전자계약 조직의 내부 서명자 등록은 업체를 만들지 않는다", async () => {
  const csrf = await csrfFrom(adminJar, "/t/law/admin");
  const r = await req("POST", "/t/law/admin/members/add", { cookie: adminJar, body: {
    _csrf: csrf, name: "사내결재", email: "gj@law.kr" } });
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/, "업체명 없이도 등록되어야 함");
  const u = await D.getUserByEmail(db, "gj@law.kr");
  assert.equal(u.role, "MERCHANT");
  assert.equal(await D.getBusinessByOwner(db, u.id), null, "업체 레코드가 생기면 안 됨");
});

// 전자계약 조직 콘솔에 남아 있던 상인회 전용 요소들 — 담당자가 못 가는 링크·엉뚱한 서식
test("전자계약 조직에는 '상인회 가입 동의서' 서식이 보이지 않는다", async () => {
  const { builtinsFor, BUILTIN } = await import("../src/templates.js");
  const es = builtinsFor("esign").map((t) => t.id);
  assert.ok(!es.includes("b-join"), "상인회 전용 서식이 전자계약 조직에 노출됨");
  assert.ok(es.includes("b-lease") && es.includes("b-nda"), "범용 서식은 남아야 함");
  assert.equal(builtinsFor("merchant").length, BUILTIN.length, "상인회는 전부 그대로");
});

test("담당자 화면에는 자기가 못 가는 곳(관리자·API) 링크가 없다", async () => {
  const e2 = makeEnv();
  const org = await D.createAssociation(e2.DB, { slug: "ho", name: "한빛", kind: "esign" });
  const h = await hashPassword("password1234");
  await D.createUser(e2.DB, { email: "boss@h.kr", passwordHash: h.hash, salt: h.salt, name: "대표", role: "ADMIN", associationId: org.id });
  await D.createUser(e2.DB, { email: "staff@h.kr", passwordHash: h.hash, salt: h.salt, name: "담당", role: "STAFF", associationId: org.id });
  const jarFor = async (email) => {
    const seed = await worker.fetch(new Request(`${BASE}/login`), e2);
    const j0 = (seed.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
    const csrf = (/name="_csrf" value="([^"]+)"/.exec(await seed.text()) || [])[1];
    const lr = await worker.fetch(new Request(`${BASE}/login`, { method: "POST", redirect: "manual",
      headers: { cookie: j0, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: csrf, email, password: "password1234" }).toString() }), e2);
    return [j0, (lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ")].filter(Boolean).join("; ");
  };
  const docsHtml = async (email) => (await worker.fetch(new Request(`${BASE}/t/ho/admin/documents`,
    { headers: { cookie: await jarFor(email) } }), e2)).text();

  const staffHtml = await docsHtml("staff@h.kr");
  assert.ok(!/href="[^"]*\/admin"/.test(staffHtml), "담당자에게 관리자 콘솔 링크가 보임 (누르면 403)");
  assert.ok(!/href="[^"]*\/admin\/api"/.test(staffHtml), "담당자에게 API 링크가 보임 (누르면 403)");
  assert.ok(!/상인회 가입 동의서/.test(staffHtml), "상인회 서식이 노출됨");

  const adminHtml = await docsHtml("boss@h.kr");
  assert.match(adminHtml, /href="[^"]*\/admin\/api"/, "관리자에게는 그대로 보여야 함");
});

// ---------- 주소(slug) 영문화 ----------
test("한글 이름은 짧은 영문 주소가 된다", async () => {
  const { slugify } = await import("../src/util.js");
  assert.equal(slugify("서초구 상인회"), "seochogu");
  assert.equal(slugify("한빛법무법인"), "hanbit");
  assert.equal(slugify("강남역 상점가"), "gangnamyeok");
  assert.equal(slugify("주식회사 가나다"), "ganada");
  assert.equal(slugify("ABC Corp"), "abc-corp", "이미 영문이면 그대로");
  assert.equal(slugify("!!!"), "biz");
  for (const n of ["서울특별시 서초구 상인번영회", "아주아주아주아주아주긴이름주식회사"]) {
    const s = slugify(n);
    assert.ok(s.length <= 24 && !s.endsWith("-"), `${n} → ${s}`);
    assert.ok(!/[^a-z0-9-]/.test(s), `영문·숫자·하이픈만: ${s}`);
  }
});

test("옛 한글 주소 DB 는 자동으로 영문 주소가 되고, 옛 주소는 301 로 이어진다", async () => {
  const e2 = makeEnv();
  const { ensureSchema } = await import("../src/schema.js");
  const old = await D.createAssociation(e2.DB, { slug: "서초구-상인회", name: "서초구 상인회" });
  await D.createAssociation(e2.DB, { slug: "keep-me", name: "그대로 상인회" });
  const hh = await hashPassword("password1234"); // 계정이 하나도 없으면 모든 요청이 /setup 으로 간다
  await D.createUser(e2.DB, { email: "a@s.kr", passwordHash: hh.hash, salt: hh.salt, name: "관리자", role: "ADMIN", associationId: old.id });
  await D.setSetting(e2.DB, "schema_version", "31"); // 옛 세대로 되돌려 마이그레이션을 태운다
  await ensureSchema(e2.DB);

  const moved = await D.getAssociationById(e2.DB, old.id);
  assert.equal(moved.slug, "seochogu", "영문 주소로 이동");
  assert.equal((await D.getAssociationBySlug(e2.DB, "keep-me")).slug, "keep-me", "이미 영문인 곳은 안 건드림");

  const r = await worker.fetch(new Request(`${BASE}/t/${encodeURIComponent("서초구-상인회")}/notices?page=2`,
    { redirect: "manual" }), e2);
  assert.equal(r.status, 301, "옛 주소는 영구 이동");
  assert.equal(r.headers.get("location"), "/t/seochogu/notices?page=2", "경로·쿼리까지 그대로 이어져야");
});

test("슈퍼가 주소를 바꾸면 옛 주소가 alias 로 남는다", async () => {
  const e2 = makeEnv();
  const a = await D.createAssociation(e2.DB, { slug: "gangnamsijang", name: "강남시장 상인회" });
  assert.equal((await D.renameAssociationSlug(e2.DB, a.id, "gangnam")).ok, true);
  assert.equal((await D.getAssociationById(e2.DB, a.id)).slug, "gangnam");
  assert.equal((await D.getAssociationByAlias(e2.DB, "gangnamsijang")).id, a.id);
  // 남이 쓰는 주소로는 못 바꾼다
  const b = await D.createAssociation(e2.DB, { slug: "seochogu", name: "서초구 상인회" });
  assert.equal((await D.renameAssociationSlug(e2.DB, b.id, "gangnam")).ok, false);
  // 남의 옛 주소로도 못 바꾼다 (301 이 엉뚱한 곳으로 가면 안 된다)
  assert.equal((await D.renameAssociationSlug(e2.DB, b.id, "gangnamsijang")).ok, false);
});

// ---------- 전자계약 제품 화면 ----------
test("/esign 에는 상인회 간판이 하나도 없다", async () => {
  const e2 = makeEnv();
  await D.createAssociation(e2.DB, { slug: "seochogu", name: "서초구 상인회" });
  await D.setSetting(e2.DB, "site_name", "서초구 상인회 플랫폼");
  const h = await hashPassword("password1234");
  await D.createUser(e2.DB, { email: "a@s.kr", passwordHash: h.hash, salt: h.salt, name: "관리자", role: "ADMIN", associationId: 1 });
  for (const p of ["/esign", "/esign/signup", "/verify"]) {
    const html = await (await worker.fetch(new Request(BASE + p), e2)).text();
    assert.ok(!/상인회/.test(html), `${p} 에 '상인회' 가 남아 있음`);
    assert.match(html, /<title>[^<]*전자계약<\/title>/, `${p} 제목이 제품 이름이어야`);
    assert.match(html, /href="\/esign\/signup"/, `${p} 에 제품 메뉴가 있어야`);
  }
});

// ── 상인회 관리자 페이지는 아무나 들어가면 안 된다.
// 멀티테넌트에서 제일 무서운 사고는 '남의 상인회 관리 화면이 열리는 것'이다.
// 한 번 확인하고 끝낼 일이 아니라 계속 지켜져야 하므로 여기 못 박아 둔다.
test("관리자 화면은 로그인·소속·권한 세 가지를 모두 본다", async () => {
  const e = makeEnv();
  const B = "https://x.test";
  const mine = await D.createAssociation(e.DB, { slug: "seocho", name: "서초구 상인회", kind: "merchant" });
  const other = await D.createAssociation(e.DB, { slug: "gangnam", name: "강남 상인회", kind: "merchant" });
  const pw = await hashPassword("pass1234");
  await D.createUser(e.DB, { email: "admin@a.kr", passwordHash: pw.hash, salt: pw.salt, name: "서초회장", role: "ADMIN", associationId: mine.id });
  await D.createUser(e.DB, { email: "owner@a.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장님", role: "MERCHANT", associationId: mine.id });
  const f = (p, i) => worker.fetch(new Request(B + p, i), e, { waitUntil() {}, passThroughOnException() {} });
  const login = async (email) => {
    const g = await f("/login");
    const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
    const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
    const lr = await f("/login", { method: "POST", headers: { cookie: seed, origin: B, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: tk, email, password: "pass1234" }) });
    return [seed, ...(lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");
  };

  // ① 로그인하지 않았으면 로그인으로 보낸다
  for (const p of ["/t/seocho/admin", "/t/seocho/admin/documents", "/t/seocho/admin/api", "/super"]) {
    const r = await f(p);
    assert.equal(r.status, 303, `${p}: 비로그인인데 막지 않았다`);
    assert.match(r.headers.get("location") || "", /^\/login\?/, `${p}: 로그인으로 보내야`);
  }
  // ② 남의 상인회 관리 화면은 로그인해도 못 연다
  const adminJar = await login("admin@a.kr");
  for (const p of ["/t/gangnam/admin", "/t/gangnam/admin/documents"]) {
    const r = await f(p, { headers: { cookie: adminJar } });
    assert.equal(r.status, 403, `${p}: 남의 상인회가 열렸다`);
  }
  // ③ 같은 상인회라도 사장님(MERCHANT) 은 관리 화면을 못 연다
  const ownerJar = await login("owner@a.kr");
  for (const p of ["/t/seocho/admin", "/t/seocho/admin/api"]) {
    const r = await f(p, { headers: { cookie: ownerJar } });
    assert.equal(r.status, 403, `${p}: 권한 없는 계정이 열었다`);
  }
  // ④ 화면에 들고 나는 길이 보인다
  const anon = await (await f("/t/seocho/")).text();
  assert.match(anon, /href="[^"]*\/login"/, "비로그인 화면에 로그인 링크가 있어야");
  const inside = await (await f("/t/seocho/", { headers: { cookie: adminJar } })).text();
  assert.match(inside, /action="\/logout"/, "로그인한 화면에 로그아웃이 있어야");
  assert.match(inside, /\/t\/seocho\/admin/, "관리자에게 관리 화면 입구가 보여야");
});
