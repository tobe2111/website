// 데모 콘텐츠 채우기 검증 — 슈퍼 콘솔 버튼 → 공개 페이지에 실제로 반영되는지.
// 실행: node --experimental-sqlite --test cloudflare/test/*.test.js
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";

const BASE = "http://localhost";
const SLUG = "리스터코퍼레이션";
const T = "/t/" + encodeURIComponent(SLUG);
let env, assoc, cookie, token;

const req = (method, path, { cookie = "", body = null } = {}) => {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let init = { method, headers };
  if (body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    headers.origin = BASE;
    init.body = new URLSearchParams(body);
  }
  return worker.fetch(new Request(BASE + path, init), env, { waitUntil() {}, passThroughOnException() {} });
};

function db() { return env.DB; }

before(async () => {
  env = makeEnv();
  assoc = await D.createAssociation(db(), { slug: SLUG, name: SLUG });
  const pw = await hashPassword("super1234");
  await D.createUser(db(), { email: "super@platform.kr", passwordHash: pw.hash, salt: pw.salt, name: "운영자", role: "SUPERADMIN", associationId: null });

  const g = await req("GET", "/login");
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  token = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const r = await req("POST", "/login", { cookie: seed, body: { _csrf: token, email: "super@platform.kr", password: "super1234" } });
  assert.equal(r.status, 303, "슈퍼 관리자 로그인");
  cookie = [seed, ...(r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");
});

test("슈퍼 콘솔에 '데모 채우기' 버튼이 있다", async () => {
  const r = await req("GET", "/super", { cookie });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /데모 채우기/);
});

test("채우기 전에는 '데모 미적용'으로 보인다", async () => {
  const r = await req("GET", "/super", { cookie });
  const html = await r.text();
  assert.match(html, /데모 미적용/, "아직 안 채운 상인회는 그렇게 표시돼야 함");
  assert.doesNotMatch(html, /데모 적용 \d/, "채운 적 없는데 시각이 뜨면 안 됨");
});

test("데모 채우기는 슈퍼 관리자만 실행할 수 있다", async () => {
  const r = await req("POST", `/super/association/${assoc.id}/demo`, { body: { _csrf: token } });
  assert.notEqual(r.status, 303, "비로그인 요청이 통과하면 안 됨");
});

test("버튼을 누르면 콘텐츠가 채워지고 공개 페이지에 나온다", async () => {
  const r = await req("POST", `/super/association/${assoc.id}/demo`, { cookie, body: { _csrf: token } });
  assert.equal(r.status, 303, "리다이렉트");

  const counts = db()._db.prepare(`SELECT
    (SELECT COUNT(*) FROM businesses WHERE association_id=? AND status='approved') b,
    (SELECT COUNT(*) FROM products WHERE association_id=?) p,
    (SELECT COUNT(*) FROM notices WHERE association_id=?) n,
    (SELECT COUNT(*) FROM events WHERE association_id=?) e,
    (SELECT COUNT(*) FROM posts WHERE association_id=?) po,
    (SELECT COUNT(*) FROM users WHERE association_id=? AND role='MERCHANT') u`)
    .get(assoc.id, assoc.id, assoc.id, assoc.id, assoc.id, assoc.id);
  assert.equal(counts.b, 25, "승인된 점포 25곳");
  assert.ok(counts.p >= 55, "메뉴 55개 이상");
  assert.equal(counts.n, 6, "공지 6건");
  assert.equal(counts.e, 3, "행사 3건");
  assert.equal(counts.po, 4, "게시글 4개");
  assert.equal(counts.u, 28, "사장님 계정 28개 (승인 25 + 신청 3)");

  const home = await req("GET", T);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /고을돼지국밥/, "점포가 홈에 노출");
  assert.match(html, /정기총회/, "공지가 홈에 노출");
  assert.match(html, /야시장/, "행사가 홈에 노출");
  assert.match(html, /골목마다 사람이 있고/, "상인회 태그라인 반영");
});

test("채우고 나면 슈퍼 콘솔에 적용 시각이 남는다", async () => {
  const r = await req("GET", "/super", { cookie });
  const html = await r.text();
  assert.match(html, /✓ 데모 적용 \d{2}-\d{2} \d{2}:\d{2}/, "언제 채웠는지 보여야 누른 걸 알 수 있음");
  assert.match(html, /데모 다시 채우기/, "이미 채운 곳은 버튼 문구도 바뀌어야 함");
});

