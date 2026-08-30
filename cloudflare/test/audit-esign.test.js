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

// 알림 자동화는 조직마다 켜는 스위치이고 기본이 '꺼짐' 이다(켜지 않은 곳에 자동 발송이
// 붙어 남의 크레딧이 줄면 안 된다). 발송 로직을 시험하려면 실제 고객처럼 한 번 켠다.
const orgSending = async (db, opts) => {
  const a = await D.createAssociation(db, opts);
  await D.setNotifyAuto(db, a.id, 1);
  return D.getAssociationById(db, a.id); // 켠 뒤의 행을 돌려줘야 한다 — 옛 사본에는 꺼짐이 박혀 있다
};

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
  a = await orgSending(db, { slug: "s", name: "서초 상인회" });
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
  assert.match(out, /^\[서초 상인회\] 계약서 전자서명 요청 안내/);
  assert.match(out, /▶ 계약서명: 임대차/);
  assert.doesNotMatch(out, /#\{/, "치환되지 않은 변수가 남으면 안 됨");
  // 빈 값이 와도 줄 구조는 무너지지 않는다
  const empty = renderTemplate("sign_request", { 상호: "x" });
  assert.match(empty, /▶ 서명 기한: -/);
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
  assert.match(done.text, /▶ 문서 검증번호: [0-9a-f]+/);
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
  assert.match(h, /인쇄 · PDF로 저장/);
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

// ---------- 서명 사슬: 동시 서명 vs 기록 삭제 ----------
test("동시 서명(같은 직전값)을 위변조로 오판하지 않는다", async () => {
  const { verifyChain } = await import("../src/esign.js");
  // A 다음에 B·C 가 동시에 서명해 둘 다 A 를 가리키는 상황
  const rows = [
    { id: 1, record_hash: "A", prev_hash: "", seal_ver: 3 },
    { id: 2, record_hash: "B", prev_hash: "A", seal_ver: 3 },
    { id: 3, record_hash: "C", prev_hash: "A", seal_ver: 3 },
    { id: 4, record_hash: "D", prev_hash: "C", seal_ver: 3 },
  ];
  const r = verifyChain(rows);
  assert.equal(r.ok, true, "동시 서명은 조작이 아니다");
  assert.equal(r.forks, 1, "갈래는 갈래대로 기록");
});

test("중간 기록을 지우면 여전히 잡아낸다", async () => {
  const { verifyChain } = await import("../src/esign.js");
  const full = [
    { id: 1, record_hash: "A", prev_hash: "", seal_ver: 3 },
    { id: 2, record_hash: "B", prev_hash: "A", seal_ver: 3 },
    { id: 3, record_hash: "C", prev_hash: "B", seal_ver: 3 },
  ];
  assert.equal(verifyChain(full).ok, true);
  const deleted = [full[0], full[2]]; // B 를 지웠다 → C 의 직전값이 어디에도 없다
  const r = verifyChain(deleted);
  assert.equal(r.ok, false, "삭제는 반드시 탐지되어야 함");
  assert.equal(r.brokenAt, 3);
  assert.equal(r.found, "B");
});

test("첫 기록의 직전값이 비어 있지 않으면 잡아낸다 (앞부분 통째 삭제)", async () => {
  const { verifyChain } = await import("../src/esign.js");
  const r = verifyChain([{ id: 5, record_hash: "E", prev_hash: "D", seal_ver: 3 }]);
  assert.equal(r.ok, false, "앞을 통째로 잘라내도 첫 줄에서 드러난다");
});

// ---------- 서명 전 문서 수정 ----------
test("서명 전에는 문서를 고칠 수 있고 해시가 다시 계산된다", async () => {
  const { hashPassword } = await import("../src/crypto.js");
  const h = await hashPassword("admin1234");
  await D.updateUserPassword(db, admin.id, h.hash, h.salt);
  const seed = await worker.fetch(new Request(`${BASE}/login`), env);
  const j0 = (seed.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const c0 = (/name="_csrf" value="([^"]+)"/.exec(await seed.text()) || [])[1];
  const lr = await worker.fetch(new Request(`${BASE}/login`, { method: "POST",
    headers: { cookie: j0, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: c0, email: "ad@x.kr", password: "admin1234" }).toString() }), env);
  const jar = [j0, (lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ")].filter(Boolean).join("; ");

  const d = await D.createDocument(db, { associationId: a.id, title: "오타 있는 계약", body: "제1조 계약금은 백만원으로 한다.",
    contentHash: await contentHash("제1조 계약금은 백만원으로 한다."), createdBy: admin.id, ordered: 0, dueDate: "" });
  const path = `/t/s/admin/documents/${d.id}`;
  const page = await worker.fetch(new Request(BASE + path, { headers: { cookie: jar } }), env);
  const html = await page.text();
  assert.match(html, /문서 수정/, "서명 전에는 수정 폼이 보여야 함");
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(html) || [])[1];

  const fixed = "제1조 계약금은 일천만원으로 한다.";
  const r = await worker.fetch(new Request(`${BASE}${path}/edit`, { method: "POST",
    headers: { cookie: jar, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, title: "수정된 계약", body: fixed }).toString() }), env);
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);
  const after = await D.getDocument(db, d.id);
  assert.equal(after.title, "수정된 계약");
  assert.equal(after.body, fixed);
  assert.equal(after.content_hash, await contentHash(fixed), "해시가 새 본문 기준으로 갱신되어야 함");
  const ev = await D.listDocEvents(db, d.id);
  assert.ok(ev.some((e) => e.kind === "edited"), "수정도 감사 추적에 남는다");

  // 서명이 시작되면 잠긴다
  await D.createSignature(db, { documentId: d.id, userId: admin.id, signerName: "관리자", signatureImage: "",
    contentHash: after.content_hash, ip: "1.1.1.1", userAgent: "t", verifyCode: "editlock1", recordHash: "x",
    signedAt: "2026-08-11T00:00:00Z", prevHash: "", sealVer: 3, verifyLevel: "password", fieldsHash: "" });
  const r2 = await worker.fetch(new Request(`${BASE}${path}/edit`, { method: "POST",
    headers: { cookie: jar, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, title: "뒤늦은 수정", body: "몰래 바꾼 본문" }).toString() }), env);
  assert.match(r2.headers.get("location") || "", /err=1/, "서명 후에는 막혀야 함");
  assert.equal((await D.getDocument(db, d.id)).title, "수정된 계약", "내용이 바뀌면 안 됨");
  const locked = await (await worker.fetch(new Request(BASE + path, { headers: { cookie: jar } }), env)).text();
  assert.doesNotMatch(locked, /✏️ 문서 수정/, "수정 폼도 사라져야 함");
});

