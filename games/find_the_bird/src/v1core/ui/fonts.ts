/**
 * ../v1core/ui font primitives.
 *
 * Two shared pieces, one job each:
 *
 * - `FONT_STACK` — the single canonical CSS font-family string for Fabrika UI.
 *   It is kept byte-identical to the `--fab-font-family` token default in
 *   `ui.css` (a unit test guards the two against drifting). A game reads this
 *   constant instead of hand-rolling its own stack literal.
 * - `ensureFontsLoaded()` — a FontFaceSet-based FOUT guard a game awaits before
 *   its first text paint, so canvas/DOM text renders with the web font already
 *   resolved instead of flashing a fallback.
 *
 * Delivery is intentionally NOT handled here: Nunito ships via the Google Fonts
 * CDN `<link>` each game already has in its `index.html`. There is deliberately
 * no self-hosted `@font-face` in core `ui.css` — adding one for `Nunito` would
 * shadow the CDN font that the live, frozen games resolve at runtime (and there
 * are no Nunito `.woff2` assets in the repo to host anyway). This module only
 * dedupes the *stack definition* and the *readiness logic*, not the hosting.
 */

/** The canonical Fabrika UI font-family stack. Mirrors `--fab-font-family` in `ui.css`. */
export const FONT_STACK = "'Nunito', sans-serif";

export interface EnsureFontsOptions {
  /** Font families to warm. Default: `['Nunito']`. */
  families?: string[];
  /** Weights to request per family. Default: `[400, 700, 800, 900]`. */
  weights?: (string | number)[];
  /** Cap on how long first paint may wait for fonts. Default: `3000` ms. */
  timeoutMs?: number;
}

/**
 * Resolve once the requested web fonts are ready — or once `timeoutMs` elapses,
 * whichever comes first.
 *
 * Fail-open by design: a game must NEVER hang its first paint on a font. If the
 * FontFaceSet API is absent (SSR / old WebView) this returns immediately, and
 * if the fonts never settle it resolves on the timeout rather than rejecting.
 * The single intentional graceful-degradation seam is the timeout race — there
 * is no other defensive handling (fonts.ready never rejects per spec).
 */
export async function ensureFontsLoaded(opts: EnsureFontsOptions = {}): Promise<void> {
  const families: string[] = opts.families ?? ['Nunito'];
  const weights: (string | number)[] = opts.weights ?? [400, 700, 800, 900];
  const timeoutMs: number = opts.timeoutMs ?? 3000;

  const fontSet: FontFaceSet | undefined =
    typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fontSet) return;

  for (const family of families) {
    for (const weight of weights) {
      // Kick off the load; readiness is awaited collectively via `.ready` below,
      // not per individual load promise. Swallow a per-face rejection (e.g. the
      // CDN failing to deliver a weight) so it never escapes as an unhandled
      // rejection — the collective `.ready`/timeout race owns the fail-open path.
      void fontSet.load(`${weight} 1em '${family}'`).catch((): void => undefined);
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout: Promise<void> = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([fontSet.ready.then((): void => undefined), timeout]);
  if (timer !== undefined) clearTimeout(timer);
}
