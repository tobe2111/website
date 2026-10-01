// 간편동의서 — 링크 하나로 여러 명에게 동의받기.
//
// 새 상인회를 열면 닭과 달걀이 생긴다. 점포 명단을 만들려면 개인정보 동의를 받아야 하는데,
// 동의를 받으려면 누구에게 보낼지 명단이 먼저 있어야 한다.
//
// 전자계약(documents)으로는 이 고리를 못 끊는다 — 받는 사람을 한 명씩 미리 등록해야
// 링크가 나오기 때문이다. 그래서 반대로 만든다: 링크 하나를 단톡방에 뿌리면
// 사장님이 열어서 자기 상호·이름·연락처를 적고 동의·서명한다.
//
// 이 화면에서 가장 중요한 것은 **증거**다. 분쟁에서 필요한 것은 "동의를 받았다" 가 아니라
// "이 사람이 이 문구에 이 시각에 동의했다" 이다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword, sha256Hex } from "../src/crypto.js";

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
// 1×1 투명 PNG — 서명 그림 자리를 채운다
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const BODY = "본인은 상인회에 가입을 신청하며 개인정보 수집·이용에 동의합니다.";

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "방배카페골목상인회", kind: "merchant" });
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const f = await D.createConsentForm(env.DB, { associationId: a.id, token: "abc123token", title: "가입 동의서", body: BODY, askAddress: 1 });
  return { a, f };
}
const login = async (env) => { const j = jar(); await post(env, j, "/login", { login: "ad@s.kr", password: "pass1234" }); return j; };
const FILL = { biz_name: "방배 커피", name: "김사장", phone: "010-1234-5678", category: "카페·디저트",
  address: "서울 서초구 방배로 42", agree: "1", signature: PNG };

test("사전 등록 없이, 링크만 받은 사장님이 동의를 보낸다", async () => {
  const env = makeEnv(); const { a, f } = await seed(env);
  const r = await post(env, jar(), "/t/seocho/consent/abc123token", FILL);
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);

  const rows = await D.listConsents(env.DB, a.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].biz_name, "방배 커피");
  assert.equal(rows[0].name, "김사장");
  assert.equal(rows[0].phone, "01012345678");
  assert.equal(rows[0].status, "new");
  assert.equal(rows[0].form_id, f.id);
});

test("동의한 그 순간의 문구 지문이 남는다 — 나중에 문구를 고쳐도 흔들리지 않는다", async () => {
  const env = makeEnv(); const { a, f } = await seed(env);
  await post(env, jar(), "/t/seocho/consent/abc123token", FILL);
  const before = (await D.listConsents(env.DB, a.id))[0];
  assert.equal(before.body_hash, await sha256Hex(BODY));

  // 상인회가 나중에 문구를 고친다
  await D.updateConsentForm(env.DB, f.id, a.id, { title: "가입 동의서", body: "완전히 다른 문구", askAddress: 1 });
  const after = (await D.listConsents(env.DB, a.id))[0];
  assert.equal(after.body_hash, before.body_hash, "이미 받은 동의의 지문이 바뀌면 증거가 아니다");
});

test("동의 시각·IP·서명 그림이 함께 남는다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  await post(env, jar(), "/t/seocho/consent/abc123token", FILL);
  const c = (await D.listConsents(env.DB, a.id))[0];
  assert.ok(c.created_at, "받은 시각");
  assert.ok(c.signature, "서명 그림이 저장돼야 한다");
  assert.ok("ip" in c, "어디서 왔는지");
});

test("동의 체크를 안 하면 받지 않는다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const r = await post(env, jar(), "/t/seocho/consent/abc123token", { ...FILL, agree: "" });
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.equal((await D.listConsents(env.DB, a.id)).length, 0);
});

test("서명을 안 하면 받지 않는다 — 체크만으로는 동의서가 아니다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const r = await post(env, jar(), "/t/seocho/consent/abc123token", { ...FILL, signature: "" });
  assert.match(decodeURIComponent(r.headers.get("location") || ""), /서명을 입력/);
  assert.equal((await D.listConsents(env.DB, a.id)).length, 0);
});

test("상호·성함·번호가 비거나 번호 꼴이 틀리면 받지 않는다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  for (const bad of [{ biz_name: "" }, { name: "" }, { phone: "" }, { phone: "123" }]) {
    const r = await post(env, jar(), "/t/seocho/consent/abc123token", { ...FILL, ...bad });
    assert.match(r.headers.get("location") || "", /err=1/, JSON.stringify(bad));
  }
  assert.equal((await D.listConsents(env.DB, a.id)).length, 0);
});

