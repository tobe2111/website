// 화면을 쓰는 데 걸리는 것들 — 눈에 잘 안 띄지만 매번 사람을 붙잡는 것들.
// (Web Interface Guidelines 기준으로 훑어 나온 것들을 여기서 지킨다)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/pages.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
const appjs = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");

// 이게 없으면 휴대폰에서 이름·전화·주소를 매번 손으로 다 쳐야 한다.
// 가게 정보를 채우는 사람은 대부분 사장님이고, 대부분 휴대폰이다.
test("사람이 치는 칸에는 자동완성이 붙어 있다", async () => {
  // name= 은 사람 이름일 때도 조직 이름일 때도 쓰인다 — 둘 중 맞는 쪽이면 된다
  const WANT = { name: ["name", "organization"], email: ["email"], phone: ["tel"],
    address: ["street-address"], business_name: ["organization"] };
  const bad = [];
  for (const [nm, list] of Object.entries(WANT)) {
    for (const m of src.matchAll(new RegExp(`<input\\b[^>]*name="${nm}"[^>]*>`, "g"))) {
      const tag = m[0];
      if (/type="(hidden|checkbox|radio|file)"/.test(tag)) continue;
      if (!list.some((ac) => tag.includes(`autocomplete="${ac}"`))) bad.push(`${nm}: ${tag.slice(0, 70)}`);
    }
  }
  assert.deepEqual(bad, [], "자동완성이 빠진 칸:\n  " + bad.join("\n  "));
});

// 손가락으로 눌렀을 때 파란 사각형이 번쩍이면 그 순간 '웹사이트' 로 읽힌다.
// touch-action 이 없으면 더블탭 확대를 기다리느라 탭이 한 박자 늦게 반응한다.
test("모바일에서 누르는 느낌이 앱에 가깝다", async () => {
  assert.match(css, /-webkit-tap-highlight-color:transparent/, "탭 하이라이트를 꺼야");
  assert.match(css, /touch-action:manipulation/, "탭 지연을 없애야");
});

// 사진 뷰어를 스크롤하다 끝에 닿으면 뒤 페이지가 밀려 올라간다 — 모달의 기본기다.
test("사진 뷰어 스크롤이 뒤 페이지로 새지 않는다", async () => {
  assert.match(css, /\.viewer\{[^}]*overscroll-behavior:contain/, "뷰어에 필요");
  assert.match(css, /\.fd-back\{[^}]*overscroll-behavior:contain/, "서명 자리 대화상자에도 필요");
});

// 25 와 412 가 자릿수 안 맞게 흔들리면 표를 눈으로 비교할 수 없다.
test("숫자 표는 자릿수가 맞는다", async () => {
  assert.match(css, /\.admin-table\{[^}]*tabular-nums/);
  assert.match(css, /\.stat-num\{[^}]*tabular-nums/);
});

// 대부분은 2단계 인증을 안 쓴다. 로그인 화면에 늘 세 번째 칸이 있으면
// "이것도 채워야 하나" 하고 한 번 멈칫한다.
test("로그인의 2단계 인증 칸은 접혀 있다", async () => {
  assert.match(src, /<details class="totp-login"><summary>2단계 인증을 쓰고 계신가요\?<\/summary>/);
  assert.match(css, /\.totp-login>summary/, "접힌 줄이 눌러야 하는 것으로 보여야");
});

// 가게 소개를 길게 쓰다 뒤로 가기를 눌러 통째로 날리는 일이 실제로 생긴다.
test("작성 중인 폼을 두고 나가면 한 번 물어본다", async () => {
  assert.match(appjs, /beforeunload/, "이탈 경고가 있어야");
  assert.match(appjs, /saving = true/, "저장을 눌렀을 때는 묻지 않아야");
});

// 공지 대표 사진이 로드되는 순간 본문이 아래로 밀리면, 읽던 줄을 놓친다.
test("사진 자리를 미리 잡아 화면이 튀지 않는다", async () => {
  assert.match(css, /\.article-image\{[^}]*aspect-ratio/);
  assert.match(css, /\.market-thumb\{[^}]*aspect-ratio/);
});
