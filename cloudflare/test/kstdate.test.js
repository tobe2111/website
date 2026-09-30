// 날짜는 한국 달력으로 센다 — UTC 로 세면 하루에 아홉 시간씩 틀린다.
//
// 워커는 UTC 로 돌고 SQLite 의 date('now') 도 UTC 다. 그런데 이 서비스를 쓰는 사람은
// 전부 한국에 있다. 한국시간 0시부터 9시까지는 UTC 가 아직 어제여서, 그 아홉 시간 동안
// "오늘" 을 물으면 어제가 돌아온다. 실제로 이것 때문에 두 가지가 조용히 틀렸다:
//   · 알림톡 정산이 매월 1일 0~9시 발송분을 지난달에 넣었다 (돈이 걸린 집계다)
//   · 계약서 기한이 아홉 시간 더 열려 있고, 화면은 '오늘까지' 를 '1일 남음' 으로 적었다
//
// 이 검사는 **몇 시에 돌려도** 그 셈법이 한국 기준인지를 본다. 시계를 직접 밀어 넣어
// 그 아홉 시간 안에 있는 것처럼 만들기 때문에, 낮에 돌려도 버그가 잡힌다.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/db.js";
import { isOverdue } from "../src/pages.js";
import { makeEnv } from "./shim.js";

// 한국시간 2026-10-01 01:30 = UTC 2026-09-30 16:30 — 날짜가 갈리는 그 아홉 시간 안이다
const 새벽 = Date.parse("2026-09-30T16:30:00Z");

test("kstToday: 한국 새벽에는 UTC 와 하루가 다르다", () => {
  assert.equal(new Date(새벽).toISOString().slice(0, 10), "2026-09-30", "UTC 로는 어제");
  assert.equal(D.kstToday(새벽), "2026-10-01", "한국으로는 오늘");
});

test("계약 기한: 한국 날짜로 판정한다 — 어제 날짜가 아직 안 지난 것이 되면 안 된다", () => {
  // 한국에서 어제(9/30)가 기한인 계약은 이미 지난 것이다.
  // UTC 로 재면 'UTC 오늘' 과 같아서 '아직 안 지남' 이 되고, 아홉 시간 뒤 스스로 만료된다.
  assert.equal(isOverdue({ closed: 0, due_date: "2026-09-30" }, 새벽), true, "한국 어제 = 지남");
  assert.equal(isOverdue({ closed: 0, due_date: "2026-10-01" }, 새벽), false, "한국 오늘 = 아직");
  assert.equal(isOverdue({ closed: 0, due_date: "2026-10-02" }, 새벽), false);
  assert.equal(isOverdue({ closed: 1, due_date: "2026-09-30" }, 새벽), false, "마감된 문서는 기한을 따지지 않는다");
});

test("기한 판정 SQL 도 한국 날짜를 쓴다", async () => {
  // date('now') 는 UTC 다. 문서 기한을 다루는 질의가 그걸 그대로 쓰면,
  // 화면(자바스크립트·한국 기준)과 목록(SQL·UTC 기준)이 아홉 시간 동안 서로 다른 말을 한다.
  const src = await import("node:fs").then((fs) => fs.readFileSync("cloudflare/src/db.js", "utf8"));
  // 한국 날짜를 뜻하는 이름이 한 곳에 정의돼 있고, +9시간이 들어 있어야 한다
  assert.match(src, /const KST_DATE = "date\('now','\+9 hours'\)"/, "SQL 용 '한국 오늘' 정의");
  // 그리고 기한을 재는 줄 중 어느 것도 맨 date('now') 를 쓰면 안 된다
  const 맨UTC = src.split("\n").filter((l) => /due_date[^\n]*\bdate\('now'\)/.test(l));
  assert.deepEqual(맨UTC.map((l) => l.trim()), [], "UTC 로 기한을 재는 줄이 남아 있다");
  // 기한을 KST_DATE 로 재는 줄이 실제로 여럿 있어야 한다 (지움이 아니라 고침인지 확인)
  const 고친줄 = src.split("\n").filter((l) => /due_date[^\n]*KST_DATE/.test(l));
  assert.ok(고친줄.length >= 3, `기한을 한국 날짜로 재는 줄 (찾은 줄 ${고친줄.length})`);
});

test("정산은 한국 달력으로 달을 끊는다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "m", name: "상인회", kind: "merchant" });
  await D.logMessage(env.DB, { associationId: a.id, kind: "sign_request", recipient: "010****",
    status: "sent", cost: 22, costBase: 650, ref: "R", detail: "" });
  // 방금 남긴 기록은 '한국의 이번 달' 정산에 잡혀야 한다. UTC 로 끊으면 새벽에는 지난달로 간다.
  const 한국이번달 = D.kstToday().slice(0, 7);
  const rows = await D.monthlySettlement(env.DB, 한국이번달);
  assert.equal(rows.length, 1, `${한국이번달} 정산에 잡혀야 한다`);
  assert.equal(rows[0].revenue, 22);
  assert.deepEqual((await D.settlementMonths(env.DB)).map((r) => r.m), [한국이번달]);
});
