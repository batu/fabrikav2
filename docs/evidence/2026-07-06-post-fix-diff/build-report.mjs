// Generate the post-fix resolved/remaining report (card MR6uIsba) from the 38
// findings in docs/evidence/2026-07-06-rigorous-diff/findings.json + the per-
// finding verdicts assessed against the newly recaptured, capture-integrity-
// gated v2 states (shots/*.png) vs the committed android refs.
//
// Verdicts are authored here (the human judgement), keyed by finding id, so the
// table is generated deterministically and every row cites its source finding.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const findings = JSON.parse(
  fs.readFileSync(path.join(REPO, 'docs/evidence/2026-07-06-rigorous-diff/findings.json'), 'utf8'),
).findings;
const integrity = JSON.parse(fs.readFileSync(path.join(HERE, 'integrity.json'), 'utf8'));

// status: resolved | partial | remains | positive | needs-video | needs-device | needs-capture | unverified
const V = {
  F01: ['needs-device', 'Safe-area inset (D1). Fix is token-based (--fab-safe-top env insets, per FIX-3/main.ts note); a 390×844 Chromium capture has no native iOS status bar to overlap, so this is verify-on-device, not observable here. Tokens present in source.'],
  F02: ['resolved', 'Saga is now a STRAIGHT vertical line of nodes (5·4·3·2·1), matching the android reference. The left/right offset is gone. (shots/menu.png)'],
  F03: ['partial', 'Connector reads as a wooden track band now (improved from a plain rope) but the reference double-rail intricacy is not clearly reproduced. Asset-detail, low severity.'],
  F04: ['partial', 'Rotation/tilt clash gone — v2 board is now axis-aligned & static. BUT composition still differs: v2 board is large and the saga runs THROUGH it; reference board is small, top-anchored, chain below in clear space. Composition portion remains.'],
  F05: ['resolved', 'Still evidence: v2 menu board is axis-aligned and static (no tilt), so the rotate-vs-static-saga clash is gone (FIX-2). Full no-animation confirmation is motion → see needs-video caveat, but the clash itself is resolved in the still.'],
  F06: ['remains', 'Background is still flat dots + confetti in v2; reference is translucent glass-marble spheres. Asset not swapped. (shots/menu.png vs refs/menu.png)'],
  F07: ['needs-video', 'Reference background is animated; v2 appears static in the still. Motion — a single frame cannot prove/disprove. Capture a video to close.'],
  F08: ['resolved', 'Coin icon is now a clean gold coin with white $ and shine on the blue pill; the muddy multicolor disc is gone. (shots/menu.png)'],
  F09: ['resolved', 'Settings-gear is now a clean gear glyph on the blue button, matching the reference light-grey gear. (shots/menu.png / shots/level.png)'],
  F10: ['resolved', "'Marble Run' wooden banner plaque now renders at reference-comparable proportions. (shots/menu.png vs refs/menu.png)"],
  F11: ['partial', 'Button color families + candy bevel are much closer (green LEVEL / green NEXT / green CLOSE candy pills). Font face still not a pixel match to the reference candy buttons. Font portion remains.'],
  F12: ['positive', 'POSITIVE retained — v2 particle/confetti system remains rich (visible on menu). No regression.'],
  F13: ['resolved', 'In-game hearts are now drawn glossy heart assets in a candy pill, not system emoji. (shots/level.png)'],
  F14: ['resolved', 'Level coin-pill icon is now gold (was silver/grey). (shots/level.png)'],
  F15: ['resolved', 'HINT tile is now a warm tan/wood panel with a gold coin (was grey-lavender + silver coin). (shots/level.png)'],
  F16: ['needs-video', 'Red glare / blocked-hit feedback is a motion/feedback event; not provable from a static level still. Capture a video of a blocked tap to close.'],
  F17: ['positive', 'POSITIVE retained — level board camera (straight top-down, fills width) and glossy marble sprites remain faithful. (shots/level.png)'],
  F18: ['resolved', 'Settings is now a floating MODAL card (rounded, centered) rather than a full opaque page. (shots/settings.png). NOTE: dimmed-board scrim still missing — tracked under F26.'],
  F19: ['partial', "Settings still has no orange ribbon header and no blue X close — it uses a green CLOSE candy button instead. The candy language is right, the specific ribbon+X assets remain unmatched."],
  F20: ['remains', "Settings header is still blue soft-sans 'Settings'; reference is a chunky white outlined 'SETTINGS'. Font not swapped for this header. (shots/settings.png)"],
  F21: ['resolved', 'Settings toggles are now GREEN (accent-flip fixed, was orange). (shots/settings.png)'],
  F22: ['remains', 'Settings card is still cream with peach rows; reference is a blue candy card with white rows. NOTE inconsistency: win/fail cards ARE now blue candy (N2), but the settings card was not migrated. (shots/settings.png)'],
  F23: ['unverified', "'Reset Progress' link not present in the capture — a fresh cold boot has no saved progress, so the (in-game-only / hasProgress) reset control does not render. Needs a save-state seeded run to verify the underline."],
  F24: ['unverified', "Still not confirmable. NOTE: v2 pause overlay does contain a 'Settings' entry (shots/pause.png); whether that is the reported oddity is undecidable without a reference pause capture (none exists — documented gap)."],
  F25: ['resolved', "Win header is now a GREEN ribbon banner 'COMPLETED' (was brown left-aligned 'Level Complete' with no banner). (shots/win.png)"],
  F26: ['partial', 'Overlay cards are no longer flat-opaque-cream — win/fail are proper candy cards. BUT the reference dimmed-board scrim is still absent: overlays float over flat purple, not a dimmed board. Scrim portion remains. (shots/win.png, shots/fail.png)'],
  F27: ['resolved', 'Win art is now a gold CROWN (was a generic gold-disc globe scribble). (shots/win.png)'],
  F28: ['partial', "Win reward now shows a gold coin + '25' (coin restored). Still missing the 'REWARD' label and the '+' prefix from the reference framing. Minor layout remainder."],
  F29: ['resolved', "Win primary button is now a green candy 'NEXT' (was an orange pill). (shots/win.png)"],
  F30: ['remains', 'Win coin balance is still an orphan coin stack bottom-left; reference shows a coin pill top-right. (shots/win.png)'],
  F31: ['partial', "Fail card now has a RED ribbon banner 'FAILED' and a green candy 'WATCH AD' button (banner + accent resolved). Still no crying-emoji asset, and still carries the extra 'Quit' (+'Retry') links the reference fail lacks. (shots/fail.png)"],
  N1: ['resolved', 'META-FIX confirmed. This recapture is capture-integrity gated: every shot required driveTo()===true AND a matching live snapshot() scene (menu/playing/settingsOpen/paused/complete/failed). menu, level and pause are now three DISTINCT, correctly-labeled states — the B5 mislabel (menu-as-level / menu-as-pause) cannot recur. (integrity.json)'],
  N2: ['partial', 'Shared OverlayCard regression is largely fixed: win + fail now use the reference overlay language (blue candy card + full ribbon banner + green accent). Remaining slices of the same root: settings card still cream (F22) and the dimmed-board scrim is still missing everywhere (F26).'],
  N3: ['resolved', 'The vestigial 2px colored top strip is gone — win/fail now render FULL ribbon banners (green COMPLETED / red FAILED). (shots/win.png, shots/fail.png)'],
  N4: ['remains', "v2 win card still adds a 'Replay' secondary link the reference win (Next-only) does not have. (shots/win.png)"],
  N5: ['needs-device', 'Status-bar glyph tint is a native-shell concern; a browser capture has no OS status bar. Per main.ts note the glyph tint (light-content) still awaits the Capacitor status-bar plugin. Verify on device.'],
  N6: ['partial', "Two-face typography partially restored: win/fail now use the chunky OUTLINED display face for banners/CTAs (COMPLETED, FAILED, NEXT, WATCH AD). Settings header (F20) and some labels still use the soft rounded sans. Partial."],
  N7: ['needs-capture', 'App-icon fidelity still cannot be assessed — no home-screen capture exists on either platform, and a WebView capture cannot show the installed app icon. Out of scope for this browser lane.'],
};

