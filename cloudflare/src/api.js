// 폼 처리 핸들러 (POST). ctx.form 은 파싱된 FormData.
import * as D from "./db.js";
import { verifyPassword, hashPassword, hmacSign, hmacVerify, b64uFromBytes, bytesFromB64u } from "./crypto.js";
import { sendEmail, emailEnabled, mailShell, mailButton } from "./email.js";
import { sessionTokenForUser, sessionCookie, clearSessionCookie } from "./auth.js";
import { back, redirect } from "./http.js";
import * as storage from "./storage.js";
import { parseEmbed } from "./embed.js";
import { cap, sniffImage, EMAIL_RE, MAX_IMAGE_BYTES, slugify, esc } from "./util.js";
import { contentHash, sealRecord, newVerifyCode } from "./esign.js";
import { turnstileVerify } from "./turnstile.js";
import { planOf } from "./plans.js";
import { seedDemo } from "./demoContent.js";

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
    out.push({ filename: key, thumb: "", size: buf.byteLength });
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
  if (form.get("agree") !== "1") return back(base + "/register", "개인정보 수집·이용에 동의해 주세요.", true);
  if (!name || !EMAIL_RE.test(email) || password.length < 8 || password.length > 200 || !businessName)
    return back(base + "/register", "입력값을 확인해 주세요. (비밀번호 8~200자)", true);
  if (await D.getUserByEmail(db, email)) return back(base + "/register", "이미 가입된 이메일입니다.", true);
  if ((await D.countMembers(db, assoc.id)) >= planOf(assoc).maxMembers)
    return back(base + "/register", "회원 정원이 가득 찼습니다. 상인회 관리자에게 문의해 주세요.", true);
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
  const snsUrl = (v) => { const t = cap((v || "").trim(), 200); if (!t) return ""; return /^https?:\/\//.test(t) ? t : "https://" + t; };
  await D.updateBusiness(db, b.id, {
    name: cap(form.get("name").trim(), 100), category: cap(form.get("category"), 40),
    description: cap(form.get("description"), 2000), phone: cap(form.get("phone"), 40),
    address: cap(form.get("address"), 200), hours: cap(form.get("hours"), 100), lat, lng,
    snsInstagram: snsUrl(form.get("sns_instagram")), snsYoutube: snsUrl(form.get("sns_youtube")),
    snsBlog: snsUrl(form.get("sns_blog")), snsKakao: snsUrl(form.get("sns_kakao")), snsNaver: snsUrl(form.get("sns_naver")),
  });
  return back(base + "/dashboard", "업체 정보가 저장되었습니다.");
}

// ---------- 사진 업로드 (R2) ----------
export async function uploadMedia(ctx) {
  const { db, env, form, user, base, assoc } = ctx;
  const b = await D.getBusinessByOwner(db, user.id);
  if (!b || b.association_id !== assoc.id) return back(base + "/dashboard", "업체를 찾을 수 없습니다.", true);
  const caption = cap((form.get("caption") || "").trim(), 200);
  const maxPhotos = planOf(assoc).maxPhotos;
  if ((await D.countBusinessImages(db, b.id)) >= maxPhotos)
    return back(base + "/dashboard", `사진은 최대 ${maxPhotos}장까지 올릴 수 있습니다.`, true);
  const up = await saveImages(env, form.getAll("files"), 12);
  if (up.error) return back(base + "/dashboard", up.error, true);
  if (!up.images.length) return back(base + "/dashboard", "선택된 사진이 없습니다.", true);
  for (const im of up.images) await D.addMedia(db, { businessId: b.id, kind: "image", filename: im.filename, size: im.size, caption });
  return back(base + "/dashboard", `${up.images.length}장 업로드 완료.`);
}

