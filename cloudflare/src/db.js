// D1(비동기) 데이터 접근 계층. 모든 함수는 D1 바인딩(db)을 첫 인자로 받습니다.
import { slugify, likeParam } from "./util.js";
import { KIND_KEYS, DEFAULT_KIND, PRESET_KEYS, DEFAULT_PRESET } from "./kinds.js";

// ----- D1 헬퍼 -----
export function first(db, sql, ...a) { return db.prepare(sql).bind(...a).first(); }
export async function all(db, sql, ...a) { return (await db.prepare(sql).bind(...a).all()).results || []; }
export function run(db, sql, ...a) { return db.prepare(sql).bind(...a).run(); }
async function lastId(db) { return (await first(db, "SELECT last_insert_rowid() AS id")).id; }

// ----- Associations -----
export const getAssociationBySlug = (db, slug) => first(db, "SELECT * FROM associations WHERE slug = ?", slug);
export const getAssociationById = (db, id) => first(db, "SELECT * FROM associations WHERE id = ?", id);
// 옛 주소 → 조직. 주소를 바꿔도 이미 나간 링크(알림톡 버튼·명함·검색결과)가 죽지 않게 한다.
export const getAssociationByAlias = (db, slug) =>
  first(db, "SELECT a.* FROM slug_aliases s JOIN associations a ON a.id = s.association_id WHERE s.slug = ?", slug);
export const listSlugAliases = (db) => all(db, "SELECT slug, association_id FROM slug_aliases ORDER BY association_id, slug");
export const addSlugAlias = (db, slug, associationId) =>
  run(db, "INSERT OR IGNORE INTO slug_aliases (slug, association_id) VALUES (?,?)", slug, associationId);
// 주소 변경 — 옛 주소는 alias 로 남기고, 혹시 새 주소가 다른 조직의 옛 주소였다면 그 alias 는 치운다.
export async function renameAssociationSlug(db, id, next) {
  const cur = await getAssociationById(db, id);
  if (!cur || cur.slug === next) return { ok: false, reason: "same" };
  if (await getAssociationBySlug(db, next)) return { ok: false, reason: "taken" };
  const alias = await getAssociationByAlias(db, next);
  if (alias && alias.id !== id) return { ok: false, reason: "taken" };
  await run(db, "DELETE FROM slug_aliases WHERE slug=?", next);
  await run(db, "UPDATE associations SET slug=? WHERE id=?", next, id);
  await addSlugAlias(db, cur.slug, id);
  return { ok: true, from: cur.slug, to: next };
}
export const listActiveAssociations = (db) => all(db, "SELECT * FROM associations WHERE active = 1 ORDER BY name");
export const listAllAssociations = (db) => all(db, "SELECT * FROM associations ORDER BY created_at DESC");
// 최근 생성된 조직 수 — 셀프 가입 폭주를 막기 위한 상한 판정
export const countAssociationsSince = async (db, ago = "-1 day") =>
  (await first(db, `SELECT COUNT(*) AS n FROM associations WHERE created_at > datetime('now', ?)`, ago)).n;
// 조직 유형·업종은 화면 구성 전체를 가르는 값이라 아무 문자열이나 들어오면 안 된다 —
// 레지스트리(kinds.js)에 있는 값만 통과시킨다.
export const ASSOC_KINDS = KIND_KEYS;
export const ASSOC_PRESETS = PRESET_KEYS;
export const normalizeKind = (k) => (KIND_KEYS.includes(k) ? k : DEFAULT_KIND);
export const normalizePreset = (p) => (PRESET_KEYS.includes(p) ? p : DEFAULT_PRESET);
// 기본 브랜드색은 세 곳이 같아야 한다 — 여기 · schema.js 의 컬럼 기본값 · app.css/render.js 의 --brand.
export async function createAssociation(db, { slug, name, brandColor = "#1F6CFF", tagline = "함께 성장하는 우리 동네 상권", kind = "merchant", preset = DEFAULT_PRESET }) {
  await run(db, "INSERT INTO associations (slug, name, brand_color, tagline, kind, preset) VALUES (?, ?, ?, ?, ?, ?)",
    slug, name, brandColor, tagline, normalizeKind(kind), normalizePreset(preset));

  return getAssociationById(db, await lastId(db));
}
export const setAssociationKind = (db, id, kind) =>
  run(db, "UPDATE associations SET kind=? WHERE id=?", normalizeKind(kind), id);
export const setAssociationPreset = (db, id, preset) =>
  run(db, "UPDATE associations SET preset=? WHERE id=?", normalizePreset(preset), id);

// 사이트 복제 — 잘 만들어 둔 사이트를 본으로 삼아 새 조직을 찍어 낸다.
// 복사하는 것: 유형·업종·브랜딩·화면 구성(홈/랜딩) — 즉 "껍데기".
// 복사하지 않는 것: 회원·점포·상담 신청·계약·알림톡 잔액 — 즉 "남의 실제 데이터".
//   (이걸 같이 복사하면 새 고객사 화면에 남의 개인정보가 뜬다. 절대 옮기지 않는다.)
export async function cloneAssociation(db, sourceId, { slug, name, brandColor, tagline }) {
  const src = await getAssociationById(db, sourceId);
  if (!src) return null;
  const made = await createAssociation(db, {
    slug, name,
    brandColor: brandColor || src.brand_color,
    tagline: tagline || src.tagline,
    kind: src.kind, preset: src.preset,
  });
  await run(db, `UPDATE associations SET home_layout=?, landing_layout=?, map_lat=?, map_lng=?, map_zoom=? WHERE id=?`,
    src.home_layout, src.landing_layout, src.map_lat, src.map_lng, src.map_zoom, made.id);
  // 캠페인 사본도 함께 (발행본만 — 남의 초안까지 끌고 오면 무엇이 발행된 건지 알 수 없다)
  for (const v of await listLandingVariants(db, sourceId)) {
    await run(db, "INSERT INTO landing_variants (association_id, slug, name, layout) VALUES (?,?,?,?)",
      made.id, v.slug, v.name, v.layout);
  }
  return getAssociationById(db, made.id);
}
export function updateAssociation(db, id, f) {
  return run(db, `UPDATE associations SET name=?, tagline=?, brand_color=?, phone=?, email=?, address=?, logo=?, hero_image=?, hero_video=?, naver_verification=?, google_verification=?, ga_measurement_id=? WHERE id=?`,
    f.name, f.tagline, f.brand_color, f.phone, f.email, f.address, f.logo, f.hero_image || "", f.hero_video || "", f.naver_verification || "", f.google_verification || "", f.ga_measurement_id || "", id);
}
export const setAssociationActive = (db, id, a) => run(db, "UPDATE associations SET active=? WHERE id=?", a ? 1 : 0, id);
export const getAssociationByDomain = (db, host) => first(db, "SELECT * FROM associations WHERE custom_domain = ? AND custom_domain != ''", String(host || "").toLowerCase());
export const setAssociationDomain = (db, id, domain) => run(db, "UPDATE associations SET custom_domain=? WHERE id=?", domain || "", id);
export const setAssociationMapKey = (db, id, key) => run(db, "UPDATE associations SET map_client_id=? WHERE id=?", key || "", id);
// 우리 직인(법인 인감). 계약서의 '우리 도장' 자리에 자동으로 찍힌다.
export const setAssociationSeal = (db, id, key) => run(db, "UPDATE associations SET seal_media=? WHERE id=?", key || "", id);
export const setAssociationPlan = (db, id, plan) => run(db, "UPDATE associations SET plan=? WHERE id=?", plan, id);
// 알림 자동화 스위치. 꺼져 있으면 이 조직 이름으로는 자동 발송이 한 통도 나가지 않는다.
export const setNotifyAuto = (db, id, on) => run(db, "UPDATE associations SET notify_auto=? WHERE id=?", on ? 1 : 0, id);
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
export const saveLandingLayout = (db, id, json) => run(db, "UPDATE associations SET landing_layout=? WHERE id=?", json, id);
export const resetLandingLayout = (db, id) => run(db, "UPDATE associations SET landing_layout=NULL, landing_draft=NULL WHERE id=?", id);
// 초안: 편집기가 저장하는 자리. 발행하면 초안이 발행본으로 옮겨 가고 초안은 비워진다.
export const saveLandingDraft = (db, id, json) => run(db, "UPDATE associations SET landing_draft=? WHERE id=?", json, id);
export const publishLandingDraft = (db, id) =>
  run(db, "UPDATE associations SET landing_layout=COALESCE(landing_draft, landing_layout), landing_draft=NULL WHERE id=?", id);
export const discardLandingDraft = (db, id) => run(db, "UPDATE associations SET landing_draft=NULL WHERE id=?", id);

// ----- 캠페인별 랜딩 사본 -----
export const listLandingVariants = (db, aid) =>
  all(db, "SELECT * FROM landing_variants WHERE association_id=? ORDER BY created_at", aid);
export const getLandingVariant = (db, aid, slug) =>
  first(db, "SELECT * FROM landing_variants WHERE association_id=? AND slug=?", aid, slug);
export async function createLandingVariant(db, { associationId, slug, name, layout }) {
  await run(db, "INSERT INTO landing_variants (association_id, slug, name, layout) VALUES (?,?,?,?)",
    associationId, slug, name || slug, layout || null);
  return getLandingVariant(db, associationId, slug);
}
export const saveLandingVariantDraft = (db, aid, slug, json) =>
  run(db, "UPDATE landing_variants SET draft=? WHERE association_id=? AND slug=?", json, aid, slug);
export const publishLandingVariant = (db, aid, slug) =>
  run(db, "UPDATE landing_variants SET layout=COALESCE(draft, layout), draft=NULL WHERE association_id=? AND slug=?", aid, slug);
export const discardLandingVariantDraft = (db, aid, slug) =>
  run(db, "UPDATE landing_variants SET draft=NULL WHERE association_id=? AND slug=?", aid, slug);
