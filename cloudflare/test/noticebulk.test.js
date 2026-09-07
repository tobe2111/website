// 공지 여러 건을 한 번에 — 지우기·상단 고정.
//
// 예전에는 공지를 지우려면 한 건씩 펼쳐 삭제 단추를 눌러야 했다. 지난 행사 안내 열 건을
// 치우는 데 열 번을 눌러야 하니 결국 아무도 안 치우고, 손님이 보는 공지 목록에는
// 반년 전 안내가 맨 위에 남아 있었다.
//
// 여러 건을 한 번에 지우는 기능은 되돌릴 수 없으므로 두 가지를 반드시 지킨다:
//   ① 남의 상인회 공지 번호를 보내도 손대지 못한다 (화면이 아니라 서버가 막는다)
//   ② 아무것도 안 골랐으면 아무 일도 일어나지 않는다
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
async function post(env, j, p, fields, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const body = new URLSearchParams();
  body.set("_csrf", t);
  for (const [k, v] of Object.entries(fields)) Array.isArray(v) ? v.forEach((x) => body.append(k, x)) : body.set(k, v);
  const r = await worker.fetch(new Request(B + p, { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: body.toString() }), env);
  absorb(j, r); return r;
}

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배 상인회", kind: "merchant" });
  const pw = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: pw.hash, salt: pw.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const ids = [];
  for (const t of ["총회 안내", "축제 참가", "가로등 공사"])
    ids.push((await D.createNotice(env.DB, { associationId: a.id, title: t, body: "본문", tag: "안내" })).id);
  return { a, ids };
}
const login = async (env) => {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/login")).text()) || [])[1];
  await post(env, j, "/t/bb/login", { _csrf: t, login: "a@bb.kr", password: "admin1234" }, "/t/bb/login");
  return j;
};

test("고른 공지만 한 번에 지운다", async () => {
  const env = makeEnv(); const { a, ids } = await seed(env);
  const j = await login(env);
  await post(env, j, "/t/bb/admin/notices/bulk", { act: "delete", ids: [String(ids[0]), String(ids[2])] }, "/t/bb/admin");
  const left = await D.listNotices(env.DB, a.id);
  assert.equal(left.length, 1, "두 건만 지워져야");
  assert.equal(left[0].title, "축제 참가", "고르지 않은 것은 남아야");
});

test("여러 건을 한 번에 상단 고정하고 다시 푼다", async () => {
  const env = makeEnv(); const { a, ids } = await seed(env);
  const j = await login(env);
  await post(env, j, "/t/bb/admin/notices/bulk", { act: "pin", ids: [String(ids[0]), String(ids[1])] }, "/t/bb/admin");
  let list = await D.listNotices(env.DB, a.id);
  assert.equal(list.filter((n) => n.pinned).length, 2);
  await post(env, j, "/t/bb/admin/notices/bulk", { act: "unpin", ids: [String(ids[0])] }, "/t/bb/admin");
  list = await D.listNotices(env.DB, a.id);
  assert.equal(list.filter((n) => n.pinned).length, 1, "푼 것만 풀려야");
});

test("남의 상인회 공지는 번호를 보내도 지워지지 않는다", async () => {
  const env = makeEnv(); await seed(env);
  const other = await D.createAssociation(env.DB, { slug: "gn", name: "강남 상인회", kind: "merchant" });
  const foreign = await D.createNotice(env.DB, { associationId: other.id, title: "남의 공지", body: "", tag: "안내" });
  const j = await login(env);
  await post(env, j, "/t/bb/admin/notices/bulk", { act: "delete", ids: [String(foreign.id)] }, "/t/bb/admin");
  assert.equal((await D.listNotices(env.DB, other.id)).length, 1, "남의 상인회 공지가 지워지면 안 된다");
});

test("아무것도 안 골랐으면 아무 일도 일어나지 않는다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const j = await login(env);
  const r = await post(env, j, "/t/bb/admin/notices/bulk", { act: "delete" }, "/t/bb/admin");
  assert.equal(r.status, 303);
  assert.match(decodeURIComponent(r.headers.get("location") || ""), /고른 공지가 없습니다/);
  assert.equal((await D.listNotices(env.DB, a.id)).length, 3, "한 건도 지워지면 안 된다");
});

test("콘솔에 표와 도구줄이 있고, 새 공지 폼은 접혀 있다", async () => {
  const env = makeEnv(); await seed(env);
  const j = await login(env);
  const html = await (await get(env, j, "/t/bb/admin")).text();
  assert.match(html, /class="notice-table"/, "목록이 표여야");
  assert.match(html, /선택 삭제/);
  assert.match(html, /상단 고정<\/button>/);
  assert.match(html, /class="fold-write"[\s\S]{0,80}새 공지 쓰기/, "쓰기는 접힌 자리에서 연다");
  assert.match(html, /form="noticeBulk"/, "체크 상자가 도구줄의 폼에 이어져야");
});

// ── 행사도 같은 방식 ──
// 공지만 표로 바꾸고 바로 옆 행사는 옛 방식으로 두면, 한 화면에 두 가지 조작법이 섞인다.
test("행사도 고른 것만 한 번에 지운다 — 참가 신청도 함께", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const e1 = await D.createEvent(env.DB, { associationId: a.id, title: "가을 축제", event_date: "2026-10-01", place: "골목 광장" });
  const e2 = await D.createEvent(env.DB, { associationId: a.id, title: "대청소", event_date: "2026-10-08", place: "입구" });
  const j = await login(env);
  await post(env, j, "/t/bb/admin/events/bulk", { act: "delete", ids: [String(e1.id)] }, "/t/bb/admin");
  const left = await D.listEvents(env.DB, a.id);
  assert.equal(left.length, 1);
  assert.equal(left[0].id, e2.id, "고르지 않은 행사는 남아야");
});

test("남의 상인회 행사는 번호를 보내도 지워지지 않는다", async () => {
  const env = makeEnv(); await seed(env);
  const other = await D.createAssociation(env.DB, { slug: "gn2", name: "강남 상인회", kind: "merchant" });
  const foreign = await D.createEvent(env.DB, { associationId: other.id, title: "남의 행사", event_date: "2026-10-01" });
  const j = await login(env);
  await post(env, j, "/t/bb/admin/events/bulk", { act: "delete", ids: [String(foreign.id)] }, "/t/bb/admin");
  assert.equal((await D.listEvents(env.DB, other.id)).length, 1, "남의 상인회 행사가 지워지면 안 된다");
});

test("공지와 행사가 같은 조작법을 쓴다 — 한 화면에 두 방식이 섞이지 않게", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  await D.createEvent(env.DB, { associationId: a.id, title: "가을 축제", event_date: "2026-10-01" });
  const j = await login(env);
  const html = await (await get(env, j, "/t/bb/admin")).text();
  assert.match(html, /form="noticeBulk"/, "공지 표");
  assert.match(html, /form="eventBulk"/, "행사도 같은 표");
  // 콘텐츠 탭 안(공지·행사)만 본다 — 팝업·문의함은 아직 옛 목록을 쓰고, 그건 이번 범위가 아니다
  const tab = html.slice(html.indexOf('id="p-content"'), html.indexOf('id="p-popup-wrap"'));
  assert.doesNotMatch(tab, /class="admin-mini-list"/, "공지·행사에 옛 목록이 남아 있으면 안 된다");
});
