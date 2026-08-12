// 실제 화면 사진 찍기 — 목업이 아니라 워커를 메모리 DB 위에서 돌려 진짜 HTML 을 뽑고,
// 그것을 진짜 Chromium 으로 렌더해 PNG 로 저장한다.
//
//   node --experimental-sqlite scripts/shoot.mjs <출력폴더>
//
// 만드는 것: 랜딩(데스크톱·모바일) · 상담 DB · 랜딩 편집기 · 업종별 랜딩 첫 화면
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import worker from "../src/index.js";
import { makeEnv } from "../test/shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { serializeLandingLayout, defaultLandingLayout } from "../src/franchise.js";
import { PRESETS } from "../src/kinds.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || path.join(ROOT, "__shots");
mkdirSync(OUT, { recursive: true });

// ---- 예시 브랜드 (가상) ----
// 실제 상호를 쓰지 않는다. 남의 브랜드로 화면을 만들면 그 자체가 사칭이 된다.
const BRANDS = {
  franchise: { name: "다뽕고", color: "#e8b400", tel: "1600-9280" },
  academy: { name: "한빛학원", color: "#1f6feb", tel: "02-555-0140" },
  fitness: { name: "바디랩", color: "#111827", tel: "02-3141-7788" },
  clinic: { name: "늘봄의원", color: "#0e7490", tel: "02-2088-3300" },
  realestate: { name: "센트럴파크", color: "#7c3aed", tel: "1533-2200" },
};

