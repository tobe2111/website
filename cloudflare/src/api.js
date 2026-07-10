// 폼 처리 핸들러 (POST). ctx.form 은 파싱된 FormData.
import * as D from "./db.js";
import { verifyPassword, hashPassword } from "./crypto.js";
import { sessionTokenForUser, sessionCookie, clearSessionCookie } from "./auth.js";
import { back, redirect } from "./http.js";
import * as storage from "./storage.js";
import { parseEmbed } from "./embed.js";
import { cap, sniffImage, EMAIL_RE, MAX_IMAGE_BYTES, slugify } from "./util.js";
import { contentHash, sealRecord, newVerifyCode } from "./esign.js";
import { turnstileVerify } from "./turnstile.js";

const BOARD_MAX_IMAGES = 6;
const MAX_EMBEDS = 30;

// FormData 파일들을 R2 에 저장(썸네일은 Workers 에선 원본 사용) → { images } 또는 { error }
async function saveImages(env, files, max) {
  const hasFiles = files.some((f) => f && typeof f.arrayBuffer === "function" && f.size);
  if (hasFiles && !storage.enabled(env))
    return { error: "사진 저장소(R2)가 아직 연결되지 않아 사진을 올릴 수 없습니다. 영상 링크는 바로 사용할 수 있어요." };
  const out = [];
  for (const f of files.slice(0, max)) {
    if (!f || typeof f.arrayBuffer !== "function" || !f.size) continue;
    const buf = new Uint8Array(await f.arrayBuffer());
    const real = sniffImage(buf);
    if (!real) return { error: "이미지 파일만 첨부할 수 있습니다." };
    if (buf.byteLength > MAX_IMAGE_BYTES) return { error: "이미지 용량이 큽니다. (최대 8MB)" };
    const key = await storage.save(env, buf, real);
    out.push({ filename: key, thumb: "" });
  }
  return { images: out };
}
const canModerateBoard = (user, assoc) => user && (user.role === "SUPERADMIN" || (user.role === "ADMIN" && user.association_id === assoc.id));

// 로그인 후 이동 경로
export async function postLoginPath(db, user) {
  if (user.role === "SUPERADMIN") return "/super";
  const a = user.association_id ? await D.getAssociationById(db, user.association_id) : null;
  const base = a ? `/t/${a.slug}` : "";
  if (user.role === "ADMIN") return base + "/admin";
  return base + "/dashboard";
}

// 최소 침입 레이트리밋 (isolate 로컬, best-effort)
const attempts = new Map();
function rateLimited(ip) {
  const r = attempts.get(ip); if (!r) return false;
  if (Date.now() - r.first > 15 * 60 * 1000) { attempts.delete(ip); return false; }
  return r.count >= 8;
}
function recordFail(ip) {
  const now = Date.now(); const r = attempts.get(ip);
  if (!r || now - r.first > 15 * 60 * 1000) attempts.set(ip, { count: 1, first: now }); else r.count++;
}

export async function login(ctx) {
  const { db, form, env, addCookie, isProd, ip } = ctx;
  if (rateLimited(ip)) return back("/login", "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.", true);
  if (!(await turnstileVerify(env, form.get("cf-turnstile-response"), ip))) return back("/login", "봇 방지 확인에 실패했습니다. 다시 시도해 주세요.", true);
  const email = (form.get("email") || "").toLowerCase().trim();
  const user = email ? await D.getUserByEmail(db, email) : null;
  if (!user || !(await verifyPassword(form.get("password") || "", user.salt, user.password_hash))) {
    recordFail(ip);
    return back("/login", "이메일 또는 비밀번호가 올바르지 않습니다.", true);
  }
  if (user.totp_enabled) {
    const { totpVerify } = await import("./totp.js");
    if (!(await totpVerify(user.totp_secret, form.get("totp")))) {
      recordFail(ip);
      return back("/login", "2단계 인증 코드가 올바르지 않습니다.", true);
    }
  }
  const token = await sessionTokenForUser(user, env.SESSION_SECRET);
  addCookie(sessionCookie(token, isProd));
  return redirect(await postLoginPath(db, user));
}

export async function logout(ctx) {
  ctx.addCookie(clearSessionCookie());
  return redirect("/");
}

