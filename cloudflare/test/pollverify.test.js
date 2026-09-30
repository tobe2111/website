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

// ── 의사록에 붙이는 종이 ────────────────────────────────────────
// 화면에 합계만 있으면 총무는 그걸 손으로 옮겨 적는다. 옮겨 적는 순간 그 숫자는
// 근거가 아니라 주장이 된다. 그래서 사람별 명세가 종이에 그대로 나와야 한다.
async function votedPoll(env, a, opts = {}) {
  const { n = 3, verify = 0 } = opts;
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "정관 제12조 개정", body: "임원 임기를 2년으로", verify, createdBy: null });
  const made = [];
  for (let i = 1; i <= n; i++) {
    const pw = await hashPassword("owner1234");
    const u = await D.createUser(env.DB, { email: `m${i}@m.kr`, passwordHash: pw.hash, salt: pw.salt, name: `사장${i}`, role: "MERCHANT", associationId: a.id });
    await D.setUserPhone(env.DB, u.id, `0102000${String(1000 + i)}`);
    made.push(u);
  }
  return { p, made };
}

test("의사록: 사람마다 무엇에 투표했고 어떻게 확인됐는지가 줄로 나온다", async () => {
  const { env, a } = await setup();
  const { p, made } = await votedPoll(env, a, { n: 3 });
  await D.setUserVerified(env.DB, made[0].id, "kakao");
  await D.setUserVerified(env.DB, made[1].id, "otp");
  await D.votePoll(env.DB, p.id, made[0].id, "yes", "kakao");
  await D.votePoll(env.DB, p.id, made[1].id, "no", "otp");
  // 셋째는 투표하지 않는다 — 미투표자 명단에 이름과 번호가 있어야 한다

  const j = jar();
  await login(env, j, "office@m.kr", "admin1234");
  const h = await (await get(env, j, `${B}/admin/polls/${p.id}/minutes`)).text();

  // ① 사람별 명세
  assert.ok(h.includes("사장1") && h.includes("사장2"), "투표한 사람 이름");
  assert.match(h, /카카오 연결/, "무엇으로 확인된 표인지");
  assert.match(h, /휴대폰 인증번호/);
  assert.ok(h.includes("찬성") && h.includes("반대"));

  // ② 미투표자는 전화번호까지 — 총무가 전화를 돌릴 종이다
  assert.ok(h.includes("사장3"), "미투표자 이름");
  assert.match(h, /010-2000-1003/, "전화번호가 있어야 전화를 걸 수 있다");
  assert.match(h, /아직 투표하지 않은 분/);

  // ③ 과반 계산 — 반올림하지 않는다
  assert.match(h, /투표권자/);
  assert.match(h, /참여자 과반/);
  assert.match(h, /투표권자 과반/);

  // ④ 법정 본인확인이 아니라는 고지가 종이에도 있다
  assert.match(h, /법이 정한 본인확인기관/);
  // ⑤ 가결 여부를 우리가 정하지 않는다 — 정관이 정한다고 적는다
  assert.match(h, /정관이 정한 기준/);
});

test("의사록: 과반은 '넘는 것' 이다 — 4명 중 2표는 과반이 아니다", async () => {
  const { env, a } = await setup();
  const { p, made } = await votedPoll(env, a, { n: 4 });
  // 넷 다 투표하고 둘만 찬성 → 딱 절반. 반올림하면 과반이 되어 부결이 가결로 바뀐다.
  await D.votePoll(env.DB, p.id, made[0].id, "yes", "admin");
  await D.votePoll(env.DB, p.id, made[1].id, "yes", "admin");
  await D.votePoll(env.DB, p.id, made[2].id, "no", "admin");
  await D.votePoll(env.DB, p.id, made[3].id, "abstain", "admin");
  const j = jar();
  await login(env, j, "office@m.kr", "admin1234");
  const h = await (await get(env, j, `${B}/admin/polls/${p.id}/minutes`)).text();
  const line = /참여자 과반<\/th><td>[^<]*<b>([^<]+)<\/b>/.exec(h);
  assert.ok(line, "참여자 과반 줄");
  assert.equal(line[1], "넘지 못했습니다", "4명 중 2표는 과반이 아니다");
});

