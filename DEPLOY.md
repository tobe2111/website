# 배포 가이드 (실서비스 올리기)

이 문서는 **서버·도메인이 준비된 뒤** 사이트를 실제로 띄우는 순서입니다.
코드는 **외부 npm 의존성이 0**이라 준비물이 단순합니다.

---

## 0. 준비물 체크리스트

- **가장 쉬운 길(추천): Render** — 서버를 따로 빌릴 필요 없음. 깃허브 연결 → 자동 배포·URL·HTTPS. → **아래 1번**
- (선택) **네이버 지도 Client ID** — 콘솔에 도메인 등록
- (선택) **Cloudflare R2** — 사진이 많아질 때(영상은 링크 임베드라 비용 없음)
- (선택) **직접 도메인** — Render 는 기본 `*.onrender.com` 주소를 무료로 주며, 원하면 내 도메인 연결 가능

> 직접 서버(VPS)를 운영하고 싶으면 아래 **대안 A(Docker)** / **대안 B(systemd)** 참고.

---

## 1. Render 로 배포 (서버 관리 없음 · 추천)

이 저장소에는 `render.yaml`(Blueprint)이 포함되어 있어 클릭 몇 번으로 뜹니다.

1. [render.com](https://render.com) 가입 → 깃허브 계정 연결.
2. **New + → Blueprint** → 이 저장소 선택 → `render.yaml` 자동 인식.
3. 생성 화면에서 **환경 변수**를 채웁니다 (⚠️ **최초 배포 전에** 입력해야 그 비밀번호로 계정이 만들어집니다):
   - `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`
   - (선택) `NAVER_MAP_CLIENT_ID`
   - `SESSION_SECRET` 은 Render 가 자동 생성하므로 비워두세요.
4. **Apply** → 빌드·배포가 끝나면 `https://seocho-website.onrender.com` 같은 **주소가 자동으로** 나옵니다. HTTPS 도 자동.

### 꼭 알아둘 점 (정직하게)
- 이 앱은 DB·업로드 사진·서명키를 **파일로 저장**하므로 **영속 디스크(disk)** 가 필요합니다.
  `render.yaml` 에 `disk` 를 1GB 로 정의해 뒀고, 이는 **유료 플랜(Starter, ~$7/월 + 디스크 약 $0.25/월)** 에서 동작합니다.
- **무료 플랜은 부적합**합니다: 일정 시간 후 잠들고(첫 접속이 느려짐), 재배포 때 디스크가 없어 **데이터가 사라집니다.**
- 최초 부팅 시 `render.yaml` 의 시작 명령이 **시드를 자동 실행**(이미 있으면 건너뜀)하므로 별도 시드 작업이 필요 없습니다.

### 내 도메인 연결(선택)
Render 대시보드 → 서비스 → **Settings → Custom Domains** 에 도메인 추가 →
안내되는 DNS 레코드(CNAME)를 도메인 구매처에 등록하면 인증서까지 자동 발급됩니다.

### 배포 후
로그인 → 초기 비밀번호가 걱정되면 계정에서 변경. 이후 **깃허브에 push 하면 자동 재배포**됩니다.

---

## 대안 A. 직접 서버 — Docker + 자동 HTTPS

서버에 Docker / Docker Compose 만 설치돼 있으면 됩니다.

```bash
# 1) 코드 받기
git clone <이 저장소 URL> seocho-website && cd seocho-website

# 2) 환경 변수 설정
cp .env.example .env
#   .env 를 열어 최소한 아래 두 개는 반드시 바꾸세요:
#   - SESSION_SECRET  (아래 명령으로 생성한 값)
#   - ADMIN_PASSWORD / SUPERADMIN_PASSWORD
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 3) 최초 1회 시드(초기 계정·샘플 생성)
docker compose run --rm app npm run seed

# 4a) HTTPS 없이 바로 띄우기(리버스 프록시를 따로 둘 때)
docker compose up -d

# 4b) 도메인 + 자동 HTTPS 로 띄우기
DOMAIN=your-domain.kr docker compose --profile edge up -d
```

`4b` 는 Caddy 가 Let's Encrypt 인증서를 **자동 발급·갱신**합니다.
도메인 A 레코드가 이 서버를 가리키고 80/443 포트가 열려 있어야 합니다.

- 상태 확인: `docker compose ps`, 로그: `docker compose logs -f app`
- 헬스체크: `curl http://localhost:3000/healthz`

---

## 대안 B. Docker 없이 — systemd 로 직접 구동

```bash
# Node 22+ 설치 후
sudo mkdir -p /opt/seocho-website && cd /opt/seocho-website
git clone <저장소 URL> .
cp .env.example .env      # 값 채우기 (위와 동일)
npm run seed              # 최초 1회

# ffmpeg 설치(사진 썸네일 자동 생성용, 선택)
sudo apt-get install -y ffmpeg

# 서비스 등록
sudo cp deploy/website.service /etc/systemd/system/seocho-website.service
#   유닛 파일의 User/WorkingDirectory/경로를 환경에 맞게 수정
sudo systemctl daemon-reload
sudo systemctl enable --now seocho-website
journalctl -u seocho-website -f
```

이 방식은 앞단에 **Nginx 또는 Caddy** 를 두고 HTTPS 를 붙이세요.
가장 간단한 건 Caddy 1줄 설정입니다:

```
your-domain.kr {
    reverse_proxy 127.0.0.1:3000
}
```

---

## 배포 후 공통 조치 (모든 방식)

1. **초기 비밀번호 변경** — 시드로 만들어진 슈퍼/관리자 계정 로그인 후 즉시 변경.
2. **네이버 지도 키**(쓸 경우) — `.env` 의 `NAVER_MAP_CLIENT_ID` 설정 + 콘솔에 도메인 등록.
3. **백업** — `data/` 디렉터리(= DB·업로드·서명키)를 정기 백업. Docker 는 `app-data` 볼륨.
4. **서명 개인키** — `data/sign_key.json` 은 절대 유출 금지(전자서명 위변조 방지 키). 운영에선 `SIGN_PRIVATE_KEY` 환경변수 권장.

---

## 사진 저장을 R2/S3 로 (선택, 사진 많을 때)

`.env` 에서:

```
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_BASE_URL=https://cdn.your-domain.kr   # 퍼블릭/CDN
```

**Cloudflare R2 는 전송(egress) 비용이 0원**이라 미디어 서비스에 유리합니다.
영상은 이미 유튜브·인스타·네이버TV **링크 임베드**이므로 저장·전송 비용이 들지 않습니다.

---

## 문제 해결

| 증상 | 확인 |
| --- | --- |
| 접속이 안 됨 | 방화벽 80/443, DNS A 레코드, `docker compose logs -f` |
| 인증서 발급 실패 | 도메인이 서버 IP를 가리키는지, 80 포트 개방 여부 |
| 사진 썸네일이 원본 크기 | 서버에 `ffmpeg` 설치 여부(`ffmpeg -version`) |
| 지도가 목록으로만 나옴 | `NAVER_MAP_CLIENT_ID` 설정·도메인 등록 여부 |
