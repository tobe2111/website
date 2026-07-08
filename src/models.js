// 도메인 데이터 접근 (쿼리 헬퍼)
import { db } from "./db.js";
import { slugify } from "./http.js";

// ----- Businesses -----
export function getBusinessByOwner(ownerId) {
  return db.prepare("SELECT * FROM businesses WHERE owner_id = ?").get(ownerId);
}

export function getBusinessBySlug(slug) {
  return db.prepare("SELECT * FROM businesses WHERE slug = ?").get(slug);
}

export function getBusinessById(id) {
  return db.prepare("SELECT * FROM businesses WHERE id = ?").get(id);
}

export function uniqueSlug(name, excludeId = null) {
  let base = slugify(name);
  let slug = base;
  let n = 1;
  while (true) {
    const row = db.prepare("SELECT id FROM businesses WHERE slug = ?").get(slug);
    if (!row || row.id === excludeId) return slug;
    slug = `${base}-${++n}`;
  }
}

export function createBusiness({ ownerId, name, category }) {
  const slug = uniqueSlug(name);
  const info = db
    .prepare(
      "INSERT INTO businesses (owner_id, name, slug, category) VALUES (?, ?, ?, ?)"
    )
    .run(ownerId, name.trim(), slug, category || "기타");
  return getBusinessById(info.lastInsertRowid);
}

export function updateBusiness(id, fields) {
  const b = getBusinessById(id);
  if (!b) return null;
  const next = {
    name: fields.name ?? b.name,
    category: fields.category ?? b.category,
    description: fields.description ?? b.description,
    phone: fields.phone ?? b.phone,
    address: fields.address ?? b.address,
    hours: fields.hours ?? b.hours,
  };
  db.prepare(
    "UPDATE businesses SET name=?, category=?, description=?, phone=?, address=?, hours=? WHERE id=?"
  ).run(next.name, next.category, next.description, next.phone, next.address, next.hours, id);
  return getBusinessById(id);
}

export function setBusinessStatus(id, status) {
  db.prepare("UPDATE businesses SET status = ? WHERE id = ?").run(status, id);
  return getBusinessById(id);
}

export function listBusinesses({ status = "approved", category = null } = {}) {
  let sql = "SELECT * FROM businesses WHERE status = ?";
  const args = [status];
  if (category) {
    sql += " AND category = ?";
    args.push(category);
  }
  sql += " ORDER BY created_at DESC";
  return db.prepare(sql).all(...args);
}

export function listAllBusinesses() {
  return db
    .prepare(
      `SELECT b.*, u.email AS owner_email, u.name AS owner_name
       FROM businesses b JOIN users u ON u.id = b.owner_id
       ORDER BY CASE b.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, b.created_at DESC`
    )
    .all();
}

export function distinctCategories() {
  return db
    .prepare(
      "SELECT category, COUNT(*) AS n FROM businesses WHERE status='approved' GROUP BY category ORDER BY n DESC"
    )
    .all();
}

// ----- Media -----
export function listMedia(businessId) {
  return db
    .prepare("SELECT * FROM media WHERE business_id = ? ORDER BY created_at DESC")
    .all(businessId);
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
export function listNotices(limit = null) {
  let sql = "SELECT * FROM notices ORDER BY pinned DESC, created_at DESC";
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  return db.prepare(sql).all();
}
export function getNotice(id) {
  return db.prepare("SELECT * FROM notices WHERE id = ?").get(id);
}
export function createNotice({ title, body, tag, pinned }) {
  const info = db
    .prepare("INSERT INTO notices (title, body, tag, pinned) VALUES (?, ?, ?, ?)")
    .run(title, body || "", tag || "안내", pinned ? 1 : 0);
  return getNotice(info.lastInsertRowid);
}
export function deleteNotice(id) {
  db.prepare("DELETE FROM notices WHERE id = ?").run(id);
}

// ----- Events -----
export function listEvents(upcomingOnly = false) {
  if (upcomingOnly) {
    return db
      .prepare("SELECT * FROM events WHERE event_date >= date('now') ORDER BY event_date ASC")
      .all();
  }
  return db.prepare("SELECT * FROM events ORDER BY event_date DESC").all();
}
export function getEvent(id) {
  return db.prepare("SELECT * FROM events WHERE id = ?").get(id);
}
export function createEvent({ title, event_date, place, description }) {
  const info = db
    .prepare("INSERT INTO events (title, event_date, place, description) VALUES (?, ?, ?, ?)")
    .run(title, event_date, place || "", description || "");
  return getEvent(info.lastInsertRowid);
}
export function deleteEvent(id) {
  db.prepare("DELETE FROM events WHERE id = ?").run(id);
}

// ----- 통계 (홈/관리자) -----
export function stats() {
  const businesses = db.prepare("SELECT COUNT(*) AS n FROM businesses WHERE status='approved'").get().n;
  const pending = db.prepare("SELECT COUNT(*) AS n FROM businesses WHERE status='pending'").get().n;
  const events = db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
  const notices = db.prepare("SELECT COUNT(*) AS n FROM notices").get().n;
  const mediaCount = db.prepare("SELECT COUNT(*) AS n FROM media").get().n;
  return { businesses, pending, events, notices, mediaCount };
}
