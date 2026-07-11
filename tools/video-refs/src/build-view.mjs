import fs from 'node:fs';
import path from 'node:path';
import { formatTimestamp } from './time.mjs';

const DEFAULT_LABELS = ['menu', 'level', 'settings', 'pause', 'win', 'fail', 'gameplay'];
const LABEL_TOKEN_RE = /^[a-z][a-z0-9_-]*$/;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeJsonForScript(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function normalizeLabels(value, source) {
  const rawLabels = Array.isArray(value) ? value : String(value).split(',');
  const labels = rawLabels.map((label, index) => {
    if (typeof label !== 'string') throw new Error(`${source} label ${index + 1} must be a string`);
    const trimmed = label.trim();
    if (!LABEL_TOKEN_RE.test(trimmed)) {
      throw new Error(`${source} label "${trimmed}" must match ${LABEL_TOKEN_RE}`);
    }
    return trimmed;
  });
  if (!labels.length) throw new Error(`${source} must contain at least one label`);
  const seen = new Set();
  for (const label of labels) {
    if (seen.has(label)) throw new Error(`${source} contains duplicate label "${label}"`);
    seen.add(label);
  }
  return labels;
}

function resolveLabels(labelInput, candidateLabels) {
  if (labelInput !== undefined) return normalizeLabels(labelInput, '--labels');
  if (candidateLabels !== undefined) return normalizeLabels(candidateLabels, 'candidates.json labels');
  return DEFAULT_LABELS.slice();
}

function readCandidates(candidatesFile, videoSrc, labelInput) {
  const abs = path.resolve(candidatesFile);
  const baseDir = path.dirname(abs);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(data.candidates)) throw new Error('candidates.json must contain a candidates array');
  const labels = resolveLabels(labelInput, data.labels);

  const fps = Number.isFinite(data.fps) && data.fps > 0 ? data.fps : null;

  const markers = data.candidates.map((candidate, index) => {
    const rel = candidate.file;
    if (typeof rel !== 'string') throw new Error(`candidate ${index} is missing file`);
    const imagePath = path.resolve(baseDir, rel);
    const buffer = fs.readFileSync(imagePath);
    return {
      id: `agent-${index + 1}`,
      // Preserve producer time exactly (millisecond precision) so seeks land frame-exact.
      t: Number(formatTimestamp(candidate.t)),
      label: labels.includes(candidate.label) ? candidate.label : labels[0],
      source: 'agent',
      keep: true,
      thumb: `data:image/jpeg;base64,${buffer.toString('base64')}`,
    };
  });

  return {
    videoSrc,
    fps,
    duration: Number.isFinite(data.duration_s) ? data.duration_s : 0,
    labels,
    markers,
  };
}

