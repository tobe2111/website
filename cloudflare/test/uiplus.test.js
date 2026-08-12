// UI 고도화: 검색 자동완성·공지 공유·지오코딩 마크업·JSON-LD·보안 헤더
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const B = "http://localhost";

async function seed(env) {
  const su = await hashPassword("super1234");
  await D.createUser(env.DB, { email: "s@p.kr", passwordHash: su.hash, salt: su.salt, name: "슈퍼", role: "SUPERADMIN", associationId: null });
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "서초구 상인회" });
  const pw = await hashPassword("merchant1234");
  const u = await D.createUser(env.DB, { email: "m@x.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "홍가네분식", category: "음식점", description: "떡볶이" });
  await D.updateBusiness(env.DB, b.id, { name: "홍가네분식", category: "음식점", description: "떡볶이", phone: "02-555-1234", address: "서울 서초구 서초대로 123", hours: "매일 10-21", lat: 37.49, lng: 127.01 });
  await D.setBusinessStatus(env.DB, b.id, "approved");
  const n = await D.createNotice(env.DB, { associationId: a.id, title: "총회 안내", body: "본문", tag: "공지" });
  return { a, b: await D.getBusinessById(env.DB, b.id), n };
}

test("홈 검색 자동완성: 승인 업체명이 datalist 로 렌더", async () => {
  const env = makeEnv();
  await seed(env);
  const h = await (await worker.fetch(new Request(B + "/t/seocho"), env)).text();
  assert.match(h, /list="storeSuggest"/);
  assert.match(h, /<datalist id="storeSuggest"><option value="홍가네분식"><\/option>/);
});

test("가게 페이지: LocalBusiness JSON-LD + 좌표·전화 포함", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const h = await (await worker.fetch(new Request(B + `/t/seocho/business/${encodeURIComponent(b.slug)}`), env)).text();
  assert.match(h, /application\/ld\+json/);
  const ld = JSON.parse(/<script type="application\/ld\+json">(.+?)<\/script>/s.exec(h)[1]);
  const biz = ld.find((x) => x["@type"] === "LocalBusiness");
  assert.equal(biz.name, "홍가네분식");
  assert.equal(biz.telephone, "02-555-1234");
  assert.equal(biz.geo.latitude, 37.49);
  assert.ok(ld.find((x) => x["@type"] === "BreadcrumbList"));
});

test("공지 상세: 공유 버튼 + share.js 로드", async () => {
  const env = makeEnv();
  const { n } = await seed(env);
  const h = await (await worker.fetch(new Request(B + `/t/seocho/notices/${n.id}`), env)).text();
  assert.match(h, /data-share/);
  assert.match(h, /js\/share\.js/);
});

test("보안·성능 헤더: HSTS + Speculation-Rules + 전용 MIME 서빙", async () => {
  const env = makeEnv();
  await seed(env);
  const r = await worker.fetch(new Request(B + "/t/seocho"), env);
  assert.equal(r.headers.get("Strict-Transport-Security"), "max-age=31536000");
  assert.equal(r.headers.get("Speculation-Rules"), '"/speculationrules.json"');
  const sr = await worker.fetch(new Request(B + "/speculationrules.json"), env);
  assert.equal(sr.headers.get("content-type"), "application/speculationrules+json");
  const rules = await sr.json();
  assert.ok(rules.prefetch && rules.prefetch.length);
});

test("대시보드: 주소로 찾기(geocoder) UI + 서브모듈 로드", async () => {
  const env = makeEnv({ NAVER_MAP_CLIENT_ID: "testkey", NAVER_MAP_PARAM: "ncpKeyId" });
  await seed(env);
  const jar = {};
  const ch = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  const absorb = (r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); } };
  let r = await worker.fetch(new Request(B + "/login"), env); absorb(r);
  const t = (/name="_csrf" value="([^"]+)"/.exec(await r.text()) || [])[1];
  r = await worker.fetch(new Request(B + "/login", { method: "POST", headers: { cookie: ch(), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, email: "m@x.kr", password: "merchant1234" }).toString() }), env);
  absorb(r);
  const h = await (await worker.fetch(new Request(B + "/t/seocho/dashboard", { headers: { cookie: ch() } }), env)).text();
  assert.match(h, /id="geoBtn"/);
  assert.match(h, /submodules=geocoder/);
});

test("공지 RSS 피드: rel=alternate 발견 + 유효 XML + 항목 포함", async () => {
  const env = makeEnv();
  const { n } = await seed(env);
  const home = await (await worker.fetch(new Request(B + "/t/seocho"), env)).text();
  assert.match(home, /rel="alternate" type="application\/rss\+xml"[^>]*href="\/t\/seocho\/feed\.xml"/);
  const r = await worker.fetch(new Request(B + "/t/seocho/feed.xml"), env);
  assert.equal(r.headers.get("content-type"), "application/rss+xml; charset=utf-8");
  const xml = await r.text();
  assert.match(xml, /<rss version="2.0">/);
  assert.match(xml, /<title>총회 안내<\/title>/);
  assert.match(xml, new RegExp(`/t/seocho/notices/${n.id}</link>`));
});

