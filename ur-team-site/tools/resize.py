#!/usr/bin/env python3
"""휴대폰용 작은 사진을 만든다: assets/img 아래 가로 1000px 넘는 사진마다 '이름.w800.webp' 를 옆에 둔다.
빌드(build.mjs)가 이 파일이 있으면 <img> 에 srcset 을 달아, 휴대폰은 작은 사진만 받게 한다.
사진을 새로 넣었으면 한 번 돌린다:  python3 tools/resize.py"""
import json, os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "assets", "img")
SKIP = ("og", "favicon")
sizes = {}
for d, _, files in os.walk(IMG):
    rel = os.path.relpath(d, IMG)
    if rel.split(os.sep)[0] in SKIP:
        continue
    for n in files:
        if ".w800." in n or not n.lower().endswith((".webp", ".jpg", ".jpeg", ".png")):
            continue
        p = os.path.join(d, n)
        try:
            im = Image.open(p)
        except Exception:
            continue
        w, h = im.size
        if w <= 1000 or getattr(im, "n_frames", 1) > 1:
            continue
        out = os.path.splitext(p)[0] + ".w800.webp"
        url = "/" + os.path.relpath(p, ROOT).replace(os.sep, "/")
        sizes[url] = w
        if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(p):
            continue
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        im.resize((800, round(h * 800 / w)), Image.LANCZOS).save(out, "WEBP", quality=78, method=6)
        print("made", os.path.relpath(out, ROOT), os.path.getsize(out) // 1024, "KB (원본", os.path.getsize(p) // 1024, "KB)")
with open(os.path.join(ROOT, "tools", "img-widths.json"), "w") as f:
    json.dump(dict(sorted(sizes.items())), f, ensure_ascii=False, indent=0)
print(len(sizes), "장")
