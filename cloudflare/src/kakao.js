// 카카오 로그인 —— 비밀번호 없이 들어오는 문.
//
// 왜 붙이는가 ——
// 이 화면을 쓰는 사람은 40~60대 사장님이다. 지금 가장 많이 막히는 지점이 비밀번호다.
// 관리자가 임시 비밀번호를 만들어 카톡으로 보내고, 사장님은 그걸 잃어버리고, 다시 요청한다.
// 카카오로 들어오면 그 왕복이 통째로 사라진다.
//
// 그리고 덤으로 하나 더 —— 카카오 계정은 만들 때 이미 **통신사 휴대폰 인증**을 거친다.
// 그래서 카카오가 알려 준 번호가 우리 명부의 번호와 같으면, "그 번호를 실제로 가진 사람이
// 지금 들어왔다" 는 상당한 근거가 된다. 총회 안건 투표에서 대리투표를 막는 데 쓴다.
// 다만 이것은 법이 정한 본인확인기관(PASS 등)의 인증이 **아니다** — 화면에도 그렇게 적는다.
//
// ── 우리가 절대 하지 않는 것 ────────────────────────────────────────────
// · 액세스 토큰을 저장하지 않는다. 사용자 정보를 한 번 읽고 그 자리에서 버린다.
//   우리는 카카오톡을 대신 보내지 않으므로 토큰을 들고 있을 이유가 없다.
// · 카카오로 들어왔다고 **자동으로 회원을 만들지 않는다.** 그러면 아무나 상인회 회원이 된다.
//   명부에 있는 번호일 때만 그 계정에 이어 붙인다.
// ────────────────────────────────────────────────────────────────────
import * as D from "./db.js";

const AUTH = "https://kauth.kakao.com/oauth/authorize";
const TOKEN = "https://kauth.kakao.com/oauth/token";
const ME = "https://kapi.kakao.com/v2/user/me";

// 열쇠가 있어야 문이 열린다. REST 키는 지도 검색과 같은 앱의 것을 쓴다.
export const kakaoReady = (env) => !!(env && env.KAKAO_REST_KEY);

// 이 요청이 서 있는 자리(도메인)로 되돌아온다. 상인회마다 도메인이 다르므로
// 고정값을 쓸 수 없다 — 카카오 콘솔에는 도메인마다 한 줄씩 등록해 둔다.
export const kakaoRedirectUri = (url) => `${url.origin}/auth/kakao/callback`;

// ---------- state —— 남이 시작한 로그인을 가로채지 못하게 ----------
//
// 카카오가 돌려주는 code 는 주소에 그대로 실려 온다. state 없이 받으면, 공격자가 자기
// 카카오로 받은 code 를 남의 브라우저에 밀어 넣어 **남의 계정에 자기 카카오를 잇는** 일이
// 가능해진다(로그인 CSRF). 그래서 우리가 서명해 보낸 값이 그대로 돌아왔을 때만 받는다.
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret || "kakao"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
}
const STATE_TTL_MS = 10 * 60 * 1000;