// 사본을 지우면 그 방문·전화 기록은 '지워진 것' 칸으로 옮긴다.
//
// 그냥 두면: 같은 이름으로 사본을 다시 만들었을 때 옛 기록이 새 사본에 붙는다.
//   "봄모집" 을 접었다가 다음 해 같은 이름으로 다시 열면 작년 숫자가 올해 성과로 보인다.
// 지워 버리면: 조직 전체 전환율의 분모만 줄어든다. 그 사본으로 들어온 상담(leads)은
//   기록으로 남아 있어서, 방문만 지우면 전환율이 실제보다 좋아 보인다.
//
// 그래서 지우지 않고 옮긴다. 사본 이름은 [a-z0-9-] 만 허용하므로 ':' 가 들어간 이름은
// 손님이 만든 사본과 절대 부딪히지 않는다. 같은 이름을 여러 번 지우면 묘비 칸에서 합쳐진다.
export const deleteLandingVariant = async (db, aid, slug) => {
  await run(db, `INSERT INTO landing_views (association_id, variant, day, views, calls)
      SELECT association_id, 'deleted:' || variant, day, views, calls
      FROM landing_views WHERE association_id=? AND variant=?
    ON CONFLICT(association_id, variant, day)
      DO UPDATE SET views = views + excluded.views, calls = calls + excluded.calls`, aid, slug);
  await run(db, "DELETE FROM landing_views WHERE association_id=? AND variant=?", aid, slug);
  await run(db, "DELETE FROM landing_variants WHERE association_id=? AND slug=?", aid, slug);
};

// ----- 랜딩 방문 수 (일자·사본별) -----
// 신청 수만으로는 "많이 왔는데 안 남긴 건지, 애초에 안 온 건지"를 구분할 수 없다.
export const bumpLandingView = (db, aid, variant = "") =>
  run(db, `INSERT INTO landing_views (association_id, variant, day, views) VALUES (?,?,?,1)
    ON CONFLICT(association_id, variant, day) DO UPDATE SET views = views + 1`, aid, variant, kstToday());
// 전화 클릭. 손님이 통화 버튼을 누른 순간을 센다 — 실제 통화 여부는 우리가 알 수 없고,
// 알 필요도 없다. "이 랜딩이 전화를 걸게 만들었는가"만 보면 광고 판단에는 충분하다.
export const bumpLandingCall = (db, aid, variant = "") =>
  run(db, `INSERT INTO landing_views (association_id, variant, day, views, calls) VALUES (?,?,?,0,1)
    ON CONFLICT(association_id, variant, day) DO UPDATE SET calls = calls + 1`, aid, variant, kstToday());

// 상인회 홈의 성과 셋. 모집 랜딩은 '상담 신청' 하나가 성공이었지만, 상인회 홈은 그렇지 않다 —
// 점주를 늘리는 것(입점 신청)과 손님을 가게로 보내는 것(가게 열람·찾기)이 둘 다 목적이다.
// 그래서 하나로 합친 '전환율' 대신 셋을 따로 세고, 화면에서 나란히 보여 준다.
const HOME_GOALS = { signup: "signups", bizview: "bizviews", find: "finds" };
export const isHomeGoal = (g) => Object.prototype.hasOwnProperty.call(HOME_GOALS, g);
export function bumpHomeGoal(db, aid, variant, goal) {
  const col = HOME_GOALS[goal];
  if (!col) return Promise.resolve(); // 알 수 없는 이름으로 컬럼을 만들 수 없게 — SQL 은 화이트리스트로만
  return run(db, `INSERT INTO landing_views (association_id, variant, day, views, ${col}) VALUES (?,?,?,0,1)
    ON CONFLICT(association_id, variant, day) DO UPDATE SET ${col} = ${col} + 1`, aid, variant, kstToday());
}
// 사본별 성과 (최근 N일). 방문이 얇으면 비율은 우연이라, 화면에서 그렇게 말해 준다.
export const homeVariantStats = (db, aid, days = 30) =>
  all(db, `SELECT variant,
      SUM(views) views, SUM(signups) signups, SUM(bizviews) bizviews, SUM(finds) finds
    FROM landing_views WHERE association_id=? AND day >= date('now','+9 hours',?)
    GROUP BY variant`, aid, `-${Math.max(1, days | 0)} days`);
export const landingCallsSince = async (db, aid, days = 30) =>
  (await first(db, `SELECT COALESCE(SUM(calls),0) AS n FROM landing_views WHERE association_id=? AND day >= ?`,
    aid, kstDaysAgo(days))).n;

export const landingViewsSince = async (db, aid, days = 30) =>
  (await first(db, `SELECT COALESCE(SUM(views),0) AS n FROM landing_views WHERE association_id=? AND day >= ?`,
    aid, kstDaysAgo(days))).n;
export const landingViewsByVariant = (db, aid, days = 30) =>
  all(db, `SELECT variant, COALESCE(SUM(views),0) AS n, COALESCE(SUM(calls),0) AS calls
    FROM landing_views WHERE association_id=? AND day >= ? GROUP BY variant`, aid, kstDaysAgo(days));

// ----- 랜딩 사진 보관함 -----
export async function addLandingAsset(db, { associationId, filename, originalName = "", size = 0 }) {
  await run(db, "INSERT INTO landing_assets (association_id, filename, original_name, size) VALUES (?,?,?,?)",
    associationId, filename, originalName, size);
  return first(db, "SELECT * FROM landing_assets WHERE id=?", await lastId(db));
}
export const listLandingAssets = (db, aid, limit = 60) =>
  all(db, "SELECT * FROM landing_assets WHERE association_id=? ORDER BY created_at DESC, id DESC LIMIT ?", aid, limit);
export const getLandingAsset = (db, id, aid) =>
  first(db, "SELECT * FROM landing_assets WHERE id=? AND association_id=?", id, aid);
export const deleteLandingAsset = (db, id, aid) =>
  run(db, "DELETE FROM landing_assets WHERE id=? AND association_id=?", id, aid);

