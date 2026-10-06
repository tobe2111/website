// 단톡방에 링크 하나 — 명부 대조로 자격을 가리고, 비밀/공개를 안건마다 고른다.
//
// 지금까지 투표 링크는 사람마다 달랐다. 125곳이면 회장님이 문자를 125번 보내야 했고,
// 실제로는 그래서 안 보내셨다. 그렇다고 단톡방에 하나 올리면 그 링크가 곧 한 사람의 표라
// 아무나 남의 표를 누를 수 있었다 — 화면이 "단톡방에 올리지 마세요" 라고 경고하던 이유다.
//
// 그래서 링크에서 사람을 뺐다. 이 검사가 지키는 것은 셋이다.
//   ① 단톡방 링크로는 **곧바로 투표되지 않는다** — 명부 대조를 통과해야 표가 열린다
//   ② 명부와 맞지 않으면 **무엇이 틀렸는지 알려 주지 않는다** (번호를 찍는 길잡이가 된다)
//   ③ 비밀투표에서는 누가 무엇을 골랐는지가 **데이터에도, 종이에도** 남지 않는다
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword, sha256Hex } from "../src/crypto.js";
import { makeRosterVoteToken, makeVoteToken } from "../src/api.js";

// 접속 주소를 검사마다 달리 준다. 틀린 횟수를 세는 자리는 **주소별**이고 그 셈은 워커
// 안의 메모리에 있어, 한 검사에서 일부러 열 번 틀리면 다음 검사의 로그인까지 잠긴다.
// (실제 운영에서도 같은 성질이다 — 한 사무실에서 여럿이 틀리면 함께 잠긴다)
let ipN = 0;
const jar = () => ({ c: {}, ip: `10.0.0.${++ipN}` });
const ch = (j) => Object.entries(j.c).map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (j, r) => { for (const s of r.headers.getSetCookie?.() || []) { const kv = s.split(";")[0]; const i = kv.indexOf("="); j.c[kv.slice(0, i)] = kv.slice(i + 1); } };
const hdr = (j, more = {}) => ({ cookie: ch(j), "cf-connecting-ip": j.ip, ...more });
async function get(env, j, u) { const r = await worker.fetch(new Request(u, { headers: hdr(j) }), env); absorb(j, r); return r; }
async function post(env, j, u, f, csrfFrom) {
  const t = (/name="_csrf" value="([^"]+)"/.exec(await (await get(env, j, csrfFrom)).text()) || [])[1];
  const r = await worker.fetch(new Request(u, { method: "POST", headers: hdr(j, { "content-type": "application/x-www-form-urlencoded" }), body: new URLSearchParams({ _csrf: t, ...f }).toString() }), env);
  absorb(j, r); return r;
}
const B = "http://localhost/t/market";

async function setup() {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "market", name: "방배카페골목상인회", kind: "merchant" });
  const ad = await hashPassword("admin1234");
  const admin = await D.createUser(env.DB, { email: "office@m.kr", passwordHash: ad.hash, salt: ad.salt, name: "총무", role: "ADMIN", associationId: a.id });
  const mp = await hashPassword("owner1234");
  const member = await D.createUser(env.DB, { email: "boss@m.kr", passwordHash: mp.hash, salt: mp.salt, name: "김방배", role: "MERCHANT", associationId: a.id });
  await D.setUserPhone(env.DB, member.id, "01012345678");
  const biz = await D.createBusiness(env.DB, { associationId: a.id, ownerId: member.id, name: "버들카페", category: "카페" });
  await D.setBusinessStatus(env.DB, biz.id, "approved");
  return { env, a, admin, member, biz };
}
const linkOf = async (env, a, p) => `${B}/vote/g/${encodeURIComponent(await makeRosterVoteToken(env.SESSION_SECRET, a.id, p.id))}`;

