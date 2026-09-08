// 들어온 문으로 들어간다.
//
// 방배카페골목 로그인 화면에서 비밀번호를 넣었는데 리스터코퍼레이션 운영사 콘솔이
// 열리면, 로그인한 사람 눈에는 남의 회사로 튕긴 것이다. 실패했을 때도 마찬가지 —
// 비밀번호를 한 번 틀렸더니 갑자기 남의 회사 로그인 화면이 뜨면 안 된다.
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
  const sp = await hashPassword("super1234");
  await D.createUser(env.DB, { email: "s@x.kr", passwordHash: sp.hash, salt: sp.salt, name: "플랫폼 운영자", role: "SUPERADMIN", associationId: null });
  const ap = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: ap.hash, salt: ap.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const mp = await hashPassword("owner1234");
  const o = await D.createUser(env.DB, { email: "o@bb.kr", passwordHash: mp.hash, salt: mp.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  await D.createBusiness(env.DB, { associationId: a.id, ownerId: o.id, name: "너나들이", category: "음식점" });
  return a;
}
// 로그인 화면(from)에서 폼을 채워 보낸다 — 그 화면의 CSRF 토큰을 그대로 쓴다.
async function tryLogin(env, from, login, password) {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + from, { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, login, password }).toString() }), env);
  absorb(j, r);
  return { status: r.status, to: r.headers.get("location") || "", jar: j };
}

test("상인회 화면에서 운영사 계정으로 들어오면 그 상인회 관리 화면으로", async () => {
  const env = makeEnv({}); await seed(env);
  const r = await tryLogin(env, "/t/bb/login", "s@x.kr", "super1234");
  assert.equal(r.to, "/t/bb/admin", `운영사 콘솔로 튕겼다: ${r.to}`);
});

test("공용 로그인에서 운영사 계정으로 들어오면 운영사 콘솔로 (기존 동작)", async () => {
  const env = makeEnv({}); await seed(env);
  const r = await tryLogin(env, "/login", "s@x.kr", "super1234");
  assert.equal(r.to, "/super", r.to);
});

test("상인회 관리자·사장님은 종전 그대로", async () => {
  const env = makeEnv({}); await seed(env);
  assert.equal((await tryLogin(env, "/t/bb/login", "a@bb.kr", "admin1234")).to, "/t/bb/admin");
  assert.equal((await tryLogin(env, "/t/bb/login", "o@bb.kr", "owner1234")).to, "/t/bb/dashboard");
});

test("비밀번호를 틀려도 그 상인회 로그인 화면에 남는다", async () => {
  const env = makeEnv({}); await seed(env);
  const r = await tryLogin(env, "/t/bb/login", "a@bb.kr", "틀린비밀번호");
  assert.ok(r.to.startsWith("/t/bb/login"), `남의 회사 로그인으로 보냈다: ${r.to}`);
});

test("상인회 콘솔 머리말에 운영사 계정의 자리는 아예 없다", async () => {
  // 이 홈페이지를 운영하는 것은 상인회지 운영사가 아니다. 임원이 옆에서 함께 보는
  // 화면에 운영사의 이름표도, 운영사의 계정 단추도 있을 이유가 없다.
  const env = makeEnv({}); await seed(env);
  const { jar: j } = await tryLogin(env, "/t/bb/login", "s@x.kr", "super1234");
  const html = await (await get(env, j, "/t/bb/admin")).text();
  const head = html.slice(html.indexOf('<header class="site-header"'), html.indexOf("</header>"));
  assert.ok(head.length > 0);
  assert.ok(!head.includes("플랫폼 운영자"), "머리말에 운영사 이름표가 있다");
  assert.ok(!/href="\/account"/.test(head), "머리말에 운영사 계정 단추가 있다");
  // 나가는 길은 남아 있어야 한다 — 없으면 갇힌다
  assert.ok(head.includes("로그아웃"));
});

test("운영사 계정 설정은 운영사 콘솔 머리말에 있다", async () => {
  // 고객사 콘솔에서 뺐으니, 운영자가 자기 계정으로 가는 길은 자기 콘솔에 있어야 한다.
  const env = makeEnv({}); await seed(env);
  const { jar: j } = await tryLogin(env, "/login", "s@x.kr", "super1234");
  const html = await (await get(env, j, "/super")).text();
  const head = html.slice(html.indexOf('<header class="site-header"'), html.indexOf("</header>"));
  assert.ok(/href="\/account"/.test(head), "운영사 콘솔에 계정으로 가는 길이 없다");
});

test("회장님 콘솔에는 자기 계정 단추가 그대로 있다", async () => {
  const env = makeEnv({}); await seed(env);
  const { jar: j } = await tryLogin(env, "/t/bb/login", "a@bb.kr", "admin1234");
  const html = await (await get(env, j, "/t/bb/admin")).text();
  const head = html.slice(html.indexOf('<header class="site-header"'), html.indexOf("</header>"));
  assert.ok(/href="\/account"/.test(head), "관리자가 자기 계정으로 갈 길이 사라졌다");
});

test("회장님 화면에는 자기 이름이 그대로 뜬다", async () => {
  const env = makeEnv({}); await seed(env);
  const { jar: j } = await tryLogin(env, "/t/bb/login", "a@bb.kr", "admin1234");
  const html = await (await get(env, j, "/t/bb/admin")).text();
  const head = html.slice(html.indexOf('<header class="site-header"'), html.indexOf("</header>"));
  assert.ok(head.includes("회장"), "관리자 본인 이름이 사라졌다");
});

