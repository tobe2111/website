// 공지 목록 화면(/notices)이 "무엇을 열어 볼지 고를 수 있는" 화면인가.
//
// 이 화면은 손님이 공지를 **고르는** 자리입니다. 그런데 여덟 건 중 넷은 똑같은 회색 서류
// 아이콘이라 눌러 보기 전에는 무슨 글인지 알 수 없었고, 사진이 붙은 넷도 썸네일이 92px 라
// 포스터 글씨가 읽히지 않았습니다. 목록이 아니라 관리자 표처럼 보였습니다.
//
// 그래서 세 가지를 잽니다 — 사진은 알아볼 만큼 큰가, 사진이 없는 공지도 분류로 갈라
// 보이는가, 제목만으로 모자랄 때 본문 한 줄이 따라오는가. 그리고 이 셋을 고치면서
// 관리자가 줄 앞 네모칸으로 고르던 흐름과 **홈 화면의 공지 줄**을 건드리지 않았는가.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => {
  for (const s of r.headers.getSetCookie?.() || []) {
    const kv = s.split(";")[0]; const i = kv.indexOf("=");
    j.c[kv.slice(0, i)] = kv.slice(i + 1);
  }
};
const get = async (env, j, p) => {
  const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env);
  absorb(j, r); return r;
};
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
const count = (s, re) => (s.match(re) || []).length;

// 사진이 붙은 공지 둘 · 글만 있는 공지 넷. 분류도 넷 다 다르게 — 색이 갈리는지 보려면
// 한 화면에 여러 분류가 같이 있어야 합니다.
async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bangbae", name: "방배카페골목상인회", kind: "merchant" });
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@s.kr", passwordHash: ad.hash, salt: ad.salt, name: "회장", role: "ADMIN", associationId: a.id });
  const rows = [
    ["제5회 방배페스티벌", "행사", "/img/festival/bangbae-festival-2026.webp", 1, "골목 전체가 하루 동안 카페가 됩니다. 15:00~20:00."],
    ["홈페이지를 열었습니다", "소식", "", 1, "우리 골목 가게 125곳이 한자리에 모였습니다."],
    ["미식로드 — 골목 맛집 22곳", "행사", "/img/festival/misik-road-2026.webp", 0, "스탬프를 모으면 선물을 드립니다."],
    ["가입 점포를 모집합니다", "안내", "", 0, "회원이 되시면 가게 페이지가 생깁니다."],
    ["상인 역량강화 교육", "교육", "", 0, "7월 27일, 8월 3일 두 차례."],
    ["연합회 창립 — 우리 골목도 창립 회원입니다", "소식", "", 0, "열 상점가가 모였습니다."],
  ];
  for (const [title, tag, images, pinned, body] of rows)
    await D.createNotice(env.DB, { associationId: a.id, title, body, tag, images, pinned });
  return { a, rows };
}

