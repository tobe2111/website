// 페이지별 D1 쿼리 수 — 워커는 쿼리마다 네트워크 왕복이라 개수가 곧 응답 속도이고,
// 무료 티어 한도(하루 500만 읽기)도 여기서 소진된다. N+1 이 숨어 있으면 데이터가 늘수록
// 조용히 느려지므로, 데이터를 늘려 가며 '쿼리 수가 같이 늘어나는 곳'을 찾는다.
//   실행: npm run test:perf
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = (await import(path.join(ROOT, "src/index.js"))).default;
const { makeEnv } = await import(path.join(ROOT, "test/shim.js"));
const D = await import(path.join(ROOT, "src/db.js"));
const E = await import(path.join(ROOT, "src/esign.js"));
const { hashPassword } = await import(path.join(ROOT, "src/crypto.js"));

globalThis.fetch = async () => new Response("ok");
const BASE = "http://localhost";
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ✓", n, x); } else { fail++; console.error("  ✗", n, x); } };

// 규모를 바꿔 가며 같은 화면의 쿼리 수를 잰다
async function build(scale) {
  const env = makeEnv({ PUBLIC_ORIGIN: "https://x.kr" });
  const h = await hashPassword("password1234");
  const a = await D.createAssociation(env.DB, { slug: "seochogu", name: "서초구 상인회" });
  const eo = await D.createAssociation(env.DB, { slug: "hanbit", name: "한빛법무법인", kind: "esign" });
  const admin = await D.createUser(env.DB, { email: "a@s.kr", passwordHash: h.hash, salt: h.salt, name: "관리자", role: "ADMIN", associationId: a.id });
  await D.createUser(env.DB, { email: "s@p.kr", passwordHash: h.hash, salt: h.salt, name: "슈퍼", role: "SUPERADMIN", associationId: null });
  await D.createUser(env.DB, { email: "eb@h.kr", passwordHash: h.hash, salt: h.salt, name: "대표", role: "ADMIN", associationId: eo.id });
  for (let i = 0; i < scale; i++) {
    const u = await D.createUser(env.DB, { email: `o${i}@s.kr`, passwordHash: h.hash, salt: h.salt, name: `사장${i}`, role: "MERCHANT", associationId: a.id });
    const b = await D.createBusiness(env.DB, { associationId: a.id, ownerId: u.id, name: `가게${i}`, category: "음식점" });
    await D.setBusinessStatus(env.DB, b.id, "approved");
    await D.createNotice(env.DB, { associationId: a.id, title: `공지${i}`, body: "내용", createdBy: admin.id });
    const body = `계약 본문 ${i}`;
    const d = await D.createDocument(env.DB, { associationId: eo.id, title: `계약${i}`, body,
      contentHash: await E.contentHash(body), createdBy: admin.id, ordered: 0, dueDate: "" });
    await D.addExternalSigner(env.DB, { documentId: d.id, name: `상대${i}`, email: `x${i}@y.kr`, signOrder: 1 });
  }
  return env;
}
const jarOf = (r) => (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
async function loginJar(env, email) {
  const g = await worker.fetch(new Request(BASE + "/login"), env, { waitUntil() {}, passThroughOnException() {} });
  const j0 = jarOf(g);
  const csrf = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
  const r = await worker.fetch(new Request(BASE + "/login", { method: "POST", redirect: "manual",
    headers: { cookie: j0, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _csrf: csrf, email, password: "password1234" }).toString() }), env, { waitUntil() {}, passThroughOnException() {} });
  return [j0, jarOf(r)].filter(Boolean).join("; ");
}
// Server-Timing 에서 쿼리 수를 읽는다 (워커가 스스로 내보내는 값)
async function q(env, p, jar = "") {
  const r = await worker.fetch(new Request(BASE + p, { headers: jar ? { cookie: jar } : {} }), env,
    { waitUntil() {}, passThroughOnException() {} });
  const st = r.headers.get("Server-Timing") || "";
  const n = Number((st.match(/D1 (\d+) queries/) || [])[1] ?? -1);
  return { n, status: r.status };
}

console.log("═══ 페이지별 D1 쿼리 수 ═══\n");
const small = await build(3);
const big = await build(30); // 10배
const jarS = { admin: await loginJar(small, "a@s.kr"), super: await loginJar(small, "s@p.kr"), esign: await loginJar(small, "eb@h.kr") };
const jarB = { admin: await loginJar(big, "a@s.kr"), super: await loginJar(big, "s@p.kr"), esign: await loginJar(big, "eb@h.kr") };

const PAGES = [
  ["상인회 홈", "/t/seochogu", null],
  ["점포 목록", "/t/seochogu/businesses", null],
  ["점포 지도", "/t/seochogu/map", null],
  ["공지 목록", "/t/seochogu/notices", null],
  ["전자계약 랜딩", "/esign", null],
  ["로그인", "/login", null],
  ["관리자 콘솔", "/t/seochogu/admin", "admin"],
  ["계약서 목록", "/t/hanbit/admin/documents", "esign"],
  ["슈퍼 콘솔", "/super", "super"],
];

console.log("  화면                 3건   30건   증가   판정");
console.log("  " + "─".repeat(52));
const rows = [];
for (const [label, p, who] of PAGES) {
  const a = await q(small, p, who ? jarS[who] : "");
  const b = await q(big, p, who ? jarB[who] : "");
  const grow = b.n - a.n;
  rows.push({ label, p, a: a.n, b: b.n, grow, status: b.status });
  const verdict = grow <= 2 ? "고정" : grow < 20 ? `+${grow} 주의` : `+${grow} N+1`;
  console.log(`  ${label.padEnd(18)} ${String(a.n).padStart(4)} ${String(b.n).padStart(6)} ${String(grow >= 0 ? "+" + grow : grow).padStart(6)}   ${verdict}`);
}
console.log("");

// 데이터가 10배가 돼도 쿼리 수는 거의 같아야 한다 (목록은 한 번에 읽어야 한다)
const np1 = rows.filter((r) => r.grow >= 20);
ok(np1.length === 0, "데이터가 10배여도 쿼리 수가 폭증하는 화면 없음",
  np1.length ? np1.map((r) => `${r.label} +${r.grow}`).join(", ") : "");

// 손님이 보는 화면은 특히 가벼워야 한다 (검색엔진·첫 방문 체감)
const publicHeavy = rows.filter((r) => ["상인회 홈", "점포 목록", "전자계약 랜딩", "로그인"].includes(r.label) && r.b > 25);
ok(publicHeavy.length === 0, "공개 화면이 25쿼리 이하",
  publicHeavy.length ? publicHeavy.map((r) => `${r.label} ${r.b}`).join(", ") : rows.filter((r) => !r.p.includes("admin") && r.p !== "/super").map((r) => `${r.label} ${r.b}`).join(" · "));

// 모든 화면이 정상 응답
ok(rows.every((r) => r.status === 200), "모든 화면 200",
  rows.filter((r) => r.status !== 200).map((r) => `${r.label} ${r.status}`).join(", "));

// 하루 한도 환산 — 무료 티어 500만 읽기
const worst = rows.reduce((m, r) => (r.b > m.b ? r : m), rows[0]);
const heaviest = rows.filter((r) => r.b > 0).sort((x, y) => y.b - x.b).slice(0, 3);
console.log(`  가장 무거운 화면: ${heaviest.map((r) => `${r.label} ${r.b}`).join(" · ")}`);
console.log(`  무료 티어(하루 500만 읽기) 기준 — ${worst.label} 만 계속 열어도 하루 ${Math.floor(5e6 / worst.b).toLocaleString()}회 가능`);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
