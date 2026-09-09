// 영업시간 — 지도가 주지 않는 유일한 값.
//
// 지도에서 가게를 고르면 상호·주소·전화·좌표·대표사진이 함께 따라옵니다.
// **영업시간만 안 옵니다.** 그러니 가게 수만큼 누군가 손으로 적어야 하는데,
// 그 '누군가' 를 회장님으로 두면 130곳이면 130번입니다.
//
// 그래서 사장님께 이미 보내고 있는 사진 요청 링크에 영업시간 칸을 얹었습니다.
// 사장님은 자기 가게 시간을 이미 알고 계십니다.
//
// 여기서 재는 것은 세 가지입니다.
//   ① 사장님이 고른 값이 openNow() 가 읽을 수 있는 한 줄이 되는가
//      — 한 글자만 어긋나면 저장은 되는데 '지금 문 연 곳' 에서만 조용히 빠집니다.
//   ② 링크로 할 수 있는 일이 여전히 그 가게의 사진·영업시간 둘뿐인가
//      — 링크는 카톡으로 돌아다닙니다. 새어 나가는 것을 전제로 만듭니다.
//   ③ 물어보는 자리가 실제로 눈에 띄는가
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { makePhotoToken } from "../src/api.js";
import { composeHours, decomposeHours, openNow } from "../src/util.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, p) { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
// csrfFrom: 폼이 있는 화면. 만료·위조 토큰의 화면에는 폼이 없어 CSRF 값을 못 얻는다 —
// 그래서 멀쩡한 링크에서 값을 얻어 **위조 토큰으로 보내 본다.** 실제 공격도 그 모양이다.
async function sendHours(env, j, token, f, csrfFrom) {
  const page = `/t/bb/photos/${encodeURIComponent(csrfFrom || token)}`;
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, page)).text()) || [])[1];
  const body = new URLSearchParams();
  body.set("_csrf", t || ""); body.set("token", token);
  for (const [k, v] of Object.entries(f)) for (const one of [].concat(v)) body.append(k, one);
  const r = await worker.fetch(new Request(B + "/t/bb/photos/hours", { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: body.toString() }), env);
  absorb(j, r); return r;
}
async function seed(env, slug = "bb") {
  const a = await D.createAssociation(env.DB, { slug, name: "방배카페골목 상인회" });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: `a@${slug}.kr`, passwordHash: ad.hash, salt: ad.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const op = await hashPassword("owner1234");
  const o = await D.createUser(env.DB, { email: `o@${slug}.kr`, passwordHash: op.hash, salt: op.salt, name: "사장", role: "OWNER", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: o.id, name: "너나들이", category: "음식점" });
  return { a, b };
}

// ── ① 고른 값이 '읽히는 한 줄' 이 되는가 ────────────────────────────────
test("고른 시각이 openNow() 가 읽는 한 줄이 된다", () => {
  const line = composeHours({ open: "09:00", close: "21:30", off: [] });
  assert.equal(line, "09:00-21:30");
  // 2026-09-08(화) 14:00 KST = 05:00 UTC
  assert.equal(openNow(line, Date.parse("2026-09-08T05:00:00Z")), true);
  assert.equal(openNow(line, Date.parse("2026-09-08T14:00:00Z")), false, "23시엔 닫혀 있어야 한다");
});

test("한 자리 시각도 두 자리로 맞춰 준다", () => {
  // 폰 시계는 09:00 을 주지만 자유 입력이나 옛 자료는 9:00 을 준다
  assert.equal(composeHours({ open: "9:00", close: "21:30" }), "09:00-21:30");
});

test("쉬는 요일을 고르면 그날은 실제로 문 닫힌 것으로 읽힌다", () => {
  const line = composeHours({ open: "09:00", close: "21:30", off: ["일"] });
  assert.equal(line, "09:00-21:30 · 일요일 휴무");
  // 2026-09-13 은 일요일
  assert.equal(openNow(line, Date.parse("2026-09-13T05:00:00Z")), false, "쉬는 날인데 영업중으로 뜬다");
  assert.equal(openNow(line, Date.parse("2026-09-14T05:00:00Z")), true, "월요일까지 닫아 버렸다");
});

