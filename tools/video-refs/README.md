# video-refs

Deterministic reference-video frame tooling for Portal-assisted game cloning.
The tool returns after each verb. It does not call Portal, does not post files,
does not wait for verdicts, and does not make network requests.

## suggest

```sh
node tools/video-refs/run.mjs suggest --video playback-proxy.mp4 --out /tmp/video-refs [--interval 2] [--scene 0.3]
```

Requires `ffmpeg` and `ffprobe` on `PATH`. The candidate set is scene-change
frames plus uniform samples every `--interval` seconds, deduped with a 32x32
grayscale perceptual signature adapted from `tools/refcap-compare`.

When the picker will play a proxy or re-encoded file, run `suggest --video` on
that exact playback file. The emitted candidate timestamps and thumbnails are a
same-file contract with `build-view --video-src`; do not generate thumbnails
from the original source while the picker plays a proxy. Scene-cut candidates are
biased two frames into the new scene and all candidates are snapped to the
playback file's frame midpoints.

Outputs:

- `/tmp/video-refs/frames/cand-<t>.jpg` - approximately 480px-wide thumbnails
- `/tmp/video-refs/candidates.json`

`candidates.json` shape:

```json
{
  "video": "/abs/path/playback-proxy.mp4",
  "duration_s": 12.4,
  "fps": 30,
  "candidates": [{ "t": 2.083333333333, "file": "frames/cand-2.083333333333.jpg" }]
}
```

## build-view

```sh
node tools/video-refs/run.mjs build-view \
  --candidates /tmp/video-refs/candidates.json \
  --video-src "02_playback-proxy.mp4" \
  --out /tmp/video-refs/picker.html
```

Builds one self-contained HTML file with inline CSS/JS and data-URI thumbnails.
`--video-src` is baked into the `<video>` tag exactly as provided; the tool never
discovers Portal asset names. Pass the Portal asset name for the same playback
file that was used for `suggest --video`.

Portal posting recipe:

```sh
portal post --kind view --stream <slug> --title "Reference frame picker" picker.html playback-proxy.mp4
portal wait <req_id>
```

Portal prefixes uploaded files in upload order. Post `[picker.html,
playback-proxy.mp4]` and pass `--video-src "02_<proxy-name>"` when building the
view.

The view submits:

```json
{ "payload": { "frames": [{ "t": 2, "label": "gameplay", "source": "agent" }] } }
```

to `/r/<reqId>/decide`, where `reqId` is read from `/media/<reqId>/...`.

## extract

```sh
node tools/video-refs/run.mjs extract \
  --video original-source.mp4 \
  --verdict verdict.json \
  --out games/<game>/refs/art
```

Accepts either a Portal verdict object with `payload.frames` or a bare
`{"frames": [...]}` object. Writes full-resolution PNGs named
`<label>-<t>.png`, with `-2`, `-3`, and so on for collisions, plus
`extracted.json`:

Use the original source video for `extract --video`, even when `suggest` and
`build-view` used a playback proxy. The picker's midpoint timestamps map back to
the original for accurate still extraction.

```json
[
  {
    "state": "gameplay",
    "t": 2,
    "file": "gameplay-2.png",
    "source": "agent",
    "provenance": "video-refs extract from gameplay.mp4",
    "at-rest": true
  }
]
```

The manifest is shaped for folding into `games/<game>/refs/manifest.yaml`.

## Verify

```sh
node --test tools/video-refs/test/
npx eslint --config tools/video-refs/eslint.config.js tools/video-refs
```

Structural tests are not visual proof. Before shipping a change to the
generated picker HTML, build a view from a **realistic** candidates.json
(dozens of markers, not the 3-marker test fixture), screenshot it with
Playwright at desktop width, and look at it:

```sh
node tools/video-refs/run.mjs build-view --candidates <real candidates.json> \
  --video-src x.mp4 --out /tmp/picker.html
npx playwright screenshot --viewport-size=1440,900 "file:///tmp/picker.html" /tmp/picker.png
```

Portal views are PC-first web pages — the browser IS their real environment,
so Playwright screenshots are the sanctioned verification here (unlike mobile
games, where a browser render is never evidence). The 2026-07-09 timeline-blob
defect shipped precisely because density was never rendered and looked at.
