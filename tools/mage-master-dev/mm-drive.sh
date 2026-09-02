#!/bin/zsh
# usage: mm-drive.sh OP ARGS_JSON   e.g. mm-drive.sh driveTo '["level"]'  |  mm-drive.sh verb '["pull"]'  |  mm-drive.sh frames '[10,80]'
W=/Users/base/dev/appletolye/fabrikav2/.worktrees/mage-master/games/mage_master/.work
SEQ=$(( $(date +%s) ))
rm -f $W/drive-result.json
printf '{"seq":%d,"op":"%s","args":%s}\n' "$SEQ" "$1" "${2:-[]}" > $W/drive.json
for i in {1..40}; do
  if [[ "$1" == "frames" ]]; then
    [[ -f $W/frames/$SEQ.done ]] && { echo "frames: $(cat $W/frames/$SEQ.done) saved as $W/frames/$SEQ-*.png"; exit 0; }
  else
    [[ -f $W/drive-result.json ]] && { cat $W/drive-result.json | head -c 900; echo; exit 0; }
  fi
  sleep 0.5
done
echo "drive timeout (seq $SEQ)"; exit 1
