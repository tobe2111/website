// 폼 처리 핸들러 (POST). ctx.form 은 파싱된 FormData.
import * as D from "./db.js";
import { verifyPassword, hashPassword } from "./crypto.js";
import { sessionTokenForUser, sessionCookie, clearSessionCookie } from "./auth.js";
import { back, redirect } from "./http.js";
import * as storage from "./storage.js";
import { parseEmbed } from "./embed.js";
import { cap, sniffImage, EMAIL_RE, MAX_IMAGE_BYTES } from "./util.js";

const BOARD_MAX_IMAGES = 6;
const MAX_EMBEDS = 30;

// FormData 파일들을 R2 에 저장(썸네일은 Workers 에선 원본 사용) → { images } 또는 { error }
async function saveImages(env, files, max) {
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
  const email = (form.get("email") || "").toLowerCase().trim();
  const user = email ? await D.getUserByEmail(db, email) : null;
  if (!user || !(await verifyPassword(form.get("password") || "", user.salt, user.password_hash))) {
    recordFail(ip);
    return back("/login", "이메일 또는 비밀번호가 올바르지 않습니다.", true);
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
  const { db, env, form, addCookie, isProd, base, assoc } = ctx;
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
