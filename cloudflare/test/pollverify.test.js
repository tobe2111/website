// 안건 투표 본인확인 — "그 표를 그 사람이 넣었나".
//
// 이 검사가 지키는 것은 하나다: **화면에서 버튼을 감추는 것으로는 막은 것이 아니다.**
// 주소로 직접 보낸 요청이 통과하면 총회 결의의 근거가 통째로 무너진다.
// 그래서 아래 검사들은 모두 화면을 건너뛰고 투표 주소로 바로 보낸다.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword, sha256Hex } from "../src/crypto.js";

const jar = () => ({ c: {} });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function get(env, j, u) { const r = await worker.fetch(new Request(u, { headers: { cookie: ch(j) } }), env); absorb(j, r); return r; }
async function post(env, j, u, f, csrfFrom) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, csrfFrom)).text()) || [])[1];
  const r = await worker.fetch(new Request(u, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
const B = "http://localhost/t/market";

// 카카오 흉내 — 토큰 교환과 사용자 정보만 가로챈다.
function fakeKakao({ id = "777222", phone = "+82 10-3333-4444", name = "김사장" } = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = String(input && input.url ? input.url : input);
    if (u.startsWith("https://kauth.kakao.com/oauth/token"))
      return new Response(JSON.stringify({ access_token: "tok" }), { headers: { "content-type": "application/json" } });
    if (u.startsWith("https://kapi.kakao.com/v2/user/me"))
      return new Response(JSON.stringify({ id: Number(id), kakao_account: { phone_number: phone, name, profile: { nickname: name } } }), { headers: { "content-type": "application/json" } });
    return real ? real(input, init) : new Response("", { status: 404 });
  };
  return () => { globalThis.fetch = real; };
}

async function setup() {
  const env = makeEnv();
  env.KAKAO_REST_KEY = "0123456789abcdef0123456789abcdef";
  const a = await D.createAssociation(env.DB, { slug: "market", name: "방배카페골목상인회", kind: "merchant" });
  const ad = await hashPassword("admin1234");
  const admin = await D.createUser(env.DB, { email: "office@m.kr", passwordHash: ad.hash, salt: ad.salt, name: "총무", role: "ADMIN", associationId: a.id });
  const mp = await hashPassword("owner1234");
  const member = await D.createUser(env.DB, { email: "boss@m.kr", passwordHash: mp.hash, salt: mp.salt, name: "김사장", role: "MERCHANT", associationId: a.id });
  await D.setUserPhone(env.DB, member.id, "01033334444");
  return { env, a, admin, member };
}
const login = async (env, j, email, pw) => post(env, j, `${B}/login`, { email, password: pw }, `${B}/login`);

// ───────────────────────────────────────────────────────────────
test("확인 등급을 올리지 않은 안건은 예전처럼 그냥 투표된다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회식 날짜", createdBy: null });
  assert.equal(D.pollVerifyLevel(p), 0, "기본값은 확인 없음");
  const j = jar();
  await login(env, j, "boss@m.kr", "owner1234");
  await post(env, j, `${B}/polls/${p.id}/vote`, { choice: "yes" }, `${B}/polls`);
  assert.equal(await D.userVote(env.DB, p.id, member.id), "yes");
  const rows = await D.listPollVotes(env.DB, p.id);
  assert.equal(rows[0].verify, "", "확인 없이 들어온 표는 그렇게 적힌다");
});

test("등급 1: 확인 안 된 회원의 표는 주소로 직접 보내도 들어가지 않는다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회비 인상", verify: 1, createdBy: null });
  const j = jar();
  await login(env, j, "boss@m.kr", "owner1234");
  // 화면에 투표 단추가 없다
  const h = await (await get(env, j, `${B}/polls`)).text();
  assert.ok(!h.includes(`/polls/${p.id}/vote`), "단추를 만들지 않는다");
  assert.match(h, /본인확인을 마친 분만/);
  // 그리고 직접 보내도 막힌다 — 이쪽이 진짜 막는 자리다
  await post(env, j, `${B}/polls/${p.id}/vote`, { choice: "yes" }, `${B}/polls`);
  assert.equal(await D.userVote(env.DB, p.id, member.id), null, "표가 들어가면 안 된다");
});

