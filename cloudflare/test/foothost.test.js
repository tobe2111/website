// 상인회 홈페이지 맨 아래의 '호스트사' 한 줄.
//
// 상인회 홈페이지는 그 상인회의 이름으로 떠 있어서, 손님도 사장님도 "이걸 누가 돌리고
// 누가 고쳐 주나" 를 알 길이 없었습니다. 연락할 곳이 화면에 없으면 회장님 개인 번호로
// 전화가 갑니다.
//
// 여기서 재는 것은 셋입니다 — ① 상인회 화면 아래에 뜨는가, ② 손님 화면에도 뜨는가
// (로그인한 사람만 보면 뜻이 없습니다), ③ **상인회가 아닌 제품**과 플랫폼 자체 화면에는
// 안 뜨는가. 셋째가 중요한 이유: 모집 랜딩은 그 브랜드가 손님에게 보여 주는 광고 화면이라,
// 거기에 남의 회사 이름이 박히면 그 브랜드의 화면이 아니게 됩니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const B = "http://localhost";
const get = async (env, p) => worker.fetch(new Request(B + p), env);
const HOST = "호스트사 : 리스터코퍼레이션";
const MAIL = "jiwon@ur-team.com";

async function seed(env, kind, slug) {
  const a = await D.createAssociation(env.DB, { slug, name: `${slug} 조직`, kind });
  const h = await hashPassword("pw12341234");
  await D.createUser(env.DB, { email: `${slug}@x.kr`, passwordHash: h.hash, salt: h.salt, name: "회장", role: "ADMIN", associationId: a.id });
  return a;
}

test("상인회 홈페이지 맨 아래에 호스트사와 연락처가 뜬다", async () => {
  const env = makeEnv();
  await seed(env, "merchant", "market");
  const html = await (await get(env, "/t/market/")).text();
  assert.ok(html.includes(HOST), "호스트사 줄이 없다");
  assert.ok(html.includes(`mailto:${MAIL}`), "연락처가 눌리지 않는다");
  // 저작권 줄 '뒤' 에 있어야 한다 — 상인회 이름보다 앞서면 안 된다
  assert.ok(html.indexOf("foot-copy") < html.indexOf("foot-host"), "저작권 줄보다 앞에 섰다");
});

test("로그인하지 않은 손님 화면에도 뜬다 — 회원만 보면 뜻이 없다", async () => {
  const env = makeEnv();
  await seed(env, "merchant", "market");
  for (const path of ["/t/market/", "/t/market/businesses", "/t/market/notices", "/t/market/map"]) {
    const html = await (await get(env, path)).text();
    assert.ok(html.includes(HOST), `${path} 에 호스트사 줄이 없다`);
  }
});

test("전자계약·모집 랜딩과 플랫폼 자체 화면에는 뜨지 않는다", async () => {
  const env = makeEnv();
  await seed(env, "esign", "law");
  await seed(env, "franchise", "brand");
  for (const path of ["/t/law/", "/t/brand/"]) {
    const html = await (await get(env, path)).text();
    assert.ok(!html.includes(HOST), `${path} 에 호스트사 줄이 떴다 — 상인회 제품만이다`);
  }
  // 플랫폼 자체 화면(조직이 없는 화면)에도 붙이지 않는다
  const esign = await (await get(env, "/esign")).text();
  assert.ok(!esign.includes(HOST), "플랫폼 소개 화면에 호스트사 줄이 떴다");
});

test("관리자 업무 화면에는 바닥글 자체가 없으므로 이 줄도 없다", async () => {
  const env = makeEnv();
  await seed(env, "merchant", "market");
  const jar = {};
  const r = await worker.fetch(new Request(B + "/login", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: "market@x.kr", password: "pw12341234" }).toString() }), env);
  for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  const html = await (await worker.fetch(new Request(B + "/t/market/admin", { headers: { cookie } }), env)).text();
  assert.ok(!html.includes("site-footer"), "업무 화면에 바닥글이 생겼다");
});

test("비밀번호를 치는 화면에는 붙이지 않는다 — 남의 회사 이름이 보이면 손이 멈춘다", async () => {
  const env = makeEnv();
  await seed(env, "merchant", "market");
  for (const path of ["/t/market/login", "/t/market/register", "/t/market/forgot"]) {
    const r = await get(env, path);
    if (r.status !== 200) continue;          // 그 조직에 없는 화면은 건너뛴다
    const html = await r.text();
    assert.ok(!html.includes(HOST), `${path} 에 호스트사 줄이 떴다`);
    assert.ok(html.includes("site-footer"), `${path} 의 바닥글 자체는 그대로여야 한다`);
  }
});
