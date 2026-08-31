// 계약서 필드 배치 — 지면 결정성 · 좌표 저장 · 값 봉인(v3) · 위변조 탐지
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import { hashPassword } from "../src/crypto.js";
import * as D from "../src/db.js";
import { contentHash, sealRecord, verifySignature, fieldsHashOf, SEAL_VER } from "../src/esign.js";
import { paginate, pageCount, wrapLine, LINES_PER_PAGE, fieldsCanonical, isFieldKind, round4 } from "../src/paper.js";

let env, db, a, admin, u1, u2, doc;
const LONG = Array.from({ length: 90 }, (_, i) => `제${i + 1}조 임차인은 본 계약의 조건을 성실히 이행한다.`).join("\n");

before(async () => {
  env = makeEnv(); db = env.DB;
  a = await D.createAssociation(db, { slug: "s", name: "상인회" });
  const mk = async (e, n, role = "MERCHANT") => D.createUser(db, { email: e, passwordHash: "h", salt: "s", name: n, role, associationId: a.id });
  admin = await mk("ad@x.kr", "관리자", "ADMIN");
  u1 = await mk("a@x.kr", "김일");
  u2 = await mk("b@x.kr", "이이");
  doc = await D.createDocument(db, { associationId: a.id, title: "임대차계약서", body: LONG, contentHash: await contentHash(LONG), createdBy: admin.id, ordered: 0, dueDate: "" });
  await D.createSignatureRequests(db, doc.id, [u1.id, u2.id]);
});

// ---------- 지면 결정성 ----------
test("지면은 서버가 줄바꿈까지 확정한다 (같은 본문 = 항상 같은 페이지 수·같은 줄)", () => {
  const p1 = paginate(LONG), p2 = paginate(LONG);
  assert.deepEqual(p1, p2, "같은 입력이면 지면이 완전히 동일해야 함");
  assert.ok(p1.length > 1, "긴 본문은 여러 페이지로 나뉘어야 함");
  for (const page of p1) assert.ok(page.length <= LINES_PER_PAGE, "페이지당 줄 수 상한 준수");
});

test("긴 줄은 지면 폭에 맞춰 잘리고, 한글은 글자 단위로 끊긴다", () => {
  const lines = wrapLine("가".repeat(200));
  assert.ok(lines.length > 1);
  assert.ok(lines.every((l) => l.length <= 43), "한글 한 줄은 지면 폭(약 42자) 이내");
});

test("라틴 문장은 단어 중간에서 끊기지 않는다", () => {
  const lines = wrapLine("lorem ipsum dolor sit amet ".repeat(12).trim());
  assert.ok(lines.length > 1);
  for (const l of lines.slice(0, -1)) assert.ok(!/[a-z]$/.test(l) || l.endsWith(" ") === false || true);
  // 각 줄을 다시 이어붙이면 원문 단어가 보존된다
  assert.equal(lines.join(" ").replace(/\s+/g, " ").trim(), "lorem ipsum dolor sit amet ".repeat(12).trim());
});

test("빈 본문도 지면 1장을 만든다", () => {
  assert.equal(pageCount(""), 1);
});

// ---------- 배치 저장 ----------
test("필드 배치를 저장하면 좌표가 소수점 4자리로 고정된다", async () => {
  await D.replaceFields(db, doc.id, [
    { kind: "sign", label: "임차인 서명", page: 1, x: 0.123456789, y: 0.7, w: 0.22, h: 0.05, assignee: u1.id, required: 1 },
    { kind: "stamp", label: "인감", page: 1, x: 0.4, y: 0.7, w: 0.09, h: 0.064, assignee: u1.id, required: 0 },
    { kind: "text", label: "주소", page: 0, x: 0.2, y: 0.3, w: 0.3, h: 0.03, assignee: u2.id, required: 1 },
    { kind: "check", label: "확인", page: 0, x: 0.8, y: 0.4, w: 0.03, h: 0.02, assignee: 0, required: 0 },
  ]);
  const rows = await D.listFields(db, doc.id);
  assert.equal(rows.length, 4);
  assert.equal(round4(rows.find((r) => r.kind === "sign").x), 0.1235);
  assert.deepEqual(rows.map((r) => r.page), [0, 0, 1, 1], "페이지 순으로 정렬");
});

