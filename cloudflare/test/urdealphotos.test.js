// 유어딜에 올린 사진을 가져오는 길.
//
// 카카오맵·네이버지도 사진은 가져올 수 없다 — 카카오가 "place_url 로 연결해서만 쓸 수
// 있다"고 못 박았고, 지도의 사진은 손님이 찍어 올린 것이라 소유권도 남에게 있다.
// 유어딜은 우리가 만든 서비스이고 거기 사진은 그 가게가 직접 올린 것이라 사정이 다르다.
//
// 다만 '우리 서비스' 라고 해서 화면이 보낸 주소를 그대로 받아 오면, 그 칸이 곧
// 우리 서버로 아무 주소나 찌르는 창구가 된다. 그래서 서버가 그 가게 번호로 다시 물어
// 그 목록에 있는 주소만 통과시킨다 — 그 규칙을 여기서 못 박는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sellerPhotos, belongsToSeller } from "../src/urdeal.js";

// 유어딜을 실제로 부르지 않는다. 검사가 남의 서버 상태에 묶이면 안 된다.
function stubFetch(payload, { ok = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok, json: async () => payload };
  };
  return calls;
}
const realFetch = globalThis.fetch;
const restore = () => { globalThis.fetch = realFetch; };

test("그 가게 번호의 사진만 돌려준다", async () => {
  stubFetch({ success: true, data: [
    { id: 1, name: "치즈돈가스 할인권", seller_id: 14, image_url: "https://cdn.example/a.jpg" },
    { id: 2, name: "남의 가게 상품",   seller_id: 99, image_url: "https://cdn.example/b.jpg" },
  ] });
  try {
    const out = await sellerPhotos({}, 14, 24);
    assert.equal(out.length, 1, "거르개가 무시된 응답에서 남의 사진이 섞였다");
    assert.equal(out[0].url, "https://cdn.example/a.jpg");
    assert.equal(out[0].name, "치즈돈가스 할인권");
    assert.equal(out[0].productId, 1);
  } finally { restore(); }
});

test("가게 번호가 비어 있는 줄은 버린다 (플랫폼 상품)", async () => {
  stubFetch({ data: [{ id: 3, name: "플랫폼 상품", image_url: "https://cdn.example/c.jpg" }] });
  try {
    assert.deepEqual(await sellerPhotos({}, 14, 24), []);
  } finally { restore(); }
});

test("http 사진은 담지 않는다 — https 만", async () => {
  stubFetch({ data: [
    { id: 4, name: "가", seller_id: 14, image_url: "http://cdn.example/plain.jpg" },
    { id: 5, name: "나", seller_id: 14, image_url: "https://cdn.example/ok.jpg" },
  ] });
  try {
    const out = await sellerPhotos({}, 14, 24);
    assert.deepEqual(out.map((x) => x.url), ["https://cdn.example/ok.jpg"]);
  } finally { restore(); }
});

test("같은 사진이 두 번 오면 한 번만", async () => {
  stubFetch({ data: [
    { id: 6, name: "가", seller_id: 14, image_url: "https://cdn.example/same.jpg" },
    { id: 7, name: "나", seller_id: 14, image_url: "https://cdn.example/same.jpg" },
  ] });
  try {
    assert.equal((await sellerPhotos({}, 14, 24)).length, 1);
  } finally { restore(); }
});

test("가게 번호가 숫자가 아니면 유어딜을 부르지도 않는다", async () => {
  // 번호를 쉼표로 이어 붙이면 유어딜이 거르개를 통째로 무시하고 전체 목록을 준다.
  // 그런 주소는 아예 만들지 않는다.
  const calls = stubFetch({ data: [] });
  try {
    for (const bad of ["1,2", "abc", "", null, -3, 1.5]) {
      assert.deepEqual(await sellerPhotos({}, bad, 24), [], `${bad} 를 통과시켰다`);
    }
    assert.equal(calls.length, 0, "잘못된 번호로 유어딜을 불렀다");
  } finally { restore(); }
});

test("유어딜이 죽어 있어도 빈 목록일 뿐 화면이 죽지 않는다", async () => {
  globalThis.fetch = async () => { throw new Error("down"); };
  try {
    assert.deepEqual(await sellerPhotos({}, 14, 24), []);
  } finally { restore(); }
});

test("belongsToSeller — 번호가 다르거나 비면 남의 것", () => {
  assert.equal(belongsToSeller({ seller_id: 14 }, 14), true);
  assert.equal(belongsToSeller({ seller_id: 99 }, 14), false);
  assert.equal(belongsToSeller({}, 14), false);
  assert.equal(belongsToSeller({ seller_id: 14 }, 0), false);
});
