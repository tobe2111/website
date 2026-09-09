// "너가 할 것들 먼저 다 해주고" — 회장님 손이 남아 있던 세 군데를 단추 하나로.
//
//  1) 사진·영업시간 부탁을 **알림톡으로 한 번에** — 문구가 카카오 심사를 통과해야만 열린다.
//     그전에는 단추 대신 왜 안 되는지가 적힌다. 없는 단추는 고장으로 보이기 때문이다.
//  2) 네이버 플레이스 주소를 **여러 개 붙여넣기** — 카카오 열쇠 없이 사진을 받는 유일한 길.
//  3) 회원·점포 머리에 **지금 어디까지 왔나** 한 줄 — 등록·지도·사진·영업시간 숫자 넷.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import * as N from "../src/notify.js";
import { hashPassword } from "../src/crypto.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
const get = async (env, j, p) => { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; };
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
const LINKS = "/t/bb/admin/members/links";
const MAP = "/t/bb/admin/members/map";
const ALIGO = { ALIGO_API_KEY: "K", ALIGO_USER_ID: "U", ALIGO_SENDER_KEY: "S", ALIGO_SENDER: "0212345678" };

// 알리고로 나갈 요청을 통째로 붙잡는다 — 진짜 발송은 없다.
function intercept() {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url && url.url ? url.url : url);
    if (u.includes("token/create")) return new Response(JSON.stringify({ code: 0, token: "T" }), { headers: { "content-type": "application/json" } });
    if (u.includes("alimtalk/send")) {
      sent.push(Object.fromEntries(init.body.entries()));
      return new Response(JSON.stringify({ code: 0, info: { mid: sent.length } }), { headers: { "content-type": "application/json" } });
    }
    return new Response("ok");
  };
  return { sent, restore: () => { globalThis.fetch = real; } };
}

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목상인회", kind: "merchant" });
  const p = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: p.hash, salt: p.salt, name: "회장", role: "ADMIN", associationId: a.id });
  return a;
}
const login = async (env) => {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/login")).text()) || [])[1];
  await worker.fetch(new Request(B + "/t/bb/login", { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, login: "a@bb.kr", password: "admin1234" }).toString() }), env)
    .then((r) => absorb(j, r));
  return j;
};
async function biz(env, a, f) {
  const p = await hashPassword("owner1234");
  const u = await D.createUser(env.DB, { email: `o${Math.random()}@x.kr`, passwordHash: p.hash, salt: p.salt,
    name: f.owner || "사장", role: "MERCHANT", associationId: a.id, phone: f.ownerPhone || "" });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: f.name, category: f.category || "음식점" });
  await D.updateBusiness(env.DB, b.id, { name: f.name, category: f.category || "음식점", description: "",
    phone: "", address: f.address || "", hours: f.hours || "", lat: f.lat ?? null, lng: f.lng ?? null, mapUrl: f.mapUrl || "" });
  return D.getBusinessById(env.DB, b.id);
}
const talkOn = async (env, a) => {
  await env.DB.prepare("UPDATE associations SET notify_auto=1 WHERE id=?").bind(a.id).run();
  await D.addCredit(env.DB, a.id, 10000, { kind: "charge", memo: "시험" });
  a.notify_auto = 1;
};

// ── 1) 알림톡으로 한 번에 부탁 ──────────────────────────────────────────
test("문구가 심사 전이면 단추 대신 '왜 안 되는지' 가 적힌다", async () => {
  const env = makeEnv(ALIGO); const a = await seed(env); await talkOn(env, a);
  await biz(env, a, { name: "버들카페", ownerPhone: "010-1111-2222" });
  const html = await (await get(env, await login(env), LINKS)).text();
  assert.ok(!html.includes("/admin/members/links/alimtalk"), "심사 전엔 보내는 단추가 없어야 한다");
  assert.ok(html.includes("카카오 심사를 통과하면 열립니다"), html.slice(0, 300));
});

