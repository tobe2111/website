# 서초구 상인회 웹사이트

서초구 지역 상인회를 위한 **풀스택 웹 애플리케이션**입니다. 회원 로그인, 사진·영상 업로드, 관리자 대시보드, 업체별 홍보 페이지를 제공합니다.

> **외부 의존성 0개.** Node.js 22 내장 기능(`node:sqlite`, `node:crypto`, `node:http`)만 사용합니다. `npm install` 없이 Node만 있으면 바로 실행됩니다.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 🔐 **로그인 / 회원가입** | 업체 사장님(MERCHANT)과 관리자(ADMIN) 역할 구분. scrypt 비밀번호 해시 + HMAC 서명 세션 쿠키(httpOnly) |
| 🏪 **업체별 페이지** | 각 업체의 고유 URL(`/business/:slug`)에서 소개·연락처·사진·영상 갤러리 제공 |
| 📸 **사진·영상 업로드** | 드래그앤드롭 업로드, 이미지/영상 다중 업로드. 영상은 HTTP Range 스트리밍 지원 |
| 🛠 **회원 대시보드** | 사장님이 본인 업체 정보와 미디어를 직접 관리 |
| 📊 **관리자 대시보드** | 업체 승인/반려, 공지·행사 등록/삭제, 전체 통계 |
| 📢 **공지·행사** | 관리자가 등록하고 홈·목록 페이지에 자동 노출 |
| 📱 **완전 반응형** | 모바일·태블릿·데스크톱 대응, 모바일 햄버거 메뉴 |

## 빠른 시작

```bash
# 요구사항: Node.js 22.5 이상
npm run seed     # 관리자 계정 + 샘플 데이터 생성 (최초 1회)
npm start        # http://localhost:3000
```

### 기본 계정 (시드 후)

| 역할 | 이메일 | 비밀번호 |
| --- | --- | --- |
| 관리자 | `admin@seocho-merchants.kr` | `admin1234` |
| 샘플 업체 | `jung@ex.kr` 외 3개 | `merchant1234` |

> ⚠️ 운영 시에는 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 환경 변수로 관리자 계정을 지정하고, `SESSION_SECRET`을 반드시 변경하세요.

### 데이터 초기화

```bash
npm run reset    # 모든 데이터 삭제 후 샘플 재생성
```

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `3000` | 서버 포트 |
| `SESSION_SECRET` | (개발용) | 세션 쿠키 서명 키 — **운영 시 필수 변경** |
| `DB_FILE` | `data/app.db` | SQLite 파일 경로 |
| `UPLOAD_DIR` | `data/uploads` | 업로드 파일 저장 경로 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 위 기본값 | 시드 시 관리자 계정 |
| `NODE_ENV` | — | `production` 이면 쿠키에 `Secure` 부여 |

## 프로젝트 구조

```
website/
├── package.json          # 스크립트 (start / seed / reset)
├── src/
│   ├── server.js         # HTTP 서버 + 라우터 + 정적/미디어 서빙
│   ├── config.js         # 설정 (환경 변수)
│   ├── db.js             # SQLite 연결 + 스키마
│   ├── auth.js           # 비밀번호 해시 + 세션 토큰
│   ├── storage.js        # 파일 스토리지 추상화 (클라우드 전환 지점)
│   ├── multipart.js      # multipart/form-data 파서 (업로드)
│   ├── http.js           # 요청/응답 유틸 (쿠키, 이스케이프 등)
│   ├── render.js         # 공용 HTML 레이아웃
│   ├── models.js         # 도메인 쿼리 (업체/미디어/공지/행사)
│   ├── seed.js           # 초기 데이터 시드
│   └── handlers/
│       ├── pages.js      # 페이지 렌더링 (GET)
│       └── api.js        # 폼 액션 (POST)
├── public/
│   ├── css/app.css       # 스타일 (외부 폰트 없음, 시스템 폰트)
│   └── js/               # app.js(내비), dashboard.js(업로드 UX)
└── data/                 # app.db + uploads/ (런타임 생성, .gitignore)
```

## 클라우드 스토리지 전환

현재 업로드 파일은 로컬(`data/uploads`)에 저장됩니다. AWS S3, Cloudflare R2 등으로 전환하려면 **`src/storage.js`의 `save` / `remove` / `publicUrl` 세 함수만 교체**하면 나머지 코드는 그대로 동작하도록 설계했습니다.

## 보안 참고

- 비밀번호는 scrypt로 해시하여 저장 (평문 저장 안 함)
- 세션은 HMAC 서명 + 만료 시간이 포함된 httpOnly 쿠키
- 모든 출력은 HTML 이스케이프 처리(XSS 방지), 업로드 경로 이탈 방지
- 업로드는 MIME 타입 화이트리스트 및 용량 제한 적용

## 배포 메모

- 데이터베이스와 업로드 폴더는 영속 볼륨에 두어야 합니다(컨테이너 재시작 시 유실 방지).
- 리버스 프록시(nginx 등) 뒤에 두고 HTTPS를 종료하는 것을 권장합니다.
