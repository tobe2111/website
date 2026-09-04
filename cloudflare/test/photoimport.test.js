// 웹에서 가게 사진을 찾아 담는 것.
//
// 여기서 재는 것은 "사진이 담긴다" 가 아니라 **우리가 아무 주소나 찌르는 창구가 되지 않는가** 입니다.
// 고를 주소를 화면에서 받아 그대로 가져오면, 그 칸이 곧 내부망을 두드리는 통로가 됩니다(SSRF).
// 그리고 남의 사진이므로 **출처가 함께 남는가**도 잽니다 — 안 남기면 내려 달라는 요청이 왔을 때
// 어느 사진인지 찾을 수조차 없습니다.
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
async function post(env, j, p, pairs, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const body = new URLSearchParams(); body.set("_csrf", t);
  for (const [k, v] of pairs) body.append(k, v);
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: body.toString() }), env);
  absorb(j, r); return r;
}

// 1x1 PNG (진짜 이미지 바이트 — sniffImage 가 헤더로 판정한다)
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

// 카카오 이미지 검색과 사진 내려받기를 가로챈다 — 검사가 남의 서버에 기대면 남의 사정으로 빨개진다
function intercept(env, { docs, onFetch } = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    if (url.includes("dapi.kakao.com/v2/search/image"))
      return new Response(JSON.stringify({ documents: docs || [] }), { headers: { "content-type": "application/json" } });
    if (onFetch) { const r = onFetch(url); if (r) return r; }
    return new Response(PNG, { headers: { "content-type": "image/png" } });
  };
  return () => { globalThis.fetch = real; };
}

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회" });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: ad.hash, salt: ad.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const op = await hashPassword("owner1234");
  const owner = await D.createUser(env.DB, { email: "o@bb.kr", passwordHash: op.hash, salt: op.salt, name: "사장", role: "OWNER", associationId: a.id });
  const biz = await D.createBusiness(env.DB, { associationId: a.id, ownerId: owner.id, name: "버들카페", category: "카페·디저트" });
  const j = jar();
  await post(env, j, "/login", [["email", "a@bb.kr"], ["password", "admin1234"]]);
  return { a, biz, j };
}
const OK_DOC = { image_url: "https://img.example.com/a.png", thumbnail_url: "https://img.example.com/t.png",
  display_sitename: "방배블로그", doc_url: "https://blog.example.com/post/1", width: 800, height: 600 };

test("열쇠가 없으면 창구가 열리지 않는다", async () => {
  const env = makeEnv();
  const { j } = await seed(env);
  const r = await get(env, j, "/t/bb/admin/image-search?q=버들카페");
  assert.equal(r.status, 503);
});

test("찾은 사진 목록에는 출처가 함께 온다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const { j } = await seed(env);
  const stop = intercept(env, { docs: [OK_DOC] });
  try {
    const d = await (await get(env, j, "/t/bb/admin/image-search?q=버들카페")).json();
    assert.equal(d.max, 5, "최대 장수를 화면에 알려 준다");
    assert.equal(d.images.length, 1);
    assert.equal(d.images[0].site, "방배블로그");
    assert.equal(d.images[0].doc, "https://blog.example.com/post/1");
  } finally { stop(); }
});

test("고른 사진을 담으면 출처가 함께 저장된다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const { biz, j } = await seed(env);
  const stop = intercept(env, { docs: [OK_DOC] });
  try {
    await post(env, j, `/t/bb/admin/business/${biz.id}/photos/import`,
      [["q", "버들카페"], ["url", OK_DOC.image_url]], `/t/bb/admin/business/${biz.id}`);
    const media = await D.listMedia(env.DB, biz.id);
    assert.equal(media.length, 1, "사진이 담겨야 한다");
    assert.equal(media[0].source_name, "방배블로그", "출처 이름이 남아야 한다");
    assert.equal(media[0].source_url, "https://blog.example.com/post/1", "원문 주소가 남아야 한다");
  } finally { stop(); }
});

test("검색 결과에 없던 주소는 통째로 버린다 — 화면이 아니라 손으로 넣은 것이다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const { biz, j } = await seed(env);
  let touched = [];
  const stop = intercept(env, { docs: [OK_DOC], onFetch: (u) => { touched.push(u); return null; } });
  try {
    for (const evil of [
      "http://127.0.0.1/admin",            // 우리 자신
      "https://169.254.169.254/latest/",   // 클라우드 메타데이터
      "https://10.0.0.5/secret",           // 내부망
      "https://evil.example.com/x.png",    // 검색에 없던 바깥 주소
    ]) {
      await post(env, j, `/t/bb/admin/business/${biz.id}/photos/import`,
        [["q", "버들카페"], ["url", evil]], `/t/bb/admin/business/${biz.id}`);
    }
    assert.equal((await D.listMedia(env.DB, biz.id)).length, 0, "하나도 담기면 안 된다");
    const hit = touched.filter((u) => !u.includes("dapi.kakao.com"));
    assert.deepEqual(hit, [], `이 주소들로 요청이 나갔습니다: ${hit.join(", ")}`);
  } finally { stop(); }
});

