// 도메인 데이터 접근 (모든 쿼리는 상인회(association) 로 스코프)
import { db } from "./db.js";
import { slugify } from "./http.js";

// ----- Businesses -----
export function getBusinessByOwner(ownerId) {
  return db.prepare("SELECT * FROM businesses WHERE owner_id = ?").get(ownerId);
}
export function getBusinessBySlug(associationId, slug) {
  return db
    .prepare("SELECT * FROM businesses WHERE association_id = ? AND slug = ?")
    .get(associationId, slug);
}
export function getBusinessById(id) {
  return db.prepare("SELECT * FROM businesses WHERE id = ?").get(id);
}
export function uniqueSlug(associationId, name, excludeId = null) {
  const base = slugify(name);
  let slug = base;
  let n = 1;
  while (true) {
    const row = db
      .prepare("SELECT id FROM businesses WHERE association_id = ? AND slug = ?")
      .get(associationId, slug);
    if (!row || row.id === excludeId) return slug;
    slug = `${base}-${++n}`;
  }
}
export function createBusiness({ associationId, ownerId, name, category }) {
  const slug = uniqueSlug(associationId, name);
  const info = db
    .prepare(
      "INSERT INTO businesses (association_id, owner_id, name, slug, category) VALUES (?, ?, ?, ?, ?)"
    )
    .run(associationId, ownerId, name.trim(), slug, category || "기타");
  return getBusinessById(info.lastInsertRowid);
}
export function updateBusiness(id, fields) {
  const b = getBusinessById(id);
  if (!b) return null;
  const n = {
    name: fields.name ?? b.name,
    category: fields.category ?? b.category,
    description: fields.description ?? b.description,
    phone: fields.phone ?? b.phone,
    address: fields.address ?? b.address,
    hours: fields.hours ?? b.hours,
    lat: fields.lat !== undefined ? fields.lat : b.lat,
    lng: fields.lng !== undefined ? fields.lng : b.lng,
  };
  db.prepare(
    "UPDATE businesses SET name=?, category=?, description=?, phone=?, address=?, hours=?, lat=?, lng=? WHERE id=?"
  ).run(n.name, n.category, n.description, n.phone, n.address, n.hours, n.lat, n.lng, id);
  return getBusinessById(id);
}

// 지도 마커 (좌표가 있는 승인 업체)
export function listBusinessMarkers(associationId) {
  return db
    .prepare(`SELECT id, name, slug, category, lat, lng, address, phone FROM businesses
              WHERE association_id = ? AND status = 'approved' AND lat IS NOT NULL AND lng IS NOT NULL`)
    .all(associationId);
}
export function setBusinessStatus(id, status) {
  db.prepare("UPDATE businesses SET status = ? WHERE id = ?").run(status, id);
  return getBusinessById(id);
}
export function listBusinesses(associationId, { status = "approved", category = null } = {}) {
  let sql = "SELECT * FROM businesses WHERE association_id = ? AND status = ?";
  const args = [associationId, status];
  if (category) {
    sql += " AND category = ?";
    args.push(category);
  }
  sql += " ORDER BY created_at DESC";
  return db.prepare(sql).all(...args);
}
// 검색 + 페이지네이션 (LIKE 와일드카드 이스케이프 포함)
function bizWhere(associationId, { status = "approved", category = null, q = null }) {
  let sql = " WHERE association_id = ? AND status = ?";
  const args = [associationId, status];
  if (category) { sql += " AND category = ?"; args.push(category); }
  if (q) {
    const like = "%" + String(q).replace(/[%_\\]/g, (c) => "\\" + c) + "%";
    sql += " AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')";
    args.push(like, like, like);
  }
  return { sql, args };
}
export function listBusinessesPaged(associationId, { status = "approved", category = null, q = null, page = 1, perPage = 12 } = {}) {
  const { sql, args } = bizWhere(associationId, { status, category, q });
  const total = db.prepare("SELECT COUNT(*) AS n FROM businesses" + sql).get(...args).n;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page | 0 || 1), pages);
  const items = db.prepare("SELECT * FROM businesses" + sql + " ORDER BY created_at DESC LIMIT ? OFFSET ?").all(...args, perPage, (p - 1) * perPage);
  return { items, total, page: p, pages, perPage };
}
export function listNoticesPaged(associationId, { page = 1, perPage = 20 } = {}) {
  const total = db.prepare("SELECT COUNT(*) AS n FROM notices WHERE association_id = ?").get(associationId).n;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page | 0 || 1), pages);
  const items = db.prepare("SELECT * FROM notices WHERE association_id = ? ORDER BY pinned DESC, created_at DESC LIMIT ? OFFSET ?").all(associationId, perPage, (p - 1) * perPage);
  return { items, total, page: p, pages, perPage };
}

