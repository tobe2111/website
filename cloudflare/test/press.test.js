// 언론 속 우리 골목 — 포털 기사 수집.
//
// 여기서 재는 것은 "기사가 들어온다" 가 아닙니다. 들어오는 것은 쉽고, 틀렸을 때가 비쌉니다.
// 그래서 네 가지를 못질합니다.
//   ① 수집한 것만으로는 **홈에 아무것도 안 뜬다** (관리자가 고른 것만 나간다)
//   ② 손님 화면에 나가는 것은 **제목·매체·날짜·링크 넷뿐** — 검색 API 의 한 줄 요약은 안 나간다
//   ③ 남의 상인회 기사 번호를 보내도 **안 바뀐다**
//   ④ 수집을 켜지 않은 상인회는 **남의 서버를 한 번도 찌르지 않는다**
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import {
  parseGoogleRss, parseNaverNews, parseNaverBlog, parseTerms, defaultTerms,
  matchesTerms, normalizeUrl, outletOf, kstDay, stripTags, collect, runPressCollect,
} from "../src/press.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, p) { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const body = new URLSearchParams();
  body.set("_csrf", t);
  for (const [k, v] of Object.entries(f)) { if (Array.isArray(v)) for (const x of v) body.append(k, x); else body.set(k, v); }
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: body.toString() }), env);
  absorb(j, r); return r;
}
async function seed(env, { slug = "bangbae", name = "방배카페골목상인회" } = {}) {
  const a = await D.createAssociation(env.DB, { slug, name });
  const h = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: `a@${slug}.kr`, passwordHash: h.hash, salt: h.salt, name: "회장", role: "ADMIN", associationId: a.id });
  return a;
}
const login = (env, j, email) => post(env, j, "/login", { email, password: "admin1234" });

// ---------- 가짜 포털 ----------
const RSS = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Google News</title>
${items.map((i) => `<item><title>${i.t}</title><link>${i.u}</link>
  <pubDate>${i.d || "Mon, 05 Oct 2026 23:10:00 GMT"}</pubDate>
  <source url="${i.su || "https://www.yna.co.kr"}">${i.s || "연합뉴스"}</source></item>`).join("\n")}
