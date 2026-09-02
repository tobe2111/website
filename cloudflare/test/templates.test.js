// 계약서 서식 — 변수 치환 · 배치 복사 · 당사자 연결 · 서식으로 저장
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import { hashPassword } from "../src/crypto.js";
import * as D from "../src/db.js";
import { contentHash } from "../src/esign.js";
import { pageCount, PAGE, LINE_H } from "../src/paper.js";
import { BUILTIN, extractVars, applyVars, resolveFieldPages, normalizeTemplate, builtinById, isBuiltinId } from "../src/templates.js";

let env, db, a, admin, u1, u2;
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

before(async () => {
  env = makeEnv(); db = env.DB;
  a = await D.createAssociation(db, { slug: "s", name: "상인회" });
  const mk = async (e, n, role, pw) => { const h = await hashPassword(pw); return D.createUser(db, { email: e, passwordHash: h.hash, salt: h.salt, name: n, role, associationId: a.id }); };
  admin = await mk("ad@x.kr", "관리자", "ADMIN", "admin1234");
  u1 = await mk("a@x.kr", "김임대", "MERCHANT", "member1234");
  u2 = await mk("b@x.kr", "이임차", "MERCHANT", "member1234");
});

// ---------- 변수 ----------
test("{{변수}} 를 나온 순서대로, 중복 없이 뽑는다", () => {
  const v = extractVars("갑 {{임대인}} 과 을 {{임차인}} 은 {{임대인}} 의 건물에 대하여");
  assert.deepEqual(v, ["임대인", "임차인"]);
});

test("공백이 섞인 변수도 같은 이름으로 본다", () => {
  assert.deepEqual(extractVars("{{ 보증금 }} 과 {{보증금}}"), ["보증금"]);
  assert.equal(applyVars("{{ 보증금 }}", { 보증금: "5000만" }), "5000만");
});

test("값이 없는 빈칸은 밑줄로 남아 종이에서도 빈칸임이 보인다", () => {
  assert.match(applyVars("보증금 {{보증금}} 원", {}), /보증금 _{6,} 원/);
});

test("변수 치환은 본문 밖을 건드리지 않는다", () => {
  const body = "제1조 {{갑}} 은 {{을}} 에게\n제2조 그대로";
  assert.equal(applyVars(body, { 갑: "A", 을: "B" }), "제1조 A 은 B 에게\n제2조 그대로");
});

test("치환 값에 든 {{...}} 가 다시 치환되지 않는다 (중첩 주입 차단)", () => {
  assert.equal(applyVars("{{a}}", { a: "{{b}}", b: "터짐" }), "{{b}}");
});

// ---------- 내장 서식 ----------
test("표준 서식은 모두 본문·당사자·배치를 갖추고 있다", () => {
  assert.ok(BUILTIN.length >= 4);
  for (const raw of BUILTIN) {
    const t = normalizeTemplate(raw);
    assert.ok(t.title && t.body.length > 200, `${t.id}: 본문`);
    assert.ok(t.parties.length >= 1, `${t.id}: 당사자`);
    assert.ok(t.fields.length >= 1, `${t.id}: 배치`);
    // 서명란은 반드시 있어야 한다
    assert.ok(t.fields.some((f) => f.kind === "sign"), `${t.id}: 서명 자리`);
    // 좌표는 지면을 벗어나지 않는다
    for (const f of t.fields) {
      assert.ok(f.x >= 0 && f.x + f.w <= 1, `${t.id}/${f.label}: x 범위`);
      assert.ok(f.y >= 0 && f.y + f.h <= 1, `${t.id}/${f.label}: y 범위`);
    }
  }
});

test("서명란은 절대 쪽수가 아니라 '마지막 쪽'에 붙는다", () => {
  const t = normalizeTemplate(builtinById("b-lease"));
  assert.ok(t.fields.every((f) => f.page === -1), "표준 서식의 서명란은 끝장 기준");
  // 본문이 3쪽이면 2번(0-based), 5쪽이면 4번으로 따라간다
  assert.equal(resolveFieldPages(t.fields, 3)[0].page, 2);
  assert.equal(resolveFieldPages(t.fields, 5)[0].page, 4);
  assert.equal(resolveFieldPages(t.fields, 1)[0].page, 0, "1쪽짜리도 음수로 새지 않아야 함");
});

test("내장 서식 id 와 저장 서식 id 를 구분한다", () => {
  assert.equal(isBuiltinId("b-lease"), true);
  assert.equal(isBuiltinId("7"), false);
  assert.equal(builtinById("b-없는것"), null);
});

