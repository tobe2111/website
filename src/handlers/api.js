// 폼 액션 핸들러 (POST) — 멀티테넌트 + 슈퍼관리자 + 보안 하드닝
import { redirect, readBody, parseUrlEncoded, readForm, setSessionCookie, clearSessionCookie, cap } from "../http.js";
import { getUserByEmail, getUserById, createUser, verifyPassword, sessionTokenForUser, updatePassword, bumpSessionVersion, ROLES } from "../auth.js";
import crypto from "node:crypto";
import { parseMultipart } from "../multipart.js";
import * as csrf from "../csrf.js";
import * as mailer from "../mailer.js";
import { sniff } from "../filetype.js";
import { contentHash, sealRecord, newVerifyCode } from "../esign.js";
import * as M from "../models.js";
import * as A from "../associations.js";
import * as storage from "../storage.js";
import * as media from "../media.js";
import { makeSemaphore } from "../semaphore.js";
import { config } from "../config.js";

// 동시 업로드 제한 (대용량 바디 버퍼링의 메모리 사용을 바운드)
const uploadSem = makeSemaphore(config.maxConcurrentUploads);
import { SECTION_CATALOG, parseLayout } from "../homeLayout.js";
import { postLoginPath } from "./pages.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const baseOf = (assoc) => (assoc && assoc._base != null ? assoc._base : `/t/${assoc.slug}`);

function back(res, to, msg, err = false) {
  const q = msg ? `?${err ? "err=1&" : ""}msg=${encodeURIComponent(msg)}` : "";
  redirect(res, to + q);
}
function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
}

// ---------- 로그인 시도 제한 (in-memory 슬라이딩 윈도우) ----------
const attempts = new Map(); // ip -> { count, first }
const RL_WINDOW = 15 * 60 * 1000;
const RL_MAX = 8;
function rateLimited(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > RL_WINDOW) { attempts.delete(ip); return false; }
  return rec.count >= RL_MAX;
}
function recordFail(ip) {
  const rec = attempts.get(ip);
  const now = Date.now();
  if (!rec || now - rec.first > RL_WINDOW) attempts.set(ip, { count: 1, first: now });
  else rec.count++;
  if (attempts.size > 5000) for (const [k, v] of attempts) if (now - v.first > RL_WINDOW) attempts.delete(k);
}
function clearFails(ip) { attempts.delete(ip); }

// ---------- 회원가입 (테넌트) ----------
export async function register(req, res, { assoc }) {
  const base = baseOf(assoc);
  const f = await readForm(req, res, 64 * 1024);
  if (!f) return;
  const name = cap((f.name || "").trim(), 60);
  const email = cap((f.email || "").toLowerCase().trim(), 120);
  const password = f.password || "";
  const businessName = cap((f.business_name || "").trim(), 100);
  if (!name || !EMAIL_RE.test(email) || password.length < 8 || password.length > 200 || !businessName)
    return back(res, base + "/register", "입력값을 확인해 주세요. (비밀번호 8~200자)", true);
  if (getUserByEmail(email)) return back(res, base + "/register", "이미 가입된 이메일입니다.", true);

  const user = createUser({ email, password, name, role: ROLES.MERCHANT, associationId: assoc.id });
  M.createBusiness({ associationId: assoc.id, ownerId: user.id, name: businessName, category: cap(f.category, 40) });
  // 관리자에게 앱 내 알림(+ 메일 훅) — 승인 대기
  M.createNotification({ associationId: assoc.id, kind: "new_business", message: `${name}님이 '${businessName}' 업체로 가입했습니다. 승인 대기 중입니다.`, link: base + "/admin" });
  mailer.send({ to: assoc.email || "관리자", subject: `[${assoc.name}] 새 업체 가입 신청`, text: `${name} / ${businessName} — 승인 대기` });
  setSessionCookie(res, sessionTokenForUser(user));
  back(res, base + "/dashboard", "가입이 완료되었습니다! 업체 정보를 입력하고 사진·영상을 올려보세요.");
}

