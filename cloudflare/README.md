# 서초구 상인회 플랫폼 — Cloudflare 버전 (Workers + D1 + R2)

기존 Node 서버 버전(저장소 루트)을 **Cloudflare 무료 티어**에서 돌도록 이식한 버전입니다.
깃허브 push → 자동 배포, HTTPS 자동, **영구 무료** 운영이 가능합니다.

- **배포 방법**: [DEPLOY-cloudflare.md](./DEPLOY-cloudflare.md) 참고
  - **거의 클릭만**: 깃허브 저장소를 Cloudflare 대시보드에서 Import → 접속하면 `/setup` 설치 화면.
    표 생성·시크릿(세션/서명 키)·초기 계정이 **전부 자동**(첫 실행 시 스스로 준비).
- **로직 테스트**: `node --experimental-sqlite --test cloudflare/test/*.test.js` (34건)
  - wrangler 없이도 D1/R2/ASSETS 를 에뮬레이션해 워커 로직을 검증합니다.

## 기능 (Node 버전과 동일)
상인회 소개·홈, 가입 점포 안내·상세, 점포 지도(네이버), 공지(카테고리·검색),
행사, 회원 게시판(다중 이미지·검색·수정), 회원가입·대시보드(사진 R2·영상 임베드),
관리자(승인·공지·행사·브랜딩·회원 CSV), 슈퍼관리자(멀티테넌트 사이트 복제),
전자서명(Ed25519 순차·기한·공개 검증).

## 조직 유형(kind) — 같은 엔진, 세 가지 제품

한 워커가 세 가지 제품을 함께 굽습니다. 조직마다 `associations.kind` 하나로 갈립니다.

| kind | 공개 화면 | 관리자 화면 | 제품 소개 페이지 |
| --- | --- | --- | --- |
| `merchant` | 상인회 홈(점포·지도·공지·게시판) | 승인·공지·회비·홈 구성 | `/` |
| `esign` | 계약 창구(서명 입구·진위확인) | 계약서·서식·담당자 | `/esign` |
| `franchise` | **가맹점 모집 랜딩 한 장** | **랜딩 편집 + 상담 DB** | `/homepage` |

### 프랜차이즈 가맹점 모집 랜딩 (`kind=franchise`)

광고를 타고 들어온 사람의 **연락처를 받는 것**이 유일한 목표인 한 장짜리 화면입니다.

- **랜딩 구성** (`src/franchise.js`) — 히어로 · 흐르는 띠 · 브랜드 소개 · 창업 강점 · 점주 후기 ·
  메뉴 라인업 · 가맹 절차 · 가맹 비용(가리기 가능) · **상담 신청 폼** · 매장 안내 · FAQ · 공지 · 마무리 배너.
  섹션마다 켜기/끄기·순서·문구를 관리자가 직접 고칩니다(`/t/:slug/admin/landing`).
  반복 항목은 **한 줄에 하나, 칸은 `|`** 로 입력합니다 — 예: `가맹비 | 1,000만원 | 부가세 별도`.
- **고정 하단 바** — 스크롤 위치와 무관하게 전화·상담 신청이 항상 손끝에 있습니다.
- **상담 DB** (`leads` 표) — 성함·연락처·희망 지역·창업 예산·유입 경로·문의 내용.
  `/t/:slug/admin/leads` 에서 상태(신규·연락 완료·상담/방문·계약·보류)·메모·CSV 내보내기·삭제,
  유입 경로별 집계까지 봅니다.
- **쓰레기 차단** — 봇 방지(Turnstile) · 허니팟 · 같은 번호 10분 내 재전송 차단.
- **개인정보** — 수집 항목을 최소로 두고, 상담이 끝난 건은 관리자가 지웁니다(삭제 시 감사 로그에도
  이름·번호를 남기지 않습니다).

랜딩 화면을 눈으로 확인하려면:

```bash
node --experimental-sqlite scripts/preview-franchise.mjs public/__franchise.html
# 브라우저로 public/__franchise.html 열기 (확인 후 삭제)
```

## 구조
```
cloudflare/
  wrangler.toml        # Workers/D1/R2/ASSETS 바인딩
  schema.sql           # D1 스키마
  src/
    index.js           # fetch 라우터 + 테넌트/인증/CSRF/보안헤더
    db.js              # D1 비동기 데이터 레이어
    homeLayout.js      # 상인회 홈 섹션 카탈로그·렌더러
    franchise.js       # 프랜차이즈 랜딩 섹션 카탈로그·렌더러 (가맹 상담 폼 포함)
    crypto.js          # Web Crypto (PBKDF2·HMAC)
    auth.js            # 세션·CSRF
    esign.js           # Ed25519 전자서명
    storage.js         # R2
    pages.js / api.js  # 페이지(GET) / 폼(POST) 핸들러
    render.js media-render.js embed.js util.js http.js
  scripts/             # 서명키·시드 SQL 생성기
  test/                # D1/R2 에뮬레이터 + node:test
  public/              # 정적 자산(css/js)
```

ffmpeg 가 없는 환경이라 **사진 썸네일은 원본을 사용**합니다(영상은 임베드라 무관).
그 외 기능·보안은 Node 버전과 동일합니다.