test("발송 열쇠가 없으면 그 이유를, 조직 스위치가 꺼졌으면 그 이유를 말한다", async () => {
  const env = makeEnv(); const a = await seed(env);
  await biz(env, a, { name: "버들카페", ownerPhone: "010-1111-2222" });
  const j = await login(env);
  assert.ok((await (await get(env, j, LINKS)).text()).includes("발송 열쇠가 없어"));
  const env2 = makeEnv(ALIGO); const a2 = await seed(env2);
  await biz(env2, a2, { name: "버들카페", ownerPhone: "010-1111-2222" });
  assert.ok((await (await get(env2, await login(env2), LINKS)).text()).includes("알림톡 발송을 켜면 열립니다"));
});

test("심사 전에 주소로 직접 눌러도 나가지 않는다", async () => {
  const env = makeEnv(ALIGO); const a = await seed(env); await talkOn(env, a);
  await biz(env, a, { name: "버들카페", ownerPhone: "010-1111-2222" });
  const t = intercept();
  try {
    const r = await post(env, await login(env), LINKS + "/alimtalk", {}, LINKS);
    assert.equal(r.status, 303);
    assert.match(decodeURIComponent(r.headers.get("location")), /심사/);
    assert.equal(t.sent.length, 0);
  } finally { t.restore(); }
});

