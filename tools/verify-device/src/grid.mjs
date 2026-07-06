// Self-contained device|reference|diff grid, one row per canonical state. Images
// are base64-inlined so the artifact is a single portable file (matches the
// hand-authored grids under docs/evidence/, which this generalizes). A missing
// device capture or a documented reference gap renders an explicit placeholder —
// absence is visible, never a silent blank (fidelity ledger B3).

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function imgTag(cell, extraClass = '') {
  if (!cell || cell.gap) {
    return `<div class="placeholder">${esc(cell ? cell.gap : 'missing')}</div>`;
  }
  return `<img class="shot ${extraClass}" src="data:image/png;base64,${cell.base64}" alt="${esc(cell.alt)}" />`;
}

function meta(cell) {
  if (!cell || cell.gap) return '';
  const rows = [
    ['source', cell.source],
    ['package', cell.package],
    ['version', cell.version],
    ['resolution', cell.resolution],
    ['sig', cell.sig],
  ].filter(([, v]) => v != null && v !== '');
  return `<dl class="meta">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

/**
 * @param {object} params
 * @param {string} params.game
 * @param {string} params.generatedAt stamp (passed in, not generated here)
 * @param {string} params.device device name/udid line, or a skip note
 * @param {Array} params.rows [{state, device, reference, diff}]
 * @param {{pass:boolean, summary:string, states:Array}} params.verdict
 * @returns {string} full HTML document
 */
export function buildGridHtml({ game, generatedAt, device, rows, verdict }) {
  const statusByState = Object.fromEntries((verdict?.states || []).map((s) => [s.state, s]));
  const body = rows.map((row) => {
    const st = statusByState[row.state] || { status: 'unknown', reason: '' };
    const diffCell = row.diff
      ? `<figure class="cell">
           <figcaption>pixel-diff (${(row.diff.changedFraction * 100).toFixed(1)}% changed)</figcaption>
           <img class="shot diff" src="data:image/png;base64,${row.diff.base64}" alt="diff ${esc(row.state)}" />
         </figure>`
      : `<figure class="cell">
           <figcaption>pixel-diff</figcaption>
           <div class="placeholder">no diff — ${esc(st.reason || 'one side is a documented gap')}</div>
         </figure>`;
    return `
    <section class="row">
      <h2>${esc(row.state)} <span class="badge ${esc(st.status)}">${esc(st.status)}</span>
          <span class="reason">${esc(st.reason || '')}</span></h2>
      <figure class="cell">
        <figcaption>device (iOS, on-device)</figcaption>
        ${imgTag(row.device, 'dev')}
        ${meta(row.device)}
      </figure>
      <figure class="cell">
        <figcaption>reference (android)</figcaption>
        ${imgTag(row.reference, 'ref')}
        ${meta(row.reference)}
      </figure>
      ${diffCell}
    </section>`;
  }).join('\n');

  const verdictClass = verdict?.pass ? 'ok' : 'bad';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>verify-device — ${esc(game)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 32px; background: #1c1830; color: #ece7f5;
         font: 15px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p.sub { color: #b3a9cc; margin: 0 0 16px; }
  code { background: #2c2646; padding: 1px 5px; border-radius: 4px; }
  .verdict { font-size: 16px; font-weight: 600; padding: 12px 16px; border-radius: 10px;
             margin: 0 0 24px; }
  .verdict.ok { background: #16351d; color: #7ee38a; border: 1px solid #2f6d3c; }
  .verdict.bad { background: #3a1a20; color: #ff9aa6; border: 1px solid #7a3040; }
  .row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px;
         align-items: start; margin-bottom: 40px;
         border-top: 1px solid #362e52; padding-top: 18px; }
  .row h2 { grid-column: 1 / -1; font-size: 17px; margin: 0; text-transform: capitalize; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; text-transform: uppercase;
           vertical-align: middle; }
  .badge.pass { background: #16351d; color: #7ee38a; }
  .badge.fail { background: #3a1a20; color: #ff9aa6; }
  .badge.missing { background: #3a2f16; color: #ffd479; }
  .badge.no-reference { background: #241f3a; color: #cdb4d6; }
  .reason { font-size: 12px; color: #8f86ad; text-transform: none; margin-left: 6px; }
  .cell { margin: 0; text-align: center; }
  .cell figcaption { color: #b3a9cc; font-size: 12px; margin-bottom: 8px; }
  .shot { width: 100%; max-width: 260px; border-radius: 12px;
          box-shadow: 0 6px 20px rgba(0,0,0,.4); }
  .shot.dev { outline: 2px solid #6aa8ff; outline-offset: 3px; }
  .shot.ref { outline: 2px solid #5fd06a; outline-offset: 3px; }
  .shot.diff { max-width: 140px; image-rendering: pixelated; }
  .placeholder { border: 1px dashed #6b6390; border-radius: 12px; padding: 24px 12px;
                 color: #cdb4d6; background: #241f3a; font-size: 13px;
                 max-width: 260px; margin: 0 auto; }
  dl.meta { text-align: left; max-width: 260px; margin: 10px auto 0;
            display: grid; grid-template-columns: auto 1fr; gap: 2px 10px;
            font-size: 11px; color: #b3a9cc; }
  dl.meta dt { font-weight: 600; color: #8f86ad; }
  dl.meta dd { margin: 0; word-break: break-all; }
</style>
</head>
<body>
  <h1>verify-device — ${esc(game)}</h1>
  <p class="sub">On-device capture (blue) vs committed reference (green) per canonical
     state · device: <code>${esc(device || 'n/a')}</code> · generated ${esc(generatedAt)}.
     The forcing function for AGENTS.md #8: a change to on-device rendering is not
     done until captured on-device and diffed here.</p>
  <p class="verdict ${verdictClass}">${esc(verdict?.summary || 'no verdict')}</p>
  ${body}
</body>
</html>
`;
}
