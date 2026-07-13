// 자동 마이그레이션용 스키마 (canonical). schema.sql 은 이 파일에서 생성된 사본.
// Workers 는 파일을 못 읽으므로 DDL 을 인라인으로 보관하고 첫 실행 때 적용.
export const SCHEMA_SQL = `-- Cloudflare D1 스키마 (SQLite 호환) — 멀티테넌트 상인회 플랫폼
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
  map_client_id TEXT NOT NULL DEFAULT '',     -- 상인회별 네이버 지도 키 (비우면 플랫폼 공용 키)
  naver_verification TEXT NOT NULL DEFAULT '',  -- 네이버 서치어드바이저 소유 확인 코드
  google_verification TEXT NOT NULL DEFAULT '', -- 구글 서치콘솔 소유 확인 코드
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
  day_off_date   TEXT NOT NULL DEFAULT '',    -- 오늘 임시휴무 (KST 날짜 저장 — 지나면 자동 무효)
  lat            REAL,
  lng            REAL,
  status         TEXT NOT NULL DEFAULT 'pending',
  sns_naver      TEXT NOT NULL DEFAULT '',    -- 네이버 플레이스(스마트플레이스) URL
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

CREATE TABLE IF NOT EXISTS coupons (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id    INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,  -- 테넌트 격리
  title          TEXT NOT NULL,               -- 예: "어묵 1개 서비스"
  terms          TEXT NOT NULL DEFAULT '',    -- 조건 (예: "2만원 이상 주문 시")
  valid_until    TEXT NOT NULL DEFAULT '',    -- YYYY-MM-DD, 비우면 무기한 — 지나면 자동 숨김
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_coupons_biz ON coupons(business_id);

CREATE TABLE IF NOT EXISTS updates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id    INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  body           TEXT NOT NULL,               -- 한 줄 소식 ("오늘 딸기 들어왔어요")
  image          TEXT NOT NULL DEFAULT '',    -- R2 key (선택)
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_updates_biz ON updates(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_updates_assoc ON updates(association_id, created_at);

CREATE TABLE IF NOT EXISTS polls (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  closes_at      TEXT NOT NULL DEFAULT '',    -- YYYY-MM-DD, 비우면 수동 마감만
  closed         INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS poll_votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL,
  choice     TEXT NOT NULL,                   -- yes | no | abstain
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(poll_id, user_id)                    -- 1인 1표 (재투표 시 변경)
);

CREATE TABLE IF NOT EXISTS event_rsvps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  association_id INTEGER NOT NULL,
  user_id        INTEGER NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_rsvp_assoc ON event_rsvps(association_id);

CREATE TABLE IF NOT EXISTS dues (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL,
  period         TEXT NOT NULL,               -- YYYY-MM (월별 회비)
  memo           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(association_id, user_id, period)
);
CREATE INDEX IF NOT EXISTS idx_dues_period ON dues(association_id, period);

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
`;

// 표가 없으면 DDL 을 적용 (idempotent). 이미 있으면 새 컬럼만 경량 마이그레이션.
// 마이그레이션 세대 — migrateColumns 에 단계를 추가할 때마다 +1
const SCHEMA_VERSION = "13";

