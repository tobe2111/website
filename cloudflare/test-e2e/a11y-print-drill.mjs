// ① 확인서·완성본 인쇄(PDF) — 분쟁 때 법원에 내는 종이다. 잘리거나 색이 날아가면 안 된다.
// ② 접근성 — 라벨 없는 입력칸, 대비 부족, 건너뛴 제목 단계는 스크린리더 사용자에게 벽이 된다.
//    외부 도구(axe) 없이 직접 검사한다 — 의존성 0 원칙을 지킨다.
//   실행: npm run test:a11y
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".a11y-shots");
fs.mkdirSync(OUT, { recursive: true });

const worker = (await import(path.join(ROOT, "src/index.js"))).default;
const { makeEnv } = await import(path.join(ROOT, "test/shim.js"));
const D = await import(path.join(ROOT, "src/db.js"));
const E = await import(path.join(ROOT, "src/esign.js"));
const { hashPassword } = await import(path.join(ROOT, "src/crypto.js"));
const { makeExtToken } = await import(path.join(ROOT, "src/extsign.js"));
const { BUILTIN, normalizeTemplate, applyVars, resolveFieldPages } = await import(path.join(ROOT, "src/templates.js"));
const { pageCount, round4 } = await import(path.join(ROOT, "src/paper.js"));

globalThis.fetch = async () => new Response("ok");
const env = makeEnv({ PUBLIC_ORIGIN: "https://x.kr" });
let pass = 0, fail = 0, warn = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ✓", n, x); } else { fail++; console.error("  ✗", n, x); } };
const note = (n, x = "") => { warn++; console.log("  ⚠", n, x); };

// ── 계약 하나를 끝까지 체결해 둔다 (확인서가 나오려면 서명이 있어야 한다)
const h = await hashPassword("password1234");
const org = await D.createAssociation(env.DB, { slug: "hanbit", name: "한빛법무법인", kind: "esign" });
await D.createUser(env.DB, { email: "b@h.kr", passwordHash: h.hash, salt: h.salt, name: "김대표", role: "ADMIN", associationId: org.id });
const tpl = normalizeTemplate(BUILTIN.find((t) => t.id === "b-lease"));
const body = applyVars(tpl.body, { 임대인: "한빛법무법인", 임차인: "최임차", 보증금: "50,000,000",
  월세: "2,000,000", 소재지: "서울 서초구 서초대로 100" });
const doc = await D.createDocument(env.DB, { associationId: org.id, title: "○○빌딩 3층 임대차계약서",
  body, contentHash: await E.contentHash(body), createdBy: null, ordered: 0, dueDate: "2099-12-31" });
const signer = await D.addExternalSigner(env.DB, { documentId: doc.id, name: "최임차", email: "t@x.kr", signOrder: 1 });
await D.replaceFields(env.DB, doc.id, resolveFieldPages(tpl.fields, pageCount(body)).map((f) => ({
  kind: f.kind, label: f.label || "", page: f.page, x: round4(f.x), y: round4(f.y), w: round4(f.w), h: round4(f.h),
  assignee: -signer.id, required: f.required ? 1 : 0 })));
const token = await makeExtToken(env.SESSION_SECRET, signer.id, doc.id);

const srv = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await worker.fetch(new Request(`http://127.0.0.1:${srv.address().port}${req.url}`, {
    method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined,
  }), env, { waitUntil() {}, passThroughOnException() {} });
  const headers = {}; r.headers.forEach((v, k) => { if (k !== "set-cookie") headers[k] = v; });
  const sc = r.headers.getSetCookie?.() || []; if (sc.length) headers["set-cookie"] = sc;
  res.writeHead(r.status, headers); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(0);
const BASE = `http://127.0.0.1:${srv.address().port}`;

const pwRoot = execSync("npm root -g").toString().trim();
const { chromium } = await import(path.join(pwRoot, "playwright/index.mjs"));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// 서명 완료시키기 — 서명 자체는 다른 드릴에서 이미 확인했으므로 여기선 서버로 바로 끝낸다
{
  const jarOf = (r) => (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const g = await worker.fetch(new Request(`http://localhost/esign/${token}`), env, { waitUntil() {}, passThroughOnException() {} });
  const gh = await g.text();
  const jar = jarOf(g);
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(gh) || [])[1];
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const vals = {};
  for (const f of await D.listFields(env.DB, doc.id)) {
    vals[f.id] = (f.kind === "sign" || f.kind === "stamp") ? { image: png }
      : f.kind === "check" ? { value: "1" } : { value: f.kind === "date" ? "2026-08-12" : "최임차" };
  }
  await worker.fetch(new Request(`http://localhost/esign/${token}`, { method: "POST", redirect: "manual",
    headers: { cookie: jar, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, consent: "1", signature: png, signer_name: "최임차",
      fields: JSON.stringify(vals) }).toString() }), env, { waitUntil() {}, passThroughOnException() {} });
}
const sig = (await D.listSignatures(env.DB, doc.id))[0];
ok(!!sig, "확인서를 만들 서명이 있음", sig ? `검증코드 ${sig.verify_code}` : "");

