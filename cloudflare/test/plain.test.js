// 화면에 이모지를 다시 들이지 않는다.
//
// 이모지로 도배된 카드·버튼은 "AI가 만든 티" 로 곧장 읽힌다. 한 번 걷어내도
// 새 화면을 만들 때마다 하나씩 다시 붙기 때문에, 실제로 그려진 HTML 을 보고 막는다.
//
// 허용하는 것은 뜻이 있는 활자 기호뿐이다:
//   ← → ↗  길 안내(뒤로·바깥 링크)      ▲ ▼  순서 바꾸기 단추
//   ▶       심사받은 알림톡 문구 안의 글머리 — 카카오가 승인한 원문이라 한 글자도 못 바꾼다
//   ○ ●     예시 이름(○○상사)·가려진 금액
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { contentHash } from "../src/esign.js";

const B = "http://localhost";
// 뜻을 가진 활자 기호는 이모지가 아니다 — 이것만 통과시킨다
const ALLOW = new Set(["←", "→", "↗", "↔", "▲", "▼", "▶", "○", "●", "♥", "✔", "★", "·"]);
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;

test("화면에 이모지가 없다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "s", name: "서초구 상인회", kind: "merchant" });
  const law = await D.createAssociation(env.DB, { slug: "law", name: "한빛법무법인", kind: "esign" });
  const pw = await hashPassword("pass1234");
  const mk = (e, r, id) => D.createUser(env.DB, { email: e, passwordHash: pw.hash, salt: pw.salt, name: "이름", role: r, associationId: id });
  await mk("sp@x.kr", "SUPERADMIN", null); await mk("ad@x.kr", "ADMIN", a.id); await mk("lw@x.kr", "ADMIN", law.id);
  const body = "제1조 계약.";
  const d = await D.createDocument(env.DB, { associationId: law.id, title: "용역 계약서", body,
    contentHash: await contentHash(body), createdBy: null, ordered: 0, dueDate: "" });
  await D.addExternalSigner(env.DB, { documentId: d.id, name: "김상대", signOrder: 1 });

  const f = (p, i = {}) => worker.fetch(new Request(B + p, { redirect: "manual", ...i }), env, { waitUntil() {}, passThroughOnException() {} });
  const login = async (email) => {
    const g = await f("/login");
    const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
    const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
    const r = await f("/login", { method: "POST", headers: { cookie: seed, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: tk, email, password: "pass1234" }) });
    return [seed, ...(r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");
  };
  const [sp, ad, lw] = [await login("sp@x.kr"), await login("ad@x.kr"), await login("lw@x.kr")];
  const PAGES = [["/", ""], ["/esign", ""], ["/homepage", ""], ["/t/s/", ""], ["/t/s/businesses", ""],
    ["/super", sp], [`/super/org/${a.id}`, sp], ["/t/s/admin", ad],
    ["/t/law/admin/documents", lw], [`/t/law/admin/documents/${d.id}`, lw],
    [`/t/law/admin/documents/${d.id}/fields`, lw]];

  const found = [];
  for (const [p, jar] of PAGES) {
    const r = await f(p, { headers: jar ? { cookie: jar } : {} });
    assert.equal(r.status, 200, `${p} 가 안 열림`);
    // <style>·<script> 안은 화면 글자가 아니므로 뺀다
    const text = (await r.text()).replace(/<(style|script)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ");
    for (const m of text.matchAll(EMOJI)) {
      if (ALLOW.has(m[0])) continue;
      found.push(`${p} … ${text.slice(Math.max(0, m.index - 20), m.index + 20).replace(/\s+/g, " ").trim()}`);
    }
  }
  assert.deepEqual(found, [], "화면에 이모지가 남아 있습니다:\n  " + found.join("\n  "));
});

// 알림톡 문구는 카카오가 심사한 원문이다. 여기 있는 ▶ 는 장식이 아니라 승인된 글자라
// 한 글자만 바꿔도 그 종류가 통째로 반려된다 — 이모지 청소가 여기까지 오면 안 된다.
test("심사받은 알림톡 문구는 건드리지 않는다", async () => {
  const { TEMPLATES } = await import("../src/notify.js");
  for (const kind of ["sign_request", "sign_remind", "sign_done", "lead_new", "notice"])
    assert.match(TEMPLATES[kind].body, /▶ /, `${kind} 문구의 글머리가 사라졌다 — 카카오 승인이 무효가 된다`);
});