async function build(preset) {
  const env = makeEnv();
  const b = BRANDS[preset];
  const su = await hashPassword("preview1234");
  await D.createUser(env.DB, { email: "s@example.kr", passwordHash: su.hash, salt: su.salt, name: "슈퍼", role: "SUPERADMIN", associationId: null });
  const a = await D.createAssociation(env.DB, { slug: "demo", name: b.name, kind: "franchise", preset });
  await D.updateAssociation(env.DB, a.id, {
    name: b.name, tagline: PRESETS[preset]?.tagline || "", brand_color: b.color,
    phone: b.tel, email: "hq@example.kr", address: "서울 서초구 강남대로 1", logo: "", hero_image: "",
  });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "admin@example.kr", passwordHash: ad.hash, salt: ad.salt, name: "본사", role: "ADMIN", associationId: a.id });

  const lay = defaultLandingLayout(b.name, preset).map((s) => {
    if (preset !== "franchise") return s;
    if (s.type === "reviews") return { ...s, items: [
      "혼자서도 돌아가는 매장이라 첫 창업인데도 버틸 수 있었습니다 | 수원 영통점 김○○ 점주",
      "원가가 고정되니 계절이 바뀌어도 마진 계산이 흔들리지 않습니다 | 부산 서면점 이○○ 점주",
      "오픈 첫 주에 슈퍼바이저가 매일 나와 함께 돌려줬습니다 | 대구 동성로점 박○○ 점주",
    ].join("\n") };
    if (s.type === "menu") return { ...s, items: [
      "대표 삼겹살 | 12,000원", "목살 정식 | 13,000원", "된장찌개 | 8,000원", "냉면 | 9,000원",
    ].join("\n") };
    if (s.type === "cost") return { ...s, locked: false, items: [
      "가맹비 | 1,000만원 | 부가세 별도", "교육비 | 300만원 | 2인 기준",
      "인테리어 | 3,300만원 | 33㎡(10평) 기준", "주방 설비 | 1,800만원 | 표준 패키지",
    ].join("\n") };
    if (s.type === "ticker") return { ...s, items: "가맹점 240호점\n창업비용 4,900만원부터\n본사 직영 물류\n1:1 전담 슈퍼바이저" };
    if (s.type === "lead") return { ...s, extras: "희망 오픈 시기 | 선택 | 3개월 내;6개월 내;미정\n보유 점포 유무 | 글 |" };
    return s;
  });
  await D.saveLandingLayout(env.DB, a.id, serializeLandingLayout(lay));
  await D.publishLandingDraft(env.DB, a.id).catch(() => {});

  if (preset === "franchise") {
    const SAMPLE = [
      ["김창업", "010-1234-5678", "수원 영통", "1억원 ~ 2억원", "네이버 검색", "naver", "cpc", "봄모집", "new"],
      ["이점주", "010-2222-3333", "부산 서면", "5천만원 ~ 1억원", "인스타그램·유튜브", "instagram", "feed", "릴스", "called"],
      ["박사장", "010-4444-5555", "대구 동성로", "2억원 이상", "지인 소개", "", "", "", "contract"],
      ["정예비", "010-7777-8888", "인천 구월", "5천만원 이하", "네이버 검색", "naver", "cpc", "봄모집", "visit"],
    ];
    for (const [name, phone, region, budget, funnel, us, um, uc, st] of SAMPLE) {
      const l = await D.createLead(env.DB, { associationId: a.id, name, phone, region, budget, funnel,
        utmSource: us, utmMedium: um, utmCampaign: uc, message: "상권 분석 먼저 받아보고 싶습니다.",
        extra: JSON.stringify({ "희망 오픈 시기": "3개월 내", "보유 점포 유무": "없음" }) });
      if (st !== "new") await D.setLeadStatus(env.DB, l.id, a.id, st).catch(() => {});
    }
    for (let i = 0; i < 140; i++) await D.bumpLandingView(env.DB, a.id, "");
    for (let i = 0; i < 22; i++) await D.bumpLandingCall(env.DB, a.id, "");
  }

  let cookie = "";
  const g = await worker.fetch(new Request("http://localhost/login"), env);
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const lr = await worker.fetch(new Request("http://localhost/login", {
    method: "POST", headers: { cookie: seed, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: tk, email: "admin@example.kr", password: "admin1234" }).toString(),
  }), env);
  cookie = [seed, ...(lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");
  return { env, cookie };
}

// ---- 정적 폴더에 HTML + 자산 심기 ----
const DIR = mkdtempSync(path.join(tmpdir(), "shots-"));
for (const sub of ["css", "js", "img"]) {
  mkdirSync(path.join(DIR, sub), { recursive: true });
  cpSync(path.join(ROOT, "public", sub), path.join(DIR, sub), { recursive: true });
}
async function grab(env, cookie, p, file) {
  const res = await worker.fetch(new Request("http://localhost" + p, {
    headers: { ...(cookie ? { cookie } : {}), "user-agent": "Mozilla/5.0 (Macintosh)" },
  }), env);
  let h = await res.text();
  h = h.replace(/<link[^>]*jsdelivr[^>]*>/g, "").replace(/\?v=[a-z0-9]+/g, "");
  writeFileSync(path.join(DIR, file), h);
  return res.status;
}

const shots = [];
{
  const { env, cookie } = await build("franchise");
  await grab(env, "", "/t/demo", "landing.html");
  await grab(env, cookie, "/t/demo/admin/leads", "leads.html");
  await grab(env, cookie, "/t/demo/admin/landing", "editor.html");
  await grab(env, cookie, "/super", "super.html");
  shots.push(
    { file: "landing.html", out: "01-landing-desktop.png", w: 1280, h: 900, full: true },
    { file: "landing.html", out: "02-landing-mobile.png", w: 390, h: 844, full: true, mobile: true },
    { file: "leads.html", out: "03-leads.png", w: 1440, h: 1000, full: true },
    { file: "editor.html", out: "04-editor.png", w: 1440, h: 1000, full: false },
    { file: "super.html", out: "05-super.png", w: 1440, h: 1000, full: false },
  );
}
for (const preset of ["academy", "fitness", "clinic", "realestate"]) {
  const { env } = await build(preset);
  await grab(env, "", "/t/demo", `${preset}.html`);
  shots.push({ file: `${preset}.html`, out: `06-${preset}.png`, w: 900, h: 720, full: false });
}

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
const srv = http.createServer((req, res) => {
  const f = path.join(DIR, req.url.split("?")[0]);
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const PORT = srv.address().port;

const pwRoot = execSync("npm root -g").toString().trim();
const { chromium } = await import(path.join(pwRoot, "playwright/index.mjs"));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2,
    isMobile: !!s.mobile, hasTouch: !!s.mobile,
    // 스크롤 등장 애니메이션은 뷰포트가 지나가야 켜진다. 전체 페이지 사진에서는
    // 아래 섹션이 opacity:0 인 채로 찍힌다. 제품이 이미 존중하는 접근성 설정을 그대로 쓴다.
    reducedMotion: "reduce",
  });
  const p = await ctx.newPage();
  await p.goto(`http://localhost:${PORT}/${s.file}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, s.out), fullPage: !!s.full });
  await ctx.close();
  console.log("  ✓", s.out);
}
await browser.close();
srv.close();
console.log(`\n${shots.length}장 → ${OUT}`);
