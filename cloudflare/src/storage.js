// R2 오브젝트 스토리지 (사진 + 히어로 배경 영상).
import { randomHex } from "./crypto.js";

const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "application/pdf": ".pdf",
  "video/mp4": ".mp4", "video/webm": ".webm" };
export const extForType = (ct) => EXT[ct] || "";

// R2 바인딩(MEDIA)이 없으면 사진 저장 비활성 — 사이트 나머지는 정상 동작.
export const enabled = (env) => !!env.MEDIA;

export async function save(env, data, contentType) {
  if (!env.MEDIA) throw new Error("R2_DISABLED");
  const key = randomHex(16) + extForType(contentType);
  await env.MEDIA.put(key, data, { httpMetadata: { contentType } });
  return key;
}
export async function remove(env, key) {
  if (key && env.MEDIA) { try { await env.MEDIA.delete(key); } catch {} }
}
export function get(env, key) {
  return env.MEDIA ? env.MEDIA.get(key) : null;
}
