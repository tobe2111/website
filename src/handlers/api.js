// 폼 액션 핸들러 (POST) — 멀티테넌트 + 슈퍼관리자
import { redirect, readBody, parseUrlEncoded, setSessionCookie, clearSessionCookie } from "../http.js";
import { getUserByEmail, createUser, verifyPassword, createSessionToken, ROLES } from "../auth.js";
import { parseMultipart } from "../multipart.js";
import * as M from "../models.js";
import * as A from "../associations.js";
import * as storage from "../storage.js";
import { config } from "../config.js";
import { SECTION_CATALOG, parseLayout } from "../homeLayout.js";
import { postLoginPath } from "./pages.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const baseOf = (assoc) => `/t/${assoc.slug}`;

function back(res, to, msg, err = false) {
  const q = msg ? `?${err ? "err=1&" : ""}msg=${encodeURIComponent(msg)}` : "";
  redirect(res, to + q);
}

// ---------- 회원가입 (테넌트) ----------
export async function register(req, res, { assoc }) {
  const base = baseOf(assoc);
  const f = parseUrlEncoded((await readBody(req, 64 * 1024)).toString("utf8"));
  const name = (f.name || "").trim();
  const email = (f.email || "").toLowerCase().trim();
  const password = f.password || "";
  const businessName = (f.business_name || "").trim();
  if (!name || !EMAIL_RE.test(email) || password.length < 8 || !businessName)
    return back(res, base + "/register", "입력값을 확인해 주세요. (비밀번호 8자 이상)", true);
  if (getUserByEmail(email)) return back(res, base + "/register", "이미 가입된 이메일입니다.", true);

  const user = createUser({ email, password, name, role: ROLES.MERCHANT, associationId: assoc.id });
  M.createBusiness({ associationId: assoc.id, ownerId: user.id, name: businessName, category: f.category });
  setSessionCookie(res, createSessionToken({ uid: user.id }));
  back(res, base + "/dashboard", "가입이 완료되었습니다! 업체 정보를 입력하고 사진·영상을 올려보세요.");
}

// ---------- 로그인 (전역) ----------
export async function login(req, res) {
  const f = parseUrlEncoded((await readBody(req, 16 * 1024)).toString("utf8"));
  const email = (f.email || "").toLowerCase().trim();
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(f.password || "", user.salt, user.password_hash))
    return back(res, "/login", "이메일 또는 비밀번호가 올바르지 않습니다.", true);
  setSessionCookie(res, createSessionToken({ uid: user.id }));
  redirect(res, postLoginPath(user));
}

export function logout(req, res) {
  clearSessionCookie(res);
  redirect(res, "/");
}

// ---------- 업체 정보 수정 ----------
export async function updateBusiness(req, res, { assoc }) {
  const base = baseOf(assoc);
  const b = M.getBusinessByOwner(req.user.id);
  if (!b || b.association_id !== assoc.id) return back(res, base + "/dashboard", "업체를 찾을 수 없습니다.", true);
  const f = parseUrlEncoded((await readBody(req, 64 * 1024)).toString("utf8"));
  if (!(f.name || "").trim()) return back(res, base + "/dashboard", "업체명을 입력하세요.", true);
  M.updateBusiness(b.id, { name: f.name.trim(), category: f.category, description: f.description, phone: f.phone, address: f.address, hours: f.hours });
  back(res, base + "/dashboard", "업체 정보가 저장되었습니다.");
}

