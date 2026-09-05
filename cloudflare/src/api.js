// 폼 처리 핸들러 (POST). ctx.form 은 파싱된 FormData.
import * as D from "./db.js";
import { verifyPassword, hashPassword, hmacSign, hmacVerify, b64uFromBytes, bytesFromB64u, sha256HexBytes, sha256Hex } from "./crypto.js";
import { sendEmail, sendEmailFor, emailEnabled, mailShell, mailButton } from "./email.js";
import { sessionTokenForUser, sessionCookie, clearSessionCookie } from "./auth.js";
import { back, redirect } from "./http.js";
import * as storage from "./storage.js";
import { countable, countHomeGoal } from "./traffic.js";
import { parseEmbed } from "./embed.js";
import { cap, sniffImage, EMAIL_RE, MAX_IMAGE_BYTES, slugify, esc, safeNext } from "./util.js";
import { contentHash, sealRecord, newVerifyCode, SEAL_VER, fieldsHashOf, keyStorage, verifyChain } from "./esign.js";
import { isFieldKind, round4, FIELD_KINDS, pageCount, remapFields } from "./paper.js";
import { parseTable, toCsv, decodeUtf8, headerRole } from "./csv.js";
import { builtinById, isBuiltinId, normalizeTemplate, extractVars, applyVars, fillVars, resolveFieldPages } from "./templates.js";
import { resolveExtToken, makeExtToken, extSignUrl, sendSignLink, remindExternals, originFor, rememberOrigin } from "./extsign.js";
import { enqueueDocEvent, newApiKey, hashApiKey, KEY_PREFIX, checkWebhookUrl } from "./apiv1.js";
import { turnstileVerify } from "./turnstile.js";
import { planOf, PLANS, PLAN_KEYS, planPriceKey } from "./plans.js";
import { seedDemo } from "./demoContent.js";
import { seedStarter } from "./starterContent.js";
import { KINDS, kindById, PRESETS, assocTerms } from "./kinds.js";
import { TEMPLATE_KEYS, TEMPLATES, sendTest, listProviderTemplates, matchTemplates, sendMany, sendOne, notifyEnabled, autoNotifyOn, canAutoSend, wonToJeon, renderTemplate, templateButton, billingMode, chargeContract, BILLING_MODES, priceOf } from "./notify.js";

// 계약 한 건을 연다 — 조직 경계와 **부서 경계**를 함께 본다.
//
// 스무 곳이 넘는 화면·처리가 여기를 지난다. 문이 여럿이면 언젠가 한 곳은 잠기지 않는다.
// 서명자 화면(/sign)은 이 문을 쓰지 않는다 — 서명자는 부서와 무관하게 자기 계약을 봐야 하고,
// 그 판정은 canReceiveSign 이 한다.
export const docOf = async (ctx, id) => {
  const d = await D.getDocument(ctx.db, Number(id) || 0);
  return D.canSeeDoc(ctx.assoc, ctx.user, d) ? d : null;
};

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
  const esign = !!(a && a.kind === "esign");
  if (user.role === "ADMIN") return base + "/admin";
  // 담당자는 관리자 콘솔에 들어갈 수 없다 — 일하는 자리인 계약서 목록으로 바로 보낸다
  if (user.role === "STAFF") return base + "/admin/documents";
  // 전자계약 조직의 회원에게 '내 업체'는 없다. 빈 화면 대신 서명 목록으로.
  if (esign) return base + "/sign";
  return base + "/dashboard";
}

