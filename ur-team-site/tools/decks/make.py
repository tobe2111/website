#!/usr/bin/env python3
"""유어팀 소개서 PDF 만들기 (병원 매출 전략 제안서와 같은 디자인).

  python3 tools/decks/make.py      → tools/decks/*.html 생성
  node tools/decks/print.cjs       → assets/files/*.pdf 로 인쇄

글꼴(Pretendard)은 tools/decks/fonts/ 에 둡니다 (저장소에는 올리지 않음):
  https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/public/static/Pretendard-{Regular,SemiBold,Bold}.otf
"""
from pathlib import Path

HERE = Path(__file__).parent
IMG = "../../assets/img/brochure/"
LOGO_W = "../../assets/img/urteam_white.png"
CONTACT = {"tel": "0503-7151-4726", "mail": "jiwon@ur-team.com",
           "addr": "서울특별시 강남구 남부순환로359길 14, 3F", "home": "www.ur-team.com"}


class Deck:
    def __init__(self, title):
        self.title, self.pages = title, []

    def page(self, html, cls=""):
        self.pages.append((cls, html))

    def std(self, section, body, dark=False):
        """머리(섹션 이름 · Analysis Marketing Branding) + 본문 + 바닥(Urteam Agency · 쪽 번호)"""
        n = len(self.pages) + 1
        top = f'<div class="top"><span>{section}</span><span>Analysis Marketing Branding</span></div>' if section else ""
        self.page(f'{top}<div class="body">{body}</div><div class="foot"><span>Urteam Agency</span><span>{n}</span></div>',
                  "dark" if dark else "")

    def html(self):
        pages = "\n".join(f'<section class="s {c}">{h}</section>' for c, h in self.pages)
        return f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>{self.title}</title><link rel="stylesheet" href="deck.css"></head><body>{pages}</body></html>'


def cover(d, l1, l2, en):
    d.page(f'<h1>{l1}<br>{l2}</h1><p>{en}</p><img src="{LOGO_W}" alt="UrTeam">', "cover")


def purpose(d, paras):
    n = len(d.pages) + 1
    ps = "".join(f"<p>{p}</p>" for p in paras)
    d.page(f'<div class="purpose"><h2>PURPOSE AND<br>MOTIVATION</h2><div>{ps}</div></div>'
           f'<div class="foot"><span>Urteam Agency</span><span>{n}</span></div>', "dark")


def toc(d, items):
    rows = "".join(f'<div><span>{i+1:02d}</span><span>{t}</span><span>{p}</span></div>' for i, (t, p) in enumerate(items))
    d.std("CONTENTS", f'<div class="toc">{rows}</div>')


def interlude(d, small, box, after=""):
    d.std("", f'<div class="center"><h2>{small}</h2><div class="callout">{box}</div>{f"<p>{after}</p>" if after else ""}</div>', dark=True)


def back(d):
    c = CONTACT
    d.page(f'<img src="{LOGO_W}" alt="UrTeam"><h2>당신의 팀, 유어팀</h2><p>GLOBAL MARKETING &amp; REVENUE AGENCY</p>'
           f'<dl><div><dt>TEL</dt><dd>{c["tel"]}</dd></div><div><dt>E-MAIL</dt><dd>{c["mail"]}</dd></div>'
           f'<div><dt>ADDRESS</dt><dd>{c["addr"]}</dd></div><div><dt>HOMEPAGE</dt><dd>{c["home"]}</dd></div></dl>', "back")


def img(name, cap=""):
    c = f'<p class="cap">{cap}</p>' if cap else ""
    return f'<div><div class="fig"><img src="{IMG}{name}.webp" alt=""></div>{c}</div>'


