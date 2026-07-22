// MRV2-14 U5: deterministic headless acceptance for the wave-7 device-parity
// defects (home vertical budget + button width, modal ribbon overhang, pause
// colors, win reward stack). Serves the dist build with `vite preview`, then for
// each of the five card states drives the in-situ tour via ?insituTour=<state>,
// waits for the published `data-tour-state` marker (never a fixed sleep),
// asserts the geometry the ref PNGs encode, and writes a screenshot to
// evidence/mrv2-14/<state>.png for eyeball diffing against refs/<state>.png.
//
// Run from games/marble_run after `npm run build`:
//   node scripts/verify-wave7.mjs
/* global process, getComputedStyle */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const PORT = Number(process.env.PREVIEW_PORT ?? 4173);
const EVIDENCE_DIR = join(process.cwd(), "evidence", "mrv2-14");
const VIEWPORT = { width: 390, height: 844 };
const STATES = ["home-fresh", "level-map", "pause", "settings", "win"];

let failures = 0;
function fail(state, msg) {
  console.error(`FAIL [${state}]: ${msg}`);
  failures += 1;
}
function ok(state, msg) {
  console.log(`  ok [${state}]: ${msg}`);
}

function rectOf(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: r.x, y: r.y, w: r.width, h: r.height,
      top: r.top, bottom: r.bottom, left: r.left, right: r.right,
      cx: r.x + r.width / 2, cy: r.y + r.height / 2,
      background: cs.backgroundColor,
      sprite: el.style.getPropertyValue("--fab-btn-sprite-image"),
    };
  }, selector);
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

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const state of STATES) {
      // Fresh context per state: home-fresh's identity is an untouched save, and
      // isolating storage keeps each drive deterministic.
      const context = await browser.newContext({ viewport: VIEWPORT });
      const page = await context.newPage();
      await page.goto(`http://localhost:${PORT}/?insituTour=${state}`);
      try {
        await page.waitForSelector(
          `body[data-tour-state="${state}"], body[data-tour-state="${state}-DONE"]`,
          { timeout: 45000 },
        );
      } catch {
        const reached = await page.evaluate(() => document.body.getAttribute("data-tour-state"));
        fail(state, `tour marker never reached (last data-tour-state=${reached})`);
        await page.screenshot({ path: join(EVIDENCE_DIR, `${state}.png`) });
        await context.close();
        continue;
      }
      // Let the surface settle a couple frames before sampling/shooting.
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(EVIDENCE_DIR, `${state}.png`) });

      if (state === "home-fresh" || state === "level-map") {
        const btnSel = ".marble-ui .fab-home-menu-actions";
        // The chain's TAIL is the bottom-most node (sun node 1 on home-fresh,
        // node 106 on level-map). v1 keeps it above the fixed LEVEL button; the
        // round-6 overflow pushed it under/below the button.
        const node = await page.evaluate(() => {
          const nodes = Array.from(document.querySelectorAll("#home-shell .fab-levelmap-node"));
          if (nodes.length === 0) return null;
          const tail = nodes.reduce((lowest, el) =>
            el.getBoundingClientRect().bottom > lowest.getBoundingClientRect().bottom ? el : lowest);
          const r = tail.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, label: tail.textContent?.trim() };
        });
        const btn = await rectOf(page, btnSel);
        if (!node) fail(state, "no saga nodes found");
        if (!btn) fail(state, `LEVEL button (${btnSel}) missing`);
        if (node && btn) {
          if (node.bottom <= btn.top + 1) ok(state, `tail node ${node.label} bottom ${node.bottom.toFixed(0)} above button top ${btn.top.toFixed(0)}`);
          else fail(state, `tail node ${node.label} bottom ${node.bottom.toFixed(0)} not above button top ${btn.top.toFixed(0)} (clipped/overlapping)`);
          if (node.top >= 0 && node.bottom <= VIEWPORT.height) ok(state, `tail node fully in viewport`);
          else fail(state, `tail node out of viewport (top ${node.top.toFixed(0)}, bottom ${node.bottom.toFixed(0)})`);
          if (btn.w < 300) ok(state, `button width ${btn.w.toFixed(0)} < 300 (not full-bleed)`);
          else fail(state, `button width ${btn.w.toFixed(0)} >= 300 (full-bleed)`);
        }
      }

      if (state === "pause" || state === "settings") {
        const ribbon = await rectOf(page, ".marble-settings-card > .fab-modal-ribbon");
        const card = await rectOf(page, ".marble-settings-card");
        if (!ribbon) fail(state, "settings ribbon missing");
        if (!card) fail(state, "settings card missing");
        if (ribbon && card) {
          if (Math.abs(ribbon.cx - card.cx) < 6) ok(state, `ribbon horizontally centered (|dx|=${Math.abs(ribbon.cx - card.cx).toFixed(1)})`);
          else fail(state, `ribbon off-center (|dx|=${Math.abs(ribbon.cx - card.cx).toFixed(1)})`);
          if (ribbon.top < card.top + 2) ok(state, `ribbon top ${ribbon.top.toFixed(0)} overhangs card top ${card.top.toFixed(0)}`);
          else fail(state, `ribbon top ${ribbon.top.toFixed(0)} sits inside card top ${card.top.toFixed(0)}`);
          const cardCenterY = card.cy;
          if (Math.abs(cardCenterY - VIEWPORT.height / 2) < 120) ok(state, `card roughly vertically centered (cy=${cardCenterY.toFixed(0)})`);
          else fail(state, `card not vertically centered (cy=${cardCenterY.toFixed(0)})`);
        }
        if (state === "pause") {
          const restart = await rectOf(page, '[data-fab-action="settings-restart"]');
          const home = await rectOf(page, '[data-fab-action="settings-home"]');
          if (restart && restart.sprite.includes("Button_Orange")) ok(state, "Restart is the orange sprite");
          else fail(state, `Restart sprite wrong (${restart ? restart.sprite : "missing"})`);
          if (home && home.sprite.includes("Button_Green")) ok(state, "Home is the green sprite");
          else fail(state, `Home sprite wrong (${home ? home.sprite : "missing"})`);
        }
      }

      if (state === "win") {
        const rewardText = await rectOf(page, ".marble-reward-text");
        const coinRow = await rectOf(page, ".marble-reward-coinrow");
        const row = await rectOf(page, ".marble-reward-row");
        if (!rewardText || !coinRow) fail(state, "reward stack pieces missing");
        if (rewardText && coinRow) {
          if (rewardText.bottom <= coinRow.top + 2) ok(state, `REWARD word-art above coin row`);
          else fail(state, `REWARD word-art not above coin row (reward bottom ${rewardText.bottom.toFixed(0)}, coin top ${coinRow.top.toFixed(0)})`);
        }
        if (row) {
          const transparent = row.background === "rgba(0, 0, 0, 0)" || row.background === "transparent";
          if (transparent) ok(state, "reward row has no pill background");
          else fail(state, `reward row still has a background (${row.background})`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  preview.kill();
}
console.log(`\nevidence written to ${EVIDENCE_DIR}`);
console.log(failures ? `RESULT: FAIL (${failures})` : "RESULT: PASS");
process.exitCode = failures ? 1 : 0;
