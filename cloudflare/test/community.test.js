// 커뮤니티 기능: 소식 피드·휴무·영업중 필터·투표·행사 신청·회비·추천
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
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
async function seed(env) {
  const su = await hashPassword("super1234");
  await D.createUser(env.DB, { email: "s@p.kr", passwordHash: su.hash, salt: su.salt, name: "슈퍼", role: "SUPERADMIN", associationId: null });
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "서초구 상인회" });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@s.kr", passwordHash: ad.hash, salt: ad.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const pw = await hashPassword("merchant1234");
  const u = await D.createUser(env.DB, { email: "m@x.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "홍가네분식", category: "음식점", description: "떡볶이" });
  await D.updateBusiness(env.DB, b.id, { name: "홍가네분식", category: "음식점", description: "떡볶이", phone: "", address: "", hours: "매일 00:00-23:59", lat: null, lng: null });
  await D.setBusinessStatus(env.DB, b.id, "approved");
  return { a, u, b: await D.getBusinessById(env.DB, b.id) };
}

test("소식 피드: 등록 → 가게 페이지·홈 노출, 삭제 동작", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const j = jar(); await post(env, j, "/login", { email: "m@x.kr", password: "merchant1234" });
  let r = await post(env, j, "/t/seocho/dashboard/updates", { body: "오늘 생딸기 크레페 한정 20개!" }, "/t/seocho/dashboard");
  assert.equal(r.status, 303);
  assert.match(await (await get(env, jar(), `/t/seocho/business/${encodeURIComponent(b.slug)}`)).text(), /생딸기 크레페/);
  const home = await (await get(env, jar(), "/t/seocho")).text();
  assert.match(home, /동네 새소식/);
  assert.match(home, /생딸기 크레페/);
  const uid = (await D.listUpdates(env.DB, b.id))[0].id;
  await post(env, j, `/t/seocho/dashboard/updates/${uid}/delete`, {}, "/t/seocho/dashboard");
  assert.equal((await D.listUpdates(env.DB, b.id)).length, 0);
});

test("임시휴무: 토글 → 카드에 '오늘 휴무', 영업중 필터에서 제외, 재토글 해제", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const j = jar(); await post(env, j, "/login", { email: "m@x.kr", password: "merchant1234" });
  await post(env, j, "/t/seocho/dashboard/dayoff", {}, "/t/seocho/dashboard");
  assert.equal((await D.getBusinessById(env.DB, b.id)).day_off_date, D.kstToday());
  const list = await (await get(env, jar(), "/t/seocho/businesses")).text();
  assert.match(list, /오늘 휴무/);
  const open = await (await get(env, jar(), "/t/seocho/businesses?open=1")).text();
  assert.doesNotMatch(open, /market-card/); // 24시간 영업이지만 휴무라 제외
  await post(env, j, "/t/seocho/dashboard/dayoff", {}, "/t/seocho/dashboard");
  assert.equal((await D.getBusinessById(env.DB, b.id)).day_off_date, "");
  assert.match(await (await get(env, jar(), "/t/seocho/businesses?open=1")).text(), /market-card/);
});

test("투표: 생성 → 투표·변경 → 결과 → 마감 후 투표 불가", async () => {
  const env = makeEnv();
  await seed(env);
  const aj = jar(); await post(env, aj, "/login", { email: "a@s.kr", password: "admin1234" });
  let r = await post(env, aj, "/t/seocho/admin/polls", { title: "골목축제 공동 부스", body: "참여 여부", closes_at: "" }, "/t/seocho/polls");
  assert.equal(r.status, 303);
  const poll = (await D.listPolls(env.DB, 1))[0];
  const mj = jar(); await post(env, mj, "/login", { email: "m@x.kr", password: "merchant1234" });
  await post(env, mj, `/t/seocho/polls/${poll.id}/vote`, { choice: "yes" }, "/t/seocho/polls");
  assert.equal(await D.userVote(env.DB, poll.id, 3), "yes");
  await post(env, mj, `/t/seocho/polls/${poll.id}/vote`, { choice: "no" }, "/t/seocho/polls"); // 변경
  const res = await D.pollResults(env.DB, poll.id);
  assert.deepEqual([res.yes, res.no, res.total], [0, 1, 1]);
  const page = await (await get(env, mj, "/t/seocho/polls")).text();
  assert.match(page, /골목축제 공동 부스/);
  await post(env, aj, `/t/seocho/admin/polls/${poll.id}/close`, {}, "/t/seocho/polls");
  r = await post(env, mj, `/t/seocho/polls/${poll.id}/vote`, { choice: "yes" }, "/t/seocho/polls");
  assert.equal(await D.userVote(env.DB, poll.id, 3), "no"); // 마감 후 불변
});

test("행사 참가 신청: 신청·취소 + 관리자 명단 노출", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const ev = await D.createEvent(env.DB, { associationId: a.id, title: "가을 골목축제", description: "", event_date: "2099-10-10", place: "" });
  const mj = jar(); await post(env, mj, "/login", { email: "m@x.kr", password: "merchant1234" });
  let r = await post(env, mj, `/t/seocho/events/${ev.id}/rsvp`, {}, "/t/seocho/events");
  assert.equal(r.status, 303);
  assert.equal(await D.rsvpCount(env.DB, ev.id), 1);
  const aj = jar(); await post(env, aj, "/login", { email: "a@s.kr", password: "admin1234" });
  assert.match(await (await get(env, aj, "/t/seocho/admin")).text(), /참가 1곳/);
  await post(env, mj, `/t/seocho/events/${ev.id}/rsvp/cancel`, {}, "/t/seocho/events");
  assert.equal(await D.rsvpCount(env.DB, ev.id), 0);
});

test("회비 장부: 납부 체크·취소 + 현황 표시", async () => {
  const env = makeEnv();
  const { u } = await seed(env);
  const j = jar(); await post(env, j, "/login", { email: "a@s.kr", password: "admin1234" });
  const period = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
  let r = await post(env, j, "/t/seocho/admin/dues", { period, user_id: String(u.id), on: "1" }, "/t/seocho/admin");
  assert.equal(r.status, 303);
  assert.equal((await D.listDuesForPeriod(env.DB, 1, period)).length, 1);
  assert.match(await (await get(env, j, "/t/seocho/admin")).text(), /1\/1 납부/);
  await post(env, j, "/t/seocho/admin/dues", { period, user_id: String(u.id), on: "0" }, "/t/seocho/admin");
  assert.equal((await D.listDuesForPeriod(env.DB, 1, period)).length, 0);
});

test("가게 추천: 같은 업종 다른 가게가 상세 하단에", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const pw = await hashPassword("merchant1234");
  const u2 = await D.createUser(env.DB, { email: "m2@x.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장2", role: "MERCHANT", associationId: a.id });
  const b2 = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u2.id, name: "교대분식", category: "음식점", description: "" });
  await D.setBusinessStatus(env.DB, b2.id, "approved");
  const h = await (await get(env, jar(), `/t/seocho/business/${encodeURIComponent(b.slug)}`)).text();
  assert.match(h, /이런 가게는 어때요/);
  assert.match(h, /교대분식/);
  // 찜 훅: 카드에 data-slug + fav 버튼
  const list = await (await get(env, jar(), "/t/seocho/businesses")).text();
  assert.match(list, /data-fav=/);
  assert.match(list, /js\/fav\.js/);
});
