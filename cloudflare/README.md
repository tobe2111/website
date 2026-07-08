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

## 구조
```
cloudflare/
  wrangler.toml        # Workers/D1/R2/ASSETS 바인딩
  schema.sql           # D1 스키마
  src/
    index.js           # fetch 라우터 + 테넌트/인증/CSRF/보안헤더
    db.js              # D1 비동기 데이터 레이어
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
