// 한계 상황 — 워커는 메모리 128MB·CPU 시간 제한이 있고, D1 응답 크기도 유한하다.
// 큰 계약(긴 본문·서명자 다수·이미지 다수)에서 조용히 500 이 나면, 하필 가장 중요한
// 순간(체결·증적 다운로드)에 서비스가 멈춘다. 여기서 미리 끝까지 밀어 본다.
// 자바스크립트를 끈 브라우저에서도 계약이 열리는지도 함께 본다(SSR 우선 설계 확인).
//   실행: npm run test:limits
import http from "node:http";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = (await import(path.join(ROOT, "src/index.js"))).default;
const { makeEnv } = await import(path.join(ROOT, "test/shim.js"));
const D = await import(path.join(ROOT, "src/db.js"));
const E = await import(path.join(ROOT, "src/esign.js"));
const { hashPassword } = await import(path.join(ROOT, "src/crypto.js"));
const { makeExtToken } = await import(path.join(ROOT, "src/extsign.js"));
const { buildEvidence } = await import(path.join(ROOT, "src/evidence.js"));
const { pageCount, paginate } = await import(path.join(ROOT, "src/paper.js"));

globalThis.fetch = async () => new Response("ok");
const env = makeEnv({ PUBLIC_ORIGIN: "https://x.kr" });
const BASE = "http://localhost";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ✓", n, x); } else { fail++; console.error("  ✗", n, x); } };
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;
const ms = (t) => `${Date.now() - t}ms`;
// 1x1 이 아니라 어느 정도 크기가 있는 PNG (실제 서명 그림에 가깝게)
const bigPng = "data:image/png;base64," + Buffer.concat([
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"),
  Buffer.alloc(60 * 1024, 7), // 뒤에 덧붙인 더미 — 크기만 키운다
]).toString("base64");

const jarOf = (r) => (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
const wfetch = (p, init) => worker.fetch(new Request(BASE + p, init), env, { waitUntil() {}, passThroughOnException() {} });

console.log("═══ 한계 상황 ═══\n");

const h = await hashPassword("password1234");
const org = await D.createAssociation(env.DB, { slug: "hanbit", name: "한빛법무법인", kind: "esign" });
await D.createUser(env.DB, { email: "b@h.kr", passwordHash: h.hash, salt: h.salt, name: "대표", role: "ADMIN", associationId: org.id });

console.log("── 아주 긴 계약서 ──");
// 본문 상한은 20,000자. 그 상한을 꽉 채운다.
const long = Array.from({ length: 400 }, (_, i) =>
  `제${i + 1}조 (조항 ${i + 1}) 본 조항은 계약의 이행과 관련하여 당사자가 준수하여야 할 사항을 정한다. ` +
  `구체적인 내용은 별도 합의서에 따르며, 본 조항과 상충하는 경우 본 계약이 우선한다.`).join("\n\n").slice(0, 20000);
let t = Date.now();
const pgs = pageCount(long);
const paginated = paginate(long);
ok(pgs > 5 && paginated.length === pgs, "긴 본문 쪽 나누기", `${long.length.toLocaleString()}자 → ${pgs}쪽 · ${ms(t)}`);
const doc = await D.createDocument(env.DB, { associationId: org.id, title: "장문 계약서", body: long,
  contentHash: await E.contentHash(long), createdBy: null, ordered: 0, dueDate: "" });

console.log("\n── 서명자 20명 ──");
const signers = [];
for (let i = 0; i < 20; i++) {
  signers.push(await D.addExternalSigner(env.DB, { documentId: doc.id, name: `서명자${i + 1}`, email: `s${i}@x.kr`, signOrder: i + 1 }));
}
// 각자 필드 2개씩 = 40개
await D.replaceFields(env.DB, doc.id, signers.flatMap((s, i) => [
  { kind: "sign", label: `서명${i + 1}`, page: Math.min(i % pgs, pgs - 1), x: 0.1, y: 0.1 + (i % 8) * 0.09, w: 0.2, h: 0.05, assignee: -s.id, required: 1 },
  { kind: "date", label: `날짜${i + 1}`, page: Math.min(i % pgs, pgs - 1), x: 0.4, y: 0.1 + (i % 8) * 0.09, w: 0.15, h: 0.03, assignee: -s.id, required: 1 },
]));
ok((await D.listFields(env.DB, doc.id)).length === 40, "필드 40개 배치");

t = Date.now();
for (const s of signers) {
  const tok = await makeExtToken(env.SESSION_SECRET, s.id, doc.id);
  const g = await wfetch(`/esign/${tok}`);
  const gh = await g.text();
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(gh) || [])[1];
  const mine = (await D.listFields(env.DB, doc.id)).filter((f) => f.assignee === -s.id);
  const vals = {};
  for (const f of mine) vals[f.id] = f.kind === "sign" ? { image: bigPng } : { value: "2026-08-12" };
  const r = await wfetch(`/esign/${tok}`, { method: "POST", redirect: "manual",
    headers: { cookie: jarOf(g), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, consent: "1", signature: bigPng, signer_name: s.name,
      fields: JSON.stringify(vals) }).toString() });
  if (/err=1/.test(r.headers.get("location") || "")) {
    ok(false, `${s.name} 서명 실패`, decodeURIComponent(r.headers.get("location")));
    break;
  }
}
const sigs = await D.listSignatures(env.DB, doc.id);
ok(sigs.length === 20, "20명 전원 서명 완료", `${ms(t)}`);
const chain = E.verifyChain(await D.listSignatureChain(env.DB));
ok(chain.ok, "20건 사슬 정상", `${chain.length}건`);
t = Date.now();
let allValid = true;
for (const s of sigs) if (!(await E.verifySignature(env, s, await D.getDocument(env.DB, doc.id))).valid) allValid = false;
ok(allValid, "20건 전부 봉인 검증 통과", ms(t));

