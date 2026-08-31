// 상인회 홈 첫 화면 — 두 갈래(사진 카드 / 한 줄 목록)와 공통 정리.
//
// 여기서 지키려는 것은 "예쁜가" 가 아니라 **손님이 3초 안에 무엇을 할 화면인지 아는가** 다.
// 그래서 검사도 색이나 여백이 아니라, 화면에 무엇이 남고 무엇이 사라졌는지를 본다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { dongOf, hoursLine } from "../src/util.js";
import { defaultLayout, applyHomePreset, serializeLayout, parseLayout } from "../src/homeLayout.js";

const B = "http://localhost";
let ipN = 0;
const get = (env, path) =>
  worker.fetch(new Request(B + path, { headers: { "cf-connecting-ip": `198.51.100.${++ipN % 250}` }, redirect: "manual" }), env,
    { waitUntil() {}, passThroughOnException() {} });

// 로그인은 CSRF 토큰이 필요하다 — 폼에서 토큰을 꺼내 함께 보낸다.
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function jget(env, j, p) { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function login(env, email, password = "pass1234") {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await jget(env, j, "/login")).text()) || [])[1];
  const r = await worker.fetch(new Request(B + "/login", { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, email, password }).toString() }), env);
  absorb(j, r);
  return j;
}

// 영업 시간이 하루 종일 열려 있어 검사 시각과 무관하게 '영업중' 인 가게를 만든다.
// (00:00-23:59 로 두면 새벽에 도는 CI 에서도 결과가 흔들리지 않는다)
async function seed({ layout = null } = {}) {
  const env = makeEnv();
  const pw = await hashPassword("pass1234");
  const a = await D.createAssociation(env.DB, { slug: "s", name: "서초구 상인회", kind: "merchant" });
  if (layout) await D.saveHomeLayout(env.DB, a.id, layout);
  let nOwner = 0;
  const mk = async (name, hours, address, category = "음식점") => {
    // 가게 한 곳에 사장 한 명 (businesses.owner_id 는 유일하다)
    const u = await D.createUser(env.DB, { email: `m${++nOwner}@s.kr`, passwordHash: pw.hash, salt: pw.salt, name: `사장${nOwner}`, role: "MERCHANT", associationId: a.id });
    const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name, category, description: "설명" });
    await D.setBusinessStatus(env.DB, b.id, "approved");
    await D.updateBusiness(env.DB, b.id, { name, category, description: "설명", phone: "02-000-0000", address, hours, lat: null, lng: null, sns_instagram: "", sns_youtube: "", sns_blog: "", sns_kakao: "", sns_naver: "" });
    return b;
  };
  await mk("종일국밥", "00:00-23:59", "서울 서초구 서초대로 78길 12");
  await mk("닫힌책방", "매주 월요일 휴무 · 매주 화요일 휴무 · 매주 수요일 휴무 · 매주 목요일 휴무 · 매주 금요일 휴무 · 매주 토요일 휴무 · 매주 일요일 휴무", "서울 서초구 방배로 42길 3", "교육·문화");
  return { env, a };
}

test("주소는 카드에서 잘리지 않는다 — 동네 이름만 남긴다", () => {
  assert.equal(dongOf("서울 서초구 서초동 1305-7"), "서초동");
  assert.equal(dongOf("서울 서초구 서초대로 78길 12"), "서초대로", "동이 없으면 길 이름 — 구 이름은 상권 안에서 모두 같아 아무것도 알려주지 않는다");
  assert.equal(dongOf("경기 성남시 분당구"), "분당구", "시·군·구가 여럿이면 가장 좁은 쪽");
  assert.equal(dongOf(""), "");
});

test("카드 첫 줄은 '지금 갈 수 있나' 를 말한다", () => {
  assert.deepEqual(hoursLine("09:00-21:30", Date.parse("2026-08-31T03:00:00Z")), { state: "open", label: "21:30 마감" }, "KST 12:00 — 열려 있으면 닫는 시각");
  assert.deepEqual(hoursLine("09:00-21:30", Date.parse("2026-08-31T20:00:00Z")), { state: "shut", label: "09:00 오픈" }, "KST 05:00 — 닫혀 있으면 여는 시각");
  assert.deepEqual(hoursLine(""), { state: "", label: "" }, "적어 두지 않았으면 아무 말도 하지 않는다");
});

test("기본 홈: 업종 줄은 글자 탭이고, 맨 앞이 '지금 문 연 곳'", async () => {
  const { env } = await seed();
  const html = await (await get(env, "/t/s/")).text();
  assert.match(html, /class="cat-tabs"/);
  assert.match(html, /지금 문 연 곳 1/, "문 연 곳 수를 세어 보여준다");
  assert.ok(!html.includes('class="cat-tile"'), "아이콘 칩(도구모음처럼 보이던 줄)은 사라졌다");
  assert.match(html, /21:59 마감|23:59 마감/, "카드에 닫는 시각이 적힌다");
  assert.match(html, /서초대로/, "동네 이름은 남는다");
  assert.ok(!html.includes("서울 서초구 서초대로 78길 12"), "전체 주소는 카드에 넣지 않는다 — 한가운데서 잘렸다");
});