const LABEL = {
  resolved: 'RESOLVED', partial: 'PARTIAL', remains: 'STILL-OPEN', positive: 'POSITIVE (kept)',
  'needs-video': 'NEEDS-VIDEO', 'needs-device': 'NEEDS-DEVICE', 'needs-capture': 'NEEDS-CAPTURE', unverified: 'UNVERIFIED',
};
const COLOR = {
  resolved: '#2ea043', partial: '#c9a227', remains: '#d1495b', positive: '#2f81f7',
  'needs-video': '#8957e5', 'needs-device': '#6e7681', 'needs-capture': '#6e7681', unverified: '#6e7681',
};

const counts = {};
for (const f of findings) { const s = V[f.id]?.[0] || 'unverified'; counts[s] = (counts[s] || 0) + 1; }

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const badge = (s) => `<span class="badge" style="background:${COLOR[s]}">${LABEL[s]}</span>`;

const summaryOrder = ['resolved', 'positive', 'partial', 'remains', 'needs-video', 'needs-device', 'needs-capture', 'unverified'];
const summaryCards = summaryOrder.filter((s) => counts[s]).map((s) =>
  `<div class="sumcard" style="border-color:${COLOR[s]}"><div class="n">${counts[s]}</div><div class="l">${LABEL[s]}</div></div>`,
).join('');

