// 자동 마이그레이션용 스키마 (canonical). schema.sql 은 이 파일에서 생성된 사본.
// Workers 는 파일을 못 읽으므로 DDL 을 인라인으로 보관하고 첫 실행 때 적용.
export const SCHEMA_SQL = `-- Cloudflare D1 스키마 (SQLite 호환) — 멀티테넌트 상인회 플랫폼
-- 적용: wrangler d1 execute <DB> --file=schema.sql  (원격은 --remote)

CREATE TABLE IF NOT EXISTS associations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  tagline     TEXT NOT NULL DEFAULT '함께 성장하는 우리 동네 상권',
  brand_color TEXT NOT NULL DEFAULT '#0a7d40',
  phone       TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  logo        TEXT NOT NULL DEFAULT '',
  seal_media  TEXT NOT NULL DEFAULT '',    -- 이 조직의 직인(법인 인감) 그림. 계약서의 '우리 도장' 자리에 자동으로 찍힌다
  hero_image  TEXT NOT NULL DEFAULT '',    -- 홈 히어로 배경 사진(R2 키). 비우면 프리미엄 그라데이션 히어로
  hero_video  TEXT NOT NULL DEFAULT '',    -- 홈 히어로 배경 영상(R2 키·선택). 사진이 poster 가 된다
  notify_auto INTEGER NOT NULL DEFAULT 0,  -- 알림 자동화. 0 이면 이 조직은 알림톡을 한 통도 자동으로 보내지 않고,
                                           -- 관리자가 서명 링크를 카톡·문자로 직접 전달한다(기본값).
  map_lat     REAL NOT NULL DEFAULT 37.4837,
  map_lng     REAL NOT NULL DEFAULT 127.0324,
  map_zoom    INTEGER NOT NULL DEFAULT 14,
  active      INTEGER NOT NULL DEFAULT 1,
  home_layout TEXT,
  landing_layout TEXT,                        -- 프랜차이즈 랜딩페이지 구성(JSON). home_layout 과 따로 둔다 —
                                              -- 유형을 바꿔 가며 써도 서로의 편집 내용이 지워지지 않아야 한다.
  landing_draft  TEXT,                        -- 편집 중인 초안. 발행 전까지 손님에게는 보이지 않는다
                                              -- (저장이 곧 발행이면 문구를 고치는 동안 공사판을 보여주게 된다).
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
  -- 랜딩형 제품의 업종 프리셋(kinds.js PRESETS). 화면 구조는 같고 기본 문구만 다르다.
  preset      TEXT NOT NULL DEFAULT 'franchise',
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
  -- 작성 중(초안)인가. 초안은 서명 요청도, 과금도, 발송도 없다 —
  -- 쓰다 만 계약서를 저장해 두고 다음 날 이어 쓰기 위한 상태다.
  draft          INTEGER NOT NULL DEFAULT 0,
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
  assignee    INTEGER NOT NULL DEFAULT 0,     -- 서명자 ref (0 = 누구나 · 양수 = 회원 user_id · 음수 = -외부서명자 id)
  slot        INTEGER NOT NULL DEFAULT 0,     -- 당사자 자리 (0 = 지정 없음 · 1 = 첫 번째 당사자 …). 보낼 때 assignee 로 확정된다
  auto        TEXT NOT NULL DEFAULT '',       -- 사람이 아니라 우리가 채우는 자리. 'seal' = 조직 직인 자동 날인
  required    INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docfield_doc ON doc_fields(document_id, page, sort);

-- 당사자 자리의 이름. '1번째 당사자' 는 자리를 놓는 사람에게 아무것도 말해 주지 않는다 —
-- 계약서는 임대인·임차인·갑·을 로 말한다. 지면 위 이름표도 그 말이어야 읽힌다.
CREATE TABLE IF NOT EXISTS doc_parties (
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  slot        INTEGER NOT NULL,               -- 1 = 첫 번째 당사자 …
  name        TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (document_id, slot)
);

-- 계약서 지면이 '올린 양식' 일 때의 쪽 그림.
--
-- 상대방이 보낸 PDF(표준근로계약서·정부 서식·회사 양식)를 옮겨 적지 않고 그대로 쓰려면
-- 그 쪽들이 지면이어야 한다. 관리자 브라우저에서 PDF 를 쪽별 그림으로 구워 여기에 남긴다.
--
-- ⚠️ 법적 원문은 여전히 **원본 PDF 파일**(documents.attachment)이고, 그 해시가 봉인에 들어간다.
--    여기 그림은 '보기·서명 자리 배치용 지면' 이다. 브라우저 렌더링 결과라 원본과 한 픽셀까지
--    같다고 보장할 수 없으므로, 증적 패키지에는 반드시 원본 PDF 가 함께 담긴다.
CREATE TABLE IF NOT EXISTS doc_pages (
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page        INTEGER NOT NULL,               -- 0부터
  media       TEXT NOT NULL,                  -- R2 키 (쪽 그림)
  w           INTEGER NOT NULL DEFAULT 0,     -- 그림 원래 가로 픽셀 (지면 비율 계산용)
  h           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (document_id, page)
);

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

-- 대량 발송 — 같은 계약서를 여러 사람에게 각각 한 부씩.
--
-- 왜 표로 남기는가: 100명에게 보내는 일은 한 번의 요청으로 끝나지 않는다(워커의 시간·요청 한도).
-- 그래서 받는 사람을 먼저 여기 적어 두고 조금씩 나눠 보낸다. 브라우저를 닫아도 남은 사람이
-- 그대로 남아 있고, 이미 보낸 사람에게 두 번 가지 않는다.
CREATE TABLE IF NOT EXISTS doc_batches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  source_id      INTEGER NOT NULL,               -- 원본 초안. 초안이 지워져도 보낸 기록은 남아야 하므로 FK 를 걸지 않는다
  title          TEXT NOT NULL DEFAULT '',
  ordered        INTEGER NOT NULL DEFAULT 0,
  due_date       TEXT NOT NULL DEFAULT '',
  slot           INTEGER NOT NULL DEFAULT 0,     -- 받는 사람이 앉을 당사자 자리 (0 = 자리 없음)
  fixed          TEXT NOT NULL DEFAULT '[]',     -- 나머지 자리에 고정으로 앉는 회원 id JSON
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docbatch_assoc ON doc_batches(association_id, id);

CREATE TABLE IF NOT EXISTS doc_batch_rows (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id    INTEGER NOT NULL REFERENCES doc_batches(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL DEFAULT 0,        -- 올린 표에서의 줄 번호 (사람이 고칠 때 찾는 번호)
  name        TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  org         TEXT NOT NULL DEFAULT '',
  vars        TEXT NOT NULL DEFAULT '{}',        -- 이 사람 몫의 빈칸 값 JSON
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending|sent|failed
  document_id INTEGER NOT NULL DEFAULT 0,        -- 만들어진 계약서
  note        TEXT NOT NULL DEFAULT '',          -- 실패 이유 · 보낸 수단
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docbatchrow ON doc_batch_rows(batch_id, status, seq);

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
  -- 광고 출처. 신청자 자기신고(funnel)만으로는 절반이 '기타'로 와서 예산을 감으로 쓰게 된다.
  utm_source      TEXT NOT NULL DEFAULT '',
  utm_medium      TEXT NOT NULL DEFAULT '',
  utm_campaign    TEXT NOT NULL DEFAULT '',
  referrer        TEXT NOT NULL DEFAULT '',
  variant         TEXT NOT NULL DEFAULT '',    -- 어느 랜딩(캠페인 사본)에서 왔는지. '' = 기본 랜딩
  extra           TEXT NOT NULL DEFAULT '',    -- 업종별 추가 질문의 답 (JSON). 고정 칸에 없는 것만 담는다
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_lead_assoc ON leads(association_id, created_at);

-- 캠페인별 랜딩 사본. 인스타용·검색광고용 문구를 따로 두고 전환율을 비교한다.
-- 기본 랜딩은 associations.landing_layout 에 있고, 여기에는 사본만 쌓인다.
CREATE TABLE IF NOT EXISTS landing_variants (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL,               -- /l/:slug
  name           TEXT NOT NULL DEFAULT '',
  layout         TEXT,                        -- 발행본
  draft          TEXT,                        -- 편집 중 초안
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (association_id, slug)
);

-- 랜딩 방문 수 (일자·사본별). 신청 수만 알면 '많이 왔는데 안 남긴 건지'를 구분할 수 없다.
CREATE TABLE IF NOT EXISTS landing_views (
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  variant        TEXT NOT NULL DEFAULT '',
  day            TEXT NOT NULL,               -- KST 기준 YYYY-MM-DD
  views          INTEGER NOT NULL DEFAULT 0,
  calls          INTEGER NOT NULL DEFAULT 0,  -- 전화 버튼 클릭. 모바일에서는 이게 상담 폼만큼 큰 전환 경로다
  -- 상인회 홈의 성과 (모집 랜딩의 '상담 신청' 에 해당하는 것이 상인회에는 셋이다)
  signups        INTEGER NOT NULL DEFAULT 0,  -- 입점 신청 제출 — 상인회가 원하는 최종 결과
  bizviews       INTEGER NOT NULL DEFAULT 0,  -- 가게 상세 열람 — 홈이 '가게를 보게 만드는가'
  finds          INTEGER NOT NULL DEFAULT 0,  -- 검색·지도 사용 — 홈이 '찾기' 를 돕는가
  PRIMARY KEY (association_id, variant, day)
);

-- 랜딩에 쓰는 사진. 관리자가 올린 뒤 주소를 골라 섹션에 넣는다
-- (media 표는 점포에 묶여 있어 본사 브랜드 사진을 담을 자리가 없다).
CREATE TABLE IF NOT EXISTS landing_assets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  filename       TEXT NOT NULL,               -- R2 키
  original_name  TEXT NOT NULL DEFAULT '',
  size           INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_landing_asset_assoc ON landing_assets(association_id, created_at);
`;