// ---------- 서식으로 문서 만들기 (실제 워커) ----------
let madeDocId;
test("서식으로 문서를 만들면 본문이 채워지고 서명 자리가 함께 놓인다", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const newPath = "/t/s/admin/documents/new?tpl=b-lease";
  const page = await req("GET", newPath, { cookie: jar });
  assert.equal(page.status, 200);
  const h = await page.text();
  assert.match(h, /name="var_보증금"/, "빈칸 입력란이 생겨야 함");
  assert.match(h, /name="party_0"/, "당사자 선택이 있어야 함");
  assert.match(h, /paper-stack/, "미리보기 지면");

  const csrf = await csrfFrom(jar, newPath);
  const r = await req("POST", "/t/s/admin/documents", { cookie: jar, body: {
    _csrf: csrf, template: "b-lease", title: "○○상가 101호 임대차",
    var_임대인: "김임대", var_임차인: "이임차", var_보증금: "50,000,000", var_월세: "1,500,000",
    var_소재지: "서울 서초구 서초대로 1", party_0: String(u1.id), party_1: String(u2.id),
  } });
  const loc = r.headers.get("location") || "";
  assert.match(loc, /\/fields\?/, "만든 뒤 배치 확인 화면으로 보내야 함");
  madeDocId = Number(loc.match(/documents\/(\d+)\//)[1]);

  const doc = await D.getDocument(db, madeDocId);
  assert.match(doc.body, /김임대/, "변수가 치환되어야 함");
  assert.match(doc.body, /50,000,000/);
  assert.doesNotMatch(doc.body, /\{\{/, "치환되지 않은 변수가 남으면 안 됨");
  assert.equal(doc.content_hash, await contentHash(doc.body), "해시는 치환된 최종 본문 기준");
});

test("당사자 지정이 실제 서명 요청과 필드 담당자로 이어진다", async () => {
  const reqs = await D.listRequestStatus(db, madeDocId);
  assert.deepEqual(reqs.map((r) => r.id).sort(), [u1.id, u2.id].sort());

  const fields = await D.listFields(db, madeDocId);
  assert.ok(fields.length >= 8, "당사자 2명 × 4자리");
  const mine = fields.filter((f) => f.assignee === u1.id);
  const theirs = fields.filter((f) => f.assignee === u2.id);
  assert.ok(mine.length >= 4 && theirs.length >= 4, "각자에게 자기 자리가 배정되어야 함");
  assert.ok(mine.some((f) => f.kind === "sign") && theirs.some((f) => f.kind === "sign"));

  // 배치는 실제 마지막 쪽에 놓였는가
  const last = pageCount((await D.getDocument(db, madeDocId)).body) - 1;
  assert.ok(fields.every((f) => f.page === last), "서명란은 모두 끝장에");
});

test("다른 상인회 회원을 당사자로 지정할 수 없다", async () => {
  const other = await D.createAssociation(db, { slug: "other", name: "다른상인회" });
  const h = await hashPassword("x12345678");
  const stranger = await D.createUser(db, { email: "z@y.kr", passwordHash: h.hash, salt: h.salt, name: "남", role: "MERCHANT", associationId: other.id });
  const jar = await loginAs("ad@x.kr", "admin1234");
  const csrf = await csrfFrom(jar, "/t/s/admin/documents/new?tpl=b-nda");
  const r = await req("POST", "/t/s/admin/documents", { cookie: jar, body: {
    _csrf: csrf, template: "b-nda", title: "침입", party_0: String(stranger.id), party_1: String(u1.id),
  } });
  assert.match(r.headers.get("location") || "", /err=1/);
});

test("당사자를 한 명도 지정하지 않으면 거부된다", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const csrf = await csrfFrom(jar, "/t/s/admin/documents/new?tpl=b-nda");
  const r = await req("POST", "/t/s/admin/documents", { cookie: jar, body: {
    _csrf: csrf, template: "b-nda", title: "무주공산", party_0: "", party_1: "",
  } });
  assert.match(r.headers.get("location") || "", /err=1/);
});

// ---------- 문서를 서식으로 저장 ----------
test("문서를 서식으로 저장하면 배치가 '당사자 번호'로 일반화된다", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const csrf = await csrfFrom(jar, "/t/s/admin/templates");
  const r = await req("POST", "/t/s/admin/templates", { cookie: jar, body: {
    _csrf: csrf, document: String(madeDocId), title: "우리 상가 표준 임대차", summary: "101호 기준",
  } });
  assert.match(r.headers.get("location") || "", /msg=/);

  const saved = (await D.listTemplates(db, a.id)).filter((t) => t.association_id === a.id);
  assert.equal(saved.length, 1);
  const t = normalizeTemplate(saved[0]);
  assert.equal(t.title, "우리 상가 표준 임대차");
  assert.deepEqual(t.parties, ["김임대", "이임차"], "당사자 이름표가 남아야 함");
  // 회원 id 가 아니라 당사자 번호(0,1)로 저장되어야 다음 계약에 재사용할 수 있다
  assert.ok(t.fields.every((f) => f.party === 0 || f.party === 1), "담당자는 번호로 일반화");
  assert.ok(t.fields.every((f) => f.page === -1), "끝장 기준으로 되돌려 저장");
  assert.ok(!JSON.stringify(t.fields).includes('"assignee"'), "회원 id 가 서식에 남으면 안 됨");
});

test("저장한 서식으로 다시 문서를 만들 수 있다 (다른 사람으로)", async () => {
  const saved = (await D.listTemplates(db, a.id)).find((t) => t.association_id === a.id);
  const jar = await loginAs("ad@x.kr", "admin1234");
  const path = `/t/s/admin/documents/new?tpl=${saved.id}`;
  assert.equal((await req("GET", path, { cookie: jar })).status, 200);
  const csrf = await csrfFrom(jar, path);
  const r = await req("POST", "/t/s/admin/documents", { cookie: jar, body: {
    _csrf: csrf, template: String(saved.id), title: "202호 임대차", party_0: String(u2.id), party_1: String(u1.id),
  } });
  const id = Number((r.headers.get("location") || "").match(/documents\/(\d+)\//)[1]);
  const fields = await D.listFields(db, id);
  assert.ok(fields.some((f) => f.assignee === u2.id) && fields.some((f) => f.assignee === u1.id));
  assert.notEqual(id, madeDocId, "새 문서가 만들어져야 함");
});

// ---------- 서식 본문 고치기 ----------
// 서식은 출발점이지 최종본이 아니다. 조항 한 줄은 계약마다 달라진다.
test("서식 화면에 본문을 고치는 칸이 있다", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const h = await (await req("GET", "/t/s/admin/documents/new?tpl=b-lease", { cookie: jar })).text();
  assert.match(h, /<textarea[^>]*name="body"/, "본문 편집 칸이 있어야");
  assert.match(h, /제1조/, "서식 본문이 칸에 들어 있어야");
  assert.ok(!/name="save_tpl"/.test(h), "표준 서식은 서식 자체를 고칠 수 없다");

  const saved = (await D.listTemplates(db, a.id)).find((t) => t.association_id === a.id);
  const own = await (await req("GET", `/t/s/admin/documents/new?tpl=${saved.id}`, { cookie: jar })).text();
  assert.match(own, /name="save_tpl"/, "우리 서식은 서식에도 저장할 수 있어야");
});

test("고친 본문이 그 계약서의 원문이 된다 (빈칸은 그대로 채워진다)", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const path = "/t/s/admin/documents/new?tpl=b-nda";
  const csrf = await csrfFrom(jar, path);
  const edited = "비밀유지 약정\n\n제1조 (목적) 우리끼리만 안다.\n제2조 (특약) 위반 시 {{위약금}} 을 문다.\n\n아래에 서명한다.";
  const r = await req("POST", "/t/s/admin/documents", { cookie: jar, body: {
    _csrf: csrf, template: "b-nda", title: "고쳐 만든 NDA", body: edited,
    var_위약금: "1,000만원", party_0: String(u1.id), party_1: String(u2.id),
  } });
  const id = Number((r.headers.get("location") || "").match(/documents\/(\d+)/)[1]);
  const doc = await D.getDocument(db, id);
  assert.match(doc.body, /위반 시 1,000만원 을 문다/, "고친 문장 + 채운 빈칸");
  assert.doesNotMatch(doc.body, /\{\{/, "치환 안 된 빈칸이 남으면 안 됨");
  assert.equal(doc.content_hash, await contentHash(doc.body), "봉인은 고친 본문 기준");
  // 표준 서식 자체는 남의 조직도 함께 쓰는 것이라 절대 바뀌면 안 된다
  assert.match(builtinById("b-nda").body, /제1조/);
  assert.doesNotMatch(builtinById("b-nda").body, /우리끼리만 안다/, "표준 서식이 오염되면 안 됨");
});

test("본문을 줄이면 서명 자리도 따라 올라온다 (본문 위에 겹쳐 앉지 않는다)", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const long = normalizeTemplate(builtinById("b-lease")).body;
  const short = long.split("\n").slice(0, 6).join("\n");
  const mk = async (body) => {
    const csrf = await csrfFrom(jar, "/t/s/admin/documents/new?tpl=b-lease");
    const r = await req("POST", "/t/s/admin/documents", { cookie: jar, body: {
      _csrf: csrf, template: "b-lease", title: "길이 비교", body,
      party_0: String(u1.id), party_1: String(u2.id),
    } });
    const id = Number((r.headers.get("location") || "").match(/documents\/(\d+)/)[1]);
    return { id, doc: await D.getDocument(db, id), fields: await D.listFields(db, id) };
  };
  const L = await mk(long), S = await mk(short);
  const lastOf = (x) => pageCount(x.doc.body) - 1;
  assert.ok(S.fields.length >= 8 && L.fields.length >= 8, "자리는 그대로 놓여야");
  assert.ok(S.fields.every((f) => f.page === lastOf(S)), "짧은 본문에서도 서명란은 마지막 쪽에");
  const topOf = (x) => Math.min(...x.fields.map((f) => f.y));
  assert.ok(topOf(S) < topOf(L), `본문이 짧으면 서명란도 위로 와야 (짧은 ${topOf(S)} < 긴 ${topOf(L)})`);
  // 본문 마지막 줄보다는 아래여야 한다 — 글자 위에 서명칸이 겹치면 읽을 수도 서명할 수도 없다
  const bodyLines = short.split("\n").length;
  assert.ok(topOf(S) > (PAGE.pad + (bodyLines - 1) * LINE_H) / PAGE.h, "서명란이 본문 아래에 있어야");
});

test("'서식에도 저장'을 체크하면 우리 서식의 본문이 바뀐다", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const saved = (await D.listTemplates(db, a.id)).find((t) => t.association_id === a.id);
  const before = saved.body;
  const next = before + "\n제99조 (특약) 반려동물 금지.";
  const csrf = await csrfFrom(jar, `/t/s/admin/documents/new?tpl=${saved.id}`);
  await req("POST", "/t/s/admin/documents", { cookie: jar, body: {
    _csrf: csrf, template: String(saved.id), title: "특약 넣은 임대차", body: next, save_tpl: "1",
    party_0: String(u1.id), party_1: String(u2.id),
  } });
  const after = await D.getTemplate(db, saved.id);
  assert.match(after.body, /반려동물 금지/, "서식 본문이 바뀌어야");
  const t = normalizeTemplate(after);
  assert.ok(t.fields.length >= 8, "서식의 자리가 사라지면 안 됨");
  assert.ok(t.fields.every((f) => f.page === -1), "끝장 기준 자리는 그대로 끝장 기준");
});

test("체크하지 않으면 서식은 그대로다", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const saved = (await D.listTemplates(db, a.id)).find((t) => t.association_id === a.id);
  const before = saved.body;
  const csrf = await csrfFrom(jar, `/t/s/admin/documents/new?tpl=${saved.id}`);
  await req("POST", "/t/s/admin/documents", { cookie: jar, body: {
    _csrf: csrf, template: String(saved.id), title: "이번만 고침", body: before + "\n제100조 (특약) 이번 계약만.",
    party_0: String(u1.id), party_1: String(u2.id),
  } });
  assert.equal((await D.getTemplate(db, saved.id)).body, before, "체크 없이는 서식이 바뀌면 안 됨");
});

