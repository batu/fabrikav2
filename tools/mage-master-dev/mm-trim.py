"""Trim a transparent PNG to its alpha bounding box (+pad px). usage: mm-trim.py FILE [pad=8]"""
import sys
from PIL import Image
path = sys.argv[1]
pad = int(sys.argv[2]) if len(sys.argv) > 2 else 8
im = Image.open(path).convert("RGBA")
bbox = im.getbbox()
if bbox:
    l, t, r, b = bbox
    l = max(0, l - pad); t = max(0, t - pad); r = min(im.width, r + pad); b = min(im.height, b + pad)
    im.crop((l, t, r, b)).save(path)
    print(path, (r - l, b - t))
