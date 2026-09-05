// 사장님 사진 요청 링크 — 로그인 없이 링크 하나로 사진을 올린다.
//
// 로그인을 없앴으므로 **토큰이 곧 권한**입니다. 그래서 여기서 재는 것은 "올라간다" 가 아니라
// **그 링크로 할 수 있는 일이 딱 그것뿐인가** 입니다. 링크는 카톡으로 돌아다니므로
// 새어 나가는 것을 전제로 만들어야 합니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { makePhotoToken } from "../src/api.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, p) { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
// 1x1 PNG — 실제 이미지 바이트 (sniffImage 가 헤더로 판정한다)
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
async function upload(env, j, token, n = 1, bytes = PNG) {
  const fd = new FormData();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, `/t/bb/photos/${encodeURIComponent(token)}`)).text()) || [])[1];
  fd.set("_csrf", t || ""); fd.set("token", token);
  for (let i = 0; i < n; i++) fd.append("files", new File([bytes], `p${i}.png`, { type: "image/png" }));
  const r = await worker.fetch(new Request(B + "/t/bb/photos/upload", { method: "POST", headers: { cookie: ch(j) }, body: fd }), env);
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

test("링크를 열면 로그인 없이 사진을 보낼 수 있고, 보내면 가게에 담긴다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const token = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  const j = jar();
  const page = await (await get(env, j, `/t/bb/photos/${encodeURIComponent(token)}`)).text();
  assert.match(page, /너나들이 사장님/, "누구에게 온 요청인지 이름으로 말한다");
  assert.match(page, /사진 고르기/);
  // "로그인" 이라는 낱말은 머리말 공통 링크에도 있다. 재야 하는 것은 낱말이 아니라
  // **로그인 없이 실제로 올라가는가** 다 — 아래 upload() 가 그것을 증명한다.
  assert.ok(!/type="password"/.test(page), "비밀번호를 묻지 않는다");
  assert.ok(!/name="email"/.test(page), "아이디를 묻지 않는다");

  const r = await upload(env, j, token, 2);
  assert.equal(r.status, 303, "보낸 뒤에는 GET 으로 돌려보낸다 (새로고침 재전송 방지)");
  const media = (await D.listMedia(env.DB, b.id)).filter((m) => m.kind === "image");
  assert.equal(media.length, 2);
});

test("보내고 나면 고맙다고 말하고, 회장님에게 알림이 간다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const token = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  const j = jar();
  await upload(env, j, token, 1);
  const done = await (await get(env, j, `/t/bb/photos/${encodeURIComponent(token)}?done=1`)).text();
  assert.match(done, /보냈습니다/);
  const notes = await D.listNotifications(env.DB, a.id).catch(() => []);
  assert.ok(notes.some((n) => /사진/.test(n.message) && /너나들이/.test(n.message)),
    "회장님이 '왔다' 를 알아야 다음 가게로 넘어간다");
});

test("만료된 링크로는 못 올린다 — 2주가 지나면 닫힌다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const token = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  const orig = Date.now;
  Date.now = () => orig() + 15 * 24 * 3600 * 1000;   // 15일 뒤
  try {
    const page = await (await get(env, jar(), `/t/bb/photos/${encodeURIComponent(token)}`)).text();
    assert.match(page, /만료/);
    await upload(env, jar(), token, 1);
    assert.equal((await D.listMedia(env.DB, b.id)).length, 0, "만료 뒤에는 한 장도 들어가면 안 된다");
  } finally { Date.now = orig; }
});

test("서명을 고치거나 남의 조직 토큰을 가져오면 통하지 않는다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const other = await seed(env, "gn");
  const good = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  const foreign = await makePhotoToken(env.SESSION_SECRET, other.a.id, other.b.id);
  const tampered = good.split(".")[0] + ".AAAA";
  // 앞부분(내용)만 바꿔 남의 가게를 가리키게 만든 것
  const swapped = foreign.split(".")[0] + "." + good.split(".")[1];
  for (const bad of [tampered, swapped, foreign, "쓰레기", ""]) {
    await upload(env, jar(), bad, 1);
  }
  assert.equal((await D.listMedia(env.DB, b.id)).length, 0, "우리 가게에 아무것도 안 들어가야 한다");
  assert.equal((await D.listMedia(env.DB, other.b.id)).length, 0, "남의 가게에도 안 들어가야 한다");
});