// ---------- 미디어 업로드 ----------
export async function uploadMedia(req, res, { assoc }) {
  const base = baseOf(assoc);
  const b = M.getBusinessByOwner(req.user.id);
  if (!b || b.association_id !== assoc.id) return back(res, base + "/dashboard", "업체를 찾을 수 없습니다.", true);
  let buf;
  try { buf = await readBody(req, config.maxVideoBytes + 1024 * 1024); }
  catch { return back(res, base + "/dashboard", "파일이 너무 큽니다. (영상 최대 120MB)", true); }
  let parsed;
  try { parsed = parseMultipart(buf, req.headers["content-type"] || ""); }
  catch { return back(res, base + "/dashboard", "업로드 형식이 올바르지 않습니다.", true); }

  const caption = (parsed.fields.caption || "").trim();
  const files = parsed.files.filter((x) => x.data && x.data.length > 0);
  if (!files.length) return back(res, base + "/dashboard", "선택된 파일이 없습니다.", true);

  let ok = 0; const errs = [];
  for (const file of files) {
    const isImage = config.allowedImageTypes.includes(file.contentType);
    const isVideo = config.allowedVideoTypes.includes(file.contentType);
    if (!isImage && !isVideo) { errs.push(`${file.filename}: 지원하지 않는 형식`); continue; }
    if (file.data.length > (isVideo ? config.maxVideoBytes : config.maxImageBytes)) { errs.push(`${file.filename}: 용량 초과`); continue; }
    const filename = storage.save(file.data, file.contentType);
    M.addMedia({ businessId: b.id, kind: isVideo ? "video" : "image", filename, originalName: file.filename, size: file.data.length, caption });
    ok++;
  }
  back(res, base + "/dashboard", `${ok}개 업로드 완료.` + (errs.length ? ` 실패: ${errs.join(", ")}` : ""), errs.length > 0 && ok === 0);
}

export async function deleteMedia(req, res, { assoc, params }) {
  const base = baseOf(assoc);
  const b = M.getBusinessByOwner(req.user.id);
  const m = M.getMedia(Number(params.id));
  if (!b || !m || m.business_id !== b.id) return back(res, base + "/dashboard", "삭제할 수 없습니다.", true);
  storage.remove(m.filename);
  M.deleteMedia(m.id);
  back(res, base + "/dashboard", "삭제되었습니다.");
}

// ---------- 관리자: 업체 상태 ----------
export async function adminBusinessStatus(req, res, { assoc, params }) {
  const base = baseOf(assoc);
  const f = parseUrlEncoded((await readBody(req, 8 * 1024)).toString("utf8"));
  if (!["approved", "rejected", "pending"].includes(f.status)) return back(res, base + "/admin", "잘못된 상태값", true);
  const b = M.getBusinessById(Number(params.id));
  if (!b || b.association_id !== assoc.id) return back(res, base + "/admin", "업체를 찾을 수 없습니다.", true);
  M.setBusinessStatus(b.id, f.status);
  back(res, base + "/admin", `'${b.name}' 상태를 변경했습니다.`);
}

// ---------- 관리자: 공지 ----------
export async function adminCreateNotice(req, res, { assoc }) {
  const base = baseOf(assoc);
  const f = parseUrlEncoded((await readBody(req, 64 * 1024)).toString("utf8"));
  if (!(f.title || "").trim()) return back(res, base + "/admin", "공지 제목을 입력하세요.", true);
  M.createNotice({ associationId: assoc.id, title: f.title.trim(), body: f.body, tag: f.tag || "안내", pinned: f.pinned === "1" });
  back(res, base + "/admin", "공지를 등록했습니다.");
}
export async function adminDeleteNotice(req, res, { assoc, params }) {
  const base = baseOf(assoc);
  const n = M.getNotice(Number(params.id));
  if (n && n.association_id === assoc.id) M.deleteNotice(n.id);
  back(res, base + "/admin", "공지를 삭제했습니다.");
}

// ---------- 관리자: 행사 ----------
export async function adminCreateEvent(req, res, { assoc }) {
  const base = baseOf(assoc);
  const f = parseUrlEncoded((await readBody(req, 64 * 1024)).toString("utf8"));
  if (!(f.title || "").trim() || !(f.event_date || "").trim()) return back(res, base + "/admin", "행사명과 날짜를 입력하세요.", true);
  M.createEvent({ associationId: assoc.id, title: f.title.trim(), event_date: f.event_date, place: f.place, description: f.description });
  back(res, base + "/admin", "행사를 등록했습니다.");
}
export async function adminDeleteEvent(req, res, { assoc, params }) {
  const base = baseOf(assoc);
  const e = M.getEvent(Number(params.id));
  if (e && e.association_id === assoc.id) M.deleteEvent(e.id);
  back(res, base + "/admin", "행사를 삭제했습니다.");
}