// ---------- 회원가입 ----------
export async function register(ctx) {
  const { db, env, form, addCookie, isProd, base, assoc, ip } = ctx;
  if (!(await turnstileVerify(env, form.get("cf-turnstile-response"), ip))) return back(base + "/register", "봇 방지 확인에 실패했습니다. 다시 시도해 주세요.", true);
  const name = cap((form.get("name") || "").trim(), 60);
  const email = cap((form.get("email") || "").toLowerCase().trim(), 120);
  const password = form.get("password") || "";
  const businessName = cap((form.get("business_name") || "").trim(), 100);
  if (!name || !EMAIL_RE.test(email) || password.length < 8 || password.length > 200 || !businessName)
    return back(base + "/register", "입력값을 확인해 주세요. (비밀번호 8~200자)", true);
  if (await D.getUserByEmail(db, email)) return back(base + "/register", "이미 가입된 이메일입니다.", true);
  const { hash, salt } = await hashPassword(password);
  const user = await D.createUser(db, { email, passwordHash: hash, salt, name, role: "MERCHANT", associationId: assoc.id });
  await D.createBusiness(db, { associationId: assoc.id, ownerId: user.id, name: businessName, category: cap(form.get("category"), 40) });
  await D.createNotification(db, { associationId: assoc.id, kind: "new_business", message: `${name}님이 '${businessName}' 업체로 가입했습니다. 승인 대기 중입니다.`, link: base + "/admin" });
  addCookie(sessionCookie(await sessionTokenForUser(user, env.SESSION_SECRET), isProd));
  return back(base + "/dashboard", "가입이 완료되었습니다! 업체 정보를 입력하고 사진을 올려보세요.");
}

// ---------- 계정: 비밀번호 변경 ----------
export async function changePassword(ctx) {
  const { db, env, form, user, addCookie, isProd } = ctx;
  if (!(await verifyPassword(form.get("current") || "", user.salt, user.password_hash)))
    return back("/account", "현재 비밀번호가 올바르지 않습니다.", true);
  const next = form.get("new") || "";
  if (next.length < 8) return back("/account", "새 비밀번호는 8자 이상이어야 합니다.", true);
  if (next !== (form.get("confirm") || "")) return back("/account", "새 비밀번호 확인이 일치하지 않습니다.", true);
  const { hash, salt } = await hashPassword(next);
  await D.updateUserPassword(db, user.id, hash, salt);
  const updated = await D.getUserById(db, user.id);
  addCookie(sessionCookie(await sessionTokenForUser(updated, env.SESSION_SECRET), isProd)); // 현재 세션 유지
  return back("/account", "비밀번호가 변경되었습니다. 다른 기기는 로그아웃되었습니다.");
}

// ---------- 업체 정보 수정 ----------
export async function updateBusiness(ctx) {
  const { db, form, user, base, assoc } = ctx;
  const b = await D.getBusinessByOwner(db, user.id);
  if (!b || b.association_id !== assoc.id) return back(base + "/dashboard", "업체를 찾을 수 없습니다.", true);
  if (!(form.get("name") || "").trim()) return back(base + "/dashboard", "업체명을 입력하세요.", true);
  const coord = (v, mn, mx) => { const s = (v ?? "").trim(); if (s === "") return null; const n = Number(s); return Number.isFinite(n) && n >= mn && n <= mx ? n : undefined; };
  const lat = coord(form.get("lat"), -90, 90), lng = coord(form.get("lng"), -180, 180);
  if (lat === undefined || lng === undefined) return back(base + "/dashboard", "좌표 형식을 확인해 주세요.", true);
  await D.updateBusiness(db, b.id, {
    name: cap(form.get("name").trim(), 100), category: cap(form.get("category"), 40),
    description: cap(form.get("description"), 2000), phone: cap(form.get("phone"), 40),
    address: cap(form.get("address"), 200), hours: cap(form.get("hours"), 100), lat, lng,
  });
  return back(base + "/dashboard", "업체 정보가 저장되었습니다.");
}

// ---------- 사진 업로드 (R2) ----------
export async function uploadMedia(ctx) {
  const { db, env, form, user, base, assoc } = ctx;
  const b = await D.getBusinessByOwner(db, user.id);
  if (!b || b.association_id !== assoc.id) return back(base + "/dashboard", "업체를 찾을 수 없습니다.", true);
  const caption = cap((form.get("caption") || "").trim(), 200);
  const up = await saveImages(env, form.getAll("files"), 12);
  if (up.error) return back(base + "/dashboard", up.error, true);
  if (!up.images.length) return back(base + "/dashboard", "선택된 사진이 없습니다.", true);
  for (const im of up.images) await D.addMedia(db, { businessId: b.id, kind: "image", filename: im.filename, caption });
  return back(base + "/dashboard", `${up.images.length}장 업로드 완료.`);
}