// ---------- 로그인 (전역, 시도 제한) ----------
export async function login(req, res) {
  const ip = clientIp(req);
  const f = await readForm(req, res, 16 * 1024);
  if (!f) return;
  if (rateLimited(ip))
    return back(res, "/login", "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.", true);

  const email = (f.email || "").toLowerCase().trim();
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(f.password || "", user.salt, user.password_hash)) {
    recordFail(ip);
    return back(res, "/login", "이메일 또는 비밀번호가 올바르지 않습니다.", true);
  }
  clearFails(ip);
  setSessionCookie(res, sessionTokenForUser(user));
  redirect(res, postLoginPath(user, req));
}

export async function logout(req, res) {
  const f = await readForm(req, res, 8 * 1024); // CSRF 검증
  if (!f) return;
  clearSessionCookie(res);
  redirect(res, "/");
}

// ---------- 비밀번호 찾기(내부 처리): 관리자에게 재설정 요청 알림 ----------
export async function forgotPassword(req, res) {
  const f = await readForm(req, res, 8 * 1024);
  if (!f) return;
  const email = (f.email || "").toLowerCase().trim();
  const user = email ? getUserByEmail(email) : null;
  if (user) {
    const link = user.association_id
      ? (() => { const a = A.getAssociationById(user.association_id); return a ? `/t/${a.slug}/admin` : "/super"; })()
      : "/super";
    M.createNotification({
      associationId: user.association_id, kind: "password_reset",
      message: `비밀번호 재설정 요청: ${user.name} (${user.email})`, link,
    });
    mailer.send({ to: "관리자", subject: "비밀번호 재설정 요청", text: `${user.email} 회원이 재설정을 요청했습니다.` });
  }
  // 이메일 존재 여부를 노출하지 않도록 항상 동일 응답
  back(res, "/forgot", "요청이 접수되었습니다. 상인회 관리자가 확인 후 임시 비밀번호를 안내해 드립니다.");
}

// 임시 비밀번호 생성 (읽기 쉬운 형태)
function tempPassword() {
  return crypto.randomBytes(6).toString("base64url"); // 8자 내외
}

// ---------- 관리자: 소속 회원 비밀번호 재설정 ----------
export async function adminResetUserPassword(req, res, { assoc, params }) {
  const base = baseOf(assoc);
  const f = await readForm(req, res, 8 * 1024);
  if (!f) return;
  const target = getUserById(Number(params.id));
  // 관리자는 자기 상인회의 회원(MERCHANT)만 재설정 가능
  if (!target || target.association_id !== assoc.id || target.role !== ROLES.MERCHANT)
    return back(res, base + "/admin", "대상 회원을 찾을 수 없습니다.", true);
  const temp = tempPassword();
  updatePassword(target.id, temp);
  mailer.send({ to: target.email, subject: "임시 비밀번호 발급", text: `임시 비밀번호: ${temp}` });
  back(res, base + "/admin", `${target.name}님 임시 비밀번호: ${temp} — 회원에게 전달하고 로그인 후 변경하도록 안내하세요.`);
}

// ---------- 슈퍼: 관리자/회원 비밀번호 재설정 ----------
export async function superResetUserPassword(req, res, { params }) {
  const f = await readForm(req, res, 8 * 1024);
  if (!f) return;
  const target = getUserById(Number(params.id));
  if (!target || target.role === ROLES.SUPERADMIN)
    return back(res, "/super", "대상을 찾을 수 없습니다.", true);
  const temp = tempPassword();
  updatePassword(target.id, temp);
  mailer.send({ to: target.email, subject: "임시 비밀번호 발급", text: `임시 비밀번호: ${temp}` });
  back(res, "/super", `${target.name}(${target.email}) 임시 비밀번호: ${temp} — 전달 후 변경 안내하세요.`);
}

// ---------- 알림 읽음 처리 ----------
export async function adminReadNotifications(req, res, { assoc }) {
  const base = baseOf(assoc);
  const f = await readForm(req, res, 8 * 1024);
  if (!f) return;
  M.markAllNotificationsRead(assoc.id);
  back(res, base + "/admin", "알림을 모두 읽음 처리했습니다.");
}
export async function superReadNotifications(req, res) {
  const f = await readForm(req, res, 8 * 1024);
  if (!f) return;
  M.markAllNotificationsRead(null);
  back(res, "/super", "알림을 모두 읽음 처리했습니다.");
}