export function listAllBusinesses(associationId) {
  return db
    .prepare(
      `SELECT b.*, u.email AS owner_email, u.name AS owner_name
       FROM businesses b JOIN users u ON u.id = b.owner_id
       WHERE b.association_id = ?
       ORDER BY CASE b.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, b.created_at DESC`
    )
    .all(associationId);
}
export function distinctCategories(associationId) {
  return db
    .prepare(
      "SELECT category, COUNT(*) AS n FROM businesses WHERE association_id = ? AND status='approved' GROUP BY category ORDER BY n DESC"
    )
    .all(associationId);
}

// ----- Media -----
export function listMedia(businessId) {
  return db.prepare("SELECT * FROM media WHERE business_id = ? ORDER BY created_at DESC").all(businessId);
}
export function addMedia({ businessId, kind, filename, poster = "", originalName, size, caption = "" }) {
  const info = db
    .prepare(
      "INSERT INTO media (business_id, kind, filename, poster, original_name, size, caption) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(businessId, kind, filename, poster, originalName, size, caption);
  return db.prepare("SELECT * FROM media WHERE id = ?").get(info.lastInsertRowid);
}
export function getMedia(id) {
  return db.prepare("SELECT * FROM media WHERE id = ?").get(id);
}
export function deleteMedia(id) {
  db.prepare("DELETE FROM media WHERE id = ?").run(id);
}

// ----- Notices -----
export function listNotices(associationId, limit = null) {
  let sql = "SELECT * FROM notices WHERE association_id = ? ORDER BY pinned DESC, created_at DESC";
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  return db.prepare(sql).all(associationId);
}
export function getNotice(id) {
  return db.prepare("SELECT * FROM notices WHERE id = ?").get(id);
}
export function createNotice({ associationId, title, body, tag, pinned }) {
  const info = db
    .prepare("INSERT INTO notices (association_id, title, body, tag, pinned) VALUES (?, ?, ?, ?, ?)")
    .run(associationId, title, body || "", tag || "안내", pinned ? 1 : 0);
  return getNotice(info.lastInsertRowid);
}
export function deleteNotice(id) {
  db.prepare("DELETE FROM notices WHERE id = ?").run(id);
}

// ----- Events -----
export function listEvents(associationId, upcomingOnly = false) {
  if (upcomingOnly) {
    return db
      .prepare("SELECT * FROM events WHERE association_id = ? AND event_date >= date('now') ORDER BY event_date ASC")
      .all(associationId);
  }
  return db.prepare("SELECT * FROM events WHERE association_id = ? ORDER BY event_date DESC").all(associationId);
}
export function getEvent(id) {
  return db.prepare("SELECT * FROM events WHERE id = ?").get(id);
}
export function createEvent({ associationId, title, event_date, place, description }) {
  const info = db
    .prepare("INSERT INTO events (association_id, title, event_date, place, description) VALUES (?, ?, ?, ?, ?)")
    .run(associationId, title, event_date, place || "", description || "");
  return getEvent(info.lastInsertRowid);
}
export function deleteEvent(id) {
  db.prepare("DELETE FROM events WHERE id = ?").run(id);
}

// ----- Notifications (앱 내 알림 — 이메일 대체) -----
export function createNotification({ associationId = null, kind, message, link = "" }) {
  const info = db
    .prepare("INSERT INTO notifications (association_id, kind, message, link) VALUES (?, ?, ?, ?)")
    .run(associationId, kind, message, link);
  return db.prepare("SELECT * FROM notifications WHERE id = ?").get(info.lastInsertRowid);
}
export function listNotifications(associationId, { limit = 20 } = {}) {
  return db
    .prepare("SELECT * FROM notifications WHERE association_id = ? ORDER BY is_read ASC, created_at DESC LIMIT ?")
    .all(associationId, limit);
}
export function listAllNotifications({ limit = 30 } = {}) {
  return db
    .prepare(`SELECT n.*, a.name AS assoc_name FROM notifications n
              LEFT JOIN associations a ON a.id = n.association_id
              ORDER BY n.is_read ASC, n.created_at DESC LIMIT ?`)
    .all(limit);
}
export function unreadCount(associationId) {
  return db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE association_id = ? AND is_read = 0").get(associationId).n;
}
export function unreadCountAll() {
  return db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE is_read = 0").get().n;
}
export function markNotificationRead(id, associationId) {
  // associationId 가 주어지면 소속 확인(테넌트 격리)
  if (associationId != null) db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND association_id = ?").run(id, associationId);
  else db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(id);
}
export function markAllNotificationsRead(associationId) {
  if (associationId != null) db.prepare("UPDATE notifications SET is_read = 1 WHERE association_id = ?").run(associationId);
  else db.prepare("UPDATE notifications SET is_read = 1").run();
}

// ----- 사용자 목록 (비밀번호 재설정 등 관리용) -----
export function listUsersByAssociation(associationId, role = null) {
  let sql = `SELECT u.id, u.email, u.name, u.role, b.name AS business_name
             FROM users u LEFT JOIN businesses b ON b.owner_id = u.id
             WHERE u.association_id = ?`;
  const args = [associationId];
  if (role) { sql += " AND u.role = ?"; args.push(role); }
  sql += " ORDER BY u.role, u.created_at DESC";
  return db.prepare(sql).all(...args);
}
export function listAdmins() {
  return db.prepare(`SELECT u.id, u.email, u.name, u.association_id, a.name AS assoc_name
                     FROM users u JOIN associations a ON a.id = u.association_id
                     WHERE u.role = 'ADMIN' ORDER BY a.name`).all();
}

// ----- 전자서명: 문서 -----
export function createDocument({ associationId, title, body, contentHash, createdBy }) {
  const info = db
    .prepare("INSERT INTO documents (association_id, title, body, content_hash, created_by) VALUES (?, ?, ?, ?, ?)")
    .run(associationId, title, body, contentHash, createdBy);
  return getDocument(info.lastInsertRowid);
}
export function getDocument(id) {
  return db.prepare("SELECT * FROM documents WHERE id = ?").get(id);
}
export function listDocuments(associationId) {
  return db
    .prepare(`SELECT d.*, (SELECT COUNT(*) FROM signatures s WHERE s.document_id = d.id) AS sign_count
              FROM documents d WHERE d.association_id = ? ORDER BY d.created_at DESC`)
    .all(associationId);
}
export function listDocumentsToSign(associationId, userId) {
  return db
    .prepare(`SELECT d.* FROM documents d
              WHERE d.association_id = ? AND d.closed = 0
                AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.document_id = d.id AND s.user_id = ?)
              ORDER BY d.created_at DESC`)
    .all(associationId, userId);
}
export function countDocumentsToSign(associationId, userId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM documents d
    WHERE d.association_id = ? AND d.closed = 0
      AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.document_id = d.id AND s.user_id = ?)`).get(associationId, userId).n;
}
export function closeDocument(id) {
  db.prepare("UPDATE documents SET closed = 1 WHERE id = ?").run(id);
}

// ----- 전자서명: 서명 기록 -----
export function hasSigned(documentId, userId) {
  return !!db.prepare("SELECT 1 FROM signatures WHERE document_id = ? AND user_id = ?").get(documentId, userId);
}
export function createSignature(row) {
  const info = db.prepare(`INSERT INTO signatures
    (document_id, user_id, signer_name, signature_image, content_hash, ip, user_agent, verify_code, record_hash, signed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    row.documentId, row.userId, row.signerName, row.signatureImage, row.contentHash,
    row.ip, row.userAgent, row.verifyCode, row.recordHash, row.signedAt);
  return db.prepare("SELECT * FROM signatures WHERE id = ?").get(info.lastInsertRowid);
}
export function listSignatures(documentId) {
  return db.prepare(`SELECT s.*, u.email AS signer_email FROM signatures s
    JOIN users u ON u.id = s.user_id WHERE s.document_id = ? ORDER BY s.signed_at DESC`).all(documentId);
}
export function getSignatureByCode(code) {
  return db.prepare("SELECT * FROM signatures WHERE verify_code = ?").get(code);
}