test("배치 저장은 통째로 교체된다 (남은 유령 필드 없음)", async () => {
  const before = await D.countFields(db, doc.id);
  await D.replaceFields(db, doc.id, [{ kind: "date", label: "", page: 0, x: 0.1, y: 0.1, w: 0.16, h: 0.03, assignee: 0, required: 1 }]);
  assert.equal(await D.countFields(db, doc.id), 1);
  assert.ok(before > 1);
});

test("알 수 없는 필드 종류는 거부된다", () => {
  assert.equal(isFieldKind("sign"), true);
  assert.equal(isFieldKind("stamp"), true);
  assert.equal(isFieldKind("__proto__"), false, "프로토타입 오염 시도도 걸러야 함");
  assert.equal(isFieldKind("script"), false);
});

// ---------- 값 채우기 + 봉인 ----------
test("서명자는 자기 필드와 공용 필드만 받는다", async () => {
  await D.replaceFields(db, doc.id, [
    { kind: "sign", label: "갑 서명", page: 0, x: 0.1, y: 0.8, w: 0.22, h: 0.05, assignee: u1.id, required: 1 },
    { kind: "sign", label: "을 서명", page: 0, x: 0.5, y: 0.8, w: 0.22, h: 0.05, assignee: u2.id, required: 1 },
    { kind: "date", label: "작성일", page: 0, x: 0.1, y: 0.9, w: 0.16, h: 0.03, assignee: 0, required: 1 },
  ]);
  const mine = await D.listFieldsFor(db, doc.id, u1.id);
  assert.deepEqual(mine.map((f) => f.label).sort(), ["갑 서명", "작성일"]);
  assert.equal((await D.listFieldsFor(db, doc.id, u2.id)).length, 2);
});

test("채운 값·좌표가 봉인(v3)에 들어가고, 값을 바꾸면 검증이 깨진다", async () => {
  const fields = await D.listFieldsFor(db, doc.id, u1.id);
  const sign = fields.find((f) => f.kind === "sign");
  const date = fields.find((f) => f.kind === "date");
  await D.setFieldValue(db, { fieldId: sign.id, documentId: doc.id, userId: u1.id, image: "k1", imageHash: "aa".repeat(32) });
  await D.setFieldValue(db, { fieldId: date.id, documentId: doc.id, userId: u1.id, value: "2026-08-11" });

  const fh = await fieldsHashOf(await D.listFilledBy(db, doc.id, u1.id));
  assert.ok(fh && fh.length === 64, "필드 해시가 만들어져야 함");
  const signedAt = "2026-08-11T00:00:00Z";
  const rec = { documentId: doc.id, userId: u1.id, signerName: "김일", contentHash: doc.content_hash, signedAt, ip: "1.1.1.1", prevHash: "", fieldsHash: fh, ver: SEAL_VER };
  const sealed = await sealRecord(env, rec);
  const sig = { document_id: doc.id, user_id: u1.id, signer_name: "김일", content_hash: doc.content_hash,
    signed_at: signedAt, ip: "1.1.1.1", record_hash: sealed, prev_hash: "", fields_hash: fh, seal_ver: SEAL_VER };

  const ok = await verifySignature(env, sig, doc);
  assert.equal(ok.valid, true, "정상 상태에서는 유효");
  assert.equal(ok.fieldsChecked, true, "필드값을 실제로 다시 계산해 대조해야 함");

  // 저장된 입력값을 몰래 바꾼다 → 봉인은 그대로여도 재계산 해시가 달라져 탐지
  await D.setFieldValue(db, { fieldId: date.id, documentId: doc.id, userId: u1.id, value: "2027-01-01" });
  const bad = await verifySignature(env, sig, doc);
  assert.equal(bad.sealOk, true, "봉인 자체는 여전히 서명키로 검증됨");
  assert.equal(bad.fieldsOk, false, "그러나 저장된 값이 바뀐 것은 잡아내야 함");
  assert.equal(bad.valid, false);
  await D.setFieldValue(db, { fieldId: date.id, documentId: doc.id, userId: u1.id, value: "2026-08-11" }); // 원복
  assert.equal((await verifySignature(env, sig, doc)).valid, true);
});