// ── ① 링크 자체로는 아무 표도 안 들어간다 ──────────────────────────────
test("단톡방 링크를 열면 투표 단추가 아니라 명부 대조 칸이 뜬다", async () => {
  const { env, a } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회비 인상", rosterLink: 1, createdBy: null });
  const h = await (await get(env, jar(), await linkOf(env, a, p))).text();
  assert.match(h, /name="shop"/, "가게 상호 칸이 있어야");
  assert.match(h, /name="last4"/, "전화번호 뒷 네 자리 칸이 있어야");
  assert.ok(!/name="choice"/.test(h), "링크만으로 찬반 단추가 뜨면 그게 곧 남의 표다");
});

test("켜지 않은 안건은 단톡방 링크로 열어도 투표되지 않는다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회식 날짜", createdBy: null });
  const url = await linkOf(env, a, p);
  const h = await (await get(env, jar(), url)).text();
  assert.match(h, /명부 대조로 투표하지 않습니다/);
  // 화면만이 아니라 처리 쪽에서도 막힌다 — 주소로 직접 보낸 요청이 진짜 막는 자리다
  const j = jar();
  await post(env, j, url, { shop: "버들카페", name: "김방배", last4: "5678" }, url);
  assert.equal(await D.userHasVoted(env.DB, p.id, member.id), false);
});

// ── ② 명부 대조 ────────────────────────────────────────────────────────
test("상호·성함·뒷 네 자리가 맞으면 그분의 표가 열린다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회비 인상", rosterLink: 1, createdBy: null });
  const url = await linkOf(env, a, p);
  const j = jar();
  const r = await post(env, j, url, { shop: "버들 카페", name: " 김방배 ", last4: "5678" }, url);
  assert.equal(r.status, 303, "맞으면 그 자리에서 표 화면으로 보낸다");
  const to = r.headers.get("location");
  assert.match(to, /\/vote\//, "표 링크로 가야");
  assert.ok(!/\/vote\/g\//.test(to), "다시 대조 화면으로 돌려보내면 안 된다");
  // 띄어쓰기가 달라도 같은 가게다 — '버들 카페' 로 막으면 그분은 다시 안 들어오신다
  const h = await (await get(env, j, "http://localhost" + to)).text();
  assert.match(h, /김방배/);
  assert.match(h, /name="choice"/, "이제는 찬반 단추가 떠야");
  await post(env, j, "http://localhost" + to, { choice: "yes" }, "http://localhost" + to);
  assert.equal(await D.userVote(env.DB, p.id, member.id), "yes");
  const [v] = await D.listPollVotes(env.DB, p.id);
  assert.equal(v.verify, "roster", "무엇으로 받은 표인지 의사록에 남아야");
});

test("하나라도 틀리면 무엇이 틀렸는지 알려 주지 않는다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회비 인상", rosterLink: 1, createdBy: null });
  const url = await linkOf(env, a, p);
  for (const bad of [
    { shop: "버들카페", name: "김방배", last4: "0000" },   // 번호만 틀림
    { shop: "없는가게", name: "김방배", last4: "5678" },   // 상호만 틀림
    { shop: "버들카페", name: "박서초", last4: "5678" },   // 성함만 틀림
  ]) {
    const r = await post(env, jar(), url, bad, url);
    const msg = decodeURIComponent(r.headers.get("location") || "");
    assert.match(msg, /명부와 맞지 않습니다/);
    assert.ok(!/번호|상호만|성함만/.test(msg.replace("전화번호 뒷 네 자리", "")),
      `어느 칸이 틀렸는지 말하면 번호를 찍는 길잡이가 된다: ${msg}`);
  }
  assert.equal(await D.userHasVoted(env.DB, p.id, member.id), false);
});

