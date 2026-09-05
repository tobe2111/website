// 관리자가 점포 정보를 대신 채운다 — 상인회장이 명단을 먼저 세팅하는 실제 시작 방식.
// 그리고 지도(카카오)에서 한 곳을 찾아 폼에 채우는 경로.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const B = "http://localhost";
const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, p) { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "seocho", name: "방배카페골목상인회" });
  const other = await D.createAssociation(env.DB, { slug: "other", name: "다른상인회" });
  const mk = async (e, n, role, aid) => { const h = await hashPassword("pass1234"); return D.createUser(env.DB, { email: e, passwordHash: h.hash, salt: h.salt, name: n, role, associationId: aid }); };
  await mk("ad@s.kr", "회장", "ADMIN", a.id);
  await mk("ad@o.kr", "남의회장", "ADMIN", other.id);
  const u = await mk("m@s.kr", "김순자", "MERCHANT", a.id);
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: "모둠분식", category: "음식점", source: "proxy" });
  const ou = await mk("m@o.kr", "남의사장", "MERCHANT", other.id);
  const ob = await D.createBusiness(env.DB, { associationId: other.id, ownerId: ou.id, name: "남의가게", category: "카페" });
  return { a, other, u, b, ob };
}
const login = async (env, email) => { const j = jar(); await post(env, j, "/login", { email, password: "pass1234" }); return j; };

test("대행 등록한 점포에 무엇이 비었는지, 그래서 손님에게 어떻게 보이는지 적는다", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const j = await login(env, "ad@s.kr");
  const html = await (await get(env, j, `/t/seocho/admin/business/${b.id}`)).text();
  assert.match(html, /모둠분식/);
  // 숫자가 아니라 결과로 말한다 — '주소 없음' 이 아니라 '지도에 뜨지 않습니다'
  assert.match(html, /지도에 뜨지 않습니다/);
  assert.match(html, /전화를 걸 수 없습니다/);
  assert.match(html, /'지금 문 연 곳'에 안 뜹니다/);
  assert.match(html, /name="address"/, "주소 칸이 관리자에게 열려 있어야");
  assert.match(html, /name="hours"/);
});

test("관리자가 채운 주소·전화가 저장되고, 점주 화면에도 같은 값이 보인다", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const j = await login(env, "ad@s.kr");
  const r = await post(env, j, `/t/seocho/admin/business/${b.id}`, {
    name: "모둠분식", category: "음식점", phone: "02-585-1234",
    address: "서울 서초구 방배로 33", hours: "10:00-21:00 · 일요일 휴무",
    description: "떡볶이와 순대", lat: "37.4835", lng: "126.9976",
  }, `/t/seocho/admin/business/${b.id}`);
  assert.equal(r.status, 303);
  const saved = await D.getBusinessById(env.DB, b.id);
  assert.equal(saved.address, "서울 서초구 방배로 33");
  assert.equal(saved.phone, "02-585-1234");
  assert.equal(saved.hours, "10:00-21:00 · 일요일 휴무");
  assert.equal(Number(saved.lat).toFixed(4), "37.4835");

  // 같은 레코드다 — 사장님이 로그인하면 이어서 고칠 수 있어야 한다
  const mj = await login(env, "m@s.kr");
  const dash = await (await get(env, mj, "/t/seocho/dashboard")).text();
  assert.match(dash, /방배로 33/, "점주 화면에 관리자가 채운 주소가 보여야");

  // 다 채웠으면 '덜 채운 것' 경고가 사라진다
  const again = await (await get(env, j, `/t/seocho/admin/business/${b.id}`)).text();
  assert.ok(!/지도에 뜨지 않습니다/.test(again), "채운 뒤에는 그 경고가 없어야");
});