// ---------- 영상 링크(임베드) 추가 ----------
export async function addVideoEmbed(ctx) {
  const { db, form, user, base, assoc } = ctx;
  const b = await D.getBusinessByOwner(db, user.id);
  if (!b || b.association_id !== assoc.id) return back(base + "/dashboard", "업체를 찾을 수 없습니다.", true);
  if ((await D.countEmbeds(db, b.id)) >= MAX_EMBEDS) return back(base + "/dashboard", `영상 링크는 최대 ${MAX_EMBEDS}개까지 가능합니다.`, true);
  const parsed = parseEmbed(form.get("url") || "");
  if (!parsed) return back(base + "/dashboard", "지원하는 영상 링크가 아닙니다. (유튜브·쇼츠·인스타 릴스·네이버TV)", true);
  await D.addMedia(db, { businessId: b.id, kind: "embed", provider: parsed.provider, embedId: parsed.id, caption: cap((form.get("caption") || "").trim(), 200) });
  return back(base + "/dashboard", "영상 링크를 추가했습니다.");
}

export async function deleteMedia(ctx) {
  const { db, env, user, base, assoc, params } = ctx;
  const b = await D.getBusinessByOwner(db, user.id);
  const m = await D.getMedia(db, Number(params.id));
  if (!b || !m || m.business_id !== b.id) return back(base + "/dashboard", "삭제할 수 없습니다.", true);
  if (m.filename) await storage.remove(env, m.filename);
  if (m.thumb) await storage.remove(env, m.thumb);
  if (m.poster) await storage.remove(env, m.poster);
  await D.deleteMedia(db, m.id);
  return back(base + "/dashboard", "삭제되었습니다.");
}

