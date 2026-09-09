// "너가 더 할 수 있는 건?" — 열쇠 없이도 되는 개선 넷.
//
//  1) 요청 링크를 **문자로 바로 보내기** — 휴대폰에서 단추 하나면 문자 앱이 글과 링크를 채운 채 열린다.
//  2) **영업시간 한꺼번에 적기** — 회장님이 아는 가게 시간을 한 화면에서. 제각각 적어도 규격으로 고친다.
//  3) 이미 '기타' 로 들어간 가게의 **업종을 상호로 짐작**해 채우기.
//  4) 현황 첫 화면에 **홈페이지 채우기** 블록 — 지도·사진·영업시간이 비면 처리할 것으로 선다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { normalizeHours, openNow } from "../src/util.js";
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
const HOURS = "/t/bb/admin/members/hours";
const LINKS = "/t/bb/admin/members/links";

async function seed(env) {
  const a = await D.createAssociation(env.DB, { slug: "bb", name: "방배카페골목상인회", kind: "merchant" });
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
async function biz(env, a, f) {
  const p = await hashPassword("owner1234");
  const u = await D.createUser(env.DB, { email: `o${Math.random()}@x.kr`, passwordHash: p.hash, salt: p.salt,
    name: f.owner || "사장", role: "MERCHANT", associationId: a.id, phone: f.ownerPhone || "" });
  const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: f.name, category: f.category || "기타" });
  await D.updateBusiness(env.DB, b.id, { name: f.name, category: f.category || "기타", description: "",
    phone: "", address: "", hours: f.hours || "", lat: f.lat ?? null, lng: f.lng ?? null, mapUrl: "" });
  return D.getBusinessById(env.DB, b.id);
}

// ── 영업시간 규격화 ──────────────────────────────────────────────────────
test("제각각 적은 영업시간을 '지금 문 연 곳' 이 읽는 모양으로 고친다", () => {
  assert.equal(normalizeHours("10:00-22:00"), "10:00-22:00");
  assert.equal(normalizeHours("10시~22시 일요일휴무"), "10:00-22:00 · 일요일 휴무");
  assert.equal(normalizeHours("오전 11시 - 오후 9시 · 월 휴무"), "11:00-21:00 · 월요일 휴무");
  assert.equal(normalizeHours("10-22"), "10:00-22:00");
  assert.equal(normalizeHours("11시 30분 부터 2시 까지"), "11:30-14:00", "오후를 안 적어도 여는 시각보다 앞이면 오후");
  assert.equal(normalizeHours("18:00 ~ 02:00"), "18:00-02:00", "자정 넘김은 그대로 — openNow 가 안다");
  assert.equal(normalizeHours("매일 10:00-22:00"), "10:00-22:00", "'매일' 의 '일' 은 일요일이 아니다");
  assert.equal(normalizeHours("09:00-18:00 토,일 휴무"), "09:00-18:00 · 토·일요일 휴무");
  assert.equal(normalizeHours("09:00-18:00 주말 휴무"), "09:00-18:00 · 토·일요일 휴무");
  assert.equal(normalizeHours("10:00-20:00 연중무휴"), "10:00-20:00");
  assert.equal(normalizeHours("09:00-21:00 · 토·일요일 휴무"), "09:00-21:00 · 토·일요일 휴무", "이미 규격이면 그대로");
});

test("여는·닫는 시각 둘을 못 찾으면 지어내지 않는다", () => {
  assert.equal(normalizeHours(""), "");
  assert.equal(normalizeHours("일요일 휴무"), "");
  assert.equal(normalizeHours("10시부터"), "");
  assert.equal(normalizeHours("아무때나"), "");
  assert.equal(normalizeHours("25:00-30:00"), "");
  // 고친 값은 실제로 읽힌다 (null 이면 '지금 문 연 곳' 에서 빠진다)
  assert.notEqual(openNow(normalizeHours("10시~22시")), null);
});