test("남의 서식은 '서식에도 저장'으로도 고칠 수 없다", async () => {
  const other = await D.createAssociation(db, { slug: "other2", name: "다른곳2" });
  const foreign = await D.createTemplate(db, { associationId: other.id, title: "남의 것", body: "원본 본문", fields: [], parties: ["갑"], ordered: 0 });
  const jar = await loginAs("ad@x.kr", "admin1234");
  const csrf = await csrfFrom(jar, "/t/s/admin/templates");
  await req("POST", "/t/s/admin/documents", { cookie: jar, body: {
    _csrf: csrf, template: String(foreign.id), title: "덮어쓰기", body: "바꿔치기", save_tpl: "1",
    party_0: String(u1.id),
  } });
  assert.equal((await D.getTemplate(db, foreign.id)).body, "원본 본문", "남의 서식이 바뀌면 안 됨");
});

test("다른 상인회의 서식은 쓸 수 없다", async () => {
  const other = await D.getAssociationBySlug(db, "other");
  const foreign = await D.createTemplate(db, { associationId: other.id, title: "남의 서식", body: "본문", fields: [], parties: ["갑"], ordered: 0 });
  const jar = await loginAs("ad@x.kr", "admin1234");
  const csrf = await csrfFrom(jar, "/t/s/admin/templates");
  const r = await req("POST", "/t/s/admin/documents", { cookie: jar, body: {
    _csrf: csrf, template: String(foreign.id), title: "훔치기", party_0: String(u1.id),
  } });
  assert.match(r.headers.get("location") || "", /err=1/);
});

test("서식 삭제는 자기 상인회 것만", async () => {
  const other = await D.getAssociationBySlug(db, "other");
  const foreign = (await D.listTemplates(db, other.id)).find((t) => t.association_id === other.id);
  const jar = await loginAs("ad@x.kr", "admin1234");
  const csrf = await csrfFrom(jar, "/t/s/admin/templates");
  const r = await req("POST", `/t/s/admin/templates/${foreign.id}/delete`, { cookie: jar, body: { _csrf: csrf } });
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.ok(await D.getTemplate(db, foreign.id), "남의 서식은 그대로 남아야 함");
});
