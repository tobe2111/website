// 행사의 시간·접수·주최·문의, 그리고 상인회 자체의 SNS 링크.
//
// 왜 이 칸들을 더했나.
// 포스터를 그대로 옮기려니 담을 자리가 없었다. 종이에는 반드시 적히는데
// 행사 표에는 없는 것들이다 — 몇 시에 가면 되나, 신청은 언제까지 어디서 받나,
// 누가 여는가, 어디로 전화하나. 이것들이 없으면 손님은 홈페이지를 보고도
// 결국 포스터 사진을 다시 찾아 확대해 읽어야 한다.
//
// 넷 다 **선택**이다. 비워 두면 그 줄이 화면에 아예 나오지 않아야 한다 —
// '접수: ' 뒤가 비어 있는 줄은 안내가 아니라 고장으로 읽힌다.
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
const soon = () => new Date(Date.now() + 9 * 3600 * 1000 + 20 * 86400000).toISOString().slice(0, 10);

async function seed(env, extra = {}) {
  const a = await D.createAssociation(env.DB, { slug: "bangbae", name: "방배카페골목상인회", kind: "merchant" });
  const pw = await hashPassword("pass1234");
  const admin = await D.createUser(env.DB, { email: "admin@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "관리자", role: "ADMIN", associationId: a.id });
  const ev = await D.createEvent(env.DB, { associationId: a.id, title: "방배페스티벌", event_date: soon(),
    place: "방배카페골목 일대", description: "골목이 카페다", ...extra });
  return { a, ev, admin };
}
const login = async (env) => { const j = jar(); await post(env, j, "/t/bangbae/login", { email: "admin@s.kr", password: "pass1234" }); return j; };

test("시간·접수·주최·문의를 적으면 행사 상세에 그대로 나온다", async () => {
  const env = makeEnv();
  const { ev } = await seed(env, {
    time_text: "15:00 ~ 20:00 (개회식 18:00)",
    signup: "9월 23일(수)까지 · 방배본동 주민센터 1층",
    host: "주최 방배본동 주민자치위원회",
    contact: "010-6619-1553",
  });
  const html = await (await get(env, jar(), `/t/bangbae/events/${ev.id}`)).text();
  assert.match(html, /15:00 ~ 20:00 \(개회식 18:00\)/, "몇 시에 가면 되나");
  assert.match(html, /방배본동 주민센터 1층/, "어디서 접수하나");
  assert.match(html, /방배본동 주민자치위원회/, "누가 여나");
  assert.match(html, /010-6619-1553/, "어디로 전화하나");
  assert.match(html, /<dt>접수<\/dt>/, "접수는 제목이 붙은 한 줄이어야");
});

test("비워 두면 그 줄이 아예 안 나온다 (빈 칸을 보여주지 않는다)", async () => {
  const env = makeEnv(); const { ev } = await seed(env);
  const html = await (await get(env, jar(), `/t/bangbae/events/${ev.id}`)).text();
  for (const label of ["접수", "주최"]) {
    assert.doesNotMatch(html, new RegExp(`<dt>${label}</dt>`), `${label} 칸이 비었는데 줄이 나왔다`);
  }
  assert.doesNotMatch(html, /ed-time/, "시간이 비었는데 시간 자리가 나왔다");
});

test("문의를 안 적으면 상인회 대표번호가 대신 나온다", async () => {
  const env = makeEnv(); const { a, ev } = await seed(env);
  await D.updateAssociation(env.DB, a.id, { name: "방배카페골목상인회", tagline: "", brand_color: "#6F4423",
    phone: "02-941-1004", email: "", address: "", logo: "", hero_image: "" });
  const html = await (await get(env, jar(), `/t/bangbae/events/${ev.id}`)).text();
  assert.match(html, /02-941-1004/, "행사에 전화가 없으면 상인회 대표번호로 받는다");
});

test("관리자가 등록·수정해도 네 칸이 살아 있다 (한쪽에만 칸이 있으면 고칠 때 지워진다)", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const j = await login(env);
  await post(env, j, "/t/bangbae/admin/event", { title: "주민 노래자랑", event_date: soon(),
    time_text: "오후 3시", place: "라이브카페 CNN", description: "예선", signup: "9월 23일까지", host: "방배카페골목 상인회", contact: "010-6619-1553" },
    "/t/bangbae/admin");
  const made = (await D.listEvents(env.DB, a.id)).find((e) => e.title === "주민 노래자랑");
  assert.ok(made, "등록돼야");
  assert.equal(made.time_text, "오후 3시");
  assert.equal(made.signup, "9월 23일까지");

  await post(env, j, `/t/bangbae/admin/event/${made.id}`, { title: "주민 노래자랑", event_date: soon(),
    time_text: "오후 4시 30분", place: "라이브카페 CNN", description: "본선", signup: "9월 23일까지", host: "방배카페골목 상인회", contact: "010-6619-1553" },
    "/t/bangbae/admin");
  const after = await D.getEvent(env.DB, made.id);
  assert.equal(after.time_text, "오후 4시 30분", "고치면 바뀌어야");
  assert.equal(after.host, "방배카페골목 상인회", "고칠 때 다른 칸이 지워지면 안 된다");
});

test("캘린더에 넣어도 시간·접수·주최가 함께 들어간다", async () => {
  const env = makeEnv();
  const { ev } = await seed(env, { time_text: "15:00 ~ 20:00", signup: "9월 23일까지", host: "서초구" });
  const ics = await (await get(env, jar(), `/t/bangbae/events/${ev.id}/calendar.ics`)).text();
  assert.match(ics, /DESCRIPTION:/);
  assert.match(ics, /시간: 15:00 ~ 20:00/, "달력에만 넣고 시간을 빼면 그 시간에 못 간다");
  assert.match(ics, /접수: 9월 23일까지/);
  assert.match(ics, /주최: 서초구/);
});

// ── 상인회 SNS ──────────────────────────────────────────────────────────
test("상인회 인스타그램을 적으면 모든 화면 바닥글에 붙는다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const insta = "https://www.instagram.com/bangbae_cafe_street/";
  await D.updateAssociation(env.DB, a.id, { name: "방배카페골목상인회", tagline: "", brand_color: "#6F4423",
    phone: "", email: "", address: "", logo: "", hero_image: "", sns_instagram: insta });
  for (const p of ["/t/bangbae/", "/t/bangbae/events", "/t/bangbae/notices"]) {
    const html = await (await get(env, jar(), p)).text();
    assert.match(html, /class="foot-sns"/, `${p} 바닥글에 SNS 줄이 있어야`);
    assert.match(html, new RegExp(insta.replace(/\//g, "\\/")), `${p} 에 인스타 주소가 있어야`);
    assert.match(html, /aria-label="인스타그램"/, "아이콘만 있는 링크는 이름을 읽어 줘야 한다");
  }
});

test("안 적은 SNS 는 아이콘이 안 나온다 (눌러도 안 가는 링크를 두지 않는다)", async () => {
  const env = makeEnv(); await seed(env);
  const html = await (await get(env, jar(), "/t/bangbae/")).text();
  assert.doesNotMatch(html, /class="foot-sns"/, "하나도 없으면 줄 자체가 없어야");
});

test("http(s) 가 아닌 주소는 저장하지 않는다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const j = await login(env);
  await post(env, j, "/t/bangbae/admin/settings", { name: "방배카페골목상인회", tagline: "", brand_color: "#6F4423",
    phone: "", email: "", address: "", sns_instagram: "javascript:alert(1)", sns_youtube: "youtube.com/@bangbae" },
    "/t/bangbae/admin");
  const after = await D.getAssociationById(env.DB, a.id);
  assert.equal(after.sns_instagram, "", "다른 스킴은 통째로 버린다");
  assert.equal(after.sns_youtube, "https://youtube.com/@bangbae", "앞을 빼고 적어도 https 를 붙여 준다");
});

// ── 참가 신청을 받지 않는 행사 ───────────────────────────────────────────
// 동네 축제 화면에 "참가 신청은 회원만 할 수 있습니다" 가 뜨면, 손님은
// "회원이라야 갈 수 있나 보다" 로 읽는다. 안내가 아니라 문을 닫는 말이 된다.
test("참가 신청을 끈 행사는 신청 자리가 통째로 없다", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const open = await D.createEvent(env.DB, { associationId: a.id, title: "회원 워크숍", event_date: soon(), rsvp: 1 });
  const free = await D.createEvent(env.DB, { associationId: a.id, title: "골목 축제", event_date: soon(), rsvp: 0 });

  const ho = await (await get(env, jar(), `/t/bangbae/events/${open.id}`)).text();
  assert.match(ho, /참가 신청은/, "받는 행사는 지금까지처럼 안내가 나와야");

  const hf = await (await get(env, jar(), `/t/bangbae/events/${free.id}`)).text();
  assert.doesNotMatch(hf, /참가 신청/, "안 받는 행사엔 신청이라는 말 자체가 없어야");

  const list = await (await get(env, jar(), "/t/bangbae/events")).text();
  assert.match(list, /골목 축제/, "목록에는 그대로 나와야");
});

test("단추를 숨겨도 서버가 막는다 (폼은 손으로 만들 수 있다)", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const free = await D.createEvent(env.DB, { associationId: a.id, title: "골목 축제", event_date: soon(), rsvp: 0 });
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "mem@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회원", role: "MERCHANT", associationId: a.id });
  const j = jar();
  await post(env, j, "/t/bangbae/login", { email: "mem@s.kr", password: "pass1234" });
  await post(env, j, `/t/bangbae/events/${free.id}/rsvp`, {}, "/t/bangbae/events");
  assert.equal((await D.listRsvps(env.DB, free.id)).length, 0, "신청이 들어가면 안 된다");
});

test("관리자가 체크를 끄면 꺼진 채로 남는다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const j = await login(env);
  // 체크 안 함 = rsvp 칸 자체가 폼에 안 실린다
  await post(env, j, "/t/bangbae/admin/event", { title: "레트로 체험부스", event_date: soon() }, "/t/bangbae/admin");
  const made = (await D.listEvents(env.DB, a.id)).find((e) => e.title === "레트로 체험부스");
  assert.equal(made.rsvp, 0, "끈 채로 등록돼야");
  await post(env, j, `/t/bangbae/admin/event/${made.id}`, { title: "레트로 체험부스", event_date: soon(), rsvp: "1" }, "/t/bangbae/admin");
  assert.equal((await D.getEvent(env.DB, made.id)).rsvp, 1, "다시 켤 수 있어야");
});