// ---------- 게시판 ----------
export async function createPost(ctx) {
  const { db, env, form, user, base, assoc } = ctx;
  const title = cap((form.get("title") || "").trim(), 200), body = cap((form.get("body") || "").trim(), 10000);
  if (!title || !body) return back(base + "/board", "제목과 내용을 입력하세요.", true);
  const up = await saveImages(env, form.getAll("images"), BOARD_MAX_IMAGES);
  if (up.error) return back(base + "/board", up.error, true);
  const p = await D.createPost(db, { associationId: assoc.id, authorId: user.id, title, body });
  if (up.images.length) await D.addPostImages(db, p.id, up.images);
  return back(base + "/board/" + p.id, "글을 등록했습니다.");
}
export async function updatePost(ctx) {
  const { db, env, form, user, base, assoc, params } = ctx;
  const p = await D.getPost(db, Number(params.id));
  if (!p || p.association_id !== assoc.id) return back(base + "/board", "게시글을 찾을 수 없습니다.", true);
  if (!(canModerateBoard(user, assoc) || p.author_id === user.id)) return back(base + "/board/" + p.id, "수정 권한이 없습니다.", true);
  const editUrl = base + "/board/" + p.id + "/edit";
  const title = cap((form.get("title") || "").trim(), 200), body = cap((form.get("body") || "").trim(), 10000);
  if (!title || !body) return back(editUrl, "제목과 내용을 입력하세요.", true);
  const existing = await D.listPostImages(db, p.id);
  const removeIds = new Set(existing.filter((im) => form.get("del_" + im.id) === "1").map((im) => im.id));
  const keep = existing.length - removeIds.size;
  const up = await saveImages(env, form.getAll("images"), BOARD_MAX_IMAGES);
  if (up.error) return back(editUrl, up.error, true);
  if (keep + up.images.length > BOARD_MAX_IMAGES) return back(editUrl, `사진은 최대 ${BOARD_MAX_IMAGES}장까지 첨부할 수 있습니다.`, true);
  for (const im of existing) if (removeIds.has(im.id)) { await storage.remove(env, im.filename); if (im.thumb) await storage.remove(env, im.thumb); await D.deletePostImage(db, im.id); }
  let imageKey = p.image;
  if (form.get("remove_image") === "1" && p.image) { await storage.remove(env, p.image); imageKey = ""; }
  if (up.images.length) await D.addPostImages(db, p.id, up.images);
  await D.updatePost(db, p.id, { title, body, image: imageKey });
  return back(base + "/board/" + p.id, "글을 수정했습니다.");
}
export async function deletePost(ctx) {
  const { db, env, user, base, assoc, params } = ctx;
  const p = await D.getPost(db, Number(params.id));
  if (!p || p.association_id !== assoc.id) return back(base + "/board", "게시글을 찾을 수 없습니다.", true);
  if (!(canModerateBoard(user, assoc) || p.author_id === user.id)) return back(base + "/board/" + p.id, "삭제 권한이 없습니다.", true);
  for (const im of await D.listPostImages(db, p.id)) { await storage.remove(env, im.filename); if (im.thumb) await storage.remove(env, im.thumb); }
  if (p.image) await storage.remove(env, p.image);
  await D.deletePost(db, p.id);
  return back(base + "/board", "게시글을 삭제했습니다.");
}
export async function pinPost(ctx) {
  const { db, user, base, assoc, params } = ctx;
  if (!canModerateBoard(user, assoc)) return back(base + "/board", "권한이 없습니다.", true);
  const p = await D.getPost(db, Number(params.id));
  if (!p || p.association_id !== assoc.id) return back(base + "/board", "게시글을 찾을 수 없습니다.", true);
  await D.setPostPinned(db, p.id, p.pinned ? 0 : 1);
  return back(base + "/board/" + p.id, p.pinned ? "고정을 해제했습니다." : "상단에 고정했습니다.");
}
export async function createComment(ctx) {
  const { db, form, user, base, assoc, params } = ctx;
  const p = await D.getPost(db, Number(params.id));
  if (!p || p.association_id !== assoc.id) return back(base + "/board", "게시글을 찾을 수 없습니다.", true);
  const body = cap((form.get("body") || "").trim(), 3000);
  if (!body) return back(base + "/board/" + p.id, "댓글 내용을 입력하세요.", true);
  await D.createComment(db, { postId: p.id, authorId: user.id, body });
  return back(base + "/board/" + p.id, "댓글을 등록했습니다.");
}
export async function deleteComment(ctx) {
  const { db, user, base, assoc, params } = ctx;
  const p = await D.getPost(db, Number(params.id));
  const c = await D.getComment(db, Number(params.cid));
  if (!p || p.association_id !== assoc.id || !c || c.post_id !== p.id) return back(base + "/board", "댓글을 찾을 수 없습니다.", true);
  if (!(canModerateBoard(user, assoc) || c.author_id === user.id)) return back(base + "/board/" + p.id, "삭제 권한이 없습니다.", true);
  await D.deleteComment(db, c.id);
  return back(base + "/board/" + p.id, "댓글을 삭제했습니다.");
}

// ---------- 관리자 ----------
const isAdmin = (user, assoc) => user && (user.role === "SUPERADMIN" || (user.role === "ADMIN" && user.association_id === assoc.id));
// 감사 로그 기록 (assoc=null 이면 플랫폼/슈퍼)
const audit = (ctx, action, detail = "", assocId) =>
  D.logAudit(ctx.db, { associationId: assocId !== undefined ? assocId : (ctx.assoc ? ctx.assoc.id : null), userId: ctx.user.id, actorName: ctx.user.name, action, detail });