test("두 번 눌러도 두 줄이 되지 않는다 (사장님은 눌렸나 싶으면 또 누른다)", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  await post(env, jar(), "/t/seocho/consent/abc123token", FILL);
  const r = await post(env, jar(), "/t/seocho/consent/abc123token", FILL);
  assert.match(decodeURIComponent(r.headers.get("location") || ""), /이미 제출/);
  assert.equal((await D.listConsents(env.DB, a.id)).length, 1);
});

test("링크를 닫으면 더는 못 보낸다 — 다만 404 로 내치지 않는다", async () => {
  const env = makeEnv(); const { a, f } = await seed(env);
  // 사장님이 링크를 열어 둔 채로 있는 사이에 총무가 접수를 닫는 상황.
  // 그래서 표(token)는 열려 있을 때 받아 두고, 닫은 뒤에 보낸다.
  const j = jar();
  const token = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/seocho/consent/abc123token")).text()) || [])[1];
  await D.setConsentFormEnabled(env.DB, f.id, a.id, 0);

  const page = await get(env, jar(), "/t/seocho/consent/abc123token");
  assert.equal(page.status, 200, "사장님이 자기가 잘못 눌렀다고 생각하면 안 된다");
  assert.match(await page.text(), /지금은 동의서를 받지 않습니다/);

  const r = await worker.fetch(new Request(B + "/t/seocho/consent/abc123token", { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: token, ...FILL }).toString() }), env);
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.equal((await D.listConsents(env.DB, a.id)).length, 0);
});

test("옆 상인회 주소에 우리 토큰을 붙여도 안 열린다 (테넌트 격리)", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const other = await D.createAssociation(env.DB, { slug: "other", name: "다른상인회", kind: "merchant" });
  assert.equal((await get(env, jar(), "/t/other/consent/abc123token")).status, 404);

  // 표는 우리 상인회 화면에서 받아 두고, 남의 주소에 그 토큰을 붙여 보낸다.
  const j = jar();
  const token = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/seocho/consent/abc123token")).text()) || [])[1];
  const r = await worker.fetch(new Request(B + "/t/other/consent/abc123token", { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: token, ...FILL }).toString() }), env);
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.equal((await D.listConsents(env.DB, other.id)).length, 0);
  assert.equal((await D.listConsents(env.DB, a.id)).length, 0, "우리 쪽에도 들어가면 안 된다");
});

test("없는 토큰은 404", async () => {
  const env = makeEnv(); await seed(env);
  assert.equal((await get(env, jar(), "/t/seocho/consent/nope")).status, 404);
});

test("공개 동의서 화면은 검색엔진에 올리지 않는다", async () => {
  const env = makeEnv(); await seed(env);
  const html = await (await get(env, jar(), "/t/seocho/consent/abc123token")).text();
  assert.match(html, /name="robots" content="noindex/);
  assert.match(html, /가입 동의서/);
  assert.match(html, /개인정보 수집·이용에 동의합니다/, "동의 문구가 화면에 그대로 보여야 한다");
  assert.match(html, /signPad/, "서명 칸이 있어야 한다");
});

test("[점포로 등록] 한 번이면 가게가 열린다 — 회장님이 다시 칠 것이 없다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  await post(env, jar(), "/t/seocho/consent/abc123token", FILL);
  const c = (await D.listConsents(env.DB, a.id))[0];

  const j = await login(env);
  await post(env, j, `/t/seocho/admin/consent/${c.id}/approve`, {}, "/t/seocho/admin");

  const after = await D.getConsent(env.DB, c.id, a.id);
  assert.equal(after.status, "approved");
  assert.ok(after.business_id, "만들어진 점포가 연결돼야");

  const biz = await D.getBusinessById(env.DB, after.business_id);
  assert.equal(biz.name, "방배 커피");
  assert.equal(biz.status, "approved", "승인했으면 그 자리에서 공개된다");
  assert.equal(biz.address, "서울 서초구 방배로 42", "사장님이 적어 준 주소가 그대로 들어가야");

  const owner = await D.getUserById(env.DB, biz.owner_id);
  assert.equal(owner.name, "김사장");
  assert.equal(owner.phone, "01012345678", "번호가 곧 로그인 아이디가 된다");
});

test("이메일이 없어도 승인된다 (사장님 절반은 이메일이 없다)", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  await post(env, jar(), "/t/seocho/consent/abc123token", { ...FILL, email: "" });
  const c = (await D.listConsents(env.DB, a.id))[0];
  const j = await login(env);
  await post(env, j, `/t/seocho/admin/consent/${c.id}/approve`, {}, "/t/seocho/admin");
  assert.equal((await D.getConsent(env.DB, c.id, a.id)).status, "approved");
});

