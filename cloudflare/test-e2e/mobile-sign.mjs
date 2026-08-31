// 휴대폰에서 서명하기 — 계약 상대방은 거의 다 폰으로 링크를 연다.
// A4 지면(794px)을 390px 화면에 넣는 화면이라, 여기가 깨지면 계약이 멈춘다.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";

import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".mobile-shots");
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

// 실제 임대차 서식으로 계약 하나 — 서명·도장·글자·날짜 자리가 모두 들어간다
const h = await hashPassword("password1234");
const org = await D.createAssociation(env.DB, { slug: "hanbit", name: "한빛법무법인", kind: "esign" });
await D.createUser(env.DB, { email: "b@h.kr", passwordHash: h.hash, salt: h.salt, name: "김대표", role: "ADMIN", associationId: org.id });
const tpl = normalizeTemplate(BUILTIN.find((t) => t.id === "b-lease"));
const body = applyVars(tpl.body, { 임대인: "한빛법무법인", 임차인: "최임차", 보증금: "50,000,000",
  월세: "2,000,000", 소재지: "서울 서초구 서초대로 100" });
const doc = await D.createDocument(env.DB, { associationId: org.id, title: "○○빌딩 3층 임대차계약서",
  body, contentHash: await E.contentHash(body), createdBy: null, ordered: 0, dueDate: "2099-12-31" });
const signer = await D.addExternalSigner(env.DB, { documentId: doc.id, name: "최임차", email: "t@x.kr", signOrder: 1 });
const placed = resolveFieldPages(tpl.fields, pageCount(body)).map((f) => ({
  kind: f.kind, label: f.label || "", page: f.page, x: round4(f.x), y: round4(f.y), w: round4(f.w), h: round4(f.h),
  assignee: -signer.id, required: f.required ? 1 : 0 }));
await D.replaceFields(env.DB, doc.id, placed);
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

let pass = 0, fail = 0;
const ok = (c, n, extra = "") => { if (c) { pass++; console.log("  ✓", n, extra); } else { fail++; console.error("  ✗", n, extra); } };

// iPhone 12/13/14 크기 — 국내에서 가장 흔한 축
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
  isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });

console.log("═══ 휴대폰(390×844)에서 서명하기 ═══\n");
await page.goto(`${BASE}/esign/${token}`, { waitUntil: "networkidle" });

// 1) 가로 스크롤 — 폰에서 옆으로 밀리면 계약서가 잘려 보인다
const scroll = await page.evaluate(() => ({
  docW: document.documentElement.scrollWidth, winW: window.innerWidth,
  bodyW: document.body.scrollWidth,
}));
ok(scroll.docW <= scroll.winW + 1, "가로 스크롤 없음", `문서 ${scroll.docW}px / 화면 ${scroll.winW}px`);

// 2) 계약서 지면이 화면 안에 들어왔는가 (A4 794px 를 축소해야 한다)
const paper = await page.evaluate(() => {
  const el = document.querySelector(".paper, .pf-page, .paper-page");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), cls: el.className };
});
ok(paper && paper.right <= 391, "계약서 지면이 화면 안에 들어옴", paper ? `폭 ${paper.w}px, 오른쪽 끝 ${paper.right}px` : "(지면 요소를 못 찾음)");

// 3) 본문 글자가 읽히는 크기인가 (모바일 최소 12px 권장)
const fontPx = await page.evaluate(() => {
  const el = document.querySelector(".paper, .pf-page, .paper-page");
  if (!el) return 0;
  const t = el.querySelector("div, p, span") || el;
  const fs = parseFloat(getComputedStyle(t).fontSize);
  const scale = el.getBoundingClientRect().width / (el.offsetWidth || 1);
  return Math.round(fs * scale * 10) / 10;
});
ok(fontPx >= 6, "본문 글자 크기 (확대 가능하므로 하한만 확인)", `실제 ${fontPx}px — A4 지면을 폭에 맞춰 축소한 결과`);

