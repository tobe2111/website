// Cloudflare Worker 진입점 — 라우팅 · 테넌트 해석 · 인증 · CSRF · 보안헤더
import { parseCookies, esc } from "./util.js";
import { SESSION_COOKIE, CSRF_COOKIE, ensureCsrfSeed, csrfToken, csrfValid, userFromToken, ROLES } from "./auth.js";
import * as D from "./db.js";
import * as apiv1 from "./apiv1.js";
import * as pages from "./pages.js";
import * as api from "./api.js";
import { setMediaBase, setOrigin, setAssetVer, layout } from "./render.js";
import { html, text, redirect, notFoundResponse, forbidden } from "./http.js";
import { ensureSchema } from "./schema.js";
import { runCron } from "./scheduled.js";
import { resolveSessionSecret } from "./secrets.js";

const _schemaReady = new WeakSet(); // DB 별 스키마 준비 캐시
const _usersConfirmed = new WeakSet(); // DB 별 "계정 존재" 확인 캐시

// 라우트: [method, pattern, handler, auth]
const GLOBAL = [
  // 전자계약 제품 · 셀프 가입 — 아래 /esign/:token 과 자리 수가 같으므로 반드시 먼저 와야 한다
  // (배열 순서대로 매칭되므로 뒤에 두면 "signup" 이 서명 토큰으로 잡힌다)
  ["GET",  "/esign/signup", pages.esignSignupForm],
  ["POST", "/esign/signup", api.esignSignup],
  // 외부(비회원) 서명 — 로그인 없이 HMAC 토큰만으로 접근. 권한 검사는 핸들러 안에서 토큰으로 한다.
  ["GET",  "/esign/:token", pages.extSignForm],
  ["GET",  "/esign/:token/paper", pages.extPaper],
  ["GET",  "/esign/:token/evidence", pages.extEvidence],
  ["POST", "/esign/:token", api.extSign],
  ["POST", "/esign/:token/decline", api.extDecline],
  ["POST", "/esign/:token/otp", api.extOtpSend],
  ["POST", "/esign/:token/otp/verify", api.extOtpVerify],
  ["GET", "/esign", pages.esignLanding],
  // 홈페이지 제작(프랜차이즈 가맹점 모집 랜딩) 제품 소개
  ["GET", "/homepage", pages.homepageLanding],
  ["GET", "/login", pages.loginForm],
  ["POST", "/login", api.login],
  ["POST", "/logout", api.logout, "USER"],
  ["GET", "/account", pages.account, "USER"],
  ["POST", "/account/password", api.changePassword, "USER"],
  ["POST", "/account/phone", api.changePhone, "USER"],
  ["POST", "/account/logout-all", api.logoutAll, "USER"],
  ["POST", "/account/2fa/setup", api.twofaSetup, "USER"],
  ["POST", "/account/2fa/enable", api.twofaEnable, "USER"],
  ["POST", "/account/2fa/disable", api.twofaDisable, "USER"],
  ["GET", "/setup", pages.setupForm],
  ["POST", "/setup", api.setupSubmit],
  ["GET", "/apply", pages.applyForm],
  ["POST", "/apply", api.applySubmit],
  ["GET", "/terms", pages.terms],
  ["GET", "/privacy", pages.privacy],
  ["GET", "/forgot", pages.forgotForm],
  ["POST", "/forgot", api.forgotPassword],
  ["GET", "/reset", pages.resetForm],
  ["POST", "/reset", api.resetPassword],
  ["GET", "/sitemap.xml", pages.sitemap],
  ["POST", "/track/call", api.trackCall],
  ["GET", "/robots.txt", pages.robots],
  ["GET", "/verify", pages.verifyPage],
  ["GET", "/verify/:code", pages.verifyPage],
  ["GET", "/certificate/:code", pages.certificatePage],
  ["GET", "/.well-known/esign-public-key", pages.esignPublicKey],
  ["GET", "/.well-known/esign-anchors", pages.esignAnchors],
  ["GET", "/super", pages.superConsole, "SUPERADMIN"],
  ["GET", "/super/org/:id", pages.superOrg, "SUPERADMIN"],
  ["POST", "/super/association", api.superCreateAssociation, "SUPERADMIN"],
  ["POST", "/super/association/clone", api.superCloneAssociation, "SUPERADMIN"],
  ["POST", "/super/association/:id/toggle", api.superToggleAssociation, "SUPERADMIN"],
  ["POST", "/super/association/:id/demo", api.superSeedDemo, "SUPERADMIN"],
  ["POST", "/super/association/:id/slug", api.superSetSlug, "SUPERADMIN"],
  ["POST", "/super/association/:id/domain", api.superSetDomain, "SUPERADMIN"],
  ["POST", "/super/association/:id/plan", api.superSetPlan, "SUPERADMIN"],
  ["POST", "/super/association/:id/mapkey", api.superSetMapKey, "SUPERADMIN"],
  ["POST", "/super/association/:id/starter", api.superSeedStarter, "SUPERADMIN"],
  ["POST", "/super/association/:id/delete", api.superDeleteAssociation, "SUPERADMIN"],
  ["POST", "/super/admin/:id/reset-password", api.superResetAdminPassword, "SUPERADMIN"],
  ["POST", "/super/credit/:id", api.superCreditApprove, "SUPERADMIN"],
  ["POST", "/super/secret-drop", api.superSecretDrop, "SUPERADMIN"],
  ["POST", "/super/notify-test", api.superNotifyTest, "SUPERADMIN"],
  ["POST", "/super/plan-prices", api.superPlanPrices, "SUPERADMIN"],
  ["POST", "/super/notify-settings", api.superNotifySettings, "SUPERADMIN"],
  ["POST", "/super/billing-mode", api.superBillingMode, "SUPERADMIN"],
  ["POST", "/super/signup-settings", api.superSignupSettings, "SUPERADMIN"],
  ["POST", "/super/association/:id/kind", api.superSetKind, "SUPERADMIN"],
  ["POST", "/super/notify-cost", api.superNotifyCost, "SUPERADMIN"],
  ["POST", "/super/association/:id/unit-price", api.superSetUnitPrice, "SUPERADMIN"],
  ["POST", "/super/esign-settings", api.superEsignSettings, "SUPERADMIN"],
  ["POST", "/super/application/:id/approve", api.approveApplication, "SUPERADMIN"],
  ["POST", "/super/application/:id/reject", api.rejectApplication, "SUPERADMIN"],
  ["POST", "/super/application/:id/stage", api.superSetApplicationStage, "SUPERADMIN"],
  ["POST", "/super/application/:id/note", api.superAddApplicationNote, "SUPERADMIN"],
  ["POST", "/super/prospect", api.superAddProspect, "SUPERADMIN"],
  ["POST", "/super/platform-mode", api.superSetPlatformMode, "SUPERADMIN"],
  ["POST", "/super/platform-info", api.superSetPlatformInfo, "SUPERADMIN"],
];
const TENANT = [
  ["GET", "/", pages.home],
  ["GET", "/businesses", pages.businesses],
  ["GET", "/business/:slug", pages.businessDetail],
  ["GET", "/map", pages.mapPage],
  ["GET", "/notices", pages.notices],
  ["GET", "/feed.xml", pages.noticesFeed],
  ["GET", "/notices/:id", pages.noticeDetail],
  ["GET", "/events", pages.events],
  ["GET", "/events/:id/calendar.ics", pages.eventIcs],
  ["POST", "/events/:id/rsvp", api.eventRsvp, "MEMBER"],
  ["POST", "/events/:id/rsvp/cancel", api.eventRsvpCancel, "MEMBER"],
  ["GET", "/polls", pages.polls, "MEMBER"],
  ["POST", "/polls/:id/vote", api.pollVote, "MEMBER"],
  ["GET", "/register", pages.registerForm],
  ["POST", "/register", api.register],
  ["GET", "/invite", pages.invitePage],
  ["POST", "/invite", api.acceptInvite],
  ["GET", "/contact", pages.contactForm],
  // 가맹 상담 신청 — 프랜차이즈 랜딩의 목적. 로그인 없이 누구나 보내는 공개 경로다.
  ["POST", "/lead", api.leadSubmit],
  // 캠페인별 랜딩 사본 (광고 소재마다 다른 문구 · 전환율 비교)
  ["GET", "/l/:slug", pages.franchiseVariant],
  ["GET", "/urdeal", pages.urdealPage],
  ["POST", "/contact", api.contactSubmit],
  ["GET", "/board", pages.board, "MEMBER"],
  ["POST", "/board", api.createPost, "MEMBER"],
  ["GET", "/board/:id", pages.postDetail, "MEMBER"],
  ["GET", "/board/:id/edit", pages.editPost, "MEMBER"],
  ["POST", "/board/:id/edit", api.updatePost, "MEMBER"],
  ["POST", "/board/:id/comment", api.createComment, "MEMBER"],
  ["POST", "/board/:id/comment/:cid/delete", api.deleteComment, "MEMBER"],
  ["POST", "/board/:id/delete", api.deletePost, "MEMBER"],
  ["POST", "/board/:id/pin", api.pinPost, "MEMBER"],
  ["GET", "/dashboard", pages.dashboard, "MERCHANT"],
  ["POST", "/dashboard/business", api.updateBusiness, "MERCHANT"],
  ["POST", "/dashboard/media", api.uploadMedia, "MERCHANT"],
  ["POST", "/dashboard/media/embed", api.addVideoEmbed, "MERCHANT"],
  ["POST", "/dashboard/media/:id/delete", api.deleteMedia, "MERCHANT"],
  ["POST", "/dashboard/products", api.productAdd, "MERCHANT"],
  ["POST", "/dashboard/products/:id", api.productUpdate, "MERCHANT"],
  ["POST", "/dashboard/products/:id/soldout", api.productToggleSoldOut, "MERCHANT"],
  ["POST", "/dashboard/products/:id/move", api.productMove, "MERCHANT"],
  ["POST", "/dashboard/products/:id/delete", api.productDelete, "MERCHANT"],
  ["POST", "/dashboard/coupons", api.couponAdd, "MERCHANT"],
  ["POST", "/dashboard/coupons/:id/delete", api.couponDelete, "MERCHANT"],
  ["POST", "/dashboard/updates", api.updateAdd, "MERCHANT"],
  ["POST", "/dashboard/updates/:id/delete", api.updateDelete, "MERCHANT"],
  ["POST", "/dashboard/dayoff", api.dayOffToggle, "MERCHANT"],
  ["GET", "/sign", pages.signList, "SIGNER"],
  ["GET", "/sign/:id", pages.signForm, "SIGNER"],
  ["POST", "/sign/:id", api.memberSign, "SIGNER"],
  ["POST", "/sign/:id/decline", api.memberDeclineSign, "SIGNER"],
  ["POST", "/sign/:id/otp", api.signOtpSend, "SIGNER"],
  ["POST", "/sign/:id/otp/verify", api.signOtpVerify, "SIGNER"],
  ["GET", "/admin", pages.admin, "ADMIN"],
  ["POST", "/admin/business/:id/status", api.adminBusinessStatus, "ADMIN"],
  ["POST", "/admin/notice", api.adminCreateNotice, "ADMIN"],
  ["POST", "/admin/notice/:id/delete", api.adminDeleteNotice, "ADMIN"],
  ["POST", "/admin/event", api.adminCreateEvent, "ADMIN"],
  ["POST", "/admin/event/:id/delete", api.adminDeleteEvent, "ADMIN"],
  ["POST", "/admin/settings", api.adminSettings, "ADMIN"],
  ["POST", "/admin/layout", api.adminSaveLayout, "ADMIN"],
  ["POST", "/admin/layout/reset", api.adminResetLayout, "ADMIN"],
  ["POST", "/admin/notifications/read", api.adminReadNotifications, "ADMIN"],
  ["POST", "/admin/user/:id/reset-password", api.adminResetUserPassword, "ADMIN"],
  ["POST", "/admin/members/add", api.adminAddMember, "ADMIN"],
  ["POST", "/admin/invite", api.adminCreateInvite, "ADMIN"],
  ["POST", "/admin/admins/add", api.adminAddAdmin, "ADMIN"],
  ["POST", "/admin/user/:id/revoke", api.adminRevokeRole, "ADMIN"],
  ["POST", "/admin/polls", api.adminCreatePoll, "ADMIN"],
  ["POST", "/admin/polls/:id/close", api.adminClosePoll, "ADMIN"],
  ["POST", "/admin/dues", api.adminDueToggle, "ADMIN"],
  ["POST", "/admin/product/:id/hide", api.adminProductHide, "ADMIN"],
  ["GET", "/admin/members.csv", pages.adminExportMembers, "ADMIN"],
  ["GET", "/admin/export.json", pages.adminExportAll, "ADMIN"],
  // 프랜차이즈: 랜딩 편집 + 상담 DB. .csv 는 경로 조각 수가 같은 :id 패턴이 없어 순서에 자유롭다.
  ["GET", "/admin/landing", pages.adminLanding, "ADMIN"],
  ["POST", "/admin/landing", api.adminSaveLanding, "ADMIN"],
  ["GET", "/admin/landing/preview", pages.adminLandingPreview, "ADMIN"],
  ["POST", "/admin/landing/publish", api.adminPublishLanding, "ADMIN"],
  ["POST", "/admin/landing/discard", api.adminDiscardLandingDraft, "ADMIN"],
  ["POST", "/admin/landing/reset", api.adminResetLanding, "ADMIN"],
  ["POST", "/admin/landing/variant", api.adminCreateLandingVariant, "ADMIN"],
  ["POST", "/admin/landing/variant/:slug/delete", api.adminDeleteLandingVariant, "ADMIN"],
  ["POST", "/admin/landing/asset", api.adminUploadLandingAsset, "ADMIN"],
  ["POST", "/admin/landing/asset/:id/delete", api.adminDeleteLandingAsset, "ADMIN"],
  ["POST", "/admin/landing/retention", api.adminSetLeadRetention, "ADMIN"],
  ["GET", "/admin/leads", pages.adminLeads, "ADMIN"],
  ["GET", "/admin/leads.csv", pages.adminLeadsCsv, "ADMIN"],
  ["POST", "/admin/leads/:id/status", api.adminLeadStatus, "ADMIN"],
  ["POST", "/admin/leads/:id/memo", api.adminLeadMemo, "ADMIN"],
  ["POST", "/admin/leads/:id/delete", api.adminLeadDelete, "ADMIN"],
  ["GET", "/admin/documents", pages.adminDocuments, "STAFF"],
  ["POST", "/admin/credit/order", api.adminCreditOrder, "ADMIN"],
  ["POST", "/admin/documents", api.adminCreateDocument, "STAFF"],
  ["GET",  "/admin/documents/new", pages.adminDocumentNew, "STAFF"],
  ["GET", "/admin/documents/:id", pages.adminDocumentDetail, "STAFF"],
  ["POST", "/admin/documents/:id/edit", api.adminEditDocument, "STAFF"],
  ["POST", "/admin/documents/:id/close", api.adminCloseDocument, "STAFF"],
  ["POST", "/admin/documents/:id/remind", api.adminRemindDocument, "STAFF"],
  ["GET",  "/admin/api", pages.adminApi, "ADMIN"],
  ["POST", "/admin/api", api.adminCreateApiKey, "ADMIN"],
  ["POST", "/admin/api/:id/revoke", api.adminRevokeApiKey, "ADMIN"],
  ["POST", "/admin/api/:id/webhook", api.adminSetWebhook, "ADMIN"],
  ["GET",  "/admin/templates", pages.adminTemplates, "STAFF"],
  ["POST", "/admin/templates", api.adminSaveTemplate, "STAFF"],
  ["POST", "/admin/templates/:id/delete", api.adminDeleteTemplate, "STAFF"],
  ["GET",  "/admin/documents/:id/fields", pages.adminDocFields, "STAFF"],
  ["POST", "/admin/documents/:id/fields", api.adminSaveFields, "STAFF"],
  ["POST", "/admin/documents/:id/external", api.adminAddExternalSigner, "STAFF"],
  ["POST", "/admin/documents/:id/external/:sid/delete", api.adminRemoveExternalSigner, "STAFF"],
  ["GET",  "/documents/:id/paper", pages.documentPaper, "MEMBER"],
  ["GET",  "/documents/:id/evidence", pages.documentEvidence, "MEMBER"],
];