console.log("\n── 인쇄(PDF) ──");
// ① 전자서명 확인서 — 분쟁 때 제출하는 문서
await page.goto(`${BASE}/certificate/${sig.verify_code}`, { waitUntil: "networkidle" });
await page.emulateMedia({ media: "print" });
const certPdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
fs.writeFileSync(path.join(OUT, "certificate.pdf"), certPdf);
const pages = (certPdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
ok(certPdf.length > 3000, "확인서 PDF 생성", `${(certPdf.length / 1024).toFixed(0)}KB · ${pages}쪽`);
ok(pages <= 2, "확인서가 1~2쪽에 들어감 (법원 제출용)", `${pages}쪽`);
// 인쇄 미디어에서 잘리지 않는가 + 핵심 정보가 남아 있는가
const certPrint = await page.evaluate(() => {
  const t = document.body.innerText;
  return { over: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    hasCode: /검증|verify/i.test(t), hasHash: /[0-9a-f]{16,}/.test(t), hasWhen: /20\d\d/.test(t),
    hidden: [...document.querySelectorAll("*")].filter((e) => getComputedStyle(e).display === "none").length };
});
ok(!certPrint.over, "인쇄 화면에서 가로로 안 잘림");
ok(certPrint.hasCode && certPrint.hasHash && certPrint.hasWhen, "확인서에 검증코드·해시·시각이 남아 있음");
await page.screenshot({ path: path.join(OUT, "certificate.png"), fullPage: true });

// ② 완성본(체결된 계약서) 인쇄
await page.emulateMedia({ media: null });
await page.goto(`${BASE}/esign/${token}/paper`, { waitUntil: "networkidle" });
await page.emulateMedia({ media: "print" });
const paperPdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
fs.writeFileSync(path.join(OUT, "contract.pdf"), paperPdf);
const pPages = (paperPdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
ok(paperPdf.length > 3000, "체결된 계약서 PDF 생성", `${(paperPdf.length / 1024).toFixed(0)}KB · ${pPages}쪽`);
ok(pPages === pageCount(body), "쪽수가 화면과 일치", `화면 ${pageCount(body)}쪽 / PDF ${pPages}쪽`);
// 서명 그림이 인쇄에서 사라지지 않는가 (배경 인쇄 끄면 날아가는 흔한 함정)
const noBg = await page.pdf({ format: "A4", printBackground: false });
ok(noBg.length > 3000, "배경 인쇄를 꺼도 내용이 남음", `${(noBg.length / 1024).toFixed(0)}KB`);
const inkOk = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll(".pf img")];
  return imgs.length > 0 && imgs.every((i) => getComputedStyle(i).display !== "none" && i.getBoundingClientRect().width > 0);
});
ok(inkOk, "서명·도장 그림이 인쇄 화면에도 보임");
await page.emulateMedia({ media: null });

