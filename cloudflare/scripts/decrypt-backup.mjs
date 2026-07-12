// 백업 복호화: node cloudflare/scripts/decrypt-backup.mjs backup-2026-07-12.json.enc "<SESSION_SECRET>"
// (R2 대시보드에서 backups/ 아래 파일을 내려받은 뒤 실행. 결과는 stdout → 파일로 저장해 사용)
import { readFileSync } from "node:fs";

const [file, secret] = process.argv.slice(2);
if (!file || !secret) {
  console.error('사용법: node decrypt-backup.mjs <백업파일.enc> "<SESSION_SECRET>"');
  process.exit(1);
}
const buf = new Uint8Array(readFileSync(file));
const keyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("backup|" + secret));
const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
process.stdout.write(new TextDecoder().decode(pt));