// ----- 가맹 상담 신청 (프랜차이즈 랜딩 DB) -----
export const LEAD_STATUSES = ["new", "contacted", "visit", "contract", "drop"];
export const LEAD_STATUS_LABEL = { new: "신규", contacted: "연락 완료", visit: "상담·방문", contract: "계약", drop: "보류·종료" };
export async function createLead(db, { associationId, name, phone = "", email = "", region = "", budget = "", funnel = "", message = "", agreeMarketing = 0, source = "landing", utmSource = "", utmMedium = "", utmCampaign = "", referrer = "", variant = "", extra = "" }) {
  await run(db, `INSERT INTO leads (association_id, name, phone, email, region, budget, funnel, message, agree_marketing, source,
    utm_source, utm_medium, utm_campaign, referrer, variant, extra) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    associationId, name, phone, email, region, budget, funnel, message, agreeMarketing ? 1 : 0, source,
    utmSource, utmMedium, utmCampaign, referrer, variant, extra);
  return first(db, "SELECT * FROM leads WHERE id=?", await lastId(db));
}
export const getLead = (db, id, aid) => first(db, "SELECT * FROM leads WHERE id=? AND association_id=?", id, aid);
export const listLeads = (db, aid, { status = "", limit = 200, offset = 0 } = {}) =>
  status
    ? all(db, "SELECT * FROM leads WHERE association_id=? AND status=? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", aid, status, limit, offset)
    : all(db, "SELECT * FROM leads WHERE association_id=? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", aid, limit, offset);
export const setLeadStatus = (db, id, aid, status) =>
  run(db, "UPDATE leads SET status=?, updated_at=datetime('now') WHERE id=? AND association_id=?",
    LEAD_STATUSES.includes(status) ? status : "new", id, aid);
export const setLeadMemo = (db, id, aid, memo) =>
  run(db, "UPDATE leads SET memo=?, updated_at=datetime('now') WHERE id=? AND association_id=?", memo || "", id, aid);
export const deleteLead = (db, id, aid) => run(db, "DELETE FROM leads WHERE id=? AND association_id=?", id, aid);
// 같은 번호로 몇 분 안에 다시 눌린 신청은 새 건이 아니다 (더블클릭·뒤로가기 재전송).
// 하이픈 유무는 같은 번호다 — 표기만 바꿔 다시 넣어도 영업팀이 두 번 전화하면 안 된다.
const bareDigits = (p) => String(p || "").replace(/\D/g, "");
export const recentLeadByPhone = (db, aid, phone, minutes = 10) =>
  first(db, `SELECT id FROM leads WHERE association_id=? AND phone!=''
    AND replace(replace(replace(phone,'-',''),' ',''),'+','') = ?
    AND created_at > datetime('now', ?) LIMIT 1`,
    aid, bareDigits(phone), `-${Math.max(1, minutes | 0)} minutes`);
export async function leadStats(db, aid) {
  const r = await first(db, `SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN status='new' THEN 1 ELSE 0 END) AS fresh,
    SUM(CASE WHEN status='contract' THEN 1 ELSE 0 END) AS contract,
    SUM(CASE WHEN date(created_at,'+9 hours') = date('now','+9 hours') THEN 1 ELSE 0 END) AS today,
    SUM(CASE WHEN created_at > datetime('now','-7 days') THEN 1 ELSE 0 END) AS week
    FROM leads WHERE association_id=?`, aid);
  return { total: r.total || 0, fresh: r.fresh || 0, contract: r.contract || 0, today: r.today || 0, week: r.week || 0 };
}
// 유입 경로별 집계 — 어느 광고가 실제로 DB 를 만들어 냈는지 (빈 값은 '미기재'로 묶는다)
export const leadFunnelStats = (db, aid) =>
  all(db, `SELECT CASE WHEN funnel='' THEN '미기재' ELSE funnel END AS funnel, COUNT(*) AS n
    FROM leads WHERE association_id=? GROUP BY 1 ORDER BY n DESC LIMIT 30`, aid);
// 광고 출처별 집계 — 신청자 자기신고(funnel)와 달리 링크에 붙여 온 값이라 거짓말을 하지 않는다
export const leadUtmStats = (db, aid, days = 30) =>
  all(db, `SELECT CASE WHEN utm_source='' THEN '직접·기타' ELSE utm_source END AS source,
      CASE WHEN utm_campaign='' THEN '' ELSE utm_campaign END AS campaign, COUNT(*) AS n
    FROM leads WHERE association_id=? AND created_at > datetime('now', ?)
    GROUP BY 1,2 ORDER BY n DESC LIMIT 30`, aid, `-${Math.max(1, days | 0)} days`);
// 사본(캠페인)별 신청 수 — 방문 수와 짝지어 전환율을 낸다
export const leadCountsByVariant = (db, aid, days = 30) =>
  all(db, `SELECT variant, COUNT(*) AS n FROM leads WHERE association_id=? AND created_at > datetime('now', ?)
    GROUP BY variant`, aid, `-${Math.max(1, days | 0)} days`);
export const countLeadsSince = async (db, aid, days = 30) =>
  (await first(db, "SELECT COUNT(*) AS n FROM leads WHERE association_id=? AND created_at > datetime('now', ?)",
    aid, `-${Math.max(1, days | 0)} days`)).n;

// 처리 완료된 상담 건의 기본 보관 기간(일). 조직별 설정이 없으면 이 값이 쓰인다.
export const LEAD_RETENTION_DEFAULT = 365;

// 보관 기간이 지난 상담 건 파기. "상담이 끝나면 지체 없이 삭제한다"고 방침에 써 놓고
// 사람 손에만 맡기면 실제로는 영원히 남는다 — 매일 크론이 대신 지운다.
// 처리가 끝난 건(계약·보류)만 대상으로 하고, 진행 중인 건은 건드리지 않는다.
export const purgeOldLeads = async (db, aid, days) => {
  const r = await run(db, `DELETE FROM leads WHERE association_id=? AND status IN ('contract','drop')
    AND COALESCE(NULLIF(updated_at,''), created_at) < datetime('now', ?)`, aid, `-${Math.max(1, days | 0)} days`);
  return (r && r.meta && r.meta.changes) || 0;
};

// ----- Settings (자동 생성 키·설정 저장) -----
export const getSetting = async (db, key) => { const r = await first(db, "SELECT value FROM settings WHERE key=?", key); return r ? r.value : null; };
export const setSetting = (db, key, value) => run(db, "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, value);
export const delSetting = (db, key) => run(db, "DELETE FROM settings WHERE key=?", key);

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
// 화면에 되돌려 보여줄 때만 하이픈을 넣는다 (저장은 숫자만).
export const formatPhone = (p) => {
  const d = normalizePhone(p);
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
};
// 휴대폰 번호로 계정 찾기 — 번호는 유일하지 않다(부부가 가게 둘을 하는 경우가 실제로 있다).
// 그래서 여럿을 돌려주고, 누구인지는 비밀번호가 가른다. 5개로 끊는 건 느려지지 않게 하려는 것.
export const listUsersByPhone = (db, phone) => {
  const d = normalizePhone(phone);
  return d ? all(db, "SELECT * FROM users WHERE phone = ? ORDER BY id LIMIT 5", d) : Promise.resolve([]);
};
// 역할 변경 — 조직 안에서만. 세션 버전을 올려 기존 로그인을 무효화한다
// (권한을 회수했는데 열려 있던 탭이 계속 동작하면 회수가 아니다).
export const setUserRole = (db, id, associationId, role) =>
  run(db, "UPDATE users SET role=?, session_version = session_version + 1 WHERE id=? AND association_id=?",
    role, id, associationId);
export const setUserPhone = (db, id, phone) => run(db, "UPDATE users SET phone=? WHERE id=?", normalizePhone(phone), id);
// 이메일 없이 등록해 둔 계정에 나중에 로그인 주소를 지정한다.
// 세션 판을 올려, 옛 주소로 남아 있던 로그인은 즉시 끊는다.
export const setUserEmail = (db, id, email) =>
  run(db, "UPDATE users SET email=?, session_version = session_version + 1 WHERE id=?", email, id);
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
// 내부 서명자 후보. 전자계약 조직에서는 관리자·담당자도 서명 대상이 될 수 있다
// (대표가 계약서를 만들고 본인이 날인하는 것은 정당하다). 상인회는 예전처럼 점포주만.
export const listSignerCandidates = (db, associationId, kind) =>
  kind === "esign"
    ? all(db, `SELECT u.id, u.email, u.name, u.role, u.phone, NULL AS business_name
        FROM users u WHERE u.association_id=? AND u.role IN ('ADMIN','STAFF','MERCHANT')
        ORDER BY CASE u.role WHEN 'ADMIN' THEN 0 WHEN 'STAFF' THEN 1 ELSE 2 END, u.name`, associationId)
    : listUsersByAssociation(db, associationId, "MERCHANT");
export function listUsersByAssociation(db, associationId, role = null) {
  const sql = `SELECT u.id, u.email, u.name, u.role, u.phone, u.team_id, b.name AS business_name
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
// "지금 문 연 곳 24곳" 을 세려면 영업시간 문자열을 코드에서 읽어야 한다 (SQL 로는 못 푼다).
// 이름·주소 없이 판단에 필요한 두 칸만 가져온다 — 홈에서 매번 도는 질의라 가볍게.
// 이번 주 방문과 지난주 방문을 한 번에. "25곳" 같은 자산 숫자만으로는 잘 되고 있는지 알 수 없고,
// 상인회장이 실제로 궁금한 것은 "사람이 오고 있나" 다. 지난주가 0이면 증감을 말하지 않는다.
export const visitTrend = (db, aid) => first(db, `SELECT
    COALESCE(SUM(CASE WHEN day >= date('now','+9 hours','-7 days') THEN views END),0) AS cur,
    COALESCE(SUM(CASE WHEN day >= date('now','+9 hours','-14 days') AND day < date('now','+9 hours','-7 days') THEN views END),0) AS prev
  FROM landing_views WHERE association_id=?`, aid);
export const listBusinessHours = (db, aid, limit = 1000) =>
  all(db, "SELECT hours, day_off_date FROM businesses WHERE association_id=? AND status='approved' LIMIT ?", aid, limit);
export const listAllBusinesses = (db, aid) =>
  all(db, `SELECT b.*, u.email AS owner_email, u.name AS owner_name FROM businesses b JOIN users u ON u.id=b.owner_id
           WHERE b.association_id=? ORDER BY CASE b.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, b.created_at DESC`, aid);

// 관리자 목록 — 찾기·거르개·쪽수.
//
// 예전에는 전부를 한 번에 뽑아 한 화면에 늘어놓았다. 34곳에 세로 9,948px 이었고,
// 300곳이면 8만 픽셀이다. 회장님이 특정 사장님 하나를 찾으려면 브라우저 찾기를 눌러야 했다.
// 그리고 같은 사람이 '회원 목록' 과 '업체 관리' 에 두 번 나와 화면이 두 배로 길었다 —
// 상인회에서 회원과 점포는 같은 것이므로 표도 하나여야 한다.
export async function listBusinessesPage(db, aid, { q = "", status = "", limit = 50, offset = 0 } = {}) {
  let where = " WHERE b.association_id = ?"; const args = [aid];
  if (status) { where += " AND b.status = ?"; args.push(status); }
  if (q) {
    const l = likeParam(q);
    // 전화번호는 숫자만 저장하므로, 하이픈을 넣어 친 것도 찾히게 숫자만 남겨 한 번 더 본다
    const digits = String(q).replace(/\D/g, "");
    where += ` AND (b.name LIKE ? ESCAPE '\\' OR b.category LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\'
                    OR b.address LIKE ? ESCAPE '\\'${digits ? " OR u.phone LIKE ? ESCAPE '\\' OR b.phone LIKE ? ESCAPE '\\'" : ""})`;
    args.push(l, l, l, l);
    if (digits) { const d = likeParam(digits); args.push(d, d); }
  }
  const base = ` FROM businesses b JOIN users u ON u.id = b.owner_id${where}`;
  const total = (await first(db, "SELECT COUNT(*) AS n" + base, ...args)).n;
  const rows = await all(db, `SELECT b.*, u.email AS owner_email, u.name AS owner_name, u.phone AS owner_phone, u.id AS owner_uid${base}
    ORDER BY CASE b.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, b.created_at DESC
    LIMIT ? OFFSET ?`, ...args, limit, offset);
  return { rows, total };
}
// 거르개 칩에 붙는 건수 — 0 건인 칸도 보여야 "반려가 없다" 는 사실을 알 수 있다
export async function businessStatusCounts(db, aid) {
  const rows = await all(db, "SELECT status, COUNT(*) AS n FROM businesses WHERE association_id=? GROUP BY status", aid);
  const out = { all: 0, pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) { out[r.status] = r.n; out.all += r.n; }
  return out;
}

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
export const kstDaysAgo = (days) => new Date(Date.now() + 9 * 3600 * 1000 - Math.max(0, days) * 86400000).toISOString().slice(0, 10);
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
  all(db, `SELECT r.*, u.name AS user_name, u.phone AS phone, b.name AS biz_name FROM event_rsvps r
           JOIN users u ON u.id = r.user_id LEFT JOIN businesses b ON b.owner_id = u.id
           WHERE r.event_id=? ORDER BY r.created_at`, eventId);
export const userRsvped = async (db, eventId, userId) => !!(await first(db, "SELECT 1 AS x FROM event_rsvps WHERE event_id=? AND user_id=?", eventId, userId));
// 행사 페이지용 일괄 요약 — 행사 수와 무관하게 1쿼리 (비회원은 uid 0)
export const eventRsvpSummary = (db, aid, uid = 0) =>
  all(db, "SELECT event_id, COUNT(*) AS n, MAX(user_id = ?2) AS mine FROM event_rsvps WHERE association_id = ?1 GROUP BY event_id", aid, uid);
// 관리자 행사 목록용 — 상인회 전체 참가 명단을 1쿼리로
// 연락처를 함께 뽑는다 — 참가자가 몇 명인지가 아니라 '누가 오는지' 를 알아야
// 자리·다과·상품권을 준비할 수 있다. 숫자만으로는 아무것도 못 한다.
export const listRsvpsByAssoc = (db, aid) =>
  all(db, `SELECT r.event_id, r.created_at, u.name AS user_name, u.phone AS phone, b.name AS biz_name FROM event_rsvps r
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
// 고치기 — 예전에는 만들기와 지우기만 있었다. 오타 하나에 공지를 지웠다 다시 쓰면
// 카톡으로 돌린 링크가 죽는다(주소가 글 번호이기 때문). 같은 글을 그대로 고친다.
// image 를 넘기지 않으면 원래 사진을 그대로 둔다 — 사진을 안 다시 올렸다고 지워 버리면 안 된다.
export async function updateNotice(db, id, aid, { title, body, tag, pinned, image = null }) {
  await run(db, `UPDATE notices SET title=?, body=?, tag=?, pinned=?${image === null ? "" : ", image=?"}
    WHERE id=? AND association_id=?`,
    ...[title, body || "", tag || "안내", pinned ? 1 : 0, ...(image === null ? [] : [image]), id, aid]);
  return getNotice(db, id);
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
export async function updateEvent(db, id, aid, { title, event_date, place, description, image = null }) {
  await run(db, `UPDATE events SET title=?, event_date=?, place=?, description=?${image === null ? "" : ", image=?"}
    WHERE id=? AND association_id=?`,
    ...[title, event_date, place || "", description || "", ...(image === null ? [] : [image]), id, aid]);
  return getEvent(db, id);
}
export const deleteEvent = (db, id) => run(db, "DELETE FROM events WHERE id=?", id);

// ----- 홈 팝업 -----
// 손님 화면을 가로막는 유일한 요소라, 스스로 내려갈 수 있어야 합니다.
// 노출 기간은 한국 날짜(kstToday)로 판단합니다 — date('now') 는 UTC 라
// 새벽 0~9시에 어제 끝난 팝업이 살아 있거나 오늘 시작할 팝업이 안 뜹니다.
export const listPopups = (db, aid) =>
  all(db, "SELECT * FROM popups WHERE association_id=? ORDER BY enabled DESC, id DESC", aid);
export const getPopup = (db, id) => first(db, "SELECT * FROM popups WHERE id=?", id);
export const listActivePopups = (db, aid, limit = 3) =>
  all(db, `SELECT * FROM popups WHERE association_id=? AND enabled=1
             AND (start_date='' OR start_date<=?) AND (end_date='' OR end_date>=?)
           ORDER BY id DESC LIMIT ?`, aid, kstToday(), kstToday(), limit);
export async function createPopup(db, { associationId, title, body, image, linkUrl, linkLabel, startDate, endDate }) {
  await run(db, `INSERT INTO popups (association_id, title, body, image, link_url, link_label, start_date, end_date)
                 VALUES (?,?,?,?,?,?,?,?)`,
    associationId, title, body || "", image || "", linkUrl || "", linkLabel || "", startDate || "", endDate || "");
  return getPopup(db, await lastId(db));
}
export const deletePopup = (db, id) => run(db, "DELETE FROM popups WHERE id=?", id);
export const setPopupEnabled = (db, id, on) => run(db, "UPDATE popups SET enabled=? WHERE id=?", on ? 1 : 0, id);

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
export async function createDocument(db, { associationId, title, body, contentHash, createdBy, ordered = 0, dueDate = "", draft = 0, teamId = 0 }) {
  await run(db, "INSERT INTO documents (association_id, title, body, content_hash, created_by, ordered, due_date, draft, team_id) VALUES (?,?,?,?,?,?,?,?,?)",
    associationId, title, body, contentHash, createdBy, ordered ? 1 : 0, dueDate || "", draft ? 1 : 0, teamId | 0);
  return getDocument(db, await lastId(db));
}
export const getDocument = (db, id) => first(db, "SELECT * FROM documents WHERE id=?", id);

// ----- 작성 중(초안) -----
// 초안은 서명 요청도 과금도 발송도 없는 상태다. 쓰다 만 계약서를 저장해 두고
// 다음 날 이어 쓰기 위한 것이라, 보내는 순간 비로소 계약이 된다.
export async function listDrafts(db, aid, { assoc = null, user = null } = {}) {
  const sc = docScopeSql(assoc, user, 2);
  return all(db, `SELECT d.* FROM documents d WHERE d.association_id=?1 AND d.draft=1${sc ? ` AND ${sc.sql}` : ""} ORDER BY d.id DESC`,
    aid, ...(sc ? sc.args : []));
}
export const saveDraft = (db, id, { title, body, contentHash }) =>
  run(db, "UPDATE documents SET title=?, body=?, content_hash=? WHERE id=? AND draft=1", title, body, contentHash, id);
// 초안 → 계약. 이 순간부터 서명 요청·과금·발송이 붙는다.
export const publishDraft = (db, id, { ordered = 0, dueDate = "" } = {}) =>
  run(db, "UPDATE documents SET draft=0, ordered=?, due_date=? WHERE id=?", ordered ? 1 : 0, dueDate || "", id);
export const deleteDraft = (db, id, aid) =>
  run(db, "DELETE FROM documents WHERE id=? AND association_id=? AND draft=1", id, aid);
// 만든 사람을 함께 가져온다 — 담당자가 여러 명이면 "누가 보낸 계약인가"가 가장 먼저 필요해진다.
// created_by 는 ON DELETE SET NULL 이라 계정이 지워져도 목록이 깨지지 않는다(LEFT JOIN).
// ----- 올린 양식의 쪽 그림 -----
// 법적 원문은 원본 PDF(documents.attachment)이고, 이건 '보는 지면' 이다.
export const listDocPages = (db, documentId) =>
  all(db, "SELECT page, media, w, h FROM doc_pages WHERE document_id=? ORDER BY page", documentId);
export async function replaceDocPages(db, documentId, pages) {
  await run(db, "DELETE FROM doc_pages WHERE document_id=?", documentId);
  let i = 0;
  for (const p of pages) {
    await run(db, "INSERT INTO doc_pages (document_id, page, media, w, h) VALUES (?,?,?,?,?)",
      documentId, i++, p.media, p.w | 0, p.h | 0);
  }
  return i;
}
export const countDocPages = async (db, documentId) =>
  (await first(db, "SELECT COUNT(*) AS n FROM doc_pages WHERE document_id=?", documentId)).n;

export const listDocuments = (db, aid) =>
  // "0명 서명" 만으로는 다 된 건지 아무도 안 한 건지 알 수 없다 — 몇 명 중 몇 명인지가 필요하다.
  all(db, `SELECT d.*, u.name AS author_name,
      (SELECT COUNT(*) FROM signatures s WHERE s.document_id=d.id) AS sign_count,
      (SELECT COUNT(*) FROM signature_requests r WHERE r.document_id=d.id) AS signer_count
    FROM documents d LEFT JOIN users u ON u.id = d.created_by
    WHERE d.association_id=? AND d.draft=0 ORDER BY d.created_at DESC`, aid);
// ---- 부서 경계 ----
//
// 한 조직 안에서 인사팀과 영업팀이 같은 콘솔을 쓰면, 인사팀의 근로계약서가 영업팀 화면에
// 그대로 뜬다. 부서를 켜면 그 경계가 생긴다.
//
// 규칙은 셋뿐이고, 판정은 **이 두 함수에서만** 한다(화면마다 따로 세면 반드시 한 곳이 샌다).
//   · 관리자·운영자는 늘 조직의 계약을 전부 본다.
//   · 부서 없는 계약(team_id=0)은 모두가 본다 — 그래서 부서를 켜도 지난 계약이 사라지지 않는다.
//   · 담당자는 자기 부서의 계약과 자기가 만든 계약을 본다.
const seesAll = (assoc, user) =>
  !assoc || !assoc.team_scope || !user || user.role === "SUPERADMIN" || user.role === "ADMIN";

export function canSeeDoc(assoc, user, doc) {
  if (!doc || !assoc || doc.association_id !== assoc.id) return false;
  if (seesAll(assoc, user)) return true;
  if (!doc.team_id) return true;
  if (doc.created_by && doc.created_by === user.id) return true;
  return !!(user.team_id && user.team_id === doc.team_id);
}
// 목록 질의용. i = 이 조각이 쓸 첫 자리표 번호. 볼 것을 다 보면 null(조건 없음).
function docScopeSql(assoc, user, i, alias = "d") {
  if (seesAll(assoc, user)) return null;
  return { sql: `(${alias}.team_id=0 OR ${alias}.team_id=?${i} OR ${alias}.created_by=?${i + 1})`,
    args: [user.team_id | 0, user.id] };
}

// ----- 부서 -----
export const listTeams = (db, aid) =>
  all(db, "SELECT * FROM teams WHERE association_id=? ORDER BY name, id", aid);
export const getTeam = (db, id) => first(db, "SELECT * FROM teams WHERE id=?", id);
export async function createTeam(db, aid, name) {
  await run(db, "INSERT INTO teams (association_id, name) VALUES (?,?)", aid, name);
  return getTeam(db, await lastId(db));
}
export const renameTeam = (db, id, aid, name) =>
  run(db, "UPDATE teams SET name=? WHERE id=? AND association_id=?", name, id, aid);
// 부서를 지워도 계약과 사람은 남는다 — '부서 없음'(전체 공개)으로 돌아갈 뿐이다.
// 계약을 함께 지우면 조직 개편 한 번에 계약 이력이 통째로 날아간다.
export async function deleteTeam(db, id, aid) {
  await run(db, "UPDATE users SET team_id=0 WHERE team_id=? AND association_id=?", id, aid);
  await run(db, "UPDATE documents SET team_id=0 WHERE team_id=? AND association_id=?", id, aid);
  await run(db, "UPDATE doc_batches SET team_id=0 WHERE team_id=? AND association_id=?", id, aid);
  await run(db, "DELETE FROM teams WHERE id=? AND association_id=?", id, aid);
}
export const setUserTeam = (db, uid, aid, teamId) =>
  run(db, "UPDATE users SET team_id=? WHERE id=? AND association_id=?", teamId | 0, uid, aid);
export const setTeamScope = (db, aid, on) =>
  run(db, "UPDATE associations SET team_scope=? WHERE id=?", on ? 1 : 0, aid);
// 부서별 인원 — 관리 화면에서 '아무도 없는 부서' 를 보여 주기 위함
export const teamCounts = async (db, aid) => {
  const out = {};
  for (const r of await all(db, "SELECT team_id, COUNT(*) AS n FROM users WHERE association_id=? AND team_id>0 GROUP BY 1", aid))
    out[r.team_id] = r.n;
  return out;
};

// ---- 계약의 상태 ----
//
// 계약이 쌓이면 목록이 곧 제품이다. "지금 뭘 봐야 하는가" 에 답하려면 상태가 한 낱말이어야 한다.
// 상태는 다섯 가지다 — 이 SQL 한 군데에서만 정한다(화면마다 다르게 계산하면 서로 어긋난다).
//   open     진행 중        아직 다 안 받았고 기한도 안 지났다
//   overdue  기한 지남      기한이 지났는데 미완료 — 손이 필요한 자리
//   declined 반려 있음      한 명이라도 거절했다. 가장 먼저 봐야 한다
//   done     체결 완료      대상 전원이 서명했다
//   closed   마감           사람이 손으로 닫았다
const DOC_STAT = `
  (SELECT COUNT(*) FROM signature_requests r WHERE r.document_id=d.id)
    + (SELECT COUNT(*) FROM external_signers e WHERE e.document_id=d.id) AS total,
  (SELECT COUNT(*) FROM signatures s WHERE s.document_id=d.id) AS signed,
  (SELECT COUNT(*) FROM signature_requests r WHERE r.document_id=d.id AND r.declined_at!='')
    + (SELECT COUNT(*) FROM external_signers e WHERE e.document_id=d.id AND e.declined_at!='') AS declined`;
const DOC_STATUS = `CASE
  WHEN d.closed=1 THEN 'closed'
  WHEN (SELECT COUNT(*) FROM signature_requests r WHERE r.document_id=d.id AND r.declined_at!='')
     + (SELECT COUNT(*) FROM external_signers e WHERE e.document_id=d.id AND e.declined_at!='') > 0 THEN 'declined'
  WHEN ((SELECT COUNT(*) FROM signature_requests r WHERE r.document_id=d.id)
      + (SELECT COUNT(*) FROM external_signers e WHERE e.document_id=d.id)) > 0
   AND (SELECT COUNT(*) FROM signatures s WHERE s.document_id=d.id)
       >= ((SELECT COUNT(*) FROM signature_requests r WHERE r.document_id=d.id)
         + (SELECT COUNT(*) FROM external_signers e WHERE e.document_id=d.id)) THEN 'done'
  WHEN d.due_date!='' AND d.due_date < date('now') THEN 'overdue'
  ELSE 'open' END`;
export const DOC_STATUSES = ["open", "overdue", "declined", "done", "closed"];
export const DOC_STATUS_LABEL = {
  open: "진행 중", overdue: "기한 지남", declined: "반려 있음", done: "체결 완료", closed: "마감",
};

// 제목으로도, 서명자 이름으로도 찾는다 — 관리자는 "누구랑 한 계약" 으로 기억한다.
const DOC_SEARCH = `(d.title LIKE ?1 ESCAPE '\\'
  OR EXISTS (SELECT 1 FROM external_signers e WHERE e.document_id=d.id AND (e.name LIKE ?1 ESCAPE '\\' OR e.org LIKE ?1 ESCAPE '\\'))
  OR EXISTS (SELECT 1 FROM signature_requests r JOIN users u ON u.id=r.user_id
             WHERE r.document_id=d.id AND u.name LIKE ?1 ESCAPE '\\'))`;

export async function listDocumentsPage(db, aid, { q = "", status = "", limit = 20, offset = 0, assoc = null, user = null } = {}) {
  const where = [`d.association_id=?${q ? 2 : 1}`, "d.draft=0"];
  const args = [];
  if (q) { args.push(likeParam(q)); where.push(DOC_SEARCH); }
  args.push(aid);
  const sc = docScopeSql(assoc, user, args.length + 1);
  if (sc) { where.push(sc.sql); args.push(...sc.args); }
  let sql = `SELECT d.*, u.name AS author_name, ${DOC_STAT}, ${DOC_STATUS} AS status
    FROM documents d LEFT JOIN users u ON u.id=d.created_by WHERE ${where.join(" AND ")}`;
  if (DOC_STATUSES.includes(status)) sql += ` AND ${DOC_STATUS} = '${status}'`;
  sql += ` ORDER BY d.created_at DESC LIMIT ${Math.max(1, Math.min(100, limit | 0))} OFFSET ${Math.max(0, offset | 0)}`;
  return all(db, sql, ...args);
}
// 상태별 건수 — 목록 위의 칩. 0 건인 상태도 자리를 지킨다(사라지면 화면이 매번 달라 보인다).
export async function documentCounts(db, aid, q = "", { assoc = null, user = null } = {}) {
  const args = [];
  let where = `d.association_id=?${q ? 2 : 1} AND d.draft=0`;
  if (q) { args.push(likeParam(q)); where += ` AND ${DOC_SEARCH}`; }
  args.push(aid);
  const sc = docScopeSql(assoc, user, args.length + 1);
  if (sc) { where += ` AND ${sc.sql}`; args.push(...sc.args); }
  const rows = await all(db, `SELECT ${DOC_STATUS} AS status, COUNT(*) AS n FROM documents d WHERE ${where} GROUP BY 1`, ...args);
  const out = { all: 0 };
  for (const s of DOC_STATUSES) out[s] = 0;
  for (const r of rows) { out[r.status] = r.n; out.all += r.n; }
  return out;
}

// 서명 시작 전 문서 수정 — 오타 하나 때문에 계약을 새로 만드는 일이 없도록.
// 본문이 바뀌면 해시도 다시 계산해야 한다(호출부에서 넘긴다).
export const updateDocument = (db, id, { title, body, contentHash, dueDate, ordered }) =>
  run(db, "UPDATE documents SET title=?, body=?, content_hash=?, due_date=?, ordered=? WHERE id=?",
    title, body, contentHash, dueDate || "", ordered ? 1 : 0, id);
// 본문이 짧아져 쪽수가 줄면 마지막 쪽 밖으로 나간 필드를 끌어온다(자리를 잃지 않게)
export const clampFieldPages = (db, documentId, lastPage) =>
  run(db, "UPDATE doc_fields SET page=? WHERE document_id=? AND page>?", lastPage, documentId, lastPage);
export const closeDocument = (db, id) => run(db, "UPDATE documents SET closed=1 WHERE id=?", id);

// 기한이 지났는데 아직 안 닫힌 계약 — 매일 크론이 정리한다.
// 기한이 지나면 서명은 이미 막히지만(TURN_OK/isPastDue) 상태는 '진행 중' 으로 남아,
// 아무도 손대지 않는 계약이 목록 맨 위에 영원히 쌓인다. 그러면 목록을 아무도 안 본다.
export const listExpiredOpen = (db) =>
  all(db, `SELECT d.*, a.slug AS assoc_slug FROM documents d JOIN associations a ON a.id=d.association_id
    WHERE d.draft=0 AND d.closed=0 AND d.due_date!='' AND d.due_date < date('now')
      AND (SELECT COUNT(*) FROM signatures s WHERE s.document_id=d.id)
        < ((SELECT COUNT(*) FROM signature_requests r WHERE r.document_id=d.id)
         + (SELECT COUNT(*) FROM external_signers e WHERE e.document_id=d.id))
    ORDER BY d.due_date`);

// 순차 서명 대기 판정 — 내 앞 순번에 아직 서명하지 않은 사람이 있는가.
// 회원과 외부 서명자를 같은 sign_order 축에서 함께 본다(둘 중 하나만 보면 순서가 어긋난다).
const TURN_OK = `(d.ordered = 0 OR (
  NOT EXISTS (
    SELECT 1 FROM signature_requests rp JOIN signature_requests rme ON rme.document_id=d.id AND rme.user_id=?
    WHERE rp.document_id=d.id AND rp.sign_order < rme.sign_order AND rp.declined_at=''
      AND NOT EXISTS (SELECT 1 FROM signatures sp WHERE sp.document_id=rp.document_id AND sp.user_id=rp.user_id))
  AND NOT EXISTS (
    SELECT 1 FROM external_signers ep JOIN signature_requests rme2 ON rme2.document_id=d.id AND rme2.user_id=?
    WHERE ep.document_id=d.id AND ep.sign_order < rme2.sign_order AND ep.declined_at=''
      AND NOT EXISTS (SELECT 1 FROM signatures se WHERE se.document_id=ep.document_id AND se.external_id=ep.id))))`;
// 서명 대기 목록.
// '대상을 아무도 지정하지 않은 문서 = 회원 전체 대상' 이라는 오래된 규칙이 있다(상인회의 전체 동의서).
// 이 규칙은 회원(MERCHANT)에게만 적용한다 — 관리자·담당자까지 끌어들이면, 상인회 관리자가
// 어느 날 갑자기 '서명 필요' 목록을 보게 된다. 계약을 만드는 사람은 명시적으로 지정됐을 때만
// 서명 대상이다.
// ⚠️ d.draft=0 을 빼면 안 된다. 초안은 서명 대상이 하나도 지정돼 있지 않은데,
// 아래 '대상이 없는 문서는 회원 전체 대상' 규칙에 걸려 **조직 회원 전원에게 열린다**.
// 쓰다 만 계약서가 서명 가능해지는 셈이다.
const toSignSql = (openToAll) => `d.association_id=? AND d.closed=0 AND d.draft=0 AND (d.due_date='' OR d.due_date >= date('now'))
  AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.document_id=d.id AND s.user_id=?)
  AND NOT EXISTS (SELECT 1 FROM signature_requests rd WHERE rd.document_id=d.id AND rd.user_id=? AND rd.declined_at != '')
  AND (EXISTS (SELECT 1 FROM signature_requests r WHERE r.document_id=d.id AND r.user_id=?)${openToAll ? `
       OR (NOT EXISTS (SELECT 1 FROM signature_requests r2 WHERE r2.document_id=d.id)
           AND NOT EXISTS (SELECT 1 FROM external_signers e2 WHERE e2.document_id=d.id))` : ""})
  AND ${TURN_OK}`;
// role 기본값이 MERCHANT 인 이유: 기존 호출부의 동작을 그대로 두기 위해서다.
const openToAllFor = (role) => (role || "MERCHANT") === "MERCHANT";
export const listDocumentsToSign = (db, aid, uid, role) =>
  all(db, `SELECT d.* FROM documents d WHERE ${toSignSql(openToAllFor(role))} ORDER BY d.created_at DESC`, aid, uid, uid, uid, uid, uid);
export const countDocumentsToSign = async (db, aid, uid, role) =>
  (await first(db, `SELECT COUNT(*) AS n FROM documents d WHERE ${toSignSql(openToAllFor(role))}`, aid, uid, uid, uid, uid, uid)).n;
// 대상이 지정된 문서(요청 행이 존재)는 대상자만 서명 가능 — 목록(TO_SIGN)과 동일한 규칙을 액션에도 강제
export async function canReceiveSign(db, docId, uid, role) {
  const mine = await first(db, "SELECT 1 AS x FROM signature_requests WHERE document_id=? AND user_id=?", docId, uid);
  if (mine) return true;
  // 관리자·담당자는 명시적으로 지정됐을 때만 대상이다 (목록 규칙과 반드시 같아야 한다 —
  // 어긋나면 화면에는 안 보이는데 URL 로는 서명이 되거나 그 반대가 된다)
  if (!openToAllFor(role)) return false;
  // 대상이 하나도 지정되지 않은 문서만 '회원 전체 대상'이다.
  // ⚠️ 외부 서명자도 대상이다 — 이걸 빠뜨리면 API·서식으로 만든 계약(서명자가 전부 외부)이
  //    signature_requests 가 비어 있다는 이유로 조직 회원 전원에게 열린다.
  // 초안은 같은 이유로 아무에게도 열리지 않는다 (목록 규칙과 반드시 같아야 한다)
  const draft = await first(db, "SELECT 1 AS x FROM documents WHERE id=? AND draft=1", docId);
  if (draft) return false;
  const any = await first(db, `SELECT 1 AS x FROM documents d WHERE d.id=?1 AND (
      EXISTS (SELECT 1 FROM signature_requests r WHERE r.document_id=?1)
      OR EXISTS (SELECT 1 FROM external_signers e WHERE e.document_id=?1))`, docId);
  return !any;
}
export const canSignNow = (db, doc, uid) => canSignNowAny(db, doc, { userId: uid });
export function isPastDue(doc) {
  if (!doc.due_date) return false;
  return doc.due_date < new Date().toISOString().slice(0, 10);
}
export async function createSignatureRequests(db, documentId, userIds) {
  let i = 0; for (const uid of userIds) { i++; await run(db, "INSERT OR IGNORE INTO signature_requests (document_id, user_id, sign_order) VALUES (?,?,?)", documentId, uid, i); }
}
// 순번을 직접 정해 한 명만 넣는다 — 회원과 외부 상대방이 섞인 계약에서, 순차 서명 차례는
// '몇 번째 당사자' 순서여야 한다. 회원을 먼저 다 넣고 외부를 뒤에 붙이면 순서가 뒤바뀐다.
export const addSignatureRequestAt = (db, documentId, userId, order) =>
  run(db, "INSERT OR IGNORE INTO signature_requests (document_id, user_id, sign_order) VALUES (?,?,?)", documentId, userId, order);
export const listRequestStatus = (db, documentId) =>
  all(db, `SELECT u.id, u.name, u.email, u.phone, r.sign_order, r.declined_at, r.decline_reason,
    EXISTS (SELECT 1 FROM signatures s WHERE s.document_id=r.document_id AND s.user_id=u.id) AS signed
    FROM signature_requests r JOIN users u ON u.id=r.user_id WHERE r.document_id=? ORDER BY r.sign_order ASC, u.name`, documentId);
export async function requestCounts(db, documentId) {
  const r = await first(db, `SELECT
    (SELECT COUNT(*) FROM signature_requests WHERE document_id=?1) AS mt,
    (SELECT COUNT(*) FROM signature_requests r WHERE r.document_id=?1
      AND EXISTS (SELECT 1 FROM signatures s WHERE s.document_id=r.document_id AND s.user_id=r.user_id)) AS ms,
    (SELECT COUNT(*) FROM external_signers WHERE document_id=?1) AS et,
    (SELECT COUNT(*) FROM external_signers e WHERE e.document_id=?1
      AND EXISTS (SELECT 1 FROM signatures s WHERE s.document_id=e.document_id AND s.external_id=e.id)) AS es`, documentId);
  return { total: r.mt + r.et, signed: r.ms + r.es, members: r.mt, externals: r.et };
}
export const hasSigned = async (db, documentId, uid) => !!(await first(db, "SELECT 1 FROM signatures WHERE document_id=? AND user_id=?", documentId, uid));
export const hasSignedExt = async (db, documentId, eid) => !!(await first(db, "SELECT 1 FROM signatures WHERE document_id=? AND external_id=?", documentId, eid));
// 서명 사슬의 마지막 봉인값 (플랫폼 전체 기준 — 어느 상인회의 기록을 지워도 사슬이 끊긴다)
export const lastSealHash = async (db) => {
  const r = await first(db, "SELECT record_hash FROM signatures ORDER BY id DESC LIMIT 1");
  return r ? r.record_hash : "";
};
export const listSignatureChain = (db) =>
  all(db, "SELECT id, record_hash, prev_hash, seal_ver FROM signatures ORDER BY id");
export async function createSignature(db, r) {
  await run(db, `INSERT INTO signatures (document_id, user_id, external_id, signer_name, signature_image, content_hash, ip, user_agent, verify_code, record_hash, signed_at, prev_hash, seal_ver, verify_level, fields_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, r.documentId, r.externalId ? null : r.userId, r.externalId || null, r.signerName, r.signatureImage, r.contentHash, r.ip, r.userAgent, r.verifyCode, r.recordHash, r.signedAt, r.prevHash || "", r.sealVer || 3, r.verifyLevel || "password", r.fieldsHash || "");
  return first(db, "SELECT * FROM signatures WHERE id=?", await lastId(db));
}
export const listSignatures = (db, documentId) =>
  all(db, `SELECT s.*, COALESCE(u.email, e.email, '') AS signer_email,
      CASE WHEN s.external_id IS NULL THEN 'member' ELSE 'external' END AS signer_kind,
      COALESCE(e.org, '') AS signer_org
    FROM signatures s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN external_signers e ON e.id = s.external_id
    WHERE s.document_id=? ORDER BY s.signed_at DESC`, documentId);
