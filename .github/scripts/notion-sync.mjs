// 기본 브랜치에 푸시된 작업을 Notion `개발 및 제작 관리` DB 에 한 줄로 남긴다.
//
// 왜 있는가:
//   CLAUDE.md 의 규약은 Claude 가 작업할 때만 돈다. 사람이 직접 코드를 짜서 푸시하면
//   아무도 Notion 에 적지 않는다. 이 스크립트가 그 구멍을 메운다.
//
// 중복을 어떻게 피하나:
//   Claude 가 이미 Notion 에 적었으면 커밋 메시지 끝에 `Notion-Logged: yes` 를 남긴다.
//   그런 커밋은 여기서 건너뛴다. 트레일러가 없으면 이 스크립트가 적는다.
//   ※ Claude 가 트레일러를 빠뜨리면 줄이 두 개 생긴다. 그 편이 낫다 —
//     중복은 눈에 보여 지울 수 있지만, 누락은 아무도 모른다.
//
// 실행: node .github/scripts/notion-sync.mjs
//   필요한 환경변수: NOTION_TOKEN, GITHUB_EVENT_PATH
//   DRY_RUN=1 이면 Notion 에 쓰지 않고 만들 내용만 출력한다.

import { readFileSync } from "node:fs";

const NOTION_VERSION = "2025-09-03";
const DATA_SOURCE_ID = "2e30adee-652b-810e-8f87-000b403bf909"; // 개발 및 제작 관리
const ASSIGNEE_ID = "8bf51a1f-e0da-4589-bcf9-cf5fb747bd9e";

// 제품 페이지 — 바뀐 파일로 어느 제품 일인지 추정한다.
const PRODUCTS = {
  merchant: "3bb0adee-652b-81bc-8e1f-edeeaa4c9de0",
  esign: "3bb0adee-652b-8144-83a5-e5cd069745f3",
  franchise: "3bb0adee-652b-81ab-b2b5-d0e389a9d729",
};

// 파일 이름 → 제품. 여기 없는 파일은 '엔진 공용' 으로 보고 세 제품 모두에 건다
// (공용 파일이 바뀌면 실제로 세 제품이 다 영향을 받는다).
const FILE_HINTS = [
  [/esign|extsign|evidence|templates|paper|totp|apiv1/i, "esign"],
  [/franchise|leads|traffic|kinds/i, "franchise"],
  [/homeLayout|demoContent|starterContent|embed|media-render/i, "merchant"],
];

const DRY_RUN = process.env.DRY_RUN === "1";

// ── 커밋 고르기 ──────────────────────────────────────────────────────
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const allCommits = event.commits || [];

// Claude 가 이미 적은 것 + 빈 푸시(브랜치 생성/삭제)는 제외
const commits = allCommits.filter((c) => !/^Notion-Logged:\s*yes\s*$/im.test(c.message || ""));

if (commits.length === 0) {
  const why = allCommits.length === 0 ? "커밋 없음" : "전부 Claude 가 이미 기록함";
  console.log(`건너뜀 — ${why}`);
  process.exit(0);
}

// ── 제목 · 본문 만들기 ───────────────────────────────────────────────
const subject = (msg) =>
  (msg || "").split("\n")[0].replace(/\s*\(#\d+\)\s*$/, "").trim() || "(제목 없음)";

const newest = commits[commits.length - 1];
const title =
  commits.length === 1
    ? subject(newest.message)
    : `${subject(newest.message)} 외 ${commits.length - 1}건`;

// 기한 = 마지막 커밋 날짜 (한국 시간 기준)
const kstDate = new Date(newest.timestamp || Date.now())
  .toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }); // YYYY-MM-DD

// 어느 제품인가
const touched = commits.flatMap((c) => [...(c.added || []), ...(c.modified || []), ...(c.removed || [])]);
const matched = new Set();
for (const file of touched) {
  for (const [re, product] of FILE_HINTS) if (re.test(file)) matched.add(product);
}
const productKeys = matched.size > 0 ? [...matched] : Object.keys(PRODUCTS);
const engineWide = matched.size === 0;