test("두 번 승인해도 가게가 두 개 생기지 않는다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  await post(env, jar(), "/t/seocho/consent/abc123token", FILL);
  const c = (await D.listConsents(env.DB, a.id))[0];
  const j = await login(env);
  await post(env, j, `/t/seocho/admin/consent/${c.id}/approve`, {}, "/t/seocho/admin");
  await post(env, j, `/t/seocho/admin/consent/${c.id}/approve`, {}, "/t/seocho/admin");
  assert.equal((await D.listAllBusinesses(env.DB, a.id)).length, 1);
});

test("반려해도 동의 기록 자체는 남는다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  await post(env, jar(), "/t/seocho/consent/abc123token", FILL);
  const c = (await D.listConsents(env.DB, a.id))[0];
  const j = await login(env);
  await post(env, j, `/t/seocho/admin/consent/${c.id}/reject`, {}, "/t/seocho/admin");
  const after = await D.getConsent(env.DB, c.id, a.id);
  assert.equal(after.status, "rejected");
  assert.ok(after.body_hash, "동의를 받은 사실은 지우지 않는다");
  assert.equal((await D.listAllBusinesses(env.DB, a.id)).length, 0);
});

test("받아 둔 동의가 있으면 양식을 지울 수 없다", async () => {
  const env = makeEnv(); const { a, f } = await seed(env);
  await post(env, jar(), "/t/seocho/consent/abc123token", FILL);
  const j = await login(env);
  const r = await post(env, j, `/t/seocho/admin/consent-form/${f.id}/delete`, {}, "/t/seocho/admin");
  assert.match(decodeURIComponent(r.headers.get("location") || ""), /지울 수 없습니다/);
  assert.ok(await D.getConsentForm(env.DB, f.id, a.id), "양식이 남아 있어야 한다");
});

test("회원·비회원은 남의 동의를 승인하거나 양식을 고칠 수 없다", async () => {
  const env = makeEnv(); const { a, f } = await seed(env);
  await post(env, jar(), "/t/seocho/consent/abc123token", FILL);
  const c = (await D.listConsents(env.DB, a.id))[0];
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "m@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회원", role: "MERCHANT", associationId: a.id });
  const j = jar();
  await post(env, j, "/login", { login: "m@s.kr", password: "pass1234" });

  await post(env, j, `/t/seocho/admin/consent/${c.id}/approve`, {}, "/t/seocho/");
  await post(env, j, `/t/seocho/admin/consent-form/${f.id}`, { title: "가로챔", body: "x" }, "/t/seocho/");
  assert.equal((await D.getConsent(env.DB, c.id, a.id)).status, "new");
  assert.equal((await D.getConsentForm(env.DB, f.id, a.id)).title, "가입 동의서");
});

test("관리 화면에 링크와 들어온 명단이 함께 뜬다", async () => {
  const env = makeEnv(); await seed(env);
  await post(env, jar(), "/t/seocho/consent/abc123token", FILL);
  const j = await login(env);
  const html = await (await get(env, j, "/t/seocho/admin")).text();
  assert.match(html, /간편동의서/);
  assert.match(html, /abc123token/, "뿌릴 주소가 보여야 한다");
  assert.match(html, /방배 커피/, "들어온 동의가 명단에 떠야 한다");
  assert.match(html, /점포로 등록/);
});

test("명단 CSV 에 동의 시각과 문구 지문이 함께 나간다", async () => {
  const env = makeEnv(); await seed(env);
  await post(env, jar(), "/t/seocho/consent/abc123token", FILL);
  const j = await login(env);
  const r = await get(env, j, "/t/seocho/admin/consents.csv");
  assert.equal(r.status, 200);
  const buf = new Uint8Array(await r.clone().arrayBuffer());
  assert.deepEqual([...buf.slice(0, 3)], [0xef, 0xbb, 0xbf], "엑셀이 한글을 깨뜨리지 않게 BOM");
  const csv = await r.text();
  assert.match(csv, /방배 커피/);
  assert.match(csv, /동의 시각/);
  assert.match(csv, /문구 지문/);
});

test("새 상인회를 열면 간편동의서가 링크까지 열린 채로 들어 있다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "new", name: "새상인회", kind: "merchant" });
  const { seedStarter } = await import("../src/starterContent.js");
  const r = await seedStarter(env, env.DB, a, { createdBy: null });
  assert.equal(r.consentForms, 1);
  const forms = await D.listConsentForms(env.DB, a.id);
  assert.equal(forms.length, 1);
  assert.equal(forms[0].enabled, 1, "열어 둔 채로 넘겨 줘야 바로 뿌릴 수 있다");
  assert.ok(forms[0].token.length >= 20, "주소는 추측할 수 없어야 한다");
  assert.match(forms[0].body, /새상인회/, "그 상인회 이름이 문구에 들어가야");
});