export const getSignatureByCode = (db, code) => first(db, "SELECT * FROM signatures WHERE verify_code=?", code);

// ----- 공개 API 키 · 웹훅 -----
export const listApiKeys = (db, aid) =>
  all(db, "SELECT * FROM api_keys WHERE association_id=? ORDER BY id DESC", aid);
export const getApiKeyByHash = (db, hash) =>
  first(db, "SELECT * FROM api_keys WHERE key_hash=? AND revoked_at=''", hash);
export const getApiKey = (db, id) => first(db, "SELECT * FROM api_keys WHERE id=?", id);
export async function createApiKey(db, { associationId, name, prefix, keyHash, webhookUrl = "", webhookSecret = "" }) {
  await run(db, `INSERT INTO api_keys (association_id, name, prefix, key_hash, webhook_url, webhook_secret)
    VALUES (?,?,?,?,?,?)`, associationId, name, prefix, keyHash, webhookUrl, webhookSecret);
  return getApiKey(db, await lastId(db));
}
export const revokeApiKey = (db, id, aid) =>
  run(db, "UPDATE api_keys SET revoked_at=datetime('now') WHERE id=? AND association_id=?", id, aid);
export const setApiKeyWebhook = (db, id, aid, url) =>
  run(db, "UPDATE api_keys SET webhook_url=? WHERE id=? AND association_id=?", url, id, aid);
