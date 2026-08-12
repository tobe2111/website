-- Cloudflare D1 스키마 (SQLite 호환) — 멀티테넌트 상인회 플랫폼
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
  landing_layout TEXT,                        -- 프랜차이즈 랜딩페이지 구성(JSON). home_layout 과 따로 둔다 —
                                              -- 유형을 바꿔 가며 써도 서로의 편집 내용이 지워지지 않아야 한다.
  custom_domain TEXT NOT NULL DEFAULT '',
  map_client_id TEXT NOT NULL DEFAULT '',     -- 상인회별 네이버 지도 키 (비우면 플랫폼 공용 키)
  naver_verification TEXT NOT NULL DEFAULT '',  -- 네이버 서치어드바이저 소유 확인 코드
  google_verification TEXT NOT NULL DEFAULT '', -- 구글 서치콘솔 소유 확인 코드
  plan        TEXT NOT NULL DEFAULT 'free',   -- 요금제(free|basic|pro)
  -- 조직 유형. merchant  = 상인회 홈페이지(점포·지도·공지 + 전자계약),
  --            esign     = 전자계약만 쓰는 조직(법무·부동산 등),
  --            franchise = 프랜차이즈 가맹점 모집 랜딩페이지(상담 DB 수집).
  -- 같은 엔진을 쓰되 손님에게 보이는 메뉴와 관리자 화면이 달라진다.
  kind        TEXT NOT NULL DEFAULT 'merchant',
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

