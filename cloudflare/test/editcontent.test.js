// 공지·행사 고치기 + 행사 참가자 명단.
//
// 왜 이 검사가 있는가: 예전에는 만들기와 지우기만 있었다. 오타 하나를 고치려면 지우고
// 다시 써야 했고, 그러면 글 주소가 바뀌어 이미 카톡으로 돌린 링크가 죽었다.
// 매주 쓰는 기능에서 그건 못 쓰는 것이다.
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
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "방배카페골목상인회" });
  const other = await D.createAssociation(env.DB, { slug: "other", name: "다른상인회" });
  const pw = await hashPassword("pass1234");
  const mk = (e, n, role, aid) => D.createUser(env.DB, { email: e, passwordHash: pw.hash, salt: pw.salt, name: n, role, associationId: aid, phone: "01012345678" });
  await mk("ad@s.kr", "회장", "ADMIN", a.id);
  await mk("ad@o.kr", "남의회장", "ADMIN", other.id);
  const u = await mk("m@s.kr", "김순자", "MERCHANT", a.id);
  await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "모둠분식", category: "음식점" });
  return { a, other, u };
}
const login = async (env, email) => { const j = jar(); await post(env, j, "/login", { login: email, password: "pass1234" }); return j; };

test("공지를 지우지 않고 그 자리에서 고친다 (돌린 링크가 살아 있어야)", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const n = await D.createNotice(env.DB, { associationId: a.id, title: "정기총외 안내", body: "3월 5일", tag: "공지", pinned: 0 });
  const j = await login(env, "ad@s.kr");

  const page = await (await get(env, j, "/t/seocho/admin")).text();
  assert.match(page, new RegExp(`/admin/notice/${n.id}"`), "그 줄에 고치는 폼이 있어야");
  assert.match(page, /정기총외 안내/);

  const r = await post(env, j, `/t/seocho/admin/notice/${n.id}`,
    { title: "정기총회 안내", body: "3월 12일로 바뀌었습니다", tag: "공지", pinned: "1" }, "/t/seocho/admin");
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);

  const after = await D.getNotice(env.DB, n.id);
  assert.equal(after.id, n.id, "같은 글이어야 — 새 글이 되면 주소가 바뀐다");
  assert.equal(after.title, "정기총회 안내");
  assert.equal(after.body, "3월 12일로 바뀌었습니다");
  assert.equal(after.pinned, 1);
  // 손님 화면에도 고친 내용이 그 주소 그대로 보여야
  const pub = await (await get(env, jar(), `/t/seocho/notices/${n.id}`)).text();
  assert.match(pub, /정기총회 안내/);
});

test("사진을 다시 안 올리면 원래 사진이 그대로 남는다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const n = await D.createNotice(env.DB, { associationId: a.id, title: "행사", body: "", tag: "행사", image: "poster.jpg", pinned: 0 });
  const j = await login(env, "ad@s.kr");
  await post(env, j, `/t/seocho/admin/notice/${n.id}`, { title: "행사 (수정)", tag: "행사" }, "/t/seocho/admin");
  assert.equal((await D.getNotice(env.DB, n.id)).image, "poster.jpg", "안 건드린 사진을 지우면 안 된다");

  await post(env, j, `/t/seocho/admin/notice/${n.id}`, { title: "행사", tag: "행사", drop_image: "1" }, "/t/seocho/admin");
  assert.equal((await D.getNotice(env.DB, n.id)).image, "", "지우기를 체크했으면 지워야");
});

test("남의 상인회 공지는 못 고친다", async () => {
  const env = makeEnv(); const { other } = await seed(env);
  const n = await D.createNotice(env.DB, { associationId: other.id, title: "남의 공지", body: "", tag: "공지", pinned: 0 });
  const j = await login(env, "ad@s.kr");
  const r = await post(env, j, `/t/seocho/admin/notice/${n.id}`, { title: "훔치기", tag: "공지" }, "/t/seocho/admin");
  assert.match(decodeURIComponent(r.headers.get("location") || ""), /err=1/);
  assert.equal((await D.getNotice(env.DB, n.id)).title, "남의 공지");
});

