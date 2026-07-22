// MRV2-13 U4: deterministic headless acceptance for defect 1 (home preview
// board). Serves the dist build with `vite preview`, opens it at iPhone-ish
// 393x852, waits for the preview canvas (boot is timing-sensitive — never a
// fixed sleep), asserts the full-bleed fixed geometry, then proves board
// PIXELS are present by diffing a screenshot against one with the canvas
// hidden (no pngjs in the tree; identical PNGs == blank/absent board).
//
// Run from games/marble_run after `npm run build`:
//   node scripts/verify-home-preview.mjs
/* global process, getComputedStyle */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const PORT = Number(process.env.PREVIEW_PORT ?? 4173);
const EVIDENCE_DIR = join(process.cwd(), "evidence", "mrv2-13");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

const preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "inherit"],
});
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite preview did not start in 30s")), 30000);
    preview.stdout.on("data", (chunk) => {
      if (String(chunk).includes(String(PORT))) {
        clearTimeout(timer);
        resolve();
      }
    });
    preview.on("exit", (code) => reject(new Error(`vite preview exited early (${code})`)));
  });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
    await page.goto(`http://localhost:${PORT}/`);
    const canvas = page.locator(".marble-home-board-preview");
    await canvas.waitFor({ state: "attached", timeout: 45000 });

    // Re-query fresh at probe time: the boot flow can dispose/remount the
    // canvas, leaving the first-matched locator element detached (all-empty
    // computed style).
    await page.waitForTimeout(1500);
    const geo = await page.evaluate(() => {
      const all = document.querySelectorAll(".marble-home-board-preview");
      const el = all[all.length - 1];
      if (!el) return null;
      if (all.length > 1) console.warn(`multiple preview canvases: ${all.length}`);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { position: cs.position, zIndex: cs.zIndex, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
    });
    console.log("preview canvas geometry:", JSON.stringify(geo));
    if (geo === null) throw new Error("preview canvas missing at probe time");
    if (geo.position !== "fixed") fail(`computed position is '${geo.position}', expected 'fixed'`);
    if (Math.abs(geo.rect.x) > 1 || Math.abs(geo.rect.y) > 1) fail(`rect origin ${geo.rect.x},${geo.rect.y}, expected 0,0`);
    if (Math.abs(geo.rect.w - 393) > 2 || Math.abs(geo.rect.h - 852) > 2) fail(`rect ${geo.rect.w}x${geo.rect.h}, expected 393x852`);

    // Give the three.js preview a few frames to draw before sampling.
    await page.waitForTimeout(1500);
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const withBoard = await page.screenshot();
    writeFileSync(join(EVIDENCE_DIR, "home-preview.png"), withBoard);
    await canvas.evaluate((el) => { el.style.visibility = "hidden"; });
    const withoutBoard = await page.screenshot();
    writeFileSync(join(EVIDENCE_DIR, "home-preview-canvas-hidden.png"), withoutBoard);
    if (withBoard.equals(withoutBoard)) {
      fail("screenshot identical with the preview canvas hidden — no board pixels rendered");
    } else {
      console.log(`board pixels present (screenshots differ: ${withBoard.length} vs ${withoutBoard.length} bytes)`);
    }
  } finally {
    await browser.close();
  }
} finally {
  preview.kill();
}
console.log(process.exitCode ? "RESULT: FAIL" : "RESULT: PASS");
