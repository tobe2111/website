// 자체 가입 이후의 위협 모델 — "아무나 관리자가 될 수 있다"를 전제로 한 점검
//  ① 웹훅 주소로 우리 서버를 남의 서버·자기 자신에게 쏘게 만들 수 있는가 (SSRF·되먹임)
//  ② 우리 메일 계정으로 대량 발송할 수 있는가 (도메인 평판 소각)
//  ③ 남의 조직 데이터에 닿을 수 있는가
//  ④ 입력값이 화면에 그대로 박히는가 (XSS)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import { hashPassword } from "../src/crypto.js";
import * as D from "../src/db.js";
import { contentHash } from "../src/esign.js";
import { checkWebhookUrl, newApiKey, hashApiKey, KEY_PREFIX, deliverWebhooks } from "../src/apiv1.js";
import { sendEmailFor, DEFAULT_DAILY_EMAIL_MAX } from "../src/email.js";
import { makeExtToken } from "../src/extsign.js";

let env, db, mine, theirs, myKey;
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
  env = makeEnv({ RESEND_API_KEY: "re_test", MAIL_FROM: "t@example.com", PUBLIC_ORIGIN: "https://our.example.com" });
  db = env.DB;
  mine = await D.createAssociation(db, { slug: "mine", name: "내조직", kind: "esign" });
  theirs = await D.createAssociation(db, { slug: "theirs", name: "남의조직", kind: "esign" });
  const mk = async (e, n, aid) => { const h = await hashPassword("password1234");
    return D.createUser(db, { email: e, passwordHash: h.hash, salt: h.salt, name: n, role: "ADMIN", associationId: aid }); };
  await mk("me@x.kr", "나", mine.id);
  await mk("you@x.kr", "남", theirs.id);
  myKey = newApiKey();
  await D.createApiKey(db, { associationId: mine.id, name: "내키", prefix: myKey.slice(0, 14),
    keyHash: await hashApiKey(myKey), webhookSecret: "s" });
});

// ---------- ① 웹훅 SSRF ----------
test("내부망·자기 자신·비표준 포트를 가리키는 웹훅은 거부된다", () => {
  const self = "https://our.example.com";
  const bad = [
    ["http://example.com/h", "https 아님"],
    ["https://localhost/h", "localhost"],
    ["https://127.0.0.1/h", "루프백"],
    ["https://10.0.0.5/h", "사설망"],
    ["https://192.168.1.1/h", "사설망"],
    ["https://172.16.0.1/h", "사설망"],
    ["https://169.254.169.254/latest/meta-data/", "메타데이터"],
    ["https://metadata.google.internal/x", "메타데이터"],
    ["https://db.internal/h", "내부 도메인"],
    ["https://box.local/h", "내부 도메인"],
    ["https://example.com:8080/h", "비표준 포트"],
    ["https://user:pw@example.com/h", "자격증명 포함"],
    ["https://our.example.com/api/v1/documents", "우리 자신 (되먹임)"],
    ["https://nodot/h", "도메인 아님"],
    ["not a url", "형식 오류"],
  ];
  for (const [u, why] of bad) assert.equal(checkWebhookUrl(u, self).ok, false, `${why}: ${u}`);
});

test("정상적인 공개 https 주소는 통과한다", () => {
  for (const u of ["https://hooks.example.com/e", "https://a.b.co.kr:443/x?y=1"])
    assert.equal(checkWebhookUrl(u, "https://our.example.com").ok, true, u);
});

test("관리자 화면에서도 나쁜 웹훅 주소는 저장되지 않는다", async () => {
  const jar = await loginAs("me@x.kr", "password1234");
  const path = "/t/mine/admin/api";
  const csrf = await csrfFrom(jar, path);
  const r = await req("POST", path, { cookie: jar, body: {
    _csrf: csrf, name: "위험한 키", webhook_url: "https://169.254.169.254/latest/meta-data/" } });
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.ok(!(await D.listApiKeys(db, mine.id)).some((k) => k.name === "위험한 키"));
});