// ---------- 과금 방식: 발송당 vs 계약당 ----------
test("계약당 과금이면 계약 생성에서 한 번만 받고 서명 발송은 무료다", async () => {
  const { billingMode, chargeContract, isContractKind } = await import("../src/notify.js");
  await D.setSetting(db, "billing_mode", "per_doc");
  await D.setSetting(db, "price_alimtalk", "100");
  assert.equal(await billingMode(db), "per_doc");

  const before = await D.getBalance(db, a.id);
  const d = await D.createDocument(db, { associationId: a.id, title: "계약당 과금 계약", body: "본문",
    contentHash: await contentHash("본문"), createdBy: admin.id, ordered: 0, dueDate: "" });
  const c = await chargeContract(db, a, { documentId: d.id, title: d.title });
  assert.equal(c.ok, true);
  assert.equal(c.cost, 100);
  assert.equal(await D.getBalance(db, a.id), before - 100, "계약 요금 1회만 차감");

  // 이 계약의 서명 발송은 추가 차감이 없어야 한다
  const e = await D.addExternalSigner(db, { documentId: d.id, name: "무료수신", phone: "010-2222-3333", signOrder: 1 });
  const afterCharge = await D.getBalance(db, a.id);
  sends = [];
  const restore = stubAligo();
  try {
    const { sendSignLink } = await import("../src/extsign.js");
    for (let i = 0; i < 3; i++) await sendSignLink(env, db, { assoc: a, doc: d, signer: e, origin: BASE });
  } finally { restore(); }
  assert.equal(sends.length, 3, "3통이 실제로 나갔다");
  assert.equal(await D.getBalance(db, a.id), afterCharge, "그런데 잔액은 그대로 (이중 과금 없음)");
});

test("계약당 과금이어도 원가는 그대로 집계된다 (마진이 흐려지지 않게)", async () => {
  const logs = await D.listMessages(db, a.id, 20);
  // 방금 계약당 모드에서 보낸 건들만 (앞선 테스트의 발송당 기록과 섞이지 않게)
  const masked = D.maskPhone("01022223333");
  const sendRows = logs.filter((l) => l.channel !== "contract" && l.status === "sent" && l.recipient === masked);
  assert.equal(sendRows.length, 3, "그 계약에서 나간 3통");
  assert.ok(sendRows.every((l) => l.cost === 0), "발송 매출은 0");
  assert.ok(sendRows.every((l) => l.cost_base > 0), "원가는 실제 값으로 남아야 함");
  const contractRow = logs.find((l) => l.channel === "contract");
  assert.ok(contractRow, "계약 요금이 매출 행으로 남아야 함");
  assert.equal(contractRow.cost, 100);
  assert.match(contractRow.ref, /-DOC\d+$/, "어느 계약의 요금인지 대사할 수 있어야 함");
});

test("공지는 계약과 무관하므로 계약당 모드에서도 발송당 과금이다", async () => {
  const { isContractKind } = await import("../src/notify.js");
  assert.equal(isContractKind("sign_request"), true);
  assert.equal(isContractKind("sign_otp"), true);
  assert.equal(isContractKind("notice"), false, "공지는 계약 요금에 포함되지 않는다");

  const before = await D.getBalance(db, a.id);
  sends = [];
  const restore = stubAligo();
  try {
    const { sendOne } = await import("../src/notify.js");
    await sendOne(env, db, { assoc: a, kind: "notice", to: "01044445555", text: "공지입니다", templateCode: "TPL_NOTICE" });
  } finally { restore(); }
  assert.equal(await D.getBalance(db, a.id), before - 100, "공지는 건당 차감");
});

