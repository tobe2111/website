// 주간 정기 작업 (Cron Trigger): ① 전체 데이터 암호화 백업 → R2 ② 상인회별 운영 리포트 메일
// - 백업은 SESSION_SECRET 파생 키로 AES-GCM 암호화한다. MEDIA 버킷은 r2.dev 로 공개 서빙될 수
//   있으므로(사진 공개용) 평문 백업을 두면 이메일·해시가 노출된다 — 반드시 암호화 상태로만 저장.
// - 복호화: node cloudflare/scripts/decrypt-backup.mjs <파일> <SESSION_SECRET>
import { sendEmail, emailEnabled, mailShell } from "./email.js";
import * as D from "./db.js";
import { sendMany, priceOf } from "./notify.js";

const BACKUP_PREFIX = "backups/";
const MANIFEST_KEY = "backups/index.json"; // R2 list() 없이도 보존 개수를 관리하기 위한 목록
const KEEP = 8; // 주 1회 × 8주 보존

// 복원 가치가 있는 원본 테이블 전체 (스키마 변화에 안전하도록 SELECT * 덤프)
const TABLES = [
  "associations", "users", "businesses", "media", "products", "coupons",
  "updates", "polls", "poll_votes", "event_rsvps", "dues",
  "notices", "events", "posts", "comments", "post_images",
  "documents", "signatures", "signature_requests",
  "notifications", "applications", "audit_log", "settings",
];

async function aesKey(secret) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("backup|" + secret));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptBackup(secret, json) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(json));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0); out.set(new Uint8Array(ct), 12);
  return out;
}
export async function decryptBackup(secret, bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, await aesKey(secret), buf.slice(12));
  return new TextDecoder().decode(pt);
}

async function dumpAll(db) {
  const dump = { backed_up_at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) {
    try {
      if (t === "settings") { // rowid 없는 소형 표
        dump.tables[t] = (await db.prepare("SELECT * FROM settings").all()).results || [];
        continue;
      }
      // 키셋 청크 — 한 번에 다 읽으면 D1 결과셋 한도·워커 메모리를 칠 수 있음 (특히 media·audit_log)
      const rows = [];
      let last = 0;
      for (;;) {
        const chunk = (await db.prepare(`SELECT rowid AS __rid, * FROM ${t} WHERE rowid > ? ORDER BY rowid LIMIT 2000`).bind(last).all()).results || [];
        if (!chunk.length) break;
        last = chunk[chunk.length - 1].__rid;
        for (const r of chunk) { delete r.__rid; rows.push(r); }
        if (chunk.length < 2000) break;
      }
      dump.tables[t] = rows;
    } catch { dump.tables[t] = null; } // 미생성 표(아주 옛 DB)는 건너뜀
  }
  return dump;
}

export async function runBackup(env) {
  if (!env.MEDIA) return { skipped: "R2 미연결" };
  let dump = await dumpAll(env.DB);
  const json = JSON.stringify(dump);
  dump = null; // 객체 그래프를 먼저 놓아 암호화 시 메모리 이중 보유를 줄임
  const enc = await encryptBackup(env.SESSION_SECRET, json);
  const key = `${BACKUP_PREFIX}backup-${new Date().toISOString().slice(0, 10)}.json.enc`;
  await env.MEDIA.put(key, enc, { httpMetadata: { contentType: "application/octet-stream" } });
  // 보존 개수 관리 (manifest 방식 — R2 list 권한/호출 불필요)
  let keys = [];
  try {
    const m = await env.MEDIA.get(MANIFEST_KEY);
    if (m) keys = JSON.parse(new TextDecoder().decode(await m.arrayBuffer()));
  } catch {}
  keys = keys.filter((k) => k !== key); keys.push(key);
  while (keys.length > KEEP) { const old = keys.shift(); try { await env.MEDIA.delete(old); } catch {} }
  await env.MEDIA.put(MANIFEST_KEY, JSON.stringify(keys), { httpMetadata: { contentType: "application/json" } });
  return { key, bytes: enc.byteLength, kept: keys.length };
}

