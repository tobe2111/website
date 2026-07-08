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
  };
  db.prepare(
    "UPDATE businesses SET name=?, category=?, description=?, phone=?, address=?, hours=? WHERE id=?"
  ).run(n.name, n.category, n.description, n.phone, n.address, n.hours, id);
  return getBusinessById(id);
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
export function addMedia({ businessId, kind, filename, originalName, size, caption = "" }) {
  const info = db
    .prepare(
      "INSERT INTO media (business_id, kind, filename, original_name, size, caption) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(businessId, kind, filename, originalName, size, caption);
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
