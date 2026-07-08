// 세션 서명 시크릿 자동 관리 — env 우선, 없으면 D1 settings 에 자동 생성·영속.
// 덕분에 배포 시 시크릿을 수동 등록하지 않아도 됩니다(원하면 env 로 고정 가능).
import { getSetting, setSetting } from "./db.js";
import { randomHex } from "./crypto.js";

let cached = null;
export async function resolveSessionSecret(env) {
  if (env.SESSION_SECRET && env.SESSION_SECRET !== "") return env.SESSION_SECRET;
  if (cached) return cached;
  let s = await getSetting(env.DB, "session_secret");
  if (!s) { s = randomHex(48); await setSetting(env.DB, "session_secret", s); }
  cached = s;
  return s;
}