export const touchApiKey = (db, id) =>
  run(db, "UPDATE api_keys SET last_used_at=datetime('now'), calls=calls+1 WHERE id=?", id);

export const queueWebhook = (db, { keyId, event, payload }) =>
  run(db, "INSERT INTO webhook_queue (key_id, event, payload) VALUES (?,?,?)", keyId, event, JSON.stringify(payload));
export const dueWebhooks = (db, limit = 25) =>
  all(db, `SELECT w.*, k.webhook_url, k.webhook_secret FROM webhook_queue w JOIN api_keys k ON k.id=w.key_id
    WHERE w.delivered_at='' AND w.next_try_at <= datetime('now') AND k.revoked_at='' AND k.webhook_url != ''
    ORDER BY w.next_try_at LIMIT ?`, limit);
export const markWebhookDone = (db, id) =>
  run(db, "UPDATE webhook_queue SET delivered_at=datetime('now'), last_error='' WHERE id=?", id);
// 재시도 간격을 점점 늘린다 (1분 → 5 → 25 → …). 6회 실패하면 포기하고 기록만 남긴다.
export const markWebhookFailed = (db, id, attempts, error) =>
  run(db, `UPDATE webhook_queue SET attempts=?, last_error=?,
    next_try_at=datetime('now', ?) WHERE id=?`, attempts, String(error || "").slice(0, 200),
    `+${Math.min(720, Math.pow(5, Math.min(attempts, 4)))} minutes`, id);
