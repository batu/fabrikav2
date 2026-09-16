import json, os, sys, base64, io, re, time, numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
ROOT=Path('/Users/base/dev/appletolye/fabrikav2/games/find_the_bird'); SCRATCH=Path(os.environ.get('FTB_SCRATCH','/tmp/ftb-lift'))
PM=json.load(open(os.environ.get('FTB_MANIFEST', str(ROOT/'public/levels/bundled-manifest.json'))))
def level_id(n): return PM['levels'][n-1]['id']
def pub(n): return ROOT/'public/levels'/level_id(n)
def sprite_path(n,sp): return pub(n)/sp['image'].split(f'levels/{level_id(n)}/')[1]
def footprint(sp,W,H):
    c=sp['cleanup']; cx,cy=c['x']+c['width']/2,c['y']+c['height']/2
    return (int(max(0,cx-c['width'])),int(max(0,cy-c['height'])),int(min(W,cx+c['width'])),int(min(H,cy+c['height'])))
def b64(im):
    buf=io.BytesIO(); im.save(buf,'PNG'); return base64.b64encode(buf.getvalue()).decode()
