// 행사 상세 + 캘린더에 넣기.
//
// 두 가지가 잘못돼 있었다:
//   ① 홈에서 행사 카드를 눌러도 아무 데도 가지 않았다. 손님은 사진과 제목을 보고
//      당연히 누르는데 아무 일이 없으면 "고장" 으로 읽는다. 공지는 상세가 있는데
//      정작 "언제 어디로 가면 되나" 를 알아야 하는 행사만 없었다.
//   ② '캘린더에 추가' 가 곧바로 .ics 파일을 내려받게 했다. 그건 개발자에게만 자연스럽다.
//      이 화면을 여는 사람은 동네 손님과 40~60대 사장님이다. 안드로이드·컴퓨터에서는
//      '다운로드 폴더에 파일 하나' 로 끝나고, 캘린더에는 아무것도 안 들어간다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, p) { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
// 내일 — 지난 행사로 판정되지 않게
const soon = () => new Date(Date.now() + 9 * 3600 * 1000 + 20 * 86400000).toISOString().slice(0, 10);

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "방배카페골목상인회", kind: "merchant" });
  await D.updateAssociation(env.DB, a.id, { name: "방배카페골목상인회", tagline: "", brand_color: "#6F4423",
    phone: "02-941-1004", email: "office@s.kr", address: "서울 서초구", logo: "", hero_image: "" });
  const pw = await hashPassword("pass1234");
  const mem = await D.createUser(env.DB, { email: "me@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회원", role: "MERCHANT", associationId: a.id });
  const ev = await D.createEvent(env.DB, { associationId: a.id, title: "방배카페상인 노래자랑",
    event_date: soon(), place: "방배카페골목", description: "저녁 6시부터\n골목 무대에서 엽니다.", image: "" });
  return { a, ev, mem };
}

test("행사 카드를 누르면 상세가 열린다 (예전엔 아무 데도 안 갔다)", async () => {
  const env = makeEnv(); const { ev } = await seed(env);
  const list = await (await get(env, jar(), "/t/seocho/events")).text();
  assert.match(list, new RegExp(`href="/t/seocho/events/${ev.id}"`), "카드가 상세로 가야 한다");

  const r = await get(env, jar(), `/t/seocho/events/${ev.id}`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /방배카페상인 노래자랑/);
  assert.match(html, /방배카페골목/, "장소가 있어야");
  assert.match(html, /골목 무대에서 엽니다/, "설명이 있어야");
  assert.match(html, /언제/, "언제·어디서를 표로 못 박는다");
});

test("홈·목록 카드에서 바로 파일이 떨어지지 않는다", async () => {
  const env = makeEnv(); await seed(env);
  for (const p of ["/t/seocho/", "/t/seocho/events"]) {
    const html = await (await get(env, jar(), p)).text();
    assert.doesNotMatch(html, /calendar\.ics/, `${p} 에서 파일 링크가 노출되면 안 된다`);
    assert.match(html, /캘린더에 넣기/, "표시는 남아 있어야 한다 (누르면 상세로 간다)");
  }
});

test("상세에서 구글·아이폰 중 골라서 넣는다", async () => {
  const env = makeEnv(); const { ev } = await seed(env);
  const html = await (await get(env, jar(), `/t/seocho/events/${ev.id}`)).text();
  assert.match(html, /구글 캘린더에 넣기/);
  assert.match(html, /아이폰 캘린더에 넣기/);
  assert.match(html, /calendar\.google\.com\/calendar\/render/, "구글 캘린더 바로 넣기 주소");
  assert.match(html, new RegExp(`/t/seocho/events/${ev.id}/calendar\\.ics`), "아이폰용 .ics");
  // 아무것도 안 눌러도 날짜는 눈으로 읽힌다 — 종이 달력에 옮겨 적는 분이 제일 많다
  assert.match(html, /ed-cal-date/);
});

test("구글 캘린더 주소에 제목·날짜·장소가 실린다", async () => {
  const env = makeEnv(); const { ev } = await seed(env);
  const html = await (await get(env, jar(), `/t/seocho/events/${ev.id}`)).text();
  const m = /href="(https:\/\/calendar\.google\.com[^"]+)"/.exec(html);
  assert.ok(m, "구글 캘린더 링크를 못 찾았다");
  const u = new URL(m[1].replace(/&amp;/g, "&"));
  assert.equal(u.searchParams.get("action"), "TEMPLATE");
  assert.match(u.searchParams.get("text"), /방배카페상인 노래자랑/);
  assert.equal(u.searchParams.get("location"), "방배카페골목");
  const ymd = soon().replace(/-/g, "");
  assert.match(u.searchParams.get("dates"), new RegExp(`^${ymd}/`), "시작일이 행사 날짜여야");
});

