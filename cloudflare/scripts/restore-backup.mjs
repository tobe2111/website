// 백업 복원: 복호화한 JSON → D1 에 그대로 넣을 수 있는 SQL 로.
//
//   node cloudflare/scripts/decrypt-backup.mjs backup-2026-08-11.json.enc "<SESSION_SECRET>" > dump.json
//   node cloudflare/scripts/restore-backup.mjs dump.json > restore.sql
//   wrangler d1 execute seocho-db --remote --file=restore.sql
//
// 그동안 백업은 만들기만 하고 되돌리는 수단이 없었다. 복원해 본 적 없는 백업은 백업이 아니다.
//
// 설계:
//  · 빈 DB 에 붓는 것을 전제로 한다. 표를 먼저 비우고(DELETE) 넣는다 — 반쯤 복원된 상태로
//    끝나면 무엇이 원본인지 알 수 없게 된다.
//  · 외래키 순서 때문에 부모 표부터 넣는다. 그래도 어긋날 수 있으므로 PRAGMA 로 잠시 끈다.
//  · 값은 전부 리터럴로 이스케이프해 넣는다(파라미터 바인딩이 없는 파일 실행이라).
//  · 열 이름을 데이터에서 읽어 쓰므로, 백업 이후 열이 늘어난 스키마에도 그대로 들어간다.
import { readFileSync } from "node:fs";

const [file] = process.argv.slice(2);
if (!file) {
  console.error("사용법: node restore-backup.mjs <복호화된-백업.json> > restore.sql");
  process.exit(1);
}
const dump = JSON.parse(readFileSync(file, "utf8"));
const tables = dump.tables || {};

// 부모 → 자식 순서. 여기 없는 표는 뒤에 원래 순서대로 붙는다.
const ORDER = [
  "associations", "users", "businesses", "settings",
  "media", "products", "coupons", "updates",
  "notices", "events", "polls", "poll_votes", "event_rsvps", "dues",
  "posts", "comments", "post_images",
  "documents", "signature_requests", "external_signers", "signatures",
  "doc_fields", "doc_field_values", "doc_templates", "doc_events",
  "notify_wallet", "credit_ledger", "credit_orders", "message_log",
  "chain_anchor", "api_keys", "notifications", "applications", "application_notes", "audit_log",
];
const names = Object.keys(tables);
const ordered = [...ORDER.filter((t) => names.includes(t)), ...names.filter((t) => !ORDER.includes(t))];

const lit = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Uint8Array || Array.isArray(v)) // D1 BLOB → hex 리터럴
    return "X'" + [...v].map((b) => b.toString(16).padStart(2, "0")).join("") + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
};

const out = [];
out.push(`-- 복원본: ${dump.backed_up_at || "(시각 미상)"} 시점의 백업`);
out.push(`-- 대상 표 ${ordered.length}개 · 총 ${ordered.reduce((n, t) => n + (tables[t]?.length || 0), 0).toLocaleString()}행`);
out.push("PRAGMA defer_foreign_keys = ON;");
// 지우기는 자식부터 (역순)
for (const t of [...ordered].reverse()) if (Array.isArray(tables[t])) out.push(`DELETE FROM ${t};`);

let total = 0;
for (const t of ordered) {
  const rows = tables[t];
  if (!Array.isArray(rows)) { out.push(`-- ${t}: 백업에 없음(건너뜀)`); continue; }
  if (!rows.length) { out.push(`-- ${t}: 0행`); continue; }
  const cols = Object.keys(rows[0]);
  out.push(`-- ${t}: ${rows.length}행`);
  // 한 문장에 너무 많이 넣으면 D1 이 거부한다 — 200행씩 끊는다
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const values = chunk.map((r) => `(${cols.map((c) => lit(r[c])).join(",")})`).join(",\n  ");
    out.push(`INSERT INTO ${t} (${cols.join(",")}) VALUES\n  ${values};`);
  }
  total += rows.length;
}
out.push("PRAGMA defer_foreign_keys = OFF;");
process.stderr.write(`표 ${ordered.length}개 · ${total.toLocaleString()}행 복원 SQL 생성\n`);
process.stdout.write(out.join("\n") + "\n");