// ----- 통계 -----
export function stats(associationId) {
  const q = (sql) => db.prepare(sql).get(associationId).n;
  return {
    businesses: q("SELECT COUNT(*) AS n FROM businesses WHERE association_id = ? AND status='approved'"),
    pending: q("SELECT COUNT(*) AS n FROM businesses WHERE association_id = ? AND status='pending'"),
    events: q("SELECT COUNT(*) AS n FROM events WHERE association_id = ?"),
    notices: q("SELECT COUNT(*) AS n FROM notices WHERE association_id = ?"),
    mediaCount: db
      .prepare(
        "SELECT COUNT(*) AS n FROM media m JOIN businesses b ON b.id = m.business_id WHERE b.association_id = ?"
      )
      .get(associationId).n,
  };
}

// 플랫폼 전체 통계 (슈퍼관리자)
export function platformStats() {
  const one = (sql) => db.prepare(sql).get().n;
  return {
    associations: one("SELECT COUNT(*) AS n FROM associations"),
    activeAssociations: one("SELECT COUNT(*) AS n FROM associations WHERE active=1"),
    businesses: one("SELECT COUNT(*) AS n FROM businesses WHERE status='approved'"),
    users: one("SELECT COUNT(*) AS n FROM users"),
    media: one("SELECT COUNT(*) AS n FROM media"),
  };
}
