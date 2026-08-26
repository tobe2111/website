// 주간 정기 작업 (Cron Trigger): ① 전체 데이터 암호화 백업 → R2 ② 상인회별 운영 리포트 메일
// - 백업은 SESSION_SECRET 파생 키로 AES-GCM 암호화한다. MEDIA 버킷은 r2.dev 로 공개 서빙될 수
//   있으므로(사진 공개용) 평문 백업을 두면 이메일·해시가 노출된다 — 반드시 암호화 상태로만 저장.
// - 복호화: node cloudflare/scripts/decrypt-backup.mjs <파일> <SESSION_SECRET>
import { sendEmail, emailEnabled, mailShell } from "./email.js";
import * as D from "./db.js";
import { sendMany, priceOf } from "./notify.js";
import { sealAnchor } from "./esign.js";
import { remindExternals, originFor } from "./extsign.js";
import { kindOf, assocTerms } from "./kinds.js";

// 크론 표현식 — wrangler.toml [triggers].crons 와 '글자 하나까지' 같아야 한다.
// scheduled() 가 이 문자열로 어떤 작업인지 가른다. 한쪽만 고치면 조용히 엉뚱한 작업이 돈다.
// ⚠️ 요일 자리에 0 을 쓰면 안 된다 — Cloudflare 는 요일을 1-7(SUN-SAT)로만 받고,
//    0 이 들어가면 크론 등록 API 가 통째로 실패한다(code 10100). 그러면 세 개 다 등록되지 않아
//    백업·리마인더·웹훅이 전부 멈춘다. 실제로 그 상태였다. 헷갈리지 않게 이름(SUN)으로 쓴다.
export const CRON = {
  weekly: "0 18 * * SUN", // 일 18:00 UTC = 월 03:00 KST — 백업 + 주간 리포트
  daily: "0 0 * * *",     // 매일 09:00 KST — 서명 기한 리마인더
  webhooks: "*/5 * * * *", // 5분마다 — 웹훅 재전송 큐
};

const BACKUP_PREFIX = "backups/";
const MANIFEST_KEY = "backups/index.json"; // R2 list() 없이도 보존 개수를 관리하기 위한 목록
const KEEP = 8; // 주 1회 × 8주 보존

// 복원 가치가 있는 원본 테이블 전체 (스키마 변화에 안전하도록 SELECT * 덤프)
export const TABLES = [
  "associations", "users", "businesses", "media", "products", "coupons",
  "updates", "polls", "poll_votes", "event_rsvps", "dues",
  "notices", "events", "posts", "comments", "post_images",
  "documents", "signatures", "signature_requests",
  // 전자계약 — 필드 배치·채운 값·서식·감사 추적·외부 서명자까지 있어야 계약이 복원된다.
  // (서명 봉인만 남고 '무엇을 어디에 채웠는지'가 없으면 계약서를 다시 그릴 수 없다)
  "doc_fields", "doc_field_values", "doc_templates", "doc_events", "external_signers",
  "notify_wallet", "credit_ledger", "credit_orders", "message_log", "chain_anchor", "api_keys",
  "notifications", "applications", "application_notes", "audit_log", "settings",
  // 옛 주소 — 빠뜨리면 복원 후 이미 나간 링크(알림톡 버튼·명함·검색결과)가 전부 죽는다
  "slug_aliases",
  // 모집형 — 상담 신청(leads)은 이 제품에서 가장 잃으면 안 되는 자산이다.
  // 랜딩 구성·사본·사진 목록·방문 통계까지 있어야 사고 후에 화면과 성과를 함께 되살릴 수 있다.
  "leads", "landing_variants", "landing_views", "landing_assets",
];

// 일부러 백업하지 않는 표 — 몇 분이면 사라지는 값이라 복원 대상이 아니다.
// (인증번호는 되살리면 오히려 위험하고, 웹훅 대기열은 되살리면 지난 이벤트를 다시 쏜다)
export const BACKUP_SKIP = ["sign_otp", "ext_otp", "webhook_queue"];

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