// ── 관리자 계정을 하나 더 만드는 자리
//
// 기능은 있었는데 '부관리자 추가' 라는 우리끼리 쓰는 말로, 접힌 채, 화면 맨 아래에
// 있었다. 그래서 "그런 계정 만드는 건 어디서 하냐" 는 질문을 받았다.
// 찾을 수 있는 말로 적혀 있는지, 관리자가 한 명뿐일 때 펼쳐져 있는지를 못 박는다.
test("관리자가 한 명뿐이면 '관리자 계정 만들기' 가 펼쳐져 있다", async () => {
  const env = makeEnv({}); await seed(env);
  const { jar: j } = await tryLogin(env, "/t/bb/login", "a@bb.kr", "admin1234");
  const html = await (await get(env, j, "/t/bb/admin")).text();
  assert.ok(html.includes("관리자 계정 만들기"), "찾을 수 있는 말로 적혀 있지 않다");
  const box = html.slice(html.indexOf("관리자 계정 만들기") - 200, html.indexOf("관리자 계정 만들기"));
  assert.ok(/<details[^>]*\sopen[^>]*>\s*<summary>$|open/.test(box), "관리자가 한 명뿐인데 접혀 있다");
  assert.ok(html.includes("한 분뿐입니다"), "관리자가 한 명뿐이라는 사실을 알려 주지 않는다");
});

test("누가 이 상인회의 관리자인지 늘 보여 준다", async () => {
  const env = makeEnv({}); await seed(env);
  const { jar: j } = await tryLogin(env, "/t/bb/login", "a@bb.kr", "admin1234");
  const html = await (await get(env, j, "/t/bb/admin")).text();
  assert.ok(/지금 이 상인회의 관리자[\s\S]{0,120}회장/.test(html), "현재 관리자 명단이 없다");
});

test("발급하면 관리자 권한 계정이 실제로 생긴다", async () => {
  const env = makeEnv({}); const a = await seed(env);
  const { jar: j } = await tryLogin(env, "/t/bb/login", "a@bb.kr", "admin1234");
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/admin")).text()) || [])[1];
  const r = await worker.fetch(new Request(B + "/t/bb/admin/admins/add", { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, name: "김총무", email: "chong@bb.kr" }).toString() }), env);
  assert.equal(r.status, 303, await r.text());
  const made = await D.getUserByEmail(env.DB, "chong@bb.kr");
  assert.ok(made, "계정이 만들어지지 않았다");
  assert.equal(made.role, "ADMIN");
  assert.equal(made.association_id, a.id, "다른 상인회에 붙었다");
  // 임시 비밀번호를 화면에 돌려줘야 전달할 수 있다
  const loc = decodeURIComponent(r.headers.get("location") || "");
  assert.ok(/임시 비밀번호 \w+/.test(loc), `임시 비밀번호를 알려 주지 않는다: ${loc}`);
  // 만든 자리(회원·점포)로 돌아가야 한다 — 첫 탭으로 떨어지면 "아무 반응이 없다" 로 보인다
  assert.ok(loc.endsWith("#s-people"), `만든 자리로 돌아가지 않는다: ${loc}`);
});

test("비밀번호를 직접 정할 수 있다 — 스쳐 가는 임시 비번을 놓치지 않게", async () => {
  const env = makeEnv({}); await seed(env);
  const { jar: j } = await tryLogin(env, "/t/bb/login", "a@bb.kr", "admin1234");
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/admin")).text()) || [])[1];
  await worker.fetch(new Request(B + "/t/bb/admin/admins/add", { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, name: "김총무", email: "chong2@bb.kr", password: "chongmu1234" }).toString() }), env);
  // 정한 비밀번호로 실제로 들어와져야 한다
  const r = await tryLogin(env, "/t/bb/login", "chong2@bb.kr", "chongmu1234");
  assert.equal(r.to, "/t/bb/admin", `정한 비밀번호로 못 들어온다: ${r.to}`);
});

test("너무 짧은 비밀번호는 계정을 만들지 않는다", async () => {
  const env = makeEnv({}); await seed(env);
  const { jar: j } = await tryLogin(env, "/t/bb/login", "a@bb.kr", "admin1234");
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/admin")).text()) || [])[1];
  await worker.fetch(new Request(B + "/t/bb/admin/admins/add", { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, name: "김총무", email: "short@bb.kr", password: "123" }).toString() }), env);
  assert.ok(!await D.getUserByEmail(env.DB, "short@bb.kr"), "짧은 비밀번호로 계정이 생겼다");
});

test("이미 쓰이는 이메일이면 왜 안 되는지 말해 준다", async () => {
  const env = makeEnv({}); await seed(env);
  const { jar: j } = await tryLogin(env, "/t/bb/login", "a@bb.kr", "admin1234");
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/admin")).text()) || [])[1];
  const r = await worker.fetch(new Request(B + "/t/bb/admin/admins/add", { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, name: "겹침", email: "a@bb.kr" }).toString() }), env);
  const loc = decodeURIComponent(r.headers.get("location") || "");
  assert.ok(/이미 쓰이고 있는 아이디/.test(loc), loc);
  assert.ok(/err=1/.test(loc), "오류로 표시되지 않는다");
});
