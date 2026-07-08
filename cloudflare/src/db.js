// D1(비동기) 데이터 접근 계층. 모든 함수는 D1 바인딩(db)을 첫 인자로 받습니다.
import { slugify, likeParam } from "./util.js";

// ----- D1 헬퍼 -----
export function first(db, sql, ...a) { return db.prepare(sql).bind(...a).first(); }
export async function all(db, sql, ...a) { return (await db.prepare(sql).bind(...a).all()).results || []; }
export function run(db, sql, ...a) { return db.prepare(sql).bind(...a).run(); }
async function lastId(db) { return (await first(db, "SELECT last_insert_rowid() AS id")).id; }

// ----- Associations -----
export const getAssociationBySlug = (db, slug) => first(db, "SELECT * FROM associations WHERE slug = ?", slug);
export const getAssociationById = (db, id) => first(db, "SELECT * FROM associations WHERE id = ?", id);
export const listActiveAssociations = (db) => all(db, "SELECT * FROM associations WHERE active = 1 ORDER BY name");
export const listAllAssociations = (db) => all(db, "SELECT * FROM associations ORDER BY created_at DESC");
export async function createAssociation(db, { slug, name, brandColor = "#0b6e4f", tagline = "함께 성장하는 우리 동네 상권" }) {
  await run(db, "INSERT INTO associations (slug, name, brand_color, tagline) VALUES (?, ?, ?, ?)", slug, name, brandColor, tagline);
  return getAssociationById(db, await lastId(db));
}
export function updateAssociation(db, id, f) {
  return run(db, `UPDATE associations SET name=?, tagline=?, brand_color=?, phone=?, email=?, address=?, logo=? WHERE id=?`,
    f.name, f.tagline, f.brand_color, f.phone, f.email, f.address, f.logo, id);
}
export const setAssociationActive = (db, id, a) => run(db, "UPDATE associations SET active=? WHERE id=?", a ? 1 : 0, id);
export const saveHomeLayout = (db, id, json) => run(db, "UPDATE associations SET home_layout=? WHERE id=?", json, id);

// ----- Users -----
export const getUserByEmail = (db, email) => first(db, "SELECT * FROM users WHERE email = ?", email);
export const getUserById = (db, id) => first(db, "SELECT * FROM users WHERE id = ?", id);
export async function createUser(db, { email, passwordHash, salt, name, role = "MERCHANT", associationId = null }) {
  await run(db, "INSERT INTO users (association_id, email, password_hash, salt, name, role) VALUES (?, ?, ?, ?, ?, ?)",
    associationId, email, passwordHash, salt, name, role);
  return getUserById(db, await lastId(db));
}
export const updateUserPassword = (db, id, hash, salt) =>
  run(db, "UPDATE users SET password_hash=?, salt=?, session_version = session_version + 1 WHERE id=?", hash, salt, id);
export const bumpSessionVersion = (db, id) => run(db, "UPDATE users SET session_version = session_version + 1 WHERE id=?", id);
export function listUsersByAssociation(db, associationId, role = null) {
  const sql = `SELECT u.id, u.email, u.name, u.role, b.name AS business_name
    FROM users u LEFT JOIN businesses b ON b.owner_id = u.id
    WHERE u.association_id = ?` + (role ? " AND u.role = ?" : "") + " ORDER BY u.role, u.created_at DESC";
  return role ? all(db, sql, associationId, role) : all(db, sql, associationId);
}