test("사진이 붙은 공지는 알아볼 만한 사진으로, 글만 있는 공지는 분류 색 타일로 선다", async () => {
  const env = makeEnv();
  const { rows } = await seed(env);
  const html = await (await get(env, jar(), "/t/bangbae/notices")).text();

  // 줄마다 사진 칸이 하나씩 — 사진이 있으면 그 사진, 없으면 색 타일
  assert.equal(count(html, /class="nl-th"/g), rows.filter((r) => r[2]).length, "사진 붙은 공지 수만큼 사진 칸");
  assert.equal(count(html, /nl-th nl-flat/g), rows.filter((r) => !r[2]).length, "사진 없는 공지 수만큼 색 타일");
  // 회색 서류 아이콘이 서던 자리를 색 타일이 가져갔다 — 옛 아이콘은 이 화면에 없어야 한다
  assert.ok(!/notice-ico/.test(html), "목록 화면에 회색 서류 아이콘이 남아 있으면 안 된다");
  assert.ok(/class="notice-list nl-big/.test(html), "큰 줄 목록으로 그려져야 한다");
});

test("분류마다 색이 갈린다 — 행사·소식·안내·교육이 같은 색으로 뭉치지 않는다", async () => {
  const env = makeEnv();
  await seed(env);
  const html = await (await get(env, jar(), "/t/bangbae/notices")).text();
  for (const cls of ["t-ev", "t-nw", "t-in", "t-ed"])
    assert.ok(html.includes(cls), `${cls} 색이 화면에 없다`);
  // 색 이름은 알약(분류 글자)과 타일 양쪽에 쓰인다 — 알약은 줄 수만큼 있어야 한다
  assert.equal(count(html, /class="nl-chip /g), 6, "줄마다 분류 알약이 하나씩");
});

test("제목 아래 본문 한 줄이 따라온다 — 제목만으로는 무슨 일인지 모르는 공지가 있다", async () => {
  const env = makeEnv();
  await seed(env);
  const html = await (await get(env, jar(), "/t/bangbae/notices")).text();
  assert.equal(count(html, /class="nl-sum"/g), 6, "줄마다 요약 한 줄");
  assert.ok(html.includes("스탬프를 모으면 선물을 드립니다"), "본문 첫 줄이 요약으로 나와야 한다");
});

test("본문이 비어 있는 공지도 줄이 깨지지 않는다 — 요약 자리만 비운다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "seorae", name: "서래마을상인회", kind: "merchant" });
  // 사람이 하나도 없으면 첫 설치 화면(/setup)으로 보내므로, 관리자 하나를 둔다
  const ad = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@s.kr", passwordHash: ad.hash, salt: ad.salt, name: "회장", role: "ADMIN", associationId: a.id });
  await D.createNotice(env.DB, { associationId: a.id, title: "제목만 있는 공지", body: "", tag: "안내", images: "", pinned: 0 });
  const html = await (await get(env, jar(), "/t/seorae/notices")).text();
  assert.ok(html.includes("제목만 있는 공지"), "제목은 떠야 한다");
  assert.equal(count(html, /class="nl-sum"/g), 0, "빈 요약 칸을 그리지 않는다");
});

test("관리자가 줄 앞에서 고르던 흐름은 그대로다", async () => {
  const env = makeEnv();
  const { rows } = await seed(env);
  const j = jar();
  await post(env, j, "/login", { email: "a@s.kr", password: "admin1234" });
  const html = await (await get(env, j, "/t/bangbae/notices")).text();
  assert.equal(count(html, /class="rowpick"/g), rows.length, "줄마다 고르기 칸");
  assert.ok(html.includes("list-pick"), "고르기용 목록이어야 한다");
  assert.ok(html.includes("선택 삭제") && html.includes("상단 고정"), "도구줄이 그대로 있어야 한다");

  // 손님에게는 고르기 칸이 아예 그려지지 않는다
  const guest = await (await get(env, jar(), "/t/bangbae/notices")).text();
  assert.ok(!guest.includes("rowpick"), "손님 화면에 고르기 칸이 보이면 안 된다");
  assert.ok(!guest.includes("선택 삭제"), "손님 화면에 삭제 단추가 보이면 안 된다");
});

test("홈 화면의 공지 줄은 건드리지 않았다 — 고친 것은 목록 화면뿐이다", async () => {
  const env = makeEnv();
  await seed(env);
  const home = await (await get(env, jar(), "/t/bangbae")).text();
  assert.ok(!home.includes("nl-big"), "홈은 큰 줄 목록을 쓰지 않는다");
  assert.ok(!home.includes("nl-sum"), "홈 줄에는 요약을 붙이지 않는다");
});

test("목록 화면이 쓰는 색은 스타일시트에 모두 정의돼 있다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  for (const cls of ["t-ev", "t-nw", "t-in", "t-ed"])
    assert.ok(new RegExp(`\\.${cls}\\{--tone-bg:`).test(css), `.${cls} 색 쌍이 스타일시트에 없다`);
  // 색을 못 찾은 분류도 기본색으로 서야 하므로, 알약·타일은 늘 --tone-bg 를 읽는다
  assert.ok(/\.nl-chip\{[^}]*--tone-bg/.test(css.replace(/\n\s*/g, "")), "알약이 분류 색을 읽어야 한다");
  assert.ok(/\.nl-flat\{[^}]*--tone-bg/.test(css.replace(/\n\s*/g, "")), "타일이 분류 색을 읽어야 한다");
});