function buildHtml(model) {
  const json = safeJsonForScript(model);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Reference Frame Picker</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0c0d11;
      --bg-grad: radial-gradient(1200px 600px at 15% -10%, #1a1d27 0%, #0c0d11 55%);
      --panel: #14161d;
      --panel-2: #1a1d26;
      --panel-3: #21252f;
      --line: #2b3040;
      --line-soft: #23272f;
      --text: #eef0f6;
      --muted: #9aa1b4;
      --muted-2: #6b7284;
      --amber: #f4b23e;
      --amber-bright: #ffc65a;
      --teal: #34d3b4;
      --red: #ff5573;
      --focus: #7ea2ff;
      --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
      font-family: var(--sans);
      background: var(--bg);
      color: var(--text);
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg-grad) fixed;
      color: var(--text);
      -webkit-font-smoothing: antialiased;
    }
    button { font: inherit; cursor: pointer; }
    button:focus-visible,
    .cand:focus-visible,
    [tabindex]:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }

    /* ---------- app shell ---------- */
    .app {
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100vh;
      min-height: 0;
    }
    header.topbar {
      display: flex;
      align-items: center;
      gap: 18px;
      padding: 12px 22px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, #171a22, #12141a);
    }
    .brand { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
    .brand h1 {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.2px;
      white-space: nowrap;
    }
    .brand .sub {
      font: 500 11px/1 var(--mono);
      color: var(--muted-2);
      letter-spacing: 0.4px;
      white-space: nowrap;
    }
    .kbd-hint {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 10px;
      margin-left: auto;
      font-size: 11.5px;
      color: var(--muted);
    }
    .kbd-hint .grp { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
    kbd {
      display: inline-block;
      min-width: 18px;
      padding: 2px 6px;
      border-radius: 5px;
      border: 1px solid var(--line);
      border-bottom-width: 2px;
      background: var(--panel-3);
      color: var(--text);
      font: 600 10.5px/1.2 var(--mono);
      text-align: center;
    }

    .workspace {
      display: grid;
      grid-template-columns: minmax(440px, 42%) minmax(0, 1fr);
      min-height: 0;
    }

    /* ---------- left / stage ---------- */
    .stage {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 18px 20px;
      border-right: 1px solid var(--line);
      overflow-y: auto;
      background: var(--panel);
    }
    .video-wrap {
      position: relative;
      border-radius: 12px;
      overflow: hidden;
      background: #05060a;
      border: 1px solid var(--line);
      box-shadow: 0 18px 40px -24px rgba(0,0,0,0.9);
    }
    video {
      display: block;
      width: 100%;
      max-height: 46vh;
      background: #05060a;
    }
    .transport {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .tc-readout {
      font: 600 15px/1 var(--mono);
      letter-spacing: 0.5px;
      color: var(--text);
    }
    .tc-readout .dim { color: var(--muted-2); }
    .tc-readout .frame { color: var(--amber); margin-left: 8px; font-size: 12.5px; }

    /* timeline */
    .timeline {
      position: relative;
      height: 46px;
      border-radius: 10px;
      background:
        repeating-linear-gradient(90deg, transparent 0 39px, rgba(255,255,255,0.04) 39px 40px),
        linear-gradient(180deg, #1d212b, #171a22);
      border: 1px solid var(--line);
      cursor: pointer;
      overflow: hidden;
    }
    .marker {
      position: absolute;
      top: 8px;
      bottom: 8px;
      width: 3px;
      transform: translateX(-50%);
      border: 0;
      padding: 0;
      border-radius: 2px;
      background: var(--amber);
      cursor: pointer;
      transition: width .1s ease, box-shadow .12s ease, background .12s ease;
      z-index: 1;
    }
    .marker[data-source="human"] { background: var(--teal); }
    .marker.dropped { background: #4b515f; }
    .marker.focused {
      width: 6px;
      box-shadow: 0 0 0 1px #05060a, 0 0 12px 1px currentColor;
      z-index: 4;
    }
    .marker:hover { width: 5px; box-shadow: 0 0 0 1px #05060a, 0 0 8px currentColor; }
    .playhead {
      position: absolute; top: 0; bottom: 0; left: 0;
      width: 2px; background: var(--red);
      box-shadow: 0 0 8px var(--red);
      pointer-events: none; z-index: 5;
    }
    .playhead::after {
      content: ''; position: absolute; top: -1px; left: 1px;
      transform: translateX(-50%);
      border-left: 5px solid transparent; border-right: 5px solid transparent;
      border-top: 7px solid var(--red);
    }

    .stage-actions { display: flex; gap: 10px; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      min-height: 40px; padding: 0 16px;
      border-radius: 9px;
      border: 1px solid var(--line);
      background: var(--panel-3);
      color: var(--text);
      font-weight: 600;
      transition: background .12s ease, border-color .12s ease, transform .05s ease;
    }
    .btn:hover { background: #262b36; border-color: #3a4152; }
    .btn:active { transform: translateY(1px); }
    .btn.ghost { background: transparent; }

    /* focused-frame inspector */
    .inspector {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 12px;
      padding: 12px;
      border: 1px solid var(--line-soft);
      border-radius: 11px;
      background: var(--panel-2);
    }
    .inspector .thumb {
      width: 74px; height: 100px; border-radius: 7px; object-fit: cover; object-position: center top;
      background: #05060a; border: 1px solid var(--line);
    }
    .inspector .info { display: flex; flex-direction: column; gap: 6px; min-width: 0; justify-content: center; }
    .inspector .info .lead { font: 600 11px/1 var(--mono); letter-spacing: 1px; color: var(--muted-2); text-transform: uppercase; }
    .inspector .info .headline { font-size: 14px; font-weight: 650; }
    .inspector .info .lab {
      align-self: start;
      font: 700 10.5px/1 var(--sans); letter-spacing: 0.6px; text-transform: uppercase;
      padding: 4px 9px; border-radius: 999px;
      background: var(--amber); color: #201603;
    }
    .inspector.is-dropped .lab { background: var(--panel-3); color: var(--muted); }

    /* shortcuts legend */
    .legend {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 18px;
      padding: 13px 14px;
      border: 1px solid var(--line-soft);
      border-radius: 11px;
      background: var(--panel-2);
    }
    .legend .lg-title {
      grid-column: 1 / -1;
      font: 600 10px/1 var(--mono); letter-spacing: 1.4px; text-transform: uppercase;
      color: var(--muted-2); margin-bottom: 2px;
    }
    .legend .row {
      display: flex; align-items: center; gap: 8px;
      font-size: 12px; color: var(--muted);
    }
    .legend .row .keys { display: inline-flex; gap: 3px; }

    /* ---------- right / rail ---------- */
    .rail-shell { display: flex; flex-direction: column; min-height: 0; background: var(--bg); }
    .rail-head {
      display: flex; align-items: center; gap: 16px;
      padding: 12px 20px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, #14161d, #101218);
    }
    .rail-title { font-size: 13px; font-weight: 700; letter-spacing: 0.3px; }
    .rail-title .n { color: var(--muted); font-weight: 500; }
    .summary {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
      margin-left: auto;
    }
    .kept-pill {
      display: inline-flex; align-items: baseline; gap: 6px;
      padding: 5px 11px; border-radius: 999px;
      background: rgba(244,178,62,0.12); border: 1px solid rgba(244,178,62,0.4);
    }
    .kept-pill b { font: 700 14px/1 var(--mono); color: var(--amber); }
    .kept-pill span { font-size: 11px; color: var(--muted); }
    .lab-count {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 8px; border-radius: 7px;
      background: var(--panel-2); border: 1px solid var(--line-soft);
      font-size: 11px; color: var(--muted);
    }
    .lab-count.zero { opacity: 0.4; }
    .lab-count b { font: 700 11px/1 var(--mono); color: var(--text); }
    .lab-count .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted-2); }

    .rail {
      flex: 1; min-height: 0; overflow-y: auto;
      padding: 16px 20px 28px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      grid-auto-rows: max-content;
      gap: 12px;
      align-content: start;
    }

    /* horizontal card: portrait thumb (mobile-game frames) + wide chip row */
    .cand {
      position: relative;
      min-height: 132px;
      display: grid;
      grid-template-columns: 104px 1fr;
      border-radius: 12px;
      border: 1px solid var(--line-soft);
      border-left-width: 3px;
      border-left-color: var(--amber);
      background: var(--panel);
      overflow: hidden;
      transition: border-color .12s ease, box-shadow .12s ease;
    }
    .cand:hover { border-color: #3a4152; }
    .cand.dropped { border-left-color: #333947; opacity: 0.66; }
    .cand.focused {
      border-color: var(--focus);
      box-shadow: 0 0 0 1px var(--focus), 0 12px 30px -18px rgba(126,162,255,0.85);
    }

    .cand .shot {
      position: relative;
      background:
        repeating-linear-gradient(45deg, #0a0b10 0 6px, #0d0f15 6px 12px);
      cursor: pointer;
      min-height: 128px;
      overflow: hidden;
    }
    .cand .shot img {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      object-fit: cover; object-position: center top;
      display: block;
      transition: filter .15s ease;
    }
    .cand.dropped .shot img { filter: grayscale(1) brightness(0.6); }
    .cand .shot .manual {
      position: absolute; inset: 0;
      display: grid; place-items: center;
      color: var(--muted); font: 700 10px/1.3 var(--mono); letter-spacing: 1px; text-align: center;
    }
    .cand .shot .drop-badge {
      position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
      display: none;
      padding: 3px 9px; border-radius: 6px;
      background: rgba(12,14,18,0.82); border: 1px solid rgba(255,85,115,0.6);
      color: var(--red); font: 800 9px/1 var(--sans); letter-spacing: 1.5px; text-transform: uppercase;
    }
    .cand.dropped .shot .drop-badge { display: block; }

    .cand .meta {
      display: flex; flex-direction: column; min-width: 0;
      padding: 10px 12px 11px;
    }
    .cand .meta-top {
      display: flex; align-items: center; gap: 8px; margin-bottom: 9px;
    }
    .cand .tc {
      display: inline-flex; align-items: baseline; gap: 7px;
      font: 700 13px/1 var(--mono); color: var(--text); letter-spacing: 0.3px;
    }
    .cand .tc .fr { color: var(--amber); font-size: 11px; font-weight: 600; }
    .cand .src-tag {
      padding: 2px 6px; border-radius: 5px;
      font: 700 8.5px/1 var(--sans); letter-spacing: 1px; text-transform: uppercase;
      background: rgba(52,211,180,0.16); color: var(--teal); border: 1px solid rgba(52,211,180,0.4);
    }
    .cand[data-source="agent"] .src-tag { display: none; }

    .keepbtn {
      margin-left: auto;
      display: inline-flex; align-items: center; gap: 5px;
      min-height: 28px; padding: 0 11px;
      border-radius: 8px; border: 1px solid transparent;
      font-weight: 700; font-size: 12px; letter-spacing: 0.2px;
      background: var(--amber); color: #201603;
    }
    .keepbtn .ic { font-size: 11px; }
    .cand.dropped .keepbtn {
      background: transparent; color: var(--red);
      border-color: rgba(255,85,115,0.55);
    }
    .chips {
      display: flex; flex-wrap: wrap; gap: 6px;
      margin-top: auto;
    }
    .chip {
      padding: 4px 8px; border-radius: 999px;
      border: 1px solid var(--line);
      background: transparent; color: var(--muted);
      font: 650 10.5px/1 var(--sans); letter-spacing: 0.2px;
      text-transform: none;
      transition: background .1s ease, color .1s ease, border-color .1s ease;
    }
    .chip .k { font: 700 9px/1 var(--mono); color: var(--muted-2); margin-right: 4px; }
    .chip:hover { border-color: #454c5e; color: var(--text); }
    .chip.active {
      background: var(--amber); border-color: var(--amber); color: #201603;
    }
    .chip.active .k { color: #4a3708; }
    .cand.dropped .chips { opacity: 0.5; }
    .other-chip {
      border-style: dashed;
      color: var(--amber-bright);
      background: rgba(244,178,62,0.08);
    }
    .other-label-form {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
      width: 100%;
      min-height: 30px;
    }
    .other-label-input {
      min-width: 148px; flex: 1 1 148px;
      height: 30px;
      padding: 0 9px;
      border-radius: 8px;
      border: 1px solid var(--focus);
      background: #0f1218;
      color: var(--text);
      font: 650 12px/1 var(--sans);
    }
    .other-label-input::placeholder { color: var(--muted-2); }
    .other-label-error {
      flex-basis: 100%;
      color: var(--red);
      font: 650 10.5px/1.25 var(--sans);
    }

    /* ---------- submit bar ---------- */
    .submitbar {
      display: flex; align-items: center; gap: 14px;
      padding: 12px 20px;
      border-top: 1px solid var(--line);
      background: linear-gradient(180deg, #12141a, #14161d);
    }
    .status {
      flex: 1; min-width: 0;
      font-size: 12.5px; color: var(--muted); line-height: 1.4;
    }
    .status.success { color: var(--teal); font-weight: 600; }
    .status.error { color: var(--red); font-weight: 600; }
    .status.warn { color: var(--amber); font-weight: 600; }
    .submit {
      min-height: 44px; padding: 0 22px;
      border-radius: 10px; border: 1px solid transparent;
      background: var(--amber); color: #201603;
      font-weight: 750; font-size: 14px; letter-spacing: 0.2px;
      box-shadow: 0 10px 26px -12px rgba(244,178,62,0.7);
      transition: background .12s ease, transform .05s ease, box-shadow .12s ease;
    }
    .submit:hover { background: var(--amber-bright); }
    .submit.confirm {
      background: var(--teal); color: #04231d;
      box-shadow: 0 0 0 3px rgba(52,211,180,0.28), 0 10px 26px -12px rgba(52,211,180,0.8);
      animation: glow 1.2s ease-in-out infinite;
    }
    .submit.done { background: var(--panel-3); color: var(--teal); border-color: rgba(52,211,180,0.5); box-shadow: none; cursor: default; }
    .submit:disabled { opacity: 0.55; cursor: default; box-shadow: none; }
    @keyframes glow {
      0%,100% { box-shadow: 0 0 0 3px rgba(52,211,180,0.22), 0 10px 26px -12px rgba(52,211,180,0.7); }
      50% { box-shadow: 0 0 0 5px rgba(52,211,180,0.10), 0 10px 30px -10px rgba(52,211,180,0.95); }
    }

    /* narrow / mobile fallback */
    @media (max-width: 900px) {
      .app { height: auto; }
      .workspace { grid-template-columns: 1fr; }
      .stage { border-right: 0; border-bottom: 1px solid var(--line); overflow: visible; }
      .rail { grid-template-columns: 1fr; }
      .kbd-hint { display: none; }
      video { max-height: 40vh; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <h1>Reference Frame Picker</h1>
        <span class="sub" id="dur-sub"></span>
      </div>
      <nav class="kbd-hint" aria-label="keyboard shortcuts">
        <span class="grp"><kbd>Space</kbd> play</span>
        <span class="grp"><kbd>J</kbd><kbd>K</kbd> walk</span>
        <span class="grp"><kbd>X</kbd> keep / drop</span>
        <span class="grp"><span class="keys" id="label-hint-keys"></span> label</span>
      </nav>
    </header>

    <div class="workspace">
      <section class="stage" aria-label="video stage">
        <div class="video-wrap">
          <video id="video" src="${escapeHtml(model.videoSrc)}" playsinline controls preload="metadata"></video>
        </div>
        <div class="transport">
          <div class="tc-readout" id="tc"><span class="dim">0:00.0</span></div>
        </div>
        <div class="timeline" id="timeline" aria-label="candidate timeline"></div>
        <div class="stage-actions">
          <button class="btn" id="add" type="button">+ Add frame at playhead</button>
          <button class="btn ghost" id="focus-seek" type="button">Seek to focused</button>
        </div>
        <div class="inspector" id="inspector">
          <img class="thumb" id="insp-thumb" alt="">
          <div class="info">
            <div class="lead">Focused candidate</div>
            <div class="headline" id="insp-head">—</div>
            <div class="lab" id="insp-lab">—</div>
          </div>
        </div>
        <div class="legend">
          <div class="lg-title">Keyboard</div>
          <div class="row"><span class="keys"><kbd>Space</kbd></span> play / pause</div>
          <div class="row"><span class="keys"><kbd>J</kbd><kbd>K</kbd></span> prev / next frame</div>
          <div class="row"><span class="keys"><kbd>X</kbd></span> keep / drop focused</div>
          <div class="row"><span class="keys" id="legend-label-keys"></span> label / other</div>
        </div>
      </section>

      <section class="rail-shell" aria-label="candidate frames">
        <div class="rail-head">
          <div class="rail-title">Candidates <span class="n" id="rail-n"></span></div>
          <div class="summary" id="summary"></div>
        </div>
        <div class="rail" id="rail"></div>
        <div class="submitbar">
          <div class="status" id="status" role="status">Review the candidates, then submit the kept frames.</div>
          <button class="submit" id="submit" type="button">Submit</button>
        </div>
      </section>
    </div>
  </div>

  <script>
    var MODEL = ${json};
    var LABELS = MODEL.labels.slice();
    var LABEL_RE = ${LABEL_TOKEN_RE.toString()};
    var FPS = MODEL.fps || null;

    var video = document.getElementById('video');
    var timeline = document.getElementById('timeline');
    var rail = document.getElementById('rail');
    var summaryEl = document.getElementById('summary');
    var statusEl = document.getElementById('status');
    var submitBtn = document.getElementById('submit');
    var tcEl = document.getElementById('tc');
    var railN = document.getElementById('rail-n');
    var inspThumb = document.getElementById('insp-thumb');
    var inspHead = document.getElementById('insp-head');
    var inspLab = document.getElementById('insp-lab');
    var inspector = document.getElementById('inspector');
    var labelHintKeys = document.getElementById('label-hint-keys');
    var legendLabelKeys = document.getElementById('legend-label-keys');

    var state = {
      markers: MODEL.markers.map(function (m) { return Object.assign({}, m); }),
      focusId: MODEL.markers.length ? MODEL.markers[0].id : null,
      confirming: false,
      submitted: false,
      otherInputForId: null,
      otherDraft: '',
      otherError: '',
      focusOtherAfterRender: false,
    };
    var confirmTimer = null;

    function sorted() {
      return state.markers.slice().sort(function (a, b) { return a.t - b.t; });
    }
    function focusedMarker() {
      return state.markers.find(function (m) { return m.id === state.focusId; }) || null;
    }
    function clearOtherInputState() {
      state.otherInputForId = null;
      state.otherDraft = '';
      state.otherError = '';
      state.focusOtherAfterRender = false;
    }

    function duration() {
      return (Number.isFinite(video.duration) && video.duration > 0) ? video.duration : (MODEL.duration || 1);
    }
    function clockAt(t) {
      var s = Math.max(0, Number(t) || 0);
      var m = Math.floor(s / 60);
      var rem = s - m * 60;
      var whole = Math.floor(rem);
      var tenth = Math.floor((rem - whole) * 10);
      return m + ':' + (whole < 10 ? '0' : '') + whole + '.' + tenth;
    }
    function frameNo(t) {
      if (!FPS) return null;
      return Math.round(Number(t) * FPS);
    }

    function setStatus(text, kind) {
      statusEl.textContent = text;
      statusEl.className = 'status' + (kind ? ' ' + kind : '');
    }
    function validateLabel(label) {
      return LABEL_RE.test(label);
    }
    function labelValidationError(label) {
      if (!validateLabel(label)) {
        return { text: 'Label must match /^[a-z][a-z0-9_-]*$.', kind: 'error' };
      }
      if (LABELS.indexOf(label) !== -1) {
        return { text: 'Label "' + label + '" already exists.', kind: 'warn' };
      }
      return null;
    }
    function normalizeOtherLabel(rawLabel) {
      return String(rawLabel || '').trim().toLowerCase().replace(/\\s+/g, '-');
    }

    // Frame-exact seek: assign the producer time verbatim, clamped to media bounds. No offsets.
    function seekTo(t) {
      var clamped = Math.min(Math.max(0, Number(t)), duration());
      video.currentTime = clamped;
    }

    function cssId(id) { return String(id).replace(/["\\\\]/g, '\\\\$&'); }

    function setFocus(id, opts) {
      opts = opts || {};
      if (state.otherInputForId && state.otherInputForId !== id) clearOtherInputState();
      state.focusId = id;
      var m = focusedMarker();
      if (m) {
        if (opts.seek) seekTo(m.t);
        render(false);
        if (opts.scroll) {
          var node = rail.querySelector('[data-id="' + cssId(id) + '"]');
          if (node) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    }

    function moveFocus(delta) {
      var list = sorted();
      if (!list.length) return;
      var idx = list.findIndex(function (m) { return m.id === state.focusId; });
      if (idx < 0) idx = 0;
      var next = Math.min(list.length - 1, Math.max(0, idx + delta));
      setFocus(list[next].id, { seek: true, scroll: true });
    }

    function toggleKeep(m) {
      m.keep = !m.keep;
      if (state.confirming) resetConfirm();
      render(false);
    }
    function assignLabel(m, label) {
      if (m.label === label) return;
      if (state.otherInputForId === m.id) clearOtherInputState();
      m.label = label;
      if (state.confirming) resetConfirm();
      render(false);
    }
    function addLabel(rawLabel) {
      var label = String(rawLabel || '').trim();
      var error = labelValidationError(label);
      if (error) {
        setStatus(error.text, error.kind);
        return null;
      }
      LABELS.push(label);
      if (state.confirming) resetConfirm();
      setStatus('Added label "' + label + '".');
      render(false);
      return label;
    }
    function openOtherInput(m) {
      state.focusId = m.id;
      state.otherInputForId = m.id;
      state.otherDraft = '';
      state.otherError = '';
      state.focusOtherAfterRender = true;
      render(false);
    }
    function cancelOtherInput() {
      clearOtherInputState();
      render(false);
    }
    function submitOtherLabel(m, rawLabel) {
      var label = normalizeOtherLabel(rawLabel);
      var error = labelValidationError(label);
      if (error) {
        state.otherInputForId = m.id;
        state.otherDraft = rawLabel;
        state.otherError = error.text;
        state.focusOtherAfterRender = true;
        setStatus(error.text, error.kind);
        render(false);
        return;
      }
      var added = addLabel(label);
      if (!added) return;
      clearOtherInputState();
      assignLabel(m, added);
    }

    /* ---------- rendering ---------- */
    var playhead = document.createElement('div');
    playhead.className = 'playhead';

    function updatePlayhead() {
      var pct = Math.min(100, Math.max(0, (video.currentTime / duration()) * 100));
      playhead.style.left = pct + '%';
      var fr = frameNo(video.currentTime);
      tcEl.innerHTML = '<span class="dim">' + clockAt(video.currentTime) + '</span>' +
        '<span class="dim"> / ' + clockAt(duration()) + '</span>' +
        (fr != null ? '<span class="frame">#' + fr + '</span>' : '');
    }

    function renderTimeline() {
      timeline.textContent = '';
      var total = duration();
      state.markers.forEach(function (m) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'marker' + (m.keep ? '' : ' dropped') + (m.id === state.focusId ? ' focused' : '');
        b.dataset.source = m.source;
        b.style.left = Math.min(100, Math.max(0, (m.t / total) * 100)) + '%';
        b.title = m.label + ' · ' + clockAt(m.t);
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          setFocus(m.id, { seek: true, scroll: true });
        });
        timeline.appendChild(b);
      });
      timeline.appendChild(playhead);
      updatePlayhead();
    }

    // Lightweight timeline refresh (keep/focus classes) without rebuilding markers.
    function renderTimelineFocus() {
      Array.prototype.forEach.call(timeline.querySelectorAll('.marker'), function (b, i) {
        var m = state.markers[i];
        if (!m) return;
        b.className = 'marker' + (m.keep ? '' : ' dropped') + (m.id === state.focusId ? ' focused' : '');
      });
    }

    function makeChips(m) {
      var wrap = document.createElement('div');
      wrap.className = 'chips';
      LABELS.forEach(function (label, i) {
        var c = document.createElement('button');
        c.type = 'button';
        c.className = 'chip' + (m.label === label ? ' active' : '');
        var key = document.createElement('span');
        key.className = 'k';
        key.textContent = shortcutKeyForIndex(i) || '';
        c.appendChild(key);
        c.appendChild(document.createTextNode(label));
        c.setAttribute('aria-pressed', m.label === label ? 'true' : 'false');
        c.title = 'Label: ' + label + (shortcutKeyForIndex(i) ? '  (' + shortcutKeyForIndex(i) + ')' : '');
        c.addEventListener('click', function (e) {
          e.stopPropagation();
          assignLabel(m, label);
        });
        wrap.appendChild(c);
      });
      if (state.otherInputForId === m.id) {
        wrap.appendChild(makeOtherInput(m));
      } else {
        wrap.appendChild(makeOtherChip(m));
      }
      return wrap;
    }

    function makeOtherChip(m) {
      var c = document.createElement('button');
      c.type = 'button';
      c.className = 'chip other-chip';
      var shortcut = otherShortcutKey();
      var key = document.createElement('span');
      key.className = 'k';
      key.textContent = shortcut || '';
      c.appendChild(key);
      c.appendChild(document.createTextNode('other...'));
      c.title = 'Create a new label' + (shortcut ? '  (' + shortcut + ')' : '');
      c.addEventListener('click', function (e) {
        e.stopPropagation();
        openOtherInput(m);
      });
      return c;
    }

    function makeOtherInput(m) {
      var form = document.createElement('div');
      form.className = 'other-label-form';
      var input = document.createElement('input');
      input.className = 'other-label-input';
      input.type = 'text';
      input.value = state.otherDraft;
      input.placeholder = 'new-label';
      input.setAttribute('aria-label', 'New label');
      input.addEventListener('click', function (e) { e.stopPropagation(); });
      input.addEventListener('input', function () {
        state.otherDraft = input.value;
        state.otherError = '';
      });
      input.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          submitOtherLabel(m, input.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelOtherInput();
        }
      });
      form.appendChild(input);
      if (state.otherError) {
        var error = document.createElement('div');
        error.className = 'other-label-error';
        error.textContent = state.otherError;
        form.appendChild(error);
      }
      return form;
    }

    function makeCard(m) {
      var card = document.createElement('article');
      card.className = 'cand ' + (m.keep ? 'kept' : 'dropped') + (m.id === state.focusId ? ' focused' : '');
      card.dataset.id = m.id;
      card.dataset.source = m.source;

      // portrait thumbnail
      var shot = document.createElement('div');
      shot.className = 'shot';
      if (m.thumb) {
        var img = document.createElement('img');
        img.src = m.thumb;
        img.alt = m.label + ' at ' + clockAt(m.t);
        shot.appendChild(img);
      } else {
        var man = document.createElement('div');
        man.className = 'manual';
        man.textContent = 'ADDED';
        shot.appendChild(man);
      }
      var badge = document.createElement('div');
      badge.className = 'drop-badge';
      badge.textContent = 'Dropped';
      shot.appendChild(badge);
      shot.addEventListener('click', function (e) { e.stopPropagation(); setFocus(m.id, { seek: true }); });
      card.appendChild(shot);

      // meta: top row (time + source + keep), then chip row
      var meta = document.createElement('div');
      meta.className = 'meta';

      var top = document.createElement('div');
      top.className = 'meta-top';
      var tc = document.createElement('div');
      tc.className = 'tc';
      var fr = frameNo(m.t);
      tc.innerHTML = clockAt(m.t) + (fr != null ? '<span class="fr">#' + fr + '</span>' : '');
      top.appendChild(tc);
      var srcTag = document.createElement('div');
      srcTag.className = 'src-tag';
      srcTag.textContent = 'manual';
      top.appendChild(srcTag);
      var keep = document.createElement('button');
      keep.type = 'button';
      keep.className = 'keepbtn';
      keep.innerHTML = m.keep
        ? '<span class="ic">✓</span>Keep'
        : '<span class="ic">✕</span>Drop';
      keep.setAttribute('aria-pressed', m.keep ? 'true' : 'false');
      keep.title = m.keep ? 'Kept — click to drop (x)' : 'Dropped — click to keep (x)';
      keep.addEventListener('click', function (e) { e.stopPropagation(); toggleKeep(m); });
      top.appendChild(keep);
      meta.appendChild(top);

      meta.appendChild(makeChips(m));
      card.appendChild(meta);

      card.addEventListener('click', function () { if (m.id !== state.focusId) setFocus(m.id, {}); });
      return card;
    }

    function renderRail() {
      var savedTop = rail.scrollTop;
      rail.textContent = '';
      sorted().forEach(function (m) { rail.appendChild(makeCard(m)); });
      rail.scrollTop = savedTop;
    }

    function renderSummary() {
      var kept = state.markers.filter(function (m) { return m.keep; });
      var counts = {};
      LABELS.forEach(function (l) { counts[l] = 0; });
      kept.forEach(function (m) { counts[m.label] = (counts[m.label] || 0) + 1; });

      railN.textContent = '· ' + state.markers.length + ' total';
      summaryEl.textContent = '';

      var pill = document.createElement('div');
      pill.className = 'kept-pill';
      pill.innerHTML = '<b>' + kept.length + '</b><span>kept</span>';
      summaryEl.appendChild(pill);

      LABELS.forEach(function (l) {
        var n = counts[l];
        var chip = document.createElement('span');
        chip.className = 'lab-count' + (n === 0 ? ' zero' : '');
        var dot = document.createElement('span');
        dot.className = 'dot';
        var label = document.createTextNode(l + ' ');
        var count = document.createElement('b');
        count.textContent = n;
        chip.appendChild(dot);
        chip.appendChild(label);
        chip.appendChild(count);
        summaryEl.appendChild(chip);
      });
    }

    function renderInspector() {
      var m = focusedMarker();
      inspector.classList.toggle('is-dropped', !!m && !m.keep);
      if (!m) {
        inspHead.textContent = '—';
        inspLab.textContent = '—';
        inspThumb.removeAttribute('src');
        return;
      }
      if (m.thumb) { inspThumb.src = m.thumb; } else { inspThumb.removeAttribute('src'); }
      var fr = frameNo(m.t);
      inspHead.textContent = clockAt(m.t) + (fr != null ? '  ·  frame #' + fr : '') + '  ·  ' + (m.keep ? 'kept' : 'dropped');
      inspLab.textContent = m.label;
    }

    function shortcutKeyForIndex(i) {
      return i >= 0 && i < 9 ? String(i + 1) : null;
    }
    function otherShortcutKey() {
      return shortcutKeyForIndex(LABELS.length);
    }
    function renderShortcutKeyRange(el) {
      el.textContent = '';
      var count = Math.min(LABELS.length + (otherShortcutKey() ? 1 : 0), 9);
      if (count < 1) return;
      var first = document.createElement('kbd');
      first.textContent = '1';
      el.appendChild(first);
      if (count > 1) {
        el.appendChild(document.createTextNode('-'));
        var last = document.createElement('kbd');
        last.textContent = String(count);
        el.appendChild(last);
      }
    }
    function renderShortcutHints() {
      renderShortcutKeyRange(labelHintKeys);
      renderShortcutKeyRange(legendLabelKeys);
    }

    function updateSubmitLabel() {
      if (state.submitted) return;
      var kept = state.markers.filter(function (m) { return m.keep; }).length;
      submitBtn.textContent = state.confirming
        ? 'Confirm — submit ' + kept + ' frame' + (kept === 1 ? '' : 's')
        : 'Submit ' + kept + ' frame' + (kept === 1 ? '' : 's');
      submitBtn.className = 'submit' + (state.confirming ? ' confirm' : '');
      submitBtn.disabled = kept === 0 && !state.confirming;
    }

    function render(fullTimeline) {
      if (fullTimeline !== false) renderTimeline(); else renderTimelineFocus();
      renderRail();
      renderSummary();
      renderInspector();
      renderShortcutHints();
      updateSubmitLabel();
      if (state.focusOtherAfterRender && state.otherInputForId) {
        var input = rail.querySelector('[data-id="' + cssId(state.otherInputForId) + '"] .other-label-input');
        if (input) {
          input.focus();
          if (input.select) input.select();
          state.focusOtherAfterRender = false;
        }
      }
    }

    /* ---------- interactions ---------- */
    timeline.addEventListener('click', function (e) {
      var rect = timeline.getBoundingClientRect();
      if (rect.width <= 0) return;
      var ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      seekTo(ratio * duration());
    });
    video.addEventListener('timeupdate', updatePlayhead);
    video.addEventListener('loadedmetadata', function () {
      document.getElementById('dur-sub').textContent =
        clockAt(duration()) + (FPS ? '  ·  ' + FPS + ' fps' : '');
      renderTimeline();
    });

    document.getElementById('add').addEventListener('click', function () {
      var m = {
        id: 'human-' + Date.now(),
        t: Math.round(video.currentTime * 1000) / 1000,
        label: LABELS[0],
        source: 'human',
        keep: true,
      };
      state.markers.push(m);
      if (state.confirming) resetConfirm();
      setStatus('Added a frame at ' + clockAt(m.t) + '.');
      setFocus(m.id, { scroll: true });
    });

    document.getElementById('focus-seek').addEventListener('click', function () {
      var m = focusedMarker();
      if (m) seekTo(m.t);
    });

    function resetConfirm() {
      state.confirming = false;
      if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
      updateSubmitLabel();
    }

    submitBtn.addEventListener('click', async function () {
      if (state.submitted) return;
      var kept = state.markers.filter(function (m) { return m.keep; });
      if (!kept.length) { setStatus('Nothing to submit — keep at least one frame first.', 'warn'); return; }

      if (!state.confirming) {
        state.confirming = true;
        setStatus('Submitting ' + kept.length + ' kept frame' + (kept.length === 1 ? '' : 's') + '. Click Confirm to send, or make more edits.', 'warn');
        updateSubmitLabel();
        confirmTimer = setTimeout(resetConfirm, 4000);
        return;
      }
      resetConfirm();

      var reqId = location.pathname.split('/')[2];
      if (!reqId) { setStatus('Could not resolve the Portal request id from this URL.', 'error'); return; }

      var frames = kept
        .slice()
        .sort(function (a, b) { return a.t - b.t; })
        .map(function (m) {
          return { t: m.t, label: m.label, source: m.source };
        });

      submitBtn.disabled = true;
      setStatus('Submitting ' + frames.length + ' frames…');
      try {
        var res = await fetch('/r/' + encodeURIComponent(reqId) + '/decide', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: { frames: frames } }),
        });
        var text = await res.text();
        if (!res.ok) throw new Error(text || (res.status + ' ' + res.statusText));
        state.submitted = true;
        setStatus('Submitted ' + frames.length + ' frames. Portal has your selection.', 'success');
        submitBtn.textContent = '✓ Submitted';
        submitBtn.className = 'submit done';
        submitBtn.disabled = false;
      } catch (err) {
        setStatus(err.message, 'error');
        submitBtn.disabled = false;
        updateSubmitLabel();
      }
    });

    // keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = (e.target && e.target.tagName) || '';
      var onButton = tag === 'BUTTON';
      var onTextInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (onTextInput) return;

      if (e.key === ' ' || e.key === 'Spacebar') {
        if (onButton) return; // let the focused button take the space
        e.preventDefault();
        if (video.paused) video.play(); else video.pause();
        return;
      }
      if (e.key === 'j' || e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); moveFocus(1); return; }
      if (e.key === 'k' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); moveFocus(-1); return; }
      if (e.key === 'x' || e.key === 'd') {
        var m = focusedMarker();
        if (m) { e.preventDefault(); toggleKeep(m); }
        return;
      }
      if (e.key >= '1' && e.key <= '9') {
        var idx = Number(e.key) - 1;
        var fm = focusedMarker();
        if (fm && LABELS[idx]) { e.preventDefault(); assignLabel(fm, LABELS[idx]); }
        else if (fm && idx === LABELS.length && otherShortcutKey()) { e.preventDefault(); openOtherInput(fm); }
        return;
      }
    });

    render();
  </script>
</body>
</html>
`;
}

export function buildView({ candidatesFile, videoSrc, outFile, labels }) {
  if (!candidatesFile) throw new Error('--candidates is required');
  if (!videoSrc) throw new Error('--video-src is required');
  if (!outFile) throw new Error('--out is required');

  const model = readCandidates(candidatesFile, videoSrc, labels);
  const absOut = path.resolve(outFile);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, buildHtml(model));
  return { outFile: absOut, markers: model.markers, labels: model.labels };
}
