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
export async function createAssociation(db, { slug, name, brandColor = "#0b8a46", tagline = "함께 성장하는 우리 동네 상권" }) {
  await run(db, "INSERT INTO associations (slug, name, brand_color, tagline) VALUES (?, ?, ?, ?)", slug, name, brandColor, tagline);
  return getAssociationById(db, await lastId(db));
}
export function updateAssociation(db, id, f) {
  return run(db, `UPDATE associations SET name=?, tagline=?, brand_color=?, phone=?, email=?, address=?, logo=?, hero_image=?, naver_verification=?, google_verification=? WHERE id=?`,
    f.name, f.tagline, f.brand_color, f.phone, f.email, f.address, f.logo, f.hero_image || "", f.naver_verification || "", f.google_verification || "", id);
}
export const setAssociationActive = (db, id, a) => run(db, "UPDATE associations SET active=? WHERE id=?", a ? 1 : 0, id);
export const getAssociationByDomain = (db, host) => first(db, "SELECT * FROM associations WHERE custom_domain = ? AND custom_domain != ''", String(host || "").toLowerCase());
export const setAssociationDomain = (db, id, domain) => run(db, "UPDATE associations SET custom_domain=? WHERE id=?", domain || "", id);
export const setAssociationMapKey = (db, id, key) => run(db, "UPDATE associations SET map_client_id=? WHERE id=?", key || "", id);
export const setAssociationPlan = (db, id, plan) => run(db, "UPDATE associations SET plan=? WHERE id=?", plan, id);
export const countMembers = async (db, aid) => (await first(db, "SELECT COUNT(*) AS n FROM users WHERE association_id=? AND role='MERCHANT'", aid)).n;
export const countBusinessImages = async (db, businessId) => (await first(db, "SELECT COUNT(*) AS n FROM media WHERE business_id=? AND kind='image'", businessId)).n;

// ----- 셀프 입점 신청 -----
export async function createApplication(db, { assocName, contactName, contactEmail, contactPhone, message }) {
  await run(db, "INSERT INTO applications (assoc_name, contact_name, contact_email, contact_phone, message) VALUES (?,?,?,?,?)",
    assocName, contactName || "", contactEmail, contactPhone || "", message || "");
  return first(db, "SELECT * FROM applications WHERE id=?", await lastId(db));
}
export const getApplication = (db, id) => first(db, "SELECT * FROM applications WHERE id=?", id);
export const listApplications = (db, status = null) => status
  ? all(db, "SELECT * FROM applications WHERE status=? ORDER BY created_at DESC", status)
  : all(db, "SELECT * FROM applications ORDER BY created_at DESC");
export const countPendingApplications = async (db) => (await first(db, "SELECT COUNT(*) AS n FROM applications WHERE status='pending'")).n;
export const setApplicationStatus = (db, id, status) => run(db, "UPDATE applications SET status=? WHERE id=?", status, id);
// 영업 파이프라인 — 단계·다음 연락일·메모
export const setApplicationStage = (db, id, stage, nextActionAt) =>
  run(db, "UPDATE applications SET stage=?, next_action_at=? WHERE id=?", stage, nextActionAt || "", id);
export async function createProspect(db, { assocName, contactName, contactEmail, contactPhone, message }) {
  await run(db, `INSERT INTO applications (assoc_name, contact_name, contact_email, contact_phone, message, source)
    VALUES (?,?,?,?,?, 'direct')`, assocName, contactName || "", contactEmail || "", contactPhone || "", message || "");
  return first(db, "SELECT * FROM applications WHERE id=?", await lastId(db));
}
export const addApplicationNote = (db, { applicationId, actorName, body }) =>
  run(db, "INSERT INTO application_notes (application_id, actor_name, body) VALUES (?,?,?)", applicationId, actorName || "", body);
// 대기 중인 건들의 메모를 한 번에 (건별 조회로 N+1 내지 않도록)
export const listApplicationNotes = (db) =>
  all(db, `SELECT n.* FROM application_notes n JOIN applications a ON a.id=n.application_id
    WHERE a.status='pending' ORDER BY n.created_at DESC, n.id DESC`);
export const saveHomeLayout = (db, id, json) => run(db, "UPDATE associations SET home_layout=? WHERE id=?", json, id);

