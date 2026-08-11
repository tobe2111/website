// 최소 ZIP 작성기 (외부 의존성 0).
// 증적 패키지를 한 파일로 내려주기 위한 것 — 압축은 Workers 내장 CompressionStream 을 쓰고,
// 없으면 무압축(store)으로 떨어진다. 어느 쪽이든 표준 ZIP 이라 어디서나 열린다.
const te = new TextEncoder();

// CRC-32 (ZIP 규격). 테이블은 첫 호출 때 한 번만 만든다.
let TABLE = null;
function crcTable() {
  if (TABLE) return TABLE;
  TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABLE[i] = c >>> 0;
  }
  return TABLE;
}
export function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const cs = new CompressionStream("deflate-raw");
    const w = cs.writable.getWriter();
    w.write(bytes); w.close();
    const out = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    return out.length < bytes.length ? out : null; // 커지면 무압축이 낫다
  } catch { return null; }
}

// DOS 시각 — ZIP 헤더 규격. 재현 가능한 패키지를 위해 고정 시각을 쓸 수도 있다.
function dosTime(d) {
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  return { date, time };
}

// files: [{ name, data (string | Uint8Array) }] → Uint8Array (ZIP)
export async function makeZip(files, { at = new Date() } = {}) {
  const { date, time } = dosTime(at);
  const parts = [];   // 로컬 헤더 + 데이터
  const central = []; // 중앙 디렉터리
  let offset = 0;

  for (const f of files) {
    const name = te.encode(f.name);
    const raw = typeof f.data === "string" ? te.encode(f.data) : f.data;
    const crc = crc32(raw);
    const deflated = await deflateRaw(raw);
    const body = deflated || raw;
    const method = deflated ? 8 : 0;

    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);          // version needed
    lv.setUint16(6, 0x0800, true);      // 파일명 UTF-8 (한글 이름을 위해 필수)
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true); lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    lh.set(name, 30);
    parts.push(lh, body);

    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true); cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    ch.set(name, 46);
    central.push(ch);

    offset += lh.length + body.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  for (const c of central) { out.set(c, p); p += c.length; }
  out.set(eocd, p);
  return out;
}
