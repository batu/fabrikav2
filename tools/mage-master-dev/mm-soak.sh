#!/bin/zsh
# 30-minute on-device play soak: drives the real app on the phone like a player would.
# usage: mm-soak.sh MINUTES OUTDIR
MIN=${1:-30}; OUT=${2:-/tmp/soak}; mkdir -p $OUT
D=/Users/base/dev/appletolye/fabrikav2/.worktrees/mage-master/tools/mage-master-dev
START=$(date +%s); END=$((START + MIN*60)); LAST_SHOT=0; N=0
STEP='const c=window.__MM_DEV.controller, ip=window.__MM_DEV.itemPower; let s=c.snapshot(); const acts=[]; const order=["common","uncommon","rare","epic","legendary","mythic","immortal","astral","celestial","ultimate"];
if (s.surface==="win") { acts.push("win->next"); c.next(); }
else if (s.surface==="fail") { acts.push("fail->retry"); if(!c.retry()) c.home(); }
else if (s.surface==="battle"||s.surface==="pause") { acts.push("battling L"+s.level+" S"+s.stage); }
else if (s.surface==="settings") { c.closeSettings(); }
s=c.snapshot();
if (s.surface==="menu"||s.surface==="rift"||s.surface==="mages") {
  if (s.surface!=="rift") { c.home(); c.openRift(); }
  let guard=0;
  while (guard++<12) { const before=c.snapshot(); if (!before.pending && !c.pull()) break; const p=c.snapshot().pending; if(!p) break; const cur=p.slot==="weapon"?c.snapshot().loadout[p.cls].weapon:c.snapshot().loadout[p.cls].armor; if (ip(p)>ip(cur)) { c.useItem(); acts.push("use:"+p.rarity+":"+p.slot); } else { c.discardItem(); acts.push("discard:"+p.rarity); } }
  if (c.upgradeRift()) acts.push("upgrade"); if (c.snapshot().gems>=10 && c.skipUpgrade()) acts.push("skip");
  c.home();
  if (c.enterLevel()) acts.push("enter L"+c.snapshot().level); else acts.push("ENERGY-WAIT");
}
s=c.snapshot(); return JSON.stringify({t:Date.now(), surface:s.surface, level:s.level, stage:s.stage, energy:s.energy, gold:s.gold, crystals:s.crystals, gems:s.gems, tier:s.riftTier, highest:s.highestCleared, pulls:s.pulls, party:s.party.map(p=>Math.round(100*p.hp/p.maxHp)), acts});'
JS=$(python3 -c "import json,sys; print(json.dumps([sys.stdin.read()]))" <<< "$STEP")
while [[ $(date +%s) -lt $END ]]; do
  N=$((N+1)); NOW=$(date +%s); ELAPSED=$((NOW-START))
  $D/mm-drive.sh eval "$JS" >/dev/null 2>&1
  R=$(python3 -c 'import json;print(json.load(open("/Users/base/dev/appletolye/fabrikav2/.worktrees/mage-master/games/mage_master/.work/drive-result.json")).get("value"))' 2>/dev/null)
  echo "$(date '+%H:%M:%S') +${ELAPSED}s ${R}" >> $OUT/soak.log
  if [[ $((NOW-LAST_SHOT)) -ge 150 ]]; then $D/mm-shot.sh $OUT/shot-$(printf '%02d' $((ELAPSED/60)))m.png >/dev/null 2>&1; LAST_SHOT=$NOW; fi
  if (( N % 12 == 0 )); then $D/mm-drive.sh inspect '["canvas",["width"]]' 2>/dev/null | grep -o '"errors":\[[^]]*\]' >> $OUT/errors.log; fi
  sleep 5
done
echo "SOAK_DONE $(date '+%H:%M:%S') steps=$N" >> $OUT/soak.log