test("검색엔진 소유 확인 메타: 관리자 저장 → 모든 테넌트 페이지에 출력", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@s.kr", passwordHash: ad.hash, salt: ad.salt, name: "관리자", role: "ADMIN", associationId: a.id });
  const jar = {};
  const ch = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  const absorb = (r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); } };
  let r = await worker.fetch(new Request(B + "/login"), env); absorb(r);
  let t = (/name="_csrf" value="([^"]+)"/.exec(await r.text()) || [])[1];
  r = await worker.fetch(new Request(B + "/login", { method: "POST", headers: { cookie: ch(), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, email: "a@s.kr", password: "admin1234" }).toString() }), env);
  absorb(r);
  r = await worker.fetch(new Request(B + "/t/seocho/admin", { headers: { cookie: ch() } }), env);
  t = (/name="_csrf" value="([^"]+)"/.exec(await r.text()) || [])[1];
  // multipart 폼이지만 urlencoded 도 파싱됨 (로고 없이)
  r = await worker.fetch(new Request(B + "/t/seocho/admin/settings", { method: "POST", headers: { cookie: ch(), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, name: "서초구 상인회", tagline: "", brand_color: "#0b6e4f", phone: "", email: "", address: "", naver_verification: "abc123<script>", google_verification: "gvcode99" }).toString() }), env);
  assert.equal(r.status, 303);
  const h = await (await worker.fetch(new Request(B + "/t/seocho"), env)).text();
  assert.match(h, /<meta name="naver-site-verification" content="abc123script" \/>/); // 위험 문자 제거 확인
  assert.match(h, /<meta name="google-site-verification" content="gvcode99" \/>/);
});

test("sitemap: 개별 도메인에선 그 상인회만 루트 경로로, 공용 도메인에선 개별 도메인 상인회 제외", async () => {
  const env = makeEnv();
  const { a } = await seed(env); // seocho (공용)
  const b = await D.createAssociation(env.DB, { slug: "gangnam", name: "강남 상인회" });
  await D.setAssociationDomain(env.DB, b.id, "gangnam-market.kr");
  // 공용 도메인: seocho 는 /t/ 경로로 포함, gangnam 은 제외(자기 도메인에서 수집)
  let xml = await (await worker.fetch(new Request(B + "/sitemap.xml"), env)).text();
  assert.match(xml, /\/t\/seocho/);
  assert.doesNotMatch(xml, /gangnam/);
  // 개별 도메인: gangnam 만 루트 경로로, 다른 상인회 URL 없음
  xml = await (await worker.fetch(new Request("http://gangnam-market.kr/sitemap.xml"), env)).text();
  assert.match(xml, /<loc>https:\/\/gangnam-market\.kr\/<\/loc>/); // 스킴은 PUBLIC_SCHEME 기본값 https
  assert.match(xml, /gangnam-market\.kr\/businesses/);
  assert.doesNotMatch(xml, /\/t\/seocho/);
});

// 색 토큰이 WCAG AA 를 넘는지 — 값이 다시 흐려지면 여기서 걸린다.
// (브라우저 없이 계산으로 검사하므로 유닛 테스트에 둔다)
test("기본 색 토큰이 WCAG AA 대비를 만족한다", async () => {
  const fs = await import("node:fs");
  const css = fs.readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  const tok = (name) => (new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(css) || [])[1];
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const WHITE = "#ffffff";
  const brand = tok("brand"), muted = tok("muted"), inkSoft = tok("ink-soft"), ink = tok("ink");
  assert.ok(brand && muted && inkSoft && ink, "색 토큰을 읽지 못함");
  // 본문 글자 기준 4.5:1
  for (const [name, c] of [["--muted", muted], ["--ink-soft", inkSoft], ["--ink", ink]])
    assert.ok(ratio(c, WHITE) >= 4.5, `${name}(${c}) 가 흰 배경에서 ${ratio(c, WHITE).toFixed(2)}:1 — 4.5 이상이어야`);
  // 기본 버튼: 브랜드색 위 흰 글자
  assert.ok(ratio(WHITE, brand) >= 4.5,
    `--brand(${brand}) 위 흰 글자가 ${ratio(WHITE, brand).toFixed(2)}:1 — 기본 버튼이 전부 이 조합이다`);
  // 앱이 쓰는 기본값과 CSS 기본값이 어긋나면 배포 후에야 안다
  const render = fs.readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  const schema = fs.readFileSync(new URL("../src/schema.js", import.meta.url), "utf8");
  assert.ok(render.includes(brand), `render.js 폴백 색이 CSS 기본값(${brand})과 다름`);
  assert.ok(schema.includes(`DEFAULT '${brand}'`), `스키마 기본 brand_color 가 ${brand} 와 다름`);
});