export const listWebhooks = (db, keyId, limit = 30) =>
  all(db, "SELECT * FROM webhook_queue WHERE key_id=? ORDER BY id DESC LIMIT ?", keyId, limit);
export const keysWithWebhook = (db, documentId) =>
  all(db, `SELECT k.* FROM api_keys k JOIN documents d ON d.association_id=k.association_id
    WHERE d.id=? AND k.revoked_at='' AND k.webhook_url != ''`, documentId);

// ----- 외부(비회원) 서명자 -----
export const listExternalSigners = (db, documentId) =>
  all(db, `SELECT e.*, EXISTS (SELECT 1 FROM signatures s WHERE s.document_id=e.document_id AND s.external_id=e.id) AS signed
    FROM external_signers e WHERE e.document_id=? ORDER BY e.sign_order, e.id`, documentId);
export const getExternalSigner = (db, id) => first(db, "SELECT * FROM external_signers WHERE id=?", id);
export async function addExternalSigner(db, { documentId, name, email = "", phone = "", org = "", signOrder = 0 }) {
  await run(db, `INSERT INTO external_signers (document_id, name, email, phone, org, sign_order)
    VALUES (?,?,?,?,?,?)`, documentId, name, email, normalizePhone(phone), org, signOrder);
  return getExternalSigner(db, await lastId(db));
}
export const removeExternalSigner = (db, id, documentId) =>
  run(db, "DELETE FROM external_signers WHERE id=? AND document_id=?", id, documentId);
export const markExternalOpened = (db, id) =>
  run(db, "UPDATE external_signers SET opened_at=datetime('now') WHERE id=? AND opened_at=''", id);
export const declineExternal = (db, id, reason) =>
  run(db, "UPDATE external_signers SET declined_at=datetime('now'), decline_reason=? WHERE id=?", reason, id);

