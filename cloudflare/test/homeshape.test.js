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
//
// 축은 하나다: 왼쪽 칸은 처리할 것, 오른쪽 칸은 지나간 것.
// 예전에는 맨 위 "오늘 처리할 일" 상자와 가입 신청 표와 알림함이 **같은 사건을 세 번**
// 말하고 있었다 — 세 번 말하면 한눈에 들어오지 않는다.
test("첫 화면은 손이 필요한 것을 색으로 가르고, 승인을 그 자리에서 한다", async () => {
  const env = makeEnv();
  const pw = await hashPassword("pass1234");
  const a = await D.createAssociation(env.DB, { slug: "s", name: "서초구 상인회", kind: "merchant" });
  await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const u = await D.createUser(env.DB, { email: "m@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "모둠분식", category: "음식점", description: "" });

  const j = await login(env, "ad@s.kr");
  const html = await (await jget(env, j, "/t/s/admin")).text();

  // 손이 필요한 것은 브랜드색 면으로 가른다 — 흰 패널 위 흰 패널로는 구별이 안 됐다
  const q = html.slice(html.indexOf('class="hot"'), html.indexOf('id="p-notif"'));
  assert.match(q, /class="hot-n">1</, "몇 건인지가 큰 숫자로 먼저 읽혀야");
  assert.match(q, /모둠분식/, "기다리는 신청이 그 안에 보인다");
  assert.match(q, /오늘 신청|일째 기다리는 중/, "몇 건인지가 아니라 얼마나 기다렸는지");
  // 승인 단추가 이 화면 안에 있어야 한다 — 예전에는 다른 탭으로 넘어가야 나왔다
  assert.match(q, new RegExp(`admin/business/${b.id}/status`), "승인·반려 폼이 첫 화면에 있어야");
  assert.match(q, /승인<\/button>/);

  // 같은 사건을 두 번 말하지 않는다
  assert.ok(!html.includes("오늘 처리할 일"), "따로 뜬 할 일 상자는 없앴다 — 파란 블록과 같은 말이었다");
  assert.ok(!html.includes("안 읽은 알림"), "'최근 활동' 구역이 곧 알림함이다");
  assert.ok(!html.includes("지금 처리할 일이 없습니다"), "처리할 것이 있는데 없다고 하면 안 된다");
  // 참고 숫자는 맨 아래로 — 매일 볼 필요 없는 넷이 맨 위 카드를 차지하고 있었다
  // 이 구역만 잘라 본다 — 문서 끝까지 훑으면 아래 '회원·점포' 탭의 글자까지 딸려 온다
  const stats = html.slice(html.indexOf('id="p-stats"'), html.indexOf('id="s-people"'));
  assert.ok(html.indexOf('class="hot"') < html.indexOf('id="p-stats"'), "할 일이 숫자보다 위에 온다");
  assert.match(stats, /가입 점포/);
  assert.match(stats, /방문/, "'사람이 오고 있나' 가 실제로 궁금한 숫자다");
  assert.ok(!/stat-card/.test(html), "숫자 카드 네 장 줄은 걷어냈다");
  assert.ok(!stats.includes("미디어"), "세어 봐야 아무것도 달라지지 않는 숫자는 뺐다");
  assert.ok(!stats.includes("승인 대기"), "위의 파란 블록이 이미 말한다");
});

// 파란 덩어리가 '보이는 것' 자체가 신호다 — 0 이라는 숫자를 읽게 하지 않는다.
test("처리할 것이 없으면 파란 블록이 통째로 사라진다", async () => {
  const env = makeEnv();
  const pw = await hashPassword("pass1234");
  const a = await D.createAssociation(env.DB, { slug: "s", name: "서초구 상인회", kind: "merchant" });
  await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const j = await login(env, "ad@s.kr");
  const html = await (await jget(env, j, "/t/s/admin")).text();

  assert.ok(!/class="hot"/.test(html), "할 일이 0건이면 파란 블록이 없어야");
  assert.match(html, /지금 처리할 일이 없습니다/, "그 자리에 한 줄만 남는다");
  assert.match(html, /id="p-stats"/, "참고 숫자는 그대로 있다");
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

// ── 전자계약 —— 계약서를 읽지 못하는 채로 서명하게 두지 않는다.
test("휴대폰에서 읽을 수 있게, 서명 화면에 본문 크게 읽기가 붙는다", async () => {
  const env = makeEnv();
  const pw = await hashPassword("pass1234");
  const a = await D.createAssociation(env.DB, { slug: "law", name: "한빛법무법인", kind: "esign" });
  const ad = await D.createUser(env.DB, { email: "ad@law.kr", passwordHash: pw.hash, salt: pw.salt, name: "담당", role: "ADMIN", associationId: a.id });
  const body = "제1조 임차인은 본 계약의 조건을 성실히 이행한다.\n제2조 보증금은 금 오천만원으로 한다.";
  const d = await D.createDocument(env.DB, { associationId: a.id, title: "임대차 계약서", body,
    contentHash: "x".repeat(64), createdBy: ad.id });
  // 필드가 있어야 A4 지면으로 그려진다 — 지면이 없으면 본문이 그대로 흐르므로 이 장치도 필요 없다
  await D.replaceFields(env.DB, d.id, [{ page: 0, kind: "sign", x: 0.5, y: 0.8, w: 0.2, h: 0.05, label: "서명", assignee: 0, required: 1 }]);
  await D.addExternalSigner(env.DB, { documentId: d.id, name: "김상대" });
  // 본인이 서명 대상이어야 서명 화면이 열린다
  await D.createSignatureRequests(env.DB, d.id, [ad.id]);
  const j = await login(env, "ad@law.kr");
  const page = await (await jget(env, j, `/t/law/sign/${d.id}`)).text();

  assert.match(page, /class="read-plain"/, "본문 크게 읽기 블록이 있어야 한다");
  assert.match(page, /본문 크게 읽기/);
  assert.match(page, /제2조 보증금은 금 오천만원으로 한다/, "지면과 같은 본문이 그대로 들어 있어야 한다");
  assert.match(page, /글자 하나까지 같은 내용/, "다른 문서를 보여주는 것이 아님을 밝힌다");
});

test("필드 배치 도구는 스크롤해도 따라온다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  const i = css.indexOf(".fp-dock{");
  assert.ok(i >= 0, ".fp-dock 규칙이 있어야 한다");
  const rule = css.slice(i, css.indexOf("}", i));
  assert.match(rule, /position:sticky/, "계약서가 세 화면 넘게 길다 — 저장 단추가 따라오지 않으면 맨 위까지 되돌아가야 한다");
  const src = readFileSync(new URL("../src/pages.js", import.meta.url), "utf8");
  assert.match(src, /class="fp-dock"/);
  assert.match(src, /id="fieldsForm" class="fp-save"/, "저장 폼이 도구 막대 안에 있어야 한다");
});

// ── 받은 PDF 양식으로 계약서 만들기 (경로 전체)
test("PDF 양식으로 만든 계약서는 배치·서명·완성본 모두 그 지면 위에서 돈다", async () => {
  const env = makeEnv();
  const pw = await hashPassword("pass1234");
  const a = await D.createAssociation(env.DB, { slug: "law", name: "한빛법무법인", kind: "esign" });
  await D.createUser(env.DB, { email: "ad@law.kr", passwordHash: pw.hash, salt: pw.salt, name: "담당", role: "ADMIN", associationId: a.id });
  const u = await D.createUser(env.DB, { email: "m@law.kr", passwordHash: pw.hash, salt: pw.salt, name: "서명자", role: "MERCHANT", associationId: a.id });
  const j = await login(env, "ad@law.kr");

  // 관리자 브라우저가 보내는 것과 같은 모양: 원본 PDF + 쪽 그림 2장
  const page = await (await jget(env, j, "/t/law/admin/documents")).text();
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(page) || [])[1];
  const pdf = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 10, 37, 37, 69, 79, 70])], { type: "application/pdf" });
  const jpg = () => new Blob([new Uint8Array(2048).fill(7)], { type: "image/jpeg" });
  const fd = new FormData();
  fd.set("_csrf", csrf); fd.set("title", "2026년 표준근로계약서");
  fd.set("target", "select"); fd.set("member", String(u.id));
  fd.set("attachment", pdf, "표준근로계약서.pdf");
  fd.append("scan_0", jpg(), "page-1.jpg"); fd.append("scan_size_0", "1240x1754");
  fd.append("scan_1", jpg(), "page-2.jpg"); fd.append("scan_size_1", "1240x1754");
  const r = await worker.fetch(new Request(B + "/t/law/admin/documents", { method: "POST", headers: { cookie: ch(j) }, body: fd }), env,
    { waitUntil() {}, passThroughOnException() {} });
  assert.equal(r.status, 303, "본문 없이도 만들어져야 한다 — 지면이 그림이기 때문");

  const docs = await D.listDocuments(env.DB, a.id);
  assert.equal(docs.length, 1);
  const d = docs[0];
  assert.equal(d.body, "", "옮겨 적지 않는다");
  assert.ok(d.attachment_hash, "법적 원문인 원본 PDF 의 해시가 남아야 한다");
  const pages = await D.listDocPages(env.DB, d.id);
  assert.equal(pages.length, 2, "쪽 그림 두 장이 지면으로 저장된다");
  assert.equal(pages[0].w, 1240);

  // 배치 화면 · 서명 화면 · 완성본이 모두 그 그림을 지면으로 그린다
  for (const [path, what] of [[`/t/law/admin/documents/${d.id}/fields`, "배치"], [`/t/law/documents/${d.id}/paper`, "완성본"]]) {
    const html = await (await jget(env, j, path)).text();
    assert.match(html, /paper-stack is-scan/, `${what} 화면이 그림 지면이어야 한다`);
    assert.match(html, /class="paper-scan"/, `${what} 화면에 쪽 그림이 있어야 한다`);
  }
});

