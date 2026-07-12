// 성장 기능: 쿠폰 전시·초대 링크·문의 폼·미니 지도·유어딜 연계
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
  await D.createUser(env.DB, { email: "a@s.kr", passwordHash: ad.hash, salt: ad.salt, name: "관리자", role: "ADMIN", associationId: a.id });
  const pw = await hashPassword("merchant1234");
  const u = await D.createUser(env.DB, { email: "m@x.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "홍가네분식", category: "음식점", description: "떡볶이" });
  await D.updateBusiness(env.DB, b.id, { name: "홍가네분식", category: "음식점", description: "떡볶이", phone: "02-1", address: "서초대로 123", hours: "", lat: 37.49, lng: 127.01 });
  await D.setBusinessStatus(env.DB, b.id, "approved");
  return { a, b: await D.getBusinessById(env.DB, b.id) };
}

test("쿠폰: 사장님 등록 → 가게 페이지 노출, 기한 지난 쿠폰은 숨김, 삭제 동작", async () => {
  const env = makeEnv();
  const { a, b } = await seed(env);
  const j = jar(); await post(env, j, "/login", { email: "m@x.kr", password: "merchant1234" });
  let r = await post(env, j, "/t/seocho/dashboard/coupons", { title: "어묵 1개 서비스", terms: "2만원 이상", valid_until: "2099-12-31" }, "/t/seocho/dashboard");
  assert.equal(r.status, 303);
  await post(env, j, "/t/seocho/dashboard/coupons", { title: "지난 쿠폰", valid_until: "2020-01-01" }, "/t/seocho/dashboard");
  const pub = await (await get(env, jar(), `/t/seocho/business/${encodeURIComponent(b.slug)}`)).text();
  assert.match(pub, /어묵 1개 서비스/);
  assert.match(pub, /매장에서 이 화면을 보여주세요/);
  assert.doesNotMatch(pub, /지난 쿠폰/); // 기한 만료 자동 숨김
  const dash = await (await get(env, j, "/t/seocho/dashboard")).text();
  assert.match(dash, /지난 쿠폰/); // 대시보드에는 보임(관리용)
  const cid = (await D.listCoupons(env.DB, b.id)).find((c) => c.title === "지난 쿠폰").id;
  r = await post(env, j, `/t/seocho/dashboard/coupons/${cid}/delete`, {}, "/t/seocho/dashboard");
  assert.equal((await D.listCoupons(env.DB, b.id)).length, 1);
});

test("초대 링크: 관리자 생성 → 사장님 수락 → 즉시 승인 가게 + 로그인", async () => {
  const env = makeEnv();
  await seed(env);
  const j = jar(); await post(env, j, "/login", { email: "a@s.kr", password: "admin1234" });
  let r = await post(env, j, "/t/seocho/admin/invite", { biz_name: "새분식집", category: "음식점" }, "/t/seocho/admin");
  assert.equal(r.status, 303);
  const token = decodeURIComponent((/invite=([^#&]+)/.exec(r.headers.get("location")) || [])[1]);
  assert.ok(token, "토큰 생성");
  // 관리자 페이지에 초대 박스 렌더
  const adm = await (await get(env, j, `/t/seocho/admin?invite=${encodeURIComponent(token)}`)).text();
  assert.match(adm, /초대 링크가 만들어졌습니다/);
  // 사장님: 초대 페이지 열람 → 수락
  const mj = jar();
  const page = await (await get(env, mj, `/t/seocho/invite?t=${encodeURIComponent(token)}`)).text();
  assert.match(page, /새분식집/);
  r = await post(env, mj, "/t/seocho/invite", { token, name: "김새분", email: "new@x.kr", password: "newpass123", agree: "1" }, `/t/seocho/invite?t=${encodeURIComponent(token)}`);
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /dashboard/);
  const nb = await D.getBusinessByOwner(env.DB, (await D.getUserByEmail(env.DB, "new@x.kr")).id);
  assert.equal(nb.name, "새분식집");
  assert.equal(nb.status, "approved"); // 초대 = 즉시 공개
  // 위조 토큰 거부
  r = await post(env, jar(), "/t/seocho/invite", { token: token.slice(0, -2) + "xx", name: "가", email: "x2@x.kr", password: "12345678", agree: "1" }, `/t/seocho/invite?t=${encodeURIComponent(token)}`);
  assert.ok(!(await D.getUserByEmail(env.DB, "x2@x.kr")), "위조 토큰은 사용자 미생성");
});

test("문의 폼: 접수 → 관리자 알림함 기록, 허니팟은 무시", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  let r = await post(env, jar(), "/t/seocho/contact", { name: "이웃", contact: "010-1234", message: "행사 문의합니다", agree: "1" });
  assert.equal(r.status, 303);
  const notis = await D.listNotifications(env.DB, a.id);
  assert.ok(notis.some((n) => n.message.includes("행사 문의합니다")), "알림함 기록");
  const before = notis.length;
  await post(env, jar(), "/t/seocho/contact", { name: "봇", contact: "x", message: "spam", agree: "1", website: "http://spam" });
  assert.equal((await D.listNotifications(env.DB, a.id)).length, before, "허니팟 걸린 제출은 저장 안 됨");
});

test("가게 상세: 미니 지도(키 있을 때) + 유어딜 연계(대시보드·랜딩)", async () => {
  const env = makeEnv({ NAVER_MAP_CLIENT_ID: "testkey", NAVER_MAP_PARAM: "ncpKeyId" });
  const { b } = await seed(env);
  const pub = await (await get(env, jar(), `/t/seocho/business/${encodeURIComponent(b.slug)}`)).text();
  assert.match(pub, /id="bizMap"/);
  assert.match(pub, /오시는 길/);
  assert.match(pub, /maps\.js\?ncpKeyId=testkey/);
  const j = jar(); await post(env, j, "/login", { email: "m@x.kr", password: "merchant1234" });
  assert.match(await (await get(env, j, "/t/seocho/dashboard")).text(), /live\.ur-team\.com/);
  await D.setSetting(env.DB, "platform_mode", "1");
  assert.match(await (await get(env, jar(), "/")).text(), /유어딜/);
});
