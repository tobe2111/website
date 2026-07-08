// 애플리케이션 설정 (환경 변수로 재정의 가능)
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, "..");

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || "0.0.0.0",

  // 세션 쿠키 서명 키. 실제 운영에서는 반드시 SESSION_SECRET 환경 변수로 지정하세요.
  sessionSecret:
    process.env.SESSION_SECRET || "dev-secret-change-me-in-production",
  sessionCookie: "sc_session",
  sessionMaxAgeSec: 60 * 60 * 24 * 7, // 7일

  // 데이터베이스 파일 경로
  dbFile: process.env.DB_FILE || path.join(ROOT, "data", "app.db"),

  // 로컬 업로드 저장 경로 및 공개 URL 프리픽스
  uploadDir: process.env.UPLOAD_DIR || path.join(ROOT, "data", "uploads"),
  uploadUrlPrefix: "/uploads",

  // 업로드 제한
  maxImageBytes: 8 * 1024 * 1024, // 8MB
  maxVideoBytes: 120 * 1024 * 1024, // 120MB
  allowedImageTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  allowedVideoTypes: ["video/mp4", "video/webm", "video/quicktime"],

  publicDir: path.join(ROOT, "public"),
  isProd: process.env.NODE_ENV === "production",
};