// ----- Settings (자동 생성 키·설정 저장) -----
export const getSetting = async (db, key) => { const r = await first(db, "SELECT value FROM settings WHERE key=?", key); return r ? r.value : null; };
export const setSetting = (db, key, value) => run(db, "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, value);

// ----- Users -----
export const countUsers = async (db) => (await first(db, "SELECT COUNT(*) AS n FROM users")).n;
export const getUserByEmail = (db, email) => first(db, "SELECT * FROM users WHERE email = ?", email);
export const getUserById = (db, id) => first(db, "SELECT * FROM users WHERE id = ?", id);
export async function createUser(db, { email, passwordHash, salt, name, role = "MERCHANT", associationId = null, phone = "" }) {
  await run(db, "INSERT INTO users (association_id, email, password_hash, salt, name, role, phone) VALUES (?, ?, ?, ?, ?, ?, ?)",
    associationId, email, passwordHash, salt, name, role, normalizePhone(phone));
  return getUserById(db, await lastId(db));
}
// 휴대폰: 숫자만 남겨 저장(하이픈·공백 제거). 010으로 시작하는 10~11자리만 유효로 본다.
export const normalizePhone = (p) => String(p || "").replace(/\D/g, "").slice(0, 11);
export const isValidPhone = (p) => /^01[016789]\d{7,8}$/.test(normalizePhone(p));
export const maskPhone = (p) => { const d = normalizePhone(p); return d.length < 8 ? "***" : `${d.slice(0, 3)}****${d.slice(-4)}`; };
export const setUserPhone = (db, id, phone) => run(db, "UPDATE users SET phone=? WHERE id=?", normalizePhone(phone), id);
export const updateUserPassword = (db, id, hash, salt) =>
  run(db, "UPDATE users SET password_hash=?, salt=?, session_version = session_version + 1 WHERE id=?", hash, salt, id);
export const bumpSessionVersion = (db, id) => run(db, "UPDATE users SET session_version = session_version + 1 WHERE id=?", id);
export const resetHomeLayout = (db, id) => run(db, "UPDATE associations SET home_layout=NULL WHERE id=?", id);
export const setUserTotp = (db, id, secret, enabled) => run(db, "UPDATE users SET totp_secret=?, totp_enabled=? WHERE id=?", secret, enabled ? 1 : 0, id);

// ----- 감사 로그 -----
export function logAudit(db, { associationId = null, userId = null, actorName = "", action, detail = "" }) {
  return run(db, "INSERT INTO audit_log (association_id, user_id, actor_name, action, detail) VALUES (?,?,?,?,?)", associationId, userId, actorName, action, detail);
}
export const listAudit = (db, associationId, limit = 20) =>
  all(db, "SELECT * FROM audit_log WHERE association_id " + (associationId == null ? "IS NULL" : "= ?") + " ORDER BY created_at DESC, id DESC LIMIT ?", ...(associationId == null ? [limit] : [associationId, limit]));
export function listUsersByAssociation(db, associationId, role = null) {
  const sql = `SELECT u.id, u.email, u.name, u.role, u.phone, b.name AS business_name
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
export async function createBusiness(db, { associationId, ownerId, name, category, source = "self" }) {
  const slug = await uniqueSlug(db, associationId, name);
  await run(db, "INSERT INTO businesses (association_id, owner_id, name, slug, category, source) VALUES (?, ?, ?, ?, ?, ?)",
    associationId, ownerId, name.trim(), slug, category || "기타", source === "proxy" ? "proxy" : "self");
  return getBusinessById(db, await lastId(db));
}
export function updateBusiness(db, id, f) {
  return run(db, "UPDATE businesses SET name=?, category=?, description=?, phone=?, address=?, hours=?, lat=?, lng=?, sns_instagram=?, sns_youtube=?, sns_blog=?, sns_kakao=?, sns_naver=?, updated_at=datetime('now') WHERE id=?",
    f.name, f.category, f.description, f.phone, f.address, f.hours, f.lat ?? null, f.lng ?? null,
    f.snsInstagram || "", f.snsYoutube || "", f.snsBlog || "", f.snsKakao || "", f.snsNaver || "", id);
}
// 콘텐츠 활동(사진 추가 등) 발생 시 갱신 시각 터치 — '살아있는 홈' 계측용
export const touchBusiness = (db, id) => run(db, "UPDATE businesses SET updated_at=datetime('now') WHERE id=?", id);
export const setBusinessStatus = (db, id, status) => run(db, "UPDATE businesses SET status=? WHERE id=?", status, id);
export const listBusinessMarkers = (db, aid) =>
  all(db, `SELECT id, name, slug, category, lat, lng, address, phone, sns_naver FROM businesses
           WHERE association_id = ? AND status='approved' AND lat IS NOT NULL AND lng IS NOT NULL`, aid);
export const distinctCategories = (db, aid) =>
  all(db, "SELECT category, COUNT(*) AS n FROM businesses WHERE association_id=? AND status='approved' GROUP BY category ORDER BY n DESC", aid);
// 가게 상세 '이런 가게는 어때요' — COUNT 없는 직접 조회 1쿼리
export const listSameCategory = (db, aid, category, exceptId, limit = 3) =>
  all(db, "SELECT * FROM businesses WHERE association_id=? AND status='approved' AND category=? AND id<>? ORDER BY created_at DESC LIMIT ?", aid, category, exceptId, limit);
// 홈 검색 자동완성(datalist)용 — 이름만 가볍게
export const listBusinessNames = (db, aid, limit = 300) =>
  all(db, "SELECT name FROM businesses WHERE association_id=? AND status='approved' ORDER BY name LIMIT ?", aid, limit);
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
// 여러 업체의 대표 사진을 한 번에 (목록 N+1 방지) → Map(business_id → {filename,thumb})
export async function coverImagesFor(db, businessIds) {
  if (!businessIds.length) return new Map();
  const ph = businessIds.map(() => "?").join(",");
  const rows = await all(db,
    `SELECT m.business_id, m.filename, m.thumb FROM media m
     JOIN (SELECT business_id, MAX(created_at) AS mc FROM media WHERE kind='image' AND business_id IN (${ph}) GROUP BY business_id) t
       ON t.business_id=m.business_id AND t.mc=m.created_at
     WHERE m.kind='image'`, ...businessIds);
  const map = new Map();
  for (const r of rows) if (!map.has(r.business_id)) map.set(r.business_id, r);
  return map;
}
export const getMedia = (db, id) => first(db, "SELECT * FROM media WHERE id = ?", id);
export const deleteMedia = (db, id) => run(db, "DELETE FROM media WHERE id = ?", id);
export const countEmbeds = async (db, businessId) => (await first(db, "SELECT COUNT(*) AS n FROM media WHERE business_id=? AND kind='embed'", businessId)).n;
export async function addMedia(db, { businessId, kind, filename = "", poster = "", thumb = "", provider = "", embedId = "", originalName = "", size = 0, caption = "" }) {
  await run(db, "INSERT INTO media (business_id, kind, filename, poster, thumb, provider, embed_id, original_name, size, caption) VALUES (?,?,?,?,?,?,?,?,?,?)",
    businessId, kind, filename, poster, thumb, provider, embedId, originalName, size, caption);
  await run(db, "UPDATE businesses SET updated_at=datetime('now') WHERE id=?", businessId); // 콘텐츠 갱신 계측
  return getMedia(db, await lastId(db));
}

// ----- 핵심 가설 계측: 셀프 등록률·관리자 개입·콘텐츠 갱신률 -----
// "회원이 스스로 채운다"가 성립하는지 재는 세 숫자. 30% 셀프 등록률을 2단계 트리거 기준으로.
export async function engagementMetrics(db, aid) {
  const row = await first(db, `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN source='self' THEN 1 ELSE 0 END) AS self_cnt,
      SUM(CASE WHEN source='proxy' THEN 1 ELSE 0 END) AS proxy_cnt,
      SUM(CASE WHEN (description<>'' OR EXISTS(SELECT 1 FROM media m WHERE m.business_id=businesses.id) OR EXISTS(SELECT 1 FROM products p WHERE p.business_id=businesses.id AND p.hidden=0)) THEN 1 ELSE 0 END) AS filled_cnt,
      SUM(CASE WHEN updated_at IS NOT NULL AND updated_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) AS refreshed_cnt
    FROM businesses WHERE association_id=?`, aid);
  const total = row.total || 0;
  const selfCnt = row.self_cnt || 0, proxyCnt = row.proxy_cnt || 0;
  const filledCnt = row.filled_cnt || 0, refreshedCnt = row.refreshed_cnt || 0;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  return {
    total, selfCnt, proxyCnt, filledCnt, refreshedCnt,
    selfRate: pct(selfCnt), filledRate: pct(filledCnt), refreshRate: pct(refreshedCnt),
  };
}

// ----- 점포 제품 진열 (전시 전용) -----
export const listProducts = (db, businessId, { includeHidden = false } = {}) =>
  all(db, `SELECT * FROM products WHERE business_id=?${includeHidden ? "" : " AND hidden=0"} ORDER BY sort_order ASC, id ASC`, businessId);
export const getProduct = (db, id) => first(db, "SELECT * FROM products WHERE id=?", id);
// 상인회 관리자용: 자기 상인회 전 점포 제품 (숨김 포함)
export const listAssocProducts = (db, aid) =>
  all(db, `SELECT p.*, b.name AS biz_name, b.slug AS biz_slug FROM products p JOIN businesses b ON b.id=p.business_id
           WHERE p.association_id=? ORDER BY b.name ASC, p.sort_order ASC`, aid);
export const countProducts = async (db, businessId) => (await first(db, "SELECT COUNT(*) AS n FROM products WHERE business_id=?", businessId)).n;
export const countProductImages = async (db, businessId) => (await first(db, "SELECT COUNT(*) AS n FROM products WHERE business_id=? AND image<>''", businessId)).n;
// 저장 quota: 미디어 사진 + 제품 사진 합산 (플랜 maxPhotos 공유)
export const countStoredImages = async (db, businessId) =>
  (await countBusinessImages(db, businessId)) + (await countProductImages(db, businessId));
// 목록 카드 대표 제품 1개 (노출·비품절 우선)
export const topProduct = (db, businessId) =>
  first(db, "SELECT * FROM products WHERE business_id=? AND hidden=0 AND image<>'' ORDER BY sold_out ASC, sort_order ASC, id ASC LIMIT 1", businessId);
export async function createProduct(db, { businessId, associationId, name, price = "", description = "", image = "", externalLink = null, source = "self" }) {
  const ord = (await first(db, "SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM products WHERE business_id=?", businessId)).n;
  await run(db, "INSERT INTO products (business_id, association_id, name, price, description, image, sort_order, external_link, source) VALUES (?,?,?,?,?,?,?,?,?)",
    businessId, associationId, name.trim(), price, description, image, ord, externalLink, source === "proxy" ? "proxy" : "self");
  return getProduct(db, await lastId(db));
}
export const updateProduct = (db, id, f) =>
  run(db, "UPDATE products SET name=?, price=?, description=?, sold_out=? WHERE id=?", f.name, f.price, f.description, f.soldOut ? 1 : 0, id);
export const setProductImage = (db, id, image) => run(db, "UPDATE products SET image=? WHERE id=?", image, id);
export const setProductHidden = (db, id, hidden) => run(db, "UPDATE products SET hidden=? WHERE id=?", hidden ? 1 : 0, id);
export const setProductSoldOut = (db, id, sold) => run(db, "UPDATE products SET sold_out=? WHERE id=?", sold ? 1 : 0, id);
export const deleteProduct = (db, id) => run(db, "DELETE FROM products WHERE id=?", id);

// ----- 쿠폰 (보여주기 혜택 — 결제 없음) -----
export const listCoupons = (db, businessId) =>
  all(db, "SELECT * FROM coupons WHERE business_id=? ORDER BY created_at DESC", businessId);
// 공개 노출: 기한 지난 쿠폰 자동 제외 (SQLite date('now') = UTC — KST 자정보다 최대 9시간 늦게 사라지는 정도라 허용)
export const listActiveCoupons = (db, businessId) =>
  all(db, "SELECT * FROM coupons WHERE business_id=? AND (valid_until='' OR valid_until >= date('now')) ORDER BY created_at DESC", businessId);
export const countCoupons = async (db, businessId) => (await first(db, "SELECT COUNT(*) AS n FROM coupons WHERE business_id=?", businessId)).n;
export const createCoupon = (db, { businessId, associationId, title, terms = "", validUntil = "" }) =>
  run(db, "INSERT INTO coupons (business_id, association_id, title, terms, valid_until) VALUES (?,?,?,?,?)", businessId, associationId, title, terms, validUntil);
export const getCoupon = (db, id) => first(db, "SELECT * FROM coupons WHERE id=?", id);
export const deleteCoupon = (db, id) => run(db, "DELETE FROM coupons WHERE id=?", id);

// ----- 가게 소식 (한 줄 피드) -----
export const listUpdates = (db, businessId, limit = 20) =>
  all(db, "SELECT * FROM updates WHERE business_id=? ORDER BY created_at DESC, id DESC LIMIT ?", businessId, limit);
export const listAssocUpdates = (db, aid, limit = 6) =>
  all(db, `SELECT u.*, b.name AS biz_name, b.slug AS biz_slug FROM updates u
           JOIN businesses b ON b.id = u.business_id AND b.status = 'approved'
           WHERE u.association_id=? ORDER BY u.created_at DESC, u.id DESC LIMIT ?`, aid, limit);
export const countUpdates = async (db, businessId) => (await first(db, "SELECT COUNT(*) AS n FROM updates WHERE business_id=?", businessId)).n;
export const createUpdate = (db, { businessId, associationId, body, image = "" }) =>
  run(db, "INSERT INTO updates (business_id, association_id, body, image) VALUES (?,?,?,?)", businessId, associationId, body, image);
export const getUpdate = (db, id) => first(db, "SELECT * FROM updates WHERE id=?", id);
export const deleteUpdate = (db, id) => run(db, "DELETE FROM updates WHERE id=?", id);

// ----- 오늘 임시휴무 (KST 날짜 저장 — 날짜가 지나면 자동 무효) -----
export const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
export const setDayOff = (db, businessId, date) => run(db, "UPDATE businesses SET day_off_date=? WHERE id=?", date || "", businessId);
export const isDayOff = (b) => !!b && b.day_off_date === kstToday();

// ----- 총회 안건 투표 -----
export const createPoll = (db, { associationId, title, body = "", closesAt = "", createdBy = null }) =>
  run(db, "INSERT INTO polls (association_id, title, body, closes_at, created_by) VALUES (?,?,?,?,?)", associationId, title, body, closesAt, createdBy).then((r) => first(db, "SELECT * FROM polls WHERE id=?", r.meta.last_row_id));
export const listPolls = (db, aid) => all(db, "SELECT * FROM polls WHERE association_id=? ORDER BY closed, created_at DESC", aid);
export const getPoll = (db, id) => first(db, "SELECT * FROM polls WHERE id=?", id);
export const closePoll = (db, id) => run(db, "UPDATE polls SET closed=1 WHERE id=?", id);
export const isPollOpen = (p) => p && !p.closed && (!p.closes_at || p.closes_at >= kstToday());
export const votePoll = (db, pollId, userId, choice) =>
  run(db, "INSERT INTO poll_votes (poll_id, user_id, choice) VALUES (?,?,?) ON CONFLICT(poll_id, user_id) DO UPDATE SET choice=excluded.choice, created_at=datetime('now')", pollId, userId, choice);
export const pollResults = async (db, pollId) => {
  const rows = await all(db, "SELECT choice, COUNT(*) AS n FROM poll_votes WHERE poll_id=? GROUP BY choice", pollId);
  const r = { yes: 0, no: 0, abstain: 0, total: 0 };
  for (const row of rows) { if (row.choice in r) r[row.choice] = row.n; r.total += row.n; }
  return r;
};
export const userVote = async (db, pollId, userId) => (await first(db, "SELECT choice FROM poll_votes WHERE poll_id=? AND user_id=?", pollId, userId))?.choice || null;
// 투표 페이지용 일괄 조회 — 안건 수와 무관하게 2쿼리 (N+1 제거)
// IN(?,?,...) 나열 대신 서브쿼리: D1 은 쿼리당 바인드 파라미터 100개 한도라 안건 100개부터 터진다
export async function pollResultsBulk(db, aid) {
  const out = new Map();
  for (const row of await all(db, `SELECT poll_id, choice, COUNT(*) AS n FROM poll_votes
      WHERE poll_id IN (SELECT id FROM polls WHERE association_id=?) GROUP BY poll_id, choice`, aid)) {
    if (!out.has(row.poll_id)) out.set(row.poll_id, { yes: 0, no: 0, abstain: 0, total: 0 });
    const r = out.get(row.poll_id);
    if (row.choice in r) { r[row.choice] = row.n; r.total += row.n; }
  }
  return out;
}
export async function userVotesBulk(db, aid, userId) {
  const out = new Map();
  for (const row of await all(db, `SELECT poll_id, choice FROM poll_votes
      WHERE user_id=? AND poll_id IN (SELECT id FROM polls WHERE association_id=?)`, userId, aid)) out.set(row.poll_id, row.choice);
  return out;
}

// ----- 행사 참가 신청 -----
export const rsvpEvent = (db, eventId, aid, userId) =>
  run(db, "INSERT OR IGNORE INTO event_rsvps (event_id, association_id, user_id) VALUES (?,?,?)", eventId, aid, userId);
export const cancelRsvp = (db, eventId, userId) => run(db, "DELETE FROM event_rsvps WHERE event_id=? AND user_id=?", eventId, userId);
export const rsvpCount = async (db, eventId) => (await first(db, "SELECT COUNT(*) AS n FROM event_rsvps WHERE event_id=?", eventId)).n;
export const listRsvps = (db, eventId) =>
  all(db, `SELECT r.*, u.name AS user_name, b.name AS biz_name FROM event_rsvps r
           JOIN users u ON u.id = r.user_id LEFT JOIN businesses b ON b.owner_id = u.id
           WHERE r.event_id=? ORDER BY r.created_at`, eventId);
export const userRsvped = async (db, eventId, userId) => !!(await first(db, "SELECT 1 AS x FROM event_rsvps WHERE event_id=? AND user_id=?", eventId, userId));
// 행사 페이지용 일괄 요약 — 행사 수와 무관하게 1쿼리 (비회원은 uid 0)
export const eventRsvpSummary = (db, aid, uid = 0) =>
  all(db, "SELECT event_id, COUNT(*) AS n, MAX(user_id = ?2) AS mine FROM event_rsvps WHERE association_id = ?1 GROUP BY event_id", aid, uid);
// 관리자 행사 목록용 — 상인회 전체 참가 명단을 1쿼리로
export const listRsvpsByAssoc = (db, aid) =>
  all(db, `SELECT r.event_id, u.name AS user_name, b.name AS biz_name FROM event_rsvps r
           JOIN users u ON u.id = r.user_id LEFT JOIN businesses b ON b.owner_id = u.id
           WHERE r.association_id=? ORDER BY r.created_at`, aid);

// ----- 회비 장부 (납부 기록만 — 결제 아님) -----
export const setDuePaid = (db, aid, userId, period) =>
  run(db, "INSERT OR IGNORE INTO dues (association_id, user_id, period) VALUES (?,?,?)", aid, userId, period);
export const setDueUnpaid = (db, aid, userId, period) =>
  run(db, "DELETE FROM dues WHERE association_id=? AND user_id=? AND period=?", aid, userId, period);
export const listDuesForPeriod = (db, aid, period) =>
  all(db, "SELECT user_id FROM dues WHERE association_id=? AND period=?", aid, period);
export async function moveProduct(db, id, dir) {
  const p = await getProduct(db, id); if (!p) return;
  const neighbor = await first(db,
    `SELECT * FROM products WHERE business_id=? AND sort_order ${dir < 0 ? "<" : ">"} ? ORDER BY sort_order ${dir < 0 ? "DESC" : "ASC"} LIMIT 1`,
    p.business_id, p.sort_order);
  if (!neighbor) return;
  await run(db, "UPDATE products SET sort_order=? WHERE id=?", neighbor.sort_order, p.id);
  await run(db, "UPDATE products SET sort_order=? WHERE id=?", p.sort_order, neighbor.id);
}

// ----- Notices -----
export const listNotices = (db, aid, limit = null) =>
  all(db, "SELECT * FROM notices WHERE association_id=? ORDER BY pinned DESC, created_at DESC" + (limit ? ` LIMIT ${Number(limit)}` : ""), aid);
export const getNotice = (db, id) => first(db, "SELECT * FROM notices WHERE id=?", id);
export const distinctNoticeTags = (db, aid) =>
  all(db, "SELECT tag, COUNT(*) AS n FROM notices WHERE association_id=? GROUP BY tag ORDER BY n DESC, tag", aid);
export async function createNotice(db, { associationId, title, body, tag, image = "", pinned }) {
  await run(db, "INSERT INTO notices (association_id, title, body, tag, image, pinned) VALUES (?,?,?,?,?,?)",
    associationId, title, body || "", tag || "안내", image || "", pinned ? 1 : 0);
  return getNotice(db, await lastId(db));
}
export const deleteNotice = (db, id) => run(db, "DELETE FROM notices WHERE id=?", id);
export async function listNoticesPaged(db, aid, { page = 1, perPage = 20, q = null, tag = null } = {}) {
  let w = " WHERE association_id = ?"; const a = [aid];
  if (tag) { w += " AND tag = ?"; a.push(tag); }
  if (q) { const l = likeParam(q); w += " AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')"; a.push(l, l); }
  const total = (await first(db, "SELECT COUNT(*) AS n FROM notices" + w, ...a)).n;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page | 0 || 1), pages);
  const items = await all(db, "SELECT * FROM notices" + w + " ORDER BY pinned DESC, created_at DESC LIMIT ? OFFSET ?", ...a, perPage, (p - 1) * perPage);
  return { items, total, page: p, pages };
}

// ----- Events -----
export const listEvents = (db, aid, upcomingOnly = false) => upcomingOnly
  ? all(db, "SELECT * FROM events WHERE association_id=? AND event_date >= ? ORDER BY event_date ASC", aid, kstToday()) // date('now')=UTC — 새벽 0~9시에 어제 행사가 남던 버그
  : all(db, "SELECT * FROM events WHERE association_id=? ORDER BY event_date DESC", aid);
export const getEvent = (db, id) => first(db, "SELECT * FROM events WHERE id=?", id);
export async function createEvent(db, { associationId, title, event_date, place, description, image }) {
  await run(db, "INSERT INTO events (association_id, title, event_date, place, description, image) VALUES (?,?,?,?,?,?)",
    associationId, title, event_date, place || "", description || "", image || "");
  return getEvent(db, await lastId(db));
}
export const deleteEvent = (db, id) => run(db, "DELETE FROM events WHERE id=?", id);

// ----- Board -----
export const getPost = (db, id) =>
  first(db, "SELECT p.*, u.name AS author_name FROM posts p LEFT JOIN users u ON u.id=p.author_id WHERE p.id=?", id);
export async function createPost(db, { associationId, authorId, title, body, image = "" }) {
  await run(db, "INSERT INTO posts (association_id, author_id, title, body, image) VALUES (?,?,?,?,?)",
    associationId, authorId, title, body || "", image || "");
  return getPost(db, await lastId(db));
}
export const updatePost = (db, id, { title, body, image }) =>
  run(db, "UPDATE posts SET title=?, body=?, image=?, updated_at=datetime('now') WHERE id=?", title, body || "", image || "", id);
export const setPostPinned = (db, id, p) => run(db, "UPDATE posts SET pinned=? WHERE id=?", p ? 1 : 0, id);
export const deletePost = (db, id) => run(db, "DELETE FROM posts WHERE id=?", id);
export async function listPostsPaged(db, aid, { page = 1, perPage = 15, q = null } = {}) {
  let w = " WHERE p.association_id = ?"; const a = [aid];
  let cw = " WHERE association_id = ?"; const ca = [aid];
  if (q) { const l = likeParam(q); w += " AND (p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\')"; a.push(l, l); cw += " AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')"; ca.push(l, l); }
  const total = (await first(db, "SELECT COUNT(*) AS n FROM posts" + cw, ...ca)).n;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page | 0 || 1), pages);
  const items = await all(db, `SELECT p.*, u.name AS author_name,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) AS comment_count,
      (SELECT COUNT(*) FROM post_images pi WHERE pi.post_id=p.id) AS image_count,
      (SELECT pi.thumb FROM post_images pi WHERE pi.post_id=p.id ORDER BY pi.id LIMIT 1) AS pi_thumb,
      (SELECT pi.filename FROM post_images pi WHERE pi.post_id=p.id ORDER BY pi.id LIMIT 1) AS pi_file
    FROM posts p LEFT JOIN users u ON u.id=p.author_id` + w + " ORDER BY p.pinned DESC, p.created_at DESC LIMIT ? OFFSET ?", ...a, perPage, (p - 1) * perPage);
  return { items, total, page: p, pages };
}
export async function addPostImages(db, postId, images) {
  for (const im of images) await run(db, "INSERT INTO post_images (post_id, filename, thumb) VALUES (?,?,?)", postId, im.filename, im.thumb || "");
}
export const listPostImages = (db, postId) => all(db, "SELECT * FROM post_images WHERE post_id=? ORDER BY id ASC", postId);
export const deletePostImage = (db, id) => run(db, "DELETE FROM post_images WHERE id=?", id);
export const listComments = (db, postId) =>
  all(db, "SELECT c.*, u.name AS author_name FROM comments c LEFT JOIN users u ON u.id=c.author_id WHERE c.post_id=? ORDER BY c.created_at ASC", postId);
export const getComment = (db, id) => first(db, "SELECT * FROM comments WHERE id=?", id);
export async function createComment(db, { postId, authorId, body }) {
  await run(db, "INSERT INTO comments (post_id, author_id, body) VALUES (?,?,?)", postId, authorId, body);
  return getComment(db, await lastId(db));
}
export const deleteComment = (db, id) => run(db, "DELETE FROM comments WHERE id=?", id);

// ----- Notifications -----
export async function createNotification(db, { associationId = null, kind, message, link = "" }) {
  await run(db, "INSERT INTO notifications (association_id, kind, message, link) VALUES (?,?,?,?)", associationId, kind, message, link);
}
export const listNotifications = (db, aid, limit = 20) =>
  all(db, "SELECT * FROM notifications WHERE association_id=? ORDER BY is_read ASC, created_at DESC LIMIT ?", aid, limit);
export const unreadCount = async (db, aid) => (await first(db, "SELECT COUNT(*) AS n FROM notifications WHERE association_id=? AND is_read=0", aid)).n;
export const markAllNotificationsRead = (db, aid) => run(db, "UPDATE notifications SET is_read=1 WHERE association_id=?", aid);

// ----- 전자서명: 문서 -----
export async function createDocument(db, { associationId, title, body, contentHash, createdBy, ordered = 0, dueDate = "" }) {
  await run(db, "INSERT INTO documents (association_id, title, body, content_hash, created_by, ordered, due_date) VALUES (?,?,?,?,?,?,?)",
    associationId, title, body, contentHash, createdBy, ordered ? 1 : 0, dueDate || "");
  return getDocument(db, await lastId(db));
}
export const getDocument = (db, id) => first(db, "SELECT * FROM documents WHERE id=?", id);
export const listDocuments = (db, aid) =>
  all(db, "SELECT d.*, (SELECT COUNT(*) FROM signatures s WHERE s.document_id=d.id) AS sign_count FROM documents d WHERE d.association_id=? ORDER BY d.created_at DESC", aid);
export const closeDocument = (db, id) => run(db, "UPDATE documents SET closed=1 WHERE id=?", id);

const TURN_OK = `(d.ordered = 0 OR NOT EXISTS (
  SELECT 1 FROM signature_requests rp JOIN signature_requests rme ON rme.document_id=d.id AND rme.user_id=?
  WHERE rp.document_id=d.id AND rp.sign_order < rme.sign_order AND rp.declined_at=''
    AND NOT EXISTS (SELECT 1 FROM signatures sp WHERE sp.document_id=rp.document_id AND sp.user_id=rp.user_id)))`;
const TO_SIGN = `d.association_id=? AND d.closed=0 AND (d.due_date='' OR d.due_date >= date('now'))
  AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.document_id=d.id AND s.user_id=?)
  AND NOT EXISTS (SELECT 1 FROM signature_requests rd WHERE rd.document_id=d.id AND rd.user_id=? AND rd.declined_at != '')
  AND (EXISTS (SELECT 1 FROM signature_requests r WHERE r.document_id=d.id AND r.user_id=?)
       OR NOT EXISTS (SELECT 1 FROM signature_requests r2 WHERE r2.document_id=d.id))
  AND ${TURN_OK}`;
export const listDocumentsToSign = (db, aid, uid) => all(db, `SELECT d.* FROM documents d WHERE ${TO_SIGN} ORDER BY d.created_at DESC`, aid, uid, uid, uid, uid);
export const countDocumentsToSign = async (db, aid, uid) => (await first(db, `SELECT COUNT(*) AS n FROM documents d WHERE ${TO_SIGN}`, aid, uid, uid, uid, uid)).n;
// 대상이 지정된 문서(요청 행이 존재)는 대상자만 서명 가능 — 목록(TO_SIGN)과 동일한 규칙을 액션에도 강제
export async function canReceiveSign(db, docId, uid) {
  const any = await first(db, "SELECT 1 AS x FROM signature_requests WHERE document_id=? LIMIT 1", docId);
  if (!any) return true; // 대상 미지정 문서 = 회원 전체 대상
  return !!(await first(db, "SELECT 1 AS x FROM signature_requests WHERE document_id=? AND user_id=?", docId, uid));
}
export async function canSignNow(db, doc, uid) {
  if (!doc.ordered) return true;
  const mine = await first(db, "SELECT sign_order FROM signature_requests WHERE document_id=? AND user_id=?", doc.id, uid);
  if (!mine) return true;
  const pending = (await first(db, `SELECT COUNT(*) AS n FROM signature_requests r WHERE r.document_id=? AND r.sign_order<?
    AND r.declined_at=''
    AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.document_id=r.document_id AND s.user_id=r.user_id)`, doc.id, mine.sign_order)).n;
  return pending === 0;
}
export function isPastDue(doc) {
  if (!doc.due_date) return false;
  return doc.due_date < new Date().toISOString().slice(0, 10);
}
export async function createSignatureRequests(db, documentId, userIds) {
  let i = 0; for (const uid of userIds) { i++; await run(db, "INSERT OR IGNORE INTO signature_requests (document_id, user_id, sign_order) VALUES (?,?,?)", documentId, uid, i); }
}
export const listRequestStatus = (db, documentId) =>
  all(db, `SELECT u.id, u.name, u.email, u.phone, r.sign_order, r.declined_at, r.decline_reason,
    EXISTS (SELECT 1 FROM signatures s WHERE s.document_id=r.document_id AND s.user_id=u.id) AS signed
    FROM signature_requests r JOIN users u ON u.id=r.user_id WHERE r.document_id=? ORDER BY r.sign_order ASC, u.name`, documentId);
export async function requestCounts(db, documentId) {
  const total = (await first(db, "SELECT COUNT(*) AS n FROM signature_requests WHERE document_id=?", documentId)).n;
  const signed = (await first(db, `SELECT COUNT(*) AS n FROM signature_requests r WHERE r.document_id=?
    AND EXISTS (SELECT 1 FROM signatures s WHERE s.document_id=r.document_id AND s.user_id=r.user_id)`, documentId)).n;
  return { total, signed };
}
export const hasSigned = async (db, documentId, uid) => !!(await first(db, "SELECT 1 FROM signatures WHERE document_id=? AND user_id=?", documentId, uid));
// 서명 사슬의 마지막 봉인값 (플랫폼 전체 기준 — 어느 상인회의 기록을 지워도 사슬이 끊긴다)
export const lastSealHash = async (db) => {
  const r = await first(db, "SELECT record_hash FROM signatures ORDER BY id DESC LIMIT 1");
  return r ? r.record_hash : "";
};
export const listSignatureChain = (db) =>
  all(db, "SELECT id, record_hash, prev_hash, seal_ver FROM signatures ORDER BY id");
export async function createSignature(db, r) {
  await run(db, `INSERT INTO signatures (document_id, user_id, signer_name, signature_image, content_hash, ip, user_agent, verify_code, record_hash, signed_at, prev_hash, seal_ver, verify_level)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, r.documentId, r.userId, r.signerName, r.signatureImage, r.contentHash, r.ip, r.userAgent, r.verifyCode, r.recordHash, r.signedAt, r.prevHash || "", r.sealVer || 2, r.verifyLevel || "password");
  return first(db, "SELECT * FROM signatures WHERE id=?", await lastId(db));
}
export const listSignatures = (db, documentId) =>
  all(db, "SELECT s.*, u.email AS signer_email FROM signatures s JOIN users u ON u.id=s.user_id WHERE s.document_id=? ORDER BY s.signed_at DESC", documentId);