// 순차 서명에서 외부 서명자의 차례인가 — 회원·외부를 같은 sign_order 축에서 함께 본다.
export async function canSignNowAny(db, doc, { userId = 0, externalId = 0 }) {
  if (!doc.ordered) return true;
  const mine = externalId
    ? await first(db, "SELECT sign_order FROM external_signers WHERE id=?", externalId)
    : await first(db, "SELECT sign_order FROM signature_requests WHERE document_id=? AND user_id=?", doc.id, userId);
  if (!mine) return true;
  const a = (await first(db, `SELECT COUNT(*) AS n FROM signature_requests r WHERE r.document_id=? AND r.sign_order<?
    AND r.declined_at='' AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.document_id=r.document_id AND s.user_id=r.user_id)`,
    doc.id, mine.sign_order)).n;
  const b = (await first(db, `SELECT COUNT(*) AS n FROM external_signers e WHERE e.document_id=? AND e.sign_order<?
    AND e.declined_at='' AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.document_id=e.document_id AND s.external_id=e.id)`,
    doc.id, mine.sign_order)).n;
  return a + b === 0;
}
// 다음 순번 — 회원과 외부를 합쳐 계산
export const nextSignOrder = async (db, documentId) => {
  const r = await first(db, `SELECT MAX(o) AS m FROM (
    SELECT MAX(sign_order) AS o FROM signature_requests WHERE document_id=?1
    UNION ALL SELECT MAX(sign_order) AS o FROM external_signers WHERE document_id=?1)`, documentId);
  return (r && r.m ? r.m : 0) + 1;
};

// ----- 문서 감사 추적 -----
// 열람은 자주 일어나므로, 같은 사람의 연속 열람은 10분에 한 번만 남긴다(기록 폭주 방지).
export async function logDocEvent(db, { documentId, userId = 0, actorName = "", kind, detail = "", ip = "", userAgent = "", dedupeMin = 0 }) {
  if (dedupeMin > 0) {
    const recent = await first(db, `SELECT 1 AS x FROM doc_events WHERE document_id=? AND user_id=? AND kind=?
      AND created_at > datetime('now', ?) LIMIT 1`, documentId, userId, kind, `-${dedupeMin} minutes`);
    if (recent) return false;
  }
  await run(db, `INSERT INTO doc_events (document_id, user_id, actor_name, kind, detail, ip, user_agent)
    VALUES (?,?,?,?,?,?,?)`, documentId, userId, actorName, kind, detail, ip, String(userAgent || "").slice(0, 200));
  return true;
}
export const listDocEvents = (db, documentId) =>
  all(db, "SELECT * FROM doc_events WHERE document_id=? ORDER BY created_at, id", documentId);

// ----- 계약서 서식(템플릿) -----
export const listTemplates = (db, aid) =>
  all(db, "SELECT * FROM doc_templates WHERE association_id IN (0, ?) ORDER BY association_id, title", aid);
export const getTemplate = (db, id) => first(db, "SELECT * FROM doc_templates WHERE id=?", id);
export async function createTemplate(db, t) {
  await run(db, `INSERT INTO doc_templates (association_id, title, summary, body, fields, parties, ordered, created_by)
    VALUES (?,?,?,?,?,?,?,?)`, t.associationId | 0, t.title, t.summary || "", t.body,
    JSON.stringify(t.fields || []), JSON.stringify(t.parties || []), t.ordered ? 1 : 0, t.createdBy || null);
  return getTemplate(db, await lastId(db));
}
export const deleteTemplate = (db, id, aid) =>
  run(db, "DELETE FROM doc_templates WHERE id=? AND association_id=?", id, aid);
// 서식 본문 고치기 — association_id 를 조건에 함께 넣어, 표준 서식(0)과 남의 서식은
// 어떤 경로로 들어와도 바뀌지 않는다.
export const updateTemplateBody = (db, id, aid, body, fieldsJson) =>
  run(db, "UPDATE doc_templates SET body=?, fields=? WHERE id=? AND association_id=? AND association_id<>0",
    body, fieldsJson, id, aid);
export const countTemplates = async (db, aid) =>
  (await first(db, "SELECT COUNT(*) AS n FROM doc_templates WHERE association_id=?", aid)).n;

// ----- 계약서 필드 (서명·도장·입력 자리) -----
export const listFields = (db, documentId) =>
  all(db, "SELECT * FROM doc_fields WHERE document_id=? ORDER BY page, sort, id", documentId);
export const countFields = async (db, documentId) =>
  (await first(db, "SELECT COUNT(*) AS n FROM doc_fields WHERE document_id=?", documentId)).n;
// 필드 + 채워진 값을 한 번에 (지면 렌더용)
export const listFieldsWithValues = (db, documentId) =>
  all(db, `SELECT f.*, v.value, v.image, v.image_hash, v.user_id AS filled_by, v.filled_at
    FROM doc_fields f LEFT JOIN doc_field_values v ON v.field_id=f.id
    WHERE f.document_id=? ORDER BY f.page, f.sort, f.id`, documentId);
