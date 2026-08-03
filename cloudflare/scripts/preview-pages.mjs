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


// ── 로그인 / 가입 (인증 카드)
const MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l1.2-4.2A1 1 0 0 1 6.2 4h11.6a1 1 0 0 1 1 .8L20 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/></svg>';
const authHead = (t, sub) => `<div class="auth-head"><span class="mark auth-mark">${MARK}</span><h1 class="auth-title">${t}</h1><p class="auth-sub">${sub}</p></div>`;
const loginBody = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
  ${authHead("로그인", "상인회 회원·관리자 로그인")}
  <form method="post" action="#" class="stack-form">
    <label>이메일<input type="email" name="email" required /></label>
    <label>비밀번호<input type="password" name="password" required /></label>
    <label class="totp-login">2단계 인증 코드 <small>(설정한 경우만)</small><input type="text" name="totp" placeholder="000000" /></label>
    <button class="btn btn-primary btn-block">로그인</button>
  </form>
  <p class="auth-note"><a href="#">비밀번호를 잊으셨나요?</a></p></div></div></section>`;
const registerBody = `<section class="section page-top"><div class="container auth-wrap"><div class="auth-card">
  ${authHead("리스터코퍼레이션 가입", "점포 정보를 등록하고 사진·소식을 공유하세요.")}
  <form method="post" action="#" class="stack-form">
    <label>대표자 성함<input type="text" required /></label>
    <label>이메일<input type="email" required /></label>
    <label>비밀번호 (8자 이상)<input type="password" required /></label>
    <label>점포명<input type="text" required /></label>
    <label>업종<select>${CATS.map((c) => `<option>${c}</option>`).join("")}</select></label>
    <label class="check"><input type="checkbox" required /> <a href="#">개인정보 수집·이용</a>에 동의합니다.</label>
    <button class="btn btn-primary btn-block">가입 신청</button>
  </form><p class="auth-note">가입 후 관리자 승인 시 일반에 공개됩니다.</p></div></div></section>`;

// ── 회원 게시판
const boardBody = `<section class="section page-top"><div class="container">
  <div class="section-head"><p class="section-eyebrow">BOARD</p><h2 class="section-title">회원 게시판</h2><p class="section-lead">글 24</p></div>
  <form method="get" action="#" class="board-search"><input type="search" placeholder="제목·내용 검색"><button class="btn btn-ghost btn-sm">검색</button></form>
  <ul class="board-list">${Array.from({ length: 7 }, (_, i) => `<li class="board-row${i === 0 ? " pinned" : ""}">
    ${i === 0 ? '<span class="board-pin"><i class="pin-mini">공지</i></span>' : ""}
    <a class="board-title" href="#">상권 활성화 아이디어 모집합니다 ${i + 1}</a>
    <span class="board-meta">김상인 · 2026.07.${String(10 + i).padStart(2, "0")} · 댓글 ${i}</span></li>`).join("")}</ul>
  <nav class="pager"><span class="pg disabled">‹ 이전</span><span class="pg cur">1</span><a class="pg" href="#">2</a><a class="pg" href="#">다음 ›</a></nav>
</div></section>`;

// ── 투표
const pollsBody = `<section class="section page-top"><div class="container">
  <div class="section-head"><p class="section-eyebrow">VOTE</p><h2 class="section-title">안건 투표</h2><p class="section-lead">회원만 참여할 수 있습니다.</p></div>
  ${Array.from({ length: 2 }, (_, i) => `<div class="panel poll-card${i ? " is-closed" : ""}">
    <h3 class="panel-title">공동 판촉 행사 예산안 ${i + 1}</h3>
    <p class="poll-body">하반기 공동 판촉 행사 예산을 500만원으로 편성하는 안건입니다. 마감 2026.08.${20 + i}</p>
    ${i ? "" : '<div class="poll-actions"><button class="btn btn-sm btn-primary">찬성</button><button class="btn btn-sm btn-ghost">반대</button><button class="btn btn-sm btn-ghost">기권</button></div>'}
    <div class="poll-results">
      <div class="poll-bar"><span class="pb-label">찬성</span><span class="pb-track"><span class="pb-fill is-yes" style="width:62%"></span></span><span class="pb-pct">62%</span></div>
      <div class="poll-bar"><span class="pb-label">반대</span><span class="pb-track"><span class="pb-fill is-no" style="width:24%"></span></span><span class="pb-pct">24%</span></div>
      <div class="poll-bar"><span class="pb-label">기권</span><span class="pb-track"><span class="pb-fill is-abs" style="width:14%"></span></span><span class="pb-pct">14%</span></div>
    </div></div>`).join("")}