function matchRoute(routes, method, path) {
  for (const [m, pattern, handler, auth] of routes) {
    if (m !== method) continue;
    const params = matchPath(pattern, path);
    if (params) return { handler, auth, params };
  }
  return null;
}
function matchPath(pattern, path) {
  const pp = pattern.split("/"), sp = path.split("/");
  if (pp.length !== sp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
    else if (pp[i] !== sp[i]) return null;
  }
  return params;
}

function resolveTenant(env, hostname, pathname) {
  const bd = (env.BASE_DOMAIN || "").toLowerCase();
  if (bd && hostname.endsWith("." + bd)) {
    const label = hostname.slice(0, -(bd.length + 1)).split(".")[0];
    if (label && label !== "www") return { slug: label, subpath: pathname || "/", base: "" };
  }
  const m = /^\/t\/([^/]+)(\/.*)?$/.exec(pathname);
  if (m) return { slug: decodeURIComponent(m[1]), subpath: m[2] || "/", base: "/t/" + m[1] };
  return null;
}

function securityHeaders(env) {
  // 네이버 지도 SDK 는 oapi 로더 외에 *.pstatic.net 에서 스타일 스크립트(JSONP)도 로드함.
  // 상인회별 지도 키(map_client_id)만 있고 공용 키가 비어 있어도 동작해야 하므로 항상 허용.
  const naver = " https://oapi.map.naver.com https://*.pstatic.net";
  const naverImg = " https://*.pstatic.net https://*.map.naver.com";
  const ts = env.TURNSTILE_SITE_KEY ? " https://challenges.cloudflare.com" : "";
  const cfa = env.CF_ANALYTICS_TOKEN ? " https://static.cloudflareinsights.com" : "";
  const cfaConn = env.CF_ANALYTICS_TOKEN ? " https://cloudflareinsights.com" : "";
  const csp = [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'self'", "form-action 'self'",
    `script-src 'self'${naver}${ts}${cfa}`, "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "img-src 'self' data: https:", "media-src 'self' https:",
    `frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://www.instagram.com https://tv.naver.com${ts}`,
    `connect-src 'self'${naver}${naverImg}${ts}${cfaConn}`, "font-src 'self' https://cdn.jsdelivr.net",
  ].join("; ");
  return {
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    // HTTPS 강제 1년 (workers.dev·커스텀 도메인 모두 HTTPS 전용 운영)
    "Strict-Transport-Security": "max-age=31536000",
    "Content-Security-Policy": csp,
  };
}