// ---------- 관리자: 상인회 브랜딩 설정 ----------
export async function adminSettings(req, res, { assoc }) {
  const base = baseOf(assoc);
  const f = parseUrlEncoded((await readBody(req, 16 * 1024)).toString("utf8"));
  if (!(f.name || "").trim()) return back(res, base + "/admin", "상인회 이름을 입력하세요.", true);
  const color = /^#[0-9a-fA-F]{6}$/.test(f.brand_color || "") ? f.brand_color : assoc.brand_color;
  A.updateAssociation(assoc.id, {
    name: f.name.trim(), tagline: f.tagline, brand_color: color,
    phone: f.phone, email: f.email, address: f.address,
  });
  back(res, base + "/admin", "상인회 정보가 저장되었습니다.");
}

// ---------- 관리자: 홈페이지 구성 저장 ----------
export async function adminSaveLayout(req, res, { assoc }) {
  const base = baseOf(assoc);
  const f = parseUrlEncoded((await readBody(req, 128 * 1024)).toString("utf8"));
  const order = (f.order || "").split(",").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  const built = [];
  for (const i of order) {
    const type = f[`ty_${i}`];
    const cat = SECTION_CATALOG[type];
    if (!cat) continue;
    const sec = { type, enabled: f[`en_${i}`] === "1" };
    for (const field of cat.fields) {
      const key = `f_${i}_${field.key}`;
      if (field.type === "bool") sec[field.key] = f[key] === "1";
      else sec[field.key] = f[key] != null ? f[key] : "";
    }
    built.push(sec);
  }
  if (!built.length) return back(res, base + "/admin", "구성을 해석할 수 없습니다.", true);
  A.saveHomeLayout(assoc.id, built);
  back(res, base + "/admin", "홈페이지 구성이 저장되었습니다.");
}
export async function adminResetLayout(req, res, { assoc }) {
  const base = baseOf(assoc);
  await readBody(req, 8 * 1024).catch(() => {});
  A.resetHomeLayout(assoc.id);
  back(res, base + "/admin", "홈페이지 구성을 기본값으로 초기화했습니다.");
}

// ---------- 슈퍼관리자: 새 상인회 생성(사이트 복제) ----------
export async function superCreateAssociation(req, res) {
  const f = parseUrlEncoded((await readBody(req, 32 * 1024)).toString("utf8"));
  const name = (f.name || "").trim();
  const adminEmail = (f.admin_email || "").toLowerCase().trim();
  const adminPassword = f.admin_password || "";
  if (!name || !EMAIL_RE.test(adminEmail) || adminPassword.length < 8)
    return back(res, "/super", "상인회 이름과 관리자 계정을 확인해 주세요. (비밀번호 8자 이상)", true);
  if (getUserByEmail(adminEmail)) return back(res, "/super", "이미 사용 중인 관리자 이메일입니다.", true);
  const color = /^#[0-9a-fA-F]{6}$/.test(f.brand_color || "") ? f.brand_color : "#0b6e4f";

  const { association } = A.provisionAssociation({
    name, brandColor: color, tagline: f.tagline,
    adminName: f.admin_name, adminEmail, adminPassword,
    seedSamples: f.seed === "1",
  });
  back(res, "/super", `'${name}' 상인회 사이트가 생성되었습니다. (주소: /t/${association.slug}, 관리자: ${adminEmail})`);
}

export async function superToggleAssociation(req, res, { params }) {
  await readBody(req, 8 * 1024).catch(() => {});
  const a = A.getAssociationById(Number(params.id));
  if (!a) return back(res, "/super", "상인회를 찾을 수 없습니다.", true);
  A.setActive(a.id, a.active ? 0 : 1);
  back(res, "/super", `'${a.name}' 상태를 변경했습니다.`);
}