// ----- Businesses -----
export const getBusinessByOwner = (db, ownerId) => first(db, "SELECT * FROM businesses WHERE owner_id = ?", ownerId);
export const getBusinessBySlug = (db, aid, slug) => first(db, "SELECT * FROM businesses WHERE association_id = ? AND slug = ?", aid, slug);
export const getBusinessById = (db, id) => first(db, "SELECT * FROM businesses WHERE id = ?", id);
export async function uniqueSlug(db, aid, name) {
  const base = slugify(name);
  let slug = base, n = 1;
  while (await first(db, "SELECT id FROM businesses WHERE association_id = ? AND slug = ?", aid, slug)) slug = `${base}-${++n}`;
  return slug;
}
export async function createBusiness(db, { associationId, ownerId, name, category }) {
  const slug = await uniqueSlug(db, associationId, name);
  await run(db, "INSERT INTO businesses (association_id, owner_id, name, slug, category) VALUES (?, ?, ?, ?, ?)",
    associationId, ownerId, name.trim(), slug, category || "기타");
  return getBusinessById(db, await lastId(db));
}
export function updateBusiness(db, id, f) {
  return run(db, "UPDATE businesses SET name=?, category=?, description=?, phone=?, address=?, hours=?, lat=?, lng=? WHERE id=?",
    f.name, f.category, f.description, f.phone, f.address, f.hours, f.lat ?? null, f.lng ?? null, id);
}
export const setBusinessStatus = (db, id, status) => run(db, "UPDATE businesses SET status=? WHERE id=?", status, id);
export const listBusinessMarkers = (db, aid) =>
  all(db, `SELECT id, name, slug, category, lat, lng, address, phone FROM businesses
           WHERE association_id = ? AND status='approved' AND lat IS NOT NULL AND lng IS NOT NULL`, aid);
export const distinctCategories = (db, aid) =>
  all(db, "SELECT category, COUNT(*) AS n FROM businesses WHERE association_id=? AND status='approved' GROUP BY category ORDER BY n DESC", aid);
export const listAllBusinesses = (db, aid) =>
  all(db, `SELECT b.*, u.email AS owner_email, u.name AS owner_name FROM businesses b JOIN users u ON u.id=b.owner_id
           WHERE b.association_id=? ORDER BY CASE b.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, b.created_at DESC`, aid);

function bizWhere(aid, { status = "approved", category = null, q = null }) {
  let sql = " WHERE association_id = ? AND status = ?"; const args = [aid, status];
  if (category) { sql += " AND category = ?"; args.push(category); }
  if (q) { const l = likeParam(q); sql += " AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')"; args.push(l, l, l); }
  return { sql, args };
}
export async function listBusinessesPaged(db, aid, { status = "approved", category = null, q = null, page = 1, perPage = 12 } = {}) {
  const { sql, args } = bizWhere(aid, { status, category, q });
  const total = (await first(db, "SELECT COUNT(*) AS n FROM businesses" + sql, ...args)).n;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page | 0 || 1), pages);
  const items = await all(db, "SELECT * FROM businesses" + sql + " ORDER BY created_at DESC LIMIT ? OFFSET ?", ...args, perPage, (p - 1) * perPage);
  return { items, total, page: p, pages };
}

// ----- Media -----
export const listMedia = (db, businessId) => all(db, "SELECT * FROM media WHERE business_id = ? ORDER BY created_at DESC", businessId);
export const getCoverImage = (db, businessId) =>
  first(db, "SELECT filename, thumb FROM media WHERE business_id=? AND kind='image' ORDER BY created_at DESC LIMIT 1", businessId);
export const getMedia = (db, id) => first(db, "SELECT * FROM media WHERE id = ?", id);
export const deleteMedia = (db, id) => run(db, "DELETE FROM media WHERE id = ?", id);
export const countEmbeds = async (db, businessId) => (await first(db, "SELECT COUNT(*) AS n FROM media WHERE business_id=? AND kind='embed'", businessId)).n;
export async function addMedia(db, { businessId, kind, filename = "", poster = "", thumb = "", provider = "", embedId = "", originalName = "", size = 0, caption = "" }) {
  await run(db, "INSERT INTO media (business_id, kind, filename, poster, thumb, provider, embed_id, original_name, size, caption) VALUES (?,?,?,?,?,?,?,?,?,?)",
    businessId, kind, filename, poster, thumb, provider, embedId, originalName, size, caption);
  return getMedia(db, await lastId(db));
}

// ----- Stats -----
export async function stats(db, aid) {
  const q = async (sql) => (await first(db, sql, aid)).n;
  return {
    businesses: await q("SELECT COUNT(*) AS n FROM businesses WHERE association_id=? AND status='approved'"),
    pending: await q("SELECT COUNT(*) AS n FROM businesses WHERE association_id=? AND status='pending'"),
    events: await q("SELECT COUNT(*) AS n FROM events WHERE association_id=?"),
    notices: await q("SELECT COUNT(*) AS n FROM notices WHERE association_id=?"),
    mediaCount: (await first(db, "SELECT COUNT(*) AS n FROM media m JOIN businesses b ON b.id=m.business_id WHERE b.association_id=?", aid)).n,
  };
}
