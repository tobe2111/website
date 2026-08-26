// 발송 리허설 — "실제로 카톡이 오는가"를 폰 없이 미리 검증한다.
//
// 개통 직전에 남는 불안은 하나다: 코드는 통과하는데 진짜로 카카오가 우리 문구를
// 받아 주고 알리고가 보내 주는가. 그건 사람이 폰으로 받아 봐야 안다.
// 다만 그 전에 확인할 수 있는 게 있다 — 우리가 알리고에 '무엇을 보내는가'다.
//
// 이 스크립트는 알리고를 가로채서 실제로 나갈 요청을 통째로 붙잡고, 계약 한 건이
// 시작해서 끝날 때까지 나가는 모든 발송을 검사한다:
//   ① 서명 요청  ② 본인확인(OTP)  ③ 서명 완료  ④ 기한 재알림
// 각각에 대해 템플릿 코드·발신번호·수신번호·문구가 심사받은 원문과 같은지,
// 버튼 링크가 진짜 열리는 주소인지, 크레딧이 정확히 얼마 깎이는지를 본다.
//
// 여기서 걸리는 것은 폰 테스트에서도 반드시 걸린다. 먼저 걸러 두는 편이 싸다.
//   실행: npm run test:send
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = (await import(path.join(ROOT, "src/index.js"))).default;
const { makeEnv } = await import(path.join(ROOT, "test/shim.js"));
const D = await import(path.join(ROOT, "src/db.js"));
const N = await import(path.join(ROOT, "src/notify.js"));
const { CRON } = await import(path.join(ROOT, "src/scheduled.js"));
const { hashPassword } = await import(path.join(ROOT, "src/crypto.js"));
const { makeExtToken } = await import(path.join(ROOT, "src/extsign.js"));

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ✓", n, x); } else { fail++; console.error("  ✗", n, x); } };
const BASE = "https://website.example.kr";

// ---- 알리고를 가로챈다. 실제로 나갈 요청을 그대로 모아 둔다. ----
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("kakaoapi.aligo.in/akv10/token/create")) {
    return new Response(JSON.stringify({ code: 0, token: "TOKEN" }), { headers: { "content-type": "application/json" } });
  }
  if (u.includes("kakaoapi.aligo.in/akv10/alimtalk/send")) {
    const f = init.body; // URLSearchParams
    sent.push(Object.fromEntries(f.entries()));
    return new Response(JSON.stringify({ code: 0, info: { mid: sent.length } }), { headers: { "content-type": "application/json" } });
  }
  return new Response("ok");
};

// ---- 운영과 같은 상태로 차린다: 키 4개 + 템플릿 코드 7개 + 크레딧 ----
const ALIGO = {
  ALIGO_API_KEY: "APIKEY", ALIGO_USER_ID: "USERID",
  ALIGO_SENDER_KEY: "SENDERKEY", ALIGO_SENDER: "0212345678",
  PUBLIC_ORIGIN: BASE,
};
const env = makeEnv(ALIGO);
const db = env.DB;
const CODES = {};
for (const [kind, t] of Object.entries(N.TEMPLATES)) {
  CODES[kind] = "TPL_" + kind.toUpperCase();
  await D.setSetting(db, t.key, CODES[kind]);
}
await D.setSetting(db, "esign_otp", "1"); // 본인확인 켠 상태로 검증한다
const assoc = await D.createAssociation(db, { slug: "law", name: "한빛법무법인", kind: "esign" });
const pw = await hashPassword("pass1234");
const admin = await D.createUser(db, { email: "law@a.kr", passwordHash: pw.hash, salt: pw.salt, name: "김담당", role: "ADMIN", associationId: assoc.id });
await D.addCredit(db, assoc.id, 100000);
const unitPrice = await N.priceOf(db, "alimtalk", assoc.id);

const f = (p, init) => worker.fetch(new Request(BASE + p, init), env, { waitUntil() {}, passThroughOnException() {} });
async function login() {
  const g = await f("/login");
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const lr = await f("/login", { method: "POST", headers: { cookie: seed, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: tk, email: "law@a.kr", password: "pass1234" }) });
  return [seed, ...(lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");
}
const jar = await login();
const csrfOf = async (p) => (/name="_csrf" value="([^"]+)"/.exec(await (await f(p, { headers: { cookie: jar } })).text()) || [])[1];

console.log("\n① 계약서를 만들면 상대방에게 서명 요청이 나가는가");
const balBefore = await D.getBalance(db, assoc.id);
const newCsrf = await csrfOf("/t/law/admin/documents/new?tpl=b-lease");
const created = await f("/t/law/admin/documents", { method: "POST",
  headers: { cookie: jar, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ _csrf: newCsrf, template: "b-lease", title: "○○상가 임대차계약",
    var_임대인: "김갑", var_임차인: "이을", due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), // 내일 — 재알림이 도는 구간(기한 2일 전부터)
    party_0: "ext", ext_name_0: "김갑", ext_phone_0: "010-1111-2222",
    party_1: "ext", ext_name_1: "이을", ext_phone_1: "010-3333-4444" }) });
