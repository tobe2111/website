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
import { BIZ, serviceHostPath } from "../src/homepageSite.js";

const go = async (env, url) => worker.fetch(new Request(url), env, { waitUntil() {}, passThroughOnException() {} });
async function ready(extra = {}) {
  const env = makeEnv(extra);
  const pw = await hashPassword("pass1234");
  await D.createUser(env.DB, { email: "op@x.kr", passwordHash: pw.hash, salt: pw.salt, name: "운영", role: "SUPERADMIN", associationId: null });
  return env;
}
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

for (const path of ["/service", "/service/terms", "/service/refund", "/service/privacy"]) {
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
