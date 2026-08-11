// 자동 마이그레이션용 스키마 (canonical). schema.sql 은 이 파일에서 생성된 사본.
// Workers 는 파일을 못 읽으므로 DDL 을 인라인으로 보관하고 첫 실행 때 적용.
export const SCHEMA_SQL = `-- Cloudflare D1 스키마 (SQLite 호환) — 멀티테넌트 상인회 플랫폼
-- 적용: wrangler d1 execute <DB> --file=schema.sql  (원격은 --remote)

CREATE TABLE IF NOT EXISTS associations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  tagline     TEXT NOT NULL DEFAULT '함께 성장하는 우리 동네 상권',
  brand_color TEXT NOT NULL DEFAULT '#0b8a46',
  phone       TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  logo        TEXT NOT NULL DEFAULT '',
  hero_image  TEXT NOT NULL DEFAULT '',    -- 홈 히어로 배경 사진(R2 키). 비우면 프리미엄 그라데이션 히어로
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
  stage         TEXT NOT NULL DEFAULT 'new',      -- 영업 단계: new|contacted|meeting|proposal (status=pending 동안만 의미)
  source        TEXT NOT NULL DEFAULT 'apply',    -- apply=공개 신청 폼 / direct=운영자가 직접 발굴
  next_action_at TEXT NOT NULL DEFAULT '',        -- 다음 연락 예정일 (YYYY-MM-DD)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status, created_at);

-- 영업 기록 (연락·미팅 메모). 신청 건마다 시간순으로 쌓입니다.
CREATE TABLE IF NOT EXISTS application_notes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  actor_name     TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appnote_app ON application_notes(application_id, created_at);

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id  INTEGER REFERENCES associations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  salt            TEXT NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'MERCHANT',
  phone           TEXT NOT NULL DEFAULT '',    -- 휴대폰(알림톡 수신 · 숫자만 저장)
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
  attachment      TEXT NOT NULL DEFAULT '',  -- 계약서 PDF(R2 키). 있으면 본문 대신 이 파일이 계약 원문
  attachment_name TEXT NOT NULL DEFAULT '',  -- 원본 파일명(표시용)
  attachment_hash TEXT NOT NULL DEFAULT '',  -- 첨부 파일 SHA-256 (검증 시 실제 파일과 대조)
  last_remind_at  TEXT NOT NULL DEFAULT '',  -- 마지막 리마인더 발송 — 연타 방지
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
  verify_level    TEXT NOT NULL DEFAULT 'password', -- 본인확인 수준: password|otp|identity
  prev_hash       TEXT NOT NULL DEFAULT '',  -- 직전 서명의 봉인값 — 서명 사슬(체인)
  seal_ver        INTEGER NOT NULL DEFAULT 2,-- 봉인 문자열 버전 (1=구버전, 2=체인 포함)
  signed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (document_id, user_id)
);

CREATE TABLE IF NOT EXISTS signature_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sign_order  INTEGER NOT NULL DEFAULT 0,
  declined_at   TEXT NOT NULL DEFAULT '',   -- 거절(반려) 시각 — 비어 있으면 미거절
  decline_reason TEXT NOT NULL DEFAULT '',  -- 거절 사유
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

-- 서명 본인확인 OTP (휴대폰 인증번호). 코드는 해시로만 저장하고 짧게 만료된다.
CREATE TABLE IF NOT EXISTS sign_otp (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',   -- 발송된 번호(마스킹 표시용)
  attempts    INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT NOT NULL DEFAULT '',
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (document_id, user_id)
);

-- 서명 사슬 앵커(시점 증거). 매일 사슬 머리(마지막 봉인값)를 봉인해 남긴다.
-- "이 시점에 이미 이 서명들이 존재했다"를 사후에 증명하는 용도.
CREATE TABLE IF NOT EXISTS chain_anchor (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  head_hash   TEXT NOT NULL,          -- 앵커 시점의 마지막 서명 봉인값
  sig_count   INTEGER NOT NULL DEFAULT 0,
  anchored_at TEXT NOT NULL,
  seal        TEXT NOT NULL DEFAULT '', -- 위 내용을 Ed25519 로 봉인
  external    TEXT NOT NULL DEFAULT '', -- 외부 TSA 응답(연동 시) — 없으면 자체 앵커
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- ===== 알림톡 선불 크레딧 (상인회가 충전 → 발송 시 차감) =====
-- 금액은 모두 '원' 정수. 판매단가는 플랫폼 설정(price_alimtalk/price_sms)에서 읽는다.
CREATE TABLE IF NOT EXISTS notify_wallet (
  association_id INTEGER PRIMARY KEY REFERENCES associations(id) ON DELETE CASCADE,
  balance        INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 크레딧 원장(감사 추적) — 충전·차감·환불·수동조정이 모두 남는다
CREATE TABLE IF NOT EXISTS credit_ledger (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,               -- charge|spend|refund|adjust
  amount         INTEGER NOT NULL,            -- 양수=증가, 음수=감소
  balance_after  INTEGER NOT NULL,
  memo           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_assoc ON credit_ledger(association_id, created_at);

-- 충전 신청 (무통장 입금 → 슈퍼관리자 확인 후 승인 시 잔액 반영)
CREATE TABLE IF NOT EXISTS credit_orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  amount         INTEGER NOT NULL,
  depositor      TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|rejected
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_corder_status ON credit_orders(status, created_at);

-- 발송 로그 (수신번호는 마스킹 저장 — 개인정보 최소화)
CREATE TABLE IF NOT EXISTS message_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  channel        TEXT NOT NULL DEFAULT 'alimtalk',  -- alimtalk|sms
  kind           TEXT NOT NULL DEFAULT '',          -- sign_request|sign_remind|notice|dues|poll
  recipient      TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'sent',      -- sent|failed
  cost           INTEGER NOT NULL DEFAULT 0,
  detail         TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msglog_assoc ON message_log(association_id, created_at);
`;

