// QR 인코더 검증: 표준 공표 상수 대조 + RS 신드롬 + 매트릭스 역추출 라운드트립
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// 브라우저용 IIFE 파일을 격리 스코프로 로드 (루트 package.json 이 type:module 이라 require 불가)
const _src = readFileSync(fileURLToPath(new URL("../public/js/qr.js", import.meta.url)), "utf8");
const _mod = { exports: {} };
new Function("module", "window", _src)(_mod, undefined);
const QR = _mod.exports;

// ---- GF(256) (검증용 독립 구현) ----
const EXP = new Array(512), LOG = new Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[(LOG[a] + LOG[b]) % 255];

test("포맷 비트: QR 표준 공표 상수(EC-M, 마스크 0~7)와 일치", () => {
  // ISO/IEC 18004 부록 C 공표값 (레벨 M)
  const PUBLISHED = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];
  // qr.js 내부 함수는 비공개 → 매트릭스에서 직접 읽어 검증 (아래 라운드트립에서 수행)
  // 여기서는 공식을 독립 재계산해 상수와 대조
  for (let mask = 0; mask < 8; mask++) {
    const data = (0 << 3) | mask;
    let v = data << 10;
    for (let i = 14; i >= 10; i--) if ((v >> i) & 1) v ^= 0x537 << (i - 10);
    const bits = ((data << 10) | v) ^ 0x5412;
    assert.equal(bits, PUBLISHED[mask], `mask ${mask}`);
  }
});

test("버전 비트: V7~V10 공표 상수와 일치", () => {
  const PUBLISHED = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };
  for (const [ver, want] of Object.entries(PUBLISHED)) {
    let v = Number(ver) << 12;
    for (let i = 17; i >= 12; i--) if ((v >> i) & 1) v ^= 0x1f25 << (i - 12);
    assert.equal((Number(ver) << 12) | v, want, `V${ver}`);
  }
});

// ---- 매트릭스 → 원문 역추출 리더 ----
const VER_M = {
  1: [16, 10, 1, 16, 0, 0], 2: [28, 16, 1, 28, 0, 0], 3: [44, 26, 1, 44, 0, 0],
  4: [64, 18, 2, 32, 0, 0], 5: [86, 24, 2, 43, 0, 0], 6: [108, 16, 4, 27, 0, 0],
  7: [124, 18, 4, 31, 0, 0], 8: [154, 22, 2, 38, 2, 39], 9: [182, 22, 3, 36, 2, 37],
  10: [216, 26, 4, 43, 1, 44],
};
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

