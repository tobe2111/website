// 알림톡 없이 '링크를 손으로 보내는' 길이 끝까지 되는지 실주행한다.
// 알리고 심사가 몇 주 걸릴 수 있고, 그동안에도 고객사는 계약을 보내야 한다.
// 이 길이 막히면 제품이 통째로 멈추므로, 단위 테스트와 별도로 처음부터 끝까지 한 번 달려 본다.
// 실행: npm run test:manual
import worker from "../src/index.js";
import { makeEnv } from "../test/shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { verifySignature } from "../src/esign.js";
const BASE = "http://localhost";
const env = makeEnv();                       // 알리고 키 없음 = 심사 대기 중 상태
let ok = 0, bad = 0;
const t = (name, cond) => { if (cond) { ok++; console.log("  ✓ " + name); } else { bad++; console.log("  ✗ " + name); } };
const f = (p, i = {}) => worker.fetch(new Request(BASE + p, { redirect: "manual", ...i }), env);
const jarOf = (r) => (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
const csrfOf = async (cookie, path) => (/name="_csrf" value="([^"]+)"/.exec(await (await f(path, { headers: { cookie } })).text()) || [])[1];
const post = (p, cookie, body) => f(p, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });

const a = await D.createAssociation(env.DB, { slug: "law", name: "한빛법무법인", kind: "esign" });
const pw = await hashPassword("admin1234");
await D.createUser(env.DB, { email: "ad@law.kr", passwordHash: pw.hash, salt: pw.salt, name: "관리자", role: "ADMIN", associationId: a.id });
const g = await f("/login"); const seed = jarOf(g);
const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
const lr = await post("/login", seed, { _csrf: tk, email: "ad@law.kr", password: "admin1234" });
const jar = [seed, jarOf(lr)].filter(Boolean).join("; ");

console.log("\n1) 계약서를 만든다 (알림톡 꺼짐)");
const dcsrf = await csrfOf(jar, "/t/law/admin/documents");
const cr = await post("/t/law/admin/documents", jar, { _csrf: dcsrf, title: "용역 계약서", body: "제1조 …\n제2조 …", target: "none" });
const loc = decodeURIComponent(cr.headers.get("location") || "");
t("문서 목록이 아니라 그 문서로 보낸다", /\/admin\/documents\/\d+\?/.test(loc));
t("링크를 직접 보내라고 알려준다", /보내기 · 복사/.test(loc));
const docId = Number(loc.match(/documents\/(\d+)/)[1]);

console.log("\n2) 연락처 없이 외부 상대방을 추가한다");
const path = `/t/law/admin/documents/${docId}`;
const c2 = await csrfOf(jar, path);
const ar = await post(`${path}/external`, jar, { _csrf: c2, name: "김상대", org: "○○상사" });
t("연락처가 없어도 막지 않는다", !/err=1/.test(ar.headers.get("location") || ""));

console.log("\n3) 문서 화면에서 링크를 다시 꺼낸다 (창을 닫았다 다시 열어도)");
const page = await (await f(path, { headers: { cookie: jar } })).text();
const link = (page.match(/data-share-url="([^"]*\/esign\/[^"]+)"/) || [])[1] || "";
t("링크가 화면에 그대로 있다", !!link);
t("붙여 넣을 말까지 준비돼 있다", /data-share-text="[^"]*전자서명 요청/.test(page));
t("버튼을 살리는 스크립트가 실려 있다", /share\.js/.test(page));
t("자동 발송이 꺼졌음을 말해 준다", /자동 발송이 꺼져 있습니다/.test(page));

console.log("\n4) 받은 사람이 그 링크로 로그인 없이 서명한다");
const token = link.split("/esign/")[1];
const sp = await f(`/esign/${token}`);
t("링크만으로 계약서가 열린다", sp.status === 200);
const spHtml = await sp.text();
const scookie = jarOf(sp);
const scsrf = (/name="_csrf" value="([^"]+)"/.exec(spHtml) || [])[1];
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const sr = await post(`/esign/${token}`, scookie, { _csrf: scsrf, consent: "1", signature: PNG, signer_name: "김상대" });
t("서명이 접수된다", !/err=1/.test(sr.headers.get("location") || ""));
const sigs = await D.listSignatures(env.DB, docId);
t("서명이 1건 남는다", sigs.length === 1);
t("Ed25519 봉인이 검증된다", sigs.length === 1 && (await verifySignature(env, sigs[0], await D.getDocument(env.DB, docId))).valid === true);

console.log(`\n결과: ${ok} 통과 / ${bad} 실패`);
process.exit(bad ? 1 : 0);
