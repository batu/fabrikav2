#!/bin/zsh
# usage: mm-shot.sh OUT.png  — screenshot Batu's iPhone over the pymobiledevice3 tunnel
/Users/base/.local/bin/pymobiledevice3 developer dvt screenshot --rsd fd00:f6c8:3ede::1 51993 "$1" 2>&1 | grep -v -i 'warning\|tunneld' | tail -1
ls -la "$1" | awk '{print $5, $9}'