test("의사록: 장이 넘어가도 장마다 안건 이름이 다시 붙는다", async () => {
  const { env, a } = await setup();
  const { p, made } = await votedPoll(env, a, { n: 20 });
  for (const u of made) await D.votePoll(env.DB, p.id, u.id, "yes", "admin");
  const j = jar();
  await login(env, j, "office@m.kr", "admin1234");
  const h = await (await get(env, j, `${B}/admin/polls/${p.id}/minutes`)).text();
  // 결의서 1장 + 명세 2장(18줄 + 2줄). 미투표자는 총무뿐이라 1장.
  const sheets = (h.match(/class="paper mn-paper"/g) || []).length;
  assert.equal(sheets, 4, `결의서1 + 명세2 + 미투표1 = 4장 (실제 ${sheets})`);
  // 장마다 머리가 다시 얹힌다
  assert.equal((h.match(/정관 제12조 개정/g) || []).length, 4);
  assert.match(h, /2 \/ 2 장/, "명세 둘째 장");
});

test("의사록: 마감하지 않은 안건은 숫자가 바뀔 수 있다고 적는다", async () => {
  const { env, a } = await setup();
  const { p } = await votedPoll(env, a, { n: 1 });
  const j = jar();
  await login(env, j, "office@m.kr", "admin1234");
  let h = await (await get(env, j, `${B}/admin/polls/${p.id}/minutes`)).text();
  assert.match(h, /마감하지 않은/, "진행 중이면 경고");
  await D.closePoll(env.DB, p.id);
  h = await (await get(env, j, `${B}/admin/polls/${p.id}/minutes`)).text();
  assert.doesNotMatch(h, /마감하지 않은/, "마감하면 경고가 사라진다");
});

test("의사록 파일: 투표와 미투표가 한 파일에 담긴다", async () => {
  const { env, a } = await setup();
  const { p, made } = await votedPoll(env, a, { n: 2 });
  await D.votePoll(env.DB, p.id, made[0].id, "yes", "kakao");
  const j = jar();
  await login(env, j, "office@m.kr", "admin1234");
  const r = await get(env, j, `${B}/admin/polls/${p.id}/minutes.csv`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /text\/csv/);
  assert.match(r.headers.get("content-disposition") || "", /attachment/);
  const csv = await r.text();
  assert.match(csv, /구분,연번,성명/);
  assert.match(csv, /투표,1,사장1,,찬성,카카오 연결/);
  assert.match(csv, /미투표,.*사장2/, "안 넣은 사람도 같은 파일에");
});

test("남의 상인회 안건의 의사록은 열리지 않는다", async () => {
  const { env } = await setup();
  const other = await D.createAssociation(env.DB, { slug: "other", name: "다른 상인회", kind: "merchant" });
  const op = await D.createPoll(env.DB, { associationId: other.id, title: "남의 안건", createdBy: null });
  const j = jar();
  await login(env, j, "office@m.kr", "admin1234");
  assert.equal((await get(env, j, `${B}/admin/polls/${op.id}/minutes`)).status, 404);
  assert.equal((await get(env, j, `${B}/admin/polls/${op.id}/minutes.csv`)).status, 404);
});