test("기본 홈: 히어로 안내표와 검은 인용 띠가 사라지고, 가입 버튼은 남는다", async () => {
  const { env } = await seed();
  const html = await (await get(env, "/t/s/")).text();
  assert.ok(!html.includes("hp-panel"), "주소·전화·오늘신청을 한 표에 담던 안내 카드는 없앴다");
  assert.ok(!html.includes('class="showcase"'), "새 정보를 주지 않으면서 화면을 끊던 검은 띠는 기본에서 끈다");
  assert.ok(!html.includes("feat-band"), "가입점포·지도·공지 바로가기 카드는 머리말 메뉴와 겹쳐 끈다");
  assert.match(html, /우리 가게 등록하기/, "가입 버튼은 첫 화면에 그대로 둔다");
  assert.match(html, /hp-facts-line/);
  assert.match(html, /가입 점포 <b>2곳<\/b>/, "손님에게 쓸모 있는 숫자만 한 줄로");
});

test("찾기 앞세우기 구성: 사진 없이 검색창이 주인공, 목록은 한 줄", async () => {
  const lay = applyHomePreset(defaultLayout("서초구 상인회"), "find");
  const { env } = await seed({ layout: serializeLayout(lay) });
  const html = await (await get(env, "/t/s/")).text();
  assert.match(html, /class="hero-find"/);
  assert.match(html, /어느 가게를 찾으세요\?/);
  assert.ok(!html.includes('class="hero-pro'), "사진 히어로는 쓰지 않는다");
  assert.match(html, /class="biz-rows"/);
  assert.ok(!html.includes('class="market-grid"'), "사진 카드 격자는 쓰지 않는다");
  assert.match(html, /오늘 휴무|오픈|마감/, "배지가 없는 줄이므로 영업 상태를 줄 안에서 말해야 한다");
});

test("프리셋은 첫 화면만 바꾼다 — 나머지 구역은 그대로", () => {
  const base = defaultLayout("서초구 상인회");
  const find = applyHomePreset(base, "find");
  const changed = base.filter((s, i) => JSON.stringify(s) !== JSON.stringify(find[i])).map((s) => s.type);
  assert.deepEqual(changed.sort(), ["businesses", "hero"], "한 번에 여러 가지를 바꾸면 무엇이 통했는지 알 수 없다");
  assert.equal(applyHomePreset(base, "없는프리셋"), base, "모르는 이름이면 아무것도 하지 않는다");
});