test("두 번 실행해도 동의서가 두 개 생기지 않는다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "new", name: "새상인회", kind: "merchant" });
  const { seedStarter } = await import("../src/starterContent.js");
  await seedStarter(env, env.DB, a, { createdBy: null });
  const r2 = await seedStarter(env, env.DB, a, { createdBy: null });
  assert.equal(r2.consentForms, 0);
  assert.ok(r2.skipped.includes("간편동의서"));
  assert.equal((await D.listConsentForms(env.DB, a.id)).length, 1);
});

test("동의 기록은 백업 대상이다 (사고로 날리면 '동의를 받았다' 를 증명할 수 없다)", async () => {
  const { TABLES } = await import("../src/scheduled.js");
  assert.ok(TABLES.includes("consents"));
  assert.ok(TABLES.includes("consent_forms"));
});

// ── 상인회 복제 ────────────────────────────────────────────────────────────
//
// "잘 만들어 둔 사이트를 본으로 삼아 새 고객사를 찍어 낸다" 가 이 제품이 장사가 되는 이유다.
// 그런데 복제본이 빈손으로 열리면 새 상인회는 처음부터 다시 쓰기 시작해야 하고, 그러면
// 아무도 안 쓴다. 껍데기만이 아니라 **바로 쓸 수 있는 틀**이 따라와야 한다.
test("복제하면 서식과 간편동의서 양식이 따라온다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  await D.createTemplate(env.DB, { associationId: a.id, title: "우리 상가 표준 임대차",
    summary: "", body: "제1조 …", fields: "[]", parties: "[]", ordered: 0, createdBy: null });

  const made = await D.cloneAssociation(env.DB, a.id, { slug: "copy", name: "복제상인회" });
  assert.ok(made);

  const tpls = await D.listTemplates(env.DB, made.id);
  assert.ok(tpls.some((t) => t.title === "우리 상가 표준 임대차"), "서식이 따라와야 한다");

  const forms = await D.listConsentForms(env.DB, made.id);
  assert.equal(forms.length, 1);
  assert.equal(forms[0].title, "가입 동의서");
  assert.notEqual(forms[0].token, "abc123token",
    "주소를 물려주면 원본에 뿌려 둔 링크가 복제본으로도 열린다");
});

test("복제본에 남의 상인회 사장님 동의는 따라오지 않는다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  await post(env, jar(), "/t/seocho/consent/abc123token", FILL);
  assert.equal((await D.listConsents(env.DB, a.id)).length, 1);

  const made = await D.cloneAssociation(env.DB, a.id, { slug: "copy", name: "복제상인회" });
  assert.equal((await D.listConsents(env.DB, made.id)).length, 0, "남의 개인정보다");
});

test("뿌릴 주소는 늘 절대 주소다 — 상대 주소 QR 은 비춰도 아무 데도 안 간다", async () => {
  // PUBLIC_ORIGIN 을 안 정해 둔 배포에서도 QR 이 동작해야 한다.
  // 예전에는 여기서 "/t/seocho/consent/…" 가 QR 에 들어갔는데, 화면에는 멀쩡한 QR 이
  // 그려지므로 아무도 눈치채지 못한다 — 종이를 다 붙인 뒤에야 안다.
  const env = makeEnv(); const { f } = await seed(env);
  const j = await login(env);

  const admin = await (await get(env, j, "/t/seocho/admin")).text();
  assert.match(admin, /http:\/\/localhost\/t\/seocho\/consent\/abc123token/, "관리 화면의 복사용 주소");

  const qr = await (await get(env, j, `/t/seocho/admin/consent-form/${f.id}/qr`)).text();
  assert.match(qr, /data-url="http:\/\/localhost\/t\/seocho\/consent\/abc123token"/, "QR 에 실리는 주소");
});

test("운영사가 사이트 주소를 정해 뒀으면 그 주소를 쓴다", async () => {
  const env = makeEnv({ PUBLIC_ORIGIN: "https://bangbae.kr" });
  const { f } = await seed(env);
  const j = await login(env);
  const qr = await (await get(env, j, `/t/seocho/admin/consent-form/${f.id}/qr`)).text();
  assert.match(qr, /data-url="https:\/\/bangbae\.kr\/t\/seocho\/consent\/abc123token"/);
});
