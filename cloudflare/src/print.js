// 3D프린팅 제작 대행 — 유어팀이 직접 받는 견적 문의 · 운영자 견적 관리.
//
// 흐름
//   손님:   /print 에서 STEP·STL 파일을 올린다 → 화면에서 부피·크기를 계산해 '예상 금액 범위'를 바로 본다
//           → 문의를 남긴다 (파일은 R2 에 비공개로 보관).
//   운영자: /super/print 에서 문의를 열고, JLC3DP · Xometry 에서 받은 원가(달러)만 넣으면
//           환율 · 배송 · 관세 · 마진을 붙인 판매가와 회신 메일 문구가 나온다. 진행 상태 · 재주문도 여기서.
//
// 왜 외주 업체 API 를 아직 안 붙였나 (정직한 한계)
//   - JLC3DP: JLC 개발자 플랫폼의 3D프린팅 API 로 견적 · 주문이 되지만 '주문 이력'을 보고 승인한다.
//     승인이 나면 운영자 화면의 '원가 입력' 칸을 API 조회로 바꾸면 된다(quoteCalc 는 그대로 쓴다).
//   - Xometry: 공개 개발자 API 는 '제작 파트너(공급사)' 용이라, 주문하는 쪽의 견적 · 주문 API 가 없다.
//     그래서 운영자가 사이트에서 직접 견적을 받는 방식으로만 쓴다.
//   - 화면의 금액은 '예상 범위'다. 확정 금액은 운영자가 원가를 넣고 회신한다.
//     단가표(아래 DEFAULT_PRICING)는 운영자 화면에서 실제 원가에 맞춰 고친다.
//
// ⚠️ /service(홈페이지 제작 판매 사이트)에 걸지 않는다 — 그 사이트는 결제대행사 심사용이라
//    '견적 문의'와 다른 상품이 섞이면 안 된다. 이 화면은 /print 에 따로 둔다.
//
// 파일 보관: R2 키를 'print/…' 로 둔다. 공개 미디어 경로(/media/)는 키에서 '/' 를 지우므로
// 이 파일들은 주소를 알아도 밖에서 열리지 않는다. 운영자 화면에서만 내려받는다.
import { esc, kstStamp } from "./util.js";
import { layout, flash, assetUrl } from "./render.js";
import { html, redirect, notFoundResponse } from "./http.js";
import { BIZ } from "./homepageSite.js";
import * as D from "./db.js";

// ── 재질 · 단가표 ────────────────────────────────────────────────────────
// rate = 손님에게 보이는 예상가의 cm³ 당 원(마진 포함), min = 부품 1개 최소 금액.
// 처음 값은 임시값이다. 실제 원가가 쌓이면 운영자 화면(단가 설정)에서 고친다.
export const MATERIALS = {
  pla:   { label: "PLA",              proc: "FDM", density: 1.24, rate: 150, min: 3000, maxMm: 250,
           note: "가장 많이 쓰는 재질입니다. 저렴하고 깔끔하지만 충격과 열(50℃ 이상)에 약합니다." },
  petg:  { label: "PETG",             proc: "FDM", density: 1.27, rate: 170, min: 3000, maxMm: 250,
           note: "PLA보다 질기고 잘 안 부러집니다. 클립·고리처럼 휘어야 하는 부품에 맞습니다." },
  abs:   { label: "ABS · ASA",        proc: "FDM", density: 1.05, rate: 190, min: 3500, maxMm: 250,
           note: "열과 충격에 강합니다. ASA는 햇빛에도 강해서 바깥에 두는 부품에 씁니다." },
  pa12:  { label: "나일론 PA12 (MJF)", proc: "MJF", density: 1.01, rate: 480, min: 5000, maxMm: 380,
           note: "산업용 분말 방식입니다. 튼튼하고 표면이 고르며, 작은 부품을 많이 만들 때 유리합니다." },
  resin: { label: "레진 (SLA)",        proc: "SLA", density: 1.15, rate: 320, min: 4000, maxMm: 400,
           note: "표면이 매끈하고 정밀합니다. 외형 확인용 시제품, 피규어에 씁니다." },
};
export const COLORS = ["블랙", "화이트", "그레이", "기타 (요청사항에 적어 주세요)"];
export const DEADLINES = ["급함 (1주 이내)", "보통 (2~3주)", "여유 있음 (한 달 이상)"];

export const DEFAULT_PRICING = {
  rates: Object.fromEntries(Object.entries(MATERIALS).map(([k, m]) => [k, { rate: m.rate, min: m.min }])),
  shipping: 20000,          // 문의 1건당 기본 배송 · 통관비(원) — 예상가에 더한다
  tiers: [[1, 1], [20, 0.92], [100, 0.85], [500, 0.78]],   // 같은 부품 수량별 할인
  // 운영자 견적 계산의 기본값
  fx: 1400, dutyPct: 18, domesticKrw: 4000, marginPct: 35,
};

const PRICING_KEY = "print_pricing";
export async function getPricing(db) {
  let saved = {};
  try { saved = JSON.parse((await D.getSetting(db, PRICING_KEY)) || "{}") || {}; } catch { saved = {}; }
  const p = { ...DEFAULT_PRICING, ...saved };
  p.rates = { ...DEFAULT_PRICING.rates };
  for (const k of Object.keys(MATERIALS)) {
    const r = saved.rates && saved.rates[k];
    if (r) p.rates[k] = { rate: num(r.rate, p.rates[k].rate), min: num(r.min, p.rates[k].min) };
  }
  if (!Array.isArray(p.tiers)) p.tiers = DEFAULT_PRICING.tiers;
  return p;
}

function num(v, fallback = 0) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
}
const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const roundUp = (n, step) => Math.ceil(n / step) * step;

// ── 계산 (순수 함수 — 시험이 직접 부른다) ────────────────────────────────

// 같은 부품 수량에 따른 할인율
export function tierFactor(qty, tiers = DEFAULT_PRICING.tiers) {
  let f = 1;
  for (const [n, k] of tiers) if (qty >= n) f = k;
  return f;
}

