// 모바일 전수조사 — 폰 화면에서 글자가 겹치거나 잘리거나 화면 밖으로 나가는 곳을 전부 찾는다.
//
//   node --experimental-sqlite scripts/mobile-audit.mjs
//   MOB_ALL=1 node --experimental-sqlite scripts/mobile-audit.mjs   # 건수 제한 없이 전부 출력
//   MOB_ONLY=home,admin node ...                                    # 특정 화면만
//
// 왜 이걸 따로 두는가 —— a11y.mjs 는 '읽히는가'(대비·이름표)를 재고, 이건 '겹치는가'를 잰다.
// 둘은 다른 사고다. 라이브에서 업종 칩이 화면 밖으로 삐져나가고 단추가 서로 붙어 보인 적이
// 있는데, 대비 검사는 그걸 잡지 못했다. 사람 눈에는 "버튼이 겹쳐 보인다" 로 보이지만
// 기계에게는 '사각형이 서로 파고들었다' 이므로, 사각형으로 재야 잡힌다.
//
// 검사 6가지:
//   ① 가로 스크롤          — 페이지가 화면보다 넓다
//   ② 화면 밖으로 나감      — 부모는 안 넘는데 자기만 오른쪽으로 삐져나간 칸
//   ③ 글자끼리 겹침        — 남남인 두 글자 상자가 서로 파고듦
//   ④ 글자가 가려짐        — 그 자리를 눌러도 그 글자가 안 잡힘(위에 뭔가 덮여 있음)
//   ⑤ 터치 목표 44px       — 손가락으로 누르기엔 작은 단추
//   ⑥ 글자 잘림            — 칸보다 글이 길어 잘려 나감(말줄임 표시가 없는데도)
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
import { seedDemo, DEMO_PASSWORD } from "../src/demoContent.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = mkdtempSync(path.join(tmpdir(), "mobile-"));
for (const sub of ["css", "js", "img"]) {
  mkdirSync(path.join(DIR, sub), { recursive: true });
  cpSync(path.join(ROOT, "public", sub), path.join(DIR, sub), { recursive: true });
}

// ── 상인회 한 곳을 실제 운영 중인 모습으로 채운다 ──────────────────────────
const env = makeEnv();
const su = await hashPassword("super1234");
await D.createUser(env.DB, { email: "super@e.kr", passwordHash: su.hash, salt: su.salt, name: "운영사", role: "SUPERADMIN", associationId: null });
const m = await D.createAssociation(env.DB, { slug: "market", name: "방배카페골목상인회", kind: "merchant" });
await seedDemo(env, env.DB, m, { emailDomain: "market.kr" });
await D.updateAssociation(env.DB, m.id, {
  name: "방배카페골목상인회", tagline: "커피 한 잔에서 시작하는 골목", brand_color: "#C24310",
  phone: "02-9410-1004", email: "office@market.kr", address: "서울 서초구 방배로 42",
  logo: "", hero_image: "", hero_video: "", naver_verification: "", google_verification: "", ga_measurement_id: "",
});
await D.createPopup(env.DB, { associationId: m.id, title: "여름 골목 야시장이 열립니다",
  body: "8월 15일(금) 저녁 6시부터 10시까지 골목길을 차 없는 거리로 운영합니다.",
  linkUrl: "/t/market/events", linkLabel: "행사 자세히 보기" });
for (const [n, ct, ms] of [
  ["박손님", "010-3333-4444", "주차장이 어디인지 알고 싶습니다."],
  ["최방문", "guest@example.com", "단체로 20명 예약이 되는 가게가 있을까요? 스무 명이 한 번에 앉을 자리가 필요합니다."],
]) await D.createLead(env.DB, { associationId: m.id, name: n, phone: /@/.test(ct) ? "" : ct, email: /@/.test(ct) ? ct : "", message: ms, source: "contact" });
await D.setDuesAmount(env.DB, m.id, 30000);
// 확인 등급이 걸린 안건을 하나씩 만들어 둔다 — 투표 화면의 '문이 닫힌 모습' 도 재어야 한다.
// (등급 0 안건만 있으면 게이트·인증번호 칸이 화면에 아예 나오지 않아 전수조사에서 빠진다)
await D.createPoll(env.DB, { associationId: m.id, title: "회비를 3만 원에서 3만 5천 원으로 올릴까요", verify: 1, createdBy: null });
await D.createPoll(env.DB, { associationId: m.id, title: "정관 제12조 개정 (임원 임기 2년)", verify: 2, createdBy: null });