test("등급 1: 관리자가 확인 처리하면 투표가 열리고, 무엇으로 확인됐는지 표에 적힌다", async () => {
  const { env, a, admin, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회비 인상", verify: 1, createdBy: null });

  const aj = jar();
  await login(env, aj, "office@m.kr", "admin1234");
  await post(env, aj, `${B}/admin/member/${member.id}/verify`, { on: "1" }, `${B}/admin/polls/verify`);
  const after = await D.getUserById(env.DB, member.id);
  assert.equal(after.verified_how, "admin");
  assert.equal(after.verified_by, admin.id, "누가 확인해 줬는지 남는다");

  const j = jar();
  await login(env, j, "boss@m.kr", "owner1234");
  await post(env, j, `${B}/polls/${p.id}/vote`, { choice: "no" }, `${B}/polls`);
  assert.equal(await D.userVote(env.DB, p.id, member.id), "no");
  assert.equal((await D.listPollVotes(env.DB, p.id))[0].verify, "admin");

  // 확인을 내려도 이미 넣은 표는 남는다 (무엇으로 확인된 표였는지까지)
  await post(env, aj, `${B}/admin/member/${member.id}/verify`, { on: "0" }, `${B}/admin/polls/verify`);
  assert.equal((await D.getUserById(env.DB, member.id)).verified_at, "");
  assert.equal((await D.listPollVotes(env.DB, p.id))[0].verify, "admin", "표에 적힌 것은 지워지지 않는다");
});

test("카카오 번호가 명부와 같을 때만 본인확인으로 인정한다", async () => {
  const { env, a, member } = await setup();
  const j = jar();
  await login(env, j, "boss@m.kr", "owner1234");

  // ① 번호가 다르면 — 연결은 되지만 확인은 붙지 않는다
  let un = fakeKakao({ id: "555000", phone: "+82 10-9999-0000" });
  try {
    const st = await (await import("../src/kakao.js")).makeState(env.SESSION_SECRET, { base: "/t/market", uid: member.id });
    await get(env, j, `${B}/auth/kakao/callback?code=c1&state=${encodeURIComponent(st)}`);
  } finally { un(); }
  let u = await D.getUserById(env.DB, member.id);
  assert.equal(u.kakao_id, "555000", "연결은 됐다");
  assert.equal(u.verified_at, "", "번호가 다르므로 확인은 아니다");

  // ② 번호가 같으면 확인이 붙는다
  await D.clearUserKakao(env.DB, member.id);
  un = fakeKakao({ id: "777222", phone: "+82 10-3333-4444" });
  try {
    const st = await (await import("../src/kakao.js")).makeState(env.SESSION_SECRET, { base: "/t/market", uid: member.id });
    await get(env, j, `${B}/auth/kakao/callback?code=c2&state=${encodeURIComponent(st)}`);
  } finally { un(); }
  u = await D.getUserById(env.DB, member.id);
  assert.equal(u.verified_how, "kakao");

  // ③ 연결을 끊으면 근거가 사라지므로 확인도 함께 내려간다
  await post(env, j, `${B}/account/kakao/unlink`, {}, `${B}/account`);
  u = await D.getUserById(env.DB, member.id);
  assert.equal(u.verified_at, "", "근거 없는 확인을 남겨 두지 않는다");
  assert.equal(u.kakao_id, "");
});

test("등급 2: 인증번호를 통과해야 표가 들어가고, 틀린 번호는 시도만 쌓인다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "정관 개정", verify: 2, createdBy: null });
  const j = jar();
  await login(env, j, "boss@m.kr", "owner1234");

  // 확인 전 — 직접 보내도 막힌다
  await post(env, j, `${B}/polls/${p.id}/vote`, { choice: "yes" }, `${B}/polls`);
  assert.equal(await D.userVote(env.DB, p.id, member.id), null);

  // 인증번호를 코드에서 직접 심는다 (발송 경로는 notify 쪽 검사가 본다)
  const code = "424242";
  await D.upsertPollOtp(env.DB, { pollId: p.id, userId: member.id,
    codeHash: await sha256Hex(`pollotp|${p.id}|${member.id}|${code}`), phone: "01033334444" });

  // 틀린 번호 — 통과하지 않고 시도만 올라간다
  await post(env, j, `${B}/polls/${p.id}/otp/verify`, { code: "000000" }, `${B}/polls`);
  let rec = await D.getPollOtp(env.DB, p.id, member.id);
  assert.equal(rec.verified_at, "");
  assert.equal(rec.attempts, 1);

  // 맞는 번호 — 통과하고, 계정에도 확인이 쌓인다
  await post(env, j, `${B}/polls/${p.id}/otp/verify`, { code }, `${B}/polls`);
  rec = await D.getPollOtp(env.DB, p.id, member.id);
  assert.ok(rec.verified_at, "통과 기록");
  assert.equal((await D.getUserById(env.DB, member.id)).verified_how, "otp",
    "같은 사람에게 다음 안건에서 또 돈을 쓰지 않도록 계정에 남긴다");

  await post(env, j, `${B}/polls/${p.id}/vote`, { choice: "abstain" }, `${B}/polls`);
  assert.equal(await D.userVote(env.DB, p.id, member.id), "abstain");
  assert.equal((await D.listPollVotes(env.DB, p.id))[0].verify, "otp");

  // 마감 전 표를 바꿀 때 다시 인증번호를 요구하지 않는다 (요구하면 사람들은 그냥 둔다)
  await post(env, j, `${B}/polls/${p.id}/vote`, { choice: "yes" }, `${B}/polls`);
  assert.equal(await D.userVote(env.DB, p.id, member.id), "yes");
});

