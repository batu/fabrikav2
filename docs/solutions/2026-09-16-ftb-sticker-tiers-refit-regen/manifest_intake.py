"""Rebuild bundled-manifest.json: the shipped 44 in their current order, then the intake levels in ids60 order;
bundled=true for the first N whose level dirs fit the byte budget, streamed for the rest. usage: manifest_intake.py [BUDGET_MB=150]"""
from common import *
editor_api()
from levelbuilder.api import public_levels as P
from levelbuilder.api import session as S
budget=float(sys.argv[1]) if len(sys.argv)>1 else 150.0
prev=S.load_bundled_manifest() or {}; old=[l['id'] for l in prev['levels']]
removed=set(open(SCRATCH/'intake'/'removed_levels.txt').read().split()) if (SCRATCH/'intake'/'removed_levels.txt').exists() else set()   # Batu's review removals
old=[k for k in old if k not in removed]
new=[k for k in open(SCRATCH/'intake'/'ids60.txt').read().split() if (ROOT/'public/levels'/k/'level.json').exists() and k not in old and k not in removed]
def size(k):
    d=ROOT/'public/levels'/k; return sum(f.stat().st_size for f in d.rglob('*') if f.is_file() and f.suffix in ('.webp','.json') or (f.suffix=='.png' and 'dogs' in f.parts))
order=old+new
# Batu 2026-09-16: move sequence levels 3, 4, 5 (1-based) to position 67
mv=order[2:5]; rest=order[:2]+order[5:]; order=rest[:66]+mv+rest[66:]
entries=[]; used=0.0; bundled=0
for k in order:
    e=P.public_level_manifest_entry(S.GAME_PUBLIC_LEVELS,k); mb=size(k)/1e6
    e['bundled']=used+mb<=budget
    if e['bundled']: used+=mb; bundled+=1
    entries.append(e)
P.save_bundled_manifest(S.GAME_PUBLIC_LEVELS,{'version':1,'manifestRevision':int(prev.get('manifestRevision') or 0)+1,'generatedAt':P.utc_now_iso(),'experimentId':'ftd_levelset_v1','levels':entries})
print('levels',len(entries),'bundled',bundled,'streamed',len(entries)-bundled,'bundled MB %.1f'%used,'rev',int(prev.get('manifestRevision') or 0)+1)
