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
- **초안 → 발행** — 저장은 초안까지만. 손님에게는 발행본이 보이고, 관리자는
  `/admin/landing/preview` 로 초안을 먼저 확인합니다. 고치는 동안 공사판이 노출되지 않습니다.
- **사진 보관함** — 관리자가 사진을 올리면 `/media/…` 주소가 생기고, 그 주소를 섹션에 붙여 넣습니다
  (히어로·브랜드 사진 칸은 파일 선택만으로 바로 채워집니다). 외부 `https://` 주소도 그대로 씁니다.
- **캠페인별 사본** — `/t/:slug/l/:campaign` 으로 열리는 랜딩 사본. 광고 소재마다 다른 문구를 쓰고
  **방문·신청·전환율을 사본별로 비교**합니다. 사본은 `robots.txt` 에서 색인 제외(중복 콘텐츠 방지).
- **고정 하단 바** — 랜딩뿐 아니라 매장·공지 등 손님 화면 전체에서 전화·상담 신청이 손끝에 있습니다
  (관리자 콘솔에는 붙지 않습니다).
- **상담 DB** (`leads` 표) — 성함·연락처·희망 지역·창업 예산·유입 경로·문의 내용, 그리고
  **광고 출처**(`utm_source/medium/campaign` · referrer · 사본)까지 자동 기록.
  `/t/:slug/admin/leads` 에서 상태(신규·연락 완료·상담/방문·계약·보류)·메모·CSV·삭제와
  **30일 전환율 · 광고 출처별 집계 · 랜딩별 성과**를 봅니다(50건씩 쪽 나눔).
- **알림** — 새 상담이 오면 담당자에게 알림톡(`lead_new`)과 메일, 신청자에게 접수 확인
  알림톡(`lead_ack`). 알림톡 설정이 없어도 접수 자체는 그대로 저장됩니다.
- **상담 → 계약** — 상담 건의 `계약서 만들기` 를 누르면 서식 선택 → 문서 생성 → 외부 서명자 폼까지
  신청자 정보가 따라가, 이름·번호를 다시 옮겨 적지 않습니다.
- **쓰레기 차단** — 봇 방지(Turnstile) · 허니팟 · 같은 번호 10분 내 재전송 차단(하이픈 무시).
- **개인정보** — 수집 항목을 최소로 두고, **처리가 끝난 건(계약·보류)은 보관 기간이 지나면 매일
  크론이 자동 파기**합니다(기본 365일, 조직별 설정). 진행 중인 건은 지우지 않으며, 삭제 시
  감사 로그에도 이름·번호를 남기지 않습니다.

화면을 눈으로 확인하려면:

```bash
node --experimental-sqlite scripts/preview-franchise.mjs public/__x.html landing  # 손님이 보는 랜딩
node --experimental-sqlite scripts/preview-franchise.mjs public/__x.html leads    # 상담 DB 콘솔
node --experimental-sqlite scripts/preview-franchise.mjs public/__x.html editor   # 랜딩 편집기
# 브라우저로 public/__x.html 열기 (확인 후 삭제)
```

## 구조
```
(저장소 최상단)
  wrangler.toml        # Workers/D1/R2/ASSETS 바인딩 — 최상단에 두어야 깃허브 자동 배포가
                       #   빌드 루트 설정(/ 또는 cloudflare)과 무관하게 동작한다
cloudflare/
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
