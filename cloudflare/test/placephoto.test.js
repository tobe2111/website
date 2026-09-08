// 지도에 올라온 그 가게의 대표 사진 한 장.
//
// 카카오는 장소 정보를 "place_url 로 연결해서만" 쓰라고 못 박았다. 그래서 내부 JSON
// 주소를 몰래 부르지 않고, 그 페이지가 스스로 공개하는 og:image 를 읽는다 —
// 카톡·검색엔진이 미리보기를 만들 때 하는 일과 같다.
//
// 여기서 지키는 것: ① 지도 주소가 아니면 아예 열지 않는다 ② 사진은 정해진 곳에서 온
// https 만 ③ 어디서 왔는지를 사람이 열어 볼 수 있는 페이지로 남긴다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { placePhoto, isPlaceUrl, kakaoPlaceId } from "../src/placePhoto.js";

const realFetch = globalThis.fetch;
const restore = () => { globalThis.fetch = realFetch; };
function stub(html, { ok = true, headers = {} } = {}) {
  const calls = [];
  globalThis.fetch = async (u) => {
    calls.push(String(u));
    return { ok, headers: { get: (k) => headers[k.toLowerCase()] || null }, text: async () => html };
  };
  return calls;
}
const page = (img, extra = "") =>
  `<html><head><meta property="og:title" content="너나들이" />
   <meta property="og:image" content="${img}" />
   <meta property="og:url" content="https://place.map.kakao.com/8137464" />${extra}</head><body></body></html>`;

test("카카오맵 장소 번호를 읽어낸다", () => {
  assert.equal(kakaoPlaceId("https://place.map.kakao.com/8137464"), "8137464");
  assert.equal(kakaoPlaceId("http://place.map.kakao.com/8137464?x=1"), "8137464");
  assert.equal(kakaoPlaceId("https://evil.example/8137464"), "");
  assert.equal(kakaoPlaceId("https://place.map.kakao.com.evil.example/1"), "");
});

test("지도 주소가 아니면 열어 보지도 않는다", async () => {
  const calls = stub(page("//img1.kakaocdn.net/a.png"));
  try {
    for (const bad of ["https://evil.example/x", "http://place.map.kakao.com.evil.example/1", "", null, "javascript:alert(1)"]) {
      assert.equal(await placePhoto(bad), null, `${bad} 를 열었다`);
    }
    assert.equal(calls.length, 0, "지도 주소가 아닌 곳을 열었다");
  } finally { restore(); }
});

test("og:image 를 읽어 절대 주소로 돌려준다", async () => {
  stub(page("//img1.kakaocdn.net/cthumb/local/C800x400.q50/?fname=x"));
  try {
    const r = await placePhoto("https://place.map.kakao.com/8137464");
    assert.equal(r.url, "https://img1.kakaocdn.net/cthumb/local/C800x400.q50/?fname=x");
    assert.equal(r.title, "너나들이");
    assert.equal(r.source, "카카오맵");
    // 출처는 사진 파일이 아니라 사람이 열어 볼 수 있는 페이지여야 한다
    assert.equal(r.sourceUrl, "https://place.map.kakao.com/8137464");
  } finally { restore(); }
});

test("사진이 정해진 곳에서 오지 않으면 버린다", async () => {
  for (const bad of ["https://evil.example/a.jpg", "http://img1.kakaocdn.net/a.jpg", "//kakaocdn.net.evil.example/a.jpg"]) {
    stub(page(bad));
    try {
      assert.equal(await placePhoto("https://place.map.kakao.com/8137464"), null, `${bad} 를 통과시켰다`);
    } finally { restore(); }
  }
});

test("og:image 가 없으면 조용히 빈 값", async () => {
  stub("<html><head><title>없음</title></head></html>");
  try {
    assert.equal(await placePhoto("https://place.map.kakao.com/8137464"), null);
  } finally { restore(); }
});

test("지도가 죽어 있어도 화면이 같이 죽지 않는다", async () => {
  globalThis.fetch = async () => { throw new Error("down"); };
  try {
    assert.equal(await placePhoto("https://place.map.kakao.com/8137464"), null);
  } finally { restore(); }
});

test("응답이 너무 크면 우리가 아는 그 페이지가 아니다", async () => {
  stub(page("//img1.kakaocdn.net/a.png"), { headers: { "content-length": String(9 * 1024 * 1024) } });
  try {
    assert.equal(await placePhoto("https://place.map.kakao.com/8137464"), null);
  } finally { restore(); }
});

test("네이버 지도 주소도 받는다 (같은 방식)", async () => {
  stub(`<meta property="og:image" content="https://ldb-phinf.pstatic.net/x.jpg" />`);
  try {
    const r = await placePhoto("https://map.naver.com/p/entry/place/1234567");
    assert.equal(r.source, "네이버 지도");
    assert.equal(r.url, "https://ldb-phinf.pstatic.net/x.jpg");
  } finally { restore(); }
});

test("isPlaceUrl — 지도 주소만", () => {
  assert.equal(isPlaceUrl("https://place.map.kakao.com/1"), true);
  assert.equal(isPlaceUrl("https://map.naver.com/p/entry/place/1"), true);
  assert.equal(isPlaceUrl("https://naver.me/abc"), true);
  assert.equal(isPlaceUrl("https://instagram.com/x"), false);
  assert.equal(isPlaceUrl("https://map.naver.com.evil.example/x"), false);
});
