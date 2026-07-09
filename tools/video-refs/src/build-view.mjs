import fs from 'node:fs';
import path from 'node:path';
import { formatTimestamp } from './time.mjs';

const LABELS = ['menu', 'level', 'settings', 'pause', 'win', 'fail', 'gameplay', 'other'];

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

function readCandidates(candidatesFile, videoSrc) {
  const abs = path.resolve(candidatesFile);
  const baseDir = path.dirname(abs);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(data.candidates)) throw new Error('candidates.json must contain a candidates array');

  const markers = data.candidates.map((candidate, index) => {
    const rel = candidate.file;
    if (typeof rel !== 'string') throw new Error(`candidate ${index} is missing file`);
    const imagePath = path.resolve(baseDir, rel);
    const buffer = fs.readFileSync(imagePath);
    return {
      id: `agent-${index + 1}`,
      t: Number(formatTimestamp(candidate.t)),
      label: LABELS.includes(candidate.label) ? candidate.label : 'gameplay',
      source: 'agent',
      keep: true,
      thumb: `data:image/jpeg;base64,${buffer.toString('base64')}`,
    };
  });

  return {
    videoSrc,
    duration: Number.isFinite(data.duration_s) ? data.duration_s : 0,
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
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f4ef;
      color: #181b20;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: #f6f4ef;
    }
    main {
      width: min(100%, 760px);
      margin: 0 auto;
      padding: max(14px, env(safe-area-inset-top)) 14px max(18px, env(safe-area-inset-bottom));
    }
    .picker-layout {
      display: grid;
    }
    .video-pane {
      display: contents;
    }
    .candidate-pane {
      order: 2;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    h1 {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
      font-weight: 720;
    }
    .count {
      min-width: 72px;
      text-align: right;
      color: #526070;
      font-size: 13px;
      font-weight: 650;
    }
    video {
      display: block;
      width: 100%;
      max-height: 44vh;
      background: #0e1116;
      border-radius: 8px;
    }
    .timeline {
      position: relative;
      height: 42px;
      margin: 12px 0 8px;
      border-radius: 8px;
      background: linear-gradient(90deg, #253142, #697b8f);
      overflow: hidden;
      border: 1px solid rgba(24, 27, 32, 0.14);
    }
    .marker {
      position: absolute;
      top: 6px;
      width: 28px;
      height: 30px;
      transform: translateX(-50%);
      border: 0;
      border-radius: 999px;
      background: #f4c542;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.24);
    }
    .marker[data-source="human"] { background: #52b788; }
    .marker.dropped {
      opacity: 0.38;
      background: #c5cad1;
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin: 10px 0 12px;
    }
    button {
      min-height: 44px;
      border: 1px solid rgba(24, 27, 32, 0.18);
      border-radius: 8px;
      background: #ffffff;
      color: #181b20;
      font: inherit;
      font-weight: 680;
    }
    button:active { transform: translateY(1px); }
    .primary {
      background: #1967d2;
      border-color: #1967d2;
      color: #ffffff;
    }
    .list {
      display: grid;
      gap: 8px;
    }
    .frame {
      display: grid;
      grid-template-columns: 112px 1fr;
      gap: 10px;
      align-items: stretch;
      padding: 8px;
      background: #ffffff;
      border: 1px solid rgba(24, 27, 32, 0.12);
      border-radius: 8px;
      cursor: pointer;
    }
    .frame.dropped {
      opacity: 0.55;
    }
    .frame img, .manual-thumb {
      width: 112px;
      height: 76px;
      object-fit: cover;
      border-radius: 6px;
      background: #202833;
    }
    .manual-thumb {
      display: grid;
      place-items: center;
      color: #ffffff;
      font-size: 12px;
      font-weight: 720;
    }
    .meta {
      min-width: 0;
      display: grid;
      gap: 8px;
      align-content: start;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .time {
      font-size: 16px;
      font-weight: 760;
      white-space: nowrap;
    }
    .source {
      color: #526070;
      font-size: 12px;
      font-weight: 690;
      text-transform: uppercase;
    }
    .small-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .toggle[aria-pressed="false"] {
      background: #eef1f4;
      color: #526070;
    }
    .chip {
      background: #fff6d8;
      color: #483500;
    }
    .status {
      order: 3;
      min-height: 22px;
      margin-top: 10px;
      color: #334155;
      font-size: 13px;
      line-height: 1.35;
      white-space: pre-wrap;
    }
    .status.success { color: #136f3b; font-weight: 700; }
    .status.error { color: #b3261e; font-weight: 700; }
    @media (min-width: 900px) {
      main {
        width: min(100%, 1180px);
        padding: max(16px, env(safe-area-inset-top)) 18px max(22px, env(safe-area-inset-bottom));
      }
      .topbar {
        margin-bottom: 14px;
      }
      .picker-layout {
        grid-template-columns: minmax(360px, 45%) minmax(0, 1fr);
        gap: 18px;
        align-items: start;
      }
      .video-pane {
        display: block;
        position: sticky;
        top: 0;
        max-height: 100vh;
        overflow-y: auto;
        padding-bottom: max(18px, env(safe-area-inset-bottom));
        background: #f6f4ef;
      }
      .candidate-pane {
        order: initial;
        min-width: 0;
      }
      .status {
        order: initial;
      }
      video {
        max-height: 52vh;
      }
      .list {
        gap: 10px;
      }
    }
    @media (max-width: 430px) {
      main { padding-left: 10px; padding-right: 10px; }
      .frame { grid-template-columns: 96px 1fr; }
      .frame img, .manual-thumb { width: 96px; height: 68px; }
      .small-actions { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>Reference frames</h1>
      <div class="count" id="count"></div>
    </div>
    <div class="picker-layout">
      <section class="video-pane" aria-label="video controls">
        <video id="video" src="${escapeHtml(model.videoSrc)}" playsinline controls preload="metadata"></video>
        <div class="timeline" id="timeline" aria-label="candidate timeline"></div>
        <div class="actions">
          <button id="add" type="button">Add frame at current time</button>
          <button id="submit" type="button" class="primary">Submit frames</button>
        </div>
        <div class="status" id="status" role="status"></div>
      </section>
      <section class="candidate-pane" aria-label="candidate frames">
        <div class="list" id="list"></div>
      </section>
    </div>
  </main>
  <script>
    const MODEL = ${json};
    const INITIAL_MARKERS = MODEL.markers;
    const LABELS = ${safeJsonForScript(LABELS)};
    const video = document.getElementById('video');
    const timeline = document.getElementById('timeline');
    const list = document.getElementById('list');
    const count = document.getElementById('count');
    const statusEl = document.getElementById('status');
    const state = { markers: INITIAL_MARKERS.map((marker) => ({ ...marker })) };

    function roundTime(value) {
      return Math.max(0, Math.round(Number(value || 0) * 10) / 10);
    }

    function fmt(value) {
      return roundTime(value).toFixed(1).replace(/\\.0$/, '');
    }

    function duration() {
      return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : MODEL.duration || 1;
    }

    function setStatus(text, kind) {
      statusEl.textContent = text;
      statusEl.className = 'status' + (kind ? ' ' + kind : '');
    }

    function seekTo(t) {
      video.currentTime = Math.min(Math.max(0, Number(t)), duration());
      video.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    function cycleLabel(marker) {
      const current = LABELS.indexOf(marker.label);
      marker.label = LABELS[(current + 1 + LABELS.length) % LABELS.length];
      render();
    }

    function toggleKeep(marker) {
      marker.keep = !marker.keep;
      render();
    }

    function markerThumb(marker) {
      if (marker.thumb) {
        const img = document.createElement('img');
        img.src = marker.thumb;
        img.alt = marker.label + ' at ' + fmt(marker.t) + 's';
        img.addEventListener('click', (event) => {
          event.stopPropagation();
          seekTo(marker.t);
        });
        return img;
      }
      const node = document.createElement('div');
      node.className = 'manual-thumb';
      node.textContent = 'ADDED';
      node.addEventListener('click', (event) => {
        event.stopPropagation();
        seekTo(marker.t);
      });
      return node;
    }

    function renderTimeline() {
      timeline.textContent = '';
      const total = duration();
      state.markers.forEach((marker) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'marker' + (marker.keep ? '' : ' dropped');
        button.dataset.source = marker.source;
        button.style.left = Math.min(100, Math.max(0, (marker.t / total) * 100)) + '%';
        button.title = marker.label + ' ' + fmt(marker.t) + 's';
        button.addEventListener('click', () => seekTo(marker.t));
        timeline.appendChild(button);
      });
    }

    function renderList() {
      list.textContent = '';
      state.markers
        .slice()
        .sort((a, b) => a.t - b.t)
        .forEach((marker) => {
          const item = document.createElement('section');
          item.className = 'frame' + (marker.keep ? '' : ' dropped');
          item.addEventListener('click', (event) => {
            const target = event.target;
            if (target instanceof Element && target.closest('button')) return;
            seekTo(marker.t);
          });
          item.appendChild(markerThumb(marker));

          const meta = document.createElement('div');
          meta.className = 'meta';

          const top = document.createElement('div');
          top.className = 'row';
          const time = document.createElement('div');
          time.className = 'time';
          time.textContent = fmt(marker.t) + 's';
          const source = document.createElement('div');
          source.className = 'source';
          source.textContent = marker.source;
          top.append(time, source);

          const controls = document.createElement('div');
          controls.className = 'small-actions';
          const keep = document.createElement('button');
          keep.type = 'button';
          keep.className = 'toggle';
          keep.setAttribute('aria-pressed', marker.keep ? 'true' : 'false');
          keep.textContent = marker.keep ? 'Keep' : 'Drop';
          keep.addEventListener('click', () => toggleKeep(marker));
          const label = document.createElement('button');
          label.type = 'button';
          label.className = 'chip';
          label.textContent = marker.label;
          label.addEventListener('click', () => cycleLabel(marker));
          controls.append(keep, label);

          meta.append(top, controls);
          item.appendChild(meta);
          list.appendChild(item);
        });
    }

    function render() {
      renderTimeline();
      renderList();
      const kept = state.markers.filter((marker) => marker.keep).length;
      count.textContent = kept + '/' + state.markers.length + ' kept';
    }

    document.getElementById('add').addEventListener('click', () => {
      state.markers.push({
        id: 'human-' + Date.now(),
        t: roundTime(video.currentTime),
        label: 'gameplay',
        source: 'human',
        keep: true,
      });
      setStatus('');
      render();
    });

    document.getElementById('submit').addEventListener('click', async () => {
      const reqId = location.pathname.split('/')[2];
      if (!reqId) {
        setStatus('Could not resolve the Portal request id from this URL.', 'error');
        return;
      }
      const frames = state.markers
        .filter((marker) => marker.keep)
        .sort((a, b) => a.t - b.t)
        .map((marker) => ({
          t: roundTime(marker.t),
          label: marker.label,
          source: marker.source,
        }));
      setStatus('Submitting...');
      try {
        const response = await fetch('/r/' + encodeURIComponent(reqId) + '/decide', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: { frames } }),
        });
        const text = await response.text();
        if (!response.ok) throw new Error(text || response.status + ' ' + response.statusText);
        setStatus('Submitted. Portal has the selected frames.', 'success');
      } catch (err) {
        setStatus(err.message, 'error');
      }
    });

    video.addEventListener('loadedmetadata', renderTimeline);
    render();
  </script>
</body>
</html>
`;
}

export function buildView({ candidatesFile, videoSrc, outFile }) {
  if (!candidatesFile) throw new Error('--candidates is required');
  if (!videoSrc) throw new Error('--video-src is required');
  if (!outFile) throw new Error('--out is required');

  const model = readCandidates(candidatesFile, videoSrc);
  const absOut = path.resolve(outFile);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, buildHtml(model));
  return { outFile: absOut, markers: model.markers };
}
