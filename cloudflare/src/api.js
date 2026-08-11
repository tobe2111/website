// 폼 처리 핸들러 (POST). ctx.form 은 파싱된 FormData.
import * as D from "./db.js";
import { verifyPassword, hashPassword, hmacSign, hmacVerify, b64uFromBytes, bytesFromB64u, sha256HexBytes, sha256Hex } from "./crypto.js";
import { sendEmail, emailEnabled, mailShell, mailButton } from "./email.js";
import { sessionTokenForUser, sessionCookie, clearSessionCookie } from "./auth.js";
import { back, redirect } from "./http.js";
import * as storage from "./storage.js";
import { parseEmbed } from "./embed.js";
import { cap, sniffImage, EMAIL_RE, MAX_IMAGE_BYTES, slugify, esc } from "./util.js";
import { contentHash, sealRecord, newVerifyCode, SEAL_VER, fieldsHashOf } from "./esign.js";
import { isFieldKind, round4, FIELD_KINDS, pageCount } from "./paper.js";
import { builtinById, isBuiltinId, normalizeTemplate, extractVars, applyVars, resolveFieldPages } from "./templates.js";
import { resolveExtToken, makeExtToken, extSignUrl, sendSignLink, remindExternals } from "./extsign.js";
import { enqueueDocEvent, newApiKey, hashApiKey, KEY_PREFIX } from "./apiv1.js";
import { turnstileVerify } from "./turnstile.js";
import { planOf } from "./plans.js";
import { seedDemo } from "./demoContent.js";
import { seedStarter } from "./starterContent.js";
import { TEMPLATE_KEYS, sendMany, sendOne, notifyEnabled, wonToJeon, renderTemplate, templateButton, billingMode, chargeContract, BILLING_MODES, priceOf } from "./notify.js";

// ctx.request 는 내부 호출 경로에서 없을 수 있다 — 감사 기록이 본 기능을 죽이면 안 된다
const uaOf = (ctx) => { try { return ctx.request.headers.get("user-agent") || ""; } catch { return ""; } };
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
  // 휴대폰은 선택 입력 — 넣었으면 형식만 확인(알림톡 수신용)
  const phone = D.normalizePhone(form.get("phone"));
  if (phone && !D.isValidPhone(phone)) return back(base + "/register", "휴대폰 번호 형식을 확인해 주세요. (예: 010-1234-5678)", true);
  const { hash, salt } = await hashPassword(password);
  const user = await D.createUser(db, { email, passwordHash: hash, salt, name, role: "MERCHANT", associationId: assoc.id, phone });
  await D.createBusiness(db, { associationId: assoc.id, ownerId: user.id, name: businessName, category: cap(form.get("category"), 40) });
  await D.createNotification(db, { associationId: assoc.id, kind: "new_business", message: `${name}님이 '${businessName}' 업체로 가입했습니다. 승인 대기 중입니다.`, link: base + "/admin" });
  addCookie(sessionCookie(await sessionTokenForUser(user, env.SESSION_SECRET), isProd));
  return back(base + "/dashboard", "가입이 완료되었습니다! 업체 정보를 입력하고 사진을 올려보세요.");
}

