// 3D프린팅 견적 문의 — 계산이 맞는지, 손님 파일이 밖으로 새지 않는지, 운영자 화면이 잠겨 있는지.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { estimate, quoteCalc, stlGeometry, cleanGeo, tierFactor, DEFAULT_PRICING, quoteEmailText } from "../src/print.js";

const B = "http://localhost";
let ipN = 0;
const f = (env, p, i = {}) => worker.fetch(new Request(B + p, { redirect: "manual", ...i,
  headers: { "cf-connecting-ip": `192.0.2.${(ipN++ % 250) + 1}`, ...(i.headers || {}) } }), env, { waitUntil() {}, passThroughOnException() {} });
const jarOf = (r) => (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
const csrfIn = (h) => (/name="_csrf" value="([^"]+)"/.exec(h) || [])[1];

// 10×20×30mm 상자 (부피 6cm³) — 이진 STL
function boxStl(x = 10, y = 20, z = 30) {
  const v = [[0,0,0],[x,0,0],[x,y,0],[0,y,0],[0,0,z],[x,0,z],[x,y,z],[0,y,z]];
  const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const buf = new ArrayBuffer(84 + faces.length * 50), dv = new DataView(buf);
  dv.setUint32(80, faces.length, true);
  faces.forEach((fc, i) => fc.forEach((vi, j) => v[vi].forEach((c, k) => dv.setFloat32(84 + i * 50 + 12 + j * 12 + k * 4, c, true))));
  return new Uint8Array(buf);
}

test("STL 부피와 크기를 잰다 (이진 · 글자 형식)", () => {
  const g = stlGeometry(boxStl());
  assert.equal(g.volume, 6);
  assert.deepEqual(g.size, [10, 20, 30]);
  const ascii = "solid t\n" + [[0,0,0],[10,0,0],[0,10,0]].map((p) => `vertex ${p.join(" ")}`).join("\n") + "\nendsolid";
  assert.ok(stlGeometry(new TextEncoder().encode(ascii)));
  assert.equal(stlGeometry(new Uint8Array(10)), null);
});

test("손님 화면이 보낸 숫자는 범위를 벗어나면 버린다", () => {
  assert.deepEqual(cleanGeo('{"volume":128.49,"size":[185,5,184.4]}'), { volume: 128.49, size: [185, 5, 184.4] });
  assert.equal(cleanGeo('{"volume":-1,"size":[1,1,1]}'), null);
  assert.equal(cleanGeo("<script>"), null);
});

test("예상가: 최소 금액 · 수량 할인 · 배송비 · 범위", () => {
  assert.equal(tierFactor(1), 1);
  assert.equal(tierFactor(200), 0.85);
  // END CAP: 캡 128.5cm³ × 200, 고리 1.96cm³ × 1200 (PLA 기본 단가)
  const e = estimate([{ volume: 128.5, qty: 200 }, { volume: 1.96, qty: 1200 }], "pla", DEFAULT_PRICING);
  const cap = 128.5 * 150 * 0.85, hook = 3000 * 0.78; // 고리는 최소 금액에 걸린다
  const base = cap * 200 + hook * 1200 + DEFAULT_PRICING.shipping;
  assert.equal(e.low, Math.ceil(base * 0.85 / 1000) * 1000);
  assert.equal(e.high, Math.ceil(base * 1.2 / 1000) * 1000);
  const none = estimate([{ volume: 0, qty: 3 }], "pla");
  assert.equal(none.unknown, 1);
  assert.equal(none.low, 0);
});

test("운영자 견적: 원가에 배송 · 관세 · 마진을 붙이고 단가는 10원 단위로 올린다", () => {
  const c = quoteCalc({ files: [{ qty: 200, costUsd: 1000 }, { qty: 1200, costUsd: 200 }], fx: 1400, shipUsd: 240, dutyPct: 18, domesticKrw: 6000, marginPct: 35 });
  // 캡 몫 = 1000/1200 → 배송 200달러, 국내 5000원
  const capLanded = (1000 + 200) * 1400 * 1.18 + 5000;
  assert.equal(c.lines[0].unit, Math.ceil(capLanded * 1.35 / 200 / 10) * 10);
  assert.equal(c.total, c.lines[0].line + c.lines[1].line);
  assert.ok(c.profit > 0 && c.total > c.cost);
  assert.equal(quoteCalc({ files: [{ qty: 1, costUsd: 0 }], fx: 1400 }), null);
  const mail = quoteEmailText({ code: "P1", material: "pla", color: "블랙", memo: "" }, [{ filename: "cap.step", qty: 200 }, { filename: "hook.step", qty: 1200 }], c);
  assert.match(mail, /cap: [\d,]+원 × 200개/);
  assert.doesNotMatch(mail, /\[   \]/);
});

async function liveEnv() {
  const env = makeEnv();
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "s@p.kr", passwordHash: pw.hash, salt: pw.salt, name: "운영", role: "SUPERADMIN", associationId: null });
  return env;
}

async function submit(env, extra = {}) {
  const g = await f(env, "/print");
  const cookie = jarOf(g);
  const fd = new FormData();
  fd.set("_csrf", csrfIn(await g.text()));
  for (const [k, v] of Object.entries({ name: "김담당", company: "테스트", phone: "010-1111-2222", email: "a@b.kr", material: "petg", color: "블랙", deadline: "보통 (2~3주)", agree: "1", qty_0: "5", qty_1: "3", geo_1: '{"volume":128.49,"size":[185,5,184.4]}', ...extra })) fd.set(k, v);
  fd.append("files", new File([boxStl()], "box.stl"));
  fd.append("files", new File([new Uint8Array([1, 2, 3])], "cap.step"));
  return f(env, "/print", { method: "POST", headers: { cookie }, body: fd });
}

