# video-refs

Deterministic reference-video frame tooling for Portal-assisted game cloning.
The tool returns after each verb. It does not call Portal, does not post files,
does not wait for verdicts, and does not make network requests.

## suggest

```sh
node tools/video-refs/run.mjs suggest --video gameplay.mp4 --out /tmp/video-refs [--interval 2] [--scene 0.3]
```

Requires `ffmpeg` and `ffprobe` on `PATH`. The candidate set is scene-change
frames plus uniform samples every `--interval` seconds, deduped with a 32x32
grayscale perceptual signature adapted from `tools/refcap-compare`.

Outputs:

- `/tmp/video-refs/frames/cand-<t>.jpg` - approximately 480px-wide thumbnails
- `/tmp/video-refs/candidates.json`

`candidates.json` shape:

```json
{
  "video": "/abs/path/gameplay.mp4",
  "duration_s": 12.4,
  "candidates": [{ "t": 2, "file": "frames/cand-2.jpg" }]
}
```

## build-view

```sh
node tools/video-refs/run.mjs build-view \
  --candidates /tmp/video-refs/candidates.json \
  --video-src "02_gameplay.mp4" \
  --out /tmp/video-refs/picker.html
```

Builds one self-contained HTML file with inline CSS/JS and data-URI thumbnails.
`--video-src` is baked into the `<video>` tag exactly as provided; the tool never
discovers Portal asset names.

Portal posting recipe:

```sh
portal post --kind view --stream <slug> --title "Reference frame picker" picker.html video.mp4
portal wait <req_id>
```

Portal prefixes uploaded files in upload order. Post `[picker.html, video.mp4]`
and pass `--video-src "02_<video-name>"` when building the view.

The view submits:

```json
{ "payload": { "frames": [{ "t": 2, "label": "gameplay", "source": "agent" }] } }
```

to `/r/<reqId>/decide`, where `reqId` is read from `/media/<reqId>/...`.

## extract

```sh
node tools/video-refs/run.mjs extract \
  --video gameplay.mp4 \
  --verdict verdict.json \
  --out games/<game>/refs/art
```

Accepts either a Portal verdict object with `payload.frames` or a bare
`{"frames": [...]}` object. Writes full-resolution PNGs named
`<label>-<t>.png`, with `-2`, `-3`, and so on for collisions, plus
`extracted.json`:

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
