// 스토리지 추상화 계층.
// 현재는 로컬 파일 시스템 구현. 나중에 S3/R2 등 클라우드로 전환하려면
// 이 파일의 save/remove/publicUrl 만 교체하면 나머지 코드는 그대로 동작합니다.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";

fs.mkdirSync(config.uploadDir, { recursive: true });

const EXT_BY_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

export function extForType(contentType) {
  return EXT_BY_TYPE[contentType] || "";
}

// 파일 저장 → 저장소 내부 파일명 반환
export function save(buffer, contentType) {
  const name = crypto.randomBytes(16).toString("hex") + extForType(contentType);
  const full = path.join(config.uploadDir, name);
  fs.writeFileSync(full, buffer);
  return name;
}

export function remove(filename) {
  if (!filename) return;
  const full = path.join(config.uploadDir, path.basename(filename));
  fs.rm(full, { force: true }, () => {});
}

// 공개 접근 URL
export function publicUrl(filename) {
  return `${config.uploadUrlPrefix}/${filename}`;
}

// 업로드 파일 스트리밍용 절대 경로 (경로 이탈 방지)
export function resolvePath(filename) {
  const safe = path.basename(filename);
  return path.join(config.uploadDir, safe);
}