test("관리자 화면이 점주의 SNS 링크를 지우지 않는다 (안 그리는 칸을 빈 값으로 덮어쓰면 안 된다)", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  await D.updateBusiness(env.DB, b.id, { name: "모둠분식", category: "음식점", description: "", phone: "", address: "",
    hours: "", lat: null, lng: null, snsInstagram: "https://instagram.com/modum", snsYoutube: "", snsBlog: "", snsKakao: "", snsNaver: "" });
  const j = await login(env, "ad@s.kr");
  await post(env, j, `/t/seocho/admin/business/${b.id}`, { name: "모둠분식", category: "음식점", address: "서울 서초구 방배로 33" },
    `/t/seocho/admin/business/${b.id}`);
  assert.equal((await D.getBusinessById(env.DB, b.id)).sns_instagram, "https://instagram.com/modum");
});

test("남의 상인회 점포는 열리지도, 고쳐지지도 않는다", async () => {
  const env = makeEnv();
  const { ob } = await seed(env);
  const j = await login(env, "ad@s.kr");
  assert.equal((await get(env, j, `/t/seocho/admin/business/${ob.id}`)).status, 404);
  const r = await post(env, j, `/t/seocho/admin/business/${ob.id}`, { name: "훔치기", address: "덮어쓰기" }, "/t/seocho/admin");
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.equal((await D.getBusinessById(env.DB, ob.id)).name, "남의가게");
});

test("점주는 남의 점포 정보 화면에 못 들어간다", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const mj = await login(env, "m@s.kr");
  const r = await get(env, mj, `/t/seocho/admin/business/${b.id}`);
  assert.ok(r.status !== 200, `점주에게 열리면 안 됨 (${r.status})`);
  assert.equal(r.status, 403, "관리자 전용이므로 거절이 분명해야 한다");
});

// ── 지도에서 찾아 채우기 ──
test("카카오 키가 없으면 그 사실을 말해 주고, 화면도 그 기능을 내걸지 않는다", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const j = await login(env, "ad@s.kr");
  const html = await (await get(env, j, `/t/seocho/admin/business/${b.id}`)).text();
  assert.ok(!/data-place-find/.test(html), "키가 없으면 찾기 칸을 그리지 않는다");
  assert.match(html, /운영사가 카카오 또는 네이버 지도 키를 등록하면/);

  const r = await get(env, j, "/t/seocho/admin/place-search?q=버들카페");
  assert.equal(r.status, 503);
  assert.match((await r.json()).message, /지도 검색 열쇠가 등록되지 않았습니다/);
});