// 손님 화면의 예상가. parts: [{ volume (cm³), qty }]. 부피를 모르는 부품은 계산에서 빠지고 unknown 으로 센다.
export function estimate(parts, material, pricing = DEFAULT_PRICING) {
  const r = (pricing.rates && pricing.rates[material]) || DEFAULT_PRICING.rates[material] || DEFAULT_PRICING.rates.pla;
  let sum = 0, unknown = 0;
  const lines = parts.map((p) => {
    const qty = Math.max(1, Math.floor(num(p.qty, 1)));
    const v = num(p.volume, 0);
    if (!(v > 0)) { unknown++; return { qty, unit: 0, line: 0 }; }
    const unit = Math.max(r.min, v * r.rate) * tierFactor(qty, pricing.tiers);
    sum += unit * qty;
    return { qty, unit, line: unit * qty };
  });
  if (sum <= 0) return { lines, unknown, low: 0, high: 0 };
  const base = sum + num(pricing.shipping, 0);
  return { lines, unknown, low: roundUp(base * 0.85, 1000), high: roundUp(base * 1.2, 1000) };
}

// 운영자 견적: 외주 원가(달러)에 배송 · 관세 · 마진을 붙여 부품별 판매 단가를 낸다.
// 배송비 · 국내 택배비는 원가 비율대로 나눠 싣는다. 단가는 10원 단위로 올린다.
export function quoteCalc({ files, fx, shipUsd = 0, dutyPct = 0, domesticKrw = 0, marginPct = 0 }) {
  const costs = files.map((f) => Math.max(0, num(f.costUsd, 0)));
  const total = costs.reduce((a, b) => a + b, 0);
  if (!(total > 0) || !(num(fx) > 0)) return null;
  let landedSum = 0, priceSum = 0;
  const lines = files.map((f, i) => {
    const qty = Math.max(1, Math.floor(num(f.qty, 1)));
    const share = costs[i] / total;
    const landed = (costs[i] + num(shipUsd) * share) * num(fx) * (1 + num(dutyPct) / 100) + num(domesticKrw) * share;
    const unit = roundUp((landed * (1 + num(marginPct) / 100)) / qty, 10);
    landedSum += landed; priceSum += unit * qty;
    return { qty, landed: Math.round(landed), unit, line: unit * qty };
  });
  return { lines, cost: Math.round(landedSum), total: priceSum, profit: Math.round(priceSum - landedSum) };
}

// STL 부피(cm³)와 크기(mm). 이진 · 글자 형식 둘 다. 못 읽으면 null.
// 닫힌 표면의 삼각형마다 원점과 만드는 사면체 부피를 더한다(부호 있는 부피의 합 = 물체 부피).
export function stlGeometry(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  let v = 0, tris = 0;
  const tri = (a, b, c) => {
    for (const p of [a, b, c]) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; }
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    tris++;
  };
  if (u8.length >= 84) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === u8.length) {
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        const p = (j) => [dv.getFloat32(o + j * 12, true), dv.getFloat32(o + j * 12 + 4, true), dv.getFloat32(o + j * 12 + 8, true)];
        tri(p(0), p(1), p(2));
      }
    }
  }
  if (!tris) {
    const txt = new TextDecoder().decode(u8.subarray(0, Math.min(u8.length, 80 * 1024 * 1024)));
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    let m, buf = [];
    while ((m = re.exec(txt))) {
      buf.push([+m[1], +m[2], +m[3]]);
      if (buf.length === 3) { tri(buf[0], buf[1], buf[2]); buf = []; }
    }
  }
  if (!tris || !Number.isFinite(v)) return null;
  const size = mx.map((x, k) => Math.round((x - mn[k]) * 10) / 10);
  return { volume: Math.round(Math.abs(v) / 10) / 100, size, tris };
}

// 손님 브라우저가 계산해 보낸 값은 믿지 않고 숫자 범위만 확인한다(예상가 참고용).
export function cleanGeo(raw) {
  try {
    const g = JSON.parse(String(raw || ""));
    const v = num(g.volume, 0);
    const size = Array.isArray(g.size) ? g.size.slice(0, 3).map((x) => num(x, 0)) : [];
    if (!(v > 0 && v < 1e7) || size.length !== 3 || size.some((x) => !(x >= 0 && x < 1e5))) return null;
    return { volume: Math.round(v * 100) / 100, size: size.map((x) => Math.round(x * 10) / 10) };
  } catch { return null; }
}

// ── 저장소 ──────────────────────────────────────────────────────────────
export const STATUSES = {
  new: "접수", quoted: "견적 발송", ordered: "업체 발주", making: "제작 중", shipping: "배송 중", done: "완료", canceled: "취소",
};
const ALLOWED_EXT = ["stl", "step", "stp", "3mf", "obj"];
const MAX_FILES = 10, MAX_FILE_BYTES = 50 * 1024 * 1024;

function makeCode() {
  const d = new Date(Date.now() + 9 * 3600e3);
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const a = new Uint8Array(4); crypto.getRandomValues(a);
  return `P${ymd}-${[...a].map((x) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join("")}`;
}

