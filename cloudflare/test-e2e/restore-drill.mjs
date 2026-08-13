// 백업 복원 리허설 — 실제로 되돌려 본다.
//   ① 운영과 비슷하게 데이터를 채우고  ② 주간 크론으로 암호화 백업을 만들고
//   ③ decrypt-backup 으로 풀고  ④ restore-backup 으로 SQL 을 만들어
//   ⑤ 빈 DB 에 부은 다음  ⑥ 계약·서명이 그대로 검증되는지 확인한다.
// 복원해 본 적 없는 백업은 백업이 아니다. 이 스크립트가 그 확인을 대신한다.
//   실행: npm run test:restore
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = (await import(path.join(ROOT, "src/index.js"))).default;
const { CRON } = await import(path.join(ROOT, "src/scheduled.js"));
const { makeEnv } = await import(path.join(ROOT, "test/shim.js"));
const D = await import(path.join(ROOT, "src/db.js"));
const E = await import(path.join(ROOT, "src/esign.js"));
const { hashPassword } = await import(path.join(ROOT, "src/crypto.js"));
const { makeExtToken } = await import(path.join(ROOT, "src/extsign.js"));

globalThis.fetch = async () => new Response("ok");
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ✓", n, x); } else { fail++; console.error("  ✗", n, x); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "restore-drill-"));

console.log("═══ 백업 복원 리허설 ═══\n");

// ── ① 운영과 비슷한 데이터
const SECRET = "test-secret-cf";
const env = makeEnv({ PUBLIC_ORIGIN: "https://x.kr" });
const h = await hashPassword("password1234");
const seocho = await D.createAssociation(env.DB, { slug: "seochogu", name: "서초구 상인회" });
const hanbit = await D.createAssociation(env.DB, { slug: "hanbit", name: "한빛법무법인", kind: "esign" });
const admin = await D.createUser(env.DB, { email: "a@s.kr", passwordHash: h.hash, salt: h.salt, name: "관리자", role: "ADMIN", associationId: seocho.id });
const owner = await D.createUser(env.DB, { email: "o@s.kr", passwordHash: h.hash, salt: h.salt, name: "김사장", role: "MERCHANT", associationId: seocho.id });
const biz = await D.createBusiness(env.DB, { associationId: seocho.id, ownerId: owner.id, name: "홍가네분식", category: "음식점" });
await D.setBusinessStatus(env.DB, biz.id, "approved");
await D.createNotice(env.DB, { associationId: seocho.id, title: "정기총회", body: "3월 5일", createdBy: admin.id });
await D.addSlugAlias(env.DB, "서초구-상인회", seocho.id);
await D.addCredit(env.DB, hanbit.id, 50000);

// 계약 2건 — 회원 서명 1, 외부 서명 1 (사슬이 이어져야 한다)
const mk = async (assocId, title, body) => D.createDocument(env.DB, { associationId: assocId, title, body,
  contentHash: await E.contentHash(body), createdBy: admin.id, ordered: 0, dueDate: "" });