test("지도 검색은 카카오가 준 값만 넘기고, 업종은 맨 끝 낱말만 쓴다", async () => {
  const env = makeEnv();
  env.KAKAO_REST_KEY = "test-key";
  const { b } = await seed(env);
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), auth: (init && init.headers && init.headers.Authorization) || "" });
    return new Response(JSON.stringify({ documents: [
      { place_name: "버들카페", road_address_name: "서울 서초구 방배로 33", address_name: "서초동 1-2",
        phone: "02-585-1234", category_name: "음식점 > 카페 > 커피전문점", x: "126.9976", y: "37.4835",
        place_url: "http://place.map.kakao.com/1234" },
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const j = await login(env, "ad@s.kr");
    const html = await (await get(env, j, `/t/seocho/admin/business/${b.id}`)).text();
    assert.match(html, /data-place-find/, "키가 있으면 찾기 칸이 열린다");

    const r = await get(env, j, "/t/seocho/admin/place-search?q=버들카페");
    assert.equal(r.status, 200);
    const { places } = await r.json();
    assert.equal(places.length, 1);
    assert.equal(places[0].name, "버들카페");
    assert.equal(places[0].address, "서울 서초구 방배로 33", "도로명 주소를 먼저 쓴다");
    assert.equal(places[0].phone, "02-585-1234");
    assert.equal(places[0].category, "커피전문점", "'음식점 > 카페 > 커피전문점' 에서 맨 끝만");
    assert.equal(places[0].lat, 37.4835);
    assert.equal(places[0].lng, 126.9976);
    // 키는 헤더로만 나간다 — 주소창에 실리면 로그·리퍼러에 남는다
    assert.match(calls[0].auth, /^KakaoAK test-key$/);
    assert.ok(!calls[0].url.includes("test-key"), "키가 주소에 실리면 안 된다");
    assert.match(calls[0].url, /dapi\.kakao\.com/);
  } finally { globalThis.fetch = realFetch; }
});

test("두 글자가 안 되면 카카오를 부르지 않는다 (호출 낭비·요금)", async () => {
  const env = makeEnv();
  env.KAKAO_REST_KEY = "test-key";
  await seed(env);
  let called = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { called++; return new Response("{}", { status: 200 }); };
  try {
    const j = await login(env, "ad@s.kr");
    const r = await get(env, j, "/t/seocho/admin/place-search?q=버");
    assert.deepEqual((await r.json()).places, []);
    assert.equal(called, 0);
  } finally { globalThis.fetch = realFetch; }
});

test("지도 검색은 로그인한 관리자만 부를 수 있다", async () => {
  const env = makeEnv();
  env.KAKAO_REST_KEY = "test-key";
  const { b } = await seed(env);
  let called = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { called++; return new Response(JSON.stringify({ documents: [] }), { status: 200 }); };
  try {
    const anon = await get(env, jar(), "/t/seocho/admin/place-search?q=버들카페");
    assert.ok(anon.status === 302 || anon.status === 303, "비로그인은 로그인으로");
    const mj = await login(env, "m@s.kr");
    const asMerchant = await get(env, mj, "/t/seocho/admin/place-search?q=버들카페");
    assert.ok(asMerchant.status !== 200, "점주는 부를 수 없다");
    assert.equal(called, 0, "권한이 없으면 카카오를 부르지도 않는다");
    void b;
  } finally { globalThis.fetch = realFetch; }
});

// ── 사진·영상 대신 올리기 ──
// 사장님이 카톡으로 사진을 보내 오는 것이 실제 흐름이다. 예전에는 점주 본인만 올릴 수 있어
// 회장님이 받은 사진을 넣을 방법이 없었고, 그래서 대행 등록한 가게는 계속 사진이 없었다.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
async function postForm(env, j, p, build, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const fd = new FormData();
  fd.set("_csrf", t);
  build(fd);
  const r = await worker.fetch(new Request(B + p, { method: "POST", headers: { cookie: ch(j) }, body: fd }), env);
  absorb(j, r); return r;
}

test("관리자가 올린 사진이 가게 페이지의 대표 사진이 된다", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  await D.setBusinessStatus(env.DB, b.id, "approved");
  const j = await login(env, "ad@s.kr");
  const r = await postForm(env, j, `/t/seocho/admin/business/${b.id}/media`, (fd) => {
    fd.append("files", new File([PNG], "front.png", { type: "image/png" }));
    fd.set("caption", "매장 전경");
  }, `/t/seocho/admin/business/${b.id}`);
  assert.equal(r.status, 303);
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);

  const media = await D.listMedia(env.DB, b.id);
  assert.equal(media.filter((m) => m.kind === "image").length, 1);
  const page = await (await get(env, jar(), `/t/seocho/business/${encodeURIComponent((await D.getBusinessById(env.DB, b.id)).slug)}`)).text();
  assert.match(page, /class="biz-cover"/, "맨 앞 사진이 이름 위 대표 사진으로");
  assert.match(page, /매장 전경/);
});

test("사진이 없으면 대표 사진 자리가 아예 없다 (회색 상자를 남기지 않는다)", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  await D.setBusinessStatus(env.DB, b.id, "approved");
  const page = await (await get(env, jar(), `/t/seocho/business/${encodeURIComponent((await D.getBusinessById(env.DB, b.id)).slug)}`)).text();
  assert.ok(!page.includes("biz-cover"), "빈 사진 자리는 '아무것도 없는 가게' 라고 먼저 말한다");
});