// ── Notion 블록 ─────────────────────────────────────────────────────
const CHUNK = 1900; // Notion rich_text 한 조각 상한(2000)보다 여유 있게
const chunks = (s) => {
  const out = [];
  for (let i = 0; i < s.length; i += CHUNK) out.push(s.slice(i, i + CHUNK));
  return out.length ? out : [""];
};
const text = (s) => chunks(s).map((content) => ({ type: "text", text: { content } }));
const para = (s) => ({ object: "block", type: "paragraph", paragraph: { rich_text: text(s) } });
const bullet = (s) => ({
  object: "block",
  type: "bulleted_list_item",
  bulleted_list_item: { rich_text: text(s) },
});

const children = [
  {
    object: "block",
    type: "callout",
    callout: {
      icon: { type: "emoji", emoji: "🤖" },
      rich_text: text(
        "커밋 기록에서 자동으로 만든 줄입니다. 무엇이 좋아졌는지가 안 읽히면 사람이 고쳐 주세요 — " +
          "이 DB 는 기획자가 읽는 문서입니다."
      ),
    },
  },
  para(engineWide ? "공용 코드가 바뀌어 세 제품 모두에 걸었습니다." : "바뀐 파일로 추정한 제품입니다."),
  { object: "block", type: "heading_3", heading_3: { rich_text: text("커밋") } },
];

for (const c of commits) {
  children.push(bullet(subject(c.message)));
  const body = (c.message || "").split("\n").slice(1).join("\n").trim();
  if (body) children.push(para(body.slice(0, CHUNK * 2)));
}

if (event.compare) {
  children.push(para(`변경 내역: ${event.compare}`));
}

const page = {
  icon: { type: "emoji", emoji: "🤖" },
  properties: {
    이름: { title: text(title.slice(0, 200)) },
    상태: { status: { name: "완료" } },
    기한: { date: { start: kstDate } },
    제품: { relation: productKeys.map((k) => ({ id: PRODUCTS[k] })) },
    담당자: { people: [{ object: "user", id: ASSIGNEE_ID }] },
  },
  children: children.slice(0, 100), // 한 번에 만들 수 있는 블록 상한
};

// ── 보내기 ──────────────────────────────────────────────────────────
console.log(`제목:   ${title}`);
console.log(`기한:   ${kstDate}`);
console.log(`제품:   ${productKeys.join(", ")}${engineWide ? " (공용 변경)" : ""}`);
console.log(`커밋:   ${commits.length}건 (전체 ${allCommits.length}건 중)`);

// Notion API 는 데이터 원본(data source) 개념이 생기면서 부모를 지정하는 방식이 갈렸다.
// 어느 쪽이 받아들여질지 계정·통합 설정에 따라 다르므로 신형을 먼저 쓰고 구형으로 물러선다.
const ATTEMPTS = [
  { label: "data_source_id (2025-09-03)", version: "2025-09-03",
    parent: { type: "data_source_id", data_source_id: DATA_SOURCE_ID } },
  { label: "database_id (2022-06-28)", version: "2022-06-28",
    parent: { type: "database_id", database_id: DATA_SOURCE_ID } },
];

if (DRY_RUN) {
  console.log("\nDRY_RUN — Notion 에 쓰지 않았습니다.");
  if (process.env.DEBUG_PAYLOAD === "1") {
    console.log(JSON.stringify({ ...page, parent: ATTEMPTS[0].parent }, null, 2));
  }
  process.exit(0);
}

let lastError = "";
for (const attempt of ATTEMPTS) {
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": attempt.version,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...page, parent: attempt.parent }),
  });

  if (res.ok) {
    const created = await res.json();
    console.log(`\n기록했습니다 (${attempt.label}): ${created.url || created.id}`);
    process.exit(0);
  }

  lastError = `[${attempt.label}] HTTP ${res.status} — ${await res.text()}`;
  console.log(`${attempt.label} 실패, 다음 방식으로 재시도합니다.`);
}

console.error(`\nNotion 이 두 방식 모두 거절했습니다.\n${lastError}`);
console.error(
  "\n확인할 것:\n" +
    "  1) NOTION_TOKEN 시크릿이 올바른지 (ntn_ 로 시작)\n" +
    "  2) 그 통합(integration)이 `개발 및 제작 관리` DB 에 연결돼 있는지\n" +
    "  3) 제품 페이지 3개에도 연결돼 있는지 (연결이 없으면 relation 을 걸 수 없습니다)"
);
process.exit(1);