test(".ics 는 파일로 떨어지지 않고 캘린더 앱으로 넘어간다 (inline)", async () => {
  const env = makeEnv(); const { ev } = await seed(env);
  const r = await worker.fetch(new Request(B + `/t/seocho/events/${ev.id}/calendar.ics`), env);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/calendar/);
  assert.match(r.headers.get("content-disposition"), /^inline/,
    "attachment 를 붙이면 아이폰도 '파일' 로 받아 버려 캘린더 앱이 안 열린다");
});

test("회원은 상세에서 참가 신청하고 취소한다", async () => {
  const env = makeEnv(); const { ev } = await seed(env);
  const j = jar();
  await post(env, j, "/login", { login: "me@s.kr", password: "pass1234" });
  let html = await (await get(env, j, `/t/seocho/events/${ev.id}`)).text();
  assert.match(html, /참가 신청하기/);

  await post(env, j, `/t/seocho/events/${ev.id}/rsvp`, {}, `/t/seocho/events/${ev.id}`);
  html = await (await get(env, j, `/t/seocho/events/${ev.id}`)).text();
  assert.match(html, /신청함 \(취소하기\)/);
  assert.match(html, /참가 신청 1곳/);
});

test("비회원에게는 신청 대신 로그인 안내가 뜬다", async () => {
  const env = makeEnv(); const { ev } = await seed(env);
  const html = await (await get(env, jar(), `/t/seocho/events/${ev.id}`)).text();
  assert.match(html, /회원만 할 수 있습니다/);
  assert.doesNotMatch(html, /참가 신청하기/);
});

test("지난 행사는 '지난 행사' 로 적고 캘린더 칸을 내린다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const old = await D.createEvent(env.DB, { associationId: a.id, title: "작년 총회",
    event_date: "2020-03-01", place: "회관", description: "", image: "" });
  const html = await (await get(env, jar(), `/t/seocho/events/${old.id}`)).text();
  assert.match(html, /지난 행사/);
  assert.doesNotMatch(html, /구글 캘린더에 넣기/, "지난 행사를 캘린더에 넣을 이유가 없다");
});

test("옆 상인회 행사는 열리지 않는다 (테넌트 격리)", async () => {
  const env = makeEnv(); const { ev } = await seed(env);
  await D.createAssociation(env.DB, { slug: "other", name: "다른상인회", kind: "merchant" });
  const r = await worker.fetch(new Request(B + `/t/other/events/${ev.id}`), env);
  assert.equal(r.status, 404);
});

test("없는 행사는 404", async () => {
  const env = makeEnv(); await seed(env);
  assert.equal((await worker.fetch(new Request(B + "/t/seocho/events/99999"), env)).status, 404);
});

// 사진 있는 행사 카드 — 홈에 크게 뜨는 그 카드다.
test("사진 카드도 상세로 가고, 날짜 칩이 띠가 되지 않는다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  // .epc-body 가 grid 라 align-self(세로축)로는 가로 폭이 안 줄어든다.
  // 그래서 '9.29' 하나가 카드를 가로지르는 검은 띠가 돼 있었다.
  const chip = /\.epc-date\{([^}]*)\}/.exec(css);
  assert.ok(chip, ".epc-date 규칙을 못 찾았다");
  assert.match(chip[1], /justify-self:start/, "글자만큼만 넓어야 한다");

  const env = makeEnv(); const { a } = await seed(env);
  const ev = await D.createEvent(env.DB, { associationId: a.id, title: "여름 골목 야시장",
    event_date: soon(), place: "중앙골목", description: "", image: "img/og-default.png" });
  const html = await (await get(env, jar(), "/t/seocho/events")).text();
  assert.match(html, /event-photo-card/);
  assert.match(html, new RegExp(`class="epc-link" href="/t/seocho/events/${ev.id}"`), "사진 카드 전체가 상세로 가야 한다");
  assert.doesNotMatch(html, /calendar\.ics/);
});
