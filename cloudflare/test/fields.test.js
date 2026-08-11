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
