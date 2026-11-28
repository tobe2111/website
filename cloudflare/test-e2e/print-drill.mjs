// 3D프린팅 견적 화면 리허설 — 실제 브라우저로 /print 를 열고 파일을 올려
//   ① 화면이 부피 · 크기를 재고 예상 금액을 띄우는지 (STL 은 직접, STEP 은 WebAssembly 로)
//   ② 보안 정책(CSP) 아래에서 WebAssembly 가 막히지 않는지
//   ③ 보내면 접수되고, 운영자 화면에 같은 값이 보이는지
// 를 본다. 단위 테스트는 브라우저가 없어 ①②를 못 본다.
//
// 실행:  node --experimental-sqlite cloudflare/test-e2e/print-drill.mjs [STEP·STL 파일 ...]
//   파일을 안 주면 시험용 상자 STL 을 만들어 쓴다. 손님 도면은 저장소에 넣지 않는다.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = (await import(path.join(ROOT, "src/index.js"))).default;
const { makeEnv } = await import(path.join(ROOT, "test/shim.js"));
const D = await import(path.join(ROOT, "src/db.js"));
const { hashPassword } = await import(path.join(ROOT, "src/crypto.js"));

const env = makeEnv();
const pw = await hashPassword("pass1234");
await D.createUser(env.DB, { email: "s@p.kr", passwordHash: pw.hash, salt: pw.salt, name: "운영", role: "SUPERADMIN", associationId: null });

// 브라우저 요청을 그대로 워커에 넘긴다 — 보안 헤더까지 실제와 같게
const srv = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : body, redirect: "manual" }),
    env, { waitUntil() {}, passThroughOnException() {} });
  const h = {};
  r.headers.forEach((v, k) => { if (k !== "set-cookie") h[k] = v; });
  const sc = r.headers.getSetCookie?.() || [];
  if (sc.length) h["set-cookie"] = sc;
  res.writeHead(r.status, h);
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(0);
const PORT = srv.address().port;

let files = process.argv.slice(2);
if (!files.length) {
  // 10×20×30mm 상자
  const v = [[0,0,0],[10,0,0],[10,20,0],[0,20,0],[0,0,30],[10,0,30],[10,20,30],[0,20,30]];
  const F = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const buf = Buffer.alloc(84 + F.length * 50);
  buf.writeUInt32LE(F.length, 80);
  F.forEach((fc, i) => fc.forEach((vi, j) => v[vi].forEach((c, k) => buf.writeFloatLE(c, 84 + i * 50 + 12 + j * 12 + k * 4))));
  const p = path.join(mkdtempSync(path.join(tmpdir(), "print-")), "box.stl");
  writeFileSync(p, buf);
  files = [p];
}

const pwRoot = execSync("npm root -g").toString().trim();
const { chromium } = await import(path.join(pwRoot, "playwright/index.mjs"));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
let pass = 0, fail = 0;
const ok = (cond, name, note = "") => { if (cond) { pass++; console.log("  ✓", name, note); } else { fail++; console.error("  ✗", name, note); } };

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const cspErrors = [];
page.on("console", (m) => { if (/Content Security Policy|wasm/i.test(m.text())) cspErrors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/print`);
await page.setInputFiles("[data-print-files]", files);
await page.waitForFunction(() => !/계산 중/.test(document.querySelector("[data-print-total]").textContent), null, { timeout: 60000 });
const rows = await page.$$eval(".pr-file__d", (els) => els.map((e) => e.textContent));
const total = await page.textContent("[data-print-total]");
rows.forEach((r, i) => ok(/mm · [\d,.]+ cm³/.test(r), `파일 ${i + 1} 크기 · 부피를 쟀다`, r));
ok(/원 ~ [\d,]+원/.test(total), "예상 금액 범위가 나온다", total);
ok(!cspErrors.length, "보안 정책이 WebAssembly 를 막지 않는다", cspErrors.join(" | "));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

// 수량을 바꾸면 금액이 다시 계산된다
await page.fill('input[name="qty_0"]', "200");
const total2 = await page.textContent("[data-print-total]");
ok(total2 !== total, "수량을 바꾸면 금액이 바뀐다", total2);

await page.fill('input[name="name"]', "김담당");
await page.fill('input[name="phone"]', "010-1111-2222");
await page.fill('input[name="email"]', "a@b.kr");
await page.check('input[name="agree"]');
await Promise.all([page.waitForURL(/\/print\/done/), page.click("button[type=submit]")]);
ok(/견적 요청을 받았습니다/.test(await page.textContent("h1")), "보내면 접수 화면이 뜬다");
const saved = (await env.DB.prepare("SELECT * FROM print_files ORDER BY id").all()).results;
ok(saved.length === files.length && saved.every((f) => f.volume > 0), "저장된 파일마다 부피가 들어 있다", saved.map((f) => `${f.filename} ${f.volume}cm³ ${f.size_mm}`).join(" / "));
ok(saved[0].qty === 200, "바꾼 수량이 저장된다");

await browser.close();
srv.close();
console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