test("다섯 장을 넘겨 보내도 다섯 장만 담는다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const { biz, j } = await seed(env);
  const docs = [];
  for (let i = 0; i < 8; i++) docs.push({ ...OK_DOC, image_url: `https://img.example.com/${i}.png` });
  const stop = intercept(env, { docs });
  try {
    await post(env, j, `/t/bb/admin/business/${biz.id}/photos/import`,
      [["q", "버들카페"], ...docs.map((d) => ["url", d.image_url])], `/t/bb/admin/business/${biz.id}`);
    assert.equal((await D.listMedia(env.DB, biz.id)).length, 5);
  } finally { stop(); }
});

test("이미지가 아닌 것은 담지 않는다 — 확장자가 아니라 실제 바이트로 본다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const { biz, j } = await seed(env);
  const stop = intercept(env, { docs: [OK_DOC],
    onFetch: (u) => u.includes("img.example.com") ? new Response("<html>속았지</html>", { headers: { "content-type": "image/png" } }) : null });
  try {
    await post(env, j, `/t/bb/admin/business/${biz.id}/photos/import`,
      [["q", "버들카페"], ["url", OK_DOC.image_url]], `/t/bb/admin/business/${biz.id}`);
    assert.equal((await D.listMedia(env.DB, biz.id)).length, 0, "content-type 을 믿지 않는다");
  } finally { stop(); }
});

test("남의 조직 가게에는 담지 못한다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const { biz } = await seed(env);
  const other = await D.createAssociation(env.DB, { slug: "gn", name: "강남 상인회" });
  const p = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@gn.kr", passwordHash: p.hash, salt: p.salt, name: "회장", role: "ADMIN", associationId: other.id });
  const j2 = jar();
  await post(env, j2, "/login", [["email", "a@gn.kr"], ["password", "admin1234"]]);
  const stop = intercept(env, { docs: [OK_DOC] });
  try {
    await post(env, j2, `/t/gn/admin/business/${biz.id}/photos/import`,
      [["q", "버들카페"], ["url", OK_DOC.image_url]], "/t/gn/admin");
    assert.equal((await D.listMedia(env.DB, biz.id)).length, 0);
  } finally { stop(); }
});

test("로그인하지 않은 사람은 이미지 검색을 쓸 수 없다 — 우리 한도로 남이 검색하게 두지 않는다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  await seed(env);
  const r = await get(env, jar(), "/t/bb/admin/image-search?q=버들카페");
  assert.ok(r.status === 302 || r.status === 303 || r.status === 403, `열려 있습니다 (${r.status})`);
});

// 검색 결과는 **바깥에서 온 값**입니다. 사이트 이름·주소에 무엇이 들어 있을지 우리는 모릅니다.
// 그것을 그대로 화면에 뱉으면, 남이 지은 사이트 이름 하나가 우리 관리자 화면에서 코드가 됩니다.
test("바깥에서 온 사이트 이름·주소는 글자로만 나간다", async () => {
  const env = makeEnv({ KAKAO_REST_KEY: "k" });
  const { biz, j } = await seed(env);
  const evil = { ...OK_DOC,
    display_sitename: '<script>alert(1)</script>',
    doc_url: "javascript:alert(1)" };
  const stop = intercept(env, { docs: [evil] });
  try {
    const d = await (await get(env, j, "/t/bb/admin/image-search?q=버들카페")).json();
    assert.equal(d.images[0].doc, "", "javascript: 주소는 통째로 버린다");
    await post(env, j, `/t/bb/admin/business/${biz.id}/photos/import`,
      [["q", "버들카페"], ["url", evil.image_url]], `/t/bb/admin/business/${biz.id}`);
    const html = await (await get(env, j, `/t/bb/admin/business/${biz.id}`)).text();
    assert.ok(!html.includes("<script>alert(1)</script>"), "사이트 이름이 코드가 되면 안 된다");
    assert.match(html, /&lt;script&gt;/, "글자로 나가야 한다");
    assert.ok(!/javascript:/.test(html));
  } finally { stop(); }
});

// 열쇠가 없으면 이 칸은 화면에 아예 없어야 합니다 — 눌러도 안 되는 단추를 두면
// 관리자는 자기가 뭘 잘못한 줄 압니다.
test("열쇠가 없으면 사진 찾기 칸도, 스크립트도 싣지 않는다", async () => {
  const env = makeEnv();
  const { biz, j } = await seed(env);
  const html = await (await get(env, j, `/t/bb/admin/business/${biz.id}`)).text();
  assert.ok(!html.includes("data-photo-pick"), "칸이 없어야 한다");
  assert.ok(!html.includes("photo-pick.js"), "쓰지 않을 스크립트를 받게 하지 않는다");
});
