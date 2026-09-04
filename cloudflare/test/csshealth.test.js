// 스타일시트가 끝까지 살아 있는가.
//
// 왜 이 검사가 생겼는가 — 두 갈래를 합치다가 @media 블록의 닫는 괄호 하나가 사라졌다.
// 그러면 브라우저는 그 지점부터 파일 끝까지를 통째로 버린다. 화면은 '조금 이상한' 게
// 아니라 '그 아래 스타일이 전부 없는' 상태가 되는데, 그게 배포된 뒤에야 눈으로 발견됐다.
// 괄호 하나는 사람 눈으로 세기 어렵다 — 기계가 센다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
// 주석을 지우되 줄 수는 유지한다 — 몇째 줄에서 어긋났는지 말해 줘야 고칠 수 있다
const bare = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

test("괄호가 끝까지 맞는다 — 하나만 어긋나도 그 아래가 통째로 죽는다", () => {
  let depth = 0, line = 1, opened = [];
  for (const ch of bare) {
    if (ch === "\n") line++;
    else if (ch === "{") { depth++; opened.push(line); }
    else if (ch === "}") {
      depth--; opened.pop();
      assert.ok(depth >= 0, `${line}행: 여는 괄호보다 닫는 괄호가 많습니다`);
    }
  }
  assert.equal(depth, 0, `안 닫힌 블록이 ${depth}개 — 시작한 줄: ${opened.join(", ")}`);
});

test("중첩은 두 겹까지만 — 그보다 깊으면 대개 실수다", () => {
  let depth = 0, max = 0, line = 1, deepAt = 0;
  for (const ch of bare) {
    if (ch === "\n") line++;
    else if (ch === "{") { depth++; if (depth > max) { max = depth; deepAt = line; } }
    else if (ch === "}") depth--;
  }
  assert.ok(max <= 2, `${deepAt}행에서 ${max}겹까지 들어갑니다 — 괄호를 빠뜨렸을 가능성이 큽니다`);
});

test("파일 맨 끝이 규칙 한가운데가 아니다", () => {
  const tail = bare.trimEnd();
  assert.ok(tail.endsWith("}"), "마지막 규칙이 닫히지 않은 채 파일이 끝납니다");
});
