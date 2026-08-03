// 공개 페이지 프리뷰 (디자인 확인용) — 점포 목록 / 점포 상세.
// 실제 핸들러는 D1 이 필요해서, 같은 클래스 구조의 대표 마크업을 layout() 에 얹어 CSS 를 검증합니다.
//
//   node scripts/preview-pages.mjs public/__biz.html detail
//   node scripts/preview-pages.mjs public/__list.html list
import { writeFileSync } from "node:fs";
import { layout } from "../src/render.js";

const assoc = { id: 1, name: "리스터코퍼레이션", slug: "리스터코퍼레이션", brand_color: "#0b8a46", tagline: "우리 동네 상권의 오늘을 함께 만들어 갑니다.", phone: "02-000-0000", address: "서울 서초구 강남대로 1" };
const base = "/t/리스터코퍼레이션";
const PIN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>';

const CATS = ["음식점", "카페", "미용", "생활", "교육", "의료"];
const card = (i) => `<article class="market-card">
  <a class="market-thumb" href="#"><span class="thumb-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9l1.2-4.2A1 1 0 0 1 6.2 4h11.6a1 1 0 0 1 1 .8L20 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/></svg></span>
  <span class="market-open"><span class="badge badge-ok">영업 중</span></span></a>
  <div class="market-body"><span class="mc-cat">${CATS[i % CATS.length]}</span>
  <h3><a href="#">샘플 가게 ${i + 1}</a></h3>
  <p class="mc-meta">${PIN}<span>서울 서초구 어딘가 ${i + 1}길 · 10:00–21:00</span></p></div></article>`;

const listBody = `<section class="section page-top"><div class="container">
  <div class="section-head"><p class="section-eyebrow">MEMBERS</p><h2 class="section-title">가입 점포 안내</h2><p class="section-lead">총 12곳</p></div>
  <form method="get" action="#" class="board-search"><input type="search" placeholder="점포·업종 검색" /><button class="btn btn-ghost btn-sm">검색</button></form>
  <div class="chip-filters"><a href="#" class="chip-filter active">전체</a><a href="#" class="chip-filter chip-open">● 지금 영업중</a>${CATS.map((c, i) => `<a href="#" class="chip-filter">${c} <em>${i + 1}</em></a>`).join("")}</div>
  <div class="market-grid">${Array.from({ length: 12 }, (_, i) => card(i)).join("")}</div>
  <nav class="pager"><span class="pg disabled">‹ 이전</span><span class="pg cur">1</span><a class="pg" href="#">2</a><a class="pg" href="#">다음 ›</a></nav>
</div></section>`;

const product = (i) => `<figure class="product-card"><div class="product-photo"><span class="product-noimg"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 8h16l-1 12H5L4 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg></span></div>
  <figcaption><div class="product-caption-top"><span class="product-name">대표 메뉴 ${i + 1}</span><span class="product-price">12,000원</span></div>
  <p class="product-desc">매일 아침 준비하는 대표 메뉴입니다. 재료 소진 시 조기 마감될 수 있습니다.</p></figcaption></figure>`;

const detailBody = `
<section class="biz-hero"><div class="container biz-hero-inner">
  <div class="biz-hero-lead">
    <span class="chip chip-light">음식점</span><span class="badge badge-ok">영업 중</span>
    <h1>샘플 가게</h1>
    <p class="biz-desc">동네에서 오래 사랑받아 온 가게입니다. 신선한 재료와 정성으로 준비합니다.</p>
    <div class="biz-actions"><button type="button" class="btn btn-share">가게 공유하기</button></div>
  </div>
  <aside class="biz-panel">
    <ul class="biz-contact">
      <li>${PIN}<span class="bc-label">주소</span><span class="bc-val">서울 서초구 어딘가 1길</span></li>
      <li>${PIN}<span class="bc-label">전화</span><a class="bc-val" href="tel:0212345600">02-1234-5600</a></li>
      <li>${PIN}<span class="bc-label">영업시간</span><span class="bc-val">10:00–21:00</span></li>
    </ul>
    <div class="biz-panel-actions"><a class="btn btn-primary btn-block" href="#">전화 걸기</a><a class="btn btn-ghost btn-block" href="#">길찾기</a></div>
  </aside>
</div></section>
<section class="section"><div class="container">
  <h2 class="biz-section-title">가게 소식</h2>
  <ul class="update-feed"><li class="update-item"><div class="update-body"><p>이번 주 신메뉴가 나왔습니다. 많이 찾아주세요!</p><time>07.20</time></div></li></ul>
  <h2 class="biz-section-title">쿠폰·혜택</h2>
  <div class="coupon-grid"><div class="coupon-card"><span class="coupon-punch"></span><span class="coupon-title">음료 1잔 무료</span><span class="coupon-terms">1만원 이상 주문 시</span><span class="coupon-meta">~ 2026.09.30</span></div></div>
  <h2 class="biz-section-title">제품·메뉴</h2>
  <div class="product-grid">${Array.from({ length: 4 }, (_, i) => product(i)).join("")}</div>
  <h2 class="biz-section-title">오시는 길</h2>
  <div class="biz-map"></div>
  <p class="biz-way">${PIN} 서울 서초구 어딘가 1길 · <a href="#">네이버 지도에서 길찾기 →</a></p>
  <h2 class="biz-section-title">이런 가게는 어때요</h2>
  <div class="market-grid">${Array.from({ length: 4 }, (_, i) => card(i + 4)).join("")}</div>
  <div class="section-more"><a href="#" class="btn btn-ghost btn-sm">← 다른 점포 보기</a></div>
</div></section>`;