test("규칙이 생기기 전에 저장된 주소도 전송 직전에 걸러진다", async () => {
  // DB 에 직접 넣어 '과거에 통과했던' 상황을 만든다
  const k = newApiKey();
  const rec = await D.createApiKey(db, { associationId: mine.id, name: "구식", prefix: k.slice(0, 14),
    keyHash: await hashApiKey(k), webhookUrl: "https://127.0.0.1/x", webhookSecret: "s" });
  await D.queueWebhook(db, { keyId: rec.id, event: "test", payload: { a: 1 } });
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called++; return new Response("ok"); };
  try { await deliverWebhooks(env, db); } finally { globalThis.fetch = realFetch; }
  assert.equal(called, 0, "내부 주소로는 요청 자체를 보내지 않아야 함");
  const q = await D.listWebhooks(db, rec.id, 3);
  assert.match(q[0].last_error, /주소 거부/);
});

// ---------- ② 메일 대량 발송 ----------
test("조직마다 하루 메일 발송 상한이 있다", async () => {
  await D.setSetting(db, "daily_email_max", "3");
  const realFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = async () => { sent++; return new Response("{}", { status: 200 }); };
  let capped = 0;
  try {
    for (let i = 0; i < 6; i++) {
      const r = await sendEmailFor(env, db, mine, { to: `a${i}@example.com`, subject: "s", html: "<p>x</p>", kind: "test" });
      if (r.capped) capped++;
    }
  } finally { globalThis.fetch = realFetch; }
  assert.equal(sent, 3, "상한만큼만 실제로 나가야 함");
  assert.equal(capped, 3, "나머지는 막혀야 함");
});

test("막힌 건도 기록에 남아 관리자가 이유를 안다", async () => {
  const logs = await D.listMessages(db, mine.id, 10);
  const blocked = logs.filter((l) => l.channel === "email" && l.status === "failed");
  assert.ok(blocked.length >= 3);
  assert.match(blocked[0].detail, /상한/);
  // 로컬파트가 가려져야 한다 (도메인은 남아도 무방)
  assert.match(blocked[0].recipient, /\*/, "수신자 로컬파트를 마스킹해서 저장");
  const local = blocked[0].recipient.split("@")[0];
  assert.ok(local.includes("*"), `마스킹되지 않음: ${blocked[0].recipient}`);
});

test("상한은 조직별로 따로 센다 (한 곳이 다 써도 다른 곳은 멀쩡)", async () => {
  const realFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = async () => { sent++; return new Response("{}", { status: 200 }); };
  try {
    const r = await sendEmailFor(env, db, theirs, { to: "b@example.com", subject: "s", html: "x", kind: "test" });
    assert.ok(!r.capped, "다른 조직은 자기 몫이 남아 있다");
  } finally { globalThis.fetch = realFetch; }
  assert.equal(sent, 1);
  await D.setSetting(db, "daily_email_max", String(DEFAULT_DAILY_EMAIL_MAX));
});

test("서명 링크 발송도 상한을 넘으면 '보냈다'고 하지 않는다", async () => {
  await D.setSetting(db, "daily_email_max", "0");
  // 0 은 '무제한'이므로 1 로 두고 이미 넘긴 상태를 만든다
  await D.setSetting(db, "daily_email_max", "1");
  const { sendSignLink } = await import("../src/extsign.js");
  const d = await D.createDocument(db, { associationId: mine.id, title: "상한 확인", body: "본문",
    contentHash: await contentHash("본문"), createdBy: null, ordered: 0, dueDate: "" });
  const e = await D.addExternalSigner(db, { documentId: d.id, name: "수신", email: "z@example.com", signOrder: 1 });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  let via;
  try { via = await sendSignLink(env, db, { assoc: mine, doc: d, signer: e, origin: BASE }); }
  finally { globalThis.fetch = realFetch; }
  assert.equal(via, null, "막혔으면 null 이어야 함 (보낸 것처럼 보고하면 안 됨)");
  await D.setSetting(db, "daily_email_max", String(DEFAULT_DAILY_EMAIL_MAX));
});