async function insertRequest(db, r) {
  const res = await db.prepare(`INSERT INTO print_requests (code, name, company, phone, email, material, color, deadline, memo, est_low, est_high, parent_id, ip)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(r.code, r.name, r.company, r.phone, r.email, r.material, r.color, r.deadline, r.memo,
    r.estLow, r.estHigh, r.parentId || null, r.ip || "").run();
  const id = res.meta && res.meta.last_row_id;
  for (const f of r.files) {
    await db.prepare(`INSERT INTO print_files (request_id, filename, r2_key, size, qty, volume, size_mm, cost_usd)
      VALUES (?,?,?,?,?,?,?,?)`).bind(id, f.filename, f.key || "", f.bytes || 0, f.qty, f.volume || 0, f.size ? f.size.join("x") : "", f.costUsd || 0).run();
  }
  return id;
}
const getRequest = (db, id) => db.prepare("SELECT * FROM print_requests WHERE id=?").bind(id).first();
const listFiles = async (db, id) => ((await db.prepare("SELECT * FROM print_files WHERE request_id=? ORDER BY id").bind(id).all()).results || []);

// ── 손님 화면 ───────────────────────────────────────────────────────────
function shell(title, desc, body, { noindex = false, scripts = "" } = {}) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : ""}
<meta property="og:type" content="website">
<meta property="og:site_name" content="유어팀 3D프린팅">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta name="theme-color" content="#ffffff">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="${assetUrl("/css/hp.css")}">
<link rel="stylesheet" href="${assetUrl("/css/print.css")}">
<script defer src="${assetUrl("/js/hp.js")}"></script>
${scripts}
</head>
<body>
<a class="skip" href="#main">본문으로 건너뛰기</a>
<header class="hd" data-hd>
  <div class="hd__in">
    <a class="logo" href="/print" style="font-size:20px;font-weight:700;letter-spacing:-.03em;white-space:nowrap">유어팀<span style="font-weight:500;color:var(--muted);margin-left:6px">3D프린팅</span></a>
    <nav class="nav" aria-label="주 메뉴">
      <a href="/print#quote">견적 받기</a>
      <a href="/print#materials">재질 안내</a>
      <a href="/print#faq">자주 묻는 질문</a>
    </nav>
    <a class="btn btn--blue hd__cta" href="/print#quote">파일 올리기</a>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="ft">
  <div class="wrap ft__in">
    <div class="ft__brand">
      <a class="logo" href="/print" style="font-size:22px;font-weight:700;color:#fff">유어팀<span style="font-weight:500;opacity:.7;margin-left:6px">3D프린팅</span></a>
      <p>시제품 · 부품 3D프린팅 제작 대행</p>
    </div>
    <address class="ft__info">
      <b>상호 ${esc(BIZ.name)}</b>
      <span>대표자 ${esc(BIZ.ceo)}</span><span>사업자등록번호 ${esc(BIZ.bizNo)}</span>
      <span>사업장 소재지 ${esc(BIZ.address)}</span>
      <span>대표번호 <a href="tel:${esc(BIZ.phone)}">${esc(BIZ.phone)}</a></span>
      <span>이메일 <a href="mailto:${esc(BIZ.email)}">${esc(BIZ.email)}</a></span>
    </address>
    <p class="ft__copy"><a href="/service/privacy">개인정보처리방침</a> · © ${new Date().getUTCFullYear()} ${esc(BIZ.name)}.</p>
  </div>
</footer>
</body>
</html>`;
}

const htmlRes = (body, headers = {}) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers } });

export async function printLanding(ctx) {
  const { db, csrf, env, query } = ctx;
  const pricing = await getPricing(db);
  const { turnstileWidget, turnstileScript } = await import("./turnstile.js");
  const msg = query.get("msg");
  // 화면 계산에 필요한 것만 넘긴다(운영자용 환율 · 마진 기본값은 빼고).
  const pub = { rates: pricing.rates, shipping: pricing.shipping, tiers: pricing.tiers,
    materials: Object.fromEntries(Object.entries(MATERIALS).map(([k, m]) => [k, { label: m.label, density: m.density, maxMm: m.maxMm }])) };
  const body = `<section class="pr-hero">
  <div class="wrap">
    <p class="eyebrow">3D프린팅 제작 대행</p>
    <h1 class="h1">파일을 올리면<br>예상 금액이 바로 나옵니다</h1>
    <p class="lead">STEP이나 STL 파일을 올려 주세요. 크기와 무게를 계산해서 대략 얼마가 드는지 바로 보여드립니다.
      정확한 견적은 담당자가 파일을 확인하고 영업일 하루 안에 보내드립니다.</p>
  </div>
</section>

<section class="sec sec--tight" id="quote">
  <div class="wrap pr-grid">
    <form class="form pr-form" method="post" action="/print" enctype="multipart/form-data" data-print-form data-pricing="${esc(JSON.stringify(pub))}">
      <input type="hidden" name="_csrf" value="${esc(csrf || "")}">
      ${msg ? `<p class="pr-alert${query.get("err") ? " pr-alert--err" : ""}" role="alert">${esc(msg)}</p>` : ""}
      <p class="fstep"><i>1</i>도면 파일</p>
      <label class="pr-drop">
        <input type="file" name="files" multiple required accept=".stl,.step,.stp,.3mf,.obj" data-print-files>
        <b>파일 선택</b>
        <span>STEP · STP · STL · 3MF · OBJ, 한 번에 ${MAX_FILES}개까지, 파일당 50MB까지</span>
      </label>
      <div class="pr-files" data-print-list hidden></div>

      <p class="fstep"><i>2</i>재질과 색상</p>
      <label>재질
        <select name="material" data-print-material>
          ${Object.entries(MATERIALS).map(([k, m]) => `<option value="${k}">${esc(m.label)}</option>`).join("")}
        </select>
      </label>
      <p class="pr-note" data-print-mnote>${esc(MATERIALS.pla.note)}</p>
      <fieldset class="chips">
        <legend>색상</legend>
        ${COLORS.map((c, i) => `<label><input type="radio" name="color" value="${esc(c)}"${i === 0 ? " checked" : ""}><span>${esc(c.replace(/ \(.*\)$/, ""))}</span></label>`).join("")}
      </fieldset>
      <fieldset class="chips">
        <legend>납기</legend>
        ${DEADLINES.map((c, i) => `<label><input type="radio" name="deadline" value="${esc(c)}"${i === 1 ? " checked" : ""}><span>${esc(c)}</span></label>`).join("")}
      </fieldset>

      <p class="fstep"><i>3</i>연락받으실 곳</p>
      <label>이름<input type="text" name="name" maxlength="60" required autocomplete="name"></label>
      <label>회사명 <small>(선택)</small><input type="text" name="company" maxlength="100" autocomplete="organization"></label>
      <label>휴대폰 번호<input type="tel" name="phone" maxlength="20" required autocomplete="tel" inputmode="tel" placeholder="010-0000-0000"></label>
      <label>이메일 <small>(견적서를 받으실 주소)</small><input type="email" name="email" maxlength="120" required autocomplete="email"></label>
      <label>요청사항 <small>(선택)</small><textarea name="memo" rows="4" maxlength="2000" placeholder="용도, 조립되는 부분, 공차, 후가공, 정기 주문 여부 등"></textarea></label>
      <label class="agree"><input type="checkbox" name="agree" value="1" required>
        <span>견적과 제작을 위해 이름·연락처·파일을 받는 데 동의합니다. 파일은 견적과 제작 외에는 쓰지 않습니다. <b aria-hidden="true">*</b></span></label>
      ${turnstileWidget(env)}
      <button class="btn btn--blue btn--lg btn--block" type="submit">견적 요청 보내기</button>
    </form>

    <aside class="pr-est" aria-live="polite" data-print-est>
      <p class="pr-est__k">예상 금액</p>
      <p class="pr-est__v" data-print-total>파일을 올리면 계산됩니다</p>
      <p class="pr-est__s" data-print-sub>부가세 별도 · 배송비 포함</p>
      <ul class="pr-est__list" data-print-lines></ul>
      <p class="pr-est__warn" data-print-warn hidden></p>
      <p class="pr-est__fine">화면의 금액은 부피로 계산한 참고용입니다. 모양, 후가공, 수량에 따라 달라지며 정확한 금액은 견적서로 알려드립니다.</p>
    </aside>
  </div>
</section>

<section class="sec" id="steps">
  <div class="wrap">
    <h2 class="h2">진행 순서</h2>
    <ol class="pr-steps">
      <li><b>파일 접수</b><span>올려주신 파일로 크기와 제작 가능 여부를 확인합니다.</span></li>
      <li><b>견적서 발송</b><span>영업일 하루 안에 메일로 금액과 납기를 보내드립니다.</span></li>
      <li><b>제작</b><span>확정하시면 제작에 들어갑니다. 보통 1~2주 걸립니다.</span></li>
      <li><b>검수 · 배송</b><span>받은 물건을 확인하고 택배로 보내드립니다.</span></li>
    </ol>
  </div>
</section>

<section class="sec sec--tight" id="materials">
  <div class="wrap">
    <h2 class="h2">재질 안내</h2>
    <div class="pr-mats">
      ${Object.values(MATERIALS).map((m) => `<div class="pr-mat"><b>${esc(m.label)}</b><span class="pr-mat__p">${esc(m.proc)}</span><p>${esc(m.note)}</p></div>`).join("")}
    </div>
  </div>
</section>

<section class="sec" id="faq">
  <div class="wrap wrap--narrow">
    <h2 class="h2">자주 묻는 질문</h2>
    <details class="pr-faq"><summary>파일이 없으면 어떻게 하나요?</summary><p>사진이나 치수를 적은 그림을 요청사항에 설명해 주시면 모델링이 가능한지 먼저 확인해 드립니다. 이 경우 모델링 비용이 따로 듭니다.</p></details>
    <details class="pr-faq"><summary>수량이 많으면 싸지나요?</summary><p>같은 부품이 20개 이상이면 단가가 내려갑니다. 정기적으로 같은 부품을 주문하시면 같은 단가로 다시 만들어 드립니다.</p></details>
    <details class="pr-faq"><summary>기존 샘플과 똑같이 만들 수 있나요?</summary><p>샘플의 재질, 색상, 출력 방식을 알려주시면 맞춰서 진행합니다. 조건이 더 나은 재질이 있으면 견적서에 함께 적어 드립니다.</p></details>
    <details class="pr-faq"><summary>올린 파일은 안전한가요?</summary><p>파일은 외부에 공개되지 않는 저장소에 보관하고, 견적과 제작에만 씁니다.</p></details>
  </div>
</section>${turnstileScript(env)}`;
  const res = htmlRes(shell("3D프린팅 제작 견적 | 유어팀", "STEP·STL 파일을 올리면 예상 금액을 바로 보여드립니다. 시제품, 부품 3D프린팅 제작 대행.", body,
    { scripts: `<script defer src="${assetUrl("/js/print-quote.js")}"></script>` }));
  // STEP 파일은 별도 작업자(public/js/vendor/occt/step-worker.js)가 읽는다 — 이 화면의 보안 정책은 그대로다.
  return res;
}