// 4) 내가 채워야 할 자리가 표시되는가
const mine = await page.$$(".pf-mine, .pf.is-mine, [data-mine='1']");
ok(mine.length > 0, "내가 채울 자리 강조", `${mine.length}개`);

// 5) 손가락으로 누를 수 있는 크기인가 (Apple HIG 44×44, 최소 32 이상은 되어야)
// 보이는 크기가 아니라 '실제로 눌리는 범위'를 잰다 — 칸 중심에서 위아래로 훑어
// elementFromPoint 가 그 칸을 반환하는 구간을 센다
// 칸을 하나씩 화면에 올려 가며 잰다. 페이지 안에서 스크롤을 흉내 내면 안 된다 —
// .paper-wrap 은 overflow:hidden 이고 스크롤 컨테이너는 body 라, scrollIntoView 도
// window.scrollBy 도 듣지 않는다. 예전엔 지면이 우연히 첫 화면에 들어와 그냥 지나갔다.
const tap = [];
for (const el of await page.$$(".pf-mine")) {
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const one = await el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cy < 0 || cy > innerHeight) return null;
    const hits = (dx, dy) => { let n = 0;
      for (let d = 0; d < 40; d++) { const e = document.elementFromPoint(cx + dx * d, cy + dy * d); if (!e || !node.contains(e) && e !== node) break; n++; }
      return n; };
    return { h: hits(0, -1) + hits(0, 1), w: hits(-1, 0) + hits(1, 0), box: Math.round(r.height) };
  });
  if (one) tap.push(one);
}
const minH = tap.length ? Math.min(...tap.map((t) => t.h)) : 0;
const minW = tap.length ? Math.min(...tap.map((t) => t.w)) : 0;
ok(minH >= 24 && minW >= 24, "누를 수 있는 범위",
  tap.length ? `보이는 칸 ${Math.min(...tap.map((t) => t.box))}px → 실제 판정 ${minW}×${minH}px` : "(측정 불가)");
// 옆 칸을 잘못 누르지 않는가 — 판정 범위가 겹치면 엉뚱한 칸이 열린다
const overlap = await page.evaluate(() => {
  const els = [...document.querySelectorAll(".pf-mine")];
  let bad = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) continue;
    const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (e && !el.contains(e) && e !== el) bad++;
  }
  return bad;
});
ok(overlap === 0, "칸 한가운데를 누르면 그 칸이 잡힌다 (옆 칸 오작동 없음)", `어긋난 칸 ${overlap}개`);

await page.screenshot({ path: `${OUT}/m1-sign.png` });

// 6) 서명 자리를 탭하면 서명판이 열리는가
const signBox = await page.$(".pf-mine[data-kind='sign'], [data-kind='sign'].is-mine, .pf[data-kind='sign']");
if (signBox) {
  await signBox.tap().catch(async () => signBox.click());
  await page.waitForTimeout(400);
  const opened = await page.evaluate(() => {
    const d = document.querySelector(".fd-back, .sign-modal, dialog[open]");
    return d ? !d.hasAttribute("hidden") && getComputedStyle(d).display !== "none" : false;
  });
  ok(opened, "서명 자리를 탭 → 서명판 열림");
  if (opened) {
    await page.screenshot({ path: `${OUT}/m2-pad.png` });
    // 서명판이 화면을 벗어나지 않는가
    const padFit = await page.evaluate(() => {
      const c = document.querySelector(".fd-back canvas, .sign-modal canvas, canvas");
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { w: Math.round(r.width), right: Math.round(r.right), h: Math.round(r.height) };
    });
    ok(padFit && padFit.right <= 391 && padFit.w > 200, "서명판이 화면 안에 들어옴",
      padFit ? `${padFit.w}×${padFit.h}px` : "(캔버스 없음)");
    // 손가락으로 그려 본다
    if (padFit) {
      const c = await page.$(".fd-back canvas, .sign-modal canvas, canvas");
      const b = await c.boundingBox();
      await page.touchscreen.tap(b.x + 30, b.y + b.height / 2).catch(() => {});
      await page.mouse.move(b.x + 30, b.y + b.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + 30 + i * (b.width - 60) / 12, b.y + b.height / 2 + Math.sin(i) * 18);
      await page.mouse.up();
      await page.waitForTimeout(200);
      const drawn = await page.evaluate(() => {
        const c = document.querySelector(".fd-back canvas, .sign-modal canvas, canvas");
        const ctx = c.getContext("2d");
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
      });
      ok(drawn > 200, "손가락으로 서명이 그려짐", `${drawn}px 칠해짐`);
      await page.screenshot({ path: `${OUT}/m3-drawn.png` });
    }
  }
} else {
  ok(false, "서명 자리를 화면에서 못 찾음");
}

