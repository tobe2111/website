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
  return new Response("", { status, headers: { Location: location, ...headers } });
}
// msg 알림과 함께 뒤로 (PRG 패턴)
export function back(to, msg, err = false) {
  const q = msg ? `?${err ? "err=1&" : ""}msg=${encodeURIComponent(msg)}` : "";
  return redirect(to + q);
}
export function notFoundResponse(ctx) {
  const body = `<section class="section page-top"><div class="container" style="text-align:center">
    <h1 style="font-size:3rem">404</h1><p class="empty">요청하신 페이지를 찾을 수 없습니다.</p>
    <p><a class="btn btn-ghost btn-sm" href="${ctx && ctx.base ? ctx.base : "/"}/">홈으로</a></p></div></section>`;
  return html(layout({ title: "404", assoc: ctx && ctx.assoc, base: ctx && ctx.base || "", body }), 404);
}
export function forbidden(msg = "권한이 없습니다.") {
  return html(`<section class="section page-top"><div class="container"><h1>403</h1><p>${esc(msg)}</p></div></section>`, 403);
}