console.log("\n── 증적 패키지 (가장 무거운 작업) ──");
t = Date.now();
const pkg = await buildEvidence(env, env.DB, await D.getDocument(env.DB, doc.id), org);
const took = Date.now() - t;
ok(pkg.zip.length > 0, "증적 ZIP 생성", `${mb(pkg.zip.length)} · 파일 ${pkg.count}개 · ${took}ms`);
// 워커 CPU 시간(유료 30초, 무료 10ms-CPU 아님 — 실시간은 넉넉) 안에 들어오는가
ok(took < 20000, "증적 생성이 20초 안에 끝남", `${took}ms`);
// 실제 unzip 으로 열리는가 — 손으로 만든 ZIP 이라 이게 진짜 확인이다
{
  const fs = await import("node:fs"); const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-"));
  const zp = path.join(dir, "e.zip");
  fs.writeFileSync(zp, Buffer.from(pkg.zip));
  let listed = "";
  try { listed = execSync(`unzip -l ${JSON.stringify(zp)}`, { encoding: "utf8" }); } catch (e) { listed = ""; }
  ok(/files?$|개의 파일|\d+ files/.test(listed) || listed.split("\n").length > 5, "실제 unzip 으로 열림",
    `${(listed.match(/\n/g) || []).length}줄 목록`);
  try { execSync(`unzip -t ${JSON.stringify(zp)}`, { stdio: "pipe" }); ok(true, "ZIP 무결성 검사 통과 (unzip -t)"); }
  catch { ok(false, "ZIP 무결성 검사 실패"); }
  fs.rmSync(dir, { recursive: true, force: true });
}
// HTTP 로도 받아지는가 (스트리밍/메모리)
const tok0 = await makeExtToken(env.SESSION_SECRET, signers[0].id, doc.id);
t = Date.now();
const evR = await wfetch(`/esign/${tok0}/evidence`);
ok(evR.status === 200, "증적 HTTP 다운로드", `HTTP ${evR.status} · ${mb((await evR.arrayBuffer()).byteLength)} · ${ms(t)}`);

console.log("\n── 완성본 화면 (긴 문서 + 40필드) ──");
t = Date.now();
const paperR = await wfetch(`/esign/${tok0}/paper`);
const paperHtml = await paperR.text();
ok(paperR.status === 200, "완성본 화면", `HTTP ${paperR.status} · ${mb(Buffer.byteLength(paperHtml))} · ${ms(t)}`);
ok(Buffer.byteLength(paperHtml) < 30 * 1024 * 1024, "응답 크기가 감당 가능", mb(Buffer.byteLength(paperHtml)));

