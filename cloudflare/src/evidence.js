// 증적 패키지 — 분쟁·소송에서 그대로 제출할 수 있는 한 벌의 증거 묶음(ZIP).
//
// 왜 링크가 아니라 파일인가:
//   법원·상대방은 우리 서버에 접속하지 않는다. 인터넷이 끊긴 자리에서도 열리고,
//   우리가 사후에 무엇을 바꿔도 이미 내려받은 파일은 그대로 남아야 증거가 된다.
//   그래서 이미지·서명·공개키까지 전부 파일 안에 넣고, 검증 절차를 글로 적어 함께 담는다.
import * as D from "./db.js";
import { esc, kstStamp } from "./util.js";
import { renderPaper, fieldBox, PAGE, FONT_PX, LINE_H, fieldsCanonical } from "./paper.js";
import { verifySignature, canonicalFromSig, publicKeyJwk, publicKeyFingerprint, algorithm, verifyChain, keyStorage } from "./esign.js";
import { makeZip } from "./zip.js";

const b64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const EVENT_LABEL = {
  created: "문서 생성", viewed: "계약서 열람", otp_sent: "인증번호 발송", otp_ok: "휴대폰 본인확인 완료",
  signed: "전자서명 완료", declined: "서명 거절", reminded: "재알림 발송", notified: "알림 발송",
};
const LEVEL_LABEL = { password: "로그인(비밀번호)", otp: "휴대폰 본인확인(OTP)", identity: "신원확인" };

// R2 객체를 data: URI 로 — 오프라인에서도 서명 그림·도장이 보이게
async function dataUri(env, key) {
  if (!key || !env || !env.MEDIA) return "";
  try {
    const obj = await env.MEDIA.get(key);
    if (!obj) return "";
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const ct = (obj.httpMetadata && obj.httpMetadata.contentType) || "image/png";
    return `data:${ct};base64,${b64(bytes)}`;
  } catch { return ""; }
}