export async function adminBusinessStatus(ctx) {
  const { db, form, base, assoc, params } = ctx;
  if (!["approved", "rejected", "pending"].includes(form.get("status"))) return back(base + "/admin", "잘못된 상태값", true);
  const b = await D.getBusinessById(db, Number(params.id));
  if (!b || b.association_id !== assoc.id) return back(base + "/admin", "업체를 찾을 수 없습니다.", true);
  await D.setBusinessStatus(db, b.id, form.get("status"));
  await audit(ctx, "업체상태", `${b.name} → ${form.get("status")}`);
  return back(base + "/admin", `'${b.name}' 상태를 변경했습니다.`);
}
export async function adminCreateNotice(ctx) {
  const { db, env, form, base, assoc } = ctx;
  const title = cap((form.get("title") || "").trim(), 200);
  if (!title) return back(base + "/admin", "공지 제목을 입력하세요.", true);
  const up = await saveImages(env, form.getAll("image"), 1);
  if (up.error) return back(base + "/admin", up.error, true);
  await D.createNotice(db, { associationId: assoc.id, title, body: cap(form.get("body"), 10000), tag: cap(form.get("tag") || "안내", 20), image: up.images[0] ? up.images[0].filename : "", pinned: form.get("pinned") === "1" });
  await audit(ctx, "공지등록", title);
  return back(base + "/admin", "공지를 등록했습니다.");
}
export async function adminDeleteNotice(ctx) {
  const { db, env, base, assoc, params } = ctx;
  const n = await D.getNotice(db, Number(params.id));
  if (n && n.association_id === assoc.id) { if (n.image) await storage.remove(env, n.image); await D.deleteNotice(db, n.id); await audit(ctx, "공지삭제", n.title); }
  return back(base + "/admin", "공지를 삭제했습니다.");
}
export async function adminCreateEvent(ctx) {
  const { db, form, base, assoc } = ctx;
  if (!(form.get("title") || "").trim() || !(form.get("event_date") || "").trim()) return back(base + "/admin", "행사명과 날짜를 입력하세요.", true);
  await D.createEvent(db, { associationId: assoc.id, title: cap(form.get("title").trim(), 200), event_date: cap(form.get("event_date"), 10), place: cap(form.get("place"), 120), description: cap(form.get("description"), 2000) });
  return back(base + "/admin", "행사를 등록했습니다.");
}
export async function adminDeleteEvent(ctx) {
  const { db, base, assoc, params } = ctx;
  const e = await D.getEvent(db, Number(params.id));
  if (e && e.association_id === assoc.id) await D.deleteEvent(db, e.id);
  return back(base + "/admin", "행사를 삭제했습니다.");
}
export async function adminSettings(ctx) {
  const { db, env, form, base, assoc } = ctx;
  if (!(form.get("name") || "").trim()) return back(base + "/admin", "상인회 이름을 입력하세요.", true);
  const color = /^#[0-9a-fA-F]{6}$/.test(form.get("brand_color") || "") ? form.get("brand_color") : assoc.brand_color;
  let logo = assoc.logo;
  const up = await saveImages(env, form.getAll("logo"), 1);
  if (up.error) return back(base + "/admin", up.error, true);
  if (up.images[0]) { if (assoc.logo) await storage.remove(env, assoc.logo); logo = up.images[0].filename; }
  await D.updateAssociation(db, assoc.id, { name: cap(form.get("name").trim(), 100), tagline: cap(form.get("tagline"), 200), brand_color: color, phone: cap(form.get("phone"), 40), email: cap(form.get("email"), 120), address: cap(form.get("address"), 200), logo });
  await audit(ctx, "브랜딩수정", "");
  return back(base + "/admin", "상인회 정보가 저장되었습니다.");
}
export async function adminReadNotifications(ctx) {
  await D.markAllNotificationsRead(ctx.db, ctx.assoc.id);
  return back(ctx.base + "/admin", "알림을 모두 읽음 처리했습니다.");
}
export async function adminResetUserPassword(ctx) {
  const { db, base, assoc, params } = ctx;
  const target = await D.getUserById(db, Number(params.id));
  if (!target || target.association_id !== assoc.id || target.role !== "MERCHANT") return back(base + "/admin", "대상 회원을 찾을 수 없습니다.", true);
  const temp = Math.random().toString(36).slice(2, 10); // 임시 비밀번호
  const { hash, salt } = await hashPassword(temp);
  await D.updateUserPassword(db, target.id, hash, salt);
  await audit(ctx, "비밀번호재설정", target.email);
  return back(base + "/admin", `${target.name}님 임시 비밀번호: ${temp} — 전달 후 변경 안내하세요.`);
}