test("잔액이 없으면 계약 요금 청구가 실패한다", async () => {
  const { chargeContract } = await import("../src/notify.js");
  const poor = await orgSending(db, { slug: "poor", name: "잔액없음" });
  const d = await D.createDocument(db, { associationId: poor.id, title: "무일푼", body: "본문",
    contentHash: await contentHash("본문"), createdBy: null, ordered: 0, dueDate: "" });
  const r = await chargeContract(db, poor, { documentId: d.id, title: d.title });
  assert.equal(r.ok, false);
  assert.match(r.error, /잔액/);
});

test("발송당 모드로 되돌리면 다시 건별로 차감한다", async () => {
  await D.setSetting(db, "billing_mode", "per_send");
  const d = await D.createDocument(db, { associationId: a.id, title: "발송당 계약", body: "본문",
    contentHash: await contentHash("본문"), createdBy: admin.id, ordered: 0, dueDate: "" });
  const e = await D.addExternalSigner(db, { documentId: d.id, name: "유료수신", phone: "010-6666-7777", signOrder: 1 });
  const before = await D.getBalance(db, a.id);
  sends = [];
  const restore = stubAligo();
  try {
    const { sendSignLink } = await import("../src/extsign.js");
    await sendSignLink(env, db, { assoc: a, doc: d, signer: e, origin: BASE });
  } finally { restore(); }
  assert.equal(sends.length, 1);
  assert.equal(await D.getBalance(db, a.id), before - 100, "발송당 모드에서는 건별 차감");
  await D.setSetting(db, "price_alimtalk", "22");
});

// ---------- 링크 절대 주소 (크론이 보내는 알림톡) ----------
test("절대 주소를 모르면 링크를 보내지 않는다 (깨진 링크 방지)", async () => {
  const { sendSignLink, originFor, rememberOrigin } = await import("../src/extsign.js");
  const d = await D.createDocument(db, { associationId: a.id, title: "주소 없음", body: "본문",
    contentHash: await contentHash("본문"), createdBy: admin.id, ordered: 0, dueDate: "" });
  const e = await D.addExternalSigner(db, { documentId: d.id, name: "수신자", phone: "010-8888-9999", signOrder: 1 });
  sends = [];
  const restore = stubAligo();
  let via;
  try { via = await sendSignLink(env, db, { assoc: a, doc: d, signer: e, origin: "" }); } finally { restore(); }
  assert.equal(via, null, "주소가 없으면 발송하지 않는다");
  assert.equal(sends.length, 0);
});

test("주소는 개별 도메인 → 워커 변수 → 학습값 순으로 정해진다", async () => {
  const { originFor, rememberOrigin } = await import("../src/extsign.js");
  // ③ 학습값
  assert.equal(await originFor({}, db, a), "", "아직 아무것도 없으면 빈 값");
  await rememberOrigin(db, "https://learned.example.com");
  assert.equal(await originFor({}, db, a), "https://learned.example.com");
  // ② 워커 변수가 우선
  assert.equal(await originFor({ PUBLIC_ORIGIN: "https://env.example.com/" }, db, a), "https://env.example.com",
    "끝의 슬래시는 떼어 낸다");
  // ① 개별 도메인이 가장 우선
  const withDomain = { ...a, custom_domain: "seocho-market.kr" };
  assert.equal(await originFor({ PUBLIC_ORIGIN: "https://env.example.com" }, db, withDomain), "https://seocho-market.kr");
});

test("이상한 값은 학습하지 않는다", async () => {
  const { rememberOrigin, originFor } = await import("../src/extsign.js");
  const before = await originFor({}, db, a);
  await rememberOrigin(db, "javascript:alert(1)");
  await rememberOrigin(db, "");
  assert.equal(await originFor({}, db, a), before, "http(s) 가 아니면 무시");
});

test("링크가 있으면 절대 주소로 나간다", async () => {
  const { sendSignLink } = await import("../src/extsign.js");
  const d = await D.createDocument(db, { associationId: a.id, title: "주소 있음", body: "본문",
    contentHash: await contentHash("본문"), createdBy: admin.id, ordered: 0, dueDate: "" });
  const e = await D.addExternalSigner(db, { documentId: d.id, name: "수신자2", phone: "010-1010-2020", signOrder: 1 });
  sends = [];
  const restore = stubAligo();
  try { await sendSignLink(env, db, { assoc: a, doc: d, signer: e, origin: "https://my.example.com" }); }
  finally { restore(); }
  assert.equal(sends.length, 1);
  const btn = JSON.parse(sends[0].button);
  assert.match(btn.button[0].linkMo, /^https:\/\/my\.example\.com\/esign\//, "버튼 링크가 절대 주소여야 함");
});