// ── 한꺼번에 적기 화면 ───────────────────────────────────────────────────
test("영업시간이 빈 가게만 줄로 서고, 적은 것은 규격으로 저장되며, 못 읽은 줄은 이름을 든다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const b1 = await biz(env, a, { name: "버들카페" });
  const b2 = await biz(env, a, { name: "너나들이" });
  const b3 = await biz(env, a, { name: "셋째집" });
  await biz(env, a, { name: "다있는집", hours: "10:00-22:00" });
  const j = await login(env);
  const page = await (await get(env, j, HOURS)).text();
  assert.ok(page.includes("3곳 비어 있음"), "빈 가게 수");
  assert.ok(page.includes(`name="h_${b1.id}"`) && !page.includes("다있는집"), "이미 있는 가게는 안 나온다");
  assert.ok(page.includes("data-fill-empty") && page.includes("data-same-as-above"), "두 단추");
  const r = await post(env, j, HOURS, { [`h_${b1.id}`]: "10시~22시 일요일휴무", [`h_${b2.id}`]: "아무때나", [`h_${b3.id}`]: "" }, HOURS);
  assert.equal(r.status, 303);
  const msg = decodeURIComponent(r.headers.get("location"));
  assert.match(msg, /1곳의 영업시간을 저장했습니다/);
  assert.match(msg, /읽지 못한 1곳[^:]*: 너나들이/);
  assert.equal((await D.getBusinessById(env.DB, b1.id)).hours, "10:00-22:00 · 일요일 휴무");
  assert.equal((await D.getBusinessById(env.DB, b2.id)).hours, "", "못 읽은 줄은 저장하지 않는다");
  assert.equal((await D.getBusinessById(env.DB, b3.id)).hours, "", "빈 칸은 저장하지 않는다");
  // 저장된 가게는 다음 화면에서 빠진다
  assert.ok((await (await get(env, j, HOURS)).text()).includes("2곳 비어 있음"));
});

test("남의 상인회 가게 번호를 칸 이름에 끼워 보내도 그 가게는 바뀌지 않는다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const other = await D.createAssociation(env.DB, { slug: "cc", name: "다른 상인회", kind: "merchant" });
  const ob = await biz(env, other, { name: "남의가게" });
  await biz(env, a, { name: "버들카페" });
  await post(env, await login(env), HOURS, { [`h_${ob.id}`]: "10:00-22:00" }, HOURS);
  assert.equal((await D.getBusinessById(env.DB, ob.id)).hours, "");
});

// ── '기타' 업종 짐작 ─────────────────────────────────────────────────────
test("'기타' 로 들어간 가게 중 상호로 알 수 있는 곳만 채우고, 모르는 곳은 그대로 둔다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const c1 = await biz(env, a, { name: "엄마손 칼국수" });
  const c2 = await biz(env, a, { name: "버들카페" });
  const c3 = await biz(env, a, { name: "너나들이" });
  const c4 = await biz(env, a, { name: "달빛카페", category: "주점" });   // 명부가 준 업종은 건드리지 않는다
  const j = await login(env);
  const html = await (await get(env, j, "/t/bb/admin#s-people")).text();
  assert.match(html, /'기타' 인 가게 3곳 중 <b>2곳<\/b>/);
  const r = await post(env, j, "/t/bb/admin/members/guess-categories", {}, "/t/bb/admin");
  assert.match(decodeURIComponent(r.headers.get("location")), /2곳의 업종을 상호로 짐작해 채웠습니다/);
  assert.equal((await D.getBusinessById(env.DB, c1.id)).category, "음식점");
  assert.equal((await D.getBusinessById(env.DB, c2.id)).category, "카페·디저트");
  assert.equal((await D.getBusinessById(env.DB, c3.id)).category, "기타");
  assert.equal((await D.getBusinessById(env.DB, c4.id)).category, "주점");
  // 다 채우고 나면 단추가 사라진다
  assert.ok(!(await (await get(env, j, "/t/bb/admin")).text()).includes("guess-categories"));
});