test("릴스·쇼츠 주소를 붙여넣으면 세로 영상으로 붙는다", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  await D.setBusinessStatus(env.DB, b.id, "approved");
  const j = await login(env, "ad@s.kr");
  for (const [url, provider] of [["https://www.instagram.com/reel/CxYzAbCdEfG/", "instagram"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube"]]) {
    const r = await post(env, j, `/t/seocho/admin/business/${b.id}/embed`, { url }, `/t/seocho/admin/business/${b.id}`);
    assert.doesNotMatch(r.headers.get("location") || "", /err=1/, url);
    assert.ok((await D.listMedia(env.DB, b.id)).some((m) => m.provider === provider), `${provider} 가 붙어야`);
  }
  const page = await (await get(env, jar(), `/t/seocho/business/${encodeURIComponent((await D.getBusinessById(env.DB, b.id)).slug)}`)).text();
  assert.match(page, /data-vertical="1"/, "릴스는 세로로 열려야 — 가로 틀에 넣으면 위아래가 잘린다");
  assert.match(page, /instagram\.com\/reel\/CxYzAbCdEfG\/embed/);
});

test("단축 주소는 왜 안 되는지 알려 준다", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const j = await login(env, "ad@s.kr");
  const r = await post(env, j, `/t/seocho/admin/business/${b.id}/embed`, { url: "https://naver.me/xAbCdEf" }, `/t/seocho/admin/business/${b.id}`);
  const msg = decodeURIComponent(r.headers.get("location") || "");
  assert.match(msg, /err=1/);
  assert.match(msg, /단축 주소/, "그냥 '실패' 라고만 하면 같은 주소를 계속 붙여넣게 된다");
});

test("올린 사진을 지울 수 있고, 남의 조직 점포에는 손대지 못한다", async () => {
  const env = makeEnv();
  const { b, ob } = await seed(env);
  const j = await login(env, "ad@s.kr");
  await postForm(env, j, `/t/seocho/admin/business/${b.id}/media`, (fd) => {
    fd.append("files", new File([PNG], "a.png", { type: "image/png" }));
  }, `/t/seocho/admin/business/${b.id}`);
  const m = (await D.listMedia(env.DB, b.id))[0];
  await post(env, j, `/t/seocho/admin/business/${b.id}/media/${m.id}/delete`, {}, `/t/seocho/admin/business/${b.id}`);
  assert.equal((await D.listMedia(env.DB, b.id)).length, 0);

  // 남의 조직 점포
  const bad = await postForm(env, j, `/t/seocho/admin/business/${ob.id}/media`, (fd) => {
    fd.append("files", new File([PNG], "x.png", { type: "image/png" }));
  }, "/t/seocho/admin");
  assert.match(bad.headers.get("location") || "", /err=1/);
  assert.equal((await D.listMedia(env.DB, ob.id)).length, 0);
});

test("점주는 관리자용 사진 올리기 경로를 쓸 수 없다", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const mj = await login(env, "m@s.kr");
  const r = await postForm(env, mj, `/t/seocho/admin/business/${b.id}/media`, (fd) => {
    fd.append("files", new File([PNG], "a.png", { type: "image/png" }));
  }, "/t/seocho/dashboard");
  assert.notEqual(r.status, 303);
  assert.equal((await D.listMedia(env.DB, b.id)).length, 0);
});

// ── 회원 추가 ──
// 상인회 사장님 중에는 이메일이 없는 분이 많다. 이 서비스는 안내를 알림톡으로 보내므로
// 실제로 필요한 연락처는 휴대폰이다. 이메일을 필수로 두면 명단을 아예 못 넣는다.
test("회원 추가 폼이 접힌 상자 안이 아니라 눈에 보이는 자리에 있다", async () => {
  const env = makeEnv();
  await seed(env);
  const j = await login(env, "ad@s.kr");
  const html = await (await get(env, j, "/t/seocho/admin")).text();
  const at = html.indexOf('id="p-addmember"');
  assert.ok(at > 0, "회원 추가 패널이 있어야");
  // 여는 태그를 함께 본다 — 접힌 상자(details)면 회장님이 못 찾는다
  assert.match(html.slice(Math.max(0, at - 120), at + 40), /<section class="panel panel-accent"/, "접힌 상자가 아니라 패널로");
  assert.match(html.slice(at, at + 1600), /name="phone"/, "휴대폰 칸이 있어야 — 알림톡이 나가는 곳이다");
  assert.match(html.slice(at, at + 1800), /이메일은 없어도 됩니다/);
});