// ---------- 전자서명 ----------
export async function adminCreateDocument(ctx) {
  const { db, form, base, assoc, user } = ctx;
  const title = cap((form.get("title") || "").trim(), 200), body = cap((form.get("body") || "").trim(), 20000);
  if (!title || !body) return back(base + "/admin/documents", "제목과 본문을 입력하세요.", true);
  const ordered = form.get("ordered") === "1" ? 1 : 0;
  let dueDate = ""; const rawDue = (form.get("due_date") || "").trim();
  if (rawDue) { if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDue)) return back(base + "/admin/documents", "기한 형식(YYYY-MM-DD)을 확인하세요.", true);
    if (rawDue < new Date().toISOString().slice(0, 10)) return back(base + "/admin/documents", "기한은 오늘 이후여야 합니다.", true); dueDate = rawDue; }
  const doc = await D.createDocument(db, { associationId: assoc.id, title, body, contentHash: await contentHash(body), createdBy: user.id, ordered, dueDate });
  const target = form.get("target");
  const members = await D.listUsersByAssociation(db, assoc.id, "MERCHANT");
  if (target === "all") await D.createSignatureRequests(db, doc.id, members.map((m) => m.id));
  else if (target === "select") { const valid = new Set(members.map((m) => m.id)); const chosen = form.getAll("members").map(Number).filter((id) => valid.has(id)); await D.createSignatureRequests(db, doc.id, chosen); }
  await audit(ctx, "서명문서생성", title);
  return back(base + "/admin/documents", ordered ? "순차 서명 문서를 생성했습니다." : "문서를 생성했습니다.");
}
export async function adminCloseDocument(ctx) {
  const { db, base, assoc, params } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  if (d && d.association_id === assoc.id) { await D.closeDocument(db, d.id); await audit(ctx, "서명문서마감", d.title); }
  return back(base + "/admin/documents", "문서를 마감했습니다.");
}
export async function memberSign(ctx) {
  const { db, env, form, base, assoc, user, ip, request } = ctx;
  const d = await D.getDocument(db, Number(ctx.params.id));
  if (!d || d.association_id !== assoc.id) return back(base + "/sign", "문서를 찾을 수 없습니다.", true);
  if (d.closed) return back(base + "/sign", "마감된 문서입니다.", true);
  if (D.isPastDue(d)) return back(base + "/sign", "서명 기한이 지난 문서입니다.", true);
  if (await D.hasSigned(db, d.id, user.id)) return back(base + "/sign", "이미 서명한 문서입니다.", true);
  if (!(await D.canSignNow(db, d, user.id))) return back(base + "/sign", "앞 순번의 서명이 완료된 후 서명할 수 있습니다.", true);
  if (form.get("consent") !== "1") return back(base + "/sign/" + d.id, "동의 확인란에 체크해 주세요.", true);
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(form.get("signature") || "");
  if (!m) return back(base + "/sign/" + d.id, "서명을 입력해 주세요.", true);
  let bytes; try { bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)); } catch { bytes = null; }
  if (!bytes || bytes.length < 64 || bytes.length > 500 * 1024 || sniffImage(bytes) !== "image/png") return back(base + "/sign/" + d.id, "서명 이미지가 올바르지 않습니다.", true);
  const sigKey = storage.enabled(env) ? await storage.save(env, bytes, "image/png") : ""; // R2 미연결 시 이미지 생략(봉인은 유효)
  const signerName = cap((form.get("signer_name") || "").trim(), 60) || user.name;
  const signedAt = new Date().toISOString();
  const recordHash = await sealRecord(env, { documentId: d.id, userId: user.id, signerName, contentHash: d.content_hash, signedAt, ip });
  const verifyCode = newVerifyCode();
  await D.createSignature(db, { documentId: d.id, userId: user.id, signerName, signatureImage: sigKey, contentHash: d.content_hash, ip, userAgent: cap(request.headers.get("user-agent") || "", 200), verifyCode, recordHash, signedAt });
  await D.createNotification(db, { associationId: assoc.id, kind: "signed", message: `${signerName}님이 '${d.title}'에 전자서명했습니다.`, link: base + "/admin/documents/" + d.id });
  return back(base + "/sign", `전자서명이 완료되었습니다. 검증 코드: ${verifyCode}`);
}

