// 기사를 '지금' 모은다 — 아침 크론을 기다리지 않고.
//
// 왜 러너에서 도나.
//   수집은 워커(크론)와 관리 화면의 [지금 한 번 찾아보기] 가 이미 한다. 그런데 둘 다
//   사이트에 들어가야 눌린다. 작업 환경에서는 라이브에 닿지 못하므로, 인터넷이 열려 있는
//   깃허브 러너에서 **제품과 똑같은 코드**(cloudflare/src/press.js)를 불러 돌린다.
//   해석·거르개를 여기에 다시 쓰지 않는다 — 두 벌이 되면 언젠가 한쪽만 고쳐진다.
//
// 열쇠.
//   네이버 검색 열쇠는 라이브 DB 의 settings 에 있다. 여기서 한 번 읽어 쓰고,
//   읽자마자 ::add-mask:: 로 가린다 — 로그·요약 어디에도 값이 찍히지 않는다.
//
// 쓰기.
//   찾은 줄은 **대기(new)** 로만 넣는다. 홈에 올리는 판단은 여기서 하지 않는다.
//   같은 주소는 UNIQUE 로 걸러져 두 번 돌려도 줄이 늘지 않는다.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collect, parseTerms } from "../../cloudflare/src/press.js";

const DB = "seocho-db";
const wrangler = (args) =>
  execFileSync("npx", ["--yes", "wrangler@4", "d1", "execute", DB, "--remote", "--yes", ...args],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

// --json 은 앞뒤에 다른 줄이 섞여 나올 수 있어 첫 '[' 부터 읽는다
function query(sql) {
  const out = wrangler(["--json", "--command", sql]);
  const i = out.indexOf("[");
  if (i < 0) throw new Error("질의 결과를 읽지 못했습니다");
  return JSON.parse(out.slice(i))[0].results || [];
}

// SQL 문자열 리터럴로 들어갈 값. 기사 제목은 남이 쓴 글이므로 그대로 믿지 않는다.
const q = (v) => "'" + String(v == null ? "" : v)
  .replace(/[\u0000-\u001f\u007f]/g, " ")   // 제어문자는 공백으로
  .replace(/'/g, "''")                        // 작은따옴표는 두 개로
  .slice(0, 500) + "'";

const keys = Object.fromEntries(query(
  "SELECT key, value FROM settings WHERE key IN ('key_NAVER_SEARCH_ID','key_NAVER_SEARCH_SECRET')"
).map((r) => [r.key, r.value]));
const env = {
  NAVER_SEARCH_ID: keys.key_NAVER_SEARCH_ID || "",
  NAVER_SEARCH_SECRET: keys.key_NAVER_SEARCH_SECRET || "",
};
for (const v of Object.values(env)) if (v) console.log("::add-mask::" + v);
console.log(env.NAVER_SEARCH_ID && env.NAVER_SEARCH_SECRET
  ? "네이버 검색 열쇠: 있음 (뉴스·블로그 + 구글 뉴스)"
  : "네이버 검색 열쇠: 없음 — 구글 뉴스만 봅니다");

// 수집을 켜 둔 상인회만
const orgs = query(`SELECT a.id, a.name,
    (SELECT value FROM settings WHERE key = 'press_on:' || a.id) AS on_,
    (SELECT value FROM settings WHERE key = 'press_terms:' || a.id) AS terms
  FROM associations a WHERE a.kind = 'merchant'`).filter((o) => String(o.on_) === "1");

if (!orgs.length) {
  console.log("수집을 켜 둔 상인회가 없습니다. 관리 화면 › 언론 보도에서 켜 주세요.");
  process.exit(0);
}

const lines = [];
let found = 0;
for (const o of orgs) {
  const terms = parseTerms(o.terms, o.name);
  // 여기서는 사람이 기다리고 있다. 평소(24건)보다 넉넉히 가져온다.
  const items = await collect(env, { terms, max: 60 });
  found += items.length;
  console.log(`\n■ ${o.name} — 찾은 글 ${items.length}건 (검색어: ${terms.include.join(" · ")})`);
  for (const it of items) {
    console.log(`   · [${it.source}] ${it.date || "날짜없음"} ${it.title}`);
    lines.push(`INSERT INTO press (association_id, title, url, source, published_at, snippet, kind, term) VALUES (`
      + `${Number(o.id)}, ${q(it.title)}, ${q(it.url)}, ${q(it.source)}, ${q(it.date)}, ${q(it.snippet)}, `
      + `${q(it.kind === "blog" ? "blog" : "news")}, ${q(terms.include[0] || "")})`
      + ` ON CONFLICT(association_id, url) DO NOTHING;`);
  }
}

if (!lines.length) {
  console.log("\n새로 찾은 글이 없습니다. 검색어를 넓혀 보세요.");
  process.exit(0);
}
const file = path.join(tmpdir(), "press-insert.sql");
writeFileSync(file, lines.join("\n") + "\n", "utf8");
console.log(`\n${lines.length}줄을 대기 줄에 넣습니다 (이미 있는 주소는 자동으로 건너뜁니다).`);
console.log(wrangler(["--file", file]));

const after = query("SELECT status, COUNT(*) AS n FROM press GROUP BY status");
console.log("\n지금 대기 줄:", after.map((r) => `${r.status} ${r.n}건`).join(" · ") || "비어 있음");
console.log("찾은 글 " + found + "건 · 홈에는 아직 아무것도 안 뜹니다 — 고른 것만 올라갑니다.");
