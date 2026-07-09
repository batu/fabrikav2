import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseFrameRate, selectFrameRate, snapToFrameMidpoint } from '../src/time.mjs';

const TOOL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN = path.join(TOOL_DIR, 'run.mjs');

function sh(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding ?? 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'video-refs-'));
}

function makeFixtureVideo(dir) {
  const video = path.join(dir, 'fixture.mp4');
  sh('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=320x180:r=30:d=2',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=320x180:r=30:d=2',
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p',
    video,
  ]);
  return video;
}

function assertMidFrame(t, fps) {
  const scaled = t * fps;
  const nearestMidpoint = Math.floor(scaled) + 0.5;
  assert.ok(
    Math.abs(scaled - nearestMidpoint) <= 1e-6,
    `expected ${t} to be on the ${fps}fps midpoint grid`,
  );
}

describe('video-refs CLI', () => {
  it('parses and selects frame rates for midpoint snapping', () => {
    assert.equal(parseFrameRate('30/1'), 30);
    assert.equal(parseFrameRate('30000/1001'), 30000 / 1001);
    assert.equal(parseFrameRate('0/0'), null);
    assert.equal(selectFrameRate({ avgFrameRate: '30/1', rFrameRate: '30/1' }), 30);
    assert.equal(selectFrameRate({ avgFrameRate: '0/0', rFrameRate: '30000/1001' }), 30000 / 1001);
    assert.throws(
      () => selectFrameRate({ avgFrameRate: '30000/1001', rFrameRate: '30/1' }),
      /conflicting video frame rates/,
    );
    assert.equal(snapToFrameMidpoint(2, 30), 60.5 / 30);
  });

  it('suggests, builds a self-contained picker, and extracts verdict frames', () => {
    const dir = makeTempDir();
    const video = makeFixtureVideo(dir);

    const suggestOut = path.join(dir, 'suggest');
    sh(process.execPath, [
      RUN,
      'suggest',
      '--video',
      video,
      '--out',
      suggestOut,
      '--interval',
      '2',
      '--scene',
      '0.2',
    ]);

    const candidatesPath = path.join(suggestOut, 'candidates.json');
    const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
    assert.equal(candidates.video, video);
    assert.equal(candidates.duration_s, 4);
    assert.equal(candidates.fps, 30);
    assert.ok(candidates.candidates.length >= 2, 'expected red and blue candidates after dedup');
    const firstFrameMidpoint = snapToFrameMidpoint(0, candidates.fps);
    const sceneMidpoint = snapToFrameMidpoint(2 + (2 / candidates.fps), candidates.fps);
    const uniformCutMidpoint = snapToFrameMidpoint(2, candidates.fps);
    assert.ok(candidates.candidates.some((candidate) => Math.abs(candidate.t - firstFrameMidpoint) <= 1e-6));
    assert.ok(candidates.candidates.some((candidate) => Math.abs(candidate.t - sceneMidpoint) <= 1e-6));
    assert.ok(!candidates.candidates.some((candidate) => Math.abs(candidate.t - uniformCutMidpoint) <= 1e-6));
    for (const candidate of candidates.candidates) {
      assertMidFrame(candidate.t, candidates.fps);
      assert.ok(fs.existsSync(path.join(suggestOut, candidate.file)), `missing ${candidate.file}`);
    }

    const htmlPath = path.join(dir, 'picker.html');
    sh(process.execPath, [
      RUN,
      'build-view',
      '--candidates',
      candidatesPath,
      '--video-src',
      '02_fixture.mp4',
      '--out',
      htmlPath,
    ]);
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /src="02_fixture\.mp4"/);
    assert.match(html, /var MODEL = /);
    assert.match(html, /var LABELS = \["menu","level","settings","pause","win","fail","gameplay","other"\];/);
    assert.match(html, /markers: MODEL\.markers\.map\(function \(m\) \{ return Object\.assign\(\{\}, m\); \}\)/);
    assert.match(html, /var FPS = MODEL\.fps \|\| null;/);
    assert.doesNotMatch(html, /INITIAL_MARKERS/);
    assert.doesNotMatch(html, /https?:\/\//i);
    assert.match(html, /<div class="workspace">/);
    assert.match(
      html,
      /<section class="stage" aria-label="video stage">[\s\S]*<video id="video" src="02_fixture\.mp4"[\s\S]*<\/section>/,
    );
    assert.match(
      html,
      /<section class="rail-shell" aria-label="candidate frames">[\s\S]*<div class="rail" id="rail"><\/div>[\s\S]*<div class="status" id="status" role="status">Review the candidates, then submit the kept frames\.<\/div>[\s\S]*<\/section>/,
    );
    assert.match(html, /<nav class="kbd-hint" aria-label="keyboard shortcuts">[\s\S]*<kbd>Space<\/kbd> play[\s\S]*<kbd>J<\/kbd><kbd>K<\/kbd> walk[\s\S]*<kbd>X<\/kbd> keep \/ drop[\s\S]*<kbd>1<\/kbd>[\s\S]*<kbd>8<\/kbd> label[\s\S]*<\/nav>/);
    assert.match(html, /function makeChips\(m\) \{[\s\S]*LABELS\.forEach\(function \(label, i\) \{[\s\S]*c\.className = 'chip' \+ \(m\.label === label \? ' active' : ''\);[\s\S]*assignLabel\(m, label\);/);
    assert.match(html, /<button class="submit" id="submit" type="button">Submit<\/button>/);
    assert.match(
      html,
      /\.workspace \{[\s\S]*grid-template-columns: minmax\(440px, 42%\) minmax\(0, 1fr\);[\s\S]*min-height: 0;/,
    );
    assert.doesNotMatch(html, /class="picker-layout"/);
    assert.doesNotMatch(html, /class="video-pane"/);
    assert.doesNotMatch(html, /class="candidate-pane"/);
    assert.doesNotMatch(html, /class="list" id="list"/);
    assert.doesNotMatch(html, /\.video-pane[\s\S]*position: sticky;[\s\S]*max-height: 100vh;/);
    assert.match(
      html,
      /function makeCard\(m\) \{[\s\S]*card\.addEventListener\('click', function \(\) \{ if \(m\.id !== state\.focusId\) setFocus\(m\.id, \{\}\); \}\);[\s\S]*return card;/,
    );
    assert.match(html, /function setFocus\(id, opts\) \{[\s\S]*if \(opts\.seek\) seekTo\(m\.t\);[\s\S]*node\.scrollIntoView\(\{ block: 'nearest', behavior: 'smooth' \}\);/);
    assert.match(html, /document\.addEventListener\('keydown', function \(e\) \{[\s\S]*if \(e\.key === ' ' \|\| e\.key === 'Spacebar'\)[\s\S]*if \(e\.key === 'j' \|\| e\.key === 'ArrowDown' \|\| e\.key === 'ArrowRight'\)[\s\S]*if \(e\.key === 'k' \|\| e\.key === 'ArrowUp' \|\| e\.key === 'ArrowLeft'\)[\s\S]*if \(e\.key === 'x' \|\| e\.key === 'd'\)[\s\S]*if \(e\.key >= '1' && e\.key <= '8'\)/);
    assert.match(html, /function resetConfirm\(\) \{[\s\S]*state\.confirming = false;[\s\S]*clearTimeout\(confirmTimer\);[\s\S]*updateSubmitLabel\(\);[\s\S]*\}/);
    assert.match(html, /if \(!state\.confirming\) \{[\s\S]*state\.confirming = true;[\s\S]*Click Confirm to send, or make more edits\.[\s\S]*confirmTimer = setTimeout\(resetConfirm, 4000\);[\s\S]*return;[\s\S]*\}/);
    assert.match(html, /await fetch\('\/r\/' \+ encodeURIComponent\(reqId\) \+ '\/decide', \{[\s\S]*method: 'POST'[\s\S]*body: JSON\.stringify\(\{ payload: \{ frames: frames \} \}\)/);
    assert.match(html, /\.map\(function \(m\) \{ return \{ t: m\.t, label: m\.label, source: m\.source \}; \}\);/);
    assert.match(html, /state\.submitted = true;[\s\S]*setStatus\('Submitted ' \+ frames\.length \+ ' frames\. Portal has your selection\.', 'success'\);[\s\S]*submitBtn\.textContent = '.*Submitted';/);
    assert.match(html, /catch \(err\) \{[\s\S]*setStatus\(err\.message, 'error'\);[\s\S]*submitBtn\.disabled = false;[\s\S]*updateSubmitLabel\(\);/);

    const verdictPath = path.join(dir, 'verdict.json');
    fs.writeFileSync(verdictPath, JSON.stringify({
      id: 'req_123',
      payload: {
        frames: [
          { t: 0, label: 'menu', source: 'agent' },
          { t: 2, label: 'level', source: 'human' },
          { t: 2, label: 'level', source: 'human' },
        ],
      },
    }));
    const extractOut = path.join(dir, 'extract');
    sh(process.execPath, [
      RUN,
      'extract',
      '--video',
      video,
      '--verdict',
      verdictPath,
      '--out',
      extractOut,
    ]);

    const manifest = JSON.parse(fs.readFileSync(path.join(extractOut, 'extracted.json'), 'utf8'));
    assert.deepEqual(manifest.map((entry) => entry.file), ['menu-0.png', 'level-2.png', 'level-2-2.png']);
    assert.equal(manifest[1].source, 'human');
    assert.equal(manifest[1].provenance, 'video-refs extract from fixture.mp4');
    assert.equal(manifest[1]['at-rest'], true);
    for (const entry of manifest) {
      assert.ok(fs.existsSync(path.join(extractOut, entry.file)), `missing extracted ${entry.file}`);
    }
  });
});