// ---------- 슈퍼관리자 ----------
export async function superCreateAssociation(ctx) {
  const { db, form } = ctx;
  const name = cap((form.get("name") || "").trim(), 100);
  const adminEmail = cap((form.get("admin_email") || "").toLowerCase().trim(), 120);
  const adminPassword = form.get("admin_password") || "";
  if (!name || !EMAIL_RE.test(adminEmail) || adminPassword.length < 8 || adminPassword.length > 200) return back("/super", "상인회 이름과 관리자 계정을 확인하세요. (비밀번호 8~200자)", true);
  if (await D.getUserByEmail(db, adminEmail)) return back("/super", "이미 사용 중인 관리자 이메일입니다.", true);
  const color = /^#[0-9a-fA-F]{6}$/.test(form.get("brand_color") || "") ? form.get("brand_color") : "#0b6e4f";
  // 고유 slug
  let slug = slugify(name), n = 1;
  while (await D.getAssociationBySlug(db, slug)) slug = slugify(name) + "-" + (++n);
  const assoc = await D.createAssociation(db, { slug, name, brandColor: color, tagline: cap(form.get("tagline"), 200) || undefined });
  const { hash, salt } = await hashPassword(adminPassword);
  await D.createUser(db, { email: adminEmail, passwordHash: hash, salt, name: cap(form.get("admin_name"), 60) || "관리자", role: "ADMIN", associationId: assoc.id });
  await audit(ctx, "상인회생성", `${name} (/t/${assoc.slug})`, null);
  return back("/super", `'${name}' 상인회가 생성되었습니다. (주소: /t/${assoc.slug}, 관리자: ${adminEmail})`);
}
export async function superToggleAssociation(ctx) {
  const { db, params } = ctx;
  const a = await D.getAssociationById(db, Number(params.id));
  if (!a) return back("/super", "상인회를 찾을 수 없습니다.", true);
  await D.setAssociationActive(db, a.id, a.active ? 0 : 1);
  await audit(ctx, "상인회상태", `${a.name} → ${a.active ? "비활성" : "활성"}`, null);
  return back("/super", `'${a.name}' 상태를 변경했습니다.`);
}

// ---------- 비밀번호 찾기 (내부 알림, 이메일 없이) ----------
export async function forgotPassword(ctx) {
  const { db, form } = ctx;
  const email = (form.get("email") || "").toLowerCase().trim();
  const user = email ? await D.getUserByEmail(db, email) : null;
  if (user && user.association_id) {
    const a = await D.getAssociationById(db, user.association_id);
    await D.createNotification(db, { associationId: user.association_id, kind: "password_reset", message: `비밀번호 재설정 요청: ${user.name} (${user.email})`, link: a ? `/t/${a.slug}/admin` : "" });
  }
  return back("/forgot", "요청이 접수되었습니다. 관리자가 확인 후 임시 비밀번호를 안내해 드립니다.");
}

// ---------- 전 기기 로그아웃 ----------
export async function logoutAll(ctx) {
  await D.bumpSessionVersion(ctx.db, ctx.user.id);
  ctx.addCookie(clearSessionCookie());
  return redirect("/login?msg=" + encodeURIComponent("모든 기기에서 로그아웃되었습니다."));
}

// ---------- 홈페이지 구성 저장/초기화 ----------
export async function adminSaveLayout(ctx) {
  const { db, form, base, assoc } = ctx;
  const { SECTION_CATALOG } = await import("./homeLayout.js");
  const order = (form.get("order") || "").split(",").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  const built = [];
  for (const i of order) {
    const type = form.get(`ty_${i}`); const catFields = SECTION_CATALOG[type];
    if (!catFields) continue;
    const sec = { type, enabled: form.get(`en_${i}`) === "1" };
    for (const f of catFields.fields) {
      const key = `f_${i}_${f.key}`;
      sec[f.key] = f.type === "bool" ? form.get(key) === "1" : cap(form.get(key) != null ? form.get(key) : "", 600);
    }
    built.push(sec);
  }
  if (!built.length) return back(base + "/admin", "구성을 해석할 수 없습니다.", true);
  await D.saveHomeLayout(db, assoc.id, JSON.stringify(built));
  await audit(ctx, "홈구성저장", "");
  return back(base + "/admin", "홈페이지 구성이 저장되었습니다.");
}
export async function adminResetLayout(ctx) {
  await D.resetHomeLayout(ctx.db, ctx.assoc.id);
  return back(ctx.base + "/admin", "홈페이지 구성을 기본값으로 초기화했습니다.");
}