export async function printDone(ctx) {
  const code = String(ctx.query.get("c") || "").replace(/[^A-Z0-9-]/g, "").slice(0, 20);
  const body = `<section class="pr-hero"><div class="wrap wrap--narrow">
    <p class="eyebrow">접수 완료</p>
    <h1 class="h1">견적 요청을 받았습니다</h1>
    <p class="lead">접수 번호 <b>${esc(code || "-")}</b><br>파일을 확인하고 영업일 하루 안에 메일로 견적서를 보내드립니다.
      급하시면 <a href="tel:${esc(BIZ.phone)}">${esc(BIZ.phone)}</a>로 전화 주세요.</p>
    <p><a class="btn btn--blue" href="/print">처음으로</a></p>
  </div></section>`;
  return htmlRes(shell("접수 완료 | 유어팀 3D프린팅", "견적 요청이 접수되었습니다.", body, { noindex: true }));
}

// 같은 IP 에서 10분에 5건까지 — 파일이 커서 한 번에 쏟아지면 저장소가 찬다
const hits = new Map();
function tooMany(ip) {
  const now = Date.now(), r = hits.get(ip);
  if (!r || now - r.t > 10 * 60 * 1000) { hits.set(ip, { t: now, n: 1 }); if (hits.size > 5000) hits.clear(); return false; }
  r.n++;
  return r.n > 5;
}

