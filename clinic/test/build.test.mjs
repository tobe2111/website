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