-- 서명 기록.
-- user_id 와 external_id 중 하나만 채워진다(회원 서명 / 외부 서명자 서명).
-- users 로의 외래키를 두지 않는 이유: 계정을 지웠다고 이미 체결된 계약의 서명이
-- 사라지면 안 된다. 문서·상인회가 사라질 때만 함께 사라진다(document_id 의 CASCADE).
CREATE TABLE IF NOT EXISTS signatures (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id         INTEGER,
  external_id     INTEGER,
  signer_name     TEXT NOT NULL,
  signature_image TEXT NOT NULL DEFAULT '',
  content_hash    TEXT NOT NULL,
  ip              TEXT NOT NULL DEFAULT '',
  user_agent      TEXT NOT NULL DEFAULT '',
  verify_code     TEXT NOT NULL UNIQUE,
  record_hash     TEXT NOT NULL,
  verify_level    TEXT NOT NULL DEFAULT 'password', -- 본인확인 수준: password|otp|identity
  prev_hash       TEXT NOT NULL DEFAULT '',  -- 직전 서명의 봉인값 — 서명 사슬(체인)
  seal_ver        INTEGER NOT NULL DEFAULT 3,-- 봉인 문자열 버전 (1=구버전, 2=체인, 3=필드값 포함)
  fields_hash     TEXT NOT NULL DEFAULT '',   -- 이 서명자가 채운 필드값·좌표의 해시 (v3 봉인 대상)
  signed_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sig_doc_user ON signatures(document_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sig_doc_ext  ON signatures(document_id, external_id) WHERE external_id IS NOT NULL;

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

-- 계약서 필드 배치 — "여기에 서명, 여기에 도장, 여기에 날짜" 를 지면 좌표로 저장한다.
-- 좌표는 페이지 대비 0~1 비율이라 화면 크기·인쇄 배율과 무관하게 같은 자리를 가리킨다.
CREATE TABLE IF NOT EXISTS doc_fields (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                  -- sign|stamp|text|date|name|check
  label       TEXT NOT NULL DEFAULT '',
  page        INTEGER NOT NULL DEFAULT 0,
  x           REAL NOT NULL DEFAULT 0,
  y           REAL NOT NULL DEFAULT 0,
  w           REAL NOT NULL DEFAULT 0.2,
  h           REAL NOT NULL DEFAULT 0.04,
  assignee    INTEGER NOT NULL DEFAULT 0,     -- 서명자 user_id (0 = 서명하는 사람 누구나)
  required    INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docfield_doc ON doc_fields(document_id, page, sort);

-- 채워진 값. 이미지(서명 그림·도장)는 R2 키와 함께 바이트 해시를 남겨 사후 교체를 탐지한다.
CREATE TABLE IF NOT EXISTS doc_field_values (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  field_id    INTEGER NOT NULL REFERENCES doc_fields(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL DEFAULT 0,
  value       TEXT NOT NULL DEFAULT '',
  image       TEXT NOT NULL DEFAULT '',
  image_hash  TEXT NOT NULL DEFAULT '',
  filled_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (field_id)
);
CREATE INDEX IF NOT EXISTS idx_docfieldval_doc ON doc_field_values(document_id);

-- 계약서 서식 — 본문 + 필드 배치를 한 벌로 저장해 재사용한다.
-- 본문의 {{변수}} 는 문서를 만들 때 값만 채운다. association_id=0 이면 플랫폼 공용.
CREATE TABLE IF NOT EXISTS doc_templates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL DEFAULT 0,
  title          TEXT NOT NULL,
  summary        TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL,
  fields         TEXT NOT NULL DEFAULT '[]',   -- 배치 JSON (page -1 = 마지막 쪽)
  parties        TEXT NOT NULL DEFAULT '[]',   -- 당사자 이름표 JSON (["갑","을"])
  ordered        INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_doctpl_assoc ON doc_templates(association_id, title);

-- 문서 감사 추적 — 누가 언제 열람했고, 인증했고, 서명했는지. "받은 적 없다·읽은 적 없다"는
-- 항변을 막는 증거이며 증적 패키지의 핵심 구성물이다.
CREATE TABLE IF NOT EXISTS doc_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL DEFAULT 0,
  actor_name  TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL,              -- created|viewed|otp_sent|otp_ok|signed|declined|reminded|notified
  detail      TEXT NOT NULL DEFAULT '',
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docev_doc ON doc_events(document_id, created_at);

-- 외부(비회원) 서명자 — 우리 서비스에 가입하지 않은 계약 상대방.
-- 가입·로그인 없이 링크 하나로 서명한다. 링크는 HMAC 토큰이라 위조·추측이 불가능하고,
-- 본인확인(OTP)은 여기 적힌 연락처로만 보내진다.
CREATE TABLE IF NOT EXISTS external_signers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id    INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  org            TEXT NOT NULL DEFAULT '',   -- 소속·상호(표시용)
  sign_order     INTEGER NOT NULL DEFAULT 0,
  declined_at    TEXT NOT NULL DEFAULT '',
  decline_reason TEXT NOT NULL DEFAULT '',
  opened_at      TEXT NOT NULL DEFAULT '',   -- 링크를 처음 연 시각
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_extsigner_doc ON external_signers(document_id, sign_order);

-- 공개 API 키 — 고객사 시스템이 계약을 자동으로 만들고 발송한다.
-- 평문 키는 발급 순간에만 보여주고 저장하지 않는다(해시만 보관).
CREATE TABLE IF NOT EXISTS api_keys (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL DEFAULT '',
  prefix         TEXT NOT NULL,               -- 키 앞자리(목록에서 구분용)
  key_hash       TEXT NOT NULL UNIQUE,
  webhook_url    TEXT NOT NULL DEFAULT '',
  webhook_secret TEXT NOT NULL DEFAULT '',    -- 웹훅 HMAC 서명키
  scopes         TEXT NOT NULL DEFAULT 'read,write',
  last_used_at   TEXT NOT NULL DEFAULT '',
  calls          INTEGER NOT NULL DEFAULT 0,
  revoked_at     TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_apikey_assoc ON api_keys(association_id);

-- 웹훅 발송 대기·이력. 실패하면 다음 주기에 다시 시도한다(최대 6회, 점점 늦게).
CREATE TABLE IF NOT EXISTS webhook_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id      INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  payload     TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  next_try_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT NOT NULL DEFAULT '',
  last_error  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wh_pending ON webhook_queue(delivered_at, next_try_at);

-- 외부 서명자용 본인확인 코드 (회원용 sign_otp 와 같은 규칙, 대상만 다름)
CREATE TABLE IF NOT EXISTS ext_otp (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id INTEGER NOT NULL REFERENCES external_signers(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  attempts    INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT NOT NULL DEFAULT '',
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (external_id)
);
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
  unit_price     INTEGER NOT NULL DEFAULT 0,  -- 이 상인회 전용 단가(원/건). 0 이면 플랫폼 기본가 적용
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
  cost           INTEGER NOT NULL DEFAULT 0,        -- 상인회에게 받은 판매가(원)
  cost_base      INTEGER NOT NULL DEFAULT 0,        -- 원가 스냅샷 (전 단위 = 0.01원. 알림톡 6.5원 → 650)
  ref            TEXT NOT NULL DEFAULT '',          -- 대사(對査)용 참조 — 이 플랫폼 발송임을 식별
  detail         TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msglog_assoc ON message_log(association_id, created_at);

-- 옛 주소(slug) → 조직. 주소를 짧은 영문으로 바꿔도 이미 나간 링크·알림톡·명함이 살아 있어야 한다.
-- 새 주소로 301 이동시킨다. 지우지 않는 한 영구히 유지된다.
CREATE TABLE IF NOT EXISTS slug_aliases (
  slug           TEXT PRIMARY KEY,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_slug_alias_assoc ON slug_aliases(association_id);

-- 가맹 상담 신청(랜딩페이지 DB). 프랜차이즈 랜딩의 존재 이유이자 유일한 성과 지표다.
-- 개인정보라 보관 최소화 원칙으로 다룬다 — 수집 항목을 늘리지 말고, 처리가 끝나면 지운다.
CREATE TABLE IF NOT EXISTS leads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id  INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  region          TEXT NOT NULL DEFAULT '',    -- 희망 지역
  budget          TEXT NOT NULL DEFAULT '',    -- 창업 예산
  funnel          TEXT NOT NULL DEFAULT '',    -- 유입 경로 (광고비 배분 판단용)
  message         TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'new', -- new|contacted|visit|contract|drop
  memo            TEXT NOT NULL DEFAULT '',    -- 상담 기록 (관리자만)
  agree_marketing INTEGER NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'landing',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_lead_assoc ON leads(association_id, created_at);
