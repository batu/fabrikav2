import json, os, sys, base64, io, re, time, numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
ROOT=Path('/Users/base/dev/appletolye/fabrikav2/games/find_the_bird'); SCRATCH=Path('/private/tmp/claude-501/-Users-base-dev-appletolye/2f9393c2-39fc-407d-a147-16a09b23e1f6/scratchpad')
PM=json.load(open('/private/tmp/claude-501/-Users-base-dev-appletolye/2f9393c2-39fc-407d-a147-16a09b23e1f6/scratchpad/published-manifest.json'))
def level_id(n): return PM['levels'][n-1]['id']
def pub(n): return ROOT/'public/levels'/level_id(n)
def sprite_path(n,sp): return pub(n)/sp['image'].split(f'levels/{level_id(n)}/')[1]
def footprint(sp,W,H):
    c=sp['cleanup']; cx,cy=c['x']+c['width']/2,c['y']+c['height']/2
    return (int(max(0,cx-c['width'])),int(max(0,cy-c['height'])),int(min(W,cx+c['width'])),int(min(H,cy+c['height'])))
def b64(im):
    buf=io.BytesIO(); im.save(buf,'PNG'); return base64.b64encode(buf.getvalue()).decode()
