// 메일 발송 추상화.
// 기본 'log' 드라이버는 외부 서비스 없이 콘솔에 기록만 합니다(내부 완결, 감사 로그).
// 실제 외부 메일함으로의 배달이 필요할 때만 SMTP 릴레이(예: 회사 메일서버, SES,
// SendGrid, Gmail SMTP)를 아래 sendSmtp 에 구현하고 MAIL_DRIVER=smtp 로 전환하세요.
// (외부 배달은 릴레이가 반드시 필요 — 이메일 프로토콜의 구조적 요구사항)
const DRIVER = (process.env.MAIL_DRIVER || "log").toLowerCase();

export async function send({ to, subject, text }) {
  if (DRIVER === "smtp") return sendSmtp({ to, subject, text });
  // log 드라이버 (기본): 내부 기록만
  console.log(`[mail:log] to=${to || "-"} · ${subject} — ${String(text || "").replace(/\s+/g, " ").slice(0, 200)}`);
  return { ok: true, driver: "log" };
}

// 향후 확장 지점: net/tls 로 SMTP 를 직접 구현하거나 외부 API 호출.
async function sendSmtp() {
  console.warn("[mail] MAIL_DRIVER=smtp 이지만 sendSmtp 가 아직 구현되지 않았습니다.");
  return { ok: false, driver: "smtp" };
}

export const driver = DRIVER;
