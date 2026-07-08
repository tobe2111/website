// 폼 액션 핸들러 (POST): 인증, 업체 수정, 미디어 업로드/삭제, 관리자 액션
import { redirect, readBody, parseUrlEncoded, esc } from "../http.js";
import { setSessionCookie, clearSessionCookie } from "../http.js";
import {
  getUserByEmail,
  createUser,
  verifyPassword,
  createSessionToken,
} from "../auth.js";
import { parseMultipart } from "../multipart.js";
import * as M from "../models.js";
import * as storage from "../storage.js";
import { config } from "../config.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function back(res, to, msg, err = false) {
  const q = `?${err ? "err=1&" : ""}msg=${encodeURIComponent(msg)}`;
  redirect(res, to + (msg ? q : ""));
}

// ---------- 회원가입 ----------
export async function register(req, res) {
  const buf = await readBody(req, 64 * 1024);
  const f = parseUrlEncoded(buf.toString("utf8"));
  const name = (f.name || "").trim();
  const email = (f.email || "").toLowerCase().trim();
  const password = f.password || "";
  const businessName = (f.business_name || "").trim();
  const category = f.category || "기타";

  if (!name || !EMAIL_RE.test(email) || password.length < 8 || !businessName) {
    return back(res, "/register", "입력값을 확인해 주세요. (비밀번호 8자 이상)", true);
  }
  if (getUserByEmail(email)) {
    return back(res, "/register", "이미 가입된 이메일입니다.", true);
  }

  const user = createUser({ email, password, name, role: "MERCHANT" });
  M.createBusiness({ ownerId: user.id, name: businessName, category });

  setSessionCookie(res, createSessionToken({ uid: user.id }));
  back(res, "/dashboard", "가입이 완료되었습니다! 업체 정보를 입력하고 사진·영상을 올려보세요.");
}

// ---------- 로그인 ----------
export async function login(req, res) {
  const buf = await readBody(req, 16 * 1024);
  const f = parseUrlEncoded(buf.toString("utf8"));
  const email = (f.email || "").toLowerCase().trim();
  const password = f.password || "";

  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    return back(res, "/login", "이메일 또는 비밀번호가 올바르지 않습니다.", true);
  }
  setSessionCookie(res, createSessionToken({ uid: user.id }));
  redirect(res, user.role === "ADMIN" ? "/admin" : "/dashboard");
}

// ---------- 로그아웃 ----------
export function logout(req, res) {
  clearSessionCookie(res);
  redirect(res, "/");
}

// ---------- 업체 정보 수정 (회원) ----------
export async function updateBusiness(req, res) {
  const b = M.getBusinessByOwner(req.user.id);
  if (!b) return back(res, "/dashboard", "업체를 찾을 수 없습니다.", true);
  const buf = await readBody(req, 64 * 1024);
  const f = parseUrlEncoded(buf.toString("utf8"));
  if (!(f.name || "").trim()) return back(res, "/dashboard", "업체명을 입력하세요.", true);
  M.updateBusiness(b.id, {
    name: f.name.trim(),
    category: f.category,
    description: f.description,
    phone: f.phone,
    address: f.address,
    hours: f.hours,
  });
  back(res, "/dashboard", "업체 정보가 저장되었습니다.");
}