test("이메일 없이 휴대폰만으로 회원을 추가할 수 있다", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const j = await login(env, "ad@s.kr");
  const r = await post(env, j, "/t/seocho/admin/members/add",
    { name: "박기석", phone: "010-3333-4444", business_name: "골목정육점", category: "농수축산" }, "/t/seocho/admin");
  const msg = decodeURIComponent(r.headers.get("location") || "");
  assert.doesNotMatch(msg, /err=1/, msg);
  assert.match(msg, /휴대폰 번호로 로그인/, "무엇으로 들어오는지 그 자리에서 말해야");
  assert.match(msg, /임시비번/, "비밀번호를 알려 줘야 사장님께 전달할 수 있다");

  const members = await D.listUsersByAssociation(env.DB, a.id, "MERCHANT");
  const added = members.find((m) => m.name === "박기석");
  assert.ok(added, "회원이 만들어져야");
  assert.equal(added.phone, "01033334444", "휴대폰이 저장돼야 — 알림톡이 여기로 간다");
  assert.match(added.email, /@no-login\.invalid$/, "실재하지 않도록 예약된 도메인이어야 메일이 잘못 나갈 일이 없다");
  const biz = (await D.listAllBusinesses(env.DB, a.id)).find((x) => x.name === "골목정육점");
  assert.ok(biz, "점포도 함께 만들어져야");
  assert.equal(biz.source, "proxy");

  // 목록에 가짜 주소를 진짜인 양 보여 주지 않는다
  const html = await (await get(env, j, "/t/seocho/admin")).text();
  assert.ok(!html.includes("no-login.invalid"), "가짜 주소를 화면에 그대로 내보이면 안 된다");
  assert.match(html, /badge-ok">휴대폰<\/span>/, "무엇이 아이디인지 목록에 적혀야");
});

test("이메일도 휴대폰도 없으면 거절한다 (연락할 방법이 없다)", async () => {
  const env = makeEnv();
  await seed(env);
  const j = await login(env, "ad@s.kr");
  const r = await post(env, j, "/t/seocho/admin/members/add", { name: "이름만", business_name: "가게" }, "/t/seocho/admin");
  const msg = decodeURIComponent(r.headers.get("location") || "");
  assert.match(msg, /err=1/);
  assert.match(msg, /연락할 방법이 없습니다/);
});

test("나중에 로그인 이메일을 지정하면 그때 임시 비밀번호가 나온다", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const j = await login(env, "ad@s.kr");
  await post(env, j, "/t/seocho/admin/members/add",
    { name: "박기석", phone: "010-3333-4444", business_name: "골목정육점" }, "/t/seocho/admin");
  const biz = (await D.listAllBusinesses(env.DB, a.id)).find((x) => x.name === "골목정육점");

  const page = await (await get(env, j, `/t/seocho/admin/business/${biz.id}`)).text();
  assert.match(page, /사장님 로그인/, "그 자리에서 지정할 수 있어야");
  assert.match(page, /번호가 아이디/, "휴대폰만 있는 계정은 그 번호가 아이디임을 알려야");

  const r = await post(env, j, `/t/seocho/admin/business/${biz.id}/owner-email`,
    { email: "gogol@example.kr" }, `/t/seocho/admin/business/${biz.id}`);
  const msg = decodeURIComponent(r.headers.get("location") || "");
  assert.doesNotMatch(msg, /err=1/, msg);
  assert.match(msg, /임시비번/, "발급된 비밀번호를 알려 줘야 전달할 수 있다");
  assert.equal((await D.getUserById(env.DB, biz.owner_id)).email, "gogol@example.kr");

  // 이제 정말 로그인이 되는가 — 화면에 적힌 비밀번호로
  const temp = /임시비번 (\S+)/.exec(msg)[1];
  const mj = jar();
  const lr = await post(env, mj, "/login", { email: "gogol@example.kr", password: temp });
  assert.equal(lr.status, 303, "지정한 주소로 실제 로그인이 돼야");
  assert.doesNotMatch(lr.headers.get("location") || "", /err=1/);
});

