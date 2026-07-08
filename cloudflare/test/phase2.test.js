// Cloudflare 워커 2단계 검증: 회원가입·대시보드·R2 업로드·임베드·게시판·지도
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const BASE = "http://localhost";
let env, seocho;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

before(async () => {
  env = makeEnv({ NAVER_MAP_CLIENT_ID: "testkey", NAVER_MAP_PARAM: "ncpClientId" });
  seocho = await D.createAssociation(env.DB, { slug: "seocho", name: "서초구 상인회", tagline: "서초 상권" });
  const pw = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "admin@seocho.kr", passwordHash: pw.hash, salt: pw.salt, name: "관리자", role: "ADMIN", associationId: seocho.id });
});

// ---- 쿠키 자 + 헬퍼 ----
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(j, p) { const r = await worker.fetch(new Request(BASE + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function token(j) { const r = await get(j, "/login"); return (/name="_csrf" value="([^"]+)"/.exec(await r.text()) || [])[1]; }
async function postU(j, p, fields) {
  const t = await token(j);
  const r = await worker.fetch(new Request(BASE + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...fields }).toString() }), env);
  absorb(j, r); return r;
}
async function postM(j, p, fields, fileFields) {
  const t = await token(j);
  const fd = new FormData(); fd.set("_csrf", t);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  for (const [name, files] of Object.entries(fileFields || {})) for (const f of files) fd.append(name, new File([f], "a.png", { type: "image/png" }));
  const r = await worker.fetch(new Request(BASE + p, { method: "POST", headers: { cookie: ch(j) }, body: fd }), env);
  absorb(j, r); return r;
}

test("회원가입 → 대시보드 리다이렉트 + 세션", async () => {
  const j = jar();
  const r = await postU(j, "/t/seocho/register", { name: "홍상인", email: "hong@ex.kr", password: "merchant1234", business_name: "홍가네분식", category: "음식점" });
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /\/dashboard/);
  assert.ok(j.c.sc_session, "세션 쿠키 발급");
  const d = await get(j, "/t/seocho/dashboard");
  assert.equal(d.status, 200);
  assert.match(await d.text(), /홍가네분식/);
});

test("업체 정보 수정 + 좌표", async () => {
  const j = jar();
  await postU(j, "/t/seocho/register", { name: "김점포", email: "kim@ex.kr", password: "merchant1234", business_name: "김가게", category: "카페·디저트" });
  const r = await postU(j, "/t/seocho/dashboard/business", { name: "김가게", category: "카페·디저트", description: "맛있는 커피", phone: "02-1", address: "서초로 1", hours: "10-22", lat: "37.49", lng: "127.01" });
  assert.equal(r.status, 303);
  const b = await D.getBusinessByOwner(env.DB, (await D.getUserByEmail(env.DB, "kim@ex.kr")).id);
  assert.equal(b.description, "맛있는 커피");
  assert.equal(b.lat, 37.49);
});

test("사진 업로드(R2) + 임베드 추가 + 삭제", async () => {
  const j = jar();
  await postU(j, "/t/seocho/register", { name: "이사진", email: "photo@ex.kr", password: "merchant1234", business_name: "사진관", category: "생활·서비스" });
  const biz = await D.getBusinessByOwner(env.DB, (await D.getUserByEmail(env.DB, "photo@ex.kr")).id);
  let r = await postM(j, "/t/seocho/dashboard/media", { caption: "우리가게" }, { files: [PNG, PNG] });
  assert.equal(r.status, 303);
  let media = await D.listMedia(env.DB, biz.id);
  assert.equal(media.filter((m) => m.kind === "image").length, 2, "사진 2장 저장");
  assert.ok(env.MEDIA._store.has(media[0].filename), "R2 에 실제 저장");
  // 임베드
  r = await postU(j, "/t/seocho/dashboard/media/embed", { url: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(r.status, 303);
  assert.equal((await D.listMedia(env.DB, biz.id)).filter((m) => m.kind === "embed").length, 1);
  // 삭제
  const img = (await D.listMedia(env.DB, biz.id)).find((m) => m.kind === "image");
  r = await postU(j, "/t/seocho/dashboard/media/" + img.id + "/delete", {});
  assert.equal(r.status, 303);
  assert.ok(!env.MEDIA._store.has(img.filename), "R2 파일도 삭제");
});

test("게시판: 사진 2장 글 작성 → 상세 갤러리 + 댓글", async () => {
  const j = jar();
  await postU(j, "/t/seocho/register", { name: "박글", email: "post@ex.kr", password: "merchant1234", business_name: "박상점", category: "기타" });
  let r = await postM(j, "/t/seocho/board", { title: "우리 사진들", body: "여러장" }, { images: [PNG, PNG] });
  assert.equal(r.status, 303);
  const pid = r.headers.get("location").match(/\/board\/(\d+)/)[1];
  r = await get(j, "/t/seocho/board/" + pid);
  const h = await r.text();
  assert.equal((h.match(/class="gallery-item"/g) || []).length, 2, "갤러리 2장");
  assert.match(h, /js\/viewer\.js/);
  // 댓글
  r = await postU(j, "/t/seocho/board/" + pid + "/comment", { body: "좋아요" });
  assert.equal(r.status, 303);
  assert.match(await (await get(j, "/t/seocho/board/" + pid)).text(), /좋아요/);
  // 목록 썸네일 + 개수 배지
  assert.match((await (await get(j, "/t/seocho/board")).text()).replace(/<[^>]+>/g, ""), /📎\s*2/);
});

test("게시판: 비회원 차단", async () => {
  const r = await worker.fetch(new Request(BASE + "/t/seocho/board"), env);
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location"), /\/login/);
});

test("지도: 네이버 로더 + 마커 데이터", async () => {
  // photo@ex.kr 업체 승인 + 좌표
  const biz = await D.getBusinessByOwner(env.DB, (await D.getUserByEmail(env.DB, "kim@ex.kr")).id);
  await D.setBusinessStatus(env.DB, biz.id, "approved");
  const r = await get(jar(), "/t/seocho/map");
  const h = await r.text();
  assert.equal(r.status, 200);
  assert.match(h, /oapi\.map\.naver\.com/);
  assert.match(h, /ncpClientId=testkey/);
});

test("공지 목록 200", async () => {
  const r = await worker.fetch(new Request(BASE + "/t/seocho/notices"), env);
  assert.equal(r.status, 200);
});