// ---------- 계정: 비밀번호 변경 ----------
export async function changePassword(req, res) {
  const f = await readForm(req, res, 16 * 1024);
  if (!f) return;
  const u = req.user;
  if (!verifyPassword(f.current || "", u.salt, u.password_hash))
    return back(res, "/account", "현재 비밀번호가 올바르지 않습니다.", true);
  const next = f.new || "";
  if (next.length < 8) return back(res, "/account", "새 비밀번호는 8자 이상이어야 합니다.", true);
  if (next !== (f.confirm || "")) return back(res, "/account", "새 비밀번호 확인이 일치하지 않습니다.", true);
  const updated = updatePassword(u.id, next);
  setSessionCookie(res, sessionTokenForUser(updated)); // 현재 세션 유지
  back(res, "/account", "비밀번호가 변경되었습니다. 다른 기기의 세션은 모두 로그아웃되었습니다.");
}

// ---------- 계정: 모든 기기 로그아웃 ----------
export async function logoutAll(req, res) {
  const f = await readForm(req, res, 8 * 1024);
  if (!f) return;
  bumpSessionVersion(req.user.id);
  clearSessionCookie(res);
  redirect(res, "/login?msg=" + encodeURIComponent("모든 기기에서 로그아웃되었습니다."));
}

// ---------- 업체 정보 수정 ----------
export async function updateBusiness(req, res, { assoc }) {
  const base = baseOf(assoc);
  const b = M.getBusinessByOwner(req.user.id);
  if (!b || b.association_id !== assoc.id) return back(res, base + "/dashboard", "업체를 찾을 수 없습니다.", true);
  const f = await readForm(req, res, 64 * 1024);
  if (!f) return;
  if (!(f.name || "").trim()) return back(res, base + "/dashboard", "업체명을 입력하세요.", true);
  M.updateBusiness(b.id, {
    name: cap(f.name.trim(), 100), category: cap(f.category, 40),
    description: cap(f.description, 2000), phone: cap(f.phone, 40),
    address: cap(f.address, 200), hours: cap(f.hours, 100),
  });
  back(res, base + "/dashboard", "업체 정보가 저장되었습니다.");
}

// ---------- 미디어 업로드 (멀티파트) ----------
export async function uploadMedia(req, res, { assoc }) {
  const base = baseOf(assoc);
  const b = M.getBusinessByOwner(req.user.id);
  if (!b || b.association_id !== assoc.id) return back(res, base + "/dashboard", "업체를 찾을 수 없습니다.", true);

  await uploadSem.acquire();
  try {
    return await doUpload(req, res, { assoc, base, b });
  } finally {
    uploadSem.release();
  }
}

async function doUpload(req, res, { assoc, base, b }) {
  let buf;
  try { buf = await readBody(req, config.maxVideoBytes + 1024 * 1024); }
  catch { return back(res, base + "/dashboard", "파일이 너무 큽니다. (영상 최대 120MB)", true); }
  let parsed;
  try { parsed = parseMultipart(buf, req.headers["content-type"] || ""); }
  catch { return back(res, base + "/dashboard", "업로드 형식이 올바르지 않습니다.", true); }

  if (!csrf.valid(req, parsed.fields._csrf)) {
    res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" }); return res.end("<h1>403 잘못된 요청(CSRF)</h1>");
  }

  const caption = cap((parsed.fields.caption || "").trim(), 200);
  const files = parsed.files.filter((x) => x.data && x.data.length > 0);
  if (!files.length) return back(res, base + "/dashboard", "선택된 파일이 없습니다.", true);

  let ok = 0; const errs = [];
  for (const file of files) {
    // 매직바이트로 실제 형식 판별 (선언 MIME 불신)
    const real = sniff(file.data);
    const isImage = real && config.allowedImageTypes.includes(real);
    const isVideo = real && config.allowedVideoTypes.includes(real);
    if (!isImage && !isVideo) { errs.push(`${file.filename}: 지원하지 않는 형식`); continue; }
    if (file.data.length > (isVideo ? config.maxVideoBytes : config.maxImageBytes)) { errs.push(`${file.filename}: 용량 초과`); continue; }
    if (isVideo) {
      const processed = await media.processVideo(file.data, real);
      const filename = await storage.save(processed.buffer, processed.contentType);
      let posterKey = "";
      if (processed.poster) posterKey = await storage.save(processed.poster, "image/jpeg");
      M.addMedia({ businessId: b.id, kind: "video", filename, poster: posterKey, originalName: file.filename, size: processed.buffer.length, caption });
    } else {
      const filename = await storage.save(file.data, real);
      M.addMedia({ businessId: b.id, kind: "image", filename, originalName: file.filename, size: file.data.length, caption });
    }
    ok++;
  }
  back(res, base + "/dashboard", `${ok}개 업로드 완료.` + (errs.length ? ` 실패: ${errs.join(", ")}` : ""), errs.length > 0 && ok === 0);
}