test("옛 저장 구성도 새 화면으로 그려진다 (구성 필드가 없어도)", async () => {
  // layout 필드가 없던 시절 저장본
  const old = JSON.stringify([{ type: "hero", enabled: true, eyebrow: "우리 동네" }, { type: "businesses", enabled: true, title: "가게" }]);
  const arr = parseLayout(old, "서초구 상인회");
  assert.equal(arr.find((s) => s.type === "hero").layout, undefined);
  const { env } = await seed({ layout: old });
  const html = await (await get(env, "/t/s/")).text();
  assert.match(html, /class="hero-pro/, "구성이 안 적혀 있으면 사진 히어로가 기본");
  assert.match(html, /class="market-grid"/);
});

// ── 일하는 화면 —— 읽는 화면이 아니라 훑고 처리하는 화면이다.
test("관리자 첫 화면 맨 위는 '오늘 처리할 일' 이고, 며칠 기다렸는지까지 말한다", async () => {
  const env = makeEnv();
  const pw = await hashPassword("pass1234");
  const a = await D.createAssociation(env.DB, { slug: "s", name: "서초구 상인회", kind: "merchant" });
  await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const u = await D.createUser(env.DB, { email: "m@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "모둠분식", category: "음식점", description: "" });

  const j = await login(env, "ad@s.kr");
  const html = await (await jget(env, j, "/t/s/admin")).text();

  assert.match(html, /오늘 처리할 일/);
  assert.match(html, /입점 신청 1건/);
  assert.match(html, /모둠분식/, "몇 건인지가 아니라 무엇이 기다리는지를 말한다");
  assert.match(html, /검토하기/, "어디를 눌러야 하는지까지");
  // 할 일 상자가 숫자 카드보다 먼저 나온다 — 훑는 순서가 곧 화면 순서다
  assert.ok(html.indexOf('id="p-todo"') < html.indexOf('id="p-stats"'), "처리할 일이 숫자보다 위");
});

test("점주 화면은 '못 채우면 무엇을 잃는지' 를 적는다", async () => {
  const env = makeEnv();
  const pw = await hashPassword("pass1234");
  const a = await D.createAssociation(env.DB, { slug: "s", name: "서초구 상인회", kind: "merchant" });
  const u = await D.createUser(env.DB, { email: "m@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "모둠분식", category: "음식점", description: "" });
  await D.setBusinessStatus(env.DB, b.id, "approved");
  const j = await login(env, "m@s.kr");
  const html = await (await jget(env, j, "/t/s/dashboard")).text();

  assert.match(html, /아직 덜 채운 것/);
  assert.match(html, /영업 시간 적기/, "홈이 영업 시간에 기대므로 맨 앞이어야 한다");
  assert.match(html, /지금 문 연 곳.*안 뜹니다/);
  assert.ok(html.indexOf("영업 시간 적기") < html.indexOf("가게 사진 3장"), "잃는 게 큰 것부터");
});

// ── 일하는 화면이 다시 카드 더미로 돌아가지 않게 잠급니다.
//
// 콘솔이 회색 바닥 위에 흰 라운드 카드를 쌓아 올린 모양이었습니다. 카드 안에 카드가 들어가고
// (패널 > 고객사 카드 > 배지) 그림자가 세 겹 겹치면, "무엇이 중요한가" 가 아니라
// "무엇이든 다 상자다" 라는 인상만 남습니다. 그래서 상자를 걷고 괘선으로 나눴습니다.
// 테두리를 두르는 것은 화면에서 딱 하나 — 지금 손대야 하는 일(할 일 상자)뿐입니다.
test("콘솔은 종이 한 장이다 — 구역이 다시 카드가 되면 안 된다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf("일하는 화면 — 종이 한 장과 괘선"));
  assert.ok(block, "콘솔 스타일 구역이 있어야 한다");

  const rule = (sel) => {
    const i = block.indexOf(sel + "{") >= 0 ? block.indexOf(sel + "{") : block.indexOf(sel + ",");
    assert.ok(i >= 0, `${sel} 규칙이 있어야 한다`);
    return block.slice(i, block.indexOf("}", i));
  };
  for (const sel of [".dash .panel", ".dash .console-side nav", ".dash .stat-card"]) {
    const r = rule(sel);
    assert.match(r, /border-radius:0/, `${sel} 는 모서리를 굴리지 않는다`);
    assert.match(r, /box-shadow:none/, `${sel} 는 그림자를 지지 않는다`);
  }
  assert.match(rule(".dash .stat-card"), /background:none/, "숫자 칸은 흰 상자가 아니다");
  assert.match(rule(".dash .org-card"), /background:none/, "고객사는 카드가 아니라 목록 행이다");
  // 예외는 하나뿐 — 그것 하나만 상자여야 "여기부터" 라는 뜻이 된다
  assert.match(block, /\.dash \.todo-box\{border-color:var\(--ink\)/, "할 일 상자만 테두리를 남긴다");
});

test("사이드바에 뜻 없는 아이콘이 다시 붙지 않는다", async () => {
  const env = makeEnv();
  const pw = await hashPassword("pass1234");
  const a = await D.createAssociation(env.DB, { slug: "s", name: "서초구 상인회", kind: "merchant" });
  await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const j = await login(env, "ad@s.kr");
  const html = await (await jget(env, j, "/t/s/admin")).text();
  const nav = html.slice(html.indexOf('id="consoleNav"'), html.indexOf("</nav>", html.indexOf('id="consoleNav"')));
  assert.ok(nav.length > 50, "사이드바를 찾아야 한다");
  assert.ok(!nav.includes("<svg"), "열 칸 중 넷이 같은 그림이었다 — 구분해 주지 않는 아이콘은 장식일 뿐이다");
  assert.match(nav, /현황/);
  assert.match(nav, /계약서/);
});

test("점주 체크리스트는 끝난 것을 줄 그어 늘어놓지 않는다", async () => {
  const env = makeEnv();
  const pw = await hashPassword("pass1234");
  const a = await D.createAssociation(env.DB, { slug: "s", name: "서초구 상인회", kind: "merchant" });
  const u = await D.createUser(env.DB, { email: "m@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "모둠분식", category: "음식점", description: "" });
  await D.setBusinessStatus(env.DB, b.id, "approved");
  await D.updateBusiness(env.DB, b.id, { name: "모둠분식", category: "음식점", description: "떡볶이집입니다", phone: "02-000-0000",
    address: "서울 서초구 서초대로 1", hours: "10:00-20:00", lat: null, lng: null,
    sns_instagram: "", sns_youtube: "", sns_blog: "", sns_kakao: "", sns_naver: "" });
  const j = await login(env, "m@s.kr");
  const html = await (await jget(env, j, "/t/s/dashboard")).text();

  const box = html.slice(html.indexOf('class="panel onboard"'), html.indexOf("</section>", html.indexOf('class="panel onboard"')));
  assert.ok(!box.includes("ob-check"), "끝난 항목에 초록 동그라미를 달지 않는다");
  assert.ok(!box.includes('class="done"'), "취소선 목록은 '다 지워졌다' 로 읽혀 남은 하나를 묻는다");
  assert.ok(!box.includes("영업 시간 적기"), "이미 채운 것은 목록에서 뺀다");
  assert.match(box, /가게 사진 3장/, "남은 것은 남는다");
  assert.match(box, /나머지 3가지는 이미 채우셨습니다/, "끝난 것은 숫자 한 줄로 센다");
});
