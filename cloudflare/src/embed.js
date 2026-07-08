// 외부 영상 임베드 유틸 (유튜브/쇼츠 · 인스타그램 릴스 · 네이버TV)
// 영상은 자체 저장/전송하지 않고 링크만 보관 → 스토리지·트래픽 비용 0.
// URL 을 서버에서 파싱해 provider + id 만 추출·검증하고, 렌더 시 신뢰 도메인 iframe 으로 embed.

const PROVIDERS = {
  youtube:   { label: "YouTube",  vertical: false },
  instagram: { label: "Instagram", vertical: true },
  navertv:   { label: "네이버TV", vertical: true },
};

// 지원 URL → { provider, id } 또는 null
export function parseEmbed(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url || url.length > 400) return null;
  let m;
  // 유튜브: watch?v= / youtu.be/ / shorts/ / embed/  (영상 ID 11자)
  if ((m = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url)))
    return { provider: "youtube", id: m[1] };
  // 인스타그램: reel/reels/p/tv/{shortcode}  (사용자명 접두 허용)
  if ((m = /instagram\.com\/(?:[^/?#]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,30})/.exec(url)))
    return { provider: "instagram", id: m[1] };
  // 네이버TV: tv.naver.com/v|embed|clip/{숫자}
  if ((m = /tv\.naver\.com\/(?:v|embed|clip)\/(\d{3,15})/.exec(url)))
    return { provider: "navertv", id: m[1] };
  return null;
}

// 신뢰 도메인 iframe src (CSP frame-src 와 일치해야 함)
export function embedSrc(provider, id) {
  if (provider === "youtube") return `https://www.youtube-nocookie.com/embed/${id}`;
  if (provider === "instagram") return `https://www.instagram.com/reel/${id}/embed`;
  if (provider === "navertv") return `https://tv.naver.com/embed/${id}`;
  return "";
}

// 그리드용 썸네일 URL (유튜브만 무료 정적 썸네일 제공, 나머지는 플레이스홀더)
export function embedThumb(provider, id) {
  if (provider === "youtube") return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  return "";
}

// 원본 보기 링크 (새 탭)
export function watchUrl(provider, id) {
  if (provider === "youtube") return `https://youtu.be/${id}`;
  if (provider === "instagram") return `https://www.instagram.com/reel/${id}/`;
  if (provider === "navertv") return `https://tv.naver.com/v/${id}`;
  return "";
}

export function providerLabel(provider) {
  return (PROVIDERS[provider] || {}).label || provider;
}
export function isVertical(provider) {
  return !!(PROVIDERS[provider] || {}).vertical;
}
