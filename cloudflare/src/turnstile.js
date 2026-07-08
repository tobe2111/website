// Cloudflare Turnstile (무료 캡차) — 키 설정 시에만 활성화, 미설정 시 자동 통과.
export function turnstileWidget(env) {
  return env.TURNSTILE_SITE_KEY ? `<div class="cf-turnstile" data-sitekey="${env.TURNSTILE_SITE_KEY}"></div>` : "";
}
export function turnstileScript(env) {
  return env.TURNSTILE_SITE_KEY ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : "";
}
export async function turnstileVerify(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true; // 시크릿 미설정이면 검증 생략(설정 시 자동 강제)
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token || "", remoteip: ip || "" }).toString(),
    });
    const j = await r.json();
    return !!j.success;
  } catch { return false; }
}