export const getSignatureByCode = (db, code) => first(db, "SELECT * FROM signatures WHERE verify_code=?", code);

// ----- Stats -----
export async function stats(db, aid) {
  // 단일 왕복 (D1 은 쿼리마다 네트워크 왕복 → 직렬 5회는 TTFB 를 직접 늘림)
  const r = await first(db, `SELECT
    (SELECT COUNT(*) FROM businesses WHERE association_id=?1 AND status='approved') AS businesses,
    (SELECT COUNT(*) FROM businesses WHERE association_id=?1 AND status='pending')  AS pending,
    (SELECT COUNT(*) FROM events   WHERE association_id=?1) AS events,
    (SELECT COUNT(*) FROM notices  WHERE association_id=?1) AS notices,
    (SELECT COUNT(*) FROM media m JOIN businesses b ON b.id=m.business_id WHERE b.association_id=?1) AS mediaCount`, aid);
  return r;
}
export async function platformStats(db) {
  const one = async (sql) => (await first(db, sql)).n;
  return {
    associations: await one("SELECT COUNT(*) AS n FROM associations"),
    activeAssociations: await one("SELECT COUNT(*) AS n FROM associations WHERE active=1"),
    businesses: await one("SELECT COUNT(*) AS n FROM businesses WHERE status='approved'"),
    users: await one("SELECT COUNT(*) AS n FROM users"),
    media: await one("SELECT COUNT(*) AS n FROM media"),
    storage: (await first(db, "SELECT COALESCE(SUM(size),0) AS n FROM media")).n,
  };
}
// 상인회별 '데모 채우기' 마지막 실행 시각.
// 데모를 채우면 그 상인회의 감사 로그가 비워지고 '데모콘텐츠' 기록이 한 건 남으므로,
// 별도 저장 없이 그 기록만 보면 됩니다. 목록 전체를 한 번에 가져와 N+1 을 피합니다.
export function demoSeedStamps(db) {
  return all(db, `SELECT association_id AS aid, MAX(created_at) AS seeded_at
    FROM audit_log WHERE action='데모콘텐츠' AND association_id IS NOT NULL GROUP BY association_id`);
}
// 상인회별 마지막 활동 시각. 죽어가는 고객을 눈으로 찾으려면 누적 수치가 아니라
// '언제 마지막으로 뭔가 했는지'가 필요합니다. 점포 갱신·공지·행사·게시글·가게소식·서명을 모두 봅니다.
export function lastActivityByAssociation(db) {
  return all(db, `SELECT a.id AS aid, MAX(x.ts) AS last_at FROM associations a LEFT JOIN (
      SELECT association_id, MAX(COALESCE(updated_at, created_at)) AS ts FROM businesses GROUP BY association_id
      UNION ALL SELECT association_id, MAX(created_at) FROM notices GROUP BY association_id
      UNION ALL SELECT association_id, MAX(created_at) FROM events GROUP BY association_id
      UNION ALL SELECT association_id, MAX(created_at) FROM posts GROUP BY association_id
      UNION ALL SELECT association_id, MAX(created_at) FROM updates GROUP BY association_id
      UNION ALL SELECT association_id, MAX(created_at) FROM documents GROUP BY association_id
    ) x ON x.association_id = a.id GROUP BY a.id`);
}

