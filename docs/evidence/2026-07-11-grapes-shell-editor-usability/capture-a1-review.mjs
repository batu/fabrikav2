import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const evidenceRoot = path.dirname(fileURLToPath(import.meta.url));
const reviewPath = path.join(evidenceRoot, "a1-review.html");
const screenshotRoot = path.join(evidenceRoot, "screenshots");
const videoRoot = path.join(evidenceRoot, "videos");
const temporaryVideoRoot = path.join(videoRoot, ".playwright");
const videoPath = path.join(videoRoot, "u3-v6-a1-flow.webm");
const manifestPath = path.join(evidenceRoot, "u3-v6-a1-capture.json");

const screenshotPaths = {
  opening: path.join(screenshotRoot, "u3-v6-a1-opening.png"),
  interaction: path.join(screenshotRoot, "u3-v6-a1-interaction.png"),
  slotSaved: path.join(screenshotRoot, "u3-v6-a1-slot-saved.png"),
  decision: path.join(screenshotRoot, "u3-v6-a1-decision.png"),
};

await mkdir(screenshotRoot, { recursive: true });
await mkdir(temporaryVideoRoot, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: temporaryVideoRoot, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
const video = page.video();
const externalRequests = [];
const consoleErrors = [];
const pageErrors = [];

page.on("request", (request) => {
  const protocol = new URL(request.url()).protocol;
  if (!["file:", "data:", "blob:"].includes(protocol)) externalRequests.push(request.url());
});
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));

await page.goto(pathToFileURL(reviewPath).href, { waitUntil: "load" });
await page.waitForSelector(".editor-shell");
await page.waitForFunction(() => window.__FABRIKAV2_GRAPES_SHELL_EDITOR__ !== undefined);
await page.waitForTimeout(350);

await page.screenshot({ path: screenshotPaths.opening, animations: "disabled", caret: "hide" });

for (const pageName of ["Gameplay and HUD", "Settings", "Pause", "Win", "Fail", "Progression Home"]) {
  await page.getByRole("button", { name: pageName, exact: true }).click();
  await page.waitForTimeout(350);
}

await page.getByRole("button", { name: "Settings", exact: true }).click();
await page.locator('.editor-layer-button[data-instance-id="settings.music"]').click();
await page.waitForTimeout(450);
await page.screenshot({ path: screenshotPaths.interaction, animations: "disabled", caret: "hide" });

await page.getByRole("button", { name: "Progression Home", exact: true }).click();
await page.locator('.editor-layer-button[data-instance-id="menu.settings"]').click();
await page.waitForTimeout(350);
const replacementAsset = page.locator(".editor-asset-card").filter({ hasText: "Icon Control Confirm" });
await replacementAsset.click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Save browser draft", exact: true }).click();
await page.waitForTimeout(350);
await replacementAsset.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: screenshotPaths.slotSaved, animations: "disabled", caret: "hide" });

const snapshot = await page.evaluate(() => window.__FABRIKAV2_GRAPES_SHELL_EDITOR__.getValidatedSnapshot());
if (snapshot.status !== "saved-unpublished") {
  throw new Error(`Expected saved-unpublished snapshot, received ${snapshot.status}.`);
}

await page.getByRole("button", { name: "Review A1 checkpoint", exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: screenshotPaths.decision, animations: "disabled", caret: "hide" });
await page.waitForTimeout(500);

const reviewSource = await readFile(reviewPath, "utf8");
const privatePatterns = [
  /\/Users\//u,
  /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/iu,
  /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/u,
  /\b192\.168\.\d{1,3}\.\d{1,3}\b/u,
  /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/u,
  /\bR6[A-Z0-9]{8,}\b/u,
];
const privatePatternMatches = privatePatterns.filter((pattern) => pattern.test(reviewSource)).map(String);

await context.close();
if (!video) throw new Error("Playwright did not create a video handle.");
const temporaryVideoPath = await video.path();
await video.saveAs(videoPath);
if (temporaryVideoPath !== videoPath) await rm(temporaryVideoPath, { force: true });
await rm(temporaryVideoRoot, { recursive: true, force: true });
await browser.close();

const manifest = {
  schema: "fabrikav2-grapes-shell-a1-capture-v1",
  sourceCommits: ["c142f286", "2f5ed0a2"],
  viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  reviewedState: {
    status: snapshot.status,
    targetGame: snapshot.project.targetGame,
    pageCount: snapshot.project.presentation.pages.length,
    projectHash: snapshot.projectHash,
    assetCatalogHash: snapshot.assetCatalogHash,
  },
  interaction: {
    pagesVisited: ["menu", "gameplay", "settings", "pause", "win", "fail"],
    selectedInstance: "menu.settings",
    installedAsset: "icon-control.confirm",
    decisionSubmitted: false,
  },
  evidence: {
    screenshots: Object.fromEntries(Object.entries(screenshotPaths).map(([key, value]) => [key, path.relative(evidenceRoot, value)])),
    video: path.relative(evidenceRoot, videoPath),
  },
  isolation: {
    externalRequestCount: externalRequests.length,
    consoleErrors,
    pageErrors,
    privatePatternMatches,
  },
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

if (externalRequests.length > 0) throw new Error(`Unexpected external requests: ${externalRequests.join(", ")}`);
if (consoleErrors.length > 0 || pageErrors.length > 0) throw new Error("Browser errors occurred during the A1 capture.");
if (privatePatternMatches.length > 0) throw new Error("The A1 artifact contains a private path, internal URL, or device-like identifier.");

process.stdout.write(`${manifestPath}\n`);