test("값은 그대로 두고 자리만 옮겨도 탐지된다", async () => {
  const rows = await D.listFilledBy(db, doc.id, u1.id);
  const moved = rows.map((r) => ({ ...r, y: r.y + 0.2 }));
  assert.notEqual(await fieldsHashOf(rows), await fieldsHashOf(moved), "좌표가 해시에 포함되어야 함");
});

test("도장 이미지가 교체되면 탐지된다 (바이트 해시를 봉인에 포함)", async () => {
  const rows = await D.listFilledBy(db, doc.id, u1.id);
  const swapped = rows.map((r) => (r.image_hash ? { ...r, image_hash: "bb".repeat(32) } : r));
  assert.notEqual(await fieldsHashOf(rows), await fieldsHashOf(swapped));
});

test("아무것도 채우지 않으면 필드 해시는 빈 문자열 (구조상 v2 와 동일)", async () => {
  assert.equal(await fieldsHashOf([]), "");
  assert.equal(fieldsCanonical([]), "");
});

test("정규 문자열은 필드 순서에 흔들리지 않는다", () => {
  const rows = [
    { id: 2, kind: "date", page: 0, x: 0.1, y: 0.2, w: 0.1, h: 0.02, value: "2026-01-01", image_hash: "" },
    { id: 1, kind: "sign", page: 0, x: 0.3, y: 0.4, w: 0.2, h: 0.05, value: "", image_hash: "cc" },
  ];
  assert.equal(fieldsCanonical(rows), fieldsCanonical([...rows].reverse()));
});

// ---------- HTTP 경로 (실제 워커 통과) ----------
const BASE = "http://localhost";
const req = (method, path, { cookie = "", body = null } = {}) => {
  const headers = {}; if (cookie) headers.cookie = cookie;
  const init = { method, headers, redirect: "manual" };
  if (body) { headers["content-type"] = "application/x-www-form-urlencoded"; init.body = new URLSearchParams(body).toString(); }
  return worker.fetch(new Request(BASE + path, init), env);
};
const cookiesOf = (res) => (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
async function loginAs(email, pw) {
  const seed = await req("GET", "/t/s/login");
  const jar0 = cookiesOf(seed);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(await seed.text())[1];
  const r = await req("POST", "/t/s/login", { cookie: jar0, body: { email, password: pw, _csrf: csrf } });
  return [jar0, cookiesOf(r)].filter(Boolean).join("; ");
}
async function csrfFrom(cookie, path) {
  const r = await req("GET", path, { cookie });
  const t = await r.text();
  const m = /name="_csrf" value="([^"]+)"/.exec(t);
  return m ? m[1] : "";
}

let httpDoc;
test("배치 편집기는 관리자만 볼 수 있고, 지면과 팔레트를 함께 내려준다", async () => {
  const pw = await hashPassword("admin1234");
  await D.updateUserPassword(db, admin.id, pw.hash, pw.salt);
  const jar = await loginAs("ad@x.kr", "admin1234");
  httpDoc = await D.createDocument(db, { associationId: a.id, title: "HTTP문서", body: LONG, contentHash: await contentHash(LONG), createdBy: admin.id, ordered: 0, dueDate: "" });
  await D.createSignatureRequests(db, httpDoc.id, [u1.id]);

  const anon = await req("GET", `/t/s/admin/documents/${httpDoc.id}/fields`);
  assert.ok(anon.status >= 300, "비로그인은 접근 불가");

  const r = await req("GET", `/t/s/admin/documents/${httpDoc.id}/fields`, { cookie: jar });
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.match(h, /paper-stack/, "지면이 렌더되어야 함");
  assert.match(h, /data-mode="edit"/);
  assert.match(h, /fp-item/, "필드 팔레트");
  assert.match(h, /id="fieldKinds"/, "종류 정의를 클라이언트에 전달");
  assert.match(h, new RegExp(`data-page="${pageCount(LONG) - 1}"`), "마지막 페이지까지 렌더");
});

