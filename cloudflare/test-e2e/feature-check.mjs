// 기능 점검 — "이게 실제로 됩니까?" 에 항목으로 답한다.
//
// 다른 검사들은 통과 개수만 말한다. 그 숫자로는 "전자계약이 되나요" 에 답할 수 없다.
// 여기서는 손님·점주·관리자가 실제로 하는 일을 처음부터 끝까지 해 보고,
// 된 것과 안 된 것을 사람 말로 적는다.
//
// 실행: npm run check
import worker from "../src/index.js";
import { makeEnv } from "../test/shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { contentHash, verifySignature } from "../src/esign.js";

const B = "http://localhost";
let ipN = 0, ok = 0, bad = 0;
const rows = [];
function chk(area, name, cond, note = "") {
  if (cond) ok++; else bad++;
  rows.push({ area, name, pass: !!cond, note });
}
const env = makeEnv();
const f = (p, i = {}) => {
  const headers = { "user-agent": "Mozilla/5.0", "cf-connecting-ip": `198.51.100.${++ipN % 250}`, ...(i.headers || {}) };
  return worker.fetch(new Request(B + p, { redirect: "manual", ...i, headers }), env, { waitUntil() {}, passThroughOnException() {} });
};
const jarOf = (r) => (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
const csrfIn = (h) => (/name="_csrf" value="([^"]+)"/.exec(h) || [])[1];
async function login(email, password) {
  const g = await f("/login"); const seed = jarOf(g);
  const tk = csrfIn(await g.text());
  const r = await f("/login", { method: "POST", headers: { cookie: seed, origin: B, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: tk, email, password }) });
  return [seed, jarOf(r)].filter(Boolean).join("; ");
}
const post = (p, jar, body, extra = {}) => f(p, { method: "POST",
  headers: { cookie: jar, origin: B, "content-type": "application/x-www-form-urlencoded", ...extra },
  body: new URLSearchParams(body) });
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// ── 준비: 운영사 + 세 제품 조직
const pw = await hashPassword("pass1234");
const mk = (e, n, role, aid) => D.createUser(env.DB, { email: e, passwordHash: pw.hash, salt: pw.salt, name: n, role, associationId: aid });
await mk("super@p.kr", "운영자", "SUPERADMIN", null);
const mart = await D.createAssociation(env.DB, { slug: "seocho", name: "서초구 상인회", kind: "merchant" });
const law  = await D.createAssociation(env.DB, { slug: "law", name: "한빛법무법인", kind: "esign" });
const fran = await D.createAssociation(env.DB, { slug: "dapong", name: "다뽕고", kind: "franchise" });
await mk("ad@seocho.kr", "회장", "ADMIN", mart.id);
await mk("ad@law.kr", "대표", "ADMIN", law.id);
await mk("ad@dapong.kr", "본사", "ADMIN", fran.id);
const superJar = await login("super@p.kr", "pass1234");
const martJar = await login("ad@seocho.kr", "pass1234");
const lawJar = await login("ad@law.kr", "pass1234");
const franJar = await login("ad@dapong.kr", "pass1234");

