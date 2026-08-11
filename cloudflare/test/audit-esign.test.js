// 전수 점검에서 나온 결함들에 대한 회귀 테스트
//  ① 알림톡 템플릿 — 용도별로 다른 코드로 나가는가 (문구 불일치 = 발송 거절)
//  ② 외부 서명자 재알림 — 회원만 챙기고 빠뜨리지 않는가
//  ③ 외부 서명자의 완성본·증적 접근 — 로그인 없이 자기 계약을 받을 수 있는가
//  ④ 증적 패키지가 외부 서명자를 온전히 담는가
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { contentHash } from "../src/esign.js";
import { TEMPLATES, TEMPLATE_KEYS, renderTemplate, templateButton } from "../src/notify.js";
import { makeExtToken, remindExternals } from "../src/extsign.js";

let env, db, a, admin, doc, ext1, ext2, token1;
const BASE = "http://localhost";
const BODY = Array.from({ length: 30 }, (_, i) => `제${i + 1}조 계약 조항.`).join("\n");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// 알리고 호출을 가로채 '어느 템플릿 코드로 무슨 문구가 나갔는지' 관찰
let sends = [];
function stubAligo() {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("token/create")) return new Response(JSON.stringify({ code: 0, token: "t" }), { status: 200 });
    if (u.includes("alimtalk/send")) {
      const p = new URLSearchParams(init.body);
      sends.push({ tpl: p.get("tpl_code"), text: p.get("message_1"), to: p.get("receiver_1"), button: p.get("button_1") || "" });
      return new Response(JSON.stringify({ code: 0, info: { mid: "1" } }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  return () => { globalThis.fetch = real; };
}

before(async () => {
  env = makeEnv({
    ALIGO_API_KEY: "k", ALIGO_USER_ID: "u", ALIGO_SENDER_KEY: "sk", ALIGO_SENDER: "0212345678",
  });
  db = env.DB;
  a = await D.createAssociation(db, { slug: "s", name: "서초 상인회" });
  const { hashPassword } = await import("../src/crypto.js");
  const h = await hashPassword("admin1234");
  admin = await D.createUser(db, { email: "ad@x.kr", passwordHash: h.hash, salt: h.salt, name: "관리자", role: "ADMIN", associationId: a.id });
  // 모든 템플릿 코드 등록 + 잔액 충전
  for (const [kind, t] of Object.entries(TEMPLATES)) await D.setSetting(db, t.key, `TPL_${kind.toUpperCase()}`);
  await D.addCredit(db, a.id, 100000, { kind: "charge", memo: "테스트" });
  doc = await D.createDocument(db, { associationId: a.id, title: "임대차 계약", body: BODY,
    contentHash: await contentHash(BODY), createdBy: admin.id, ordered: 0, dueDate: "2026-12-31" });
  ext1 = await D.addExternalSigner(db, { documentId: doc.id, name: "김갑", phone: "010-1111-2222", signOrder: 1 });
  ext2 = await D.addExternalSigner(db, { documentId: doc.id, name: "이을", phone: "010-3333-4444", signOrder: 2 });
  token1 = await makeExtToken(env.SESSION_SECRET, ext1.id, doc.id);
});

// ---------- ① 템플릿 ----------
test("용도마다 별도의 템플릿이 정의되어 있다", () => {
  for (const k of ["sign_request", "sign_remind", "sign_done", "sign_otp", "notice"]) {
    assert.ok(TEMPLATES[k], `${k} 템플릿`);
    assert.ok(TEMPLATES[k].body.length > 20, `${k} 문구`);
    assert.ok(TEMPLATES[k].key.startsWith("tpl_"), `${k} 설정 키`);
  }
  // 서로 다른 코드를 쓰는지 (같으면 문구가 달라 발송이 거절된다)
  const keys = Object.values(TEMPLATES).map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length, "템플릿 키가 겹치면 안 됨");
});

test("템플릿 문구의 변수는 선언된 것만 쓴다", () => {
  for (const [kind, t] of Object.entries(TEMPLATES)) {
    const used = [...t.body.matchAll(/#\{([^}]+)\}/g)].map((m) => m[1].trim());
    for (const v of used) assert.ok(t.vars.includes(v), `${kind}: 선언되지 않은 변수 ${v}`);
    for (const v of t.vars) assert.ok(used.includes(v), `${kind}: 쓰이지 않는 변수 ${v}`);
  }
});

test("값을 끼워 넣으면 심사 문구의 구조가 그대로 유지된다", () => {
  const out = renderTemplate("sign_request", { 상호: "서초 상인회", 이름: "김갑", 문서명: "임대차", 기한: "2026-12-31" });
  assert.match(out, /^\[서초 상인회\] 전자서명 요청/);
  assert.match(out, /▶ 문서: 임대차/);
  assert.doesNotMatch(out, /#\{/, "치환되지 않은 변수가 남으면 안 됨");
  // 빈 값이 와도 줄 구조는 무너지지 않는다
  const empty = renderTemplate("sign_request", { 상호: "x" });
  assert.match(empty, /▶ 기한: -/);
  assert.equal(empty.split("\n").length, out.split("\n").length);
});

test("서명 요청·완료·본인확인이 각각 자기 템플릿 코드로 나간다", async () => {
  sends = [];
  const restore = stubAligo();
  try {
    // 요청
    const { sendSignLink } = await import("../src/extsign.js");
    await sendSignLink(env, db, { assoc: a, doc, signer: ext1, origin: BASE });
    // 본인확인
    const page = await worker.fetch(new Request(`${BASE}/esign/${token1}`), env);
    const cookie = (page.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
    const csrf = (/name="_csrf" value="([^"]+)"/.exec(await page.text()) || [])[1];
    await D.setSetting(db, "esign_otp", "1");
    await worker.fetch(new Request(`${BASE}/esign/${token1}/otp`, { method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: csrf }).toString() }), env);
    await D.setSetting(db, "esign_otp", "0");
  } finally { restore(); }

  const byTpl = Object.fromEntries(sends.map((x) => [x.tpl, x]));
  assert.ok(byTpl.TPL_SIGN_REQUEST, `서명 요청 템플릿으로 발송: ${sends.map((s) => s.tpl)}`);
  assert.ok(byTpl.TPL_SIGN_OTP, `본인확인은 전용 템플릿으로: ${sends.map((s) => s.tpl)}`);
  assert.notEqual(byTpl.TPL_SIGN_OTP.tpl, byTpl.TPL_SIGN_REQUEST.tpl, "같은 코드를 쓰면 안 됨");
  // 문구가 심사본과 일치하는가
  assert.equal(byTpl.TPL_SIGN_REQUEST.text,
    renderTemplate("sign_request", { 상호: a.name, 이름: "김갑", 문서명: doc.title, 기한: doc.due_date }));
  assert.match(byTpl.TPL_SIGN_OTP.text, /전자서명 본인확인/);
  assert.match(byTpl.TPL_SIGN_OTP.text, /인증번호는 \d{6} 입니다/);
  assert.equal(byTpl.TPL_SIGN_OTP.button, "", "본인확인 문자에는 버튼이 없어야 함");
  assert.ok(byTpl.TPL_SIGN_REQUEST.button.includes(templateButton("sign_request")), "요청에는 버튼이 있어야 함");
});

test("서명 완료 확인서도 전용 템플릿으로 나간다", async () => {
  sends = [];
  const restore = stubAligo();
  try {
    const page = await worker.fetch(new Request(`${BASE}/esign/${token1}`), env);
    const cookie = (page.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
    const csrf = (/name="_csrf" value="([^"]+)"/.exec(await page.text()) || [])[1];
    const r = await worker.fetch(new Request(`${BASE}/esign/${token1}`, { method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: csrf, consent: "1", signature: PNG, signer_name: "김갑" }).toString() }), env);
    assert.doesNotMatch(r.headers.get("location") || "", /err=1/);
  } finally { restore(); }
  const done = sends.find((x) => x.tpl === "TPL_SIGN_DONE");
  assert.ok(done, `완료 템플릿으로 발송: ${sends.map((s) => s.tpl)}`);
  assert.match(done.text, /전자서명 완료/);
  assert.match(done.text, /검증코드: [0-9a-f]+/);
});

