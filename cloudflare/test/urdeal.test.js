// 우리 골목 이용권 (유어딜 연동).
//
// 유어딜은 우리 서비스가 아니다. 그래서 두 가지를 못 박아 둔다:
//   ① 유어딜이 죽거나 느려도 상인회 홈은 뜬다
//   ② 이용권이 하나도 없어도 섹션이 비지 않는다 (사장님을 부르는 칸이 늘 있다)
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { fetchDeals, urdealProductUrl, urdealBase } from "../src/urdeal.js";

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
async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "방배카페골목상인회" });
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "ad@s.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const mk = async (name, i) => {
    const u = await D.createUser(env.DB, { email: `m${i}@x.kr`, passwordHash: pw.hash, salt: pw.salt, name: "사장" + i, role: "MERCHANT", associationId: a.id });
    const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name, category: "카페·디저트" });
    await D.setBusinessStatus(env.DB, b.id, "approved");
    return b;
  };
  return { a, b1: await mk("방배 커피", 1), b2: await mk("방배 정육점", 2) };
}
const login = async (env) => { const j = jar(); await post(env, j, "/login", { login: "ad@s.kr", password: "pass1234" }); return j; };

// 유어딜 응답을 흉내낸다. 실제 API 계약(openapi.json)의 필드 이름 그대로다.
function stubUrdeal(bySeller) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (!u.includes("ur-team.com")) return real(url, init);
    calls.push(u);
    const id = Number(new URL(u).searchParams.get("seller_id"));
    const data = bySeller[id];
    if (data === "boom") throw new Error("유어딜 죽음");
    if (data === "500") return new Response("nope", { status: 500 });
    return new Response(JSON.stringify({ success: true, data: data || [] }), { headers: { "content-type": "application/json" } });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
// 실제 응답에는 seller_id 가 늘 들어 있다(가게 것이 아니면 null). 그 모양을 그대로 흉내낸다 —
// 예전 이 자리에 0 을 박아 두었는데, 그건 실제로는 오지 않는 값이라 시험이 헐거웠다.
const DEAL = (id, name, price, was, seller, sellerId) => ({
  id, name, price, original_price: was, image_url: "https://cdn.example.com/a.jpg",
  seller_name: seller, sold_count: 12, seller_id: sellerId === undefined ? null : sellerId,
});

test("이용권이 없어도 섹션이 비지 않는다 — 사장님을 부르는 칸이 남는다", async () => {
  const env = makeEnv(); await seed(env);
  const html = await (await get(env, jar(), "/t/seocho/")).text();
  assert.match(html, /우리 골목 이용권/, "섹션이 있어야");
  assert.match(html, /우리 가게 이용권 만들어서 홍보하기/, "사장님을 부르는 칸이 있어야");
  assert.match(html, /deal-row is-empty/, "이용권이 0개면 그 칸 하나가 섹션 전체");
  assert.match(html, /이용권 만들러 가기/);
});