const ad = await hashPassword("market1234");
await D.createUser(env.DB, { email: "office@market.kr", passwordHash: ad.hash, salt: ad.salt, name: "총무", role: "ADMIN", associationId: m.id });

// 실제 데이터 id 들 (상세 화면 주소를 만들 때 쓴다)
const bizList = (await D.listBusinessesPaged(env.DB, m.id, { perPage: 5 })).rows || [];
const biz = bizList[0];
const notices = await D.listNotices(env.DB, m.id);
const events = await D.listEvents(env.DB, m.id);
const posts = (await D.listPostsPaged(env.DB, m.id, { perPage: 5 }).catch(() => ({}))).rows || [];
const docs = (await D.listDocuments(env.DB, m.id).catch(() => [])) || [];

async function loginAs(email, password) {
  const g = await worker.fetch(new Request("http://localhost/login"), env);
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const lr = await worker.fetch(new Request("http://localhost/login", {
    method: "POST", headers: { cookie: seed, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: tk, email, password }).toString(),
  }), env);
  return [seed, ...(lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");
}
const adminCookie = await loginAs("office@market.kr", "market1234");
// 사장님 계정 — 데모가 만든 첫 가게의 주인으로 들어간다
const ownerRow = await env.DB.prepare("SELECT email FROM users WHERE association_id=? AND role='MERCHANT' AND email!='' ORDER BY id LIMIT 1").bind(m.id).first();
const ownerCookie = ownerRow?.email ? await loginAs(ownerRow.email, DEMO_PASSWORD) : "";
if (!ownerCookie) console.log("   ! 사장님 계정을 못 찾아 회원 화면은 건너뜁니다");

let grabbed = 0;
async function grab(p, file, cookie) {
  const res = await worker.fetch(new Request("http://localhost" + p, {
    headers: { ...(cookie ? { cookie } : {}), "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" },
  }), env);
  const html = (await res.text()).replace(/<link[^>]*jsdelivr[^>]*>/g, "").replace(/\?v=[a-z0-9]+/g, "");
  writeFileSync(path.join(DIR, file), html);
  grabbed++;
  return res.status;
}

// ── 찍을 화면 목록 ────────────────────────────────────────────────────────
// key 는 MOB_ONLY 로 고를 때 쓴다. label 은 사람이 읽는 이름.
const B = "/t/market";
const PAGES = [
  ["home", "홈 (손님 첫 화면)", `${B}`, null],
  ["home-pop", "홈 — 팝업 뜬 상태", `${B}?_pop=1`, null],
  ["list", "가입 점포 목록", `${B}/businesses`, null],
  ["list-cat", "점포 목록 — 업종 고름", `${B}/businesses?cat=${encodeURIComponent("음식점")}`, null],
  ["biz", "가게 페이지", `${B}/business/${biz?.slug || ""}`, null],
  ["map", "점포 지도", `${B}/map`, null],
  ["notices", "공지 목록", `${B}/notices`, null],
  ["notice", "공지 상세", `${B}/notices/${notices[0]?.id || 1}`, null],
  ["events", "행사 목록", `${B}/events`, null],
  ["event", "행사 상세", `${B}/events/${events[0]?.id || 1}`, null],
  ["register", "회원 신청", `${B}/register`, null],
  ["contact", "문의하기", `${B}/contact`, null],
  ["urdeal", "유어딜 안내", `${B}/urdeal`, null],
  ["login", "로그인", `${B}/login`, null],
  // 회원(사장님)
  ["board", "회원 게시판", `${B}/board`, "owner"],
  ["post", "게시글 상세", `${B}/board/${posts[0]?.id || 1}`, "owner"],
  ["polls", "안건 투표", `${B}/polls`, "owner"],
  ["dash", "사장님 내 가게", `${B}/dashboard`, "owner"],
  ["sign", "내 서명 목록", `${B}/sign`, "owner"],
  ["account", "계정 설정", `/account`, "owner"],
  // 관리자
  ["admin", "관리 콘솔", `${B}/admin`, "admin"],
  ["admin-biz", "가게 정보 채우기", `${B}/admin/business/${biz?.id || 1}`, "admin"],
  ["admin-import", "명부로 한 번에 등록", `${B}/admin/members/import`, "admin"],
  ["admin-map", "지도에 한꺼번에 연결", `${B}/admin/members/map`, "admin"],
  ["admin-photos", "지도 사진 한꺼번에", `${B}/admin/members/photos`, "admin"],
  ["admin-links", "사진 요청 링크", `${B}/admin/members/links`, "admin"],
  ["admin-docs", "계약서 목록", `${B}/admin/documents`, "admin"],
  ["admin-write", "계약서 쓰기", `${B}/admin/documents/write`, "admin"],
  ["admin-tpl", "서식", `${B}/admin/templates`, "admin"],
  ["admin-api", "API 연동", `${B}/admin/api`, "admin"],
  ["admin-verify", "투표 자격 대장", `${B}/admin/polls/verify`, "admin"],
];
if (docs[0]) {
  PAGES.push(["admin-doc", "계약 상세", `${B}/admin/documents/${docs[0].id}`, "admin"]);
  PAGES.push(["admin-fields", "서명 자리 놓기", `${B}/admin/documents/${docs[0].id}/fields`, "admin"]);
}

const only = (process.env.MOB_ONLY || "").split(",").filter(Boolean);
const targets = only.length ? PAGES.filter((p) => only.includes(p[0])) : PAGES;
for (const [key, , url, who] of targets) {
  const ck = who === "admin" ? adminCookie : who === "owner" ? ownerCookie : null;
  const st = await grab(url, `${key}.html`, ck);
  if (st >= 400) console.log(`   ! ${key} → HTTP ${st} (${url})`);
}

// ── 정적 서버 ─────────────────────────────────────────────────────────────
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
const srv = http.createServer((req, res) => {
  const f = path.join(DIR, decodeURIComponent(req.url.split("?")[0]));
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const PORT = srv.address().port;

// ── 브라우저에서 도는 검사기 ──────────────────────────────────────────────
const AUDIT = () => {
  const W = window.innerWidth, H = window.innerHeight;
  const out = { outside: [], overlap: [], covered: [], tap: [], clipped: [] };
  const sel = (el) => {
    if (!el || !el.tagName) return "?";
    const id = el.id ? `#${el.id}` : "";
    const cls = (typeof el.className === "string" && el.className.trim())
      ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const txt = (el) => (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30);

  // 정말 눈에 보이는가.
  //
  // ⚠️ 여기가 이 검사기의 핵심이다. 접힌 모바일 메뉴는 `max-height:0; overflow:hidden` 으로
  // 감추는데, 그 안의 링크들은 **여전히 원래 좌표를 그대로 돌려준다**. 조상이 잘라내고
  // 있다는 걸 같이 보지 않으면, 닫혀 있는 메뉴가 본문 위에 겹쳐 있다고 스무 건씩 잘못 짚는다.
  // 화면 낭독기 전용 글(.a11y-only)은 clip-path 로 1px 로 접어 두므로 그것도 안 보이는 것이다.
  const visible = (el) => {
    if (el.closest("svg")) return false;                       // 그림 내부 좌표는 화면 좌표가 아니다
    // 접힌 서랍 속인가 —— 서랍이 겹쳐 있을 때가 문제다. 바깥 서랍이 닫혀 있으면
    // 그 안의 '또 다른 서랍 제목'도 화면에 없다. 가장 안쪽만 보고 넘기면, 닫혀 있는
    // 홈페이지 구성 편집의 줄 제목들이 제품 표 위에 겹쳐 있다고 스무 건씩 잘못 짚는다.
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.tagName === "DETAILS" && !n.hasAttribute("open") && n !== el) {
        const sm = n.querySelector(":scope > summary");
        if (!sm || !sm.contains(el)) return false;
      }
    }
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false;
      if (cs.clipPath && cs.clipPath !== "none") return false;  // .a11y-only 처럼 접어 둔 것
      if (n !== el && /hidden|clip/.test(cs.overflow + cs.overflowY + cs.overflowX)) {
        const pr = n.getBoundingClientRect();
        if (pr.height <= 1 || pr.width <= 1) return false;
        if (r.bottom <= pr.top + 1 || r.top >= pr.bottom - 1) return false;
        if (r.right <= pr.left + 1 || r.left >= pr.right - 1) return false;
      }
    }
    return true;
  };
  // 머리말·하단탭·팝업처럼 본문 위에 겹치라고 만든 층. 층이 다른 둘이 겹치는 건 설계다.
  const layerOf = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.position === "fixed" || cs.position === "sticky" || cs.position === "absolute") return n;
    }
    return null;
  };
  const inScroller = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/auto|scroll/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;
    }
    return false;
  };

  // ② 화면 밖으로 나감 — 부모는 안 넘는데 자기만 넘는 칸(진짜 원인)만 짚는다
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || inScroller(el)) continue;
    const r = el.getBoundingClientRect();
    const par = el.parentElement;
    const pr = par ? par.getBoundingClientRect() : null;
    if (r.right > W + 1 && (!pr || pr.right <= W + 1))
      out.outside.push({ sel: sel(el), text: txt(el), at: Math.round(r.right), w: Math.round(r.width) });
    else if (r.left < -1 && (!pr || pr.left >= -1))
      out.outside.push({ sel: sel(el), text: txt(el), at: Math.round(r.left), w: Math.round(r.width) });
  }

  // ③ 글자끼리 겹침 —— 요소 상자가 아니라 **글자 줄 상자**로 잰다.
  //
  // 요소 상자로 재면 두 가지를 잘못 짚는다: 문장 속 <b> 같은 인라인은 여러 줄을 감싼 큰
  // 사각형이라 옆 낱말과 늘 겹쳐 보이고, 줄 간격이 넉넉한 제목은 글자 없는 여백끼리 닿는다.
  // Range 로 실제 글자가 칠해진 줄만 꺼내면 사람 눈에 겹쳐 보이는 것만 남는다.
  // 글자 줄 상자는 **잘린 뒤의 크기**로 재야 한다. 말줄임(…)으로 접힌 제목은 원래 길이를
  // 그대로 돌려주기 때문에, 그대로 쓰면 이미 고친 자리를 계속 "겹친다" 고 짚는다.
  const clipped = (el, r) => {
    let L = r.left, T = r.top, R = r.right, B = r.bottom;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (!/hidden|clip|auto|scroll/.test(cs.overflow + cs.overflowX + cs.overflowY)) continue;
      const pr = n.getBoundingClientRect();
      L = Math.max(L, pr.left); R = Math.min(R, pr.right);
      T = Math.max(T, pr.top); B = Math.min(B, pr.bottom);
    }
    return { left: L, top: T, right: R, bottom: B, width: R - L, height: B - T };
  };
  const runs = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const t = n.textContent.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || !visible(el)) continue;
    const rg = document.createRange();
    rg.selectNodeContents(n);
    for (const raw of rg.getClientRects()) {
      if (raw.width < 2 || raw.height < 2) continue;
      const r = clipped(el, raw);
      if (r.width < 2 || r.height < 2) continue;
      runs.push({ el, t, r, layer: layerOf(el) });
    }
  }
  const seen = new Set();
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const A = runs[i], B = runs[j];
      if (A.el === B.el || A.el.contains(B.el) || B.el.contains(A.el)) continue;
      if (A.layer !== B.layer) continue;
      const ox = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
      const oy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
      if (ox <= 1 || oy <= 1) continue;
      // 글자 높이의 40% 넘게 파고들어야 사람 눈에 겹쳐 보인다
      if (oy < Math.min(A.r.height, B.r.height) * 0.4) continue;
      if (ox < 3) continue;
      const key = `${sel(A.el)}|${sel(B.el)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.overlap.push({ a: sel(A.el), at: A.t.slice(0, 24), b: sel(B.el), bt: B.t.slice(0, 24), ox: Math.round(ox), oy: Math.round(oy), y: Math.round(Math.min(A.r.top, B.r.top) + window.scrollY) });
    }
  }

  // ④ 글자가 가려짐 — 같은 층의 무언가가 위를 덮어 글자가 안 잡히는 경우
  for (const { el, t, r, layer } of runs) {
    if (r.top < 0 || r.bottom > H) continue;
    const x = Math.round(r.left + Math.min(r.width / 2, 30));
    const y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
    if (getComputedStyle(hit).pointerEvents === "none") continue;
    if (layerOf(hit) !== layer) continue;
    out.covered.push({ sel: sel(el), text: t.slice(0, 24), by: sel(hit), byText: txt(hit), y: Math.round(r.top + window.scrollY) });
  }

  // ⑤ 터치 목표 44px
  const tapSel = "a[href],button,input[type=submit],input[type=button],summary,select,input[type=checkbox],input[type=radio],[role=button]";
  for (const el of document.querySelectorAll(tapSel)) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    // 문장 속 링크는 글줄 높이가 곧 크기다 — 따로 키울 수 없다.
    // flex 칸(체크 상자 줄) 안에서는 display 가 block 으로 바뀌므로, 그것만 보고
    // 판단하면 "개인정보 수집·이용에 동의합니다" 같은 한 문장이 매번 걸린다.
    // 링크 밖에 다른 글자가 같이 있으면 문장 속으로 본다.
    if (el.tagName === "A") {
      if (cs.display === "inline") continue;
      const par = el.parentElement;
      if (par && par.textContent.replace(el.textContent, "").trim().length > 1
          && !/^(li|nav|td|th)$/i.test(par.tagName)) continue;
    }
    let r = el.getBoundingClientRect();
    if (/^(checkbox|radio)$/.test(el.type)) {
      const lab = el.closest("label");
      if (lab) r = lab.getBoundingClientRect();
    }
    const w = Math.round(r.width), h = Math.round(r.height);
    if (w < 44 || h < 44) out.tap.push({ sel: sel(el), text: txt(el) || el.getAttribute("aria-label") || "", w, h });
  }

  // ⑥ 글자 잘림 — 칸보다 글이 긴데 말줄임(…) 없이 그냥 잘린 것
  for (const el of new Set(runs.map((x) => x.el))) {
    const cs = getComputedStyle(el);
    if (cs.overflow === "visible" && cs.overflowX === "visible") continue;
    if (cs.textOverflow === "ellipsis") continue;
    if (/auto|scroll/.test(cs.overflowX)) continue;
    if (el.scrollWidth > el.clientWidth + 2)
      out.clipped.push({ sel: sel(el), text: txt(el), sw: el.scrollWidth, cw: el.clientWidth });
  }
  return out;
};

// ── 실행 ──────────────────────────────────────────────────────────────────
const pwRoot = execSync("npm root -g").toString().trim();
const { chromium } = await import(path.join(pwRoot, "playwright/index.mjs"));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const VIEWPORTS = [
  { label: "아이폰 (390px)", width: 390, height: 844 },
  { label: "갤럭시 (360px)", width: 360, height: 800 },
];
const CAP = process.env.MOB_ALL ? 999 : 4;
let total = 0;
const summary = [];

for (const vp of VIEWPORTS) {
  console.log(`\n\n══════ ${vp.label} ══════`);
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await ctx.newPage();
  page.on("pageerror", () => {});

  for (const [key, label] of targets) {
    await page.goto(`http://127.0.0.1:${PORT}/${key}.html`, { waitUntil: "load" });
    await page.waitForTimeout(160);

    // 콘솔 탭은 한 번에 한 묶음만 보인다 — 묶음마다 펼쳐서 검사한다
    const tabs = await page.evaluate(() => {
      const g = [...document.querySelectorAll(".sgroup")];
      return g.length > 1 ? g.map((x) => x.id || "") : [""];
    });

    const found = { outside: [], overlap: [], covered: [], tap: [], clipped: [] };
    let scrollW = 0;
    for (const tab of tabs) {
      if (tab) await page.evaluate((id) => {
        document.querySelectorAll(".sgroup").forEach((g) => g.classList.toggle("on", g.id === id));
      }, tab);
      await page.waitForTimeout(60);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      scrollW = Math.max(scrollW, sw);
      if (process.env.MOB_CROP && vp.width === 390) {
        const fsx = await import("node:fs");
        const dir = process.env.MOB_CROP;
        fsx.mkdirSync(dir, { recursive: true });
        const pre = await page.evaluate(AUDIT);
        const spots = [...pre.overlap, ...pre.covered].map((x) => x.y).filter((y) => y != null);
        const uniq = [...new Set(spots.map((y) => Math.round(y / 200) * 200))].slice(0, 6);
        for (const y of uniq) {
          await page.evaluate((yy) => window.scrollTo(0, Math.max(0, yy - 120)), y);
          await page.waitForTimeout(80);
          await page.screenshot({ path: path.join(dir, `${key}${tab ? "-" + tab : ""}-y${y}.png`) });
        }
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      if (process.env.MOB_SHOT && vp.width === 390) {
        const fsx = await import("node:fs");
        fsx.mkdirSync(process.env.MOB_SHOT, { recursive: true });
        await page.screenshot({ path: path.join(process.env.MOB_SHOT, `${key}${tab ? "-" + tab : ""}.png`), fullPage: true });
      }
      const r = await page.evaluate(AUDIT);
      for (const k of Object.keys(found)) {
        for (const x of r[k]) found[k].push(tab ? { ...x, tab } : x);
      }
    }
    // 같은 건 두 번 세지 않는다 (탭을 오가며 머리말·바닥글이 되풀이된다)
    for (const k of Object.keys(found)) {
      const seen = new Set();
      found[k] = found[k].filter((x) => {
        const key2 = JSON.stringify({ ...x, tab: undefined });
        if (seen.has(key2)) return false; seen.add(key2); return true;
      });
    }

    const hscroll = scrollW > vp.width + 4;   // body 가 overflow-x:hidden 이라 몇 px 은 밀리지 않는다
    let pushers = [];
    if (hscroll) {
      pushers = await page.evaluate((W) => {
        const out = [];
        document.querySelectorAll("body *").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.right <= W + 1) return;
          const cs = getComputedStyle(el);
          if (cs.position === "fixed") return;
          // 가로로 미는 칸(사이드바·칩 줄) 안은 넘쳐도 문서를 넓히지 않는다 — 범인이 아니다
          for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
            const pcs = getComputedStyle(n);
            if (/auto|scroll|hidden/.test(pcs.overflowX) && n.scrollWidth > n.clientWidth + 1) return;
          }
          const nm = `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
          const chain = []; for (let n = el.parentElement, i = 0; n && n !== document.body && i < 4; n = n.parentElement, i++)
            chain.push(`${n.tagName.toLowerCase()}${typeof n.className === "string" && n.className.trim() ? "." + n.className.trim().split(/\s+/)[0] : ""}`);
          out.push({ nm, right: Math.round(r.right), w: Math.round(r.width), t: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 20), chain: chain.join(" < ") });
        });
        // 가장 깊은(자식이 없는) 것부터 — 진짜 미는 칸은 대개 맨 끝에 있다
        return out.sort((a, b) => b.right - a.right).slice(0, 5);
      }, vp.width);
    }
    const n = found.outside.length + found.overlap.length + found.covered.length + found.tap.length + found.clipped.length + (hscroll ? 1 : 0);
    total += n;
    if (!n) { console.log(`\n■ ${label}   ✓ 이상 없음`); continue; }
    console.log(`\n■ ${label}   ✗ ${n}건`);
    summary.push({ vp: vp.width, label, n });
    if (hscroll) {
      console.log(`   ✗ 가로 스크롤 — 페이지 폭 ${scrollW}px > 화면 ${vp.width}px`);
      pushers.forEach((x) => console.log(`       ${x.nm} → ${x.right}px (폭 ${x.w}) "${x.t}"\n          ↑ ${x.chain}`));
    }
    const show = (name, arr, fmt) => {
      if (!arr.length) return;
      console.log(`   ✗ ${name} — ${arr.length}건`);
      arr.slice(0, CAP).forEach((x) => console.log(`       ${x.tab ? `[${x.tab}] ` : ""}${fmt(x)}`));
      if (arr.length > CAP) console.log(`       … 외 ${arr.length - CAP}건`);
    };
    show("화면 밖으로 나감", found.outside, (x) => `${x.sel} → ${x.at}px (폭 ${x.w}) "${x.text}"`);
    show("글자끼리 겹침", found.overlap, (x) => `${x.a} "${x.at}" ↔ ${x.b} "${x.bt}" (${x.ox}×${x.oy}px, y=${x.y})`);
    show("글자가 가려짐", found.covered, (x) => `${x.sel} "${x.text}" ← ${x.by} "${x.byText}" 가 덮음`);
    show("터치 목표 44px", found.tap, (x) => `${x.w}×${x.h} · ${x.sel} "${x.text}"`);
    show("글자 잘림", found.clipped, (x) => `${x.sel} "${x.text}" (${x.sw}px > ${x.cw}px)`);
  }
  await ctx.close();
}

console.log(`\n\n═══════════════════════════════`);
console.log(`화면 ${targets.length}개 × 폭 ${VIEWPORTS.length}가지 · 합계 ${total}건`);
if (summary.length) {
  console.log("\n많이 나온 화면:");
  summary.sort((a, b) => b.n - a.n).slice(0, 10).forEach((s) => console.log(`   ${s.n}건  ${s.label} (${s.vp}px)`));
}
console.log("");
await browser.close();
srv.close();
