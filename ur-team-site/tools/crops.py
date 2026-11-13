#!/usr/bin/env python3
"""옮겨 적기에서 잘라 둔 '실제 화면 예시'를 사이트용 webp 로 바꾼다.  python3 tools/crops.py <잘라 둔 폴더> [이름 접두어…]"""
import os, sys
from PIL import Image
src = sys.argv[1]; pre = tuple(sys.argv[2:]) or ("",)
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "img", "p")
for n in sorted(os.listdir(src)):
    if not n.endswith(".png") or not n.startswith(pre):
        continue
    im = Image.open(os.path.join(src, n)).convert("RGB")
    dest = os.path.join(out, n[:-4] + ".webp")
    im.save(dest, "WEBP", quality=84, method=6)
    print(n, im.size, os.path.getsize(dest) // 1024, "KB")