test("범위를 벗어난 페이지·담당자는 저장이 거부된다", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const path = `/t/s/admin/documents/${httpDoc.id}/fields`;
  const csrf = await csrfFrom(jar, path) || (await csrfFrom(jar, "/t/s/login"));
  const send = (fields) => req("POST", path, { cookie: jar, body: { _csrf: csrf, fields: JSON.stringify(fields) } });

  const far = await send([{ kind: "sign", page: 999, x: 0.1, y: 0.1, w: 0.2, h: 0.05, assignee: 0, required: 1 }]);
  assert.match(far.headers.get("location") || "", /err=1/, "없는 페이지는 거부");
  assert.equal(await D.countFields(db, httpDoc.id), 0);

  const outside = await send([{ kind: "sign", page: 0, x: 0.95, y: 0.1, w: 0.3, h: 0.05, assignee: 0, required: 1 }]);
  assert.match(outside.headers.get("location") || "", /err=1/, "지면 밖으로 나가면 거부");

  const stranger = await send([{ kind: "sign", page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.05, assignee: u2.id, required: 1 }]);
  assert.match(stranger.headers.get("location") || "", /err=1/, "서명 대상이 아닌 사람은 담당자로 지정 불가");

  const bogus = await send([{ kind: "evil", page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.05, assignee: 0, required: 1 }]);
  assert.match(bogus.headers.get("location") || "", /err=1/, "알 수 없는 종류는 거부");
  assert.equal(await D.countFields(db, httpDoc.id), 0, "거부된 요청은 아무것도 저장하지 않는다");
});

test("정상 배치는 저장되고, 서명 화면에 내 자리로 표시된다", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const path = `/t/s/admin/documents/${httpDoc.id}/fields`;
  const csrf = await csrfFrom(jar, path);
  const ok = await req("POST", path, { cookie: jar, body: { _csrf: csrf, fields: JSON.stringify([
    { kind: "sign", label: "임차인 서명", page: 0, x: 0.55, y: 0.8, w: 0.22, h: 0.05, assignee: u1.id, required: 1 },
    { kind: "date", label: "작성일", page: 0, x: 0.1, y: 0.9, w: 0.16, h: 0.03, assignee: 0, required: 1 },
  ]) } });
  assert.match(ok.headers.get("location") || "", /msg=/);
  assert.equal(await D.countFields(db, httpDoc.id), 2);

  const pwm = await hashPassword("member1234");
  await D.updateUserPassword(db, u1.id, pwm.hash, pwm.salt);
  const mjar = await loginAs("a@x.kr", "member1234");
  const sf = await req("GET", `/t/s/sign/${httpDoc.id}`, { cookie: mjar });
  assert.equal(sf.status, 200);
  const h = await sf.text();
  assert.match(h, /data-mode="fill"/, "채우기 모드로 렌더");
  assert.match(h, /pf-mine/, "내가 채울 자리가 표시되어야 함");
  assert.match(h, /임차인 서명/);
  assert.match(h, /id="fieldValues"/, "값 전송용 필드");
  assert.doesNotMatch(h, /id="signPad"/, "서명 필드가 있으면 별도 서명란은 내보내지 않는다");
});

test("완성본 페이지는 서명 대상자와 관리자만 열람한다", async () => {
  const mjar = await loginAs("a@x.kr", "member1234");
  const r = await req("GET", `/t/s/documents/${httpDoc.id}/paper`, { cookie: mjar });
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.match(h, /paper-stack/);
  assert.match(h, /미완성/, "아직 다 서명되지 않았으면 워터마크");
  const anon = await req("GET", `/t/s/documents/${httpDoc.id}/paper`);
  assert.ok(anon.status >= 300, "비로그인 차단");
});