export async function printSubmit(ctx) {
  const { db, env, form, ip } = ctx;
  const back = (m) => redirect(`/print?err=1&msg=${encodeURIComponent(m)}#quote`);
  if (tooMany(ip)) return back("잠시 후 다시 시도해 주세요.");
  const { turnstileVerify } = await import("./turnstile.js");
  if (!(await turnstileVerify(env, form.get("cf-turnstile-response"), ip))) return back("봇 방지 확인에 실패했습니다. 다시 시도해 주세요.");
  const s = (k, n) => String(form.get(k) || "").trim().slice(0, n);
  const name = s("name", 60), phone = s("phone", 20), email = s("email", 120);
  if (!name || !phone || !email) return back("이름, 휴대폰 번호, 이메일을 적어 주세요.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return back("이메일 주소를 확인해 주세요.");
  if (form.get("agree") !== "1") return back("개인정보 수집에 동의해 주세요.");
  const material = MATERIALS[form.get("material")] ? String(form.get("material")) : "pla";
  const color = COLORS.includes(form.get("color")) ? String(form.get("color")) : COLORS[0];
  const deadline = DEADLINES.includes(form.get("deadline")) ? String(form.get("deadline")) : DEADLINES[1];

  const uploads = form.getAll("files").filter((f) => f && typeof f === "object" && f.size > 0);
  if (!uploads.length) return back("도면 파일을 올려 주세요.");
  if (uploads.length > MAX_FILES) return back(`파일은 한 번에 ${MAX_FILES}개까지 올릴 수 있습니다.`);
  const files = [];
  for (let i = 0; i < uploads.length; i++) {
    const f = uploads[i];
    const filename = String(f.name || `file${i + 1}`).replace(/[\\/\r\n"]/g, "_").slice(0, 120);
    const ext = (filename.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return back(`${filename}: STEP, STL, 3MF, OBJ 파일만 받습니다.`);
    if (f.size > MAX_FILE_BYTES) return back(`${filename}: 파일당 50MB까지 올릴 수 있습니다.`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    // STL 은 서버가 직접 잰다. STEP 등은 손님 화면이 잰 값을 범위만 확인해 참고로 둔다.
    const geo = ext === "stl" ? stlGeometry(bytes) : cleanGeo(form.get(`geo_${i}`));
    const qty = Math.min(100000, Math.max(1, parseInt(form.get(`qty_${i}`), 10) || 1));
    let key = "";
    if (env.MEDIA) {
      const a = new Uint8Array(12); crypto.getRandomValues(a);
      key = `print/${[...a].map((x) => x.toString(16).padStart(2, "0")).join("")}.${ext}`;
      await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { filename: encodeURIComponent(filename) } });
    }
    files.push({ filename, key, bytes: f.size, qty, volume: geo ? geo.volume : 0, size: geo ? geo.size : null });
  }
  const pricing = await getPricing(db);
  const est = estimate(files, material, pricing);
  const code = makeCode();
  await insertRequest(db, { code, name, company: s("company", 100), phone, email, material, color, deadline, memo: s("memo", 2000),
    estLow: est.low, estHigh: est.high, ip, files });

  // 운영자에게 알림 메일(설정돼 있을 때만). 실패해도 접수는 끝난 것이다.
  try {
    const to = (await D.getSetting(db, "print_notify_email")) || (await D.getSetting(db, "contact_email")) || "";
    if (to) {
      const { sendEmail } = await import("./email.js");
      const lines = files.map((f) => `${esc(f.filename)} × ${f.qty}`).join("<br>");
      await sendEmail(env, { to, subject: `[3D프린팅 문의] ${name} · ${code}`,
        html: `<p>${esc(name)} ${esc(s("company", 100))} · ${esc(phone)} · ${esc(email)}</p><p>${esc(MATERIALS[material].label)} / ${esc(color)} / ${esc(deadline)}</p><p>${lines}</p>
          <p>예상가 ${est.low ? `${won(est.low)} ~ ${won(est.high)}` : "계산 못 함"}</p><p><a href="${esc(ctx.url.origin)}/super/print">운영자 화면에서 보기</a></p>` });
    }
  } catch {}
  return redirect(`/print/done?c=${encodeURIComponent(code)}`);
}

// ── 운영자 화면 ─────────────────────────────────────────────────────────
const badge = (st) => `<span class="badge ${st === "done" ? "badge-ok" : st === "canceled" ? "badge-muted" : st === "new" ? "badge-wait" : "badge-ok"}">${esc(STATUSES[st] || st)}</span>`;
const adminShell = (ctx, title, inner) => html(layout({ title, console: "super", user: ctx.user, csrf: ctx.csrf,
  scripts: `<script src="${assetUrl("/js/print-admin.js")}" defer></script>`,
  // 이 화면 몇 개만 쓰는 배치라 app.css(6천 줄)에 넣지 않고 여기 둔다
  body: `<style>.pr-calc{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin:16px 0}
.pr-calc label{display:grid;gap:4px;font-size:14px}.pr-tabs{display:flex;flex-wrap:wrap;gap:6px}.pr-kpi{margin:8px 0 20px}
.pr-mail{width:100%;font:inherit;font-size:14px;line-height:1.7;padding:12px}
form.panel>label{display:grid;gap:4px;margin:8px 0}form.panel>label textarea{width:100%}</style>
<section class="dash dash-shell"><div class="container">${inner}</div></section>` }));
const flashQ = (q) => (q.get("msg") ? flash(q.get("msg"), q.get("err") ? "err" : "ok") : "");

export async function superPrintList(ctx) {
  const { db, query } = ctx;
  const st = STATUSES[query.get("s")] ? query.get("s") : "";
  const rows = ((await db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM print_files f WHERE f.request_id=r.id) AS nfiles
    FROM print_requests r ${st ? "WHERE r.status=?" : ""} ORDER BY r.id DESC LIMIT 200`).bind(...(st ? [st] : [])).all()).results) || [];
  const counts = Object.fromEntries((((await db.prepare("SELECT status, COUNT(*) AS n FROM print_requests GROUP BY status").all()).results) || []).map((r) => [r.status, r.n]));
  const tabs = [["", "전체", Object.values(counts).reduce((a, b) => a + b, 0)], ...Object.entries(STATUSES).map(([k, v]) => [k, v, counts[k] || 0])]
    .map(([k, label, n]) => `<a class="btn btn-sm ${k === st ? "btn-primary" : "btn-outline"}" href="/super/print${k ? `?s=${k}` : ""}">${esc(label)} ${n}</a>`).join(" ");
  const table = rows.length ? `<div class="table-scroll"><table class="admin-table"><thead><tr>
      <th>접수</th><th>고객</th><th>재질</th><th>파일</th><th>예상가</th><th>견적가</th><th>상태</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><a href="/super/print/${r.id}"><b>${esc(r.code)}</b></a><br><small>${esc(kstStamp(r.created_at))}</small></td>
        <td>${esc(r.name)}${r.company ? `<br><small>${esc(r.company)}</small>` : ""}</td>
        <td>${esc((MATERIALS[r.material] || {}).label || r.material)}<br><small>${esc(r.color)}</small></td>
        <td>${r.nfiles}개</td>
        <td>${r.est_low ? `${won(r.est_low)}~<br>${won(r.est_high)}` : "-"}</td>
        <td>${r.quote_total ? won(r.quote_total) : "-"}</td>
        <td>${badge(r.status)}${r.parent_id ? ' <span class="badge badge-muted">재주문</span>' : ""}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="panel-hint">아직 들어온 문의가 없습니다. 고객용 화면: <a href="/print" target="_blank" rel="noopener">/print</a></p>`;
  return adminShell(ctx, "3D프린팅 문의", `<div class="dash-head"><div><h1 class="dash-title">3D프린팅 문의</h1>
      <p class="dash-sub">고객 화면 <a href="/print" target="_blank" rel="noopener">/print ↗</a> 에서 들어온 견적 요청입니다</p></div>
      <div class="dash-head-actions"><a class="btn btn-outline btn-sm" href="/super/print/settings">단가 설정</a> <a class="btn btn-outline btn-sm" href="/super">운영사 콘솔</a></div></div>
    ${flashQ(query)}
    <p class="pr-tabs">${tabs}</p>
    <section class="panel">${table}</section>`);
}

function fileRows(files, material, editable) {
  const m = MATERIALS[material] || MATERIALS.pla;
  return files.map((f, i) => {
    const w = f.volume ? Math.round(f.volume * m.density * 10) / 10 : 0;
    const big = f.size_mm && f.size_mm.split("x").some((x) => num(x) > m.maxMm);
    return `<tr><td><a href="/super/print/${f.request_id}/file/${f.id}">${esc(f.filename)}</a><br><small>${Math.round(f.size / 1024).toLocaleString("ko-KR")}KB</small></td>
      <td>${f.qty.toLocaleString("ko-KR")}개</td>
      <td>${f.size_mm ? `${esc(f.size_mm.replace(/x/g, " × "))} mm` : "-"}${big ? ' <span class="badge badge-wait">큼</span>' : ""}</td>
      <td>${f.volume ? `${f.volume.toLocaleString("ko-KR")} cm³<br><small>약 ${w.toLocaleString("ko-KR")}g (${esc(m.label)})</small>` : "-"}</td>
      <td>${editable ? `<input type="number" name="cost_${f.id}" step="0.01" min="0" value="${f.cost_usd || ""}" placeholder="0.00" style="width:7em" aria-label="${esc(f.filename)} 원가(달러)">` : (f.cost_usd ? `$${f.cost_usd}` : "-")}</td>
      <td>${f.unit_price ? `${won(f.unit_price)}<br><small>합 ${won(f.unit_price * f.qty)}</small>` : "-"}</td></tr>`;
  }).join("");
}

// 회신 메일 초안 — 꾸밈 없이, 사람이 쓴 것처럼.
export function quoteEmailText(r, files, calc, pricing = DEFAULT_PRICING) {
  const m = MATERIALS[r.material] || MATERIALS.pla;
  const lines = files.map((f, i) => ` - ${f.filename.replace(/\.[^.]+$/, "")}: ${calc ? won(calc.lines[i].unit) : "[   ]원"} × ${f.qty.toLocaleString("ko-KR")}개${calc ? ` = ${won(calc.lines[i].line)}` : ""}`).join("\n");
  return `제목: [견적] 3D프린팅 제작 견적 드립니다 (${r.code})

안녕하세요, ${BIZ.name}입니다.
보내주신 파일 확인했고 견적 드립니다.

1. 견적 (${m.label}, ${r.color})
${lines}
 - 합계: ${calc ? won(calc.total) : "[   ]원"} (VAT 별도, 배송비 포함)

2. 납기: 발주 후 약 2~3주

${r.memo ? "요청하신 내용 확인했습니다. 진행하면서 문제가 될 부분이 있으면 미리 연락드리겠습니다.\n" : ""}수량이 바뀌거나 재질을 바꿔 보고 싶으시면 말씀 주세요. 다시 계산해 드리겠습니다.
추가 제작은 수량만 알려주시면 같은 사양으로 진행하겠습니다.

감사합니다.
${BIZ.name} 드림
${BIZ.phone}`;
}

export async function superPrintDetail(ctx) {
  const { db, params, query, csrf } = ctx;
  const r = await getRequest(db, parseInt(params.id, 10) || 0);
  if (!r) return notFoundResponse(ctx);
  const files = await listFiles(db, r.id);
  const pricing = await getPricing(db);
  const v = (k, d) => (r[k] != null && r[k] !== 0 && r[k] !== "" ? r[k] : d);
  const calc = files.some((f) => f.cost_usd > 0) ? quoteCalc({ files: files.map((f) => ({ qty: f.qty, costUsd: f.cost_usd })),
    fx: v("fx", pricing.fx), shipUsd: r.ship_usd || 0, dutyPct: v("duty_pct", pricing.dutyPct), domesticKrw: v("domestic_krw", pricing.domesticKrw), marginPct: v("margin_pct", pricing.marginPct) }) : null;
  const m = MATERIALS[r.material] || MATERIALS.pla;
  const parent = r.parent_id ? await getRequest(db, r.parent_id) : null;
  const inner = `<div class="dash-head"><div><h1 class="dash-title">${esc(r.code)} ${badge(r.status)}</h1>
      <p class="dash-sub">${esc(kstStamp(r.created_at))} 접수${parent ? ` · <a href="/super/print/${parent.id}">${esc(parent.code)}</a> 재주문` : ""}</p></div>
      <div class="dash-head-actions"><a class="btn btn-outline btn-sm" href="/super/print">목록</a></div></div>
    ${flashQ(query)}
    <section class="panel"><h2 class="panel-title">고객</h2>
      <p><b>${esc(r.name)}</b> ${esc(r.company)} · <a href="tel:${esc(r.phone)}">${esc(r.phone)}</a> · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a></p>
      <p>${esc(m.label)} · ${esc(r.color)} · ${esc(r.deadline)}</p>
      ${r.memo ? `<p style="white-space:pre-wrap;background:var(--surface-2,#f5f7fa);padding:12px;border-radius:8px">${esc(r.memo)}</p>` : ""}
      <p class="panel-hint">고객 화면 예상가: ${r.est_low ? `${won(r.est_low)} ~ ${won(r.est_high)}` : "계산 못 함 (부피를 모르는 파일)"}</p>
    </section>

    <form class="panel" method="post" action="/super/print/${r.id}">
      <input type="hidden" name="_csrf" value="${esc(csrf)}">
      <h2 class="panel-title">원가 넣고 견적 계산</h2>
      <p class="panel-hint">아래 버튼으로 외주 업체 견적 화면을 열고, 파일을 올려 나온 <b>제작비(달러, 그 수량 합계)</b>를 파일별로 적으세요.
        <a href="https://jlc3dp.com/kr" target="_blank" rel="noopener">JLC3DP 견적 ↗</a> ·
        <a href="https://xometry.asia/zh-hans/" target="_blank" rel="noopener">Xometry 견적 ↗</a></p>
      <div class="table-scroll"><table class="admin-table"><thead><tr><th>파일</th><th>수량</th><th>크기</th><th>부피 · 무게</th><th>원가(달러, 합계)</th><th>판매 단가</th></tr></thead>
        <tbody>${fileRows(files, r.material, true)}</tbody></table></div>
      <div class="pr-calc">
        <label>외주 업체<select name="vendor">${["JLC3DP", "Xometry", "직접 출력"].map((x) => `<option${r.vendor === x ? " selected" : ""}>${x}</option>`).join("")}</select></label>
        <label>국제 배송비(달러)<input type="number" step="0.01" min="0" name="ship_usd" value="${r.ship_usd || ""}" placeholder="0"></label>
        <label>환율(원/달러)<input type="number" step="1" min="1" name="fx" value="${v("fx", pricing.fx)}"></label>
        <label>관세·부가세(%)<input type="number" step="0.1" min="0" name="duty_pct" value="${v("duty_pct", pricing.dutyPct)}"></label>
        <label>국내 택배비(원)<input type="number" step="100" min="0" name="domestic_krw" value="${v("domestic_krw", pricing.domesticKrw)}"></label>
        <label>마진(%)<input type="number" step="1" min="0" name="margin_pct" value="${v("margin_pct", pricing.marginPct)}"></label>
      </div>
      ${calc ? `<div class="kpi-grid pr-kpi">
        <div class="kpi"><span class="kpi-k">고객 견적가</span><b class="kpi-v">${won(calc.total)}</b></div>
        <div class="kpi"><span class="kpi-k">들어가는 돈</span><b class="kpi-v">${won(calc.cost)}</b></div>
        <div class="kpi"><span class="kpi-k">남는 돈</span><b class="kpi-v">${won(calc.profit)}</b></div></div>` : ""}

      <h2 class="panel-title">진행 상태</h2>
      <div class="pr-calc">
        <label>상태<select name="status">${Object.entries(STATUSES).map(([k, l]) => `<option value="${k}"${r.status === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>업체 주문번호<input type="text" name="vendor_order_no" maxlength="80" value="${esc(r.vendor_order_no || "")}"></label>
        <label>운송장 번호<input type="text" name="tracking_no" maxlength="80" value="${esc(r.tracking_no || "")}"></label>
      </div>
      <label>메모 (고객에게 안 보임)<textarea name="admin_memo" rows="3" maxlength="4000">${esc(r.admin_memo || "")}</textarea></label>
      <p><button class="btn btn-primary">저장하고 다시 계산</button></p>
    </form>

    <section class="panel"><h2 class="panel-title">회신 메일 초안</h2>
      <p class="panel-hint">${calc ? "계산된 금액이 들어가 있습니다. 필요한 곳만 고쳐서 보내세요." : "원가를 넣고 저장하면 금액이 채워집니다."}</p>
      <textarea class="pr-mail" rows="20" readonly data-print-mail>${esc(quoteEmailText(r, files, calc, pricing))}</textarea>
      <p><button type="button" class="btn btn-outline btn-sm" data-print-copy>복사하기</button>
        <a class="btn btn-outline btn-sm" href="mailto:${esc(r.email)}?subject=${encodeURIComponent(`[견적] 3D프린팅 제작 견적 드립니다 (${r.code})`)}">메일 앱 열기</a></p>
    </section>

    <form class="panel" method="post" action="/super/print/${r.id}/reorder">
      <input type="hidden" name="_csrf" value="${esc(csrf)}">
      <h2 class="panel-title">재주문</h2>
      <p class="panel-hint">같은 고객 · 같은 파일 · 같은 원가로 새 건을 만듭니다. 수량만 바꾸면 됩니다.</p>
      <button class="btn btn-outline btn-sm">이 건으로 재주문 만들기</button>
    </form>`;
  return adminShell(ctx, `${r.code} · 3D프린팅`, inner);
}

export async function superPrintUpdate(ctx) {
  const { db, params, form } = ctx;
  const r = await getRequest(db, parseInt(params.id, 10) || 0);
  if (!r) return notFoundResponse(ctx);
  const files = await listFiles(db, r.id);
  const pricing = await getPricing(db);
  const n = (k, d = 0) => Math.max(0, num(form.get(k), d));
  const costs = files.map((f) => Math.round(n(`cost_${f.id}`) * 100) / 100);
  const opts = { fx: n("fx", pricing.fx) || pricing.fx, shipUsd: n("ship_usd"), dutyPct: n("duty_pct"), domesticKrw: n("domestic_krw"), marginPct: n("margin_pct") };
  const calc = quoteCalc({ files: files.map((f, i) => ({ qty: f.qty, costUsd: costs[i] })), ...opts });
  for (let i = 0; i < files.length; i++) {
    await db.prepare("UPDATE print_files SET cost_usd=?, unit_price=? WHERE id=?").bind(costs[i], calc ? calc.lines[i].unit : 0, files[i].id).run();
  }
  const status = STATUSES[form.get("status")] ? String(form.get("status")) : r.status;
  const vendor = ["JLC3DP", "Xometry", "직접 출력"].includes(form.get("vendor")) ? String(form.get("vendor")) : r.vendor;
  const s = (k, len) => String(form.get(k) || "").trim().slice(0, len);
  await db.prepare(`UPDATE print_requests SET status=?, vendor=?, fx=?, ship_usd=?, duty_pct=?, domestic_krw=?, margin_pct=?, quote_total=?,
      vendor_order_no=?, tracking_no=?, admin_memo=?, updated_at=datetime('now') WHERE id=?`)
    .bind(status, vendor, opts.fx, opts.shipUsd, opts.dutyPct, opts.domesticKrw, opts.marginPct, calc ? calc.total : 0,
      s("vendor_order_no", 80), s("tracking_no", 80), s("admin_memo", 4000), r.id).run();
  return redirect(`/super/print/${r.id}?msg=${encodeURIComponent(calc ? `저장했습니다. 견적가 ${won(calc.total)}` : "저장했습니다. 원가를 넣으면 견적가가 계산됩니다.")}`);
}

export async function superPrintReorder(ctx) {
  const { db, params, ip } = ctx;
  const r = await getRequest(db, parseInt(params.id, 10) || 0);
  if (!r) return notFoundResponse(ctx);
  const files = await listFiles(db, r.id);
  const pricing = await getPricing(db);
  const parts = files.map((f) => ({ filename: f.filename, key: f.r2_key, bytes: f.size, qty: f.qty, volume: f.volume,
    size: f.size_mm ? f.size_mm.split("x").map(Number) : null, costUsd: f.cost_usd }));
  const est = estimate(parts, r.material, pricing);
  const id = await insertRequest(db, { code: makeCode(), name: r.name, company: r.company, phone: r.phone, email: r.email, material: r.material,
    color: r.color, deadline: r.deadline, memo: r.memo, estLow: est.low, estHigh: est.high, parentId: r.id, ip, files: parts });
  await db.prepare("UPDATE print_requests SET vendor=?, fx=?, ship_usd=?, duty_pct=?, domestic_krw=?, margin_pct=? WHERE id=?")
    .bind(r.vendor || "", r.fx || 0, r.ship_usd || 0, r.duty_pct || 0, r.domestic_krw || 0, r.margin_pct || 0, id).run();
  return redirect(`/super/print/${id}?msg=${encodeURIComponent("재주문 건을 만들었습니다. 원가가 그대로 들어 있으니 수량이 바뀌었으면 원가를 다시 받아 넣으세요.")}`);
}

export async function superPrintFile(ctx) {
  const { db, env, params } = ctx;
  const f = await db.prepare("SELECT * FROM print_files WHERE id=? AND request_id=?").bind(parseInt(params.fid, 10) || 0, parseInt(params.id, 10) || 0).first();
  if (!f || !f.r2_key || !env.MEDIA) return notFoundResponse(ctx);
  const obj = await env.MEDIA.get(f.r2_key);
  if (!obj) return notFoundResponse(ctx);
  return new Response(obj.body, { headers: { "content-type": "application/octet-stream", "cache-control": "private, no-store",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}` } });
}

export async function superPrintSettings(ctx) {
  const { db, query, csrf } = ctx;
  const p = await getPricing(db);
  const notify = (await D.getSetting(db, "print_notify_email")) || "";
  const inner = `<div class="dash-head"><div><h1 class="dash-title">3D프린팅 단가 설정</h1>
      <p class="dash-sub">고객 화면의 예상가와 견적 계산 기본값입니다</p></div>
      <div class="dash-head-actions"><a class="btn btn-outline btn-sm" href="/super/print">문의 목록</a></div></div>
    ${flashQ(query)}
    <form class="panel" method="post" action="/super/print/settings">
      <input type="hidden" name="_csrf" value="${esc(csrf)}">
      <h2 class="panel-title">재질별 예상 단가 (고객 화면)</h2>
      <p class="panel-hint">예상가 = 부품 1개당 max(최소 금액, 부피 cm³ × 단가) × 수량 할인 × 수량 + 기본 배송비. 화면에는 이 값의 85%~120% 범위로 보입니다.
        <b>처음 값은 임시값입니다.</b> 실제 견적을 몇 건 해 보고 맞추세요.</p>
      <div class="table-scroll"><table class="admin-table"><thead><tr><th>재질</th><th>단가(원/cm³)</th><th>부품 1개 최소(원)</th></tr></thead><tbody>
        ${Object.entries(MATERIALS).map(([k, m]) => `<tr><td>${esc(m.label)}</td>
          <td><input type="number" name="rate_${k}" min="0" step="1" value="${p.rates[k].rate}" style="width:7em"></td>
          <td><input type="number" name="min_${k}" min="0" step="100" value="${p.rates[k].min}" style="width:8em"></td></tr>`).join("")}
      </tbody></table></div>
      <div class="pr-calc">
        <label>기본 배송·통관비(원, 문의 1건당)<input type="number" name="shipping" min="0" step="1000" value="${p.shipping}"></label>
      </div>
      <h2 class="panel-title">견적 계산 기본값 (운영자 화면)</h2>
      <div class="pr-calc">
        <label>환율(원/달러)<input type="number" name="fx" min="1" step="1" value="${p.fx}"></label>
        <label>관세·부가세(%)<input type="number" name="dutyPct" min="0" step="0.1" value="${p.dutyPct}"></label>
        <label>국내 택배비(원)<input type="number" name="domesticKrw" min="0" step="100" value="${p.domesticKrw}"></label>
        <label>마진(%)<input type="number" name="marginPct" min="0" step="1" value="${p.marginPct}"></label>
      </div>
      <h2 class="panel-title">새 문의 알림</h2>
      <label>알림 받을 이메일 <small>(메일 발송 설정이 켜져 있을 때만 갑니다)</small><input type="email" name="notify_email" maxlength="120" value="${esc(notify)}"></label>
      <p><button class="btn btn-primary">저장</button></p>
    </form>`;
  return adminShell(ctx, "3D프린팅 단가 설정", inner);
}

export async function superPrintSettingsSave(ctx) {
  const { db, form } = ctx;
  const n = (k, d) => { const v = num(form.get(k), NaN); return Number.isFinite(v) && v >= 0 ? v : d; };
  const cur = await getPricing(db);
  const next = {
    rates: Object.fromEntries(Object.keys(MATERIALS).map((k) => [k, { rate: n(`rate_${k}`, cur.rates[k].rate), min: n(`min_${k}`, cur.rates[k].min) }])),
    shipping: n("shipping", cur.shipping), tiers: cur.tiers,
    fx: n("fx", cur.fx) || cur.fx, dutyPct: n("dutyPct", cur.dutyPct), domesticKrw: n("domesticKrw", cur.domesticKrw), marginPct: n("marginPct", cur.marginPct),
  };
  await D.setSetting(db, PRICING_KEY, JSON.stringify(next));
  const mail = String(form.get("notify_email") || "").trim().slice(0, 120);
  await D.setSetting(db, "print_notify_email", /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) ? mail : "");
  return redirect(`/super/print/settings?msg=${encodeURIComponent("저장했습니다.")}`);
}