test("이미 이메일이 있는 계정은 이 경로로 주소를 바꿀 수 없다", async () => {
  const env = makeEnv();
  const { b } = await seed(env);
  const j = await login(env, "ad@s.kr");
  const r = await post(env, j, `/t/seocho/admin/business/${b.id}/owner-email`,
    { email: "hijack@example.kr" }, `/t/seocho/admin/business/${b.id}`);
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.equal((await D.getUserById(env.DB, b.owner_id)).email, "m@s.kr");
});

test("지도에서 찾아 채운 주소·전화·좌표가 등록과 동시에 저장된다", async () => {
  const env = makeEnv();
  env.KAKAO_REST_KEY = "test-key";
  const { a } = await seed(env);
  const j = await login(env, "ad@s.kr");
  // 화면에도 찾기 칸이 있어야 한다 (키가 있을 때만)
  const html = await (await get(env, j, "/t/seocho/admin")).text();
  const at = html.indexOf('id="p-addmember"');
  assert.match(html.slice(at, at + 2500), /data-place-find/, "회원 추가에서도 지도로 찾을 수 있어야");

  const r = await post(env, j, "/t/seocho/admin/members/add", {
    name: "이도현", phone: "010-5555-6666", business_name: "방배커피로스터스", category: "카페·디저트",
    address: "서울 서초구 방배로 33", biz_phone: "02-585-1234", lat: "37.4835", lng: "126.9976",
  }, "/t/seocho/admin");
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);

  const biz = (await D.listAllBusinesses(env.DB, a.id)).find((x) => x.name === "방배커피로스터스");
  assert.equal(biz.address, "서울 서초구 방배로 33", "등록하자마자 주소가 들어 있어야 — 두 번 넣게 하지 않는다");
  assert.equal(biz.phone, "02-585-1234");
  assert.equal(Number(biz.lat).toFixed(4), "37.4835");
  assert.equal(biz.category, "카페·디저트");
});

test("지도 키가 없으면 회원 추가에도 찾기 칸을 내걸지 않는다", async () => {
  const env = makeEnv();
  await seed(env);
  const j = await login(env, "ad@s.kr");
  const html = await (await get(env, j, "/t/seocho/admin")).text();
  const at = html.indexOf('id="p-addmember"');
  assert.ok(!html.slice(at, at + 2500).includes("data-place-find"), "쓸 수 없는 기능을 내걸면 안 된다");
  assert.ok(!html.includes("/js/place.js"), "쓰지 않는 스크립트를 내려받게 하지 않는다");
});

// ── 휴대폰 번호 로그인 ──────────────────────────────────────────────
// 이메일 없이 등록한 사장님이 실제로 들어올 수 있어야 한다. 이게 안 되면
// '이메일 없이 등록' 은 명단에만 이름이 오르는 반쪽짜리 기능이다.

test("휴대폰 번호와 임시 비밀번호로 사장님이 실제로 로그인한다", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const j = await login(env, "ad@s.kr");
  const r = await post(env, j, "/t/seocho/admin/members/add",
    { name: "박기석", phone: "010-3333-4444", business_name: "골목정육점" }, "/t/seocho/admin");
  const msg = decodeURIComponent(r.headers.get("location") || "");
  const temp = /임시비번 (\S+)/.exec(msg)[1];

  const mj = jar();
  const lr = await post(env, mj, "/login", { login: "010-3333-4444", password: temp });
  assert.equal(lr.status, 303, "번호로 로그인이 돼야: " + msg);
  assert.doesNotMatch(lr.headers.get("location") || "", /err=1/);

  // 로그인한 사람이 정말 그 사장님인가 — 자기 가게 화면이 열려야
  const dash = await (await get(env, mj, "/t/seocho/dashboard")).text();
  assert.match(dash, /골목정육점/);
  const added = (await D.listUsersByAssociation(env.DB, a.id, "MERCHANT")).find((m) => m.name === "박기석");
  assert.match(added.email, /@no-login\.invalid$/, "이메일은 여전히 자리표시자여야");
});