test("틀린 횟수를 세어 잠근다 — 뒷 네 자리는 만 가지뿐이다", async () => {
  const { env, a } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회비 인상", rosterLink: 1, createdBy: null });
  const url = await linkOf(env, a, p);
  const j = jar();                       // 같은 사람(같은 주소)이 계속 찍는 상황이다
  let last = "";
  for (let i = 0; i < 12; i++) {
    const r = await post(env, j, url, { shop: "버들카페", name: "김방배", last4: String(1000 + i) }, url);
    last = decodeURIComponent(r.headers.get("location") || "");
  }
  assert.match(last, /잠겼습니다|잠시 후/, `계속 받아 주면 끝까지 찍어 볼 수 있다: ${last}`);
  // 메모리의 셈만으로는 부족하다 — 워커가 내려갔다 떠도 남아 있어야 실제로 막은 것이다.
  const who = (await sha256Hex(`${env.SESSION_SECRET}|${j.ip}`)).slice(0, 32);
  assert.equal(await D.pollTriesLeft(env.DB, p.id, who), 0, "표에 적힌 횟수도 바닥나 있어야");
  // 맞는 값으로 들어오신 분은 그 셈이 지워진다 — 다음에 또 들어오셔야 하기 때문이다
  await D.clearPollTries(env.DB, p.id, who);
  assert.ok(await D.pollTriesLeft(env.DB, p.id, who) > 0);
});

test("마감된 안건은 명부가 맞아도 열리지 않는다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회비 인상", rosterLink: 1, createdBy: null });
  await D.closePoll(env.DB, p.id);
  const url = await linkOf(env, a, p);
  // 마감하면 화면에서 칸이 사라진다 — 토큰은 다른 화면에서 받아 '주소로 직접' 보낸다.
  // 화면이 아니라 처리 쪽에서 막히는지를 보는 검사이기 때문이다.
  const r = await post(env, jar(), url, { shop: "버들카페", name: "김방배", last4: "5678" }, `${B}/login`);
  assert.match(decodeURIComponent(r.headers.get("location") || ""), /마감/);
  assert.equal(await D.userHasVoted(env.DB, p.id, member.id), false);
});

// 확인 등급을 올려 둔 안건은 이 길로 열면 안 된다. 간판을 보면 아는 상호·성함과
// 번호 뒷자리로 통과시키면, 켜 둔 등급이 코드에만 있고 실제로는 없는 것이 된다.
test("확인 등급이 걸린 안건은 명부 대조로 열리지 않는다 — 명부 대조는 본인확인이 아니다", async () => {
  for (const [lv, word] of [[1, /본인확인을 마친/], [2, /인증번호/]]) {
    const { env, a, member } = await setup();
    const p = await D.createPoll(env.DB, { associationId: a.id, title: "임원 선출", verify: lv, rosterLink: 1, createdBy: null });
    const url = await linkOf(env, a, p);
    // 화면에 칸을 만들지 않는다 — 채우게 해 놓고 마지막에 막으면 그분은 전화를 거신다
    const h = await (await get(env, jar(), url)).text();
    assert.ok(!/name="last4"/.test(h), `등급 ${lv}: 칸을 만들면 안 된다`);
    assert.match(h, word);
    // 주소로 직접 보낸 요청도 막힌다 — 이쪽이 진짜 막는 자리다
    const r = await post(env, jar(), url, { shop: "버들카페", name: "김방배", last4: "5678" }, `${B}/login`);
    assert.match(decodeURIComponent(r.headers.get("location") || ""), word);
    assert.equal(await D.userHasVoted(env.DB, p.id, member.id), false);
  }
});

test("옆 상인회 명부로는 통과하지 못한다 (테넌트 격리)", async () => {
  const { env, a } = await setup();
  const b = await D.createAssociation(env.DB, { slug: "other", name: "옆동네상인회", kind: "merchant" });
  const op = await hashPassword("owner1234");
  const other = await D.createUser(env.DB, { email: "x@o.kr", passwordHash: op.hash, salt: op.salt, name: "이옆집", role: "MERCHANT", associationId: b.id });
  await D.setUserPhone(env.DB, other.id, "01099998888");
  await D.createBusiness(env.DB, { associationId: b.id, ownerId: other.id, name: "옆집분식", category: "음식점" });
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회비 인상", rosterLink: 1, createdBy: null });
  const url = await linkOf(env, a, p);
  const r = await post(env, jar(), url, { shop: "옆집분식", name: "이옆집", last4: "8888" }, url);
  assert.match(decodeURIComponent(r.headers.get("location") || ""), /명부와 맞지 않습니다/);
  assert.equal(await D.userHasVoted(env.DB, p.id, other.id), false);
});

