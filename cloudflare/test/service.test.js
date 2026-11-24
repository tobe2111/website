// 홈페이지 제작 서비스 판매 사이트(/service) — 결제대행사(토스페이먼츠) 심사에서 반려된 사유가
// 다시 들어오지 않게 지킨다:
//   ① 바닥글 상호 · 사업장 주소가 사업자등록증과 같아야 한다
//   ② '견적 문의' 상품은 입점 불가 — 정해진 가격이어야 한다
//   ③ 광고 · 마케팅 업종은 입점 불가 — 그런 서비스를 소개하면 안 된다
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { BIZ, serviceHostPath, PRICE } from "../src/homepageSite.js";
import * as B from "../src/billing.js";

const go = async (env, url) => worker.fetch(new Request(url), env, { waitUntil() {}, passThroughOnException() {} });
async function ready(extra = {}) {
  const env = makeEnv(extra);
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "op@x.kr", passwordHash: pw.hash, salt: pw.salt, name: "운영", role: "SUPERADMIN", associationId: null });
  return env;
}
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

for (const path of ["/service", "/service/terms", "/service/refund", "/service/privacy", "/service/order"]) {
  test(`${path}: 바닥글에 사업자등록증과 같은 상호 · 주소 · 번호가 있다`, async () => {
    const env = await ready();
    const r = await go(env, "https://example.com" + path);
    assert.equal(r.status, 200);
    const h = await r.text();
    for (const v of [`상호 ${BIZ.name}`, BIZ.address, BIZ.bizNo, BIZ.mailOrderNo, BIZ.ceo]) assert.ok(h.includes(v), `${v} 가 없다`);
    assert.ok(!h.includes("리스터코퍼레이션"), "바뀌기 전 상호가 남아 있다");
  });
  test(`${path}: 광고 · 마케팅 · 견적 문구가 없다`, async () => {
    const env = await ready();
    const t = text(await (await go(env, "https://example.com" + path)).text());
    for (const w of ["광고", "마케팅", "견적"]) assert.ok(!t.includes(w), `'${w}' 가 화면에 있다: …${t.slice(Math.max(0, t.indexOf(w) - 40), t.indexOf(w) + 20)}…`);
  });
}

test("가격 · 약관 · 환불 정책이 서로 이어져 있다", async () => {
  const env = await ready();
  const h = await (await go(env, "https://example.com/service")).text();
  assert.match(h, /id="price"/);
  assert.match(h, /href="\/service\/refund"/);
  assert.match(h, /href="\/service\/terms"/);
  const t = await (await go(env, "https://example.com/service/terms")).text();
  assert.match(t, /제6조 \(환불\)/);
});

test("전용 도메인으로 들어오면 첫 화면이 이 사이트다 — 다른 도메인은 그대로", async () => {
  assert.equal(serviceHostPath("hp.example.kr", "hp.example.kr", "/"), "/service");
  assert.equal(serviceHostPath("www.hp.example.kr", "https://hp.example.kr/", "/refund"), "/service/refund");
  assert.equal(serviceHostPath("other.kr", "hp.example.kr", "/"), null);
  assert.equal(serviceHostPath("hp.example.kr", "", "/"), null);
  const env = await ready({ SERVICE_HOST: "hp.example.kr" });
  const h = await (await go(env, "https://hp.example.kr/")).text();
  assert.match(h, /유어팀<span[^>]*>홈페이지/);
  assert.match(h, /사업장 소재지/);
});

test("가격이 정해진 금액으로 적혀 있다 — 빈칸(○○)이 없다", async () => {
  const env = await ready();
  const h = await (await go(env, "https://example.com/service")).text();
  assert.ok(!h.includes("○○</b>"), "가격 빈칸이 남아 있다");
  assert.equal((h.match(/<b>990,000<\/b>원/g) || []).length, 3, "초기 제작비 990,000원이 업종 셋에");
  assert.equal((h.match(/<b>15,000<\/b>원/g) || []).length, 3, "월 이용료 15,000원이 업종 셋에");
});

test("요금표 숫자와 신청 · 결제 금액이 같다", async () => {
  const env = await ready();
  const h = await (await go(env, "https://example.com/service")).text();
  assert.ok(h.includes(`<b>${PRICE.setup.toLocaleString("ko-KR")}</b>원`));
  assert.ok(h.includes(`<b>${PRICE.monthly.toLocaleString("ko-KR")}</b>원`));
});

test("선불: 첫 화면에서 신청 · 결제로 바로 갈 수 있고, 결제가 제작보다 앞에 있다", async () => {
  const env = await ready();
  const h = await (await go(env, "https://example.com/service")).text();
  assert.match(h, /href="\/service\/order"[^>]*>신청하고 결제하기/);
  assert.ok(h.indexOf("<b>신청 · 결제</b>") > 0 && h.indexOf("<b>신청 · 결제</b>") < h.indexOf("<b>제작 · 검수</b>"), "결제가 제작보다 먼저");
});

test("신청서를 내면 조직 · 계정 · 결제 안내가 생기고 곧바로 결제 화면으로 간다", async () => {
  const env = await ready({ TOSS_CLIENT_KEY: "test_ck_abcdefgh12345678", TOSS_SECRET_KEY: "test_sk_abcdefgh12345678" });
  const jar = {}; const ck = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  const eat = (r) => { for (const c of r.headers.getSetCookie()) { const kv = c.split(";")[0]; const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); } };
  const call = (path, init = {}) => worker.fetch(new Request("https://example.com" + path, { ...init, headers: { ...(init.headers || {}), cookie: ck() } }), env, { waitUntil() {}, passThroughOnException() {} });
  let r = await call("/service/order?plan=clinic"); eat(r);
  const form = await r.text();
  assert.match(form, /value="clinic" checked/);
  assert.match(form, /1,005,000원/);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(form)[1];
  const post = (f) => call("/service/order", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: csrf, ...f }).toString() });
  const ok = { plan: "clinic", name: "새봄의원", admin_name: "김원장", phone: "010-1234-5678", email: "kim@saebom.kr", password: "pass12345", agree: "1" };
  r = await post({ ...ok, agree: "" });
  assert.match(decodeURIComponent(r.headers.get("location")), /동의가 필요/);
  r = await post(ok); eat(r);
  assert.equal(r.status, 303);
  const to = r.headers.get("location");
  assert.match(to, /^\/t\/[a-z0-9-]+\/admin\/billing\?msg=/);
  const slug = to.split("/")[2];
  const a = await D.getAssociationBySlug(env.DB, slug);
  assert.equal(a.kind, "franchise"); assert.equal(a.preset, "clinic");
  const sub = await B.getSubscription(env.DB, a.id);
  assert.equal(sub.status, "offered"); assert.equal(sub.monthly_amount, PRICE.monthly); assert.equal(sub.setup_amount, PRICE.setup);
  r = await call(to);
  const bill = await r.text();
  assert.equal(r.status, 200, "가입하자마자 로그인된 채로 결제 화면이 열린다");
  assert.match(bill, /data-toss-billing/);
  assert.match(bill, /1,005,000원 결제하기/);
  // 같은 이메일로 또 신청하면 로그인하라고 알려 준다
  r = await post(ok);
  assert.match(decodeURIComponent(r.headers.get("location")), /이미 신청하신 이메일/);
});
