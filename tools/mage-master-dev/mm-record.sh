#!/bin/zsh
# Record a scripted playthrough on the phone: continuous screenshots (~1 fps) plus
# high-rate canvas bursts during battle, then assemble mp4s with ffmpeg.
# usage: mm-record.sh OUTDIR
ROOT=$(cd "$(dirname "$0")/../.." && pwd)  # repo root, whichever checkout this lives in
OUT=${1:-/tmp/mm-record}; mkdir -p $OUT/shots $OUT/bursts
D=$ROOT/tools/mage-master-dev
W=$ROOT/games/mage_master/.work
START=$(date +%s.%N)
# continuous screenshot loop in the background (each shot ~1.2 s)
( i=0; while [[ ! -f $OUT/STOP ]]; do t=$(printf '%08.2f' $(echo "$(date +%s.%N) - $START" | bc)); $D/mm-shot.sh $OUT/shots/t$t.png >/dev/null 2>&1; i=$((i+1)); done ) &
SHOTS=$!
mark() { echo "$(printf '%.1f' $(echo "$(date +%s.%N) - $START" | bc))s $1" >> $OUT/timeline.txt; }
burst() { # name frames everyMs
  $D/mm-drive.sh frames "[$2,$3]" >/dev/null 2>&1
  seq=$(ls -t $W/frames/*.done 2>/dev/null | head -1 | xargs basename | sed 's/.done//')
  mkdir -p $OUT/bursts/$1; cp $W/frames/$seq-*.png $OUT/bursts/$1/ 2>/dev/null; mark "burst:$1 ($(ls $OUT/bursts/$1 | wc -l | tr -d ' ') frames)"
}
ev() { $D/mm-drive.sh eval "[$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1")]" >/dev/null 2>&1; }

mark "fresh save, home"; ev 'window.__MM_DEV.controller.resetSave(); return 1'; sleep 3
mark "settings open"; $D/mm-drive.sh driveTo '["settings"]' >/dev/null; sleep 2.5
mark "back home"; $D/mm-drive.sh driveTo '["menu"]' >/dev/null; sleep 1.5
mark "mages page"; $D/mm-drive.sh verb '["openMages"]' >/dev/null; sleep 3
mark "home"; $D/mm-drive.sh driveTo '["menu"]' >/dev/null; sleep 1.5
mark "tap Play -> level 1"; ev 'document.querySelector("[data-fab-action=play]").click(); return 1'; sleep 4
burst battle-l1-s1 40 60; sleep 2
mark "pause"; ev 'document.querySelector("[data-fab-action=pause]").click(); return 1'; sleep 2.5
mark "resume"; ev 'document.querySelector("[data-fab-action=pause-resume]").click(); return 1'; sleep 1
mark "2x speed"; ev 'document.querySelector("[data-fab-action=speed]").click(); return 1'; sleep 6
burst battle-l1-late 40 60
# wait for the level to finish (win or fail), up to 90 s
for i in $(seq 1 45); do s=$($D/mm-drive.sh snapshot '[]' 2>/dev/null | python3 -c 'import json,sys; d=json.load(open("$ROOT/games/mage_master/.work/drive-result.json")); print(d["snapshot"]["surface"])' 2>/dev/null); [[ "$s" == "win" || "$s" == "fail" ]] && break; sleep 2; done
mark "result: $s"; sleep 3
mark "result -> home"; ev 'const b=document.querySelector("[data-fab-action=result-menu]"); b&&b.click(); return 1'; sleep 2.5
mark "rift page"; ev 'document.querySelector("[data-fab-action=nav-rift]").click(); return 1'; sleep 2.5
mark "summon (tap)"; ev 'document.querySelector("[data-fab-action=pull]").click(); return 1'; sleep 3.5
mark "use item"; ev 'const b=document.querySelector("[data-fab-action=reveal-use]"); b&&b.click(); return 1'; sleep 2.5
mark "summon again"; ev 'document.querySelector("[data-fab-action=pull]").click(); return 1'; sleep 3.5
mark "discard"; ev 'const b=document.querySelector("[data-fab-action=reveal-discard]"); b&&b.click(); return 1'; sleep 2
mark "grant gold for upgrade (dev)"; ev 'window.__MM_DEV.controller.grantResources({gold:600, gems:40}); return 1'; sleep 1
mark "upgrade rift"; ev 'document.querySelector("[data-fab-action=upgrade-rift]").click(); return 1'; sleep 3
mark "skip with gems"; ev 'document.querySelector("[data-fab-action=skip-upgrade]").click(); return 1'; sleep 3
mark "mages page (geared)"; ev 'document.querySelector("[data-fab-action=nav-mages]").click(); return 1'; sleep 3
mark "item detail"; ev 'const b=document.querySelector("[data-fab-action=slot-warrior-weapon]"); b&&b.click(); return 1'; sleep 2.5
mark "close detail"; ev 'const b=document.querySelector("[data-fab-action=item-close]"); b&&b.click(); return 1'; sleep 1.5
mark "home; jump to level 6 boss wave (dev fast-forward)"; ev 'const c=window.__MM_DEV.controller; c.home(); c.unlockAll(); c.grantResources({energy:10}); c.enterLevel(6); return 1'; sleep 3
ev 'const c=window.__MM_DEV.controller; let n=0; while(n<3000){const v=c.battleView(); if(!v||v.stage>=4||v.phase!=="stage"&&v.phase!=="advance") break; c.advanceBattle(0.25); n++;} c.drainBattleEvents(); return n'; sleep 2.5
burst boss-l6 40 60; sleep 4
burst boss-l6-b 40 60
mark "offline return (backdated 3h, reload)"; ev 'const k="fabrikav2.mage_master.save"; const s=JSON.parse(localStorage.getItem(k)); s.lastSeenAt=Date.now()-3*3600*1000; localStorage.setItem(k, JSON.stringify(s)); setTimeout(()=>location.reload(),200); return 1'; sleep 7
mark "claim"; ev 'const b=document.querySelector("[data-fab-action=offline-claim]"); b&&b.click(); return 1'; sleep 2
mark "end"
touch $OUT/STOP; wait $SHOTS 2>/dev/null
# assemble: walkthrough at ~1 fps from timestamped shots; bursts at 15 fps
cd $OUT/shots && ls t*.png | sort > list.txt && ffmpeg -y -loglevel error -framerate 1 -pattern_type glob -i 't*.png' -vf 'scale=585:-2' -c:v libx264 -pix_fmt yuv420p $OUT/walkthrough.mp4
for b in $OUT/bursts/*/; do n=$(basename $b); ffmpeg -y -loglevel error -framerate 15 -pattern_type glob -i "$b/*.png" -vf 'scale=780:-2' -c:v libx264 -pix_fmt yuv420p $OUT/burst-$n.mp4; done
echo "shots: $(ls $OUT/shots/t*.png | wc -l | tr -d ' ')"; ls -la $OUT/*.mp4 | awk '{print $5, $9}'
