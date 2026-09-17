"""Restoration with the ORIGINAL editor writer (_write_birdless_restore_bg: erase every pixel that differs from the plate inside
each bird's cleanup rect) + bg_00.webp at 2560/q90. Batu 2026-09-17: the silhouette-only writer was a misreading of the
neighbour-protection rule; protection lives in the runtime reveal geometry instead. usage: intake_restore_original.py IDS..."""
from common import *
editor_api(); from levelbuilder.api import session as S
for k in sys.argv[1:]:
    pubdir=ROOT/'public/levels'/k; e=json.load(open(pubdir/'level.json')); raw=json.load(open(sdir(k)/'session.json'))
    S._write_birdless_restore_bg(sdir(k),pubdir,raw,e)
    with Image.open(pubdir/'bg_00.png') as img:
        im=img.convert('RGB'); im=im.resize((2560,int(im.height*2560/im.width)),Image.LANCZOS) if im.width!=2560 else im; im.save(pubdir/'bg_00.webp',format='WEBP',quality=90,method=6)
    print(k,'original restoration',flush=True)