test("행사도 그 자리에서 고친다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const e = await D.createEvent(env.DB, { associationId: a.id, title: "봄 축제", event_date: "2026-04-01", place: "사무실", description: "", image: "" });
  const j = await login(env, "ad@s.kr");
  const r = await post(env, j, `/t/seocho/admin/event/${e.id}`,
    { title: "봄맞이 골목 축제", event_date: "2026-04-08", place: "골목 입구", description: "우천 시 연기" }, "/t/seocho/admin");
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);
  const after = await D.getEvent(env.DB, e.id);
  assert.equal(after.title, "봄맞이 골목 축제");
  assert.equal(after.event_date, "2026-04-08");
  assert.equal(after.place, "골목 입구");
  assert.equal(after.description, "우천 시 연기");
});

test("제목이나 날짜를 비우면 거절하고 원래 값을 지키지 않는다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const e = await D.createEvent(env.DB, { associationId: a.id, title: "총회", event_date: "2026-04-01", place: "", description: "", image: "" });
  const j = await login(env, "ad@s.kr");
  const r = await post(env, j, `/t/seocho/admin/event/${e.id}`, { title: "", event_date: "2026-04-01" }, "/t/seocho/admin");
  assert.match(decodeURIComponent(r.headers.get("location") || ""), /err=1/);
  assert.equal((await D.getEvent(env.DB, e.id)).title, "총회", "거절했으면 값도 그대로여야");
});

test("행사 참가자를 이름이 아니라 명단으로 본다 (연락처 포함)", async () => {
  const env = makeEnv(); const { a, u } = await seed(env);
  const e = await D.createEvent(env.DB, { associationId: a.id, title: "정기총회", event_date: "2026-04-01", place: "", description: "", image: "" });
  await D.rsvpEvent(env.DB, e.id, a.id, u.id);
  const j = await login(env, "ad@s.kr");

  const page = await (await get(env, j, "/t/seocho/admin")).text();
  assert.match(page, /모둠분식/, "누가 오는지 가게 이름이 보여야");
  assert.match(page, /010-1234-5678/, "연락처가 보여야 — 자리·다과를 이걸로 준비한다");
  assert.match(page, new RegExp(`/admin/event/${e.id}/rsvps\\.csv`), "엑셀로 뽑는 길이 있어야");

  const res = await get(env, j, `/t/seocho/admin/event/${e.id}/rsvps.csv`);
  // BOM 은 바이트로 본다 — Response.text() 는 규격상 앞머리 BOM 을 벗겨서 돌려주므로
  // 문자열로 검사하면 실제로는 보내고 있는데 안 보낸 것처럼 보인다.
  const bytes = new Uint8Array(await res.clone().arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "엑셀이 한글을 깨뜨리지 않게 BOM 을 붙여야");
  const csv = await res.text();
  assert.match(csv, /가게,사장님,연락처,신청일시/);
  assert.match(csv, /모둠분식/);
  assert.match(csv, /010-1234-5678/);
});

test("남의 상인회 행사 명단은 못 내려받는다", async () => {
  const env = makeEnv(); const { other } = await seed(env);
  const e = await D.createEvent(env.DB, { associationId: other.id, title: "남의 행사", event_date: "2026-04-01", place: "", description: "", image: "" });
  const j = await login(env, "ad@s.kr");
  assert.equal((await get(env, j, `/t/seocho/admin/event/${e.id}/rsvps.csv`)).status, 404);
});

test("점주는 공지를 못 고친다", async () => {
  const env = makeEnv(); const { a } = await seed(env);
  const n = await D.createNotice(env.DB, { associationId: a.id, title: "공지", body: "", tag: "공지", pinned: 0 });
  const j = await login(env, "m@s.kr");
  const r = await post(env, j, `/t/seocho/admin/notice/${n.id}`, { title: "점주가 고침", tag: "공지" }, "/t/seocho/");
  assert.equal(r.status, 403);
  assert.equal((await D.getNotice(env.DB, n.id)).title, "공지");
});