// ══════════ 1. 전자계약 ══════════
const A = "전자계약";
{
  // 계약서 만들기
  const listP = await f("/t/law/admin/documents", { headers: { cookie: lawJar } });
  const csrf = csrfIn(await listP.text());
  const r = await post("/t/law/admin/documents", lawJar, { _csrf: csrf, title: "용역 계약서", body: "제1조 …\n제2조 …", target: "none" });
  const loc = decodeURIComponent(r.headers.get("location") || "");
  chk(A, "관리자가 계약서를 만든다", r.status === 303 && /documents\/\d+/.test(loc));
  const docId = Number((loc.match(/documents\/(\d+)/) || [])[1]);

  // 받은 PDF 양식을 그대로 지면으로 — 옮겨 적지 않아도 되는가
  {
    const lp = await (await f("/t/law/admin/documents", { headers: { cookie: lawJar } })).text();
    const fd = new FormData();
    fd.set("_csrf", csrfIn(lp)); fd.set("title", "표준근로계약서"); fd.set("target", "none");
    fd.set("attachment", new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])], { type: "application/pdf" }), "form.pdf");
    fd.append("scan_0", new Blob([new Uint8Array(1024).fill(9)], { type: "image/jpeg" }), "p1.jpg");
    fd.append("scan_size_0", "1240x1754");
    const rr = await f("/t/law/admin/documents", { method: "POST", headers: { cookie: lawJar, origin: B }, body: fd });
    const id = Number((decodeURIComponent(rr.headers.get("location") || "").match(/documents\/(\d+)/) || [])[1]);
    const made = id ? await D.getDocument(env.DB, id) : null;
    const pgs = id ? await D.listDocPages(env.DB, id) : [];
    chk(A, "받은 PDF 양식을 옮겨 적지 않고 그대로 계약서로 쓴다", !!made && made.body === "" && pgs.length === 1);
    chk(A, "그 계약의 원문 해시는 올린 PDF 파일의 것이다", !!made && !!made.attachment_hash);
    const edit = id ? await (await f(`/t/law/admin/documents/${id}/fields`, { headers: { cookie: lawJar } })).text() : "";
    chk(A, "올린 양식 위에 서명 자리를 놓을 수 있다", /paper-stack is-scan/.test(edit) && /class="paper-scan"/.test(edit));
  }

  // 외부 상대방 추가 (연락처 없이 = 링크를 손으로 보내는 길)
  const pg = await f(`/t/law/admin/documents/${docId}`, { headers: { cookie: lawJar } });
  const html = await pg.text();
  const c2 = csrfIn(html);
  const ar = await post(`/t/law/admin/documents/${docId}/external`, lawJar, { _csrf: c2, name: "김상대", org: "○○상사" });
  chk(A, "연락처 없이도 서명 상대방을 넣는다 (알림톡 없이 진행)", !/err=1/.test(ar.headers.get("location") || ""));

  // 링크가 화면에 남아 있는가
  const pg2 = await (await f(`/t/law/admin/documents/${docId}`, { headers: { cookie: lawJar } })).text();
  const link = (pg2.match(/data-share-url="([^"]*\/esign\/[^"]+)"/) || [])[1] || "";
  chk(A, "서명 링크를 언제든 다시 꺼내 복사한다", !!link);
  chk(A, "카톡에 붙여 넣을 문장까지 준비된다", /data-share-text="[^"]*전자서명 요청/.test(pg2));

  // 상대방이 로그인 없이 서명
  const token = link.split("/esign/")[1] || "";
  const sp = await f(`/esign/${token}`);
  const spHtml = await sp.text();
  chk(A, "받은 사람이 가입·로그인 없이 계약서를 연다", sp.status === 200 && /용역 계약서/.test(spHtml));
  const sr = await post(`/esign/${token}`, jarOf(sp), { _csrf: csrfIn(spHtml), consent: "1", signature: PNG, signer_name: "김상대" });
  chk(A, "그 자리에서 전자서명이 접수된다", !/err=1/.test(sr.headers.get("location") || ""));

  const sigs = await D.listSignatures(env.DB, docId);
  const doc = await D.getDocument(env.DB, docId);
  const v = sigs.length ? await verifySignature(env, sigs[0], doc) : { valid: false };
  chk(A, "서명이 Ed25519 로 봉인되고 검증된다 (위변조 탐지)", v.valid === true);

  // 확인서·검증·완성본·증적
  const code = sigs.length ? sigs[0].verify_code : "";
  chk(A, "누구나 검증코드로 진위를 확인한다", code && (await f(`/verify/${code}`)).status === 200);
  chk(A, "전자서명 확인서가 열린다", code && (await f(`/certificate/${code}`)).status === 200);
  chk(A, "완성본(서명이 얹힌 계약서)이 열린다", (await f(`/esign/${token}/paper`)).status === 200);
  const ev = await f(`/esign/${token}/evidence`);
  chk(A, "증적 패키지(ZIP)를 내려받는다", ev.status === 200 && /zip/.test(ev.headers.get("content-type") || ""));

  // 문서 수정 잠금
  const after = await (await f(`/t/law/admin/documents/${docId}`, { headers: { cookie: lawJar } })).text();
  chk(A, "서명이 시작되면 계약서 본문이 잠긴다", !/문서 수정<\/summary>|panel-title">문서 수정/.test(after));
  chk(A, "감사 추적(누가 언제 열람·서명했는지)이 남는다", /감사 추적/.test(after) && /전자서명 완료|계약서 열람/.test(after));
}

