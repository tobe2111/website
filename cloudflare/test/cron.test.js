// 크론 표현식은 두 곳에 나뉘어 있다 — wrangler.toml(등록) 과 scheduled.js 의 CRON(분기).
// 어긋나면 아무도 모르게 엉뚱한 작업이 돌거나, 아예 하나도 등록되지 않는다.
//
// 실제로 그런 상태였다: 요일 자리에 0 을 쓴 "0 18 * * 0" 때문에 Cloudflare 의 크론 등록
// API 가 통째로 실패했고(code 10100 invalid cron string), 배포 로그 맨 끝에만 조용히
// 찍혔다. 세 개를 한 번의 API 호출로 등록하기 때문에 하나가 잘못되면 셋 다 등록되지 않는다
// — 주간 백업·일일 리마인더·웹훅 재전송이 전부 멈춘 채로 배포는 "성공"처럼 보였다.
//
// 그래서 배포 파일을 직접 읽어서 검사한다. 코드끼리만 비교하면 이 사고는 다시 난다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CRON } from "../src/scheduled.js";

const toml = readFileSync(fileURLToPath(new URL("../../wrangler.toml", import.meta.url)), "utf8");
// crons = [...] 한 줄을 뽑아 문자열만 걷어낸다 (주석 제외)
const cronsLine = (/^\s*crons\s*=\s*\[([^\]]*)\]/m.exec(toml) || [])[1] || "";
const deployed = [...cronsLine.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

test("wrangler.toml 의 크론과 코드의 CRON 이 정확히 같다", () => {
  assert.deepEqual([...deployed].sort(), Object.values(CRON).sort(),
    "한쪽만 고치면 분기가 어긋나 엉뚱한 작업이 돈다");
});

test("요일 자리에 0 을 쓰지 않는다 (Cloudflare 는 1-7/SUN-SAT 만 받는다)", () => {
  // 0 이 하나라도 있으면 등록 API 가 실패해 세 개 다 등록되지 않는다.
  for (const c of deployed) {
    const dow = c.trim().split(/\s+/)[4];
    assert.ok(dow !== undefined, `요일 자리가 없다: ${c}`);
    assert.ok(!/(^|[^0-9])0([^0-9]|$)/.test(dow),
      `요일에 0 이 있으면 크론 전체가 등록되지 않는다: ${c}`);
  }
});

test("크론은 다섯 자리이고 값의 범위가 Cloudflare 가 받는 범위 안이다", () => {
  // 분 0-59 · 시 0-23 · 일 1-31 · 월 1-12 · 요일 1-7(또는 이름)
  const RANGE = [[0, 59], [0, 23], [1, 31], [1, 12], [1, 7]];
  for (const c of deployed) {
    const f = c.trim().split(/\s+/);
    assert.equal(f.length, 5, `다섯 자리가 아니다: ${c}`);
    f.forEach((field, i) => {
      const [lo, hi] = RANGE[i];
      for (const n of field.match(/\d+/g) || []) {
        // */5 의 5 는 간격이라 범위 밖일 수 있으므로 간격 부분은 건너뛴다
        if (/\*\//.test(field) && field.split("/")[1] === n) continue;
        const v = Number(n);
        assert.ok(v >= lo && v <= hi, `${c} 의 ${i + 1}번째 자리 ${v} 가 ${lo}-${hi} 밖이다`);
      }
    });
  }
});

test("세 가지 정기 작업이 서로 다른 크론을 쓴다 (분기가 겹치지 않게)", () => {
  assert.equal(new Set(Object.values(CRON)).size, 3);
});
