// Response 헬퍼 (Workers 표준 Request/Response)
import { layout } from "./render.js";
import { esc } from "./util.js";

export function html(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}
export function text(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...headers } });
}
export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}
export function redirect(location, status = 303, headers = {}) {
  // Location 헤더는 ByteString 이라 비ASCII(한글 슬러그 등)를 퍼센트 인코딩해야 함.
  // encodeURI 를 쓰면 안 된다 — 이미 인코딩된 %xx 의 % 까지 %25 로 다시 먹어서
  // `?msg=%ED%99%98...` 이 `%25ED%2599...` 가 되고, 화면에는 안내문 대신 기호가 뜬다.
  // 비ASCII 글자만 골라 인코딩하면 기존 %xx·쿼리 구분자는 그대로 남는다.
  const loc = /[^\x00-\x7F]/.test(location)
    ? location.replace(/[^\x00-\x7F]+/g, (s) => encodeURIComponent(s))
    : location;
  return new Response("", { status, headers: { Location: loc, ...headers } });
}
// msg 알림과 함께 뒤로 (PRG 패턴) — 대상에 이미 쿼리가 있으면 & 로 잇는다 (?t=토큰?msg=… 오염 방지)
export function back(to, msg, err = false) {
  const q = msg ? `${to.includes("?") ? "&" : "?"}${err ? "err=1&" : ""}msg=${encodeURIComponent(msg)}` : "";
  return redirect(to + q);
}
export function notFoundResponse(ctx) {
  const base = (ctx && ctx.base) || "";
  const body = `<section class="nf-wrap">
    <div class="nf-inner">
      <p class="nf-num" aria-hidden="true">404</p>
      <h1 class="nf-title">찾으시는 골목이 없어요</h1>
      <p class="nf-desc">주소가 바뀌었거나 삭제된 페이지입니다.<br />홈에서 다시 찾아보세요.</p>
      <div class="nf-actions">
        <a class="btn btn-primary" href="${base}/">홈으로</a>
        ${ctx && ctx.assoc ? `<a class="btn btn-ghost" href="${base}/businesses">업체 둘러보기</a>` : ""}
      </div>
    </div></section>`;
  return html(layout({ title: "404", assoc: ctx && ctx.assoc, base, body }), 404);
}
export function forbidden(msg = "권한이 없습니다.") {
  return html(`<section class="section page-top"><div class="container"><h1>403</h1><p>${esc(msg)}</p></div></section>`, 403);
}
