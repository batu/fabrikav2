/**
 * buildFidelityGrid() — the PURE (browser-safe, no filesystem) HTML builder for
 * a reference-vs-candidate fidelity grid. Mirrors `runLayout.ts`: the shape is
 * defined here and unit-tested without disk; the runner-side `writeFidelityGrid`
 * (`../playwright/fidelityRun.ts`) copies the reference PNGs and writes the file.
 *
 * WHY THIS EXISTS (card KEghp3x4 friction #1): before this, every fidelity
 * consumer hand-wrote ~90 lines of grid `<html>` + inline CSS in its spec (the
 * marble_run fidelity re-run, the reskin-drill verdict page, the `2026-07-06-1328-fixed`
 * before/after grid). `collectRun` knew screenshots/snapshots/events/perf but had
 * no notion of "compare a capture against its reference." This is that primitive.
 */

/** One reference↔candidate pair to render as a grid row. `*Src` are the
 *  relative image `src`s as they resolve from the grid HTML's own location. */
export interface FidelityPair {
  /** State name (used as the row heading). */
  readonly name: string;
  /** `<img src>` for the reference (v1) image, relative to the grid file. */
  readonly refSrc: string;
  /** `<img src>` for the candidate (v2) image, relative to the grid file. */
  readonly candidateSrc: string;
  /** Optional caption of the strictness axes locked for this state. */
  readonly axes?: string;
}

export interface FidelityGridOptions {
  /** Page `<title>` and `<h1>`. */
  readonly title?: string;
  /** Intro paragraph under the heading. */
  readonly lede?: string;
  /** Column caption for the reference (left) images. */
  readonly refLabel?: string;
  /** Column caption for the candidate (right) images. */
  readonly candidateLabel?: string;
  /** Small footer line (provenance). */
  readonly footer?: string;
}

const DEFAULTS: Required<Omit<FidelityGridOptions, 'footer'>> = {
  title: 'Fidelity grid — reference vs candidate',
  lede: 'Left column: reference. Right column: candidate capture.',
  refLabel: 'reference (v1)',
  candidateLabel: 'candidate (v2)',
};

/** Escape the five HTML-significant characters so state names / captions can't
 *  break the markup (they come from manifests, not the harness). */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a self-contained (single-file, inline-CSS) fidelity grid. Each pair is
 * one section with the reference on the left and the candidate on the right.
 * Returns the HTML string; the caller writes it next to the images it references.
 */
export function buildFidelityGrid(pairs: readonly FidelityPair[], options: FidelityGridOptions = {}): string {
  const opts = { ...DEFAULTS, ...options };
  const rows = pairs
    .map(
      (p) => `
    <section class="pair">
      <h2>${esc(p.name)}</h2>${p.axes ? `\n      <p class="axes">${esc(p.axes)}</p>` : ''}
      <div class="cols">
        <figure><figcaption>${esc(opts.refLabel)}</figcaption><img src="${esc(p.refSrc)}" alt="${esc(opts.refLabel)} ${esc(p.name)}"></figure>
        <figure><figcaption>${esc(opts.candidateLabel)}</figcaption><img src="${esc(p.candidateSrc)}" alt="${esc(opts.candidateLabel)} ${esc(p.name)}"></figure>
      </div>
    </section>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)}</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; padding: 2rem; background: #10131a; color: #e6e9ef; font: 15px/1.5 system-ui, sans-serif; }
    h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
    .lede { color: #9aa4b2; max-width: 62ch; margin: 0 0 2rem; }
    .pair { margin: 0 0 2.5rem; padding: 1rem 1.25rem 1.5rem; background: #171b24; border: 1px solid #232a36; border-radius: 12px; }
    .pair h2 { font-size: 1.05rem; margin: 0 0 .15rem; text-transform: capitalize; }
    .axes { color: #8b93a3; font-size: .85rem; margin: 0 0 1rem; }
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
    figure { margin: 0; }
    figcaption { color: #9aa4b2; font-size: .8rem; margin-bottom: .4rem; }
    img { width: 100%; height: auto; border-radius: 8px; border: 1px solid #2a3140; background: #000; }
    footer { color: #6c7686; font-size: .8rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>${esc(opts.title)}</h1>
  <p class="lede">${esc(opts.lede)}</p>
${rows}${opts.footer ? `\n  <footer>${esc(opts.footer)}</footer>` : ''}
</body>
</html>
`;
}