// 모집형(랜딩) 조직의 주간 리포트.
// 상인회 리포트(가입·승인 대기)는 본사에게 남의 숫자다. 여기서 볼 것은 하나뿐이다 —
// "지난주에 몇 명이 연락처를 남겼고, 그게 어디서 왔는가".
// 이 메일이 매주 가야 담당자가 화면을 다시 연다. 안 열면 상담 DB 는 그냥 쌓이기만 한다.
async function landingWeeklyReport(env, db, a, since) {
  const T = assocTerms(a);
  const one = async (sql, ...args) => (await db.prepare(sql).bind(...args).first())?.n ?? 0;
  const [leads7, fresh, contracts, views7] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM leads WHERE association_id=?1 AND created_at >= ?2", a.id, since),
    one("SELECT COUNT(*) AS n FROM leads WHERE association_id=?1 AND status='new'", a.id),
    one("SELECT COUNT(*) AS n FROM leads WHERE association_id=?1 AND status='contract' AND created_at >= ?2", a.id, since),
    one("SELECT COALESCE(SUM(views),0) AS n FROM landing_views WHERE association_id=?1 AND day >= date(?2)", a.id, since),
  ]);
  // 조용한 주는 메일도 조용히. 다만 '미처리가 쌓여 있으면' 신청이 없어도 알린다 — 그게 진짜 위험 신호다.
  if (!leads7 && !views7 && !fresh) return false;
  const srcRows = (await db.prepare(`SELECT CASE WHEN utm_source='' THEN '직접·기타' ELSE utm_source END AS s,
      COUNT(*) AS n FROM leads WHERE association_id=?1 AND created_at >= ?2 GROUP BY 1 ORDER BY n DESC LIMIT 5`)
    .bind(a.id, since).all()).results || [];
  const rate = views7 > 0 ? `${((leads7 / views7) * 100).toFixed(1)}%` : "-";
  const row = (k, v, strong) => `<tr><td style="padding:6px 14px 6px 0;color:#666">${k}</td>
    <td style="padding:6px 0;font-weight:${strong ? 800 : 700}${strong ? ";color:#b7791f" : ""}">${v}</td></tr>`;
  const table = [
    row(`${T.consult} 신청`, `${leads7}건`),
    row("랜딩 방문", `${views7.toLocaleString()}회`),
    row("전환율", rate),
    row("계약 성사", `${contracts}건`),
    row("미처리(신규)", `${fresh}건`, fresh > 0),
  ].join("");
  const srcList = srcRows.length
    ? `<p style="margin-top:16px;color:#666">어디서 왔나</p><table>${srcRows.map((r) => row(r.s, `${r.n}건`)).join("")}</table>`
    : "";
  const tip = fresh > 0
    ? `<p style="color:#b7791f;font-weight:700">아직 연락하지 않은 신청이 ${fresh}건 있습니다. 오래 둘수록 연결될 확률이 떨어집니다.</p>`
    : leads7 === 0 && views7 > 0
      ? `<p style="color:#888;font-size:13px">방문은 있었는데 신청이 없었습니다. 첫 화면 문구나 비용 안내를 손볼 때입니다.</p>`
      : "";
  await sendEmail(env, {
    to: a.email,
    subject: `[${a.name}] 지난주 ${T.consult} ${leads7}건`,
    html: mailShell(`${a.name} 주간 리포트`,
      `<p>지난 7일 요약입니다.</p><table>${table}</table>${srcList}${tip}
       <p style="color:#888;font-size:13px">상담 DB 에서 상태를 남기면 다음 주 리포트가 더 정확해집니다.</p>`),
  }).catch(() => {});
  return true;
}

