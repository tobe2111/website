// 웹에서 사진 찾기 — 빈손으로 돌아오지 않게 검색어를 넓힌다.
//
// 화면은 상호에 지역을 붙여("너나들이 서울 서초구") 보낸다. 다른 지점이 안 섞이게 하려는
// 것인데, 동네 식당은 그 긴 말로는 웹에 아무것도 안 걸린다. 그러면 "찾지 못했습니다" 만
// 뜨고 회장님은 기능이 고장 난 줄 안다 — 실제로 그 말을 들었다.
//
// 그래서 좁은 것부터 물어보고 빈손이면 한 마디씩 줄여 간다. 그리고 **실제로 쓴 검색어**를
// 화면에 돌려준다. 담을 때 서버가 같은 말로 다시 검색해 대조하기 때문에, 이게 어긋나면
// 고른 사진이 한 장도 안 담긴다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => {
  for (const s of r.headers.getSetCookie?.() || []) {
    const kv = s.split(";")[0]; const i = kv.indexOf("=");
    j.c[kv.slice(0, i)] = kv.slice(i + 1);
  }
};
const get = async (env, j, p) => { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; };

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회", kind: "merchant" });
  const ap = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: ap.hash, salt: ap.salt, name: "회장", role: "ADMIN", associationId: a.id });
  return a;
}
const login = async (env) => {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/login")).text()) || [])[1];
  await worker.fetch(new Request(B + "/t/bb/login", { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, login: "a@bb.kr", password: "admin1234" }).toString() }), env).then((r) => absorb(j, r));
  return j;
};
// 진짜 PNG 1×1 — 담기 쪽은 확장자가 아니라 **실제 바이트**로 그림인지 판정한다.
const PNG1 = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
), (c) => c.charCodeAt(0));

// 카카오 대신 답하는 가짜 창구. `hits` 에 적힌 검색어에만 사진을 준다.
function stubKakao(hits) {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    // 사진 파일을 내려받는 요청이면 진짜 그림 바이트를 준다
    if (u.hostname === "img.example") return new Response(PNG1, { headers: { "content-type": "image/png" } });
    const q = u.searchParams.get("query");
    asked.push(q);
    const n = hits[q] || 0;
    return new Response(JSON.stringify({ documents: Array.from({ length: n }, (_, i) => ({
      image_url: `https://img.example/${encodeURIComponent(q)}-${i}.jpg`,
      thumbnail_url: `https://img.example/t-${i}.jpg`,
      display_sitename: "블로그", doc_url: "https://blog.example/1", width: 800, height: 600,
    })) }), { headers: { "content-type": "application/json" } });
  };
  return { asked, restore: () => { globalThis.fetch = real; } };
}
const ENV = { KAKAO_REST_KEY: "test-key" };

test("긴 말로 걸리면 거기서 멈춘다 — 넓히지 않는다", async () => {
  const env = makeEnv(ENV); await seed(env);
  const j = await login(env);
  const k = stubKakao({ "너나들이 서울 서초구": 5 });
  try {
    const d = await (await get(env, j, "/t/bb/admin/image-search?q=" + encodeURIComponent("너나들이 서울 서초구"))).json();
    assert.equal(d.images.length, 5);
    assert.equal(d.used, "너나들이 서울 서초구");
    assert.equal(d.widened, false, "안 넓혔는데 넓혔다고 말한다");
    assert.deepEqual(k.asked, ["너나들이 서울 서초구"], "한 번이면 될 것을 더 물었다");
  } finally { k.restore(); }
});

test("긴 말로 빈손이면 뒤에서부터 한 마디씩 줄여 간다", async () => {
  const env = makeEnv(ENV); await seed(env);
  const j = await login(env);
  const k = stubKakao({ "너나들이": 7 });   // 상호만 걸린다
  try {
    const d = await (await get(env, j, "/t/bb/admin/image-search?q=" + encodeURIComponent("너나들이 서울 서초구"))).json();
    assert.equal(d.images.length, 7, "줄여서 찾았어야 한다");
    assert.equal(d.used, "너나들이");
    assert.equal(d.widened, true, "넓혔으면 화면이 경고할 수 있게 알려야 한다");
    assert.deepEqual(k.asked, ["너나들이 서울 서초구", "너나들이 서울", "너나들이"]);
  } finally { k.restore(); }
});

