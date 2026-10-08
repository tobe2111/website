// Cloudflare Worker 진입점 — 라우팅 · 테넌트 해석 · 인증 · CSRF · 보안헤더
import { parseCookies, esc, safeNext } from "./util.js";
import { SESSION_COOKIE, CSRF_COOKIE, ensureCsrfSeed, csrfToken, csrfValid, userFromToken, ROLES } from "./auth.js";
import * as D from "./db.js";
import * as apiv1 from "./apiv1.js";
import * as pages from "./pages.js";
import * as api from "./api.js";
import { setMediaBase, setOrigin, setAssetVer, layout } from "./render.js";
import { html, text, redirect, notFoundResponse, forbidden } from "./http.js";
import { kindOf } from "./kinds.js";
import { ensureSchema } from "./schema.js";
import { withStoredKeys } from "./keys.js";
import { runCron } from "./scheduled.js";
import { resolveSessionSecret } from "./secrets.js";

// 나가는 스타일시트에서 주석만 뗀다(아이솔레이트마다 한 번).
//
// 문자열이나 url() 안에 `/*` 가 들어 있으면 이 정규식이 엉뚱한 데를 자르는데,
// app.css 에는 그런 자리가 없음을 확인했고 csshealth 시험이 중괄호 균형을 계속 지킨다.
const CSS_LEAN = new Map();
const stripCssComments = (css) => String(css).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n{3,}/g, "\n\n");

const _schemaReady = new WeakSet(); // DB 별 스키마 준비 캐시
const _usersConfirmed = new WeakSet(); // DB 별 "계정 존재" 확인 캐시