// ---------- 2단계 인증 (TOTP) ----------
export async function twofaSetup(ctx) {
  const { db, user } = ctx;
  const { generateSecret } = await import("./totp.js");
  await D.setUserTotp(db, user.id, generateSecret(), 0); // 비활성 상태로 시크릿 발급
  return back("/account", "인증 앱에 키를 등록한 뒤 코드로 활성화하세요.");
}
export async function twofaEnable(ctx) {
  const { db, user, form } = ctx;
  if (!user.totp_secret) return back("/account", "먼저 2단계 인증 설정을 시작하세요.", true);
  const { totpVerify } = await import("./totp.js");
  if (!(await totpVerify(user.totp_secret, form.get("code")))) return back("/account", "코드가 올바르지 않습니다. 다시 시도해 주세요.", true);
  await D.setUserTotp(db, user.id, user.totp_secret, 1);
  await D.bumpSessionVersion(db, user.id);
  ctx.addCookie(sessionCookie(await sessionTokenForUser(await D.getUserById(db, user.id), ctx.env.SESSION_SECRET), ctx.isProd));
  return back("/account", "2단계 인증이 활성화되었습니다.");
}
export async function twofaDisable(ctx) {
  const { db, user, form } = ctx;
  if (!user.totp_enabled) return back("/account", "2단계 인증이 설정되어 있지 않습니다.", true);
  const { totpVerify } = await import("./totp.js");
  if (!(await totpVerify(user.totp_secret, form.get("code")))) return back("/account", "코드가 올바르지 않습니다.", true);
  await D.setUserTotp(db, user.id, "", 0);
  return back("/account", "2단계 인증이 해제되었습니다.");
}

// ---------- 설치 마법사 제출 (계정이 없을 때만) ----------
export async function setupSubmit(ctx) {
  const { db, form } = ctx;
  if ((await D.countUsers(db)) > 0) return back("/login", "이미 설정이 완료되었습니다.");
  const assocName = cap((form.get("assoc_name") || "").trim(), 100);
  const adminEmail = cap((form.get("admin_email") || "").toLowerCase().trim(), 120);
  const adminPw = form.get("admin_password") || "";
  const superEmail = cap((form.get("super_email") || "").toLowerCase().trim(), 120);
  const superPw = form.get("super_password") || "";
  if (!assocName || !EMAIL_RE.test(adminEmail) || !EMAIL_RE.test(superEmail) || adminPw.length < 8 || superPw.length < 8)
    return back("/setup", "입력값을 확인해 주세요. (비밀번호 8자 이상)", true);
  if (adminEmail === superEmail) return back("/setup", "관리자와 슈퍼 이메일은 서로 달라야 합니다.", true);
  // 상인회 + 슈퍼 + 관리자 생성
  let slug = slugify(assocName), n = 1;
  while (await D.getAssociationBySlug(db, slug)) slug = slugify(assocName) + "-" + (++n);
  const assoc = await D.createAssociation(db, { slug, name: assocName });
  const su = await hashPassword(superPw);
  await D.createUser(db, { email: superEmail, passwordHash: su.hash, salt: su.salt, name: "플랫폼 운영자", role: "SUPERADMIN", associationId: null });
  const ad = await hashPassword(adminPw);
  await D.createUser(db, { email: adminEmail, passwordHash: ad.hash, salt: ad.salt, name: assocName + " 관리자", role: "ADMIN", associationId: assoc.id });
  return redirect("/login?msg=" + encodeURIComponent("설정이 완료되었습니다! 관리자 계정으로 로그인하세요."));
}

// ---------- 슈퍼: 상인회별 개별 도메인 연결 ----------
export async function superSetDomain(ctx) {
  const { db, form, params } = ctx;
  const a = await D.getAssociationById(db, Number(params.id));
  if (!a) return back("/super", "상인회를 찾을 수 없습니다.", true);
  // 입력 정리: 프로토콜·경로 제거, 소문자화
  let domain = (form.get("domain") || "").toLowerCase().trim()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (domain && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain))
    return back("/super", "도메인 형식을 확인해 주세요. (예: seocho-market.kr)", true);
  if (domain) {
    const dup = await D.getAssociationByDomain(db, domain);
    if (dup && dup.id !== a.id) return back("/super", "이미 다른 상인회에 연결된 도메인입니다.", true);
  }
  await D.setAssociationDomain(db, a.id, domain);
  await audit(ctx, "도메인연결", `${a.name} → ${domain || "(해제)"}`, null);
  return back("/super", domain
    ? `'${a.name}' 에 ${domain} 을 연결했습니다. Cloudflare 워커의 Custom Domain 에도 같은 도메인을 추가하세요.`
    : `'${a.name}' 도메인 연결을 해제했습니다.`);
}
