// 역할·서명 대상 판정 — "누가 무엇을 할 수 있는가"
import { test, before } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import { hashPassword } from "../src/crypto.js";
import * as D from "../src/db.js";
import { contentHash } from "../src/esign.js";

let env, db, esignOrg, member;
const BASE = "http://localhost";

before(async () => {
  env = makeEnv(); db = env.DB;
  esignOrg = await D.createAssociation(db, { slug: "eo", name: "전자계약조직", kind: "esign" });
  const h = await hashPassword("password1234");
  member = await D.createUser(db, { email: "m@x.kr", passwordHash: h.hash, salt: h.salt, name: "직원", role: "MERCHANT", associationId: esignOrg.id });
});

// ---------- 서명 대상 판정 ----------
// 외부 서명자도 '대상'이다. 이걸 빠뜨리면 API·서식으로 만든 계약(서명자가 전부 외부)이
// signature_requests 가 비었다는 이유로 조직 회원 전원에게 열린다.
test("외부 서명자만 있는 계약은 사내 회원에게 열리지 않는다", async () => {
  const d = await D.createDocument(db, { associationId: esignOrg.id, title: "외부 전용", body: "본문",
    contentHash: await contentHash("본문"), createdBy: null, ordered: 0, dueDate: "" });
  await D.addExternalSigner(db, { documentId: d.id, name: "상대방", email: "x@y.kr", signOrder: 1 });
  assert.equal(await D.canReceiveSign(db, d.id, member.id), false, "서명 대상이 아니어야 함");
  assert.ok(!(await D.listDocumentsToSign(db, esignOrg.id, member.id)).some((x) => x.id === d.id),
    "서명 목록에도 뜨면 안 됨");
});

test("대상이 아예 없는 문서는 여전히 회원 전체 대상 (기존 동작 유지)", async () => {
  const d = await D.createDocument(db, { associationId: esignOrg.id, title: "전체 공개", body: "본문",
    contentHash: await contentHash("본문"), createdBy: null, ordered: 0, dueDate: "" });
  assert.equal(await D.canReceiveSign(db, d.id, member.id), true);
  assert.ok((await D.listDocumentsToSign(db, esignOrg.id, member.id)).some((x) => x.id === d.id));
});

test("회원이 대상으로 지정되면 외부 서명자가 함께 있어도 열린다", async () => {
  const d = await D.createDocument(db, { associationId: esignOrg.id, title: "혼합", body: "본문",
    contentHash: await contentHash("본문"), createdBy: null, ordered: 0, dueDate: "" });
  await D.addExternalSigner(db, { documentId: d.id, name: "상대방", email: "x@y.kr", signOrder: 1 });
  await D.createSignatureRequests(db, d.id, [member.id]);
  assert.equal(await D.canReceiveSign(db, d.id, member.id), true);
  assert.ok((await D.listDocumentsToSign(db, esignOrg.id, member.id)).some((x) => x.id === d.id));
});

test("서명 화면에서도 같은 규칙이 강제된다 (목록만 가리는 게 아니다)", async () => {
  const d = await D.createDocument(db, { associationId: esignOrg.id, title: "직접 접근", body: "본문",
    contentHash: await contentHash("본문"), createdBy: null, ordered: 0, dueDate: "" });
  await D.addExternalSigner(db, { documentId: d.id, name: "상대방", email: "x@y.kr", signOrder: 1 });
  const seed = await worker.fetch(new Request(`${BASE}/login`), env);
  const j0 = (seed.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(await seed.text()) || [])[1];
  const lr = await worker.fetch(new Request(`${BASE}/login`, { method: "POST", redirect: "manual",
    headers: { cookie: j0, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, email: "m@x.kr", password: "password1234" }).toString() }), env);
  const jar = [j0, (lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ")].filter(Boolean).join("; ");
  const r = await worker.fetch(new Request(`${BASE}/t/eo/sign/${d.id}`, { headers: { cookie: jar }, redirect: "manual" }), env);
  assert.ok(r.status >= 300, "URL 을 직접 쳐도 막혀야 함");
  assert.match(r.headers.get("location") || "", /err=1/);
});