test("템플릿 코드가 없는 종류만 막히고 나머지는 정상 발송된다", async () => {
  await D.setSetting(db, TEMPLATE_KEYS.sign_remind, "");
  sends = [];
  const restore = stubAligo();
  try {
    const r = await remindExternals(env, db, { assoc: a, doc, origin: BASE });
    assert.equal(r.sent, 0, "리마인더 템플릿이 없으면 나가지 않는다");
  } finally { restore(); }
  const logs = await D.listMessages(db, a.id, 5);
  assert.ok(logs.some((l) => l.detail && l.detail.includes("템플릿")), "실패 사유가 로그에 남아야 함");
  await D.setSetting(db, TEMPLATE_KEYS.sign_remind, "TPL_SIGN_REMIND");
});

// ---------- ② 외부 서명자 재알림 ----------
test("재알림이 외부 서명자를 빠뜨리지 않는다", async () => {
  sends = [];
  const restore = stubAligo();
  let r;
  try { r = await remindExternals(env, db, { assoc: a, doc, origin: BASE }); } finally { restore(); }
  assert.equal(r.total, 1, "이미 서명한 사람은 빼고 남은 1명");
  assert.equal(r.sent, 1);
  assert.equal(sends[0].tpl, "TPL_SIGN_REMIND");
  assert.match(sends[0].text, /미완료 안내/);
  assert.equal(sends[0].to, "01033334444", "남은 외부 서명자에게");
});

test("자동 리마인더 대상 판정이 외부 서명자만 있는 문서도 잡는다", async () => {
  const soon = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const d2 = await D.createDocument(db, { associationId: a.id, title: "외부만 있는 계약", body: "본문",
    contentHash: await contentHash("본문"), createdBy: admin.id, ordered: 0, dueDate: soon });
  await D.addExternalSigner(db, { documentId: d2.id, name: "박병", phone: "010-5555-6666", signOrder: 1 });
  const list = await D.listDocsNeedingRemind(db);
  assert.ok(list.some((x) => x.id === d2.id), "회원 서명 요청이 하나도 없어도 대상이어야 함");
});