test("행사는 항상 미래 날짜라 '다가오는 행사'에 남는다", () => {
  const today = new Date().toISOString().slice(0, 10);
  const past = db()._db.prepare(`SELECT COUNT(*) n FROM events WHERE association_id=? AND event_date < ?`).get(assoc.id, today);
  assert.equal(past.n, 0, "지난 행사가 없어야 함");
});

test("공개 페이지가 모두 200 으로 뜬다", async () => {
  for (const path of [T, T + "/businesses", T + "/map", T + "/notices", T + "/events", T + "/business/goeul-gukbap"]) {
    const r = await req("GET", path);
    assert.equal(r.status, 200, path);
  }
});

test("두 번 눌러도 데이터가 중복되지 않는다", async () => {
  const r = await req("POST", `/super/association/${assoc.id}/demo`, { cookie, body: { _csrf: token } });
  assert.equal(r.status, 303);
  const n = db()._db.prepare(`SELECT
    (SELECT COUNT(*) FROM businesses WHERE association_id=?) b,
    (SELECT COUNT(*) FROM notices WHERE association_id=?) n,
    (SELECT COUNT(*) FROM users WHERE association_id=? AND role='MERCHANT') u`).get(assoc.id, assoc.id, assoc.id);
  assert.equal(n.b, 28, "점포가 28곳 그대로 (승인 25 + 신청 3)");
  assert.equal(n.n, 6, "공지가 6건 그대로");
  assert.equal(n.u, 28, "사장님 계정이 28개 그대로");
});

test("투표에 실제 표가 들어가 결과 막대가 채워진다", async () => {
  const r = await req("GET", T + "/polls", { cookie });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /찬성 <b>13표<\/b>/, "진행 중 안건 찬성 13표");
  assert.match(html, /총 19명 참여/, "진행 중 안건 참여 19명");
  assert.match(html, /총 22명 참여/, "마감된 안건 참여 22명");
  assert.doesNotMatch(html, /총 0명 참여/, "0표짜리 빈 안건이 남아 있으면 안 됨");
});

test("데모 계정은 진행 중인 안건에 아직 투표하지 않았다", () => {
  const open = db()._db.prepare(`SELECT id FROM polls WHERE association_id=? AND closed=0`).get(assoc.id);
  const me = db()._db.prepare(`SELECT id FROM users WHERE email='owner1@demo.kr'`).get();
  const v = db()._db.prepare(`SELECT COUNT(*) n FROM poll_votes WHERE poll_id=? AND user_id=?`).get(open.id, me.id);
  assert.equal(v.n, 0, "시연 중에 직접 눌러 볼 수 있어야 함");
});

test("행사 참가·회비·승인 대기가 채워진다", async () => {
  const n = db()._db.prepare(`SELECT
    (SELECT COUNT(*) FROM event_rsvps WHERE association_id=?) r,
    (SELECT COUNT(*) FROM dues WHERE association_id=?) d,
    (SELECT COUNT(DISTINCT period) FROM dues WHERE association_id=?) dp,
    (SELECT COUNT(*) FROM businesses WHERE association_id=? AND status='pending') pend,
    (SELECT COUNT(*) FROM businesses WHERE association_id=? AND status='rejected') rej,
    (SELECT COUNT(*) FROM audit_log WHERE association_id=?) a`)
    .get(assoc.id, assoc.id, assoc.id, assoc.id, assoc.id, assoc.id);
  assert.equal(n.r, 43, "행사 참가 신청 43건");
  assert.equal(n.d, 68, "회비 납부 기록 68건");
  assert.equal(n.dp, 3, "회비는 최근 3개월치");
  assert.equal(n.pend, 2, "승인 대기 2곳");
  assert.equal(n.rej, 1, "반려 1곳");
  assert.ok(n.a >= 8, "감사 로그가 남아 있어야 함");
});

