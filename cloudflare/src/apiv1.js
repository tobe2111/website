// 전자계약 공개 API (/api/v1) — 고객사 시스템이 계약을 자동으로 만들고 발송한다.
//
// 인증:  Authorization: Bearer sk_live_xxxxx      (상인회 단위로 발급)
// 과금:  API 호출 자체는 무료다. 돈은 알림톡 발송에서만 나온다 —
//        고객사가 자동화할수록 발송이 늘고, 발송 마진이 곧 수익이다.
// 응답:  항상 JSON. 오류는 { error: { code, message } } 한 가지 모양으로만 낸다.
import * as D from "./db.js";
import { sha256Hex, hmacSign, randomHex } from "./crypto.js";
import { contentHash } from "./esign.js";
import { cap, EMAIL_RE } from "./util.js";
import { makeExtToken, extSignUrl } from "./extsign.js";
import { builtinById, isBuiltinId, normalizeTemplate, applyVars, resolveFieldPages } from "./templates.js";
import { pageCount, isFieldKind, round4 } from "./paper.js";
import { buildEvidence } from "./evidence.js";

const J = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
const fail = (status, code, message) => J({ error: { code, message } }, status);

export const KEY_PREFIX = "sk_live_";
export const hashApiKey = (key) => sha256Hex(`apikey|${key}`);
export const newApiKey = () => KEY_PREFIX + randomHex(24);

// ---------- 인증 + 레이트리밋 ----------
// D1 만으로 정확한 슬라이딩 윈도우를 만들면 왕복이 늘어난다. 여기서는 분당 상한을
// 메모리(아이솔레이트 단위)로 두어 가장 흔한 폭주를 싸게 막고, 남용은 키 폐기로 대응한다.
const RATE = { perMin: 120 };
const buckets = new Map();
function rateOk(keyId, nowMs) {
  const min = Math.floor(nowMs / 60000);
  const b = buckets.get(keyId);
  if (!b || b.min !== min) { buckets.set(keyId, { min, n: 1 }); return true; }
  b.n++;
  return b.n <= RATE.perMin;
}