test("중간 길이에서 걸리면 거기서 멈춘다 — 더 넓히지 않는다", async () => {
  const env = makeEnv(ENV); await seed(env);
  const j = await login(env);
  const k = stubKakao({ "너나들이 서울": 3, "너나들이": 99 });
  try {
    const d = await (await get(env, j, "/t/bb/admin/image-search?q=" + encodeURIComponent("너나들이 서울 서초구"))).json();
    assert.equal(d.images.length, 3, "더 넓은 말로 넘어가 버렸다 — 엉뚱한 가게가 섞인다");
    assert.equal(d.used, "너나들이 서울");
  } finally { k.restore(); }
});

test("어느 말로도 없으면 빈손이되, 마지막까지 물어본 것이 보인다", async () => {
  const env = makeEnv(ENV); await seed(env);
  const j = await login(env);
  const k = stubKakao({});
  try {
    const d = await (await get(env, j, "/t/bb/admin/image-search?q=" + encodeURIComponent("없는가게 서울 서초구"))).json();
    assert.equal(d.images.length, 0);
    assert.equal(k.asked.length, 3, "한 번만 물어보고 포기했다");
  } finally { k.restore(); }
});

test("돌려준 검색어로 담으면 실제로 담긴다 (넓힌 경우에도)", async () => {
  const env = makeEnv(ENV); await seed(env);
  const a = await D.getAssociationBySlug(env.DB, "bb");
  const op = await hashPassword("owner1234");
  const ou = await D.createUser(env.DB, { email: "o@bb.kr", passwordHash: op.hash, salt: op.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const biz = await D.createBusiness(env.DB, { associationId: a.id, ownerId: ou.id, name: "너나들이", category: "음식점" });
  const j = await login(env);
  const k = stubKakao({ "너나들이": 2 });
  try {
    const d = await (await get(env, j, "/t/bb/admin/image-search?q=" + encodeURIComponent("너나들이 서울 서초구"))).json();
    assert.equal(d.used, "너나들이");
    // 담기 쪽은 `q` 를 그대로 다시 검색해 대조한다. 화면이 `used` 를 보내야 대조가 성립한다.
    const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, `/t/bb/admin/business/${biz.id}`)).text()) || [])[1];
    const r = await worker.fetch(new Request(`${B}/t/bb/admin/business/${biz.id}/photos/import`, { method: "POST",
      headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: t, q: d.used, url: d.images[0].url }).toString() }), env);
    assert.equal(r.status, 303);
    const loc = decodeURIComponent(r.headers.get("location") || "");
    assert.ok(!/err=1/.test(loc), `담기가 거절됐다: ${loc}`);
    assert.equal(await D.countBusinessImages(env.DB, biz.id), 1, "사진이 실제로 담기지 않았다");
  } finally { k.restore(); }
});

test("내가 친 말과 다른 주소를 손으로 끼워 넣어도 담기지 않는다", async () => {
  const env = makeEnv(ENV); await seed(env);
  const a = await D.getAssociationBySlug(env.DB, "bb");
  const op = await hashPassword("owner1234");
  const ou = await D.createUser(env.DB, { email: "o@bb.kr", passwordHash: op.hash, salt: op.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const biz = await D.createBusiness(env.DB, { associationId: a.id, ownerId: ou.id, name: "너나들이", category: "음식점" });
  const j = await login(env);
  const k = stubKakao({ "너나들이": 2 });
  try {
    const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, `/t/bb/admin/business/${biz.id}`)).text()) || [])[1];
    const r = await worker.fetch(new Request(`${B}/t/bb/admin/business/${biz.id}/photos/import`, { method: "POST",
      headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: t, q: "너나들이", url: "https://evil.example/steal.jpg" }).toString() }), env);
    const loc = decodeURIComponent(r.headers.get("location") || "");
    assert.ok(/err=1/.test(loc), `검색 결과에 없던 주소가 통과했다: ${loc}`);
    assert.equal(await D.countBusinessImages(env.DB, biz.id), 0);
  } finally { k.restore(); }
});