const rows = findings.map((f) => {
  const [status, note] = V[f.id] || ['unverified', '—'];
  return `<tr class="s-${status}">
    <td class="id">${esc(f.id)}</td>
    <td><span class="sev sev-${esc(f.severity)}">${esc(f.severity)}</span></td>
    <td class="axis">${esc(f.axis)}</td>
    <td class="title">${esc(f.title)}</td>
    <td>${badge(status)}</td>
    <td class="note">${esc(note)}</td>
  </tr>`;
}).join('\n');

const integRows = integrity.captured.map((c) =>
  `<tr><td class="id">${esc(c.state)}</td><td>${c.integrityPass ? '<span class="ok">✓ confirmed</span>' : '<span class="bad">✗ FAIL</span>'}</td><td><code>driveTo()=${c.driveToReturned}</code></td><td><code>scene='${esc(c.actualScene)}'${c.settingsOpen ? " · settingsOpen" : ''}</code></td><td class="note">${esc(c.expected)}</td></tr>`,
).join('\n');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>marble_run — post-fix fidelity re-verify (MR6uIsba)</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; padding:32px 28px 80px; background:#0f1117; color:#e6edf3;
         font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif; }
  h1 { font-size:24px; margin:0 0 6px; }
  h2 { font-size:18px; margin:36px 0 12px; border-bottom:1px solid #21262d; padding-bottom:6px; }
  p.sub { color:#8b949e; margin:0 0 8px; max-width:900px; }
  a { color:#2f81f7; }
  code { background:#161b22; padding:1px 5px; border-radius:4px; font-size:12.5px; }
  .summary { display:flex; flex-wrap:wrap; gap:12px; margin:18px 0 8px; }
  .sumcard { border:2px solid; border-radius:10px; padding:10px 16px; min-width:96px; background:#161b22; }
  .sumcard .n { font-size:26px; font-weight:700; }
  .sumcard .l { font-size:11px; color:#8b949e; text-transform:uppercase; letter-spacing:.04em; }
  table { border-collapse:collapse; width:100%; margin-top:8px; font-size:13.5px; }
  th,td { text-align:left; padding:8px 10px; vertical-align:top; border-bottom:1px solid #21262d; }
  th { color:#8b949e; font-size:12px; text-transform:uppercase; letter-spacing:.03em; position:sticky; top:0; background:#0f1117; }
  td.id { font-weight:700; font-family:ui-monospace,monospace; white-space:nowrap; }
  td.title { min-width:240px; }
  td.axis { color:#8b949e; white-space:nowrap; font-size:12px; }
  td.note { color:#c9d1d9; font-size:12.5px; }
  .badge { color:#fff; font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:20px;
           white-space:nowrap; text-transform:uppercase; letter-spacing:.03em; }
  .sev { font-weight:700; font-size:11px; padding:1px 6px; border-radius:4px; }
  .sev-P1 { background:#d1495b; color:#fff; } .sev-P2 { background:#c9a227; color:#111; } .sev-P3 { background:#30363d; color:#c9d1d9; }
  tr.s-resolved td.id, tr.s-positive td.id { color:#3fb950; }
  tr.s-remains td.id { color:#f85149; }
  .ok { color:#3fb950; font-weight:700; } .bad { color:#f85149; font-weight:700; }
  .legend { color:#8b949e; font-size:12.5px; margin-top:10px; max-width:900px; }
  .cite { background:#161b22; border-left:3px solid #2f81f7; padding:10px 14px; border-radius:0 8px 8px 0; margin:10px 0; max-width:900px; }
</style></head>
<body>
<h1>marble_run — post-fix fidelity re-verify</h1>
<p class="sub">Card <b>MR6uIsba</b> · date 2026-07-06 · re-runs the 38-finding
<a href="../2026-07-06-rigorous-diff/report.html">rigorous paired diff</a> after the fidelity fixes
(overlays / saga / assets / theme / render-binding) + <code>driveTo</code> + refcap-compare landed.</p>

<div class="cite">
<b>Method (honest).</b> v2 lane = <code>vite dev</code> (harness enabled) driven by Playwright:
<code>window.__MARBLE_RUN_HARNESS__.driveTo(state)</code> for menu/level/settings/pause/win/fail, at
390×844 Chromium (deviceScaleFactor 2). <b>Every</b> shot is capture-integrity gated — it is saved only when
<code>driveTo()===true</code> AND the live <code>snapshot()</code> reports the expected scene/flag — so the
B5/N1 "menu mislabeled as level/pause" bug cannot recur. Each state is captured from a fresh cold reload
(no cross-state DOM leak). Reference lane = the committed OFFLINE android captures
(<code>refs/captures/android-basegamelab/*.png</code>, Pixel&nbsp;6a adb). A browser (WKWebView-family) capture is
sufficient for asset/color/layout fidelity; motion and native-shell items are marked, never asserted from a still.
Grid: <a href="grid.html">grid.html</a> (paired android | v2 + perceptual diff, via refcap-compare's grid module).
</div>

<h2>Capture-integrity ledger (the N1/B5 gate)</h2>
<table>
<thead><tr><th>state</th><th>integrity</th><th>driveTo</th><th>confirmed snapshot</th><th>expected</th></tr></thead>
<tbody>${integRows}</tbody>
</table>
<p class="legend">All six states confirmed. <code>pause</code> is a genuine pause overlay (not a mislabeled menu);
<code>level</code> is a real playing board; <code>settings</code> confirmed on the modal flag (settings is a modal over the
menu, so its flow scene stays <code>menu</code> by design). Source: <code>integrity.json</code>.</p>

<h2>Resolved / remaining — all 38 findings</h2>
<div class="summary">${summaryCards}</div>
<p class="legend"><b>PARTIAL</b> = the finding's root cause is addressed but a named slice remains (cited in-row).
<b>NEEDS-VIDEO</b> = motion item, unprovable from a still. <b>NEEDS-DEVICE</b> = native-shell (safe-area / status-bar tint),
not observable in a browser lane. <b>NEEDS-CAPTURE</b> = requires an artifact this lane can't produce (app icon).
<b>UNVERIFIED</b> = requires a state this cold-boot capture didn't reach (seeded save / reference pause).</p>
<table>
<thead><tr><th>id</th><th>sev</th><th>axis</th><th>finding</th><th>verdict</th><th>evidence / note</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>

<p class="legend" style="margin-top:24px">Generated by <code>build-report.mjs</code> from
<code>2026-07-06-rigorous-diff/findings.json</code> + <code>integrity.json</code> + the recaptured
<code>shots/*.png</code>. Verdicts are the reviewer's per-finding judgement against the new captures; every row cites its source finding id.</p>
</body></html>
`;

fs.writeFileSync(path.join(HERE, 'report.html'), html, 'utf8');
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log('verdict counts:', JSON.stringify(counts), 'total', total);
console.log('wrote report.html');