export async function authenticate(ctx) {
  const auth = ctx.request.headers.get("authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) return { error: fail(401, "unauthorized", "Authorization: Bearer <api key> 헤더가 필요합니다.") };
  const key = await D.getApiKeyByHash(ctx.db, await hashApiKey(m[1]));
  if (!key) return { error: fail(401, "invalid_key", "API 키가 올바르지 않거나 폐기되었습니다.") };
  if (!rateOk(key.id, Date.now()))
    return { error: fail(429, "rate_limited", `분당 ${RATE.perMin}회를 넘었습니다. 잠시 후 다시 시도해 주세요.`) };
  const assoc = await D.getAssociationById(ctx.db, key.association_id);
  if (!assoc || !assoc.active) return { error: fail(403, "inactive", "이 키에 연결된 조직이 비활성 상태입니다.") };
  await D.touchApiKey(ctx.db, key.id);
  return { key, assoc };
}

// ---------- 직렬화 ----------
const docJson = (d, extra = {}) => ({
  id: d.id, title: d.title, status: d.closed ? "closed" : "open",
  ordered: !!d.ordered, due_date: d.due_date || null,
  content_hash: d.content_hash, created_at: d.created_at,
  attachment: d.attachment ? { name: d.attachment_name, hash: d.attachment_hash } : null,
  ...extra,
});
const signerJson = (r, kind) => kind === "external"
  ? { kind: "external", id: r.id, name: r.name, email: r.email || null, phone: r.phone ? D.maskPhone(r.phone) : null,
      org: r.org || null, order: r.sign_order, signed: !!r.signed,
      declined_at: r.declined_at || null, decline_reason: r.decline_reason || null, opened_at: r.opened_at || null }
  : { kind: "member", id: r.id, name: r.name, email: r.email, order: r.sign_order, signed: !!r.signed,
      declined_at: r.declined_at || null, decline_reason: r.decline_reason || null };

// ---------- 라우팅 ----------
// 경로가 몇 개 안 되므로 표를 따로 두지 않고 여기서 분기한다.
export async function handle(ctx) {
  const { request, url } = ctx;
  const path = url.pathname.replace(/^\/api\/v1/, "") || "/";
  const method = request.method;

  if (path === "/" || path === "") return J({ service: "esign", version: "1", docs: `${url.origin}/api/v1/docs` });
  if (path === "/docs") return J(apiDocs(url.origin));

  const a = await authenticate(ctx);
  if (a.error) return a.error;
  const { key, assoc } = a;
  const db = ctx.db;

  try {
    if (path === "/me" && method === "GET")
      return J({ organization: { id: assoc.id, name: assoc.name, slug: assoc.slug },
        key: { name: key.name, prefix: key.prefix, calls: key.calls, webhook: key.webhook_url || null } });

    if (path === "/templates" && method === "GET") {
      const own = (await D.listTemplates(db, assoc.id)).map(normalizeTemplate);
      const { BUILTIN } = await import("./templates.js");
      return J({ templates: [...BUILTIN.map(normalizeTemplate), ...own].map((t) => ({
        id: String(t.id), title: t.title, summary: t.summary || null, builtin: t.builtin,
        variables: t.vars, parties: t.parties, fields: t.fields.length })) });
    }

    if (path === "/documents" && method === "GET") {
      const docs = await D.listDocuments(db, assoc.id);
      return J({ documents: docs.map((d) => docJson(d)) });
    }

    if (path === "/documents" && method === "POST") return createDocument(ctx, key, assoc);

    let m = /^\/documents\/(\d+)$/.exec(path);
    if (m && method === "GET") {
      const d = await D.getDocument(db, Number(m[1]));
      if (!d || d.association_id !== assoc.id) return fail(404, "not_found", "문서를 찾을 수 없습니다.");
      const members = await D.listRequestStatus(db, d.id);
      const exts = await D.listExternalSigners(db, d.id);
      const counts = await D.requestCounts(db, d.id);
      const sigs = await D.listSignatures(db, d.id);
      return J(docJson(d, {
        progress: { signed: counts.signed, total: counts.total,
          state: counts.total && counts.signed === counts.total ? "completed" : d.closed ? "closed" : "in_progress" },
        signers: [...members.map((r) => signerJson(r, "member")), ...exts.map((r) => signerJson(r, "external"))],
        signatures: sigs.map((s) => ({ verify_code: s.verify_code, signer: s.signer_name, kind: s.signer_kind,
          signed_at: s.signed_at, verify_level: s.verify_level,
          certificate_url: `${ctx.url.origin}/certificate/${s.verify_code}` })),
      }));
    }

    m = /^\/documents\/(\d+)\/signers$/.exec(path);
    if (m && method === "POST") return addSigner(ctx, key, assoc, Number(m[1]));

    m = /^\/documents\/(\d+)\/remind$/.exec(path);
    if (m && method === "POST") return remind(ctx, key, assoc, Number(m[1]));

    m = /^\/documents\/(\d+)\/evidence$/.exec(path);
    if (m && method === "GET") {
      const d = await D.getDocument(db, Number(m[1]));
      if (!d || d.association_id !== assoc.id) return fail(404, "not_found", "문서를 찾을 수 없습니다.");
      const { zip, filename } = await buildEvidence(ctx.env, db, d, assoc);
      return new Response(zip, { headers: { "content-type": "application/zip",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "cache-control": "no-store" } });
    }

    m = /^\/documents\/(\d+)\/close$/.exec(path);
    if (m && method === "POST") {
      const d = await D.getDocument(db, Number(m[1]));
      if (!d || d.association_id !== assoc.id) return fail(404, "not_found", "문서를 찾을 수 없습니다.");
      await D.closeDocument(db, d.id);
      return J({ ok: true, document: docJson(await D.getDocument(db, d.id)) });
    }

    if (path === "/balance" && method === "GET") {
      const bal = await D.getBalance(db, assoc.id);
      const { priceOf } = await import("./notify.js");
      const unit = await priceOf(db, "alimtalk", assoc.id);
      return J({ balance: bal, unit_price: unit, sendable: unit > 0 ? Math.floor(bal / unit) : 0 });
    }

    return fail(404, "no_route", `${method} ${path} 은(는) 없는 경로입니다. /api/v1/docs 를 참고하세요.`);
  } catch (e) {
    return fail(500, "internal", String((e && e.message) || e).slice(0, 200));
  }
}

// ---------- 문서 생성 ----------
async function createDocument(ctx, key, assoc) {
  const { db, env } = ctx;
  let b;
  try { b = await ctx.request.json(); } catch { return fail(400, "bad_json", "JSON 본문을 읽을 수 없습니다."); }
  if (!b || typeof b !== "object") return fail(400, "bad_json", "JSON 객체가 필요합니다.");

  const title = cap(String(b.title || "").trim(), 200);
  if (!title) return fail(400, "missing_title", "title 이 필요합니다.");
  const dueDate = String(b.due_date || "").trim();
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return fail(400, "bad_due_date", "due_date 는 YYYY-MM-DD 형식이어야 합니다.");
  const ordered = b.ordered ? 1 : 0;

  // 본문: 직접 넣거나(body) 서식에서 만든다(template + variables)
  let body = "", tpl = null;
  if (b.template) {
    const src = isBuiltinId(String(b.template)) ? builtinById(String(b.template)) : await D.getTemplate(db, Number(b.template) || 0);
    if (!src) return fail(404, "template_not_found", "서식을 찾을 수 없습니다.");
    if (!isBuiltinId(String(b.template)) && src.association_id !== 0 && src.association_id !== assoc.id)
      return fail(403, "forbidden_template", "다른 조직의 서식은 쓸 수 없습니다.");
    tpl = normalizeTemplate(src);
    body = applyVars(tpl.body, b.variables || {});
  } else {
    body = cap(String(b.body || "").trim(), 20000);
  }
  if (!body) return fail(400, "missing_body", "body 또는 template 중 하나가 필요합니다.");

  const signers = Array.isArray(b.signers) ? b.signers : [];
  if (!signers.length) return fail(400, "missing_signers", "signers 배열에 최소 한 명이 필요합니다.");
  if (signers.length > 20) return fail(400, "too_many_signers", "서명자는 최대 20명입니다.");
  for (const s of signers) {
    if (!s || !String(s.name || "").trim()) return fail(400, "bad_signer", "각 서명자에게 name 이 필요합니다.");
    if (s.email && !EMAIL_RE.test(String(s.email))) return fail(400, "bad_email", `이메일 형식 오류: ${s.email}`);
    if (!s.email && !s.phone) return fail(400, "no_contact", `'${s.name}' 에게 email 또는 phone 이 필요합니다.`);
  }

  const doc = await D.createDocument(db, { associationId: assoc.id, title, body,
    contentHash: await contentHash(body), createdBy: null, ordered, dueDate });

  // 서명자 등록 — API 로 만드는 계약은 상대방이 회원이 아닌 것이 보통이므로 전부 외부 서명자로 둔다
  const created = [];
  let order = 0;
  for (const s of signers) {
    order++;
    const rec = await D.addExternalSigner(db, { documentId: doc.id, name: cap(String(s.name).trim(), 60),
      email: cap(String(s.email || "").toLowerCase().trim(), 120), phone: String(s.phone || ""),
      org: cap(String(s.org || "").trim(), 80), signOrder: order });
    const token = await makeExtToken(env.SESSION_SECRET, rec.id, doc.id);
    created.push({ ...rec, token, url: extSignUrl(ctx.url.origin, token) });
  }

  // 서식의 필드 배치를 실제 사람에게 붙인다 (당사자 번호 → 등록 순서)
  if (tpl && tpl.fields.length) {
    const pages = pageCount(body);
    const placed = resolveFieldPages(tpl.fields, pages).map((f) => ({
      kind: f.kind, label: f.label || "", page: f.page,
      x: round4(f.x), y: round4(f.y), w: round4(f.w), h: round4(f.h),
      assignee: created[f.party | 0] ? -created[f.party | 0].id : 0, required: f.required ? 1 : 0,
    })).filter((f) => isFieldKind(f.kind) && f.x + f.w <= 1.0001 && f.y + f.h <= 1.0001);
    if (placed.length) await D.replaceFields(db, doc.id, placed);
  }

  await D.logDocEvent(db, { documentId: doc.id, actorName: `API(${key.prefix})`, kind: "created",
    detail: tpl ? `서식: ${tpl.title}` : "API", ip: ctx.ip || "" });

  // 발송 — 여기서만 크레딧이 나간다
  const notify = b.send !== false;
  const sent = [];
  if (notify) for (const c of created) {
    // 순차 계약이면 1번만 먼저 부른다. 나머지는 앞사람이 끝나야 의미가 있다.
    if (ordered && c.sign_order !== 1) continue;
    const r = await notifySigner(ctx, assoc, doc, c);
    if (r) sent.push({ id: c.id, via: r });
  }

  await enqueueEvent(db, assoc.id, "document.created", { document: docJson(doc), signers: created.length });
  return J({ document: docJson(doc, {
    signers: created.map((c) => ({ id: c.id, name: c.name, order: c.sign_order, sign_url: c.url })),
    notified: sent,
  }) }, 201);
}

// 서명자에게 링크 보내기 — 문구·템플릿·폴백 규칙은 extsign 한 곳에 모아 두고 그대로 쓴다.
async function notifySigner(ctx, assoc, doc, signer) {
  const { sendSignLink } = await import("./extsign.js");
  return sendSignLink(ctx.env, ctx.db, { assoc, doc, signer, origin: ctx.url.origin });
}

async function addSigner(ctx, key, assoc, docId) {
  const { db, env } = ctx;
  const d = await D.getDocument(db, docId);
  if (!d || d.association_id !== assoc.id) return fail(404, "not_found", "문서를 찾을 수 없습니다.");
  if (d.closed) return fail(409, "closed", "마감된 문서입니다.");
  let b;
  try { b = await ctx.request.json(); } catch { return fail(400, "bad_json", "JSON 본문을 읽을 수 없습니다."); }
  const name = cap(String((b && b.name) || "").trim(), 60);
  if (!name) return fail(400, "bad_signer", "name 이 필요합니다.");
  const email = cap(String((b && b.email) || "").toLowerCase().trim(), 120);
  const phone = String((b && b.phone) || "");
  if (email && !EMAIL_RE.test(email)) return fail(400, "bad_email", "이메일 형식 오류");
  if (!email && !phone) return fail(400, "no_contact", "email 또는 phone 이 필요합니다.");
  const signOrder = await D.nextSignOrder(db, d.id);
  const rec = await D.addExternalSigner(db, { documentId: d.id, name, email, phone,
    org: cap(String((b && b.org) || "").trim(), 80), signOrder });
  const token = await makeExtToken(env.SESSION_SECRET, rec.id, d.id);
  const url = extSignUrl(ctx.url.origin, token);
  let via = null;
  if (b && b.send !== false) via = await notifySigner(ctx, assoc, d, { ...rec, url });
  return J({ signer: { id: rec.id, name: rec.name, order: signOrder, sign_url: url }, notified: via }, 201);
}

async function remind(ctx, key, assoc, docId) {
  const { db } = ctx;
  const d = await D.getDocument(db, docId);
  if (!d || d.association_id !== assoc.id) return fail(404, "not_found", "문서를 찾을 수 없습니다.");
  if (d.closed) return fail(409, "closed", "마감된 문서입니다.");
  const exts = (await D.listExternalSigners(db, d.id)).filter((e) => !e.signed && !e.declined_at);
  if (!exts.length) return J({ reminded: 0, message: "미서명자가 없습니다." });
  const sent = [];
  for (const e of exts) {
    if (d.ordered && !(await D.canSignNowAny(db, d, { externalId: e.id }))) continue;
    const via = await notifySigner(ctx, assoc, d, e);
    if (via) sent.push({ id: e.id, via });
  }
  await D.logDocEvent(db, { documentId: d.id, actorName: `API(${key.prefix})`, kind: "reminded",
    detail: `대상 ${sent.length}명`, ip: ctx.ip || "" });
  return J({ reminded: sent.length, details: sent });
}

// ---------- 웹훅 ----------
// 이벤트가 나면 이 조직의 웹훅 등록 키마다 큐에 넣는다. 실제 발송은 크론이 한다 —
// 상대 서버가 느리다고 우리 응답이 같이 느려지면 안 되기 때문.
export async function enqueueEvent(db, assocId, event, payload) {
  const keys = await db.prepare("SELECT id FROM api_keys WHERE association_id=? AND revoked_at='' AND webhook_url != ''").bind(assocId).all();
  for (const k of keys.results || []) await D.queueWebhook(db, { keyId: k.id, event, payload: { event, ...payload } });
}
// 문서 단위 이벤트 — 서명/거절이 났을 때 호출한다(문서로 조직을 찾는다)
export async function enqueueDocEvent(db, documentId, event, payload) {
  const keys = await D.keysWithWebhook(db, documentId);
  for (const k of keys) await D.queueWebhook(db, { keyId: k.id, event, payload: { event, ...payload } });
}

// 서명은 위조 방지를 위해 HMAC-SHA256. 수신 측은 같은 계산을 해서 대조하면 된다.
export async function deliverWebhooks(env, db) {
  const rows = await D.dueWebhooks(db);
  let ok = 0, failed = 0;
  for (const w of rows) {
    const ts = Math.floor(Date.now() / 1000);
    try {
      const sig = await hmacSign(w.webhook_secret, `${ts}.${w.payload}`);
      const res = await fetch(w.webhook_url, { method: "POST", headers: {
        "content-type": "application/json",
        "x-esign-event": w.event,
        "x-esign-timestamp": String(ts),
        "x-esign-signature": `v1=${sig}`,
      }, body: w.payload });
      if (res.ok) { await D.markWebhookDone(db, w.id); ok++; continue; }
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      failed++;
      const n = (w.attempts || 0) + 1;
      if (n >= 6) await D.markWebhookFailed(db, w.id, n, `포기: ${String((e && e.message) || e)}`);
      else await D.markWebhookFailed(db, w.id, n, String((e && e.message) || e));
    }
  }
  return { ok, failed, total: rows.length };
}

// ---------- 문서(사람이 읽는 것) ----------
function apiDocs(origin) {
  return {
    service: "전자계약 API", version: "1",
    auth: { header: "Authorization: Bearer sk_live_...", note: "키는 관리자 콘솔 → 전자서명 문서 → API 연동 에서 발급합니다." },
    pricing: { api: "무료", alimtalk: "발송 건당 차감 (관리자 콘솔의 단가 기준)" },
    rate_limit: `분당 ${RATE.perMin}회`,
    endpoints: [
      { method: "GET", path: "/api/v1/me", desc: "키·조직 확인" },
      { method: "GET", path: "/api/v1/templates", desc: "쓸 수 있는 서식과 빈칸 목록" },
      { method: "GET", path: "/api/v1/documents", desc: "문서 목록" },
      { method: "POST", path: "/api/v1/documents", desc: "계약서 생성 + 서명 링크 발급 + 발송",
        body: { title: "○○상가 임대차", template: "b-lease",
          variables: { 임대인: "김갑", 임차인: "이을", 보증금: "50,000,000" },
          signers: [{ name: "김갑", email: "a@example.com" }, { name: "이을", phone: "010-1234-5678" }],
          ordered: true, due_date: "2026-12-31", send: true } },
      { method: "GET", path: "/api/v1/documents/{id}", desc: "진행 상태 · 서명자 · 확인서 링크" },
      { method: "POST", path: "/api/v1/documents/{id}/signers", desc: "서명자 추가 + 링크 발송" },
      { method: "POST", path: "/api/v1/documents/{id}/remind", desc: "미서명자 재알림" },
      { method: "GET", path: "/api/v1/documents/{id}/evidence", desc: "증적 패키지(ZIP) 내려받기" },
      { method: "POST", path: "/api/v1/documents/{id}/close", desc: "문서 마감" },
      { method: "GET", path: "/api/v1/balance", desc: "발송 잔액 · 단가 · 남은 건수" },
    ],
    webhooks: {
      events: ["document.created", "document.signed", "document.declined", "document.completed"],
      headers: { "x-esign-event": "이벤트 이름", "x-esign-timestamp": "유닉스 초", "x-esign-signature": "v1=<base64url HMAC-SHA256>" },
      verify: "HMAC-SHA256(webhook_secret, `${timestamp}.${본문원문}`) 을 계산해 x-esign-signature 와 비교하세요.",
      retry: "실패 시 1·5·25·125분… 간격으로 최대 6회 재시도합니다.",
    },
    errors: { shape: { error: { code: "not_found", message: "문서를 찾을 수 없습니다." } } },
    example: `curl -X POST ${origin}/api/v1/documents \\
  -H "Authorization: Bearer sk_live_..." -H "content-type: application/json" \\
  -d '{"title":"임대차","template":"b-lease","signers":[{"name":"이을","phone":"010-1234-5678"}]}'`,
  };
}