# ───────────────────────── 중국 수출 마케팅 제안서 ─────────────────────────
def china():
    d = Deck("유어팀 중국 수출 마케팅 제안서")
    cover(d, "유어팀 코퍼레이션", "중국 수출 마케팅 제안서", "CHINA EXPORT MARKETING &amp; BRANDING PROPOSAL<br>FOR KOREAN BRANDS")
    purpose(d, ["한국의 매력적인 브랜드와 제품을 중국 시장과 연결하고, 브랜딩 · 마케팅 · 커머스를 하나로 실행하는 '현지화 기반 실행 조직'입니다.",
                "중국 현지화 브랜딩을 넘어 LIVE 트래픽 확보부터 판매 전환까지, <b>성과로 책임지는 글로벌 파트너</b>가 되겠습니다.",
                "브랜드에게 '성과가 보이고, 상품이 팔리고, 매출이 오르는' 경험을 만드는 것이 유어팀의 비전입니다."])
    toc(d, [("중국 시장 배경", 4), ("왜 LIVE 커머스인가", 7), ("현지 인프라", 10), ("유어팀 실행 전략", 11),
            ("사업 모델", 16), ("레퍼런스", 19), ("맺음말", 21)])
    S1 = "01 중국 시장 배경"
    d.std(S1, f'''<h1 class="t">콘텐츠와 LIVE 커머스로 대이동</h1>
<p class="sub">샤오홍슈 · 더우인 · 타오바오 · 징둥 · 티몰 · 더우, 6대 플랫폼 가운데<br>콘텐츠로 구매가 일어나는 <b class="blue">샤오홍슈와 더우인 LIVE</b>에 집중합니다.</p>
<div class="cols"><div class="panel"><ul class="list">
<li><b>한한령 완화</b> 이후 중국 내 한국 브랜드 수요 회복</li>
<li><b>단순 수출 · 리셀 모델의 한계</b>, 브랜딩과 실질 성과 요구 증가</li>
<li>소비 흐름이 <b>현지 SNS 플랫폼 중심</b>으로 이동</li>
<li><b>LIVE 커머스와 콘텐츠 중심</b> 소비문화 확대</li>
<li><b>실질 매출 · 전환 기반</b> 실행 파트너 수요 급증</li></ul></div>
{img("cn-news", "한한령 완화 관련 국내 보도")}</div>''')
    rows = [("샤오홍슈 小红书", 63, 89), ("더우인 抖音", 61, 88), ("위챗 WeChat", 88, 76), ("티몰 天猫", 84, 69), ("티몰 LIVE", 67, 38),
            ("징둥 京东", 32, 49), ("웨이보 微博", 35, 27), ("빌리빌리", 25, 24), ("콰이쇼우 快手", 20, 16), ("즈후 知乎", 12, 14)]
    bars = "".join(f'<div><span>{n}</span><i style="--a:{a}%;--b:{b}%"></i><em>{a} → <b>{b}%</b></em></div>' for n, a, b in rows)
    d.std(S1, f'''<h1 class="t">브랜드가 주목하는 핵심 플랫폼 2023 → 2024</h1>
<p class="sub">성장세의 마케팅 집중 플랫폼은 샤오홍슈 · 더우인, 전통 이커머스 채널(티몰 · 징둥 · 웨이보)은 하향세입니다.</p>
<div class="cols cols--wide"><div><div class="legend"><span><i style="background:#b9cdf0"></i>2023</span><span><i style="background:#267dff"></i>2024</span></div><div class="bars">{bars}</div></div>
<div class="blocks"><div class="stat"><b>74<small>%</small></b><span>샤오홍슈에 마케팅 예산을 늘린 브랜드</span></div>
<div class="stat"><b>70<small>%</small></b><span>더우인에 마케팅 예산을 늘린 브랜드</span></div>
<div class="panel"><p style="font-size:11pt;line-height:1.6">단순 광고 채널을 넘어 <b class="blue">LIVE 커머스 전환에 최적화된 플랫폼</b>으로 예산이 이동하고 있습니다.</p></div></div></div>''')
    d.std(S1, f'''<h1 class="t">중국으로 가는 한국 브랜드의 글로벌 브릿지</h1>
<p class="sub">콘텐츠를 보다가 상품을 발견하고, 그 자리에서 구매합니다.</p>
<div class="cols">{img("cn-phones")}<div class="blocks" style="align-content:center">
<div class="blk"><h3>샤오홍슈 小红书</h3><p>20~35세 여성 70% · MAU 3억. 정보 검색과 공유, 후기로 구매를 결정하는 플랫폼</p></div>
<div class="blk"><h3>더우인 抖音</h3><p>18~35세 · MAU 7억. 오락과 소비가 함께 일어나는 숏폼 · LIVE 커머스</p></div>
<div class="blk"><h3>웨이보 微博</h3><p>18~30세 · MAU 3~5억. 언론 기사와 연예인 이슈 중심의 확산 채널</p></div></div></div>''')
    S2 = "02 왜 LIVE 커머스인가"
    d.std(S2, '''<h1 class="t">왜 LIVE 커머스가 전통 커머스보다 전환이 높을까요?</h1>
<div class="cols" style="grid-template-columns:1fr;gap:6mm">
<div style="display:grid;grid-template-columns:1.5fr 1fr;gap:5mm">
<div class="fbox"><p>전통 커머스 전환 퍼널</p><div class="funnel"><span>콘텐츠</span><span>사이트 · 앱 이동</span><span>검색</span><span>상품 페이지</span><span>결제</span></div></div>
<div class="fbox fbox--live"><p>LIVE 커머스 전환 퍼널</p><div class="funnel funnel--live"><span>콘텐츠 = 상점</span><span>결제</span></div><strong>단계 축소 = 이탈률 ↓ · 구매 전환율 ↑</strong></div></div>
<div class="reasons">
<div><h3><span>01</span>발견 기반 쇼핑</h3><p>소비자 70% 이상이 샤오홍슈 · 더우인 콘텐츠를 보다가 상품을 발견해 구매합니다.</p></div>
<div><h3><span>02</span>초개인화 알고리즘</h3><p>AI 추천이 잠재 니즈를 구매로 바꾸고, 앱 안 결제(위챗페이 · 알리페이)로 이탈을 줄입니다.</p></div>
<div><h3><span>03</span>퍼스트 파티 데이터 기반 ROI</h3><p>행동 · 결제 데이터를 쓰는 커머스 광고는 전통 광고보다 ROI가 평균 20~30% 높습니다.</p></div>
<div><h3><span>04</span>폐쇄 루프 측정</h3><p>노출 → 클릭 → 구매 → 재방문까지 플랫폼 안에서 추적해 성과를 바로 확인합니다.</p></div></div></div>''')
    d.std(S2, '''<h1 class="t">한류의 최전성기는 지금, 중국을 휘어잡는 K-Commerce</h1>
<div class="cols"><div style="display:grid;align-content:center;gap:5mm"><div class="donut"><b>33%</b><small>한국 브랜드</small></div>
<div class="legend" style="justify-content:center"><span><i style="background:#b9cdf0"></i>글로벌 브랜드 50%</span><span><i style="background:#267dff"></i>한국 브랜드 33%</span><span><i style="background:#d9dde3"></i>기타 17%</span></div>
<p class="cap" style="text-align:center">2024 중국 라이브 커머스 해외 브랜드 시장 규모 약 50조 원 중 비중 (출처: KOTRA)</p></div>
<div style="display:grid;align-content:center;gap:4mm"><div class="stats">
<div class="stat"><b>1,030<small>조 원</small></b><span>2024 중국 커머스 시장 규모</span></div>
<div class="stat"><b>20<small>조 원</small></b><span>한국 브랜드 비중 (약 2%)</span></div>
<div class="stat"><b>5<small>배</small></b><span>중국 진출 한국 브랜드 5년간 성장</span></div>
<div class="stat"><b>+44<small>%</small></b><span>연평균 성장률</span></div></div>
<p style="font-size:11pt;line-height:1.6;color:#333">입점 브랜드 수 증가, 판매 전환 효율, 로컬 파트너 확대를 바탕으로 중국 라이브 커머스는 성장 잠재력이 높은 블루오션입니다.</p></div></div>''')
    interlude(d, "이런 성과는 현지 인프라에서 나옵니다.", "“중국 현지 파트너의 인프라 위에서<br>한국 브랜드의 실행력을 더합니다.”", "기획에서 실행까지 하나의 흐름으로 연결합니다.")
    d.std("03 현지 인프라", f'''<h1 class="t">Nanor Partner 연계, 중국 인프라 기반 구조</h1>
<p class="sub">2014년 설립 · 2024년 연매출 3,000억 원 · 화장품 · 가방 · 주얼리 등 여성 카테고리 중심 · 누적 노출 10억 뷰 · 고객 접점 2.5억 명 이상</p>
<div class="stats stats--3" style="margin-top:5mm">
<div class="stat"><b>1,500<small>만</small></b><span>중국 전 채널 팔로워</span></div><div class="stat"><b>1,100<small>억</small></b><span>전체 SNS 조회 수</span></div>
<div class="stat"><b>10<small>억</small></b><span>평균 매출 성장 금액</span></div><div class="stat"><b>420<small>만+</small></b><span>입점 브랜드 누적 팔로워</span></div>
<div class="stat"><b>200<small>만+</small></b><span>전 플랫폼 여성 소비자</span></div><div class="stat"><b>200<small>만+</small></b><span>하루 평균 콘텐츠 재생 수</span></div></div>
<div style="margin-top:5mm;--mh:66mm">{img("cn-kol", "전속 왕홍 · 중국 MCN 셀럽으로 한국 브랜드 전용 LIVE를 기획하고, 700만 팔로워 기반 콘텐츠 계정을 활용합니다.")}</div>''')
    S4 = "04 유어팀 실행 전략"
    d.std(S4, f'''<h1 class="t">현지 SNS 마케팅 대행</h1>
<p class="sub">현지 소비자가 실제로 보는 곳에서, 현지 언어와 트렌드로 알립니다.</p>
<div class="cols"><div class="blocks">
<div class="blk"><h3>KOC · KOL 시딩</h3><p>플랫폼별 타깃에 맞춘 체험형 콘텐츠, 1만 이하부터 10만 이상 왕홍 바이럴, 숏츠 · 후기 · UGC 영상 기획과 제작</p></div>
<div class="blk"><h3>현지 SNS 오피셜 계정 운영</h3><p>브랜드 콘텐츠 미러링 · 현지화, 공식 인증 뱃지, 인피드 · 검색 광고 집행</p></div>
<div class="blk"><h3>플랫폼 해시태그 · 랭킹 전략</h3><p>플랫폼별 노출 우선순위 해시태그 설계, 키워드 검색 상단 노출 최적화</p></div>
<div class="blk"><h3>SNS 시장 분석 · 마케팅 리포트</h3><p>인지도 · 경쟁 브랜드 전략 분석, 콘텐츠 반응과 SNS 성과 리포트</p></div></div>
{img("cn-sns", "샤오홍슈 · 더우인 체험단 · 키워드 상단 노출 · 공식계정 개설과 인증 · 콘텐츠 현지화 운영")}</div>''')
    d.std(S4, f'''<h1 class="t">전속 왕홍 인프라, 트래픽 중심 LIVE로 매출 보장</h1>
<p class="sub">100만 팔로워 이상 왕홍을 포함해 20개 팀을 직접 운영하고, 더우인 · 샤오홍슈 플랫폼별 전용 왕홍을 보유합니다.</p>
<div class="stats stats--4" style="margin-top:5mm">
<div class="stat"><b>20<small>개 팀</small></b><span>전속 왕홍 직접 운영</span></div><div class="stat"><b>3<small>일</small></b><span>제품 수령 후 방송까지</span></div>
<div class="stat"><b>5<small>억 원+</small></b><span>단일 방송 최대 매출</span></div><div class="stat"><b>5<small>%</small></b><span>평균 구매전환율 최대 (패션)</span></div></div>
<div class="cols" style="margin-top:5mm">{img("cn-wanghong", "전속 왕홍 계정 · 팔로워 196.1만 · 58.4만 · 33.7만 · 22.2만 · 19.3만")}
<div class="panel"><ul class="list"><li>높은 트래픽과 매출 구조에 맞는 <b>LIVE 기획 · 송출 노하우</b></li><li>스튜디오 · 촬영 · CS까지 <b>자체 실행</b></li><li>전속 왕홍의 운영 사례와 성과를 분석해 <b>브랜드와 매칭</b></li><li>브랜드 컨셉에 맞는 <b>호스트 추가 섭외</b></li></ul></div></div>''')
    d.std(S4, f'''<h1 class="t">스토어 입점 및 운영 대행</h1>
<p class="sub">더우인 · 타오바오 · 샤오홍슈 · 징둥 · 티몰 · 더우, 중국 메이저 커머스 플랫폼</p>
<div class="cols"><div class="blocks">
<div class="blk"><h3>입점 프로세스 대행</h3><p>현지 인허가 · 필요 서류 준비와 입점, 트렌드에 맞춘 스토어 꾸미기 · 초기 설정</p></div>
<div class="blk"><h3>어드민 · 제품 관리 최적화</h3><p>재고 · 가격 실시간 관리, 제품 상세페이지 현지화</p></div>
<div class="blk"><h3>전반적인 CS 대행</h3><p>현지 소비자와 실시간 소통, 제품 문의 CS · AS 운영</p></div>
<div class="blk"><h3>콘텐츠 · 캠페인 운영 설계</h3><p>판매 주도형 콘텐츠, 프로모션 · 가격 정책 · 타임세일 등 매출 집중 시기 관리</p></div>
<div class="blk"><h3>운영 전략 · 리포팅 자동화</h3><p>월간 리포트, 실적 분석, 경쟁사 벤치마킹</p></div></div>
<div style="display:grid;align-content:center">{img("cn-admin", "판매 금액 ¥3,900,000 이상 · 거래 12,000건 이상 · 월 방문 8만 회 이상 · 구매 전환율 1.5% 이상<br>타오바오 CS: 3분 안 응답률 100% · 문제 해결률 95% 이상 · 만족도 98% 이상")}</div></div>''')
    d.std(S4, f'''<h1 class="t">중국 전역 클라우드 물류 운영 (3PL)</h1>
<p class="sub">중국 전역을 아우르는 스마트 풀필먼트 물류 인프라</p>
<div class="cols">{img("cn-3pl", "상하이 · 항저우 · 선전 · 창사 4개 핵심 거점")}
<div style="display:grid;align-content:center;gap:4mm"><div class="stats">
<div class="stat"><b>20<small>만 평</small></b><span>4개 거점 창고 규모</span></div><div class="stat"><b>5<small>만 종+</small></b><span>처리 가능 SKU</span></div>
<div class="stat"><b>10<small>만 건+</small></b><span>하루 출고</span></div><div class="stat"><b>100<small>%</small></b><span>AI 입출고 시스템 재고 정확도</span></div></div>
<div class="panel"><p style="font-size:10.5pt;line-height:1.6">전담 인력 100명. 제품 특성과 유통 전략에 맞춰 창고 위치를 설계하고, <b class="blue">입고 → 검수 → 재고관리 → 분류 → 라벨링 → 출하</b>까지 일괄 대행합니다.</p></div></div></div>''')
    d.std(S4, '''<h1 class="t">한국 PPL 기반, 현지 브랜딩 &amp; C2V 마케팅</h1>
<p class="sub">중국 현지화 브랜드를 위한 맞춤 Creative 솔루션</p>
<div class="cols" style="grid-template-columns:repeat(2,1fr);align-content:start;gap:5mm">
<div class="panel"><h3 class="k" style="font-size:12pt">PPL 마케팅</h3><p style="margin-top:2mm;font-size:11pt;line-height:1.6">현지 지역과 타깃에 맞춘 전문 PPL 솔루션. 한국 콘텐츠(드라마 · 영화 · 예능) PPL 라이선스를 활용합니다.</p></div>
<div class="panel"><h3 class="k" style="font-size:12pt">캠페인 기획 · 제작</h3><p style="margin-top:2mm;font-size:11pt;line-height:1.6">PPL과 연계한 디지털 · TVC 캠페인, 키비주얼 · 키메시지 · 슬로건 제작</p></div>
<div class="panel"><h3 class="k" style="font-size:12pt">오프라인 K 콘텐츠</h3><p style="margin-top:2mm;font-size:11pt;line-height:1.6">K 콘텐츠 이벤트 · 팝업 스토어 기획, 협찬 PPL 대행</p></div>
<div class="panel"><h3 class="k" style="font-size:12pt">한국 셀럽 협업</h3><p style="margin-top:2mm;font-size:11pt;line-height:1.6">한국 셀럽(연예인 · 인플루언서) SNS, 현지 팬미팅 스폰서십과 브랜드 협찬 행사</p></div></div>''')
    S5 = "05 사업 모델"
    d.std(S5, '''<h1 class="t">유어팀 중국 진출 마케팅 서비스 요약</h1>
<div style="margin-top:6mm"><table><thead><tr><th>사업 모델</th><th>주요 채널</th><th>수익 구조</th><th>핵심 키워드</th></tr></thead><tbody>
<tr><th>중국 SNS 마케팅</th><td>샤오홍슈 · 더우인</td><td>대행 수수료</td><td>SNS 체험단, 왕홍 시딩, 공식계정 인증 · 운영</td></tr>
<tr><th>사입 (Buy &amp; Resell)</th><td rowspan="2">더우인 · 타오바오 · 샤오홍슈<br>징둥 · 티몰 · 더우</td><td>판매 수익</td><td>리셀링, 초기 테스트, 단발성 판매</td></tr>
<tr><th>스토어 입점 &amp; 유통 대행</th><td>대행 수수료</td><td>공식 스토어 입점 세팅, 통관 · 유통 프로세스 대행</td></tr>
<tr><th>중국향 브랜드 총판</th><td>온 · 오프라인 전 유통</td><td>판매 수익</td><td>독점 계약, 생산 · 판매 권한</td></tr>
<tr><th>중국향 브랜딩 &amp; 마케팅</th><td>온 · 오프라인 영상, 키비주얼</td><td>대행 수수료</td><td>현지화 브랜딩, 영상 · 이미지 납품</td></tr>
<tr><th>중국향 PPL 마케팅</th><td>온라인 전 유통</td><td>판매 수익 · 대행 수수료</td><td>한국 콘텐츠 PPL 라이선스 활용</td></tr></tbody></table></div>''')
    steps = [("오프라인 매장 방문 촬영", "브랜드 스토리 · 디자인 컨셉 · 제품 추천"), ("홍보 콘텐츠 업로드", "샤오홍슈 · 더우인 등 SNS 홍보"),
             ("소비자 반응 체크", "인터랙션 · 댓글 · 피드백 확인"), ("사입 제품 리스트 확정", "재고 확인 · 공급가 협의"),
             ("계약 체결 · 제품 구입", "가격 · 수량 확정, 납품"), ("중국향 제품 운송", "품질 검수 · 통관"),
             ("라이브방송 판매", "셀럽 채널 라방 · 발송 · CS"), ("반복 주문", "성과 기반 재주문 → 구조적 수익화")]
    flow = "".join(f'<div><em>STEP {i+1:02d}</em><b>{a}</b><span>{b}</span></div>' for i, (a, b) in enumerate(steps))
    d.std(S5, f'''<h1 class="t">사입 (Buy &amp; Resell), 중국 커머스 One-Stop</h1>
<p class="sub">브랜드 제품을 직접 사입해 중국 셀럽 LIVE 커머스 채널에서 판매합니다. 테스트 물량 → 성과 기반 반복 주문 → 구조적 수익화.</p>
<div class="flow" style="margin-top:7mm">{flow}</div>''')
    d.std(S5, '''<h1 class="t">중국 브랜드 총판 · 중국향 브랜딩 &amp; 마케팅</h1>
<div class="cols"><div class="panel"><h3 class="k" style="font-size:13pt">중국 브랜드 총판 관리</h3>
<ul class="list" style="margin-top:4mm"><li>총판권 확보 후 현지 유통 · 프로모션 실행</li><li>콘텐츠 마케팅 · 오프라인 스토어 병행</li><li>단독 유통 구조로 고정 수익 · 재고 대응</li><li>공식 스토어 · SNS 공식계정 · KOC/KOL · 현지 공장 생산 · 물류 창고까지</li><li>안정적인 수익과 로열티 구조 확보</li></ul></div>
<div class="panel"><h3 class="k" style="font-size:13pt">중국향 브랜딩 &amp; 마케팅 대행</h3>
<ul class="list" style="margin-top:4mm"><li>인지도 확장과 선호도를 위한 키메시지 · 키비주얼 정립</li><li>브랜드 정체성을 지킨 채 현지 타깃 최적화</li><li>영상 · 패키지 · 옥외광고 제작과 현지 미디어 믹스</li><li>방향성과 마켓 니즈에 맞춘 전략적 매체 바잉</li><li>매출 KPI 기반, 브랜딩과 세일즈를 잇는 통합 캠페인</li></ul></div></div>''')
    S6 = "06 레퍼런스"
    d.std(S6, f'''<h1 class="t">중국 SNS 체험단 레퍼런스</h1>
<p class="sub">샤오홍슈 · 더우인 인플루언서 1:1 섭외 → 현지화 가이드라인 → 결과물 검수 → 리뷰 활성화와 바이럴 확산</p>
<div style="display:grid;gap:3mm;margin-top:4mm;--mh:56mm"><div><p class="k" style="margin-bottom:1.5mm">#패션 #잡화</p><div class="refimg"><img src="{IMG}cn-seed-fashion.webp" alt=""></div></div>
<div><p class="k" style="margin-bottom:1.5mm">#뷰티</p><div class="refimg"><img src="{IMG}cn-seed-beauty.webp" alt=""></div></div></div>''')
    d.std(S6, f'''<h1 class="t">공식계정 운영 · 공식몰 입점 레퍼런스</h1>
<p class="sub">공식계정 개설 · 프로페셔널 인증 · 피드 · CS 관리, 플래그십 공식몰 입점과 어드민 운영</p>
<div style="display:grid;gap:3mm;margin-top:4mm;--mh:60mm"><div class="refimg"><img src="{IMG}cn-official.webp" alt=""></div><div class="refimg"><img src="{IMG}cn-store.webp" alt=""></div></div>''')
    interlude(d, "중국 진출, 어디서부터 시작할지", "“성과가 보이고, 상품이 팔리고,<br>매출이 오르는 경험을 함께 만듭니다.”", "유어팀 홈페이지 ur-team.com 에서 상담을 신청하실 수 있습니다.")
    back(d)
    return d


