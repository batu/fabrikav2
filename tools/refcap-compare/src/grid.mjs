// Self-contained HTML grid: one row per canonical state, reference | v2 columns
// plus a pixel-diff thumbnail. Images are base64-inlined so the artifact is a
// single portable file (matches the existing hand-authored grids under evidence/,
// which this generalizes). A missing side renders an explicit "documented gap"
// placeholder — absence is visible, never a silent blank (ledger B3).

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function imgTag(cell, extraClass = '') {
  if (cell.gap) {
    return `<div class="placeholder">${esc(cell.gap)}</div>`;
  }
  return `<img class="shot ${extraClass}" src="data:image/png;base64,${cell.base64}" alt="${esc(cell.alt)}" />`;
}

function meta(cell) {
  if (cell.gap) return '';
  const rows = [
    ['source', cell.source],
    ['lane', cell.lane],
    ['package', cell.package],
    ['version', cell.version],
    ['resolution', cell.resolution],
    ['sig', cell.sig],
  ].filter(([, v]) => v != null && v !== '');
  return `<dl class="meta">${rows
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
    .join('')}</dl>`;
}

/**
 * @param {object} params
 * @param {string} params.game
 * @param {string} params.generatedAt ISO timestamp (passed in, not generated here)
 * @param {string} params.mode e.g. "offline"
 * @param {Array} params.rows [{state, reference, v2, diff:{base64,changedFraction}|null}]
 * @returns {string} full HTML document
 */
export function buildGridHtml({ game, generatedAt, mode, rows }) {
  const body = rows.map((row) => {
    const diffCell = row.diff
      ? `<figure class="cell">
           <figcaption>pixel-diff (${(row.diff.changedFraction * 100).toFixed(0)}% changed)</figcaption>
           <img class="shot diff" src="data:image/png;base64,${row.diff.base64}" alt="diff ${esc(row.state)}" />
         </figure>`
      : `<figure class="cell">
           <figcaption>pixel-diff</figcaption>
           <div class="placeholder">no diff — one side is a documented gap</div>
         </figure>`;
    return `
    <section class="row">
      <h2>${esc(row.state)}</h2>
      <figure class="cell">
        <figcaption>reference (android)</figcaption>
        ${imgTag(row.reference, 'ref')}
        ${meta(row.reference)}
      </figure>
      <figure class="cell">
        <figcaption>v2 (apple/web port)</figcaption>
        ${imgTag(row.v2)}
        ${meta(row.v2)}
      </figure>
      ${diffCell}
    </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>refcap-compare — ${esc(game)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 32px; background: #1c1830; color: #ece7f5;
         font: 15px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p.sub { color: #b3a9cc; margin: 0 0 24px; }
  code { background: #2c2646; padding: 1px 5px; border-radius: 4px; }
  .row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px;
         align-items: start; margin-bottom: 40px;
         border-top: 1px solid #362e52; padding-top: 18px; }
  .row h2 { grid-column: 1 / -1; font-size: 17px; margin: 0; text-transform: capitalize; }
  .cell { margin: 0; text-align: center; }
  .cell figcaption { color: #b3a9cc; font-size: 12px; margin-bottom: 8px; }
  .shot { width: 100%; max-width: 260px; border-radius: 12px;
          box-shadow: 0 6px 20px rgba(0,0,0,.4); }
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
  <h1>refcap-compare — ${esc(game)}</h1>
  <p class="sub">Paired reference(android) vs v2 per canonical state · mode:
     <code>${esc(mode)}</code> · generated ${esc(generatedAt)}.
     Reference package foreground-verified + package/version stamped per capture.
     Green outline = authoritative reference. Documented gaps render explicitly.</p>
  ${body}
</body>
</html>
`;
}
