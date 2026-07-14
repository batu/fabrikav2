import { execFileSync } from "node:child_process";
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
  cleanPreview: path.join(screenshotRoot, "u3-v6-a1-clean-preview.png"),
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

// Clean preview: hide the editor overlays and unfilled optional art so the phone
// reads as an authored game, not an authoring slot map. Capture it, then return
// to the author view where the representative edits are performed.
await page.getByRole("button", { name: "Clean preview", exact: true }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: screenshotPaths.cleanPreview, animations: "disabled", caret: "hide" });
await page.getByRole("button", { name: "Author", exact: true }).click();
await page.waitForTimeout(300);

for (const pageName of ["Gameplay and HUD", "Settings", "Pause", "Win", "Fail", "Progression Home"]) {
  await page.getByRole("button", { name: pageName, exact: true }).click();
  await page.waitForTimeout(350);
}

await page.getByRole("button", { name: "Settings", exact: true }).click();
await page.locator('.editor-layer-button[data-instance-id="settings.music"]').click();
await page.waitForTimeout(450);
await page.screenshot({ path: screenshotPaths.interaction, animations: "disabled", caret: "hide" });

// Compatible asset replacement: restyle the Back button from the primary to the
// secondary action surface. Both rasters live in the button-surface slot, so the
// swap changes emphasis without ever putting a wrong icon on a labelled control.
await page.locator('.editor-layer-button[data-instance-id="settings.back"]').click();
await page.waitForTimeout(350);
const replacementAsset = page.locator(".editor-asset-card").filter({ hasText: "Secondary action surface" });
await replacementAsset.click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Save browser draft", exact: true }).click();
await page.waitForTimeout(350);
await replacementAsset.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: screenshotPaths.slotSaved, animations: "disabled", caret: "hide" });

const inspectorMetrics = await page.locator(".editor-inspector").evaluate((inspector) => {
  const previousScrollTop = inspector.scrollTop;
  const maxScrollTop = inspector.scrollHeight - inspector.clientHeight;
  inspector.scrollTop = maxScrollTop;
  const inspectorBounds = inspector.getBoundingClientRect();
  const lastChildBounds = inspector.lastElementChild?.getBoundingClientRect();
  const lastVisibleAtBottom = lastChildBounds !== undefined
    && lastChildBounds.top >= inspectorBounds.top - 1
    && lastChildBounds.bottom <= inspectorBounds.bottom + 1;
  inspector.scrollTop = previousScrollTop;
  return {
    clientHeight: inspector.clientHeight,
    scrollHeight: inspector.scrollHeight,
    maxScrollTop,
    lastVisibleAtBottom,
  };
});
if (inspectorMetrics.maxScrollTop <= 0 || !inspectorMetrics.lastVisibleAtBottom) {
  throw new Error("The constrained inspector does not expose a reachable overflow region at 1440x900.");
}

const constraintStyleMetrics = await page.evaluate(() => {
  const compact = document.querySelector(".editor-locked-note--compact");
  const publication = document.querySelector(".editor-publication-state");
  if (!compact || !publication) throw new Error("Expected constraint and publication-state elements.");
  const compactStyle = getComputedStyle(compact);
  const publicationStyle = getComputedStyle(publication);
  return {
    compactBackground: compactStyle.backgroundColor,
    compactBorder: compactStyle.borderLeftColor,
    publicationBackground: publicationStyle.backgroundColor,
    publicationBorder: publicationStyle.borderLeftColor,
  };
});
if (
  constraintStyleMetrics.compactBackground === constraintStyleMetrics.publicationBackground
  || constraintStyleMetrics.compactBorder === constraintStyleMetrics.publicationBorder
) {
  throw new Error("Read-only constraint notes still reuse the publication-warning treatment.");
}

const snapshot = await page.evaluate(() => window.__FABRIKAV2_GRAPES_SHELL_EDITOR__.getValidatedSnapshot());
if (snapshot.status !== "saved-unpublished") {
  throw new Error(`Expected saved-unpublished snapshot, received ${snapshot.status}.`);
}

await page.getByRole("button", { name: "Review A1 checkpoint", exact: true }).click();
await page.waitForTimeout(500);
const decisionStyleMetrics = await page.evaluate(() => {
  const accept = document.querySelector('[data-decision="accepted"]');
  const reject = document.querySelector('[data-decision="rejected"]');
  if (!(accept instanceof HTMLButtonElement) || !(reject instanceof HTMLButtonElement)) {
    throw new Error("Expected A1 decision buttons.");
  }
  const acceptStyle = getComputedStyle(accept);
  const rejectStyle = getComputedStyle(reject);
  return {
    acceptDisabled: accept.disabled,
    rejectDisabled: reject.disabled,
    acceptBackground: acceptStyle.backgroundColor,
    acceptBorder: acceptStyle.borderColor,
    rejectBackground: rejectStyle.backgroundColor,
    rejectBorder: rejectStyle.borderColor,
  };
});
if (
  !decisionStyleMetrics.acceptDisabled
  || !decisionStyleMetrics.rejectDisabled
  || decisionStyleMetrics.acceptBackground === decisionStyleMetrics.rejectBackground
  || decisionStyleMetrics.acceptBorder === decisionStyleMetrics.rejectBorder
) {
  throw new Error("Disabled A1 decisions do not retain distinct positive and destructive semantics.");
}
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

let headCommit = "unknown";
try {
  headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.resolve(evidenceRoot, "../../.."), encoding: "utf8" }).trim();
} catch {
  headCommit = "unknown";
}

const manifest = {
  schema: "fabrikav2-grapes-shell-a1-capture-v1",
  sourceCommits: [headCommit],
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
    cleanPreviewExercised: true,
    selectedInstance: "settings.back",
    installedAsset: "button-surface.secondary",
    decisionSubmitted: false,
  },
  visualAssertions: {
    inspector: inspectorMetrics,
    constraintStyles: constraintStyleMetrics,
    decisionStyles: decisionStyleMetrics,
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
