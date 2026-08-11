// 로컬 검증용 에뮬레이터: D1 ← node:sqlite, R2 ← 메모리, ASSETS ← 파일.
// 실제 Cloudflare 런타임과 동일한 바인딩 API 모양을 흉내내어 워커 코드를 그대로 실행.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_SQL, SCHEMA_VERSION } from "../src/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ----- D1 흉내 -----  (bare=true 면 스키마 미적용 → 자동 마이그레이션 테스트용)
export function makeD1(bare = false) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  if (!bare) {
    db.exec(SCHEMA_SQL);
    // 현행 SCHEMA_SQL 로 만든 DB 는 이미 최신이다 — 버전을 남겨 콜드스타트 마이그레이션을 건너뛴다
    db.exec(`INSERT INTO settings (key,value) VALUES ('schema_version','${SCHEMA_VERSION}') ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  }
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
      const type = { ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".json": "application/json",
        ".webmanifest": "application/manifest+json" }[ext] || "application/octet-stream";
      return new Response(fs.readFileSync(fp), { headers: { "content-type": type } });
    },
  };
}

export function makeEnv(extra = {}) {
  const { bare, ...rest } = extra;
  return {
    DB: makeD1(bare), MEDIA: makeR2(), ASSETS: makeAssets(),
    SESSION_SECRET: "test-secret-cf", PUBLIC_SCHEME: "https",
    ...rest,
  };
}
