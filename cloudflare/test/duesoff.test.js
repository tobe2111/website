// 회비를 안 걷는 상인회는 장부를 감춘다.
//
// 회비 개념이 없는 상인회가 있다. 그런 곳에 빈 장부를 띄워 두면 "이건 뭐지, 내가 뭘
// 안 한 건가" 가 되고, 총회 때 안 쓰는 화면을 설명하게 된다.
//
// 감추는 것이지 지우는 것이 아니다 — 이게 이 파일의 본론이다. 실수로 껐을 때
// 되돌릴 수 없으면 아무도 그 단추를 못 누른다.
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
const post = async (env, j, p, f) => {
  const r = await worker.fetch(new Request(B + p, { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(f).toString() }), env);
  absorb(j, r); return r;
};
const csrfOf = async (env, j, p) => (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, p)).text()) || [])[1];

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회", kind: "merchant" });
  const ap = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: ap.hash, salt: ap.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const mp = await hashPassword("owner1234");
  const owner = await D.createUser(env.DB, { email: "o@bb.kr", passwordHash: mp.hash, salt: mp.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  return { a, owner };
}
const login = async (env, email, pw) => {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/login")).text()) || [])[1];
  await post(env, j, "/t/bb/login", { _csrf: t, login: email, password: pw });
  return j;
};

test("기본은 켜짐 — 지금까지 쓰던 곳은 그대로다", async () => {
  const env = makeEnv({}); const { a } = await seed(env);
  assert.equal(D.usesDues(await D.getAssociationById(env.DB, a.id)), true);
  const j = await login(env, "a@bb.kr", "admin1234");
  const html = await (await get(env, j, "/t/bb/admin")).text();
  assert.ok(html.includes('id="p-dues"'), "회비 장부가 안 보인다");
});

test("끄면 장부가 화면에서 사라진다", async () => {
  const env = makeEnv({}); await seed(env);
  const j = await login(env, "a@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/admin");
  const r = await post(env, j, "/t/bb/admin/dues/enabled", { _csrf: t, on: "0" });
  assert.equal(r.status, 303);
  const html = await (await get(env, j, "/t/bb/admin")).text();
  assert.ok(!html.includes('id="p-dues"'), "껐는데 장부가 그대로 있다");
  // 눌러도 없는 자리로 가는 바로 가기가 남아 있으면 안 된다
  assert.ok(!html.includes('href="#p-dues"'), "바로 가기가 남아 있다");
});

test("끈다고 기록이 지워지지는 않는다 — 다시 켜면 그대로 있다", async () => {
  const env = makeEnv({}); const { a, owner } = await seed(env);
  await D.setDuesAmount(env.DB, a.id, 30000);
  await D.setDuesAccount(env.DB, a.id, "국민 123456-01-789012");
  const j = await login(env, "a@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/admin");
  await post(env, j, "/t/bb/admin/dues", { _csrf: t, user_id: String(owner.id), amount: "30000" }).catch(() => {});

  await post(env, j, "/t/bb/admin/dues/enabled", { _csrf: t, on: "0" });
  const off = await D.getAssociationById(env.DB, a.id);
  assert.equal(Number(off.dues_amount), 30000, "껐더니 기본 회비가 지워졌다");
  assert.equal(off.dues_account, "국민 123456-01-789012", "껐더니 계좌가 지워졌다");

  await post(env, j, "/t/bb/admin/dues/enabled", { _csrf: t, on: "1" });
  const html = await (await get(env, j, "/t/bb/admin")).text();
  assert.ok(html.includes('id="p-dues"'), "다시 켰는데 장부가 안 보인다");
  assert.ok(html.includes("30000") || html.includes("30,000"), "다시 켰는데 기본 회비가 안 보인다");
});

test("꺼져 있을 때만 설정에 '다시 켜기' 가 뜬다", async () => {
  const env = makeEnv({}); await seed(env);
  const j = await login(env, "a@bb.kr", "admin1234");
  const t = await csrfOf(env, j, "/t/bb/admin");
  assert.ok(!(await (await get(env, j, "/t/bb/admin")).text()).includes('id="p-off"'),
    "켜져 있는데 '쓰지 않기로 한 것' 이 떠 있다 — 평소에 없어야 할 줄이다");
  await post(env, j, "/t/bb/admin/dues/enabled", { _csrf: t, on: "0" });
  assert.ok((await (await get(env, j, "/t/bb/admin")).text()).includes('id="p-off"'),
    "껐는데 다시 켤 길이 없다");
});

test("사장님(MERCHANT)은 끄지 못한다", async () => {
  const env = makeEnv({}); const { a } = await seed(env);
  const j = await login(env, "o@bb.kr", "owner1234");
  const t = await csrfOf(env, j, "/t/bb");
  const r = await post(env, j, "/t/bb/admin/dues/enabled", { _csrf: t, on: "0" });
  assert.ok(r.status === 303 || r.status === 403, `상태 ${r.status}`);
  assert.equal(D.usesDues(await D.getAssociationById(env.DB, a.id)), true, "사장님이 회비 장부를 껐다");
});

test("옛 배포에서 올라온 조직(값 없음)도 켜진 것으로 본다", async () => {
  // 컬럼이 늘기 전에 만들어진 행은 마이그레이션이 1 을 채운다. 혹시 비어 있어도
  // '안 쓴다' 로 읽히면 멀쩡히 쓰던 장부가 소리 없이 사라진다 — 그쪽이 훨씬 나쁘다.
  assert.equal(D.usesDues({ uses_dues: 1 }), true);
  assert.equal(D.usesDues({ uses_dues: undefined }), true);
  assert.equal(D.usesDues({}), true);
  assert.equal(D.usesDues({ uses_dues: 0 }), false);
});