// ---------- 알림톡 크레딧 ----------
// 충전 금액은 자유 입력 — 상인회 규모가 제각각이라 고정 금액만으로는 맞지 않는다.
// 최소 1만원(소액 입금 확인 부담), 최대 500만원(오입력 방지) 사이 1천원 단위.
const CHARGE_MIN = 10000, CHARGE_MAX = 5000000, CHARGE_STEP = 1000;
export async function adminCreditOrder(ctx) {
  const { db, form, base, assoc } = ctx;
  const amount = parseInt(String(form.get("amount") || "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(amount) || amount < CHARGE_MIN || amount > CHARGE_MAX || amount % CHARGE_STEP !== 0)
    return back(base + "/admin", `충전 금액은 ${CHARGE_MIN.toLocaleString()}원 ~ ${CHARGE_MAX.toLocaleString()}원 사이에서 1,000원 단위로 입력해 주세요.`, true);
  await D.createCreditOrder(db, { associationId: assoc.id, amount, depositor: cap(form.get("depositor"), 40) });
  await D.createNotification(db, { associationId: null, kind: "credit_order", message: `${assoc.name}이(가) 알림톡 ${amount.toLocaleString()}원 충전을 신청했습니다.`, link: "/super" });
  await audit(ctx, "충전신청", `${amount}원`);
  return back(base + "/admin", "충전을 신청했습니다. 입금이 확인되면 잔액에 반영됩니다.");
}
// 슈퍼: 충전 승인/반려 — 승인 시에만 잔액이 늘어난다
export async function superCreditApprove(ctx) {
  const { db, params, form } = ctx;
  const o = await D.getCreditOrder(db, Number(params.id));
  if (!o || o.status !== "pending") return back("/super", "이미 처리된 신청입니다.", true);
  if (form.get("action") === "reject") {
    await D.setCreditOrderStatus(db, o.id, "rejected");
    await audit(ctx, "충전반려", `#${o.id} ${o.amount}원`, null);
    return back("/super", "충전 신청을 반려했습니다.");
  }
  await D.setCreditOrderStatus(db, o.id, "approved");
  await D.addCredit(db, o.association_id, o.amount, { memo: `충전 승인 #${o.id}${o.depositor ? ` (${o.depositor})` : ""}` });
  await audit(ctx, "충전승인", `#${o.id} ${o.amount}원`, null);
  return back("/super", `${o.amount.toLocaleString()}원을 충전했습니다.`);
}
// 슈퍼: 알림톡 원가 설정 (마진 계산 기준)
export async function superNotifyCost(ctx) {
  const { db, form } = ctx;
  // 알림톡 원가는 6.5원처럼 소수점이 있다 — 전(0.01원) 단위 정수로 환산해 저장
  const won = parseFloat(String(form.get("cost_alimtalk") || "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(won) || won < 0 || won > 1000) return back("/super", "원가는 0~1000원 사이로 입력해 주세요. (소수점 가능, 예: 6.5)", true);
  const jeon = wonToJeon(won);
  await D.setSetting(db, "cost_alimtalk_jeon", String(jeon));
  await audit(ctx, "알림톡원가", `${won}원`, null);
  return back("/super", `알림톡 원가를 ${won}원으로 저장했습니다. (이후 발송분부터 적용)`);
}

// 슈퍼: 상인회별 단가 설정 (0 = 플랫폼 기본가 적용)
// 슈퍼: 과금 방식 (발송당 / 계약당)
export async function superBillingMode(ctx) {
  const { db, form } = ctx;
  const mode = form.get("billing_mode") === "per_doc" ? "per_doc" : "per_send";
  await D.setSetting(db, "billing_mode", mode);
  await audit(ctx, "과금방식변경", BILLING_MODES[mode], null);
  return back("/super", `과금 방식을 '${BILLING_MODES[mode]}'로 바꿨습니다. 이미 만들어진 계약에는 소급되지 않습니다.`);
}

export async function superSetUnitPrice(ctx) {
  const { db, params, form } = ctx;
  const a = await D.getAssociationById(db, Number(params.id));
  if (!a) return back("/super", "상인회를 찾을 수 없습니다.", true);
  const p = parseInt(String(form.get("unit_price") || "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(p) || p < 0 || p > 1000) return back("/super", "단가는 0~1000원 사이로 입력해 주세요. (0 = 기본가 적용)", true);
  await D.setUnitPrice(db, a.id, p);
  await audit(ctx, "상인회단가", `${a.name} → ${p === 0 ? "기본가" : p + "원"}`, null);
  return back("/super", `'${a.name}' 알림톡 단가를 ${p === 0 ? "플랫폼 기본가로" : p.toLocaleString() + "원으로"} 설정했습니다.`);
}

// 슈퍼: 알림톡 판매단가·템플릿 코드 설정
export async function superNotifySettings(ctx) {
  const { db, form } = ctx;
  const price = parseInt(form.get("price_alimtalk") || "", 10);
  if (!Number.isFinite(price) || price < 0 || price > 1000) return back("/super", "판매단가는 0~1000원 사이로 입력해 주세요.", true);
  await D.setSetting(db, "price_alimtalk", String(price));
  for (const [kind, key] of Object.entries(TEMPLATE_KEYS)) {
    const v = (form.get(key) || "").trim().slice(0, 60);
    if (v !== null) await D.setSetting(db, key, v.replace(/[^\w-]/g, ""));
  }
  await audit(ctx, "알림톡설정", `단가 ${price}원`, null);
  return back("/super", "알림톡 설정을 저장했습니다.");
}

// ---------- 계정: 알림 휴대폰 ----------
export async function changePhone(ctx) {
  const { db, form, user } = ctx;
  const raw = (form.get("phone") || "").trim();
  if (!raw) { await D.setUserPhone(db, user.id, ""); return back("/account", "휴대폰 번호를 지웠습니다. 알림톡은 발송되지 않습니다."); }
  if (!D.isValidPhone(raw)) return back("/account", "휴대폰 번호 형식을 확인해 주세요. (예: 010-1234-5678)", true);
  await D.setUserPhone(db, user.id, raw);
  return back("/account", "알림 받을 휴대폰을 저장했습니다.");
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
  // naver.me·bit.ly 같은 단축 주소는 서버에서 원본을 알 수 없어 그대로는 못 씁니다.
  // 왜 안 되는지 알려 주지 않으면 사장님이 같은 주소를 계속 붙여넣게 됩니다.
  if (!parsed) {
    const short = /(?:naver\.me|bit\.ly|han\.gl|vo\.la|url\.kr|me2\.do)\//i.test(form.get("url") || "");
    return back(base + "/dashboard", short
      ? "단축 주소는 사용할 수 없습니다. 영상을 열어 주소창에 뜨는 원래 주소(tv.naver.com/v/… 또는 youtu.be/…)를 붙여넣어 주세요."
      : "지원하는 영상 링크가 아닙니다. (유튜브·쇼츠·인스타 릴스·네이버TV)", true);
  }
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
  const title = cap((form.get("title") || "").trim(), 200);
  // 서식에서 만들기 — 본문의 {{빈칸}} 을 입력값으로 치환하고, 배치까지 그대로 복사한다.
  const tplId = (form.get("template") || "").trim();
  let tpl = null, tplBody = "", partyMap = [];
  if (tplId) {
    const src = isBuiltinId(tplId) ? builtinById(tplId) : await D.getTemplate(db, Number(tplId) || 0);
    if (!src) return back(base + "/admin/documents", "서식을 찾을 수 없습니다.", true);
    if (!isBuiltinId(tplId) && src.association_id !== 0 && src.association_id !== assoc.id)
      return back(base + "/admin/documents", "다른 상인회의 서식은 쓸 수 없습니다.", true);
    tpl = normalizeTemplate(src);
    const vals = {};
    for (const v of tpl.vars) vals[v] = cap((form.get("var_" + v) || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 200);
    tplBody = applyVars(tpl.body, vals);
    const members = await D.listUsersByAssociation(db, assoc.id, "MERCHANT");
    const valid = new Set(members.map((m) => m.id));
    const n = Math.max(1, tpl.parties.length);
    for (let i = 0; i < n; i++) {
      const id = Number(form.get("party_" + i)) || 0;
      if (id && !valid.has(id)) return back(base + "/admin/documents", "이 상인회 회원만 당사자로 지정할 수 있습니다.", true);
      partyMap.push(id);
    }
    if (!partyMap.some(Boolean)) return back(base + "/admin/documents", "당사자를 한 명 이상 지정해 주세요.", true);
  }
  const body = tpl ? cap(tplBody, 20000) : cap((form.get("body") || "").trim(), 20000);
  if (!title || !body) return back(base + "/admin/documents", "제목과 본문을 입력하세요.", true);
  const ordered = form.get("ordered") === "1" ? 1 : 0;
  let dueDate = ""; const rawDue = (form.get("due_date") || "").trim();
  if (rawDue) { if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDue)) return back(base + "/admin/documents", "기한 형식(YYYY-MM-DD)을 확인하세요.", true);
    if (rawDue < new Date().toISOString().slice(0, 10)) return back(base + "/admin/documents", "기한은 오늘 이후여야 합니다.", true); dueDate = rawDue; }
  // 계약서 PDF 첨부(선택) — 파일 내용 해시를 본문 해시에 함께 묶어야 봉인이 첨부까지 보호한다
  let attKey = "", attName = "", attHash = "";
  const file = form.get("attachment");
  if (file && typeof file === "object" && file.size > 0) {
    if (!storage.enabled(ctx.env)) return back(base + "/admin/documents", "파일 저장소(R2)가 연결되지 않아 첨부할 수 없습니다.", true);
    if (file.size > 10 * 1024 * 1024) return back(base + "/admin/documents", "PDF는 10MB 이하만 첨부할 수 있습니다.", true);
    const buf = new Uint8Array(await file.arrayBuffer());
    // 확장자·MIME 이 아니라 실제 선두 바이트(%PDF-)로 판별 — 위장 업로드 차단
    if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46))
      return back(base + "/admin/documents", "PDF 파일만 첨부할 수 있습니다.", true);
    attHash = await sha256HexBytes(buf);
    attKey = await storage.save(ctx.env, buf, "application/pdf");
    attName = cap(String(file.name || "계약서.pdf").replace(/[\\/\x00-\x1f]/g, ""), 120);
  }
  const docHash = attHash ? await contentHash(`${body}\n--attachment--\n${attHash}`) : await contentHash(body);
  // 계약당 과금이면 문서를 만드는 시점에 한 번 청구한다. 잔액이 없으면 아예 만들지 않는다 —
  // 만들어 두고 발송이 안 되면 상대방은 링크를 못 받고 관리자만 헛일을 한다.
  if ((await billingMode(db)) === "per_doc") {
    const bal = await D.getBalance(db, assoc.id);
    const price = await priceOf(db, "alimtalk", assoc.id);
    if (bal < price) return back(base + "/admin/documents", `크레딧 잔액이 부족합니다. (계약 1건 ${price.toLocaleString()}원 · 잔액 ${bal.toLocaleString()}원)`, true);
  }
  const doc = await D.createDocument(db, { associationId: assoc.id, title, body, contentHash: docHash, createdBy: user.id, ordered, dueDate });
  if ((await billingMode(db)) === "per_doc") await chargeContract(db, assoc, { documentId: doc.id, title });
  if (attKey) await D.setDocumentAttachment(db, doc.id, attKey, attName, attHash);
  // 서식이면 당사자 지정 순서가 곧 서명 순서이고, 배치는 당사자 → 실제 회원으로 옮겨 붙인다
  if (tpl) {
    const signers = partyMap.filter(Boolean);
    await D.createSignatureRequests(db, doc.id, signers);
    const pages = pageCount(body);
    const placed = resolveFieldPages(tpl.fields, pages).map((f) => ({
      kind: f.kind, label: f.label || "", page: f.page,
      x: round4(f.x), y: round4(f.y), w: round4(f.w), h: round4(f.h),
      assignee: partyMap[f.party | 0] || 0, required: f.required ? 1 : 0,
    })).filter((f) => isFieldKind(f.kind) && f.x + f.w <= 1.0001 && f.y + f.h <= 1.0001);
    if (placed.length) await D.replaceFields(db, doc.id, placed);
    const recips = (await D.listUsersByAssociation(db, assoc.id, "MERCHANT")).filter((m) => signers.includes(m.id));
    await D.logDocEvent(db, { documentId: doc.id, userId: user.id, actorName: user.name, kind: "created", detail: `서식: ${tpl.title}`, ip: ctx.ip || "", userAgent: uaOf(ctx) });
    await notifyNewDocument(ctx, doc, title, dueDate, ordered, recips);
    await audit(ctx, "서명문서생성", `${title} (서식: ${tpl.title})`);
    return redirect(`${base}/admin/documents/${doc.id}/fields?msg=${encodeURIComponent("서식으로 문서를 만들었습니다. 서명 자리를 확인하고 저장하세요.")}`);
  }
  const target = form.get("target");
  const members = await D.listUsersByAssociation(db, assoc.id, "MERCHANT");
  let recipients = [];
  if (target === "all") { recipients = members; await D.createSignatureRequests(db, doc.id, members.map((m) => m.id)); }
  else if (target === "select") { const valid = new Map(members.map((m) => [m.id, m])); const chosen = form.getAll("members").map(Number).filter((id) => valid.has(id)); recipients = chosen.map((id) => valid.get(id)); await D.createSignatureRequests(db, doc.id, chosen); }
  await D.logDocEvent(db, { documentId: doc.id, userId: user.id, actorName: user.name, kind: "created", ip: ctx.ip || "", userAgent: uaOf(ctx) });
  await notifyNewDocument(ctx, doc, title, dueDate, ordered, recipients);
  await audit(ctx, "서명문서생성", title);
  return back(base + "/admin/documents", ordered ? "순차 서명 문서를 생성했습니다." : "문서를 생성했습니다.");
}
// 웹훅 큐에 넣고, 모두 서명이 끝났으면 완료 이벤트도 함께 남긴다.
async function notifyWebhook(ctx, doc, event, payload) {
  try {
    await enqueueDocEvent(ctx.db, doc.id, event, payload);
    if (event === "document.signed") {
      const rc = await D.requestCounts(ctx.db, doc.id);
      if (rc.total > 0 && rc.signed === rc.total)
        await enqueueDocEvent(ctx.db, doc.id, "document.completed", { document_id: doc.id, title: doc.title, signers: rc.total });
    }
  } catch {}
}

// 관리자: API 키 발급. 평문은 이 순간에만 보여주고 저장하지 않는다(해시만 보관).
export async function adminCreateApiKey(ctx) {
  const { db, form, base, assoc } = ctx;
  const to = `${base}/admin/api`;
  const name = cap((form.get("name") || "").trim(), 60) || "기본 키";
  const webhook = cap((form.get("webhook_url") || "").trim(), 300);
  if (webhook && !/^https:\/\/[^\s]+$/i.test(webhook)) return back(to, "웹훅 주소는 https:// 로 시작해야 합니다.", true);
  const active = (await D.listApiKeys(db, assoc.id)).filter((k) => !k.revoked_at);
  if (active.length >= 5) return back(to, "활성 키는 최대 5개입니다. 쓰지 않는 키를 먼저 폐기해 주세요.", true);
  const key = newApiKey();
  const rec = await D.createApiKey(db, { associationId: assoc.id, name, prefix: key.slice(0, KEY_PREFIX.length + 6),
    keyHash: await hashApiKey(key), webhookUrl: webhook, webhookSecret: randomHexKey() });
  await audit(ctx, "API키발급", name);
  return redirect(`${to}?newkey=${encodeURIComponent(key)}&id=${rec.id}`);
}
const randomHexKey = () => { const b = crypto.getRandomValues(new Uint8Array(24)); return [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); };

export async function adminRevokeApiKey(ctx) {
  const { db, base, assoc, params } = ctx;
  const to = `${base}/admin/api`;
  const k = await D.getApiKey(db, Number(params.id) || 0);
  if (!k || k.association_id !== assoc.id) return back(to, "키를 찾을 수 없습니다.", true);
  await D.revokeApiKey(db, k.id, assoc.id);
  await audit(ctx, "API키폐기", k.name || k.prefix);
  return back(to, "키를 폐기했습니다. 이 키로는 더 이상 호출할 수 없습니다.");
}
export async function adminSetWebhook(ctx) {
  const { db, form, base, assoc, params } = ctx;
  const to = `${base}/admin/api`;
  const k = await D.getApiKey(db, Number(params.id) || 0);
  if (!k || k.association_id !== assoc.id) return back(to, "키를 찾을 수 없습니다.", true);
  const url = cap((form.get("webhook_url") || "").trim(), 300);
  if (url && !/^https:\/\/[^\s]+$/i.test(url)) return back(to, "웹훅 주소는 https:// 로 시작해야 합니다.", true);
  await D.setApiKeyWebhook(db, k.id, assoc.id, url);
  return back(to, url ? "웹훅 주소를 저장했습니다." : "웹훅을 껐습니다.");
}

// ================= 외부(비회원) 서명 =================
// 이 경로에는 로그인 세션이 없다. 권한의 근거는 오직 HMAC 토큰이며, 토큰이 가리키는
// 서명자 본인의 자리에만 쓸 수 있다. 아래 모든 핸들러가 같은 검증을 먼저 통과한다.
async function extCtx(ctx) {
  const signer = await resolveExtToken(ctx.db, ctx.env.SESSION_SECRET, ctx.params.token || "");
  if (!signer) return null;
  const doc = await D.getDocument(ctx.db, signer.document_id);
  if (!doc) return null;
  const assoc = await D.getAssociationById(ctx.db, doc.association_id);
  if (!assoc) return null;
  return { signer, doc, assoc, to: `/esign/${encodeURIComponent(ctx.params.token)}` };
}

export async function extSign(ctx) {
  const { db, env, form, ip, request } = ctx;
  const c = await extCtx(ctx);
  if (!c) return back("/", "링크가 올바르지 않습니다.", true);
  const { signer, doc: d, assoc, to } = c;
  if (d.closed) return back(to, "마감된 문서입니다.", true);
  if (D.isPastDue(d)) return back(to, "서명 기한이 지났습니다.", true);
  if (signer.declined_at) return back(to, "이미 거절하신 계약입니다.", true);
  if (await D.hasSignedExt(db, d.id, signer.id)) return back(to, "이미 서명하셨습니다.", true);
  if (!(await D.canSignNowAny(db, d, { externalId: signer.id }))) return back(to, "앞 순번의 서명이 완료된 후 서명할 수 있습니다.", true);
  if (form.get("consent") !== "1") return back(to, "동의 확인란에 체크해 주세요.", true);

  let verifyLevel = "link"; // 링크 소지만으로 확인된 상태
  if (await otpRequired(db)) {
    if (!(await D.extOtpVerifiedRecently(db, signer.id))) return back(to, "본인확인을 먼저 완료해 주세요.", true);
    verifyLevel = "otp";
  }
  const myRef = -signer.id;
  const allFields = await D.listFieldsWithValues(db, d.id);
  const myFields = allFields.filter((f) => !f.value && !f.image && (f.assignee === myRef || f.assignee === 0));
  let fieldResult = { signKey: "", hadSignField: false };
  if (myFields.length) {
    fieldResult = await applyFieldValues({ ...ctx, user: { id: myRef } }, d, myFields, form.get("fields"));
    if (fieldResult.error) return back(to, fieldResult.error, true);
  }
  let sigKey = fieldResult.signKey || "";
  if (!fieldResult.hadSignField) {
    const bytes = pngFromDataUrl(form.get("signature"));
    if (!bytes) return back(to, "서명을 입력해 주세요.", true);
    sigKey = storage.enabled(env) ? await storage.save(env, bytes, "image/png") : "";
  }
  const signerName = cap((form.get("signer_name") || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 60) || signer.name;
  const signedAt = new Date().toISOString();
  const prevHash = await D.lastSealHash(db);
  const fieldsHash = await fieldsHashOf(await D.listFilledBy(db, d.id, myRef));
  // 봉인 안의 서명자 식별자는 "x{id}" — 회원 id 와 절대 겹치지 않는 이름공간
  const recordHash = await sealRecord(env, { documentId: d.id, userId: `x${signer.id}`, signerName,
    contentHash: d.content_hash, signedAt, ip, prevHash, fieldsHash, ver: SEAL_VER });
  const verifyCode = newVerifyCode();
  await D.createSignature(db, { documentId: d.id, externalId: signer.id, signerName, signatureImage: sigKey,
    contentHash: d.content_hash, ip, userAgent: cap(request.headers.get("user-agent") || "", 200),
    verifyCode, recordHash, signedAt, prevHash, sealVer: SEAL_VER, verifyLevel, fieldsHash });
  await D.logDocEvent(db, { documentId: d.id, userId: myRef, actorName: signerName, kind: "signed",
    detail: `외부 서명자 · 본인확인 ${verifyLevel} · 검증코드 ${verifyCode}`, ip, userAgent: uaOf(ctx) });

  // 웹훅 — 고객사 시스템이 진행 상황을 즉시 받아본다. 실제 발송은 크론이 하므로 여기서 막히지 않는다.
  await notifyWebhook(ctx, d, "document.signed", { document_id: d.id, title: d.title, signer: { kind: "external", id: signer.id, name: signerName } });
  await D.createNotification(db, { associationId: assoc.id, kind: "signed",
    message: `${signerName}님(외부)이 '${d.title}'에 전자서명했습니다.`, link: `/t/${assoc.slug}/admin/documents/${d.id}` });

  // 확인서 사본 — "받은 적 없다"는 분쟁을 막는 증거. 실패해도 서명은 이미 유효하다.
  try {
    const certUrl = `${new URL(request.url).origin}/certificate/${verifyCode}`;
    if (D.isValidPhone(signer.phone || "")) {
      await sendOne(env, db, { assoc, kind: "sign_done", to: signer.phone,
        text: renderTemplate("sign_done", { 상호: assoc.name, 이름: signerName, 문서명: d.title, 검증코드: verifyCode }),
        buttonName: templateButton("sign_done"), buttonUrl: certUrl });
    }
    if (emailEnabled(env) && signer.email) {
      await sendEmail(env, { to: signer.email, subject: `[${assoc.name}] 전자서명 완료 — ${d.title}`,
        html: mailShell(`${esc(assoc.name)} 전자서명 완료`,
          `<p>${esc(signerName)}님, '<b>${esc(d.title)}</b>' 전자서명이 완료되었습니다.</p>
           <p>검증 코드: <b>${esc(verifyCode)}</b></p>${mailButton(certUrl, "전자서명 확인서 보기")}`) });
    }
  } catch {}
  return back(to, `전자서명이 완료되었습니다. 검증 코드: ${verifyCode}`);
}

export async function extDecline(ctx) {
  const { db, form, ip } = ctx;
  const c = await extCtx(ctx);
  if (!c) return back("/", "링크가 올바르지 않습니다.", true);
  const { signer, doc: d, assoc, to } = c;
  if (await D.hasSignedExt(db, d.id, signer.id)) return back(to, "이미 서명한 계약은 거절할 수 없습니다.", true);
  const reason = cap((form.get("reason") || "").trim(), 300);
  if (!reason) return back(to, "거절 사유를 입력해 주세요.", true);
  await D.declineExternal(db, signer.id, reason);
  await D.logDocEvent(ctx.db, { documentId: d.id, userId: -signer.id, actorName: signer.name, kind: "declined",
    detail: `외부 서명자: ${reason.slice(0, 80)}`, ip, userAgent: uaOf(ctx) });

  // 웹훅 — 고객사 시스템이 진행 상황을 즉시 받아본다. 실제 발송은 크론이 하므로 여기서 막히지 않는다.
  await notifyWebhook(ctx, d, "document.declined", { document_id: d.id, title: d.title, signer: { kind: "external", id: signer.id, name: signer.name } });
  await D.createNotification(db, { associationId: assoc.id, kind: "sign_declined",
    message: `${signer.name}님(외부)이 '${d.title}' 서명을 거절했습니다.`, link: `/t/${assoc.slug}/admin/documents/${d.id}` });
  return back(to, "서명을 거절하셨습니다. 요청하신 분께 사유가 전달됩니다.");
}

export async function extOtpSend(ctx) {
  const { db, env } = ctx;
  const c = await extCtx(ctx);
  if (!c) return back("/", "링크가 올바르지 않습니다.", true);
  const { signer, doc: d, assoc, to } = c;
  const hasPhone = D.isValidPhone(signer.phone || "");
  if (!hasPhone && !signer.email) return back(to, "연락처가 등록되어 있지 않아 본인확인을 할 수 없습니다.", true);
  const cur = await D.getExtOtp(db, signer.id);
  if (cur && Date.parse(cur.created_at.replace(" ", "T") + "Z") > Date.now() - 60 * 1000)
    return back(to, "인증번호를 방금 보냈습니다. 1분 뒤에 다시 요청해 주세요.", true);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await D.upsertExtOtp(db, { externalId: signer.id, codeHash: await sha256Hex(`ext|${signer.id}|${code}`), phone: signer.phone });
  const msg = renderTemplate("sign_otp", { 상호: assoc.name, 인증번호: code, 유효시간: D.OTP_TTL_MIN });
  let via = "";
  if (hasPhone && notifyEnabled(env)) {
    const r = await sendOne(env, db, { assoc, kind: "sign_otp", to: signer.phone, text: msg });
    if (r.ok) via = `${D.maskPhone(signer.phone)} 으로 알림톡을`;
    else if (r.insufficient) { await D.clearExtOtp(db, signer.id); return back(to, "발송 크레딧이 부족해 인증번호를 보내지 못했습니다. 요청하신 분께 문의해 주세요.", true); }
  }
  if (!via && emailEnabled(env) && signer.email) {
    await sendEmail(env, { to: signer.email, subject: `[${assoc.name}] 전자서명 본인확인 번호`,
      html: mailShell("본인확인 번호", `<p>아래 번호를 서명 화면에 입력해 주세요.</p><p style="font-size:28px;font-weight:800;letter-spacing:.1em">${esc(code)}</p><p style="color:#888">${D.OTP_TTL_MIN}분 후 만료됩니다.</p>`) }).catch(() => {});
    via = "등록된 이메일로";
  }
  if (!via) { await D.clearExtOtp(db, signer.id); return back(to, "인증번호를 보낼 수단이 없습니다. 요청하신 분께 문의해 주세요.", true); }
  await D.logDocEvent(db, { documentId: d.id, userId: -signer.id, actorName: signer.name, kind: "otp_sent", detail: "외부 서명자", ip: ctx.ip || "" });
  return back(to, `${via} 인증번호를 보냈습니다. ${D.OTP_TTL_MIN}분 안에 입력해 주세요.`);
}

export async function extOtpVerify(ctx) {
  const { db, form } = ctx;
  const c = await extCtx(ctx);
  if (!c) return back("/", "링크가 올바르지 않습니다.", true);
  const { signer, doc: d, to } = c;
  const rec = await D.getExtOtp(db, signer.id);
  if (!rec) return back(to, "먼저 인증번호를 요청해 주세요.", true);
  if (rec.attempts >= D.OTP_MAX_ATTEMPTS) return back(to, "시도 횟수를 초과했습니다. 인증번호를 다시 요청해 주세요.", true);
  if (Date.parse(rec.expires_at.replace(" ", "T") + "Z") < Date.now()) return back(to, "인증번호가 만료되었습니다. 다시 요청해 주세요.", true);
  const input = (form.get("code") || "").replace(/\D/g, "");
  await D.bumpExtOtpAttempt(db, rec.id);
  const ok = input.length === 6 && (await sha256Hex(`ext|${signer.id}|${input}`)) === rec.code_hash;
  if (!ok) return back(to, `인증번호가 올바르지 않습니다. (남은 시도 ${Math.max(0, D.OTP_MAX_ATTEMPTS - rec.attempts - 1)}회)`, true);
  await D.markExtOtpVerified(db, rec.id);
  await D.logDocEvent(db, { documentId: d.id, userId: -signer.id, actorName: signer.name, kind: "otp_ok", detail: "외부 서명자", ip: ctx.ip || "" });
  return back(to, "본인확인이 완료되었습니다. 아래에서 서명해 주세요.");
}

// 관리자: 외부 서명자 추가 → 서명 링크 발급(+ 알림톡·이메일 발송)
export async function adminAddExternalSigner(ctx) {
  const { db, env, form, base, assoc, params, request } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  const to = `${base}/admin/documents/${d ? d.id : ""}`;
  if (!d || d.association_id !== assoc.id) return back(base + "/admin/documents", "문서를 찾을 수 없습니다.", true);
  if (d.closed) return back(to, "마감된 문서입니다.", true);
  const name = cap((form.get("name") || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 60);
  const email = cap((form.get("email") || "").toLowerCase().trim(), 120);
  const phone = D.normalizePhone(form.get("phone") || "");
  const org = cap((form.get("org") || "").trim(), 80);
  if (!name) return back(to, "서명자 이름을 입력해 주세요.", true);
  if (email && !EMAIL_RE.test(email)) return back(to, "이메일 형식을 확인해 주세요.", true);
  if (phone && !D.isValidPhone(phone)) return back(to, "휴대폰 번호 형식을 확인해 주세요.", true);
  if (!email && !phone) return back(to, "링크를 보낼 이메일 또는 휴대폰 중 하나는 필요합니다.", true);
  if ((await D.listExternalSigners(db, d.id)).length >= 20) return back(to, "외부 서명자는 최대 20명까지 추가할 수 있습니다.", true);

  const signOrder = await D.nextSignOrder(db, d.id);
  const signer = await D.addExternalSigner(db, { documentId: d.id, name, email, phone, org, signOrder });
  const token = await makeExtToken(env.SESSION_SECRET, signer.id, d.id);
  const link = extSignUrl(new URL(request.url).origin, token);

  const via = await sendSignLink(env, db, { assoc, doc: d, signer, origin: new URL(request.url).origin });
  const sent = via === "alimtalk" ? "알림톡을 보냈습니다." : via === "email" ? "이메일을 보냈습니다." : "";
  await audit(ctx, "외부서명자추가", `${d.title}: ${name}`);
  return redirect(`${to}?extlink=${encodeURIComponent(token)}&msg=${encodeURIComponent(`${name}님을 추가했습니다. ${sent || "아래 링크를 직접 전달해 주세요."}`)}`);
}

export async function adminRemoveExternalSigner(ctx) {
  const { db, base, assoc, params } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  if (!d || d.association_id !== assoc.id) return back(base + "/admin/documents", "문서를 찾을 수 없습니다.", true);
  const to = `${base}/admin/documents/${d.id}`;
  const signer = await D.getExternalSigner(db, Number(params.sid) || 0);
  if (!signer || signer.document_id !== d.id) return back(to, "서명자를 찾을 수 없습니다.", true);
  if (await D.hasSignedExt(db, d.id, signer.id)) return back(to, "이미 서명한 사람은 삭제할 수 없습니다.", true);
  await D.removeExternalSigner(db, signer.id, d.id);
  await audit(ctx, "외부서명자삭제", `${d.title}: ${signer.name}`);
  return back(to, "외부 서명자를 삭제했습니다.");
}

// ---------- 서명 본인확인 OTP ----------
// 목적: "로그인한 계정 = 본인"이라는 전제를 보강한다. 계정을 빌려줬거나 세션이 탈취돼도
//       본인 휴대폰이 없으면 서명을 완성할 수 없다.
export const otpRequired = async (db) => (await D.getSetting(db, "esign_otp")) === "1";

export async function signOtpSend(ctx) {
  const { db, env, base, assoc, user, params } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  if (!d || d.association_id !== assoc.id) return back(base + "/sign", "문서를 찾을 수 없습니다.", true);
  if (d.closed || D.isPastDue(d)) return back(base + "/sign", "서명할 수 없는 문서입니다.", true);
  if (!(await D.canReceiveSign(db, d.id, user.id))) return back(base + "/sign", "이 문서의 서명 대상이 아닙니다.", true);
  if (!D.isValidPhone(user.phone || "")) return back(base + "/sign/" + d.id, "본인확인에 쓸 휴대폰이 없습니다. 계정 설정에서 번호를 등록해 주세요.", true);
  // 재발송 남용 방지 — 직전 발송 후 60초 이내면 거절 (비용·문자 폭탄 방지)
  const cur = await D.getSignOtp(db, d.id, user.id);
  if (cur && Date.parse(cur.created_at.replace(" ", "T") + "Z") > Date.now() - 60 * 1000)
    return back(base + "/sign/" + d.id, "인증번호를 방금 보냈습니다. 1분 뒤에 다시 요청해 주세요.", true);

  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6자리
  await D.upsertSignOtp(db, { documentId: d.id, userId: user.id, codeHash: await sha256Hex(`otp|${d.id}|${user.id}|${code}`), phone: user.phone });
  const msg = renderTemplate("sign_otp", { 상호: assoc.name, 인증번호: code, 유효시간: D.OTP_TTL_MIN });
  // 알림톡이 준비되지 않았어도(카카오 채널 승인 대기 등) 이메일로 보낼 수 있으면 보낸다.
  // 그래야 알림톡 개통 전에 본인확인을 켜도 서명이 막히지 않는다.
  let via = "";
  if (notifyEnabled(env)) {
    const r = await sendOne(env, db, { assoc, kind: "sign_otp", to: user.phone, text: msg });
    if (r.ok) via = `${D.maskPhone(user.phone)} 으로 알림톡을`;
    else if (r.insufficient) { await D.clearSignOtp(db, d.id, user.id); return back(base + "/sign/" + d.id, "알림 크레딧이 부족해 인증번호를 보내지 못했습니다. 상인회 관리자에게 문의해 주세요.", true); }
  }
  if (!via && emailEnabled(env) && user.email) {
    await sendEmail(env, { to: user.email, subject: `[${assoc.name}] 전자서명 본인확인 번호`,
      html: mailShell("본인확인 번호", `<p>아래 번호를 서명 화면에 입력해 주세요.</p><p style="font-size:28px;font-weight:800;letter-spacing:.1em">${esc(code)}</p><p style="color:#888">${D.OTP_TTL_MIN}분 후 만료됩니다.</p>`) }).catch(() => {});
    via = `${esc(user.email)} 로 이메일을`;
  }
  if (!via) {
    await D.clearSignOtp(db, d.id, user.id);
    return back(base + "/sign/" + d.id, "인증번호를 보낼 수단이 없습니다. 상인회 관리자에게 문의해 주세요. (알림톡·이메일 모두 미설정)", true);
  }
  await D.logDocEvent(db, { documentId: d.id, userId: user.id, actorName: user.name, kind: "otp_sent",
    detail: via.replace(/<[^>]*>/g, ""), ip: ctx.ip || "", userAgent: uaOf(ctx) });
  return back(base + "/sign/" + d.id, `${via} 보냈습니다. ${D.OTP_TTL_MIN}분 안에 입력해 주세요.`);
}

export async function signOtpVerify(ctx) {
  const { db, base, assoc, user, form, params } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  if (!d || d.association_id !== assoc.id) return back(base + "/sign", "문서를 찾을 수 없습니다.", true);
  const rec = await D.getSignOtp(db, d.id, user.id);
  if (!rec) return back(base + "/sign/" + d.id, "먼저 인증번호를 요청해 주세요.", true);
  if (rec.attempts >= D.OTP_MAX_ATTEMPTS) return back(base + "/sign/" + d.id, "시도 횟수를 초과했습니다. 인증번호를 다시 요청해 주세요.", true);
  if (Date.parse(rec.expires_at.replace(" ", "T") + "Z") < Date.now())
    return back(base + "/sign/" + d.id, "인증번호가 만료되었습니다. 다시 요청해 주세요.", true);
  const input = (form.get("code") || "").replace(/\D/g, "");
  await D.bumpOtpAttempt(db, rec.id);
  const ok = input.length === 6 && (await sha256Hex(`otp|${d.id}|${user.id}|${input}`)) === rec.code_hash;
  if (!ok) return back(base + "/sign/" + d.id, `인증번호가 올바르지 않습니다. (남은 시도 ${Math.max(0, D.OTP_MAX_ATTEMPTS - rec.attempts - 1)}회)`, true);
  await D.markOtpVerified(db, rec.id);
  await D.logDocEvent(db, { documentId: d.id, userId: user.id, actorName: user.name, kind: "otp_ok",
    detail: D.maskPhone(rec.phone || ""), ip: ctx.ip || "", userAgent: uaOf(ctx) });
  return back(base + "/sign/" + d.id, "본인확인이 완료되었습니다. 아래에서 서명해 주세요.");
}

// 슈퍼: 서명 본인확인 사용 여부
export async function superEsignSettings(ctx) {
  const { db, env, form } = ctx;
  const on = form.get("esign_otp") === "1";
  // 발송 수단이 전혀 없는데 켜면 회원이 인증번호를 못 받아 '서명 자체가 불가능'해진다.
  if (on && !notifyEnabled(env) && !emailEnabled(env))
    return back("/super", "알림톡·이메일 중 하나는 설정되어야 본인확인을 켤 수 있습니다. (지금 켜면 회원이 서명할 수 없게 됩니다)", true);
  await D.setSetting(db, "esign_otp", on ? "1" : "0");
  await audit(ctx, "전자서명설정", `본인확인 ${on ? "사용" : "미사용"}`, null);
  return back("/super", "전자서명 설정을 저장했습니다.");
}

// 회원: 서명 거절(반려) — 사유를 남기고 서명 대기에서 빠진다. 되돌리려면 관리자가 문서를 다시 만들어야 한다.
export async function memberDeclineSign(ctx) {
  const { db, base, assoc, user, form, params } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  if (!d || d.association_id !== assoc.id) return back(base + "/sign", "문서를 찾을 수 없습니다.", true);
  if (d.closed) return back(base + "/sign", "마감된 문서입니다.", true);
  if (await D.hasSigned(db, d.id, user.id)) return back(base + "/sign", "이미 서명한 문서는 거절할 수 없습니다.", true);
  if (!(await D.canReceiveSign(db, d.id, user.id))) return back(base + "/sign", "이 문서의 서명 대상이 아닙니다.", true);
  const reason = cap((form.get("reason") || "").trim(), 300);
  if (!reason) return back(base + "/sign/" + d.id, "거절 사유를 입력해 주세요.", true);
  await D.declineSign(db, d.id, user.id, reason);
  await notifyWebhook(ctx, d, "document.declined", { document_id: d.id, title: d.title, signer: { kind: "member", id: user.id, name: user.name }, reason });
  await D.logDocEvent(db, { documentId: d.id, userId: user.id, actorName: user.name, kind: "declined",
    detail: reason.slice(0, 100), ip: ctx.ip || "", userAgent: uaOf(ctx) });
  await D.createNotification(db, { associationId: assoc.id, kind: "sign_declined", message: `${user.name}님이 '${d.title}' 서명을 거절했습니다.`, link: base + "/admin/documents/" + d.id });
  await audit(ctx, "서명거절", `${d.title}: ${reason.slice(0, 60)}`);
  return back(base + "/sign", "서명을 거절했습니다. 상인회 관리자에게 사유가 전달됩니다.");
}

// 관리자: 미서명자에게 리마인더 — 알림톡(잔액 차감) 우선, 번호 없으면 이메일
export async function adminRemindDocument(ctx) {
  const { db, env, base, assoc, params, request } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  if (!d || d.association_id !== assoc.id) return back(base + "/admin/documents", "문서를 찾을 수 없습니다.", true);
  if (d.closed) return back(base + "/admin/documents/" + d.id, "마감된 문서입니다.", true);
  // 연타 방지 — 같은 문서에 6시간 안에 두 번 보내지 않는다(비용·수신자 피로)
  if (d.last_remind_at && Date.now() - Date.parse(d.last_remind_at.replace(" ", "T") + "Z") < 6 * 3600 * 1000)
    return back(base + "/admin/documents/" + d.id, "방금 리마인더를 보냈습니다. 6시간 뒤에 다시 보낼 수 있습니다.", true);
  const targets = await D.listUnsigned(db, d.id);
  const origin = new URL(request.url).origin;
  // 외부 서명자는 각자 자기 토큰 링크를 받아야 하므로 회원과 발송 경로가 다르다
  const extResult = await remindExternals(env, db, { assoc, doc: d, origin });
  if (!targets.length && !extResult.total) return back(base + "/admin/documents/" + d.id, "미서명자가 없습니다.");
  await D.logDocEvent(db, { documentId: d.id, userId: ctx.user.id, actorName: ctx.user.name, kind: "reminded",
    detail: `대상 ${targets.length}명`, ip: ctx.ip || "" });
  const link = `${origin}${base}/sign`;
  // 알림톡이 아직 준비되지 않았으면(채널 승인 대기 등) 전원 이메일로 보낸다
  const canTalk = notifyEnabled(env);
  const withPhone = canTalk ? targets.filter((t) => t.phone) : [];
  let msg = "";
  if (withPhone.length) {
    const r = await sendMany(env, db, {
      assoc, kind: "sign_remind", recipients: withPhone,
      textFor: (m) => renderTemplate("sign_remind", { 상호: assoc.name, 이름: m.name, 문서명: d.title, 기한: d.due_date || "미지정" }),
      buttonName: templateButton("sign_remind"), buttonUrl: link,
    });
    msg += `알림톡 ${r.sent}건 발송(${r.cost.toLocaleString()}원 차감)`;
    if (r.failed) msg += `, 실패 ${r.failed}건`;
    if (r.stopped) msg += " — 잔액이 부족해 중단되었습니다";
  }
  // 번호가 없는 사람은 이메일로 (설정된 경우)
  const noPhone = targets.filter((t) => (!canTalk || !t.phone) && t.email);
  if (noPhone.length && emailEnabled(env)) {
    await Promise.all(noPhone.map((m) => sendEmail(env, {
      to: m.email, subject: `[${assoc.name}] 전자서명 미완료 안내 — ${d.title}`,
      html: mailShell(`${esc(assoc.name)} 전자서명`, `<p>${esc(m.name)}님, 아직 서명하지 않은 문서가 있습니다.</p><p><b>${esc(d.title)}</b>${d.due_date ? ` (기한: ${d.due_date})` : ""}</p>${mailButton(link, "서명하러 가기")}`),
    }).catch(() => {})));
    msg += `${msg ? " · " : ""}이메일 ${noPhone.length}건 발송`;
  }
  if (extResult.sent) msg += `${msg ? " · " : ""}외부 서명자 ${extResult.sent}명 발송`;
  if (!msg) msg = `미서명자에게 보낼 연락처가 없습니다. 휴대폰·이메일을 등록해 주세요.`;
  await D.markReminded(db, d.id);
  await audit(ctx, "서명리마인더", `${d.title} · 회원 ${targets.length}명 · 외부 ${extResult.sent}명`);
  return back(base + "/admin/documents/" + d.id, msg);
}

// 서명이 시작되기 전까지는 문서를 고칠 수 있다. 오타 하나로 계약을 새로 만들고
// 링크를 다시 돌리는 일이 실무에서 가장 잦은 낭비다.
// 한 명이라도 서명했으면 잠근다 — 서명자가 확인한 내용이 뒤에서 바뀌면 봉인의 뜻이 사라진다.
export async function adminEditDocument(ctx) {
  const { db, form, base, assoc, params, user } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  if (!d || d.association_id !== assoc.id) return back(base + "/admin/documents", "문서를 찾을 수 없습니다.", true);
  const to = `${base}/admin/documents/${d.id}`;
  if ((await D.listSignatures(db, d.id)).length)
    return back(to, "이미 서명이 시작된 문서는 수정할 수 없습니다. 내용을 바꾸려면 새 문서를 만들어 주세요.", true);
  if (d.closed) return back(to, "마감된 문서입니다.", true);
  const title = cap((form.get("title") || "").trim(), 200);
  const body = cap((form.get("body") || "").trim(), 20000);
  if (!title || !body) return back(to, "제목과 본문을 입력하세요.", true);
  let dueDate = ""; const rawDue = (form.get("due_date") || "").trim();
  if (rawDue) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDue)) return back(to, "기한 형식(YYYY-MM-DD)을 확인하세요.", true);
    dueDate = rawDue;
  }
  const ordered = form.get("ordered") === "1" ? 1 : 0;
  // 첨부가 있으면 해시 구성이 본문+첨부이므로 같은 규칙으로 다시 계산한다
  const hash = d.attachment_hash
    ? await contentHash(`${body}\n--attachment--\n${d.attachment_hash}`)
    : await contentHash(body);
  await D.updateDocument(db, d.id, { title, body, contentHash: hash, dueDate, ordered });

  // 본문이 짧아져 쪽수가 줄면 배치해 둔 필드가 없는 쪽에 남는다 — 마지막 쪽으로 끌어온다
  let moved = 0;
  const fieldN = await D.countFields(db, d.id);
  if (fieldN) {
    const last = pageCount(body) - 1;
    const rows = await D.listFields(db, d.id);
    moved = rows.filter((f) => f.page > last).length;
    if (moved) await D.clampFieldPages(db, d.id, last);
  }
  await D.logDocEvent(db, { documentId: d.id, userId: user.id, actorName: user.name, kind: "edited",
    detail: "본문·제목 수정", ip: ctx.ip || "", userAgent: uaOf(ctx) });
  await audit(ctx, "서명문서수정", title);
  return back(to, moved
    ? `문서를 수정했습니다. 쪽수가 줄어 ${moved}개 필드를 마지막 쪽으로 옮겼습니다 — 배치를 확인해 주세요.`
    : fieldN ? "문서를 수정했습니다. 본문이 바뀌었으니 필드 배치를 한 번 확인해 주세요." : "문서를 수정했습니다.");
}

export async function adminCloseDocument(ctx) {
  const { db, base, assoc, params } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  if (d && d.association_id === assoc.id) { await D.closeDocument(db, d.id); await audit(ctx, "서명문서마감", d.title); }
  return back(base + "/admin/documents", "문서를 마감했습니다.");
}
// 서명 요청 안내 메일 — 실패해도 문서 생성 자체는 유효하므로 되돌리지 않는다
async function notifyNewDocument(ctx, doc, title, dueDate, ordered, recipients) {
  if (!emailEnabled(ctx.env) || !recipients || !recipients.length) return;
  const { assoc, base } = ctx;
  const origin = new URL(ctx.request.url).origin;
  await Promise.all(recipients.filter((m) => m.email).map((m) => sendEmail(ctx.env, {
    to: m.email,
    subject: `[${assoc.name}] 전자서명 요청 — ${title}`,
    html: mailShell(`${esc(assoc.name)} 전자서명`, `<p>${esc(m.name || "회원")}님, 서명이 필요한 문서가 도착했습니다.</p><p><b>${esc(title)}</b>${dueDate ? ` (기한: ${dueDate})` : ""}${ordered ? " · 순차 서명 문서입니다" : ""}</p>${mailButton(`${origin}${base}/sign`, "서명하러 가기")}`),
  }).catch(() => {})));
}

// 만든 문서를 서식으로 저장 — 본문과 배치를 함께 보관해 다음부터 그대로 찍어낸다.
export async function adminSaveTemplate(ctx) {
  const { db, form, base, assoc, user } = ctx;
  const to = base + "/admin/templates";
  const title = cap((form.get("title") || "").trim(), 200);
  const summary = cap((form.get("summary") || "").trim(), 120);
  const d = await D.getDocument(db, Number(form.get("document")) || 0);
  if (!title) return back(to, "서식 이름을 입력하세요.", true);
  if (!d || d.association_id !== assoc.id) return back(to, "원본 문서를 찾을 수 없습니다.", true);
  if (await D.countTemplates(db, assoc.id) >= 50) return back(to, "서식은 최대 50개까지 저장할 수 있습니다.", true);
  // 담당자(회원 id)는 서식에 남기지 않는다 — 다음 계약은 다른 사람이 서명한다.
  // 대신 '몇 번째 당사자' 인지만 남겨 두고, 문서를 만들 때 실제 사람을 연결한다.
  const rows = await D.listFields(db, d.id);
  const order = [];
  for (const f of rows) if (f.assignee && !order.includes(f.assignee)) order.push(f.assignee);
  const names = await D.listRequestStatus(db, d.id);
  const parties = order.length
    ? order.map((id, i) => { const u = names.find((n) => n.id === id); return u ? u.name : `당사자${i + 1}`; })
    : ["서명자"];
  const pages = pageCount(d.body);
  const fields = rows.map((f) => ({
    kind: f.kind, label: f.label, w: round4(f.w), h: round4(f.h), x: round4(f.x), y: round4(f.y),
    // 마지막 쪽에 있던 자리는 '끝장' 으로 저장 — 본문 길이가 달라져도 서명란이 끝에 붙는다
    page: f.page === pages - 1 ? -1 : f.page,
    party: Math.max(0, order.indexOf(f.assignee)), required: f.required ? 1 : 0,
  }));
  await D.createTemplate(db, { associationId: assoc.id, title, summary, body: d.body, fields, parties, ordered: d.ordered, createdBy: user.id });
  await audit(ctx, "서식저장", title);
  return back(to, `'${title}' 서식으로 저장했습니다. 본문의 바뀌는 값을 {{변수}} 로 고치면 다음부터 그 칸만 채우면 됩니다.`);
}
export async function adminDeleteTemplate(ctx) {
  const { db, base, assoc, params } = ctx;
  const t = await D.getTemplate(db, Number(params.id) || 0);
  if (!t || t.association_id !== assoc.id) return back(base + "/admin/templates", "서식을 찾을 수 없습니다.", true);
  await D.deleteTemplate(db, t.id, assoc.id);
  await audit(ctx, "서식삭제", t.title);
  return back(base + "/admin/templates", "서식을 삭제했습니다.");
}

// 계약서 필드 배치 저장 — 편집기가 보낸 좌표 묶음을 통째로 교체한다.
// 서명이 하나라도 시작되면 잠근다: 서명자가 확인한 지면이 사후에 바뀌면 봉인의 의미가 사라진다.
const MAX_FIELDS = 200;
export async function adminSaveFields(ctx) {
  const { db, form, base, assoc, params } = ctx;
  const d = await D.getDocument(db, Number(params.id));
  if (!d || d.association_id !== assoc.id) return back(base + "/admin/documents", "문서를 찾을 수 없습니다.", true);
  const to = `${base}/admin/documents/${d.id}/fields`;
  if ((await D.listSignatures(db, d.id)).length) return back(to, "이미 서명이 시작된 문서는 배치를 바꿀 수 없습니다.", true);
  let raw;
  try { raw = JSON.parse(form.get("fields") || "[]"); } catch { return back(to, "배치 데이터를 읽을 수 없습니다.", true); }
  if (!Array.isArray(raw)) return back(to, "배치 데이터 형식이 올바르지 않습니다.", true);
  if (raw.length > MAX_FIELDS) return back(to, `필드는 최대 ${MAX_FIELDS}개까지 놓을 수 있습니다.`, true);
  const pages = pageCount(d.body);
  // 담당자로 지정할 수 있는 사람은 이 문서의 서명 대상뿐 (엉뚱한 회원을 지정해 지면을 오염시키는 것 차단)
  const allowed = new Set((await D.listRequestStatus(db, d.id)).map((r) => r.id));
  for (const e of await D.listExternalSigners(db, d.id)) allowed.add(-e.id); // 외부 서명자는 음수
  const fields = [];
  for (const f of raw) {
    if (!f || !isFieldKind(f.kind)) return back(to, "알 수 없는 필드 종류가 있습니다.", true);
    const page = Number(f.page) | 0;
    if (page < 0 || page >= pages) return back(to, "필드가 문서 범위를 벗어났습니다.", true);
    const assignee = Number(f.assignee) | 0;
    if (assignee && !allowed.has(assignee)) return back(to, "서명 대상이 아닌 담당자가 지정되었습니다.", true);
    const x = round4(f.x), y = round4(f.y);
    const w = Math.max(0.01, round4(f.w)), h = Math.max(0.008, round4(f.h));
    if (x + w > 1.0001 || y + h > 1.0001) return back(to, "필드가 지면 밖으로 나갔습니다. 위치를 조정해 주세요.", true);
    fields.push({ kind: f.kind, label: cap(String(f.label || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 20),
      page, x, y, w, h, assignee, required: f.required ? 1 : 0 });
  }
  const n = await D.replaceFields(db, d.id, fields);
  return back(to, n ? `${n}개 필드를 배치했습니다.` : "배치를 모두 지웠습니다.");
}

// data:image/png;base64 → 바이트. 형식·크기·실제 시그니처까지 확인한다.
function pngFromDataUrl(s, maxBytes = 500 * 1024) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(s || ""));
  if (!m) return null;
  let bytes;
  try { bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)); } catch { return null; }
  if (bytes.length < 64 || bytes.length > maxBytes || sniffImage(bytes) !== "image/png") return null;
  return bytes;
}