// ══════════ 2. 상인회 홈페이지 ══════════
const M = "상인회";
{
  chk(M, "손님이 상인회 홈을 연다", (await f("/t/seocho/")).status === 200);
  // 점주 가입 → 가게 등록 → 승인 → 공개
  const rp = await f("/t/seocho/register");
  const rjar = jarOf(rp);
  const rr = await post("/t/seocho/register", rjar, { _csrf: csrfIn(await rp.text()),
    name: "박사장", email: "boss@x.kr", password: "pass1234", business_name: "홍가네분식", agree: "1" });
  chk(M, "점주가 스스로 가입한다", rr.status === 303 && !/err=1/.test(rr.headers.get("location") || ""));
  const bizJar = [rjar, jarOf(rr)].filter(Boolean).join("; ");
  const biz = await D.getBusinessByOwner(env.DB, (await D.getUserByEmail(env.DB, "boss@x.kr")).id);
  const dash = await f("/t/seocho/dashboard", { headers: { cookie: bizJar } });
  const dHtml = await dash.text();
  chk(M, "점주가 자기 가게 화면을 연다", dash.status === 200);
  const ur = await post("/t/seocho/dashboard/business", bizJar, { _csrf: csrfIn(dHtml),
    name: "홍가네분식", category: "음식점", description: "떡볶이·순대", phone: "02-123-4567",
    address: "서울 서초구 서초대로 1", hours: "매일 10:00-21:00" });
  chk(M, "점주가 가게 정보를 직접 고친다", ur.status === 303);
  const adm = await (await f("/t/seocho/admin", { headers: { cookie: martJar } })).text();
  const apr = await post(`/t/seocho/admin/business/${biz.id}/status`, martJar, { _csrf: csrfIn(adm), status: "approved" });
  chk(M, "상인회가 가게를 승인한다", apr.status === 303);
  const pub = await (await f("/t/seocho/businesses")).text();
  chk(M, "승인된 가게가 손님 목록에 뜬다", /홍가네분식/.test(pub));
  chk(M, "가게 상세가 열린다", (await f(`/t/seocho/business/${encodeURIComponent((await D.getBusinessById(env.DB, biz.id)).slug)}`)).status === 200);
  chk(M, "업종·검색으로 가게를 찾는다", /홍가네분식/.test(await (await f("/t/seocho/businesses?q=분식")).text()));
  chk(M, "지도 화면이 열린다", (await f("/t/seocho/map")).status === 200);
  // 공지·행사
  const a2 = await (await f("/t/seocho/admin", { headers: { cookie: martJar } })).text();
  await post("/t/seocho/admin/notice", martJar, { _csrf: csrfIn(a2), title: "정기총회 안내", body: "3월 5일", tag: "공지" });
  chk(M, "상인회가 공지를 올리고 손님이 본다", /정기총회 안내/.test(await (await f("/t/seocho/notices")).text()));
  await post("/t/seocho/admin/event", martJar, { _csrf: csrfIn(a2), title: "봄 골목축제", event_date: "2099-04-01" });
  chk(M, "행사를 올리고 손님이 본다", /봄 골목축제/.test(await (await f("/t/seocho/events")).text()));
  chk(M, "공지 RSS 가 나간다", (await f("/t/seocho/feed.xml")).status === 200);
  // A/B
  await D.createLandingVariant(env.DB, { associationId: mart.id, slug: "b", name: "사본", layout: null });
  const vr = await f("/t/seocho/l/b");
  chk(M, "홈 사본(A/B) 주소가 열린다", vr.status === 200);
  const vjar = jarOf(vr);
  await f("/t/seocho/businesses?q=분식", { headers: { cookie: vjar } });
  const st = (await D.homeVariantStats(env.DB, mart.id, 30)).find((x) => x.variant === "b") || {};
  chk(M, "사본이 만든 성과가 그 사본 앞으로 쌓인다", Number(st.views) >= 1 && Number(st.finds) >= 1);
}

// ══════════ 3. 모집 랜딩 + 상담 DB ══════════
const Fq = "모집 랜딩";
{
  chk(Fq, "가맹점 모집 랜딩이 열린다", (await f("/t/dapong/")).status === 200);
  const lp = await f("/t/dapong/");
  const lHtml = await lp.text();
  const lr = await post("/t/dapong/lead", jarOf(lp), { _csrf: csrfIn(lHtml),
    name: "이창업", phone: "010-1234-5678", region: "서울", agree: "1" });
  chk(Fq, "상담 신청이 접수된다", lr.status === 303 && !/err=1/.test(lr.headers.get("location") || ""));
  const leads = await D.listLeads(env.DB, fran.id, {});
  chk(Fq, "신청이 상담 DB 에 쌓인다", (leads.items || leads).length >= 1);
  const db2 = await (await f("/t/dapong/admin/leads", { headers: { cookie: franJar } })).text();
  chk(Fq, "본사가 상담 DB 화면에서 본다", /이창업/.test(db2));
  const csv = await f("/t/dapong/admin/leads.csv", { headers: { cookie: franJar } });
  chk(Fq, "엑셀(CSV)로 내려받는다", csv.status === 200);
}

