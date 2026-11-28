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
    done: "Ready. Your file was not uploaded anywhere.", parts: "parts", saved: "Saved", making: "Making the file…",
  } : {
    drop: "3D 파일을 여기에 끌어 놓거나 눌러서 고르세요", reading: "읽는 중…", fail: "이 파일을 읽지 못했습니다: ", unsupported: "이 형식은 브라우저에서 바로 변환할 수 없습니다. 파일을 보내 주시면 확인해 드립니다.",
    tris: "삼각형", verts: "꼭짓점", size: "크기", vol: "부피", area: "겉넓이", solid: "꽉 채운 PLA", est: "일반 출력 (외벽 3줄 · 채움 15%)", open: "열린 모서리", closed: "닫힌 형상 (출력 가능)", notClosed: "개의 열린 모서리, 보정이 필요할 수 있음",
    done: "준비됐습니다. 파일은 어디에도 올라가지 않았습니다.", parts: "개 파일", saved: "저장했습니다", making: "파일을 만드는 중…",
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
  async function zip(files, pack) { // files: [{name, data:Uint8Array}], pack: true 면 압축
    const enc = new TextEncoder(), chunks = [], cent = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), body = pack ? await deflate(f.data) : f.data, m = pack ? 8 : 0;
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(8, m, true);
      h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true);
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(10, m, true);
      c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      chunks.push(h, name, body); cent.push(c, name); off += 30 + name.length + body.length;
    }
    const csz = cent.reduce((s, x) => s + (x.byteLength ?? x.length), 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csz, true); e.setUint32(16, off, true);
    return new Blob([...chunks, ...cent, e]);
  }

  // ── 읽기: 모두 { pos: Float32Array(xyz…), idx: Uint32Array(삼각형 3개씩) } 로 ─────
  const mesh = (pos, idx) => ({ pos: pos instanceof Float32Array ? pos : new Float32Array(pos), idx: idx instanceof Uint32Array ? idx : new Uint32Array(idx) });
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
        return weld(pos);
      }
    }
    const t = new TextDecoder().decode(buf), out = [], re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g; let m;
    while ((m = re.exec(t))) out.push(+m[1], +m[2], +m[3]);
    if (!out.length) throw new Error("STL");
    return weld(new Float32Array(out));
  }
  function readOBJ(t) {
    const pos = [], idx = []; let nv = 0;
    for (const line of t.split(/\r?\n/)) {
      const s = line.trim().split(/\s+/);
      if (s[0] === "v") { pos.push(+s[1], +s[2], +s[3]); nv++; }
      else if (s[0] === "f") {
        const f = s.slice(1).map((x) => { const i = parseInt(x, 10); return i < 0 ? nv + i : i - 1; });
        for (let k = 1; k + 1 < f.length; k++) idx.push(f[0], f[k], f[k + 1]);
      }
    }
    if (!idx.length) throw new Error("OBJ");
    return mesh(pos, idx);
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
  async function read3MF(buf) {
    const files = await unzip(buf), name = Object.keys(files).find((n) => /^3D\/.*\.model$/i.test(n)) || Object.keys(files).find((n) => /\.model$/i.test(n));
    if (!name) throw new Error("3MF");
    const doc = xmlDoc(new TextDecoder().decode(await files[name])), unit = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[doc.documentElement.getAttribute("unit") || "millimeter"] || 1;
    const objs = {};
    for (const o of doc.getElementsByTagName("object")) {
      const m = o.getElementsByTagName("mesh")[0]; if (!m) continue;
      const pos = [], idx = [];
      for (const v of m.getElementsByTagName("vertex")) pos.push(+v.getAttribute("x") * unit, +v.getAttribute("y") * unit, +v.getAttribute("z") * unit);
      for (const tr of m.getElementsByTagName("triangle")) idx.push(+tr.getAttribute("v1"), +tr.getAttribute("v2"), +tr.getAttribute("v3"));
      objs[o.getAttribute("id")] = { pos, idx };
    }
    const items = [...doc.getElementsByTagName("item")].filter((it) => objs[it.getAttribute("objectid")]);
    const list = items.length ? items.map((it) => [objs[it.getAttribute("objectid")], it.getAttribute("transform")]) : Object.values(objs).map((o) => [o, null]);
    const pos = [], idx = [];
    for (const [o, tf] of list) {
      const base = pos.length / 3, m = tf ? tf.trim().split(/\s+/).map(Number) : null;
      for (let i = 0; i < o.pos.length; i += 3) {
        const x = o.pos[i], y = o.pos[i + 1], z = o.pos[i + 2];
        if (m) pos.push(x * m[0] + y * m[3] + z * m[6] + m[9] * unit, x * m[1] + y * m[4] + z * m[7] + m[10] * unit, x * m[2] + y * m[5] + z * m[8] + m[11] * unit);
        else pos.push(x, y, z);
      }
      for (const v of o.idx) idx.push(v + base);
    }
    if (!idx.length) throw new Error("3MF");
    return mesh(pos, idx);
  }
  async function readAMF(buf) {
    let u8 = new Uint8Array(buf);
    if (u8[0] === 0x50 && u8[1] === 0x4b) { const f = await unzip(buf); u8 = await Object.values(f)[0]; }
    const doc = xmlDoc(new TextDecoder().decode(u8)), unit = { micron: 0.001, millimeter: 1, inch: 25.4, feet: 304.8, meter: 1000 }[doc.documentElement.getAttribute("unit") || "millimeter"] || 1;
    const pos = [], idx = [];
    for (const m of doc.getElementsByTagName("mesh")) {
      const base = pos.length / 3;
      for (const c of m.getElementsByTagName("coordinates")) pos.push(+c.getElementsByTagName("x")[0].textContent * unit, +c.getElementsByTagName("y")[0].textContent * unit, +c.getElementsByTagName("z")[0].textContent * unit);
      for (const t of m.getElementsByTagName("triangle")) idx.push(base + +t.getElementsByTagName("v1")[0].textContent, base + +t.getElementsByTagName("v2")[0].textContent, base + +t.getElementsByTagName("v3")[0].textContent);
    }
    if (!idx.length) throw new Error("AMF");
    return mesh(pos, idx);
  }
  // glTF: 장면의 노드 변환을 모두 곱해서 점을 옮긴다. 단위는 미터라 mm 로 1000배 한다
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
    const buffers = await Promise.all((json.buffers || []).map(async (b, i) => {
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
    const pos = [], idx = [], S = 1000;
    const visit = (ni, parent) => {
      const n = json.nodes[ni], m = mul(parent, trs(n));
      if (n.mesh != null) for (const pr of json.meshes[n.mesh].primitives) {
        if ((pr.mode ?? 4) !== 4 || pr.attributes.POSITION == null) continue;
        const p = acc(pr.attributes.POSITION), base = pos.length / 3;
        for (let i = 0; i < p.length; i += 3) { const x = p[i], y = p[i + 1], z = p[i + 2]; pos.push((m[0] * x + m[4] * y + m[8] * z + m[12]) * S, -(m[2] * x + m[6] * y + m[10] * z + m[14]) * S, (m[1] * x + m[5] * y + m[9] * z + m[13]) * S); }
        const ix = pr.indices != null ? acc(pr.indices) : [...Array(p.length / 3).keys()];
        for (let i = 0; i < ix.length; i += 3) idx.push(base + ix[i], base + ix[i + 2], base + ix[i + 1]);
      }
      for (const c of n.children || []) visit(c, m);
    };
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], sc = json.scenes?.[json.scene ?? 0];
    (sc ? sc.nodes : (json.nodes || []).map((_, i) => i)).forEach((n) => visit(n, I));
    if (!idx.length) throw new Error("glTF");
    return mesh(pos, idx);
  }
  async function readFile(f) {
    const ext = f.name.split(".").pop().toLowerCase(), buf = await f.arrayBuffer(), txt = () => new TextDecoder().decode(buf);
    switch (ext) {
      case "stl": return readSTL(buf); case "obj": return readOBJ(txt()); case "off": return readOFF(txt()); case "ply": return readPLY(buf);
      case "3mf": return read3MF(buf); case "amf": return readAMF(buf); case "glb": return readGLTF(buf, true); case "gltf": return readGLTF(buf, false);
      default: throw new Error(L.unsupported);
    }
  }
  const merge = (list) => {
    const n = list.reduce((s, m) => s + m.pos.length, 0), t = list.reduce((s, m) => s + m.idx.length, 0), pos = new Float32Array(n), idx = new Uint32Array(t);
    let p = 0, q = 0; for (const m of list) { pos.set(m.pos, p); for (let i = 0; i < m.idx.length; i++) idx[q + i] = m.idx[i] + p / 3; p += m.pos.length; q += m.idx.length; }
    return mesh(pos, idx);
  };

  // ── 분석: 크기 · 부피 · 겉넓이 · 열린 모서리 ─────────────────────────
  function analyze(m) {
    const P = m.pos, I = m.idx, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = P[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    let vol = 0, area = 0; const edges = new Map();
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ax = P[a], ay = P[a + 1], az = P[a + 2], bx = P[b], by = P[b + 1], bz = P[b + 2], cx = P[c], cy = P[c + 1], cz = P[c + 2];
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      if (I.length < 9e6) for (const [p, q] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) { const k = p < q ? p * 4294967296 + q : q * 4294967296 + p; edges.set(k, (edges.get(k) || 0) + 1); }
    }
    let open = 0; for (const c of edges.values()) if (c !== 2) open++;
    vol = Math.abs(vol);
    const solid = vol / 1000 * 1.24, shell = Math.min(vol, area * 1.2), est = (shell + (vol - shell) * 0.15) / 1000 * 1.24;
    return { mn, mx, size: mx.map((v, k) => v - mn[k]), vol, area, open, tris: I.length / 3, verts: P.length / 3, solid, est };
  }

  // ── 쓰기 ────────────────────────────────────────────────────
  const enc = new TextEncoder(), f6 = (v) => +v.toFixed(5);
  const W = {
    stl(m, name) {
      const n = m.idx.length / 3, b = new ArrayBuffer(84 + n * 50), dv = new DataView(b), P = m.pos, I = m.idx;
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
    stla(m) {
      const P = m.pos, I = m.idx, out = ["solid urteam\n"];
      for (let t = 0; t < I.length; t += 3) { out.push(" facet normal 0 0 0\n  outer loop\n"); for (let j = 0; j < 3; j++) { const v = I[t + j] * 3; out.push(`   vertex ${f6(P[v])} ${f6(P[v + 1])} ${f6(P[v + 2])}\n`); } out.push("  endloop\n endfacet\n"); }
      out.push("endsolid urteam\n"); return new Blob(out);
    },
    obj(m) {
      const P = m.pos, I = m.idx, out = ["# UrTeam 3D converter (ur-team.com/3d-converter/)\n"];
      for (let i = 0; i < P.length; i += 3) out.push(`v ${f6(P[i])} ${f6(P[i + 1])} ${f6(P[i + 2])}\n`);
      for (let t = 0; t < I.length; t += 3) out.push(`f ${I[t] + 1} ${I[t + 1] + 1} ${I[t + 2] + 1}\n`);
      return new Blob(out);
    },
    off(m) {
      const P = m.pos, I = m.idx, out = [`OFF\n${P.length / 3} ${I.length / 3} 0\n`];
      for (let i = 0; i < P.length; i += 3) out.push(`${f6(P[i])} ${f6(P[i + 1])} ${f6(P[i + 2])}\n`);
      for (let t = 0; t < I.length; t += 3) out.push(`3 ${I[t]} ${I[t + 1]} ${I[t + 2]}\n`);
      return new Blob(out);
    },
    ply(m) {
      const nv = m.pos.length / 3, nf = m.idx.length / 3, head = enc.encode(`ply\nformat binary_little_endian 1.0\ncomment UrTeam 3D converter\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\nelement face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`);
      const b = new ArrayBuffer(nf * 13), dv = new DataView(b);
      for (let t = 0; t < nf; t++) { dv.setUint8(t * 13, 3); for (let j = 0; j < 3; j++) dv.setInt32(t * 13 + 1 + j * 4, m.idx[t * 3 + j], true); }
      return new Blob([head, m.pos.buffer.slice(m.pos.byteOffset, m.pos.byteOffset + m.pos.byteLength), b]);
    },
    async "3mf"(m) {
      const P = m.pos, I = m.idx, vs = [], ts = [];
      for (let i = 0; i < P.length; i += 3) vs.push(`<vertex x="${f6(P[i])}" y="${f6(P[i + 1])}" z="${f6(P[i + 2])}"/>`);
      for (let t = 0; t < I.length; t += 3) ts.push(`<triangle v1="${I[t]}" v2="${I[t + 1]}" v3="${I[t + 2]}"/>`);
      const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">UrTeam 3D converter</metadata><resources><object id="1" type="model"><mesh><vertices>${vs.join("")}</vertices><triangles>${ts.join("")}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
      return zip([
        { name: "[Content_Types].xml", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
        { name: "_rels/.rels", data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
        { name: "3D/3dmodel.model", data: enc.encode(model) },
      ], true);
    },
    glb(m) { // mm → m, Z 위 → Y 위
      const P = m.pos, n = P.length / 3, pos = new Float32Array(P.length), mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) { const v = [P[i * 3] / 1000, P[i * 3 + 2] / 1000, -P[i * 3 + 1] / 1000]; for (let k = 0; k < 3; k++) { pos[i * 3 + k] = v[k]; mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); } }
      const idx = new Uint32Array(m.idx), pb = pos.byteLength, ib = idx.byteLength;
      const json = { asset: { version: "2.0", generator: "UrTeam 3D converter" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.85, 0.85, 0.85, 1], metallicFactor: 0, roughnessFactor: 0.7 } }],
        buffers: [{ byteLength: pb + ib }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pb, target: 34962 }, { buffer: 0, byteOffset: pb, byteLength: ib, target: 34963 }],
        accessors: [{ bufferView: 0, componentType: 5126, count: n, type: "VEC3", min: mn, max: mx }, { bufferView: 1, componentType: 5125, count: idx.length, type: "SCALAR" }] };
      let js = enc.encode(JSON.stringify(json)); const jp = (4 - (js.length % 4)) % 4; js = new Uint8Array([...js, ...new Array(jp).fill(32)]);
      const h = new DataView(new ArrayBuffer(20)), total = 12 + 8 + js.length + 8 + pb + ib;
      h.setUint32(0, 0x46546c67, true); h.setUint32(4, 2, true); h.setUint32(8, total, true); h.setUint32(12, js.length, true); h.setUint32(16, 0x4e4f534a, true);
      const bh = new DataView(new ArrayBuffer(8)); bh.setUint32(0, pb + ib, true); bh.setUint32(4, 0x004e4942, true);
      return new Blob([h, js, bh, pos, idx]);
    },
  };
  const EXT = { stl: "stl", stla: "stl", obj: "obj", off: "off", ply: "ply", "3mf": "3mf", glb: "glb" };

  // ── 화면: WebGL 뷰어 ───────────────────────────────────────────
  const cv = $("canvas[data-view]"), gl = cv.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true });
  let prog, vao, count = 0, model = null, info = null, yaw = 0.7, pitch = 0.55, zoom = 1, drag = null, raf = 0;
  if (gl) {
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
      in vec3 aP; uniform vec3 uC; uniform float uS, uYaw, uPitch, uAsp; out vec3 vP;
      void main(){ vec3 p=(aP-uC)*uS; p=vec3(p.x,p.z,-p.y); float c=cos(uYaw),s=sin(uYaw); p=vec3(c*p.x+s*p.z,p.y,c*p.z-s*p.x); c=cos(uPitch); s=sin(uPitch); p=vec3(p.x,c*p.y-s*p.z,s*p.y+c*p.z);
        p.z-=3.0; vP=p; gl_Position=vec4(p.x*2.4/max(uAsp,1.),p.y*2.4*min(uAsp,1.),(p.z*10.5+10.)/-9.5,-p.z); }`));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; in vec3 vP; out vec4 o;
      void main(){ vec3 n=normalize(cross(dFdx(vP),dFdy(vP))); if(n.z<0.) n=-n; vec3 L=normalize(vec3(.4,.7,.6));
        float k=.32+.62*max(dot(n,L),0.)+.14*max(dot(n,normalize(vec3(-.7,.1,.5))),0.); float sp=pow(max(dot(n,normalize(L+vec3(0,0,1))),0.),40.);
        o=vec4(vec3(.15,.36,.96)*k+sp*.25,1.); }`));
    gl.linkProgram(prog);
  }
  const U = (n) => gl.getUniformLocation(prog, n);
  function upload(m) {
    if (!gl) return;
    gl.useProgram(prog); vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, "aP"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW); count = m.idx.length;
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
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(draw); };
  cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener("pointermove", (e) => { if (!drag) return; yaw += (e.clientX - drag.x) * 0.01; pitch = Math.max(-1.4, Math.min(1.4, pitch + (e.clientY - drag.y) * 0.008)); drag = { x: e.clientX, y: e.clientY }; kick(); });
  const up = () => { drag = null; }; cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  cv.addEventListener("wheel", (e) => { if (!info) return; e.preventDefault(); zoom = Math.max(0.3, Math.min(6, zoom * Math.exp(-e.deltaY * 0.0012))); kick(); }, { passive: false });
  addEventListener("resize", kick);

  // ── 화면: 파일 받기 · 정보 표시 · 내려받기 ──────────────────────────
  const fmt = (n, k = 1) => n.toLocaleString(EN ? "en-US" : "ko-KR", { maximumFractionDigits: k });
  let baseName = "model";
  async function load(files) {
    files = [...files].filter(Boolean); if (!files.length) return;
    say(L.reading); root.classList.remove("is-ready");
    try {
      const list = [];
      for (const f of files) {
        const ext = f.name.split(".").pop().toLowerCase();
        if (!IN.includes(ext)) throw new Error(`.${ext} — ${L.unsupported}`);
        list.push(await readFile(f));
      }
      model = list.length > 1 ? merge(list) : list[0];
      baseName = files[0].name.replace(/\.[^.]+$/, "") + (files.length > 1 ? "_merged" : "");
      if ($("[data-scale]").value !== "1") { const s = +$("[data-scale]").value; for (let i = 0; i < model.pos.length; i++) model.pos[i] *= s; }
      info = analyze(model); upload(model); show(); root.classList.add("is-ready"); say(L.done);
    } catch (e) { say(L.fail + (e.message || e), true); }
  }
  function show() {
    const s = info.size, rows = [
      [L.size, `${fmt(s[0])} × ${fmt(s[1])} × ${fmt(s[2])} mm`], [L.tris, fmt(info.tris, 0)], [L.verts, fmt(info.verts, 0)],
      [L.vol, `${fmt(info.vol / 1000, 2)} cm³`], [L.area, `${fmt(info.area / 100, 1)} cm²`],
      [L.solid, `${fmt(info.solid, 1)} g`], [L.est, `${EN ? "about " : "약 "}${fmt(info.est, 1)} g`],
      [L.open, info.open ? `${fmt(info.open, 0)} ${L.notClosed}` : L.closed],
    ];
    const dl = $("[data-info]"); dl.textContent = "";
    for (const [a, b] of rows) { const r = d.createElement("div"), dt = d.createElement("dt"), dd = d.createElement("dd"); dt.textContent = a; dd.textContent = b; r.append(dt, dd); dl.appendChild(r); }
    $("[data-info-open]").classList.toggle("is-bad", !!info.open);
    try { sessionStorage.setItem("p3-prefill", JSON.stringify({ size: `${Math.round(s[0])} × ${Math.round(s[1])} × ${Math.round(s[2])} mm`, item: `${baseName} (${fmt(info.vol / 1000, 1)} cm³)` })); } catch (e) {}
  }
  const save = (blob, name) => { const a = d.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; d.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  async function exportIt() {
    if (!model) return;
    const to = $("[data-to]").value, pack = $("[data-pack]").value, part = +$("[data-split]").value * 1024 * 1024;
    say(L.making);
    try {
      let blob = await W[to](model, baseName), name = `${baseName}.${EXT[to]}`;
      if (pack === "zip" || part) { blob = await zip([{ name, data: new Uint8Array(await blob.arrayBuffer()) }], true); name += ".zip"; }
      if (part && blob.size > part) {
        const n = Math.ceil(blob.size / part);
        for (let i = 0; i < n; i++) { save(blob.slice(i * part, (i + 1) * part), `${name}.${String(i + 1).padStart(3, "0")}`); await new Promise((r) => setTimeout(r, 350)); }
        say(`${L.saved}: ${name}.001 ~ .${String(n).padStart(3, "0")} (${n}${L.parts})`);
      } else { save(blob, name); say(`${L.saved}: ${name} (${fmt(blob.size / 1048576, 2)} MB)`); }
      root.classList.add("is-done");
    } catch (e) { say(L.fail + (e.message || e), true); }
  }
  const pick = $("input[type=file]"), zone = $("[data-drop]");
  pick.addEventListener("change", () => load(pick.files));
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("is-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
  zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("is-over"); load(e.dataTransfer.files); });
  $("[data-go]").addEventListener("click", exportIt);
  $("[data-png]").addEventListener("click", () => { if (!info) return; draw(); cv.toBlob((b) => b && save(b, baseName + ".png"), "image/png"); });
  const preset = root.dataset.preset; if (preset && W[preset]) $("[data-to]").value = preset;
})();
