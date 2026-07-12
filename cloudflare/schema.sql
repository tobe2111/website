-- Cloudflare D1 스키마 (SQLite 호환) — 멀티테넌트 상인회 플랫폼
-- 적용: wrangler d1 execute <DB> --file=schema.sql  (원격은 --remote)

CREATE TABLE IF NOT EXISTS associations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  tagline     TEXT NOT NULL DEFAULT '함께 성장하는 우리 동네 상권',
  brand_color TEXT NOT NULL DEFAULT '#0b6e4f',
  phone       TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  logo        TEXT NOT NULL DEFAULT '',
  map_lat     REAL NOT NULL DEFAULT 37.4837,
  map_lng     REAL NOT NULL DEFAULT 127.0324,
  map_zoom    INTEGER NOT NULL DEFAULT 14,
  active      INTEGER NOT NULL DEFAULT 1,
  home_layout TEXT,
  custom_domain TEXT NOT NULL DEFAULT '',
  plan        TEXT NOT NULL DEFAULT 'free',   -- 요금제(free|basic|pro)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assoc_domain ON associations(custom_domain) WHERE custom_domain != '';

-- 셀프 입점 신청
CREATE TABLE IF NOT EXISTS applications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assoc_name    TEXT NOT NULL,
  contact_name  TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL,
  contact_phone TEXT NOT NULL DEFAULT '',
  message       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|rejected
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status, created_at);

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id  INTEGER REFERENCES associations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  salt            TEXT NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'MERCHANT',
  session_version INTEGER NOT NULL DEFAULT 0,
  totp_secret     TEXT NOT NULL DEFAULT '',    -- 2FA base32 시크릿(빈 값=미설정)
  totp_enabled    INTEGER NOT NULL DEFAULT 0,  -- 2FA 활성화 여부
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 관리자 감사 로그
CREATE TABLE IF NOT EXISTS audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER REFERENCES associations(id) ON DELETE CASCADE,  -- NULL=플랫폼(슈퍼)
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name     TEXT NOT NULL DEFAULT '',
  action         TEXT NOT NULL,
  detail         TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_assoc ON audit_log(association_id, created_at);

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
  lat            REAL,
  lng            REAL,
  status         TEXT NOT NULL DEFAULT 'pending',
  sns_instagram  TEXT NOT NULL DEFAULT '',
  sns_youtube    TEXT NOT NULL DEFAULT '',
  sns_blog       TEXT NOT NULL DEFAULT '',
  sns_kakao      TEXT NOT NULL DEFAULT '',
  source         TEXT NOT NULL DEFAULT 'self',   -- 'self'(사장님 직접) | 'proxy'(관리자 대행) — 핵심 가설 계측
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT,                            -- 콘텐츠 갱신 시각(살아있는 홈 판정)
  UNIQUE (association_id, slug)
);

CREATE TABLE IF NOT EXISTS media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  filename      TEXT NOT NULL DEFAULT '',
  poster        TEXT NOT NULL DEFAULT '',
  thumb         TEXT NOT NULL DEFAULT '',
  provider      TEXT NOT NULL DEFAULT '',
  embed_id      TEXT NOT NULL DEFAULT '',
  original_name TEXT NOT NULL DEFAULT '',
  caption       TEXT NOT NULL DEFAULT '',
  size          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 점포 제품/메뉴 진열 (전시 전용 — 결제·주문·장바구니 없음)
CREATE TABLE IF NOT EXISTS products (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id    INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,  -- 테넌트 격리
  name           TEXT NOT NULL,
  price          TEXT NOT NULL DEFAULT '',    -- 선택 입력("시가"·미표기 허용) → 문자열
  description    TEXT NOT NULL DEFAULT '',
  image          TEXT NOT NULL DEFAULT '',    -- R2 key (기존 미디어 파이프라인·WebP 재사용)
  sold_out       INTEGER NOT NULL DEFAULT 0,  -- 사장님 품절 토글
  hidden         INTEGER NOT NULL DEFAULT 0,  -- 상인회 관리자 숨김/정리
  sort_order     INTEGER NOT NULL DEFAULT 0,  -- 노출 순서
  external_link  TEXT,                        -- nullable, 현재 미노출 · 향후 외부 판매 링크용
  source         TEXT NOT NULL DEFAULT 'self',-- 등록 주체(self/proxy) — 계측 합산
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_biz ON products(business_id, hidden, sort_order);

CREATE TABLE IF NOT EXISTS notices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  tag            TEXT NOT NULL DEFAULT '안내',
  image          TEXT NOT NULL DEFAULT '',
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
  image          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER REFERENCES associations(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  message        TEXT NOT NULL,
  link           TEXT NOT NULL DEFAULT '',
  is_read        INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  author_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  image          TEXT NOT NULL DEFAULT '',
  pinned         INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS post_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  thumb      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ordered        INTEGER NOT NULL DEFAULT 0,
  due_date       TEXT NOT NULL DEFAULT '',
  closed         INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signatures (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signer_name     TEXT NOT NULL,
  signature_image TEXT NOT NULL DEFAULT '',
  content_hash    TEXT NOT NULL,
  ip              TEXT NOT NULL DEFAULT '',
  user_agent      TEXT NOT NULL DEFAULT '',
  verify_code     TEXT NOT NULL UNIQUE,
  record_hash     TEXT NOT NULL,
  signed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (document_id, user_id)
);

CREATE TABLE IF NOT EXISTS signature_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sign_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (document_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_posts_assoc ON posts(association_id, pinned, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_postimg_post ON post_images(post_id);
CREATE INDEX IF NOT EXISTS idx_doc_assoc ON documents(association_id);
CREATE INDEX IF NOT EXISTS idx_sig_doc ON signatures(document_id);
CREATE INDEX IF NOT EXISTS idx_sigreq_doc ON signature_requests(document_id);
CREATE INDEX IF NOT EXISTS idx_notif_assoc ON notifications(association_id, is_read);
CREATE INDEX IF NOT EXISTS idx_media_business ON media(business_id);
CREATE INDEX IF NOT EXISTS idx_business_assoc ON businesses(association_id, status);
CREATE INDEX IF NOT EXISTS idx_business_owner ON businesses(owner_id);
CREATE INDEX IF NOT EXISTS idx_notices_assoc ON notices(association_id);
CREATE INDEX IF NOT EXISTS idx_events_assoc ON events(association_id);
CREATE INDEX IF NOT EXISTS idx_users_assoc ON users(association_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