console.log("\n── 첨부 상한 ──");
{
  const mkPdf = (bytes) => { const b = Buffer.alloc(bytes, 0x20); Buffer.from("%PDF-1.4\n").copy(b, 0); return b; };
  const g = await wfetch("/login");
  const seed = jarOf(g);
  const csrf0 = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const lr = await wfetch("/login", { method: "POST", redirect: "manual",
    headers: { cookie: seed, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf0, email: "b@h.kr", password: "password1234" }).toString() });
  const jar = [seed, jarOf(lr)].filter(Boolean).join("; ");
  const dp = await wfetch("/t/hanbit/admin/documents", { headers: { cookie: jar } });
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(await dp.text()) || [])[1];
  const send = async (bytes, title) => {
    const fd = new FormData();
    fd.set("_csrf", csrf); fd.set("title", title); fd.set("body", "본문"); fd.set("target", "all");
    fd.set("attachment", new File([mkPdf(bytes)], "a.pdf", { type: "application/pdf" }));
    return wfetch("/t/hanbit/admin/documents", { method: "POST", redirect: "manual", headers: { cookie: jar }, body: fd });
  };
  const over = await send(11 * 1024 * 1024, "11MB 첨부");
  const overMsg = decodeURIComponent((/[?&]msg=([^&]*)/.exec(over.headers.get("location") || "") || [])[1] || "");
  ok(/err=1/.test(over.headers.get("location") || ""), "10MB 초과 첨부는 거부 (500 이 아니라 안내로)", `"${overMsg}"`);
  ok(over.status < 500, "거부가 서버 오류가 아님", `HTTP ${over.status}`);
  // 위장 파일 — 확장자만 pdf
  const fd = new FormData();
  fd.set("_csrf", csrf); fd.set("title", "위장 파일"); fd.set("body", "본문"); fd.set("target", "all");
  fd.set("attachment", new File([Buffer.from("MZ\x90\x00 not a pdf")], "a.pdf", { type: "application/pdf" }));
  const fake = await wfetch("/t/hanbit/admin/documents", { method: "POST", redirect: "manual", headers: { cookie: jar }, body: fd });
  ok(/err=1/.test(fake.headers.get("location") || ""), "PDF 로 위장한 파일 거부 (선두 바이트 검사)",
    decodeURIComponent((/[?&]msg=([^&]*)/.exec(fake.headers.get("location") || "") || [])[1] || ""));
}

console.log("\n── 자바스크립트를 끈 브라우저 ──");
{
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await worker.fetch(new Request(`http://127.0.0.1:${srv.address().port}${req.url}`, {
      method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined,
    }), env, { waitUntil() {}, passThroughOnException() {} });
    const hh = {}; r.headers.forEach((v, k) => { if (k !== "set-cookie") hh[k] = v; });
    const sc = r.headers.getSetCookie?.() || []; if (sc.length) hh["set-cookie"] = sc;
    res.writeHead(r.status, hh); res.end(Buffer.from(await r.arrayBuffer()));
  }).listen(0);
  const P = `http://127.0.0.1:${srv.address().port}`;
  const pwRoot = execSync("npm root -g").toString().trim();
  const { chromium } = await import(path.join(pwRoot, "playwright/index.mjs"));
  const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
  const ctx = await br.newContext({ javaScriptEnabled: false });
  const p = await ctx.newPage();
  const tk = await makeExtToken(env.SESSION_SECRET, signers[0].id, doc.id);
  for (const [label, url, must] of [
    ["상인회/전자계약 랜딩", `${P}/esign`, "전자계약"],
    ["로그인", `${P}/login`, "로그인"],
    ["계약서 열람", `${P}/esign/${tk}`, "장문 계약서"],
    ["완성본", `${P}/esign/${tk}/paper`, "제1조"],
  ]) {
    const r = await p.goto(url, { waitUntil: "domcontentloaded" });
    const txt = await p.evaluate(() => document.body.innerText);
    ok(r.status() === 200 && txt.includes(must), `JS 없이 ${label}`, `HTTP ${r.status()}`);
  }
  await br.close(); srv.close();
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