</div></section>`;


// ── 사장님 대시보드 (내 업체)
const dashBody = `<section class="dash"><div class="container">
  <div class="dash-head"><div><p class="section-eyebrow">MY BUSINESS</p><h1 class="dash-title">샘플 가게 <span class="badge badge-ok">승인</span></h1>
    <p class="dash-sub">공개 주소: <a href="#">/t/리스터코퍼레이션/business/sample</a></p></div>
    <div class="dash-head-actions"><form class="inline-form"><button class="btn btn-sm btn-ghost">오늘 임시휴무</button></form>
    <a href="#" class="btn btn-ghost btn-sm">전자서명</a></div></div>
  <section class="panel onboard"><h2 class="panel-title">시작하기</h2>
    <ul class="onboard-list">
      <li class="done"><span class="ob-check">✓</span><a href="#">가게 정보 채우기</a></li>
      <li><span class="ob-check"></span><a href="#">사진 3장 이상 올리기</a></li>
      <li><span class="ob-check"></span><a href="#">대표 메뉴 등록하기</a></li>
    </ul></section>
  <div class="dash-grid">
    <section class="panel"><h2 class="panel-title">업체 정보</h2>
      <form class="stack-form">
        <label>업체명<input type="text" value="샘플 가게" /></label>
        <label>업종<select>${CATS.map((c) => `<option>${c}</option>`).join("")}</select></label>
        <label>소개<textarea rows="4">동네에서 오래 사랑받아 온 가게입니다.</textarea></label>
        <div class="form-two"><label>전화<input type="tel" value="02-1234-5600" /></label><label>영업시간<input type="text" value="10:00–21:00" /></label></div>
        <label>주소<input type="text" value="서울 서초구 어딘가 1길" /></label>
        <div class="form-divider">SNS 링크 <small style="font-weight:400;color:var(--muted)">(선택 · 가게 페이지에 버튼으로 표시)</small></div>
        <div class="form-two"><label>인스타그램<input type="url" placeholder="instagram.com/가게계정" /></label><label>유튜브<input type="url" placeholder="youtube.com/@채널" /></label></div>
        <button class="btn btn-primary">정보 저장</button></form></section>
    <section class="panel"><h2 class="panel-title">사진 업로드</h2>
      <form class="upload-form">
        <label class="file-drop"><input type="file" /><span class="file-drop-text">📁 사진 선택 (최대 8MB)</span></label>
        <input type="text" placeholder="설명 (선택)" class="caption-input" />
        <button class="btn btn-primary">업로드</button></form>
      <div class="media-grid" style="margin-top:14px">${Array.from({ length: 3 }, (_, i) => `<figure class="media-tile"><div style="aspect-ratio:1;background:var(--surface-2)"></div>
        <figcaption><span class="media-kind">🖼 사진</span><button class="link-danger">삭제</button></figcaption></figure>`).join("")}</div></section>
  </div></div></section>`;

// ── 관리자 대시보드
const adminBody = `<section class="dash"><div class="container">
  <div class="dash-head"><div><p class="section-eyebrow">ADMIN · 리스터코퍼레이션</p><h1 class="dash-title">관리자 대시보드</h1></div>
    <div class="dash-head-actions"><a href="#" class="btn btn-ghost btn-sm">홈 구성 편집</a><a href="#" class="btn btn-primary btn-sm">공지 쓰기</a></div></div>
  <div class="stat-cards">
    <div class="stat-card"><span class="stat-num">42</span><span class="stat-label">가입 점포</span></div>
    <div class="stat-card stat-alert"><span class="stat-num">3</span><span class="stat-label">승인 대기</span></div>
    <div class="stat-card"><span class="stat-num">12</span><span class="stat-label">공지</span></div>
    <div class="stat-card"><span class="stat-num">3</span><span class="stat-label">행사</span></div>
    <div class="stat-card"><span class="stat-num">128</span><span class="stat-label">사진</span></div>
  </div>
  <section class="panel"><h2 class="panel-title">승인 대기 점포</h2>
    <div class="table-scroll"><table class="admin-table">
      <thead><tr><th>점포</th><th>업종</th><th>대표자</th><th>신청일</th><th>처리</th></tr></thead>
      <tbody>${Array.from({ length: 3 }, (_, i) => `<tr><td><strong>샘플 가게 ${i + 1}</strong><br /><small>서울 서초구 어딘가 ${i + 1}길</small></td>
        <td>${CATS[i]}</td><td>김상인</td><td>2026.07.${20 + i}</td>
        <td><span class="actions-cell"><button class="btn btn-xs btn-primary">승인</button><button class="btn btn-xs btn-ghost">반려</button></span></td></tr>`).join("")}</tbody>
    </table></div></section>
</div></section>`;

const MODES = { dash: dashBody, admin: adminBody, login: loginBody, register: registerBody, board: boardBody, polls: pollsBody, list: listBody, detail: detailBody, map: mapBody, notices: noticesBody, article: articleBody, events: eventsBody };
const mode = process.argv[3] || "detail";
writeFileSync(process.argv[2], layout({ title: mode, assoc, base, user: null, body: MODES[mode] || detailBody }));