// 서명자가 채운 필드를 검증하고 저장 — 먼저 전부 검증한 뒤에 쓴다(중간 실패로 반쯤 채워지는 것 방지).
async function applyFieldValues(ctx, doc, fields, rawJson) {
  const { db, env, user } = ctx;
  let raw = {};
  try { raw = JSON.parse(rawJson || "{}") || {}; } catch { return { error: "입력값을 읽을 수 없습니다." }; }
  const staged = [];
  for (const f of fields) {
    const v = raw[String(f.id)];
    const label = f.label || (FIELD_KINDS[f.kind] || {}).label || "항목";
    if (f.kind === "sign" || f.kind === "stamp") {
      if (!v || !v.image) { if (f.required) return { error: `'${label}' 자리를 채워 주세요.` }; continue; }
      const bytes = pngFromDataUrl(v.image);
      if (!bytes) return { error: `'${label}' 이미지가 올바르지 않습니다.` };
      staged.push({ f, bytes });
    } else if (f.kind === "check") {
      const on = !!(v && (v.value === "1" || v.value === 1 || v.value === true));
      if (!on) { if (f.required) return { error: `'${label}' 에 체크해 주세요.` }; continue; }
      staged.push({ f, value: "1" });
    } else {
      const val = cap(String((v && v.value) || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 100);
      if (!val) { if (f.required) return { error: `'${label}' 을(를) 입력해 주세요.` }; continue; }
      if (f.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(val)) return { error: `'${label}' 날짜 형식(YYYY-MM-DD)을 확인해 주세요.` };
      staged.push({ f, value: val });
    }
  }
  let signKey = "";
  for (const st of staged) {
    if (st.bytes) {
      const key = storage.enabled(env) ? await storage.save(env, st.bytes, "image/png") : "";
      const hash = await sha256HexBytes(st.bytes);
      await D.setFieldValue(db, { fieldId: st.f.id, documentId: doc.id, userId: user.id, image: key, imageHash: hash });
      if (st.f.kind === "sign" && !signKey) signKey = key;
    } else {
      await D.setFieldValue(db, { fieldId: st.f.id, documentId: doc.id, userId: user.id, value: st.value });
    }
  }
  return { filled: staged.length, signKey, hadSignField: staged.some((st) => st.f.kind === "sign") };
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
  // 본인확인(OTP)이 켜져 있으면 통과한 사람만 서명할 수 있다 — 화면을 우회한 직접 POST 도 여기서 막힌다
  let verifyLevel = "password";
  if (await otpRequired(db)) {
    if (!D.isValidPhone(user.phone || "")) return back(base + "/sign/" + d.id, "본인확인용 휴대폰이 등록되어 있지 않습니다.", true);
    if (!(await D.otpVerifiedRecently(db, d.id, user.id))) return back(base + "/sign/" + d.id, "휴대폰 본인확인을 먼저 완료해 주세요.", true);
    verifyLevel = "otp";
  }
  // 지면에 배치된 필드 — 내가 채워야 할(아직 비어 있는) 자리만 대상. 화면을 우회한 POST 도 같은 규칙을 받는다.
  const allFields = await D.listFieldsWithValues(db, d.id);
  const myFields = allFields.filter((f) => !f.value && !f.image && (f.assignee === user.id || f.assignee === 0));
  let fieldResult = { signKey: "", hadSignField: false };
  if (myFields.length) {
    fieldResult = await applyFieldValues(ctx, d, myFields, form.get("fields"));
    if (fieldResult.error) return back(base + "/sign/" + d.id, fieldResult.error, true);
  }
  // 서명 필드를 채웠으면 그 그림이 곧 대표 서명 — 따로 서명란을 요구하지 않는다
  let sigKey = fieldResult.signKey || "";
  if (!fieldResult.hadSignField) {
    const bytes = pngFromDataUrl(form.get("signature"));
    if (!bytes) return back(base + "/sign/" + d.id, "서명을 입력해 주세요.", true);
    sigKey = storage.enabled(env) ? await storage.save(env, bytes, "image/png") : ""; // R2 미연결 시 이미지 생략(봉인은 유효)
  }
  // 제어문자(개행 등) 제거 — 봉인 문자열이 \n 구분이라 이름에 섞이면 인코딩이 모호해짐
  const signerName = cap((form.get("signer_name") || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 60) || user.name;
  const signedAt = new Date().toISOString();
  // 직전 서명의 봉인값을 이번 봉인에 포함 → 서명들이 사슬로 엮여 중간 기록 삭제·조작이 탐지된다
  const prevHash = await D.lastSealHash(db);
  // 내가 채운 값 + 그 자리의 좌표까지 봉인에 넣는다 → 값 위조는 물론 "자리만 옮기는" 조작도 탐지된다
  const fieldsHash = await fieldsHashOf(await D.listFilledBy(db, d.id, user.id));
  const recordHash = await sealRecord(env, { documentId: d.id, userId: user.id, signerName, contentHash: d.content_hash, signedAt, ip, prevHash, fieldsHash, ver: SEAL_VER });
  const verifyCode = newVerifyCode();
  await D.createSignature(db, { documentId: d.id, userId: user.id, signerName, signatureImage: sigKey, contentHash: d.content_hash, ip, userAgent: cap(request.headers.get("user-agent") || "", 200), verifyCode, recordHash, signedAt, prevHash, sealVer: SEAL_VER, verifyLevel, fieldsHash });
  await D.logDocEvent(db, { documentId: d.id, userId: user.id, actorName: signerName, kind: "signed",
    detail: `본인확인 ${verifyLevel} · 검증코드 ${verifyCode}`, ip, userAgent: request.headers.get("user-agent") || "" });

  // 웹훅 — 고객사 시스템이 진행 상황을 즉시 받아본다. 실제 발송은 크론이 하므로 여기서 막히지 않는다.
  await notifyWebhook(ctx, d, "document.signed", { document_id: d.id, title: d.title, signer: { kind: "member", id: user.id, name: signerName } });
  await D.createNotification(db, { associationId: assoc.id, kind: "signed", message: `${signerName}님이 '${d.title}'에 전자서명했습니다.`, link: base + "/admin/documents/" + d.id });
  // 서명자 본인에게 확인서 사본 자동 발송 — "받은 적 없다"는 분쟁을 막는 증거.
  // 실패해도 서명은 이미 유효하므로 전체를 되돌리지 않는다.
  try {
    const certUrl = `${new URL(request.url).origin}/certificate/${verifyCode}`;
    if (D.isValidPhone(user.phone || "")) {
      await sendOne(env, db, { assoc, kind: "sign_done", to: user.phone,
        text: renderTemplate("sign_done", { 상호: assoc.name, 이름: signerName, 문서명: d.title, 검증코드: verifyCode }),
        buttonName: templateButton("sign_done"), buttonUrl: certUrl });
    }
    if (emailEnabled(env) && user.email) {
      await sendEmail(env, { to: user.email, subject: `[${assoc.name}] 전자서명 완료 — ${d.title}`,
        html: mailShell(`${esc(assoc.name)} 전자서명 완료`,
          `<p>${esc(signerName)}님, '<b>${esc(d.title)}</b>' 전자서명이 완료되었습니다.</p>
           <p>검증 코드: <b>${esc(verifyCode)}</b></p>${mailButton(certUrl, "전자서명 확인서 보기")}
           <p style="font-size:12px;color:#888">이 확인서는 서명자·시각·문서해시를 전자서명으로 봉인한 기록입니다. 분쟁 시 증빙으로 쓸 수 있습니다.</p>`) });
    }
  } catch {}
  return back(base + "/sign", `전자서명이 완료되었습니다. 검증 코드: ${verifyCode} — 확인서를 보내드렸습니다.`);
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
  // 빈 화면으로 넘기지 않도록 시작 세트를 함께 넣습니다(공지·가입 동의서).
  const st = await seedStarter(ctx.env, db, assoc, { createdBy: null });
  await audit(ctx, "상인회생성", `${name} (/t/${assoc.slug})`, null);
  return back("/super", `'${name}' 상인회가 생성되었습니다. (주소: /t/${assoc.slug}, 관리자: ${adminEmail}) 시작 공지 ${st.notices}건과 가입 동의서를 함께 넣었습니다.`);
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
  await seedStarter(ctx.env, db, assoc, { createdBy: null }); // 개설 즉시 쓸 수 있게 첫 공지·가입 동의서 포함
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

// ---------- 슈퍼: 영업 파이프라인 ----------
export const SALES_STAGES = { new: "신규", contacted: "연락함", meeting: "미팅", proposal: "제안" };

// 직접 발굴한 상인회를 파이프라인에 올립니다(공개 신청 폼을 거치지 않은 건).
export async function superAddProspect(ctx) {
  const { db, form } = ctx;
  const assocName = cap((form.get("assoc_name") || "").trim(), 100);
  if (!assocName) return back("/super", "상인회 이름을 입력해 주세요.", true);
  const email = cap((form.get("contact_email") || "").toLowerCase().trim(), 120);
  if (email && !EMAIL_RE.test(email)) return back("/super", "이메일 형식이 올바르지 않습니다.", true);
  await D.createProspect(db, {
    assocName, contactEmail: email,
    contactName: cap(form.get("contact_name"), 60),
    contactPhone: cap(form.get("contact_phone"), 40),
    message: cap(form.get("message"), 2000),
  });
  await audit(ctx, "영업등록", assocName, null);
  return back("/super", `'${assocName}' 을(를) 영업 목록에 추가했습니다.`);
}

export async function superSetApplicationStage(ctx) {
  const { db, form, params } = ctx;
  const app = await D.getApplication(db, Number(params.id));
  if (!app) return back("/super", "대상을 찾을 수 없습니다.", true);
  const stage = form.get("stage");
  if (!Object.keys(SALES_STAGES).includes(stage)) return back("/super", "잘못된 단계입니다.", true);
  const next = (form.get("next_action_at") || "").trim();
  if (next && !/^\d{4}-\d{2}-\d{2}$/.test(next)) return back("/super", "다음 연락일 형식이 올바르지 않습니다.", true);
  await D.setApplicationStage(db, app.id, stage, next);
  await audit(ctx, "영업단계", `${app.assoc_name} → ${SALES_STAGES[stage]}${next ? ` (다음 ${next})` : ""}`, null);
  return back("/super", `'${app.assoc_name}' 단계를 '${SALES_STAGES[stage]}' 로 바꿨습니다.`);
}

export async function superAddApplicationNote(ctx) {
  const { db, user, form, params } = ctx;
  const app = await D.getApplication(db, Number(params.id));
  if (!app) return back("/super", "대상을 찾을 수 없습니다.", true);
  const body = cap((form.get("body") || "").trim(), 1000);
  if (!body) return back("/super", "메모 내용을 입력해 주세요.", true);
  await D.addApplicationNote(db, { applicationId: app.id, actorName: user.name || user.email, body });
  return back("/super", `'${app.assoc_name}' 에 기록을 남겼습니다.`);
}

// ---------- 슈퍼: 상인회 관리자 비밀번호 재발급 ----------
// "로그인이 안 된다" 는 문의가 오면 운영자가 바로 처리할 수 있어야 합니다.
// 상인회 관리자(ADMIN)는 자기 상인회 화면에서도 자기 비밀번호를 재발급할 수 없어 여기서만 가능합니다.
export async function superResetAdminPassword(ctx) {
  const { db, params } = ctx;
  const target = await D.getUserById(db, Number(params.id));
  if (!target || target.role !== "ADMIN") return back("/super", "대상 관리자를 찾을 수 없습니다.", true);
  const temp = Math.random().toString(36).slice(2, 10);
  const { hash, salt } = await hashPassword(temp);
  await D.updateUserPassword(db, target.id, hash, salt);
  await audit(ctx, "관리자비번재발급", target.email, null);
  return back("/super", `${target.email} 임시 비밀번호: ${temp} — 전달 후 변경 안내하세요.`);
}

// ---------- 슈퍼: 실전용 시작 세트 ----------
// 빈 사이트로 고객사에 넘기지 않기 위한 것. 비어 있는 항목만 채우므로 여러 번 눌러도 안전합니다.
export async function superSeedStarter(ctx) {
  const { db, user, params } = ctx;
  const a = await D.getAssociationById(db, Number(params.id));
  if (!a) return back("/super", "상인회를 찾을 수 없습니다.", true);
  const r = await seedStarter(ctx.env, db, a, { createdBy: user.id });
  if (!r.notices && !r.documents)
    return back("/super", `'${a.name}' 은(는) 이미 ${r.skipped.join("·")}이(가) 있어 넣을 것이 없었습니다.`);
  await audit(ctx, "시작세트", `${a.name} — 공지 ${r.notices}건·서명문서 ${r.documents}건`, a.id);
  const skip = r.skipped.length ? ` (${r.skipped.join("·")}은(는) 이미 있어 건너뜀)` : "";
  return back("/super", `'${a.name}' 에 시작 세트를 넣었습니다. 공지 ${r.notices}건 · 전자서명 문서 ${r.documents}건${skip}`);
}

// ---------- 슈퍼: 상인회 삭제 ----------
// 되돌릴 수 없으므로 slug 를 정확히 입력해야만 진행됩니다.
export async function superDeleteAssociation(ctx) {
  const { db, form, params } = ctx;
  const a = await D.getAssociationById(db, Number(params.id));
  if (!a) return back("/super", "상인회를 찾을 수 없습니다.", true);
  if ((form.get("confirm_slug") || "").trim() !== a.slug)
    return back("/super", `삭제하려면 주소(${a.slug})를 정확히 입력해야 합니다.`, true);
  const n = await D.countMembers(db, a.id);
  await D.deleteAssociationDeep(db, a.id);
  await audit(ctx, "상인회삭제", `${a.name} (/t/${a.slug}) — 회원 ${n}명 포함 전체 삭제`, null);
  return back("/super", `'${a.name}' 을(를) 삭제했습니다. 점포·회원·게시물이 모두 함께 지워졌습니다.`);
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
