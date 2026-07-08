// SQLite 데이터 계층 (Node 내장 node:sqlite 사용) — 멀티테넌트 스키마
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

export const db = new DatabaseSync(config.dbFile);

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// ----- 스키마 -----
// associations(상인회/테넌트) 를 최상위로 두고, 모든 데이터가 소속 상인회를 가집니다.
db.exec(`
CREATE TABLE IF NOT EXISTS associations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  tagline     TEXT NOT NULL DEFAULT '함께 성장하는 우리 동네 상권',
  brand_color TEXT NOT NULL DEFAULT '#0b6e4f',
  phone       TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  logo        TEXT NOT NULL DEFAULT '',              -- 상인회 로고 (스토리지 키). 비어있으면 이니셜 표시
  map_lat     REAL NOT NULL DEFAULT 37.4837,         -- 지도 기본 중심 (서초구청 부근)
  map_lng     REAL NOT NULL DEFAULT 127.0324,
  map_zoom    INTEGER NOT NULL DEFAULT 14,
  active      INTEGER NOT NULL DEFAULT 1,
  home_layout TEXT,                                  -- 홈페이지 구성(JSON). NULL 이면 기본 구성 사용
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER REFERENCES associations(id) ON DELETE CASCADE,  -- SUPERADMIN 은 NULL
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  salt           TEXT NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'MERCHANT',   -- 'SUPERADMIN' | 'ADMIN' | 'MERCHANT'
  session_version INTEGER NOT NULL DEFAULT 0,          -- 값 증가 시 기존 세션 전부 무효화(revocation)
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS businesses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  owner_id       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT '기타',
  description    TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  address        TEXT NOT NULL DEFAULT '',
  hours          TEXT NOT NULL DEFAULT '',
  lat            REAL,                                  -- 지도 좌표 (위도). NULL 이면 미표시
  lng            REAL,                                  -- 지도 좌표 (경도)
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (association_id, slug)
);

CREATE TABLE IF NOT EXISTS media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  filename      TEXT NOT NULL,
  poster        TEXT NOT NULL DEFAULT '',              -- 영상 포스터(썸네일) 스토리지 키
  original_name TEXT NOT NULL DEFAULT '',
  caption       TEXT NOT NULL DEFAULT '',
  size          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  tag            TEXT NOT NULL DEFAULT '안내',
  image          TEXT NOT NULL DEFAULT '',              -- 대표 이미지(소식 카드용) 스토리지 키
  pinned         INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  event_date     TEXT NOT NULL,
  place          TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER REFERENCES associations(id) ON DELETE CASCADE,  -- 관련 상인회 (NULL=플랫폼/슈퍼)
  kind           TEXT NOT NULL,                         -- 'new_business' | 'password_reset' | ...
  message        TEXT NOT NULL,
  link           TEXT NOT NULL DEFAULT '',
  is_read        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 회원 게시판: 글
CREATE TABLE IF NOT EXISTS posts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  author_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  pinned         INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 회원 게시판: 댓글
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_assoc ON posts(association_id, pinned, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

-- 전자서명: 서명 대상 문서
CREATE TABLE IF NOT EXISTS documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,                         -- 서명 대상 본문(약관/동의 내용). 생성 후 불변.
  content_hash   TEXT NOT NULL,                         -- sha256(body) — 서명 대상 고정 해시
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed         INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 전자서명: 서명 기록 (감사추적 + 봉인)
CREATE TABLE IF NOT EXISTS signatures (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signer_name     TEXT NOT NULL,
  signature_image TEXT NOT NULL DEFAULT '',             -- 캔버스 서명 이미지 스토리지 키
  content_hash    TEXT NOT NULL,                        -- 서명 시점 문서 해시(스냅샷)
  ip              TEXT NOT NULL DEFAULT '',
  user_agent      TEXT NOT NULL DEFAULT '',
  verify_code     TEXT NOT NULL UNIQUE,                 -- 공개 검증 코드
  record_hash     TEXT NOT NULL,                        -- HMAC 봉인(위변조 방지)
  signed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (document_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_assoc ON documents(association_id);
CREATE INDEX IF NOT EXISTS idx_sig_doc ON signatures(document_id);
CREATE INDEX IF NOT EXISTS idx_notif_assoc ON notifications(association_id, is_read);
CREATE INDEX IF NOT EXISTS idx_media_business ON media(business_id);
CREATE INDEX IF NOT EXISTS idx_business_assoc ON businesses(association_id, status);
CREATE INDEX IF NOT EXISTS idx_notices_assoc ON notices(association_id);
CREATE INDEX IF NOT EXISTS idx_events_assoc ON events(association_id);
CREATE INDEX IF NOT EXISTS idx_users_assoc ON users(association_id);
`);

// ----- 경량 마이그레이션 (구버전 단일 테넌트 DB 업그레이드용) -----
// association_id 컬럼이 없던 기존 DB 를 안전하게 업그레이드하고 기본 상인회로 귀속시킵니다.
function columnExists(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}

(function migrateAssociationCols() {
  if (!columnExists("associations", "home_layout")) {
    db.exec("ALTER TABLE associations ADD COLUMN home_layout TEXT");
  }
  if (!columnExists("associations", "logo")) {
    db.exec("ALTER TABLE associations ADD COLUMN logo TEXT NOT NULL DEFAULT ''");
  }
  if (!columnExists("media", "poster")) {
    db.exec("ALTER TABLE media ADD COLUMN poster TEXT NOT NULL DEFAULT ''");
  }
  if (!columnExists("users", "session_version")) {
    db.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnExists("businesses", "lat")) db.exec("ALTER TABLE businesses ADD COLUMN lat REAL");
  if (!columnExists("businesses", "lng")) db.exec("ALTER TABLE businesses ADD COLUMN lng REAL");
  if (!columnExists("associations", "map_lat")) db.exec("ALTER TABLE associations ADD COLUMN map_lat REAL NOT NULL DEFAULT 37.4837");
  if (!columnExists("associations", "map_lng")) db.exec("ALTER TABLE associations ADD COLUMN map_lng REAL NOT NULL DEFAULT 127.0324");
  if (!columnExists("associations", "map_zoom")) db.exec("ALTER TABLE associations ADD COLUMN map_zoom INTEGER NOT NULL DEFAULT 14");
  if (!columnExists("notices", "image")) db.exec("ALTER TABLE notices ADD COLUMN image TEXT NOT NULL DEFAULT ''");
})();

(function migrate() {
  const needs = ["users", "businesses", "notices", "events"].filter(
    (t) => !columnExists(t, "association_id")
  );
  if (needs.length === 0) return;

  for (const t of needs) {
    db.exec(`ALTER TABLE ${t} ADD COLUMN association_id INTEGER`);
  }
  // 귀속시킬 기본 상인회 확보
  let def = db.prepare("SELECT id FROM associations ORDER BY id LIMIT 1").get();
  if (!def) {
    const info = db
      .prepare("INSERT INTO associations (slug, name) VALUES ('seocho', '서초구 상인회')")
      .run();
    def = { id: info.lastInsertRowid };
  }
  for (const t of needs) {
    db.prepare(`UPDATE ${t} SET association_id = ? WHERE association_id IS NULL`).run(def.id);
  }
})();