test("쉬는 요일 여러 개도 앞 요일이 안 잘린다", () => {
  // closedToday() 는 '휴무' 앞 12글자만 훑는다. '매주' 를 붙이면 세 글자가 밀려
  // 요일을 서너 개 고른 가게에서 맨 앞 요일이 창 밖으로 나간다.
  const line = composeHours({ open: "10:00", close: "20:00", off: ["목", "금", "토", "일"] });
  assert.equal(line, "10:00-20:00 · 목·금·토·일요일 휴무");
  assert.equal(openNow(line, Date.parse("2026-09-10T05:00:00Z")), false, "목요일(맨 앞 요일)이 잘렸다");
  assert.equal(openNow(line, Date.parse("2026-09-13T05:00:00Z")), false, "일요일(맨 뒤 요일)이 안 잡혔다");
  assert.equal(openNow(line, Date.parse("2026-09-09T05:00:00Z")), true, "수요일까지 닫아 버렸다");
});

test("시각 없이 쉬는 날만 고르면 아무것도 만들지 않는다", () => {
  // "일요일 휴무" 만 남으면 openNow() 가 숫자를 못 찾아 **늘 닫힘**으로 읽는다.
  // 그러면 그 가게는 영영 '지금 문 연 곳' 에 안 뜬다 — 도우려다 지우는 셈이다.
  assert.equal(composeHours({ open: "", close: "", off: ["일"] }), "");
  assert.equal(composeHours({ open: "09:00", close: "", off: ["일"] }), "");
  assert.equal(composeHours({ open: "25:00", close: "21:00" }), "", "말이 안 되는 시각은 안 받는다");
});

test("우리가 만든 줄은 되돌려 읽고, 사람이 적은 줄은 건드리지 않는다", () => {
  assert.deepEqual(decomposeHours("09:00-21:30 · 토·일요일 휴무"), { open: "09:00", close: "21:30", off: ["토", "일"] });
  assert.deepEqual(decomposeHours("09:00-21:30"), { open: "09:00", close: "21:30", off: [] });
  assert.equal(decomposeHours("평일 09:00-21:00 · 주말 11:00-20:00"), null, "자유롭게 적은 줄을 칸에 억지로 끼웠다");
  assert.equal(decomposeHours(""), null);
});

// ── ② 링크로 실제로 되는가, 그리고 그것만 되는가 ────────────────────────
test("사장님이 링크에서 영업시간을 보내면 가게에 적힌다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const token = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  const r = await sendHours(env, jar(), token, { open: "09:00", close: "21:30", off: ["일"] });
  assert.equal(r.status, 303, "새로고침으로 다시 보내지지 않게 GET 으로 돌려보낸다");
  const after = await D.getBusinessById(env.DB, b.id);
  assert.equal(after.hours, "09:00-21:30 · 일요일 휴무");
});

test("요일마다 다른 가게는 직접 적은 줄이 그대로 남는다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const token = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  await sendHours(env, jar(), token, { raw: "평일 09:00-21:00 · 주말 11:00-20:00 · 월요일 휴무" });
  const after = await D.getBusinessById(env.DB, b.id);
  assert.equal(after.hours, "평일 09:00-21:00 · 주말 11:00-20:00 · 월요일 휴무");
});

test("빈 채로 보내면 아무것도 지우지 않는다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  await D.setBusinessHours(env.DB, b.id, "09:00-21:00");
  const token = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  const r = await sendHours(env, jar(), token, { open: "", close: "", raw: "" });
  assert.ok(/err=1/.test(r.headers.get("location") || ""), "빈 값을 그냥 받았다");
  const after = await D.getBusinessById(env.DB, b.id);
  assert.equal(after.hours, "09:00-21:00", "적혀 있던 시간이 지워졌다");
});

test("이 링크로는 상호도 소개도 못 바꾼다", async () => {
  // 토큰이 곧 권한이다. 칸 이름을 지어 보내도 영업시간 말고는 손대지 못해야 한다.
  const env = makeEnv();
  const { a, b } = await seed(env);
  await D.updateBusiness(env.DB, b.id, { name: "너나들이", category: "음식점", description: "원래 소개",
    phone: "", address: "", hours: "", lat: null, lng: null });
  const token = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  await sendHours(env, jar(), token, { open: "09:00", close: "21:00", name: "남의가게", description: "덮어쓰기", phone: "010-0000-0000" });
  const after = await D.getBusinessById(env.DB, b.id);
  assert.equal(after.name, "너나들이");
  assert.equal(after.description, "원래 소개");
  assert.equal(after.phone, "");
  assert.equal(after.hours, "09:00-21:00", "영업시간은 들어가야 한다");
});

test("남의 상인회에서 만든 토큰으로는 안 된다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const zz = await D.createAssociation(env.DB, { slug: "zz", name: "남의 상인회" });
  // 서명은 멀쩡하지만 조직이 다르다 — verifyPhotoToken 이 조직까지 본다
  const token = await makePhotoToken(env.SESSION_SECRET, zz.id, b.id);
  const ok = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  const r = await sendHours(env, jar(), token, { open: "09:00", close: "21:00" }, ok);
  assert.ok(/err=1/.test(r.headers.get("location") || ""), "남의 조직 토큰이 통과했다");
  assert.equal((await D.getBusinessById(env.DB, b.id)).hours, "");
});