function readMatrix(m) {
  const size = m.length, ver = (size - 17) / 4;
  // 1) 포맷 비트 읽기 (좌상단 사본) → 마스크 확인 + 공표 상수 대조
  const fmtBitAt = (i) => {
    if (i < 6) return m[8][i];
    if (i === 6) return m[8][7];
    if (i === 7) return m[8][8];
    if (i === 8) return m[7][8];
    return m[14 - i][8];
  };
  let fmt = 0;
  for (let i = 14; i >= 0; i--) fmt = (fmt << 1) | (fmtBitAt(i) ? 1 : 0);
  const PUBLISHED = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];
  const mask = PUBLISHED.indexOf(fmt);
  assert.notEqual(mask, -1, "포맷 비트가 공표 상수와 불일치(레벨 M 아님?)");
  // 우상단·좌하단 사본도 동일해야 함
  let fmt2 = 0;
  for (let i = 14; i >= 0; i--) {
    const bit = i < 8 ? m[8][size - 1 - i] : m[size - 15 + i][8];
    fmt2 = (fmt2 << 1) | (bit ? 1 : 0);
  }
  assert.equal(fmt2, fmt, "포맷 두 번째 사본 불일치");

  // 2) 예약 영역 재구성 (기능 패턴 위치)
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const rsv = (r, c) => { if (r >= 0 && r < size && c >= 0 && c < size) reserved[r][c] = true; };
  for (const [fr, fc] of [[0, 0], [0, size - 7], [size - 7, 0]])
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) rsv(fr + dr, fc + dc);
  const ap = ALIGN[ver];
  for (const cr of ap) for (const cc of ap) {
    if (reserved[cr][cc]) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) rsv(cr + dr, cc + dc);
  }
  for (let i = 8; i < size - 8; i++) { rsv(6, i); rsv(i, 6); }
  rsv(size - 8, 8);
  for (let i = 0; i < 9; i++) { rsv(8, i); rsv(i, 8); }
  for (let i = 0; i < 8; i++) { rsv(8, size - 1 - i); rsv(size - 1 - i, 8); }
  if (ver >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { rsv(i, size - 11 + j); rsv(size - 11 + j, i); }

  // 3) 지그재그 순회로 비트 추출 + 마스크 해제
  const unmask = (r, c, v) => {
    let f;
    switch (mask) {
      case 0: f = (r + c) % 2 === 0; break;
      case 1: f = r % 2 === 0; break;
      case 2: f = c % 3 === 0; break;
      case 3: f = (r + c) % 3 === 0; break;
      case 4: f = (((r / 2) | 0) + ((c / 3) | 0)) % 2 === 0; break;
      case 5: f = ((r * c) % 2) + ((r * c) % 3) === 0; break;
      case 6: f = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; break;
      default: f = (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
    return f ? !v : v;
  };
  const bits = [];
  let col = size - 1, up = true;
  while (col > 0) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const r = up ? size - 1 - i : i;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (!reserved[r][c]) bits.push(unmask(r, c, m[r][c]) ? 1 : 0);
      }
    }
    col -= 2; up = !up;
  }
  const all = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    all.push(b);
  }

  // 4) 디인터리빙 → 데이터 코드워드 복원 + RS 신드롬 검증
  const spec = VER_M[ver], ecPer = spec[1];
  const sizes = [...Array(spec[2]).fill(spec[3]), ...Array(spec[4]).fill(spec[5])];
  const nBlocks = sizes.length, maxLen = Math.max(...sizes);
  const blocks = sizes.map(() => []), ecs = sizes.map(() => []);
  let idx = 0;
  for (let i = 0; i < maxLen; i++) for (let j = 0; j < nBlocks; j++) if (i < sizes[j]) blocks[j].push(all[idx++]);
  for (let i = 0; i < ecPer; i++) for (let j = 0; j < nBlocks; j++) ecs[j].push(all[idx++]);
  for (let j = 0; j < nBlocks; j++) {
    const full = blocks[j].concat(ecs[j]);
    for (let s = 0; s < ecPer; s++) { // 신드롬: α^s 대입 결과 0 이어야 함
      let acc = 0;
      for (const cw of full) acc = gmul(acc, EXP[s]) ^ cw;
      assert.equal(acc, 0, `RS 신드롬 ≠ 0 (블록 ${j}, s=${s})`);
    }
  }
  const data = blocks.flat();

  // 5) 바이트 모드 파싱
  let pos = 0;
  const take = (n) => { let v = 0; for (let k = 0; k < n; k++) { v = (v << 1) | ((data[(pos / 8) | 0] >> (7 - (pos % 8))) & 1); pos++; } return v; };
  assert.equal(take(4), 4, "모드 ≠ 바이트");
  const len = take(ver <= 9 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < len; i++) bytes.push(take(8));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

test("라운드트립: 인코딩 → 매트릭스 역추출 = 원문 (V1~V10·한글·멀티블록)", () => {
  const cases = [
    "HELLO",                                                              // V1
    "https://website.tobe211167.workers.dev/t/seocho",                    // V3~4
    "https://website.tobe211167.workers.dev/t/seocho/business/" + encodeURIComponent("홍가네분식"), // V5~6 (퍼센트인코딩 한글)
    "https://example.com/" + "a".repeat(120),                             // V8 멀티블록(그룹2)
    "https://example.com/" + "b".repeat(190),                             // V10 (16비트 길이)
  ];
  for (const text of cases) {
    const m = QR.matrix(text);
    assert.equal(readMatrix(m), text, text.slice(0, 40) + "...");
  }
});

test("구조: 파인더·타이밍·다크모듈 위치", () => {
  const m = QR.matrix("TEST");
  const size = m.length;
  assert.equal(size, 21, "V1 = 21x21");
  assert.ok(m[0][0] && m[0][6] && m[6][0] && m[3][3], "좌상 파인더");
  assert.ok(m[0][size - 1] && m[size - 1][0], "우상·좌하 파인더 모서리");
  for (let i = 8; i < size - 8; i++) assert.equal(m[6][i], i % 2 === 0, "타이밍 행");
  assert.equal(m[size - 8][8], true, "다크 모듈");
});

test("SVG 출력: 유효한 마크업 + 콰이엇존", () => {
  const s = QR.svg("https://example.com");
  assert.match(s, /^<svg xmlns/);
  assert.match(s, /fill="#fff"/);
  assert.match(s, /fill="#000"/);
});
