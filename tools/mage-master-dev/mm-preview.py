"""Preview the runtime mage composite on the Mac (same algorithm as src/battle/mageComposite.ts).
usage: python mm-preview.py OUT.png  — renders 3 mages x (fire common, ice epic, lightning legendary, arcane ultimate)"""
import json, os, re, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
from PIL import Image, ImageChops
D=ROOT+"/games/mage_master/design/assets"
src=open(ROOT+"/games/mage_master/design/assets.ts").read()
anchors={}
for m in re.finditer(r'(\w+): \{ x: ([\d.]+), y: ([\d.]+), staffScale: ([\d.]+), staffAngle: (-?[\d.]+), staffPivotX: ([\d.]+), staffPivotY: ([\d.]+), staffBehind: (true|false)[^}]*\}', src):
    anchors[m.group(1)]=dict(x=float(m.group(2)),y=float(m.group(3)),scale=float(m.group(4)),angle=float(m.group(5)),px=float(m.group(6)),py=float(m.group(7)),behind=m.group(8)=="true")
tokens=open(ROOT+"/games/mage_master/design/tokens.css").read()
def color(rarity):
    return re.search(r'--fab-mm-rarity-%s: (#[0-9a-f]{6})'%rarity, tokens).group(1)
def hex2rgb(h): return tuple(int(h[i:i+2],16) for i in (1,3,5))
S=512
def compose(cls, element, rarity):
    canvas=Image.new("RGBA",(S,S),(0,0,0,0))
    base=Image.open(f"{D}/unit-mage-{cls}.png").convert("RGBA").resize((S,S))
    garment=Image.open(f"{D}/garment-mage-{cls}.png").convert("RGBA").resize((S,S))
    staff=Image.open(f"{D}/icon-weapon-{element}.png").convert("RGBA")
    a=anchors[cls]
    size=int(S*a["scale"]); st=staff.resize((size,size)).rotate(-a["angle"], expand=True, resample=Image.BICUBIC)
    # pivot: rotate around pivot -> compute offset of pivot after rotation
    import math
    pivot=(size*a["px"], size*a["py"]); c=(size/2,size/2)
    ang=math.radians(-a["angle"])  # PIL rotate is CCW for positive; canvas rotate positive is CW => negate
    dx,dy=pivot[0]-c[0],pivot[1]-c[1]
    rx=dx*math.cos(-ang)-dy*math.sin(-ang); ry=dx*math.sin(-ang)+dy*math.cos(-ang)
    px=st.width/2+rx; py=st.height/2+ry
    pos=(int(a["x"]*S-px), int(a["y"]*S-py))
    def draw_staff(): canvas.alpha_composite(st, dest=(max(0,pos[0]),max(0,pos[1])), source=(max(0,-pos[0]),max(0,-pos[1])))
    if a["behind"]: draw_staff()
    canvas.alpha_composite(base)
    tint=Image.new("RGBA",(S,S),hex2rgb(color(rarity))+(255,))
    mul=ImageChops.multiply(garment.convert("RGB"), tint.convert("RGB")).convert("RGBA")
    mul.putalpha(garment.split()[3])
    canvas.alpha_composite(mul)
    if not a["behind"]: draw_staff()
    return canvas
combos=[("fire","common"),("ice","epic"),("lightning","legendary"),("arcane","ultimate")]
sheet=Image.new("RGB",(4*260,3*260),(233,211,166))
for r,cls in enumerate(["tank","warrior","support"]):
    for c,(el,rar) in enumerate(combos):
        im=compose(cls,el,rar); im.thumbnail((250,250)); sheet.paste(im,(c*260+5,r*260+5),im)
sheet.save(sys.argv[1]); print("preview", sys.argv[1], anchors)