// 슈퍼 관리자 계정 목록 — "누가 이 콘솔에 들어올 수 있는가" 를 눈으로 확인하기 위한 것.
export const listSuperAdmins = (db) =>
  all(db, "SELECT id, name, email, created_at, totp_enabled FROM users WHERE role='SUPERADMIN' ORDER BY id");

// 모든 상인회 관리자(ADMIN) 계정 — 슈퍼 콘솔에서 연락처 확인·비밀번호 재발급용
export const listAllAdmins = (db) =>
  all(db, "SELECT id, association_id, name, email FROM users WHERE role='ADMIN' ORDER BY association_id, id");

// 상인회 완전 삭제. 외래키 CASCADE 에 기대지 않고 자식 표부터 순서대로 지웁니다
// (D1 의 FK 강제 설정에 따라 조용히 고아 행이 남는 사고를 막기 위함).
export async function deleteAssociationDeep(db, aid) {
  const viaPosts = ["comments", "post_images"];
  for (const t of viaPosts) await run(db, `DELETE FROM ${t} WHERE post_id IN (SELECT id FROM posts WHERE association_id=?)`, aid);
  await run(db, "DELETE FROM poll_votes WHERE poll_id IN (SELECT id FROM polls WHERE association_id=?)", aid);
  for (const t of ["signatures", "signature_requests"])
    await run(db, `DELETE FROM ${t} WHERE document_id IN (SELECT id FROM documents WHERE association_id=?)`, aid);
  await run(db, "DELETE FROM media WHERE business_id IN (SELECT id FROM businesses WHERE association_id=?)", aid);
  for (const t of ["documents", "posts", "polls", "event_rsvps", "notices", "events", "products",
                   "coupons", "updates", "notifications", "dues", "audit_log", "businesses", "users"])
    await run(db, `DELETE FROM ${t} WHERE association_id=?`, aid);
  await run(db, "DELETE FROM associations WHERE id=?", aid);
}