test("투표 화면이 카톡에 붙일 안내문과 링크를 만들어 준다 (0원)", async () => {
  const { env, a } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회비 인상", closesAt: "2026-10-15", createdBy: null });
  const j = jar();
  await login(env, j, "office@m.kr", "admin1234");
  const h = await (await get(env, j, `${B}/polls`)).text();
  assert.match(h, /회원에게 알리기/);
  assert.match(h, /안건 투표 안내/, "보낼 글");
  assert.match(h, /2026-10-15/, "마감일이 글에 들어간다");
  assert.ok(h.includes("/t/market/polls"), "투표 링크가 글에 들어간다");
  assert.match(h, /data-copy=/, "복사 단추");
  assert.match(h, /href="sms:/, "문자로 보내기");
  assert.ok(h.includes(`/admin/polls/${p.id}/minutes`), "의사록으로 가는 길");
});

// ── 투표 링크 — 로그인 없이 한 표 ───────────────────────────────
// 이 링크는 **가지고 있으면 쓸 수 있는 열쇠**다. 그래서 검사가 지켜야 할 것은
// "된다" 가 아니라 **"딱 그것만 된다"** 이다. 다른 안건·다른 사람·다른 화면으로
// 새어 나가면, 총회 표결이 링크 하나 유출로 무너진다.
import { makeVoteToken, verifyVoteToken, makePhotoToken } from "../src/api.js";

async function linkFor(env, a, pollId, userId) {
  return `${B}/vote/${encodeURIComponent(await makeVoteToken(env.SESSION_SECRET, a.id, pollId, userId))}`;
}
// 로그인하지 않은 브라우저 — 링크만 들고 온 사람이다
async function postNoLogin(env, url, fields) {
  const j = jar();
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, url)).text()) || [])[1];
  return worker.fetch(new Request(url, { method: "POST",
    headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: t, ...fields }).toString() }), env);
}

test("링크: 로그인 없이 들어와 한 표를 넣는다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회비 인상", createdBy: null });
  const url = await linkFor(env, a, p.id, member.id);

  const h = await (await get(env, jar(), url)).text();
  assert.match(h, /회비 인상/);
  assert.match(h, /김사장/, "누구로 투표하는지 먼저 보여 준다");
  assert.match(h, /단톡방에 올리지/, "넘기면 안 된다는 경고");

  await postNoLogin(env, url, { choice: "yes" });
  assert.equal(await D.userVote(env.DB, p.id, member.id), "yes");
  // 표에는 '문자 링크' 로 적힌다 — 의사록에서 카카오·인증번호 표와 구별되어야 한다
  assert.equal((await D.listPollVotes(env.DB, p.id))[0].verify, "link");

  // 마감 전에는 바꿀 수 있다
  await postNoLogin(env, url, { choice: "no" });
  assert.equal(await D.userVote(env.DB, p.id, member.id), "no");
});

test("링크: 로그인이 되는 것이 아니다 — 다른 화면은 안 열린다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "안건", createdBy: null });
  const url = await linkFor(env, a, p.id, member.id);
  const j = jar();
  await get(env, j, url);
  await worker.fetch(new Request(url, { method: "POST", headers: { cookie: ch(j), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, url)).text()) || [])[1], choice: "yes" }).toString() }), env);
  // 쿠키 병에 세션이 들어오지 않았어야 한다
  assert.ok(!Object.keys(j.c).some((k) => /sess/i.test(k)), "세션 쿠키를 심지 않는다");
  // 그리고 회원 화면은 로그인으로 튕긴다
  const r = await get(env, j, `${B}/board`);
  assert.ok(r.status === 302 || r.status === 303, "게시판은 안 열린다");
  assert.match(r.headers.get("location") || "", /login/);
});

