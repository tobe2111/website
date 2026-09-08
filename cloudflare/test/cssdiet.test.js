// 스타일시트의 주석은 저장소의 재산이지 손님의 짐이 아니다.
//
// app.css 는 "왜 이렇게 했는지" 를 적어 둔 주석이 파일의 28% 다. 그 주석 덕에 같은 사고를
// 두 번 안 낸다 — 지워서는 안 된다. 그런데 그걸 휴대폰까지 내려보낼 이유도 없다.
//
// 이 파일은 **나가는 길에서만 뗀다** 는 것을 지킨다:
//   ① 브라우저가 받는 것에는 주석이 없다
//   ② 저장소의 원본에는 주석이 그대로 있다
//   ③ 떼고 나서도 CSS 가 문법적으로 멀쩡하다 (중괄호가 안 맞으면 그 아래가 통째로 무시된다)
//
// 실측: 전송량 81.9KB → 42.9KB (gzip). 느린 회선에서 이 파일은 렌더를 막는 유일한
// 자원이라, 그만큼이 그대로 첫 화면 시간이다. 화면은 픽셀까지 같다(12화면 비교).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";

const B = "http://localhost";
const css = async (env, p = "/css/app.css") => {
  const r = await worker.fetch(new Request(B + p), env);
  return { r, text: await r.text() };
};

test("브라우저가 받는 스타일시트에는 주석이 없다", async () => {
  const env = makeEnv({});
  const { r, text } = await css(env);
  assert.equal(r.status, 200);
  assert.ok(text.length > 10000, "스타일시트가 안 왔다");
  assert.ok(!text.includes("/*"), "주석이 그대로 나간다");
});

test("저장소의 원본에는 주석이 그대로 있다", () => {
  // 나가는 길에서만 떼는 것이지, 소스를 깎는 것이 아니다.
  const src = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  assert.ok(src.includes("/*"), "원본에서 주석이 사라졌다 — 그러면 다음 사람이 이유를 모른다");
  assert.ok(src.length > 200000, "원본이 이상하게 작다");
});

test("주석을 떼도 중괄호가 맞는다", async () => {
  // 하나만 어긋나도 그 아래 규칙이 전부 무시된다 — 오류도 경고도 없이.
  const env = makeEnv({});
  const { text } = await css(env);
  let depth = 0, min = 0;
  for (const c of text) { if (c === "{") depth++; else if (c === "}") { depth--; if (depth < min) min = depth; } }
  assert.equal(depth, 0, `중괄호가 ${depth}개 남았다`);
  assert.equal(min, 0, "닫는 괄호가 여는 것보다 먼저 나왔다");
});

test("실제로 가볍게 나간다", async () => {
  // 글자 수가 아니라 **바이트**로 잰다 — 회선을 지나는 것은 바이트고,
  // 한글 주석은 글자당 3바이트라 글자 수로 재면 실제 효과가 절반으로 보인다.
  const env = makeEnv({});
  const bytes = (s) => new TextEncoder().encode(s).length;
  const src = bytes(readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8"));
  const out = bytes((await css(env)).text);
  const cut = 1 - out / src;
  assert.ok(cut > 0.25, `줄어든 것이 ${(cut * 100).toFixed(0)}% 뿐이다 — 떼는 일이 안 돌고 있다`);
});

test("길이·지문 머리글이 본문과 어긋난 채 나가지 않는다", async () => {
  // 본문을 바꿔 놓고 원본의 content-length 나 etag 를 그대로 붙이면 브라우저가 잘린 파일로 읽는다.
  const env = makeEnv({});
  const { r, text } = await css(env);
  const len = r.headers.get("content-length");
  if (len) assert.equal(Number(len), new TextEncoder().encode(text).length, "길이 머리글이 본문과 다르다");
  assert.equal(r.headers.get("etag"), null, "바뀐 본문에 원본 지문이 붙어 있다");
});

test("자바스크립트는 건드리지 않는다", async () => {
  // 정규식으로 JS 주석을 떼면 정규식 리터럴·문자열을 잘라 스크립트가 죽는다. CSS 만 한다.
  const env = makeEnv({});
  const r = await worker.fetch(new Request(B + "/js/app.js"), env);
  const t = await r.text();
  assert.equal(r.status, 200);
  assert.ok(t.includes("//") || t.includes("/*"), "자바스크립트 주석까지 떼고 있다");
});

test("버전 붙은 주소는 1년 캐시, 버전 없는 주소는 매번 재검증", async () => {
  const env = makeEnv({});
  const a = await worker.fetch(new Request(B + "/css/app.css?v=abc123"), env);
  assert.match(a.headers.get("cache-control") || "", /immutable/);
  const b = await worker.fetch(new Request(B + "/css/app.css"), env);
  assert.match(b.headers.get("cache-control") || "", /no-cache/);
});