// 상인회별 사용량 (회원·미디어·저장용량)
export function usageByAssociation(db) {
  return all(db, `SELECT a.id, a.name, a.slug, a.plan,
      (SELECT COUNT(*) FROM users u WHERE u.association_id=a.id AND u.role='MERCHANT') AS members,
      (SELECT COUNT(*) FROM media m JOIN businesses b ON b.id=m.business_id WHERE b.association_id=a.id) AS media_count,
      (SELECT COALESCE(SUM(m.size),0) FROM media m JOIN businesses b ON b.id=m.business_id WHERE b.association_id=a.id) AS storage
    FROM associations a ORDER BY storage DESC, members DESC`);
}

// ===== 알림톡 선불 크레딧 =====
// 잔액은 notify_wallet 에, 모든 증감은 credit_ledger 에 남긴다(감사 추적).
// D1 은 대화형 트랜잭션이 없으므로, 차감은 조건부 UPDATE(balance >= ?)로 원자성을 확보한다.
export async function getBalance(db, aid) {
  const r = await first(db, "SELECT balance FROM notify_wallet WHERE association_id=?", aid);
  return r ? r.balance : 0;
}
async function ledger(db, aid, kind, amount, balanceAfter, memo) {
  await run(db, "INSERT INTO credit_ledger (association_id, kind, amount, balance_after, memo) VALUES (?,?,?,?,?)", aid, kind, amount, balanceAfter, memo || "");
}
// 충전·환불·수동조정 (증가). 지갑이 없으면 만든다.
export async function addCredit(db, aid, amount, { kind = "charge", memo = "" } = {}) {
  const amt = Math.trunc(Number(amount) || 0);
  if (amt <= 0) return { ok: false, balance: await getBalance(db, aid) };
  await run(db, "INSERT INTO notify_wallet (association_id, balance) VALUES (?, 0) ON CONFLICT(association_id) DO NOTHING", aid);
  await run(db, "UPDATE notify_wallet SET balance = balance + ?, updated_at = datetime('now') WHERE association_id=?", amt, aid);
  const balance = await getBalance(db, aid);
  await ledger(db, aid, kind, amt, balance, memo);
  return { ok: true, balance };
}
// 차감 — 잔액이 모자라면 아무것도 하지 않고 ok:false (조건부 UPDATE 로 경합 안전)
export async function spendCredit(db, aid, amount, memo = "") {
  const amt = Math.trunc(Number(amount) || 0);
  if (amt <= 0) return { ok: true, balance: await getBalance(db, aid) };
  await run(db, "INSERT INTO notify_wallet (association_id, balance) VALUES (?, 0) ON CONFLICT(association_id) DO NOTHING", aid);
  const res = await run(db, "UPDATE notify_wallet SET balance = balance - ?, updated_at = datetime('now') WHERE association_id=? AND balance >= ?", amt, aid, amt);
  const changed = res && res.meta ? res.meta.changes : 0;
  const balance = await getBalance(db, aid);
  if (!changed) return { ok: false, balance };
  await ledger(db, aid, "spend", -amt, balance, memo);
  return { ok: true, balance };
}
// 상인회 전용 단가 (0/미설정이면 플랫폼 기본가)
export const getUnitPrice = async (db, aid) => {
  const r = await first(db, "SELECT unit_price FROM notify_wallet WHERE association_id=?", aid);
  return r && r.unit_price > 0 ? r.unit_price : 0;
};
export async function setUnitPrice(db, aid, price) {
  await run(db, "INSERT INTO notify_wallet (association_id, balance) VALUES (?, 0) ON CONFLICT(association_id) DO NOTHING", aid);
  await run(db, "UPDATE notify_wallet SET unit_price=? WHERE association_id=?", Math.max(0, Math.trunc(price) || 0), aid);
}
export const listLedger = (db, aid, limit = 50) =>
  all(db, "SELECT * FROM credit_ledger WHERE association_id=? ORDER BY id DESC LIMIT ?", aid, limit);

