// R2 오브젝트 스토리지 (사진). 영상은 임베드라 저장하지 않음.
import { randomHex } from "./crypto.js";

const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
export const extForType = (ct) => EXT[ct] || "";

export async function save(env, data, contentType) {
  const key = randomHex(16) + extForType(contentType);
  await env.MEDIA.put(key, data, { httpMetadata: { contentType } });
  return key;
}
export async function remove(env, key) {
  if (key) { try { await env.MEDIA.delete(key); } catch {} }
}
export function get(env, key) {
  return env.MEDIA.get(key);
}