</channel></rss>`;
const NAVER_NEWS = (items) => JSON.stringify({ items: items.map((i) => ({
  title: i.t, originallink: i.u, link: "https://n.news.naver.com/x",
  description: i.desc || "", pubDate: i.d || "Sun, 04 Oct 2026 09:00:00 +0900",
})) });
const NAVER_BLOG = (items) => JSON.stringify({ items: items.map((i) => ({
  title: i.t, link: i.u, description: i.desc || "", bloggername: i.s || "동네한바퀴", postdate: i.d || "20261004",
})) });

// url 패턴 → 돌려줄 본문. 찌른 주소를 전부 기록한다(안 찔러야 할 때를 재려고).
function fakePortal(routes) {
  const real = globalThis.fetch;
  const hit = [];
  globalThis.fetch = async (u) => {
    const url = String(u && u.url ? u.url : u);
    hit.push(url);
    for (const [frag, body] of routes) if (url.includes(frag)) return new Response(body, { status: 200 });
    return new Response("", { status: 404 });
  };
  return { hit, restore() { globalThis.fetch = real; } };
}

// ---------- 해석 ----------
test("구글 뉴스 RSS — 제목 뒤 ' - 매체명' 꼬리를 뗀다 (매체는 따로 보여 주므로)", () => {
  const rows = parseGoogleRss(RSS([{ t: "방배카페골목에 축제가 열렸다 - 연합뉴스", u: "https://www.yna.co.kr/view/AKR1" }]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "방배카페골목에 축제가 열렸다", "꼬리말이 제목에 두 번 남지 않는다");
  assert.equal(rows[0].source, "연합뉴스");
  assert.equal(rows[0].date, "2026-10-06", "KST 로 바꿔 담는다 (10/5 23:10 UTC = 10/6 아침)");
  assert.equal(rows[0].url, "https://www.yna.co.kr/view/AKR1");
});

test("네이버 뉴스 — <b> 태그와 &quot; 를 떼고, 매체는 원문 주소에서 읽는다", () => {
  const rows = parseNaverNews(JSON.parse(NAVER_NEWS([
    { t: "&quot;<b>방배카페골목</b>&quot; 상인들이 모였다", u: "https://www.seoul.co.kr/news/1", desc: "<b>방배</b> 골목에서" },
  ])));
  assert.equal(rows[0].title, '"방배카페골목" 상인들이 모였다', "태그도 실체참조도 화면에 남지 않는다");
  assert.equal(rows[0].source, "서울신문", "아는 매체는 이름으로");
  assert.equal(rows[0].snippet, "방배 골목에서");
  assert.equal(rows[0].kind, "news");
});

test("네이버 블로그 — 글쓴이가 매체 이름이고, 날짜는 20261004 꼴을 받는다", () => {
  const rows = parseNaverBlog(JSON.parse(NAVER_BLOG([{ t: "방배카페골목 다녀왔어요", u: "https://blog.naver.com/x/1" }])));
  assert.equal(rows[0].source, "동네한바퀴");
  assert.equal(rows[0].date, "2026-10-04");
  assert.equal(rows[0].kind, "blog", "블로그는 기사와 구분해 둔다 — 관리자가 가려 올릴 수 있어야 한다");
});

test("모르는 매체는 이름을 지어내지 않고 주소를 그대로 보여 준다", () => {
  assert.equal(outletOf("https://www.yna.co.kr/a"), "연합뉴스");
  assert.equal(outletOf("https://news.seocho.go.kr/a"), "서초구청", "하위 도메인도 같은 곳으로 본다");
  assert.equal(outletOf("https://some-local-paper.example/a"), "some-local-paper.example");
});

test("날짜를 못 읽으면 빈 칸 — 틀린 날짜를 적지 않는다", () => {
  assert.equal(kstDay("아무 말"), "");
  assert.equal(kstDay(""), "");
  assert.equal(stripTags("<b>가</b>  나&amp;다"), "가 나&다");
});

// ---------- 거르개 ----------
test("검색어는 상인회 이름의 꼬리말을 뗀 것이 기본 — 기사는 '상인회' 를 안 쓴다", () => {
  assert.equal(defaultTerms("방배카페골목상인회"), "방배카페골목");
  assert.equal(defaultTerms("서래마을 상가번영회"), "서래마을");
  assert.equal(defaultTerms("골목"), "골목", "뗐을 때 너무 짧아지면 원래 이름을 쓴다");
});

test("띄어쓰기가 달라도 같은 골목으로 본다 — 매체마다 다르게 쓴다", () => {
  const t = parseTerms("방배카페골목", "");
  assert.ok(matchesTerms("방배 카페골목 축제 개막", t), "'방배 카페골목' 도 걸린다");
  assert.ok(matchesTerms("방배카페골목 축제", t));
  assert.ok(!matchesTerms("양재천 벚꽃 축제", t), "상관없는 기사는 안 걸린다");
});

test("'-' 를 붙인 낱말이 들어간 글은 버린다 — 분양 광고가 상인회 홈에 뜨면 안 된다", () => {
  const t = parseTerms("방배카페골목\n-분양", "");
  assert.deepEqual(t.exclude, ["분양"]);
  assert.ok(!matchesTerms("방배카페골목 인근 오피스텔 분양 안내", t));
  assert.ok(matchesTerms("방배카페골목 미식로드 개막", t));
});

test("겹친 기사는 한 줄 — 추적 꼬리표(utm_)는 떼고 주소로 가른다", () => {
  const a = normalizeUrl("https://www.yna.co.kr/view/AKR1?utm_source=google&id=7#top");
  assert.equal(a, "https://yna.co.kr/view/AKR1?id=7", "www·#·utm_ 은 떼고 뜻 있는 값은 남긴다");
  assert.equal(normalizeUrl("javascript:alert(1)"), "", "http(s) 가 아니면 주소로 보지 않는다");
  assert.equal(normalizeUrl(""), "");
});

test("두 포털에서 같은 기사가 와도 한 건으로 합친다", async () => {
  const f = fakePortal([
    ["news.google.com", RSS([{ t: "방배카페골목 축제 - 연합뉴스", u: "https://www.yna.co.kr/view/AKR1?utm_source=g" }])],
    ["search/news.json", NAVER_NEWS([{ t: "방배카페골목 축제", u: "https://yna.co.kr/view/AKR1" }])],
    ["search/blog.json", NAVER_BLOG([])],
  ]);
  try {
    const rows = await collect({ NAVER_SEARCH_ID: "id", NAVER_SEARCH_SECRET: "sec" }, { terms: parseTerms("방배카페골목", "") });
    assert.equal(rows.length, 1, "같은 기사를 두 줄로 쌓지 않는다");
  } finally { f.restore(); }
});

test("열쇠가 없으면 네이버는 찌르지 않고 구글만 본다 — 반쯤 되는 상태로도 쓸 수 있다", async () => {
  const f = fakePortal([["news.google.com", RSS([{ t: "방배카페골목 축제 - 연합뉴스", u: "https://www.yna.co.kr/view/A" }])]]);
  try {
    const rows = await collect({}, { terms: parseTerms("방배카페골목", "") });
    assert.equal(rows.length, 1);
    assert.ok(!f.hit.some((u) => u.includes("openapi.naver.com")), "열쇠 없이 네이버를 부르지 않는다");
  } finally { f.restore(); }
});

// ---------- 화면 ----------
test("수집해도 홈에는 아무것도 안 뜬다 — 회장님이 고른 것만 올라간다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = jar();
  await login(env, j, "a@bangbae.kr");
  await post(env, j, "/t/bangbae/admin/press/settings", { press_on: "1", press_terms: "방배카페골목" }, "/t/bangbae/admin/press");

  const f = fakePortal([["news.google.com", RSS([
    { t: "방배카페골목 미식로드 개막 - 연합뉴스", u: "https://www.yna.co.kr/view/AKR9" },
  ])]]);
  let r;
  try { r = await post(env, j, "/t/bangbae/admin/press/collect", {}, "/t/bangbae/admin/press"); }
  finally { f.restore(); }
  assert.equal(r.status, 303);

  assert.equal(await D.countPressPending(env.DB, a.id), 1, "대기 줄에는 들어왔다");
  const home = await (await get(env, jar(), "/t/bangbae/")).text();
  assert.ok(!home.includes("미식로드 개막"), "고르기 전에는 홈에 안 뜬다");
  assert.ok(!home.includes("press-wall"), "구역 자체가 없다 — 빈 상자를 남기지 않는다");

  const admin = await (await get(env, j, "/t/bangbae/admin/press")).text();
  assert.match(admin, /미식로드 개막/, "관리 화면 대기 줄에는 보인다");
  assert.match(admin, /언론 보도/, "왼쪽 차림표에 자리가 있다");
});

test("고른 기사는 홈에 뜨고, 나가는 것은 제목·매체·날짜·원문 링크 넷뿐이다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = jar();
  await login(env, j, "a@bangbae.kr");
  const row = await D.addPressItem(env.DB, {
    associationId: a.id, title: "방배카페골목 미식로드 개막", url: "https://yna.co.kr/view/AKR9",
    source: "연합뉴스", publishedAt: "2026-10-06", snippet: "기사 본문 첫 문장이 여기 들어온다",
    kind: "news", term: "방배카페골목",
  });
  await post(env, j, "/t/bangbae/admin/press/bulk", { act: "live", ids: [String(row.id)] }, "/t/bangbae/admin/press");

  const home = await (await get(env, jar(), "/t/bangbae/")).text();
  assert.match(home, /press-wall/, "구역이 켜진다");
  assert.match(home, /방배카페골목 미식로드 개막/);
  assert.match(home, /연합뉴스/);
  assert.match(home, /2026-10-06/);
  assert.match(home, /href="https:\/\/yna\.co\.kr\/view\/AKR9"/);
  assert.ok(!home.includes("기사 본문 첫 문장"), "한 줄 요약은 손님 화면에 안 나간다 (남의 글이다)");
  assert.match(home, /rel="noopener nofollow ugc"/, "남의 기사에 검색 순위를 넘기지 않는다");
  assert.match(home, /target="_blank"/, "원문은 새 창으로 — 우리 홈을 떠나게 만들지 않는다");
});

test("홈에서 내리면 그 자리에서 사라지고, 치운 기사는 지워지지 않는다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = jar();
  await login(env, j, "a@bangbae.kr");
  const row = await D.addPressItem(env.DB, { associationId: a.id, title: "엉뚱한 기사", url: "https://x.example/1", source: "x.example" });
  await post(env, j, "/t/bangbae/admin/press/bulk", { act: "hidden", ids: [String(row.id)] }, "/t/bangbae/admin/press");
  assert.equal(await D.countPressPending(env.DB, a.id), 0);
  assert.equal((await D.listPress(env.DB, a.id, "hidden")).length, 1, "지우지 않고 남긴다 — 내일 또 올라와 또 치우는 일을 막는다");
  const again = await D.addPressItem(env.DB, { associationId: a.id, title: "엉뚱한 기사", url: "https://x.example/1", source: "x.example" });
  assert.equal(again, null, "같은 주소는 다시 안 들어온다");
});

test("남의 상인회 기사 번호를 보내도 안 바뀐다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const b = await seed(env, { slug: "seorae", name: "서래마을상인회" });
  const row = await D.addPressItem(env.DB, { associationId: a.id, title: "방배 기사", url: "https://yna.co.kr/1", source: "연합뉴스" });
  const j = jar();
  await login(env, j, "a@seorae.kr");
  await post(env, j, "/t/seorae/admin/press/bulk", { act: "live", ids: [String(row.id)] }, "/t/seorae/admin/press");
  assert.equal((await D.getPressItem(env.DB, row.id)).status, "new", "다른 상인회 관리자는 손대지 못한다");
  assert.equal(await D.countPressLive(env.DB, b.id), 0);
});

test("수집을 켜지 않은 상인회는 남의 서버를 한 번도 찌르지 않는다", async () => {
  const env = makeEnv();
  await seed(env);
  const f = fakePortal([["news.google.com", RSS([])]]);
  try {
    const out = await runPressCollect(env);
    assert.equal(out.ran, 0, "켠 곳이 없으면 아무 데도 안 간다");
    assert.equal(f.hit.length, 0, "기본이 꺼짐이라, 켜기 전에는 요청이 한 건도 나가지 않는다");
  } finally { f.restore(); }
});

test("크론이 돌면 켜 둔 상인회만 모으고, 그래도 홈은 조용하다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  await seed(env, { slug: "seorae", name: "서래마을상인회" });
  await D.setPressEnabled(env.DB, a.id, true);
  await D.setPressTerms(env.DB, a.id, "방배카페골목");
  const f = fakePortal([["news.google.com", RSS([{ t: "방배카페골목 축제 - 연합뉴스", u: "https://www.yna.co.kr/view/AKR7" }])]]);
  try {
    const out = await runPressCollect(env);
    assert.equal(out.ran, 1, "켠 곳만 돈다");
    assert.equal(out.added, 1);
    assert.ok(f.hit.every((u) => u.includes("news.google.com") || u.includes("openapi.naver.com")),
      "찌르는 곳은 두 곳으로 고정돼 있다 (주소를 받아 가져오는 길이 없다)");
  } finally { f.restore(); }
  const home = await (await get(env, jar(), "/t/bangbae/")).text();
  assert.ok(!home.includes("press-wall"), "크론이 모아도 손님 화면은 그대로다");
});

test("고른 기사를 공지로도 올린다 — 회원이 찾아보는 자리는 공지 목록이다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = jar();
  await login(env, j, "a@bangbae.kr");
  const row = await D.addPressItem(env.DB, {
    associationId: a.id, title: "방배카페골목 미식로드 개막", url: "https://yna.co.kr/view/AKR9",
    source: "연합뉴스", publishedAt: "2026-10-06", snippet: "기사 본문 첫 문장이 여기 들어온다", kind: "news",
  });
  await post(env, j, "/t/bangbae/admin/press/bulk", { act: "notice", ids: [String(row.id)] }, "/t/bangbae/admin/press");

  const notices = await D.listNotices(env.DB, a.id);
  assert.equal(notices.length, 1, "공지가 한 건 생긴다");
  assert.equal(notices[0].title, "방배카페골목 미식로드 개막");
  assert.match(notices[0].body, /연합뉴스/);
  assert.match(notices[0].body, /2026-10-06/);
  assert.match(notices[0].body, /https:\/\/yna\.co\.kr\/view\/AKR9/, "원문으로 가는 주소가 들어간다");
  assert.ok(!notices[0].body.includes("기사 본문 첫 문장"), "한 줄 요약조차 공지에 안 넣는다 — 남의 글이다");
  assert.equal((await D.getPressItem(env.DB, row.id)).status, "live", "공지로 올리면 홈에도 함께 걸린다");

  // 공지 목록·검색에서 찾힌다 (홈 구역만으로는 회원이 못 찾는다)
  const list = await (await get(env, jar(), "/t/bangbae/notices")).text();
  assert.match(list, /방배카페골목 미식로드 개막/);
});

test("같은 기사를 두 번 눌러도 공지가 두 건이 되지 않는다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = jar();
  await login(env, j, "a@bangbae.kr");
  const row = await D.addPressItem(env.DB, { associationId: a.id, title: "같은 기사", url: "https://yna.co.kr/1", source: "연합뉴스" });
  await post(env, j, "/t/bangbae/admin/press/bulk", { act: "notice", ids: [String(row.id)] }, "/t/bangbae/admin/press");
  await post(env, j, "/t/bangbae/admin/press/bulk", { act: "notice", ids: [String(row.id)] }, "/t/bangbae/admin/press");
  assert.equal((await D.listNotices(env.DB, a.id)).length, 1, "두 번 눌러도 한 건이다");
});

test("남의 상인회 기사를 내 공지로 올리지 못한다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const b = await seed(env, { slug: "seorae", name: "서래마을상인회" });
  const row = await D.addPressItem(env.DB, { associationId: a.id, title: "방배 기사", url: "https://yna.co.kr/1", source: "연합뉴스" });
  const j = jar();
  await login(env, j, "a@seorae.kr");
  await post(env, j, "/t/seorae/admin/press/bulk", { act: "notice", ids: [String(row.id)] }, "/t/seorae/admin/press");
  assert.equal((await D.listNotices(env.DB, b.id)).length, 0, "남의 기사가 내 공지가 되지 않는다");
  assert.equal((await D.getPressItem(env.DB, row.id)).status, "new");
});

test("켜고 끄기와 검색어가 저장된다 — 끄면 다음 아침부터 안 돈다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  const j = jar();
  await login(env, j, "a@bangbae.kr");
  await post(env, j, "/t/bangbae/admin/press/settings", { press_on: "1", press_terms: "방배카페골목\n-분양" }, "/t/bangbae/admin/press");
  assert.equal(await D.pressEnabled(env.DB, a.id), true);
  assert.match(await D.getPressTerms(env.DB, a.id), /-분양/);
  await post(env, j, "/t/bangbae/admin/press/settings", { press_terms: "방배카페골목" }, "/t/bangbae/admin/press");
  assert.equal(await D.pressEnabled(env.DB, a.id), false, "체크를 빼면 꺼진다");
});

test("구역 제목이 '언론 속의 방배카페골목' — 아무도 '우리 골목'을 검색하지 않는다", async () => {
  const env = makeEnv();
  const a = await seed(env);
  await D.addPressItem(env.DB, { associationId: a.id, title: "방배카페골목 미식로드", url: "https://yna.co.kr/9", source: "연합뉴스" });
  await D.setPressStatus(env.DB, (await D.listPress(env.DB, a.id, "new", 1))[0].id, a.id, "live");

  const home = await (await get(env, jar(), "/t/bangbae/")).text();
  assert.match(home, /언론 속의 방배카페골목/, "상인회 이름에서 꼬리말을 뗀 골목 이름을 쓴다");
  assert.ok(!home.includes("언론 속 우리 골목"), "'우리 골목' 은 어느 상인회나 똑같은 말이다");

  // 상인회마다 제 이름이 들어간다
  const b = await seed(env, { slug: "seorae", name: "서래마을 상가번영회" });
  await D.addPressItem(env.DB, { associationId: b.id, title: "서래마을 축제", url: "https://yna.co.kr/8", source: "연합뉴스" });
  await D.setPressStatus(env.DB, (await D.listPress(env.DB, b.id, "new", 1))[0].id, b.id, "live");
  const home2 = await (await get(env, jar(), "/t/seorae/")).text();
  assert.match(home2, /언론 속의 서래마을/, "'상가번영회' 꼬리말도 뗀다");
});
