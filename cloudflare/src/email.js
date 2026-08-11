// 이메일 발송 (Resend API) — RESEND_API_KEY 미설정 시 조용히 건너뜀(폴백 동작 유지)
// 설정: wrangler.toml 또는 대시보드에 RESEND_API_KEY, MAIL_FROM("상인회 플랫폼 <no-reply@도메인>")
export const emailEnabled = (env) => !!(env.RESEND_API_KEY && env.MAIL_FROM);

// 조직 단위 하루 발송 상한. 자체 가입을 열면 "누구나 우리 메일 계정으로 대량 발송"이 된다 —
// 도메인 평판이 망가지면 정작 계약 안내 메일이 스팸함으로 간다. 그래서 조직마다 상한을 둔다.
// 상한을 넘으면 조용히 버리지 않고 실패로 기록해 관리자가 발송 내역에서 이유를 볼 수 있게 한다.
export const DEFAULT_DAILY_EMAIL_MAX = 200;
export async function dailyEmailMax(db) {
  const { getSetting } = await import("./db.js");
  const n = parseInt((await getSetting(db, "daily_email_max")) || "", 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_EMAIL_MAX;
}
// 조직에 귀속되는 메일은 반드시 이 함수를 거친다(상한 + 기록).
export async function sendEmailFor(env, db, assoc, { to, subject, html, kind = "" }) {
  if (!emailEnabled(env)) return { skipped: true };
  const D = await import("./db.js");
  const { maskEmail } = await import("./util.js");
  const masked = maskEmail(to);
  if (assoc) {
    const max = await dailyEmailMax(db);
    if (max > 0 && (await D.countMessagesToday(db, assoc.id, "email")) >= max) {
      await D.logMessage(db, { associationId: assoc.id, channel: "email", kind, recipient: masked,
        status: "failed", cost: 0, detail: `하루 발송 상한(${max}건) 초과` });
      return { capped: true, error: `하루 메일 발송 상한(${max}건)을 넘었습니다.` };
    }
  }
  const r = await sendEmail(env, { to, subject, html });
  if (assoc) {
    await D.logMessage(db, { associationId: assoc.id, channel: "email", kind, recipient: masked,
      status: r.sent ? "sent" : "failed", cost: 0, detail: r.error || "" });
  }
  return r;
}

export async function sendEmail(env, { to, subject, html }) {
  if (!emailEnabled(env)) return { skipped: true };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html }),
    });
    if (!res.ok) return { error: `메일 발송 실패 (${res.status})` };
    return { sent: true };
  } catch {
    return { error: "메일 발송 실패 (네트워크)" };
  }
}

// 공용 이메일 레이아웃 (인라인 스타일 — 메일 클라이언트 호환)
export function mailShell(title, inner, siteName = "상인회 플랫폼") {
  return `<div style="margin:0;padding:24px;background:#f5f5f7;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #e8e8ed">
    <div style="font-size:13px;font-weight:700;color:#0b6e4f;margin-bottom:14px">${siteName}</div>
    <h1 style="margin:0 0 14px;font-size:20px;color:#1d1d1f">${title}</h1>
    <div style="font-size:15px;line-height:1.7;color:#515154">${inner}</div>
    <p style="margin:24px 0 0;font-size:12px;color:#86868b">본인이 요청하지 않았다면 이 메일을 무시하세요.</p>
  </div></div>`;
}

export const mailButton = (href, label) =>
  `<p style="margin:20px 0"><a href="${href}" style="display:inline-block;background:#0b6e4f;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:999px">${label}</a></p>
   <p style="font-size:12px;color:#86868b;word-break:break-all">버튼이 안 눌리면 이 주소를 복사해 접속하세요:<br>${href}</p>`;
