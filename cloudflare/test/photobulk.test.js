// 지도 사진을 한꺼번에 가져오기.
//
// 한 곳씩 누르는 단추는 원래 있었다. 그런데 가게가 114곳이면 **114번 눌러야 한다.**
// 그 화면을 114번 열고 닫는 사람은 없다. 그래서 기능이 있는데도 사진이 한 장도
// 안 들어왔고, "사진들 아직까지 불러오질 않아" 라는 말을 들었다.
//
// 그래서 이 파일은 "가져오는가" 만이 아니라 **"안 가져와야 할 때 안 가져오는가"** 를 함께 본다:
// 이미 사진이 있는 가게, 지도에 안 붙은 가게, 지도에 사진이 없는 가게.
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
const get = async (env, j, p) => { const r = await worker.fetch(new Request(B + p, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; };
async function post(env, j, p, f, from) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, from || p)).text()) || [])[1];
  const r = await worker.fetch(new Request(B + p, { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
const PHOTOS = "/t/bb/admin/members/photos";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(1)]);

// 카카오 장소 페이지와 사진을 가로챈다 — 진짜 지도에 나가지 않는다.
function stubMap({ withPhoto = () => true } = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = async (req, init) => {
    const u = String(req && req.url ? req.url : req);
    if (u.includes("place.map.kakao.com")) {
      const id = (/\/(\d+)/.exec(u) || [])[1] || "";
      const img = withPhoto(id)
        ? `<meta property="og:image" content="//img1.kakaocdn.net/cthumb/local/x.jpg" />`
        // 사진이 없는 가게는 카카오가 '지도 그림' 을 준다. 그건 가게 사진이 아니다.
        : `<meta property="og:image" content="http://staticmap.kakao.com/staticmap/og?x=1" />`;
      return new Response(`<html><head>${img}<meta property="og:title" content="가게${id}" />
        <meta property="og:url" content="${u}" /></head></html>`, { headers: { "content-type": "text/html" } });
    }
    if (u.includes("img1.kakaocdn.net"))
      return new Response(PNG, { headers: { "content-type": "image/png" } });
    return real(req, init);
  };
  return () => { globalThis.fetch = real; };
}

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목 상인회", kind: "merchant" });
  const p = await hashPassword("admin1234");
  await D.createUser(env.DB, { email: "a@bb.kr", passwordHash: p.hash, salt: p.salt, name: "회장", role: "ADMIN", associationId: a.id });
  return a;
}
const login = async (env) => {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, "/t/bb/login")).text()) || [])[1];
  await worker.fetch(new Request(B + "/t/bb/login", { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, login: "a@bb.kr", password: "admin1234" }).toString() }), env)
    .then((r) => absorb(j, r));
  return j;
};
async function shop(env, a, name, { mapUrl = "", naver = "" } = {}) {
  const p = await hashPassword("owner1234");
  const u = await D.createUser(env.DB, { email: `${name}@bb.kr`, passwordHash: p.hash, salt: p.salt,
    name, role: "MERCHANT", associationId: a.id });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name, category: "음식점" });
  await D.updateBusiness(env.DB, b.id, { name, category: "음식점", description: "", phone: "", address: "",
    hours: "", lat: 37.48, lng: 126.99, snsInstagram: "", snsYoutube: "", snsBlog: "", snsKakao: "",
    snsNaver: naver, mapUrl });
  await D.setBusinessStatus(env.DB, b.id, "approved");
  return b.id;
}
const imgs = (env, id) => D.countBusinessImages(env.DB, id);

test("지도에 붙은 가게들의 사진을 한 번에 담는다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const ids = [];
  for (const n of ["버들카페", "돈거돈락", "서광안경"])
    ids.push(await shop(env, a, n, { mapUrl: `http://place.map.kakao.com/${100 + ids.length}` }));
  const j = await login(env);
  const stop = stubMap();
  try {
    await post(env, j, PHOTOS, { after: "0" }, PHOTOS);
    for (const id of ids) assert.equal(await imgs(env, id), 1, "한 곳이라도 빠지면 회장님이 그 한 곳을 찾아야 한다");
  } finally { stop(); }
});

