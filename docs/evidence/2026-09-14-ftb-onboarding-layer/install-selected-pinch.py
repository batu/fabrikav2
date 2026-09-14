"""Convert the human-selected Compact pulse Layer clip to runtime alpha assets."""
from pathlib import Path
import subprocess
from PIL import Image

root = Path(__file__).resolve().parent
target = root.parents[2] / 'games/find_the_bird/public/ui/tutorial'
frames_dir = Path('/private/tmp/ftb-selected-pinch-frames')
frames_dir.mkdir(exist_ok=True)
source = root / 'assets/pinch-v8.mp4'
duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(source)], text=True))
subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(source), '-vf', f'setpts={2.1/duration}*PTS,colorkey=0x777777:0.06:0.04,scale=256:256,format=rgba,fps=24', '-t', '2.1', str(frames_dir/'%03d.png')], check=True)
frames = [Image.open(p).convert('RGBA') for p in sorted(frames_dir.glob('*.png'))]
frames += [frame.copy() for frame in frames[-2:0:-1]]
frames[0].save(target/'pinch.png')
frames[0].save(target/'pinch.webp', save_all=True, append_images=frames[1:], duration=[42 if i%3 else 41 for i in range(len(frames))], loop=0, quality=90)
print(f'Installed Compact pulse: {len(frames)} alpha frames')