function authorize(user, auth, assoc) {
  if (!auth) return true;
  if (!user) return "/login?err=1&msg=" + encodeURIComponent("로그인이 필요합니다.");
  if (auth === "USER") return true;
  if (auth === "SUPERADMIN") return user.role === ROLES.SUPERADMIN;
  const own = assoc && user.association_id === assoc.id; // 이 조직 소속인가
  // ADMIN — 설정·API 키·과금·담당자 관리. 조직의 주인만.
  if (auth === "ADMIN") return user.role === ROLES.SUPERADMIN || (user.role === ROLES.ADMIN && own);
  // STAFF — 계약 업무(문서·서식·외부 서명자). 관리자는 담당자가 하는 것을 당연히 할 수 있다.
  if (auth === "STAFF") return user.role === ROLES.SUPERADMIN || ((user.role === ROLES.ADMIN || user.role === ROLES.STAFF) && own);
  // SIGNER — 서명. 이 조직 소속이면 역할과 무관하게 들어올 수 있다(계약을 만든 사람도 서명해야 한다).
  //   실제로 그 문서의 대상인지는 canReceiveSign 이 판정한다.
  //   SUPERADMIN 은 일부러 제외한다 — 남의 조직 계약에 플랫폼 운영자의 서명이 남으면 안 된다.
  if (auth === "SIGNER") return !!own;
  // MERCHANT — 업체 관리(상인회 전용). 점포주 본인만.
  if (auth === "MERCHANT") return user.role === ROLES.MERCHANT && own;
  if (auth === "MEMBER") return user.role === ROLES.SUPERADMIN || own;
  return false;
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      console.error(e && e.stack || e); // 상세는 로그로만 (wrangler tail / 대시보드)
      // 운영자(슈퍼 관리자)에게는 오류 요지를 화면에 보여 줍니다.
      // 로그를 볼 수 없는 환경에서 "일시적인 오류" 만 뜨면 원인을 좁힐 방법이 없습니다.
      // 일반 방문자에게는 종전대로 아무것도 노출하지 않습니다.
      let detail = "";
      try {
        const tok = parseCookies(request.headers.get("cookie") || "")[SESSION_COOKIE];
        if (tok) {
          const secret = await resolveSessionSecret(env);
          const u = await userFromToken(env.DB, tok, secret);
          if (u && u.role === ROLES.SUPERADMIN) {
            const msg = String((e && e.message) || e).slice(0, 400);
            const at = String((e && e.stack) || "").split("\n").slice(1, 4).join("\n").slice(0, 600);
            detail = `<pre style="max-width:820px;margin:24px auto;text-align:left;white-space:pre-wrap;word-break:break-all;background:#f6f4ef;border:1px solid #e0dbcf;border-radius:10px;padding:16px;font-size:.85rem;line-height:1.6">${esc(msg)}${at ? "\n\n" + esc(at) : ""}</pre>
              <p style="color:#888;font-size:.85rem">이 상세 내용은 슈퍼 관리자에게만 보입니다.</p>`;
          }
        }
      } catch {}
      return html(`<section style="text-align:center;padding:80px 20px;font-family:system-ui">
        <h1 style="font-size:2rem">일시적인 오류가 발생했습니다</h1>
        <p style="color:#666">잠시 후 다시 시도해 주세요.</p>
        <p><a href="/" style="color:#0b6e4f;font-weight:700">홈으로</a></p>${detail}</section>`, 500);
    }
  },
  // 주간 정기 작업 (wrangler.toml [triggers].crons) — 암호화 백업 + 운영 리포트 메일
  async scheduled(event, env, ctx) {
    await ensureSchema(env.DB);
    const full = { ...env, SESSION_SECRET: await resolveSessionSecret(env) };
    // 분기와 실행 기록은 runCron 안에 있다 — 크론이 돌았다는 사실 자체를 남겨야
    // 등록이 안 됐을 때 화면에서 알아챌 수 있다(예전엔 몇 달을 몰랐다).
    ctx.waitUntil(runCron(event.cron, full));
  },
};

