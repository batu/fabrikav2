"""Rsync golden color.pngs + manifest to ubuntu-server:~/hitbox-lab/scenes/<sid>/color.png"""
import json
import subprocess
from pathlib import Path

manifest_path = Path(__file__).resolve().parents[2] / 'golden-hitboxes-2026-08-05/manifest.json'
m = json.loads(manifest_path.read_text())
subprocess.run(['ssh', 'ubuntu-server', 'mkdir -p ~/hitbox-lab/scenes'], check=True)
for sid, info in m.items():
    subprocess.run(['ssh', 'ubuntu-server', f'mkdir -p ~/hitbox-lab/scenes/{sid}'], check=True)
    subprocess.run(['rsync', '-a', info['color'], f'ubuntu-server:hitbox-lab/scenes/{sid}/color.png'], check=True)
    print(sid, 'synced', flush=True)
subprocess.run(['rsync', '-a', str(manifest_path), 'ubuntu-server:hitbox-lab/manifest.json'], check=True)
print('done')