// 표가 없으면 DDL 을 적용 (idempotent). 이미 있으면 새 컬럼만 경량 마이그레이션.
// 마이그레이션 세대 — migrateColumns 에 단계를 추가할 때마다 +1
// 36 = 두 갈래(트렁크 33 · 모집형 35)를 합친 세대. 양쪽 DB 모두 다시 한 번 마이그레이션을 타게 한다.
export const SCHEMA_VERSION = "46";

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
  // 우리 직인(법인 인감) 그림
  if (!cols.some((c) => c.name === "seal_media")) {
    await db.prepare("ALTER TABLE associations ADD COLUMN seal_media TEXT NOT NULL DEFAULT ''").run();
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
  // v39: 홈 히어로 배경 영상 (선택). 사진은 poster 로 함께 쓰인다 —
  // 영상이 뜨기 전과, 움직임을 꺼 둔 방문자에게 보이는 화면이 그 사진이다.
  if (!cols.some((c) => c.name === "hero_video")) {
    await db.prepare("ALTER TABLE associations ADD COLUMN hero_video TEXT NOT NULL DEFAULT ''").run();
  }
  // v40: 알림 자동화 스위치. 기본은 꺼짐 — 켜기 전까지 자동 발송이 한 통도 나가지 않는다.
  // 기존 조직도 0 으로 들어온다. 알림톡을 실제로 쓰던 곳이면 관리 화면에서 한 번 켜 주면 된다.
  // (모르는 새 자동 발송이 시작돼 남의 크레딧이 줄어드는 쪽이 더 나쁘다)
  if (!cols.some((c) => c.name === "notify_auto")) {
    await db.prepare("ALTER TABLE associations ADD COLUMN notify_auto INTEGER NOT NULL DEFAULT 0").run();
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
  // v25: 마진 계산 — 발송 시점의 원가 스냅샷 + 대사용 참조
  const mcols = (await db.prepare("PRAGMA table_info(message_log)").all()).results || [];
  if (mcols.length && !mcols.some((c) => c.name === "cost_base")) {
    await db.prepare("ALTER TABLE message_log ADD COLUMN cost_base INTEGER NOT NULL DEFAULT 0").run();
    await db.prepare("ALTER TABLE message_log ADD COLUMN ref TEXT NOT NULL DEFAULT ''").run();
  }
  // v31: 조직 유형 (상인회 / 전자계약 전용)
  const acol = (await db.prepare("PRAGMA table_info(associations)").all()).results || [];
  if (acol.length && !acol.some((c) => c.name === "kind")) {
    await db.prepare("ALTER TABLE associations ADD COLUMN kind TEXT NOT NULL DEFAULT 'merchant'").run();
  }
  // v30: 공개 API 키 + 웹훅 큐
  const akTbl = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'").first();
  if (!akTbl) {
    await db.prepare(`CREATE TABLE api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE, name TEXT NOT NULL DEFAULT '', prefix TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, webhook_url TEXT NOT NULL DEFAULT '', webhook_secret TEXT NOT NULL DEFAULT '', scopes TEXT NOT NULL DEFAULT 'read,write', last_used_at TEXT NOT NULL DEFAULT '', calls INTEGER NOT NULL DEFAULT 0, revoked_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_apikey_assoc ON api_keys(association_id)").run();
    await db.prepare(`CREATE TABLE webhook_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE, event TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_try_at TEXT NOT NULL DEFAULT (datetime('now')), delivered_at TEXT NOT NULL DEFAULT '', last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_wh_pending ON webhook_queue(delivered_at, next_try_at)").run();
  }
  // v29: 외부(비회원) 서명자
  const extTbl = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='external_signers'").first();
  if (!extTbl) {
    await db.prepare(`CREATE TABLE external_signers (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', org TEXT NOT NULL DEFAULT '', sign_order INTEGER NOT NULL DEFAULT 0, declined_at TEXT NOT NULL DEFAULT '', decline_reason TEXT NOT NULL DEFAULT '', opened_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_extsigner_doc ON external_signers(document_id, sign_order)").run();
    await db.prepare(`CREATE TABLE ext_otp (id INTEGER PRIMARY KEY AUTOINCREMENT, external_id INTEGER NOT NULL REFERENCES external_signers(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0, verified_at TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (external_id))`).run();
  }
  // signatures 에 external_id 를 더하고 user_id 를 비울 수 있게 — 컬럼 제약을 바꾸는 것이라
  // SQLite 에선 표를 다시 만드는 수밖에 없다. 기존 행은 그대로 옮긴다(무손실).
  const sg2 = (await db.prepare("PRAGMA table_info(signatures)").all()).results || [];
  if (sg2.length && !sg2.some((c) => c.name === "external_id")) {
    await db.prepare(`CREATE TABLE signatures_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id INTEGER, external_id INTEGER,
      signer_name TEXT NOT NULL, signature_image TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '',
      verify_code TEXT NOT NULL UNIQUE, record_hash TEXT NOT NULL,
      verify_level TEXT NOT NULL DEFAULT 'password', prev_hash TEXT NOT NULL DEFAULT '',
      seal_ver INTEGER NOT NULL DEFAULT 3, fields_hash TEXT NOT NULL DEFAULT '',
      signed_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
    const cols = new Set(sg2.map((c) => c.name));
    const pick = (n, d) => (cols.has(n) ? n : d);
    await db.prepare(`INSERT INTO signatures_new (id, document_id, user_id, external_id, signer_name, signature_image,
      content_hash, ip, user_agent, verify_code, record_hash, verify_level, prev_hash, seal_ver, fields_hash, signed_at)
      SELECT id, document_id, user_id, NULL, signer_name, signature_image, content_hash, ip, user_agent, verify_code,
        record_hash, ${pick("verify_level", "'password'")}, ${pick("prev_hash", "''")}, ${pick("seal_ver", "1")},
        ${pick("fields_hash", "''")}, signed_at FROM signatures`).run();
    await db.prepare("DROP TABLE signatures").run();
    await db.prepare("ALTER TABLE signatures_new RENAME TO signatures").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_sig_doc ON signatures(document_id)").run();
    await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sig_doc_user ON signatures(document_id, user_id) WHERE user_id IS NOT NULL").run();
    await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sig_doc_ext ON signatures(document_id, external_id) WHERE external_id IS NOT NULL").run();
  }
  // v28: 문서 감사 추적 (열람·인증·서명 이력)
  const evTbl2 = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='doc_events'").first();
  if (!evTbl2) {
    await db.prepare(`CREATE TABLE doc_events (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, user_id INTEGER NOT NULL DEFAULT 0, actor_name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_docev_doc ON doc_events(document_id, created_at)").run();
  }
  // v27: 계약서 서식(템플릿)
  const tplTbl = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='doc_templates'").first();
  if (!tplTbl) {
    await db.prepare(`CREATE TABLE doc_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, association_id INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, fields TEXT NOT NULL DEFAULT '[]', parties TEXT NOT NULL DEFAULT '[]', ordered INTEGER NOT NULL DEFAULT 0, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_doctpl_assoc ON doc_templates(association_id, title)").run();
  }
  // v26: 봉인 v3 — 필드값 해시 컬럼 (기존 서명은 빈 값 + seal_ver 그대로라 검증이 깨지지 않는다)
  const sgc = (await db.prepare("PRAGMA table_info(signatures)").all()).results || [];
  if (sgc.length && !sgc.some((c) => c.name === "fields_hash")) {
    await db.prepare("ALTER TABLE signatures ADD COLUMN fields_hash TEXT NOT NULL DEFAULT ''").run();
  }
  // v26: 계약서 필드 배치(서명·도장·입력 자리) + 채워진 값
  const fTbl = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='doc_fields'").first();
  if (!fTbl) {
    await db.prepare(`CREATE TABLE doc_fields (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', page INTEGER NOT NULL DEFAULT 0, x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0, w REAL NOT NULL DEFAULT 0.2, h REAL NOT NULL DEFAULT 0.04, assignee INTEGER NOT NULL DEFAULT 0, slot INTEGER NOT NULL DEFAULT 0, auto TEXT NOT NULL DEFAULT '', required INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_docfield_doc ON doc_fields(document_id, page, sort)").run();
    await db.prepare(`CREATE TABLE doc_field_values (id INTEGER PRIMARY KEY AUTOINCREMENT, field_id INTEGER NOT NULL REFERENCES doc_fields(id) ON DELETE CASCADE, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE, user_id INTEGER NOT NULL DEFAULT 0, value TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', image_hash TEXT NOT NULL DEFAULT '', filled_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (field_id))`).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_docfieldval_doc ON doc_field_values(document_id)").run();
  }
  // v23: 상인회별 알림톡 단가 (규모·계약에 따라 다르게 받을 수 있게)
  const wcols = (await db.prepare("PRAGMA table_info(notify_wallet)").all()).results || [];
  if (wcols.length && !wcols.some((c) => c.name === "unit_price")) {
    await db.prepare("ALTER TABLE notify_wallet ADD COLUMN unit_price INTEGER NOT NULL DEFAULT 0").run();
  }
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
  // 작성 중(초안). 옛 문서는 전부 0 — 이미 발송된 계약이므로 초안일 수 없다.
  if (dcols.length && !dcols.some((c) => c.name === "draft")) {
    await db.prepare("ALTER TABLE documents ADD COLUMN draft INTEGER NOT NULL DEFAULT 0").run();
  }
  // 당사자 자리(1 = 첫 번째 당사자…). 보내기 전에는 서명자가 아직 정해지지 않아
  // 사람 대신 '몇 번째 당사자' 로만 놓아 둔다. 보낼 때 실제 사람으로 확정된다.
  const fcols = (await db.prepare("PRAGMA table_info(doc_fields)").all()).results || [];
  if (fcols.length && !fcols.some((c) => c.name === "slot")) {
    await db.prepare("ALTER TABLE doc_fields ADD COLUMN slot INTEGER NOT NULL DEFAULT 0").run();
  }
  // 사람이 아니라 우리가 채우는 자리 ('seal' = 조직 직인). 회사는 계약마다 서명하지 않는다 —
  // 직인이 이미 찍힌 계약서를 보낸다.
  if (fcols.length && !fcols.some((c) => c.name === "auto")) {
    await db.prepare("ALTER TABLE doc_fields ADD COLUMN auto TEXT NOT NULL DEFAULT ''").run();
  }
  // 당사자 자리의 이름 (임대인·임차인·갑·을). 없어도 '1번째 당사자' 로 동작한다.
  await db.prepare(`CREATE TABLE IF NOT EXISTS doc_parties (
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '', PRIMARY KEY (document_id, slot))`).run();
  // v46: 대량 발송 명단. 한 요청으로 다 못 보내므로 받는 사람을 적어 두고 나눠 보낸다.
  await db.prepare(`CREATE TABLE IF NOT EXISTS doc_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '',
    ordered INTEGER NOT NULL DEFAULT 0, due_date TEXT NOT NULL DEFAULT '',
    slot INTEGER NOT NULL DEFAULT 0, fixed TEXT NOT NULL DEFAULT '[]',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_docbatch_assoc ON doc_batches(association_id, id)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS doc_batch_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES doc_batches(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', org TEXT NOT NULL DEFAULT '',
    vars TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
    document_id INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_docbatchrow ON doc_batch_rows(batch_id, status, seq)").run();
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

  // v32: 주소(slug)를 짧은 영문으로.
  // 한글 slug 는 링크로 복사될 때 한 글자가 9바이트(%EC%84%9C…)로 늘어나 알림톡 버튼·명함에 쓸 수 없다.
  // 이미 나간 링크를 살려 두기 위해 옛 주소를 alias 로 남기고 새 주소로 301 이동시킨다.
  await db.prepare(`CREATE TABLE IF NOT EXISTS slug_aliases (
    slug TEXT PRIMARY KEY,
    association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_slug_alias_assoc ON slug_aliases(association_id)").run();

  // v33[모집형]: 가맹점·회원 모집 랜딩페이지 — 랜딩 구성 + 상담 신청 DB
  if (acol.length && !acol.some((c) => c.name === "landing_layout")) {
    await db.prepare("ALTER TABLE associations ADD COLUMN landing_layout TEXT").run();
  }
  await db.prepare(`CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '', budget TEXT NOT NULL DEFAULT '', funnel TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new', memo TEXT NOT NULL DEFAULT '',
    agree_marketing INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'landing',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT '')`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_lead_assoc ON leads(association_id, created_at)").run();

  // v34: 광고 성과 계측(UTM·방문수) · 캠페인 사본 · 초안 발행 · 랜딩 사진 보관함
  if (acol.length && !acol.some((c) => c.name === "landing_draft")) {
    await db.prepare("ALTER TABLE associations ADD COLUMN landing_draft TEXT").run();
  }
  const lcol = (await db.prepare("PRAGMA table_info(leads)").all()).results || [];
  if (lcol.length && !lcol.some((c) => c.name === "utm_source")) {
    for (const c of ["utm_source", "utm_medium", "utm_campaign", "referrer", "variant"])
      await db.prepare(`ALTER TABLE leads ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`).run();
  }
  await db.prepare(`CREATE TABLE IF NOT EXISTS landing_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    slug TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', layout TEXT, draft TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (association_id, slug))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS landing_views (
    association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    variant TEXT NOT NULL DEFAULT '', day TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (association_id, variant, day))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS landing_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
    filename TEXT NOT NULL, original_name TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_landing_asset_assoc ON landing_assets(association_id, created_at)").run();

  // v38: 전화 클릭 — 전환율에서 통째로 빠져 있던 경로
  const vcol = (await db.prepare("PRAGMA table_info(landing_views)").all()).results || [];
  if (vcol.length && !vcol.some((c) => c.name === "calls")) {
    await db.prepare("ALTER TABLE landing_views ADD COLUMN calls INTEGER NOT NULL DEFAULT 0").run();
  }

  // v41: 상인회 홈 A/B — 성과 셋을 따로 센다. 모집 랜딩은 '상담 신청' 하나였지만
  //      상인회 홈은 무엇이 성공인지가 하나가 아니다(입점 신청·가게 열람·찾기).
  for (const c of ["signups", "bizviews", "finds"]) {
    const cols = (await db.prepare("PRAGMA table_info(landing_views)").all()).results || [];
    if (!cols.some((x) => x.name === c))
      await db.prepare(`ALTER TABLE landing_views ADD COLUMN ${c} INTEGER NOT NULL DEFAULT 0`).run();
  }
  // v37: 상담 폼의 업종별 추가 질문 답변
  if (lcol.length && !lcol.some((c) => c.name === "extra")) {
    await db.prepare("ALTER TABLE leads ADD COLUMN extra TEXT NOT NULL DEFAULT ''").run();
  }
  // v35: 랜딩형 제품의 업종 프리셋 (프랜차이즈·학원·헬스장·병원·분양…)
  if (acol.length && !acol.some((c) => c.name === "preset")) {
    await db.prepare("ALTER TABLE associations ADD COLUMN preset TEXT NOT NULL DEFAULT 'franchise'").run();
  }

  await romanizeSlugs(db);

  // v33[대비]: 기본 브랜드색을 접근성 기준에 맞춘다.
  // 옛 기본값 #0b8a46 은 흰 글자를 얹었을 때 4.43:1 로 WCAG AA(4.5:1)에 아슬하게 못 미쳤다.
  // 기본 버튼·배지가 전부 그 조합이라 저시력 사용자에게는 제품 전체가 걸린다.
  // v14 때와 같은 원칙 — 기본값을 그대로 둔 곳만 옮기고, 직접 색을 고른 곳은 건드리지 않는다.
  if (cols.some((c) => c.name === "brand_color")) {
    await db.prepare("UPDATE associations SET brand_color='#0a7d40' WHERE brand_color='#0b8a46'").run();
  }
}

// 비ASCII slug 를 로마자 slug 로 옮긴다. 옛 주소는 alias 로 보존.
// 이미 영문인 조직은 건드리지 않는다(주소가 바뀌면 안 되는 쪽이 훨씬 크다).
async function romanizeSlugs(db) {
  const { slugify } = await import("./util.js");
  const rows = (await db.prepare("SELECT id, slug, name FROM associations").all()).results || [];
  const taken = new Set(rows.map((r) => r.slug));
  for (const r of rows) {
    if (!/[^\x00-\x7F]/.test(r.slug)) continue; // 이미 영문·숫자 주소
    let base = slugify(r.name) || "biz";
    let next = base, n = 1;
    while (taken.has(next)) next = `${base}-${++n}`;
    await db.prepare("INSERT OR IGNORE INTO slug_aliases (slug, association_id) VALUES (?,?)").bind(r.slug, r.id).run();
    await db.prepare("UPDATE associations SET slug=? WHERE id=?").bind(next, r.id).run();
    taken.delete(r.slug); taken.add(next);
  }
}
