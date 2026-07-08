// 스토리지 추상화 계층 — 로컬 파일시스템 또는 S3 호환 클라우드 선택.
// STORAGE_DRIVER 환경 변수로 전환 (local | s3). 나머지 코드는 이 인터페이스만 사용합니다.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";
import * as s3 from "./s3.js";

const DRIVER = config.storageDriver === "s3" ? "s3" : "local";

if (DRIVER === "local") fs.mkdirSync(config.uploadDir, { recursive: true });

const EXT_BY_TYPE = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
  "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
};
export function extForType(contentType) {
  return EXT_BY_TYPE[contentType] || "";
}
function newKey(contentType) {
  return crypto.randomBytes(16).toString("hex") + extForType(contentType);
}

// 파일 저장 → 저장소 내부 식별자(파일명/키) 반환
export async function save(buffer, contentType) {
  const key = newKey(contentType);
  if (DRIVER === "s3") {
    await s3.putObject(key, buffer, contentType);
    return key;
  }
  fs.writeFileSync(path.join(config.uploadDir, key), buffer);
  return key;
}

export async function remove(filename) {
  if (!filename) return;
  const key = path.basename(filename);
  if (DRIVER === "s3") {
    try { await s3.deleteObject(key); } catch (e) { console.error("[storage] s3 delete", e.message); }
    return;
  }
  fs.rm(path.join(config.uploadDir, key), { force: true }, () => {});
}

// 공개 접근 URL
export function publicUrl(filename) {
  if (DRIVER === "s3") return s3.publicUrl(filename);
  return `${config.uploadUrlPrefix}/${filename}`;
}

// 로컬 파일 스트리밍용 절대 경로 (경로 이탈 방지). s3 모드에서는 사용 안 함.
export function resolvePath(filename) {
  return path.join(config.uploadDir, path.basename(filename));
}

export const driver = DRIVER;