// 조직별 주간 리포트 — 이메일 설정(RESEND) + 조직 이메일이 있을 때만
export async function runWeeklyReports(env) {
  if (!emailEnabled(env)) return { skipped: "이메일 미설정" };
  const db = env.DB;
  const assocs = (await db.prepare("SELECT * FROM associations WHERE active=1 AND email != ''").all()).results || [];
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  let sent = 0;
  for (const a of assocs) {
    // 제품마다 볼 숫자가 다르다 — 모집형에는 모집형 리포트를 보낸다
    if (kindOf(a).usesLanding) {
      if (await landingWeeklyReport(env, db, a, since).catch(() => false)) sent++;
      continue;
    }
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

// 매일: 서명 기한이 임박(D-2 이내)한 문서의 미서명자에게 자동 리마인더.
// 알림톡이 되면 알림톡으로, 안 되면(키 미설정·잔액 부족) 이메일로 보낸다.
// ⚠️ 예전에는 잔액이 단가보다 적으면 문서를 통째로 건너뛰었다. 그래서 알리고를 아직 붙이지
//    않았거나 크레딧이 0인 조직은 — 돈이 안 드는 이메일 리마인더까지 함께 죽어 있었다.
//    개통 직후가 정확히 그 상태다.
export async function runSignReminders(env) {
  const db = env.DB;
  const docs = await D.listDocsNeedingRemind(db);
  const { emailEnabled, sendEmailFor, mailShell, mailButton } = await import("./email.js");
  const { notifyEnabled } = await import("./notify.js");
  const { esc } = await import("./util.js");
  let sent = 0, docsDone = 0, skipped = 0;
  for (const d of docs) {
    const assoc = await D.getAssociationById(db, d.association_id);
    if (!assoc) continue;
    const price = await priceOf(db, "alimtalk");
    const canAlimtalk = notifyEnabled(env) && (await D.getBalance(db, assoc.id)) >= price;
    const canEmail = emailEnabled(env);
    if (!canAlimtalk && !canEmail) { skipped++; continue; } // 보낼 수단이 아예 없다 — 다음날 다시
    // 크론에는 요청이 없다 — 개별 도메인 → PUBLIC_ORIGIN → 학습해 둔 주소 순으로 찾는다
    const origin = await originFor(env, db, assoc);
    if (!origin) { skipped++; continue; } // 주소를 모르면 깨진 링크를 보내느니 다음날로 미룬다
    // 회원 — 공용 서명 목록 주소로
    const unsigned = await D.listUnsigned(db, d.id);
    const targets = canAlimtalk ? unsigned.filter((t) => t.phone) : [];
    if (targets.length) {
      // ⚠️ 여기서 문구를 직접 쓰면 안 된다. 알림톡은 심사받은 문구와 글자까지 같아야
      // 발송되므로, 손으로 쓴 문장은 카카오가 거절한다(사내 회원 재알림이 통째로 죽는다).
      // 반드시 심사받은 템플릿에 변수만 갈아 끼운다.
      const { renderTemplate, templateButton } = await import("./notify.js");
      const r = await sendMany(env, db, {
        assoc, kind: "sign_remind", recipients: targets,
        textFor: (m) => renderTemplate("sign_remind", {
          상호: assoc.name, 이름: m.name, 문서명: d.title, 기한: d.due_date || "미지정",
        }),
        buttonName: templateButton("sign_remind"), buttonUrl: `${origin}/t/${d.assoc_slug}/sign`,
      });
      sent += r.sent;
    } else if (canEmail) {
      // 알림톡을 못 쓰는 동안에도 회원은 안내를 받아야 한다
      for (const m of unsigned.filter((t) => t.email)) {
        const r = await sendEmailFor(env, db, assoc, { kind: "sign_remind", to: m.email,
          subject: `[${assoc.name}] 전자서명 미완료 안내 — ${d.title}`,
          html: mailShell(`${esc(assoc.name)} 전자서명`,
            `<p>${esc(m.name)}님, 아직 서명하지 않은 계약서가 있습니다.</p>
             <p><b>${esc(d.title)}</b>${d.due_date ? ` (기한: ${esc(d.due_date)})` : ""}</p>
             ${mailButton(`${origin}/t/${d.assoc_slug}/sign`, "서명하러 가기")}`) }).catch(() => ({}));
        if (r && r.sent) sent++;
      }
    }
    // 외부 서명자 — 각자 자기 토큰 링크로 (공용 주소로는 들어올 수 없다)
    const ext = await remindExternals(env, db, { assoc, doc: d, origin });
    sent += ext.sent;
    if (!targets.length && !ext.total) { await D.markReminded(db, d.id); continue; }
    docsDone++;
    await D.markReminded(db, d.id);
  }
  return { docs: docsDone, sent, skipped };
}

// 매일: 서명 사슬의 머리를 봉인해 남긴다(시점 증거).
// "이 시각에 이미 이 서명들이 존재했다"를 사후에 증명한다. 서명이 늘지 않았으면 건너뛴다.
// 외부 공인 시점확인(TSA)을 붙이면 external 에 응답을 함께 보관한다(env.TSA_URL 설정 시).
export async function runChainAnchor(env) {
  const db = env.DB;
  const headHash = await D.lastSealHash(db);
  if (!headHash) return { skipped: "서명 없음" };
  const prev = await D.lastAnchor(db);
  if (prev && prev.head_hash === headHash) return { skipped: "변경 없음" };
  const sigCount = await D.countSignatures(db);
  const anchoredAt = new Date().toISOString();
  const seal = await sealAnchor(env, { headHash, sigCount, anchoredAt });
  // 외부 TSA (선택) — RFC3161 서버가 있으면 사슬 머리를 제출해 제3자 시점 증거를 받는다
  let external = "";
  if (env.TSA_URL) {
    try {
      const res = await fetch(env.TSA_URL, {
        method: "POST",
        headers: { "content-type": "application/json", ...(env.TSA_TOKEN ? { authorization: `Bearer ${env.TSA_TOKEN}` } : {}) },
        body: JSON.stringify({ hash: headHash, alg: "SHA-256" }),
      });
      if (res.ok) external = (await res.text()).slice(0, 4000);
    } catch (e) { external = ""; }
  }
  const a = await D.addChainAnchor(db, { headHash, sigCount, anchoredAt, seal, external });
  return { anchored: a.id, sigCount, external: !!external };
}

// 웹훅 전송 — 서명 이벤트를 고객사 서버로 밀어 넣는다. 상대 서버가 느려도 우리 응답이
// 같이 느려지면 안 되므로, 서명 시점에는 큐에만 넣고 실제 전송은 여기서 한다.
export async function runWebhooks(env) {
  const { deliverWebhooks } = await import("./apiv1.js");
  return deliverWebhooks(env, env.DB);
}

export async function runDaily(env) {
  const reminders = await runSignReminders(env).catch((e) => ({ error: String(e) }));
  const anchor = await runChainAnchor(env).catch((e) => ({ error: String(e) }));
  const hooks = await runWebhooks(env).catch((e) => ({ error: String(e) }));
  const leads = await runLeadPurge(env).catch((e) => ({ error: String(e) }));
  console.log("daily job", JSON.stringify({ reminders, anchor, hooks, leads }));
  return { reminders, anchor, hooks, leads };
}

// 보관 기간이 지난 상담 신청 파기.
// "상담이 끝나면 지체 없이 삭제한다"고 처리방침에 써 놓고 사람 손에만 맡기면 실제로는 영원히 남는다.
// 처리가 끝난 건(계약·보류)만 대상이며, 진행 중인 건은 건드리지 않는다.
export async function runLeadPurge(env) {
  const db = env.DB;
  const assocs = await D.listAllAssociations(db);
  let deleted = 0;
  for (const a of assocs) {
    if (a.kind !== "franchise") continue;
    const days = parseInt((await D.getSetting(db, `lead_retention:${a.id}`)) || String(D.LEAD_RETENTION_DEFAULT), 10);
    if (!(days > 0)) continue;
    deleted += await D.purgeOldLeads(db, a.id, days);
  }
  return { deleted };
}

export async function runWeekly(env) {
  const backup = await runBackup(env).catch((e) => ({ error: String(e) }));
  const report = await runWeeklyReports(env).catch((e) => ({ error: String(e) }));
  console.log("weekly job", JSON.stringify({ backup, report }));
  return { backup, report };
}

// ---------- 정기 작업이 '실제로 돌았는지' 기록 ----------
// 크론이 등록되지 않으면 아무 일도 일어나지 않는데, 화면에는 아무 표시도 없었다.
// 그래서 백업이 한 번도 만들어지지 않은 채 몇 달이 지났다(요일 자리에 0 을 쓴 탓).
// 이제는 돌 때마다 시각을 남겨서, 안 돌고 있으면 /super 에서 바로 보이게 한다.
export const CRON_JOBS = { weekly: "주간 백업·리포트", daily: "일일 서명 리마인더", webhooks: "웹훅 재전송" };
export const cronRunKey = (job) => `cron_run:${job}`;
export const jobForCron = (cron) => (cron === CRON.weekly ? "weekly" : cron === CRON.webhooks ? "webhooks" : "daily");

// 크론 한 번의 실행 = 작업 수행 + 실행 기록. index.js 의 scheduled() 가 이것만 부른다.
export async function runCron(cron, env, now = Date.now()) {
  const job = jobForCron(cron);
  let result = null, error = "";
  try {
    result = job === "weekly" ? await runWeekly(env) : job === "webhooks" ? await runWebhooks(env) : await runDaily(env);
  } catch (e) {
    error = String((e && e.message) || e).slice(0, 300);
  }
  // 기록 실패가 작업 자체를 실패시키면 안 된다
  await D.setSetting(env.DB, cronRunKey(job), JSON.stringify({
    at: new Date(now).toISOString(), ms: Date.now() - now, error, cron,
  })).catch(() => {});
  if (error) console.log("cron error", job, error);
  return result;
}