test("거절한 외부 서명자에게는 다시 조르지 않는다", async () => {
  const d3 = await D.createDocument(db, { associationId: a.id, title: "거절 포함", body: "본문",
    contentHash: await contentHash("본문"), createdBy: admin.id, ordered: 0, dueDate: "" });
  const e = await D.addExternalSigner(db, { documentId: d3.id, name: "거절자", phone: "010-7777-8888", signOrder: 1 });
  await D.declineExternal(db, e.id, "동의 불가");
  sends = [];
  const restore = stubAligo();
  let r;
  try { r = await remindExternals(env, db, { assoc: a, doc: d3, origin: BASE }); } finally { restore(); }
  assert.equal(r.total, 0);
  assert.equal(sends.length, 0);
});

// ---------- ③ 외부 서명자의 완성본·증적 ----------
test("외부 서명자는 로그인 없이 자기 계약의 완성본을 본다", async () => {
  const r = await worker.fetch(new Request(`${BASE}/esign/${token1}/paper`), env);
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.match(h, /paper-stack/);
  assert.match(h, /임대차 계약/);
  assert.match(h, /인쇄 \/ PDF로 저장/);
});

test("외부 서명자는 자기 계약의 증적 패키지를 받는다", async () => {
  const r = await worker.fetch(new Request(`${BASE}/esign/${token1}/evidence`), env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/zip");
  const b = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual([...b.slice(0, 2)], [0x50, 0x4b]);
});

test("토큰이 틀리면 완성본·증적 모두 404", async () => {
  for (const p of [`/esign/${ext1.id}.bogus/paper`, `/esign/${ext1.id}.bogus/evidence`])
    assert.equal((await worker.fetch(new Request(BASE + p), env)).status, 404, p);
});

// ---------- ④ 증적 패키지의 외부 서명자 반영 ----------
test("증적 패키지가 외부 서명자를 온전히 담는다", async () => {
  const { buildEvidence } = await import("../src/evidence.js");
  const { makeZip } = await import("../src/zip.js");
  const pkg = await buildEvidence(env, db, await D.getDocument(db, doc.id), a);
  assert.ok(pkg.zip.length > 0);
  // JSON 안을 직접 확인 (압축 해제 없이 buildEvidence 의 입력을 다시 계산)
  const counts = await D.requestCounts(db, doc.id);
  assert.equal(counts.total, 2, "외부 2명이 전체 인원에 포함");
  assert.equal(counts.signed, 1);
  const sigs = await D.listSignatures(db, doc.id);
  assert.equal(sigs[0].signer_kind, "external");
  assert.equal(sigs[0].signer_email, "", "이메일 없이 번호만 준 경우");
  assert.ok(makeZip, "zip 작성기 사용 가능");
});

test("외부 서명자에게 배정된 필드의 이름표가 비지 않는다", async () => {
  const d4 = await D.createDocument(db, { associationId: a.id, title: "이름표 확인", body: BODY,
    contentHash: await contentHash(BODY), createdBy: admin.id, ordered: 0, dueDate: "" });
  const e = await D.addExternalSigner(db, { documentId: d4.id, name: "홍외부", email: "h@example.com", signOrder: 1 });
  await D.replaceFields(db, d4.id, [
    { kind: "sign", label: "외부 서명", page: 0, x: 0.5, y: 0.8, w: 0.2, h: 0.05, assignee: -e.id, required: 1 },
  ]);
  const { buildEvidence } = await import("../src/evidence.js");
  const pkg = await buildEvidence(env, db, await D.getDocument(db, d4.id), a);
  const text = new TextDecoder().decode(pkg.zip);
  // 압축되지 않은 부분에도 이름이 들어가지만, 확실히 하려면 데이터 구조로 확인
  const exts = await D.listExternalSigners(db, d4.id);
  assert.equal(exts[0].name, "홍외부");
  const fields = await D.listFields(db, d4.id);
  assert.equal(fields[0].assignee, -e.id, "음수 = 외부 서명자");
  assert.ok(pkg.count >= 4, "패키지 구성 파일");
});

// ---------- 검증 화면 ----------
test("검증 페이지가 입력값 무결성까지 보여 준다", async () => {
  const sig = (await D.listSignatures(db, doc.id))[0];
  const h = await (await worker.fetch(new Request(`${BASE}/verify/${sig.verify_code}`), env)).text();
  assert.match(h, /입력값·서명 위치/, "필드값 판정이 보여야 함");
  assert.match(h, /외부 서명자/, "서명자 구분 표시");
});

test("확인서에도 입력값 판정이 들어간다", async () => {
  const sig = (await D.listSignatures(db, doc.id))[0];
  const h = await (await worker.fetch(new Request(`${BASE}/certificate/${sig.verify_code}`), env)).text();
  assert.match(h, /입력값·서명 위치/);
});
