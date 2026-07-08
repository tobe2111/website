// 상인회(테넌트) 관리 + 사이트 복제 기능
import { db } from "./db.js";
import { createUser } from "./auth.js";
import { slugify } from "./http.js";

export function getAssociationBySlug(slug) {
  return db.prepare("SELECT * FROM associations WHERE slug = ?").get(slug);
}
export function getAssociationById(id) {
  return db.prepare("SELECT * FROM associations WHERE id = ?").get(id);
}
export function listAssociations() {
  return db
    .prepare(
      `SELECT a.*,
        (SELECT COUNT(*) FROM businesses b WHERE b.association_id = a.id AND b.status='approved') AS biz_count,
        (SELECT COUNT(*) FROM users u WHERE u.association_id = a.id) AS user_count
       FROM associations a ORDER BY a.created_at DESC`
    )
    .all();
}
export function listActiveAssociations() {
  return db
    .prepare(
      `SELECT a.*,
        (SELECT COUNT(*) FROM businesses b WHERE b.association_id = a.id AND b.status='approved') AS biz_count
       FROM associations a WHERE a.active = 1 ORDER BY a.name ASC`
    )
    .all();
}

export function uniqueAssocSlug(name) {
  let base = slugify(name);
  let slug = base;
  let n = 1;
  while (db.prepare("SELECT id FROM associations WHERE slug = ?").get(slug)) {
    slug = `${base}-${++n}`;
  }
  return slug;
}

export function updateAssociation(id, fields) {
  const a = getAssociationById(id);
  if (!a) return null;
  const next = {
    name: fields.name ?? a.name,
    tagline: fields.tagline ?? a.tagline,
    brand_color: fields.brand_color ?? a.brand_color,
    phone: fields.phone ?? a.phone,
    address: fields.address ?? a.address,
    email: fields.email ?? a.email,
    logo: fields.logo ?? a.logo,
    active: fields.active ?? a.active,
  };
  db.prepare(
    "UPDATE associations SET name=?, tagline=?, brand_color=?, phone=?, address=?, email=?, logo=?, active=? WHERE id=?"
  ).run(next.name, next.tagline, next.brand_color, next.phone, next.address, next.email, next.logo, next.active, id);
  return getAssociationById(id);
}

export function setLogo(id, logoKey) {
  db.prepare("UPDATE associations SET logo = ? WHERE id = ?").run(logoKey || "", id);
  return getAssociationById(id);
}

export function setActive(id, active) {
  db.prepare("UPDATE associations SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
  return getAssociationById(id);
}

// 홈페이지 구성 저장/초기화
export function saveHomeLayout(id, layoutArray) {
  db.prepare("UPDATE associations SET home_layout = ? WHERE id = ?").run(JSON.stringify(layoutArray), id);
  return getAssociationById(id);
}
export function resetHomeLayout(id) {
  db.prepare("UPDATE associations SET home_layout = NULL WHERE id = ?").run(id);
  return getAssociationById(id);
}

// ----- 사이트 복제: 새 상인회 + 초기 관리자 계정 생성 -----
// 슈퍼관리자만 호출. 새 상인회 구조를 그대로 "복사"해 발급합니다.
export function provisionAssociation({ name, slug: wantSlug, brandColor, tagline, adminName, adminEmail, adminPassword, seedSamples = true }) {
  const slug = wantSlug && !getAssociationBySlug(wantSlug) ? wantSlug : uniqueAssocSlug(name);
  const info = db
    .prepare(
      "INSERT INTO associations (slug, name, tagline, brand_color) VALUES (?, ?, ?, ?)"
    )
    .run(name.trim(), "PLACEHOLDER", "", "#0b6e4f");
  // 위 run 은 컬럼 순서 문제를 피하려 아래에서 정식 값으로 갱신
  const id = info.lastInsertRowid;
  db.prepare("UPDATE associations SET slug=?, name=?, tagline=?, brand_color=? WHERE id=?").run(
    slug,
    name.trim(),
    tagline || "함께 성장하는 우리 동네 상권",
    brandColor || "#0b6e4f",
    id
  );

  // 이 상인회의 관리자(ADMIN) 계정 생성
  const admin = createUser({
    email: adminEmail,
    password: adminPassword,
    name: adminName || `${name} 관리자`,
    role: "ADMIN",
    associationId: id,
  });

  if (seedSamples) seedStarterContent(id, name);

  return { association: getAssociationById(id), admin };
}

// 신규 상인회에 기본 공지/행사 샘플을 넣어 빈 화면을 방지
function seedStarterContent(associationId, name) {
  db.prepare(
    "INSERT INTO notices (association_id, title, body, tag, pinned) VALUES (?, ?, ?, ?, 1)"
  ).run(
    associationId,
    `${name} 홈페이지가 열렸습니다`,
    "상인회 관리자 페이지에서 공지, 행사, 업체 승인을 관리할 수 있습니다. 이 공지는 예시이며 삭제하셔도 됩니다.",
    "안내"
  );
  db.prepare(
    "INSERT INTO events (association_id, title, event_date, place, description) VALUES (?, ?, ?, ?, ?)"
  ).run(
    associationId,
    "첫 정기 모임",
    "2026-12-01",
    "상인회관",
    "회원 상견례 및 사업 계획 공유 (예시 행사입니다)."
  );
}
