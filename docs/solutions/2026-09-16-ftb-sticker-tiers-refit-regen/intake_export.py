"""Bless final cutouts (delegated actor, operator option 2 on 2026-09-16) and export session-addressed levels.
usage: intake_export.py IDS...
Actor: human:batu-delegated:intake-2026-09-16 (the contract records it as delegated; the gemini judge
plus Batu's Portal review stand in for the UI click). The bundled manifest is NOT touched here;
manifest_intake.py assigns order and bundled flags afterwards."""
from common import *
editor_api()
from levelbuilder.api import session as S
ACTOR='human:batu-delegated:intake-2026-09-16'
for k in sys.argv[1:]:
    try:
        cur=S.read_canonical_session(k)
        rev=cur.pointer.content_revision if cur.pointer else None
        fr=(cur.snapshot or {}).get('reviews',{}).get('finalCutouts') or {}
        if fr.get('contentRevision')!=rev:
            S.set_canonical_final_review_if_present(k,True,expected_content_revision=rev,reviewer=ACTOR)
        r=S.export_to_game(k,update_preview_manifest=False)
        print(k,'exported',r.get('variant'),r.get('contentRevision','')[:19],flush=True)
    except Exception as e:
        print(k,'FAILED',f'{type(e).__name__}: {str(e)[:300]}',flush=True)
