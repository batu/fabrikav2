// MRV2-15: built-dist headless acceptance for final home/settings parity.
// Run from games/marble_run; this script builds the harness-enabled dist first.
/* global process, getComputedStyle */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const PORT = Number(process.env.PREVIEW_PORT ?? 4173);
const EVIDENCE_DIR = join(process.cwd(), "evidence", "mrv2-15");
let failures = 0;

function fail(state, message) {
  console.error(`FAIL [${state}]: ${message}`);
  failures += 1;
}

function ok(state, message) {
  console.log(`  ok [${state}]: ${message}`);
}

async function buildDist() {
  await new Promise((resolve, reject) => {
    const build = spawn("npm", ["run", "build"], {
      cwd: process.cwd(),
      env: { ...process.env, VITE_ENABLE_TEST_HARNESS: "true" },
      stdio: "inherit",
    });
    build.on("error", reject);
    build.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`harness-enabled build failed (${code})`));
    });
  });
}

async function reach(page, state) {
  await page.goto(`http://localhost:${PORT}/?insituTour=${state}`);
  await page.waitForSelector(
    `body[data-tour-state="${state}"], body[data-tour-state="${state}-DONE"]`,
    { timeout: 45000 },
  );
  await page.waitForTimeout(600);
}

async function homeGeometry(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("#home-shell .fab-levelmap-node"));
    const actions = document.querySelector(".marble-ui .fab-home-menu-actions");
    if (nodes.length === 0 || actions === null) return null;
    const tail = nodes.reduce((lowest, node) =>
      node.getBoundingClientRect().bottom > lowest.getBoundingClientRect().bottom ? node : lowest);
    const node = tail.getBoundingClientRect();
    const button = actions.getBoundingClientRect();
    return { nodeTop: node.top, nodeBottom: node.bottom, buttonTop: button.top, clearance: button.top - node.bottom };
  });
}

async function checkHome(browser, viewport, filename, minimumClearance) {
  const state = filename.replace(".png", "");
  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    await reach(page, "home-fresh");
    await page.screenshot({ path: join(EVIDENCE_DIR, filename) });
    const geometry = await homeGeometry(page);
    if (geometry === null) {
      fail(state, "sun node or LEVEL action missing");
      return;
    }
    if (geometry.nodeTop >= 0 && geometry.nodeBottom <= viewport.height) ok(state, "sun node fully in viewport");
    else fail(state, `sun node clipped (${geometry.nodeTop.toFixed(1)}..${geometry.nodeBottom.toFixed(1)})`);
    if (geometry.clearance >= minimumClearance) ok(state, `sun clearance ${geometry.clearance.toFixed(1)}px >= ${minimumClearance}px`);
    else fail(state, `sun clearance ${geometry.clearance.toFixed(1)}px < ${minimumClearance}px`);
  } finally {
    await context.close();
  }
}

async function checkSettings(browser, state) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await reach(page, state);
    await page.screenshot({ path: join(EVIDENCE_DIR, `${state}.png`) });
    const result = await page.evaluate(() => {
      const root = document.querySelector(".fab-modal-backdrop");
      const ribbon = document.querySelector(".marble-settings-card > .fab-modal-ribbon");
      const title = document.querySelector(".marble-settings-card .fab-modal-ribbon-title");
      if (root === null || ribbon === null || title === null) return null;
      const rr = ribbon.getBoundingClientRect();
      const tr = title.getBoundingClientRect();
      const background = getComputedStyle(root).backgroundColor;
      const alphaMatch = background.match(/^rgba?\([^)]*(?:,\s*([\d.]+))?\)$/);
      return {
        titleDelta: Math.abs((tr.left + tr.width / 2) - (rr.left + rr.width / 2)),
        background,
        alpha: background.startsWith("rgb(") ? 1 : Number(alphaMatch?.[1] ?? 0),
        menu: root.classList.contains("marble-settings-modal--menu"),
        ingame: root.classList.contains("marble-settings-modal--ingame"),
      };
    });
    if (result === null) {
      fail(state, "modal root, ribbon, or title missing");
      return;
    }
    if (result.titleDelta < 6) ok(state, `title centered (|dx|=${result.titleDelta.toFixed(1)}px)`);
    else fail(state, `title off-center (|dx|=${result.titleDelta.toFixed(1)}px)`);
    if (state === "settings") {
      if (result.menu && !result.ingame) ok(state, "menu variant hook present");
      else fail(state, `wrong variant hooks (menu=${result.menu}, ingame=${result.ingame})`);
      if (result.alpha === 1 && result.background === "rgb(0, 0, 0)") ok(state, "backdrop is opaque black");
      else fail(state, `backdrop is ${result.background} (alpha ${result.alpha})`);
    } else if (result.ingame && !result.menu && result.alpha < 1) {
      ok(state, `in-game backdrop remains dim (${result.background})`);
    } else {
      fail(state, `in-game backdrop/variant regressed (${result.background}, menu=${result.menu}, ingame=${result.ingame})`);
    }
  } finally {
    await context.close();
  }
}

await buildDist();

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
    await checkHome(browser, { width: 390, height: 844 }, "home-fresh.png", 16);
    await checkHome(browser, { width: 390, height: 780 }, "home-fresh-390x780.png", 0);
    await checkSettings(browser, "settings");
    await checkSettings(browser, "pause");
  } finally {
    await browser.close();
  }
} finally {
  preview.kill();
}

console.log(`\nevidence written to ${EVIDENCE_DIR}`);
console.log(failures ? `RESULT: FAIL (${failures})` : "RESULT: PASS");
process.exitCode = failures ? 1 : 0;