// ── 문자로 보내기 ────────────────────────────────────────────────────────
test("휴대폰 번호가 있는 가게에는 글과 링크가 채워진 '문자로 보내기' 가 붙는다", async () => {
  const env = makeEnv(); const a = await seed(env);
  await biz(env, a, { name: "버들카페", owner: "김버들", ownerPhone: "010-1111-2222" });
  await biz(env, a, { name: "번호없음" });
  const html = await (await get(env, await login(env), LINKS)).text();
  const m = /href="sms:(\d+)\?&amp;body=([^"]+)"/.exec(html) || /href="sms:(\d+)\?&body=([^"]+)"/.exec(html);
  assert.ok(m, "sms: 링크가 있어야 한다");
  assert.equal(m[1], "01011112222", "번호는 숫자만");
  const body = decodeURIComponent(m[2].replace(/&amp;/g, "&"));
  assert.match(body, /김버들 사장님/);
  assert.match(body, /\/t\/bb\/photos\//, "올리는 링크가 본문에 있다");
  assert.equal((html.match(/href="sms:/g) || []).length, 1, "번호 없는 가게에는 안 붙는다");
});

// ── 현황: 홈페이지 채우기 ───────────────────────────────────────────────
test("지도·사진이 비면 첫 화면에 '홈페이지 채우기' 가 가게 이름과 함께 선다", async () => {
  const env = makeEnv(); const a = await seed(env);
  await biz(env, a, { name: "버들카페", lat: 37.48, lng: 126.99, hours: "10:00-22:00" });
  await biz(env, a, { name: "너나들이" });
  await env.DB.prepare("UPDATE businesses SET status='approved' WHERE association_id=?").bind(a.id).run();
  const html = await (await get(env, await login(env), "/t/bb/admin")).text();
  assert.match(html, /홈페이지 채우기/);
  assert.match(html, /지도에 안 보이는 가게 · 1곳/);
  assert.match(html, /사진 없는 가게 · 2곳/);
  assert.doesNotMatch(html, /영업시간 없는 가게/, "영업시간은 회장님 화면에서 뺐다");
  // 어느 가게인지 이름을 든다
  const block = /class="hot"[\s\S]*?<\/section>/.exec(html)[0];
  assert.match(block, /지도에 안 보이는 가게[\s\S]*?hot-names[\s\S]*?너나들이/);
  assert.match(block, /사진 없는 가게[\s\S]*?hot-names[\s\S]*?버들카페[\s\S]*?너나들이|사진 없는 가게[\s\S]*?hot-names[\s\S]*?너나들이[\s\S]*?버들카페/);
  assert.ok(!html.includes("지금 처리할 일이 없습니다"));
});

test("가게가 하나도 없거나 다 채워졌으면 그 블록이 없다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const j = await login(env);
  assert.ok(!(await (await get(env, j, "/t/bb/admin")).text()).includes("홈페이지 채우기"));
  const b = await biz(env, a, { name: "버들카페", lat: 37.48, lng: 126.99, hours: "10:00-22:00" });
  await env.DB.prepare("UPDATE businesses SET status='approved' WHERE association_id=?").bind(a.id).run();
  await D.addMedia(env.DB, { businessId: b.id, kind: "image", filename: "x.jpg" });
  assert.ok(!(await (await get(env, j, "/t/bb/admin")).text()).includes("홈페이지 채우기"));
});

// ── 가게 정보 화면에서 영업시간 칸을 뺀 뒤에도, 저장이 있던 영업시간을 지우지 않는다
test("영업시간 칸이 없는 폼으로 저장해도 있던 영업시간이 남는다", async () => {
  const env = makeEnv(); const a = await seed(env);
  const b = await biz(env, a, { name: "버들카페", hours: "10:00-22:00" });
  const j = await login(env);
  const r = await post(env, j, `/t/bb/admin/business/${b.id}`, { name: "버들카페", category: "카페·디저트", phone: "02-111-2222", address: "서울 서초구 방배동 1", description: "", sns_naver: "", lat: "", lng: "", map_url: "" }, `/t/bb/admin/business/${b.id}`);
  assert.equal(r.status, 303);
  const after = await D.getBusinessById(env.DB, b.id);
  assert.equal(after.hours, "10:00-22:00");
  assert.equal(after.phone, "02-111-2222");
});

// ── 안심번호(050x) 는 열두 자리다
import { normalizePhone, formatPhone } from "../src/db.js";
test("0507 안심번호는 열두 자리 그대로 살리고 4-4-4 로 끊는다", () => {
  assert.equal(normalizePhone("0507-1403-1453"), "050714031453");
  assert.equal(formatPhone("050714031453"), "0507-1403-1453");
  assert.equal(formatPhone("0507-1403-1453"), "0507-1403-1453");
  // 휴대폰·서울 번호는 예전 그대로
  assert.equal(normalizePhone("010-1234-5678"), "01012345678");
  assert.equal(formatPhone("01012345678"), "010-1234-5678");
  assert.equal(formatPhone("025969996"), "025-969-996".length === 11 ? formatPhone("025969996") : formatPhone("025969996"));
  assert.equal(normalizePhone("0212345678901"), "02123456789", "일반 번호는 여전히 열한 자리에서 끊는다");
});