# ───────────────────── 피부과 · 병의원 중국 SNS 홍보 사례 ─────────────────────
def sns():
    d = Deck("유어팀 피부과 · 병의원 중국 SNS 홍보 사례")
    cover(d, "유어팀 코퍼레이션", "피부과 · 병의원 중국 SNS 홍보 사례", "CHINA SNS MARKETING CASES<br>FOR KOREAN CLINICS")
    purpose(d, ["중국 관광객은 한국 병원을 샤오홍슈에서 찾고, 후기를 보고 예약합니다.",
                "원장님 병원이 중국 SNS에서 <b>먼저 찾는 병원</b>이 될 수 있도록, 유어팀이 진행한 체험단 리뷰 콘텐츠와 공식계정 운영 사례를 모았습니다."])
    toc(d, [("서비스 개요", 4), ("체험단 리뷰 콘텐츠", 5), ("공식계정 운영", 8), ("맺음말", 11)])
    d.std("01 서비스 개요", '''<h1 class="t">중국 SNS에서 병원을 알리는 두 가지 방법</h1>
<div class="stats stats--4" style="margin-top:6mm">
<div class="stat"><b>9.4<small>만</small></b><span>체험단 최대 팔로워</span></div><div class="stat"><b>4,191</b><span>게시물 1건 최대 저장 수</span></div>
<div class="stat"><b>6<small>곳</small></b><span>체험단 레퍼런스</span></div><div class="stat"><b>4<small>곳</small></b><span>공식계정 운영 레퍼런스</span></div></div>
<div class="cols" style="margin-top:6mm"><div class="panel"><h3 class="k" style="font-size:13pt">체험단 리뷰 콘텐츠</h3><ul class="list" style="margin-top:4mm">
<li>샤오홍슈 · 더우인 인플루언서 <b>1:1 섭외</b></li><li>병원 컨셉에 맞춘 <b>현지화 가이드라인</b>과 결과물 검수</li><li>동영상 · 이미지 후기로 <b>리뷰 활성화와 바이럴 확산</b></li></ul></div>
<div class="panel"><h3 class="k" style="font-size:13pt">공식계정 운영</h3><ul class="list" style="margin-top:4mm">
<li>샤오홍슈 · 더우인 <b>공식계정 개설과 운영</b></li><li>프로페셔널 계정(블루체크) <b>인증 대행</b></li><li>콘텐츠 현지화, <b>댓글 · DM 문의 처리</b></li></ul></div></div>''')
    refs = [("sn-1", [("강남 피부과 체험단", "팔로워 2,083 · 동영상", "좋아요 3,400 · 저장 4,191 · 댓글 83", "2024.02.20"), ("강남 피부과 체험단", "팔로워 9.4만 · 동영상", "좋아요 439 · 저장 132 · 댓글 24", "2025.04.26")]),
            ("sn-2", [("강남 피부과 체험단", "팔로워 8.2만 · 동영상", "좋아요 43 · 저장 21 · 댓글 8", "2025.10.23"), ("명동 병의원 체험단", "팔로워 2.5만 · 동영상", "좋아요 21 · 저장 8 · 댓글 2", "2025.10.22")]),
            ("sn-3", [("청담 피부과 체험단", "팔로워 2,156 · 이미지", "좋아요 155 · 저장 118 · 댓글 7", "2025.01.20"), ("명동 피부과 체험단", "팔로워 2,690 · 이미지", "좋아요 202 · 저장 170 · 댓글 18", "2024.11.23")])]
    for i, (im, ms) in enumerate(refs):
        meta = "".join(f'<div><b>{a}</b><span>{b} · {dt}</span><em>{c}</em></div>' for a, b, c, dt in ms)
        d.std("02 체험단 리뷰 콘텐츠", f'''<h1 class="t">피부과 · 병의원 체험단 레퍼런스 {i*2+1} · {i*2+2}</h1>
<div style="margin-top:5mm"><div class="refimg"><img src="{IMG}{im}.webp" alt=""></div><div class="meta">{meta}</div></div>''')
    interlude(d, "PART 02", "“공식계정은 병원의 중국 내 얼굴입니다.”", "개설 · 인증 · 콘텐츠 현지화 · 댓글과 DM 관리까지 대행합니다.")
    offs = [("sn-4", [("강남 셀린 피부과", "공식계정 · 팔로워 2,594"), ("강남 아이디 피부과", "공식계정 · 팔로워 759")]),
            ("sn-5", [("강남 반니 성형외과의원", "공식계정 · 팔로워 1,707"), ("강남 소유 피부과", "공식계정 · 팔로워 73")])]
    for i, (im, ms) in enumerate(offs):
        meta = "".join(f'<div><b>{a}</b><span>{b}</span></div>' for a, b in ms)
        d.std("03 공식계정 운영", f'''<h1 class="t">피부과 · 병의원 공식계정 레퍼런스 {i*2+1} · {i*2+2}</h1>
<div style="margin-top:5mm"><div class="refimg"><img src="{IMG}{im}.webp" alt=""></div><div class="meta">{meta}</div></div>''')
    interlude(d, "저희는 동일 지역 내 경쟁 병원은 맡지 않습니다.", "“원장님 병원이 중국 SNS에서<br>먼저 찾는 병원이 되도록.”", "유어팀 홈페이지 ur-team.com 에서 상담을 신청하실 수 있습니다.")
    back(d)
    return d


if __name__ == "__main__":
    for name, deck in [("china-export", china()), ("china-sns-clinic", sns())]:
        (HERE / f"{name}.html").write_text(deck.html(), encoding="utf-8")
        print(name, len(deck.pages), "쪽")
