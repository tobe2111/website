# 서초구 상인회 플랫폼 — 프로덕션 이미지
# Node 22 + ffmpeg(이미지 썸네일·레거시 영상 처리용). 외부 npm 의존성 0.
FROM node:22-slim

# ffmpeg: 사진 썸네일 생성에 사용(없어도 원본 폴백으로 동작하지만, 있으면 자동 최적화)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg wget \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 의존성이 없으므로 package.json 만 먼저 복사(레이어 캐시)
COPY package.json ./
COPY . .

# 런타임 데이터 디렉터리(볼륨 마운트 지점)
RUN mkdir -p /app/data/uploads

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_FILE=/app/data/app.db \
    UPLOAD_DIR=/app/data/uploads

EXPOSE 3000

# 컨테이너 헬스체크 (/healthz)
HEALTHCHECK --interval=30s --timeout=4s --start-period=8s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

# 첫 기동 시 시드가 필요하면 `docker compose run --rm app npm run seed` 사용
CMD ["node", "--experimental-sqlite", "src/server.js"]