export async function deleteMedia(req, res, { assoc, params }) {
  const base = baseOf(assoc);
  const f = await readForm(req, res, 8 * 1024);
  if (!f) return;
  const b = M.getBusinessByOwner(req.user.id);
  const m = M.getMedia(Number(params.id));
  if (!b || !m || m.business_id !== b.id) return back(res, base + "/dashboard", "삭제할 수 없습니다.", true);
  await storage.remove(m.filename);
  if (m.poster) await storage.remove(m.poster);
  M.deleteMedia(m.id);
  back(res, base + "/dashboard", "삭제되었습니다.");
}

// ---------- 관리자: 업체 상태 ----------
export async function adminBusinessStatus(req, res, { assoc, params }) {
  const base = baseOf(assoc);
  const f = await readForm(req, res, 8 * 1024);
  if (!f) return;
  if (!["approved", "rejected", "pending"].includes(f.status)) return back(res, base + "/admin", "잘못된 상태값", true);
  const b = M.getBusinessById(Number(params.id));
  if (!b || b.association_id !== assoc.id) return back(res, base + "/admin", "업체를 찾을 수 없습니다.", true);
  M.setBusinessStatus(b.id, f.status);
  back(res, base + "/admin", `'${b.name}' 상태를 변경했습니다.`);
}

// ---------- 관리자: 공지 ----------
export async function adminCreateNotice(req, res, { assoc }) {
  const base = baseOf(assoc);
  const f = await readForm(req, res, 64 * 1024);
  if (!f) return;
  if (!(f.title || "").trim()) return back(res, base + "/admin", "공지 제목을 입력하세요.", true);
  M.createNotice({ associationId: assoc.id, title: cap(f.title.trim(), 200), body: cap(f.body, 10000), tag: cap(f.tag || "안내", 20), pinned: f.pinned === "1" });
  back(res, base + "/admin", "공지를 등록했습니다.");
}
export async function adminDeleteNotice(req, res, { assoc, params }) {
  const base = baseOf(assoc);
  const f = await readForm(req, res, 8 * 1024);
  if (!f) return;
  const n = M.getNotice(Number(params.id));
  if (n && n.association_id === assoc.id) M.deleteNotice(n.id);
  back(res, base + "/admin", "공지를 삭제했습니다.");
}

// ---------- 관리자: 행사 ----------
export async function adminCreateEvent(req, res, { assoc }) {
  const base = baseOf(assoc);
  const f = await readForm(req, res, 64 * 1024);
  if (!f) return;
  if (!(f.title || "").trim() || !(f.event_date || "").trim()) return back(res, base + "/admin", "행사명과 날짜를 입력하세요.", true);
  M.createEvent({ associationId: assoc.id, title: cap(f.title.trim(), 200), event_date: cap(f.event_date, 10), place: cap(f.place, 120), description: cap(f.description, 2000) });
  back(res, base + "/admin", "행사를 등록했습니다.");
}
export async function adminDeleteEvent(req, res, { assoc, params }) {
  const base = baseOf(assoc);
  const f = await readForm(req, res, 8 * 1024);
  if (!f) return;
  const e = M.getEvent(Number(params.id));
  if (e && e.association_id === assoc.id) M.deleteEvent(e.id);
  back(res, base + "/admin", "행사를 삭제했습니다.");
}

