// QR 코드 생성기 (의존성 0 · 바이트 모드 · EC 레벨 M · 버전 1~10 자동)
// 사용: QR.svg("https://...") → SVG 문자열 / QR.matrix(text) → boolean[][]
(function (global) {
  "use strict";

  // ---- GF(256) 산술 (Reed-Solomon) ----
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  function rsGenPoly(deg) {
    // (x+α^0)(x+α^1)...(x+α^{deg-1}) — 계수 최고차 우선, gen[0]=1 (monic)
    var poly = [1];
    for (var i = 0; i < deg; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];                                                  // x · poly
        next[j + 1] ^= poly[j] === 0 ? 0 : EXP[(LOG[poly[j]] + i) % 255];    // α^i · poly
      }
      poly = next;
    }
    return poly;
  }
  function rsRemainder(data, degree) {
    var gen = rsGenPoly(degree);
    var buf = data.concat(new Array(degree).fill(0));
    for (var i = 0; i < data.length; i++) {
      var factor = buf[i];
      if (factor === 0) continue;
      var lf = LOG[factor];
      for (var j = 0; j < gen.length; j++) buf[i + j] ^= gen[j] === 0 ? 0 : EXP[(LOG[gen[j]] + lf) % 255];
    }
    return buf.slice(data.length);
  }

  // ---- 버전 테이블 (EC 레벨 M): [총데이터코드워드, EC/블록, 그룹1블록수, 그룹1크기, 그룹2블록수, 그룹2크기] ----
  var VER_M = {
    1: [16, 10, 1, 16, 0, 0], 2: [28, 16, 1, 28, 0, 0], 3: [44, 26, 1, 44, 0, 0],
    4: [64, 18, 2, 32, 0, 0], 5: [86, 24, 2, 43, 0, 0], 6: [108, 16, 4, 27, 0, 0],
    7: [124, 18, 4, 31, 0, 0], 8: [154, 22, 2, 38, 2, 39], 9: [182, 22, 3, 36, 2, 37],
    10: [216, 26, 4, 43, 1, 44],
  };
  var ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };

  function toUtf8(str) {
    if (typeof TextEncoder !== "undefined") return Array.from(new TextEncoder().encode(str));
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.codePointAt(i);
      if (c > 0xffff) i++;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function buildCodewords(bytes, ver) {
    var spec = VER_M[ver], totalData = spec[0];
    // 비트스트림: 모드(0100) + 길이(8/16bit) + 데이터 + 종단
    var bits = [];
    function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    push(4, 4);
    push(bytes.length, ver <= 9 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);
    var cap = totalData * 8;
    push(0, Math.min(4, cap - bits.length)); // terminator
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }
    var pad = [0xec, 0x11], k = 0;
    while (data.length < totalData) data.push(pad[k++ % 2]);
    // 블록 분할 + EC + 인터리빙
    var ecPer = spec[1], blocks = [], ecs = [], idx = 0;
    function addBlocks(count, size) {
      for (var n = 0; n < count; n++) {
        var blk = data.slice(idx, idx + size); idx += size;
        blocks.push(blk); ecs.push(rsRemainder(blk, ecPer));
      }
    }
    addBlocks(spec[2], spec[3]); addBlocks(spec[4], spec[5]);
    var out = [], maxLen = Math.max.apply(null, blocks.map(function (b) { return b.length; }));
    for (i = 0; i < maxLen; i++) for (j = 0; j < blocks.length; j++) if (i < blocks[j].length) out.push(blocks[j][i]);
    for (i = 0; i < ecPer; i++) for (j = 0; j < ecs.length; j++) out.push(ecs[j][i]);
    return out;
  }

  function makeMatrix(ver) {
    var size = ver * 4 + 17;
    var m = [], reserved = [];
    for (var r = 0; r < size; r++) { m.push(new Array(size).fill(false)); reserved.push(new Array(size).fill(false)); }
    function set(r, c, v) { m[r][c] = v; reserved[r][c] = true; }
    function finder(r, c) {
      for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
        var rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        var on = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        set(rr, cc, on);
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    // 얼라인먼트
    var ap = ALIGN[ver];
    for (var i = 0; i < ap.length; i++) for (var j = 0; j < ap.length; j++) {
      var cr = ap[i], cc2 = ap[j];
      if (reserved[cr][cc2]) continue;
      for (var dr2 = -2; dr2 <= 2; dr2++) for (var dc2 = -2; dc2 <= 2; dc2++)
        set(cr + dr2, cc2 + dc2, Math.max(Math.abs(dr2), Math.abs(dc2)) !== 1);
    }
    // 타이밍 패턴
    for (i = 8; i < size - 8; i++) {
      if (!reserved[6][i]) set(6, i, i % 2 === 0);
      if (!reserved[i][6]) set(i, 6, i % 2 === 0);
    }
    set(size - 8, 8, true); // dark module
    // 포맷 영역 예약
    for (i = 0; i < 9; i++) { if (!reserved[8][i]) reserved[8][i] = true; if (!reserved[i][8]) reserved[i][8] = true; }
    for (i = 0; i < 8; i++) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }
    // 버전 정보 영역 예약 (V7+)
    if (ver >= 7) for (i = 0; i < 6; i++) for (j = 0; j < 3; j++) { reserved[i][size - 11 + j] = true; reserved[size - 11 + j][i] = true; }
    return { m: m, reserved: reserved, size: size };
  }

  function placeData(mm, codewords) {
    var m = mm.m, reserved = mm.reserved, size = mm.size;
    var bitIdx = 0, total = codewords.length * 8;
    function nextBit() {
      if (bitIdx >= total) return false;
      var byte = codewords[bitIdx >> 3];
      var bit = (byte >> (7 - (bitIdx & 7))) & 1;
      bitIdx++;
      return bit === 1;
    }
    var col = size - 1, up = true;
    while (col > 0) {
      if (col === 6) col--; // 타이밍 열 건너뜀
      for (var i = 0; i < size; i++) {
        var r = up ? size - 1 - i : i;
        for (var dc = 0; dc < 2; dc++) {
          var c = col - dc;
          if (!reserved[r][c]) { m[r][c] = nextBit(); reserved[r][c] = true; }
        }
      }
      col -= 2; up = !up;
    }
  }

  function applyMask(mm, dataRegion, mask) {
    var size = mm.size, m = mm.m;
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
      if (!dataRegion[r][c]) continue;
      var f;
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
      if (f) m[r][c] = !m[r][c];
    }
  }

  function formatBits(mask) {
    // EC 레벨 M = 00
    var data = (0 << 3) | mask;
    var v = data << 10;
    var g = 0x537;
    for (var i = 14; i >= 10; i--) if ((v >> i) & 1) v ^= g << (i - 10);
    return ((data << 10) | v) ^ 0x5412;
  }
  function versionBits(ver) {
    var v = ver << 12, g = 0x1f25;
    for (var i = 17; i >= 12; i--) if ((v >> i) & 1) v ^= g << (i - 12);
    return (ver << 12) | v;
  }

  function drawFormat(mm, mask) {
    var size = mm.size, m = mm.m, f = formatBits(mask);
    for (var i = 0; i < 15; i++) {
      var bit = ((f >> i) & 1) === 1;
      // 좌상단 배치
      if (i < 6) m[8][i] = bit;
      else if (i === 6) m[8][7] = bit;
      else if (i === 7) m[8][8] = bit;
      else if (i === 8) m[7][8] = bit;
      else m[14 - i][8] = bit;
      // 우상단·좌하단 분산 배치
      if (i < 8) m[8][size - 1 - i] = bit;
      else m[size - 15 + i][8] = bit;
    }
  }
  function drawVersion(mm, ver) {
    if (ver < 7) return;
    var size = mm.size, m = mm.m, v = versionBits(ver);
    for (var i = 0; i < 18; i++) {
      var bit = ((v >> i) & 1) === 1;
      var r = (i / 3) | 0, c = i % 3;
      m[r][size - 11 + c] = bit;
      m[size - 11 + c][r] = bit;
    }
  }

  function penalty(m) {
    var size = m.length, score = 0, r, c;
    // 규칙1: 연속 동일 5+
    for (r = 0; r < size; r++) {
      var run = 1;
      for (c = 1; c <= size; c++) {
        if (c < size && m[r][c] === m[r][c - 1]) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
    }
    for (c = 0; c < size; c++) {
      var run2 = 1;
      for (r = 1; r <= size; r++) {
        if (r < size && m[r][c] === m[r - 1][c]) run2++;
        else { if (run2 >= 5) score += run2 - 2; run2 = 1; }
      }
    }
    // 규칙2: 2x2 블록
    for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++)
      if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) score += 3;
    return score;
  }

  function matrix(text) {
    var bytes = toUtf8(String(text));
    var ver = 0;
    for (var v = 1; v <= 10; v++) {
      var cap = VER_M[v][0] - (v <= 9 ? 2 : 3); // 모드+길이 헤더 코드워드
      if (bytes.length <= cap) { ver = v; break; }
    }
    if (!ver) throw new Error("내용이 너무 깁니다 (QR V10-M 초과)");
    var codewords = buildCodewords(bytes, ver);

    var best = null, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var mm = makeMatrix(ver);
      // 데이터 영역 기록(마스킹 대상 추적)
      var dataRegion = [];
      for (var r = 0; r < mm.size; r++) dataRegion.push(mm.reserved[r].map(function (x) { return !x; }));
      placeData(mm, codewords);
      applyMask(mm, dataRegion, mask);
      drawFormat(mm, mask);
      drawVersion(mm, ver);
      var sc = penalty(mm.m);
      if (sc < bestScore) { bestScore = sc; best = mm.m; }
    }
    return best;
  }

  function svg(text, opts) {
    opts = opts || {};
    var m = matrix(text), n = m.length, quiet = opts.quiet != null ? opts.quiet : 4;
    var total = n + quiet * 2, cell = opts.cell || 8;
    var px = total * cell;
    var path = "";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++)
      if (m[r][c]) path += "M" + ((c + quiet) * cell) + " " + ((r + quiet) * cell) + "h" + cell + "v" + cell + "h-" + cell + "z";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + px + " " + px + '" width="' + px + '" height="' + px + '" shape-rendering="crispEdges">' +
      '<rect width="100%" height="100%" fill="#fff"/><path d="' + path + '" fill="#000"/></svg>';
  }

  var QR = { matrix: matrix, svg: svg };
  if (typeof module !== "undefined" && module.exports) module.exports = QR;
  global.QR = QR;
})(typeof window !== "undefined" ? window : globalThis);