test("명부 대조 링크를 사람 표 링크로 돌려 쓸 수 없다 (서명 문맥이 다르다)", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회비 인상", rosterLink: 1, createdBy: null });
  const group = await makeRosterVoteToken(env.SESSION_SECRET, a.id, p.id);
  const h = await (await get(env, jar(), `${B}/vote/${encodeURIComponent(group)}`)).text();
  assert.match(h, /링크가 만료되었습니다/);
  // 반대 방향도 마찬가지 — 사람 표 링크를 대조 화면에 넣어도 안 열린다
  const mine = await makeVoteToken(env.SESSION_SECRET, a.id, p.id, member.id);
  const h2 = await (await get(env, jar(), `${B}/vote/g/${encodeURIComponent(mine)}`)).text();
  assert.match(h2, /링크가 만료되었습니다/);
});

// ── ③ 비밀투표 ─────────────────────────────────────────────────────────
test("비밀투표는 누가 무엇을 골랐는지 데이터에 남지 않는다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "임원 신임", secret: 1, createdBy: null });
  const j = jar();
  await post(env, j, `${B}/login`, { email: "boss@m.kr", password: "owner1234" }, `${B}/login`);
  await post(env, j, `${B}/polls/${p.id}/vote`, { choice: "no" }, `${B}/polls`);

  // 넣으셨다는 것은 남는다 (1인 1표·미투표자 명단에 쓰인다)
  assert.equal(await D.userHasVoted(env.DB, p.id, member.id), true);
  // 무엇을 고르셨는지는 그 줄에 없다
  const [v] = await D.listPollVotes(env.DB, p.id);
  assert.equal(v.choice, "", "사람 줄에 선택이 적히면 그건 비밀투표가 아니다");
  // 숫자는 이름 없는 표에서 나온다
  const r = await D.pollResults(env.DB, p.id, p);
  assert.deepEqual({ yes: r.yes, no: r.no, abstain: r.abstain, total: r.total }, { yes: 0, no: 1, abstain: 0, total: 1 });
});

test("비밀투표는 한 번 넣으면 바꿀 수 없다 — 바꾸려면 지난 표를 찾아야 하기 때문이다", async () => {
  const { env, a } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "임원 신임", secret: 1, createdBy: null });
  const j = jar();
  await post(env, j, `${B}/login`, { email: "boss@m.kr", password: "owner1234" }, `${B}/login`);
  await post(env, j, `${B}/polls/${p.id}/vote`, { choice: "yes" }, `${B}/polls`);
  const r = await post(env, j, `${B}/polls/${p.id}/vote`, { choice: "no" }, `${B}/polls`);
  assert.match(decodeURIComponent(r.headers.get("location") || ""), /이미 투표하셨습니다/);
  const res = await D.pollResults(env.DB, p.id, p);
  assert.deepEqual({ yes: res.yes, no: res.no, total: res.total }, { yes: 1, no: 0, total: 1 },
    "두 번째 누름이 표를 덮어쓰거나 한 표를 더 만들면 안 된다");
});

test("비밀 안건의 의사록에는 '선택' 칸이 아예 없다", async () => {
  const { env, a } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "임원 신임", secret: 1, createdBy: null });
  const j = jar();
  await post(env, j, `${B}/login`, { email: "boss@m.kr", password: "owner1234" }, `${B}/login`);
  await post(env, j, `${B}/polls/${p.id}/vote`, { choice: "yes" }, `${B}/polls`);
  const aj = jar();
  await post(env, aj, `${B}/login`, { email: "office@m.kr", password: "admin1234" }, `${B}/login`);
  const h = await (await get(env, aj, `${B}/admin/polls/${p.id}/minutes`)).text();
  assert.match(h, /투표 참여자 명단/, "명세가 아니라 참여자 명단이어야");
  assert.ok(!/mn-ch-yes/.test(h), "누가 무엇을 골랐는지 칸이 있으면 비밀투표가 아니다");
  assert.match(h, /찬성<\/th>\s*<td class="mn-num">1표/, "찬반 숫자는 그대로 나와야");
  // 파일로 받아도 마찬가지다
  const csv = await (await get(env, aj, `${B}/admin/polls/${p.id}/minutes.csv`)).text();
  assert.match(csv, /비밀투표라 비움/);
  assert.ok(!/찬성/.test(csv.split("\r\n").slice(1).join("\r\n")), "줄에 선택이 적히면 안 된다");
});

