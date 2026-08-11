// 전수조사(4개 병렬 감사)에서 확정된 결함들의 회귀 테스트
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { back } from "../src/http.js";

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
  const u1 = await D.createUser(env.DB, { email: "m1@x.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장1", role: "MERCHANT", associationId: a.id });
  const u2 = await D.createUser(env.DB, { email: "m2@x.kr", passwordHash: pw.hash, salt: pw.salt, name: "사장2", role: "MERCHANT", associationId: a.id });
  await D.createBusiness(env.DB, { associationId: a.id, ownerId: u1.id, name: "가게1", category: "기타" });
  await D.createBusiness(env.DB, { associationId: a.id, ownerId: u2.id, name: "가게2", category: "기타" });
  return { a, u1, u2 };
}

test("back(): 쿼리가 있는 URL 에 msg 를 & 로 잇는다 (초대 토큰 오염 방지)", () => {
  assert.match(back("/invite?t=TOK", "x", true).headers.get("Location"), /^\/invite\?t=TOK&err=1&msg=/);
  assert.match(back("/dashboard", "x").headers.get("Location"), /^\/dashboard\?msg=/);
});

test("초대 흐름: 입력 오류 후에도 토큰이 살아남아 재시도 가능", async () => {
  const env = makeEnv();
  await seed(env);
  const aj = jar(); await post(env, aj, "/login", { email: "a@s.kr", password: "admin1234" });
  const r = await post(env, aj, "/t/seocho/admin/invite", { biz_name: "새가게", category: "기타" }, "/t/seocho/admin");
  const token = decodeURIComponent((/invite=([^#&]+)/.exec(r.headers.get("location")) || [])[1]);
  const mj = jar();
  // 동의 체크 누락 → 에러 리다이렉트에 붙은 t= 가 그대로 유효해야 함
  const bad = await post(env, mj, "/t/seocho/invite", { token, name: "김", email: "n@x.kr", password: "12345678" }, `/t/seocho/invite?t=${encodeURIComponent(token)}`);
  const loc = bad.headers.get("location");
  const t2 = new URL("http://x" + loc).searchParams.get("t");
  assert.equal(t2, token, "리다이렉트 URL 의 토큰이 오염되지 않아야");
  const page = await (await get(env, mj, loc)).text();
  assert.match(page, /새가게/, "재시도 폼이 정상 렌더");
});

test("서명 대상 지정 문서: 비대상 회원의 서명은 거부", async () => {
  const env = makeEnv();
  const { u1 } = await seed(env);
  const aj = jar(); await post(env, aj, "/login", { email: "a@s.kr", password: "admin1234" });
  // u1 만 대상으로 지정
  let r = await post(env, aj, "/t/seocho/admin/documents", { title: "임대 협약", body: "동의", target: "select", members: String(u1.id) }, "/t/seocho/admin/documents");
  assert.equal(r.status, 303);
  const doc = (await D.listDocuments(env.DB, 1))[0];
  // 비대상자 u2 가 서명 시도
  const mj = jar(); await post(env, mj, "/login", { email: "m2@x.kr", password: "merchant1234" });
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  r = await post(env, mj, `/t/seocho/sign/${doc.id}`, { consent: "1", signature: png, signer_name: "사장2" }, "/t/seocho/dashboard"); // CSRF 토큰은 폼 있는 페이지에서
  assert.match(decodeURIComponent(r.headers.get("location")), /서명 대상이 아닙니다/);
  assert.equal(await D.hasSigned(env.DB, doc.id, 4), false, "서명 기록이 남지 않아야");
  // 폼 접근도 차단
  const form = await get(env, mj, `/t/seocho/sign/${doc.id}`);
  assert.match(decodeURIComponent(form.headers.get("location") || ""), /서명 대상이 아닙니다/);
});

test("?msg=%25 등 잘못된 인코딩이 500 을 내지 않는다", async () => {
  const env = makeEnv();
  await seed(env);
  for (const p of ["/login?err=1&msg=%25", "/t/seocho/businesses?msg=%25"]) {
    const r = await worker.fetch(new Request(B + p), env);
    assert.notEqual(r.status, 500, p);
  }
});

test("지도 배너: 카드 수(최대 6)가 아니라 전체 승인 업체 수를 표시", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const pw = await hashPassword("merchant1234");
  for (let i = 3; i <= 9; i++) { // 총 9곳 (기본 카드 6장 초과)
    const u = await D.createUser(env.DB, { email: `mm${i}@x.kr`, passwordHash: pw.hash, salt: pw.salt, name: "m" + i, role: "MERCHANT", associationId: a.id });
    const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "가게" + i, category: "기타" });
    await D.setBusinessStatus(env.DB, b.id, "approved");
  }
  const b1 = await D.getBusinessByOwner(env.DB, 3), b2 = await D.getBusinessByOwner(env.DB, 4);
  await D.setBusinessStatus(env.DB, b1.id, "approved");
  await D.setBusinessStatus(env.DB, b2.id, "approved");
  const h = await (await worker.fetch(new Request(B + "/t/seocho"), env)).text();
  assert.match(h, /9곳이 지도 위에/);
});

test("행사 이미지: 관리자 업로드가 저장된다 (조용히 버려지던 버그)", async () => {
  const env = makeEnv();
  await seed(env);
  const aj = jar(); await post(env, aj, "/login", { email: "a@s.kr", password: "admin1234" });
  // multipart 로 1x1 png 업로드
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, aj, "/t/seocho/admin")).text()) || [])[1];
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  const fd = new FormData();
  fd.set("_csrf", t); fd.set("title", "포스터 행사"); fd.set("event_date", "2099-05-05");
  fd.set("image", new File([png], "p.png", { type: "image/png" }));
  const r = await worker.fetch(new Request(B + "/t/seocho/admin/event", { method: "POST", headers: { cookie: ch(aj) }, body: fd }), env);
  assert.equal(r.status, 303);
  const ev = (await D.listEvents(env.DB, 1)).find((e) => e.title === "포스터 행사");
  assert.ok(ev.image, "이미지 키가 저장되어야");
});

// 한글 슬러그 조직에서 안내문이 %25… 로 깨지던 버그.
// redirect() 가 encodeURI 로 전체를 다시 인코딩해 이미 인코딩된 msg 의 % 가 %25 가 됐다.
test("한글 슬러그 + 안내문: 이중 인코딩되지 않는다", () => {
  const loc = back("/t/한빛법무법인/admin/documents", "환영합니다!").headers.get("location");
  assert.ok(!/%25/.test(loc), `이중 인코딩됨: ${loc}`);
  const u = new URL(loc, B);
  assert.equal(decodeURIComponent(u.pathname), "/t/한빛법무법인/admin/documents");
  assert.equal(u.searchParams.get("msg"), "환영합니다!");
});

test("슬러그 길이 제한: 긴 상호도 주소가 감당할 만큼만", async () => {
  const { slugify } = await import("../src/util.js");
  const s = slugify("주식회사 " + "한빛".repeat(40) + " 법무법인");
  assert.ok(s.length <= 40, `너무 김: ${s.length}`);
  assert.ok(!s.endsWith("-"), "끝이 하이픈으로 잘리면 안 됨");
  assert.equal(slugify("!!!"), "biz");
});