test("가게 번호를 넣으면 그 가게의 이용권이 홈에 걸린다", async () => {
  const env = makeEnv(); const { b1, b2 } = await seed(env);
  await D.setUrdealSeller(env.DB, b1.id, b1.association_id, 128);
  await D.setUrdealSeller(env.DB, b2.id, b2.association_id, 300);
  const s = stubUrdeal({
    128: [DEAL(9001, "아메리카노 5잔 이용권", 17000, 20000, "방배 커피", 128)],
    300: [DEAL(9002, "삼겹살 600g 교환권", 19900, 24000, "방배 정육점", 300)],
  });
  try {
    const html = await (await get(env, jar(), "/t/seocho/")).text();
    assert.match(html, /아메리카노 5잔 이용권/);
    assert.match(html, /삼겹살 600g 교환권/);
    assert.match(html, /17,000원/, "값이 사람이 읽는 꼴이어야");
    assert.match(html, /20,000원/, "정가도 함께 보여 얼마나 싼지 알 수 있어야");
    assert.match(html, /15%/, "할인율 (20000→17000)");
    assert.ok(!/deal-row is-empty/.test(html), "이용권이 있으면 빈 구성이 아니어야");
    // 손님이 사러 갈 곳은 유어딜이다 — 우리 사이트 안에서 팔지 않는다
    assert.match(html, new RegExp(urdealProductUrl(env, 9001).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(s.calls.length, 2, "가게마다 한 번씩 부른다");
    assert.ok(s.calls.every((u) => u.includes("deal_only=1")), "이용권만 가져온다");
  } finally { s.restore(); }
});

test("유어딜이 죽어도 상인회 홈은 뜬다", async () => {
  const env = makeEnv(); const { b1 } = await seed(env);
  await D.setUrdealSeller(env.DB, b1.id, b1.association_id, 128);
  const s = stubUrdeal({ 128: "boom" });
  try {
    const r = await get(env, jar(), "/t/seocho/");
    assert.equal(r.status, 200, "남의 서비스가 죽었다고 우리 홈이 죽으면 안 된다");
    const html = await r.text();
    assert.match(html, /방배 커피/, "가게 목록은 그대로 나와야");
    assert.match(html, /우리 가게 이용권 만들어서 홍보하기/, "섹션은 부르는 칸으로 남아야");
  } finally { s.restore(); }
});

test("한 가게가 실패해도 나머지 가게 이용권은 나온다", async () => {
  const env = makeEnv(); const { b1, b2 } = await seed(env);
  await D.setUrdealSeller(env.DB, b1.id, b1.association_id, 128);
  await D.setUrdealSeller(env.DB, b2.id, b2.association_id, 300);
  const s = stubUrdeal({ 128: "500", 300: [DEAL(9002, "삼겹살 교환권", 19900, 24000, "방배 정육점", 300)] });
  try {
    const html = await (await get(env, jar(), "/t/seocho/")).text();
    assert.match(html, /삼겹살 교환권/, "살아 있는 쪽은 나와야");
  } finally { s.restore(); }
});

test("남의 서비스가 준 값을 그대로 화면에 흘리지 않는다", async () => {
  const env = makeEnv();
  const s = stubUrdeal({ 7: [
    { id: 1, name: "정상", price: 1000, original_price: 500, image_url: "javascript:alert(1)", seller_name: "가게", seller_id: 7 },
    { id: 0, name: "번호 없음", price: 100, seller_id: 7 },   // 상품 번호가 없으면 사러 갈 곳이 없다
    { id: 2, name: "", price: 100, seller_id: 7 },            // 이름이 없으면 카드가 성립하지 않는다
    { id: 3, name: "값 이상", price: -5, seller_id: 7 },
  ] });
  try {
    const out = await fetchDeals(env, [7]);
    assert.equal(out.length, 2, "번호·이름 없는 것은 버린다: " + JSON.stringify(out.map((x) => x.name)));
    const ok = out.find((x) => x.id === 1);
    assert.equal(ok.image, "", "http(s) 가 아닌 주소는 그림으로 쓰지 않는다");
    assert.equal(ok.was, 0, "정가가 판매가보다 낮으면 '할인'으로 보여 주지 않는다");
    assert.equal(ok.off, 0);
    assert.equal(out.find((x) => x.id === 3).price, 0, "음수 값은 0 으로");
  } finally { s.restore(); }
});

test("가게 번호가 하나도 없으면 유어딜을 아예 부르지 않는다", async () => {
  const env = makeEnv(); await seed(env);
  const s = stubUrdeal({});
  try {
    await get(env, jar(), "/t/seocho/");
    assert.equal(s.calls.length, 0, "부를 이유가 없으면 남의 서버를 두드리지 않는다");
  } finally { s.restore(); }
});

test("관리자가 가게 번호를 넣고 지운다", async () => {
  const env = makeEnv(); const { b1 } = await seed(env);
  const j = await login(env);
  const page = await (await get(env, j, `/t/seocho/admin/business/${b1.id}`)).text();
  assert.match(page, /name="urdeal_seller_id"/, "번호 넣는 칸이 있어야");
  assert.match(page, /유어딜 가게 번호/);

  const ok = await post(env, j, `/t/seocho/admin/business/${b1.id}`,
    { name: "방배 커피", category: "카페·디저트", urdeal_seller_id: "128" }, `/t/seocho/admin/business/${b1.id}`);
  assert.doesNotMatch(ok.headers.get("location") || "", /err=1/);
  assert.equal((await D.getBusinessById(env.DB, b1.id)).urdeal_seller_id, 128);

  const bad = await post(env, j, `/t/seocho/admin/business/${b1.id}`,
    { name: "방배 커피", category: "카페·디저트", urdeal_seller_id: "live.ur-team.com/seller/128" }, `/t/seocho/admin/business/${b1.id}`);
  assert.match(decodeURIComponent(bad.headers.get("location") || ""), /숫자만/, "주소를 통째로 붙여넣는 실수를 잡아 줘야");
  assert.equal((await D.getBusinessById(env.DB, b1.id)).urdeal_seller_id, 128, "거절했으면 값도 그대로여야");

  await post(env, j, `/t/seocho/admin/business/${b1.id}`,
    { name: "방배 커피", category: "카페·디저트", urdeal_seller_id: "" }, `/t/seocho/admin/business/${b1.id}`);
  assert.equal((await D.getBusinessById(env.DB, b1.id)).urdeal_seller_id, 0, "비우면 연동을 끈다");
});

test("점주 화면에서 저장해도 가게 번호가 지워지지 않는다", async () => {
  // 점주 대시보드에는 이 칸이 없다. 안 그리는 칸을 빈 값으로 덮어쓰면 관리자가 넣어 둔 번호가 사라진다.
  const env = makeEnv(); const { b1 } = await seed(env);
  await D.setUrdealSeller(env.DB, b1.id, b1.association_id, 128);
  const j = jar(); await post(env, j, "/login", { login: "m1@x.kr", password: "pass1234" });
  await post(env, j, "/t/seocho/dashboard/business", { name: "방배 커피", category: "카페·디저트", description: "고침" }, "/t/seocho/dashboard");
  assert.equal((await D.getBusinessById(env.DB, b1.id)).urdeal_seller_id, 128);
});

test("유어딜 주소는 한 곳에서만 정한다", () => {
  const env = makeEnv();
  assert.equal(urdealBase(env), "https://live.ur-team.com");
  assert.equal(urdealBase({ URDEAL_BASE: "https://stage.ur-team.com/" }), "https://stage.ur-team.com");
  assert.match(urdealProductUrl(env, 42), /^https:\/\/live\.ur-team\.com\/products\/42$/);
});

// ── 거르개가 조용히 무시되는 문제 ────────────────────────────────────────────
//
// 2026-09-05 에 실제 유어딜을 불러 재 봤다:
//   seller_id=1     → 0건
//   seller_id=1,2   → 100건 (거르지 않은 전체)
//   seller_ids=1,2  → 100건 (그런 이름의 칸이 없어 그냥 무시)
//
// 즉 숫자가 아닌 값을 주면 오류가 나는 게 아니라 **남의 가게 상품이 전부 돌아온다.**
// 그러면 상인회 홈에 우리 골목과 아무 상관 없는 상품이 우리 가게 이름을 달고 걸린다.
// "호출을 줄이자" 며 번호를 쉼표로 잇는 순간 나는 사고라, 두 겹으로 막아 둔다.

test("가게 번호를 쉼표로 이어 붙이지 않는다 — 주소에는 숫자 하나만 실린다", async () => {
  const env = makeEnv();
  const s = stubUrdeal({});
  try {
    await fetchDeals(env, [128, 300, 411]);
    assert.equal(s.calls.length, 3, "한 번에 몰아 부르지 않는다 (유어딜에 그런 칸이 없다)");
    for (const u of s.calls) {
      const v = new URL(u).searchParams.get("seller_id");
      assert.match(v, /^\d+$/, `seller_id 에 숫자 아닌 값이 실렸다: ${v}`);
      assert.doesNotMatch(u, /seller_ids=/, "유어딜에 없는 칸을 보내면 거르개가 통째로 무시된다");
    }
  } finally { s.restore(); }
});

test("숫자가 아닌 가게 번호는 부르지도 않는다", async () => {
  const env = makeEnv();
  const s = stubUrdeal({});
  try {
    const out = await fetchDeals(env, ["1,2", "abc", -3, 0, 1.5, NaN]);
    assert.equal(s.calls.length, 0, "이런 값이 주소에 실리면 남의 가게 것이 통째로 돌아온다");
    assert.deepEqual(out, []);
  } finally { s.restore(); }
});

test("거르개가 무시돼 남의 상품이 와도 홈에 걸지 않는다", async () => {
  const env = makeEnv();
  // 128번 가게를 물었는데 유어딜이 거르지 않고 전체를 준 상황
  const s = stubUrdeal({ 128: [
    DEAL(9001, "우리 가게 이용권", 17000, 20000, "방배 커피", 128),
    DEAL(9002, "남의 가게 이용권", 9900, 20000, "강남 어딘가", 999),
    DEAL(9003, "플랫폼 상품", 300000, 300000, "연타발", null),
  ] });
  try {
    const out = await fetchDeals(env, [128]);
    assert.deepEqual(out.map((x) => x.name), ["우리 가게 이용권"],
      "번호가 다르거나 비어 있는 줄은 우리 골목 것이 아니다");
  } finally { s.restore(); }
});

test("상품에 적힌 가게 번호를 우리가 물어본 번호로 덮어쓰지 않는다", async () => {
  const env = makeEnv();
  const s = stubUrdeal({ 128: [DEAL(9001, "이용권", 1000, 2000, "방배 커피", 128)] });
  try {
    const out = await fetchDeals(env, [128]);
    assert.equal(out[0].sellerId, 128);
  } finally { s.restore(); }
});