const d1 = await mk(seocho.id, "2026 회칙 동의서", "제1조 회칙에 동의한다.");
await D.createSignatureRequests(env.DB, d1.id, [owner.id]);
const d2 = await mk(hanbit.id, "임대차계약서", "제1조 목적물 …");
const ext = await D.addExternalSigner(env.DB, { documentId: d2.id, name: "최임차", email: "t@x.kr", signOrder: 1 });
await D.replaceFields(env.DB, d2.id, [
  { kind: "text", label: "보증금", page: 0, x: 0.1, y: 0.2, w: 0.2, h: 0.03, assignee: -ext.id, required: 1 },
  { kind: "sign", label: "서명", page: 0, x: 0.6, y: 0.8, w: 0.2, h: 0.06, assignee: -ext.id, required: 1 },
]);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const BASE = "http://localhost";
const jarOf = (r) => (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
async function post(p, jar, body) {
  return worker.fetch(new Request(BASE + p, { method: "POST", redirect: "manual",
    headers: { cookie: jar, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString() }), env, { waitUntil() {}, passThroughOnException() {} });
}
// 외부 서명 (필드까지 채워 fieldsHash 가 걸리게)
const tok = await makeExtToken(env.SESSION_SECRET, ext.id, d2.id);
const g = await worker.fetch(new Request(BASE + `/esign/${tok}`), env, { waitUntil() {}, passThroughOnException() {} });
const gh = await g.text();
const jar = jarOf(g);
const csrf = (/name="_csrf" value="([^"]+)"/.exec(gh) || [])[1];
const fields = await D.listFields(env.DB, d2.id);
await post(`/esign/${tok}`, jar, { _csrf: csrf, consent: "1", signature: PNG, signer_name: "최임차",
  fields: JSON.stringify({ [fields[0].id]: { value: "50,000,000" }, [fields[1].id]: { image: PNG } }) });
// 회원 서명
const lg = await worker.fetch(new Request(BASE + "/login"), env, { waitUntil() {}, passThroughOnException() {} });
const lj = jarOf(lg);
const lc = (/name="_csrf" value="([^"]+)"/.exec(await lg.text()) || [])[1];
const lr = await post("/login", lj, { _csrf: lc, email: "o@s.kr", password: "password1234" });
const ojar = [lj, jarOf(lr)].filter(Boolean).join("; ");
const sf = await worker.fetch(new Request(BASE + `/t/seochogu/sign/${d1.id}`, { headers: { cookie: ojar } }), env, { waitUntil() {}, passThroughOnException() {} });
const sc = (/name="_csrf" value="([^"]+)"/.exec(await sf.text()) || [])[1];
await post(`/t/seochogu/sign/${d1.id}`, ojar, { _csrf: sc, consent: "1", signer_name: "김사장", signature: PNG });

const before = {
  sigs: await D.listSignatures(env.DB, d1.id).then((a) => a.length) + (await D.listSignatures(env.DB, d2.id)).length,
  chain: E.verifyChain(await D.listSignatureChain(env.DB)),
  balance: await D.getBalance(env.DB, hanbit.id),
  head: await D.lastSealHash(env.DB),
};
ok(before.sigs === 2 && before.chain.ok, "원본 준비 — 서명 2건, 사슬 정상", `잔액 ${before.balance.toLocaleString()}원`);

// ── ② 주간 크론으로 백업
await worker.scheduled({ cron: CRON.weekly }, env, { waitUntil: (p) => p });
await new Promise((r) => setTimeout(r, 80));
const keys = [...env.MEDIA._store.keys()].filter((k) => k.endsWith(".json.enc"));
ok(keys.length === 1, "주간 크론이 암호화 백업을 남김", keys[0] || "(없음)");
const encBuf = env.MEDIA._store.get(keys[0]).body;
const encPath = path.join(tmp, "backup.json.enc");
fs.writeFileSync(encPath, encBuf);
ok(encBuf.length > 500, "백업 파일 크기", `${(encBuf.length / 1024).toFixed(1)}KB (암호문)`);
// 평문이 새어 있지 않은지 — 암호화가 실제로 걸렸는가
ok(!encBuf.includes(Buffer.from("서초구 상인회")), "암호문에 원문이 보이지 않음");

// ── ③ 실제 스크립트로 복호화
const jsonPath = path.join(tmp, "dump.json");
const plain = execFileSync("node", [path.join(ROOT, "scripts/decrypt-backup.mjs"), encPath, SECRET], { maxBuffer: 64 << 20 });
fs.writeFileSync(jsonPath, plain);
const dump = JSON.parse(plain.toString());
ok(!!dump.tables && dump.tables.associations?.length === 2, "복호화 성공", `표 ${Object.keys(dump.tables).length}개`);
const emptyTables = Object.entries(dump.tables).filter(([, v]) => v === null).map(([k]) => k);
ok(emptyTables.length === 0, "모든 표가 덤프됨", emptyTables.length ? `누락: ${emptyTables.join(", ")}` : "");
const need = ["documents", "signatures", "doc_fields", "doc_field_values", "external_signers",
  "slug_aliases", "credit_ledger", "credit_orders"];