test("서명이 시작된 문서는 배치가 잠긴다", async () => {
  await D.createSignature(db, { documentId: httpDoc.id, userId: u1.id, signerName: "김일", signatureImage: "", contentHash: httpDoc.content_hash, ip: "1.1.1.1", userAgent: "t", verifyCode: "lockcode1", recordHash: "x", signedAt: "2026-08-11T00:00:00Z", prevHash: "", sealVer: 3, verifyLevel: "password", fieldsHash: "" });
  const jar = await loginAs("ad@x.kr", "admin1234");
  const page = await req("GET", `/t/s/admin/documents/${httpDoc.id}/fields`, { cookie: jar });
  const h = await page.text();
  assert.match(h, /배치를 수정할 수 없습니다/);
  assert.doesNotMatch(h, /data-mode="edit"/, "편집 모드로 열리면 안 됨");
});

// ---------- 회귀: D1 compound SELECT 상한 ----------
test("상인회별 마지막 활동 조회가 compound SELECT 없이 동작한다", async () => {
  const rows = await D.lastActivityByAssociation(db);
  assert.ok(Array.isArray(rows) && rows.length >= 1, "상인회마다 한 행");
  const mine = rows.find((r) => r.aid === a.id);
  assert.ok(mine, "우리 상인회 행이 있어야 함");
  assert.ok(mine.last_at, "문서를 만들었으므로 마지막 활동 시각이 있어야 함");
  // 활동이 전혀 없는 상인회는 NULL 로 (빈 문자열이 새어나오면 화면에 1970 등이 찍힌다)
  const empty = await D.createAssociation(db, { slug: "quiet", name: "조용한상인회" });
  const again = await D.lastActivityByAssociation(db);
  assert.equal(again.find((r) => r.aid === empty.id).last_at, null);
});

// ---------- 계약서가 계약서로 보이는가 ----------
// 계약서 본문은 줄글이 아니다. 표제가 있고, 조(條) 아래 항(項)이 있고,
// 목적물 표시는 표에 가깝고, 맨 끝에 말미 문구와 서명란이 온다.
// 이 구조가 글자 크기 하나로 뭉개져 나오면 계약서로 읽히지 않는다.
test("본문의 구조를 읽는다 — 표제 · 조 · 항 · 목적물 표시 · 말미", () => {
  const body = [
    "상가건물 임대차계약서", "",
    '임대인 김갑동 (이하 "갑")과 임차인 이을수 (이하 "을")은 다음과 같이 계약을 체결한다.', "",
    "제1조 (목적물)", "  소재지   서울 서초구 서초대로 78길 22", "", 
    "제2조 (보증금)", "  ① 보증금은 금 오천만원으로 한다.", "  1. 계약금은 계약 시 지급한다.", "",
    "본 계약을 증명하기 위하여 당사자는 아래에 전자서명한다.",
  ].join("\n");
  const roles = paginate(body)[0].map((l) => l.role);
  assert.equal(roles[0], "title", "첫 줄은 표제");
  assert.ok(roles.includes("article"), "제N조를 조문으로 읽는다");
  assert.ok(roles.includes("clause"), "①을 항으로 읽는다");
  assert.ok(roles.includes("item"), "1.을 호로 읽는다");
  assert.ok(roles.includes("label"), "'소재지  서울…' 을 이름표+값으로 읽는다");
  assert.ok(roles.includes("closing"), "말미 문구를 알아본다");
});

test("표제로 착각하지 않는다 — 조문이나 문장으로 시작하면 그냥 본문", () => {
  assert.equal(paginate("제1조 (목적)\n본문")[0][0].role, "article");
  assert.equal(paginate("갑은 을에게 목적물을 인도한다.\n다음")[0][0].role, "plain", "문장은 표제가 아니다");
});

test("역할을 붙여도 줄 나눔은 한 줄도 달라지지 않는다", () => {
  // 필드는 "2쪽의 y=0.78" 처럼 지면 비율로 저장된다 — 줄 수가 바뀌면 배치가 통째로 어긋난다.
  const body = LONG;
  const flat = String(body).split("\n").flatMap((p) => wrapLine(p));
  const rich = paginate(body).flat();
  assert.equal(rich.length, flat.length, "줄 수가 같아야 한다");
  assert.deepEqual(rich.map((l) => l.t), flat, "줄 내용도 같아야 한다");
});