// ---------- ③ 조직 격리 ----------
test("남의 조직 계약·서식·API 키에 닿을 수 없다", async () => {
  const theirDoc = await D.createDocument(db, { associationId: theirs.id, title: "남의 계약", body: "비밀",
    contentHash: await contentHash("비밀"), createdBy: null, ordered: 0, dueDate: "" });
  const theirTpl = await D.createTemplate(db, { associationId: theirs.id, title: "남의 서식", body: "본문", fields: [], parties: ["갑"], ordered: 0 });
  const theirKey = await D.createApiKey(db, { associationId: theirs.id, name: "남의키", prefix: "sk_live_zzzzzz",
    keyHash: await hashApiKey(newApiKey()), webhookSecret: "s" });

  const jar = await loginAs("me@x.kr", "password1234");
  const csrf = await csrfFrom(jar, "/t/mine/admin/documents");
  // 내 테넌트 경로로 남의 문서 id 를 찔러 본다
  for (const p of [
    `/t/mine/admin/documents/${theirDoc.id}`,
    `/t/mine/admin/documents/${theirDoc.id}/fields`,
    `/t/mine/documents/${theirDoc.id}/paper`,
    `/t/mine/documents/${theirDoc.id}/evidence`,
  ]) assert.equal((await req("GET", p, { cookie: jar })).status, 404, p);

  for (const [p, body] of [
    [`/t/mine/admin/documents/${theirDoc.id}/close`, {}],
    [`/t/mine/admin/documents/${theirDoc.id}/edit`, { title: "탈취", body: "바꿈" }],
    [`/t/mine/admin/documents/${theirDoc.id}/external`, { name: "침입", email: "x@x.kr" }],
    [`/t/mine/admin/documents/${theirDoc.id}/remind`, {}],
    [`/t/mine/admin/templates/${theirTpl.id}/delete`, {}],
    [`/t/mine/admin/api/${theirKey.id}/revoke`, {}],
    [`/t/mine/admin/api/${theirKey.id}/webhook`, { webhook_url: "https://evil.example.com/h" }],
  ]) {
    const r = await req("POST", p, { cookie: jar, body: { _csrf: csrf, ...body } });
    assert.match(r.headers.get("location") || "", /err=1/, p);
  }
  // 실제로 아무것도 바뀌지 않았다
  const after = await D.getDocument(db, theirDoc.id);
  assert.equal(after.title, "남의 계약");
  assert.equal(after.closed, 0);
  assert.equal((await D.listExternalSigners(db, theirDoc.id)).length, 0);
  assert.ok(await D.getTemplate(db, theirTpl.id), "남의 서식이 살아 있어야 함");
  assert.equal((await D.getApiKey(db, theirKey.id)).revoked_at, "", "남의 키가 폐기되면 안 됨");
  assert.equal((await D.getApiKey(db, theirKey.id)).webhook_url, "", "남의 웹훅이 바뀌면 안 됨");
});

test("내 API 키로 남의 문서를 볼 수 없다", async () => {
  const theirDoc = (await D.listDocuments(db, theirs.id))[0];
  const r = await worker.fetch(new Request(`${BASE}/api/v1/documents/${theirDoc.id}`, {
    headers: { authorization: `Bearer ${myKey}` } }), env);
  assert.equal(r.status, 404);
});

