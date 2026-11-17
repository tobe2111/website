// 칼럼 원고(.md) 읽기 — 꼭 필요한 문법만 직접 처리한다(외부 의존성 0).
//
//   ---                     ← 머리말: 제목·날짜·과목·관련 진료
//   title: 허리디스크, 수술이 꼭 필요할까요?
//   date: 2026-11-17
//   category: spine
//   treatment: herniated-disc
//   summary: 한 줄 요약
//   ---
//   본문 문단 … **굵게** · ## 소제목 · ### 작은 제목 · - 목록 · 1. 번호 목록 · > 주의 상자
//
// 원고를 쓰는 사람이 HTML 을 몰라도 되게, 그리고 원고에 든 꺾쇠(<)가 화면을 깨지 않게
// 모든 글자를 먼저 이스케이프한 뒤 위 문법만 태그로 바꾼다.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

export function parseFrontMatter(src) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(String(src).replace(/\r\n/g, "\n"));
  if (!m) return { meta: {}, body: String(src) };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2] };
}

// 본문 → HTML. 소제목(##)은 목차용으로 id 를 붙여 돌려준다.
export function renderMarkdown(body) {
  const lines = String(body).replace(/\r\n/g, "\n").split("\n");
  const out = [], toc = [];
  let para = [], list = null, quote = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((x) => `<li>${inline(x)}</li>`).join("")}</${list.tag}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<aside class="note">${quote.map((q) => `<p>${inline(q)}</p>`).join("")}</aside>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushAll(); continue; }
    if ((m = /^(#{2,3})\s+(.*)$/.exec(line))) {
      flushAll();
      const level = m[1].length, text = m[2].trim();
      if (level === 2) {
        const id = `s${toc.length + 1}`;
        toc.push([id, text]);
        out.push(`<h2 id="${id}">${inline(text)}</h2>`);
      } else out.push(`<h3>${inline(text)}</h3>`);
      continue;
    }
    if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); flushList(); quote.push(m[1]); continue; }
    if ((m = /^(?:[-*]|(\d+)\.)\s+(.*)$/.exec(line))) {
      flushPara(); flushQuote();
      const tag = m[1] ? "ol" : "ul";
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(m[2]);
      continue;
    }
    flushList(); flushQuote();
    para.push(line.trim());
  }
  flushAll();
  return { html: out.join("\n"), toc };
}

// 본문을 평문으로 — 검색 설명·글자 수·의료광고 검사용
export const plainText = (body) => String(body).replace(/^#{2,3}\s+/gm, "").replace(/^[>\-*]\s?|^\d+\.\s+/gm, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