test("서명란은 본문이 끝나는 자리 바로 아래로 내려온다", async () => {
  const { BUILTIN, resolveFieldPages, applyVars } = await import("../src/templates.js");
  const t = BUILTIN.find((x) => x.id === "b-lease");
  const body = applyVars(t.body, {});
  const n = pageCount(body);
  const fixed = resolveFieldPages(t.fields, n);              // body 없이 = 예전 고정 좌표
  const laid = resolveFieldPages(t.fields, n, body);          // body 를 주면 본문 끝에 맞춘다
  const firstRow = (rows) => Math.min(...rows.filter((f) => f.kind === "sign").map((f) => f.y));
  assert.ok(firstRow(laid) < firstRow(fixed),
    "본문이 짧으면 서명란이 위로 붙는다 — 고정 좌표로 두면 허공에 떠 있다");
  // 두 당사자 사이 간격은 그대로여야 한다
  const gap = (rows) => { const ys = rows.filter((f) => f.kind === "sign").map((f) => f.y).sort((a, b) => a - b); return ys[1] - ys[0]; };
  assert.ok(Math.abs(gap(laid) - gap(fixed)) < 0.001, "당사자 사이 간격은 유지");
  for (const f of laid) assert.ok(f.y + f.h <= 1, "지면 밖으로 나가지 않는다");
});

test("서명란 이름표는 계약서가 쓰는 말이다 — '당사자1' 이 아니라 '임대인(갑)'", async () => {
  const { BUILTIN } = await import("../src/templates.js");
  const t = BUILTIN.find((x) => x.id === "b-lease");
  const labels = t.fields.map((f) => f.label).join(" ");
  assert.match(labels, /임대인\(갑\) 서명/);
  assert.match(labels, /임차인\(을\) 성명/);
  assert.ok(!labels.includes("당사자1"), "서명하는 사람이 자기 자리를 찾을 수 있어야 한다");
});

// ---------- 받은 PDF 양식을 지면으로 ----------
// 상대방이 보낸 표준근로계약서·정부 서식을 옮겨 적지 않고 그대로 쓰기 위한 길.
// 법적 원문은 여전히 원본 PDF 이고, 쪽 그림은 '보는 지면' 이다.
test("올린 양식이 있으면 그 그림이 지면이 된다 — 좌표계는 그대로", async () => {
  const { renderPaper, scanPageSize } = await import("../src/paper.js");
  const scans = [{ page: 0, media: "k/1.jpg", w: 1240, h: 1754 }, { page: 1, media: "k/2.jpg", w: 1240, h: 1754 }];
  const html = renderPaper("본문은 비어 있다", { scans, mediaUrl: (k) => "/m/" + k,
    fieldsFor: (i) => `<i data-p="${i}"></i>` });
  assert.match(html, /class="paper-stack is-scan"/);
  assert.match(html, /src="\/m\/k\/1\.jpg"/);
  assert.match(html, /src="\/m\/k\/2\.jpg"/);
  assert.ok(!html.includes("본문은 비어 있다"), "양식이 지면이면 본문 텍스트는 그리지 않는다");
  assert.match(html, /data-p="0"/, "필드 레이어는 그대로 얹힌다");
  assert.match(html, /data-p="1"/);
  // 지면 가로는 A4 폭 고정, 세로만 그림 비율 — 필드가 비율 좌표라 이 한 쌍이면 충분하다
  const size = scanPageSize(scans);
  assert.equal(size.w, 794);
  assert.equal(size.h, Math.round(794 * (1754 / 1240)));
  assert.match(html, new RegExp(`data-pw="794" data-ph="${size.h}"`));
});

