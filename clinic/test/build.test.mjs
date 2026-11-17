// 병원 홈페이지 빌더 검사 — 브라우저 없이 돈다.
//   node --test clinic/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../build.mjs";
import { lintText, lintTree } from "../lib/adlint.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = mkdtempSync(path.join(tmpdir(), "clinic-"));
const { pages } = build("cheonsaem", { outDir: OUT });
const htmlOf = (p) => readFileSync(path.join(OUT, p === "/" ? "index.html" : `${p}index.html`), "utf8");
const all = () => {
  const out = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const x = path.join(d, f); statSync(x).isDirectory() ? walk(x) : f.endsWith(".html") && out.push(x); } };
  walk(OUT);
  return out;
};

test("모든 페이지에 검색용 제목·설명·대표 주소·h1 하나가 있다", () => {
  const titles = new Set();
  for (const p of pages) {
    const h = htmlOf(p);
    const title = (/<title>([^<]+)<\/title>/.exec(h) || [])[1];
    assert.ok(title, `${p}: 제목`);
    assert.ok(!titles.has(title), `${p}: 제목이 다른 페이지와 겹친다 — ${title}`);
    titles.add(title);
    const desc = (/<meta name="description" content="([^"]*)"/.exec(h) || [])[1] || "";
    assert.ok(desc.length >= 20 && desc.length <= 160, `${p}: 설명 길이 ${desc.length}`);
    assert.match(h, new RegExp(`<link rel="canonical" href="[^"]+${p.replace(/\//g, "\\/")}"`), `${p}: 대표 주소`);
    assert.equal((h.match(/<h1[\s>]/g) || []).length, 1, `${p}: h1 은 하나`);
    assert.match(h, /<html lang="ko">/);
  }
});