test("손님 문의가 저장되고, 파일은 공개 주소로 열리지 않으며, 운영자만 본다", async () => {
  const env = await liveEnv();
  const page = await f(env, "/print");
  assert.equal(page.status, 200);
  // STEP 은 별도 작업자가 읽으므로 화면의 보안 정책을 느슨하게 하지 않는다
  assert.doesNotMatch(page.headers.get("content-security-policy"), /unsafe-eval/);

  const r = await submit(env);
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /^\/print\/done\?c=P\d{6}-[A-Z0-9]{4}$/);
  const req = await env.DB.prepare("SELECT * FROM print_requests").first();
  assert.equal(req.material, "petg");
  assert.ok(req.est_low > 0 && req.est_high > req.est_low);
  const files = (await env.DB.prepare("SELECT * FROM print_files ORDER BY id").all()).results;
  assert.equal(files.length, 2);
  assert.equal(files[0].volume, 6);          // STL 은 서버가 직접 잰 값
  assert.equal(files[0].qty, 5);
  assert.equal(files[1].volume, 128.49);     // STEP 은 화면이 잰 값(범위 확인 뒤)
  assert.match(files[0].r2_key, /^print\/[0-9a-f]{24}\.stl$/);
  assert.ok(await env.MEDIA.get(files[0].r2_key));
  // 공개 미디어 경로로는 열 수 없다
  assert.equal((await f(env, `/media/${files[0].r2_key}`)).status, 404);
  assert.equal((await f(env, `/media/${files[0].r2_key.replace("/", "%2F")}`)).status, 404);

  // 로그인 안 한 사람은 운영자 화면 · 파일 내려받기 모두 못 연다
  for (const p of ["/super/print", `/super/print/${req.id}`, `/super/print/${req.id}/file/${files[0].id}`, "/super/print/settings"]) {
    assert.notEqual((await f(env, p)).status, 200, p);
  }

  // 운영자: 원가 입력 → 견적가 계산 → 메일 초안
  const lg = await f(env, "/login");
  const seed = jarOf(lg);
  const lr = await f(env, "/login", { method: "POST", headers: { cookie: seed, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrfIn(await lg.text()), email: "s@p.kr", password: "pass1234" }) });
  const cookie = [seed, jarOf(lr)].filter(Boolean).join("; ");
  const list = await f(env, "/super/print", { headers: { cookie } });
  assert.equal(list.status, 200);
  assert.match(await list.text(), new RegExp(req.code));
  const det = await f(env, `/super/print/${req.id}`, { headers: { cookie } });
  const dh = await det.text();
  const dl = await f(env, `/super/print/${req.id}/file/${files[0].id}`, { headers: { cookie } });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get("content-disposition"), /box\.stl/);
  const up = await f(env, `/super/print/${req.id}`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrfIn(dh), [`cost_${files[0].id}`]: "3.5", [`cost_${files[1].id}`]: "20", fx: "1400", ship_usd: "15", duty_pct: "18", domestic_krw: "4000", margin_pct: "35", status: "quoted", vendor: "JLC3DP" }) });
  assert.equal(up.status, 303);
  const after = await env.DB.prepare("SELECT * FROM print_requests WHERE id=?").bind(req.id).first();
  assert.equal(after.status, "quoted");
  assert.ok(after.quote_total > 0);
  const mailPage = await (await f(env, `/super/print/${req.id}`, { headers: { cookie } })).text();
  assert.match(mailPage, /box: [\d,]+원 × 5개/);

  // 재주문: 같은 파일 · 원가로 새 건
  const ro = await f(env, `/super/print/${req.id}/reorder`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrfIn(mailPage) }) });
  assert.equal(ro.status, 303);
  const kids = (await env.DB.prepare("SELECT * FROM print_requests WHERE parent_id=?").bind(req.id).all()).results;
  assert.equal(kids.length, 1);
  const kf = (await env.DB.prepare("SELECT * FROM print_files WHERE request_id=?").bind(kids[0].id).all()).results;
  assert.equal(kf.length, 2);
  assert.equal(kf[0].r2_key, files[0].r2_key);
  assert.equal(kf[1].cost_usd, 20);
});

test("허용하지 않는 파일 · 빠진 칸은 접수하지 않는다", async () => {
  const env = await liveEnv();
  const g = await f(env, "/print");
  const fd = new FormData();
  fd.set("_csrf", csrfIn(await g.text()));
  for (const [k, v] of Object.entries({ name: "김", phone: "010", email: "a@b.kr", agree: "1" })) fd.set(k, v);
  fd.append("files", new File([new Uint8Array([1])], "virus.exe"));
  const r = await f(env, "/print", { method: "POST", headers: { cookie: jarOf(g) }, body: fd });
  assert.equal(r.status, 303);
  assert.match(decodeURIComponent(r.headers.get("location")), /STEP, STL/);
  const r2 = await submit(env, { agree: "" });
  assert.match(decodeURIComponent(r2.headers.get("location")), /동의/);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM print_requests").first()).n, 0);
});
