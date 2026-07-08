# Cloudflare 무료 배포 가이드

이 폴더(`cloudflare/`)는 **Cloudflare Workers + D1 + R2** 로 도는 버전입니다.
**무료 티어로 영구 운영**할 수 있고, **깃허브 push → 자동 배포**가 됩니다.

- Workers: 하루 10만 요청 무료
- D1(DB): 5GB 저장 무료
- R2(사진): 10GB 저장 + **전송(egress) 무료**
- 영상은 유튜브·인스타·네이버TV **링크 임베드**라 저장·전송 비용 없음

---

# ⭐ 가장 쉬운 길 (대시보드 · 명령어 거의 없음)

앱이 **첫 실행 때 표를 스스로 만들고, 세션·서명 키도 스스로 생성**하며,
계정이 없으면 **`/setup` 설치 화면**으로 안내합니다. 그래서 순서가 아주 단순합니다.

1. **[dash.cloudflare.com](https://dash.cloudflare.com)** → **Workers & Pages → Create → Import a repository** → 이 깃허브 저장소 선택.
   - 빌드 설정에서 **Root directory** 를 `cloudflare` 로 지정.
2. 배포 과정에서 **D1(`seocho-db`)·R2(`seocho-media`) 바인딩**을 만들라고 하면 대시보드에서 생성/연결.
   (`wrangler.toml` 에 이름이 정의돼 있어 클릭으로 연결됩니다.)
3. 배포 완료 → 발급된 주소(`https://…workers.dev`)로 접속.
4. 자동으로 **`/setup` 화면**이 뜹니다 → **상인회 이름 + 관리자/슈퍼 계정**을 입력하고 시작.
   - 표 생성·시드·시크릿 등록 **전부 자동**. 별도 명령 불필요.

> 지도·봇차단·통계는 나중에 대시보드 → 그 워커 → **Settings → Variables** 에서 키만 넣으면 켜집니다(아래 참고).

아래는 CLI 로 직접 하고 싶을 때의 상세 방법입니다.

---

## 0. 사전 준비 (한 번만)

```bash
npm install -g wrangler     # Cloudflare CLI (사장님 PC 에 설치)
wrangler login              # 브라우저로 Cloudflare 로그인
cd cloudflare
```

---

## 1. D1(DB) · R2(사진) 만들기

```bash
# D1 데이터베이스 생성 → 출력된 database_id 를 복사
wrangler d1 create seocho-db

# R2 버킷 생성
wrangler r2 bucket create seocho-media
```

`wrangler.toml` 을 열어 `database_id = "..."` 에 방금 받은 값을 붙여넣으세요.

---

## 2. 스키마 + 초기 데이터 넣기 (선택 — 이제 자동)

> 앱이 첫 실행 때 표를 자동 생성하고 `/setup` 으로 계정을 만들 수 있어 이 단계는 **생략 가능**합니다.
> CLI 로 직접 넣고 싶을 때만 사용하세요.

```bash
# 표 생성
wrangler d1 execute seocho-db --remote --file=schema.sql

# 초기 계정(슈퍼/관리자) SQL 생성 — 비밀번호는 여기서 정합니다
SUPER_EMAIL=you@super.kr   SUPER_PASSWORD=바꾸세요1234 \
ADMIN_EMAIL=admin@seocho.kr ADMIN_PASSWORD=바꾸세요1234 \
  node scripts/gen-seed-sql.mjs > seed.sql

wrangler d1 execute seocho-db --remote --file=seed.sql
rm seed.sql        # 해시가 들어있으니 삭제 권장(원하면 보관)
```

> 샘플 점포·공지까지 넣고 싶으면 알려주세요. 시드 SQL 을 확장해 드립니다.

---

## 3. 시크릿(비밀값) 등록 (선택 — 이제 자동)

> `SESSION_SECRET`·`SIGN_PRIVATE_KEY` 를 설정하지 않으면 앱이 **자동 생성해 D1 에 안전하게 저장**합니다.
> 키를 직접 고정·관리하고 싶을 때만 아래처럼 등록하세요(권장이지만 필수 아님).

```bash
# 세션 서명 키 (아무 긴 랜덤 문자열)
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())" | wrangler secret put SESSION_SECRET

# 전자서명용 Ed25519 개인키 (JWK) — 생성해서 그대로 등록
node scripts/gen-sign-key.mjs        # 출력된 JSON 한 줄을 복사
wrangler secret put SIGN_PRIVATE_KEY # 프롬프트에 붙여넣기
```

> `SIGN_PRIVATE_KEY` 는 전자서명 위변조 방지의 핵심 키입니다. **절대 유출 금지**, 분실 시 기존 서명 검증이 깨집니다(백업 권장).

---

## 4. 배포

```bash
wrangler deploy
```

끝나면 `https://seocho-website.<계정>.workers.dev` 주소가 나옵니다. HTTPS 자동.

### 깃허브 자동 배포(선택)
Cloudflare 대시보드 → Workers & Pages → 해당 워커 → **Settings → Build** 에서
깃허브 저장소를 연결하면, 이후 **push 할 때마다 자동 배포**됩니다.

---

## 5. 사진 공개 URL (권장)

R2 파일은 기본적으로 워커를 거쳐 `/media/...` 로 제공됩니다(동작함).
더 빠르게 하려면 R2 버킷에 **공개 도메인**을 연결하고 `wrangler.toml` 의
`MEDIA_PUBLIC_BASE` 를 그 주소로 설정하세요(선택).

## 6. 봇 차단 (Turnstile · 선택, 무료)

Cloudflare 대시보드 → **Turnstile** 에서 위젯을 만들어 **사이트키/시크릿**을 발급받으세요.
- `wrangler.toml [vars]` 의 `TURNSTILE_SITE_KEY` 에 사이트키 입력
- `wrangler secret put TURNSTILE_SECRET` 로 시크릿 등록

설정하면 회원가입·로그인에 캡차가 **자동 활성화**됩니다(미설정 시 비활성, 정상 동작).

## 7. PWA (설치형 앱)

별도 설정 없이 이미 동작합니다. 모바일에서 사이트 접속 → "홈 화면에 추가" 하면
앱처럼 실행되고, 정적 자산은 오프라인 캐시됩니다. 아이콘·매니페스트는 `public/` 에 포함.

## 8. 네이버 지도

`wrangler.toml [vars]` 의 `NAVER_MAP_CLIENT_ID` 는 이미 설정돼 있습니다.
**네이버 클라우드 콘솔에서 배포된 도메인(위 workers.dev 또는 연결한 도메인)을
서비스 URL 로 등록**해야 지도가 뜹니다. 안 뜨면 `NAVER_MAP_PARAM` 을
`ncpClientId` ↔ `ncpKeyId` 로 바꿔 재배포하세요.

---

## 기능 스위치 (모두 선택 · 무료)

`wrangler.toml [vars]` 또는 `wrangler secret put` 으로 켜면 자동 활성화됩니다.
| 기능 | 설정 |
| --- | --- |
| 봇 차단(Turnstile) | `TURNSTILE_SITE_KEY` + secret `TURNSTILE_SECRET` |
| 방문 통계(Web Analytics) | `CF_ANALYTICS_TOKEN` |
| 네이버 지도 | `NAVER_MAP_CLIENT_ID` (+ 콘솔 도메인 등록) |
| 2단계 인증(2FA) | 별도 설정 불필요 — 계정 화면에서 사용자가 켬 |

## 기존 배포 업그레이드 (스키마 변경 시)

새 컬럼/표가 추가된 버전으로 올릴 때 한 번 실행:

```bash
wrangler d1 execute seocho-db --remote --command "ALTER TABLE users ADD COLUMN totp_secret TEXT NOT NULL DEFAULT ''"
wrangler d1 execute seocho-db --remote --command "ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0"
wrangler d1 execute seocho-db --remote --command "CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, association_id INTEGER, user_id INTEGER, actor_name TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))"
```

(새로 배포하는 경우엔 `schema.sql` 에 이미 포함되어 있어 불필요합니다.)

## 로컬에서 미리보기(선택)

```bash
wrangler dev        # 로컬 에뮬레이션(Miniflare)으로 D1/R2 포함 실행
```

## 로직 테스트(개발자용)

이 저장소는 wrangler 없이도 로직을 검증할 수 있게 D1/R2 에뮬레이터를 포함합니다.

```bash
node --experimental-sqlite --test cloudflare/test/*.test.js   # 22건
```

---

## Node 서버 버전과의 차이(요약)

| 항목 | Node 버전 | Cloudflare 버전 |
| --- | --- | --- |
| DB | node:sqlite(파일) | D1 |
| 파일 저장 | 로컬/S3 | R2 |
| 비밀번호 | scrypt | PBKDF2(Web Crypto) |
| 전자서명 | Ed25519(node:crypto) | Ed25519(Web Crypto) |
| 사진 썸네일 | ffmpeg 자동 | 원본 사용(ffmpeg 없음) |
| 영상 | 링크 임베드 | 링크 임베드(동일) |
| 배포 | 서버/도커 | Workers(무료 티어) |