test("쪽 그림만 보내고 원본 PDF 를 빠뜨리면 만들지 않는다", async () => {
  const env = makeEnv();
  const pw = await hashPassword("pass1234");
  const a = await D.createAssociation(env.DB, { slug: "law", name: "한빛법무법인", kind: "esign" });
  await D.createUser(env.DB, { email: "ad@law.kr", passwordHash: pw.hash, salt: pw.salt, name: "담당", role: "ADMIN", associationId: a.id });
  const u = await D.createUser(env.DB, { email: "m@law.kr", passwordHash: pw.hash, salt: pw.salt, name: "서명자", role: "MERCHANT", associationId: a.id });
  const j = await login(env, "ad@law.kr");
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(await (await jget(env, j, "/t/law/admin/documents")).text()) || [])[1];
  const fd = new FormData();
  fd.set("_csrf", csrf); fd.set("title", "원본 없는 양식"); fd.set("target", "select"); fd.set("member", String(u.id));
  fd.append("scan_0", new Blob([new Uint8Array(512)], { type: "image/jpeg" }), "p.jpg");
  fd.append("scan_size_0", "1240x1754");
  const r = await worker.fetch(new Request(B + "/t/law/admin/documents", { method: "POST", headers: { cookie: ch(j) }, body: fd }), env,
    { waitUntil() {}, passThroughOnException() {} });
  const to = decodeURIComponent(r.headers.get("location") || "");
  assert.match(to, /원본 PDF/, "그림만 남기면 '그 그림이 원본과 같다'를 증명할 방법이 없다");
  assert.equal((await D.listDocuments(env.DB, a.id)).length, 0);
});