test("초대 링크 토큰을 사진 링크로 돌려 쓸 수 없다 — 서명 문맥이 다르다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const { makeInviteToken } = await import("../src/api.js");
  const invite = await makeInviteToken(env.SESSION_SECRET, a.id, "너나들이", "음식점");
  await upload(env, jar(), invite, 1);
  assert.equal((await D.listMedia(env.DB, b.id)).length, 0);
});

test("이미지가 아닌 것은 올라가지 않는다 — 파일 이름이 아니라 실제 바이트로 본다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const token = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  await upload(env, jar(), token, 1, new TextEncoder().encode("<html>속았지</html>"));
  assert.equal((await D.listMedia(env.DB, b.id)).length, 0, "png 라고 적혀 있어도 안 된다");
});

test("요금제 사진 한도를 넘겨 올릴 수 없다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const token = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  // 무료 한도(50장)를 채워 둔다
  for (let i = 0; i < 50; i++) await D.addMedia(env.DB, { businessId: b.id, kind: "image", filename: `x${i}.png` });
  const j = jar();
  await upload(env, j, token, 3);
  assert.equal((await D.listMedia(env.DB, b.id)).length, 50, "한도를 넘으면 한 장도 더 안 들어간다");
  const page = await (await get(env, j, `/t/bb/photos/${encodeURIComponent(token)}`)).text();
  assert.match(page, /가득 찼습니다/, "왜 안 되는지 화면에서 말한다");
});

test("이 링크로 할 수 있는 일은 사진 올리기 하나뿐이다", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const token = await makePhotoToken(env.SESSION_SECRET, a.id, b.id);
  const j = jar();
  await get(env, j, `/t/bb/photos/${encodeURIComponent(token)}`);
  // 링크를 열었다고 해서 관리자 화면이 열리면 안 된다
  for (const p of ["/t/bb/admin", `/t/bb/admin/business/${b.id}`, "/t/bb/admin/members.csv"]) {
    const r = await get(env, j, p);
    assert.ok(r.status !== 200, `${p} 가 열립니다 (${r.status})`);
  }
  // 기존 사진을 지우지도 못한다
  const m = await D.addMedia(env.DB, { businessId: b.id, kind: "image", filename: "keep.png" });
  await post(env, j, `/t/bb/admin/business/${b.id}/media/${m.id}/delete`, {}, `/t/bb/photos/${encodeURIComponent(token)}`);
  assert.ok(await D.getMedia(env.DB, m.id), "사진이 지워지면 안 된다");
});

test("관리자가 단추 하나로 링크를 만든다", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const j = jar();
  await post(env, j, "/login", { email: "a@bb.kr", password: "admin1234" });
  const r = await post(env, j, `/t/bb/admin/business/${b.id}/photo-link`, {}, `/t/bb/admin/business/${b.id}`);
  assert.equal(r.status, 303);
  const loc = r.headers.get("location") || "";
  assert.match(loc, /photolink=/, "만든 링크를 화면으로 돌려준다");
  const page = await (await get(env, j, loc.replace("http://localhost", ""))).text();
  assert.match(page, /사진 요청 링크가 만들어졌습니다/);
  assert.match(page, /카톡으로 보내기/);
});

test("남의 조직 가게로는 링크를 만들지 못한다", async () => {
  const env = makeEnv();
  await seed(env);
  const other = await seed(env, "gn");
  const j = jar();
  await post(env, j, "/login", { email: "a@bb.kr", password: "admin1234" });
  const r = await post(env, j, `/t/bb/admin/business/${other.b.id}/photo-link`, {}, "/t/bb/admin");
  assert.ok(!/photolink=/.test(r.headers.get("location") || ""), "남의 가게 링크가 만들어지면 안 된다");
});