// 라우트: [method, pattern, handler, auth]
//
// 두 표를 내보내는 이유: 판매 전 QA(qa-drill)가 **라우트를 하나씩 전부 두드려**
// 인증이 빠진 곳이 없는지 본다. 라우트가 200줄 가까이 되면, 새 줄에 auth 를 빠뜨리는 것이
// 가장 흔한 사고인데 그건 사람 눈으로는 안 잡힌다.
export const GLOBAL = [
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
  // 카카오 로그인 — 시작(GET)·되돌아오기(GET)·연결 해제(POST).
  // 되돌아오는 주소는 카카오 콘솔에 도메인마다 한 줄씩 등록해 둔다: https://<도메인>/auth/kakao/callback
  ["GET",  "/auth/kakao", api.kakaoStart],
  ["GET",  "/auth/kakao/callback", api.kakaoCallback],
  ["POST", "/account/kakao/unlink", api.kakaoUnlink, "USER"],
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
  ["POST", "/super/notify-sync", api.superSyncTemplates, "SUPERADMIN"],
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
  ["POST", "/super/keys", api.superSetKeys, "SUPERADMIN"],
];
export const TENANT = [
  ["GET", "/", pages.home],
  ["GET", "/businesses", pages.businesses],
  ["GET", "/business/:slug", pages.businessDetail],
  ["GET", "/map", pages.mapPage],
  ["GET", "/notices", pages.notices],
  ["GET", "/feed.xml", pages.noticesFeed],
  ["GET", "/notices/:id", pages.noticeDetail],
  ["GET", "/events", pages.events],
  ["GET", "/events/:id/calendar.ics", pages.eventIcs],
  ["GET", "/events/:id", pages.eventDetail],
  ["POST", "/events/:id/rsvp", api.eventRsvp, "MEMBER"],
  ["POST", "/events/:id/rsvp/cancel", api.eventRsvpCancel, "MEMBER"],
  ["GET", "/polls", pages.polls, "MEMBER"],
  ["POST", "/polls/:id/vote", api.pollVote, "MEMBER"],
  ["POST", "/polls/:id/otp", api.pollOtpSend, "MEMBER"],
  ["POST", "/polls/:id/otp/verify", api.pollOtpVerify, "MEMBER"],
  // 로그인 없이 한 표 — 토큰이 곧 권한이다(사진 요청 링크와 같은 방식)
  // 단톡방에 뿌리는 링크 하나 — 사람이 아니라 안건만 든 토큰이라, 누르면 투표가 아니라
  // 명부 대조가 먼저 뜬다. (토막 수가 달라 /vote/:token 과 섞이지 않는다)
  ["GET", "/vote/g/:token", pages.rosterVotePage],
  ["POST", "/vote/g/:token", api.rosterVoteMatch],
  ["GET", "/vote/:token", pages.votePage],
  ["POST", "/vote/:token", api.voteByLink],
  ["GET", "/register", pages.registerForm],
  ["POST", "/register", api.register],
  ["POST", "/photos/upload", api.ownerPhotoUpload],
  ["POST", "/photos/hours", api.ownerHoursUpdate],
  ["GET", "/photos/:token", pages.ownerPhotoPage],
  ["GET", "/invite", pages.invitePage],
  ["POST", "/invite", api.acceptInvite],
  ["GET", "/contact", pages.contactForm],
  // 간편동의서 — 로그인 없이 링크만으로 연다. 토큰이 곧 주소다.
  ["GET", "/consent/:token", pages.consentForm],
  ["POST", "/consent/:token", api.consentSubmit],
  // 가맹 상담 신청 — 프랜차이즈 랜딩의 목적. 로그인 없이 누구나 보내는 공개 경로다.
  ["POST", "/lead", api.leadSubmit],
  // 사본 주소 — 모집 랜딩은 광고 소재별 문구, 상인회는 홈 구성 A/B (성과를 나란히 비교한다)
  ["GET", "/l/:slug", pages.tenantVariant],
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
  ["POST", "/dashboard/urdeal", api.setMyUrdealSeller, "MERCHANT"],
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
  ["POST", "/dashboard/coupons/:id/use", api.couponUse, "MERCHANT"],
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
  // 관리자가 점포 정보를 대신 채운다 (사장님이 로그인하기 전에 명단을 세팅하는 경로)
  ["GET",  "/admin/business/:id", pages.adminBusinessEdit, "ADMIN"],
  ["POST", "/admin/business/:id", api.adminUpdateBusiness, "ADMIN"],
  ["GET",  "/admin/place-search", api.adminPlaceSearch, "ADMIN"],
  ["GET",  "/admin/image-search", api.adminImageSearch, "ADMIN"],
  // 사장님이 카톡으로 보내 온 사진·릴스를 관리자가 대신 올린다
  ["POST", "/admin/business/:id/media", api.adminUploadMedia, "ADMIN"],
  ["POST", "/admin/business/:id/photos/import", api.adminImportPhotos, "ADMIN"],
  ["POST", "/admin/business/:id/photos/urdeal", api.adminImportUrdealPhotos, "ADMIN"],
  ["POST", "/admin/business/:id/photos/place", api.adminImportPlacePhoto, "ADMIN"],
  ["POST", "/admin/business/:id/photo-link", api.adminCreatePhotoLink, "ADMIN"],
  ["POST", "/admin/user/:id/officer", api.adminSetOfficer, "ADMIN"],
  ["POST", "/admin/business/:id/embed", api.adminAddEmbed, "ADMIN"],
  ["POST", "/admin/business/:id/media/:mid/delete", api.adminDeleteMedia, "ADMIN"],
  // 이메일 없이 등록해 둔 사장님에게 나중에 로그인 주소를 지정한다
  ["POST", "/admin/business/:id/owner-email", api.adminSetOwnerEmail, "ADMIN"],
  ["POST", "/admin/business/:id/owner-phone", api.adminSetOwnerPhone, "ADMIN"],
  ["POST", "/admin/notice", api.adminCreateNotice, "ADMIN"],
  ["POST", "/admin/notice/:id", api.adminUpdateNotice, "ADMIN"],
  ["POST", "/admin/notice/:id/delete", api.adminDeleteNotice, "ADMIN"],
  ["POST", "/admin/notices/bulk", api.adminNoticesBulk, "ADMIN"],
  ["POST", "/admin/event", api.adminCreateEvent, "ADMIN"],
  ["POST", "/admin/event/:id", api.adminUpdateEvent, "ADMIN"],
  ["GET", "/admin/event/:id/rsvps.csv", pages.adminExportRsvps, "ADMIN"],
  ["POST", "/admin/event/:id/delete", api.adminDeleteEvent, "ADMIN"],
  ["POST", "/admin/events/bulk", api.adminEventsBulk, "ADMIN"],
  // 손님이 보는 '언론 속의 우리 골목' 전체 목록. 홈 구역은 여섯 건까지라
  // 올린 기사가 더 많으면 나머지를 볼 자리가 없었다.
  ["GET", "/press", pages.pressList],
  // 언론 속 우리 골목 — 수집은 크론이, 게시 판단은 이 화면이 한다
  ["GET", "/admin/press", pages.adminPress, "ADMIN"],
  ["POST", "/admin/press/settings", api.adminPressSettings, "ADMIN"],
  ["POST", "/admin/press/bulk", api.adminPressBulk, "ADMIN"],
  ["POST", "/admin/press/collect", api.adminPressCollect, "ADMIN"],
  ["POST", "/admin/popup", api.adminCreatePopup, "ADMIN"],
  ["POST", "/admin/popup/:id/delete", api.adminDeletePopup, "ADMIN"],
  ["POST", "/admin/popup/:id/toggle", api.adminTogglePopup, "ADMIN"],
  ["POST", "/admin/settings", api.adminSettings, "ADMIN"],
  ["POST", "/admin/layout", api.adminSaveLayout, "ADMIN"],
  ["POST", "/admin/layout/reset", api.adminResetLayout, "ADMIN"],
  // 상인회 홈 A/B — 사본 만들기·지우기
  ["POST", "/admin/notifications/read", api.adminReadNotifications, "ADMIN"],
  ["POST", "/admin/user/:id/reset-password", api.adminResetUserPassword, "ADMIN"],
  ["POST", "/admin/members/add", api.adminAddMember, "ADMIN"],
  // 명부 붙여넣기 화면은 GET·POST 를 둘 다 pages 가 받는다. 이 화면의 본체가 '미리보기'라
  // POST 의 결과도 표로 그려야 하기 때문이다. 실제로 쓰는 일은 api.importMemberRows 가 한다.
  ["GET", "/admin/members/import", pages.adminMembersImport, "ADMIN"],
  ["GET", "/admin/members/map", pages.adminMembersMap, "ADMIN"],
  ["GET", "/admin/members/photos", pages.adminMembersPhotos, "ADMIN"],
  ["GET", "/admin/members/links", pages.adminMembersLinks, "ADMIN"],
  ["POST", "/admin/members/links/alimtalk", api.adminAskPhotosAlimtalk, "ADMIN"],
  ["POST", "/admin/members/map/naver", api.adminLinkNaverBulk, "ADMIN"],
  ["GET", "/admin/members/hours", pages.adminMembersHours, "ADMIN"],
  ["POST", "/admin/members/hours", api.adminHoursBulk, "ADMIN"],
  ["POST", "/admin/members/guess-categories", api.adminGuessCategories, "ADMIN"],
  ["POST", "/admin/members/photos", pages.adminMembersPhotos, "ADMIN"],
  ["POST", "/admin/members/map", pages.adminMembersMap, "ADMIN"],
  ["POST", "/admin/members/import", pages.adminMembersImport, "ADMIN"],
  ["POST", "/admin/invite", api.adminCreateInvite, "ADMIN"],
  ["POST", "/admin/admins/add", api.adminAddAdmin, "ADMIN"],
  ["POST", "/admin/user/:id/revoke", api.adminRevokeRole, "ADMIN"],
  // 부서 — 인사팀의 근로계약서가 영업팀 화면에 뜨지 않게 하는 경계. 조직의 주인만 손댄다.
  ["POST", "/admin/teams/add", api.adminAddTeam, "ADMIN"],
  ["POST", "/admin/teams/:id/rename", api.adminRenameTeam, "ADMIN"],
  ["POST", "/admin/teams/:id/delete", api.adminDeleteTeam, "ADMIN"],
  ["POST", "/admin/teams/scope", api.adminTeamScope, "ADMIN"],
  ["POST", "/admin/user/:id/team", api.adminSetUserTeam, "ADMIN"],
  ["POST", "/admin/polls", api.adminCreatePoll, "ADMIN"],
  ["GET", "/admin/polls/verify", pages.adminPollVerify, "ADMIN"],
  ["GET", "/admin/polls/:id/links", pages.adminPollLinks, "ADMIN"],
  ["GET", "/admin/polls/:id/minutes.csv", pages.adminPollMinutesCsv, "ADMIN"],
  ["GET", "/admin/polls/:id/minutes", pages.adminPollMinutes, "ADMIN"],
  ["POST", "/admin/member/:id/verify", api.adminMemberVerify, "ADMIN"],
  ["POST", "/admin/polls/:id/close", api.adminClosePoll, "ADMIN"],
  ["POST", "/admin/polls/:id/reopen", api.adminReopenPoll, "ADMIN"],
  ["POST", "/admin/polls/:id/delete", api.adminDeletePoll, "ADMIN"],
  ["POST", "/admin/polls/:id", api.adminUpdatePoll, "ADMIN"],
  ["POST", "/admin/dues", api.adminDueToggle, "ADMIN"],
  ["POST", "/admin/dues/amount", api.adminDuesAmount, "ADMIN"],
  ["POST", "/admin/dues/account", api.adminDuesAccount, "ADMIN"],
  ["POST", "/admin/dues/enabled", api.adminDuesEnabled, "ADMIN"],
  ["POST", "/admin/dues/remind", api.adminDuesRemind, "ADMIN"],
  ["POST", "/admin/consent-form", api.adminConsentFormSave, "ADMIN"],
  ["POST", "/admin/consent-form/:id/toggle", api.adminConsentFormToggle, "ADMIN"],
  ["POST", "/admin/consent-form/:id/delete", api.adminConsentFormDelete, "ADMIN"],
  ["GET", "/admin/consent-form/:id/qr", pages.adminConsentQr, "ADMIN"],
  ["POST", "/admin/consent-form/:id", api.adminConsentFormSave, "ADMIN"],
  ["POST", "/admin/consent/:id/approve", api.adminConsentApprove, "ADMIN"],
  ["POST", "/admin/consent/:id/reject", api.adminConsentReject, "ADMIN"],
  ["GET", "/admin/consents.csv", pages.adminExportConsents, "ADMIN"],
  ["GET", "/admin/dues/unpaid.csv", pages.adminExportUnpaid, "ADMIN"],
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
  ["POST", "/admin/notify-auto", api.adminNotifyAuto, "ADMIN"],
  ["POST", "/admin/documents", api.adminCreateDocument, "STAFF"],
  ["GET",  "/admin/documents/new", pages.adminDocumentNew, "STAFF"],
  // 계약서 작성기 — 조·항·호를 눌러 넣고 오른쪽에서 실제 지면을 보며 쓴다.
  // 미리보기는 서버가 그린다: 지면 줄바꿈은 서버가 확정하므로, 화면에서 따로 그리면
  // 미리보기와 실제 계약서가 다른 자리에서 끊긴다.
  ["GET",  "/admin/documents/write", pages.adminDocumentWrite, "STAFF"],
  ["POST", "/admin/documents/preview", api.adminPreviewPaper, "STAFF"],
  ["POST", "/admin/documents/draft", api.adminSaveDraft, "STAFF"],
  ["POST", "/admin/documents/:id/fill", api.adminFillBlanks, "STAFF"],
  ["POST", "/admin/documents/:id/publish", api.adminPublishDraft, "STAFF"],
  ["POST", "/admin/documents/:id/draft-delete", api.adminDeleteDraft, "STAFF"],
  // 대량 발송 — 명단 한 장으로 사람마다 한 부씩. 실제 발송은 /admin/bulk/:bid 에서 나눠 돈다.
  ["GET",  "/admin/documents/:id/bulk", pages.adminDocBulk, "STAFF"],
  ["POST", "/admin/documents/:id/bulk", api.adminBulkPrepare, "STAFF"],
  ["GET",  "/admin/documents/:id/bulk/sample", api.adminBulkSample, "STAFF"],
  ["GET",  "/admin/bulk/:bid", pages.adminBulkView, "STAFF"],
  ["GET",  "/admin/bulk/:bid/ledger", pages.adminBulkLedger, "STAFF"],
  ["POST", "/admin/bulk/:bid/run", api.adminBulkRun, "STAFF"],
  ["POST", "/admin/bulk/:bid/delete", api.adminBulkDelete, "STAFF"],
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
  // 우리 직인(법인 인감) — 회사 도장이라 담당자가 아니라 관리자만 올리고 지운다
  ["POST", "/admin/seal", api.adminSaveSeal, "ADMIN"],
  ["POST", "/admin/seal/delete", api.adminDeleteSeal, "ADMIN"],
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

function securityHeaders(env, opts = {}) {
  // 네이버 지도 SDK 는 oapi 로더 외에 *.pstatic.net 에서 스타일 스크립트(JSONP)도 로드함.
  // 상인회별 지도 키(map_client_id)만 있고 공용 키가 비어 있어도 동작해야 하므로 항상 허용.
  const naver = " https://oapi.map.naver.com https://*.pstatic.net";
  const naverImg = " https://*.pstatic.net https://*.map.naver.com";
  const ts = env.TURNSTILE_SITE_KEY ? " https://challenges.cloudflare.com" : "";
  // Cloudflare 웹 분석 — 토큰을 우리가 넣지 않아도, 도메인을 Cloudflare 에 붙이면
  // 엣지가 beacon.min.js 를 응답에 **자동으로 끼워 넣는다**(대시보드의 자동 설정).
  // 그래서 토큰이 있을 때만 열어 두면, 개별 도메인을 연결한 그날부터 콘솔이
  // "beacon.min.js 가 CSP 에 막혔다" 로 뒤덮인다. 우리가 넣지 않은 스크립트가
  // 우리 CSP 위반으로 잡히는 셈이라, 진짜 오류가 그 사이에 묻힌다.
  // Cloudflare 자체 도메인 하나만 여는 것이므로 열어 둔다.
  const cfa = " https://static.cloudflareinsights.com";
  const cfaConn = " https://cloudflareinsights.com";
  // 구글 애널리틱스 — 측정 ID 를 넣어 둔 조직의 화면에서만 문을 엽니다.
  // 정책을 전 조직에 한 번에 열어 두면, 애널리틱스를 안 쓰는 상인회까지 구글 도메인에서
  // 스크립트를 받을 수 있는 상태가 됩니다. 쓰는 곳에서만, 쓰는 만큼만 엽니다.
  const ga = opts.ga ? " https://www.googletagmanager.com" : "";
  const gaConn = opts.ga ? " https://www.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com" : "";
  const csp = [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'self'", "form-action 'self'",
    `script-src 'self'${naver}${ts}${cfa}${ga}`, "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    // blob: — PDF 양식을 쪽 그림으로 굽는 화면에서 미리보기를 그린다(우리 스크립트가 만든 같은 출처 값).
    "img-src 'self' data: blob: https:", "media-src 'self' https:",
    `frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://www.instagram.com https://tv.naver.com${ts}`,
    `connect-src 'self'${naver}${naverImg}${ts}${cfaConn}${gaConn}`, "font-src 'self' https://cdn.jsdelivr.net",
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

// wantPath: 로그인 뒤 돌아갈 자리. 관리자가 카톡으로 보낸 서명 링크를 회원이 눌렀을 때,
// 로그인 화면에서 끝나 버리면 정작 서명해야 할 문서를 스스로 찾아 들어가야 한다.
// GET 만 넘긴다 — POST 를 로그인 뒤에 다시 실행하면 안 된다.
function authorize(user, auth, assoc, wantPath = "") {
  if (!auth) return true;
  // 상인회 안에서 막혔으면 그 상인회의 로그인으로 보낸다. 공용 로그인으로 보내면
  // 로고도 이름도 남의 것("리스터코퍼레이션")이 떠서, 손님은 다른 사이트로 튕긴 줄 안다.
  if (!user) return (assoc && assoc._base ? assoc._base : "") + "/login?err=1&msg=" + encodeURIComponent("로그인이 필요합니다.")
    + (safeNext(wantPath) ? "&next=" + encodeURIComponent(wantPath) : "");
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

// 차림표 옆의 숫자 — '내 서명 ①' · '투표 ②'.
//
// 서명 요청과 새 안건은 문자나 이메일이 설정돼 있어야만 알림이 나간다. 설정이 없으면
// (지금 대부분이 그렇다) 사장님은 **아무 신호도 받지 못하고**, 우연히 그 메뉴를 눌러 봐야
// 알게 된다. 보내 놓고 아무도 모르는 계약서는 안 보낸 것과 같다.
//
// 그래서 화면 자체가 신호가 되게 한다. 다만 값이 싸지 않으므로(조회 두 번) 꼭 필요할 때만 센다 —
// 화면을 그리는 GET 일 때, 로그인한 사람일 때, 그리고 그 메뉴가 실제로 보이는 역할일 때만.
async function attachNavCounts(db, user, assoc, method) {
  if (!user || !assoc || method !== "GET") return;
  const esign = kindOf(assoc).nav === "esign";
  const member = user.role === "MERCHANT";
  const wantSign = member || esign;              // '내 서명' 이 차림표에 서는 조건 (render.js 와 같다)
  const wantPolls = !esign && kindOf(assoc).nav !== "landing";
  if (!wantSign && !wantPolls) return;
  const [sign, polls] = await Promise.all([
    wantSign ? D.countDocumentsToSign(db, assoc.id, user.id, user.role).catch(() => 0) : 0,
    wantPolls ? D.countOpenPollsToVote(db, assoc.id, user.id).catch(() => 0) : 0,
  ]);
  // user 는 이 요청 동안만 사는 객체다 — 화면(render.js)이 같은 객체를 받으므로 여기 얹어 둔다.
  user.navCounts = { sign, polls };
}

async function handle(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const canon = url.origin + url.pathname; // 표준 URL(쿼리 제외) — finalize 에서 <link rel=canonical> 주입
  const timing = { t0: Date.now(), db: { n: 0, ms: 0 } };
  const rawDb = env.DB;
  const db = instrumentDb(rawDb, timing.db);
  env = { ...env, DB: db, DB_RAW: rawDb }; // 핸들러 내부 D1 사용도 계측에 포함 · DB_RAW 는 아이솔레이트 단위 캐시의 열쇠
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
      // 스타일시트의 주석은 **저장소의 재산이지 손님의 짐이 아니다.**
      //
      // app.css 는 왜 이렇게 하는지를 적어 둔 주석이 파일의 28% 다. 그 주석 덕에 같은 사고를
      // 두 번 안 내지만, 그걸 휴대폰까지 내려보낼 이유는 없다. 실측: 전송량 81.9KB → 42.9KB.
      // 느린 회선에서 이 파일은 렌더를 막는 유일한 자원이라 그만큼이 그대로 첫 화면 시간이다.
      //
      // 소스는 손대지 않는다 — 나가는 길에서만 뗀다. 그래서 주석과 배포가 어긋날 수 없다.
      if (pathname.endsWith(".css") && res.status === 200) {
        const key = pathname;
        let css = CSS_LEAN.get(key);
        if (css == null) {
          css = stripCssComments(await res.text());
          if (CSS_LEAN.size > 8) CSS_LEAN.clear();   // 아이솔레이트 하나가 파일을 무한정 쥐지 않게
          CSS_LEAN.set(key, css);
        }
        h.delete("content-length");   // 길이가 바뀌었다
        h.delete("etag");             // 본문이 바뀌었으니 원본의 지문은 더 이상 맞지 않는다
        return new Response(css, { status: 200, headers: h });
      }
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
  // 운영사가 콘솔에서 붙여넣은 지도 열쇠 — 워커 Secret 이 빈 것만 채운다 (keys.js)
  env = await withStoredKeys(env, db, rawDb);

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
    // www.도메인 으로 들어오면 알맹이 도메인으로 영구 이동 — 명함에 www 를 붙여 적어도 죽지 않는다.
    // (개별 도메인은 조직당 하나만 저장하므로 www 를 따로 등록할 자리가 없다.)
    if (!assocPre && url.hostname.startsWith("www.")) {
      const bare = await D.getAssociationByDomain(db, url.hostname.slice(4));
      if (bare && bare.active)
        return finalize(redirect(`https://${bare.custom_domain}${pathname}${url.search}`, 301), setCookies, env, timing);
    }
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
      const ok = authorize(user, route.auth, assoc, request.method === "GET" ? pathname : "");
      if (ok !== true) return finalize(typeof ok === "string" ? redirect(ok) : forbidden(), setCookies, env, timing);
      await attachNavCounts(db, user, assoc, request.method);
      const res = await route.handler({ ...baseCtx, assoc, base: t.base, params: route.params });
      return finalize(res, setCookies, env, timing, tCanon, assoc);
    }
    // 테넌트 경로에 없으면 전역 라우트 폴백 (개별 도메인·서브도메인에서 /login, /verify, /sitemap.xml 등)
    const gt = matchRoute(GLOBAL, request.method, t.subpath);
    if (gt) {
      const ok = authorize(user, gt.auth, assoc, request.method === "GET" ? pathname : "");
      if (ok !== true) return finalize(typeof ok === "string" ? redirect(ok) : forbidden(), setCookies, env, timing);
      const res = await gt.handler({ ...baseCtx, assoc, base: t.base, params: gt.params });
      return finalize(res, setCookies, env, timing, tCanon, assoc);
    }
    return finalize(notFoundResponse({ assoc, base: t.base }), setCookies, env, timing);
  }

  // 전역 라우트
  // ⚠️ 여기에 권한 검사가 빠져 있었습니다. 테넌트 분기 두 곳에는 authorize() 가 있는데
  //    이 분기에만 없어서, 플랫폼 도메인에서 /super · /account 같은 인증 경로가 무방비였습니다.
  //    (로그인하지 않아도 /super 가 그대로 열렸습니다.) 같은 검사를 반드시 통과시킵니다.
  const g = matchRoute(GLOBAL, request.method, pathname);
  if (g) {
    const ok = authorize(user, g.auth, null, request.method === "GET" ? pathname : "");
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

async function finalize(res, setCookies, env, timing, canonical = "", assoc = null) {
  const headers = new Headers(res.headers);
  const sec = securityHeaders(env, { ga: !!(assoc && assoc.ga_measurement_id) });
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