// 홈 섹션 검사용 씨앗 — 운영자 계정이 없으면 사이트가 /setup 으로 보내므로 한 명은 만들어 둔다.
async function seedPhotos(notices) {
  const env = makeEnv();
  const pw = await hashPassword("pass1234");
  const a = await D.createAssociation(env.DB, { slug: "s", name: "방배카페골목상인회", kind: "merchant" });
  await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  for (const [title, image] of notices)
    await D.createNotice(env.DB, { associationId: a.id, title, body: "본문", image, tag: image ? "소식" : "공지" });
  return { env, a };
}

// ── 홈에서 무엇을 보여 주고 무엇을 치웠나 ─────────────────────────────
//
// 이 홈의 주 손님은 '가게를 찾는 사람' 이다. 점주 모집 안내(절차·혜택·FAQ)를 다 펴 두면
// 화면의 절반이 모집 문서가 되어 정작 가게가 안 보인다. 모집은 맨 아래 배너 하나로 족하다.
test("기본 홈에는 입점 절차·혜택·FAQ 가 없다 (모집은 맨 아래 배너 하나)", async () => {
  const { env } = await seedPhotos([]);
  const html = await (await get(env, "/t/s/")).text();
  assert.ok(!html.includes("입점은 이렇게 진행됩니다"), "절차 안내는 기본에서 꺼져 있어야");
  assert.ok(!html.includes("입점하면 생기는 것"), "혜택 안내는 기본에서 꺼져 있어야");
  assert.ok(!html.includes("자주 묻는 질문"), "FAQ 는 기본에서 꺼져 있어야");
  assert.match(html, /아직 회원이 아니신가요\?/, "가입 배너는 남는다");
  // 쓰고 싶은 상인회는 홈 구성에서 켤 수 있어야 한다 — 지운 게 아니라 끈 것이다
  assert.ok(defaultLayout("x").some((s) => s.type === "steps"), "섹션 자체는 목록에 남아 있어야");
});