async function handle(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const canon = url.origin + url.pathname; // 표준 URL(쿼리 제외) — finalize 에서 <link rel=canonical> 주입
  const timing = { t0: Date.now(), db: { n: 0, ms: 0 } };
  const rawDb = env.DB;
  const db = instrumentDb(rawDb, timing.db);
  env = { ...env, DB: db }; // 핸들러 내부 D1 사용도 계측에 포함
  const isProd = (env.PUBLIC_SCHEME || "https") === "https";
  setMediaBase(env.MEDIA_PUBLIC_BASE || "");
  setOrigin(url.origin); // og:image 등 절대 URL 조립용
  // 배포 버전을 CSS/JS 주소에 붙여 옛 캐시 자동 무력화 (배포마다 새 주소)
  setAssetVer(env.CF_VERSION_METADATA && env.CF_VERSION_METADATA.id);

  // 정적 자산 (css/js/img/아이콘/PWA)
  if (/^\/(css|js|img|favicon)/.test(pathname) || pathname === "/manifest.webmanifest" || pathname === "/sw.js") {
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(request);
      // ?v= 버전 주소 = 배포마다 바뀜 → 1년 불변 캐시. 무버전 주소 = 매번 재검증(옛 캐시 자가치유).
      const h = new Headers(res.headers);
      h.set("Cache-Control", url.searchParams.has("v") ? "public, max-age=31536000, immutable" : "no-cache");
      return new Response(res.body, { status: res.status, headers: h });
    }
  }
  // R2 미디어 서빙 (퍼블릭 base 미설정 시 워커 경유)
  if (pathname.startsWith("/media/")) return serveMedia(env, pathname.slice("/media/".length));

  // Speculation Rules — 지원 브라우저(크롬 계열)가 링크에 마우스를 올리면 다음 페이지를 미리 받아
  // 클릭 시 즉시 표시. 전용 MIME 이 필수라 정적 자산이 아닌 여기서 직접 서빙.
  if (pathname === "/speculationrules.json") {
    return new Response(JSON.stringify({
      // 인증·개인·대용량 경로는 선로딩 제외 — 호버마다 D1 무거운 렌더가 낭비되고 개인 페이지 프리페치는 부적절
      prefetch: [{ where: { and: [{ href_matches: "/*" }, { not: { href_matches: ["/logout", "/*/admin*", "/*/dashboard*", "/*/polls*", "/*/board*", "/*/sign*", "/*/invite*", "/admin*", "/dashboard*", "/super*", "/account*", "/*.csv", "/*.json", "/*.ics", "/*.xml"] } }] }, eagerness: "moderate" }],
    }), { headers: { "content-type": "application/speculationrules+json", "cache-control": "public, max-age=86400" } });
  }

  // 최초 실행: 표 자동 생성 + 세션 시크릿 자동 확보 (시크릿·스키마 명령 불필요)
  if (!_schemaReady.has(rawDb)) { await ensureSchema(db); _schemaReady.add(rawDb); }
  // 워커 Secret 으로 들어온 값인지 D1 에서 자동 생성된 값인지는 여기서만 구분할 수 있다.
  // (아래부터는 항상 채워진 상태라 핸들러에서는 출처를 알 수 없다.) 값이 아니라 사실만 넘긴다.
  const secretFromWorker = !!(env.SESSION_SECRET && env.SESSION_SECRET !== "");
  env = { ...env, SESSION_SECRET: await resolveSessionSecret(env), SESSION_SECRET_IS_WORKER: secretFromWorker };

  // 설치 마법사 게이트: 계정이 하나도 없으면 /setup 으로 유도
  if (!_usersConfirmed.has(rawDb)) {
    if ((await D.countUsers(db)) > 0) _usersConfirmed.add(rawDb);
    else if (pathname !== "/setup") return finalize(redirect("/setup"), [], env, timing);
  }

  const cookies = parseCookies(request.headers.get("cookie") || "");
  const setCookies = [];
  const addCookie = (c) => setCookies.push(c);
  const seed = ensureCsrfSeed(cookies, isProd, addCookie);
  const csrf = await csrfToken(seed, env.SESSION_SECRET);
  const user = await userFromToken(db, cookies[SESSION_COOKIE], env.SESSION_SECRET);
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "?";

  // 공개 API — 폼·CSRF·세션 체계 밖이다. 인증은 Bearer 키로만 하고 본문은 JSON 이므로
  // 아래의 formData() 파싱·CSRF 검사보다 먼저 갈라져야 한다.
  if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
    const res = await apiv1.handle({ env, db, url, request, ip });
    return finalize(res, setCookies, env, timing);
  }

  // 폼 파싱(POST)
  let form = null;
  if (request.method === "POST") {
    try { form = await request.formData(); } catch { form = new FormData(); }
    if (!(await csrfValid(seed, form.get("_csrf"), env.SESSION_SECRET)))
      return finalize(html("<h1>403 잘못된 요청(CSRF)</h1>", 403), setCookies, env, timing);
  }

  const baseCtx = { env, db, url, query: url.searchParams, user, csrf, form, addCookie, isProd, ip, request };

  // 테넌트 라우트 — ① BASE_DOMAIN 서브도메인/경로(/t/:slug) ② 상인회별 개별 도메인(custom_domain)
  let t = resolveTenant(env, url.hostname, pathname);
  let assocPre = null;
  if (!t) {
    assocPre = await D.getAssociationByDomain(db, url.hostname);
    if (assocPre) t = { slug: assocPre.slug, subpath: pathname || "/", base: "" };
  }
  if (t) {
    const assoc = assocPre || (await D.getAssociationBySlug(db, t.slug));
    if (!assoc) {
      // 옛 주소로 들어왔으면 새 주소로 영구 이동 — 이미 나간 알림톡 버튼·명함 링크가 죽지 않는다
      const moved = await D.getAssociationByAlias(db, t.slug);
      if (moved && (moved.active || (user && user.role === ROLES.SUPERADMIN)))
        return finalize(redirect(`/t/${moved.slug}${t.subpath === "/" ? "" : t.subpath}${url.search}`, 301),
          setCookies, env, timing);
    }
    if (!assoc || (!assoc.active && !(user && user.role === ROLES.SUPERADMIN)))
      return finalize(notFoundResponse({ base: t.base }), setCookies, env, timing);
    assoc._base = t.base;
    // 개별 도메인이 있으면 표준 URL 을 그 도메인으로 고정 → workers.dev/t/:slug 사본이 개별 도메인으로 정규화(교차 호스트 중복 제거)
    const tCanon = assoc.custom_domain && url.hostname !== assoc.custom_domain
      ? `https://${assoc.custom_domain}${t.subpath}`
      : canon;
    const route = matchRoute(TENANT, request.method, t.subpath);
    if (route) {
      const ok = authorize(user, route.auth, assoc);
      if (ok !== true) return finalize(typeof ok === "string" ? redirect(ok) : forbidden(), setCookies, env, timing);
      const res = await route.handler({ ...baseCtx, assoc, base: t.base, params: route.params });
      return finalize(res, setCookies, env, timing, tCanon);
    }
    // 테넌트 경로에 없으면 전역 라우트 폴백 (개별 도메인·서브도메인에서 /login, /verify, /sitemap.xml 등)
    const gt = matchRoute(GLOBAL, request.method, t.subpath);
    if (gt) {
      const ok = authorize(user, gt.auth, assoc);
      if (ok !== true) return finalize(typeof ok === "string" ? redirect(ok) : forbidden(), setCookies, env, timing);
      const res = await gt.handler({ ...baseCtx, assoc, base: t.base, params: gt.params });
      return finalize(res, setCookies, env, timing, tCanon);
    }
    return finalize(notFoundResponse({ assoc, base: t.base }), setCookies, env, timing);
  }

  // 전역 라우트
  // ⚠️ 여기에 권한 검사가 빠져 있었습니다. 테넌트 분기 두 곳에는 authorize() 가 있는데
  //    이 분기에만 없어서, 플랫폼 도메인에서 /super · /account 같은 인증 경로가 무방비였습니다.
  //    (로그인하지 않아도 /super 가 그대로 열렸습니다.) 같은 검사를 반드시 통과시킵니다.
  const g = matchRoute(GLOBAL, request.method, pathname);
  if (g) {
    const ok = authorize(user, g.auth, null);
    if (ok !== true) return finalize(typeof ok === "string" ? redirect(ok) : forbidden(), setCookies, env, timing);
    const res = await g.handler({ ...baseCtx, params: g.params });
    return finalize(res, setCookies, env, timing, canon);
  }

  // 루트: 플랫폼 모드면 랜딩 / 아니면 상인회 1곳이면 그 홈으로 바로 이동
  if (pathname === "/") {
    const platformMode = (await D.getSetting(db, "platform_mode")) === "1";
    if (!platformMode) {
      const list = await D.listActiveAssociations(db);
      if (list.length === 1) return finalize(redirect(`/t/${list[0].slug}`), setCookies, env, timing);
    }
    return finalize(await pages.platformLanding(baseCtx), setCookies, env, timing, canon);
  }

  return finalize(notFoundResponse({}), setCookies, env, timing);
}