test("링크: 다른 안건·다른 사람으로 돌려 쓸 수 없다", async () => {
  const { env, a, member } = await setup();
  const p1 = await D.createPoll(env.DB, { associationId: a.id, title: "안건1", createdBy: null });
  const p2 = await D.createPoll(env.DB, { associationId: a.id, title: "안건2", createdBy: null });
  const url1 = await linkFor(env, a, p1.id, member.id);

  // ① 서명 안의 안건 번호를 고쳐도 서명이 깨진다
  const raw = decodeURIComponent(url1.split("/vote/")[1]);
  const [data, sig] = raw.split(".");
  const body = JSON.parse(Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  body.p = p2.id;
  const forged = Buffer.from(JSON.stringify(body)).toString("base64url") + "." + sig;
  assert.equal(await verifyVoteToken(env.SESSION_SECRET, forged, a.id), null, "고친 토큰은 받지 않는다");
  await postNoLogin(env, `${B}/vote/${encodeURIComponent(forged)}`, { choice: "yes" });
  assert.equal(await D.userVote(env.DB, p2.id, member.id), null, "다른 안건에 표가 들어가면 안 된다");

  // ② 사진 요청 링크를 투표 링크로 쓸 수 없다 (서명 문맥이 다르다)
  const photo = await makePhotoToken(env.SESSION_SECRET, a.id, 1);
  assert.equal(await verifyVoteToken(env.SESSION_SECRET, photo, a.id), null);

  // ③ 남의 상인회에서 만든 토큰은 통하지 않는다
  const other = await D.createAssociation(env.DB, { slug: "other", name: "다른 상인회", kind: "merchant" });
  const cross = await makeVoteToken(env.SESSION_SECRET, other.id, p1.id, member.id);
  assert.equal(await verifyVoteToken(env.SESSION_SECRET, cross, a.id), null);
});

test("링크: 인증번호 등급 안건은 링크로 통과시키지 않는다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "정관 개정", verify: 2, createdBy: null });
  const url = await linkFor(env, a, p.id, member.id);
  const h = await (await get(env, jar(), url)).text();
  assert.match(h, /휴대폰 인증번호/, "왜 안 되는지 적는다");
  assert.ok(!/name="choice"/.test(h), "단추를 만들지 않는다");
  // 주소로 직접 보내도 막힌다 — 이쪽이 진짜 막는 자리다
  await postNoLogin(env, url, { choice: "yes" });
  assert.equal(await D.userVote(env.DB, p.id, member.id), null);
});

test("링크: 계정에 본인확인 표시를 붙이지 않는다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "안건", createdBy: null });
  await postNoLogin(env, await linkFor(env, a, p.id, member.id), { choice: "yes" });
  // 링크를 받았다는 것은 그 사람이라는 증명이 아니다 — 넘길 수 있는 물건이다
  assert.equal((await D.getUserById(env.DB, member.id)).verified_at, "",
    "링크로 계정 확인이 붙으면 다음 안건에서 더 센 등급을 통과해 버린다");
});

test("링크: 확인된 계정만 투표하는 등급은 링크로 통과한다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회비", verify: 1, createdBy: null });
  // 관리자가 그 사람 번호로 링크를 보낸 것이므로 '관리자 확인' 과 같은 무게로 본다
  await postNoLogin(env, await linkFor(env, a, p.id, member.id), { choice: "abstain" });
  assert.equal(await D.userVote(env.DB, p.id, member.id), "abstain");
});

test("링크 보내기 화면: 사람마다 다른 링크와 문자 단추가 선다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회비 인상", closesAt: "2026-10-15", createdBy: null });
  const j = jar();
  await login(env, j, "office@m.kr", "admin1234");
  const h = await (await get(env, j, `${B}/admin/polls/${p.id}/links`)).text();
  assert.match(h, /단톡방에 올리지 마세요/, "한 링크가 한 사람의 표라는 경고");
  assert.match(h, /href="sms:01033334444/, "그분 번호로 문자 앱을 연다");
  assert.ok(h.includes("/vote/"), "링크가 글에 들어 있다");
  assert.match(h, /2명 중 0명 투표함/);
  // 투표하면 그 줄이 바뀐다
  await postNoLogin(env, await linkFor(env, a, p.id, member.id), { choice: "yes" });
  const h2 = await (await get(env, j, `${B}/admin/polls/${p.id}/links`)).text();
  assert.match(h2, /2명 중 1명 투표함/);
});

test("의사록: 문자 링크로 들어온 표는 그렇게 적히고, 약하다고 적는다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회비", createdBy: null });
  await postNoLogin(env, await linkFor(env, a, p.id, member.id), { choice: "yes" });
  const j = jar();
  await login(env, j, "office@m.kr", "admin1234");
  const h = await (await get(env, j, `${B}/admin/polls/${p.id}/minutes`)).text();
  assert.match(h, /문자로 보낸 링크로 투표/, "결의서 내역에 따로 센다");
  assert.match(h, /문자 링크/, "명세의 본인확인 칸");
  assert.match(h, /가장 약합니다/, "약한 근거라고 적어야 의사록을 읽는 사람이 판단한다");
});
