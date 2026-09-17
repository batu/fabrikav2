# App Store screenshot banner

`banner.png` is the caption plank from the live Find the Bird listing: plank,
end leaves, stones, transparent elsewhere. It is stored cropped to its own alpha
bounds, with `banner-offset.txt` giving its position on a 1290x2796 frame.
It was recovered from the six published screenshots rather than authored — the
original composite that made shots 01 to 06 is not in any repo — by taking a
per-pixel median across the five in-level shots (which reveals the wood under
their captions and mascots) and a pixel diff across the same five (which gives
the plank's alpha). Levels of the interior were then filled row-wise, since the
grain runs horizontally, to erase the old captions.

`compose.py` drops it onto a fresh simulator capture, draws the caption in
Lilita One at the listing's own metrics (cap height 53px, line pitch 85px,
centred at x=752, colour #173C42) and pastes a mascot cutout bottom-left.
Lilita One is here as a TTF because the game ships it as woff2, which Pillow
cannot read.

Keep this directory. Rebuilding the banner costs an afternoon; using it costs a
command.
