// 초기 데이터(SQL) 생성기 — 슈퍼관리자 + 기본 상인회(서초) + 관리자.
// 비밀번호는 PBKDF2 로 해시해 INSERT 문으로 출력합니다(평문 미포함).
// 사용:
//   SUPER_EMAIL=... SUPER_PASSWORD=... ADMIN_EMAIL=... ADMIN_PASSWORD=... \
//     node cloudflare/scripts/gen-seed-sql.mjs > seed.sql
//   wrangler d1 execute seocho-db --remote --file=seed.sql
import { hashPassword } from "../src/crypto.js";

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const SUPER_EMAIL = process.env.SUPER_EMAIL || "super@platform.kr";
const SUPER_PASSWORD = process.env.SUPER_PASSWORD || "super1234";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@seocho-merchants.kr";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";

const sup = await hashPassword(SUPER_PASSWORD);
const adm = await hashPassword(ADMIN_PASSWORD);

console.log(`-- 초기 데이터 (비밀번호는 PBKDF2 해시)
INSERT INTO associations (slug, name, tagline, brand_color) VALUES ('seocho', '서초구 상인회', '함께 성장하는 서초 상권', '#0b6e4f');
INSERT INTO users (association_id, email, password_hash, salt, name, role) VALUES
  (NULL, ${q(SUPER_EMAIL)}, ${q(sup.hash)}, ${q(sup.salt)}, '플랫폼 운영자', 'SUPERADMIN');
INSERT INTO users (association_id, email, password_hash, salt, name, role) VALUES
  ((SELECT id FROM associations WHERE slug='seocho'), ${q(ADMIN_EMAIL)}, ${q(adm.hash)}, ${q(adm.salt)}, '서초 상인회 관리자', 'ADMIN');`);