// ----- 충전 신청 (무통장 입금 → 슈퍼 승인) -----
export async function createCreditOrder(db, { associationId, amount, depositor }) {
  await run(db, "INSERT INTO credit_orders (association_id, amount, depositor) VALUES (?,?,?)", associationId, Math.trunc(amount), depositor || "");
  return first(db, "SELECT * FROM credit_orders WHERE id=?", await lastId(db));
}
export const getCreditOrder = (db, id) => first(db, "SELECT * FROM credit_orders WHERE id=?", id);
export const listCreditOrders = (db, aid, limit = 20) =>
  all(db, "SELECT * FROM credit_orders WHERE association_id=? ORDER BY id DESC LIMIT ?", aid, limit);
export const listPendingCreditOrders = (db) =>
  all(db, "SELECT o.*, a.name AS assoc_name FROM credit_orders o JOIN associations a ON a.id=o.association_id WHERE o.status='pending' ORDER BY o.id");
export const setCreditOrderStatus = (db, id, status) => run(db, "UPDATE credit_orders SET status=? WHERE id=?", status, id);

// ----- 발송 로그 -----
export const logMessage = (db, { associationId, channel = "alimtalk", kind = "", recipient = "", status = "sent", cost = 0, detail = "" }) =>
  run(db, "INSERT INTO message_log (association_id, channel, kind, recipient, status, cost, detail) VALUES (?,?,?,?,?,?,?)",
    associationId, channel, kind, recipient, status, Math.trunc(cost) || 0, String(detail || "").slice(0, 300));