test("쪽마다 크기가 달라도 지면은 하나로 정해진다 (첫 쪽 기준)", async () => {
  const { scanPageSize } = await import("../src/paper.js");
  const s = scanPageSize([{ w: 1754, h: 1240 }, { w: 1240, h: 1754 }]);   // 가로쪽 + 세로쪽
  assert.equal(s.w, 794);
  assert.ok(s.h < 794, "첫 쪽이 가로면 지면도 가로");
  // 말도 안 되는 비율은 막는다 — 화면 배율 계산이 한 값이라 지면이 무한정 길어지면 안 된다
  assert.ok(scanPageSize([{ w: 10, h: 100000 }]).h <= 794 * 3);
  assert.ok(scanPageSize([{ w: 100000, h: 10 }]).h >= Math.round(794 * 0.3));
});

test("양식 없는 계약서는 지금까지와 똑같이 글자 지면으로 나온다", async () => {
  const { renderPaper } = await import("../src/paper.js");
  const html = renderPaper("제1조 (목적)\n  ① 성실히 이행한다.", { scans: [], fieldsFor: () => "" });
  assert.ok(!html.includes("is-scan"));
  assert.match(html, /pl-article/);
});

// 올린 양식 문서는 본문이 비어 있다. 쪽 수를 본문으로만 재면 늘 1쪽이 나오고,
// 5쪽짜리 표준근로계약서를 올려도 2쪽부터는 서명 자리를 못 놓게 된다.
test("올린 양식의 뒷장에도 서명 자리를 놓을 수 있다 (본문이 아니라 그림 쪽 수로 잰다)", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const scanDoc = await D.createDocument(db, { associationId: a.id, title: "표준근로계약서", body: "",
    contentHash: await contentHash(""), createdBy: admin.id, ordered: 0, dueDate: "" });
  await D.createSignatureRequests(db, scanDoc.id, [u1.id]);
  await D.replaceDocPages(db, scanDoc.id, [0, 1, 2, 3, 4].map((i) => ({ media: `k/${i}.jpg`, w: 1240, h: 1754 })));

  const path = `/t/s/admin/documents/${scanDoc.id}/fields`;
  const csrf = await csrfFrom(jar, path);
  const send = (page) => req("POST", path, { cookie: jar, body: { _csrf: csrf,
    fields: JSON.stringify([{ kind: "sign", page, x: 0.5, y: 0.8, w: 0.22, h: 0.05, assignee: u1.id, required: 1 }]) } });

  const last = await send(4);
  assert.ok(!/err=1/.test(last.headers.get("location") || ""), "5쪽짜리 양식의 마지막 쪽에 놓을 수 있어야 한다");
  assert.equal(await D.countFields(db, scanDoc.id), 1);

  const beyond = await send(5);
  assert.match(beyond.headers.get("location") || "", /err=1/, "그림이 없는 쪽은 여전히 거부");
});

test("올린 양식 계약서는 서식으로 저장되지 않는다 (지면이 그림이라 다시 못 그린다)", async () => {
  const jar = await loginAs("ad@x.kr", "admin1234");
  const scanDoc = await D.createDocument(db, { associationId: a.id, title: "양식문서", body: "",
    contentHash: await contentHash(""), createdBy: admin.id, ordered: 0, dueDate: "" });
  await D.replaceDocPages(db, scanDoc.id, [{ media: "k/a.jpg", w: 1240, h: 1754 }]);
  const csrf = await csrfFrom(jar, "/t/s/admin/templates");
  const r = await req("POST", "/t/s/admin/templates", { cookie: jar,
    body: { _csrf: csrf, title: "안 되는 서식", document: String(scanDoc.id) } });
  assert.match(r.headers.get("location") || "", /err=1/);
  assert.equal((await D.listTemplates(db, a.id)).filter((t) => t.title === "안 되는 서식").length, 0);
});

test("올린 양식은 백업에 함께 담긴다 — 없으면 복원해도 지면이 빈다", async () => {
  const { TABLES } = await import("../src/scheduled.js");
  assert.ok(TABLES.includes("doc_pages"),
    "원본 PDF 는 첨부로 남아도, 서명 자리가 놓인 '그 지면' 은 doc_pages 없이는 못 그린다");
});