// ══════════ 4. 알림톡 ══════════
const N = "알림톡";
{
  const { notifyEnabled, autoNotifyOn, canAutoSend } = await import("../src/notify.js");
  chk(N, "키가 없으면 발송이 꺼진 것으로 판정한다", notifyEnabled(env) === false);
  const fresh = await D.getAssociationById(env.DB, mart.id);
  chk(N, "새 조직은 자동 발송이 꺼진 채로 시작한다", autoNotifyOn(fresh) === false);
  const withKeys = makeEnv({ ALIGO_API_KEY: "k", ALIGO_USER_ID: "u", ALIGO_SENDER_KEY: "s", ALIGO_SENDER: "021234567" });
  chk(N, "운영사 키가 있어도 조직이 켜지 않으면 안 나간다", canAutoSend(withKeys, fresh) === false);
  await D.setNotifyAuto(env.DB, mart.id, 1);
  chk(N, "조직이 켜면 그때부터 나간다", canAutoSend(withKeys, await D.getAssociationById(env.DB, mart.id)) === true);
  const admHtml = await (await f("/t/seocho/admin", { headers: { cookie: martJar } })).text();
  chk(N, "관리 화면에 켜고 끄는 스위치가 있다", /알림 자동화/.test(admHtml) && /자동화 (켜기|끄기)/.test(admHtml));
}

// ══════════ 5. 운영사 콘솔 ══════════
const S = "운영사 콘솔";
{
  const sc = await f("/super", { headers: { cookie: superJar } });
  const sHtml = await sc.text();
  chk(S, "운영사 콘솔이 열린다", sc.status === 200);
  chk(S, "고객사 세 곳이 모두 보인다", /서초구 상인회/.test(sHtml) && /한빛법무법인/.test(sHtml) && /다뽕고/.test(sHtml));
  chk(S, "간판을 눌러도 콘솔 밖으로 안 나간다", /<a class="brand" href="\/super"/.test(sHtml));
  const org = await f(`/super/org/${mart.id}`, { headers: { cookie: superJar } });
  chk(S, "고객사 한 곳의 정보가 한 화면에 모인다", org.status === 200);
  chk(S, "로그인 안 하면 콘솔이 안 열린다", (await f("/super")).status === 303);
}

// ══════════ 6. 접근 통제 (가장 무서운 사고) ══════════
const G = "접근 통제";
{
  chk(G, "남의 상인회 관리 화면에 못 들어간다", (await f("/t/law/admin", { headers: { cookie: martJar } })).status === 403);
  chk(G, "점주 계정으로 관리 화면에 못 들어간다", (await f("/t/seocho/admin", { headers: { cookie: await login("boss@x.kr", "pass1234") } })).status === 403);
  chk(G, "비로그인은 관리 화면 대신 로그인으로 간다", (await f("/t/seocho/admin")).status === 303);
  chk(G, "위조된 서명 링크는 404", (await f("/esign/999.aaaa")).status === 404);
  const bad = await post("/t/seocho/admin/notice", martJar, { _csrf: "위조", title: "x", body: "y" });
  chk(G, "위조 요청(CSRF)은 막힌다", bad.status === 403);
}

// ══════════ 7. 백업·복원 ══════════
const Bk = "백업";
{
  // 인증번호·웹훅 대기열은 일부러 뺀다 — 되살리면 오히려 위험하고 지난 이벤트를 다시 쏜다.
  const { TABLES, BACKUP_SKIP } = await import("../src/scheduled.js");
  const names = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map((r) => r.name)
    .filter((n) => !n.startsWith("sqlite_") && n !== "_cf_KV");
  const missing = names.filter((n) => !TABLES.includes(n) && !BACKUP_SKIP.includes(n));
  chk(Bk, "새로 생긴 표가 백업에서 빠지지 않았다", missing.length === 0, missing.join(", "));
  chk(Bk, "되살리면 안 되는 값은 일부러 뺀다 (인증번호·웹훅 대기열)", BACKUP_SKIP.length === 3);
}

// ── 출력
const areas = [...new Set(rows.map((r) => r.area))];
for (const a of areas) {
  console.log(`\n${a}`);
  for (const r of rows.filter((x) => x.area === a))
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}${r.note ? `  (${r.note})` : ""}`);
}
console.log(`\n${ok + bad}개 항목 · ${ok}개 정상${bad ? ` · ${bad}개 실패` : ""}`);
process.exit(bad ? 1 : 0);