test("사진 붙은 공지는 활동사진 판으로 뜨고, 공지 목록에 두 번 나오지 않는다", async () => {
  const { env } = await seedPhotos([["달빛축제 현장", "shot.jpg"], ["9월 정기총회 안내", ""]]);
  const html = await (await get(env, "/t/s/")).text();

  assert.match(html, /class="photo-board"/, "활동사진 판이 있어야");
  assert.match(html, /pb-card/);
  assert.equal((html.match(/달빛축제 현장/g) || []).length, 1, "사진 공지는 한 번만 — 같은 말을 두 번 하지 않는다");
  assert.match(html, /9월 정기총회 안내/, "사진 없는 공지는 공지 목록에 남는다");
});

test("사진 붙은 공지가 하나도 없으면 활동사진 자리가 아예 없다", async () => {
  const { env } = await seedPhotos([["주차 안내", ""]]);
  const html = await (await get(env, "/t/s/")).text();
  assert.ok(!html.includes("photo-board"), "빈 사진판은 '아무것도 안 한 상인회' 로 읽힌다");
  assert.ok(!html.includes("활동사진"), "제목만 남기지도 않는다");
  assert.match(html, /주차 안내/, "공지는 그대로 목록에");
});

test("영상은 주소를 넣었을 때만 뜬다 (없거나 이상하면 자리 자체가 없다)", async () => {
  const { env, a } = await seedPhotos([]);
  const lay = (url) => serializeLayout(parseLayout(null, a.name).map((s) => (s.type === "video" ? { ...s, url } : s)));

  const none = await (await get(env, "/t/s/")).text();
  assert.ok(!none.includes("home-video"), "주소가 없으면 빈 검은 네모를 남기지 않는다");
  assert.ok(!none.includes("영상으로 보기"));

  await env.DB.prepare("UPDATE associations SET home_layout=? WHERE id=?").bind(lay("https://naver.me/abcd"), a.id).run();
  const bad = await (await get(env, "/t/s/")).text();
  assert.ok(!bad.includes("home-video"), "읽을 수 없는 주소(단축 링크)면 섹션이 없다");

  await env.DB.prepare("UPDATE associations SET home_layout=? WHERE id=?").bind(lay("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), a.id).run();
  const ok = await (await get(env, "/t/s/")).text();
  assert.match(ok, /class="home-video"/);
  // 쿠키를 심지 않는 주소로만 띄운다 — 손님이 우리 홈을 보다 광고 추적을 당하지 않게
  assert.match(ok, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.ok(!/youtube\.com\/watch/.test(ok), "원본 주소를 그대로 iframe 에 넣지 않는다");
});