test("서명을 고친 토큰으로는 안 된다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const ok = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  const token = ok.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  const r = await sendHours(env, jar(), token, { open: "09:00", close: "21:00" }, ok);
  assert.ok(/err=1/.test(r.headers.get("location") || ""));
  assert.equal((await D.getBusinessById(env.DB, b.id)).hours, "");
});

test("들어오면 회장님께 알림이 남는다", async () => {
  // 회장님은 '안 들어온 곳' 만 챙기면 된다. 그러려면 들어온 것을 알아야 한다.
  const env = makeEnv();
  const { a, b } = await seed(env);
  const token = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  await sendHours(env, jar(), token, { open: "09:00", close: "21:00" });
  const ns = await D.listNotifications(env.DB, a.id);
  const hit = ns.find((n) => /영업시간/.test(n.message));
  assert.ok(hit, "영업시간이 들어왔는데 회장님이 모른다");
  assert.match(hit.message, /너나들이/);
  assert.match(hit.link, new RegExp(`/admin/business/${b.id}$`));
});

// ── ③ 물어보는 자리가 눈에 띄는가 ──────────────────────────────────────
test("사진 화면에 영업시간 칸이 함께 있다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const token = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  const html = await (await get(env, jar(), `/t/bb/photos/${encodeURIComponent(token)}`)).text();
  assert.match(html, /name="open"/, "여는 시각 칸이 없다");
  assert.match(html, /name="close"/, "닫는 시각 칸이 없다");
  assert.match(html, /type="time"/, "폰 시계로 고르게 하지 않고 글로 적게 한다");
  assert.match(html, /name="off" value="일"/, "쉬는 요일을 고를 수 없다");
  assert.ok(html.includes("지금 문 연 곳"), "왜 적어야 하는지를 말하지 않는다");
});

test("이미 적힌 가게는 고른 값이 칸에 그대로 들어가 있다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  await D.setBusinessHours(env.DB, b.id, "10:00-22:00 · 화요일 휴무");
  const token = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  const html = await (await get(env, jar(), `/t/bb/photos/${encodeURIComponent(token)}`)).text();
  assert.match(html, /name="open" value="10:00"/);
  assert.match(html, /name="close" value="22:00"/);
  assert.match(html, /name="off" value="화" checked/, "고른 요일이 안 남아 다시 고르게 한다");
  assert.ok(html.includes("영업시간 고치기"), "이미 적힌 가게에도 '보내기' 라고 한다");
});

test("사진을 보낸 직후에 영업시간을 여쭙는다", async () => {
  // 이미 한 번 손을 대신 참이다. 처음부터 둘을 나란히 놓으면 둘 다 안 하고 닫으신다.
  const env = makeEnv();
  const { a, b } = await seed(env);
  const token = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  const url = `/t/bb/photos/${encodeURIComponent(token)}?done=2`;
  const html = await (await get(env, jar(), url)).text();
  assert.ok(html.includes("한 가지만 더"), "사진만 받고 끝낸다");
  assert.match(html, /name="open"/);

  await D.setBusinessHours(env.DB, b.id, "09:00-21:00");
  const html2 = await (await get(env, jar(), url)).text();
  assert.ok(!html2.includes("한 가지만 더"), "이미 적어 주셨는데 또 묻는다");
});

test("회장님 화면의 링크 만들기가 영업시간도 받는다고 말한다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/login")).text()) || [])[1];
  await worker.fetch(new Request(B + "/t/bb/login", { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, login: "a@bb.kr", password: "admin1234" }).toString() }), env).then((r) => absorb(j, r));
  const html = await (await get(env, j, `/t/bb/admin/business/${b.id}`)).text();
  assert.ok(html.includes("사진·영업시간 요청 링크 만들기"),
    "회장님이 이 링크로 영업시간까지 받을 수 있다는 걸 모른다 — 그러면 130번 직접 적는다");
  // 영업시간은 가게 화면에서 뺐다(회장님 요청). '남은 일' 에도 안 나온다 — 요청 링크가 그 길이다.
  assert.ok(!/'지금 문 연 곳'에 안 뜹니다/.test(html), "영업시간 줄은 이 화면에서 뺐다");
  assert.equal(a.id, (await D.getBusinessById(env.DB, b.id)).association_id);
});