// 공개 상담 폼 제출 제한 (isolate 로컬, best-effort).
// 로그인 실패 카운터와 목적이 다르다 — 저쪽은 '틀린 시도', 이쪽은 '성공한 제출'을 센다.
// Turnstile 시크릿이 없는 배포에서는 이것이 유일한 방벽이라 실패가 아니라 제출을 기준으로 잡는다.
// 국내 모바일은 CGNAT 라 수많은 사람이 IP 하나를 함께 쓴다 — 빡빡하게 잡으면 진짜 신청자가 막힌다.
// 목적은 '스크립트 반복'을 끊는 것이지 할당량 관리가 아니므로, 실제 사람 몫보다 넉넉히 잡는다.
// 비용의 실제 상한은 아래 LEAD_NOTIFY_DAILY_CAP(하루 발송 수)이 맡는다.
const LEAD_IP_MAX = 20, LEAD_IP_WINDOW_MS = 15 * 60 * 1000;
const leadHits = new Map();
function leadRateLimited(ip) {
  const now = Date.now(), r = leadHits.get(ip);
  if (!r || now - r.first > LEAD_IP_WINDOW_MS) { leadHits.set(ip, { n: 1, first: now }); return false; }
  r.n++;
  if (leadHits.size > 5000) leadHits.clear(); // 메모리 상한 — best-effort 이므로 통째로 비워도 된다
  return r.n > LEAD_IP_MAX;
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

// 로그인 칸 하나로 이메일과 휴대폰 번호를 함께 받는다.
//
// 왜 — 이메일 없이 등록한 사장님(이름·전화번호만 있는 회원)이 지금까지는 아예 못 들어왔다.
// 40~60대 사장님에게 이메일 주소를 새로 만들게 하는 것이 실제 도입을 막는 벽이었다.
//
// 번호는 유일하지 않으므로 후보를 여럿 놓고 비밀번호로 가른다. 둘 이상이 같은 번호에
// 같은 비밀번호를 쓰는 경우는 누구인지 정할 수 없으니 아무도 들여보내지 않는다 —
// 남의 가게 화면이 열리는 것보다 못 들어가는 편이 낫다.
async function findLoginUser(db, who, password) {
  const ok = async (u) => u && (await verifyPassword(password, u.salt, u.password_hash)) ? u : null;
  // 숫자와 구분기호만 적혔을 때에만 번호로 본다. 이 검사가 없으면
  // 'a01012345678@x.kr' 같은 주소가 번호로 읽혀 엉뚱한 계정을 찾게 된다.
  const looksLikePhone = /^[\d\s().+-]+$/.test(who) && D.isValidPhone(who);
  if (looksLikePhone) {
    const hits = [];
    for (const u of await D.listUsersByPhone(db, who)) if (await ok(u)) hits.push(u);
    return hits.length === 1 ? hits[0] : null;
  }
  return ok(await D.getUserByEmail(db, who.toLowerCase()));
}

export async function login(ctx) {
  const { db, form, env, addCookie, isProd, ip } = ctx;
  if (rateLimited(ip)) return back("/login", "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.", true);
  if (!(await turnstileVerify(env, form.get("cf-turnstile-response"), ip))) return back("/login", "봇 방지 확인에 실패했습니다. 다시 시도해 주세요.", true);
  // 칸 이름은 login 이지만, 예전 폼·자동완성이 email 로 보내는 경우도 받아 준다.
  const who = (form.get("login") || form.get("email") || "").trim();
  const password = form.get("password") || "";
  const user = await findLoginUser(db, who, password);
  if (!user) {
    recordFail(ip);
    return back("/login", "이메일·휴대폰 번호 또는 비밀번호가 올바르지 않습니다.", true);
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
  // 서명 링크를 눌렀다가 로그인하러 온 사람은 그 문서로 돌려보낸다.
  // (safeNext 가 같은 사이트 경로만 통과시킨다 — 열린 리다이렉트 차단)
  return redirect(safeNext(form.get("next")) || (await postLoginPath(db, user)));
}

export async function logout(ctx) {
  ctx.addCookie(clearSessionCookie());
  return redirect("/");
}

// ---------- 회원가입 ----------
export async function register(ctx) {
  // 프랜차이즈 랜딩도 셀프 가입을 받지 않는다 — 매장 목록은 본사가 관리한다.
  if (ctx.assoc && (ctx.assoc.kind === "esign" || ctx.assoc.kind === "franchise"))
    return back(ctx.base + "/", "이 조직은 점포 가입을 받지 않습니다.", true);
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
  // A/B — 상인회가 원하는 최종 결과. 어느 홈 사본을 보고 온 사람이 실제로 입점했는지 센다.
  await countHomeGoal(ctx, "signup");
  return back(base + "/dashboard", "가입이 완료되었습니다! 업체 정보를 입력하고 사진을 올려보세요.");
}

// ---------- 알림톡 크레딧 ----------
// 충전 금액은 자유 입력 — 상인회 규모가 제각각이라 고정 금액만으로는 맞지 않는다.
// 최소 1만원(소액 입금 확인 부담), 최대 500만원(오입력 방지) 사이 1천원 단위.
const CHARGE_MIN = 10000, CHARGE_MAX = 5000000, CHARGE_STEP = 1000;
// 알림 자동화 켜기/끄기 — 이 조직 이름으로 자동 발송을 할지 말지.
// 끄면 서명 요청·재알림·완료 안내가 한 통도 나가지 않고, 관리자가 링크를 직접 전달한다.
export async function adminNotifyAuto(ctx) {
  const { db, form, base, assoc, env } = ctx;
  const to = `${base}/admin#p-notify`;
  const on = form.get("on") === "1";
  // 켤 수 없는 상태에서 켜 두면 "켰는데 왜 안 가지"가 된다. 지금 못 보내는 이유를 그대로 말한다.
  if (on && !notifyEnabled(env))
    return back(to, "아직 운영사 쪽 발송 설정이 끝나지 않아 켤 수 없습니다. (알림톡 심사·키 등록이 끝나면 켜집니다)", true);
  await D.setNotifyAuto(db, assoc.id, on);
  await audit(ctx, "알림자동화", on ? "켬" : "끔");
  return back(to, on
    ? "알림 자동화를 켰습니다. 이제 서명 요청·재알림·완료 안내가 카카오톡으로 자동 발송됩니다."
    : "알림 자동화를 껐습니다. 계약은 문서 화면의 [보내기 · 복사] 로 직접 보내시면 됩니다.");
}

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
// 슈퍼: 조직 유형 전환 (상인회 ↔ 전자계약 전용)
// 데이터는 지우지 않는다 — 보이는 메뉴와 관리자 화면만 달라진다. 되돌리면 그대로 돌아온다.
// 사이트 복제 — 잘 만들어 둔 사이트를 본으로 삼아 새 고객사를 찍어 낸다.
// "프랜차이즈 홈페이지도 상인회처럼 계속 복사해서 관리한다"가 이 기능의 목적이다.
// 껍데기(유형·업종·브랜딩·화면 구성·캠페인 사본)만 복사하고, 남의 실제 데이터
// (회원·점포·상담 신청·계약)는 절대 따라오지 않는다.
export async function superCloneAssociation(ctx) {
  const { db, form } = ctx;
  const src = await D.getAssociationById(db, Number(form.get("source_id")) || 0);
  if (!src) return back("/super", "복제할 원본 조직을 골라 주세요.", true);
  const name = cap((form.get("name") || "").trim(), 100);
  const adminEmail = cap((form.get("admin_email") || "").toLowerCase().trim(), 120);
  const adminPassword = form.get("admin_password") || "";
  if (!name || !EMAIL_RE.test(adminEmail) || adminPassword.length < 8 || adminPassword.length > 200)
    return back("/super", "새 조직 이름과 관리자 계정을 확인하세요. (비밀번호 8~200자)", true);
  if (await D.getUserByEmail(db, adminEmail)) return back("/super", "이미 사용 중인 관리자 이메일입니다.", true);
  let slug = slugify(name), n = 1;
  while (await D.getAssociationBySlug(db, slug)) slug = slugify(name) + "-" + (++n);
  const made = await D.cloneAssociation(db, src.id, {
    slug, name,
    brandColor: /^#[0-9a-fA-F]{6}$/.test(form.get("brand_color") || "") ? form.get("brand_color") : "",
    tagline: cap(form.get("tagline"), 200),
  });
  if (!made) return back("/super", "복제에 실패했습니다.", true);
  const { hash, salt } = await hashPassword(adminPassword);
  await D.createUser(db, { email: adminEmail, passwordHash: hash, salt, name: cap(form.get("admin_name"), 60) || "관리자", role: "ADMIN", associationId: made.id });
  const st = await seedStarter(ctx.env, db, made, { createdBy: null });
  await audit(ctx, "사이트복제", `${src.name} → ${name} (/t/${made.slug})`, null);
  return back("/super", `'${src.name}' 을(를) 본으로 '${name}' 을(를) 만들었습니다. (주소: /t/${made.slug}, 관리자: ${adminEmail}) `
    + `화면 구성은 그대로 복사됐고, 회원·상담 신청 등 원본의 데이터는 따라오지 않았습니다. 시작 공지 ${st.notices}건을 넣었습니다.`);
}

export async function superSetKind(ctx) {
  const { db, form, params } = ctx;
  const a = await D.getAssociationById(db, Number(params.id) || 0);
  if (!a) return back(superBackTo(ctx), "조직을 찾을 수 없습니다.", true);
  const kind = D.normalizeKind(form.get("kind"));
  await D.setAssociationKind(db, a.id, kind);
  // 업종 문구는 랜딩형에서만 의미가 있지만, 유형을 오갈 수 있으니 값이 오면 그대로 보관한다
  if (form.get("preset")) await D.setAssociationPreset(db, a.id, D.normalizePreset(form.get("preset")));
  await audit(ctx, "조직유형변경", `${a.name}: ${KIND_LABEL[kind]}`, null);
  return back(superBackTo(ctx), `'${a.name}' 을(를) ${KIND_LABEL[kind]} 으로 바꿨습니다. 기존 데이터는 그대로 있습니다.`);
}

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
  if (!a) return back(superBackTo(ctx), "상인회를 찾을 수 없습니다.", true);
  const p = parseInt(String(form.get("unit_price") || "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(p) || p < 0 || p > 1000) return back(superBackTo(ctx), "단가는 0~1000원 사이로 입력해 주세요. (0 = 기본가 적용)", true);
  await D.setUnitPrice(db, a.id, p);
  await audit(ctx, "상인회단가", `${a.name} → ${p === 0 ? "기본가" : p + "원"}`, null);
  return back(superBackTo(ctx), `'${a.name}' 알림톡 단가를 ${p === 0 ? "플랫폼 기본가로" : p.toLocaleString() + "원으로"} 설정했습니다.`);
}

// 슈퍼: 알림톡 판매단가·템플릿 코드 설정
// D1 에 남은 시크릿 사본 삭제.
// 워커 Secret 이 실제로 들어와 있을 때만 허용한다 — 그 시점엔 워커 값이 이미 우선하므로
// D1 사본은 아무도 쓰지 않는 상태다. 반대로 워커에 값이 없는데 지우면, 다음 요청에서
// 새 값이 자동 생성되어 로그인이 전부 풀리고 예전 백업을 영원히 못 열게 된다.
// 조직 하나를 모아 보는 화면(/super/org/:id)에서 고친 뒤에도 그 화면에 남아야 한다.
// 목록으로 튕기면 "방금 뭘 고쳤더라"를 다시 찾아야 한다.
// 열린 리다이렉트가 되지 않도록 /super 로 시작하는 우리 경로만 허용한다.
export function superBackTo(ctx, fallback = "/super") {
  const v = (ctx.form && ctx.form.get("return")) || "";
  return /^\/super(\/[\w/-]*)?(#[\w-]*)?$/.test(v) ? v : fallback;
}

export async function superSecretDrop(ctx) {
  const { db, form, env } = ctx;
  const key = (form.get("key") || "").trim();
  if (key !== "session_secret" && key !== "sign_key") return back("/super", "알 수 없는 항목입니다.", true);
  if (!(await D.getSetting(db, key))) return back("/super#s-settings", "이미 지워져 있습니다.");

  if (key === "session_secret") {
    if (!env.SESSION_SECRET_IS_WORKER)
      return back("/super#s-settings", "워커 Secret 이 아직 확인되지 않았습니다. 지금 지우면 로그인이 전부 풀리고 예전 백업을 열 수 없게 됩니다.", true);
  } else {
    if (keyStorage(env) !== "secret")
      return back("/super#s-settings", "워커 Secret 이 아직 확인되지 않았습니다. 지금 지우면 이미 받은 서명을 검증할 수 없게 됩니다.", true);
    // 워커 키로 기존 서명이 실제로 검증되는지 확인한 뒤에만 지운다
    if (!verifyChain(await D.listSignatureChain(db)).ok)
      return back("/super#s-settings", "서명 사슬 검증이 통과하지 않아 사본을 지우지 않았습니다. 옮긴 키가 현행 키와 같은지 확인해 주세요.", true);
  }
  await D.delSetting(db, key);
  await audit(ctx, "시크릿이전", `${key} DB 사본 삭제`, null);
  return back("/super#s-settings", "DB 사본을 지웠습니다. 이제 이 값은 워커 Secret 에만 있습니다.");
}

// 템플릿 코드 시험 발송 — 결과(제공사 오류 원문)를 플래시로 되돌려 준다.
export async function superNotifyTest(ctx) {
  const { db, form, env } = ctx;
  const kind = (form.get("kind") || "").trim();
  if (!TEMPLATES[kind]) return back("/super#s-money", "알 수 없는 알림 종류입니다.", true);
  const to = (form.get("phone") || "").trim();
  const r = await sendTest(env, db, { kind, to });
  await audit(ctx, "테스트발송", `${kind} → ${r.ok ? "성공" : "실패"}`, null);
  return r.ok
    ? back("/super#s-money", `테스트 발송 성공 — ${TEMPLATES[kind].label} (${r.to}). 휴대폰을 확인해 주세요.`)
    : back("/super#s-money", `테스트 발송 실패 — ${TEMPLATES[kind].label}: ${r.error}`, true);
}

// 요금제 월 요금 — 얼마에 팔지는 운영사가 정한다. 비우면 화면에 요금 안내가 나오지 않는다.
export async function superPlanPrices(ctx) {
  const { db, form } = ctx;
  for (const k of PLAN_KEYS) {
    const raw = (form.get(`price_${k}`) || "").replace(/[,\s]/g, "");
    if (raw === "") { await D.delSetting(db, planPriceKey(k)); continue; }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0 || n > 100000000)
      return back("/super#s-settings", `${PLANS[k].label} 요금은 0원 이상으로 입력해 주세요.`, true);
    await D.setSetting(db, planPriceKey(k), String(n));
  }
  await audit(ctx, "요금제", "월 요금 저장", null);
  return back("/super#s-settings", "요금제를 저장했습니다.");
}

// 알리고에 등록된 템플릿 목록을 받아 코드 칸을 자동으로 채운다.
// 손으로 일곱 개를 옮겨 적으면 오타 하나로 그 종류만 조용히 실패한다.
export async function superSyncTemplates(ctx) {
  const { db, env } = ctx;
  const r = await listProviderTemplates(env);
  if (!r.ok) return back("/super#s-money", `템플릿 목록을 받지 못했습니다 — ${r.error}`, true);
  if (!r.list.length) return back("/super#s-money", "알리고에 등록된 템플릿이 없습니다. 발신프로필이 맞는지 확인해 주세요.", true);

  const { matched, unmatched } = matchTemplates(r.list);
  let saved = 0, waiting = [];
  for (const [kind, m] of Object.entries(matched)) {
    const key = TEMPLATE_KEYS[kind];
    if ((await D.getSetting(db, key)) === m.code) continue;
    await D.setSetting(db, key, m.code);
    saved++;
    // 심사가 안 끝난 것은 채워 두되 아직 못 보낸다고 알린다
    if (m.inspection && !/^APR/i.test(m.inspection)) waiting.push(TEMPLATES[kind].label);
  }
  await audit(ctx, "템플릿동기화", `${saved}건 채움 · 목록 ${r.list.length}건`, null);
  const parts = [`알리고에서 ${r.list.length}건을 받아 ${saved}건을 채웠습니다.`];
  if (waiting.length) parts.push(`아직 심사 중: ${waiting.join(" · ")}`);
  if (unmatched.length) parts.push(`못 찾은 것: ${unmatched.join(" · ")} — 문구가 다르거나 아직 등록 전입니다.`);
  return back("/super#s-money", parts.join(" "), unmatched.length > 0);
}

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

// 관리자가 점포 정보를 대신 채운다.
//
// 예전에는 주소·전화·영업시간을 점주 본인만 고칠 수 있었다. 그런데 상인회장이 명단을
// 미리 넣어 두는 것이 실제 시작 방식이다 — 사장님들은 그 뒤에 로그인한다.
// 대행 등록만 되고 주소를 못 넣으면 점포에 이름과 업종만 남아, 지도에도 안 뜨고
// 목록에서도 빈껍데기로 보인다. 그래서 같은 칸을 관리자에게도 연다.
// 점주가 나중에 자기 화면에서 이어서 고칠 수 있다 — 같은 레코드다.
export async function adminUpdateBusiness(ctx) {
  const { db, form, base, assoc, params } = ctx;
  const b = await D.getBusinessById(db, Number(params.id) || 0);
  const to = `${base}/admin/business/${Number(params.id) || 0}`;
  if (!b || b.association_id !== assoc.id) return back(base + "/admin", "업체를 찾을 수 없습니다.", true);
  const name = cap((form.get("name") || "").trim(), 100);
  if (!name) return back(to, "업체명을 입력하세요.", true);
  const coord = (v, mn, mx) => { const s = (v ?? "").trim(); if (s === "") return null; const n = Number(s); return Number.isFinite(n) && n >= mn && n <= mx ? n : undefined; };
  const lat = coord(form.get("lat"), -90, 90), lng = coord(form.get("lng"), -180, 180);
  if (lat === undefined || lng === undefined) return back(to, "좌표 형식을 확인해 주세요.", true);
  const snsUrl = (v) => { const t = cap((v || "").trim(), 200); if (!t) return ""; return /^https?:\/\//.test(t) ? t : "https://" + t; };
  await D.updateBusiness(db, b.id, {
    name, category: cap(form.get("category"), 40), description: cap(form.get("description"), 2000),
    phone: cap(form.get("phone"), 40), address: cap(form.get("address"), 200),
    hours: cap(form.get("hours"), 100), lat, lng,
    // 점주가 넣어 둔 SNS 는 관리자 화면에서 다루지 않는다 — 안 그리는 칸을 빈 값으로 덮어쓰면 지워진다
    snsInstagram: b.sns_instagram, snsYoutube: b.sns_youtube, snsBlog: b.sns_blog,
    snsKakao: b.sns_kakao, snsNaver: snsUrl(form.get("sns_naver")) || b.sns_naver,
  });
  // 유어딜 가게 번호 — 이 번호가 있는 점포의 이용권이 홈 '우리 골목 이용권' 에 걸린다.
  // 칸을 아예 안 그린 화면(점주 대시보드)에서 온 저장은 건드리지 않는다.
  if (form.has("urdeal_seller_id")) {
    const raw = String(form.get("urdeal_seller_id") || "").trim();
    if (raw && !/^\d{1,12}$/.test(raw)) return back(to, "유어딜 가게 번호는 숫자만 넣어 주세요. (예: 128)", true);
    await D.setUrdealSeller(db, b.id, assoc.id, raw ? Number(raw) : 0);
  }
  await audit(ctx, "점포정보수정", `${name} (관리자 대행)`);
  return back(to, "저장했습니다. 사장님이 로그인하면 이어서 고칠 수 있습니다.");
}

// 관리자가 그 가게의 사진·영상을 대신 올린다.
//
// 사장님이 카톡으로 사진을 보내 오는 것이 실제 흐름이다. 예전에는 점주 본인만 올릴 수 있어
// 회장님이 받은 사진을 넣을 방법이 없었고, 그래서 대행 등록한 가게는 계속 사진이 없었다.
// 지도에서 사진을 긁어 오지 않는 이유는 따로 있다 — 그 사진들은 사장님·손님·플랫폼이
// 각각 찍은 남의 저작물이라, 우리 서버에 복사해 우리 페이지에 거는 순간 재배포가 된다.
async function bizOfAdmin(ctx) {
  const b = await D.getBusinessById(ctx.db, Number(ctx.params.id) || 0);
  return b && b.association_id === ctx.assoc.id ? b : null;
}
export async function adminUploadMedia(ctx) {
  const { db, env, form, base, assoc } = ctx;
  const b = await bizOfAdmin(ctx);
  if (!b) return back(base + "/admin", "업체를 찾을 수 없습니다.", true);
  const to = `${base}/admin/business/${b.id}`;
  const maxPhotos = planOf(assoc).maxPhotos;
  if ((await D.countBusinessImages(db, b.id)) >= maxPhotos)
    return back(to, `사진은 최대 ${maxPhotos}장까지 올릴 수 있습니다.`, true);
  const up = await saveImages(env, form.getAll("files"), 12);
  if (up.error) return back(to, up.error, true);
  if (!up.images.length) return back(to, "선택된 사진이 없습니다.", true);
  const caption = cap((form.get("caption") || "").trim(), 200);
  for (const im of up.images) await D.addMedia(db, { businessId: b.id, kind: "image", filename: im.filename, size: im.size, caption });
  await audit(ctx, "점포사진등록", `${b.name} · ${up.images.length}장 (관리자 대행)`);
  return back(to, `${up.images.length}장 올렸습니다.`);
}
// 릴스·쇼츠도 같은 길로 들어온다 — 주소만 붙여 넣으면 되고, 세로 영상은 세로로 열린다.
export async function adminAddEmbed(ctx) {
  const { db, form, base, assoc } = ctx;
  const b = await bizOfAdmin(ctx);
  if (!b) return back(base + "/admin", "업체를 찾을 수 없습니다.", true);
  const to = `${base}/admin/business/${b.id}`;
  const maxEmbeds = planOf(assoc).maxEmbeds;
  if ((await D.countEmbeds(db, b.id)) >= maxEmbeds) return back(to, `영상 링크는 최대 ${maxEmbeds}개까지 가능합니다.`, true);
  const raw = form.get("url") || "";
  const parsed = parseEmbed(raw);
  if (!parsed) {
    const short = /(?:naver\.me|bit\.ly|han\.gl|vo\.la|url\.kr|me2\.do)\//i.test(raw);
    return back(to, short
      ? "단축 주소는 사용할 수 없습니다. 영상을 열어 주소창에 뜨는 원래 주소를 붙여넣어 주세요."
      : "지원하는 영상 링크가 아닙니다. (유튜브·쇼츠·인스타 릴스·네이버TV)", true);
  }
  await D.addMedia(db, { businessId: b.id, kind: "embed", provider: parsed.provider, embedId: parsed.id,
    caption: cap((form.get("caption") || "").trim(), 200) });
  await audit(ctx, "점포영상등록", `${b.name} · ${parsed.provider} (관리자 대행)`);
  return back(to, "영상 링크를 추가했습니다.");
}
export async function adminDeleteMedia(ctx) {
  const { db, env, base, params } = ctx;
  const b = await bizOfAdmin(ctx);
  const m = await D.getMedia(db, Number(params.mid) || 0);
  if (!b || !m || m.business_id !== b.id) return back(base + "/admin", "삭제할 수 없습니다.", true);
  if (m.filename) await storage.remove(env, m.filename);
  if (m.thumb) await storage.remove(env, m.thumb);
  await D.deleteMedia(db, m.id);
  await audit(ctx, "점포사진삭제", `${b.name} (관리자 대행)`);
  return back(`${base}/admin/business/${b.id}`, "삭제했습니다.");
}

// 카카오 로컬에서 가게 한 곳을 찾아 주소·전화·업종·좌표를 폼에 채워 준다.
//
// 구역을 통째로 긁어 '가입 점포' 로 넣지는 않는다. 동의하지 않은 가게가 홈페이지에 올라가고
// 가입 점포 수가 사실과 달라지기 때문이다. 여기서는 **관리자가 이름을 치고 눈으로 고른** 한 곳만
// 채운다 — 출처가 분명하고, 저장은 사람이 누른다.
export async function adminPlaceSearch(ctx) {
  const { env, query, db, assoc } = ctx;
  const json = (o, status = 200) => new Response(JSON.stringify(o), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  const kakaoKey = String(env.KAKAO_REST_KEY || "").trim();
  const nId = String(env.NAVER_SEARCH_ID || "").trim();
  const nSecret = String(env.NAVER_SEARCH_SECRET || "").trim();
  if (!kakaoKey && !(nId && nSecret))
    return json({ error: "not_configured", message: "지도 검색 열쇠가 등록되지 않았습니다. 운영사에 문의해 주세요." }, 503);
  const q = cap((query.get("q") || "").trim(), 60);
  if (q.length < 2) return json({ places: [] });

  // 검색 중심 — 같은 상호는 전국에 있다. 우리 골목 것을 위로 올리려면 '어디쯤' 인지가 필요하다.
  // 화면이 좌표를 주면 그것을, 없으면 **이미 등록된 우리 가게들의 한가운데**를 쓴다.
  // (첫 가게를 넣을 때는 중심이 없다 — 그때는 전국 검색이지만, 두 번째부터는 골목이 잡힌다)
  let cx = Number(query.get("x")), cy = Number(query.get("y"));
  if (!(Number.isFinite(cx) && Number.isFinite(cy) && cx && cy) && db && assoc) {
    try {
      const pts = await D.listBusinessMarkers(db, assoc.id);
      if (pts.length) {
        cx = pts.reduce((a, p) => a + Number(p.lng), 0) / pts.length;
        cy = pts.reduce((a, p) => a + Number(p.lat), 0) / pts.length;
      }
    } catch { /* 중심이 없으면 그냥 전국 검색 */ }
  }
  const hasCenter = Number.isFinite(cx) && Number.isFinite(cy) && cx && cy;

  // ── 카카오 로컬 ──
  async function fromKakao() {
    if (!kakaoKey) return [];
    const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
    url.searchParams.set("query", q);
    url.searchParams.set("size", "15");
    if (hasCenter) {
      url.searchParams.set("x", String(cx)); url.searchParams.set("y", String(cy));
      url.searchParams.set("radius", "20000"); url.searchParams.set("sort", "distance");
    }
    const r = await fetch(url, { headers: { Authorization: `KakaoAK ${kakaoKey}` } });
    if (!r.ok) throw new Error(`kakao ${r.status}`);
    const data = await r.json().catch(() => null);
    return (data && Array.isArray(data.documents) ? data.documents : []).map((d) => ({
      source: "카카오",
      name: cap(String(d.place_name || ""), 100),
      address: cap(String(d.road_address_name || d.address_name || ""), 200),
      phone: cap(String(d.phone || ""), 40),
      category: cap(String(d.category_name || "").split(">").pop().trim(), 40),
      categoryPath: cap(String(d.category_name || "").trim(), 120),
      lat: Number(d.y) || null, lng: Number(d.x) || null,
      url: /^https?:\/\//.test(String(d.place_url || "")) ? String(d.place_url) : "",
    }));
  }

  // ── 네이버 지역 검색 ──
  // 소상공인은 네이버 스마트플레이스에만 등록한 경우가 많아, 카카오에는 없는 가게가 흔하다.
  // 두 곳을 함께 물어야 "우리 가게가 안 나와요" 가 줄어든다.
  async function fromNaver() {
    if (!(nId && nSecret)) return [];
    const url = new URL("https://openapi.naver.com/v1/search/local.json");
    url.searchParams.set("query", q);
    url.searchParams.set("display", "5");     // 지역 검색은 최대 5건까지만 준다
    const r = await fetch(url, { headers: { "X-Naver-Client-Id": nId, "X-Naver-Client-Secret": nSecret } });
    if (!r.ok) throw new Error(`naver ${r.status}`);
    const data = await r.json().catch(() => null);
    return (data && Array.isArray(data.items) ? data.items : []).map((d) => {
      // 검색어에 <b> 태그가 씌워져 온다 — 태그를 벗기고 실체를 남긴다
      const name = String(d.title || "").replace(/<[^>]*>/g, "").trim();
      // mapx·mapy 는 두 가지 체계가 섞여 온다: 옛 KATECH(6자리대)와 WGS84×10^7(10자리대).
      // 자릿수로 갈라 낸다 — 잘못 읽으면 지도 핀이 엉뚱한 곳에 찍힌다.
      const nx = Number(d.mapx), ny = Number(d.mapy);
      const wgs = Math.abs(nx) > 1e6;
      return {
        source: "네이버",
        name: cap(name, 100),
        address: cap(String(d.roadAddress || d.address || ""), 200),
        phone: cap(String(d.telephone || ""), 40),
        category: cap(String(d.category || "").split(">").pop().trim(), 40),
        categoryPath: cap(String(d.category || "").trim(), 120),
        lat: wgs && Number.isFinite(ny) ? ny / 1e7 : null,
        lng: wgs && Number.isFinite(nx) ? nx / 1e7 : null,
        url: /^https?:\/\//.test(String(d.link || "")) ? String(d.link) : "",
      };
    });
  }

  // **실제로 물어본 곳**만 센다. 열쇠가 없어 아예 묻지 않은 곳을 '성공' 으로 치면,
  // 카카오가 죽었을 때 빈 목록이 200 으로 나가 관리자는 "그런 가게가 없다" 고 읽는다.
  // 그러면 상호만 계속 고쳐 치게 된다 — 지도가 아픈 것을 지도가 아프다고 말해야 한다.
  const tried = [];
  if (kakaoKey) tried.push(fromKakao());
  if (nId && nSecret) tried.push(fromNaver());
  const settled = await Promise.allSettled(tried);
  const got = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (settled.every((r) => r.status === "rejected"))
    return json({ error: "upstream", message: "지도 검색에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 502);

  // 같은 가게가 두 곳에서 오면 한 줄로 합친다 — 관리자는 같은 이름 두 개를 보고 어느 쪽인지 모른다.
  // 전화번호가 같으면 확실히 같은 가게고, 없으면 이름+번지로 본다.
  const keyOf = (p) => (p.phone ? p.phone.replace(/\D/g, "")
    : (p.name.replace(/\s/g, "") + "|" + p.address.replace(/\s/g, "").slice(0, 14)));
  const merged = new Map();
  for (const p of got) {
    const k2 = keyOf(p);
    const prev = merged.get(k2);
    if (!prev) { merged.set(k2, { ...p, sources: [p.source] }); continue; }
    prev.sources.push(p.source);
    // 빈 칸은 다른 쪽 값으로 메운다 — 카카오에 좌표가, 네이버에 도로명이 있는 식이다
    for (const f of ["address", "phone", "category", "categoryPath", "lat", "lng", "url"])
      if (!prev[f] && p[f]) prev[f] = p[f];
  }
  // 중심이 있으면 가까운 순 — 골목 것이 위로 온다
  const out = [...merged.values()].map(({ source, ...p }) => p);
  if (hasCenter) {
    const d2 = (p) => (p.lat == null || p.lng == null) ? Infinity
      : (p.lat - cy) ** 2 + ((p.lng - cx) * 0.8) ** 2;
    out.sort((a, b) => d2(a) - d2(b));
  }
  return json({ places: out.slice(0, 12), center: hasCenter });
}


// ---------- 웹에서 가게 사진 찾아 담기 ----------
//
// 지도(로컬) 검색은 사진을 주지 않는다 — 상호·주소·전화·업종·좌표뿐이다.
// 사진은 **이미지 검색**이라는 별개의 창구에서 온다. 열쇠는 같은 것을 쓴다.
//
// ⚠️ 여기서 오는 것은 '그 가게의 공식 사진' 이 아니라 **웹에서 그 이름으로 검색된 사진**이다.
//    남의 블로그 후기 사진, 다른 지점, 아예 상관없는 사진이 섞여 나온다. 그래서
//    ① 사람이 눈으로 고르고 ② 최대 다섯 장까지만 담고 ③ 출처를 함께 저장한다.
//    출처를 안 남기면 나중에 내려 달라는 요청이 왔을 때 어느 사진인지 찾을 수조차 없다.
const IMPORT_MAX = 5;
export async function adminImageSearch(ctx) {
  const { env, query } = ctx;
  const json = (o, status = 200) => new Response(JSON.stringify(o), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  const key = String(env.KAKAO_REST_KEY || "").trim();
  if (!key) return json({ error: "not_configured", message: "이미지 검색 열쇠가 등록되지 않았습니다. 운영사에 문의해 주세요." }, 503);
  const q = cap((query.get("q") || "").trim(), 60);
  if (q.length < 2) return json({ images: [] });
  const url = new URL("https://dapi.kakao.com/v2/search/image");
  url.searchParams.set("query", q);
  url.searchParams.set("size", "24");
  let r;
  try {
    r = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
  } catch {
    return json({ error: "unreachable", message: "이미지 검색에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 502);
  }
  if (!r.ok) return json({ error: "upstream", message: `이미지 검색이 ${r.status} 로 답했습니다.` }, 502);
  const data = await r.json().catch(() => null);
  const docs = (data && Array.isArray(data.documents) ? data.documents : []);
  return json({ max: IMPORT_MAX, images: docs.filter((d) => httpsOnly(d.image_url)).slice(0, 24).map((d) => ({
    url: String(d.image_url), thumb: httpsOnly(d.thumbnail_url) ? String(d.thumbnail_url) : String(d.image_url),
    site: cap(String(d.display_sitename || ""), 60),
    doc: httpsOnly(d.doc_url) ? String(d.doc_url) : "",
    w: Number(d.width) || 0, h: Number(d.height) || 0,
  })) });
}
const httpsOnly = (u) => { try { return new URL(String(u)).protocol === "https:"; } catch { return false; } };

// 고른 사진을 우리 저장소로 가져온다.
//
// 주소를 화면에서 받아 그대로 fetch 하면, 그 칸이 곧 **우리 서버로 아무 주소나 찌르는 창구**가 된다
// (SSRF). 그래서 두 겹으로 막는다:
//   ① 같은 검색어로 **서버가 직접 다시 검색**해, 그 결과에 없는 주소는 통째로 버린다
//   ② 그래도 https·공개 도메인만, 내부망·IP 주소는 거부한다 (웹훅 주소와 같은 잣대)
export async function adminImportPhotos(ctx) {
  const { db, env, form, base, assoc } = ctx;
  const b = await D.getBusinessById(db, Number(ctx.params.id) || 0);
  if (!b || b.association_id !== assoc.id) return back(`${base}/admin`, "업체를 찾을 수 없습니다.", true);
  const at = (m, bad) => back(`${base}/admin/business/${b.id}`, m, bad);
  const key = String(env.KAKAO_REST_KEY || "").trim();
  if (!key) return at("이미지 검색 열쇠가 등록되지 않았습니다.", true);
  if (!storage.enabled(env)) return at("사진 저장소(R2)가 아직 연결되지 않았습니다.", true);

  const q = cap((form.get("q") || "").trim(), 60);
  const picked = form.getAll("url").map(String).filter(Boolean).slice(0, IMPORT_MAX);
  if (!q || !picked.length) return at("가져올 사진을 골라 주세요.", true);

  const plan = planOf(assoc);
  const have = await D.countBusinessImages(db, b.id);
  if (have >= plan.maxPhotos) return at(`사진은 최대 ${plan.maxPhotos}장까지 올릴 수 있습니다.`, true);
  const room = Math.min(IMPORT_MAX, plan.maxPhotos - have);

  // ① 서버가 같은 검색어로 다시 물어, 실제로 그 결과에 있던 주소만 통과시킨다
  let allow = new Map();
  try {
    const u = new URL("https://dapi.kakao.com/v2/search/image");
    u.searchParams.set("query", q); u.searchParams.set("size", "24");
    const r = await fetch(u, { headers: { Authorization: `KakaoAK ${key}` } });
    if (!r.ok) return at("이미지 검색을 다시 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", true);
    for (const d of ((await r.json()).documents || [])) {
      if (httpsOnly(d.image_url)) allow.set(String(d.image_url),
        { site: cap(String(d.display_sitename || ""), 60), doc: httpsOnly(d.doc_url) ? String(d.doc_url) : "" });
    }
  } catch {
    return at("이미지 검색에 연결하지 못했습니다.", true);
  }

  let saved = 0, skipped = 0;
  for (const raw of picked) {
    if (saved >= room) break;
    const meta = allow.get(raw);
    // ② 검색 결과에 없던 주소 = 화면이 아니라 누군가 손으로 넣은 것. 버린다.
    if (!meta) { skipped++; continue; }
    const chk = checkWebhookUrl(raw, env.PUBLIC_ORIGIN || "");   // https · 공개 도메인 · 내부망 금지
    if (!chk.ok) { skipped++; continue; }
    let res;
    try { res = await fetch(raw, { redirect: "follow" }); } catch { skipped++; continue; }
    if (!res.ok) { skipped++; continue; }
    const len = Number(res.headers.get("content-length") || 0);
    if (len && len > MAX_IMAGE_BYTES) { skipped++; continue; }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) { skipped++; continue; }
    const real = sniffImage(buf);            // 확장자·헤더가 아니라 실제 바이트로 판정
    if (!real) { skipped++; continue; }
    const stored = await storage.save(env, buf, real);
    await D.addMedia(db, { businessId: b.id, kind: "image", filename: stored, size: buf.byteLength,
      caption: "", sourceName: meta.site, sourceUrl: meta.doc });
    saved++;
  }
  const tail = skipped ? ` (${skipped}장은 가져오지 못했습니다)` : "";
  return saved
    ? at(`사진 ${saved}장을 담았습니다.${tail} 사장님 사진이 들어오면 바꿔 주세요.`)
    : at(`사진을 가져오지 못했습니다.${tail}`, true);
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
// 임시 비밀번호 — Math.random() 은 예측 가능해 계정 탈취에 쓰일 수 있다.
// 이 값은 사람이 손으로 옮겨 적으므로 헷갈리는 글자(0/O, 1/l/I)는 뺀다.
const TEMP_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export function tempPassword(len = 12) {
  const b = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += TEMP_ALPHABET[b[i] % TEMP_ALPHABET.length];
  return out;
}

// 유형별 표시 이름·기본 한 줄 소개는 레지스트리(kinds.js)에서 온다.
// 상인회는 db.createAssociation 의 기본값을 그대로 쓰므로 undefined 를 넘긴다.
const KIND_LABEL = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.createLabel || v.label]));
const taglineFor = (kind, preset) =>
  kind === "merchant" ? undefined
  : (kindById(kind).usesLanding && (PRESETS[preset] || {}).tagline) || kindById(kind).tagline;

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
        to: owner.email, subject: `'${b.name}' 가게가 공개되었습니다`,
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
// 공지 고치기 — 지웠다 다시 쓰면 주소가 바뀌어 카톡으로 돌린 링크가 죽는다.
// 사진은 새로 고르지 않으면 원래 것을 그대로 둔다. 지우려면 [사진 지우기] 를 체크한다.
export async function adminUpdateNotice(ctx) {
  const { db, env, form, base, assoc, params } = ctx;
  const n = await D.getNotice(db, Number(params.id) || 0);
  if (!n || n.association_id !== assoc.id) return back(base + "/admin", "공지를 찾을 수 없습니다.", true);
  const title = cap((form.get("title") || "").trim(), 200);
  if (!title) return back(base + "/admin#s-content", "공지 제목을 입력하세요.", true);
  const up = await saveImages(env, form.getAll("image"), 1);
  if (up.error) return back(base + "/admin#s-content", up.error, true);
  const drop = form.get("drop_image") === "1";
  const nextImage = up.images[0] ? up.images[0].filename : drop ? "" : null;
  // 바꿔치웠거나 지운 사진은 저장소에서도 치운다 — 안 그러면 아무도 안 보는 파일이 쌓인다
  if (nextImage !== null && n.image && n.image !== nextImage) await storage.remove(env, n.image).catch(() => {});
  await D.updateNotice(db, n.id, assoc.id, {
    title, body: cap(form.get("body"), 10000), tag: cap(form.get("tag") || "안내", 20),
    pinned: form.get("pinned") === "1", image: nextImage,
  });
  await audit(ctx, "공지수정", title);
  return back(base + "/admin#s-content", "공지를 고쳤습니다.");
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
export async function adminUpdateEvent(ctx) {
  const { db, env, form, base, assoc, params } = ctx;
  const e = await D.getEvent(db, Number(params.id) || 0);
  if (!e || e.association_id !== assoc.id) return back(base + "/admin", "행사를 찾을 수 없습니다.", true);
  const title = cap((form.get("title") || "").trim(), 200);
  const date = cap((form.get("event_date") || "").trim(), 10);
  if (!title || !date) return back(base + "/admin#s-content", "행사명과 날짜를 입력하세요.", true);
  const up = await saveImages(env, form.getAll("image"), 1);
  if (up.error) return back(base + "/admin#s-content", up.error, true);
  const drop = form.get("drop_image") === "1";
  const nextImage = up.images[0] ? up.images[0].filename : drop ? "" : null;
  if (nextImage !== null && e.image && e.image !== nextImage) await storage.remove(env, e.image).catch(() => {});
  await D.updateEvent(db, e.id, assoc.id, {
    title, event_date: date, place: cap(form.get("place"), 120),
    description: cap(form.get("description"), 2000), image: nextImage,
  });
  await audit(ctx, "행사수정", title);
  return back(base + "/admin#s-content", "행사를 고쳤습니다.");
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
// ---------- 홈 팝업 ----------
//
// 관리자가 홈 첫 화면에 띄우는 안내창입니다. 손님 화면을 가로막는 유일한 요소라
// 세 가지를 지킵니다: ① 노출 기간이 지나면 스스로 내려간다 ② 방문자가 '오늘 하루 보지 않기'로 닫는다
// ③ 링크는 http(s) 만 — 관리자 계정이 털렸을 때 javascript: 주소가 팝업 버튼으로 나가면 안 됩니다.
const YMD = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim()) ? String(v).trim() : "");
const httpUrl = (v) => {
  const t = cap((v || "").trim(), 300);
  if (!t) return "";
  // 같은 사이트 안으로 보내는 상대 경로(/t/…)는 그대로 둡니다. 그 외에는 http(s) 만 통과시킵니다.
  if (t.startsWith("/") && !t.startsWith("//")) return t;
  return /^https?:\/\//i.test(t) ? t : "";
};
export async function adminCreatePopup(ctx) {
  const { db, env, form, base, assoc } = ctx;
  const title = (form.get("title") || "").trim();
  if (!title) return back(base + "/admin", "팝업 제목을 입력하세요.", true);
  const up = await saveImages(env, form.getAll("image"), 1);
  if (up.error) return back(base + "/admin", up.error, true);
  const start = YMD(form.get("start_date")), end = YMD(form.get("end_date"));
  if (start && end && end < start) return back(base + "/admin", "노출 종료일이 시작일보다 빠릅니다.", true);
  await D.createPopup(db, {
    associationId: assoc.id, title: cap(title, 100), body: cap(form.get("body"), 500),
    image: up.images[0]?.filename || "", linkUrl: httpUrl(form.get("link_url")),
    linkLabel: cap((form.get("link_label") || "").trim(), 30), startDate: start, endDate: end,
  });
  await audit(ctx, "팝업등록", title);
  return back(base + "/admin", "팝업을 등록했습니다.");
}
export async function adminDeletePopup(ctx) {
  const { db, env, base, assoc, params } = ctx;
  const p = await D.getPopup(db, Number(params.id));
  if (p && p.association_id === assoc.id) {
    if (p.image) await storage.remove(env, p.image);
    await D.deletePopup(db, p.id);
    await audit(ctx, "팝업삭제", p.title);
  }
  return back(base + "/admin", "팝업을 삭제했습니다.");
}
export async function adminTogglePopup(ctx) {
  const { db, base, assoc, params } = ctx;
  const p = await D.getPopup(db, Number(params.id));
  if (!p || p.association_id !== assoc.id) return back(base + "/admin", "팝업을 찾을 수 없습니다.", true);
  await D.setPopupEnabled(db, p.id, !p.enabled);
  await audit(ctx, p.enabled ? "팝업내림" : "팝업올림", p.title);
  return back(base + "/admin", p.enabled ? "팝업을 내렸습니다." : "팝업을 다시 띄웁니다.");
}

// 히어로 배경 영상 저장 — 파일 이름이나 MIME 은 얼마든지 속일 수 있으므로 실제 바이트로 본다.
// mp4/mov 는 4바이트 뒤에 "ftyp", webm 은 EBML 매직(1A 45 DF A3)으로 시작한다.
const HERO_VIDEO_MAX = 8 * 1024 * 1024; // 8MB — 첫 화면에서 받는 파일이다. 크면 시골 LTE 에서 첫 인상이 망가진다
function sniffVideo(buf) {
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return "video/mp4";
  return "";
}
async function saveHeroVideo(env, file) {
  if (!file || typeof file !== "object" || !file.size) return { key: "" };
  if (!storage.enabled(env)) return { error: "파일 저장소(R2)가 연결되지 않아 영상을 올릴 수 없습니다." };
  if (file.size > HERO_VIDEO_MAX) return { error: `배경 영상은 ${Math.round(HERO_VIDEO_MAX / 1024 / 1024)}MB 이하만 올릴 수 있습니다. (올리신 파일 ${(file.size / 1024 / 1024).toFixed(1)}MB)` };
  const buf = new Uint8Array(await file.arrayBuffer());
  const type = sniffVideo(buf);
  if (!type) return { error: "MP4 또는 WebM 영상만 올릴 수 있습니다." };
  return { key: await storage.save(env, buf, type) };
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
  // 히어로 배경 영상 (선택) — 사진이 poster 가 되므로, 영상만 있고 사진이 없으면 첫 프레임이 뜨기 전까지 빈 화면이 된다.
  let heroVideo = assoc.hero_video || "";
  const vres = await saveHeroVideo(env, form.get("hero_video"));
  if (vres.error) return back(base + "/admin", vres.error, true);
  if (vres.key) { if (heroVideo) await storage.remove(env, heroVideo); heroVideo = vres.key; }
  else if (form.get("hero_video_clear") === "1") { if (heroVideo) await storage.remove(env, heroVideo); heroVideo = ""; }
  // 검색엔진 소유 확인 코드: 메타 태그 content 로 그대로 나가므로 안전한 문자만 허용
  const verCode = (v) => (cap(v, 100) || "").replace(/[^-\w.]/g, "");
  await D.updateAssociation(db, assoc.id, { name: cap(form.get("name").trim(), 100), tagline: cap(form.get("tagline"), 200), brand_color: color, phone: cap(form.get("phone"), 40), email: cap(form.get("email"), 120), address: cap(form.get("address"), 200), logo, hero_image: heroImage, hero_video: heroVideo,
    naver_verification: verCode(form.get("naver_verification")), google_verification: verCode(form.get("google_verification")),
    // GA4 측정 ID — 'G-' + 영숫자. 이 값은 구글로 나가는 <script src> 의 쿼리에 그대로 붙으므로
    // 규격에 맞지 않으면 아예 저장하지 않습니다(빈 값 = 애널리틱스 끔).
    ga_measurement_id: (() => { const v = cap((form.get("ga_measurement_id") || "").trim(), 30).toUpperCase(); return /^G-[A-Z0-9]{4,20}$/.test(v) ? v : ""; })() });
  await audit(ctx, "브랜딩수정", "");
  return back(base + "/admin", "상인회 정보가 저장되었습니다.");
}
// ---------- 우리 직인(법인 인감) ----------
//
// 회사는 계약마다 서명하지 않는다. 직인이 이미 찍힌 계약서를 보내고, 상대방만 서명한다.
// 그래서 직인은 '서명' 이 아니라 **보내는 쪽이 미리 찍어 두는 표시** 다 —
// 서명자의 전자서명(개인키로 봉인되는 그것)과 같은 것으로 취급하지 않는다.
export async function adminSaveSeal(ctx) {
  const { db, env, form, base, assoc } = ctx;
  const to = base + "/admin/documents";
  const up = await saveImages(env, form.getAll("seal"), 1);
  if (up.error) return back(to, up.error, true);
  if (!up.images[0]) return back(to, "직인 이미지를 골라 주세요.", true);
  const old = assoc.seal_media;
  await D.setAssociationSeal(db, assoc.id, up.images[0].filename);
  // 옛 직인 그림은 지운다. 이미 찍힌 계약서는 **각자 자기 사본**을 가지고 있으므로
  // (찍을 때 복사해 둔다) 지난 계약서의 도장이 사라지지 않는다.
  if (old) await storage.remove(env, old);
  await audit(ctx, "직인등록", "");
  return back(to, "직인을 등록했습니다. 도장 자리를 '우리 직인' 으로 지정하면 자동으로 찍힙니다.");
}
export async function adminDeleteSeal(ctx) {
  const { db, env, base, assoc } = ctx;
  if (assoc.seal_media) await storage.remove(env, assoc.seal_media);
  await D.setAssociationSeal(db, assoc.id, "");
  await audit(ctx, "직인삭제", "");
  return back(base + "/admin/documents", "직인을 지웠습니다. 이미 보낸 계약서의 도장은 그대로 남습니다.");
}

// 도장 자리에 우리 직인을 찍는다. 배치를 저장할 때마다 다시 찍는다(배치 저장은 필드를 통째로
// 갈아끼우므로 값도 함께 사라진다). 찍을 때 **그림을 복사**하는 이유: 나중에 직인을 바꿔도
// 이미 나간 계약서의 도장이 따라 바뀌면 안 되기 때문이다.
async function applySeal(ctx, doc) {
  const { db, env, assoc } = ctx;
  const rows = await D.listAutoFields(db, doc.id, "seal");
  if (!rows.length) return 0;
  if (!assoc.seal_media) return -1;                 // 등록된 직인이 없다 — 호출부가 안내한다
  const src = await storage.get(env, assoc.seal_media);
  if (!src) return -1;
  const bytes = new Uint8Array(await src.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) return -1;
  const key = await storage.save(env, bytes, type);
  const hash = await sha256HexBytes(bytes);
  for (const f of rows) {
    await D.setFieldValue(db, { fieldId: f.id, documentId: doc.id, userId: 0, value: "", image: key, imageHash: hash });
  }
  // 증적에 남긴다. 이건 서명자의 전자서명이 아니라 **보내는 쪽이 찍은 도장** 이고,
  // 그래서 서명자의 봉인(개인키로 잠그는 그것)에는 들어가지 않는다. 기록만 남긴다.
  await D.logDocEvent(db, { documentId: doc.id, userId: ctx.user?.id || 0, actorName: ctx.user?.name || "",
    kind: "sealed", detail: `우리 직인 ${rows.length}곳 · 해시 ${hash.slice(0, 12)}`, ip: ctx.ip || "", userAgent: uaOf(ctx) });
  return rows.length;
}

export async function adminReadNotifications(ctx) {
  await D.markAllNotificationsRead(ctx.db, ctx.assoc.id);
  return back(ctx.base + "/admin", "알림을 모두 읽음 처리했습니다.");
}
export async function adminResetUserPassword(ctx) {
  const { db, base, assoc, params } = ctx;
  const target = await D.getUserById(db, Number(params.id));
  if (!target || target.association_id !== assoc.id) return back(base + "/admin", "대상 회원을 찾을 수 없습니다.", true);
  if (target.role === "SUPERADMIN") return back(base + "/admin", "플랫폼 운영자 계정은 여기서 바꿀 수 없습니다.", true);
  // 자기 비밀번호는 계정 설정에서 바꾼다. 여기서 되면 세션 탈취자가 곧바로 계정을 굳혀 버린다.
  if (target.id === ctx.user.id) return back(base + "/admin", "본인 비밀번호는 계정 설정에서 변경해 주세요.", true);
  // 이메일 없이 등록한 사장님은 휴대폰 번호로 들어온다. 무엇을 불러 줘야 하는지
  // 여기서 같이 말해 주지 않으면, 회장님이 가짜 주소(@no-login.invalid)를 불러 준다.
  const byPhone = isPlaceholderEmail(target.email);
  if (byPhone && !target.phone)
    return back(base + "/admin", `${target.name}님은 이메일도 휴대폰 번호도 없어 로그인할 방법이 없습니다. 점포 화면에서 하나를 넣어 주세요.`, true);
  const temp = tempPassword();
  const { hash, salt } = await hashPassword(temp);
  await D.updateUserPassword(db, target.id, hash, salt);
  await audit(ctx, "비밀번호재설정", byPhone ? `${target.name} (휴대폰 로그인)` : target.email);
  const idLabel = byPhone ? `휴대폰 ${D.maskPhone(target.phone)}` : target.email;
  return back(base + "/admin", `${target.name}님 — ${idLabel} / 임시 비밀번호 ${temp} (전달 후 변경 안내하세요)`);
}

// 관리자 대행 등록: 총무가 사장님 대신 회원+업체를 만들고 임시 비번을 전달.
// source='proxy' 로 태깅 → '셀프 등록률' 계측의 분모/분자에 반영.
// 로그인 자리만 잡아 두는 주소. .invalid 는 절대 실재하지 않도록 예약된 최상위 도메인이라
// (RFC 2606) 실수로 메일이 나갈 일이 없다. 사장님이 나중에 진짜 이메일을 정하면 교체된다.
export const NO_LOGIN_DOMAIN = "no-login.invalid";
export const isPlaceholderEmail = (e) => String(e || "").endsWith("@" + NO_LOGIN_DOMAIN);

export async function adminAddMember(ctx) {
  // 전자계약 조직에는 업체가 없다 — 담당자는 '담당자 추가'로, 내부 서명자는 이 경로로 받되
  // 업체 레코드를 만들지 않는다(만들면 쓰지도 않을 '내 업체' 화면이 열린다).
  const { db, form, base, assoc } = ctx;
  const name = cap((form.get("name") || "").trim(), 60);
  const email = cap((form.get("email") || "").toLowerCase().trim(), 120);
  const phone = D.normalizePhone(form.get("phone") || "");
  const businessName = cap((form.get("business_name") || "").trim(), 100);
  const isEsign = assoc.kind === "esign";
  const to = base + "/admin";
  if (!name) return back(to, "성함을 입력해 주세요.", true);
  if (!isEsign && !businessName) return back(to, "업체명을 입력해 주세요.", true);
  // 이메일은 이제 선택이다. 상인회 사장님 중에는 이메일이 없는 분이 많고, 이 서비스는
  // 안내를 알림톡으로 보내므로 실제로 필요한 연락처는 휴대폰이다.
  // 다만 로그인은 이메일로 하므로, 없으면 '아직 로그인 못 하는 상태' 로 자리만 잡아 둔다.
  if (email && !EMAIL_RE.test(email)) return back(to, "이메일 형식을 확인해 주세요.", true);
  if (phone && !D.isValidPhone(phone)) return back(to, "휴대폰 번호 형식을 확인해 주세요. (010-1234-5678)", true);
  if (!email && !phone) return back(to, "이메일이나 휴대폰 중 하나는 있어야 합니다 — 둘 다 없으면 사장님께 연락할 방법이 없습니다.", true);
  if (email && await D.getUserByEmail(db, email)) return back(to, "이미 가입된 이메일입니다.", true);
  if ((await D.countMembers(db, assoc.id)) >= planOf(assoc).maxMembers)
    return back(to, "회원 정원이 가득 찼습니다.", true);
  const loginEmail = email || `p${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}@${NO_LOGIN_DOMAIN}`;
  const temp = tempPassword();
  const { hash, salt } = await hashPassword(temp);
  const user = await D.createUser(db, { email: loginEmail, passwordHash: hash, salt, name, role: "MERCHANT", associationId: assoc.id, phone });
  if (!isEsign) {
    const biz = await D.createBusiness(db, { associationId: assoc.id, ownerId: user.id, name: businessName, category: cap(form.get("category"), 40), source: "proxy" });
    // 지도에서 찾아 채운 값이 함께 왔으면 그 자리에서 저장한다 — 안 그러면 등록하자마자
    // 다시 [정보 채우기] 로 들어가 같은 값을 또 넣어야 한다.
    const coord = (v, mn, mx) => { const t = String(v ?? "").trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) && n >= mn && n <= mx ? n : null; };
    const address = cap((form.get("address") || "").trim(), 200);
    const bizPhone = cap((form.get("biz_phone") || "").trim(), 40);
    const lat = coord(form.get("lat"), -90, 90), lng = coord(form.get("lng"), -180, 180);
    if (address || bizPhone || lat != null) {
      await D.updateBusiness(db, biz.id, {
        name: biz.name, category: biz.category, description: "", phone: bizPhone, address, hours: "", lat, lng,
        snsInstagram: "", snsYoutube: "", snsBlog: "", snsKakao: "", snsNaver: "",
      });
    }
  }
  await audit(ctx, isEsign ? "서명자등록" : "회원대행등록", `${name}${businessName ? " / " + businessName : ""} (${email || "이메일 없음"})`);
  // 이메일이 없으면 휴대폰 번호가 곧 아이디다. 그 자리에서 비밀번호까지 알려 주지 않으면
  // 회장님이 사장님께 전화해 불러 줄 것이 없다.
  return back(to, `${isEsign ? "내부 서명자" : "대행"} 등록 완료 — ${name}님 로그인: ${
    email || D.maskPhone(phone) + " (휴대폰 번호로 로그인)"} / 임시비번 ${temp} (본인에게 전달하세요)`);
}

// 사장님 휴대폰 번호 수정 — 이메일 없이 등록한 계정에서는 이 번호가 곧 아이디다.
// 번호를 잘못 받아 적으면 사장님이 영영 못 들어오는데, 예전에는 고칠 화면이 없었다.
export async function adminSetOwnerPhone(ctx) {
  const { db, form, base, assoc, params } = ctx;
  const b = await D.getBusinessById(db, Number(params.id) || 0);
  if (!b || b.association_id !== assoc.id) return back(base + "/admin", "업체를 찾을 수 없습니다.", true);
  const to = `${base}/admin/business/${b.id}`;
  const owner = b.owner_id ? await D.getUserById(db, b.owner_id) : null;
  if (!owner) return back(to, "연결된 사장님 계정이 없습니다.", true);
  const phone = D.normalizePhone(form.get("phone") || "");
  if (phone && !D.isValidPhone(phone)) return back(to, "휴대폰 번호 형식을 확인해 주세요. (010-1234-5678)", true);
  if (!phone && isPlaceholderEmail(owner.email))
    return back(to, "이 계정은 휴대폰 번호가 아이디입니다 — 비우면 사장님이 로그인할 수 없게 됩니다.", true);
  await D.setUserPhone(db, owner.id, phone);
  await audit(ctx, "사장님연락처변경", `${b.name} · ${owner.name} → ${phone ? D.maskPhone(phone) : "지움"}`);
  return back(to, phone
    ? `휴대폰 번호를 저장했습니다 — 사장님은 ${D.formatPhone(phone)} 로 로그인하십니다. 비밀번호는 회원 목록의 [임시 비밀번호] 로 발급하세요.`
    : "휴대폰 번호를 지웠습니다.");
}

// 이메일 없이 등록해 둔 사장님에게 나중에 로그인 이메일을 지정한다.
// 이게 없으면 이메일 없이 등록한 계정은 영영 로그인할 수 없는 껍데기로 남는다.
export async function adminSetOwnerEmail(ctx) {
  const { db, form, base, assoc, params } = ctx;
  const b = await D.getBusinessById(db, Number(params.id) || 0);
  if (!b || b.association_id !== assoc.id) return back(base + "/admin", "업체를 찾을 수 없습니다.", true);
  const to = `${base}/admin/business/${b.id}`;
  const owner = b.owner_id ? await D.getUserById(db, b.owner_id) : null;
  if (!owner) return back(to, "연결된 사장님 계정이 없습니다.", true);
  if (!isPlaceholderEmail(owner.email)) return back(to, "이미 로그인 이메일이 있는 계정입니다.", true);
  const email = cap((form.get("email") || "").toLowerCase().trim(), 120);
  if (!EMAIL_RE.test(email)) return back(to, "이메일 형식을 확인해 주세요.", true);
  if (await D.getUserByEmail(db, email)) return back(to, "이미 가입된 이메일입니다.", true);
  const temp = tempPassword();
  const { hash, salt } = await hashPassword(temp);
  await D.setUserEmail(db, owner.id, email);
  await D.updateUserPassword(db, owner.id, hash, salt);
  await audit(ctx, "로그인이메일지정", `${b.name} · ${owner.name} → ${email}`);
  return back(to, `로그인 이메일을 지정했습니다 — ${email} / 임시비번 ${temp} (사장님께 전달하세요)`);
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
  if (form.get("on") === "1") {
    // 금액을 안 적어 보내면 상인회가 정해 둔 기본 회비로 넣는다 — 매번 같은 숫자를
    // 타이핑하게 하면 임원이 그냥 엑셀로 돌아간다.
    const raw = String(form.get("amount") || "").replace(/[,\s원]/g, "");
    if (raw && !/^\d{1,9}$/.test(raw)) return back(`${base}/admin?due_period=${encodeURIComponent(period)}`, "회비 금액은 숫자만 넣어 주세요.", true);
    await D.setDuePaid(db, assoc.id, userId, period, raw ? Number(raw) : (assoc.dues_amount || 0));
  } else await D.setDueUnpaid(db, assoc.id, userId, period);
  return redirect(`${base}/admin?due_period=${encodeURIComponent(period)}#p-dues`);
}

// 기본 월 회비 — 한 번 정해 두면 체크할 때마다 그 금액이 들어간다.
export async function adminDuesAmount(ctx) {
  const { db, form, base, assoc } = ctx;
  const raw = String(form.get("dues_amount") || "").replace(/[,\s원]/g, "");
  if (raw && !/^\d{1,9}$/.test(raw)) return back(base + "/admin#p-dues", "회비 금액은 숫자만 넣어 주세요. (예: 30000)", true);
  await D.setDuesAmount(db, assoc.id, raw ? Number(raw) : 0);
  await audit(ctx, "회비금액변경", raw ? `${Number(raw).toLocaleString("ko-KR")}원` : "안 정함");
  return back(base + "/admin#p-dues", raw ? `기본 월 회비를 ${Number(raw).toLocaleString("ko-KR")}원으로 정했습니다.` : "기본 회비를 지웠습니다 — 금액 없이 체크만 합니다.");
}

// 권한 회수 — 계정을 지우지 않고 역할만 내린다.
// 서명 이력·감사 추적이 계정에 매달려 있으므로 삭제하면 증거가 사라진다.
export async function adminRevokeRole(ctx) {
  const { db, base, assoc, params, user } = ctx;
  const target = await D.getUserById(db, Number(params.id) || 0);
  if (!target || target.association_id !== assoc.id) return back(base + "/admin", "대상을 찾을 수 없습니다.", true);
  if (target.id === user.id) return back(base + "/admin", "본인 권한은 회수할 수 없습니다.", true);
  if (target.role !== "ADMIN" && target.role !== "STAFF") return back(base + "/admin", "이미 권한이 없는 계정입니다.", true);
  // 마지막 관리자를 내리면 그 조직에 들어갈 사람이 없어진다
  if (target.role === "ADMIN") {
    const admins = await D.listUsersByAssociation(db, assoc.id, "ADMIN");
    if (admins.length <= 1) return back(base + "/admin", "마지막 관리자의 권한은 회수할 수 없습니다. 다른 관리자를 먼저 지정해 주세요.", true);
  }
  await D.setUserRole(db, target.id, assoc.id, "MERCHANT");
  await audit(ctx, "권한회수", `${target.name} (${target.email}) ${target.role} → 일반`);
  return back(base + "/admin", `${target.name}님의 권한을 회수했습니다. 계정과 서명 이력은 그대로 남습니다.`);
}

// ---------- 부서 ----------
//
// 한 조직 안에 인사팀과 영업팀이 같이 있으면, 인사팀의 근로계약서가 영업팀 화면에 그대로 뜬다.
// 부서는 그 경계다. 다만 **켜기 전에는 아무것도 달라지지 않는다** — 쓰던 조직의 화면이
// 어느 날 갑자기 비어 보이면 그건 기능이 아니라 사고다.
const TEAM_MAX = 30;
// 안내문은 back() 이 쿼리로 붙인다 — 여기에 #조각을 두면 '?msg=' 가 조각 안으로 들어가 깨진다.
// 사람이 보던 묶음(담당자 탭)으로는 화면 스크립트가 알아서 되돌린다.
const teamsTo = (base) => base + "/admin";

export async function adminAddTeam(ctx) {
  const { db, form, base, assoc } = ctx;
  const name = cap((form.get("team_name") || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 40);
  if (!name) return back(teamsTo(base), "부서 이름을 입력해 주세요.", true);
  const cur = await D.listTeams(db, assoc.id);
  if (cur.length >= TEAM_MAX) return back(teamsTo(base), `부서는 ${TEAM_MAX}개까지 만들 수 있습니다.`, true);
  if (cur.some((t) => t.name === name)) return back(teamsTo(base), `'${name}' 부서가 이미 있습니다.`, true);
  await D.createTeam(db, assoc.id, name);
  await audit(ctx, "부서추가", name);
  return back(teamsTo(base), `'${name}' 부서를 만들었습니다. 담당자를 배정해 주세요.`);
}

export async function adminRenameTeam(ctx) {
  const { db, form, base, assoc, params } = ctx;
  const t = await D.getTeam(db, Number(params.id) || 0);
  if (!t || t.association_id !== assoc.id) return back(teamsTo(base), "부서를 찾을 수 없습니다.", true);
  const name = cap((form.get("team_name") || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 40);
  if (!name) return back(teamsTo(base), "부서 이름을 입력해 주세요.", true);
  if ((await D.listTeams(db, assoc.id)).some((x) => x.id !== t.id && x.name === name))
    return back(teamsTo(base), `'${name}' 부서가 이미 있습니다.`, true);
  await D.renameTeam(db, t.id, assoc.id, name);
  await audit(ctx, "부서이름변경", `${t.name} → ${name}`);
  return back(teamsTo(base), `'${t.name}' 을 '${name}' 으로 바꿨습니다.`);
}

export async function adminDeleteTeam(ctx) {
  const { db, base, assoc, params } = ctx;
  const t = await D.getTeam(db, Number(params.id) || 0);
  if (!t || t.association_id !== assoc.id) return back(teamsTo(base), "부서를 찾을 수 없습니다.", true);
  // 계약과 사람은 지우지 않는다 — '부서 없음'(조직 전체 공개)으로 돌아갈 뿐이다.
  // 조직 개편 한 번에 계약 이력이 통째로 사라지면 그게 더 큰 사고다.
  await D.deleteTeam(db, t.id, assoc.id);
  await audit(ctx, "부서삭제", t.name);
  return back(teamsTo(base), `'${t.name}' 부서를 없앴습니다. 그 부서의 계약과 담당자는 '부서 없음' 이 되어 조직 전체가 다시 봅니다.`);
}

export async function adminSetUserTeam(ctx) {
  const { db, form, base, assoc, params } = ctx;
  const target = await D.getUserById(db, Number(params.id) || 0);
  if (!target || target.association_id !== assoc.id) return back(teamsTo(base), "대상을 찾을 수 없습니다.", true);
  const id = Number(form.get("team")) || 0;
  if (id && !(await D.listTeams(db, assoc.id)).some((t) => t.id === id))
    return back(teamsTo(base), "이 조직의 부서만 지정할 수 있습니다.", true);
  await D.setUserTeam(db, target.id, assoc.id, id);
  const name = id ? (await D.getTeam(db, id)).name : "부서 없음";
  await audit(ctx, "부서배정", `${target.name} → ${name}`);
  // 이미 만들어진 계약은 따라가지 않는다 — 계약의 부서는 '만든 시점' 의 것이다.
  // 사람이 옮겼다고 지난 계약이 새 부서로 딸려 가면, 옮긴 순간 남의 부서 계약이 열린다.
  return back(teamsTo(base), `${target.name}님을 '${name}' 으로 옮겼습니다. 이미 만들어진 계약의 부서는 그대로입니다.`);
}

export async function adminTeamScope(ctx) {
  const { db, form, base, assoc } = ctx;
  const on = form.get("on") === "1";
  if (on && !(await D.listTeams(db, assoc.id)).length)
    return back(teamsTo(base), "먼저 부서를 하나 이상 만들어 주세요.", true);
  await D.setTeamScope(db, assoc.id, on);
  await audit(ctx, "부서경계", on ? "켬" : "끔");
  return back(teamsTo(base), on
    ? "이제 담당자는 자기 부서의 계약과 자기가 만든 계약만 봅니다. 부서를 정하지 않은 계약은 그대로 모두가 봅니다."
    : "부서 경계를 껐습니다. 담당자가 조직의 계약을 다시 모두 봅니다.");
}

// ---------- 부관리자 (회장·총무 등 공동 운영) ----------
export async function adminAddAdmin(ctx) {
  const { db, base, assoc, user } = ctx;
  const form = ctx.form;
  const name = cap((form.get("name") || "").trim(), 60);
  const email = cap((form.get("email") || "").toLowerCase().trim(), 120);
  const phone = D.normalizePhone(form.get("phone") || "");
  // 상인회의 '부관리자'는 회장·총무가 공동 운영하는 자리라 예전처럼 관리자 권한이 기본이다.
  // 전자계약 조직은 실무자에게 계정을 주는 자리이므로 담당자(STAFF)가 기본 — 관리자 권한은
  // 일부러 골라야 준다(실수로 API 키·과금까지 열리지 않게). 폼이 role 을 보내면 그것이 우선.
  const picked = form.get("role");
  const role = picked === "ADMIN" ? "ADMIN"
    : picked === "STAFF" ? "STAFF"
    : (assoc.kind === "esign" ? "STAFF" : "ADMIN");
  if (!name || !EMAIL_RE.test(email)) return back(base + "/admin", "이름·이메일을 확인해 주세요.", true);
  if (phone && !D.isValidPhone(phone)) return back(base + "/admin", "휴대폰 번호 형식을 확인해 주세요.", true);
  if (await D.getUserByEmail(db, email)) return back(base + "/admin", "이미 가입된 이메일입니다.", true);
  const temp = tempPassword();
  const { hash, salt } = await hashPassword(temp);
  await D.createUser(db, { email, passwordHash: hash, salt, name, role, associationId: assoc.id, phone });
  await audit(ctx, role === "ADMIN" ? "부관리자추가" : "담당자추가", `${name} (${email}) by ${user.email}`);
  return back(base + "/admin", `부관리자 발급 완료 — ${name}님 로그인: ${email} / 임시비번 ${temp} (전달 후 비밀번호 변경을 안내하세요)`);
}

// ---------- 전자서명 ----------
export async function adminCreateDocument(ctx) {
  const { db, form, base, assoc, user } = ctx;
  const title = cap((form.get("title") || "").trim(), 200);
  // 서식에서 만들기 — 본문의 {{빈칸}} 을 입력값으로 치환하고, 배치까지 그대로 복사한다.
  const tplId = (form.get("template") || "").trim();
  let tpl = null, tplBody = "", tplBase = "", saveTplBody = "", partyMap = [];
  const externalParties = []; // 가입하지 않은 상대방 — 문서를 만든 뒤에 서명자로 등록한다
  if (tplId) {
    const src = isBuiltinId(tplId) ? builtinById(tplId) : await D.getTemplate(db, Number(tplId) || 0);
    if (!src) return back(base + "/admin/documents", "서식을 찾을 수 없습니다.", true);
    if (!isBuiltinId(tplId) && src.association_id !== 0 && src.association_id !== assoc.id)
      return back(base + "/admin/documents", "다른 상인회의 서식은 쓸 수 없습니다.", true);
    tpl = normalizeTemplate(src);
    // 서식 화면에서 본문을 고쳤을 수 있다. 고친 본문이 이 계약의 원문이 된다 —
    // 다만 자리는 서식 본문 기준으로 놓여 있으므로, 아래에서 문단을 따라 옮겨 준다.
    // 칸이 아예 오지 않았으면(옛 화면·JS 없는 브라우저) 서식 본문 그대로 간다.
    const rawEdit = form.get("body");
    const bodySrc = rawEdit == null ? tpl.body : cap(String(rawEdit), 20000);
    // 빈칸은 고친 본문에서 다시 뽑는다 — 고치면서 새로 만든 빈칸도 값이 오면 채워야 한다.
    const vals = {};
    for (const v of new Set([...tpl.vars, ...extractVars(bodySrc)]))
      vals[v] = cap((form.get("var_" + v) || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 200);
    tplBase = applyVars(tpl.body, vals);
    tplBody = applyVars(bodySrc, vals);
    // 우리 서식에 한해, 체크했을 때만 서식 자체도 고친다. 표준 서식과 남의 서식은 건드리지 않는다.
    if (form.get("save_tpl") === "1" && !tpl.builtin && src.association_id === assoc.id && rawEdit != null)
      saveTplBody = cap(String(rawEdit), 20000);
    const members = await D.listSignerCandidates(db, assoc.id, assoc.kind);
    const valid = new Set(members.map((m) => m.id));
    const n = Math.max(1, tpl.parties.length);
    const to = base + "/admin/documents";
    for (let i = 0; i < n; i++) {
      const raw = String(form.get("party_" + i) || "").trim();
      if (raw === "ext") {
        // 가입하지 않은 상대방 — 여기서 받아 두고 문서를 만든 뒤에 서명자로 등록한다
        const name = cap((form.get("ext_name_" + i) || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 60);
        const email = cap((form.get("ext_email_" + i) || "").toLowerCase().trim(), 120);
        const phone = D.normalizePhone(form.get("ext_phone_" + i) || "");
        const org = cap((form.get("ext_org_" + i) || "").trim(), 80);
        if (!name) return back(to, "외부 상대방의 이름을 입력해 주세요.", true);
        if (email && !EMAIL_RE.test(email)) return back(to, "외부 상대방의 이메일 형식을 확인해 주세요.", true);
        if (phone && !D.isValidPhone(phone)) return back(to, "외부 상대방의 휴대폰 번호 형식을 확인해 주세요.", true);
        if (!email && !phone) return back(to, `${name}님께 링크를 보낼 휴대폰 또는 이메일이 필요합니다.`, true);
        externalParties.push({ i, name, email, phone, org });
        partyMap.push(0); // 자리만 잡아 두고, 실제 id 는 만든 뒤에 채운다
        continue;
      }
      const id = Number(raw) || 0;
      if (id && !valid.has(id)) return back(to, "이 조직의 사람만 당사자로 지정할 수 있습니다.", true);
      partyMap.push(id);
    }
    if (!partyMap.some(Boolean) && !externalParties.length) return back(to, "당사자를 한 명 이상 지정해 주세요.", true);
  }
  const body = tpl ? cap(tplBody, 20000) : cap((form.get("body") || "").trim(), 20000);
  // 올린 양식(PDF 를 쪽 그림으로 구운 것)이 함께 왔는가. 그 경우 지면은 그림이므로 본문은 없어도 된다.
  const scanFiles = [];
  for (let i = 0; i < 30; i++) {
    const f = form.get(`scan_${i}`);
    if (!f || typeof f !== "object" || !f.size) break;
    const [sw, sh] = String(form.get(`scan_size_${i}`) || "").split("x").map((v) => parseInt(v, 10) || 0);
    scanFiles.push({ file: f, w: sw, h: sh });
  }
  if (!title) return back(base + "/admin/documents", "제목을 입력하세요.", true);
  if (!body && !scanFiles.length) return back(base + "/admin/documents", "본문을 입력하거나 PDF 양식을 올려 주세요.", true);
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
  // 올린 양식으로 만드는 계약은 **원본 PDF 가 곧 계약 원문**이다. 그림만 남기면
  // 나중에 "그 그림이 원본과 같다"를 증명할 방법이 없다 — 그래서 원본 없이는 만들지 않는다.
  if (scanFiles.length && !attHash) return back(base + "/admin/documents", "PDF 양식으로 만들 때는 원본 PDF 가 함께 올라와야 합니다. 다시 시도해 주세요.", true);
  const docHash = attHash ? await contentHash(`${body}\n--attachment--\n${attHash}`) : await contentHash(body);
  // 계약당 과금이면 문서를 만드는 시점에 한 번 청구한다. 잔액이 없으면 아예 만들지 않는다 —
  // 만들어 두고 발송이 안 되면 상대방은 링크를 못 받고 관리자만 헛일을 한다.
  if ((await billingMode(db)) === "per_doc") {
    const bal = await D.getBalance(db, assoc.id);
    const price = await priceOf(db, "alimtalk", assoc.id);
    if (bal < price) return back(base + "/admin/documents", `크레딧 잔액이 부족합니다. (계약 1건 ${price.toLocaleString()}원 · 잔액 ${bal.toLocaleString()}원)`, true);
  }
  // 정기 작업이 쓸 절대 주소를 여기서 확보해 둔다(크론에는 요청이 없다)
  await rememberOrigin(db, new URL(ctx.request.url).origin);
  const doc = await D.createDocument(db, { associationId: assoc.id, title, body, contentHash: docHash, createdBy: user.id, ordered, dueDate, teamId: user.team_id });
  if ((await billingMode(db)) === "per_doc") await chargeContract(db, assoc, { documentId: doc.id, title });
  if (attKey) await D.setDocumentAttachment(db, doc.id, attKey, attName, attHash);
  if (scanFiles.length) {
    const saved = [];
    for (const s of scanFiles) {
      const bytes = new Uint8Array(await s.file.arrayBuffer());
      saved.push({ media: await storage.save(ctx.env, bytes, "image/jpeg"), w: s.w, h: s.h });
    }
    await D.replaceDocPages(db, doc.id, saved);
  }
  // 서식이면 당사자 지정 순서가 곧 서명 순서이고, 배치는 당사자 → 실제 회원으로 옮겨 붙인다
  if (tpl) {
    // 외부 상대방을 실제 서명자로 등록한다. 필드의 담당자는 음수 id 로 가리킨다(내부 회원과 구분).
    const extLinks = [];
    for (const e of externalParties) {
      const signOrder = await D.nextSignOrder(db, doc.id);
      const signer = await D.addExternalSigner(db, { documentId: doc.id, name: e.name, email: e.email, phone: e.phone, org: e.org, signOrder });
      partyMap[e.i] = -signer.id;
      const token = await makeExtToken(ctx.env.SESSION_SECRET, signer.id, doc.id);
      const via = await sendSignLink(ctx.env, db, { assoc, doc, signer, origin: new URL(ctx.request.url).origin }).catch(() => "");
      extLinks.push({ name: e.name, token, via });
    }
    const signers = partyMap.filter((v) => v > 0);
    await D.createSignatureRequests(db, doc.id, signers);
    // 자리는 서식 본문 위에 놓여 있다. 그래서 먼저 서식 본문 기준으로 확정하고(마지막 쪽·서명란 앵커),
    // 본문을 고쳤으면 그만큼 문단을 따라 옮긴다 — 대량 발송에서 쓰는 것과 같은 방법이다.
    // 이 두 걸음을 건너뛰면 조항 한 줄을 지웠을 때 서명란이 본문 위에 겹쳐 앉는다.
    const edited = body !== tplBase;
    const baseFields = resolveFieldPages(tpl.fields, pageCount(tplBase), tplBase);
    const placed = (edited ? remapFields(tplBase, body, baseFields) : baseFields).map((f) => ({
      kind: f.kind, label: f.label || "", page: f.page,
      x: round4(f.x), y: round4(f.y), w: round4(f.w), h: round4(f.h),
      assignee: partyMap[f.party | 0] || 0, required: f.required ? 1 : 0,
    })).filter((f) => isFieldKind(f.kind) && f.x + f.w <= 1.0001 && f.y + f.h <= 1.0001);
    if (placed.length) await D.replaceFields(db, doc.id, placed);
    // '서식에도 저장' 을 체크했으면 서식 본문을 고친다. 서식의 자리도 함께 옮기되,
    // '마지막 쪽'(page<0)으로 놓인 서명란은 쓸 때마다 본문 끝을 다시 찾아 앉으므로 건드리지 않는다.
    if (saveTplBody && saveTplBody !== tpl.body) {
      const at = [], move = [];
      tpl.fields.forEach((f, i) => { if ((f.page | 0) >= 0) { at.push(i); move.push(f); } });
      const out = tpl.fields.slice();
      if (move.length) remapFields(tpl.body, saveTplBody, move).forEach((f, k) => { out[at[k]] = f; });
      await D.updateTemplateBody(db, tpl.id, assoc.id, saveTplBody, JSON.stringify(out));
      await audit(ctx, "서식수정", `${tpl.title} (계약서 만들면서 함께 저장)`);
    }
    const recips = (await D.listSignerCandidates(db, assoc.id, assoc.kind)).filter((m) => signers.includes(m.id));
    if (extLinks.length) {
      const sentN = extLinks.filter((x) => x.via).length;
      const note = sentN === extLinks.length
        ? `상대방 ${extLinks.length}명에게 서명 링크를 보냈습니다.`
        : `상대방 ${extLinks.length}명 중 ${sentN}명에게 보냈습니다 — 나머지는 아래에서 링크를 복사해 직접 전달해 주세요.`;
      await D.logDocEvent(db, { documentId: doc.id, userId: user.id, actorName: user.name, kind: "created", detail: `서식: ${tpl.title}`, ip: ctx.ip || "", userAgent: uaOf(ctx) });
      await audit(ctx, "서명문서생성", `${title} (서식: ${tpl.title})`);
      return redirect(`${base}/admin/documents/${doc.id}?msg=${encodeURIComponent(note)}`);
    }
    await D.logDocEvent(db, { documentId: doc.id, userId: user.id, actorName: user.name, kind: "created", detail: `서식: ${tpl.title}`, ip: ctx.ip || "", userAgent: uaOf(ctx) });
    await notifyNewDocument(ctx, doc, title, dueDate, ordered, recips);
    await audit(ctx, "서명문서생성", `${title} (서식: ${tpl.title})`);
    // 상담 건에서 시작한 계약이면 상세 화면으로 보내 상대방(신청자)을 바로 서명자로 넣게 한다
    const leadId = Number(form.get("lead_id")) || 0;
    if (leadId) return redirect(`${base}/admin/documents/${doc.id}?lead=${leadId}&msg=${encodeURIComponent("계약서를 만들었습니다. 아래에서 서명 링크를 발급해 보내세요.")}`);
    return redirect(`${base}/admin/documents/${doc.id}/fields?msg=${encodeURIComponent("서식으로 문서를 만들었습니다. 서명 자리를 확인하고 저장하세요.")}`);
  }
  const target = form.get("target");
  const members = await D.listSignerCandidates(db, assoc.id, assoc.kind);
  let recipients = [];
  if (target === "all") { recipients = members; await D.createSignatureRequests(db, doc.id, members.map((m) => m.id)); }
  else if (target === "select") { const valid = new Map(members.map((m) => [m.id, m])); const chosen = form.getAll("members").map(Number).filter((id) => valid.has(id)); recipients = chosen.map((id) => valid.get(id)); await D.createSignatureRequests(db, doc.id, chosen); }
  await D.logDocEvent(db, { documentId: doc.id, userId: user.id, actorName: user.name, kind: "created", ip: ctx.ip || "", userAgent: uaOf(ctx) });
  await notifyNewDocument(ctx, doc, title, dueDate, ordered, recipients);
  await audit(ctx, "서명문서생성", title);
  // 목록이 아니라 그 문서로 보낸다 — 서명 링크와 현황이 거기 있다.
  // 알림톡이 꺼져 있으면 관리자가 직접 링크를 전달해야 하므로, 어디로 가야 하는지가 특히 중요하다.
  const note = canAutoSend(ctx.env, assoc)
    ? ordered ? "순차 서명 문서를 만들었습니다." : "문서를 만들었습니다."
    : "문서를 만들었습니다. 아래 [보내기 · 복사] 로 서명 링크를 전달해 주세요.";
  return redirect(`${base}/admin/documents/${doc.id}?msg=${encodeURIComponent(note)}`);
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
  if (webhook) {
    const chk = checkWebhookUrl(webhook, new URL(ctx.request.url).origin);
    if (!chk.ok) return back(to, `웹훅 주소를 확인해 주세요 — ${chk.why}`, true);
  }
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
  if (url) {
    const chk = checkWebhookUrl(url, new URL(ctx.request.url).origin);
    if (!chk.ok) return back(to, `웹훅 주소를 확인해 주세요 — ${chk.why}`, true);
  }
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
      await sendEmailFor(env, db, assoc, { kind: "sign_done", to: signer.email, subject: `[${assoc.name}] 전자서명 완료 — ${d.title}`,
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
  if (hasPhone && canAutoSend(env, assoc)) {
    const r = await sendOne(env, db, { assoc, kind: "sign_otp", to: signer.phone, text: msg });
    if (r.ok) via = `${D.maskPhone(signer.phone)} 으로 알림톡을`;
    else if (r.insufficient) { await D.clearExtOtp(db, signer.id); return back(to, "발송 크레딧이 부족해 인증번호를 보내지 못했습니다. 요청하신 분께 문의해 주세요.", true); }
  }
  if (!via && emailEnabled(env) && signer.email) {
    await sendEmailFor(env, db, assoc, { kind: "sign_otp", to: signer.email, subject: `[${assoc.name}] 전자서명 본인확인 번호`,
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
  const d = await docOf(ctx, params.id);
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
  // 연락처는 '자동 발송'에만 필요하다. 링크를 손으로 전달하겠다는 관리자에게까지 강제하면,
  // 알림톡 심사가 끝나기 전에는 계약을 한 건도 보낼 수 없게 된다.
  // 다만 본인확인(OTP)이 켜져 있으면 인증번호를 보낼 곳이 있어야 하므로 그때는 받는다.
  if (!email && !phone && (await otpRequired(db)))
    return back(to, "본인확인이 켜져 있어 이메일 또는 휴대폰 중 하나가 필요합니다. (설정에서 본인확인을 끄면 링크만으로 서명할 수 있습니다)", true);
  if ((await D.listExternalSigners(db, d.id)).length >= 20) return back(to, "외부 서명자는 최대 20명까지 추가할 수 있습니다.", true);

  const signOrder = await D.nextSignOrder(db, d.id);
  const signer = await D.addExternalSigner(db, { documentId: d.id, name, email, phone, org, signOrder });
  const token = await makeExtToken(env.SESSION_SECRET, signer.id, d.id);
  const link = extSignUrl(new URL(request.url).origin, token);

  const via = await sendSignLink(env, db, { assoc, doc: d, signer, origin: new URL(request.url).origin });
  const sent = via === "alimtalk" ? "알림톡을 보냈습니다." : via === "email" ? "이메일을 보냈습니다." : "";
  await audit(ctx, "외부서명자추가", `${d.title}: ${name}`);
  return redirect(`${to}?extlink=${encodeURIComponent(token)}&msg=${encodeURIComponent(`${name}님을 추가했습니다. ${sent || "아래 [보내기 · 복사] 로 링크를 전달해 주세요."}`)}`);
}

export async function adminRemoveExternalSigner(ctx) {
  const { db, base, assoc, params } = ctx;
  const d = await docOf(ctx, params.id);
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
  if (!(await D.canReceiveSign(db, d.id, user.id, user.role))) return back(base + "/sign", "이 문서의 서명 대상이 아닙니다.", true);
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
    await sendEmailFor(env, db, assoc, { kind: "sign_otp", to: user.email, subject: `[${assoc.name}] 전자서명 본인확인 번호`,
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
  if (!(await D.canReceiveSign(db, d.id, user.id, user.role))) return back(base + "/sign", "이 문서의 서명 대상이 아닙니다.", true);
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
  const d = await docOf(ctx, params.id);
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
  const canTalk = canAutoSend(env, assoc);
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
    await Promise.all(noPhone.map((m) => sendEmailFor(env, db, assoc, {
      kind: "sign_remind", to: m.email, subject: `[${assoc.name}] 전자서명 미완료 안내 — ${d.title}`,
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
  const d = await docOf(ctx, params.id);
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

  // 본문이 짧아져 쪽수가 줄면 배치해 둔 필드가 없는 쪽에 남는다 — 마지막 쪽으로 끌어온다.
  // 올린 양식 문서는 본문을 아무리 고쳐도 지면(그림) 쪽 수가 그대로이므로 끌어오지 않는다.
  let moved = 0;
  const fieldN = await D.countFields(db, d.id);
  if (fieldN) {
    const last = (await docPageCount(db, d)) - 1;
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
  const d = await docOf(ctx, params.id);
  // 남의 조직 문서는 애초에 손대지 못하지만, 그때 "마감했습니다"라고 답하면 안 된다 —
  // 아무 일도 하지 않고 성공을 보고하는 것은 그 자체로 결함이고, 탐색자에게 힌트도 된다.
  if (!d || d.association_id !== assoc.id) return back(base + "/admin/documents", "문서를 찾을 수 없습니다.", true);
  if (d.closed) return back(base + "/admin/documents", "이미 마감된 문서입니다.", true);
  await D.closeDocument(db, d.id);
  await audit(ctx, "서명문서마감", d.title);
  return back(base + "/admin/documents", "문서를 마감했습니다.");
}
// 서명 요청 안내 — 실패해도 문서 생성 자체는 유효하므로 되돌리지 않는다.
//
// ⚠️ 예전에는 이 함수가 이메일만 보냈다. 제품에서 이메일을 뺀 뒤로는 사내 회원이 서명 대상이 돼도
//    아무 통보를 못 받았다 — 다음 날 기한 임박 리마인더(크론)가 돌 때까지 문서가 있는 줄도 몰랐다.
//    휴대폰이 있으면 심사받은 sign_request 템플릿으로 알림톡을 먼저 보낸다.
//    알림톡이 꺼져 있으면 아무것도 보내지 않는다 — 대신 관리자가 문서 화면에서 링크를 직접 전달한다.
async function notifyNewDocument(ctx, doc, title, dueDate, ordered, recipients) {
  if (!recipients || !recipients.length) return;
  const { assoc, base } = ctx;
  const origin = new URL(ctx.request.url).origin;
  const byPhone = recipients.filter((m) => D.isValidPhone(m.phone || ""));
  if (byPhone.length && canAutoSend(ctx.env, assoc)) {
    await sendMany(ctx.env, ctx.db, {
      assoc, kind: "sign_request", recipients: byPhone,
      textFor: (m) => renderTemplate("sign_request", {
        상호: assoc.name, 이름: m.name, 문서명: title, 기한: dueDate || "미지정",
      }),
      buttonName: templateButton("sign_request"), buttonUrl: `${origin}${base}/sign`,
    }).catch(() => {});
  }
  if (!emailEnabled(ctx.env)) return;
  await Promise.all(recipients.filter((m) => m.email).map((m) => sendEmailFor(ctx.env, ctx.db, assoc, {
    kind: "sign_request", to: m.email,
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
  const d = await docOf(ctx, form.get("document"));
  if (!title) return back(to, "서식 이름을 입력하세요.", true);
  if (!d || d.association_id !== assoc.id) return back(to, "원본 문서를 찾을 수 없습니다.", true);
  if (await D.countTemplates(db, assoc.id) >= 50) return back(to, "서식은 최대 50개까지 저장할 수 있습니다.", true);
  // 올린 양식(PDF 를 구운 그림이 지면인 문서)은 서식으로 못 만든다 — 서식은 본문 글을 다시 조판해
  // 지면을 만드는데, 이 문서의 지면은 그림이라 본문이 비어 있다. 저장해 두면 다음번에
  // 서명 자리만 떠 있는 빈 종이가 나온다. 되는 척하느니 여기서 막는 게 낫다.
  if (await D.countDocPages(db, d.id)) {
    return back(to, "올린 양식으로 만든 계약서는 서식으로 저장할 수 없습니다. 같은 양식을 또 쓰시려면 그 PDF 를 다시 올려 주세요.", true);
  }
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

// 이 문서의 지면이 몇 쪽인가.
//
// ⚠️ 본문 길이로만 재면 안 된다. 올린 양식(PDF 를 쪽 그림으로 구운 문서)은 본문이 비어 있어
//    pageCount("") = 1 이 나오고, 그러면 2쪽 이후에 놓은 서명 자리가 통째로 '지면 밖' 으로
//    거부된다. 그림이 지면인 문서는 그림 쪽 수가 진짜 쪽 수다.
const docPageCount = async (db, doc) => (await D.countDocPages(db, doc.id)) || pageCount(doc.body);

// 계약서 필드 배치 저장 — 편집기가 보낸 좌표 묶음을 통째로 교체한다.
// 서명이 하나라도 시작되면 잠근다: 서명자가 확인한 지면이 사후에 바뀌면 봉인의 의미가 사라진다.
const MAX_FIELDS = 200;
// 한 계약서의 당사자 수 상한. 서명자 20명까지 받지만, '몇 번째 당사자' 로 눈으로 배치하는 건
// 이 정도가 한계다 — 그 이상은 보낸 뒤 사람 이름으로 지정하는 편이 헷갈리지 않는다.
export const MAX_SLOTS = 8;
export async function adminSaveFields(ctx) {
  const { db, form, base, assoc, params } = ctx;
  const d = await docOf(ctx, params.id);
  if (!d || d.association_id !== assoc.id) return back(base + "/admin/documents", "문서를 찾을 수 없습니다.", true);
  const to = `${base}/admin/documents/${d.id}/fields`;
  if ((await D.listSignatures(db, d.id)).length) return back(to, "이미 서명이 시작된 문서는 배치를 바꿀 수 없습니다.", true);
  let raw;
  try { raw = JSON.parse(form.get("fields") || "[]"); } catch { return back(to, "배치 데이터를 읽을 수 없습니다.", true); }
  if (!Array.isArray(raw)) return back(to, "배치 데이터 형식이 올바르지 않습니다.", true);
  if (raw.length > MAX_FIELDS) return back(to, `필드는 최대 ${MAX_FIELDS}개까지 놓을 수 있습니다.`, true);
  const pages = await docPageCount(db, d);
  // 담당자로 지정할 수 있는 사람은 이 문서의 서명 대상뿐 (엉뚱한 회원을 지정해 지면을 오염시키는 것 차단)
  const allowed = new Set((await D.listRequestStatus(db, d.id)).map((r) => r.id));
  for (const e of await D.listExternalSigners(db, d.id)) allowed.add(-e.id); // 외부 서명자는 음수
  const fields = [];
  for (const f of raw) {
    if (!f || !isFieldKind(f.kind)) return back(to, "알 수 없는 필드 종류가 있습니다.", true);
    const page = Number(f.page) | 0;
    if (page < 0 || page >= pages) return back(to, "필드가 문서 범위를 벗어났습니다.", true);
    // 담당자는 사람(숫자) 이거나 자리(slotN) 다. 자리는 보내기 전 초안에서만 쓸 수 있다 —
    // 이미 보낸 계약서에 자리를 넣으면 아무도 채울 수 없는 칸이 남는다.
    // 우리 직인 자리는 사람이 채우지 않는다 — 도장 자리에만 지정할 수 있다.
    const auto = f.auto === "seal" ? "seal" : "";
    if (auto && f.kind !== "stamp") return back(to, "직인은 도장 자리에만 찍을 수 있습니다.", true);
    const slotM = /^slot([1-9]\d?)$/.exec(String(f.assignee ?? ""));
    let assignee = 0, slot = 0;
    if (auto) {
      // 직인 자리는 담당자가 없다 — 이미 우리가 찍은 자리다
    } else if (slotM) {
      if (!d.draft) return back(to, "이미 보낸 계약서에는 '몇 번째 당사자' 로 지정할 수 없습니다. 사람을 직접 고르세요.", true);
      slot = Number(slotM[1]);
      if (slot > MAX_SLOTS) return back(to, `당사자는 ${MAX_SLOTS}명까지 지정할 수 있습니다.`, true);
    } else {
      assignee = Number(f.assignee) | 0;
      if (assignee && !allowed.has(assignee)) return back(to, "서명 대상이 아닌 담당자가 지정되었습니다.", true);
    }
    const x = round4(f.x), y = round4(f.y);
    const w = Math.max(0.01, round4(f.w)), h = Math.max(0.008, round4(f.h));
    if (x + w > 1.0001 || y + h > 1.0001) return back(to, "필드가 지면 밖으로 나갔습니다. 위치를 조정해 주세요.", true);
    fields.push({ kind: f.kind, label: cap(String(f.label || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 20),
      page, x, y, w, h, assignee, slot, auto, required: f.required ? 1 : 0 });
  }
  const n = await D.replaceFields(db, d.id, fields);

  // 당사자 자리의 이름 (임대인·임차인·갑·을). 쓰이지 않는 자리의 이름은 버린다 —
  // 자리를 지웠는데 이름만 남아 다음 화면에서 없는 당사자가 되살아나면 안 된다.
  let names = {};
  try { names = JSON.parse(form.get("parties") || "{}") || {}; } catch { names = {}; }
  const used = new Set(fields.map((f) => f.slot).filter(Boolean));
  const keep = {};
  for (const [k, v] of Object.entries(names)) {
    const slot = Number(k) | 0;
    if (slot < 1 || slot > MAX_SLOTS || !used.has(slot)) continue;
    const name = cap(String(v || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 20);
    if (name) keep[slot] = name;
  }
  await D.replaceDocParties(db, d.id, keep);

  // 배치를 저장하면 필드가 통째로 새로 만들어지므로 찍어 둔 직인도 함께 사라진다 — 여기서 다시 찍는다.
  const sealed = await applySeal(ctx, d);
  const note = sealed > 0 ? ` 우리 직인 ${sealed}곳을 찍었습니다.`
    : sealed < 0 ? " 직인 자리를 놓았지만 등록된 직인이 없습니다 — 문서 목록 화면에서 직인을 올려 주세요." : "";
  return back(to, (n ? `${n}개 필드를 배치했습니다.` : "배치를 모두 지웠습니다.") + note, sealed < 0);
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
// 첨부로 받을 수 있는 것 — 사업자등록증·통장사본·신분증이 대부분이다.
// 실행 파일이나 문서 매크로가 섞이면 그걸 여는 사람이 위험해지므로, 그림과 PDF 만 받는다.
const ATTACH_MAX = 10 * 1024 * 1024;
const isPdfBytes = (b) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

async function applyFieldValues(ctx, doc, fields, rawJson) {
  const { db, env, user, form } = ctx;
  let raw = {};
  try { raw = JSON.parse(rawJson || "{}") || {}; } catch { return { error: "입력값을 읽을 수 없습니다." }; }
  const staged = [];
  for (const f of fields) {
    const v = raw[String(f.id)];
    const label = f.label || (FIELD_KINDS[f.kind] || {}).label || "항목";
    if (f.kind === "file") {
      // 파일은 JSON 에 실어 보내지 않는다 — 10MB 를 base64 로 부풀리면 본문이 13MB 가 된다.
      // 폼 안의 <input type=file> 로 그대로 온다.
      const up = form && form.get(`file_${f.id}`);
      if (!up || typeof up.arrayBuffer !== "function" || !up.size) {
        if (f.required) return { error: `'${label}' 파일을 올려 주세요.` };
        continue;
      }
      if (up.size > ATTACH_MAX) return { error: `'${label}' 파일이 큽니다. (최대 10MB)` };
      const bytes = new Uint8Array(await up.arrayBuffer());
      const type = sniffImage(bytes) || (isPdfBytes(bytes) ? "application/pdf" : "");
      if (!type) return { error: `'${label}' 은 이미지 또는 PDF 파일만 올릴 수 있습니다.` };
      staged.push({ f, bytes, type, name: cap(String(up.name || "첨부").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_"), 80) });
      continue;
    }
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
      const key = storage.enabled(env) ? await storage.save(env, st.bytes, st.type || "image/png") : "";
      const hash = await sha256HexBytes(st.bytes);
      // 첨부는 파일 이름도 함께 남긴다 — '사업자등록증.pdf' 인지 '통장사본.jpg' 인지가 증적에서 중요하다.
      // 이름과 해시가 모두 봉인에 들어가므로, 나중에 다른 파일로 바꿔치기하면 드러난다.
      await D.setFieldValue(db, { fieldId: st.f.id, documentId: doc.id, userId: user.id,
        value: st.name || "", image: key, imageHash: hash });
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
  if (!(await D.canReceiveSign(db, d.id, user.id, user.role))) return back(base + "/sign", "이 문서의 서명 대상이 아닙니다.", true);
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
      await sendEmailFor(env, db, assoc, { kind: "sign_done", to: user.email, subject: `[${assoc.name}] 전자서명 완료 — ${d.title}`,
        html: mailShell(`${esc(assoc.name)} 전자서명 완료`,
          `<p>${esc(signerName)}님, '<b>${esc(d.title)}</b>' 전자서명이 완료되었습니다.</p>
           <p>검증 코드: <b>${esc(verifyCode)}</b></p>${mailButton(certUrl, "전자서명 확인서 보기")}
           <p style="font-size:12px;color:#888">이 확인서는 서명자·시각·문서해시를 전자서명으로 봉인한 기록입니다. 분쟁 시 증빙으로 쓸 수 있습니다.</p>`) });
    }
  } catch {}
  return back(base + "/sign", `전자서명이 완료되었습니다. 검증 코드: ${verifyCode} — 확인서를 보내드렸습니다.`);
}

// ---------- 슈퍼관리자 ----------
// ================= 전자계약 셀프 가입 =================
// 영업 없이 스스로 시작하게 한다. 다만 조직이 마구 생기면 정리가 안 되므로:
//  · 캡차(Turnstile 설정 시) · 하루 생성 상한 · 예약어 차단 · 슈퍼가 언제든 끌 수 있음
// 발송(=돈)은 크레딧 충전 승인을 거치므로, 가입만으로 비용이 새지는 않는다.
export const selfSignupOn = async (db) => (await D.getSetting(db, "esign_self_signup")) !== "0";
const SIGNUP_DAILY_MAX = 20;
// 다른 경로와 충돌하거나 오해를 부르는 주소는 조직 주소로 내주지 않는다
const RESERVED_SLUGS = new Set([
  "admin", "super", "api", "esign", "login", "logout", "register", "account", "setup",
  "apply", "verify", "certificate", "sign", "documents", "t", "www", "static", "assets",
  "terms", "privacy", "sitemap", "robots", "feed", "well-known", "media", "img", "css", "js",
]);

export async function esignSignup(ctx) {
  const { db, env, form, ip, request, addCookie, isProd } = ctx;
  const to = "/esign/signup";
  if (!(await selfSignupOn(db))) return back(to, "지금은 셀프 가입을 받지 않습니다. 도입 문의로 연락 주세요.", true);
  if (!(await turnstileVerify(env, form.get("cf-turnstile-response"), ip)))
    return back(to, "봇 확인에 실패했습니다. 다시 시도해 주세요.", true);

  const name = cap((form.get("name") || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 100);
  const adminName = cap((form.get("admin_name") || "").trim(), 60) || "관리자";
  const email = cap((form.get("email") || "").toLowerCase().trim(), 120);
  const password = form.get("password") || "";
  const phone = D.normalizePhone(form.get("phone") || "");
  if (!name) return back(to, "조직 이름을 입력해 주세요.", true);
  if (!EMAIL_RE.test(email)) return back(to, "이메일 형식을 확인해 주세요.", true);
  if (password.length < 8 || password.length > 200) return back(to, "비밀번호는 8자 이상이어야 합니다.", true);
  if (phone && !D.isValidPhone(phone)) return back(to, "휴대폰 번호 형식을 확인해 주세요.", true);
  if (form.get("agree") !== "1") return back(to, "약관·개인정보처리방침 동의가 필요합니다.", true);
  if (await D.getUserByEmail(db, email)) return back(to, "이미 사용 중인 이메일입니다. 로그인해 주세요.", true);

  // 하루 상한 — 스크립트가 조직을 쏟아붓는 것을 막는다
  const today = (await D.countAssociationsSince(db, "-1 day"));
  if (today >= SIGNUP_DAILY_MAX) return back(to, "오늘 가입이 많아 잠시 후 다시 시도해 주세요. 급하시면 도입 문의로 연락 주세요.", true);

  let base = slugify(name) || "esign";
  if (RESERVED_SLUGS.has(base)) base = base + "-co";
  let slug = base, n = 1;
  while (await D.getAssociationBySlug(db, slug)) slug = `${base}-${++n}`;

  const assoc = await D.createAssociation(db, { slug, name, kind: "esign",
    tagline: "종이 없이, 만나지 않고, 법적 효력 있는 계약" });
  const { hash, salt } = await hashPassword(password);
  const user = await D.createUser(db, { email, passwordHash: hash, salt, name: adminName, role: "ADMIN", associationId: assoc.id, phone });

  // 체험 크레딧 (기본 0 — 슈퍼가 원하면 켠다). 0 이면 이메일 발송만 되고 알림톡은 충전 후.
  const trial = parseInt((await D.getSetting(db, "esign_trial_credit")) || "0", 10);
  if (trial > 0) await D.addCredit(db, assoc.id, trial, { kind: "charge", memo: "가입 체험 크레딧" });

  await D.createNotification(db, { associationId: null, kind: "signup",
    message: `전자계약 셀프 가입: ${name} (${email})`, link: "/super" });
  await D.logAudit(db, { associationId: assoc.id, userId: user.id, actorName: adminName,
    action: "셀프가입", detail: `${name} (/t/${slug})` });

  // 바로 로그인시켜 준다 — 가입하고 다시 로그인하게 만들면 절반이 떨어져 나간다
  const token = await sessionTokenForUser(user, env.SESSION_SECRET);
  addCookie(sessionCookie(token, isProd));

  try {
    if (emailEnabled(env)) {
      const origin = new URL(request.url).origin;
      await sendEmail(env, { to: email, subject: `[${name}] 전자계약 시작하기`,
        html: mailShell("전자계약을 시작하셨습니다", `<p>${esc(adminName)}님, ${esc(name)} 전자계약 공간이 준비되었습니다.</p>
          <p>주소: <b>${esc(origin)}/t/${esc(slug)}</b></p>
          ${mailButton(`${origin}/t/${slug}/admin/documents`, "첫 계약서 만들기")}
          <p style="font-size:12px;color:#888">표준 서식(임대차·용역·비밀유지·동의서)이 준비되어 있어 빈칸만 채우면 바로 보내실 수 있습니다.</p>`) }).catch(() => {});
    }
  } catch {}
  return redirect(`/t/${slug}/admin/documents?msg=${encodeURIComponent("환영합니다! 서식을 고르면 첫 계약서를 바로 만들 수 있습니다.")}`);
}

// 슈퍼: 셀프 가입 켜기/끄기 + 체험 크레딧
export async function superSignupSettings(ctx) {
  const { db, form } = ctx;
  const on = form.get("self_signup") === "1";
  await D.setSetting(db, "esign_self_signup", on ? "1" : "0");
  const trial = Math.max(0, Math.min(100000, parseInt(form.get("trial_credit") || "0", 10) || 0));
  await D.setSetting(db, "esign_trial_credit", String(trial));
  await audit(ctx, "셀프가입설정", `${on ? "허용" : "차단"} · 체험 ${trial.toLocaleString()}원`, null);
  return back("/super", "셀프 가입 설정을 저장했습니다.");
}

export async function superCreateAssociation(ctx) {
  const { db, form } = ctx;
  const name = cap((form.get("name") || "").trim(), 100);
  const adminEmail = cap((form.get("admin_email") || "").toLowerCase().trim(), 120);
  const adminPassword = form.get("admin_password") || "";
  if (!name || !EMAIL_RE.test(adminEmail) || adminPassword.length < 8 || adminPassword.length > 200) return back("/super", "상인회 이름과 관리자 계정을 확인하세요. (비밀번호 8~200자)", true);
  if (await D.getUserByEmail(db, adminEmail)) return back("/super", "이미 사용 중인 관리자 이메일입니다.", true);
  const color = /^#[0-9a-fA-F]{6}$/.test(form.get("brand_color") || "") ? form.get("brand_color") : "#0b6e4f";
  const kind = D.normalizeKind(form.get("kind"));
  const preset = D.normalizePreset(form.get("preset"));
  // 고유 slug
  let slug = slugify(name), n = 1;
  while (await D.getAssociationBySlug(db, slug)) slug = slugify(name) + "-" + (++n);
  const assoc = await D.createAssociation(db, { slug, name, brandColor: color, kind,
    preset, tagline: cap(form.get("tagline"), 200) || taglineFor(kind, preset) });
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
  if (!a) return back(superBackTo(ctx), "상인회를 찾을 수 없습니다.", true);
  const r = await seedDemo(env, db, a);
  await audit(ctx, "데모콘텐츠", `${a.name} — 점포 ${r.businesses}곳·공지 ${r.notices}건·행사 ${r.events}건·서명문서 ${r.documents}건`, a.id);
  return back(superBackTo(ctx), `'${a.name}' 에 데모 콘텐츠를 채웠습니다. 점포 ${r.businesses}곳 · 메뉴 ${r.products}개 · 공지 ${r.notices}건 · 행사 ${r.events}건 · 전자서명 문서 ${r.documents}건(서명 ${r.signatures}명). 사장님 데모 계정 ${r.ownerEmail} / 비밀번호 ${r.password} (시연 후 반드시 변경하세요)`);
}

export async function superToggleAssociation(ctx) {
  const { db, params } = ctx;
  const a = await D.getAssociationById(db, Number(params.id));
  if (!a) return back(superBackTo(ctx), "상인회를 찾을 수 없습니다.", true);
  await D.setAssociationActive(db, a.id, a.active ? 0 : 1);
  await audit(ctx, "상인회상태", `${a.name} → ${a.active ? "비활성" : "활성"}`, null);
  return back(superBackTo(ctx), `'${a.name}' 상태를 변경했습니다.`);
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
  // 문의는 남는 곳이 있어야 한다.
  //
  // 예전에는 알림함에 한 줄만 남겼다. 회장님이 그 줄을 한 번 읽고 지나가면 그 문의는
  // 사실상 사라졌다 — 누가 물었는지, 답을 했는지, 언제 왔는지를 나중에 알 방법이 없었다.
  // 모집 랜딩의 상담 표(leads)와 담기는 값이 같아서 그 표를 함께 쓴다. source 로 갈린다.
  //
  // '연락처' 한 칸으로 받으므로 @ 가 있으면 이메일, 아니면 전화로 넣는다.
  const isMail = contact.includes("@");
  await D.createLead(db, {
    associationId: assoc.id, name, message, source: "contact",
    phone: isMail ? "" : contact, email: isMail ? contact : "",
  }).catch(() => {}); // 표에 못 넣어도 아래 알림·메일은 나가야 한다
  await D.createNotification(db, { associationId: assoc.id, kind: "contact", message: `[문의] ${name} (${contact}): ${cap(message, 200)}`, link: base + "/admin#s-inbox" });
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
// ---------- 사장님 사진 요청 링크 ----------
//
// 사진을 모으는 유일하게 깨끗한 길이다. 지도에서 긁어 오는 것은 남의 저작물이고, 웹 이미지
// 검색은 그 가게 사진이 아니다. **사장님이 자기 사진을 올리는 것**만 문제가 없다.
//
// 그런데 사장님께 "로그인해서 올려 주세요" 라고 하면 거기서 끊긴다 — 아이디를 잊었거나,
// 비밀번호를 못 찾거나, 그냥 귀찮다. 그래서 **로그인 없이 링크 하나로** 올리게 한다.
// 회장님이 카톡으로 링크를 보내면, 사장님은 폰에서 열어 사진을 고르고 보내면 끝이다.
//
// 그 대신 이 링크로 할 수 있는 일은 **그 가게에 사진을 올리는 것 하나뿐**이다.
// 남의 가게도, 글 수정도, 기존 사진 삭제도 안 된다. 링크가 새어 나가도 잃을 것이 적어야 한다.
const PHOTO_TTL_MS = 14 * 24 * 60 * 60 * 1000;   // 2주 — 카톡으로 받은 뒤 주말에 올리는 분이 많다
export async function makePhotoToken(secret, assocId, bizId) {
  const json = JSON.stringify({ a: assocId, b: bizId, x: Date.now() + PHOTO_TTL_MS });
  const sig = await hmacSign(secret, "photo|" + json);
  return `${b64uFromBytes(new TextEncoder().encode(json))}.${sig}`;
}
export async function verifyPhotoToken(secret, token, assocId) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  let raw;
  try { raw = new TextDecoder().decode(bytesFromB64u(parts[0])); } catch { return null; }
  // 서명 문맥이 "photo|" 다 — 초대 링크 토큰을 사진 링크로 돌려 쓸 수 없다.
  if (!(await hmacVerify(secret, "photo|" + raw, parts[1]))) return null;
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || data.a !== assocId || !data.b || !data.x || Date.now() > data.x) return null;
  return data;
}

export async function adminCreatePhotoLink(ctx) {
  const { db, env, base, assoc } = ctx;
  const b = await D.getBusinessById(db, Number(ctx.params.id) || 0);
  if (!b || b.association_id !== assoc.id) return back(`${base}/admin`, "업체를 찾을 수 없습니다.", true);
  const token = await makePhotoToken(env.SESSION_SECRET, assoc.id, b.id);
  await audit(ctx, "사진요청링크생성", b.name);
  return redirect(`${base}/admin/business/${b.id}?photolink=${encodeURIComponent(token)}#p-photos`);
}

// 사장님이 링크를 열고 사진을 보낸다. 로그인 없음 — 토큰이 곧 권한이다.
export async function ownerPhotoUpload(ctx) {
  const { db, env, form, assoc, ip } = ctx;
  const token = String(form.get("token") || "");
  const at = (m, bad) => back(`${ctx.base}/photos/${encodeURIComponent(token)}`, m, bad);
  if (rateLimited(ip)) return at("잠시 후 다시 시도해 주세요.", true);
  const t = await verifyPhotoToken(env.SESSION_SECRET, token, assoc.id);
  if (!t) { recordFail(ip); return at("링크가 만료되었습니다. 상인회에 새 링크를 요청해 주세요.", true); }
  const b = await D.getBusinessById(db, t.b);
  if (!b || b.association_id !== assoc.id) return at("가게를 찾을 수 없습니다.", true);

  const plan = planOf(assoc);
  const have = await D.countBusinessImages(db, b.id);
  if (have >= plan.maxPhotos) return at(`사진이 이미 가득 찼습니다 (${plan.maxPhotos}장). 상인회에 문의해 주세요.`, true);
  const room = plan.maxPhotos - have;
  const up = await saveImages(env, form.getAll("files"), Math.min(room, 10));
  if (up.error) return at(up.error, true);
  if (!up.images.length) return at("사진을 한 장 이상 골라 주세요.", true);
  for (const im of up.images)
    await D.addMedia(db, { businessId: b.id, kind: "image", filename: im.filename, size: im.size });
  // 회장님이 "보냈다" 를 알아야 다음 가게로 넘어간다
  await D.createNotification(db, { associationId: assoc.id, kind: "new_media",
    message: `'${b.name}' 사장님이 사진 ${up.images.length}장을 보내 주셨습니다.`,
    link: `${ctx.base}/admin/business/${b.id}` });
  return redirect(`${ctx.base}/photos/${encodeURIComponent(token)}?done=${up.images.length}`);
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
  if (ctx.assoc && ctx.assoc.kind === "esign") return back(ctx.base + "/", "이 조직은 점포 가입을 받지 않습니다.", true);
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

// 재설정 메일은 같은 주소로 이 시간 안에 두 번 나가지 않는다.
//
// 왜 막는가: 계정 열거는 이미 막혀 있지만(있든 없든 같은 안내), **횟수**가 안 막히면 두 가지가 터진다.
//   ① 남의 메일함을 재설정 메일로 채울 수 있다.
//   ② 우리 발송 한도를 태운다. 알림톡 심사가 끝나기 전까지 이메일이 유일한 발송 수단이라,
//      한도가 마르면 전 조직의 계약 서명 링크가 함께 멈춘다.
const RESET_COOLDOWN_MIN = 10;

export async function forgotPassword(ctx) {
  const { db, env, form, request, ip } = ctx;
  const email = (form.get("email") || "").toLowerCase().trim();
  const SAME = "가입된 이메일이라면 재설정 링크를 보냈습니다. 메일함을 확인해 주세요.";
  // 한 곳에서 쏟아붓는 것부터 막는다. 로그인과 같은 장치를 쓴다(isolate 로컬 · best-effort).
  if (rateLimited(ip)) return back("/forgot", SAME);
  recordFail(ip);
  const user = email ? await D.getUserByEmail(db, email) : null;
  // 이메일 설정 시: 재설정 링크 자동 발송 (존재 여부 무관 동일 안내 = 계정 열거 방지)
  if (emailEnabled(env)) {
    if (user) {
      // 주소 자체가 아니라 해시 꼬리표로 센다 — 발송 이력에 원본 주소를 남기지 않기 위함이다.
      const tag = (await sha256Hex(`reset|${email}`)).slice(0, 16);
      if (!(await D.recentMailByTag(db, tag, RESET_COOLDOWN_MIN))) {
        const token = await makeResetToken(env.SESSION_SECRET, email);
        const origin = new URL(request.url).origin;
        const link = `${origin}/reset?token=${encodeURIComponent(token)}`;
        // sendEmailFor 를 거쳐야 하루 상한에 함께 잡히고 발송 이력에도 남는다.
        // 예전에는 sendEmail 을 직접 불러 상한 밖에서 무제한으로 나갔다.
        const assocOf = user.association_id ? await D.getAssociationById(db, user.association_id) : null;
        await sendEmailFor(env, db, assocOf, {
          to: email, kind: "password_reset", tag,
          subject: "비밀번호 재설정 안내",
          html: mailShell("비밀번호 재설정", `<p>아래 버튼을 눌러 새 비밀번호를 설정하세요. 링크는 <b>1시간</b> 동안만 유효합니다.</p>${mailButton(link, "새 비밀번호 설정")}`),
        }).catch(() => {});
      }
    }
    return back("/forgot", SAME);
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
// ---------- 상인회 홈 A/B ----------
// 사본은 '지금 쓰는 홈' 을 그대로 복사해 만든다. 빈 화면에서 시작하면 아무도 안 만든다.
// 표는 모집 랜딩과 같은 것(landing_variants)을 쓴다 — 무엇을 사본으로 두느냐만 다르다.
export async function adminCreateHomeVariant(ctx) {
  const { db, form, base, assoc } = ctx;
  const to = `${base}/admin#p-ab`;
  const { kindOf } = await import("./kinds.js");
  if (kindOf(assoc).home !== "merchant") return back(base + "/admin", "이 조직에는 홈 사본을 만들 수 없습니다.", true);
  const name = cap((form.get("name") || "").trim(), 40);
  const slug = cap((form.get("slug") || "").trim().toLowerCase(), 40).replace(/[^a-z0-9-]/g, "");
  if (!name || !slug) return back(to, "사본 이름과 주소를 입력해 주세요. (주소는 영문 소문자·숫자·하이픈)", true);
  if (await D.getLandingVariant(db, assoc.id, slug)) return back(to, "이미 쓰고 있는 주소입니다.", true);
  if ((await D.listLandingVariants(db, assoc.id)).length >= 5)
    return back(to, "사본은 5개까지입니다. 비교 대상이 많아지면 어느 것도 표본이 차지 않습니다.", true);
  // 사본은 기본적으로 지금 홈을 그대로 복사한다. 두 갈래 프리셋을 고르면 첫 화면 구성만 바꿔서 복사한다 —
  // 나머지 구역은 그대로 두어야 무엇이 통했는지 알 수 있다.
  const { parseLayout, applyHomePreset, serializeLayout, HOME_PRESETS } = await import("./homeLayout.js");
  const preset = String(form.get("preset") || "");
  const layout = HOME_PRESETS[preset]
    ? serializeLayout(applyHomePreset(parseLayout(assoc.home_layout, assoc.name), preset))
    : assoc.home_layout || null;
  await D.createLandingVariant(db, { associationId: assoc.id, slug, name, layout });
  await audit(ctx, "홈사본생성", `${name} (/l/${slug})${HOME_PRESETS[preset] ? ` · ${HOME_PRESETS[preset].label}` : ""}`);
  return back(to, `'${name}' 사본을 만들었습니다. 주소: ${base}/l/${slug} — 이 주소를 전단 QR·카톡에 뿌리고 비교해 보세요.`);
}
export async function adminDeleteHomeVariant(ctx) {
  const { db, base, assoc, params } = ctx;
  const to = `${base}/admin#p-ab`;
  const slug = cap(params.slug || "", 40);
  const v = await D.getLandingVariant(db, assoc.id, slug);
  if (!v) return back(to, "사본을 찾을 수 없습니다.", true);
  await D.deleteLandingVariant(db, assoc.id, slug);
  await audit(ctx, "홈사본삭제", `${v.name || slug} (/l/${slug})`);
  return back(to, "사본을 지웠습니다. 쌓인 성과 기록은 남아 있습니다.");
}

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

// ---------- 프랜차이즈 랜딩페이지 ----------
// 섹션 저장 로직은 홈 구성과 같은 모양이지만 카탈로그와 저장 위치가 다르다.
// 반복 항목(lines)은 여러 줄이 들어오므로 한 칸 상한을 홈 구성보다 넉넉히 잡는다.
const LANDING_FIELD_MAX = 4000;
// 올린 사진을 섹션에 넣을 때 쓰는 주소. 워커 상대 경로로 박아 둔다 —
// R2 공개 도메인을 나중에 붙이거나 떼도 이미 저장된 랜딩이 깨지지 않는다.
const mediaPath = (key) => `/media/${key}`;
// 편집 대상이 기본 랜딩인지 캠페인 사본인지 — ?v=슬러그 하나로 갈린다.
const variantOf = (ctx) => cap(ctx.url.searchParams.get("v") || "", 40);
const landingBack = (base, v) => `${base}/admin/landing${v ? `?v=${encodeURIComponent(v)}` : ""}`;

export async function adminSaveLanding(ctx) {
  const { db, env, form, base, assoc } = ctx;
  const { LANDING_CATALOG } = await import("./franchise.js");
  const v = variantOf(ctx);
  const to = landingBack(base, v);
  if (v && !(await D.getLandingVariant(db, assoc.id, v))) return back(base + "/admin/landing", "사본을 찾을 수 없습니다.", true);
  const order = (form.get("order") || "").split(",").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  const built = [];
  for (const i of order) {
    const type = form.get(`ty_${i}`); const cat = LANDING_CATALOG[type];
    if (!cat) continue;
    const sec = { type, enabled: form.get(`en_${i}`) === "1" };
    for (const f of cat.fields) {
      const key = `f_${i}_${f.key}`;
      if (f.type === "bool") { sec[f.key] = form.get(key) === "1"; continue; }
      let value = cap(String(form.get(key) != null ? form.get(key) : "").replace(/\r\n/g, "\n"), LANDING_FIELD_MAX);
      // 파일을 골랐으면 올린 주소가 직접 입력한 주소를 이깁니다 (방금 고른 쪽이 의도한 것)
      if (f.type === "image") {
        const up = await saveImages(env, form.getAll(`file_${i}_${f.key}`), 1);
        if (up.error) return back(to, up.error, true);
        if (up.images[0]) {
          value = mediaPath(up.images[0].filename);
          await D.addLandingAsset(db, { associationId: assoc.id, filename: up.images[0].filename, size: up.images[0].size });
        }
      }
      sec[f.key] = value;
    }
    built.push(sec);
  }
  if (!built.length) return back(to, "구성을 해석할 수 없습니다.", true);
  const json = JSON.stringify(built);
  // 저장은 초안까지만. 발행을 따로 두어야 문구를 고치는 동안 손님이 공사판을 보지 않는다.
  if (v) await D.saveLandingVariantDraft(db, assoc.id, v, json);
  else await D.saveLandingDraft(db, assoc.id, json);
  await audit(ctx, "랜딩초안저장", v || "기본");
  return back(to, "초안이 저장되었습니다. 손님에게 보이려면 '발행하기'를 눌러 주세요.");
}
export async function adminPublishLanding(ctx) {
  const { db, base, assoc } = ctx;
  const v = variantOf(ctx);
  if (v) await D.publishLandingVariant(db, assoc.id, v);
  else await D.publishLandingDraft(db, assoc.id);
  await audit(ctx, "랜딩발행", v || "기본");
  return back(landingBack(base, v), "발행했습니다. 이제 손님에게 보입니다.");
}
export async function adminDiscardLandingDraft(ctx) {
  const { db, base, assoc } = ctx;
  const v = variantOf(ctx);
  if (v) await D.discardLandingVariantDraft(db, assoc.id, v);
  else await D.discardLandingDraft(db, assoc.id);
  return back(landingBack(base, v), "초안을 버리고 발행본으로 되돌렸습니다.");
}
export async function adminResetLanding(ctx) {
  const { db, base, assoc } = ctx;
  const v = variantOf(ctx);
  if (v) { await D.saveLandingVariantDraft(db, assoc.id, v, null); await D.publishLandingVariant(db, assoc.id, v); }
  else await D.resetLandingLayout(db, assoc.id);
  await audit(ctx, "랜딩구성초기화", v || "기본");
  return back(landingBack(base, v), "랜딩페이지를 기본 구성으로 되돌렸습니다.");
}

// 캠페인 사본 — 지금 편집 중인 내용을 그대로 복사해 새 주소로 띄운다.
export async function adminCreateLandingVariant(ctx) {
  const { db, form, base, assoc } = ctx;
  const name = cap((form.get("name") || "").trim(), 40);
  const slug = cap((form.get("slug") || "").trim().toLowerCase(), 40).replace(/[^a-z0-9-]/g, "");
  if (!name || !slug) return back(base + "/admin/landing", "사본 이름과 주소를 입력해 주세요. (주소는 영문 소문자·숫자·하이픈)", true);
  if (await D.getLandingVariant(db, assoc.id, slug)) return back(base + "/admin/landing", "이미 쓰고 있는 주소입니다.", true);
  const from = variantOf(ctx);
  const src = from ? (await D.getLandingVariant(db, assoc.id, from)) : null;
  const layout = src ? (src.draft || src.layout) : (assoc.landing_draft || assoc.landing_layout);
  await D.createLandingVariant(db, { associationId: assoc.id, slug, name, layout });
  await audit(ctx, "랜딩사본생성", `${name} (/l/${slug})`);
  return back(`${base}/admin/landing?v=${encodeURIComponent(slug)}`, `'${name}' 사본을 만들었습니다. 주소: ${base}/l/${slug}`);
}
export async function adminDeleteLandingVariant(ctx) {
  const { db, base, assoc, params } = ctx;
  const slug = cap(params.slug || "", 40);
  const v = await D.getLandingVariant(db, assoc.id, slug);
  if (!v) return back(base + "/admin/landing", "사본을 찾을 수 없습니다.", true);
  await D.deleteLandingVariant(db, assoc.id, slug);
  await audit(ctx, "랜딩사본삭제", v.name || slug);
  // 이 사본으로 들어온 상담 신청은 지우지 않는다 — 화면을 접었다고 받은 연락처가 사라지면 안 된다
  return back(base + "/admin/landing", `'${v.name || slug}' 사본을 지웠습니다. 이 사본으로 들어온 상담 신청은 그대로 남아 있습니다.`);
}

// 사진 보관함 — 올려 두고 주소를 복사해 섹션에 붙여 넣는다.
export async function adminUploadLandingAsset(ctx) {
  const { db, env, form, base, assoc } = ctx;
  const up = await saveImages(env, form.getAll("images"), 12);
  if (up.error) return back(base + "/admin/landing", up.error, true);
  if (!up.images.length) return back(base + "/admin/landing", "올릴 사진을 선택해 주세요.", true);
  for (const im of up.images) await D.addLandingAsset(db, { associationId: assoc.id, filename: im.filename, size: im.size });
  await audit(ctx, "랜딩사진업로드", `${up.images.length}장`);
  return back(base + "/admin/landing", `사진 ${up.images.length}장을 올렸습니다. 주소를 복사해 섹션에 붙여 넣으세요.`);
}
export async function adminDeleteLandingAsset(ctx) {
  const { db, env, base, assoc, params } = ctx;
  const a = await D.getLandingAsset(db, Number(params.id) || 0, assoc.id);
  if (!a) return back(base + "/admin/landing", "사진을 찾을 수 없습니다.", true);
  await D.deleteLandingAsset(db, a.id, assoc.id);
  await storage.remove(env, a.filename);
  return back(base + "/admin/landing", "사진을 지웠습니다.");
}

// 상담 정보 보관 기간 — 매일 크론이 이 값을 보고 처리 끝난 건을 지운다.
export async function adminSetLeadRetention(ctx) {
  const { db, form, base, assoc } = ctx;
  const days = Math.max(30, Math.min(3650, parseInt(form.get("days") || "0", 10) || 0));
  await D.setSetting(db, `lead_retention:${assoc.id}`, String(days));
  await audit(ctx, "상담보관기간변경", `${days}일`);
  return back(base + "/admin/landing", `처리가 끝난 상담 건을 ${days}일 뒤 자동 삭제합니다.`);
}

// ---------- 가맹 상담 신청 (공개 · DB 수집) ----------
// 이 폼 하나가 프랜차이즈 랜딩의 성과 전부다. 그래서 두 가지를 동시에 지킨다:
//   ① 진짜 신청은 절대 잃지 않는다 (메일·알림이 실패해도 DB 저장은 끝난 뒤에 한다)
//   ② 쓰레기는 들이지 않는다 (봇 방지 · 허니팟 · 중복 제출 차단)
export async function leadSubmit(ctx) {
  const { db, env, form, base, assoc, ip } = ctx;
  // 사본(캠페인 랜딩)에서 왔으면 그 화면으로 돌려보낸다 — 기본 랜딩으로 튕기면 방금 읽던 문구가 사라진다
  const variant = cap((form.get("variant") || "").trim(), 40).replace(/[^a-z0-9-]/g, "");
  const home = variant ? `${base}/l/${encodeURIComponent(variant)}` : `${base}/`;
  const at = (msg, err = false) => redirect(`${home}?${err ? "err=1&" : ""}msg=${encodeURIComponent(msg)}#apply`);
  if (!kindById(assoc.kind).usesLanding) return at("이 조직은 상담 신청을 받지 않습니다.", true);
  if (leadRateLimited(ip)) return at("잠시 후 다시 시도해 주세요.", true);
  if (!(await turnstileVerify(env, form.get("cf-turnstile-response"), ip)))
    return at("봇 방지 확인에 실패했습니다. 다시 시도해 주세요.", true);
  // 허니팟: 사람 눈에 보이지 않는 칸이 채워졌다면 봇이다. 봇에게는 성공처럼 보이게 두고 저장하지 않는다.
  if (form.get("website")) return at("상담 신청이 접수되었습니다. 곧 연락드리겠습니다.");
  if (form.get("agree") !== "1") return at("개인정보 수집·이용에 동의해 주세요.", true);
  const name = cap((form.get("name") || "").trim(), 60);
  const phoneRaw = cap((form.get("phone") || "").trim(), 20);
  const phone = phoneRaw.replace(/[^0-9+\-]/g, "");
  if (!name || !phone) return at("성함과 연락처를 입력해 주세요.", true);
  if (D.normalizePhone(phone).length < 9) return at("연락처를 다시 확인해 주세요.", true);
  // 뒤로가기·더블클릭으로 같은 사람이 두 번 들어오면 영업팀이 같은 번호로 두 번 전화한다
  if (await D.recentLeadByPhone(db, assoc.id, phone, 10))
    return at("이미 접수되었습니다. 곧 연락드리겠습니다.");
  // 사본 이름은 실제로 있는 것만 기록한다 — 공개 폼이 지어낸 이름이 성과표에 줄을 만들면 안 된다
  const knownVariant = variant && (await D.getLandingVariant(db, assoc.id, variant)) ? variant : "";
  // 업종별 추가 질문 — 무엇을 물었는지는 발행된 랜딩 구성이 결정한다.
  // 폼이 보낸 라벨을 그대로 쓰면 아무나 상담 DB 의 열 이름을 만들 수 있다.
  const extra = await collectExtraAnswers(ctx, knownVariant);
  const lead = await D.createLead(db, {
    associationId: assoc.id, name, phone, variant: knownVariant,
    email: cap((form.get("email") || "").trim(), 120),
    region: cap((form.get("region") || "").trim(), 60),
    budget: cap((form.get("budget") || "").trim(), 40),
    funnel: cap((form.get("funnel") || "").trim(), 40),
    message: cap((form.get("message") || "").trim(), 2000),
    agreeMarketing: form.get("agree_marketing") === "1" ? 1 : 0, extra,
    utmSource: cap((form.get("utm_source") || "").trim(), 60),
    utmMedium: cap((form.get("utm_medium") || "").trim(), 60),
    utmCampaign: cap((form.get("utm_campaign") || "").trim(), 60),
    referrer: cap((form.get("referrer") || "").trim(), 200),
  });
  // 알림함은 파기 대상(leads)이 아니다 — 여기에 이름·번호를 적으면 신청 건을 지워도 그대로 남는다.
  // 누가 왔는지는 링크를 눌러 상담 DB 에서 본다.
  await D.createNotification(db, { associationId: assoc.id, kind: "lead",
    message: `새 ${assocTerms(assoc).consult} 신청이 들어왔습니다${lead.region ? ` (${lead.region})` : ""}`,
    link: base + "/admin/leads" });
  // 알림톡 — 담당자는 메일함을 늘 보고 있지 않다. 초기 응답 속도가 계약률을 가른다.
  // 크레딧이 없거나 발송이 꺼져 있어도 접수는 이미 끝났다 — 실패해도 조용히 넘어간다.
  await notifyLead(ctx, lead).catch(() => {});
  if (emailEnabled(env) && assoc.email) {
    // 메일이 죽어도 신청은 이미 DB 에 있다 — 알림 실패로 접수 자체가 실패한 것처럼 보이면 안 된다
    await sendEmail(env, {
      to: assoc.email,
      subject: `[${assoc.name}] 새 가맹 상담 신청 — ${name}`,
      html: mailShell(`${esc(assoc.name)} 가맹 상담`,
        `<p><b>성함</b>: ${esc(name)}<br /><b>연락처</b>: ${esc(phone)}<br />
          <b>희망 지역</b>: ${esc(lead.region || "-")}<br /><b>창업 예산</b>: ${esc(lead.budget || "-")}<br />
          <b>유입 경로</b>: ${esc(lead.funnel || "-")}</p>
        ${lead.message ? `<p style="white-space:pre-wrap">${esc(lead.message)}</p>` : ""}`),
    }).catch(() => {});
  }
  return at("상담 신청이 접수되었습니다. 남겨주신 연락처로 곧 연락드리겠습니다.");
}

// 전화 클릭 집계 (sendBeacon). 응답 본문이 필요 없으니 204 로 끝낸다.
// 아무나 부를 수 있는 공개 주소라, 방문 집계와 같은 잣대로 크롤러·연타를 막는다 —
// 막지 않으면 전화 클릭 수를 부풀려 광고 판단을 망칠 수 있다.
export async function trackCall(ctx) {
  const { db, assoc, query } = ctx;
  if (!kindById(assoc.kind).usesLanding) return new Response(null, { status: 204 });
  const variant = cap(query.get("v") || "", 60);
  const known = variant && (await D.getLandingVariant(db, assoc.id, variant)) ? variant : "";
  if (countable(ctx, known, "call")) await D.bumpLandingCall(db, assoc.id, known).catch(() => {});
  return new Response(null, { status: 204 });
}

// 발행된 랜딩의 상담 폼 정의를 읽어, 거기 있는 질문의 답만 추려 담는다.
async function collectExtraAnswers(ctx, variant) {
  const { db, form, assoc } = ctx;
  const { parseLandingLayout, extraDefs } = await import("./franchise.js");
  let json = assoc.landing_layout;
  if (variant) {
    const v = await D.getLandingVariant(db, assoc.id, variant);
    if (v && v.layout) json = v.layout;
  }
  const sec = parseLandingLayout(json, assoc.name, assoc.preset).find((x) => x.type === "lead" && x.enabled);
  if (!sec) return "";
  const out = {};
  for (const f of extraDefs(sec)) {
    const v = cap((form.get(f.name) || "").trim(), 200);
    if (!v) continue;
    // 선택형은 제시한 보기 중 하나여야 한다 — 아니면 저장하지 않는다
    if (f.type === "select" && f.options.length && !f.options.includes(v)) continue;
    out[f.label] = v;
  }
  return Object.keys(out).length ? JSON.stringify(out) : "";
}

// 새 상담이 들어오면 담당자에게 알림톡, 신청자에게 접수 확인.
// 알림톡 설정(키·템플릿 코드·크레딧)이 없으면 조용히 넘어간다 — 알림이 접수를 막으면 본말전도다.
//
// ⚠️ 이 발송은 '누구나 보낼 수 있는 공개 폼'이 방아쇠다. 신청자 확인 문자는 폼에 적힌 번호로
//    나가고 요금은 조직이 문다 — 즉 남의 번호로 문자를 쏘고 남의 돈을 태우는 통로가 될 수 있다.
//    그래서 하루 상한을 두고, 넘으면 발송만 멈춘다(접수는 계속 받는다).
const LEAD_NOTIFY_DAILY_CAP = 200;
async function notifyLead(ctx, lead) {
  const { db, env, assoc, base } = ctx;
  if (!canAutoSend(env, assoc)) return;
  const sentToday = await D.countMessagesSince(db, assoc.id, ["lead_new", "lead_ack"], 24);
  if (sentToday >= LEAD_NOTIFY_DAILY_CAP) return;
  const origin = await originFor(env, db, assoc);
  const staff = [...(await D.listUsersByAssociation(db, assoc.id, "ADMIN")),
    ...(await D.listUsersByAssociation(db, assoc.id, "STAFF"))].filter((u) => u.phone);
  if (staff.length) {
    await sendMany(env, db, {
      assoc, kind: "lead_new", recipients: staff,
      textFor: () => renderTemplate("lead_new", { 상호: assoc.name, 이름: lead.name, 연락처: lead.phone, 지역: lead.region }),
      buttonName: templateButton("lead_new"), buttonUrl: origin ? `${origin}${base}/admin/leads` : "",
    });
  }
  // 신청자 확인 문자 — "접수됐나?" 하는 불안을 없애는 것만으로 이탈이 줄어든다.
  if (D.isValidPhone(lead.phone)) {
    await sendOne(env, db, {
      assoc, kind: "lead_ack", to: lead.phone,
      text: renderTemplate("lead_ack", { 상호: assoc.name, 이름: lead.name }),
    });
  }
}

// ---------- 상담 DB 관리 (관리자) ----------
// 같은 표를 두 화면이 쓴다 — 모집 랜딩의 상담 DB 와 상인회 콘솔의 문의함.
// 손댄 뒤에는 왔던 화면으로 돌려보낸다. 상인회 회장을 상담 DB 로 보내면 남의 화면이다.
const leadBack = (base, lead) => lead.source === "contact" ? base + "/admin#s-inbox" : base + "/admin/leads";
export async function adminLeadStatus(ctx) {
  const { db, form, base, assoc, params } = ctx;
  const lead = await D.getLead(db, Number(params.id) || 0, assoc.id);
  if (!lead) return back(base + "/admin/leads", "신청 건을 찾을 수 없습니다.", true);
  const to = leadBack(base, lead);
  const status = form.get("status");
  if (!D.LEAD_STATUSES.includes(status)) return back(to, "잘못된 상태값입니다.", true);
  await D.setLeadStatus(db, lead.id, assoc.id, status);
  // 감사 로그·주소창에도 이름을 남기지 않는다 (감사 로그는 파기 대상이 아니고, 주소는 방문 기록에 남는다)
  await audit(ctx, lead.source === "contact" ? "문의상태변경" : "상담상태변경", `#${lead.id}: ${D.LEAD_STATUS_LABEL[status]}`);
  return back(to, `'${D.LEAD_STATUS_LABEL[status]}'(으)로 바꿨습니다.`);
}
export async function adminLeadMemo(ctx) {
  const { db, form, base, assoc, params } = ctx;
  const lead = await D.getLead(db, Number(params.id) || 0, assoc.id);
  if (!lead) return back(base + "/admin/leads", "신청 건을 찾을 수 없습니다.", true);
  await D.setLeadMemo(db, lead.id, assoc.id, cap(form.get("memo"), 500));
  return back(leadBack(base, lead), "메모를 저장했습니다.");
}
export async function adminLeadDelete(ctx) {
  const { db, base, assoc, params } = ctx;
  const lead = await D.getLead(db, Number(params.id) || 0, assoc.id);
  if (!lead) return back(base + "/admin/leads", "신청 건을 찾을 수 없습니다.", true);
  const to = leadBack(base, lead);
  await D.deleteLead(db, lead.id, assoc.id);
  // 지운 내용(이름·번호)은 감사 로그에도 남기지 않는다 — 지웠는데 다른 표에 남으면 지운 게 아니다
  await audit(ctx, lead.source === "contact" ? "문의삭제" : "상담신청삭제", `#${lead.id}`);
  return back(to, "지웠습니다.");
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
// 주소(slug) 바꾸기 — 옛 주소는 자동으로 alias 로 남아 301 로 이어진다.
export async function superSetSlug(ctx) {
  const { db, form, params } = ctx;
  const a = await D.getAssociationById(db, Number(params.id));
  if (!a) return back(superBackTo(ctx), "조직을 찾을 수 없습니다.", true);
  const want = (form.get("slug") || "").toLowerCase().trim();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(want) || want.length > 40)
    return back(superBackTo(ctx), "주소는 영문 소문자·숫자·하이픈만 쓸 수 있습니다. (예: seocho)", true);
  if (RESERVED_SLUGS.has(want)) return back(superBackTo(ctx), `'${want}' 는 시스템이 쓰는 주소라 사용할 수 없습니다.`, true);
  const r = await D.renameAssociationSlug(db, a.id, want);
  if (!r.ok) return back(superBackTo(ctx), r.reason === "taken" ? "이미 쓰이고 있는 주소입니다." : "주소가 그대로입니다.", true);
  await audit(ctx, "주소변경", `${a.name}: /t/${r.from} → /t/${r.to}`, null);
  return back(superBackTo(ctx), `'${a.name}' 주소를 /t/${r.to} 로 바꿨습니다. 옛 주소 /t/${r.from} 로 들어와도 새 주소로 이동합니다.`);
}

export async function superSetDomain(ctx) {
  const { db, form, params } = ctx;
  const a = await D.getAssociationById(db, Number(params.id));
  if (!a) return back(superBackTo(ctx), "상인회를 찾을 수 없습니다.", true);
  if (!planOf(a).customDomain) return back(superBackTo(ctx), "이 상인회 플랜은 개별 도메인을 지원하지 않습니다.", true);
  // 입력 정리: 프로토콜·경로 제거, 소문자화
  let domain = (form.get("domain") || "").toLowerCase().trim()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (domain && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain))
    return back(superBackTo(ctx), "도메인 형식을 확인해 주세요. (예: seocho-market.kr)", true);
  if (domain) {
    const dup = await D.getAssociationByDomain(db, domain);
    if (dup && dup.id !== a.id) return back(superBackTo(ctx), "이미 다른 상인회에 연결된 도메인입니다.", true);
  }
  await D.setAssociationDomain(db, a.id, domain);
  await audit(ctx, "도메인연결", `${a.name} → ${domain || "(해제)"}`, null);
  return back(superBackTo(ctx), domain
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
  return back("/apply", "신청이 접수되었습니다. 검토 후 연락드리겠습니다.");
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
  const temp = tempPassword();
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
  if (!target || target.role !== "ADMIN") return back(superBackTo(ctx), "대상 관리자를 찾을 수 없습니다.", true);
  const temp = tempPassword();
  const { hash, salt } = await hashPassword(temp);
  await D.updateUserPassword(db, target.id, hash, salt);
  await audit(ctx, "관리자비번재발급", target.email, null);
  return back(superBackTo(ctx), `${target.email} 임시 비밀번호: ${temp} — 전달 후 변경 안내하세요.`);
}

// ---------- 슈퍼: 실전용 시작 세트 ----------
// 빈 사이트로 고객사에 넘기지 않기 위한 것. 비어 있는 항목만 채우므로 여러 번 눌러도 안전합니다.
export async function superSeedStarter(ctx) {
  const { db, user, params } = ctx;
  const a = await D.getAssociationById(db, Number(params.id));
  if (!a) return back(superBackTo(ctx), "상인회를 찾을 수 없습니다.", true);
  const r = await seedStarter(ctx.env, db, a, { createdBy: user.id });
  if (!r.notices && !r.documents)
    return back(superBackTo(ctx), `'${a.name}' 은(는) 이미 ${r.skipped.join("·")}이(가) 있어 넣을 것이 없었습니다.`);
  await audit(ctx, "시작세트", `${a.name} — 공지 ${r.notices}건·서명문서 ${r.documents}건`, a.id);
  const skip = r.skipped.length ? ` (${r.skipped.join("·")}은(는) 이미 있어 건너뜀)` : "";
  return back(superBackTo(ctx), `'${a.name}' 에 시작 세트를 넣었습니다. 공지 ${r.notices}건 · 전자서명 문서 ${r.documents}건${skip}`);
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
  if (!a) return back(superBackTo(ctx), "상인회를 찾을 수 없습니다.", true);
  const key = (form.get("map_client_id") || "").trim();
  if (key && !/^[a-z0-9]{4,24}$/i.test(key)) return back(superBackTo(ctx), "지도 키 형식이 올바르지 않습니다. (영문·숫자)", true);
  await D.setAssociationMapKey(db, a.id, key);
  await audit(ctx, "지도키", `${a.name} → ${key || "(공용)"}`, null);
  return back(superBackTo(ctx), key ? `'${a.name}' 전용 지도 키를 설정했습니다.` : `'${a.name}' 지도 키를 공용으로 되돌렸습니다.`);
}

export async function superSetPlan(ctx) {
  const { db, form, params } = ctx;
  const { PLAN_KEYS } = await import("./plans.js");
  const a = await D.getAssociationById(db, Number(params.id));
  if (!a) return back(superBackTo(ctx), "상인회를 찾을 수 없습니다.", true);
  const plan = form.get("plan");
  if (!PLAN_KEYS.includes(plan)) return back(superBackTo(ctx), "잘못된 플랜입니다.", true);
  await D.setAssociationPlan(db, a.id, plan);
  await audit(ctx, "플랜변경", `${a.name} → ${plan}`, null);
  return back(superBackTo(ctx), `'${a.name}' 플랜을 ${plan} 으로 변경했습니다.`);
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

// ================= 계약서 작성기 =================
//
// 지면 줄바꿈은 서버가 확정한다(paper.js). 그래서 미리보기도 서버가 그린다 —
// 화면에서 따로 그리면 미리보기와 실제 계약서가 다른 자리에서 끊기고,
// 그 위에 놓은 서명 자리가 어긋난다.
export async function adminPreviewPaper(ctx) {
  const { form } = ctx;
  const { renderPaper } = await import("./paper.js");
  const body = cap((form.get("body") || ""), 20000);
  return new Response(renderPaper(body, { fieldsFor: () => "" }), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

// 임시저장 — 쓰다 만 계약서를 그대로 둔다.
// 초안은 서명 요청도 과금도 발송도 없다. 보내는 순간 비로소 계약이 된다.
export async function adminSaveDraft(ctx) {
  const { db, form, base, assoc, user } = ctx;
  const title = cap((form.get("title") || "").trim(), 200) || "제목 없는 계약서";
  const body = cap((form.get("body") || ""), 20000);
  const id = Number(form.get("doc") || 0);
  const hash = await contentHash(body);
  let doc;
  if (id) {
    const cur = await docOf(ctx, id);
    if (!cur || cur.association_id !== assoc.id) return jsonOut({ ok: false, error: "문서를 찾을 수 없습니다." }, 404);
    if (!cur.draft) return jsonOut({ ok: false, error: "이미 보낸 계약서는 임시저장으로 되돌릴 수 없습니다." }, 409);
    await D.saveDraft(db, id, { title, body, contentHash: hash });
    doc = await D.getDocument(db, id);   // 방금 위에서 docOf 로 통과시킨 문서다
  } else {
    // 아무것도 안 쓴 화면은 초안이 되지 않는다. 자동 저장이 3초마다 도는데 이 문이 없으면,
    // 작성기를 열어 두기만 해도 '제목 없는 계약서' 가 목록에 쌓인다.
    if (!body.trim() && !form.get("title")) return jsonOut({ ok: false, error: "아직 쓴 내용이 없습니다." }, 400);
    doc = await D.createDocument(db, { associationId: assoc.id, title, body, contentHash: hash, createdBy: user.id, draft: 1, teamId: user.team_id });
  }
  return jsonOut({ ok: true, id: doc.id, at: new Date().toISOString(), to: `${base}/admin/documents/write?doc=${doc.id}` });
}
// 빈칸 채우기 — {{보증금}} 같은 자리를 실제 값으로 바꾼다.
//
// ⚠️ 왜 보낼 때가 아니라 여기서 바꾸는가.
//    본문 글자 수가 달라지면 지면 줄바꿈이 달라지고, 그 위에 놓아 둔 서명 자리가 어긋난다.
//    그래서 **서명 자리를 놓기 전에** 본문을 확정한다. 보낼 때는 이미 채워져 있어야 한다.
export async function adminFillBlanks(ctx) {
  const { db, form, base, assoc, params } = ctx;
  const d = await docOf(ctx, params.id);
  const to = `${base}/admin/documents/write?doc=${params.id}`;
  if (!d || d.association_id !== assoc.id) return back(base + "/admin/documents", "문서를 찾을 수 없습니다.", true);
  if (!d.draft) return back(`${base}/admin/documents/${d.id}`, "이미 보낸 계약서는 고칠 수 없습니다.", true);
  const names = extractVars(d.body);
  if (!names.length) return back(to, "채울 빈칸이 없습니다.", true);
  const values = {};
  for (const n of names) {
    const v = cap((form.get("var_" + n) || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 200);
    if (v) values[n] = v;
  }
  if (!Object.keys(values).length) return back(to, "채운 빈칸이 없습니다.", true);
  const body = cap(fillVars(d.body, values), 20000);
  await D.saveDraft(db, d.id, { title: d.title, body, contentHash: await contentHash(body) });
  const left = extractVars(body).length;
  return back(to, left
    ? `빈칸 ${Object.keys(values).length}개를 채웠습니다. ${left}개가 남았습니다.`
    : `빈칸을 모두 채웠습니다. 이제 서명 자리를 놓고 보내면 됩니다.`);
}

const jsonOut = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

// 초안 → 계약. 여기서부터 서명 요청·과금·발송이 붙는다.
export async function adminPublishDraft(ctx) {
  const { db, form, base, assoc, params } = ctx;
  const d = await docOf(ctx, params.id);
  const to = `${base}/admin/documents/write?doc=${params.id}`;
  if (!d || d.association_id !== assoc.id) return back(base + "/admin/documents", "문서를 찾을 수 없습니다.", true);
  if (!d.draft) return back(`${base}/admin/documents/${d.id}`, "이미 보낸 계약서입니다.", true);
  if (!String(d.body || "").trim()) return back(to, "본문이 비어 있습니다. 내용을 쓰고 보내 주세요.", true);
  // {{보증금}} 이 그대로 박힌 계약서가 나가면 안 된다 — 상대방이 그 화면에서 서명한다.
  const blanks = extractVars(d.body);
  if (blanks.length) return back(to, `아직 채우지 않은 빈칸이 ${blanks.length}개 있습니다: ${blanks.slice(0, 5).join(" · ")}${blanks.length > 5 ? " …" : ""}`, true);

  let dueDate = ""; const rawDue = (form.get("due_date") || "").trim();
  if (rawDue) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDue)) return back(to, "기한 형식(YYYY-MM-DD)을 확인하세요.", true);
    if (rawDue < new Date().toISOString().slice(0, 10)) return back(to, "기한은 오늘 이후여야 합니다.", true);
    dueDate = rawDue;
  }
  const ordered = form.get("ordered") === "1" ? 1 : 0;

  // 계약당 과금이면 '보내는 순간' 한 번 청구한다 — 초안은 몇 번을 고쳐도 돈이 들지 않는다.
  if ((await billingMode(db)) === "per_doc") {
    const bal = await D.getBalance(db, assoc.id);
    const price = await priceOf(db, "alimtalk", assoc.id);
    if (bal < price) return back(to, `크레딧 잔액이 부족합니다. (계약 1건 ${price.toLocaleString()}원 · 잔액 ${bal.toLocaleString()}원)`, true);
  }
  const valid = new Set((await D.listSignerCandidates(db, assoc.id, assoc.kind)).map((m) => m.id));
  const slots = await D.usedSlots(db, d.id);   // 서명 자리를 당사자별로 놓았는가
  const pNames = await D.listDocParties(db, d.id);
  const pLabel = (i) => D.partyLabel(pNames, i + 1);   // '임대인' 또는 '1번째 당사자'

  // ---- 당사자 정하기 ----
  // 자리를 놓아 둔 계약서는 '몇 번째 당사자' 가 누구인지부터 정해야 한다.
  // 그렇지 않은 계약서는 지금까지와 같이 전체/특정 회원으로 보낸다.
  let signers = [];                 // 서명 요청을 만들 회원 id
  const parties = [];               // 자리 순서대로의 ref (회원 id · 나중에 채울 외부는 null)
  const externals = [];             // { at, name, email, phone, org }
  if (slots.length) {
    const need = Math.max(...slots);
    for (let i = 0; i < need; i++) {
      const raw = String(form.get(`party_${i}`) || "").trim();
      if (raw === "ext") {
        const name = cap((form.get(`ext_name_${i}`) || "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 60);
        const email = cap((form.get(`ext_email_${i}`) || "").toLowerCase().trim(), 120);
        const phone = D.normalizePhone(form.get(`ext_phone_${i}`) || "");
        const org = cap((form.get(`ext_org_${i}`) || "").trim(), 80);
        if (!name) return back(to, `${pLabel(i)}의 이름을 입력해 주세요.`, true);
        if (email && !EMAIL_RE.test(email)) return back(to, `${name}님의 이메일 형식을 확인해 주세요.`, true);
        if (phone && !D.isValidPhone(phone)) return back(to, `${name}님의 휴대폰 번호 형식을 확인해 주세요.`, true);
        if (!email && !phone) return back(to, `${name}님께 서명 링크를 보낼 휴대폰 또는 이메일이 필요합니다.`, true);
        externals.push({ at: i, name, email, phone, org });
        parties.push(null);
        continue;
      }
      const id = Number(raw) || 0;
      if (!id) return back(to, `${D.withJosa(pLabel(i), ["이", "가"])} 비어 있습니다. 서명 자리를 그 몫으로 놓아 두었습니다.`, true);
      if (!valid.has(id)) return back(to, "이 조직의 사람만 당사자로 지정할 수 있습니다.", true);
      if (parties.includes(id)) return back(to, "같은 사람을 두 당사자로 지정할 수 없습니다.", true);
      parties.push(id);
      signers.push(id);
    }
  } else if ((form.get("target") || "all") === "select") {
    const ids = form.getAll("members").map((v) => Number(v)).filter(Boolean);
    signers = ids.filter((id) => valid.has(id));
    if (!signers.length) return back(to, "서명할 회원을 한 명 이상 골라 주세요.", true);
  }

  await D.publishDraft(db, d.id, { ordered, dueDate });

  // 외부 상대방은 계약이 된 뒤에 등록한다 — 초안 단계에서 만들면 아직 쓰다 만 계약서로
  // 서명 링크가 나가 버린다.
  //
  // 자리를 놓은 계약서는 회원·외부를 **당사자 순서 그대로** 넣는다. 회원을 먼저 다 넣고
  // 외부를 뒤에 붙이면, 순차 서명에서 2번째 당사자가 1번보다 먼저 차례를 받는다.
  const extLinks = [];
  const addExt = async (e, signOrder) => {
    const signer = await D.addExternalSigner(db, { documentId: d.id, name: e.name, email: e.email, phone: e.phone, org: e.org, signOrder });
    parties[e.at] = -signer.id;
    const token = await makeExtToken(ctx.env.SESSION_SECRET, signer.id, d.id);
    const via = await sendSignLink(ctx.env, db, { assoc, doc: d, signer, origin: new URL(ctx.request.url).origin }).catch(() => "");
    extLinks.push({ name: e.name, token, via });
  };
  if (parties.length) {
    for (let i = 0; i < parties.length; i++) {
      const e = externals.find((x) => x.at === i);
      if (e) await addExt(e, i + 1);
      else await D.addSignatureRequestAt(db, d.id, parties[i], i + 1);
    }
  } else {
    if (signers.length) await D.createSignatureRequests(db, d.id, signers);
    for (const e of externals) await addExt(e, await D.nextSignOrder(db, d.id));
  }
  // '몇 번째 당사자' 를 실제 사람으로 확정 — 여기서부터 각자 자기 자리만 채운다
  const placed = parties.length ? await D.resolveFieldSlots(db, d.id, parties) : 0;

  if ((await billingMode(db)) === "per_doc") await chargeContract(db, assoc, { documentId: d.id, title: d.title });
  await rememberOrigin(db, new URL(ctx.request.url).origin);
  await audit(ctx, "계약서발송", d.title);

  const notSent = extLinks.filter((x) => !x.via);
  const msg = placed
    ? `계약서를 보냈습니다. 서명 자리 ${placed}칸을 당사자에게 배정했습니다.`
    : "계약서를 보냈습니다. 서명 자리를 아직 안 놓았다면 [서명 자리 배치] 에서 놓아 주세요.";
  const tail = !extLinks.length ? ""
    : notSent.length ? ` 외부 상대방 ${notSent.length}명은 링크가 자동으로 나가지 않았습니다 — 문서 화면에서 링크를 복사해 전달해 주세요.`
      : ` 외부 상대방 ${extLinks.length}명에게 서명 링크를 보냈습니다.`;
  return back(`${base}/admin/documents/${d.id}`, msg + tail);
}

export async function adminDeleteDraft(ctx) {
  const { db, base, assoc, params } = ctx;
  const d = await docOf(ctx, params.id);
  if (!d || d.association_id !== assoc.id || !d.draft) return back(base + "/admin/documents", "작성 중인 계약서를 찾을 수 없습니다.", true);
  await D.deleteDraft(db, d.id, assoc.id);
  return back(base + "/admin/documents", `'${d.title}' 초안을 지웠습니다.`);
}

// ---------- 대량 발송 ----------
//
// "같은 계약서를 100명에게, 사람마다 값만 다르게." 한국의 계약 실무 대부분이 이 모양이다 —
// 입점 계약, 위탁 계약, 연간 재계약. 한 건씩 만들면 100번 같은 화면을 반복해야 한다.
//
// 두 가지가 어렵고, 둘 다 여기서 푼다.
//   1. 사람마다 {{보증금}} 이 다르면 글자 수가 달라져 **지면의 줄이 밀린다.**
//      → paper.js 의 remapFields 가 서명 자리를 '몇 번째 문단의 몇 번째 줄' 로 따라 옮긴다.
//   2. 100건을 한 요청에 보낼 수 없다(워커의 시간·바깥 요청 한도).
//      → 명단을 표에 적어 두고 몇 명씩 나눠 보낸다. 브라우저를 닫아도 남은 사람이 남는다.
export const BULK_MAX = 300;    // 한 명단의 최대 인원
export const BULK_CHUNK = 5;    // 한 번의 요청에서 보내는 인원

// 올린 표 → 보낼 사람들. 틀린 줄은 버리지 않고 '왜 못 보내는지'를 달아 그대로 남긴다 —
// 한 줄 오타 때문에 나머지 99명이 멈추면 안 되고, 그 한 줄이 조용히 사라져도 안 된다.
export function parseRoster(text, blanks = []) {
  const table = parseTable(text);
  if (table.length < 2) return { error: "첫 줄에 머리글(이름·휴대폰 …), 그 아래로 사람을 한 줄씩 적어 주세요." };
  const head = table[0];
  const roles = head.map(headerRole);
  const idx = { name: -1, phone: -1, email: -1, org: -1 };
  for (let i = 0; i < roles.length; i++) if (roles[i] && idx[roles[i]] < 0) idx[roles[i]] = i;
  if (idx.name < 0) return { error: "머리글에 '이름' 칸이 없습니다. 첫 줄을 이름·휴대폰·이메일 … 로 적어 주세요." };
  if (idx.phone < 0 && idx.email < 0) return { error: "머리글에 '휴대폰' 또는 '이메일' 칸이 필요합니다 — 서명 링크를 보낼 곳이 없습니다." };
  // 사람 정보가 아닌 머리글은 계약서의 빈칸 이름으로 읽는다
  const varAt = {};
  for (let i = 0; i < head.length; i++) {
    const n = head[i].trim();
    if (roles[i] || !n) continue;
    if (blanks.includes(n) && varAt[n] === undefined) varAt[n] = i;
  }
  const missing = blanks.filter((b) => varAt[b] === undefined);
  if (missing.length)
    return { error: `계약서의 빈칸 ${missing.map((m) => `'${m}'`).join(" · ")} 에 해당하는 칸이 명단에 없습니다. 머리글에 그 이름 그대로 넣어 주세요.` };
  if (table.length - 1 > BULK_MAX)
    return { error: `한 명단에 ${BULK_MAX}명까지 담을 수 있습니다. (올린 명단 ${table.length - 1}명) 나눠서 올려 주세요.` };
  const rows = [];
  const seen = new Set();
  for (let r = 1; r < table.length; r++) {
    const c = table[r];
    const g = (i) => (i >= 0 ? cap(String(c[i] ?? "").replace(/[\x00-\x1f\x7f]/g, " ").trim(), 200) : "");
    const name = cap(g(idx.name), 60);
    const org = cap(g(idx.org), 80);
    const email = g(idx.email).toLowerCase();
    const phone = D.normalizePhone(g(idx.phone));
    const vars = {};
    for (const b of blanks) vars[b] = g(varAt[b]);
    const empty = blanks.filter((b) => !vars[b]);
    const key = phone || email;
    let note = "";
    if (!name) note = "이름이 비어 있습니다";
    else if (!phone && !email) note = "휴대폰·이메일이 둘 다 비어 있습니다";
    else if (phone && !D.isValidPhone(phone)) note = "휴대폰 번호 형식을 확인해 주세요";
    else if (email && !EMAIL_RE.test(email)) note = "이메일 형식을 확인해 주세요";
    // 같은 사람이 두 줄에 있으면 계약서가 두 부 간다. 명단을 붙여 만들다 보면 흔한 일이라 여기서 잡는다.
    else if (seen.has(key)) note = "위에 같은 연락처가 이미 있습니다";
    else if (empty.length) note = `빈칸이 비었습니다: ${empty.join(" · ")}`;
    if (!note) seen.add(key);
    rows.push({ seq: r, name, phone, email, org, vars, status: note ? "failed" : "pending", note });
  }
  return { rows };
}

// 명단 양식 내려받기 — 머리글은 이 계약서의 빈칸 이름 그대로다. 사람이 이름을 맞출 필요가 없다.
export async function adminBulkSample(ctx) {
  const { db, assoc, params } = ctx;
  const d = await docOf(ctx, params.id);
  if (!d || d.association_id !== assoc.id) return new Response("문서를 찾을 수 없습니다.", { status: 404 });
  const blanks = extractVars(d.body);
  const csv = toCsv([
    ["이름", "휴대폰", "이메일", "상호", ...blanks],
    ["홍길동", "010-1234-5678", "hong@example.com", "길동상회", ...blanks.map((b) => `${b} 값`)],
  ]);
  return new Response(csv, { headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="roster.csv"; filename*=UTF-8''${encodeURIComponent(`${d.title} 명단.csv`)}`,
    "cache-control": "no-store",
  } });
}

// 명단 올리기 → 보낼 준비가 된 '명단' 하나를 만든다. 아직 아무것도 나가지 않는다.
export async function adminBulkPrepare(ctx) {
  const { db, form, base, assoc, user, params } = ctx;
  const d = await docOf(ctx, params.id);
  const to = `${base}/admin/documents/${params.id}/bulk`;
  if (!d || d.association_id !== assoc.id) return back(base + "/admin/documents", "문서를 찾을 수 없습니다.", true);
  // 초안에서만 시작한다 — 이미 보낸 계약서를 복제하면 그 계약의 서명·증적까지 함께 복사할 뻔한다.
  if (!d.draft) return back(`${base}/admin/documents/${d.id}`, "작성 중인 계약서에서만 대량 발송을 시작할 수 있습니다.", true);
  if (!String(d.body || "").trim() && !(await D.countDocPages(db, d.id)))
    return back(to, "본문이 비어 있습니다. 내용을 쓰고 다시 시도해 주세요.", true);

  let text = "";
  const f = form.get("roster");
  if (f && typeof f.arrayBuffer === "function" && f.size) {
    if (f.size > 2 * 1024 * 1024) return back(to, "명단 파일이 너무 큽니다. (최대 2MB)", true);
    const r = decodeUtf8(new Uint8Array(await f.arrayBuffer()));
    if (!r.ok) return back(to, r.error, true);
    text = r.text;
  } else {
    text = String(form.get("paste") || "");
  }
  if (!text.trim()) return back(to, "명단을 올리거나 붙여넣어 주세요.", true);

  const blanks = extractVars(d.body);
  const parsed = parseRoster(text, blanks);
  if (parsed.error) return back(to, parsed.error, true);
  if (!parsed.rows.some((r) => r.status === "pending"))
    return back(to, "보낼 수 있는 줄이 하나도 없습니다. 명단을 고쳐 다시 올려 주세요.", true);

  // 당사자 자리 — 명단의 사람이 앉을 자리 하나를 고르고, 나머지는 우리 쪽 사람으로 고정한다.
  const slots = await D.usedSlots(db, d.id);
  const fixed = [];
  let slot = 0;
  if (slots.length) {
    const need = Math.max(...slots);
    slot = Number(form.get("to_slot")) || 0;
    if (!slot || slot > need) return back(to, "명단의 사람이 앉을 당사자 자리를 골라 주세요.", true);
    const valid = new Set((await D.listSignerCandidates(db, assoc.id, assoc.kind)).map((m) => m.id));
    const pNames = await D.listDocParties(db, d.id);
    for (let i = 1; i <= need; i++) {
      if (i === slot) { fixed.push(0); continue; }
      const id = Number(form.get(`party_${i}`)) || 0;
      if (!valid.has(id))
        return back(to, `${D.withJosa(D.partyLabel(pNames, i), ["은", "는"])} 모든 계약서에서 같은 사람이 됩니다. 우리 쪽 사람을 골라 주세요.`, true);
      fixed.push(id);
    }
  }
  let dueDate = "";
  const rawDue = (form.get("due_date") || "").trim();
  if (rawDue) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDue)) return back(to, "기한 형식(YYYY-MM-DD)을 확인하세요.", true);
    if (rawDue < new Date().toISOString().slice(0, 10)) return back(to, "기한은 오늘 이후여야 합니다.", true);
    dueDate = rawDue;
  }
  const ordered = form.get("ordered") === "1" ? 1 : 0;
  const title = cap((form.get("title") || "").trim(), 200) || d.title;
  const batch = await D.createBatch(db, { associationId: assoc.id, sourceId: d.id, title, ordered, dueDate, slot, fixed, createdBy: user.id, teamId: user.team_id });
  for (const r of parsed.rows) await D.addBatchRow(db, batch.id, r);
  // 정기 작업이 쓸 절대 주소를 확보해 둔다(크론에는 요청이 없다)
  await rememberOrigin(db, new URL(ctx.request.url).origin);
  await audit(ctx, "대량발송준비", `${title} · ${parsed.rows.length}명`);
  return redirect(`${base}/admin/bulk/${batch.id}`);
}

// 명단 한 줄 → 계약서 한 부. 만들고, 봉인 대상 값을 채우고, 링크를 보낸다.
async function sendBatchRow(ctx, { batch, src, row, srcFields, srcParties, srcPages, origin, perDoc }) {
  const { db, assoc } = ctx;
  const vars = JSON.parse(row.vars || "{}");
  const body = cap(fillVars(src.body, vars), 20000);
  const left = extractVars(body);
  if (left.length) throw new Error(`빈칸이 남았습니다: ${left.slice(0, 3).join(" · ")}`);
  // 제목에도 {{이름}} 을 쓸 수 있다 — "2026 입점계약서 (길동상회)" 처럼 목록에서 구분되어야 한다.
  const title = cap(fillVars(batch.title || src.title, { ...vars, 이름: row.name, 상호: row.org }).trim(), 200) || src.title;
  const hash = src.attachment_hash
    ? await contentHash(`${body}\n--attachment--\n${src.attachment_hash}`)
    : await contentHash(body);
  // 초안으로 만들었다가 과금이 끝난 뒤에 계약으로 바꾼다 — 잔액이 모자라면 아무것도 남지 않아야 한다.
  const doc = await D.createDocument(db, { associationId: assoc.id, title, body, contentHash: hash,
    createdBy: batch.created_by, ordered: batch.ordered, dueDate: batch.due_date, draft: 1, teamId: batch.team_id });
  if (src.attachment) await D.setDocumentAttachment(db, doc.id, src.attachment, src.attachment_name, src.attachment_hash);
  if (srcPages.length) await D.replaceDocPages(db, doc.id, srcPages);
  if (Object.keys(srcParties).length) await D.replaceDocParties(db, doc.id, srcParties);
  if (srcFields.length) {
    // 올린 양식(쪽 그림)은 지면이 글이 아니라 그림이라 줄이 밀리지 않는다 — 그대로 둔다.
    const moved = srcPages.length ? srcFields : remapFields(src.body, body, srcFields);
    await D.replaceFields(db, doc.id, moved);
  }
  await applySeal(ctx, doc);
  if (perDoc) {
    const paid = await chargeContract(db, assoc, { documentId: doc.id, title });
    if (!paid.ok) { await D.deleteDraft(db, doc.id, assoc.id); throw new Error(paid.error || "크레딧 잔액이 부족합니다"); }
  }
  await D.publishDraft(db, doc.id, { ordered: batch.ordered, dueDate: batch.due_date });

  let signer = null;
  if (batch.slot > 0) {
    const fixed = JSON.parse(batch.fixed || "[]");
    const refs = [];
    for (let i = 1; i <= fixed.length; i++) {
      if (i === batch.slot) {
        signer = await D.addExternalSigner(db, { documentId: doc.id, name: row.name, email: row.email, phone: row.phone, org: row.org, signOrder: i });
        refs.push(-signer.id);
      } else {
        await D.addSignatureRequestAt(db, doc.id, fixed[i - 1], i);
        refs.push(fixed[i - 1]);
      }
    }
    await D.resolveFieldSlots(db, doc.id, refs);
  } else {
    signer = await D.addExternalSigner(db, { documentId: doc.id, name: row.name, email: row.email, phone: row.phone, org: row.org, signOrder: 1 });
  }
  await D.logDocEvent(db, { documentId: doc.id, userId: batch.created_by || 0, actorName: ctx.user?.name || "",
    kind: "created", detail: `대량 발송 · 명단 ${row.seq}번째 줄`, ip: ctx.ip || "", userAgent: uaOf(ctx) });
  const via = await sendSignLink(ctx.env, db, { assoc, doc, signer, origin }).catch(() => "");
  return { docId: doc.id, note: via === "alimtalk" ? "알림톡으로 보냈습니다"
    : via === "email" ? "이메일로 보냈습니다"
    : "보낼 수단이 없습니다 — 링크를 복사해 전달해 주세요" };
}

// 명단에서 몇 사람씩 보낸다. 화면이 다 될 때까지 반복해서 부른다.
export async function adminBulkRun(ctx) {
  const { db, base, assoc, params } = ctx;
  const b = await D.getBatch(db, Number(params.bid));
  if (!D.canSeeBatch(assoc, ctx.user, b)) return jsonOut({ ok: false, error: "명단을 찾을 수 없습니다." }, 404);
  const src = await D.getDocument(db, b.source_id);
  if (!src || src.association_id !== assoc.id)
    return jsonOut({ ok: false, error: "원본 계약서가 없습니다. 초안이 지워진 것 같습니다." }, 409);
  const rows = await D.nextBatchRows(db, b.id, BULK_CHUNK);
  const origin = new URL(ctx.request.url).origin;
  const perDoc = (await billingMode(db)) === "per_doc";
  const price = perDoc ? await priceOf(db, "alimtalk", assoc.id) : 0;
  const srcFields = await D.listFields(db, src.id);
  const srcParties = await D.listDocParties(db, src.id);
  const srcPages = await D.listDocPages(db, src.id);
  let stopped = "";
  for (const row of rows) {
    // 잔액이 바닥나면 **여기서 멈춘다.** 남은 사람은 pending 그대로라, 충전하고 다시 누르면 이어진다.
    if (perDoc && price > 0 && (await D.getBalance(db, assoc.id)) < price) {
      stopped = "크레딧 잔액이 부족해 여기서 멈췄습니다. 충전하시면 남은 사람부터 이어서 보냅니다.";
      break;
    }
    try {
      const out = await sendBatchRow(ctx, { batch: b, src, row, srcFields, srcParties, srcPages, origin, perDoc });
      await D.setBatchRow(db, row.id, { status: "sent", documentId: out.docId, note: out.note });
    } catch (e) {
      await D.setBatchRow(db, row.id, { status: "failed", note: String((e && e.message) || e).slice(0, 200) });
    }
  }
  const c = await D.batchCounts(db, b.id);
  // 다 끝나면 알림 **한 줄**. 100건이면 알림도 100개가 되는 것이 가장 흔한 사고다.
  if (rows.length && !c.pending) {
    await D.createNotification(db, { associationId: assoc.id, kind: "document",
      message: `대량 발송 '${b.title}' 을 마쳤습니다 — 보냄 ${c.sent}건${c.failed ? ` · 실패 ${c.failed}건` : ""}`,
      link: `${base}/admin/bulk/${b.id}` });
    await audit(ctx, "대량발송완료", `${b.title} · 보냄 ${c.sent} · 실패 ${c.failed}`);
  }
  return jsonOut({ ok: true, ran: rows.length, total: c.total, sent: c.sent, failed: c.failed, pending: c.pending, stopped });
}

export async function adminBulkDelete(ctx) {
  const { db, base, assoc, params } = ctx;
  const b = await D.getBatch(db, Number(params.bid));
  if (!D.canSeeBatch(assoc, ctx.user, b)) return back(base + "/admin/documents", "명단을 찾을 수 없습니다.", true);
  const c = await D.batchCounts(db, b.id);
  // 이미 나간 계약서는 지우지 않는다 — 여기서 지우는 건 '명단' 이지 계약이 아니다.
  await D.deleteBatch(db, b.id, assoc.id);
  return back(base + "/admin/documents", `명단 '${b.title}' 을 목록에서 지웠습니다.${c.sent ? ` 이미 보낸 계약 ${c.sent}건은 그대로 남아 있습니다.` : ""}`);
}
