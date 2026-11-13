#!/usr/bin/env python3
"""마케팅 상품 8개 페이지를 아임웹 원본 순서대로 만든다 (한 번 돌리고 결과 HTML 을 고쳐 쓴다).

    python3 ur-team-site/tools/gen_products.py <렌더 결과 폴더>

<렌더 결과 폴더>: 아임웹 원본을 브라우저로 띄워 보이는 글자를 뽑아 둔 product-N.json 과
product-N.html (사진 주소를 아임웹 서버로 되돌린 것)이 있는 곳.
"""
import html, json, os, re, sys
from bs4 import BeautifulSoup, NavigableString

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = sys.argv[1]
IMGS = json.load(open(os.path.join(ROOT, "source", "imweb-images.json")))
SIZES = json.load(open(os.path.join(ROOT, "source", "imweb-sizes.json")))
by_file = {u.rsplit("/", 1)[-1]: k for k, u in IMGS.items() if k.startswith("p-")}

PRODUCTS = [
    ("product-1", "naver", "네이버", "유어팀 네이버 광고", "네이버의 모든 온라인 광고 지면을 바탕으로 업체 현황과 시장성을 근거로 광고를 집행합니다.", "검색 · 쇼핑검색 · 파워컨텐츠 · 브랜드검색 · 성과형 DA"),
    ("product-2", "google", "구글", "유어팀 구글 애즈 광고", "Google 검색, 디스플레이 네트워크, YouTube 등 광고 게재가 가능한 플랫폼 광고 상품입니다.", "Search Ads · PMAX(Performance Max)"),
    ("product-3", "blog-marketing", "블로그", "유어팀 블로그 광고", "단순한 글쓰기 플랫폼이 아니라, 브랜드와 고객 간의 소통의 장이자 검색엔진에서의 가시성을 높이는 도구입니다.", "브랜드 블로그 · 체험단 블로그"),
    ("product-4", "daangn", "당근마켓", "유어팀 당근마켓 광고", "3,900만 명 지역 광고 기반으로 특화된 온 · 오프라인 광고 집행 플랫폼입니다.", "네이티브 피드 · 카탈로그 광고"),
    ("product-5", "momcafe", "맘카페", "유어팀 카페 광고", "온라인 카페 혹은 커뮤니티 플랫폼을 통해 상품, 서비스, 브랜드에 대한 긍정적 리뷰나 정보를 확산시키는 마케팅입니다.", "수만~수십만 회원 카페 바이럴"),
    ("product-6", "place", "플레이스/리뷰", "유어팀 플레이스 | 리뷰", "네이버 스마트플레이스는 사업장의 정보를 노출하고, 리뷰는 신뢰를 쌓아 고객의 방문을 유도하는 핵심 마케팅 채널입니다.", "네이버 플레이스 · 리뷰 관리"),
    ("product-8", "experience", "체험단", "유어팀 체험단 광고", "기업이 제품이나 서비스를 소비자(체험단)에게 제공하고, 사용 후기나 콘텐츠를 공유하도록 유도하는 마케팅입니다.", "블로그 · 유튜브 · 인스타그램 체험단"),
    ("product-9", "press", "언론", "유어팀 언론 광고", "공신력과 신뢰도를 더한 언론 보도 마케팅. 저렴한 단가에 유어팀 올인원 서비스로 진행합니다.", "인터넷 언론 기사 · 직 · 간접 마케팅"),
]
MENU = {"네이버", "구글", "블로그", "당근마켓", "맘카페", "플레이스/리뷰", "홈페이지 제작", "체험단", "언론", "마케팅 상품",
        "유어팀 마케팅", "나에게 딱 맞는 광고만 기획/구성해주는 유어팀 마케팅", "병원 마케팅", "해외 환자 유치", "리스터코퍼레이션", "블로그"}


def esc(s):
    return html.escape(s, quote=False)


