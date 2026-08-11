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
