"""Split a matted mage sprite into base (garment removed) + garment layer (luminance-preserving, tintable).
usage: python mm-garment.py IN_alpha.png OUT_base.png OUT_garment.png
Garment = magenta hue band (hue 270..330 deg, sat > 0.35)."""
import sys, colorsys
import numpy as np
from PIL import Image
src, out_base, out_garment = sys.argv[1:4]
im = Image.open(src).convert("RGBA")
a = np.asarray(im).astype(np.float32) / 255.0
rgb = a[..., :3]; alpha = a[..., 3]
mx = rgb.max(axis=2); mn = rgb.min(axis=2); delta = mx - mn + 1e-6
sat = np.where(mx > 0, delta / (mx + 1e-6), 0)
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
hue = np.zeros_like(mx)
m = (mx == r); hue[m] = ((g - b)[m] / delta[m]) % 6
m = (mx == g); hue[m] = (b - r)[m] / delta[m] + 2
m = (mx == b); hue[m] = (r - g)[m] / delta[m] + 4
hue = (hue * 60) % 360
mask = (alpha > 0.05) & (sat > 0.35) & (hue >= 268) & (hue <= 335)
# soften mask edges slightly
from PIL import ImageFilter
mimg = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
soft = np.clip(np.asarray(mimg).astype(np.float32) / 255.0, 0, 1)
# garment layer: luminance from value channel (keeps shading), neutral grey base
val = mx  # brightness of the magenta tones
lum = np.clip(val * 1.0, 0, 1)
garment = np.zeros_like(a)
garment[..., 0] = garment[..., 1] = garment[..., 2] = lum
garment[..., 3] = alpha * soft
base = a.copy()
base[..., 3] = alpha * (1 - soft)
Image.fromarray((base * 255).astype(np.uint8), "RGBA").save(out_base)
Image.fromarray((garment * 255).astype(np.uint8), "RGBA").save(out_garment)
print("garment px", int(mask.sum()), "of", int((alpha > 0.05).sum()))
