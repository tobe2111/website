// 전화번호를 치는 대로 끊어 주는 것.
//
// 여기서 재는 것은 "하이픈이 들어간다" 가 아니라 **서버와 같은 규칙인가** 입니다.
// 화면이 010-1234-5678 로 끊었는데 저장 뒤 서버가 다르게 되돌리면, 회장님은
// "내가 친 게 안 들어갔나" 싶어 다시 칩니다. 두 곳의 규칙이 갈리면 그때부터 아무도 못 믿습니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

// public/js/phone.js 의 format() 을 그대로 꺼내 돌린다 (브라우저 없이 규칙만 잰다)
const src = readFileSync(new URL("../public/js/phone.js", import.meta.url), "utf8");
const body = src.slice(src.indexOf("function format("), src.indexOf("// 글자를 가운데 고쳐도"));
const format = new Function(body + "; return format;")();

test("치는 대로 끊어 준다 — 휴대폰", () => {
  assert.equal(format(""), "");
  assert.equal(format("0"), "0");
  assert.equal(format("010"), "010");
  assert.equal(format("0101"), "010-1");
  assert.equal(format("0101234"), "010-1234");
  assert.equal(format("01012345"), "010-123-45");
  assert.equal(format("01012345678"), "010-1234-5678");
  assert.equal(format("010-1234-5678"), "010-1234-5678", "이미 끊긴 값을 다시 끊어도 같다");
  assert.equal(format("010 1234 5678"), "010-1234-5678", "띄어쓰기로 친 것도 받아 준다");
  assert.equal(format("010123456789999"), "010-1234-5678", "열한 자리를 넘으면 버린다");
});

test("서울(02)과 대표번호(1588)는 끊는 자리가 다르다", () => {
  assert.equal(format("025330000"), "02-533-0000");
  assert.equal(format("0212345678"), "02-1234-5678");
  assert.equal(format("15881588"), "1588-1588");
  assert.equal(format("0313334444"), "031-333-4444");
  assert.equal(format("07012345678"), "070-1234-5678");
});

test("국제번호는 손대지 않는다 — 우리가 아는 규칙이 아니다", () => {
  const wired = src.slice(src.indexOf("function apply("), src.indexOf("// ── 옆에 한 줄로"));
  assert.match(wired, /indexOf\("\+"\)\s*>=\s*0\)\s*return/, "+ 로 시작하는 값은 그대로 둔다");
});

test("화면이 끊은 모양과 서버가 되돌리는 모양이 같다", () => {
  for (const raw of ["01012345678", "0101234567", "010-1234-5678"]) {
    assert.equal(format(raw), D.formatPhone(raw),
      `화면과 서버가 다르게 끊습니다: ${raw}`);
  }
});

test("하이픈이 든 채로 보내도 서버는 숫자만 저장한다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회" });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: ad.hash, salt: ad.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const jar = { c: {} };
  const ch = () => Object.entries(jar.c).map(([k, v]) => `${k}=${v}`).join("; ");
  const absorb = (r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); jar.c[kv.slice(0, i)] = kv.slice(i + 1); } };
  const get = async (p) => { const r = await worker.fetch(new Request("http://localhost" + p, { headers: { cookie: ch() } }), env); absorb(r); return r; };
  const post = async (p, f, from) => {
    const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(from || p)).text()) || [])[1];
    const r = await worker.fetch(new Request("http://localhost" + p, { method: "POST", headers: { cookie: ch(), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
    absorb(r); return r;
  };
  await post("/login", { email: "a@bb.kr", password: "admin1234" });
  await post("/t/bb/admin/members/add",
    { name: "김사장", phone: "010-1234-5678", business_name: "버들카페", category: "카페·디저트" }, "/t/bb/admin");
  const rows = await D.listAllBusinesses(env.DB, a.id);
  assert.equal(rows.length, 1, "가게가 등록돼야 한다");
  const users = await D.listUsersByPhone(env.DB, "01012345678");
  assert.equal(users.length, 1, "하이픈을 뺀 숫자로 찾을 수 있어야 한다 — 이 번호가 곧 아이디다");
  assert.equal(users[0].phone, "01012345678", "저장은 숫자만 — 하이픈이 섞여 들어가면 안 된다");
});

test("전화 칸이 있는 화면에만 스크립트를 싣는다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회" });
  const home = await (await worker.fetch(new Request("http://localhost/t/bb/"), env)).text();
  assert.ok(!home.includes("js/phone.js"), "전화 칸이 없는 홈에는 싣지 않는다");
  const login = await (await worker.fetch(new Request("http://localhost/login"), env)).text();
  assert.ok(!/type="tel"/.test(login) || login.includes("js/phone.js"),
    "전화 칸이 있으면 반드시 함께 실려야 한다");
  assert.ok(a);
});
