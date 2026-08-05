"""Rsync corpus scenes + corpus.json to ubuntu-server:~/hitbox-lab/corpus/"""
import json
import subprocess
from pathlib import Path

base = Path('/Users/base/dev/appletolye/fabrikav2/.worktrees/hitbox-hillclimb/tools/level-editor/eval/corpus')
corpus = json.loads((base / 'corpus.json').read_text())
subprocess.run(['ssh', 'ubuntu-server', 'mkdir -p ~/hitbox-lab/corpus/scenes'], check=True)
for i, (sid, e) in enumerate(corpus.items()):
    subprocess.run(['rsync', '-a', e['color'], f'ubuntu-server:hitbox-lab/corpus/scenes/{sid}.png'], check=True)
    if i % 10 == 0:
        print(i, sid, flush=True)
subprocess.run(['rsync', '-a', str(base / 'corpus.json'), 'ubuntu-server:hitbox-lab/corpus/corpus.json'], check=True)
print('done', len(corpus))