async function serveMedia(env, key) {
  if (!env.MEDIA) return new Response("Not Found", { status: 404 }); // R2 미연결 시
  key = key.replace(/[^A-Za-z0-9._-]/g, "");
  if (!key) return new Response("Not Found", { status: 404 });
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response("Not Found", { status: 404 });
  const headers = new Headers();
  if (obj.httpMetadata && obj.httpMetadata.contentType) headers.set("content-type", obj.httpMetadata.contentType);
  // 파일명이 콘텐츠 고유(랜덤) → 1년 불변 캐시. Cloudflare 엣지·브라우저가 캐시해 R2 읽기·워커 요청 절감.
  headers.set("cache-control", "public, max-age=31536000, immutable");
  if (obj.httpEtag) headers.set("etag", obj.httpEtag);
  return new Response(obj.body, { headers });
}

// 보안 헤더 + 쿠키 부착 (+ 선택: Cloudflare Web Analytics 주입)
// D1 계측: 요청당 쿼리 수·소요 시간 집계 (Server-Timing 으로 노출 → 개발자도구에서 병목 확인)
function instrumentDb(db, acc) {
  const wrapStmt = (stmt) => ({
    bind: (...a) => wrapStmt(stmt.bind(...a)),
    first: async (...a) => { const t0 = Date.now(); try { return await stmt.first(...a); } finally { acc.n++; acc.ms += Date.now() - t0; } },
    all: async (...a) => { const t0 = Date.now(); try { return await stmt.all(...a); } finally { acc.n++; acc.ms += Date.now() - t0; } },
    run: async (...a) => { const t0 = Date.now(); try { return await stmt.run(...a); } finally { acc.n++; acc.ms += Date.now() - t0; } },
  });
  return { prepare: (sql) => wrapStmt(db.prepare(sql)) };
}