// ---------- 전자서명: 관리자 문서 생성 ----------
export async function adminCreateDocument(req, res, { assoc }) {
  const base = baseOf(assoc);
  const f = await readForm(req, res, 128 * 1024);
  if (!f) return;
  const title = cap((f.title || "").trim(), 200);
  const bodyText = cap((f.body || "").trim(), 20000);
  if (!title || !bodyText) return back(res, base + "/admin/documents", "제목과 본문을 입력하세요.", true);
  M.createDocument({ associationId: assoc.id, title, body: bodyText, contentHash: contentHash(bodyText), createdBy: req.user.id });
  back(res, base + "/admin/documents", "문서를 생성했습니다. 회원 대시보드에 서명 요청으로 표시됩니다.");
}
export async function adminCloseDocument(req, res, { assoc, params }) {
  const base = baseOf(assoc);
  const f = await readForm(req, res, 8 * 1024);
  if (!f) return;
  const d = M.getDocument(Number(params.id));
  if (d && d.association_id === assoc.id) M.closeDocument(d.id);
  back(res, base + "/admin/documents", "문서를 마감했습니다.");
}

// ---------- 전자서명: 회원 서명 제출 ----------
export async function memberSign(req, res, { assoc, params }) {
  const base = baseOf(assoc);
  const d = M.getDocument(Number(params.id));
  if (!d || d.association_id !== assoc.id) return back(res, base + "/sign", "문서를 찾을 수 없습니다.", true);
  const f = await readForm(req, res, 2 * 1024 * 1024); // 서명 이미지(dataURL) 수용
  if (!f) return;
  if (d.closed) return back(res, base + "/sign", "마감된 문서입니다.", true);
  if (M.hasSigned(d.id, req.user.id)) return back(res, base + "/sign", "이미 서명한 문서입니다.", true);
  if (f.consent !== "1") return back(res, base + "/sign/" + d.id, "동의 확인란에 체크해 주세요.", true);

  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(f.signature || "");
  if (!m) return back(res, base + "/sign/" + d.id, "서명을 입력해 주세요.", true);
  let imgBuf;
  try { imgBuf = Buffer.from(m[1], "base64"); } catch { imgBuf = null; }
  if (!imgBuf || imgBuf.length < 64 || imgBuf.length > 500 * 1024 || sniff(imgBuf) !== "image/png")
    return back(res, base + "/sign/" + d.id, "서명 이미지가 올바르지 않습니다.", true);

  const signerName = cap((f.signer_name || "").trim(), 60) || req.user.name;
  const sigKey = await storage.save(imgBuf, "image/png");
  const signedAt = new Date().toISOString();
  const ip = clientIp(req);
  const ch = d.content_hash; // 서명 시점 문서 해시(불변 본문)
  const recordHash = sealRecord({ documentId: d.id, userId: req.user.id, signerName, contentHash: ch, signedAt, ip });
  const verifyCode = newVerifyCode();
  M.createSignature({
    documentId: d.id, userId: req.user.id, signerName, signatureImage: sigKey,
    contentHash: ch, ip, userAgent: cap(req.headers["user-agent"] || "", 200),
    verifyCode, recordHash, signedAt,
  });
  // 관리자 알림
  M.createNotification({ associationId: assoc.id, kind: "signed", message: `${signerName}님이 '${d.title}'에 전자서명했습니다.`, link: base + "/admin/documents/" + d.id });
  back(res, base + "/sign", `전자서명이 완료되었습니다. 검증 코드: ${verifyCode}`);
}

