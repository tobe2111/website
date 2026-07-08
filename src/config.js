// 애플리케이션 설정 (환경 변수로 재정의 가능)
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
const bool = (v, def = false) => (v == null ? def : /^(1|true|yes|on)$/i.test(String(v)));

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || "0.0.0.0",

  // 세션
  sessionSecret: process.env.SESSION_SECRET || "dev-secret-change-me-in-production",
  sessionCookie: "sc_session",
  sessionMaxAgeSec: 60 * 60 * 24 * 7,

  // 데이터베이스
  dbFile: process.env.DB_FILE || path.join(ROOT, "data", "app.db"),

  // ----- 멀티테넌트 주소 방식 -----
  // BASE_DOMAIN 설정 시 서브도메인 라우팅 활성화 (예: seocho.example.com).
  // 미설정 시 경로 기반(/t/:slug)만 사용.
  baseDomain: (process.env.BASE_DOMAIN || "").toLowerCase().replace(/^\.+|\.+$/g, ""),
  publicScheme: process.env.PUBLIC_SCHEME || "https",

  // ----- 스토리지 -----
  // STORAGE_DRIVER = 'local' (기본) | 's3'
  storageDriver: (process.env.STORAGE_DRIVER || "local").toLowerCase(),
  uploadDir: process.env.UPLOAD_DIR || path.join(ROOT, "data", "uploads"),
  uploadUrlPrefix: "/uploads",

  // S3 / R2 / MinIO (S3 호환) — STORAGE_DRIVER=s3 일 때 사용
  s3: {
    region: process.env.S3_REGION || "us-east-1",
    bucket: process.env.S3_BUCKET || "",
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    // R2/MinIO 등 커스텀 엔드포인트 (예: https://<account>.r2.cloudflarestorage.com). AWS 는 비워두면 자동 구성.
    endpoint: process.env.S3_ENDPOINT || "",
    // 퍼블릭 접근 URL 베이스 (CDN 또는 퍼블릭 버킷). 예: https://cdn.example.com
    publicBaseUrl: (process.env.S3_PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
    forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, false),
  },

  // ----- 미디어 처리 (ffmpeg 존재 시 자동 동작) -----
  mediaTranscode: bool(process.env.MEDIA_TRANSCODE, true), // 영상 → H.264 mp4 정규화
  mediaPoster: bool(process.env.MEDIA_POSTER, true),       // 영상 포스터(썸네일) 프레임 추출

  // 업로드 제한
  maxImageBytes: 8 * 1024 * 1024,
  maxVideoBytes: 120 * 1024 * 1024,
  maxLogoBytes: 2 * 1024 * 1024,
  allowedImageTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  allowedVideoTypes: ["video/mp4", "video/webm", "video/quicktime"],

  publicDir: path.join(ROOT, "public"),
  isProd: process.env.NODE_ENV === "production",
};

export const subdomainRouting = !!config.baseDomain;