export async function ensureSchema(db) {
  const has = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='associations'").first();
  if (has) {
    // 패스트패스: 버전이 이미 최신이면 마이그레이션 검사(~15회 왕복) 생략 → 콜드스타트 단축
    try {
      const v = await db.prepare("SELECT value FROM settings WHERE key='schema_version'").first();
      if (v && v.value === SCHEMA_VERSION) return false;
    } catch {}
    await migrateColumns(db);
    // 초구버전 DB 엔 settings 자체가 없을 수 있음 (버전 기록 전 보장)
    await db.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')").run();
    await db.prepare("INSERT INTO settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(SCHEMA_VERSION).run();
    return false;
  }
  const clean = SCHEMA_SQL.replace(/--[^\n]*\n/g, "\n");
  for (const st of clean.split(";").map((s) => s.trim()).filter(Boolean)) await db.prepare(st).run();
  await db.prepare("INSERT INTO settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(SCHEMA_VERSION).run();
  return true;
}

// 기존 배포 DB 업그레이드: 이후 버전에서 추가된 컬럼을 자동 반영 (무손실)
async function migrateColumns(db) {
  const cols = (await db.prepare("PRAGMA table_info(associations)").all()).results || [];
  if (!cols.some((c) => c.name === "custom_domain")) {
    await db.prepare("ALTER TABLE associations ADD COLUMN custom_domain TEXT NOT NULL DEFAULT ''").run();
    await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_assoc_domain ON associations(custom_domain) WHERE custom_domain != ''").run();
  }
  if (!cols.some((c) => c.name === "plan")) {
    await db.prepare("ALTER TABLE associations ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'").run();
  }
  if (!cols.some((c) => c.name === "map_client_id")) {
    await db.prepare("ALTER TABLE associations ADD COLUMN map_client_id TEXT NOT NULL DEFAULT ''").run();
  }
  if (!cols.some((c) => c.name === "naver_verification")) {
    await db.prepare("ALTER TABLE associations ADD COLUMN naver_verification TEXT NOT NULL DEFAULT ''").run();
    await db.prepare("ALTER TABLE associations ADD COLUMN google_verification TEXT NOT NULL DEFAULT ''").run();
  }
  // businesses 계측 컬럼 (기존 배포 업그레이드): 등록 경로·갱신 시각
  const bizTbl = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='businesses'").first();
  if (bizTbl) {
    const bcols = (await db.prepare("PRAGMA table_info(businesses)").all()).results || [];
    if (!bcols.some((c) => c.name === "source")) {
      await db.prepare("ALTER TABLE businesses ADD COLUMN source TEXT NOT NULL DEFAULT 'self'").run();
    }
    if (!bcols.some((c) => c.name === "updated_at")) {
      await db.prepare("ALTER TABLE businesses ADD COLUMN updated_at TEXT").run();
    }
    for (const col of ["sns_instagram", "sns_youtube", "sns_blog", "sns_kakao", "sns_naver", "day_off_date"]) {
      if (!bcols.some((c) => c.name === col)) {
        await db.prepare(`ALTER TABLE businesses ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`).run();
      }
    }
  }
  // products 표가 없으면 생성 (기존 배포 업그레이드): 점포 제품 진열
  const prodTbl = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='products'").first();
  if (!prodTbl) {
    await db.prepare(`CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE, name TEXT NOT NULL, price TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', sold_out INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, external_link TEXT, source TEXT NOT NULL DEFAULT 'self', created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_products_biz ON products(business_id, hidden, sort_order)").run();
  }
  // coupons 표가 없으면 생성 (기존 배포 업그레이드): 보여주기 쿠폰
  const cpTbl = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='coupons'").first();
  if (!cpTbl) {
    await db.prepare(`CREATE TABLE coupons (id INTEGER PRIMARY KEY AUTOINCREMENT, business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE, title TEXT NOT NULL, terms TEXT NOT NULL DEFAULT '', valid_until TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_coupons_biz ON coupons(business_id)").run();
  }
  // v11 신규 표 (기존 배포 업그레이드): 소식·투표·행사 신청·회비
  const v11 = [
    ["updates", `CREATE TABLE updates (id INTEGER PRIMARY KEY AUTOINCREMENT, business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE, association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE, body TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
      ["CREATE INDEX IF NOT EXISTS idx_updates_biz ON updates(business_id, created_at)", "CREATE INDEX IF NOT EXISTS idx_updates_assoc ON updates(association_id, created_at)"]],
    ["polls", `CREATE TABLE polls (id INTEGER PRIMARY KEY AUTOINCREMENT, association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', closes_at TEXT NOT NULL DEFAULT '', closed INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`, []],
    ["poll_votes", `CREATE TABLE poll_votes (id INTEGER PRIMARY KEY AUTOINCREMENT, poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, choice TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(poll_id, user_id))`, []],
    ["event_rsvps", `CREATE TABLE event_rsvps (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, association_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(event_id, user_id))`, []],
    ["dues", `CREATE TABLE dues (id INTEGER PRIMARY KEY AUTOINCREMENT, association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, period TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(association_id, user_id, period))`, []],
  ];
  for (const [name, ddl, idx] of v11) {
    const tbl = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first();
    if (!tbl) { await db.prepare(ddl).run(); for (const i of idx) await db.prepare(i).run(); }
  }
  // v13 인덱스 (기존 배포 업그레이드): 행사 신청 상인회 집계·회비 월 조회
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_rsvp_assoc ON event_rsvps(association_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_dues_period ON dues(association_id, period)").run();
  // events 대표 이미지 컬럼 (기존 배포 업그레이드)
  const evTbl = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").first();
  if (evTbl) {
    const ecols = (await db.prepare("PRAGMA table_info(events)").all()).results || [];
    if (!ecols.some((c) => c.name === "image")) {
      await db.prepare("ALTER TABLE events ADD COLUMN image TEXT NOT NULL DEFAULT ''").run();
    }
  }
  // 조회 빈도 높은 owner_id 인덱스 (기존 배포 업그레이드 · businesses 존재 시)
  if (bizTbl) await db.prepare("CREATE INDEX IF NOT EXISTS idx_business_owner ON businesses(owner_id)").run();
  // applications 표가 없으면 생성 (기존 배포 업그레이드)
  const appTbl = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").first();
  if (!appTbl) {
    await db.prepare("CREATE TABLE applications (id INTEGER PRIMARY KEY AUTOINCREMENT, assoc_name TEXT NOT NULL, contact_name TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL, contact_phone TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status, created_at)").run();
  }
}