// ── 점포 지도
const mapBody = `<section class="section page-top"><div class="container">
  <div class="section-head"><p class="section-eyebrow">MAP</p><h2 class="section-title">가입 점포 지도</h2><p class="section-lead">리스터코퍼레이션 가입 점포 6곳</p></div>
  <div class="chip-filters"><a href="#" class="chip-filter active">전체</a>${CATS.map((c) => `<a href="#" class="chip-filter">${c}</a>`).join("")}</div>
  <div class="map-fallback"><span class="mf-ico"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg></span><p>인터랙티브 지도는 관리자가 네이버 지도 키를 설정하면 표시됩니다. 아래 목록에서 각 점포의 네이버 지도를 열 수 있습니다.</p></div>
  <ul class="map-list">${Array.from({ length: 6 }, (_, i) => `<li class="map-store" data-lat="1" data-lng="1">
    <a href="#" class="map-store-name">샘플 가게 ${i + 1}</a><span class="chip">${CATS[i % CATS.length]}</span>
    <span class="map-store-addr">${PIN} 서울 서초구 어딘가 ${i + 1}길</span>
    <a class="map-store-link" href="#">네이버 지도에서 열기 →</a></li>`).join("")}</ul>
</div></section>`;

// ── 공지 목록
const noticeRow = (i) => `<li><a href="#"><span class="notice-ico${i === 0 ? " is-pinned" : ""}"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg></span>
  <span class="notice-main"><span class="notice-title">${i === 0 ? '<i class="pin-mini">공지</i>' : ""}상인회 정기 총회 및 하반기 사업 계획 안내 ${i + 1}</span><span class="notice-meta">2026.07.${String(10 + i).padStart(2, "0")}</span></span>
  <span class="notice-tag${i === 0 ? " tag-important" : ""}">${i === 0 ? "중요" : "안내"}</span>
  <span class="notice-chev"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5l7 7-7 7"/></svg></span></a></li>`;
const noticesBody = `<section class="section page-top"><div class="container">
  <div class="section-head"><p class="section-eyebrow">NOTICE</p><h2 class="section-title">공지사항</h2><p class="section-lead">총 8</p></div>
  <form method="get" action="#" class="board-search"><input type="search" placeholder="제목·내용 검색"><button class="btn btn-ghost btn-sm">검색</button></form>
  <div class="chip-filters"><a href="#" class="chip-filter active">전체</a><a href="#" class="chip-filter">안내 <em>5</em></a><a href="#" class="chip-filter">혜택 <em>3</em></a></div>
  <ul class="notice-list">${Array.from({ length: 6 }, (_, i) => noticeRow(i)).join("")}</ul>
  <nav class="pager"><span class="pg disabled">‹ 이전</span><span class="pg cur">1</span><a class="pg" href="#">2</a><a class="pg" href="#">다음 ›</a></nav>
</div></section>`;

// ── 공지 상세
const articleBody = `<section class="section page-top"><div class="container narrow">
  <a href="#" class="back-link">← 공지 목록</a>
  <div class="article-head"><span class="notice-tag tag-important">중요</span><time>2026.07.10</time></div>
  <h1 class="article-title">상인회 정기 총회 및 하반기 사업 계획 안내</h1>
  <div class="article-body">안녕하세요, 회원 여러분.<br /><br />2026년 하반기 정기 총회를 아래와 같이 개최합니다. 상권 활성화 사업 계획과 예산안을 함께 논의할 예정이니 많은 참석 부탁드립니다.<br /><br />일시: 2026년 8월 20일(목) 오후 7시<br />장소: 상인회 사무실 2층 회의실<br /><br />참석이 어려우신 분은 사무실로 미리 연락 주시기 바랍니다.</div>
  <div class="article-actions"><button type="button" class="btn btn-share">공지 공유하기</button></div>
</div></section>`;

// ── 행사
const eventsBody = `<section class="section page-top"><div class="container">
  <div class="section-head"><p class="section-eyebrow">EVENTS</p><h2 class="section-title">행사·소식</h2><p class="section-lead">회원은 행사별로 참가 신청을 할 수 있습니다.</p></div>
  <div class="event-grid">${Array.from({ length: 3 }, (_, i) => `<article class="event-card"><div class="event-date"><span class="d">${12 + i}</span><span class="m">8월</span></div>
    <div class="event-info"><div class="ev-head"><h3>여름 골목 축제 ${i + 1}</h3><span class="dday">D-${9 + i}</span></div>
    <p>가게마다 준비한 특별 할인과 먹거리 부스가 열립니다.</p><span class="event-place">${PIN} 중앙로 일대</span>
    <a class="event-cal" href="#">캘린더에 추가</a></div>
    <div class="event-rsvp"><span class="rsvp-count">참가 신청 ${3 + i}곳</span></div></article>`).join("")}</div>
</div></section>`;

const MODES = { list: listBody, detail: detailBody, map: mapBody, notices: noticesBody, article: articleBody, events: eventsBody };
const mode = process.argv[3] || "detail";
writeFileSync(process.argv[2], layout({ title: mode, assoc, base, user: null, body: MODES[mode] || detailBody }));