async function finalize(res, setCookies, env, timing, canonical = "") {
  const headers = new Headers(res.headers);
  const sec = securityHeaders(env);
  for (const [k, v] of Object.entries(sec)) headers.set(k, v);
  const isHtml = (headers.get("content-type") || "").includes("text/html");
  // 호버 시 다음 페이지 선(先)로딩 — 지원 브라우저만 반응, 나머지는 무시
  if (isHtml) headers.set("Speculation-Rules", '"/speculationrules.json"');
  if (timing) headers.set("Server-Timing",
    `db;dur=${timing.db.ms};desc="D1 ${timing.db.n} queries", app;dur=${Date.now() - timing.t0};desc="worker total"`);
  for (const c of setCookies) headers.append("set-cookie", c);
  let body = res.body;
  // 표준 URL(canonical) + 웹분석 비콘을 최종 HTML 에 주입 (둘 중 하나라도 필요할 때만 버퍼링).
  // canonical = 오리진+경로(쿼리 제외) → ?err=·?page=·?category= 같은 중복 URL 을 하나로 정규화.
  const needCanon = canonical && isHtml;
  const needBeacon = env.CF_ANALYTICS_TOKEN && isHtml;
  if (needCanon || needBeacon) {
    let t = await res.text();
    if (needCanon && !/rel=["']canonical["']/.test(t)) {
      const tag = `<link rel="canonical" href="${canonical.replace(/"/g, "%22")}" />`;
      if (t.includes("</head>")) t = t.replace("</head>", tag + "</head>");
    }
    if (needBeacon) {
      const beacon = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${env.CF_ANALYTICS_TOKEN}"}'></script>`;
      t = t.includes("</body>") ? t.replace("</body>", beacon + "</body>") : t + beacon;
    }
    body = t;
    headers.delete("content-length");
  }
  return new Response(body, { status: res.status, headers });
}
