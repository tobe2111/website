# 서초구 상인회 — 멀티테넌트 상인회 웹사이트 플랫폼

여러 상인회가 각자의 홈페이지를 갖고 운영할 수 있는 **멀티테넌트 웹 플랫폼**입니다. 슈퍼 관리자가 새 상인회 사이트를 "복제"해 발급하면, 각 상인회는 독립된 데이터·브랜딩·**홈페이지 구조**를 자유롭게 관리합니다.

> **외부 의존성 0개.** Node.js 22 내장 기능(`node:sqlite`, `node:crypto`, `node:http`)만 사용합니다. `npm install` 없이 Node만 있으면 바로 실행됩니다.

## 핵심 개념

- **상인회(Association / 테넌트)**: 각 상인회는 `/t/:slug` 주소의 독립 사이트를 가집니다. 업체·공지·행사·회원·브랜딩·홈 구조가 모두 분리됩니다.
- **사이트 복제**: 슈퍼 관리자가 새 상인회를 생성하면 동일 구조의 홈페이지 + 전용 관리자 계정이 발급됩니다. "다른 상인회에서도 쓰고 싶다"는 수요를 그대로 충족합니다.
- **홈페이지 구조 편집**: 복제 후에도 각 상인회 관리자가 홈 섹션의 표시/순서/문구를 독립적으로 바꿀 수 있습니다.

## 역할 (권한)

| 역할 | 권한 |
| --- | --- |
| **SUPERADMIN** (1인) | 플랫폼 전체 관리. **사이트 복제(새 상인회 생성)는 슈퍼 관리자만** 보고 조작 가능. 모든 상인회 관리 화면 접근 가능 |
| **ADMIN** (상인회별) | 자기 상인회만 관리 — 업체 승인, 공지·행사, 브랜딩, **홈페이지 구조 편집** |
| **MERCHANT** (업체) | 자기 업체 페이지만 관리 — 정보 수정, 사진·영상 업로드 |

## 주요 기능

- 🔐 **로그인/회원가입** — scrypt 해시 + HMAC 서명 세션 쿠키(httpOnly), 3단계 역할
- 🏢 **멀티테넌트** — 상인회별 독립 사이트(`/t/:slug`), 데이터 완전 격리
- 🎨 **상인회별 브랜딩** — 대표 색상이 사이트 전체 팔레트에 자동 반영
- 🧩 **홈페이지 구조 편집기** — 섹션 켜기/끄기 · 순서 변경 · 문구 수정 (상인회마다 다른 구조)
- 🏪 **업체별 페이지** — 고유 URL, 소개·연락처·사진/영상 갤러리
- 📸 **사진·영상 업로드** — 드래그앤드롭, 직접 구현한 multipart 파서, 영상 Range 스트리밍
- 📊 **관리자 대시보드** — 상인회별 통계, 업체 승인/반려, 공지·행사 CRUD
- 🛡 **슈퍼 관리자 콘솔** — 상인회 생성(복제)·운영/중지, 플랫폼 전체 통계
- 📱 **완전 반응형** — 모바일·태블릿·데스크톱, 모바일 햄버거 메뉴

## 빠른 시작

```bash
# 요구사항: Node.js 22.5 이상
npm run seed     # 슈퍼관리자 + 기본 상인회(서초구) + 샘플 데이터
npm start        # http://localhost:3000
```

### 기본 계정 (시드 후)

| 역할 | 이메일 | 비밀번호 | 로그인 후 |
| --- | --- | --- | --- |
| 슈퍼 관리자 | `super@platform.kr` | `super1234` | `/super` |
| 서초구 관리자 | `admin@seocho-merchants.kr` | `admin1234` | `/t/seocho/admin` |
| 샘플 업체 | `jung@ex.kr` 외 3개 | `merchant1234` | `/t/seocho/dashboard` |

> ⚠️ 운영 시 `SUPERADMIN_EMAIL/PASSWORD`, `ADMIN_EMAIL/PASSWORD`, `SESSION_SECRET` 환경 변수를 반드시 설정·변경하세요.

## 사용 흐름

1. 슈퍼 관리자가 `/super`에서 **새 상인회 사이트 만들기(복제)** — 이름·색상·관리자 계정 입력 → `/t/새슬러그` 사이트 생성
2. 발급된 상인회 관리자가 `/t/:slug/admin`에서 **홈페이지 구조·브랜딩**을 원하는 대로 편집
3. 업체 사장님이 `/t/:slug/register`로 가입 → 사진·영상 업로드 → 관리자 승인 후 공개

## 프로젝트 구조