// 표가 없으면 DDL 을 적용 (idempotent). 이미 있으면 새 컬럼만 경량 마이그레이션.
// 마이그레이션 세대 — migrateColumns 에 단계를 추가할 때마다 +1
export const SCHEMA_VERSION = "23";

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
  // v14: 브랜드색 기본값을 임시 민트(#2bb3a3)에서 서초구 정체성 녹색(#0b8a46)으로 교체.
  //      옛 임시 기본값을 그대로 둔 테넌트만 갱신 — 직접 색을 고른 테넌트는 건드리지 않음.
  if (cols.some((c) => c.name === "brand_color")) {
    await db.prepare("UPDATE associations SET brand_color='#0b8a46' WHERE brand_color='#2bb3a3'").run();
  }
  // v15: 홈 히어로 배경 사진 컬럼
  if (!cols.some((c) => c.name === "hero_image")) {
    await db.prepare("ALTER TABLE associations ADD COLUMN hero_image TEXT NOT NULL DEFAULT ''").run();
  }
  // v17: 알림톡 — 회원 휴대폰 + 선불 크레딧/원장/충전신청/발송로그
  const ucols = (await db.prepare("PRAGMA table_info(users)").all()).results || [];
  if (ucols.length && !ucols.some((c) => c.name === "phone")) {
    await db.prepare("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''").run();
  }
  // 표 존재 여부를 한 번에 조회 — 콜드스타트 왕복 절감 (표마다 조회하면 4회 → 1회)
  const have = new Set(((await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('notify_wallet','credit_ledger','credit_orders','message_log')"
  ).all()).results || []).map((r) => r.name));
  const v17 = [
    ["notify_wallet", `CREATE TABLE notify_wallet (association_id INTEGER PRIMARY KEY REFERENCES associations(id) ON DELETE CASCADE, balance INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`, []],
    ["credit_ledger", `CREATE TABLE credit_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE, kind TEXT NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER NOT NULL, memo TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
      ["CREATE INDEX IF NOT EXISTS idx_ledger_assoc ON credit_ledger(association_id, created_at)"]],
    ["credit_orders", `CREATE TABLE credit_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE, amount INTEGER NOT NULL, depositor TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
      ["CREATE INDEX IF NOT EXISTS idx_corder_status ON credit_orders(status, created_at)"]],
    ["message_log", `CREATE TABLE message_log (id INTEGER PRIMARY KEY AUTOINCREMENT, association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE, channel TEXT NOT NULL DEFAULT 'alimtalk', kind TEXT NOT NULL DEFAULT '', recipient TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'sent', cost INTEGER NOT NULL DEFAULT 0, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
      ["CREATE INDEX IF NOT EXISTS idx_msglog_assoc ON message_log(association_id, created_at)"]],
  ];
  // v22: 사슬 앵커 (시점 증거)
  const ancTbl = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chain_anchor'").first();
  if (!ancTbl) {
    await db.prepare(`CREATE TABLE chain_anchor (id INTEGER PRIMARY KEY AUTOINCREMENT, head_hash TEXT NOT NULL, sig_count INTEGER NOT NULL DEFAULT 0, anchored_at TEXT NOT NULL, seal TEXT NOT NULL DEFAULT '', external TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  }
  // v21: 서명 본인확인 OTP
  const otpTbl = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sign_otp'").first();
  if (!otpTbl) {
    await db.prepare(`CREATE TABLE sign_otp (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0, verified_at TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (document_id, user_id))`).run();
  }
  // v19: 서명 사슬 — 직전 봉인값·봉인 버전 (기존 서명은 seal_ver=1 로 남아 그대로 검증됨)
  const scols = (await db.prepare("PRAGMA table_info(signatures)").all()).results || [];
  if (scols.length && !scols.some((c) => c.name === "prev_hash")) {
    await db.prepare("ALTER TABLE signatures ADD COLUMN prev_hash TEXT NOT NULL DEFAULT ''").run();
    // 이미 있던 서명은 구버전 봉인이므로 1 로 표시해야 검증이 깨지지 않는다
    await db.prepare("ALTER TABLE signatures ADD COLUMN seal_ver INTEGER NOT NULL DEFAULT 1").run();
    await db.prepare("ALTER TABLE signatures ADD COLUMN verify_level TEXT NOT NULL DEFAULT 'password'").run();
  }
  // v18: 전자계약 — 서명 거절 사유, 계약서 PDF 첨부, 리마인더 발송 시각
  const rcols = (await db.prepare("PRAGMA table_info(signature_requests)").all()).results || [];
  if (rcols.length && !rcols.some((c) => c.name === "declined_at")) {
    await db.prepare("ALTER TABLE signature_requests ADD COLUMN declined_at TEXT NOT NULL DEFAULT ''").run();
    await db.prepare("ALTER TABLE signature_requests ADD COLUMN decline_reason TEXT NOT NULL DEFAULT ''").run();
  }
  const dcols = (await db.prepare("PRAGMA table_info(documents)").all()).results || [];
  if (dcols.length && !dcols.some((c) => c.name === "attachment")) {
    await db.prepare("ALTER TABLE documents ADD COLUMN attachment TEXT NOT NULL DEFAULT ''").run();
    await db.prepare("ALTER TABLE documents ADD COLUMN attachment_name TEXT NOT NULL DEFAULT ''").run();
    await db.prepare("ALTER TABLE documents ADD COLUMN attachment_hash TEXT NOT NULL DEFAULT ''").run();
  }
  if (dcols.length && !dcols.some((c) => c.name === "last_remind_at")) {
    await db.prepare("ALTER TABLE documents ADD COLUMN last_remind_at TEXT NOT NULL DEFAULT ''").run();
  }
  for (const [name, ddl, idx] of v17) {
    if (have.has(name)) continue;
    await db.prepare(ddl).run();
    for (const i of idx) await db.prepare(i).run();
  }
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
    await db.prepare("CREATE TABLE applications (id INTEGER PRIMARY KEY AUTOINCREMENT, assoc_name TEXT NOT NULL, contact_name TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL, contact_phone TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', stage TEXT NOT NULL DEFAULT 'new', source TEXT NOT NULL DEFAULT 'apply', next_action_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status, created_at)").run();
  } else {
    // v16: 영업 파이프라인 (단계·발굴 경로·다음 연락일)
    const acols = (await db.prepare("PRAGMA table_info(applications)").all()).results || [];
    if (!acols.some((c) => c.name === "stage"))
      await db.prepare("ALTER TABLE applications ADD COLUMN stage TEXT NOT NULL DEFAULT 'new'").run();
    if (!acols.some((c) => c.name === "source"))
      await db.prepare("ALTER TABLE applications ADD COLUMN source TEXT NOT NULL DEFAULT 'apply'").run();
    if (!acols.some((c) => c.name === "next_action_at"))
      await db.prepare("ALTER TABLE applications ADD COLUMN next_action_at TEXT NOT NULL DEFAULT ''").run();
  }
  // v16: 영업 기록 (연락·미팅 메모)
  await db.prepare(`CREATE TABLE IF NOT EXISTS application_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    actor_name TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_appnote_app ON application_notes(application_id, created_at)").run();
}