test("이미 사진이 있는 가게는 건너뛴다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const id = await shop(env, a, "버들카페", { mapUrl: "http://place.map.kakao.com/100" });
  await D.addMedia(env.DB, { businessId: id, kind: "image", filename: "mine.jpg", size: 10, caption: "" });
  const j = await login(env);
  const stop = stubMap();
  try {
    await post(env, j, PHOTOS, { after: "0" }, PHOTOS);
    assert.equal(await imgs(env, id), 1, "남의 후기 사진이 사장님 사진 옆에 쌓이면 안 된다");
  } finally { stop(); }
});

test("지도에 안 붙은 가게는 애초에 대상이 아니다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const id = await shop(env, a, "새롬상사", { mapUrl: "https://www.saerom.co.kr" });   // 업체 홈페이지
  assert.equal(await D.countBusinessesForPlacePhoto(env.DB, a.id), 0,
    "지도 페이지가 아닌 주소를 대상에 넣으면 남의 홈페이지를 긁게 된다");
  const j = await login(env);
  const stop = stubMap();
  try {
    await post(env, j, PHOTOS, { after: "0" }, PHOTOS);
    assert.equal(await imgs(env, id), 0);
  } finally { stop(); }
});

test("지도에 사진이 없으면 '없습니다' 라고 말하고 넘어간다", async () => {
  // 카카오는 사진이 없는 가게에 '지도 그림' 을 대신 준다. 그걸 가게 사진으로 담으면
  // 목록에 회색 지도 조각이 줄줄이 걸린다 — 회색 상자보다 나쁘다.
  const env = makeEnv(); const a = await seed(env);
  const id = await shop(env, a, "따올라이", { mapUrl: "http://place.map.kakao.com/777" });
  const j = await login(env);
  const stop = stubMap({ withPhoto: () => false });
  try {
    const html = await (await post(env, j, PHOTOS, { after: "0" }, PHOTOS)).text();
    assert.equal(await imgs(env, id), 0, "지도 그림을 가게 사진으로 담았다");
    assert.match(html, /지도에 아직 사진이 없습니다/);
  } finally { stop(); }
});

test("한 곳이 실패해도 나머지는 담는다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const ok1 = await shop(env, a, "버들카페", { mapUrl: "http://place.map.kakao.com/100" });
  const bad = await shop(env, a, "돈거돈락", { mapUrl: "http://place.map.kakao.com/777" });
  const ok2 = await shop(env, a, "서광안경", { mapUrl: "http://place.map.kakao.com/101" });
  const j = await login(env);
  const stop = stubMap({ withPhoto: (id) => id !== "777" });
  try {
    await post(env, j, PHOTOS, { after: "0" }, PHOTOS);
    assert.equal(await imgs(env, ok1), 1);
    assert.equal(await imgs(env, bad), 0);
    assert.equal(await imgs(env, ok2), 1, "가운데가 실패했다고 뒤가 멈추면 안 된다");
  } finally { stop(); }
});

test("담은 사진에는 어디서 왔는지가 함께 저장된다", async () => {
  // 이 사진은 손님이 올린 후기 사진이다. 내려 달라는 요청이 오면 어느 사진인지 찾을 수 있어야 한다.
  const env = makeEnv(); const a = await seed(env);
  const id = await shop(env, a, "버들카페", { mapUrl: "http://place.map.kakao.com/100" });
  const j = await login(env);
  const stop = stubMap();
  try {
    await post(env, j, PHOTOS, { after: "0" }, PHOTOS);
    const m = (await D.listMedia(env.DB, id))[0];
    assert.equal(m.source_name, "카카오맵");
    assert.match(m.source_url, /place\.map\.kakao\.com/);
  } finally { stop(); }
});

test("네이버 플레이스 주소만 적어 둔 가게도 대상이 된다", async () => {
  const env = makeEnv(); const a = await seed(env);
  await shop(env, a, "컴포즈커피", { naver: "https://m.place.naver.com/restaurant/123" });
  assert.equal(await D.countBusinessesForPlacePhoto(env.DB, a.id), 1,
    "'장소 찾기' 전에 손으로 적어 둔 주소를 버리면 그 가게는 영영 사진이 없다");
});

test("회원·점포 화면에서 이 기능으로 가는 길이 있다", async () => {
  const env = makeEnv(); await seed(env);
  const j = await login(env);
  const html = await (await get(env, j, "/t/bb/admin")).text();
  assert.ok(html.includes(">지도 사진 한꺼번에</a>"), "기능이 있어도 못 찾으면 없는 것과 같다");
  assert.ok(html.includes("/admin/members/photos"));
});