// 패키지 안의 HTML 은 외부 CSS 를 못 불러오므로 필요한 스타일만 직접 넣는다
const SHEET = `
body{margin:0;background:#eef1f4;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#16181d}
.wrap{max-width:860px;margin:0 auto;padding:24px 16px}
h1{font-size:1.4rem;margin:0 0 4px}.sub{color:#6b7280;font-size:.86rem;margin:0 0 20px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-bottom:18px}
th,td{padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:.88rem;text-align:left;vertical-align:top}
th{width:150px;background:#f8fafc;font-weight:700;color:#475569}
code{font-family:ui-monospace,Menlo,monospace;font-size:.8rem;word-break:break-all}
.ok{color:#0b7a3e;font-weight:800}.no{color:#b91c1c;font-weight:800}
.paper{position:relative;margin:0 auto 20px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.12);overflow:hidden}
.paper-text{position:absolute;inset:0;white-space:pre;overflow:hidden;font-family:'Nanum Myeongjo','Batang',serif}
.paper-layer{position:absolute;inset:0}
.paper-no{position:absolute;left:0;right:0;bottom:18px;text-align:center;font-size:12px;color:#9aa1ac}
.paper-wm{position:absolute;inset:0;display:grid;place-items:center;font-size:80px;font-weight:800;color:rgba(190,30,45,.07);transform:rotate(-24deg)}
.pf{position:absolute;display:flex;align-items:center;justify-content:center;box-sizing:border-box;font-size:14px;overflow:hidden}
.pf img{max-width:100%;max-height:100%;object-fit:contain}
.pf-val{padding:0 4px;font-family:'Nanum Myeongjo','Batang',serif;white-space:nowrap}
.pf-check{font-size:20px;font-weight:700}
.pf-tag,.pf-who{display:none}
.paper-stack{transform-origin:top left}
@media print{body{background:#fff}.wrap{padding:0;max-width:none}.paper{box-shadow:none;margin:0;page-break-after:always}@page{size:A4;margin:0}}
`;
const shell = (title, inner) =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(title)}</title><style>${SHEET}</style></head><body><div class="wrap">${inner}</div></body></html>`;

// ---------- 패키지 만들기 ----------
export async function buildEvidence(env, db, doc, assoc) {
  const sigs = await D.listSignatures(db, doc.id);
  const reqs = await D.listRequestStatus(db, doc.id);
  const fields = await D.listFieldsWithValues(db, doc.id);
  const events = await D.listDocEvents(db, doc.id);
  const verds = await Promise.all(sigs.map((s) => verifySignature(env, s, doc)));
  const chain = verifyChain(await D.listSignatureChain(db));
  const jwk = await publicKeyJwk(env);
  const fp = await publicKeyFingerprint(env);
  const at = new Date();
  const stamp = at.toISOString().slice(0, 10);
  const files = [];

  // 필드 이미지를 미리 data: URI 로 바꿔 둔다 (완성본 HTML 이 혼자 열리도록)
  const uriOf = new Map();
  for (const f of fields) if (f.image) uriOf.set(f.image, await dataUri(env, f.image));

  // ① 계약서 완성본
  const nameOf = (id) => { const u = reqs.find((r) => r.id === id); return u ? u.name : ""; };
  const done = reqs.length > 0 && reqs.every((r) => r.signed);
  const paper = renderPaper(doc.body, {
    watermark: done ? "" : "미완성",
    fieldsFor: (page) => fields.filter((f) => f.page === page).map((f) =>
      fieldBox(f, { mode: "view", assigneeName: nameOf(f.assignee),
        val: f.value || f.image ? { value: f.value || "", imageUrl: uriOf.get(f.image) || "" } : null })).join(""),
  });
  files.push({ name: "1_계약서_완성본.html", data: shell(`${doc.title} — 완성본`,
    `<h1>${esc(doc.title)}</h1><p class="sub">${esc(assoc ? assoc.name : "")} · 서명 ${sigs.length}/${reqs.length || sigs.length}명${done ? " · 체결 완료" : " · 진행 중"}
     · 브라우저 인쇄로 PDF 저장 가능</p>${paper}`) });

  // ② 서명자별 확인서
  sigs.forEach((s, i) => {
    const v = verds[i];
    const row = (k, val) => `<tr><th>${esc(k)}</th><td>${val}</td></tr>`;
    files.push({ name: `2_확인서/${String(i + 1).padStart(2, "0")}_${safeName(s.signer_name)}_${s.verify_code}.html`,
      data: shell(`전자서명 확인서 — ${s.signer_name}`, `<h1>전자서명 확인서</h1>
        <p class="sub">${esc(assoc ? assoc.name : "")} · 검증코드 ${esc(s.verify_code)}</p>
        <table>
        ${row("판정", v.valid ? '<span class="ok">유효 — 봉인·본문·입력값 모두 무결</span>' : '<span class="no">불일치 — 아래 항목 확인</span>')}
        ${row("문서", esc(doc.title))}
        ${row("서명자", `${esc(s.signer_name)} &lt;${esc(s.signer_email || "")}&gt;`)}
        ${row("서명 시각", `${esc(kstStamp(s.signed_at))} KST <small>(${esc(s.signed_at)})</small>`)}
        ${row("본인확인", esc(LEVEL_LABEL[s.verify_level] || s.verify_level))}
        ${row("접속 IP", esc(s.ip))}
        ${row("기기", `<small>${esc(s.user_agent || "")}</small>`)}
        ${row("문서 해시", `<code>${esc(s.content_hash)}</code>`)}
        ${row("입력값 해시", s.fields_hash ? `<code>${esc(s.fields_hash)}</code>` : "<small>입력 필드 없음</small>")}
        ${row("직전 봉인", s.prev_hash ? `<code>${esc(s.prev_hash)}</code>` : "<small>사슬의 첫 기록</small>")}
        ${row("봉인값", `<code>${esc(s.record_hash)}</code>`)}
        ${row("봉인 버전", `v${s.seal_ver || 1}`)}
        ${row("봉인 원문", `<code>${esc(canonicalFromSig(s).replace(/\n/g, " ⏎ "))}</code>`)}
        </table>
        <p class="sub">이 확인서는 서명자·시각·문서해시·입력값을 ${esc(algorithm)} 전자서명으로 봉인한 기록입니다.
        검증 방법은 같은 폴더의 <b>4_검증방법.txt</b> 를 참고하세요.</p>`) });
  });

  // ③ 감사 추적 (CSV — 엑셀에서 바로 열림)
  const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + [["시각(KST)", "행위", "행위자", "상세", "IP", "기기"].join(",")]
    .concat(events.map((e) => [kstStamp(e.created_at), EVENT_LABEL[e.kind] || e.kind, e.actor_name, e.detail, e.ip, e.user_agent].map(csvCell).join(",")))
    .join("\r\n");
  files.push({ name: "3_감사추적.csv", data: csv });

  // ④ 검증 방법 (사람이 읽는 안내 + 공개키)
  files.push({ name: "4_검증방법.txt", data: verifyGuide({ doc, assoc, sigs, verds, chain, jwk, fp, env, at }) });

  // ⑤ 기계 판독용 원본 기록
  files.push({ name: "5_증적.json", data: JSON.stringify({
    생성시각: at.toISOString(),
    상인회: assoc ? { id: assoc.id, 이름: assoc.name, 주소: assoc.slug } : null,
    문서: { id: doc.id, 제목: doc.title, 본문해시: doc.content_hash, 순차서명: !!doc.ordered,
      기한: doc.due_date || null, 마감: !!doc.closed, 생성: doc.created_at,
      첨부: doc.attachment ? { 파일명: doc.attachment_name, 해시: doc.attachment_hash } : null,
      본문: doc.body },
    필드: fields.map((f) => ({ id: f.id, 종류: f.kind, 이름표: f.label, 쪽: f.page,
      좌표: { x: f.x, y: f.y, w: f.w, h: f.h }, 담당: f.assignee, 필수: !!f.required,
      값: f.value || "", 이미지해시: f.image_hash || "", 입력시각: f.filled_at || null })),
    서명: sigs.map((s, i) => ({ 검증코드: s.verify_code, 서명자: s.signer_name, 이메일: s.signer_email,
      시각: s.signed_at, IP: s.ip, 기기: s.user_agent, 본인확인: s.verify_level,
      문서해시: s.content_hash, 입력값해시: s.fields_hash || "", 직전봉인: s.prev_hash || "",
      봉인값: s.record_hash, 봉인버전: s.seal_ver, 봉인원문: canonicalFromSig(s),
      판정: { 봉인: verds[i].sealOk, 본문: verds[i].contentOk, 입력값: verds[i].fieldsOk, 종합: verds[i].valid } })),
    요청: reqs.map((r) => ({ 이름: r.name, 이메일: r.email, 순번: r.sign_order,
      서명완료: !!r.signed, 거절시각: r.declined_at || null, 거절사유: r.decline_reason || null })),
    감사추적: events.map((e) => ({ 시각: e.created_at, 행위: e.kind, 설명: EVENT_LABEL[e.kind] || e.kind,
      행위자: e.actor_name, 상세: e.detail, IP: e.ip, 기기: e.user_agent })),
    서명사슬: chain,
    공개키: { 알고리즘: algorithm, jwk, 지문: fp, 보관: keyStorage(env) === "secret" ? "시크릿" : "데이터베이스" },
  }, null, 2) });

  // ⑥ 서명·도장 이미지 원본 (해시 대조용)
  let n = 0;
  for (const f of fields) {
    if (!f.image) continue;
    const uri = uriOf.get(f.image) || "";
    const m = /^data:([^;]+);base64,(.+)$/.exec(uri);
    if (!m) continue;
    n++;
    files.push({ name: `6_이미지/${String(n).padStart(2, "0")}_${safeName(f.label || f.kind)}_${(f.image_hash || "").slice(0, 12)}.png`,
      data: Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)) });
  }

  // ⑦ 첨부 계약서 원문
  if (doc.attachment && env.MEDIA) {
    try {
      const obj = await env.MEDIA.get(doc.attachment);
      if (obj) files.push({ name: `7_첨부/${safeName(doc.attachment_name || "계약서.pdf")}`, data: new Uint8Array(await obj.arrayBuffer()) });
    } catch {}
  }

  const zip = await makeZip(files, { at });
  return { zip, filename: `증적_${safeName(doc.title)}_${stamp}.zip`, count: files.length };
}

const safeName = (s) => String(s || "문서").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 60).trim() || "문서";

function verifyGuide({ doc, assoc, sigs, verds, chain, jwk, fp, env, at }) {
  const lines = [];
  const P = (s = "") => lines.push(s);
  P("전자서명 증적 패키지 — 검증 방법");
  P("=".repeat(50));
  P("");
  P(`문서       ${doc.title}`);
  P(`발행       ${assoc ? assoc.name : ""}`);
  P(`내려받은 때 ${kstStamp(at.toISOString())} KST`);
  P(`서명자     ${sigs.length}명`);
  P("");
  P("[ 이 패키지에 들어 있는 것 ]");
  P("  1_계약서_완성본.html   서명·도장이 실제 자리에 찍힌 계약서. 브라우저로 열고 인쇄하면 PDF 가 됩니다.");
  P("  2_확인서/             서명자별 확인서. 봉인 원문과 봉인값이 그대로 적혀 있습니다.");
  P("  3_감사추적.csv         열람·인증·서명 시각을 시간순으로 정리한 기록.");
  P("  5_증적.json            위 내용 전부를 기계가 읽을 수 있는 형태로 담은 원본.");
  P("  6_이미지/              서명 그림·도장 원본. 파일명 끝의 값이 그 파일의 해시 앞자리입니다.");
  P("");
  P("[ 검증 절차 ]");
  P("");
  P("① 계약서 본문이 바뀌지 않았는가");
  P("   증적.json 의 문서.본문 을 SHA-256 으로 해싱해 문서.본문해시 와 비교합니다.");
  P("   (첨부 PDF 가 있으면  본문 + \"\\n--attachment--\\n\" + 첨부해시  를 해싱합니다)");
  P("");
  P("② 서명 기록이 위조되지 않았는가");
  P(`   각 서명의 '봉인원문' 을 아래 공개키로 ${algorithm} 검증합니다. 봉인값은 base64url 입니다.`);
  P("   봉인 원문은 줄바꿈(\\n)으로 이어 붙인 문자열이며, 버전별 구성은 다음과 같습니다.");
  P("     v1  문서id · 사용자id · 서명자명 · 문서해시 · 시각 · IP");
  P("     v2  v1 + 직전 봉인값");
  P("     v3  v2 + 입력값 해시");
  P("");
  P("③ 서명자가 채운 값이 바뀌지 않았는가 (v3)");
  P("   증적.json 의 필드 중 그 서명자가 채운 것들을 id 오름차순으로 정렬해");
  P("   각 줄을  id⇥종류⇥쪽⇥x⇥y⇥w⇥h⇥값⇥이미지해시  (⇥=탭) 로 만들고 줄바꿈으로 이어 SHA-256 합니다.");
  P("   좌표를 함께 넣기 때문에, 값을 그대로 두고 자리만 옮기는 조작도 드러납니다.");
  P("   (좌표는 소수점 넷째 자리로 반올림한 값을 씁니다)");
  P("");
  P("④ 중간 기록이 삭제되지 않았는가");
  P("   각 서명의 '직전봉인' 이 바로 앞 서명의 '봉인값' 과 일치해야 합니다.");
  P("   하나라도 어긋나면 그 지점에서 기록이 지워지거나 순서가 바뀐 것입니다.");
  P("");
  P("⑤ 이미지가 교체되지 않았는가");
  P("   6_이미지/ 의 각 파일을 SHA-256 으로 해싱해 증적.json 의 이미지해시 와 비교합니다.");
  P("");
  P("[ 공개키 ]");
  P(`  알고리즘  ${algorithm}`);
  P(`  지문      ${fp}`);
  P(`  JWK       ${JSON.stringify(jwk)}`);
  P("  (같은 키를 발행처의 /.well-known/esign-public-key 에서도 공개하고 있습니다.");
  P("   두 값의 지문이 같아야 이 패키지가 그 발행처의 것입니다.)");
  P("");
  P("[ 내려받는 시점의 자동 판정 ]");
  for (let i = 0; i < sigs.length; i++) {
    const v = verds[i];
    P(`  ${sigs[i].signer_name}  봉인 ${v.sealOk ? "OK" : "실패"} / 본문 ${v.contentOk ? "OK" : "불일치"} / 입력값 ${v.fieldsChecked ? (v.fieldsOk ? "OK" : "불일치") : "해당없음"} → ${v.valid ? "유효" : "확인 필요"}`);
  }
  P(`  서명 사슬  ${chain.ok ? `정상 (${chain.length}건)` : `끊김 — 서명 #${chain.brokenAt}`}`);
  if (keyStorage(env) !== "secret") {
    P("");
    P("  ⚠ 주의: 이 발행처는 서명 개인키를 데이터베이스에 보관하고 있습니다.");
    P("     데이터베이스 접근 권한자가 과거 봉인을 다시 만들 수 있으므로,");
    P("     제3자 시점 증거(앵커)와 함께 판단하시기 바랍니다.");
  }
  P("");
  P("문의: " + (assoc ? assoc.name : "발행처"));
  return lines.join("\r\n");
}