test("시도 횟수를 넘기면 더 받지 않는다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "정관", verify: 2, createdBy: null });
  const j = jar();
  await login(env, j, "boss@m.kr", "owner1234");
  const code = "131313";
  await D.upsertPollOtp(env.DB, { pollId: p.id, userId: member.id,
    codeHash: await sha256Hex(`pollotp|${p.id}|${member.id}|${code}`), phone: "01033334444" });
  for (let i = 0; i < D.OTP_MAX_ATTEMPTS; i++)
    await post(env, j, `${B}/polls/${p.id}/otp/verify`, { code: "111111" }, `${B}/polls`);
  // 이제 맞는 번호를 넣어도 통과하지 않는다
  const r = await post(env, j, `${B}/polls/${p.id}/otp/verify`, { code }, `${B}/polls`);
  assert.match(decodeURIComponent(r.headers.get("location") || ""), /시도 횟수/);
  assert.equal((await D.getPollOtp(env.DB, p.id, member.id)).verified_at, "");
});

test("모르는 등급 값을 보내면 확인 없음으로 떨어진다", async () => {
  const { env, a } = await setup();
  const j = jar();
  await login(env, j, "office@m.kr", "admin1234");
  await post(env, j, `${B}/admin/polls`, { title: "장난", verify: "9" }, `${B}/polls`);
  const [p] = await D.listPolls(env.DB, a.id);
  assert.equal(D.pollVerifyLevel(p), 0, "모르는 값은 0 — 없는 등급으로 문이 열려 있으면 안 된다");
});

test("자격 대장은 법정 본인확인이 아니라고 적는다", async () => {
  const { env, a, member } = await setup();
  const j = jar();
  await login(env, j, "office@m.kr", "admin1234");
  const h = await (await get(env, j, `${B}/admin/polls/verify`)).text();
  assert.match(h, /법이 정한 본인확인기관/, "아닌 것을 아니라고 적어야 한다");
  assert.match(h, /2명 중 0명 확인됨/, "총무 자신도 대장에 올라간다 — 없으면 자기 표가 막힌다");
  assert.ok(h.includes("김사장"));
  assert.ok(h.includes(`/admin/member/${member.id}/verify`), "확인 처리 단추");
});

test("남의 상인회 회원을 확인 처리할 수 없다", async () => {
  const { env } = await setup();
  const other = await D.createAssociation(env.DB, { slug: "other", name: "다른 상인회", kind: "merchant" });
  const op = await hashPassword("x1234567");
  const stranger = await D.createUser(env.DB, { email: "x@o.kr", passwordHash: op.hash, salt: op.salt, name: "남", role: "MERCHANT", associationId: other.id });
  const j = jar();
  await login(env, j, "office@m.kr", "admin1234");
  await post(env, j, `${B}/admin/member/${stranger.id}/verify`, { on: "1" }, `${B}/admin/polls/verify`);
  assert.equal((await D.getUserById(env.DB, stranger.id)).verified_at, "", "경계를 넘지 못한다");
});
