// 운영사가 화면에서 붙여넣는 열쇠.
//
// 지도 열쇠(카카오 REST · 네이버 검색 · 네이버 클라우드 비밀키)는 원래 워커 Secret 으로만
// 들어갔다. 그러려면 Cloudflare 대시보드에 들어가 Settings → Variables 를 찾아야 하는데,
// 운영사가 개발자가 아니면 거기서 막힌다 — 실제로 열쇠를 받아 놓고도 며칠을 못 넣었다.
// 그래서 운영사 콘솔에 붙여넣는 칸을 두고, 워커 Secret 이 비어 있을 때만 그 값을 쓴다.
// Secret 이 있으면 Secret 이 이긴다(운영 인프라가 정한 값을 화면이 덮어쓰지 않는다).
//
// 값은 settings 표의 key_<이름> 줄에 있다. 화면에는 앞 네 글자만 보여 준다.
import * as D from "./db.js";

export const STORED_KEYS = [
  ["KAKAO_REST_KEY", "카카오 REST API 키", /^[0-9a-f]{32}$/i, "developers.kakao.com → 내 애플리케이션 → 앱 키 → REST API 키 (영문·숫자 32자)"],
  ["NAVER_SEARCH_ID", "네이버 검색 Client ID", /^[\w-]{4,128}$/, "developers.naver.com → 검색 API 애플리케이션"],
  ["NAVER_SEARCH_SECRET", "네이버 검색 Client Secret", /^[\w-]{4,128}$/, "위 애플리케이션의 Client Secret"],
  ["NAVER_MAP_CLIENT_SECRET", "네이버 클라우드 지도 비밀키", /^[\w-]{4,128}$/, "네이버 클라우드 Maps 의 Client Secret — 지도 화면 키(NAVER_MAP_CLIENT_ID)와 짝. 주소→좌표에 쓴다"],
];
const settingKey = (name) => `key_${name}`;

// 요청마다 D1 을 네 번 묻지 않게 D1 별로 잠깐 기억한다. 저장하면 곧바로 잊는다.
const TTL_MS = 60 * 1000;
const cache = new WeakMap();   // rawDb → { at, vals }
export function forgetStoredKeys(rawDb) { if (rawDb) cache.delete(rawDb); }

export async function readStoredKeys(db, rawDb) {
  const hit = rawDb && cache.get(rawDb);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.vals;
  const vals = {};
  try {
    for (const [name] of STORED_KEYS) {
      const v = await D.getSetting(db, settingKey(name));
      if (v) vals[name] = String(v).trim();
    }
  } catch { /* settings 표가 아직 없으면 빈 것으로 */ }
  if (rawDb) cache.set(rawDb, { at: Date.now(), vals });
  return vals;
}

// 워커 Secret 이 빈 열쇠만 저장된 값으로 채운 env 를 돌려준다.
export async function withStoredKeys(env, db, rawDb) {
  const stored = await readStoredKeys(db, rawDb);
  const out = { ...env };
  for (const [name] of STORED_KEYS) {
    if (!String(env[name] || "").trim() && stored[name]) out[name] = stored[name];
  }
  return out;
}

export const storeKey = (db, name, value) => D.setSetting(db, settingKey(name), String(value || "").trim());
export const clearKey = (db, name) => D.delSetting(db, settingKey(name));
export const storedKeyHint = async (db, name) => {
  const v = await D.getSetting(db, settingKey(name));
  return v ? `${String(v).slice(0, 4)}…` : "";
};

// 카카오 열쇠가 진짜인지 — 저장하기 전에 한 번 물어본다. 틀린 열쇠를 저장해 두면
// "지도에서 못 찾는다" 로만 보여서 며칠을 헤맨다. 답이 없으면(망) 모름으로 둔다.
export async function checkKakaoKey(key) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const r = await fetch("https://dapi.kakao.com/v2/local/search/keyword.json?query=%EC%84%9C%EC%B4%88&size=1",
      { headers: { Authorization: `KakaoAK ${key}` }, signal: ac.signal });
    return r.status === 200 ? "ok" : (r.status === 401 || r.status === 403) ? "rejected" : "unknown";
  } catch { return "unknown"; }
  finally { clearTimeout(timer); }
}
