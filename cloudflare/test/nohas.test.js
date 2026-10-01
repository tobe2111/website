// `:has()` 를 쓰지 않는다 — 그리고 그 자리를 무엇으로 메웠는지까지 검사한다.
//
// 왜 이 검사가 있나.
// app.css 에는 "`:has()` 는 쓰지 않는다 — 파이어폭스 ESR(관공서·학교 PC 에 남아 있다)에서
// 안 돈다" 는 주석이 두 군데 적혀 있었다. 그런데 **같은 파일이 여섯 곳에서 그 규칙을 어기고
// 있었다.** 깨지지는 않으니 아무도 몰랐다 — 고른 사진에 테두리가 안 생기고, 꺼 둔 구역이
// 켜 둔 구역과 똑같아 보일 뿐이었다. 둘 다 "안 보인다" 가 아니라 "똑같아 보인다" 라서
// 쓰는 사람은 자기가 잘못 눌렀다고 생각한다.
//
// 글로 적은 규칙은 지켜지지 않는다. 기계가 보게 한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
// 주석을 걷어낸다 — 주석 안에서 `:has()` 를 설명하는 것은 규칙 위반이 아니다
const rules = css.replace(/\/\*[\s\S]*?\*\//g, " ");

test("선택자에 :has() 를 쓰지 않는다 (파이어폭스 ESR 에서 안 돈다)", () => {
  const hits = [];
  rules.split("\n").forEach((line, i) => { if (/:has\(/.test(line)) hits.push(`${i + 1}줄: ${line.trim()}`); });
  assert.deepEqual(hits, [], ":has() 가 남아 있습니다:\n" + hits.join("\n"));
});

// :has() 를 걷어낸 자리가 **무엇으로** 메워졌는지. 규칙만 지우고 기능을 잃으면
// 검사는 통과하는데 화면은 더 나빠진다 — 그쪽이 더 나쁜 결말이다.
test("고른 사진의 테두리는 체크박스 형제(.pick-ring)가 그린다", () => {
  assert.match(rules, /\.pick-item input:checked ~ \.pick-ring\{[^}]*border-color/, "고른 테가 없습니다");
  assert.match(rules, /\.pick-item input:disabled ~ \*\{[^}]*opacity/, "잠긴 칸을 흐리게 하는 규칙이 없습니다");
  assert.match(rules, /\.pick-item input:focus-visible ~ \.pick-ring/, "키보드 초점 테가 없습니다");
});

test("꺼 둔 구역은 줄의 is-off 로 흐려진다", () => {
  assert.match(rules, /\.layout-row\.is-off > \.layout-row-head\{/, "꺼진 줄의 머리 규칙이 없습니다");
  assert.match(rules, /\.layout-row\.is-off \.lname strong\{/, "꺼진 줄의 이름 규칙이 없습니다");
});

test("서식 본문을 펼치면 is-wide 로 칸이 넓어진다", () => {
  assert.match(rules, /\.tpl-layout\.is-wide\{[^}]*grid-template-columns/, "넓히는 규칙이 없습니다");
});

// 클래스를 붙이는 쪽이 사라지면 CSS 만 남아 아무 일도 일어나지 않는다. 양쪽을 함께 묶는다.
test("클래스를 붙이는 코드가 함께 있다", () => {
  const pages = readFileSync(new URL("../src/pages.js", import.meta.url), "utf8");
  const layoutJs = readFileSync(new URL("../public/js/layout-editor.js", import.meta.url), "utf8");
  const appJs = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
  const pickJs = readFileSync(new URL("../public/js/photo-pick.js", import.meta.url), "utf8");

  assert.match(pages, /layout-row\$\{sec\.enabled \? "" : " is-off"\}/, "서버가 is-off 를 안 찍습니다");
  assert.match(layoutJs, /classList\.toggle\("is-off"/, "스위치를 눌러도 is-off 가 안 바뀝니다");
  assert.match(appJs, /classList\.toggle\("is-wide"/, "본문을 펼쳐도 is-wide 가 안 붙습니다");
  assert.match(pages, /<span class="pick-ring"/, "서버가 그리는 사진 칸에 테가 없습니다");
  assert.match(pickJs, /"pick-ring"/, "웹에서 찾은 사진 칸에 테가 없습니다");
});
