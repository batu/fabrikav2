"""Contact sheets from a recording: usage mm-video-sheet.py OUTDIR [per_sheet=12]
Walkthrough shots (t*.png) become numbered sheets with elapsed-second labels;
each burst directory becomes one sheet of its frames."""
import glob
import os
import sys

from PIL import Image, ImageDraw

out = sys.argv[1]
per = int(sys.argv[2]) if len(sys.argv) > 2 else 12
cols = 6
cell_w = 234
cell_h = 506 + 18


def sheet(files, labels, path):
    rows = (len(files) + cols - 1) // cols
    img = Image.new("RGB", (cols * (cell_w + 4), rows * (cell_h + 4)), (40, 30, 20))
    d = ImageDraw.Draw(img)
    for i, (f, label) in enumerate(zip(files, labels)):
        im = Image.open(f).convert("RGB")
        im.thumbnail((cell_w, cell_h - 18))
        x = (i % cols) * (cell_w + 4)
        y = (i // cols) * (cell_h + 4)
        img.paste(im, (x, y + 18))
        d.text((x + 4, y + 2), label, fill=(255, 243, 214))
    img.save(path)
    return path


shots = sorted(glob.glob(os.path.join(out, "shots", "t*.png")))
made = []
for n in range(0, len(shots), per):
    chunk = shots[n : n + per]
    labels = [os.path.basename(f)[1:-4].lstrip("0") + "s" for f in chunk]
    made.append(sheet(chunk, labels, os.path.join(out, f"sheet-{n // per + 1:02d}.png")))
for b in sorted(glob.glob(os.path.join(out, "bursts", "*"))):
    frames = sorted(glob.glob(os.path.join(b, "*.png")))
    if not frames:
        continue
    step = max(1, len(frames) // 12)
    pick = frames[::step][:12]
    labels = [f"f{frames.index(f)}" for f in pick]
    made.append(sheet(pick, labels, os.path.join(out, f"burst-{os.path.basename(b)}.png")))
print("\n".join(made))