// ---------- 영상 링크(임베드) 추가 ----------
export async function addVideoEmbed(ctx) {
  const { db, form, user, base, assoc } = ctx;
  const b = await D.getBusinessByOwner(db, user.id);
  if (!b || b.association_id !== assoc.id) return back(base + "/dashboard", "업체를 찾을 수 없습니다.", true);
  const maxEmbeds = planOf(assoc).maxEmbeds;
  if ((await D.countEmbeds(db, b.id)) >= maxEmbeds) return back(base + "/dashboard", `영상 링크는 최대 ${maxEmbeds}개까지 가능합니다.`, true);
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

// ---------- 점포 제품 진열 (전시 전용 · 결제/주문 없음) ----------
async function ownBusiness(ctx) {
  const { db, user, assoc } = ctx;
  const b = await D.getBusinessByOwner(db, user.id);
  return b && b.association_id === assoc.id ? b : null;
}
export async function productAdd(ctx) {
  const { db, env, form, base, assoc } = ctx;
  const b = await ownBusiness(ctx);
  if (!b) return back(base + "/dashboard", "업체를 찾을 수 없습니다.", true);
  const name = cap((form.get("name") || "").trim(), 100);
  if (!name) return back(base + "/dashboard", "제품 이름을 입력해 주세요.", true);
  const plan = planOf(assoc);
  if ((await D.countProducts(db, b.id)) >= plan.maxProducts)
    return back(base + "/dashboard", `제품은 최대 ${plan.maxProducts}개까지 올릴 수 있습니다. (플랜 업그레이드 시 확장)`, true);
  let image = "";
  const files = form.getAll("image").filter((f) => f && typeof f.arrayBuffer === "function" && f.size);
  if (files.length) {
    if ((await D.countStoredImages(db, b.id)) >= plan.maxPhotos)
      return back(base + "/dashboard", `사진 저장 한도(${plan.maxPhotos}장)를 초과했습니다.`, true);
    const up = await saveImages(env, files, 1);
    if (up.error) return back(base + "/dashboard", up.error, true);
    if (up.images.length) image = up.images[0].filename;
  }
  await D.createProduct(db, {
    businessId: b.id, associationId: assoc.id, name,
    price: cap((form.get("price") || "").trim(), 40),
    description: cap((form.get("description") || "").trim(), 300),
    image, source: "self",
  });
  await D.touchBusiness(db, b.id); // 콘텐츠 갱신 계측
  return back(base + "/dashboard", "제품을 추가했습니다.");
}
export async function productUpdate(ctx) {
  const { db, form, base, params } = ctx;
  const b = await ownBusiness(ctx);
  const p = await D.getProduct(db, Number(params.id));
  if (!b || !p || p.business_id !== b.id) return back(base + "/dashboard", "수정할 수 없습니다.", true);
  const name = cap((form.get("name") || "").trim(), 100);
  if (!name) return back(base + "/dashboard", "제품 이름을 입력해 주세요.", true);
  await D.updateProduct(db, p.id, {
    name, price: cap((form.get("price") || "").trim(), 40),
    description: cap((form.get("description") || "").trim(), 300),
    soldOut: form.get("sold_out") === "1",
  });
  await D.touchBusiness(db, b.id);
  return back(base + "/dashboard", "제품을 수정했습니다.");
}
export async function productToggleSoldOut(ctx) {
  const { db, base, params } = ctx;
  const b = await ownBusiness(ctx);
  const p = await D.getProduct(db, Number(params.id));
  if (!b || !p || p.business_id !== b.id) return back(base + "/dashboard", "처리할 수 없습니다.", true);
  await D.setProductSoldOut(db, p.id, !p.sold_out);
  return back(base + "/dashboard", p.sold_out ? "판매중으로 변경했습니다." : "품절로 표시했습니다.");
}
export async function productMove(ctx) {
  const { db, base, params, form } = ctx;
  const b = await ownBusiness(ctx);
  const p = await D.getProduct(db, Number(params.id));
  if (!b || !p || p.business_id !== b.id) return back(base + "/dashboard", "처리할 수 없습니다.", true);
  await D.moveProduct(db, p.id, form.get("dir") === "up" ? -1 : 1);
  return back(base + "/dashboard", "순서를 변경했습니다.");
}
export async function productDelete(ctx) {
  const { db, env, base, params } = ctx;
  const b = await ownBusiness(ctx);
  const p = await D.getProduct(db, Number(params.id));
  if (!b || !p || p.business_id !== b.id) return back(base + "/dashboard", "삭제할 수 없습니다.", true);
  if (p.image) await storage.remove(env, p.image);
  await D.deleteProduct(db, p.id);
  return back(base + "/dashboard", "제품을 삭제했습니다.");
}

// ---------- 쿠폰 (보여주기 혜택 — 결제·발급 없음, 매장에서 화면 제시) ----------
const MAX_COUPONS = 5;
export async function couponAdd(ctx) {
  const { db, form, base, assoc } = ctx;
  const b = await ownBusiness(ctx);
  if (!b) return back(base + "/dashboard", "업체를 찾을 수 없습니다.", true);
  const title = cap((form.get("title") || "").trim(), 80);
  if (!title) return back(base + "/dashboard", "혜택 내용을 입력해 주세요.", true);
  if ((await D.countCoupons(db, b.id)) >= MAX_COUPONS)
    return back(base + "/dashboard", `쿠폰은 최대 ${MAX_COUPONS}개까지 등록할 수 있습니다. 지난 쿠폰을 삭제해 주세요.`, true);
  const rawDate = (form.get("valid_until") || "").trim();
  const validUntil = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : "";
  await D.createCoupon(db, { businessId: b.id, associationId: assoc.id, title, terms: cap((form.get("terms") || "").trim(), 120), validUntil });
  await D.touchBusiness(db, b.id);
  return back(base + "/dashboard", "쿠폰을 등록했습니다. 가게 페이지에 바로 노출됩니다.");
}
export async function couponDelete(ctx) {
  const { db, base, params } = ctx;
  const b = await ownBusiness(ctx);
  const c = await D.getCoupon(db, Number(params.id));
  if (!b || !c || c.business_id !== b.id) return back(base + "/dashboard", "삭제할 수 없습니다.", true);
  await D.deleteCoupon(db, c.id);
  return back(base + "/dashboard", "쿠폰을 삭제했습니다.");
}
// 상인회 관리자: 자기 상인회 점포 제품 숨김/정리 (테넌트 격리)
export async function adminProductHide(ctx) {
  const { db, base, assoc, params } = ctx;
  const p = await D.getProduct(db, Number(params.id));
  if (!p || p.association_id !== assoc.id) return back(base + "/admin", "대상 제품을 찾을 수 없습니다.", true);
  await D.setProductHidden(db, p.id, !p.hidden);
  await audit(ctx, p.hidden ? "제품숨김해제" : "제품숨김", `#${p.id} ${p.name}`);
  return back(base + "/admin", p.hidden ? "제품을 다시 노출했습니다." : "제품을 숨겼습니다.");
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
const isAdmin = canModerateBoard; // 동일 판정 — 중복 정의 통합
// 감사 로그 기록 (assoc=null 이면 플랫폼/슈퍼)
const audit = (ctx, action, detail = "", assocId) =>
  D.logAudit(ctx.db, { associationId: assocId !== undefined ? assocId : (ctx.assoc ? ctx.assoc.id : null), userId: ctx.user.id, actorName: ctx.user.name, action, detail });

export async function adminBusinessStatus(ctx) {
  const { db, form, base, assoc, params } = ctx;
  if (!["approved", "rejected", "pending"].includes(form.get("status"))) return back(base + "/admin", "잘못된 상태값", true);
  const b = await D.getBusinessById(db, Number(params.id));
  if (!b || b.association_id !== assoc.id) return back(base + "/admin", "업체를 찾을 수 없습니다.", true);
  const wasApproved = b.status === "approved";
  await D.setBusinessStatus(db, b.id, form.get("status"));
  await audit(ctx, "업체상태", `${b.name} → ${form.get("status")}`);
  // 승인 순간: 사장님에게 "가게 공개" 안내 메일 (이메일 설정 시)
  if (form.get("status") === "approved" && !wasApproved && emailEnabled(ctx.env)) {
    const owner = await D.getUserById(db, b.owner_id);
    if (owner) {
      const origin = new URL(ctx.request.url).origin;
      const link = `${origin}${base}/business/${encodeURIComponent(b.slug)}`;
      await sendEmail(ctx.env, {
        to: owner.email, subject: `🎉 '${b.name}' 가게가 공개되었습니다`,
        html: mailShell("가게가 공개되었습니다!", `<p><b>${esc(b.name)}</b> 페이지가 ${esc(assoc.name)} 홈에 공개되었습니다.</p>
          ${mailButton(link, "내 가게 페이지 보기")}
          <p>대시보드에서 <b>가게 QR 코드</b>를 인쇄해 계산대에 붙이고, <b>공유하기</b>로 카톡방에 알려보세요.</p>`),
      });
    }
  }
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
  const { db, env, form, base, assoc } = ctx;
  if (!(form.get("title") || "").trim() || !(form.get("event_date") || "").trim()) return back(base + "/admin", "행사명과 날짜를 입력하세요.", true);
  const up = await saveImages(env, form.getAll("image"), 1); // 폼의 대표 이미지 — 누락돼 조용히 버려지던 버그 수정
  if (up.error) return back(base + "/admin", up.error, true);
  await D.createEvent(db, { associationId: assoc.id, title: cap(form.get("title").trim(), 200), event_date: cap(form.get("event_date"), 10), place: cap(form.get("place"), 120), description: cap(form.get("description"), 2000), image: up.images[0]?.filename || "" });
  return back(base + "/admin", "행사를 등록했습니다.");
}
export async function adminDeleteEvent(ctx) {
  const { db, env, base, assoc, params } = ctx;
  const e = await D.getEvent(db, Number(params.id));
  if (e && e.association_id === assoc.id) {
    if (e.image) await storage.remove(env, e.image);
    await D.deleteEvent(db, e.id);
  }
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
  // 히어로 배경 사진 (선택) — 있으면 홈 히어로가 사진 배경, 없으면 그라데이션 유지. 삭제 체크박스 지원.
  let heroImage = assoc.hero_image;
  const hup = await saveImages(env, form.getAll("hero_image"), 1);
  if (hup.error) return back(base + "/admin", hup.error, true);
  if (hup.images[0]) { if (assoc.hero_image) await storage.remove(env, assoc.hero_image); heroImage = hup.images[0].filename; }
  else if (form.get("hero_image_clear") === "1") { if (assoc.hero_image) await storage.remove(env, assoc.hero_image); heroImage = ""; }
  // 검색엔진 소유 확인 코드: 메타 태그 content 로 그대로 나가므로 안전한 문자만 허용
  const verCode = (v) => (cap(v, 100) || "").replace(/[^-\w.]/g, "");
  await D.updateAssociation(db, assoc.id, { name: cap(form.get("name").trim(), 100), tagline: cap(form.get("tagline"), 200), brand_color: color, phone: cap(form.get("phone"), 40), email: cap(form.get("email"), 120), address: cap(form.get("address"), 200), logo, hero_image: heroImage,
    naver_verification: verCode(form.get("naver_verification")), google_verification: verCode(form.get("google_verification")) });
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

// 관리자 대행 등록: 총무가 사장님 대신 회원+업체를 만들고 임시 비번을 전달.
// source='proxy' 로 태깅 → '셀프 등록률' 계측의 분모/분자에 반영.
export async function adminAddMember(ctx) {
  const { db, form, base, assoc } = ctx;
  const name = cap((form.get("name") || "").trim(), 60);
  const email = cap((form.get("email") || "").toLowerCase().trim(), 120);
  const businessName = cap((form.get("business_name") || "").trim(), 100);
  if (!name || !EMAIL_RE.test(email) || !businessName) return back(base + "/admin", "이름·이메일·업체명을 확인해 주세요.", true);
  if (await D.getUserByEmail(db, email)) return back(base + "/admin", "이미 가입된 이메일입니다.", true);
  if ((await D.countMembers(db, assoc.id)) >= planOf(assoc).maxMembers)
    return back(base + "/admin", "회원 정원이 가득 찼습니다.", true);
  const temp = Math.random().toString(36).slice(2, 10);
  const { hash, salt } = await hashPassword(temp);
  const user = await D.createUser(db, { email, passwordHash: hash, salt, name, role: "MERCHANT", associationId: assoc.id });
  await D.createBusiness(db, { associationId: assoc.id, ownerId: user.id, name: businessName, category: cap(form.get("category"), 40), source: "proxy" });
  await audit(ctx, "회원대행등록", `${name} / ${businessName} (${email})`);
  return back(base + "/admin", `대행 등록 완료 — ${name}님 로그인: ${email} / 임시비번 ${temp} (사장님께 전달하세요)`);
}

// ---------- 가게 소식 (한 줄 피드) ----------
export async function updateAdd(ctx) {
  const { db, env, form, base, assoc } = ctx;
  const b = await ownBusiness(ctx);
  if (!b) return back(base + "/dashboard", "업체를 찾을 수 없습니다.", true);
  const body = cap((form.get("body") || "").trim(), 300);
  if (!body) return back(base + "/dashboard", "소식 내용을 입력해 주세요.", true);
  if ((await D.countUpdates(db, b.id)) >= 100) return back(base + "/dashboard", "소식은 100개까지 보관됩니다. 오래된 소식을 지워주세요.", true);
  let image = "";
  const files = form.getAll("image").filter((f) => f && typeof f.arrayBuffer === "function" && f.size);
  if (files.length) {
    const up = await saveImages(env, files, 1);
    if (up.error) return back(base + "/dashboard", up.error, true);
    if (up.images.length) image = up.images[0].filename;
  }
  await D.createUpdate(db, { businessId: b.id, associationId: assoc.id, body, image });
  await D.touchBusiness(db, b.id);
  return back(base + "/dashboard", "소식을 올렸습니다. 가게 페이지와 홈에 바로 노출됩니다.");
}
export async function updateDelete(ctx) {
  const { db, env, base, params } = ctx;
  const b = await ownBusiness(ctx);
  const u = await D.getUpdate(db, Number(params.id));
  if (!b || !u || u.business_id !== b.id) return back(base + "/dashboard", "삭제할 수 없습니다.", true);
  if (u.image) await storage.remove(env, u.image);
  await D.deleteUpdate(db, u.id);
  return back(base + "/dashboard", "소식을 삭제했습니다.");
}

// ---------- 오늘 임시휴무 토글 ----------
export async function dayOffToggle(ctx) {
  const { db, base } = ctx;
  const b = await ownBusiness(ctx);
  if (!b) return back(base + "/dashboard", "업체를 찾을 수 없습니다.", true);
  const today = D.kstToday();
  const off = b.day_off_date === today;
  await D.setDayOff(db, b.id, off ? "" : today);
  return back(base + "/dashboard", off ? "휴무를 해제했습니다. 영업 상태로 표시됩니다." : "오늘 하루 휴무로 표시했습니다. 내일 자동으로 풀립니다.");
}

// ---------- 총회 안건 투표 ----------
export async function adminCreatePoll(ctx) {
  const { db, form, base, assoc, user } = ctx;
  const title = cap((form.get("title") || "").trim(), 200);
  if (!title) return back(base + "/admin", "안건 제목을 입력해 주세요.", true);
  const rawClose = (form.get("closes_at") || "").trim();
  const closesAt = /^\d{4}-\d{2}-\d{2}$/.test(rawClose) ? rawClose : "";
  await D.createPoll(db, { associationId: assoc.id, title, body: cap((form.get("body") || "").trim(), 2000), closesAt, createdBy: user.id });
  await D.createNotification(db, { associationId: assoc.id, kind: "poll", message: `새 투표: ${title}`, link: base + "/polls" });
  await audit(ctx, "투표생성", title);
  return back(base + "/polls", "투표를 시작했습니다. 회원들이 투표할 수 있습니다.");
}
export async function adminClosePoll(ctx) {
  const { db, base, assoc, params } = ctx;
  const p = await D.getPoll(db, Number(params.id));
  if (!p || p.association_id !== assoc.id) return back(base + "/polls", "투표를 찾을 수 없습니다.", true);
  await D.closePoll(db, p.id);
  await audit(ctx, "투표마감", p.title);
  return back(base + "/polls", "투표를 마감했습니다.");
}
export async function pollVote(ctx) {
  const { db, form, base, assoc, user, params } = ctx;
  const p = await D.getPoll(db, Number(params.id));
  if (!p || p.association_id !== assoc.id) return back(base + "/polls", "투표를 찾을 수 없습니다.", true);
  if (!D.isPollOpen(p)) return back(base + "/polls", "마감된 투표입니다.", true);
  const choice = form.get("choice");
  if (!["yes", "no", "abstain"].includes(choice)) return back(base + "/polls", "선택을 확인해 주세요.", true);
  await D.votePoll(db, p.id, user.id, choice);
  return back(base + "/polls", "투표했습니다. 마감 전까지 다시 눌러 변경할 수 있습니다.");
}

// ---------- 행사 참가 신청 ----------
export async function eventRsvp(ctx) {
  const { db, base, assoc, user, params } = ctx;
  const e = await D.getEvent(db, Number(params.id));
  if (!e || e.association_id !== assoc.id) return back(base + "/events", "행사를 찾을 수 없습니다.", true);
  await D.rsvpEvent(db, e.id, assoc.id, user.id);
  return back(base + "/events", `'${e.title}' 참가 신청 완료! 관리자가 명단을 확인합니다.`);
}
export async function eventRsvpCancel(ctx) {
  const { db, base, assoc, user, params } = ctx;
  const e = await D.getEvent(db, Number(params.id));
  if (!e || e.association_id !== assoc.id) return back(base + "/events", "행사를 찾을 수 없습니다.", true);
  await D.cancelRsvp(db, e.id, user.id);
  return back(base + "/events", "참가 신청을 취소했습니다.");
}

// ---------- 회비 장부 (기록만) ----------
export async function adminDueToggle(ctx) {
  const { db, form, base, assoc } = ctx;
  const period = (form.get("period") || "").trim();
  const userId = Number(form.get("user_id"));
  if (!/^\d{4}-\d{2}$/.test(period) || !userId) return back(base + "/admin", "입력값을 확인해 주세요.", true);
  const member = await D.getUserById(db, userId);
  if (!member || member.association_id !== assoc.id) return back(base + "/admin", "회원을 찾을 수 없습니다.", true);
  if (form.get("on") === "1") await D.setDuePaid(db, assoc.id, userId, period);
  else await D.setDueUnpaid(db, assoc.id, userId, period);
  return redirect(`${base}/admin?due_period=${encodeURIComponent(period)}#p-dues`);
}

// ---------- 부관리자 (회장·총무 등 공동 운영) ----------
export async function adminAddAdmin(ctx) {
  const { db, base, assoc, user } = ctx;
  const form = ctx.form;
  const name = cap((form.get("name") || "").trim(), 60);
  const email = cap((form.get("email") || "").toLowerCase().trim(), 120);
  if (!name || !EMAIL_RE.test(email)) return back(base + "/admin", "이름·이메일을 확인해 주세요.", true);
  if (await D.getUserByEmail(db, email)) return back(base + "/admin", "이미 가입된 이메일입니다.", true);
  const temp = Math.random().toString(36).slice(2, 10);
  const { hash, salt } = await hashPassword(temp);
  await D.createUser(db, { email, passwordHash: hash, salt, name, role: "ADMIN", associationId: assoc.id });
  await audit(ctx, "부관리자추가", `${name} (${email}) by ${user.email}`);
  return back(base + "/admin", `부관리자 발급 완료 — ${name}님 로그인: ${email} / 임시비번 ${temp} (전달 후 비밀번호 변경을 안내하세요)`);
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
  let recipients = [];
  if (target === "all") { recipients = members; await D.createSignatureRequests(db, doc.id, members.map((m) => m.id)); }
  else if (target === "select") { const valid = new Map(members.map((m) => [m.id, m])); const chosen = form.getAll("members").map(Number).filter((id) => valid.has(id)); recipients = chosen.map((id) => valid.get(id)); await D.createSignatureRequests(db, doc.id, chosen); }
  // 서명 요청 이메일 (RESEND 설정 시) — 실패해도 문서 생성은 유효
  if (emailEnabled(ctx.env) && recipients.length) {
    const origin = new URL(ctx.request.url).origin;
    await Promise.all(recipients.filter((m) => m.email).map((m) => sendEmail(ctx.env, {
      to: m.email,
      subject: `[${assoc.name}] 전자서명 요청 — ${title}`,
      html: mailShell(`${esc(assoc.name)} 전자서명`, `<p>${esc(m.name || "회원")}님, 서명이 필요한 문서가 도착했습니다.</p><p><b>${esc(title)}</b>${dueDate ? ` (기한: ${dueDate})` : ""}${ordered ? " · 순차 서명 문서입니다" : ""}</p>${mailButton(`${origin}${base}/sign`, "서명하러 가기")}`),
    }).catch(() => {})));
  }
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
  // 대상 지정 문서는 지정된 회원만 서명 가능 (비대상자의 서명 봉인 위조 차단)
  if (!(await D.canReceiveSign(db, d.id, user.id))) return back(base + "/sign", "이 문서의 서명 대상이 아닙니다.", true);
  if (!(await D.canSignNow(db, d, user.id))) return back(base + "/sign", "앞 순번의 서명이 완료된 후 서명할 수 있습니다.", true);
  if (form.get("consent") !== "1") return back(base + "/sign/" + d.id, "동의 확인란에 체크해 주세요.", true);
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(form.get("signature") || "");
  if (!m) return back(base + "/sign/" + d.id, "서명을 입력해 주세요.", true);
  let bytes; try { bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)); } catch { bytes = null; }
  if (!bytes || bytes.length < 64 || bytes.length > 500 * 1024 || sniffImage(bytes) !== "image/png") return back(base + "/sign/" + d.id, "서명 이미지가 올바르지 않습니다.", true);
  const sigKey = storage.enabled(env) ? await storage.save(env, bytes, "image/png") : ""; // R2 미연결 시 이미지 생략(봉인은 유효)
  // 제어문자(개행 등) 제거 — 봉인 문자열이 \n 구분이라 이름에 섞이면 인코딩이 모호해짐
  const signerName = cap((form.get("signer_name") || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 60) || user.name;
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
// 데모 콘텐츠 채우기 — 영업 소개용 샘플 사이트를 버튼 하나로 만들기 위한 기능.
// 대상 상인회의 기존 콘텐츠와 사장님 계정을 지우고 데모 세트를 넣습니다(다른 상인회는 무관).
export async function superSeedDemo(ctx) {
  const { db, env, params } = ctx;
  const a = await D.getAssociationById(db, Number(params.id));
  if (!a) return back("/super", "상인회를 찾을 수 없습니다.", true);
  const r = await seedDemo(env, db, a);
  await audit(ctx, "데모콘텐츠", `${a.name} — 점포 ${r.businesses}곳·공지 ${r.notices}건·행사 ${r.events}건·서명문서 ${r.documents}건`, a.id);
  return back("/super", `'${a.name}' 에 데모 콘텐츠를 채웠습니다. 점포 ${r.businesses}곳 · 메뉴 ${r.products}개 · 공지 ${r.notices}건 · 행사 ${r.events}건 · 전자서명 문서 ${r.documents}건(서명 ${r.signatures}명). 사장님 데모 계정 ${r.ownerEmail} / 비밀번호 ${r.password} (시연 후 반드시 변경하세요)`);
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
// ----- 비밀번호 재설정 (이메일 링크 · HMAC 토큰 60분) -----
const RESET_TTL_MS = 60 * 60 * 1000;
export async function makeResetToken(secret, email) {
  const exp = Date.now() + RESET_TTL_MS;
  const payload = `reset|${email}|${exp}`;
  const sig = await hmacSign(secret, payload);
  return `${b64uFromBytes(new TextEncoder().encode(email))}.${exp}.${sig}`;
}
export async function verifyResetToken(secret, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  let email;
  try { email = new TextDecoder().decode(bytesFromB64u(parts[0])); } catch { return null; }
  const exp = Number(parts[1]);
  if (!exp || Date.now() > exp) return null;
  if (!(await hmacVerify(secret, `reset|${email}|${exp}`, parts[2]))) return null;
  return email;
}

// ---------- 방문자 문의 (관리자 알림함 + 이메일 수신) ----------
export async function contactSubmit(ctx) {
  const { db, env, form, base, assoc, ip } = ctx;
  if (!(await turnstileVerify(env, form.get("cf-turnstile-response"), ip))) return back(base + "/contact", "봇 방지 확인에 실패했습니다. 다시 시도해 주세요.", true);
  if (form.get("website")) return back(base + "/contact", "문의가 접수되었습니다. 확인 후 연락드리겠습니다."); // 허니팟 — 봇에겐 성공처럼
  const name = cap((form.get("name") || "").trim(), 60);
  const contact = cap((form.get("contact") || "").trim(), 120);
  const message = cap((form.get("message") || "").trim(), 2000);
  if (form.get("agree") !== "1") return back(base + "/contact", "개인정보 수집·이용에 동의해 주세요.", true);
  if (!name || !contact || !message) return back(base + "/contact", "성함·연락처·문의 내용을 모두 입력해 주세요.", true);
  await D.createNotification(db, { associationId: assoc.id, kind: "contact", message: `[문의] ${name} (${contact}): ${cap(message, 200)}`, link: base + "/admin" });
  if (emailEnabled(env) && assoc.email) {
    await sendEmail(env, {
      to: assoc.email,
      subject: `[${assoc.name}] 새 문의 — ${name}`,
      html: mailShell(`${esc(assoc.name)} 문의`, `<p><b>보낸 분</b>: ${esc(name)}<br /><b>연락처</b>: ${esc(contact)}</p><p style="white-space:pre-wrap">${esc(message)}</p>`),
    }).catch(() => {}); // 메일 실패해도 알림함에는 남음
  }
  return back(base + "/contact", "문의가 접수되었습니다. 확인 후 연락드리겠습니다.");
}

// ----- 사장님 초대 링크 (HMAC 토큰 7일 · 테이블 없음) -----
// 관리자가 가게 이름·업종을 미리 채워 링크를 만들고, 사장님은 이메일·비밀번호만 입력하면
// 승인 상태로 즉시 개설 (관리자가 초대 = 승인 심사 불필요).
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export async function makeInviteToken(secret, assocId, bizName, category) {
  const json = JSON.stringify({ a: assocId, b: bizName, c: category, x: Date.now() + INVITE_TTL_MS });
  const sig = await hmacSign(secret, "invite|" + json);
  return `${b64uFromBytes(new TextEncoder().encode(json))}.${sig}`;
}
export async function verifyInviteToken(secret, token, assocId) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  let raw;
  try { raw = new TextDecoder().decode(bytesFromB64u(parts[0])); } catch { return null; }
  if (!(await hmacVerify(secret, "invite|" + raw, parts[1]))) return null;
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || data.a !== assocId || !data.x || Date.now() > data.x) return null;
  return data;
}
export async function adminCreateInvite(ctx) {
  const { env, form, base, assoc } = ctx;
  const bizName = cap((form.get("biz_name") || "").trim(), 100);
  if (!bizName) return back(base + "/admin", "가게 이름을 입력해 주세요.", true);
  const token = await makeInviteToken(env.SESSION_SECRET, assoc.id, bizName, cap(form.get("category"), 40));
  await audit(ctx, "초대링크생성", bizName);
  return redirect(`${base}/admin?invite=${encodeURIComponent(token)}#p-members`);
}
export async function acceptInvite(ctx) {
  const { db, env, form, addCookie, isProd, base, assoc, ip } = ctx;
  if (rateLimited(ip)) return back(base + "/invite", "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.", true);
  const inv = await verifyInviteToken(env.SESSION_SECRET, form.get("token"), assoc.id);
  if (!inv) { recordFail(ip); return back(base + "/invite", "초대 링크가 만료되었거나 올바르지 않습니다. 관리자에게 새 링크를 요청해 주세요.", true); }
  const name = cap((form.get("name") || "").trim(), 60);
  const email = cap((form.get("email") || "").toLowerCase().trim(), 120);
  const password = form.get("password") || "";
  if (form.get("agree") !== "1") return back(`${base}/invite?t=${encodeURIComponent(form.get("token"))}`, "개인정보 수집·이용에 동의해 주세요.", true);
  if (!name || !EMAIL_RE.test(email) || password.length < 8 || password.length > 200)
    return back(`${base}/invite?t=${encodeURIComponent(form.get("token"))}`, "입력값을 확인해 주세요. (비밀번호 8자 이상)", true);
  if (await D.getUserByEmail(db, email)) return back("/login", "이미 가입된 이메일입니다. 로그인해 주세요.", true);
  if ((await D.countMembers(db, assoc.id)) >= planOf(assoc).maxMembers)
    return back(base + "/invite", "회원 정원이 가득 찼습니다. 상인회 관리자에게 문의해 주세요.", true);
  const { hash, salt } = await hashPassword(password);
  const user = await D.createUser(db, { email, passwordHash: hash, salt, name, role: "MERCHANT", associationId: assoc.id });
  const biz = await D.createBusiness(db, { associationId: assoc.id, ownerId: user.id, name: inv.b, category: inv.c || "기타" });
  await D.setBusinessStatus(db, biz.id, "approved"); // 관리자가 초대했으므로 즉시 공개
  await D.createNotification(db, { associationId: assoc.id, kind: "new_business", message: `초대 링크로 ${name}님이 '${inv.b}' 개설을 마쳤습니다.`, link: base + "/admin" });
  addCookie(sessionCookie(await sessionTokenForUser(user, env.SESSION_SECRET), isProd));
  return back(base + "/dashboard", "환영합니다! 가게가 바로 공개되었습니다. 사진과 제품·메뉴를 채워보세요.");
}

export async function forgotPassword(ctx) {
  const { db, env, form, request } = ctx;
  const email = (form.get("email") || "").toLowerCase().trim();
  const user = email ? await D.getUserByEmail(db, email) : null;
  // 이메일 설정 시: 재설정 링크 자동 발송 (존재 여부 무관 동일 안내 = 계정 열거 방지)
  if (emailEnabled(env)) {
    if (user) {
      const token = await makeResetToken(env.SESSION_SECRET, email);
      const origin = new URL(request.url).origin;
      const link = `${origin}/reset?token=${encodeURIComponent(token)}`;
      await sendEmail(env, {
        to: email, subject: "비밀번호 재설정 안내",
        html: mailShell("비밀번호 재설정", `<p>아래 버튼을 눌러 새 비밀번호를 설정하세요. 링크는 <b>1시간</b> 동안만 유효합니다.</p>${mailButton(link, "새 비밀번호 설정")}`),
      });
    }
    return back("/forgot", "가입된 이메일이라면 재설정 링크를 보냈습니다. 메일함을 확인해 주세요.");
  }
  // 이메일 미설정 폴백: 관리자에게 알림
  if (user && user.association_id) {
    const a = await D.getAssociationById(db, user.association_id);
    await D.createNotification(db, { associationId: user.association_id, kind: "password_reset", message: `비밀번호 재설정 요청: ${user.name} (${user.email})`, link: a ? `/t/${a.slug}/admin` : "" });
  }
  return back("/forgot", "요청이 접수되었습니다. 관리자가 확인 후 임시 비밀번호를 안내해 드립니다.");
}

export async function resetPassword(ctx) {
  const { db, env, form } = ctx;
  const email = await verifyResetToken(env.SESSION_SECRET, form.get("token"));
  if (!email) return back("/forgot", "링크가 만료되었거나 올바르지 않습니다. 다시 요청해 주세요.", true);
  const pw = String(form.get("password") || "");
  if (pw.length < 8) return back("/reset?token=" + encodeURIComponent(form.get("token") || ""), "비밀번호는 8자 이상이어야 합니다.", true);
  const user = await D.getUserByEmail(db, email);
  if (!user) return back("/forgot", "계정을 찾을 수 없습니다.", true);
  const h = await hashPassword(pw);
  await D.updateUserPassword(db, user.id, h.hash, h.salt);
  return redirect("/login?msg=" + encodeURIComponent("비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요."));
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
  if (!planOf(a).customDomain) return back("/super", "이 상인회 플랜은 개별 도메인을 지원하지 않습니다.", true);
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

// ---------- 셀프 입점 신청 (공개) ----------
export async function applySubmit(ctx) {
  const { db, env, form, ip } = ctx;
  if (!(await turnstileVerify(env, form.get("cf-turnstile-response"), ip)))
    return back("/apply", "봇 방지 확인에 실패했습니다. 다시 시도해 주세요.", true);
  if (form.get("agree") !== "1") return back("/apply", "개인정보 수집·이용에 동의해 주세요.", true);
  const assocName = cap((form.get("assoc_name") || "").trim(), 100);
  const contactEmail = cap((form.get("contact_email") || "").toLowerCase().trim(), 120);
  if (!assocName || !EMAIL_RE.test(contactEmail))
    return back("/apply", "상인회 이름과 올바른 이메일을 입력해 주세요.", true);
  await D.createApplication(db, {
    assocName, contactEmail,
    contactName: cap(form.get("contact_name"), 60),
    contactPhone: cap(form.get("contact_phone"), 40),
    message: cap(form.get("message"), 2000),
  });
  await D.createNotification(db, { associationId: null, kind: "application", message: `새 입점 신청: ${assocName} (${contactEmail})`, link: "/super" });
  return back("/apply", "신청이 접수되었습니다. 검토 후 이메일로 안내드리겠습니다.");
}

// ---------- 슈퍼: 입점 신청 승인/반려 ----------
export async function approveApplication(ctx) {
  const { db, params } = ctx;
  const app = await D.getApplication(db, Number(params.id));
  if (!app || app.status !== "pending") return back("/super", "처리할 신청을 찾을 수 없습니다.", true);
  if (await D.getUserByEmail(db, app.contact_email)) return back("/super", "이미 사용 중인 이메일입니다. 신청자에게 다른 이메일을 요청하세요.", true);
  // 상인회 + 관리자(임시 비밀번호) 자동 발급
  let slug = slugify(app.assoc_name), n = 1;
  while (await D.getAssociationBySlug(db, slug)) slug = slugify(app.assoc_name) + "-" + (++n);
  const assoc = await D.createAssociation(db, { slug, name: app.assoc_name });
  const temp = Math.random().toString(36).slice(2, 10);
  const { hash, salt } = await hashPassword(temp);
  await D.createUser(db, { email: app.contact_email, passwordHash: hash, salt, name: app.assoc_name + " 관리자", role: "ADMIN", associationId: assoc.id });
  await D.setApplicationStatus(db, app.id, "approved");
  await audit(ctx, "입점승인", `${app.assoc_name} (${app.contact_email})`, null);
  // 이메일 설정 시: 신청자에게 접속 안내 자동 발송
  if (emailEnabled(ctx.env)) {
    const origin = new URL(ctx.request.url).origin;
    const r = await sendEmail(ctx.env, {
      to: app.contact_email, subject: `'${app.assoc_name}' 홈페이지가 개설되었습니다`,
      html: mailShell("홈페이지 개설 완료", `<p><b>${esc(app.assoc_name)}</b> 홈페이지가 준비되었습니다.</p>
        <p>관리자 계정: <b>${app.contact_email}</b><br>임시 비밀번호: <b style="font-family:monospace">${temp}</b></p>
        <p>로그인 후 반드시 비밀번호를 변경해 주세요.</p>${mailButton(origin + "/login", "로그인하기")}
        <p>홈 주소: ${origin}/t/${assoc.slug}</p>`),
    });
    if (r.sent) return back("/super", `'${app.assoc_name}' 발급 완료 — 주소 /t/${assoc.slug}. 접속 안내 메일을 ${app.contact_email} 로 보냈습니다.`);
  }
  return back("/super", `'${app.assoc_name}' 발급 완료 — 주소 /t/${assoc.slug}, 관리자 ${app.contact_email} / 임시비번 ${temp} (신청자에게 전달하세요)`);
}
export async function rejectApplication(ctx) {
  const { db, params } = ctx;
  const app = await D.getApplication(db, Number(params.id));
  if (app && app.status === "pending") { await D.setApplicationStatus(db, app.id, "rejected"); await audit(ctx, "입점반려", app.assoc_name, null); }
  return back("/super", "신청을 반려했습니다.");
}

// ---------- 슈퍼: 상인회 플랜 변경 ----------
// 상인회별 네이버 지도 키 (비우면 플랫폼 공용) — 도메인 10개 초과 확장용
export async function superSetMapKey(ctx) {
  const { db, form, params } = ctx;
  const a = await D.getAssociationById(db, Number(params.id));
  if (!a) return back("/super", "상인회를 찾을 수 없습니다.", true);
  const key = (form.get("map_client_id") || "").trim();
  if (key && !/^[a-z0-9]{4,24}$/i.test(key)) return back("/super", "지도 키 형식이 올바르지 않습니다. (영문·숫자)", true);
  await D.setAssociationMapKey(db, a.id, key);
  await audit(ctx, "지도키", `${a.name} → ${key || "(공용)"}`, null);
  return back("/super", key ? `'${a.name}' 전용 지도 키를 설정했습니다.` : `'${a.name}' 지도 키를 공용으로 되돌렸습니다.`);
}

export async function superSetPlan(ctx) {
  const { db, form, params } = ctx;
  const { PLAN_KEYS } = await import("./plans.js");
  const a = await D.getAssociationById(db, Number(params.id));
  if (!a) return back("/super", "상인회를 찾을 수 없습니다.", true);
  const plan = form.get("plan");
  if (!PLAN_KEYS.includes(plan)) return back("/super", "잘못된 플랜입니다.", true);
  await D.setAssociationPlan(db, a.id, plan);
  await audit(ctx, "플랜변경", `${a.name} → ${plan}`, null);
  return back("/super", `'${a.name}' 플랜을 ${plan} 으로 변경했습니다.`);
}

// ---------- 슈퍼: 플랫폼 랜딩 모드 토글 ----------
export async function superSetPlatformMode(ctx) {
  await D.setSetting(ctx.db, "platform_mode", ctx.form.get("on") === "1" ? "1" : "0");
  return back("/super", "플랫폼 설정을 저장했습니다.");
}

// ---------- 슈퍼: 플랫폼/운영자 정보 저장 ----------
export async function superSetPlatformInfo(ctx) {
  const { db, form } = ctx;
  await D.setSetting(db, "site_name", cap((form.get("site_name") || "").trim(), 60));
  await D.setSetting(db, "operator", cap((form.get("operator") || "").trim(), 80));
  await D.setSetting(db, "contact_email", cap((form.get("contact_email") || "").trim(), 120));
  await D.setSetting(db, "contact_phone", cap((form.get("contact_phone") || "").trim(), 40));
  return back("/super", "플랫폼 정보를 저장했습니다.");
}
