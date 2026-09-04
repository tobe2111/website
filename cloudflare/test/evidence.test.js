// 증적 패키지 — 진짜 ZIP 인가, 필요한 게 다 들었는가, 오프라인에서 열리는가
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { contentHash, sealRecord, newVerifyCode, SEAL_VER, fieldsHashOf } from "../src/esign.js";
import { buildEvidence } from "../src/evidence.js";
import { makeZip, crc32 } from "../src/zip.js";

let env, db, a, admin, u1, doc, pkg, DIR;
const BODY = Array.from({ length: 40 }, (_, i) => `제${i + 1}조 계약 조항.`).join("\n");

before(async () => {
  env = makeEnv(); db = env.DB;
  a = await D.createAssociation(db, { slug: "s", name: "서초 상인회" });
  const mk = (e, n, role) => D.createUser(db, { email: e, passwordHash: "h", salt: "s", name: n, role, associationId: a.id });
  admin = await mk("ad@x.kr", "관리자", "ADMIN");
  u1 = await mk("a@x.kr", "김일", "MERCHANT");
  doc = await D.createDocument(db, { associationId: a.id, title: "임대차 계약서", body: BODY, contentHash: await contentHash(BODY), createdBy: admin.id, ordered: 0, dueDate: "" });
  await D.createSignatureRequests(db, doc.id, [u1.id]);

  // 필드 배치 + 값 채우기 (서명 이미지는 R2 에 실제로 넣는다)
  await D.replaceFields(db, doc.id, [
    { kind: "sign", label: "임차인 서명", page: 0, x: 0.4, y: 0.8, w: 0.22, h: 0.05, assignee: u1.id, required: 1 },
    { kind: "date", label: "작성일", page: 0, x: 0.1, y: 0.9, w: 0.16, h: 0.03, assignee: u1.id, required: 1 },
  ]);
  const fields = await D.listFields(db, doc.id);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
  await env.MEDIA.put("sig1.png", png, { httpMetadata: { contentType: "image/png" } });
  const sf = fields.find((f) => f.kind === "sign");
  await D.setFieldValue(db, { fieldId: sf.id, documentId: doc.id, userId: u1.id, image: "sig1.png", imageHash: "ab".repeat(32) });
  await D.setFieldValue(db, { fieldId: fields.find((f) => f.kind === "date").id, documentId: doc.id, userId: u1.id, value: "2026-08-11" });

  // 실제 봉인된 서명
  const fh = await fieldsHashOf(await D.listFilledBy(db, doc.id, u1.id));
  const signedAt = "2026-08-11T01:02:03Z";
  const recordHash = await sealRecord(env, { documentId: doc.id, userId: u1.id, signerName: "김일",
    contentHash: doc.content_hash, signedAt, ip: "203.0.113.9", prevHash: "", fieldsHash: fh, ver: SEAL_VER });
  await D.createSignature(db, { documentId: doc.id, userId: u1.id, signerName: "김일", signatureImage: "sig1.png",
    contentHash: doc.content_hash, ip: "203.0.113.9", userAgent: "Mozilla/5.0 테스트", verifyCode: newVerifyCode(),
    recordHash, signedAt, prevHash: "", sealVer: SEAL_VER, verifyLevel: "otp", fieldsHash: fh });

  // 감사 추적
  await D.logDocEvent(db, { documentId: doc.id, userId: admin.id, actorName: "관리자", kind: "created", ip: "1.1.1.1" });
  await D.logDocEvent(db, { documentId: doc.id, userId: u1.id, actorName: "김일", kind: "viewed", ip: "203.0.113.9", userAgent: "Mozilla/5.0 테스트" });
  await D.logDocEvent(db, { documentId: doc.id, userId: u1.id, actorName: "김일", kind: "otp_ok", detail: "010-****-1234", ip: "203.0.113.9" });
  await D.logDocEvent(db, { documentId: doc.id, userId: u1.id, actorName: "김일", kind: "signed", ip: "203.0.113.9" });

  pkg = await buildEvidence(env, db, doc, a);
  DIR = mkdtempSync(path.join(tmpdir(), "evi-"));
  writeFileSync(path.join(DIR, "pkg.zip"), Buffer.from(pkg.zip));
});