const gone = need.filter((t) => !(t in dump.tables));
ok(gone.length === 0, "계약·돈·주소 복원에 필요한 표가 모두 백업됨", gone.length ? `빠짐: ${gone.join(", ")}` : `${need.length}개 확인`);

// ── ④ 복원 SQL 생성
const sqlPath = path.join(tmp, "restore.sql");
const sql = execFileSync("node", [path.join(ROOT, "scripts/restore-backup.mjs"), jsonPath], { maxBuffer: 64 << 20 });
fs.writeFileSync(sqlPath, sql);
ok(sql.length > 500 && /INSERT INTO associations/.test(sql.toString()), "복원 SQL 생성", `${(sql.length / 1024).toFixed(1)}KB`);

// ── ⑤ 빈 DB 에 붓는다
const fresh = makeEnv({ PUBLIC_ORIGIN: "https://x.kr" }); // 스키마만 있는 새 DB
// 주석 줄을 먼저 걷어낸 뒤 문장을 자른다 (wrangler 는 알아서 하지만 여기선 직접)
const bare = sql.toString().split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const statements = bare.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
let applied = 0, errs = [];
for (const s of statements) {
  try { fresh.DB._db.exec(s + ";"); applied++; }
  catch (e) { errs.push(`${s.slice(0, 60)}… → ${e.message}`); }
}
ok(errs.length === 0, "복원 SQL 이 오류 없이 적용됨", errs.length ? `${errs.length}건 실패: ${errs[0]}` : `${applied}개 문장`);

// ── ⑥ 되살아났는가
const rAssocs = await D.listAllAssociations(fresh.DB);
ok(rAssocs.length === 2 && rAssocs.some((a) => a.slug === "seochogu") && rAssocs.some((a) => a.kind === "esign"),
  "조직 복원", rAssocs.map((a) => `${a.slug}(${a.kind})`).join(", "));
ok((await D.getBusinessByOwner(fresh.DB, owner.id))?.name === "홍가네분식", "점포 복원");
ok((await D.getAssociationByAlias(fresh.DB, "서초구-상인회"))?.id === seocho.id, "옛 주소 alias 복원 — 나간 링크가 계속 산다");
ok((await D.getBalance(fresh.DB, hanbit.id)) === before.balance, "크레딧 잔액 복원", `${(await D.getBalance(fresh.DB, hanbit.id)).toLocaleString()}원`);

const rChain = E.verifyChain(await D.listSignatureChain(fresh.DB));
ok(rChain.ok && rChain.length === before.chain.length, "서명 사슬이 그대로 이어짐", `${rChain.length}건`);
ok((await D.lastSealHash(fresh.DB)) === before.head, "사슬 머리 해시 일치");

// 가장 중요한 것 — 복원한 DB 에서 서명이 여전히 유효한가
let allValid = true, detail = [];
for (const docId of [d1.id, d2.id]) {
  const doc = await D.getDocument(fresh.DB, docId);
  for (const s of await D.listSignatures(fresh.DB, docId)) {
    const v = await E.verifySignature({ ...fresh, DB: fresh.DB, SIGN_PRIVATE_KEY: env.SIGN_PRIVATE_KEY }, s, doc);
    if (!v.valid) allValid = false;
    detail.push(`${s.signer_name}:봉인${v.sealOk ? "○" : "✗"}/본문${v.contentOk ? "○" : "✗"}/입력값${v.fieldsChecked ? (v.fieldsOk ? "○" : "✗") : "-"}`);
  }
}
ok(allValid, "복원한 DB 에서 모든 서명이 그대로 검증됨", detail.join(" · "));

// 화면도 뜨는가 — 데이터만 맞고 앱이 안 뜨면 소용없다
const srvGet = async (p) => (await worker.fetch(new Request(BASE + p), fresh, { waitUntil() {}, passThroughOnException() {} }));
const homeR = await srvGet("/t/seochogu");
ok(homeR.status === 200, "복원한 DB 로 상인회 홈이 뜬다", `HTTP ${homeR.status}`);
const bizR = await srvGet("/t/seochogu/businesses");
ok(bizR.status === 200 && (await bizR.text()).includes("홍가네분식"), "점포 목록에 그대로 보인다");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
