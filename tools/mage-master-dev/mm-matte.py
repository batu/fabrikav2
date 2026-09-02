"""Matte a flat #333333 generation background to alpha, then fit to a square ship size.
usage: python mm-matte.py IN.png OUT.png [size=512] [pad=0.04]
Flood-fills background from the border (tight tolerance), feathers 1px, trims to content bbox, pads, resizes."""
import sys
import numpy as np
from PIL import Image, ImageFilter
from collections import deque

src, dst = sys.argv[1], sys.argv[2]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 512
pad = float(sys.argv[4]) if len(sys.argv) > 4 else 0.04
im = Image.open(src).convert("RGB")
a = np.asarray(im).astype(np.int16)
h, w, _ = a.shape
bg = np.array([51, 51, 51], dtype=np.int16)
# per-channel closeness to matte
diff = np.abs(a - bg).max(axis=2)
near = diff <= 14
# flood fill from border over `near` pixels
mask = np.zeros((h, w), dtype=bool)
q = deque()
for x in range(w):
    for y in (0, h - 1):
        if near[y, x] and not mask[y, x]:
            mask[y, x] = True; q.append((y, x))
for y in range(h):
    for x in (0, w - 1):
        if near[y, x] and not mask[y, x]:
            mask[y, x] = True; q.append((y, x))
while q:
    y, x = q.popleft()
    for ny, nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
        if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not mask[ny, nx]:
            mask[ny, nx] = True; q.append((ny, nx))
alpha = np.where(mask, 0, 255).astype(np.uint8)
# soft edge: partial pixels adjacent to background get alpha from closeness
al = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.8))
alpha_s = np.asarray(al).astype(np.float32)
# never re-fill true background
alpha_s[mask & (diff <= 6)] = 0
rgba = np.dstack([a.astype(np.uint8), alpha_s.clip(0, 255).astype(np.uint8)])
out = Image.fromarray(rgba, "RGBA")
# defringe: push edge pixel color away from matte
arr = np.asarray(out).astype(np.float32)
edge = (arr[..., 3] > 0) & (arr[..., 3] < 250)
t = (arr[edge, 3] / 255.0)[:, None]
arr[edge, :3] = np.clip((arr[edge, :3] - (1 - t) * 51) / np.maximum(t, 0.05), 0, 255)
out = Image.fromarray(arr.astype(np.uint8), "RGBA")
bbox = out.getbbox()
if bbox:
    out = out.crop(bbox)
cw, ch = out.size
side = int(max(cw, ch) * (1 + 2 * pad))
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(out, ((side - cw) // 2, side - ch - int(side * pad)))  # feet at bottom, horizontally centered
canvas = canvas.resize((size, size), Image.LANCZOS)
canvas.save(dst)
print(dst, canvas.size, "content", (cw, ch))
