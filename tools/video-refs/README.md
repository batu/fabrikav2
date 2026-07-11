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
  --out /tmp/video-refs/picker.html \
  [--labels menu,gameplay,shop]
```

Builds one self-contained HTML file with inline CSS/JS and data-URI thumbnails.
`--video-src` is baked into the `<video>` tag exactly as provided; the tool never
discovers Portal asset names. Pass the Portal asset name for the same playback
file that was used for `suggest --video`.

The picker label list comes from `--labels` when provided, otherwise from a
top-level `labels` array in `candidates.json`, otherwise from the default labels
`menu,level,settings,pause,win,fail,gameplay`. Labels must match
`/^[a-z][a-z0-9_-]*$/`, be unique, and be non-empty. Candidate labels outside the
active list fall back to the first active label instead of inventing `gameplay`.
The generated chip row, summary counts, and number-key shortcuts use the active
label list.

Every candidate card also ends its chip row with a non-label `other...` chip.
Click it, or press its displayed number key when one is available, to open an
inline text input on that card. Enter lowercases the text, converts whitespace
runs to `-`, validates the normalized token with `/^[a-z][a-z0-9_-]*$/`, adds it
as a normal global label, and assigns it to that candidate. Invalid or duplicate
labels stay open with an inline error and do not mutate the picker. Escape closes
the input without changing the candidate. Runtime labels created through
`other...` appear on every card, in summary counts, and submit like configured
labels.

The picker does not judge at-rest state. It ignores any incoming `atRest`
metadata and submits only the selected frame time, label, and source; the
downstream judge/compare layer owns at-rest classification.

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
{
  "payload": {
    "frames": [
      { "t": 2, "label": "gameplay", "source": "agent" },
      { "t": 3.5, "label": "shop", "source": "agent" }
    ]
  }
}
```

to `/r/<reqId>/decide`, where `reqId` is read from `/media/<reqId>/...`.

## extract

```sh
node tools/video-refs/run.mjs extract \
  --video original-source.mp4 \
  --verdict verdict.json \
  --out games/<game>/refs/art \
  [--captured YYYY-MM-DD]
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
    "provenance": {
      "source": "video-extract",
      "tool": "video-refs extract",
      "captured": "2026-07-09",
      "video": "original-source.mp4"
    },
    "at-rest": false,
    "not-at-rest-reason": "unjudged video frame",
    "recapture-note": "review this extracted video frame before accepting it as an at-rest reference"
  }
]
```

`extract` preserves an explicit frame `at-rest` boolean from an external judge
or a legacy verdict. Those verdicts may use either `atRest`/`notAtRestReason` or
`at-rest`/`not-at-rest-reason`; `extract` writes the fold-compatible kebab-case
fields. An explicit false value without a supplied reason becomes
`human-flagged mid-motion`. When the at-rest field is absent, the frame is
written as not at rest with the `unjudged video frame` reason above; unreviewed
video frames are never promoted as trusted by default. `--captured` defaults to
today's date and exists so tests and replayed folds can be deterministic.

## fold

```sh
node tools/video-refs/run.mjs fold \
  --game games/<game> \
  --extracted games/<game>/refs/art/extracted.json \
  --video refs/video/reference-video.mp4 \
  --captured YYYY-MM-DD
```

`fold` promotes every extracted PNG into
`games/<game>/refs/captures/video-extract/<video-stem>/` and updates
`games/<game>/refs/manifest.yaml` with a `refs:` entry for each promoted
capture. Folded entries use the marble_run-compatible shape: `state-variant`,
`capture-recipe`, `at-rest`, optional false-at-rest explanation fields, and
structured `provenance` with `source: video-extract`, `tool`, `captured`, and
`video`.

The command appends missing states found in `extracted.json` with explicit
reference and v2 gaps. It does not make refs-lint scan `refs/art`; that folder
remains source material, while `refs/captures` is the committed reference
contract.

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
  --video-src x.mp4 --out /tmp/picker.html --labels menu,gameplay,shop,tutorial
npx playwright screenshot --viewport-size=1440,900 "file:///tmp/picker.html" /tmp/picker.png
```

Portal views are PC-first web pages — the browser IS their real environment,
so Playwright screenshots are the sanctioned verification here (unlike mobile
games, where a browser render is never evidence). The 2026-07-09 timeline-blob
defect shipped precisely because density was never rendered and looked at.
For picker changes, also exercise the page through a Portal-like stub URL so
`/r/<reqId>/decide` receives the real POST payload. Inspect the captured JSON
for configured labels, runtime-added labels, and the absence of picker-owned
at-rest fields.