def sequence(src, slug):
    """원본 문서 순서대로 (글/사진) 조각을 뽑는다. 글은 화면에 실제로 보였던 것만."""
    seen = json.load(open(os.path.join(EXT, src + ".json")))
    big = {}
    for i in seen:
        if i["t"] == "text" and i["y"] > 900:
            big[i["v"]] = max(big.get(i["v"], 0), i["fs"])
    soup = BeautifulSoup(open(os.path.join(EXT, src + ".html"), encoding="utf-8").read(), "html.parser")
    for t in soup(["script", "style", "noscript"]):
        t.decompose()
    out, used = [], set()
    for node in soup.body.descendants:
        if isinstance(node, NavigableString):
            v = " ".join(str(node).split())
            if v and v in big and v not in MENU and not v.startswith(("유어팀 |", "사업자", "대표번호", "본사", "인천", "고객센터")):
                out.append(("h" if big[v] >= 28 else "t", v))
            continue
        cands = [node.get("src", ""), node.get("data-src", ""), node.get("data-bg", ""), node.get("style", "")]
        for c in cands:
            for f in re.findall(r"([0-9a-f]{13}\.(?:png|jpe?g|gif))", c or ""):
                k = by_file.get(f)
                if k and k.startswith(f"p-{slug}-") and k not in used:
                    used.add(k)
                    out.append(("i", k))
    # 같은 글이 PC·모바일 두 벌로 들어 있다 — 처음 나온 것만 둔다
    res, seen_t = [], set()
    for kind, v in out:
        if kind in "ht":
            if v in seen_t:
                continue
            seen_t.add(v)
        res.append((kind, v))
    return res


def render(seq):
    parts, buf, imgs = [], [], []

    def flush_text():
        if not buf:
            return
        head = [v for k, v in buf if k == "h"]
        body = [v for k, v in buf if k == "t"]
        h = "<b>" + "<br>".join(esc(x) for x in head) + "</b>" if head else ""
        p = "<p>" + "<br>".join(esc(x) for x in body) + "</p>" if body else ""
        parts.append(f'      <div class="fact" data-reveal>{h}{p}</div>')
        buf.clear()

    def flush_imgs():
        if not imgs:
            return
        tags = []
        for k in imgs:
            w, h = SIZES[k]
            tags.append(f'<img src="/assets/img/i/{k}.webp" alt="" width="{w}" height="{h}" loading="lazy" decoding="async">')
        parts.append('      <div class="detail" data-reveal>' + "".join(tags) + "</div>")
        imgs.clear()

    for kind, v in seq:
        if kind == "i":
            flush_text()
            imgs.append(v)
        else:
            flush_imgs()
            if kind == "h" and buf and buf[-1][0] == "t":
                flush_text()
            buf.append((kind, v))
    flush_text()
    flush_imgs()
    return "\n".join(parts)


def tabs(active):
    a = []
    for _, slug, name, *_ in PRODUCTS:
        cur = ' aria-current="page"' if slug == active else ""
        a.append(f'<a href="/marketing/{slug}/"{cur}>{name}</a>')
    return '<nav class="tabs" aria-label="마케팅 상품"><div class="wrap tabs__in">' + "".join(a) + "</div></nav>"


for i, (src, slug, name, title, desc, kinds) in enumerate(PRODUCTS):
    seq = sequence(src, slug)
    prev = PRODUCTS[i - 1]
    nxt = PRODUCTS[(i + 1) % len(PRODUCTS)]
    meta = json.dumps({"title": f"{name} 광고 · 마케팅 상품", "description": desc, "nav": "marketing",
                       "image": f"/assets/img/i/p-{slug}-1.webp"}, ensure_ascii=False)
    page = f"""<!-- {meta} -->
<section class="phero" style="min-height:56svh">
  <div class="hero__glow" aria-hidden="true"></div>
  <div class="wrap">
    <p class="crumb" data-reveal><a href="/">홈</a><span aria-hidden="true">/</span><a href="/marketing/">마케팅</a><span aria-hidden="true">/</span><span>{esc(name)}</span></p>
    <p class="eyebrow" data-reveal>마케팅 상품 · {esc(kinds)}</p>
    <h1 class="h1" data-reveal style="--i:1">{esc(title)}</h1>
    <p class="lead" data-reveal style="--i:2">{esc(desc)}</p>
  </div>
</section>
{tabs(slug)}
<section class="sec sec--tight">
  <div class="wrap">
    <div class="facts">
{render(seq)}
    </div>
    <nav class="pager" aria-label="다른 상품">
      <a href="/marketing/{prev[1]}/"><small>이전 상품</small>{esc(prev[2])}</a>
      <a href="/marketing/{nxt[1]}/"><small>다음 상품</small>{esc(nxt[2])}</a>
    </nav>
  </div>
</section>

<!--@ cta -->
"""
    open(os.path.join(ROOT, "src", "pages", "marketing", slug + ".html"), "w", encoding="utf-8").write(page)
    print(slug, sum(1 for k, _ in seq if k == "i"), "사진", sum(1 for k, _ in seq if k != "i"), "글")