export const listMessages = (db, aid, limit = 50) =>
  all(db, "SELECT * FROM message_log WHERE association_id=? ORDER BY id DESC LIMIT ?", aid, limit);
export const messageStats = (db, aid) =>
  first(db, `SELECT COUNT(*) AS n, COALESCE(SUM(cost),0) AS spent,
    COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS failed
    FROM message_log WHERE association_id=?`, aid);
// 플랫폼 전체 사용량·매출(슈퍼) — 판매액 기준
export const platformMessageUsage = (db) =>
  all(db, `SELECT a.id, a.name, COALESCE(w.balance,0) AS balance,
      (SELECT COUNT(*) FROM message_log m WHERE m.association_id=a.id AND m.status='sent') AS sent,
      (SELECT COALESCE(SUM(m.cost),0) FROM message_log m WHERE m.association_id=a.id) AS revenue,
      (SELECT COALESCE(SUM(l.amount),0) FROM credit_ledger l WHERE l.association_id=a.id AND l.kind='charge') AS charged,
      COALESCE(w.unit_price,0) AS unit_price
    FROM associations a LEFT JOIN notify_wallet w ON w.association_id=a.id ORDER BY revenue DESC`);
// 알림톡 수신 대상 회원 (휴대폰 있는 사람만)
export const listPhoneMembers = (db, aid) =>
  all(db, "SELECT id, name, phone FROM users WHERE association_id=? AND role='MERCHANT' AND phone != ''", aid);