test("승인 대기 점포는 공개 목록에 나오지 않는다", async () => {
  const r = await req("GET", T + "/businesses");
  const html = await r.text();
  assert.doesNotMatch(html, /모둠분식/, "승인 전 점포가 손님 화면에 노출되면 안 됨");
  assert.doesNotMatch(html, /에스씨마케팅/, "반려된 점포가 노출되면 안 됨");
});

test("관리자 화면에 승인 대기·회비·참가 현황이 보인다", async () => {
  const r = await req("GET", T + "/admin", { cookie });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /모둠분식/, "승인 대기 점포");
  assert.match(html, /참가 15곳/, "행사 참가 인원");
  assert.match(html, /19\/28 납부/, "회비 장부 현황");
  assert.doesNotMatch(html, /셀프 등록률<\/span><span class="stat-num">100%/, "계측이 전부 100% 면 지표 구실을 못 함");
});

// ── 전자서명: 데이터만 밀어 넣은 게 아니라 실제 봉인 절차를 탔는지
import { verifySignature, contentHash } from "../src/esign.js";

test("전자서명 문서와 서명이 채워진다", async () => {
  const docs = db()._db.prepare(`SELECT * FROM documents WHERE association_id=? ORDER BY id`).all(assoc.id);
  assert.equal(docs.length, 3, "문서 3건");
  assert.ok(docs.some((d) => d.ordered === 1), "순차 서명 문서가 있다");
  assert.ok(docs.some((d) => d.closed === 1), "마감된 문서가 있다");
  const n = db()._db.prepare(`SELECT
    (SELECT COUNT(*) FROM signatures WHERE document_id IN (SELECT id FROM documents WHERE association_id=?)) s,
    (SELECT COUNT(*) FROM signature_requests WHERE document_id IN (SELECT id FROM documents WHERE association_id=?)) r`)
    .get(assoc.id, assoc.id);
  assert.equal(n.s, 17, "서명 17건");
  assert.equal(n.r, 24, "서명 요청 24건");
});

test("모든 데모 서명이 봉인 검증을 통과한다", async () => {
  const docs = db()._db.prepare(`SELECT * FROM documents WHERE association_id=?`).all(assoc.id);
  for (const d of docs) {
    assert.equal(await contentHash(d.body), d.content_hash, `본문 해시가 맞아야 함: ${d.title}`);
    const sigs = db()._db.prepare(`SELECT * FROM signatures WHERE document_id=?`).all(d.id);
    for (const s of sigs) {
      const v = await verifySignature(env, s, d);
      assert.equal(v.sealOk, true, `봉인 무결: ${d.title} / ${s.signer_name}`);
      assert.equal(v.contentOk, true, `본문 무결: ${d.title} / ${s.signer_name}`);
      assert.equal(v.valid, true, `${d.title} / ${s.signer_name}`);
    }
  }
});

test("본문이 한 글자라도 바뀌면 검증이 깨진다", async () => {
  const d = db()._db.prepare(`SELECT * FROM documents WHERE association_id=? LIMIT 1`).get(assoc.id);
  const s = db()._db.prepare(`SELECT * FROM signatures WHERE document_id=? LIMIT 1`).get(d.id);
  const v = await verifySignature(env, s, { ...d, body: d.body + " " });
  assert.equal(v.contentOk, false, "위조된 본문은 통과하면 안 됨");
  assert.equal(v.valid, false);
});

test("검증 코드 페이지가 '유효'로 뜬다", async () => {
  const s = db()._db.prepare(`SELECT s.* FROM signatures s JOIN documents d ON d.id=s.document_id
    WHERE d.association_id=? LIMIT 1`).get(assoc.id);
  const r = await req("GET", "/verify/" + s.verify_code);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /유효/, "검증 결과가 유효로 표시");
  assert.match(html, new RegExp(s.signer_name), "서명자 이름 표시");
});