// 상인회별 주간 리포트 — 이메일 설정(RESEND) + 상인회 이메일이 있을 때만
export async function runWeeklyReports(env) {
  if (!emailEnabled(env)) return { skipped: "이메일 미설정" };
  const db = env.DB;
  const assocs = (await db.prepare("SELECT * FROM associations WHERE active=1 AND email != ''").all()).results || [];
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  let sent = 0;
  for (const a of assocs) {
    const one = async (sql, ...args) => (await db.prepare(sql).bind(...args).first())?.n ?? 0;
    const [newMembers, pending, contacts, newNotices] = await Promise.all([
      one("SELECT COUNT(*) AS n FROM users WHERE association_id=?1 AND role='MERCHANT' AND created_at >= ?2", a.id, since),
      one("SELECT COUNT(*) AS n FROM businesses WHERE association_id=?1 AND status='pending'", a.id),
      one("SELECT COUNT(*) AS n FROM notifications WHERE association_id=?1 AND kind='contact' AND created_at >= ?2", a.id, since),
      one("SELECT COUNT(*) AS n FROM notices WHERE association_id=?1 AND created_at >= ?2", a.id, since),
    ]);
    if (!newMembers && !pending && !contacts && !newNotices) continue; // 조용한 주는 메일도 조용히
    const rows = [
      ["신규 가입", `${newMembers}곳`], ["승인 대기", `${pending}건`],
      ["방문자 문의", `${contacts}건`], ["새 공지", `${newNotices}건`],
    ].map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;color:#666">${k}</td><td style="padding:6px 0;font-weight:700">${v}</td></tr>`).join("");
    await sendEmail(env, {
      to: a.email,
      subject: `[${a.name}] 지난 주 우리 상인회 소식`,
      html: mailShell(`${a.name} 주간 리포트`, `<p>지난 7일 동안의 활동 요약입니다.</p><table>${rows}</table><p style="color:#888;font-size:13px">승인 대기 건은 관리자 페이지에서 처리할 수 있습니다.</p>`),
    }).catch(() => {});
    sent++;
  }
  return { sent };
}

// 매일: 서명 기한이 임박(D-2 이내)한 문서의 미서명자에게 알림톡 자동 리마인더.
// 크레딧이 없는 상인회는 건너뛴다(과금 실패로 로그만 쌓이지 않도록).
export async function runSignReminders(env) {
  const db = env.DB;
  const docs = await D.listDocsNeedingRemind(db);
  let sent = 0, docsDone = 0, skipped = 0;
  for (const d of docs) {
    const assoc = await D.getAssociationById(db, d.association_id);
    if (!assoc) continue;
    const targets = (await D.listUnsigned(db, d.id)).filter((t) => t.phone);
    if (!targets.length) { await D.markReminded(db, d.id); continue; }
    const price = await priceOf(db, "alimtalk");
    if ((await D.getBalance(db, assoc.id)) < price) { skipped++; continue; } // 잔액 없으면 다음날 다시 시도
    const r = await sendMany(env, db, {
      assoc, kind: "sign_remind", recipients: targets,
      textFor: (m) => `[${assoc.name}] ${m.name}님, '${d.title}' 전자서명 기한이 ${d.due_date}까지입니다. 아직 서명이 완료되지 않았습니다.`,
      buttonName: "서명하러 가기", buttonUrl: `${env.PUBLIC_ORIGIN || ""}/t/${d.assoc_slug}/sign`,
    });
    sent += r.sent; docsDone++;
    await D.markReminded(db, d.id);
  }
  return { docs: docsDone, sent, skipped };
}

export async function runDaily(env) {
  const reminders = await runSignReminders(env).catch((e) => ({ error: String(e) }));
  console.log("daily job", JSON.stringify({ reminders }));
  return { reminders };
}

export async function runWeekly(env) {
  const backup = await runBackup(env).catch((e) => ({ error: String(e) }));
  const report = await runWeeklyReports(env).catch((e) => ({ error: String(e) }));
  console.log("weekly job", JSON.stringify({ backup, report }));
  return { backup, report };
}