console.log("\n── 접근성 ──");
const CHECK = [
  ["전자계약 랜딩", "/esign"], ["가입", "/esign/signup"], ["로그인", "/login"],
  ["문서 진위확인", "/verify"], ["서명 화면", `/esign/${token}`], ["확인서", `/certificate/${sig.verify_code}`],
];
// 대비 계산 (WCAG) — 배경을 위로 거슬러 올라가 실제 색을 찾는다
const A11Y = `(() => {
  const lum = (c) => { const [r,g,b] = c.map((v)=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);});
    return 0.2126*r + 0.7152*g + 0.0722*b; };
  const parse = (s) => { const m = String(s).match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const p = m[1].split(",").map(parseFloat); return { rgb: p.slice(0,3), a: p.length>3 ? p[3] : 1 }; };
  const bgOf = (el) => { let e = el; while (e) { const p = parse(getComputedStyle(e).backgroundColor);
      if (p && p.a > 0.05) return p.rgb; e = e.parentElement; } return [255,255,255]; };
  const ratio = (f, b) => { const L1 = lum(f), L2 = lum(b); return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); };
  const vis = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect();
    return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0; };
  const out = { lang: document.documentElement.lang || "", title: (document.title||"").trim(),
    unlabeled: [], noAlt: [], lowContrast: [], headingSkips: [], noName: [], dupIds: [] };
  // 라벨 없는 입력칸
  for (const el of document.querySelectorAll("input, select, textarea")) {
    if (!vis(el)) continue;
    const t = (el.type || "").toLowerCase();
    if (t === "hidden" || t === "submit" || t === "button") continue;
    const labelled = (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'))
      || el.closest("label") || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")
      || el.getAttribute("title") || el.getAttribute("placeholder");
    if (!labelled) out.unlabeled.push((el.name || el.id || el.tagName).slice(0, 40));
  }
  // alt 없는 이미지
  for (const img of document.querySelectorAll("img")) if (vis(img) && img.getAttribute("alt") === null) out.noAlt.push((img.src||"").slice(-40));
  // 이름 없는 버튼·링크
  for (const el of document.querySelectorAll("a, button")) {
    if (!vis(el)) continue;
    const name = (el.innerText || "").trim() || el.getAttribute("aria-label") || el.getAttribute("title") || (el.querySelector("img") ? el.querySelector("img").alt : "");
    if (!name) out.noName.push(el.tagName + (el.className ? "." + String(el.className).split(" ")[0] : ""));
  }
  // 글자 대비 (본문 텍스트 노드가 있는 요소만)
  const seen = new Set();
  for (const el of document.querySelectorAll("p, span, a, li, td, th, label, small, h1, h2, h3, button, div")) {
    if (!vis(el)) continue;
    const txt = [...el.childNodes].filter((n)=>n.nodeType===3).map((n)=>n.textContent.trim()).join("");
    if (txt.length < 2) continue;
    const s = getComputedStyle(el);
    const fg = parse(s.color); if (!fg) continue;
    const size = parseFloat(s.fontSize), bold = parseInt(s.fontWeight,10) >= 700;
    const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
    const r = ratio(fg.rgb, bgOf(el));
    const key = s.color + "|" + bgOf(el).join(",") + "|" + Math.round(size);
    if (r < need && !seen.has(key)) { seen.add(key);
      out.lowContrast.push({ text: txt.slice(0,24), color: s.color, size: Math.round(size), ratio: Math.round(r*100)/100, need }); }
  }
  // 제목 단계 건너뜀 (h1 → h3)
  let prev = 0;
  for (const hEl of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    if (!vis(hEl)) continue;
    const lv = +hEl.tagName[1];
    if (prev && lv > prev + 1) out.headingSkips.push("h" + prev + "→h" + lv);
    prev = lv;
  }
  // 중복 id (스크린리더가 라벨을 잘못 연결한다)
  const ids = {};
  for (const el of document.querySelectorAll("[id]")) { ids[el.id] = (ids[el.id]||0)+1; }
  out.dupIds = Object.entries(ids).filter(([,n])=>n>1).map(([k])=>k);
  return out;
})()`;

let a11yFail = 0;
for (const [label, p] of CHECK) {
  await page.goto(BASE + p, { waitUntil: "networkidle" });
  const r = await page.evaluate(A11Y);
  const probs = [];
  if (!r.lang) probs.push("lang 없음");
  if (!r.title) probs.push("title 없음");
  if (r.unlabeled.length) probs.push(`라벨없는 입력 ${r.unlabeled.length}(${r.unlabeled.slice(0,3).join(",")})`);
  if (r.noAlt.length) probs.push(`alt없는 이미지 ${r.noAlt.length}`);
  if (r.noName.length) probs.push(`이름없는 버튼·링크 ${r.noName.length}(${r.noName.slice(0,2).join(",")})`);
  if (r.dupIds.length) probs.push(`중복 id ${r.dupIds.join(",")}`);
  if (r.lowContrast.length) probs.push(`대비부족 ${r.lowContrast.length}(${r.lowContrast.slice(0,2).map((c)=>`"${c.text}" ${c.ratio}:1<${c.need}`).join(" / ")})`);
  if (probs.length) { a11yFail++; console.error(`  ✗ ${label.padEnd(12)} ${probs.join(" · ")}`); }
  else console.log(`  ✓ ${label.padEnd(12)} 라벨·alt·이름·대비·제목단계 모두 정상`);
  if (r.headingSkips.length) note(`${label} 제목 단계 건너뜀`, r.headingSkips.join(","));
}
ok(a11yFail === 0, `접근성 — 검사한 ${CHECK.length}개 화면 모두 통과`, a11yFail ? `${a11yFail}개 화면에 문제` : "");

// 키보드만으로 서명까지 갈 수 있는가
await page.goto(`${BASE}/esign/${token}`, { waitUntil: "networkidle" });
const focusable = await page.evaluate(() => [...document.querySelectorAll('a[href],button:not([disabled]),input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])')]
  .filter((e) => e.offsetParent !== null).length);
ok(focusable > 3, "키보드로 도달 가능한 요소가 있음", `${focusable}개`);
const focusRing = await page.evaluate(() => {
  const b = document.querySelector("button, a[href]"); if (!b) return false;
  b.focus();
  const s = getComputedStyle(b);
  return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
});
ok(focusRing, "포커스가 눈에 보임 (키보드 사용자가 어디 있는지 안다)");

console.log(`\n결과: ${pass} 통과 / ${fail} 실패${warn ? ` / 참고 ${warn}` : ""}`);
console.log(`PDF·스크린샷: ${OUT}/`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