// ----- 전자계약: 거절(반려) · 리마인더 · 첨부 -----
export const declineSign = (db, documentId, uid, reason) =>
  run(db, "UPDATE signature_requests SET declined_at=datetime('now'), decline_reason=? WHERE document_id=? AND user_id=?", String(reason || "").slice(0, 300), documentId, uid);
export const getDeclineOf = (db, documentId, uid) =>
  first(db, "SELECT declined_at, decline_reason FROM signature_requests WHERE document_id=? AND user_id=? AND declined_at != ''", documentId, uid);
// 아직 서명도 거절도 안 한 대상자 (리마인더 발송 대상)
export const listUnsigned = (db, documentId) =>
  all(db, `SELECT u.id, u.name, u.email, u.phone FROM signature_requests r JOIN users u ON u.id=r.user_id
    WHERE r.document_id=? AND r.declined_at='' 
      AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.document_id=r.document_id AND s.user_id=u.id)
    ORDER BY r.sign_order`, documentId);
export const markReminded = (db, documentId) => run(db, "UPDATE documents SET last_remind_at=datetime('now') WHERE id=?", documentId);
export const setDocumentAttachment = (db, id, key, name, hash) =>
  run(db, "UPDATE documents SET attachment=?, attachment_name=?, attachment_hash=? WHERE id=?", key || "", String(name || "").slice(0, 120), hash || "", id);
// 기한이 임박(D-2 이내)했는데 아직 안 끝난 문서 — 자동 리마인더 대상
export const listDocsNeedingRemind = (db) =>
  all(db, `SELECT d.*, a.name AS assoc_name, a.slug AS assoc_slug FROM documents d JOIN associations a ON a.id=d.association_id
    WHERE d.closed=0 AND d.due_date != '' AND d.due_date >= date('now') AND d.due_date <= date('now','+2 day')
      AND (d.last_remind_at='' OR d.last_remind_at < datetime('now','-20 hour'))
      AND EXISTS (SELECT 1 FROM signature_requests r WHERE r.document_id=d.id AND r.declined_at=''
        AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.document_id=r.document_id AND s.user_id=r.user_id))`);

// ----- 서명 본인확인 OTP -----
// 코드는 해시로만 저장(DB 유출 시에도 코드 자체는 노출되지 않음). 5분 만료·5회 시도 제한.
export const OTP_TTL_MIN = 5;
export const OTP_MAX_ATTEMPTS = 5;
export async function upsertSignOtp(db, { documentId, userId, codeHash, phone }) {
  await run(db, `INSERT INTO sign_otp (document_id, user_id, code_hash, phone, attempts, verified_at, expires_at)
    VALUES (?,?,?,?,0,'', datetime('now', '+${OTP_TTL_MIN} minutes'))
    ON CONFLICT(document_id, user_id) DO UPDATE SET
      code_hash=excluded.code_hash, phone=excluded.phone, attempts=0, verified_at='',
      expires_at=excluded.expires_at, created_at=datetime('now')`, documentId, userId, codeHash, phone || "");
}
export const getSignOtp = (db, documentId, userId) =>
  first(db, "SELECT * FROM sign_otp WHERE document_id=? AND user_id=?", documentId, userId);
export const bumpOtpAttempt = (db, id) => run(db, "UPDATE sign_otp SET attempts=attempts+1 WHERE id=?", id);
export const markOtpVerified = (db, id) => run(db, "UPDATE sign_otp SET verified_at=datetime('now') WHERE id=?", id);
export const clearSignOtp = (db, documentId, userId) => run(db, "DELETE FROM sign_otp WHERE document_id=? AND user_id=?", documentId, userId);
// 인증이 유효한가 — 확인 완료 + 30분 이내 (서명 작성 시간 여유)
export async function otpVerifiedRecently(db, documentId, userId) {
  const r = await first(db, `SELECT 1 AS ok FROM sign_otp WHERE document_id=? AND user_id=?
    AND verified_at != '' AND verified_at > datetime('now','-30 minutes')`, documentId, userId);
  return !!r;
}

// ----- 서명 사슬 앵커 (시점 증거) -----
export const countSignatures = async (db) => (await first(db, "SELECT COUNT(*) AS n FROM signatures")).n;
export async function addChainAnchor(db, { headHash, sigCount, anchoredAt, seal, external }) {
  await run(db, "INSERT INTO chain_anchor (head_hash, sig_count, anchored_at, seal, external) VALUES (?,?,?,?,?)",
    headHash, sigCount, anchoredAt, seal || "", external || "");
  return first(db, "SELECT * FROM chain_anchor WHERE id=?", await lastId(db));
}
export const listAnchors = (db, limit = 30) => all(db, "SELECT * FROM chain_anchor ORDER BY id DESC LIMIT ?", limit);
export const lastAnchor = (db) => first(db, "SELECT * FROM chain_anchor ORDER BY id DESC LIMIT 1");