// ---------- 미디어 업로드 (회원) ----------
export async function uploadMedia(req, res) {
  const b = M.getBusinessByOwner(req.user.id);
  if (!b) return back(res, "/dashboard", "업체를 찾을 수 없습니다.", true);

  let buf;
  try {
    buf = await readBody(req, config.maxVideoBytes + 1024 * 1024);
  } catch {
    return back(res, "/dashboard", "파일이 너무 큽니다. (영상 최대 120MB)", true);
  }

  const contentType = req.headers["content-type"] || "";
  let parsed;
  try {
    parsed = parseMultipart(buf, contentType);
  } catch {
    return back(res, "/dashboard", "업로드 형식이 올바르지 않습니다.", true);
  }

  const caption = (parsed.fields.caption || "").trim();
  const files = parsed.files.filter((x) => x.data && x.data.length > 0);
  if (!files.length) return back(res, "/dashboard", "선택된 파일이 없습니다.", true);

  let ok = 0;
  const errs = [];
  for (const file of files) {
    const ct = file.contentType;
    const isImage = config.allowedImageTypes.includes(ct);
    const isVideo = config.allowedVideoTypes.includes(ct);
    if (!isImage && !isVideo) {
      errs.push(`${file.filename}: 지원하지 않는 형식`);
      continue;
    }
    const limit = isVideo ? config.maxVideoBytes : config.maxImageBytes;
    if (file.data.length > limit) {
      errs.push(`${file.filename}: 용량 초과`);
      continue;
    }
    const filename = storage.save(file.data, ct);
    M.addMedia({
      businessId: b.id,
      kind: isVideo ? "video" : "image",
      filename,
      originalName: file.filename,
      size: file.data.length,
      caption,
    });
    ok++;
  }

  const msg = `${ok}개 업로드 완료.` + (errs.length ? ` 실패: ${errs.join(", ")}` : "");
  back(res, "/dashboard", msg, errs.length > 0 && ok === 0);
}

// ---------- 미디어 삭제 (회원) ----------
export async function deleteMedia(req, res, { params }) {
  const b = M.getBusinessByOwner(req.user.id);
  const m = M.getMedia(Number(params.id));
  if (!b || !m || m.business_id !== b.id) {
    return back(res, "/dashboard", "삭제할 수 없습니다.", true);
  }
  storage.remove(m.filename);
  M.deleteMedia(m.id);
  back(res, "/dashboard", "삭제되었습니다.");
}

// ---------- 관리자: 업체 상태 변경 ----------
export async function adminBusinessStatus(req, res, { params }) {
  const buf = await readBody(req, 8 * 1024);
  const f = parseUrlEncoded(buf.toString("utf8"));
  const status = f.status;
  if (!["approved", "rejected", "pending"].includes(status)) {
    return back(res, "/admin", "잘못된 상태값", true);
  }
  const b = M.getBusinessById(Number(params.id));
  if (!b) return back(res, "/admin", "업체를 찾을 수 없습니다.", true);
  M.setBusinessStatus(b.id, status);
  back(res, "/admin", `'${b.name}' 상태를 변경했습니다.`);
}

// ---------- 관리자: 공지 ----------
export async function adminCreateNotice(req, res) {
  const buf = await readBody(req, 64 * 1024);
  const f = parseUrlEncoded(buf.toString("utf8"));
  if (!(f.title || "").trim()) return back(res, "/admin", "공지 제목을 입력하세요.", true);
  M.createNotice({ title: f.title.trim(), body: f.body, tag: f.tag || "안내", pinned: f.pinned === "1" });
  back(res, "/admin", "공지를 등록했습니다.");
}
export async function adminDeleteNotice(req, res, { params }) {
  M.deleteNotice(Number(params.id));
  back(res, "/admin", "공지를 삭제했습니다.");
}

// ---------- 관리자: 행사 ----------
export async function adminCreateEvent(req, res) {
  const buf = await readBody(req, 64 * 1024);
  const f = parseUrlEncoded(buf.toString("utf8"));
  if (!(f.title || "").trim() || !(f.event_date || "").trim()) {
    return back(res, "/admin", "행사명과 날짜를 입력하세요.", true);
  }
  M.createEvent({ title: f.title.trim(), event_date: f.event_date, place: f.place, description: f.description });
  back(res, "/admin", "행사를 등록했습니다.");
}
export async function adminDeleteEvent(req, res, { params }) {
  M.deleteEvent(Number(params.id));
  back(res, "/admin", "행사를 삭제했습니다.");
}