test("검색엔진용 정보(JSON-LD)가 모두 올바른 JSON 이고, 병원·진료 페이지에 맞는 종류다", () => {
  for (const p of pages) for (const m of htmlOf(p).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  const types = (p) => [...htmlOf(p).matchAll(/"@type":"([A-Za-z]+)"/g)].map((m) => m[1]);
  assert.ok(types("/").includes("MedicalClinic"));
  assert.ok(types("/").includes("OpeningHoursSpecification"));
  const t = types("/treatments/herniated-disc/");
  for (const need of ["MedicalWebPage", "MedicalCondition", "FAQPage", "BreadcrumbList", "Physician"]) assert.ok(t.includes(need), `진료 페이지에 ${need}`);
});

test("사이트 안 링크가 전부 실제 페이지로 간다", () => {
  for (const f of all()) {
    for (const m of readFileSync(f, "utf8").matchAll(/href="(\/[^"#?]*)/g)) {
      const u = m[1];
      if (u.startsWith("/assets/") || u === "/favicon.svg") { assert.ok(existsSync(path.join(OUT, u)), `${u}`); continue; }
      const target = u.endsWith("/") ? path.join(OUT, u, "index.html") : path.join(OUT, u);
      assert.ok(existsSync(target), `${path.relative(OUT, f)} → ${u} 가 없다`);
    }
  }
});

test("사이트 지도·크롤러 안내·AI 검색 안내가 만들어진다", () => {
  const sm = readFileSync(path.join(OUT, "sitemap.xml"), "utf8");
  assert.ok((sm.match(/<loc>/g) || []).length >= pages.length - 1);
  assert.doesNotMatch(sm, /privacy/, "개인정보처리방침은 사이트 지도에서 뺀다");
  assert.match(readFileSync(path.join(OUT, "robots.txt"), "utf8"), /Sitemap: https?:\/\//);
  const llms = readFileSync(path.join(OUT, "llms.txt"), "utf8");
  assert.match(llms, /^# 천샘정형외과/);
  assert.match(llms, /허리디스크/);
});

test("진료 페이지는 증상 → 원인 → 진단 → 치료 → 회복 → 자주 묻는 질문 순서다", () => {
  const h = htmlOf("/treatments/herniated-disc/");
  const order = ["symptoms", "causes", "diagnosis", "treatment", "recovery", "faq"].map((id) => h.indexOf(`<section id="${id}"`));
  assert.ok(order.every((x) => x > 0), "여섯 구역이 다 있다");
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(h, /감수했습니다/, "감수 의사가 적혀 있다");
});

test("의료광고 금지 표현을 잡아낸다", () => {
  for (const bad of ["국내 최고의 의료진", "허리 통증 완치", "부작용 없는 시술", "시술 전후 사진", "환자 후기", "도수치료 50% 할인", "지역 1위 병원"])
    assert.ok(lintText(bad).length, `"${bad}" 를 잡아야 한다`);
  for (const ok of ["통증의 원인을 먼저 찾습니다", "치료 후 하루 이틀 뻐근함이 있을 수 있습니다", "식사 후 복용하세요"])
    assert.equal(lintText(ok).length, 0, `"${ok}" 는 통과해야 한다`);
  const hits = lintTree({ treatments: [{ slug: "x", faq: [["q", "100% 낫습니다"]] }] });
  assert.match(hits[0].where, /treatments\[0\].*faq/, "어느 칸인지 알려준다");
});

test("금지 표현이 원고에 있으면 빌드가 멈춘다", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "clinic-bad-"));
  const sites = path.join(ROOT, "sites");
  const id = "__lint_probe";
  mkdirSync(path.join(sites, id), { recursive: true });
  try {
    cpSync(path.join(sites, "cheonsaem"), path.join(sites, id), { recursive: true });
    const f = path.join(sites, id, "site.json");
    const s = JSON.parse(readFileSync(f, "utf8"));
    s.tagline = "강남 최고의 정형외과";
    writeFileSync(f, JSON.stringify(s));
    assert.throws(() => build(id, { outDir: tmp }), /의료광고 금지 표현/);
  } finally {
    rmSync(path.join(sites, id), { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("상담 신청 주소가 없으면 신청 단추를 잠그고 전화로 안내한다", () => {
  const h = htmlOf("/reservation/");
  assert.match(h, /온라인 접수는 준비 중/);
  assert.match(h, /type="submit" disabled/);
  assert.match(h, /href="tel:/);
});

test("두 번째 모양(견본 B)은 같은 원고로 다른 배치·글꼴을 쓴다", () => {
  const out = mkdtempSync(path.join(tmpdir(), "clinic-b-"));
  try {
    const r = build("sample-b", { outDir: out });
    assert.equal(r.pages.length, pages.length, "원고를 빌려 와도 페이지 수는 같다");
    const h = readFileSync(path.join(out, "index.html"), "utf8");
    assert.match(h, /<body class="t-serif L-b">/);
    assert.match(h, /class="hero hero-ed"/);
    assert.match(h, /Noto\+Serif\+KR/);
    assert.doesNotMatch(htmlOf("/"), /Noto\+Serif\+KR/, "고딕 병원은 명조 글꼴을 받지 않는다");
  } finally { rmSync(out, { recursive: true, force: true }); }
});

// 원고를 빌려 쓰는 사이트에 원래 병원 이름이 남으면, 남의 병원 이름을 단 홈페이지가 된다
test("한 병원 사이트에 다른 병원 이름이 섞이지 않는다", () => {
  const out = mkdtempSync(path.join(tmpdir(), "clinic-b2-"));
  try {
    build("sample-b", { outDir: out });
    const walk = (d) => readdirSync(d).flatMap((f) => { const x = path.join(d, f); return statSync(x).isDirectory() ? walk(x) : [x]; });
    for (const f of walk(out).filter((f) => /\.(html|txt|xml)$/.test(f)))
      assert.doesNotMatch(readFileSync(f, "utf8"), /천샘/, path.relative(out, f));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("견적서 기준 25페이지를 채운다", () => {
  assert.ok(pages.length >= 25, `지금 ${pages.length}페이지`);
});

// 사진 자동 압축은 ffmpeg 가 있는 컴퓨터에서만 돈다. 없으면 이 검사는 건너뛴다(빌드는 원본으로 계속된다).
import { hasFfmpeg } from "../lib/media.mjs";
import { execFileSync } from "node:child_process";
test("사진을 넣으면 휴대폰·PC 크기의 WebP 를 만들고, 화면이 맞는 것을 고르게 한다", { skip: !hasFfmpeg() && "ffmpeg 없음" }, () => {
  const sites = path.join(ROOT, "sites");
  const id = "__media_probe";
  const out = mkdtempSync(path.join(tmpdir(), "clinic-media-"));
  try {
    cpSync(path.join(sites, "cheonsaem"), path.join(sites, id), { recursive: true });
    mkdirSync(path.join(sites, id, "media"), { recursive: true });
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=2000x1000", "-frames:v", "1", path.join(sites, id, "media", "hero.jpg")]);
    const f = path.join(sites, id, "site.json");
    const s = JSON.parse(readFileSync(f, "utf8"));
    s.hero.image.src = "/media/hero.jpg";
    writeFileSync(f, JSON.stringify(s));
    build(id, { outDir: out });
    for (const w of [640, 1280, 1920]) assert.ok(existsSync(path.join(out, "media", `hero-${w}.webp`)), `${w}px`);
    assert.ok(!existsSync(path.join(out, "media", "hero-2560.webp")), "원본(2000px)보다 큰 폭은 만들지 않는다");
    assert.ok(statSync(path.join(out, "media", "hero-640.webp")).size < statSync(path.join(out, "media", "hero.jpg")).size, "작은 폭이 원본보다 가볍다");
    const h = readFileSync(path.join(out, "index.html"), "utf8");
    assert.match(h, /type="image\/webp" srcset="\/media\/hero-640\.webp 640w, \/media\/hero-1280\.webp 1280w/);
    assert.match(h, /<img src="\/media\/hero\.jpg"[^>]*width="2000" height="1000"/, "크기를 적어 두어 화면이 덜컥이지 않는다");
  } finally {
    rmSync(path.join(sites, id), { recursive: true, force: true });
    rmSync(path.join(ROOT, ".cache", id), { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

// 숫자 띠는 의료광고에 걸리지 않는 사실만 — 원고에서 바로 세는 수와 진료 시간.
// 환자 수·치료 건수·만족도·재방문율 같은 숫자는 심의 대상이라 자동으로 만들면 안 된다.
test("한눈에 보는 사실은 원고에서 센 것만 보여준다", () => {
  const h = htmlOf("/");
  const band = (/<dl class="facts">[\s\S]*?<\/dl>/.exec(h) || [""])[0];
  assert.ok(band, "숫자 띠가 있다");
  const treatments = JSON.parse(readFileSync(path.join(ROOT, "sites", "cheonsaem", "treatments.json"), "utf8"));
  assert.match(band, new RegExp(`data-count="${treatments.length}"`), "진료 안내 수 = 원고의 진료 수");
  assert.doesNotMatch(band, /환자|만족|재방문|건수|치료 성공|%/, "효과·실적 숫자를 만들지 않는다");
  assert.match(h, /class="tbar tbar-dark" data-today data-tbar/, "첫 화면에 오늘 진료 시간 막대");
  // 빌드 때는 평일 기준으로 칠해 둔다 — 평일 09:00~18:30, 점심 13:00~14:00 이면 구간이 둘
  assert.equal((h.match(/class="seg"/g) || []).length, 2, "점심시간은 빈칸으로 나뉜다");
});

test("건강 칼럼: 글 페이지·목록·검색 정보가 만들어지고, 진료 페이지와 서로 잇는다", () => {
  const h = htmlOf("/column/herniated-disc-surgery/");
  assert.match(h, /"@type":"BlogPosting"/);
  assert.match(h, /href="\/treatments\/herniated-disc\/"/, "칼럼 → 관련 진료");
  assert.match(h, /<h2 id="s1">/, "소제목에 목차용 주소");
  assert.match(htmlOf("/treatments/herniated-disc/"), /href="\/column\/herniated-disc-surgery\/"/, "진료 → 관련 칼럼");
  assert.match(htmlOf("/column/"), /frozen-shoulder-stretch/);
  assert.match(readFileSync(path.join(OUT, "sitemap.xml"), "utf8"), /\/column\/herniated-disc-surgery\//);
  assert.match(readFileSync(path.join(OUT, "llms.txt"), "utf8"), /## 건강 칼럼/);
});

test("칼럼 원고의 꺾쇠는 화면을 깨지 않고, 금지 표현은 칼럼에서도 걸린다", async () => {
  const { renderMarkdown } = await import("../lib/md.mjs");
  const { html } = renderMarkdown("<script>alert(1)</script> **굵게**\n\n- 하나\n- 둘\n\n> 주의");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<strong>굵게<\/strong>/);
  assert.match(html, /<ul><li>하나<\/li><li>둘<\/li><\/ul>/);
  assert.match(html, /<aside class="note">/);
  const sites = path.join(ROOT, "sites"), id = "__col_probe", tmp = mkdtempSync(path.join(tmpdir(), "clinic-col-"));
  try {
    cpSync(path.join(sites, "cheonsaem"), path.join(sites, id), { recursive: true });
    writeFileSync(path.join(sites, id, "columns", "bad.md"), "---\ntitle: 테스트\n---\n이 시술은 통증을 완치합니다.");
    assert.throws(() => build(id, { outDir: tmp }), /의료광고 금지 표현/);
  } finally {
    rmSync(path.join(sites, id), { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  }
});