```
website/
├── package.json
├── src/
│   ├── server.js          # HTTP 서버 + 멀티테넌트 라우터 + 권한
│   ├── config.js          # 설정
│   ├── db.js              # SQLite 스키마 + 경량 마이그레이션
│   ├── auth.js            # 비밀번호 해시 · 세션 · 역할 헬퍼
│   ├── associations.js    # 상인회(테넌트) 관리 + 사이트 복제 로직
│   ├── homeLayout.js      # 홈페이지 구성 카탈로그 · 기본값 · 렌더링
│   ├── models.js          # 테넌트 스코프 도메인 쿼리
│   ├── storage.js         # 파일 스토리지 추상화 (클라우드 전환 지점)
│   ├── multipart.js       # multipart/form-data 파서
│   ├── http.js · render.js
│   ├── seed.js
│   └── handlers/
│       ├── pages.js       # 페이지 렌더링 (플랫폼·테넌트·대시보드·슈퍼)
│       └── api.js         # 폼 액션 (인증·업체·미디어·관리·복제·레이아웃)
├── public/
│   ├── css/app.css
│   └── js/                # app.js · dashboard.js · layout-editor.js
└── data/                  # app.db + uploads/ (런타임 생성, .gitignore)
```

## 주소 방식: 경로 vs 서브도메인

기본은 경로 기반(`/t/:slug`)이며, `BASE_DOMAIN` 환경 변수를 설정하면 **서브도메인 라우팅**이 자동 활성화됩니다.

| 모드 | 설정 | 상인회 주소 | 플랫폼(루트) |
| --- | --- | --- | --- |
| 경로 (기본) | — | `example.com/t/seocho` | `example.com/` |
| 서브도메인 | `BASE_DOMAIN=example.com` | `seocho.example.com` | `example.com/` (apex) |

서브도메인 모드에서는 내부 링크가 루트 상대경로로 바뀌고, 로그인 후 리다이렉트는 해당 상인회의 절대 URL(`https://seocho.example.com/admin`)로 이동합니다. DNS 는 와일드카드 레코드(`*.example.com`)를 서버로 향하게 설정하세요.

## 클라우드 스토리지 (S3 / R2 / MinIO)

기본은 로컬 저장(`data/uploads`)입니다. `STORAGE_DRIVER=s3` 로 전환하면 **외부 SDK 없이** AWS Signature V4 를 직접 구현한 클라이언트(`src/s3.js`)로 S3 호환 스토리지에 업로드합니다. 서명 로직은 AWS 공식 테스트 벡터로 검증됩니다.

```bash
npm run test:s3   # SigV4 서명 자체 검증 (네트워크 불필요)
```

| 변수 | 설명 |
| --- | --- |
| `STORAGE_DRIVER` | `local`(기본) 또는 `s3` |
| `S3_BUCKET` / `S3_REGION` | 버킷 이름 / 리전 |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | 자격 증명 |
| `S3_ENDPOINT` | R2/MinIO 커스텀 엔드포인트 (AWS 는 비워둠) |
| `S3_PUBLIC_BASE_URL` | 퍼블릭/CDN URL 베이스 (예: `https://cdn.example.com`) |
| `S3_FORCE_PATH_STYLE` | MinIO 등에서 `true` |

스토리지 인터페이스(`save/remove/publicUrl`)는 동일하므로 미디어·로고 업로드 코드는 드라이버와 무관하게 동작합니다.

## 상인회별 로고

각 상인회 관리자는 대시보드의 **브랜딩** 패널에서 로고 이미지를 업로드할 수 있습니다(PNG·JPG, 최대 2MB). 업로드 시 헤더·푸터·플랫폼 카드의 이니셜이 로고로 대체되며, 삭제하면 다시 이니셜로 표시됩니다.

## 운영 · 보안 메모

- **영속성**: `data/`(DB·로컬 업로드)는 재시작 시 유지되도록 영속 볼륨에 두세요. S3 모드에서는 미디어가 클라우드에 저장되므로 DB만 영속화하면 됩니다.
- **보안**: scrypt 해시, HMAC 서명 httpOnly 쿠키, 전 출력 HTML 이스케이프(XSS 방지), 업로드 MIME 화이트리스트·용량 제한, 테넌트 간 데이터 접근 차단, 정적 경로 이탈 방지.

## 환경 변수 요약

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | 서버 바인딩 |
| `SESSION_SECRET` | (개발용) | 세션 서명 키 — **운영 필수 변경** |
| `BASE_DOMAIN` | — | 설정 시 서브도메인 라우팅 활성화 |
| `PUBLIC_SCHEME` | `https` | 서브도메인 절대 URL 스킴 |
| `STORAGE_DRIVER` | `local` | `local` 또는 `s3` |
| `S3_*` | — | 위 스토리지 표 참고 |
| `SUPERADMIN_EMAIL/PASSWORD` | 시드 기본값 | 슈퍼관리자 계정 |
| `ADMIN_EMAIL/PASSWORD` | 시드 기본값 | 기본 상인회 관리자 |
| `NODE_ENV` | — | `production` 시 쿠키 `Secure` 부여 |
