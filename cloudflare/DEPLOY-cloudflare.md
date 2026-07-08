# Cloudflare 무료 배포 가이드

이 폴더(`cloudflare/`)는 **Cloudflare Workers + D1 + R2** 로 도는 버전입니다.
**무료 티어로 영구 운영**할 수 있고, **깃허브 push → 자동 배포**가 됩니다.

- Workers: 하루 10만 요청 무료
- D1(DB): 5GB 저장 무료
- R2(사진): 10GB 저장 + **전송(egress) 무료**
- 영상은 유튜브·인스타·네이버TV **링크 임베드**라 저장·전송 비용 없음

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

## 2. 스키마 + 초기 데이터 넣기

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

## 3. 시크릿(비밀값) 등록

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

## 6. 네이버 지도

`wrangler.toml [vars]` 의 `NAVER_MAP_CLIENT_ID` 는 이미 설정돼 있습니다.
**네이버 클라우드 콘솔에서 배포된 도메인(위 workers.dev 또는 연결한 도메인)을
서비스 URL 로 등록**해야 지도가 뜹니다. 안 뜨면 `NAVER_MAP_PARAM` 을
`ncpClientId` ↔ `ncpKeyId` 로 바꿔 재배포하세요.

---

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