ok(created.status === 303, "계약서가 만들어짐");
const doc = (await D.listDocuments(db, assoc.id))[0];
const ext = await D.listExternalSigners(db, doc.id);
ok(ext.length === 2, "상대방 2명이 서명자로 등록됨", ext.map((e) => e.name).join(", "));

const reqs = sent.filter((s) => s.tpl_code === CODES.sign_request);
ok(reqs.length === 2, `서명 요청이 2통 나감 (실제 ${reqs.length}통)`);
for (const [i, e] of ext.entries()) {
  const s = reqs.find((x) => x.receiver_1 === e.phone);
  ok(!!s, `${e.name} 님 번호로 나감`, e.phone);
  if (!s) continue;
  ok(s.sender === ALIGO.ALIGO_SENDER, "발신번호가 등록한 번호와 같음", s.sender);
  ok(s.senderkey === ALIGO.ALIGO_SENDER_KEY, "발신프로필 키가 실림");
  // 알림톡은 심사받은 문구와 글자까지 같아야 한다 — 여기서 한 글자만 달라도 카카오가 거절한다
  const expect = N.renderTemplate("sign_request", { 상호: assoc.name, 이름: e.name, 문서명: doc.title, 기한: doc.due_date || "미지정" });
  ok(s.message_1 === expect, "문구가 심사 원문과 정확히 같음");
  ok(s.failover === "Y", "카톡 못 받는 사람에겐 문자로 대체 발송");
  // 버튼 링크가 진짜 열리는 주소여야 한다 — 여기가 틀리면 상대방은 링크를 눌러도 아무것도 못 본다
  const btn = JSON.parse(s.button_1 || "{}").button?.[0];
  ok(!!btn && /^https:\/\/[^ ]+\/esign\/[\w.-]+$/.test(btn.linkMo), "버튼이 서명 링크를 가리킴", btn ? btn.linkMo.replace(BASE, "") : "(없음)");
  if (btn) {
    const open = await f(btn.linkMo.replace(BASE, ""));
    ok(open.status === 200, "그 링크가 실제로 열림", `HTTP ${open.status}`);
    const html = await open.text();
    ok(html.includes(e.name) && html.includes(doc.title), "열린 화면에 본인 이름과 계약서 제목이 보임");
  }
}
const spent1 = balBefore - (await D.getBalance(db, assoc.id));
ok(spent1 === unitPrice * 2, `크레딧이 정확히 2통분 깎임 (${spent1}원 = ${unitPrice}원 × 2)`);

console.log("\n② 본인확인 번호가 OTP 전용 템플릿으로 나가는가");
const token = await makeExtToken(env.SESSION_SECRET, ext[0].id, doc.id);
const page = await f(`/esign/${token}`);
const pageHtml = await page.text();
const extCsrf = (/name="_csrf" value="([^"]+)"/.exec(pageHtml) || [])[1];
const seed2 = (page.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
sent.length = 0;
await f(`/esign/${token}/otp`, { method: "POST", headers: { cookie: seed2, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ _csrf: extCsrf }) });
const otp = sent.find((s) => s.tpl_code === CODES.sign_otp);
ok(!!otp, "본인확인이 OTP 전용 템플릿으로 나감");
if (otp) {
  ok(otp.receiver_1 === ext[0].phone, "본인 번호로만 나감");
  const code = /인증번호는 (\d{6}) 입니다/.exec(otp.message_1 || "");
  ok(!!code, "6자리 인증번호가 문구에 들어 있음", code ? code[1] : "(못 찾음)");
  ok(!otp.button_1, "인증번호 알림에는 버튼이 없음 (심사 원문 그대로)");
  ok(otp.message_1 === N.renderTemplate("sign_otp", { 상호: assoc.name, 인증번호: code ? code[1] : "", 유효시간: String(D.OTP_TTL_MIN) }),
    "OTP 문구가 심사 원문과 정확히 같음");
}