test("데모 사장님 계정에 서명할 문서가 남아 있다", async () => {
  const g = await req("GET", "/login");
  const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
  const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const lr = await req("POST", "/login", { cookie: seed, body: { _csrf: tk, email: "owner1@demo.kr", password: "demo1234" } });
  assert.equal(lr.status, 303, "데모 계정 로그인");
  const jar = [seed, ...(lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");

  const r = await req("GET", T + "/sign", { cookie: jar });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /서명 필요/, "서명할 문서가 남아 있어야 시연이 됨");
  assert.match(html, /야시장 공동 운영 동의서/);
  assert.match(html, /서명 완료/, "이미 서명한 내역도 보여야 함");
});

test("관리자 문서 화면에 서명 현황과 이미지가 나온다", async () => {
  const list = await req("GET", T + "/admin/documents", { cookie });
  assert.equal(list.status, 200);
  assert.match(await list.text(), /여름 골목 야시장 공동 운영 동의서/);

  const d = db()._db.prepare(`SELECT id FROM documents WHERE association_id=? AND ordered=1`).get(assoc.id);
  const detail = await req("GET", T + "/admin/documents/" + d.id, { cookie });
  assert.equal(detail.status, 200);
  const html = await detail.text();
  assert.match(html, /3\/5/, "순차 문서 서명 진행률");
  assert.match(html, /서명 차례/, "다음 차례 표시");
  assert.match(html, /\/img\/demo\/sign\/\d+\.png/, "서명 이미지가 붙어 있어야 함");
});

test("다른 상인회의 데이터는 건드리지 않는다", async () => {
  const other = await D.createAssociation(db(), { slug: "other", name: "다른 상인회" });
  await db().prepare(`INSERT INTO notices (association_id, title, body) VALUES (?,?,?)`).bind(other.id, "남의 공지", "본문").run();
  const r = await req("POST", `/super/association/${assoc.id}/demo`, { cookie, body: { _csrf: token } });
  assert.equal(r.status, 303);
  const n = db()._db.prepare(`SELECT COUNT(*) n FROM notices WHERE association_id=?`).get(other.id);
  assert.equal(n.n, 1, "다른 상인회 공지가 그대로 남아야 함");
});

// ── 영업 상태 판정 (정기휴무 요일 반영)
import { openNow, closedToday, kstStamp } from "../src/util.js";

test("화면에 보이는 시각은 KST 로 환산한다", () => {
  assert.equal(kstStamp("2026-08-03T01:44:35.962Z"), "2026-08-03 10:44");
  assert.equal(kstStamp("2026-08-03 23:10:00"), "2026-08-04 08:10", "UTC 자정을 넘기면 날짜도 넘어가야 함");
  assert.equal(kstStamp("2026-08-03 23:10:00", { year: false }), "08-04 08:10");
  assert.equal(kstStamp(""), "");
  assert.equal(kstStamp("알 수 없음"), "알 수 없음", "해석할 수 없으면 원문 그대로");
});

const SUN = Date.parse("2026-08-09T03:00:00Z"); // 일요일 정오 KST
const MON = Date.parse("2026-08-10T03:00:00Z"); // 월요일 정오 KST
const SAT = Date.parse("2026-08-08T03:00:00Z"); // 토요일 정오 KST

test("영업시간 줄에 적힌 정기휴무 요일을 반영한다", () => {
  const h = "09:00-21:30 · 매주 일요일 휴무";
  assert.equal(openNow(h, SUN), false, "일요일 휴무인데 일요일에 영업중으로 나오면 안 됨");
  assert.equal(openNow(h, MON), true, "월요일에는 영업중");

  assert.equal(openNow("10:00-20:00 · 월요일 휴무", MON), false);
  assert.equal(openNow("10:00-20:00 · 주말 휴무", SAT), false, "주말 휴무 — 토요일");
  assert.equal(openNow("10:00-20:00 · 주말 휴무", SUN), false, "주말 휴무 — 일요일");
  assert.equal(openNow("10:00-20:00 · 주말 휴무", MON), true);
  assert.equal(openNow("10:00-20:00 · 토·일 휴무", SAT), false, "요일 나열");
});

test("'연중무휴'를 휴무로 오해하지 않는다", () => {
  assert.equal(closedToday("연중무휴 10:00-20:00", SUN), false);
  assert.equal(openNow("연중무휴 10:00-20:00", SUN), true);
});

test("휴무 표기가 없으면 종전대로 시간만 본다", () => {
  assert.equal(openNow("08:00-23:00", SUN), true);
  assert.equal(openNow("08:00-23:00", MON), true);
  assert.equal(openNow("", MON), null, "영업시간 미기재는 판단 불가(null)");
});