test("하이픈을 넣든 안 넣든 같은 번호로 본다", async () => {
  const env = makeEnv();
  await seed(env);
  const j = await login(env, "ad@s.kr");
  const msg = decodeURIComponent((await post(env, j, "/t/seocho/admin/members/add",
    { name: "박기석", phone: "01033334444", business_name: "골목정육점" }, "/t/seocho/admin")).headers.get("location"));
  const temp = /임시비번 (\S+)/.exec(msg)[1];
  const lr = await post(env, jar(), "/login", { login: "010-3333-4444", password: temp });
  assert.equal(lr.status, 303);
});

test("이메일처럼 생긴 값은 번호로 읽지 않는다", async () => {
  const env = makeEnv();
  await seed(env);
  // 주소 안의 숫자만 뽑으면 유효한 번호가 되는 주소 — 번호 조회로 새면 엉뚱한 계정이 열린다
  const lr = await post(env, jar(), "/login", { login: "a01033334444b@x.kr", password: "pass1234" });
  assert.match(lr.headers.get("location") || "", /err=1/, "이 주소는 계정이 없으므로 실패해야");
});

test("같은 번호에 같은 비밀번호를 쓰는 계정이 둘이면 아무도 들여보내지 않는다", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const h = await hashPassword("same-pass-9999");
  for (const n of ["부부1", "부부2"])
    await D.createUser(env.DB, { email: `${n}@x.kr`, passwordHash: h.hash, salt: h.salt, name: n, role: "MERCHANT", associationId: a.id, phone: "01055556666" });
  const lr = await post(env, jar(), "/login", { login: "010-5555-6666", password: "same-pass-9999" });
  assert.match(lr.headers.get("location") || "", /err=1/, "누구인지 정할 수 없으면 남의 가게를 열어 주는 것보다 막는 게 맞다");
  // 각자의 이메일로는 여전히 들어갈 수 있다
  assert.equal((await post(env, jar(), "/login", { login: "부부1@x.kr", password: "same-pass-9999" })).status, 303);
});

test("관리자가 잘못 받아 적은 사장님 번호를 고친다", async () => {
  const env = makeEnv();
  const { a } = await seed(env);
  const j = await login(env, "ad@s.kr");
  await post(env, j, "/t/seocho/admin/members/add",
    { name: "박기석", phone: "010-3333-4444", business_name: "골목정육점" }, "/t/seocho/admin");
  const biz = (await D.listAllBusinesses(env.DB, a.id)).find((x) => x.name === "골목정육점");

  const r = await post(env, j, `/t/seocho/admin/business/${biz.id}/owner-phone`,
    { phone: "010-9999-8888" }, `/t/seocho/admin/business/${biz.id}`);
  assert.doesNotMatch(r.headers.get("location") || "", /err=1/);
  assert.equal((await D.getUserById(env.DB, biz.owner_id)).phone, "01099998888");

  // 번호가 아이디인 계정에서 번호를 비우면 로그인 수단이 사라진다 — 막아야 한다
  const bad = await post(env, j, `/t/seocho/admin/business/${biz.id}/owner-phone`,
    { phone: "" }, `/t/seocho/admin/business/${biz.id}`);
  assert.match(decodeURIComponent(bad.headers.get("location") || ""), /로그인할 수 없게 됩니다/);
  assert.equal((await D.getUserById(env.DB, biz.owner_id)).phone, "01099998888", "막았으면 값도 그대로여야");
});

test("남의 상인회 사장님 번호는 못 고친다", async () => {
  const env = makeEnv();
  const { ob } = await seed(env);
  const j = await login(env, "ad@s.kr");
  const r = await post(env, j, `/t/seocho/admin/business/${ob.id}/owner-phone`,
    { phone: "010-1111-2222" }, "/t/seocho/admin");
  assert.match(decodeURIComponent(r.headers.get("location") || ""), /err=1/);
  assert.notEqual((await D.getUserById(env.DB, ob.owner_id)).phone, "01011112222");
});