test("문구가 승인되면 휴대폰 있는 사장님께만 한 번에 나가고, 링크는 사람마다 다르다", async () => {
  const env = makeEnv(ALIGO); const a = await seed(env); await talkOn(env, a);
  await D.setSetting(env.DB, N.TEMPLATE_KEYS.photo_ask, "TPL_PHOTO");
  await biz(env, a, { name: "버들카페", owner: "김버들", ownerPhone: "010-1111-2222" });
  await biz(env, a, { name: "너나들이", owner: "박너나", ownerPhone: "010-3333-4444" });
  await biz(env, a, { name: "번호없음" });
  await biz(env, a, { name: "다있는집", ownerPhone: "010-5555-6666", hours: "매일 10:00-22:00" });
  const done = await D.getBusinessByName(env.DB, a.id, "다있는집");
  await D.addMedia(env.DB, { businessId: done.id, kind: "image", url: "https://x/1.jpg", caption: "" }).catch(async () =>
    env.DB.prepare("INSERT INTO media (business_id, kind, url, caption) VALUES (?,?,?,?)").bind(done.id, "image", "https://x/1.jpg", "").run());
  const j = await login(env);
  const page = await (await get(env, j, LINKS)).text();
  assert.ok(page.includes("2곳에 알림톡으로 한 번에 부탁하기"), "휴대폰 있는 두 곳만 센다");
  const t = intercept();
  try {
    const r = await post(env, j, LINKS + "/alimtalk", {}, LINKS);
    assert.equal(r.status, 303);
    assert.match(decodeURIComponent(r.headers.get("location")), /알림톡 2건을 보냈습니다/);
    assert.equal(t.sent.length, 2);
    for (const s of t.sent) {
      assert.equal(s.tpl_code, "TPL_PHOTO");
      assert.match(s.message_1, /가게 사진·영업시간 요청/);
      assert.match(s.message_1, /방배카페골목상인회/);
      assert.match(s.message_1, /\/t\/bb\/photos\//, "로그인 없는 올리기 링크가 본문에 실린다");
    }
    assert.notEqual(t.sent[0].message_1, t.sent[1].message_1, "링크는 가게마다 다르다");
    assert.ok(t.sent.some((s) => s.message_1.includes("김버들님")));
  } finally { t.restore(); }
});

// ── 2) 네이버 플레이스 주소 여러 개 붙이기 ──────────────────────────────
test("'상호 [탭] 주소' 를 줄줄이 붙이면 상호로 맞춰 붙이고, 못 맞춘 줄은 말해 준다", async () => {
  const env = makeEnv(); const a = await seed(env);
  await biz(env, a, { name: "버들카페" });
  await biz(env, a, { name: "옹심이 감자탕" });
  const j = await login(env);
  const page = await (await get(env, j, MAP)).text();
  assert.ok(page.includes("네이버 플레이스 주소 여러 개 한 번에 붙이기"));
  const r = await post(env, j, MAP + "/naver", { naver_links: [
    "버들카페\thttps://naver.me/abcd12",
    "옹심이감자탕 https://m.place.naver.com/restaurant/123456/home",   // 띄어쓰기가 달라도 맞춘다
    "없는가게\thttps://map.naver.com/p/entry/place/999",
    "버들카페\thttps://buddlecafe.co.kr",                               // 지도 주소가 아니다
    "주소없는줄",
  ].join("\n") }, MAP);
  assert.equal(r.status, 303);
  const msg = decodeURIComponent(r.headers.get("location"));
  assert.match(msg, /2곳에 네이버 플레이스 주소를 붙였습니다/);
  assert.match(msg, /명부에 없는 상호 1곳: 없는가게/);
  assert.match(msg, /지도 주소가 아닌 줄 2/);
  const b1 = await D.getBusinessByName(env.DB, a.id, "버들카페");
  assert.equal(b1.sns_naver, "https://naver.me/abcd12");
  const b2 = await D.getBusinessByName(env.DB, a.id, "옹심이 감자탕");
  assert.equal(b2.sns_naver, "https://m.place.naver.com/restaurant/123456/home");
  // 붙인 곳은 '지도 사진 한꺼번에' 가 가져올 곳으로 센다
  assert.equal(await D.countBusinessesForPlacePhoto(env.DB, a.id), 2);
});

test("빈 칸으로 누르면 아무것도 바꾸지 않고 알린다", async () => {
  const env = makeEnv(); const a = await seed(env);
  await biz(env, a, { name: "버들카페" });
  const r = await post(env, await login(env), MAP + "/naver", { naver_links: "  \n " }, MAP);
  assert.match(decodeURIComponent(r.headers.get("location")), /err=1/);
  assert.equal((await D.getBusinessByName(env.DB, a.id, "버들카페")).sns_naver, "");
});

// ── 3) 지금 어디까지 왔나 ───────────────────────────────────────────────
test("회원·점포 머리에 등록·지도·사진 숫자 셋이 뜬다 — 영업시간은 뺐다", async () => {
  const env = makeEnv(); const a = await seed(env);
  await biz(env, a, { name: "버들카페", lat: 37.48, lng: 126.99, hours: "10-22" });
  await biz(env, a, { name: "너나들이", lat: 37.48, lng: 126.99 });
  await biz(env, a, { name: "셋째집" });
  // 지도 숫자는 손님 지도에 **실제로 보이는** 곳 — 승인된 가게만 센다
  await env.DB.prepare("UPDATE businesses SET status='approved' WHERE association_id=?").bind(a.id).run();
  const html = await (await get(env, await login(env), "/t/bb/admin")).text();
  const strip = /class="setup-strip"[\s\S]*?<\/p>/.exec(html);
  assert.ok(strip, "진행 한 줄이 있어야 한다");
  const s = strip[0];
  assert.match(s, /등록 <em>3<\/em>/);
  assert.match(s, /지도 <em>2<\/em>/);
  assert.match(s, /사진 <em>0<\/em>/);
  assert.doesNotMatch(s, /영업시간/, "영업시간은 회장님 화면에서 뺐다");
  assert.ok(s.includes('/admin/members/map"'), "숫자를 누르면 그 일을 하는 화면으로 간다");
});

test("전자계약 조직에는 진행 한 줄이 없다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "전자계약", kind: "esign" });
  const p = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: p.hash, salt: p.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const html = await (await get(env, await login(env), "/t/bb/admin")).text();
  assert.ok(!html.includes("setup-strip"));
});
