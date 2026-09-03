#!/bin/zsh
# usage: mm-shot.sh OUT.png  — screenshot Batu's iPhone over the pymobiledevice3 tunnel.
# The tunnel address changes whenever the phone reconnects; read it from tunneld each time.
RSD=$(curl -s --max-time 3 http://127.0.0.1:49151/ | python3 -c 'import json,sys; d=json.load(sys.stdin); t=next(iter(d.values()))[0]; print(t["tunnel-address"], t["tunnel-port"])' 2>/dev/null)
if [[ -z "$RSD" ]]; then echo "no tunnel (phone off the network?)"; exit 1; fi
/Users/base/.local/bin/pymobiledevice3 developer dvt screenshot --rsd ${=RSD} "$1" 2>&1 | grep -v -i 'warning\|tunneld' | tail -1
ls -la "$1" | awk '{print $5, $9}'
