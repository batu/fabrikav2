// Boot gate — keep this module free of app imports. src/core/Constants.ts
// snapshots window.innerWidth/Height at module evaluation, and on a cold
// iOS WKWebView start those report a stale size for the first frames.
// Booting then bakes a wrong aspect into GAME.WIDTH/HEIGHT, and Phaser's
// FIT letterboxes the whole canvas with background bars down the sides
// (the "first boot: sides cropped / not mirrored" bug). Defer every app
// import until the viewport holds still for a few consecutive frames.
async function waitForStableViewport(maxWaitMs: number): Promise<void> {
  const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const deadline = performance.now() + maxWaitMs;
  let width = window.innerWidth;
  let height = window.innerHeight;
  let stableFrames = 0;
  while (performance.now() < deadline) {
    await nextFrame();
    const nextWidth = window.innerWidth;
    const nextHeight = window.innerHeight;
    if (nextWidth === width && nextHeight === height && nextWidth > 0 && nextHeight > 0) {
      stableFrames += 1;
      if (stableFrames >= 3) return;
    } else {
      stableFrames = 0;
      width = nextWidth;
      height = nextHeight;
    }
  }
}

void waitForStableViewport(600).then(() => import('./bootstrap'));
