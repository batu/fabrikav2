from common import *
sys.path.insert(0,'/Users/base/dev/appletolye/fabrikav2/tools/level-editor'); os.environ.setdefault('LEVEL_EDITOR_GAME','find_the_bird')
from levelbuilder.api import public_levels as P
from levelbuilder.api import session as S
prev=S.load_bundled_manifest() or {}; entries=[]
for l in PM['levels']:
    e=P.public_level_manifest_entry(S.GAME_PUBLIC_LEVELS,l['id']); e['bundled']=True; entries.append(e)
P.save_bundled_manifest(S.GAME_PUBLIC_LEVELS,{'version':1,'manifestRevision':int(prev.get('manifestRevision') or 0)+1,'generatedAt':P.utc_now_iso(),'experimentId':'ftd_levelset_v1','levels':entries}); print('manifest rev',int(prev.get('manifestRevision') or 0)+1)
