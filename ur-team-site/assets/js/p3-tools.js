// 유어팀 3D 파일 변환 · 뷰어 (/3d-converter/ · /3d-viewer/). 라이브러리 없이 브라우저 안에서만 처리한다.
// 읽기: STL(문자 · 이진) · OBJ · PLY(문자 · 이진) · OFF · 3MF · GLB · glTF(파일 안에 데이터가 든 것) · AMF
// 쓰기: STL(이진 · 문자) · OBJ · PLY · OFF · 3MF · GLB
// 그 밖에: 크기 · 부피 · 무게 추정 · 열린 면 검사, PNG 저장, ZIP 압축, 반디집 · 7-Zip 식 분할(.001), 출력 견적으로 넘기기
(() => {
  const d = document, root = d.querySelector("[data-p3tool]");
  if (!root) return;
  const $ = (q) => root.querySelector(q), EN = d.documentElement.lang === "en";
  const L = EN ? {
    drop: "Drop 3D files here or click to choose", reading: "Reading…", fail: "Could not read this file: ", unsupported: "This format can't be converted in the browser. Send it to us and we will check it.",
    tris: "Triangles", verts: "Vertices", size: "Size", vol: "Volume", area: "Surface", solid: "Solid PLA", est: "Typical print (3 walls, 15 % infill)", open: "Open edges", closed: "Closed (printable)", notClosed: "open edges, may need repair",
    done: "Ready. Your file was not uploaded anywhere.", files: " files", saved: "Saved", making: "Making the file…", part: "Part", partsUnit: " parts", partsLabel: "Parts", showing: "showing", noneShown: "No part is selected", merged: "parts were merged into one mesh (this format has no parts)",
    manyParts: (n) => `This file has ${n} parts. Untick a part to hide it or leave it out of the download.`, splitN: (n) => `Split into ${n} loose pieces`,
  } : {
    drop: "3D 파일을 여기에 끌어 놓거나 눌러서 고르세요", reading: "읽는 중…", fail: "이 파일을 읽지 못했습니다: ", unsupported: "이 형식은 브라우저에서 바로 변환할 수 없습니다. 파일을 보내 주시면 확인해 드립니다.",
    tris: "삼각형", verts: "꼭짓점", size: "크기", vol: "부피", area: "겉넓이", solid: "꽉 채운 PLA", est: "일반 출력 (외벽 3줄 · 채움 15%)", open: "열린 모서리", closed: "닫힌 형상 (출력 가능)", notClosed: "개의 열린 모서리, 보정이 필요할 수 있음",
    done: "준비됐습니다. 파일은 어디에도 올라가지 않았습니다.", files: "개 파일", saved: "저장했습니다", making: "파일을 만드는 중…", part: "부품", partsUnit: "개", partsLabel: "부품", showing: "보이는 것", noneShown: "고른 부품이 없습니다", merged: "이 형식은 부품 구분이 없어 하나로 합쳐 저장했습니다",
    manyParts: (n) => `이 파일에는 부품이 ${n}개 들어 있습니다. 체크를 끄면 화면과 내려받기에서 빠집니다.`, splitN: (n) => `떨어진 조각 ${n}개로 나누기`,
  };
  const IN = ["stl", "obj", "ply", "off", "3mf", "glb", "gltf", "amf"];
  const say = (t, bad) => { const m = $("[data-msg]"); m.textContent = t; m.classList.toggle("is-bad", !!bad); };

  // ── zip 읽기 · 쓰기 (3MF 는 zip 이다) ─────────────────────────────
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = ~0; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
  const inflate = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
  const deflate = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  async function unzip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), out = {};
    let e = buf.byteLength - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error("zip");
    let p = dv.getUint32(e + 16, true); const n = dv.getUint16(e + 10, true), td = new TextDecoder();
    for (let i = 0; i < n; i++) {
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nl)), start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = u8.subarray(start, start + size);
      out[name] = method === 8 ? inflate(raw) : Promise.resolve(raw.slice());
      p += 46 + nl + xl + cl;
    }
    return out;
  }
  const now = new Date(), DOSDATE = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  async function zip(files, pack) { // files: [{name, data:Uint8Array}], pack: true 면 압축
    const enc = new TextEncoder(), chunks = [], cent = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), body = pack ? await deflate(f.data) : f.data, m = pack ? 8 : 0;
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(8, m, true); h.setUint16(12, DOSDATE, true);
      h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true);
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(10, m, true); c.setUint16(14, DOSDATE, true);
      c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      chunks.push(h, name, body); cent.push(c, name); off += 30 + name.length + body.length;
    }
    const csz = cent.reduce((s, x) => s + (x.byteLength ?? x.length), 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csz, true); e.setUint32(16, off, true);
    return new Blob([...chunks, ...cent, e]);
  }

  // ── 읽기: 모두 부품 목록 [{ name, pos: Float32Array(xyz…), idx: Uint32Array(삼각형 3개씩) }] 로 ─────
  // 한 파일에 물체가 여럿 든 경우(3MF 의 여러 물체, OBJ 의 o/g 묶음, glTF 의 여러 노드, 문자 STL 의 여러 solid)를 부품으로 나눠 둔다
  const mesh = (pos, idx) => ({ pos: pos instanceof Float32Array ? pos : new Float32Array(pos), idx: idx instanceof Uint32Array ? idx : new Uint32Array(idx) });
  const part = (name, m) => Object.assign(m, { name: String(name || "").trim() });
  function weld(pos) { // 같은 자리의 꼭짓점을 하나로 (STL 은 삼각형마다 꼭짓점을 따로 적는다)
    const n = pos.length / 3, map = new Map(), out = [], idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], k = Math.round(x * 1e4) + "," + Math.round(y * 1e4) + "," + Math.round(z * 1e4);
      let j = map.get(k); if (j === undefined) { j = out.length / 3; map.set(k, j); out.push(x, y, z); } idx[i] = j;
    }
    return mesh(out, idx);
  }
  function readSTL(buf) {
    const dv = new DataView(buf);
    if (buf.byteLength >= 84) {
      const n = dv.getUint32(80, true);
      if (84 + n * 50 === buf.byteLength) {
        const pos = new Float32Array(n * 9);
        for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) pos[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true);
        return [part("", weld(pos))];
      }
    }
    const t = new TextDecoder().decode(buf), re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g, out = [];
    const verts = (s) => { const v = []; let m; re.lastIndex = 0; while ((m = re.exec(s))) v.push(+m[1], +m[2], +m[3]); return v; };
    for (const m of t.matchAll(/solid[ \t]*([^\r\n]*)([\s\S]*?)endsolid/g)) { const v = verts(m[2]); if (v.length) out.push(part(m[1], weld(new Float32Array(v)))); }
    if (!out.length) { const v = verts(t); if (v.length) out.push(part("", weld(new Float32Array(v)))); }
    if (!out.length) throw new Error("STL");
    return out;
  }
  function readOBJ(t) {
    const pos = [], groups = new Map(); let nv = 0, cur = "", oName = "";
    for (const line of t.split(/\r?\n/)) {
      const s = line.trim().split(/\s+/);
      if (s[0] === "v") { pos.push(+s[1], +s[2], +s[3]); nv++; }
      else if (s[0] === "o") { oName = s.slice(1).join(" "); cur = oName; }
      else if (s[0] === "g") cur = s.slice(1).join(" ") || oName;
      else if (s[0] === "f") {
        const f = s.slice(1).map((x) => { const i = parseInt(x, 10); return i < 0 ? nv + i : i - 1; });
        let g = groups.get(cur); if (!g) groups.set(cur, (g = []));
        for (let k = 1; k + 1 < f.length; k++) g.push(f[0], f[k], f[k + 1]);
      }
    }
    if (!groups.size) throw new Error("OBJ");
    return [...groups].map(([name, gi]) => { // 부품마다 쓰는 꼭짓점만 남긴다
      const map = new Map(), p = [], idx = new Uint32Array(gi.length);
      for (let i = 0; i < gi.length; i++) { let j = map.get(gi[i]); if (j === undefined) { j = p.length / 3; map.set(gi[i], j); p.push(pos[gi[i] * 3], pos[gi[i] * 3 + 1], pos[gi[i] * 3 + 2]); } idx[i] = j; }
      return part(name, mesh(p, idx));
    });
  }
  function readOFF(t) {
    const w = t.replace(/#.*$/gm, "").trim().split(/\s+/); let p = 0;
    if (/^C?N?OFF$/.test(w[0])) p++;
    const nv = +w[p++], nf = +w[p++]; p++;
    const pos = [], idx = [];
    for (let i = 0; i < nv; i++) { pos.push(+w[p], +w[p + 1], +w[p + 2]); p += 3; while (p < w.length && w[p] !== undefined && i < nv - 1 && false) p++; }
    for (let i = 0; i < nf; i++) { const k = +w[p++], f = []; for (let j = 0; j < k; j++) f.push(+w[p++]); for (let j = 1; j + 1 < k; j++) idx.push(f[0], f[j], f[j + 1]); }
    return mesh(pos, idx);
  }
  function readPLY(buf) {
    const u8 = new Uint8Array(buf), head = new TextDecoder().decode(u8.subarray(0, Math.min(u8.length, 8192))), end = head.indexOf("end_header");
    if (!head.startsWith("ply") || end < 0) throw new Error("PLY");
    const lines = head.slice(0, end).split(/\r?\n/), els = []; let fmt = "ascii";
    for (const l of lines) {
      const s = l.trim().split(/\s+/);
      if (s[0] === "format") fmt = s[1];
      else if (s[0] === "element") els.push({ name: s[1], n: +s[2], props: [] });
      else if (s[0] === "property") els[els.length - 1].props.push(s[1] === "list" ? { name: s[4], list: true, ct: s[2], it: s[3] } : { name: s[2], t: s[1] });
    }
    let off = head.indexOf("\n", end) + 1;
    const pos = [], idx = [];
    if (fmt === "ascii") {
      const w = new TextDecoder().decode(u8.subarray(off)).trim().split(/\s+/); let p = 0;
      for (const e of els) for (let i = 0; i < e.n; i++) {
        const row = {};
        for (const pr of e.props) { if (pr.list) { const k = +w[p++]; row[pr.name] = w.slice(p, p + k).map(Number); p += k; } else row[pr.name] = +w[p++]; }
        if (e.name === "vertex") pos.push(row.x, row.y, row.z);
        else if (e.name === "face") { const f = row.vertex_indices || row.vertex_index || []; for (let j = 1; j + 1 < f.length; j++) idx.push(f[0], f[j], f[j + 1]); }
      }
    } else {
      const le = fmt === "binary_little_endian", dv = new DataView(buf);
      const SZ = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
      const rd = (t) => { let v; switch (t) {
        case "char": case "int8": v = dv.getInt8(off); break; case "uchar": case "uint8": v = dv.getUint8(off); break;
        case "short": case "int16": v = dv.getInt16(off, le); break; case "ushort": case "uint16": v = dv.getUint16(off, le); break;
        case "int": case "int32": v = dv.getInt32(off, le); break; case "uint": case "uint32": v = dv.getUint32(off, le); break;
        case "float": case "float32": v = dv.getFloat32(off, le); break; default: v = dv.getFloat64(off, le); }
        off += SZ[t]; return v; };
      for (const e of els) for (let i = 0; i < e.n; i++) {
        const row = {};
        for (const pr of e.props) { if (pr.list) { const k = rd(pr.ct), f = []; for (let j = 0; j < k; j++) f.push(rd(pr.it)); row[pr.name] = f; } else row[pr.name] = rd(pr.t); }
        if (e.name === "vertex") pos.push(row.x, row.y, row.z);
        else if (e.name === "face") { const f = row.vertex_indices || row.vertex_index || []; for (let j = 1; j + 1 < f.length; j++) idx.push(f[0], f[j], f[j + 1]); }
      }
    }
    if (!idx.length) throw new Error(EN ? "PLY has no faces (point cloud)" : "면이 없는 PLY(점 데이터)");
    return mesh(pos, idx);
  }
  const xmlDoc = (t) => new DOMParser().parseFromString(t, "application/xml");
  // 3MF 의 3×4 변환(행 벡터): a 를 먼저, b 를 나중에
  const T3 = (a, b) => [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
    a[9] * b[0] + a[10] * b[3] + a[11] * b[6] + b[9], a[9] * b[1] + a[10] * b[4] + a[11] * b[7] + b[10], a[9] * b[2] + a[10] * b[5] + a[11] * b[8] + b[11]];
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], tf3 = (s) => (s ? s.trim().split(/\s+/).map(Number) : I3);
  async function read3MF(buf) {
    const files = await unzip(buf), names = Object.keys(files).filter((n) => /\.model$/i.test(n));
    if (!names.length) throw new Error("3MF");
    const main = names.find((n) => /^\/?3D\/3dmodel\.model$/i.test(n)) || names[0], objs = {};
    let unit = 1;
    for (const n of names) { // 프로젝트 3MF 는 물체를 다른 .model 파일에 나눠 두기도 한다
      const doc = xmlDoc(new TextDecoder().decode(await files[n]));
      if (n === main) unit = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[doc.documentElement.getAttribute("unit") || "millimeter"] || 1;
      for (const o of doc.getElementsByTagName("object")) {
        const id = o.getAttribute("id"), key = (n === main ? "" : "/" + n.replace(/^\//, "")) + "#" + id, m = o.getElementsByTagName("mesh")[0], rec = { name: o.getAttribute("name") || "", comps: [] };
        if (m) {
          const pos = [], idx = [];
          for (const v of m.getElementsByTagName("vertex")) pos.push(+v.getAttribute("x"), +v.getAttribute("y"), +v.getAttribute("z"));
          for (const tr of m.getElementsByTagName("triangle")) idx.push(+tr.getAttribute("v1"), +tr.getAttribute("v2"), +tr.getAttribute("v3"));
          rec.mesh = { pos, idx };
        }
        for (const c of o.getElementsByTagName("component")) { const path = c.getAttribute("p:path") || c.getAttributeNS("*", "path") || ""; rec.comps.push({ key: (path ? "/" + path.replace(/^\//, "") : n === main ? "" : "/" + n.replace(/^\//, "")) + "#" + c.getAttribute("objectid"), m: tf3(c.getAttribute("transform")) }); }
        objs[key] = rec;
      }
    }
    const inst = (key, M, pos, idx, depth = 0) => {
      const o = objs[key]; if (!o || depth > 16) return;
      if (o.mesh) { const base = pos.length / 3, P = o.mesh.pos; for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; pos.push((x * M[0] + y * M[3] + z * M[6] + M[9]) * unit, (x * M[1] + y * M[4] + z * M[7] + M[10]) * unit, (x * M[2] + y * M[5] + z * M[8] + M[11]) * unit); } for (const v of o.mesh.idx) idx.push(v + base); }
      for (const c of o.comps) inst(c.key, T3(c.m, M), pos, idx, depth + 1);
    };
    const doc = xmlDoc(new TextDecoder().decode(await files[main])), items = [...doc.getElementsByTagName("item")];
    const list = items.length ? items.map((it) => ["#" + it.getAttribute("objectid"), tf3(it.getAttribute("transform"))]) : Object.keys(objs).filter((k) => k.startsWith("#")).map((k) => [k, I3]);
    const out = [];
    for (const [key, M] of list) { const pos = [], idx = []; inst(key, M, pos, idx); if (idx.length) out.push(part(objs[key]?.name || (EN ? "Object " : "물체 ") + key.slice(1), mesh(pos, idx))); }
    if (!out.length) throw new Error("3MF");
    return out;
  }
  async function readAMF(buf) {
    let u8 = new Uint8Array(buf);
    if (u8[0] === 0x50 && u8[1] === 0x4b) { const f = await unzip(buf); u8 = await Object.values(f)[0]; }
    const doc = xmlDoc(new TextDecoder().decode(u8)), unit = { micron: 0.001, millimeter: 1, inch: 25.4, feet: 304.8, meter: 1000 }[doc.documentElement.getAttribute("unit") || "millimeter"] || 1;
    const out = [];
    for (const o of doc.getElementsByTagName("object")) {
      const pos = [], idx = [];
      for (const m of o.getElementsByTagName("mesh")) {
        const base = pos.length / 3;
        for (const c of m.getElementsByTagName("coordinates")) pos.push(+c.getElementsByTagName("x")[0].textContent * unit, +c.getElementsByTagName("y")[0].textContent * unit, +c.getElementsByTagName("z")[0].textContent * unit);
        for (const t of m.getElementsByTagName("triangle")) idx.push(base + +t.getElementsByTagName("v1")[0].textContent, base + +t.getElementsByTagName("v2")[0].textContent, base + +t.getElementsByTagName("v3")[0].textContent);
      }
      const nm = [...o.getElementsByTagName("metadata")].find((x) => x.getAttribute("type") === "name");
      if (idx.length) out.push(part(nm ? nm.textContent : (EN ? "Object " : "물체 ") + (o.getAttribute("id") || out.length + 1), mesh(pos, idx)));
    }
    if (!out.length) throw new Error("AMF");
    return out;
  }
  // glTF: 장면의 노드 변환을 모두 곱해서 점을 옮긴다. 단위는 미터라 mm 로 1000배 한다. 메시가 달린 노드 하나가 부품 하나
  const mul = (a, b) => { const o = new Array(16); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
  const trs = (n) => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0, (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0, (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  async function readGLTF(buf, isGlb) {
    let json, bin = null;
    if (isGlb) {
      const dv = new DataView(buf); let p = 12;
      while (p < buf.byteLength) { const len = dv.getUint32(p, true), type = dv.getUint32(p + 4, true); if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, p + 8, len))); else if (type === 0x004e4942) bin = new Uint8Array(buf, p + 8, len); p += 8 + len; }
    } else json = JSON.parse(new TextDecoder().decode(buf));
    const buffers = await Promise.all((json.buffers || []).map(async (b) => {
      if (!b.uri) return bin;
      if (b.uri.startsWith("data:")) return new Uint8Array(await (await fetch(b.uri)).arrayBuffer());
      throw new Error(EN ? "glTF uses a separate .bin file. Please convert the .glb version." : "glTF 가 별도 .bin 파일을 씁니다. 하나로 묶인 .glb 로 올려 주세요.");
    }));
    const acc = (i) => {
      const a = json.accessors[i], v = json.bufferViews[a.bufferView], b = buffers[v.buffer], comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
      const C = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
      const stride = v.byteStride || comps * C.BYTES_PER_ELEMENT, base = b.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0), out = new Array(a.count * comps), dv = new DataView(b.buffer);
      const g = { 5120: "getInt8", 5121: "getUint8", 5122: "getInt16", 5123: "getUint16", 5125: "getUint32", 5126: "getFloat32" }[a.componentType];
      for (let i2 = 0; i2 < a.count; i2++) for (let k = 0; k < comps; k++) out[i2 * comps + k] = dv[g](base + i2 * stride + k * C.BYTES_PER_ELEMENT, true);
      return out;
    };
    const out = [], S = 1000;
    const visit = (ni, parent) => {
      const n = json.nodes[ni], m = mul(parent, trs(n));
      if (n.mesh != null) {
        const pos = [], idx = [];
        for (const pr of json.meshes[n.mesh].primitives) {
          if ((pr.mode ?? 4) !== 4 || pr.attributes.POSITION == null) continue;
          const p = acc(pr.attributes.POSITION), base = pos.length / 3;
          for (let i = 0; i < p.length; i += 3) { const x = p[i], y = p[i + 1], z = p[i + 2]; pos.push((m[0] * x + m[4] * y + m[8] * z + m[12]) * S, -(m[2] * x + m[6] * y + m[10] * z + m[14]) * S, (m[1] * x + m[5] * y + m[9] * z + m[13]) * S); }
          const ix = pr.indices != null ? acc(pr.indices) : [...Array(p.length / 3).keys()];
          for (let i = 0; i < ix.length; i += 3) idx.push(base + ix[i], base + ix[i + 2], base + ix[i + 1]);
        }
        if (idx.length) out.push(part(n.name || json.meshes[n.mesh].name || (EN ? "Mesh " : "메시 ") + (out.length + 1), mesh(pos, idx)));
      }
      for (const c of n.children || []) visit(c, m);
    };
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], sc = json.scenes?.[json.scene ?? 0];
    (sc ? sc.nodes : (json.nodes || []).map((_, i) => i)).forEach((n) => visit(n, I));
    if (!out.length) throw new Error("glTF");
    return out;
  }
  async function readFile(f) {
    const ext = f.name.split(".").pop().toLowerCase(), buf = await f.arrayBuffer(), txt = () => new TextDecoder().decode(buf);
    switch (ext) {
      case "stl": return readSTL(buf); case "obj": return readOBJ(txt()); case "off": return [part("", readOFF(txt()))]; case "ply": return [part("", readPLY(buf))];
      case "3mf": return read3MF(buf); case "amf": return readAMF(buf); case "glb": return readGLTF(buf, true); case "gltf": return readGLTF(buf, false);
      default: throw new Error(L.unsupported);
    }
  }
  const merge = (list) => {
    const n = list.reduce((s, m) => s + m.pos.length, 0), t = list.reduce((s, m) => s + m.idx.length, 0), pos = new Float32Array(n), idx = new Uint32Array(t);
    let p = 0, q = 0; for (const m of list) { pos.set(m.pos, p); for (let i = 0; i < m.idx.length; i++) idx[q + i] = m.idx[i] + p / 3; p += m.pos.length; q += m.idx.length; }
    return mesh(pos, idx);
  };
  // 떨어진 덩어리 찾기: 꼭짓점을 공유하는 삼각형끼리 한 덩어리 (STL 하나에 공룡 여러 마리가 든 경우 등)
  function islands(m) {
    const n = m.pos.length / 3, par = new Int32Array(n).map((_, i) => i), I = m.idx;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[b] = a; };
    for (let t = 0; t < I.length; t += 3) { uni(I[t], I[t + 1]); uni(I[t], I[t + 2]); }
    const groups = new Map();
    for (let t = 0; t < I.length; t += 3) { const r = find(I[t]); let g = groups.get(r); if (!g) groups.set(r, (g = [])); g.push(t); }
    return groups;
  }
  function splitIslands(m, max = 400) {
    const groups = [...islands(m).values()].sort((a, b) => b.length - a.length);
    if (groups.length < 2) return [m];
    const keep = groups.slice(0, max - 1), rest = groups.slice(max - 1).flat(), out = [];
    const build = (tris, name) => {
      const map = new Map(), p = [], idx = new Uint32Array(tris.length * 3); let q = 0;
      for (const t of tris) for (let k = 0; k < 3; k++) { const v = m.idx[t + k]; let j = map.get(v); if (j === undefined) { j = p.length / 3; map.set(v, j); p.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]); } idx[q++] = j; }
      return part(name, mesh(p, idx));
    };
    keep.forEach((g, i) => out.push(build(g, `${m.name || "part"} ${i + 1}`)));
    if (rest.length) out.push(build(rest, `${m.name || "part"} ${EN ? "(small pieces)" : "(작은 조각 모음)"}`));
    return out;
  }

  // ── 분석: 크기 · 부피 · 겉넓이 · 열린 모서리 ─────────────────────────
  function analyze(m, quick) {
    const P = m.pos, I = m.idx, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = P[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    let vol = 0, area = 0; const edges = new Map();
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ax = P[a], ay = P[a + 1], az = P[a + 2], bx = P[b], by = P[b + 1], bz = P[b + 2], cx = P[c], cy = P[c + 1], cz = P[c + 2];
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      if (!quick && I.length < 9e6) for (const [p, q] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) { const k = p < q ? p * 4294967296 + q : q * 4294967296 + p; edges.set(k, (edges.get(k) || 0) + 1); }
    }
    let open = 0; for (const c of edges.values()) if (c !== 2) open++;
    const signed = vol; vol = Math.abs(vol);
    const solid = vol / 1000 * 1.24, shell = Math.min(vol, area * 1.2), est = (shell + (vol - shell) * 0.15) / 1000 * 1.24;
    return { mn, mx, size: mx.map((v, k) => v - mn[k]), vol, signed, area, open, tris: I.length / 3, verts: P.length / 3, solid, est };
  }

  // ── 쓰기: 부품 목록을 받는다. 3MF · OBJ · GLB · 문자 STL 은 부품을 따로 담고, 나머지는 하나로 합친다 ─────
  const enc = new TextEncoder(), f6 = (v) => +v.toFixed(5);
  const xmlEsc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const label = (p, i) => (p.name || `part ${i + 1}`).replace(/[\r\n]+/g, " ");
  const W = {
    stl(ps, name) {
      const m = ps.length > 1 ? merge(ps) : ps[0], n = m.idx.length / 3, b = new ArrayBuffer(84 + n * 50), dv = new DataView(b), P = m.pos, I = m.idx;
      const h = enc.encode("UrTeam 3D converter " + name); new Uint8Array(b).set(h.subarray(0, 80));
      dv.setUint32(80, n, true);
      for (let t = 0; t < n; t++) {
        const o = 84 + t * 50, a = I[t * 3] * 3, bb = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
        const ux = P[bb] - P[a], uy = P[bb + 1] - P[a + 1], uz = P[bb + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
        dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
        for (const [j, v] of [[0, a], [1, bb], [2, c]]) for (let k = 0; k < 3; k++) dv.setFloat32(o + 12 + j * 12 + k * 4, P[v + k], true);
      }
      return new Blob([b]);
    },
    stla(ps) {
      const out = [];
      ps.forEach((m, i) => {
        const P = m.pos, I = m.idx, nm = label(m, i).replace(/\s+/g, "_");
        out.push(`solid ${nm}\n`);
        for (let t = 0; t < I.length; t += 3) { out.push(" facet normal 0 0 0\n  outer loop\n"); for (let j = 0; j < 3; j++) { const v = I[t + j] * 3; out.push(`   vertex ${f6(P[v])} ${f6(P[v + 1])} ${f6(P[v + 2])}\n`); } out.push("  endloop\n endfacet\n"); }
        out.push(`endsolid ${nm}\n`);
      });
      return new Blob(out);
    },
    obj(ps) {
      const out = ["# UrTeam 3D converter (ur-team.com/3d-converter/)\n"]; let base = 1;
      ps.forEach((m, i) => {
        const P = m.pos, I = m.idx; out.push(`o ${label(m, i)}\n`);
        for (let k = 0; k < P.length; k += 3) out.push(`v ${f6(P[k])} ${f6(P[k + 1])} ${f6(P[k + 2])}\n`);
        for (let t = 0; t < I.length; t += 3) out.push(`f ${I[t] + base} ${I[t + 1] + base} ${I[t + 2] + base}\n`);
        base += P.length / 3;
      });
      return new Blob(out);
    },
    off(ps) {
      const m = ps.length > 1 ? merge(ps) : ps[0], P = m.pos, I = m.idx, out = [`OFF\n${P.length / 3} ${I.length / 3} 0\n`];
      for (let i = 0; i < P.length; i += 3) out.push(`${f6(P[i])} ${f6(P[i + 1])} ${f6(P[i + 2])}\n`);
      for (let t = 0; t < I.length; t += 3) out.push(`3 ${I[t]} ${I[t + 1]} ${I[t + 2]}\n`);
      return new Blob(out);
    },
    ply(ps) {
      const m = ps.length > 1 ? merge(ps) : ps[0], nv = m.pos.length / 3, nf = m.idx.length / 3, head = enc.encode(`ply\nformat binary_little_endian 1.0\ncomment UrTeam 3D converter\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\nelement face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`);
      const b = new ArrayBuffer(nf * 13), dv = new DataView(b);
      for (let t = 0; t < nf; t++) { dv.setUint8(t * 13, 3); for (let j = 0; j < 3; j++) dv.setInt32(t * 13 + 1 + j * 4, m.idx[t * 3 + j], true); }
      return new Blob([head, m.pos.buffer.slice(m.pos.byteOffset, m.pos.byteOffset + m.pos.byteLength), b]);
    },
    async "3mf"(ps) {
      const objs = [], items = [];
      ps.forEach((m, i) => {
        const P = m.pos, I = m.idx, vs = [], ts = [];
        for (let k = 0; k < P.length; k += 3) vs.push(`<vertex x="${f6(P[k])}" y="${f6(P[k + 1])}" z="${f6(P[k + 2])}"/>`);
        for (let t = 0; t < I.length; t += 3) ts.push(`<triangle v1="${I[t]}" v2="${I[t + 1]}" v3="${I[t + 2]}"/>`);
        objs.push(`<object id="${i + 1}" name="${xmlEsc(label(m, i))}" type="model"><mesh><vertices>${vs.join("")}</vertices><triangles>${ts.join("")}</triangles></mesh></object>`);
        items.push(`<item objectid="${i + 1}"/>`);
      });
      const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">UrTeam 3D converter</metadata><resources>${objs.join("")}</resources><build>${items.join("")}</build></model>`;
      return zip([
        { name: "[Content_Types].xml", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
        { name: "_rels/.rels", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
        { name: "3D/3dmodel.model", data: enc.encode(model) },
      ], true);
    },
    glb(ps) { // mm → m, Z 위 → Y 위. 부품 하나 = 노드 하나
      const chunks = [], views = [], accs = [], meshes = [], nodes = []; let off = 0;
      ps.forEach((m, i) => {
        const P = m.pos, n = P.length / 3, pos = new Float32Array(P.length), mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (let j = 0; j < n; j++) { const v = [P[j * 3] / 1000, P[j * 3 + 2] / 1000, -P[j * 3 + 1] / 1000]; for (let k = 0; k < 3; k++) { pos[j * 3 + k] = v[k]; mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); } }
        const idx = new Uint32Array(m.idx);
        views.push({ buffer: 0, byteOffset: off, byteLength: pos.byteLength, target: 34962 }); off += pos.byteLength;
        views.push({ buffer: 0, byteOffset: off, byteLength: idx.byteLength, target: 34963 }); off += idx.byteLength;
        accs.push({ bufferView: i * 2, componentType: 5126, count: n, type: "VEC3", min: mn, max: mx }, { bufferView: i * 2 + 1, componentType: 5125, count: idx.length, type: "SCALAR" });
        meshes.push({ name: label(m, i), primitives: [{ attributes: { POSITION: i * 2 }, indices: i * 2 + 1, material: 0 }] });
        nodes.push({ name: label(m, i), mesh: i });
        chunks.push(pos, idx);
      });
      const json = { asset: { version: "2.0", generator: "UrTeam 3D converter" }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes,
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.85, 0.85, 0.85, 1], metallicFactor: 0, roughnessFactor: 0.7 } }],
        buffers: [{ byteLength: off }], bufferViews: views, accessors: accs };
      let js = enc.encode(JSON.stringify(json)); const jp = (4 - (js.length % 4)) % 4; js = new Uint8Array([...js, ...new Array(jp).fill(32)]);
      const h = new DataView(new ArrayBuffer(20)), total = 12 + 8 + js.length + 8 + off;
      h.setUint32(0, 0x46546c67, true); h.setUint32(4, 2, true); h.setUint32(8, total, true); h.setUint32(12, js.length, true); h.setUint32(16, 0x4e4f534a, true);
      const bh = new DataView(new ArrayBuffer(8)); bh.setUint32(0, off, true); bh.setUint32(4, 0x004e4942, true);
      return new Blob([h, js, bh, ...chunks]);
    },
  };
  const EXT = { stl: "stl", stla: "stl", obj: "obj", off: "off", ply: "ply", "3mf": "3mf", glb: "glb" };
  const KEEPS = { stla: 1, obj: 1, "3mf": 1, glb: 1 }; // 한 파일 안에 부품을 따로 담는 형식

  // ── 화면: WebGL 뷰어 (부품마다 색을 달리해 그린다) ─────────────────────
  const cv = $("canvas[data-view]"), gl = cv.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true });
  let prog, vao, parts = [], ranges = [], info = null, hi = -1, yaw = 0.7, pitch = 0.55, zoom = 1, drag = null, raf = 0;
  const COLORS = [[.15, .36, .96], [.93, .45, .12], [.12, .62, .42], [.78, .2, .5], [.55, .38, .9], [.85, .68, .1], [.1, .6, .75], [.6, .4, .25], [.4, .55, .15], [.9, .3, .3]];
  const colorOf = (i) => (parts.length === 1 ? COLORS[0] : COLORS[i % COLORS.length]);
  if (gl) {
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
      in vec3 aP; uniform vec3 uC; uniform float uS, uYaw, uPitch, uAsp; out vec3 vP;
      void main(){ vec3 p=(aP-uC)*uS; p=vec3(p.x,p.z,-p.y); float c=cos(uYaw),s=sin(uYaw); p=vec3(c*p.x+s*p.z,p.y,c*p.z-s*p.x); c=cos(uPitch); s=sin(uPitch); p=vec3(p.x,c*p.y-s*p.z,s*p.y+c*p.z);
        p.z-=3.0; vP=p; gl_Position=vec4(p.x*2.4/max(uAsp,1.),p.y*2.4*min(uAsp,1.),(p.z*10.5+10.)/-9.5,-p.z); }`));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; in vec3 vP; uniform vec3 uCol; out vec4 o;
      void main(){ vec3 n=normalize(cross(dFdx(vP),dFdy(vP))); if(n.z<0.) n=-n; vec3 L=normalize(vec3(.4,.7,.6));
        float k=.32+.62*max(dot(n,L),0.)+.14*max(dot(n,normalize(vec3(-.7,.1,.5))),0.); float sp=pow(max(dot(n,normalize(L+vec3(0,0,1))),0.),40.);
        o=vec4(uCol*k+sp*.25,1.); }`));
    gl.linkProgram(prog);
  }
  const U = (n) => gl.getUniformLocation(prog, n);
  function upload() { // 모든 부품을 한 버퍼에 넣고, 부품마다 그릴 구간만 기억한다
    if (!gl) return;
    const all = merge(parts); ranges = []; let q = 0; for (const p of parts) { ranges.push([q, p.idx.length]); q += p.idx.length; }
    gl.useProgram(prog); vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, all.pos, gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, "aP"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, all.idx, gl.STATIC_DRAW);
    zoom = 1; kick();
  }
  function draw() {
    raf = 0; if (!gl || !info) return;
    const r = Math.min(devicePixelRatio || 1, 2), w = Math.round(cv.clientWidth * r), h = Math.round(cv.clientHeight * r);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
    gl.useProgram(prog); gl.bindVertexArray(vao);
    gl.uniform3fv(U("uC"), info.mn.map((v, k) => v + info.size[k] / 2)); gl.uniform1f(U("uS"), 2 / Math.max(1e-6, Math.hypot(...info.size)) * zoom);
    gl.uniform1f(U("uYaw"), yaw); gl.uniform1f(U("uPitch"), pitch); gl.uniform1f(U("uAsp"), w / h);
    parts.forEach((p, i) => {
      if (!p.on) return;
      const c = colorOf(i); gl.uniform3fv(U("uCol"), hi < 0 || hi === i ? c : c.map((v) => v * 0.25 + 0.6));
      gl.drawElements(gl.TRIANGLES, ranges[i][1], gl.UNSIGNED_INT, ranges[i][0] * 4);
    });
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(draw); };
  cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener("pointermove", (e) => { if (!drag) return; yaw += (e.clientX - drag.x) * 0.01; pitch = Math.max(-1.4, Math.min(1.4, pitch + (e.clientY - drag.y) * 0.008)); drag = { x: e.clientX, y: e.clientY }; kick(); });
  const up = () => { drag = null; }; cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  cv.addEventListener("wheel", (e) => { if (!info) return; e.preventDefault(); zoom = Math.max(0.3, Math.min(6, zoom * Math.exp(-e.deltaY * 0.0012))); kick(); }, { passive: false });
  addEventListener("resize", kick);

  // ── 화면: 파일 받기 · 부품 목록 · 정보 표시 · 내려받기 ──────────────────
  const fmt = (n, k = 1) => n.toLocaleString(EN ? "en-US" : "ko-KR", { maximumFractionDigits: k });
  const chosen = () => parts.filter((p) => p.on);
  let baseName = "model";
  async function load(files) {
    files = [...files].filter(Boolean); if (!files.length) return;
    say(L.reading); root.classList.remove("is-ready", "is-done"); offer(false);
    try {
      const list = [];
      for (const f of files) {
        const ext = f.name.split(".").pop().toLowerCase(), stem = f.name.replace(/\.[^.]+$/, "");
        if (!IN.includes(ext)) throw new Error(`.${ext} — ${L.unsupported}`);
        const ps = await readFile(f);
        ps.forEach((p, i) => { p.name = ps.length === 1 ? (files.length > 1 || !p.name ? stem : p.name) : (files.length > 1 ? `${stem} / ` : "") + (p.name || `${L.part} ${i + 1}`); list.push(p); });
      }
      const s = +$("[data-scale]").value;
      if (s !== 1) for (const p of list) for (let i = 0; i < p.pos.length; i++) p.pos[i] *= s;
      parts = list; parts.forEach((p) => { p.on = true; }); scaleNow = 1; if ($("[data-resize]")) $("[data-resize]").value = 100;
      baseName = files[0].name.replace(/\.[^.]+$/, "") + (files.length > 1 ? "_merged" : "");
      upload(); refresh(); root.classList.add("is-ready");
      // 하나로 보이는 부품 안에 떨어진 조각이 여럿이면 나눌지 묻는다
      const loose = parts.length < 400 ? parts.reduce((n, p) => n + (p.idx.length < 6e6 ? Math.max(0, islands(p).size - 1) : 0), 0) : 0;
      $("[data-islands]").hidden = !loose;
      if (loose) $("[data-islands]").textContent = L.splitN(loose + parts.length);
      say(parts.length > 1 ? L.manyParts(parts.length) : L.done);
      setTimeout(() => { if ($("[data-check-out]")) resultCheck(); else if ($("[data-calc]")) resultCalc(); }, 350);
    } catch (e) { say(L.fail + (e.message || e), true); }
  }
  function refresh() { // 보이는 부품만으로 정보를 다시 계산한다
    const on = chosen();
    info = on.length ? analyze(on.length > 1 ? merge(on) : on[0]) : null;
    list(); show(); calc(); check(); kick();
  }
  function list() {
    const box = $("[data-parts]"), wrap = $("[data-parts-wrap]");
    wrap.hidden = !parts.length; box.textContent = "";
    $("[data-parts-count]").textContent = parts.length > 1 ? `${parts.length}${L.partsUnit} · ${L.showing} ${chosen().length}` : "";
    $("[data-each-wrap]").hidden = chosen().length < 2;
    parts.forEach((p, i) => {
      p.st = p.st || analyze(p, true);
      const li = d.createElement("li"), lab = d.createElement("label"), cb = d.createElement("input"), dot = d.createElement("i"), nm = d.createElement("span"), meta = d.createElement("small");
      cb.type = "checkbox"; cb.checked = p.on; cb.addEventListener("change", () => { p.on = cb.checked; refresh(); });
      dot.style.background = `rgb(${colorOf(i).map((v) => Math.round(v * 255)).join(",")})`; dot.setAttribute("aria-hidden", "true");
      nm.textContent = p.name; meta.textContent = `${p.st.size.map((v) => fmt(v, 0)).join("×")} mm · ${EN ? "about " : "약 "}${fmt(p.st.est, 1)} g`;
      lab.append(cb, dot, nm, meta); li.appendChild(lab);
      li.addEventListener("pointerenter", () => { if (parts.length > 1) { hi = i; kick(); } });
      li.addEventListener("pointerleave", () => { hi = -1; kick(); });
      box.appendChild(li);
    });
  }
  function show() {
    const dl = $("[data-info]"); dl.textContent = "";
    if (!info) { dl.innerHTML = `<div><dt>${L.size}</dt><dd>${L.noneShown}</dd></div>`; return; }
    const s = info.size, rows = [
      [L.size, `${fmt(s[0])} × ${fmt(s[1])} × ${fmt(s[2])} mm`], [L.tris, fmt(info.tris, 0)], [L.verts, fmt(info.verts, 0)],
      [L.vol, `${fmt(info.vol / 1000, 2)} cm³`], [L.area, `${fmt(info.area / 100, 1)} cm²`],
      [L.solid, `${fmt(info.solid, 1)} g`], [L.est, `${EN ? "about " : "약 "}${fmt(info.est, 1)} g`],
      [L.open, info.open ? `${fmt(info.open, 0)} ${L.notClosed}` : L.closed],
    ];
    if (parts.length > 1) rows.unshift([L.partsLabel, `${chosen().length} / ${parts.length}`]);
    for (const [a, b] of rows) { const r = d.createElement("div"), dt = d.createElement("dt"), dd = d.createElement("dd"); dt.textContent = a; dd.textContent = b; r.append(dt, dd); dl.appendChild(r); }
    $("[data-info-open]").classList.toggle("is-bad", !!info.open);
    const lg = $("[data-longest]"); if (lg && d.activeElement !== lg) lg.value = +Math.max(...info.size).toFixed(2);
    const on = chosen();
    try { sessionStorage.setItem("p3-prefill", JSON.stringify({ size: `${Math.round(s[0])} × ${Math.round(s[1])} × ${Math.round(s[2])} mm`, item: `${baseName}${on.length > 1 ? ` (${L.partsLabel} ${on.length}${L.partsUnit})` : ""} (${fmt(info.vol / 1000, 1)} cm³)` })); } catch (e) {}
  }
  const save = (blob, name) => { const a = d.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; d.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const safe = (t) => t.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 80) || "part";
  async function exportIt() {
    const on = chosen(); if (!on.length) return say(L.noneShown, true);
    const to = $("[data-to]").value, pack = $("[data-pack]").value, part = +$("[data-split]").value * 1024 * 1024, each = on.length > 1 && $("[data-each]").value === "each";
    say(L.making);
    try {
      let blob, name;
      if (each) { // 부품마다 따로 만든 뒤 ZIP 하나로 묶는다
        const used = new Map(), files = [];
        for (const p of on) { let n = safe(p.name); const c = used.get(n) || 0; used.set(n, c + 1); if (c) n += "_" + (c + 1); files.push({ name: `${n}.${EXT[to]}`, data: new Uint8Array(await (await W[to]([p], n)).arrayBuffer()) }); }
        blob = await zip(files, true); name = `${baseName}_${on.length}parts.zip`;
      } else {
        blob = await W[to](on, baseName); name = `${baseName}.${EXT[to]}`;
        if (pack === "zip" || part) { blob = await zip([{ name, data: new Uint8Array(await blob.arrayBuffer()) }], true); name += ".zip"; }
      }
      if (part && blob.size > part) {
        const n = Math.ceil(blob.size / part);
        for (let i = 0; i < n; i++) { save(blob.slice(i * part, (i + 1) * part), `${name}.${String(i + 1).padStart(3, "0")}`); await new Promise((r) => setTimeout(r, 350)); }
        say(`${L.saved}: ${name}.001 ~ .${String(n).padStart(3, "0")} (${n}${L.files})`);
      } else { save(blob, name); say(`${L.saved}: ${name} (${fmt(blob.size / 1048576, 2)} MB)${on.length > 1 && !each && !KEEPS[to] ? " · " + L.merged : ""}`); }
      root.classList.add("is-done"); offer(true);
    } catch (e) { say(L.fail + (e.message || e), true); }
  }
  // 변환이 끝나면 출력 제안을 띄운다
  // 내려받기가 시작된 뒤 잠깐 있다가 팝업으로 띄운다. 파일을 새로 열 때까지 한 번만
  let offered = false, offerT = 0;
  function offer(on) {
    const o = $("[data-offer]"); if (!o || !o.showModal) return;
    clearTimeout(offerT);
    if (!on) { offered = false; if (o.open) o.close(); return; }
    if (offered) return; offered = true;
    offerT = setTimeout(() => { if (offered && !o.open) o.showModal(); }, 600);
  }
  const pick = $("input[type=file]"), zone = $("[data-drop]");
  pick.addEventListener("change", () => load(pick.files));
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("is-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
  zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("is-over"); load(e.dataTransfer.files); });
  $("[data-go]").addEventListener("click", exportIt);
  $("[data-png]").addEventListener("click", () => { if (!info) return; draw(); cv.toBlob((b) => b && save(b, baseName + ".png"), "image/png"); });
  $("[data-all]").addEventListener("click", () => { parts.forEach((p) => { p.on = true; }); refresh(); });
  $("[data-none]").addEventListener("click", () => { parts.forEach((p) => { p.on = false; }); refresh(); });
  $("[data-islands]").addEventListener("click", () => {
    say(L.reading);
    setTimeout(() => {
      const next = parts.flatMap((p) => (p.on ? splitIslands(p) : [p])); next.forEach((p) => { if (p.on === undefined) p.on = true; });
      parts = next; upload(); refresh(); $("[data-islands]").hidden = true; say(L.manyParts(parts.length));
    }, 20);
  });
  root.querySelectorAll("[data-offer-close]").forEach((b) => b.addEventListener("click", () => $("[data-offer]").close()));
  $("[data-offer]")?.addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }); // 바깥 어두운 곳을 누르면 닫기

  // ── 크기 조절 (%, 또는 가장 긴 변 mm) ─────────────────────────────
  let scaleNow = 1;
  function rescale(f) {
    if (!parts.length || !(f > 0)) return;
    const r = f / scaleNow; scaleNow = f;
    for (const p of parts) { for (let i = 0; i < p.pos.length; i++) p.pos[i] *= r; p.st = null; }
    upload(); refresh();
    const rz = $("[data-resize]"), lg = $("[data-longest]");
    if (rz) rz.value = +(f * 100).toFixed(2);
    if (lg && info) lg.value = +Math.max(...info.size).toFixed(2);
  }
  $("[data-resize]")?.addEventListener("change", (e) => rescale(+e.target.value / 100));
  $("[data-longest]")?.addEventListener("change", (e) => { if (info) rescale(scaleNow * +e.target.value / Math.max(...info.size)); });

  // ── 무게 · 재료 계산 ([data-calc] 가 있는 페이지) ─────────────────────
  const MAT = { pla: [1.24, "PLA"], petg: [1.27, "PETG"], abs: [1.04, "ABS"], asa: [1.07, "ASA"], tpu: [1.21, "TPU"], resin: [1.12, EN ? "Resin (SLA)" : "레진 (SLA)"] };
  let lastCalc = null, lastCheck = null;
  function calc() {
    const box = $("[data-calc]"); if (!box) return;
    const out = $("[data-calc-out]");
    if (!info) { out.textContent = EN ? "Open a model to see the estimate." : "모델을 열면 계산됩니다."; return; }
    const m = $("[data-mat]").value, fill = +$("[data-fill]").value / 100, walls = +$("[data-walls]").value, qty = Math.max(1, +$("[data-qty]").value || 1);
    const resin = m === "resin", t = resin ? 2 : walls * 0.42;
    const shell = Math.min(info.vol, info.area * t), cm3 = (fill >= 1 ? info.vol : shell + (info.vol - shell) * fill) / 1000, g = cm3 * MAT[m][0];
    const r = $("[data-dia]")?.value === "2.85" ? 0.1425 : 0.0875, len = cm3 / (Math.PI * r * r) / 100;
    const rows = [[EN ? "Material used" : "쓰이는 재료", `${fmt(cm3, 2)} cm³`], [EN ? "Weight (1 pc)" : "무게 (1개)", `${fmt(g, 1)} g`],
      resin ? [EN ? "Resin" : "레진 양", `${fmt(cm3, 1)} ml`] : [EN ? "Filament length" : "필라멘트 길이", `${fmt(len, 2)} m`]];
    if (qty > 1) rows.push([EN ? `Total for ${qty}` : `${qty}개 합계`, `${fmt(g * qty, 1)} g`]);
    lastCalc = { g: g * qty, one: g, mat: MAT[m][1], qty };
    out.textContent = "";
    for (const [a, b] of rows) { const r2 = d.createElement("div"), dt = d.createElement("dt"), dd = d.createElement("dd"); dt.textContent = a; dd.textContent = b; r2.append(dt, dd); out.appendChild(r2); }
    try { const pf = JSON.parse(sessionStorage.getItem("p3-prefill") || "{}"); pf.item = `${pf.item || baseName} · ${MAT[m][1]} ${EN ? "about" : "약"} ${fmt(g * qty, 0)} g${qty > 1 ? ` (${qty}${EN ? " pcs" : "개"})` : ""}`; sessionStorage.setItem("p3-prefill", JSON.stringify(pf)); } catch (e) {}
  }
  root.querySelectorAll("[data-mat],[data-fill],[data-walls],[data-qty],[data-dia]").forEach((x) => x.addEventListener("input", calc));
  $("[data-mat]")?.addEventListener("change", () => { const r = $("[data-mat]").value === "resin"; $("[data-walls-wrap]").hidden = r; });

  // ── 출력 가능 검사 ([data-check] 가 있는 페이지) ──────────────────────
  function check() {
    const box = $("[data-check-out]"); if (!box) return;
    box.textContent = "";
    if (!info) return;
    const s = info.size, mx = Math.max(...s), mnD = Math.min(...s), on = chosen();
    let loose = 0; if (on.length < 400) for (const p of on) if (p.idx.length < 6e6) loose += islands(p).size; else loose += 1;
    const flipped = on.filter((p) => (p.st || analyze(p, true)).signed < 0).length;
    const K = EN ? {
      ok: "OK", warn: "Check", bad: "Fix needed",
    } : { ok: "통과", warn: "확인", bad: "수정 필요" };
    const items = [
      info.open ? ["bad", EN ? "Holes / open edges" : "구멍 · 열린 모서리", EN ? `${fmt(info.open, 0)} open edges. The slicer may fill or skip these areas.` : `열린 모서리 ${fmt(info.open, 0)}개. 슬라이서가 이 부분을 비우거나 잘못 채울 수 있습니다.`]
        : ["ok", EN ? "Closed shape" : "닫힌 형상", EN ? "No holes found. The model is watertight." : "구멍이 없습니다. 안이 꽉 막힌 형상입니다."],
      flipped ? ["bad", EN ? "Inverted faces" : "뒤집힌 면", EN ? `${flipped} part(s) have faces pointing inward.` : `부품 ${flipped}개의 면이 안쪽을 향합니다. 출력 시 안팎이 바뀔 수 있습니다.`]
        : ["ok", EN ? "Face direction" : "면 방향", EN ? "Faces point outward." : "면이 바깥을 향합니다."],
      mx > 2000 || mx < 3 ? ["warn", EN ? "Unit" : "단위", EN ? `Longest side is ${fmt(mx)} mm. The file may be in m or inch. Change 'Original unit'.` : `가장 긴 변이 ${fmt(mx)} mm 입니다. 원래 m · inch 로 만든 파일일 수 있습니다. '원본 단위'를 바꿔 보세요.`]
        : ["ok", EN ? "Unit" : "단위", EN ? `${fmt(s[0])} × ${fmt(s[1])} × ${fmt(s[2])} mm looks reasonable.` : `${fmt(s[0])} × ${fmt(s[1])} × ${fmt(s[2])} mm, 자연스러운 크기입니다.`],
      mx > 256 ? ["warn", EN ? "Build size" : "출력 크기", EN ? "Larger than a typical 256 mm printer. It will be printed in pieces and joined." : "일반 프린터(256 mm)보다 큽니다. 나눠 출력한 뒤 붙여야 합니다. 분할 설계도 도와드립니다."]
        : ["ok", EN ? "Build size" : "출력 크기", EN ? "Fits a typical printer in one piece." : "일반 프린터에서 한 번에 출력할 수 있는 크기입니다."],
      mnD > 0 && mnD < 1.2 ? ["warn", EN ? "Very thin" : "아주 얇음", EN ? `The thinnest side is ${fmt(mnD, 2)} mm. Below about 1.2 mm may break or not print.` : `가장 얇은 방향이 ${fmt(mnD, 2)} mm 입니다. 1.2 mm 보다 얇으면 부러지거나 출력되지 않을 수 있습니다.`] : null,
      loose > on.length ? ["warn", EN ? "Loose pieces" : "떨어진 조각", EN ? `${loose} separate pieces. Small floating pieces need support or may be lost.` : `서로 떨어진 조각이 ${loose}개입니다. 공중에 뜬 작은 조각은 받침이 필요하거나 떨어져 나갈 수 있습니다.`] : null,
      info.tris > 2e6 ? ["warn", EN ? "File weight" : "용량", EN ? `${fmt(info.tris, 0)} triangles. Slicers get slow; it can be simplified.` : `삼각형이 ${fmt(info.tris, 0)}개로 무겁습니다. 슬라이서가 느려질 수 있어 줄이는 편이 좋습니다.`] : null,
    ].filter(Boolean);
    const bad = items.filter((x) => x[0] === "bad").length, warn = items.filter((x) => x[0] === "warn").length;
    const head = d.createElement("p"); head.className = "tl__ck-sum " + (bad ? "is-bad" : warn ? "is-warn" : "is-ok");
    head.textContent = bad ? (EN ? `${bad} problem(s) to fix before printing.` : `출력 전에 고쳐야 할 문제가 ${bad}개 있습니다.`) : warn ? (EN ? `Printable, ${warn} item(s) to check.` : `출력은 가능하고, 확인할 점이 ${warn}개 있습니다.`) : (EN ? "Ready to print." : "바로 출력할 수 있는 상태입니다.");
    box.appendChild(head);
    const ul = d.createElement("ul"); ul.className = "tl__ck";
    for (const [k, t, msg] of items) { const li = d.createElement("li"), b = d.createElement("b"), sp = d.createElement("span"), em = d.createElement("em"); li.className = "is-" + k; em.textContent = K[k]; b.textContent = t; sp.textContent = msg; li.append(em, b, sp); ul.appendChild(li); }
    box.appendChild(ul);
    lastCheck = { head: head.textContent, bad, warn };
  }

  // ── 결과 팝업 (무게 계산 · 출력 검사) ─────────────────────────────
  function showResult(k, h, node, p, cta) {
    const dlg = $("[data-result]"); if (!dlg || !dlg.showModal) return;
    $("[data-result-k]").textContent = k; $("[data-result-h]").textContent = h; $("[data-result-p]").textContent = p; $("[data-result-cta]").textContent = cta;
    const body = $("[data-result-body]"); body.textContent = ""; if (node) body.appendChild(node.cloneNode(true));
    if (offerT) clearTimeout(offerT); const off = $("[data-offer]"); if (off?.open) off.close();
    if (!dlg.open) dlg.showModal();
  }
  function resultCalc() {
    if (!info || !lastCalc) return;
    showResult(EN ? "Estimate" : "계산 결과", EN ? `About ${fmt(lastCalc.g, 1)} g of ${lastCalc.mat}` : `${lastCalc.mat} 약 ${fmt(lastCalc.g, 1)} g`, $("[data-calc-out]"),
      EN ? "Supports and brims are not included; real prints are usually 10–30 % heavier. Send the file and we will review it and quote by the actual material weight." : "받침(서포트)과 바닥판은 빠진 값이라 실제로는 보통 10~30% 더 나옵니다. 파일을 보내 주시면 출력 전에 검토해 피드백을 드리고, 실제로 쓰인 재료 무게로 정확히 견적해 드립니다.",
      EN ? "Get a print quote" : "이 무게로 출력 견적 받기");
  }
  function resultCheck() {
    if (!info || !lastCheck) return;
    showResult(EN ? "Check result" : "검사 결과", lastCheck.head, $("[data-check-out] ul"),
      lastCheck.bad ? (EN ? "We can review and fix the file, then print it." : "문제가 있는 파일도 괜찮습니다. 유어팀이 파일을 검토해 문제점을 피드백 드리고, 바로잡은 모델로 출력까지 진행합니다.")
        : (EN ? "Automatic checks cannot see thin walls or support needs. We review every file by hand before printing." : "자동 검사로는 부분적으로 얇은 벽, 받침이 필요한 기울기까지는 알 수 없습니다. 출력 전에 사람이 직접 한 번 더 검토해 드립니다."),
      lastCheck.bad ? (EN ? "Ask us to review and fix" : "파일 검토 · 수정 요청하기") : (EN ? "Get a print quote" : "이 모델 출력 견적 받기"));
  }
  root.querySelectorAll("[data-result-close]").forEach((b) => b.addEventListener("click", () => $("[data-result]").close()));
  $("[data-result]")?.addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $("[data-calc-go]")?.addEventListener("click", resultCalc);
  $("[data-check-go]")?.addEventListener("click", resultCheck);
  const preset = root.dataset.preset; if (preset && W[preset]) $("[data-to]").value = preset;
  if (root.dataset.presetSplit) $("[data-split]").value = root.dataset.presetSplit;
})();
