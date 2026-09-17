"""Store screenshot composite using the listing's own caption banner.

Usage: uv run --with pillow python docs/store/compose.py <capture.png> "LINE ONE\nLINE TWO" <mascot-name> <out.png>
Captures come from the simulator at 1290x2796; mascot cutouts live in
fabrika-adgen/projects/find-the-bird/assets/mascot (outside this repo).

`banner.png` is the plank + end leaves + stones lifted from the six live
App Store screenshots (median across the five in-level shots recovers the art
under their text and mascots; a pixel-diff across those shots gives the alpha).
Text metrics measured off the live shots: Lilita One at cap height 53px (its
rendered line widths match the listing's within 1.5%), line pitch 85px,
centred at x=752, first line top y=2598, colour (23,60,66).
"""
import sys
from PIL import Image, ImageDraw, ImageFont, ImageOps

import os
HERE = os.path.dirname(os.path.abspath(__file__))
MASCOTS = '/Users/base/dev/appletolye/fabrika-adgen/projects/find-the-bird/assets/mascot'
TEAL = (23, 60, 66)
CAP, PITCH, CX, Y0 = 53, 85, 752, 2598
MASCOT_H, MASCOT_X, MASCOT_BOTTOM = 470, 8, 2778
BANNER_AT = None            # set from banner-offset.txt: where the cropped overlay sits


def fitted_font(cap_px):
    """Lilita One sized so a capital letter is exactly cap_px tall."""
    for size in range(40, 140):
        f = ImageFont.truetype(f'{HERE}/LilitaOne.ttf', size)
        box = f.getbbox('H')
        if box[3] - box[1] >= cap_px:
            return f, box
    raise SystemExit('no fit')


def compose(raw_path, caption, mascot_name, out_path, flip=False):
    im = Image.open(raw_path).convert('RGBA')
    banner = Image.open(f'{HERE}/banner.png').convert('RGBA')
    # The overlay is stored cropped to its own alpha bounds to keep the repo
    # light; banner-offset.txt says where it belongs on a 1290x2796 frame.
    ox, oy = (int(v) for v in open(f'{HERE}/banner-offset.txt').read().split())
    im.alpha_composite(banner, (ox, oy))
    font, hbox = fitted_font(CAP)
    d = ImageDraw.Draw(im)
    for i, line in enumerate(caption.split('\n')):
        d.text((CX, Y0 + i * PITCH - hbox[1]), line, font=font, fill=TEAL, anchor='ma')
    m = Image.open(f'{MASCOTS}/{mascot_name}.png').convert('RGBA')
    m = m.crop(m.getbbox())
    m = m.resize((round(m.width * MASCOT_H / m.height), MASCOT_H), Image.LANCZOS)
    if flip:
        m = ImageOps.mirror(m)
    im.alpha_composite(m, (MASCOT_X, MASCOT_BOTTOM - MASCOT_H))
    im.convert('RGB').save(out_path)
    print('->', out_path)


if __name__ == '__main__':
    compose(sys.argv[1], sys.argv[2].replace('\\n', '\n'), sys.argv[3], sys.argv[4])