// ---------- 관리자: 상인회 브랜딩 설정 (+ 로고 업로드, 멀티파트) ----------
export async function adminSettings(req, res, { assoc }) {
  const base = baseOf(assoc);
  let buf;
  try { buf = await readBody(req, config.maxLogoBytes + 64 * 1024); }
  catch { return back(res, base + "/admin", "로고 파일이 너무 큽니다. (최대 2MB)", true); }

  let fields = {}, files = [];
  const ct = req.headers["content-type"] || "";
  if (ct.includes("multipart/form-data")) {
    try { const p = parseMultipart(buf, ct); fields = p.fields; files = p.files; }
    catch { return back(res, base + "/admin", "폼 형식이 올바르지 않습니다.", true); }
  } else {
    fields = parseUrlEncoded(buf.toString("utf8"));
  }
  if (!csrf.valid(req, fields._csrf)) {
    res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" }); return res.end("<h1>403 잘못된 요청(CSRF)</h1>");
  }

  if (!(fields.name || "").trim()) return back(res, base + "/admin", "상인회 이름을 입력하세요.", true);
  const color = /^#[0-9a-fA-F]{6}$/.test(fields.brand_color || "") ? fields.brand_color : assoc.brand_color;

  let logoKey = assoc.logo;
  const logoFile = files.find((x) => x.field === "logo" && x.data && x.data.length > 0);
  if (logoFile) {
    const real = sniff(logoFile.data);
    if (!real || !config.allowedImageTypes.includes(real))
      return back(res, base + "/admin", "로고는 이미지 파일만 가능합니다.", true);
    if (logoFile.data.length > config.maxLogoBytes)
      return back(res, base + "/admin", "로고 용량이 큽니다. (최대 2MB)", true);
    const newKey = await storage.save(logoFile.data, real);
    if (assoc.logo) await storage.remove(assoc.logo);
    logoKey = newKey;
  } else if (fields.remove_logo === "1" && assoc.logo) {
    await storage.remove(assoc.logo);
    logoKey = "";
  }

  A.updateAssociation(assoc.id, {
    name: cap(fields.name.trim(), 100), tagline: cap(fields.tagline, 200), brand_color: color,
    phone: cap(fields.phone, 40), email: cap(fields.email, 120), address: cap(fields.address, 200), logo: logoKey,
  });
  back(res, base + "/admin", "상인회 정보가 저장되었습니다.");
}

// ---------- 관리자: 홈페이지 구성 저장 ----------
export async function adminSaveLayout(req, res, { assoc }) {
  const base = baseOf(assoc);
  const f = await readForm(req, res, 128 * 1024);
  if (!f) return;
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
      else sec[field.key] = cap(f[key] != null ? f[key] : "", 600);
    }
    built.push(sec);
  }
  if (!built.length) return back(res, base + "/admin", "구성을 해석할 수 없습니다.", true);
  A.saveHomeLayout(assoc.id, built);
  back(res, base + "/admin", "홈페이지 구성이 저장되었습니다.");
}
export async function adminResetLayout(req, res, { assoc }) {
  const base = baseOf(assoc);
  const f = await readForm(req, res, 8 * 1024);
  if (!f) return;
  A.resetHomeLayout(assoc.id);
  back(res, base + "/admin", "홈페이지 구성을 기본값으로 초기화했습니다.");
}

// ---------- 슈퍼관리자: 새 상인회 생성(사이트 복제) ----------
export async function superCreateAssociation(req, res) {
  const f = await readForm(req, res, 32 * 1024);
  if (!f) return;
  const name = cap((f.name || "").trim(), 100);
  const adminEmail = cap((f.admin_email || "").toLowerCase().trim(), 120);
  const adminPassword = f.admin_password || "";
  if (!name || !EMAIL_RE.test(adminEmail) || adminPassword.length < 8 || adminPassword.length > 200)
    return back(res, "/super", "상인회 이름과 관리자 계정을 확인해 주세요. (비밀번호 8~200자)", true);
  if (getUserByEmail(adminEmail)) return back(res, "/super", "이미 사용 중인 관리자 이메일입니다.", true);
  const color = /^#[0-9a-fA-F]{6}$/.test(f.brand_color || "") ? f.brand_color : "#0b6e4f";

  const { association } = A.provisionAssociation({
    name, brandColor: color, tagline: cap(f.tagline, 200),
    adminName: cap(f.admin_name, 60), adminEmail, adminPassword,
    seedSamples: f.seed === "1",
  });
  back(res, "/super", `'${name}' 상인회 사이트가 생성되었습니다. (주소: /t/${association.slug}, 관리자: ${adminEmail})`);
}

export async function superToggleAssociation(req, res, { params }) {
  const f = await readForm(req, res, 8 * 1024);
  if (!f) return;
  const a = A.getAssociationById(Number(params.id));
  if (!a) return back(res, "/super", "상인회를 찾을 수 없습니다.", true);
  A.setActive(a.id, a.active ? 0 : 1);
  back(res, "/super", `'${a.name}' 상태를 변경했습니다.`);
}