// payload: 돌아와서 가야 할 자리 (테넌트 base + next) · 지금 로그인한 사람(있으면)
export async function makeState(secret, { base = "", next = "", uid = 0 } = {}) {
  const body = JSON.stringify({ b: base, n: next, u: uid | 0, t: Date.now() });
  const data = b64url(new TextEncoder().encode(body));
  return `${data}.${await hmac(secret, data)}`;
}
export async function readState(secret, state) {
  const [data, sig] = String(state || "").split(".");
  if (!data || !sig) return null;
  if ((await hmac(secret, data)) !== sig) return null;          // 우리가 서명한 값이 아니다
  let o;
  try {
    o = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(data.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
  } catch { return null; }
  if (!o || typeof o.t !== "number" || Date.now() - o.t > STATE_TTL_MS) return null;   // 오래된 것
  return { base: String(o.b || ""), next: String(o.n || ""), uid: o.u | 0 };
}

// ---------- 카카오와 주고받기 ----------
export function kakaoAuthUrl(env, { redirectUri, state }) {
  const q = new URLSearchParams({
    client_id: env.KAKAO_REST_KEY, redirect_uri: redirectUri, response_type: "code", state,
  });
  // scope 는 일부러 보내지 않는다 —— 무엇을 받을지는 카카오 콘솔의 동의항목이 정한다.
  // 여기에 박아 두면 비즈니스 앱 전환 전에는 전화번호를 달라다가 통째로 거절당하고,
  // 전환 뒤에는 코드를 다시 고쳐야 한다. 콘솔에서 한 번 켜면 그만인 일이다.
  return `${AUTH}?${q}`;
}

export async function kakaoExchange(env, { code, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code", client_id: env.KAKAO_REST_KEY, redirect_uri: redirectUri, code,
  });
  if (env.KAKAO_CLIENT_SECRET) body.set("client_secret", env.KAKAO_CLIENT_SECRET);
  const r = await fetch(TOKEN, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" }, body: body.toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return { ok: false, error: j.error_description || j.error || `토큰 교환 실패 (${r.status})` };
  return { ok: true, token: j.access_token };
}

// 카카오가 주는 번호는 "+82 10-1234-5678" 꼴이다. 우리 명부는 숫자만 담는다.
export function normalizeKakaoPhone(v) {
  let s = String(v || "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+82")) s = "0" + s.slice(3);
  else if (s.startsWith("82") && s.length > 10) s = "0" + s.slice(2);
  s = s.replace(/\D/g, "");
  return /^01\d{8,9}$/.test(s) ? s : "";
}

export async function kakaoMe(token) {
  const r = await fetch(ME, { method: "GET", headers: { authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) return { ok: false, error: j.msg || `사용자 정보를 받지 못했습니다 (${r.status})` };
  const acc = j.kakao_account || {};
  return {
    ok: true,
    id: String(j.id),
    // 아래 셋은 **비즈니스 앱으로 전환하고 동의항목을 켠 뒤에만** 들어온다.
    // 전환 전에는 빈 값이며, 그때는 '로그인한 상태에서 연결' 경로만 열린다.
    phone: normalizeKakaoPhone(acc.phone_number || ""),
    name: String(acc.name || (acc.profile && acc.profile.nickname) || "").trim(),
    email: String(acc.email || "").trim().toLowerCase(),
  };
}

// ---------- 누구인지 정하기 ----------
//
// 순서가 곧 규칙이다.
//   ① 이미 이어 둔 카카오면 그 사람이다.
//   ② 로그인한 채로 '연결' 을 누른 것이면 그 계정에 잇는다.
//   ③ 카카오가 알려 준 번호가 명부에 있으면 그 사람이다(첫 로그인도 이 길로 통과한다).
//   ④ 그 밖에는 **아무것도 만들지 않는다.** 모르는 사람이다.
export async function resolveKakaoUser(db, kk, { uid = 0, assocId = null } = {}) {
  const linked = await D.getUserByKakaoId(db, kk.id);
  if (linked) return { kind: "login", user: linked };

  if (uid) {
    const me = await D.getUserById(db, uid);
    if (me) {
      if (me.kakao_id && me.kakao_id !== kk.id) return { kind: "already", user: me };
      return { kind: "link", user: me };
    }
  }

  if (kk.phone) {
    const byPhone = await D.findUserByPhone(db, kk.phone, assocId);
    if (byPhone) {
      if (byPhone.kakao_id && byPhone.kakao_id !== kk.id) return { kind: "taken", user: byPhone };
      return { kind: "link", user: byPhone };
    }
    return { kind: "unknown", phone: kk.phone };
  }
  // 번호를 못 받았다 = 비즈니스 앱 전환 전이거나 동의하지 않았다.
  return { kind: "nophone" };
}