// 6-b) '다음 항목으로 이동' 이 그 자리를 바로 열어 주는가 — 작은 칸을 안 건드리고 끝낼 수 있어야
await page.reload({ waitUntil: "networkidle" });
const jump = await page.$("#fieldJump");
if (jump) {
  const jb = await jump.boundingBox();
  ok(jb.height >= 36 && jb.width > 200, "다음 항목 버튼이 손가락 크기", `${Math.round(jb.width)}×${Math.round(jb.height)}px`);
  await jump.click();
  await page.waitForTimeout(700);
  const dlgOpen = await page.evaluate(() => {
    const d = document.getElementById("fieldDialog");
    return d && !d.hidden && getComputedStyle(d).display !== "none";
  });
  ok(dlgOpen, "버튼 한 번으로 첫 항목이 바로 열림 (작은 칸을 누를 필요 없음)");
  await page.screenshot({ path: `${OUT}/m5-jump.png` });
  await page.click("#fdCancel").catch(() => {});
} else ok(false, "다음 항목 버튼이 없음");

// 7) 제출 버튼이 화면 안에 있고 눌리는가
const submit = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /서명|제출|완료/.test(x.textContent));
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { text: b.textContent.trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height),
    right: Math.round(r.right), disabled: b.disabled };
});
ok(submit && submit.right <= 391 && submit.h >= 36, "제출 버튼이 화면 안, 누를 수 있는 크기",
  submit ? `"${submit.text}" ${submit.w}×${submit.h}px${submit.disabled ? " (아직 잠김)" : ""}` : "(못 찾음)");

// 8) 확대 금지(user-scalable=no)가 걸려 있지 않은가 — 접근성 문제
const vp = await page.evaluate(() => (document.querySelector('meta[name="viewport"]') || {}).content || "");
ok(!/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(vp), "손가락 확대 허용", vp);

// 9) 읽을 수 있는가 — A4 를 390px 에 넣으면 본문이 8px 로 내려간다.
//    지면은 리플로우할 수 없으므로(줄이 다시 나뉘면 서명 자리가 어긋난다) 두 가지로 답한다:
//    본문을 큰 글자로 펴 두고, 지면은 통째로 크게 볼 수 있게 한다.
const read = await page.evaluate(() => {
  const rp = document.querySelector(".read-plain");
  const body = document.querySelector(".rp-body");
  const line = document.querySelector(".paper .paper-text > div");
  const paper = document.querySelector(".paper");
  const px = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0);
  return {
    열려있나: !!(rp && rp.open),
    큰글자: px(body),
    지면글자: line && paper ? +(px(line) * (paper.getBoundingClientRect().width / 794)).toFixed(1) : 0,
  };
});
ok(read.열려있나, "휴대폰에서는 본문이 펼쳐진 채로 시작한다 (읽지 못하는 화면이 기본이면 안 된다)");
ok(read.큰글자 >= 15, "펼친 본문은 읽을 수 있는 크기", `${read.큰글자}px (지면은 ${read.지면글자}px)`);

const zoom = await page.evaluate(async () => {
  const b = document.querySelector(".paper-zoom button");
  if (!b || b.hidden) return null;
  b.click();
  await new Promise((r) => setTimeout(r, 150));
  const line = document.querySelector(".paper .paper-text > div");
  const paper = document.querySelector(".paper");
  const after = +(parseFloat(getComputedStyle(line).fontSize) * (paper.getBoundingClientRect().width / 794)).toFixed(1);
  const scrolls = getComputedStyle(paper.closest(".paper-wrap")).overflowX;
  b.click();
  return { after, scrolls };
});
ok(zoom && zoom.after >= 15, "지면도 통째로 크게 볼 수 있다", zoom ? `${zoom.after}px · 가로 ${zoom.scrolls}` : "(확대 단추 없음)");

