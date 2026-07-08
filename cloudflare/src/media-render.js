// 갤러리 타일 렌더 (사진 / 레거시 영상 / 외부 임베드) — 순수 함수
import { esc } from "./util.js";
import { mediaUrl } from "./render.js";
import { embedSrc, embedThumb, providerLabel, isVertical } from "./embed.js";

export function galleryItem(m, { showCaption = true } = {}) {
  const cap = esc(m.caption || "");
  if (m.kind === "embed") {
    const label = providerLabel(m.provider);
    const thumb = embedThumb(m.provider, m.embed_id);
    const src = embedSrc(m.provider, m.embed_id);
    const face = thumb
      ? `<img src="${esc(thumb)}" alt="${cap || esc(label) + " 영상"}" loading="lazy" />`
      : `<span class="embed-face embed-${esc(m.provider)}">${esc(label)}</span>`;
    return `<button type="button" class="gallery-item is-video is-embed" data-kind="embed" data-embed-src="${esc(src)}" data-provider="${esc(m.provider)}" data-vertical="${isVertical(m.provider) ? "1" : "0"}" data-caption="${cap}" aria-label="${cap || esc(label) + " 영상 보기"}">
      ${face}<span class="play-badge" aria-hidden="true">▶</span><span class="embed-badge">${esc(label)}</span>${showCaption && cap ? `<figcaption>${cap}</figcaption>` : ""}</button>`;
  }
  const url = mediaUrl(m.filename);
  const posterUrl = m.poster ? mediaUrl(m.poster) : "";
  let inner;
  if (m.kind === "video") {
    inner = `${posterUrl ? `<img src="${esc(posterUrl)}" alt="${cap || "영상"}" loading="lazy" />` : `<video src="${esc(url)}#t=0.1" preload="metadata" muted playsinline></video>`}<span class="play-badge" aria-hidden="true">▶</span>`;
  } else {
    inner = `<img src="${esc(m.thumb ? mediaUrl(m.thumb) : url)}" alt="${cap || "사진"}" loading="lazy" />`;
  }
  return `<button type="button" class="gallery-item${m.kind === "video" ? " is-video" : ""}" data-src="${esc(url)}" data-kind="${m.kind}" data-poster="${esc(posterUrl)}" data-caption="${cap}" aria-label="${cap || "보기"}">
    ${inner}${showCaption && cap ? `<figcaption>${cap}</figcaption>` : ""}</button>`;
}