console.log("\n③ 서명이 끝나면 완료 안내가 나가는가");
sent.length = 0;
// 본인확인을 통과시킨 뒤 서명한다 (실제 사람이 하는 순서 그대로)
const codeVal = (/인증번호는 (\d{6}) 입니다/.exec(otp?.message_1 || "") || [])[1];
await f(`/esign/${token}/otp/verify`, { method: "POST", headers: { cookie: seed2, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ _csrf: extCsrf, code: codeVal || "000000" }) });
// 실제 사람이 화면에서 채우는 것과 같은 값을 만든다 — 서명/도장은 PNG, 나머지는 글자.
// 1×1 투명 PNG (data URL) — 그림 내용은 이 리허설의 관심사가 아니다.
const PNG1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const myFields = (await D.listFields(db, doc.id)).filter((x) => x.assignee === -ext[0].id || x.assignee === 0);
const filled = {};
for (const fl of myFields) {
  filled[String(fl.id)] = fl.kind === "sign" || fl.kind === "stamp" ? { image: PNG1 }
    : fl.kind === "check" ? { value: "1" }
    : fl.kind === "date" ? { value: new Date().toISOString().slice(0, 10) }
    : { value: ext[0].name };
}
ok(myFields.length > 0, `이 사람이 채울 자리가 ${myFields.length}개 배정돼 있음`);
const signRes = await f(`/esign/${token}`, { method: "POST", headers: { cookie: seed2, origin: BASE, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ _csrf: extCsrf, name: ext[0].name, consent: "1", fields: JSON.stringify(filled) }) });
ok(signRes.status === 303, "서명이 접수됨", decodeURIComponent(signRes.headers.get("location") || "").slice(0, 160));
const sigs = await D.listSignatures(db, doc.id);
ok(sigs.length === 1, "서명이 1건 기록됨");
const done = sent.find((s) => s.tpl_code === CODES.sign_done);
ok(!!done, "완료 안내가 완료 전용 템플릿으로 나감");
if (done) {
  const btn = JSON.parse(done.button_1 || "{}").button?.[0];
  ok(!!btn && /\/certificate\/[0-9a-f]{8,}$/.test(btn.linkMo), "버튼이 확인서를 가리킴", btn ? btn.linkMo.replace(BASE, "") : "(없음)");
  if (btn) {
    const v = await f(btn.linkMo.replace(BASE, ""));
    ok(v.status === 200, "받은 사람이 그 링크로 확인서를 볼 수 있음", `HTTP ${v.status}`);
  }
}

console.log("\n④ 기한이 다가오면 재알림이 나가는가 (매일 아침 크론)");
sent.length = 0;
// scheduled() 는 일을 waitUntil 로 넘기고 곧장 돌아온다 — 그 약속을 붙잡아 끝까지 기다린다.
// (이걸 안 기다리면 "재알림이 안 나갔다"는 잘못된 결론이 난다. 실제로 한 번 속았다.)
const bg = [];
await worker.scheduled({ cron: CRON.daily }, env, { waitUntil: (p) => bg.push(p) });
await Promise.all(bg);
const remind = sent.filter((s) => s.tpl_code === CODES.sign_remind);
ok(remind.length === 1, `아직 서명 안 한 1명에게만 재알림 (실제 ${remind.length}통)`);
if (remind[0]) {
  ok(remind[0].receiver_1 === ext[1].phone, "서명을 마친 사람에겐 다시 보내지 않음", remind[0].receiver_1);
  ok(remind[0].message_1 === N.renderTemplate("sign_remind",
    { 상호: assoc.name, 이름: ext[1].name, 문서명: doc.title, 기한: doc.due_date || "미지정" }),
    "재알림 문구가 심사 원문과 정확히 같음");
}

console.log("\n⑤ 돈이 맞는가");
const month = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
const row = (await D.monthlySettlement(db, month)).find((r) => r.id === assoc.id) || { sent: 0, revenue: 0 };
const totalSent = row.sent;
ok(totalSent === 5, `발송 5통이 정산에 잡힘 (요청2 + OTP1 + 완료1 + 재알림1 · 실제 ${totalSent}통)`);
ok(row.revenue === unitPrice * 5, `매출이 ${unitPrice * 5}원 (${unitPrice}원 × 5)`, `실제 ${row.revenue}원`);
const logs = await D.listMessages(db, assoc.id, 50);
ok(logs.every((l) => !/\d{7,}/.test(l.recipient)), "발송 이력에 전화번호가 통째로 남지 않음(가림 처리)");

console.log("\n⑥ 잔액이 없으면 어떻게 되는가");
sent.length = 0;
const drain = await D.getBalance(db, assoc.id);
await D.spendCredit(db, assoc.id, drain, "리허설: 잔액 소진");
const r2 = await N.sendOne(env, db, { assoc, kind: "sign_request", to: "01055556666", text: "t" });
ok(r2.ok === false && r2.insufficient, "잔액이 없으면 발송을 시도하지 않음");
ok(sent.length === 0, "제공사에 요청 자체를 보내지 않음 (헛돈이 나가지 않음)");
const failLog = (await D.listMessages(db, assoc.id, 5))[0];
ok(failLog && /잔액/.test(failLog.detail || ""), "왜 못 보냈는지 이력에 남음", failLog ? failLog.detail : "");

globalThis.fetch = realFetch;
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail) process.exit(1);