// 10) 작은 칸을 못 누르는 문제에 제품이 실제로 내놓는 답 — 지면을 크게 보면 손가락 크기가 된다.
//     칸 자체의 판정 범위를 44px 로 넓히는 길은 일부러 택하지 않았다: 서명·도장·성명·날짜가
//     서로 20~30px 안에 붙어 있어 넓히면 이웃끼리 겹치고, 한가운데를 눌러도 옆 칸이 열린다.
const zoomTap = await page.evaluate(async () => {
  const b = document.querySelector(".paper-zoom button");
  if (!b || b.hidden) return null;
  b.click();
  await new Promise((r) => setTimeout(r, 150));
  let best = null;
  for (const el of document.querySelectorAll(".pf-mine")) {
    const r = el.getBoundingClientRect();
    if (!best || r.height > best.h) best = { w: Math.round(r.width), h: Math.round(r.height) };
  }
  b.click();
  return best;
});
ok(zoomTap && zoomTap.h >= 44, "지면을 크게 보면 서명 칸이 손가락 크기가 된다",
  zoomTap ? `${zoomTap.w}×${zoomTap.h}px` : "(확대 단추 없음)");

// 11) 관리자도 폰으로 서명 자리를 놓을 수 있는가.
//     0.42 배로 줄어든 지면에서는 칸이 16px, 손잡이가 5px 다 — 배치 화면은 배율 1.0 으로 시작한다.
{
  const dbody = "위탁 계약서\n\n제1조 (범위)\n  ① 을은 업무를 수행한다.\n\n본 계약을 증명하기 위하여 당사자는 아래에 전자서명한다.";
  const draft = await D.createDocument(env.DB, { associationId: org.id, title: "폰에서 배치", body: dbody,
    contentHash: await E.contentHash(dbody), createdBy: null, draft: 1 });
  const admin = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await admin.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await admin.fill('input[name="email"]', "b@h.kr");
  await admin.fill('input[name="password"]', "password1234");
  await Promise.all([admin.waitForNavigation(), admin.locator("form button").first().tap()]);
  await admin.goto(`${BASE}/t/hanbit/admin/documents/${draft.id}/fields`, { waitUntil: "networkidle" });

  const start = await admin.evaluate(() => {
    const s = document.querySelector(".paper-stack");
    return s ? +(+getComputedStyle(s).getPropertyValue("--ps")).toFixed(2) : 0;
  });
  ok(start === 1, "배치 화면은 폰에서 실제 크기로 시작한다 (줄어든 지면에는 못 놓는다)", `배율 ${start}`);

  await admin.tap('.fp-item[data-kind="sign"]').catch(() => {});
  const sheet = admin.locator(".paper").first();
  const pb = await sheet.boundingBox();
  if (pb) await sheet.tap({ position: { x: pb.width * 0.3, y: pb.height * 0.8 } });
  const put = await admin.locator(".paper .pf").count();
  const gb = await admin.locator(".pf-grip").first().boundingBox().catch(() => null);
  ok(put === 1, "지면을 손가락으로 눌러 자리를 놓는다", `${put}개`);
  ok(gb && gb.width >= 20, "크기 손잡이가 손가락에 잡힌다", gb ? `${Math.round(gb.width)}px` : "(없음)");

  await Promise.all([admin.waitForNavigation(), admin.locator(".fp-save button").tap()]);
  ok((await D.countFields(env.DB, draft.id)) === 1, "폰에서 놓은 자리가 저장된다");
  await admin.screenshot({ path: `${OUT}/m6-place.png` });
  await admin.close();
}

await page.screenshot({ path: `${OUT}/m4-full.png`, fullPage: true });
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
console.log(`스크린샷: ${OUT}/`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