test("외부 서명 토큰은 자기 문서에만 열린다", async () => {
  const theirDoc = (await D.listDocuments(db, theirs.id))[0];
  const myDoc = await D.createDocument(db, { associationId: mine.id, title: "내 계약", body: "본문",
    contentHash: await contentHash("본문"), createdBy: null, ordered: 0, dueDate: "" });
  const mySigner = await D.addExternalSigner(db, { documentId: myDoc.id, name: "내서명자", email: "m@x.kr", signOrder: 1 });
  // 내 서명자 id 로 남의 문서를 가리키는 토큰을 만들어도 통하지 않는다
  const forged = await makeExtToken(env.SESSION_SECRET, mySigner.id, theirDoc.id);
  assert.equal((await req("GET", `/esign/${forged}`)).status, 404);
  const real = await makeExtToken(env.SESSION_SECRET, mySigner.id, myDoc.id);
  assert.equal((await req("GET", `/esign/${real}`)).status, 200);
});

// ---------- ④ XSS ----------
test("조직 이름·서식 제목·필드 이름표에 태그를 넣어도 실행되지 않는다", async () => {
  const XSS = '"><img src=x onerror=alert(1)>';
  const evil = await D.createAssociation(db, { slug: "evil", name: XSS, kind: "esign" });
  const d = await D.createDocument(db, { associationId: evil.id, title: XSS, body: XSS,
    contentHash: await contentHash(XSS), createdBy: null, ordered: 0, dueDate: "" });
  await D.replaceFields(db, d.id, [{ kind: "sign", label: XSS, page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.05, assignee: 0, required: 1 }]);
  const e = await D.addExternalSigner(db, { documentId: d.id, name: XSS, email: "x@x.kr", signOrder: 1 });
  const t = await makeExtToken(env.SESSION_SECRET, e.id, d.id);

  const h = await (await req("GET", `/esign/${t}`)).text();
  assert.equal((await req("GET", `/esign/${t}`)).status, 200);
  assert.doesNotMatch(h, /<img src=x onerror/, "태그가 살아 있으면 안 됨");
  assert.match(h, /&lt;img src=x onerror/, "이스케이프된 형태로만 나와야 함");

  const home = await (await req("GET", "/t/evil")).text();
  assert.doesNotMatch(home, /<img src=x onerror/);
});

test("셀프 가입 이름에 태그를 넣어도 안전하다", async () => {
  const page = await req("GET", "/esign/signup");
  const cookie = cookiesOf(page);
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(await page.text()) || [])[1];
  await req("POST", "/esign/signup", { cookie, body: {
    _csrf: csrf, name: '<script>alert(1)</script>', email: "xss@example.com",
    password: "password1234", agree: "1" } });
  const made = (await D.listAllAssociations(db)).find((x) => x.email !== undefined && x.name.includes("script"));
  if (made) {
    const h = await (await req("GET", `/t/${made.slug}`)).text();
    assert.doesNotMatch(h, /<script>alert\(1\)<\/script>/, "스크립트가 그대로 들어가면 안 됨");
  }
});

// ---------- 계정 ----------
test("셀프 가입으로 슈퍼 권한을 얻을 수는 없다", async () => {
  const page = await req("GET", "/esign/signup");
  const cookie = cookiesOf(page);
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(await page.text()) || [])[1];
  const { cookie: jar } = { cookie: [cookie].join("; ") };
  const r = await req("POST", "/esign/signup", { cookie, body: {
    _csrf: csrf, name: "권한상승시도", email: "esc@example.com", password: "password1234",
    agree: "1", role: "SUPERADMIN", association_id: "1" } });
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);
  const u = await D.getUserByEmail(db, "esc@example.com");
  assert.equal(u.role, "ADMIN", "폼에 role 을 넣어도 무시되어야 함");
  const made = (await D.listAllAssociations(db)).find((x) => x.name === "권한상승시도");
  assert.equal(u.association_id, made.id, "자기 조직에만 묶여야 함");

  const sess = [cookie, cookiesOf(r)].filter(Boolean).join("; ");
  assert.ok((await req("GET", "/super", { cookie: sess })).status >= 300, "슈퍼 콘솔은 막혀야 함");
});