test("표가 들어온 뒤에는 비밀/공개를 바꿀 수 없다", async () => {
  const { env, a } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "임원 신임", secret: 1, createdBy: null });
  const j = jar();
  await post(env, j, `${B}/login`, { email: "boss@m.kr", password: "owner1234" }, `${B}/login`);
  await post(env, j, `${B}/polls/${p.id}/vote`, { choice: "yes" }, `${B}/polls`);
  const aj = jar();
  await post(env, aj, `${B}/login`, { email: "office@m.kr", password: "admin1234" }, `${B}/login`);
  // 공개로 되돌리려 해도 — 이미 이름 없이 적힌 표에 이름을 붙일 길이 없다
  const r = await post(env, aj, `${B}/admin/polls/${p.id}`, { title: "임원 신임" }, `${B}/polls`);
  assert.match(decodeURIComponent(r.headers.get("location") || ""), /비밀\/공개는 그대로/);
  assert.equal(D.pollIsSecret(await D.getPoll(env.DB, p.id)), true);
});

// 비밀 안건에서 '누가 아직 안 넣으셨나' 는 그대로 보여야 한다. 안 보이면 총무가
// 다 넣으신 분들께까지 전화를 돌리게 되고, 그러면 그 기능은 쓰이지 않는다.
test("비밀 안건에서도 누가 넣으셨는지는 보인다 (무엇을 골랐는지만 없다)", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "임원 신임", secret: 1, createdBy: null });
  await D.castSecretVote(env.DB, p.id, member.id, "yes", "roster");
  const rows = await D.listPollRecipients(env.DB, p.id, a.id);
  const me = rows.find((r) => r.id === member.id);
  assert.ok(me.voted, "넣으셨다는 것은 보여야");
  assert.equal(me.choice, "", "무엇을 고르셨는지는 보이면 안 된다");
  const left = await D.listPollNonVoters(env.DB, p.id, a.id);
  assert.ok(!left.some((r) => r.id === member.id), "넣으신 분이 미투표자 명단에 남으면 안 된다");

  const aj = jar();
  await post(env, aj, `${B}/login`, { email: "office@m.kr", password: "admin1234" }, `${B}/login`);
  const h = await (await get(env, aj, `${B}/admin/polls/${p.id}/links`)).text();
  assert.match(h, /2명 중 1명 투표함/, "비밀이라고 참여 인원까지 0으로 보이면 전화를 다시 돌리게 된다");
  assert.ok(!/badge-ok">찬성/.test(h), "표 칸에 선택이 뜨면 비밀투표가 아니다");
});

test("공개투표는 예전 그대로다 — 바꿀 수 있고, 명세에 이름과 선택이 함께 적힌다", async () => {
  const { env, a, member } = await setup();
  const p = await D.createPoll(env.DB, { associationId: a.id, title: "회식 날짜", createdBy: null });
  assert.equal(D.pollIsSecret(p), false, "기본값은 공개투표");
  const j = jar();
  await post(env, j, `${B}/login`, { email: "boss@m.kr", password: "owner1234" }, `${B}/login`);
  await post(env, j, `${B}/polls/${p.id}/vote`, { choice: "yes" }, `${B}/polls`);
  await post(env, j, `${B}/polls/${p.id}/vote`, { choice: "no" }, `${B}/polls`);
  assert.equal(await D.userVote(env.DB, p.id, member.id), "no", "마감 전에는 바꿀 수 있다");
  const r = await D.pollResults(env.DB, p.id, p);
  assert.deepEqual({ yes: r.yes, no: r.no, total: r.total }, { yes: 0, no: 1, total: 1 });
});