test("로그인하지 않으면 이 화면을 열 수 없다", async () => {
  const env = makeEnv(); await seed(env);
  const r = await get(env, jar(), PHOTOS);
  assert.ok(r.status !== 200, `누구나 열 수 있다 (${r.status})`);
});

// ── 사장님께 부탁하는 링크를 한 번에 ───────────────────────────────────
//
// 지도가 못 주는 것이 둘이다: 영업시간과 사장님이 직접 찍은 사진.
// 그런데 링크는 가게 화면에 들어가야 하나씩 만들어졌다 — 114곳이면 화면을 114번 연다.
const LINKS = "/t/bb/admin/members/links";

test("사진이나 영업시간이 없는 가게만 나온다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const bare = await shop(env, a, "따올라이");                       // 둘 다 없음
  const noHours = await shop(env, a, "버들카페");                    // 사진만 있음
  await D.addMedia(env.DB, { businessId: noHours, kind: "image", filename: "x.jpg", size: 10, caption: "" });
  const done = await shop(env, a, "서광안경");                       // 둘 다 있음
  await D.addMedia(env.DB, { businessId: done, kind: "image", filename: "y.jpg", size: 10, caption: "" });
  await D.setBusinessHours(env.DB, done, "10:00-22:00");

  assert.equal(await D.countBusinessesToAsk(env.DB, a.id), 2, "다 갖춘 가게까지 부르면 사장님이 두 번 귀찮다");
  const j = await login(env);
  const html = await (await get(env, j, LINKS)).text();
  assert.ok(html.includes("따올라이") && html.includes("버들카페"));
  assert.ok(!html.includes(">서광안경<"), "이미 다 갖춘 가게가 목록에 있으면 회장님이 헛수고한다");
  assert.ok(bare && noHours);
});

test("보낼 글까지 만들어 준다 — 링크만 주면 '뭐라고 쓰지' 에서 또 멈춘다", async () => {
  const env = makeEnv(); const a = await seed(env);
  await shop(env, a, "따올라이");
  const j = await login(env);
  const html = await (await get(env, j, LINKS)).text();
  assert.ok(html.includes("방배카페골목 상인회"), "어느 상인회에서 온 것인지 없으면 사장님이 스팸으로 본다");
  assert.ok(html.includes("영업시간을 부탁드립니다"));
  assert.ok(/\/photos\/[A-Za-z0-9_.-]+/.test(html), "링크가 안 만들어졌다");
  assert.ok(html.includes("data-copy="), "한 곳씩 복사할 길이 없다");
});

test("만들어 준 링크로 사장님이 실제로 들어올 수 있다", async () => {
  const env = makeEnv(); const a = await seed(env);
  await shop(env, a, "따올라이");
  const j = await login(env);
  const html = await (await get(env, j, LINKS)).text();
  const tok = (/\/photos\/([A-Za-z0-9_.-]+)/.exec(html) || [])[1];
  assert.ok(tok, "링크를 못 찾았다");
  // 로그인 없이 열려야 한다 — 사장님은 계정이 없다.
  const r = await worker.fetch(new Request(B + `/t/bb/photos/${tok}`), env);
  assert.equal(r.status, 200, "회장님이 보낸 링크가 사장님에게서 안 열리면 이 기능은 없는 것이다");
  assert.ok(a);
});

test("부탁드릴 곳이 없으면 그렇게 말한다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const id = await shop(env, a, "서광안경");
  await D.addMedia(env.DB, { businessId: id, kind: "image", filename: "y.jpg", size: 10, caption: "" });
  await D.setBusinessHours(env.DB, id, "10:00-22:00");
  const j = await login(env);
  assert.match(await (await get(env, j, LINKS)).text(), /부탁드릴 곳이 없습니다/);
});

test("회원·점포 화면에서 요청 링크로 가는 길이 있다", async () => {
  const env = makeEnv(); await seed(env);
  const j = await login(env);
  const html = await (await get(env, j, "/t/bb/admin")).text();
  assert.ok(html.includes(">사진·영업시간 요청 링크</a>"));
});

test("로그인하지 않으면 링크 화면을 열 수 없다", async () => {
  // 이 화면은 사장님 휴대폰 번호와 서명된 링크를 통째로 보여 준다.
  const env = makeEnv(); const a = await seed(env);
  await shop(env, a, "따올라이");
  const r = await get(env, jar(), LINKS);
  assert.ok(r.status !== 200, `누구나 열 수 있다 (${r.status})`);
});
