// 지도가 안 떠도 화면이 죽지 않는다.
//
// 라이브에서 이렇게 났다: 점포 지도와 가게 상세를 열면 **화면을 가득 채운 흰 상자**만
// 보이고, 페이지가 한참 느렸다.
//
// 원인은 둘이었다.
//
//   ① 지도 자리를 빈 <div> 로 내보냈다. 네이버 지도 스크립트가 안 실리면 그 자리가
//      그냥 흰 네모로 남는다 — 손님에게는 '고장' 으로 읽힌다. 안내도, 대안도 없었다.
//
//   ② 그 스크립트만 defer 없이 동기로 실려 있었다. 남의 서버 스크립트 하나가 느리면
//      **우리 페이지의 자바스크립트 전부**가 그 뒤로 밀린다 — 메뉴 단추도, 사진 보기도,
//      전화번호 자동 정리도 그때까지 죽어 있다. 6초 늦은 스크립트로 재 보면 6,055ms 였다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const B = "http://localhost";
const get = async (env, p) => worker.fetch(new Request(B + p), env);
async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목상인회", kind: "merchant" });
  const p = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: p.hash, salt: p.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const o = await D.createUser(env.DB, { email: "o@bb.kr", passwordHash: p.hash, salt: p.salt, name: "사장", role: "MERCHANT", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: o.id, name: "버들카페", category: "음식점" });
  await D.updateBusiness(env.DB, b.id, { name: "버들카페", category: "음식점", description: "", phone: "",
    address: "서울 서초구 방배중앙로 174", hours: "09:00-21:00", lat: 37.48, lng: 126.99, mapUrl: "" });
  await D.setBusinessStatus(env.DB, b.id, "approved");
  return { a, biz: await D.getBusinessById(env.DB, b.id) };
}
const MAPKEY = { NAVER_MAP_CLIENT_ID: "demo", NAVER_MAP_PARAM: "ncpKeyId" };

test("지도 자리를 빈 채로 내보내지 않는다", async () => {
  const env = makeEnv(MAPKEY); await seed(env);
  const html = await (await get(env, "/t/bb/map")).text();
  const i = html.indexOf('id="storeMap"');
  assert.ok(i > 0, "지도 자리가 없다");
  const el = html.slice(i, html.indexOf("</div>", i));
  assert.ok(!/data-base="[^"]*"><\/div>/.test(html.slice(i, i + 400)),
    "지도 자리가 빈 <div> 다 — 스크립트가 안 실리면 흰 상자만 남는다");
  assert.ok(el.includes("<svg"), "골목 그림이 안 깔려 있다");
  assert.ok(el.includes("지도를 불러오는 중입니다"), "기다리는 동안 아무 말도 안 한다");
  assert.ok(el.includes("지도를 불러오지 못했습니다"), "못 불러왔을 때 할 말이 없다");
  assert.ok(el.includes("네이버 지도를 열 수 있습니다"), "지도가 안 떴을 때 갈 곳을 안 알려 준다");
});

test("가게 상세의 지도 자리도 빈 채로 나가지 않는다", async () => {
  const env = makeEnv(MAPKEY); const { biz } = await seed(env);
  const html = await (await get(env, `/t/bb/business/${biz.slug}`)).text();
  const i = html.indexOf('id="bizMap"');
  assert.ok(i > 0, "지도 자리가 없다");
  assert.ok(html.slice(i, html.indexOf("</div>", i)).includes("<svg"), "빈 상자로 나간다");
});

test("남의 서버 스크립트가 우리 화면 자바스크립트를 붙잡지 않는다", async () => {
  // defer 를 빠뜨리면 네이버가 느린 날 메뉴 단추부터 사진 보기까지 전부 그만큼 죽어 있다.
  // 실측: 6초 늦은 스크립트에서 화면 자바스크립트가 살아나기까지 6,055ms → 0ms.
  const env = makeEnv(MAPKEY); const { biz } = await seed(env);
  for (const p of ["/t/bb/map", `/t/bb/business/${biz.slug}`]) {
    const html = await (await get(env, p)).text();
    const tags = html.match(/<script[^>]*oapi\.map\.naver\.com[^>]*>/g) || [];
    assert.ok(tags.length, `${p}: 지도 스크립트가 없다`);
    for (const t of tags) assert.ok(/\sdefer\b/.test(t), `${p}: 동기 스크립트다 — ${t}`);
  }
});

test("소스 어디에도 동기 네이버 지도 스크립트가 남아 있지 않다", async () => {
  // 화면이 세 곳(점포 지도·가게 상세·관리자 좌표 고르기)이라, 한 곳만 고치면 반드시 또 샌다.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/pages.js", import.meta.url), "utf8");
  const tags = src.match(/<script(?![^>]*\sdefer)[^>]*oapi\.map\.naver\.com[^>]*>/g) || [];
  assert.deepEqual(tags, [], "defer 없는 지도 스크립트가 남아 있다");
});

test("지도 키가 아예 없으면 예전처럼 그림과 안내가 나온다", async () => {
  const env = makeEnv({}); await seed(env);
  const html = await (await get(env, "/t/bb/map")).text();
  assert.ok(html.includes("지도 키를 넣으면 여기에 실제 지도가 뜹니다"), "키 없는 상인회 안내가 사라졌다");
  assert.ok(!html.includes('id="storeMap"'), "키도 없는데 지도 자리를 만들었다");
});

test("지도가 안 떠도 가게 목록은 그대로 있다", async () => {
  // 지도는 거들 뿐이다. 지도가 죽어도 손님이 가게를 찾을 길은 남아야 한다.
  const env = makeEnv(MAPKEY); await seed(env);
  const html = await (await get(env, "/t/bb/map")).text();
  assert.ok(html.includes("버들카페"), "목록이 없다");
  assert.ok(html.includes("네이버 지도에서 열기"), "가게별로 지도를 열 길이 없다");
});