// 배치 저장 — 통째로 갈아끼운다(부분 수정 UI 가 없으므로 단순·안전).
// 이미 서명이 있는 문서는 호출부에서 막는다(서명자가 본 지면이 바뀌면 안 됨).
export async function replaceFields(db, documentId, fields) {
  await run(db, "DELETE FROM doc_fields WHERE document_id=?", documentId);
  let i = 0;
  for (const f of fields) {
    i++;
    await run(db, `INSERT INTO doc_fields (document_id, kind, label, page, x, y, w, h, assignee, slot, auto, required, sort)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, documentId, f.kind, f.label || "", f.page | 0,
      f.x, f.y, f.w, f.h, f.assignee | 0, f.slot | 0, f.auto || "", f.required ? 1 : 0, i);
  }
  return i;
}
// 우리가 채우는 자리 (사람이 아니라 조직이 채운다)
export const listAutoFields = (db, documentId, auto) =>
  all(db, "SELECT * FROM doc_fields WHERE document_id=? AND auto=? ORDER BY page, sort, id", documentId, auto);
// 보낼 때 '몇 번째 당사자' 를 실제 사람으로 바꾼다.
// refs[0] 이 첫 번째 당사자(slot 1). 회원은 양수 user_id, 외부 서명자는 음수(-id).
// 사람이 정해지지 않은 자리는 0(누구나)으로 남는다 — 없는 사람을 가리키는 것보다 낫다.
export async function resolveFieldSlots(db, documentId, refs) {
  let n = 0;
  for (let i = 0; i < refs.length; i++) {
    if (!refs[i]) continue;
    // meta.changes 는 D1 구현마다 다르게 온다 — 세어서 쓴다
    const c = await first(db, "SELECT COUNT(*) AS n FROM doc_fields WHERE document_id=? AND slot=?", documentId, i + 1);
    await run(db, "UPDATE doc_fields SET assignee=? WHERE document_id=? AND slot=?", refs[i], documentId, i + 1);
    n += c.n;
  }
  return n;
}
// 이 문서에 실제로 쓰인 당사자 자리 번호들 (1,2,3…)
export const usedSlots = async (db, documentId) =>
  (await all(db, "SELECT DISTINCT slot FROM doc_fields WHERE document_id=? AND slot>0 ORDER BY slot", documentId)).map((r) => r.slot);

// 당사자 자리의 이름 (임대인·임차인·갑·을). { 1: "임대인", 2: "임차인" }
export async function listDocParties(db, documentId) {
  const out = {};
  for (const r of await all(db, "SELECT slot, name FROM doc_parties WHERE document_id=? ORDER BY slot", documentId)) out[r.slot] = r.name;
  return out;
}
export async function replaceDocParties(db, documentId, names) {
  await run(db, "DELETE FROM doc_parties WHERE document_id=?", documentId);
  for (const [slot, name] of Object.entries(names || {})) {
    if (!name) continue;
    await run(db, "INSERT INTO doc_parties (document_id, slot, name) VALUES (?,?,?)", documentId, Number(slot) | 0, name);
  }
}
// 자리 이름이 있으면 그 이름, 없으면 'N번째 당사자'
export const partyLabel = (names, slot) => (names && names[slot]) || `${slot}번째 당사자`;

// ----- 대량 발송 명단 -----
// 한 번의 요청으로 100건을 보낼 수는 없다(워커의 시간·바깥 요청 한도). 받는 사람을 먼저
// 여기 적어 두고 조금씩 보낸다 — 브라우저를 닫아도 남은 사람이 남고, 보낸 사람에게 두 번 가지 않는다.
export async function createBatch(db, b) {
  await run(db, `INSERT INTO doc_batches (association_id, source_id, title, ordered, due_date, slot, fixed, team_id, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`, b.associationId, b.sourceId, b.title || "", b.ordered ? 1 : 0,
    b.dueDate || "", b.slot | 0, JSON.stringify(b.fixed || []), b.teamId | 0, b.createdBy || null);
  return getBatch(db, await lastId(db));
}
export const getBatch = (db, id) => first(db, "SELECT * FROM doc_batches WHERE id=?", id);
export function listBatches(db, aid, limit = 20, { assoc = null, user = null } = {}) {
  const sc = docScopeSql(assoc, user, 2, "b");
  return all(db, `SELECT b.*,
      (SELECT COUNT(*) FROM doc_batch_rows r WHERE r.batch_id=b.id) AS total,
      (SELECT COUNT(*) FROM doc_batch_rows r WHERE r.batch_id=b.id AND r.status='sent') AS sent,
      (SELECT COUNT(*) FROM doc_batch_rows r WHERE r.batch_id=b.id AND r.status='failed') AS failed
    FROM doc_batches b WHERE b.association_id=?1${sc ? ` AND ${sc.sql}` : ""}
    ORDER BY b.id DESC LIMIT ${Math.max(1, Math.min(100, limit | 0))}`, aid, ...(sc ? sc.args : []));
}
export const canSeeBatch = (assoc, user, b) =>
  !!b && !!assoc && b.association_id === assoc.id
    && (seesAll(assoc, user) || !b.team_id || b.created_by === user.id || (!!user.team_id && user.team_id === b.team_id));
export const deleteBatch = (db, id, aid) =>
  run(db, "DELETE FROM doc_batches WHERE id=? AND association_id=?", id, aid);

export async function addBatchRow(db, batchId, r) {
  await run(db, `INSERT INTO doc_batch_rows (batch_id, seq, name, phone, email, org, vars, status, note)
    VALUES (?,?,?,?,?,?,?,?,?)`, batchId, r.seq | 0, r.name || "", normalizePhone(r.phone || ""),
    r.email || "", r.org || "", JSON.stringify(r.vars || {}), r.status || "pending", r.note || "");
}
export const listBatchRows = (db, batchId) =>
  all(db, "SELECT * FROM doc_batch_rows WHERE batch_id=? ORDER BY seq, id", batchId);
// 다음에 보낼 몇 사람. 상태로 고르므로 같은 사람을 두 번 집지 않는다.
export const nextBatchRows = (db, batchId, limit) =>
  all(db, "SELECT * FROM doc_batch_rows WHERE batch_id=? AND status='pending' ORDER BY seq, id LIMIT ?", batchId, limit);
export const setBatchRow = (db, id, { status, documentId = 0, note = "" }) =>
  run(db, "UPDATE doc_batch_rows SET status=?, document_id=?, note=? WHERE id=?", status, documentId | 0, note, id);
export const batchCounts = (db, batchId) =>
  first(db, `SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
    FROM doc_batch_rows WHERE batch_id=?`, batchId);
// 조사 붙이기 — "임대인가 비어 있습니다" 는 우리가 쓴 글이 아니라 기계가 쓴 글로 읽힌다.
// 마지막 글자에 받침이 있으면 이/은/을, 없으면 가/는/를.
export function withJosa(word, pair) {
  const w = String(word || "");
  const [withBatchim, without] = pair;
  const c = w.charCodeAt(w.length - 1);
  // 한글 음절이 아니면(숫자·영문) 판단하지 않고 받침 있는 쪽을 쓴다 — 더 자주 맞는다
  const has = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : true;
  return w + (has ? withBatchim : without);
}
// 이 사람이 채워야 할 필드 (본인 지정 + 지정 없는 공용 필드).
// auto 자리(우리 직인)는 조직이 이미 찍은 자리라 서명자에게 요구하지 않는다.
export const listFieldsFor = (db, documentId, uid) =>
  all(db, "SELECT * FROM doc_fields WHERE document_id=? AND auto='' AND (assignee=? OR assignee=0) ORDER BY page, sort, id", documentId, uid);
export async function setFieldValue(db, { fieldId, documentId, userId, value = "", image = "", imageHash = "" }) {
  await run(db, `INSERT INTO doc_field_values (field_id, document_id, user_id, value, image, image_hash)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(field_id) DO UPDATE SET value=excluded.value, image=excluded.image,
      image_hash=excluded.image_hash, user_id=excluded.user_id, filled_at=datetime('now')`,
    fieldId, documentId, userId, value, image, imageHash);
}
// 봉인 대상 — 이 사람이 채운 값들 (좌표까지 함께 봉인해 자리 이동 조작을 막는다)
// ref: 회원은 양수 user_id, 외부 서명자는 음수(-external_id)
export const listFilledBy = (db, documentId, ref) =>
  all(db, `SELECT f.id, f.kind, f.page, f.x, f.y, f.w, f.h, v.value, v.image_hash
    FROM doc_fields f JOIN doc_field_values v ON v.field_id=f.id
    WHERE f.document_id=? AND v.user_id=? ORDER BY f.id`, documentId, ref);

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
// ⚠️ UNION ALL 로 6갈래를 합치던 구현은 D1 에서 "too many terms in compound SELECT" 로 실패했습니다.
//    (D1 의 SQLite 는 compound SELECT 항 수 상한이 로컬 SQLite 보다 훨씬 낮습니다.)
//    같은 결과를 상관 서브쿼리 + 스칼라 MAX() 로 바꿔 compound SELECT 를 아예 쓰지 않습니다.
//    시각은 ISO 문자열이라 문자열 비교로도 대소가 맞고, 빈 값은 ''(가장 작음)으로 눌러 둡니다.
export function lastActivityByAssociation(db) {
  const src = (tbl, col = "created_at") =>
    `COALESCE((SELECT MAX(${col}) FROM ${tbl} WHERE association_id = a.id), '')`;
  return all(db, `SELECT a.id AS aid, NULLIF(MAX(
      ${src("businesses", "COALESCE(updated_at, created_at)")},
      ${src("notices")}, ${src("events")}, ${src("posts")},
      ${src("updates")}, ${src("documents")}
    ), '') AS last_at FROM associations a`);
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
export const logMessage = (db, { associationId, channel = "alimtalk", kind = "", recipient = "", status = "sent", cost = 0, costBase = 0, ref = "", detail = "" }) =>
  run(db, "INSERT INTO message_log (association_id, channel, kind, recipient, status, cost, cost_base, ref, detail) VALUES (?,?,?,?,?,?,?,?,?)",
    associationId, channel, kind, recipient, status, Math.trunc(cost) || 0, Math.trunc(costBase) || 0, String(ref || "").slice(0, 60), String(detail || "").slice(0, 300));
// 하루 발송 건수 — 남용 상한 판정용 (channel 별)
export const countMessagesToday = async (db, aid, channel) =>
  (await first(db, `SELECT COUNT(*) AS n FROM message_log WHERE association_id=? AND channel=?
    AND created_at > datetime('now','-1 day')`, aid, channel)).n;
// 같은 주소로 최근에 나간 메일이 있는가 — 비밀번호 재설정 폭탄을 막는다.
// 주소 자체가 아니라 해시 꼬리표로 센다(이력에 원본 주소를 남기지 않기 위함).
export const recentMailByTag = async (db, tag, minutes) =>
  !!(await first(db, `SELECT 1 AS x FROM message_log WHERE channel='email' AND detail LIKE ?
    AND created_at > datetime('now', ?) LIMIT 1`, `%#${tag}%`, `-${minutes | 0} minutes`));
export const listMessages = (db, aid, limit = 50) =>
  all(db, "SELECT * FROM message_log WHERE association_id=? ORDER BY id DESC LIMIT ?", aid, limit);
// 최근 N시간 동안 특정 종류로 나간 발송 건수 — 공개 폼발(發) 알림톡의 남용 상한 판정에 쓴다
export const countMessagesSince = async (db, aid, kinds, hours = 24) => {
  const list = (kinds || []).filter(Boolean);
  if (!list.length) return 0;
  const ph = list.map(() => "?").join(",");
  return (await first(db, `SELECT COUNT(*) AS n FROM message_log
    WHERE association_id=? AND kind IN (${ph}) AND created_at > datetime('now', ?)`,
    aid, ...list, `-${Math.max(1, hours | 0)} hours`)).n;
};
export const messageStats = (db, aid) =>
  first(db, `SELECT COUNT(*) AS n, COALESCE(SUM(cost),0) AS spent,
    COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) AS failed
    FROM message_log WHERE association_id=?`, aid);
// 월별 정산 — 건수·매출(판매가)·원가·마진. 성공 발송만 집계(실패는 환불되어 매출이 아님).
export const monthlySettlement = (db, month) =>
  all(db, `SELECT a.id, a.name,
      COUNT(m.id) AS sent,
      COALESCE(SUM(m.cost),0) AS revenue,
      COALESCE(SUM(m.cost_base),0) AS cost_base
    FROM message_log m JOIN associations a ON a.id=m.association_id
    WHERE m.status='sent' AND strftime('%Y-%m', m.created_at)=?
    GROUP BY a.id, a.name ORDER BY revenue DESC`, month);
// 대사용: 이 플랫폼이 해당 월에 보낸 총 건수 (CPaaS 대시보드 수치와 맞춰 보는 기준)
export const monthlySendCount = (db, month) =>
  first(db, `SELECT COUNT(*) AS sent, COALESCE(SUM(cost),0) AS revenue, COALESCE(SUM(cost_base),0) AS cost_base
    FROM message_log WHERE status='sent' AND strftime('%Y-%m', created_at)=?`, month);
export const settlementMonths = (db) =>
  all(db, `SELECT DISTINCT strftime('%Y-%m', created_at) AS m FROM message_log WHERE status='sent' ORDER BY m DESC LIMIT 12`);

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
      AND (EXISTS (SELECT 1 FROM signature_requests r WHERE r.document_id=d.id AND r.declined_at=''
             AND NOT EXISTS (SELECT 1 FROM signatures s WHERE s.document_id=r.document_id AND s.user_id=r.user_id))
        OR EXISTS (SELECT 1 FROM external_signers e WHERE e.document_id=d.id AND e.declined_at=''
             AND NOT EXISTS (SELECT 1 FROM signatures s2 WHERE s2.document_id=e.document_id AND s2.external_id=e.id)))`);

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

// 외부 서명자 본인확인 — 회원용과 같은 규칙(5분 만료·5회 시도)을 별도 표에 둔다.
export async function upsertExtOtp(db, { externalId, codeHash, phone }) {
  await run(db, `INSERT INTO ext_otp (external_id, code_hash, phone, attempts, verified_at, expires_at)
    VALUES (?,?,?,0,'', datetime('now', '+${OTP_TTL_MIN} minutes'))
    ON CONFLICT(external_id) DO UPDATE SET
      code_hash=excluded.code_hash, phone=excluded.phone, attempts=0, verified_at='',
      expires_at=excluded.expires_at, created_at=datetime('now')`, externalId, codeHash, phone || "");
}
export const getExtOtp = (db, externalId) => first(db, "SELECT * FROM ext_otp WHERE external_id=?", externalId);
export const bumpExtOtpAttempt = (db, id) => run(db, "UPDATE ext_otp SET attempts=attempts+1 WHERE id=?", id);
export const markExtOtpVerified = (db, id) => run(db, "UPDATE ext_otp SET verified_at=datetime('now') WHERE id=?", id);
export const clearExtOtp = (db, externalId) => run(db, "DELETE FROM ext_otp WHERE external_id=?", externalId);
export async function extOtpVerifiedRecently(db, externalId) {
  return !!(await first(db, `SELECT 1 AS ok FROM ext_otp WHERE external_id=?
    AND verified_at != '' AND verified_at > datetime('now','-30 minutes')`, externalId));
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
