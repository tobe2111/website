// 로컬 검증용 에뮬레이터: D1 ← node:sqlite, R2 ← 메모리, ASSETS ← 파일.
// 실제 Cloudflare 런타임과 동일한 바인딩 API 모양을 흉내내어 워커 코드를 그대로 실행.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ----- D1 흉내 -----
export function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(fs.readFileSync(path.join(ROOT, "schema.sql"), "utf8"));
  const wrap = (stmt, args) => ({
    async first() { const r = stmt.get(...args); return r === undefined ? null : r; },
    async all() { return { results: stmt.all(...args) }; },
    async run() { const r = stmt.run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
  });
  return {
    _db: db,
    prepare(sql) {
      const stmt = db.prepare(sql);
      const noArgs = wrap(stmt, []);
      return { bind: (...args) => wrap(stmt, args), ...noArgs };
    },
  };
}

// ----- R2 흉내 -----
export function makeR2() {
  const store = new Map();
  return {
    _store: store,
    async put(key, data, opts = {}) {
      const buf = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
      store.set(key, { body: buf, httpMetadata: opts.httpMetadata || {} });
    },
    async get(key) {
      const o = store.get(key);
      if (!o) return null;
      return { body: o.body, httpMetadata: o.httpMetadata, async arrayBuffer() { return o.body; } };
    },
    async delete(key) { store.delete(key); },
  };
}

// ----- ASSETS 흉내 -----
export function makeAssets() {
  return {
    async fetch(request) {
      const url = new URL(request.url);
      const fp = path.join(ROOT, "public", url.pathname);
      if (!fp.startsWith(path.join(ROOT, "public")) || !fs.existsSync(fp)) return new Response("Not Found", { status: 404 });
      const ext = path.extname(fp);
      const type = ext === ".css" ? "text/css" : ext === ".js" ? "text/javascript" : "application/octet-stream";
      return new Response(fs.readFileSync(fp), { headers: { "content-type": type } });
    },
  };
}

export function makeEnv(extra = {}) {
  return {
    DB: makeD1(), MEDIA: makeR2(), ASSETS: makeAssets(),
    SESSION_SECRET: "test-secret-cf", PUBLIC_SCHEME: "https",
    ...extra,
  };
}