// ---------- ZIP 자체 ----------
test("CRC-32 가 규격값과 맞는다", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("만들어진 파일은 진짜 ZIP 이고, 표준 도구로 풀린다", () => {
  const out = execFileSync("unzip", ["-t", path.join(DIR, "pkg.zip")], { encoding: "utf8" });
  assert.match(out, /No errors detected/i, "unzip 무결성 검사 통과");
});

test("한글 파일명이 깨지지 않는다 (UTF-8 플래그)", () => {
  execFileSync("unzip", ["-o", "-q", path.join(DIR, "pkg.zip"), "-d", path.join(DIR, "x")]);
  const names = readdirSync(path.join(DIR, "x"));
  assert.ok(names.includes("1_계약서_완성본.html"), `한글 이름 보존: ${names.join(", ")}`);
  assert.ok(names.includes("3_감사추적.csv"));
  assert.ok(names.includes("5_증적.json"));
});

test("빈 ZIP 도 규격에 맞는다", async () => {
  const z = await makeZip([]);
  assert.equal(z.length, 22, "EOCD 만 남아야 함");
  assert.deepEqual([...z.slice(0, 4)], [0x50, 0x4b, 0x05, 0x06]);
});

// 위 테스트는 이 기계에 깔린 unzip 이 어떻게 만들어졌느냐에 따라 결과가 갈린다.
// 이름이 깨지느냐 마느냐를 정하는 건 헤더 두 곳이므로, 그것 자체를 못 박아 둔다.
test("파일명 헤더가 UTF-8 · 유닉스로 적힌다", async () => {
  const z = await makeZip([{ name: "계약서.txt", data: "가" }]);
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  assert.equal(v.getUint16(6, true) & 0x0800, 0x0800, "로컬 헤더에 UTF-8 플래그");

  const cd = z.indexOf(0x50) >= 0 ? [...z].findIndex((_, i) =>
    z[i] === 0x50 && z[i + 1] === 0x4b && z[i + 2] === 0x01 && z[i + 3] === 0x02) : -1;
  assert.ok(cd > 0, "중앙 디렉터리를 찾음");
  assert.equal(v.getUint16(cd + 8, true) & 0x0800, 0x0800, "중앙 디렉터리에도 UTF-8 플래그");
  assert.equal(v.getUint16(cd + 4, true) >> 8, 3,
    "만든 시스템 = 유닉스 (MS-DOS 로 두면 압축 프로그램이 한글 이름을 코드페이지로 읽어 깨뜨린다)");
  assert.equal(v.getUint32(cd + 38, true) >>> 16, 0o100644, "유닉스 권한 rw-r--r--");

  const nameLen = v.getUint16(cd + 28, true);
  assert.equal(new TextDecoder().decode(z.slice(cd + 46, cd + 46 + nameLen)), "계약서.txt");
});

// ---------- 내용물 ----------
const read = (p) => readFileSync(path.join(DIR, "x", p), "utf8");

test("계약서 완성본은 외부 파일 없이 혼자 열린다", () => {
  const h = read("1_계약서_완성본.html");
  assert.match(h, /<style>/, "스타일이 파일 안에 있어야 함");
  assert.doesNotMatch(h, /<link[^>]+href=["']?\/|<script[^>]+src=/, "외부 CSS/JS 참조가 없어야 함");
  assert.match(h, /data:image\/png;base64,/, "서명 그림이 파일 안에 박혀 있어야 함");
  assert.match(h, /2026-08-11/, "입력한 날짜가 지면에 찍혀야 함");
  assert.match(h, /임대차 계약서/);
});

test("확인서에는 봉인 원문과 봉인값이 그대로 적힌다", () => {
  const dir = readdirSync(path.join(DIR, "x", "2_확인서"));
  assert.equal(dir.length, 1);
  const h = read(path.join("2_확인서", dir[0]));
  assert.match(h, /유효/, "판정이 유효여야 함");
  assert.match(h, /휴대폰 본인확인/, "본인확인 수준 표시");
  assert.match(h, /203\.0\.113\.9/, "접속 IP");
  assert.match(h, /봉인 원문/);
  assert.match(h, /입력값 해시/);
});

test("감사 추적 CSV 에 열람·인증·서명이 시간순으로 담긴다", () => {
  const csv = read("3_감사추적.csv");
  assert.ok(csv.startsWith("﻿"), "엑셀용 BOM");
  assert.match(csv, /계약서 열람/);
  assert.match(csv, /휴대폰 본인확인 완료/);
  assert.match(csv, /전자서명 완료/);
  const rows = csv.trim().split("\r\n");
  assert.equal(rows.length, 5, "헤더 + 4건");
});

test("검증 방법 문서에 공개키와 절차가 들어 있다", () => {
  const t = read("4_검증방법.txt");
  assert.match(t, /Ed25519/);
  assert.match(t, /"kty"/, "JWK 공개키 원문");
  assert.match(t, /지문/);
  assert.match(t, /①/, "절차가 번호로 정리되어야 함");
  assert.match(t, /자리만 옮기는 조작도 드러납니다/, "좌표 봉인 설명");
  assert.match(t, /서명 사슬\s+정상/);
});

test("증적 JSON 은 기계가 그대로 재검증할 수 있는 값을 담는다", () => {
  const j = JSON.parse(read("5_증적.json"));
  assert.equal(j.문서.본문해시, doc.content_hash);
  assert.equal(j.문서.본문, BODY, "본문 원본이 있어야 해시를 다시 계산할 수 있다");
  assert.equal(j.서명.length, 1);
  const s = j.서명[0];
  assert.ok(s.봉인원문.includes("김일"), "봉인 원문");
  assert.ok(s.봉인값.length > 40);
  assert.equal(s.판정.종합, true);
  assert.equal(s.본인확인, "otp");
  assert.equal(j.필드.length, 2);
  assert.ok(j.필드.every((f) => typeof f.좌표.x === "number"), "좌표가 들어야 재검증 가능");
  assert.equal(j.감사추적.length, 4);
  assert.ok(j.공개키.jwk.x, "공개키 JWK");
});

test("서명·도장 이미지 원본이 해시와 함께 들어간다", () => {
  const imgs = readdirSync(path.join(DIR, "x", "6_이미지"));
  assert.equal(imgs.length, 1);
  assert.match(imgs[0], /^01_임차인 서명_ababababa/, "파일명에 해시 앞자리");
  const bytes = readFileSync(path.join(DIR, "x", "6_이미지", imgs[0]));
  assert.deepEqual([...bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], "PNG 원본 그대로");
});

test("패키지 파일명에 문서 제목과 날짜가 들어간다", () => {
  assert.match(pkg.filename, /^증적_임대차 계약서_\d{4}-\d{2}-\d{2}\.zip$/);
  assert.ok(pkg.count >= 6);
});

// ---------- 위변조 상황 ----------
test("본문이 바뀐 뒤 다시 뽑으면 패키지가 '불일치'로 말한다", async () => {
  await db.prepare("UPDATE documents SET body=? WHERE id=?").bind(BODY + "\n몰래 추가한 조항", doc.id).run();
  const tampered = await D.getDocument(db, doc.id);
  const p2 = await buildEvidence(env, db, tampered, a);
  const dir2 = mkdtempSync(path.join(tmpdir(), "evi2-"));
  writeFileSync(path.join(dir2, "p.zip"), Buffer.from(p2.zip));
  execFileSync("unzip", ["-o", "-q", path.join(dir2, "p.zip"), "-d", path.join(dir2, "x")]);
  const j = JSON.parse(readFileSync(path.join(dir2, "x", "5_증적.json"), "utf8"));
  assert.equal(j.서명[0].판정.본문, false, "본문 변조를 잡아야 함");
  assert.equal(j.서명[0].판정.종합, false);
  const g = readFileSync(path.join(dir2, "x", "4_검증방법.txt"), "utf8");
  assert.match(g, /본문 불일치/, "안내문에도 드러나야 함");
});

// ---------- 백업 커버리지 ----------
test("주간 백업이 전자계약 데이터를 빠짐없이 담는다", async () => {
  const { runBackup } = await import("../src/scheduled.js");
  const { decryptBackup } = await import("../src/scheduled.js");
  const r = await runBackup(env);
  assert.ok(r.key, "백업 파일이 만들어져야 함");
  const obj = await env.MEDIA.get(r.key);
  const dump = JSON.parse(await decryptBackup(env.SESSION_SECRET, new Uint8Array(await obj.arrayBuffer())));
  // 봉인만 남고 '무엇을 어디에 채웠는지'가 없으면 계약서를 다시 그릴 수 없다
  for (const t of ["documents", "signatures", "doc_fields", "doc_field_values", "doc_events", "external_signers", "doc_templates"])
    assert.ok(Array.isArray(dump.tables[t]), `${t} 이 백업에 있어야 함`);
  assert.ok(dump.tables.doc_fields.length >= 2, "배치된 필드가 실제로 담겨야 함");
  assert.ok(dump.tables.doc_field_values.length >= 2, "채운 값도 담겨야 함");
  assert.ok(dump.tables.signatures.some((s) => s.fields_hash), "필드 봉인 해시도 함께");
});
