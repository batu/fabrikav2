import { test, expect } from "@playwright/test";

interface ActionRect {
  readonly actionId: string;
  readonly instanceId: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
  readonly disabled: boolean;
}

interface ProbeSnapshot {
  readonly state: string;
  readonly ready: boolean;
  readonly actions: readonly ActionRect[];
}

declare global {
  interface Window {
    __SHELL_PROOF_PHASER_EVIDENCE_PROBE__?: { snapshot(): ProbeSnapshot };
  }
}

async function snapshot(page: import("@playwright/test").Page): Promise<ProbeSnapshot> {
  return page.evaluate(() => window.__SHELL_PROOF_PHASER_EVIDENCE_PROBE__!.snapshot());
}

async function waitForState(page: import("@playwright/test").Page, state: string): Promise<ProbeSnapshot> {
  await page.waitForFunction((expected) => {
    const value = window.__SHELL_PROOF_PHASER_EVIDENCE_PROBE__?.snapshot();
    return value?.state === expected && value.ready;
  }, state);
  return snapshot(page);
}

function liveAction(value: ProbeSnapshot, actionId: string): ActionRect {
  const action = value.actions.find((candidate) =>
    candidate.actionId === actionId && candidate.visible && !candidate.disabled,
  );
  expect(action, `missing live ${actionId} action in ${value.state}`).toBeDefined();
  return action!;
}

async function tapAction(page: import("@playwright/test").Page, value: ProbeSnapshot, actionId: string): Promise<void> {
  const action = liveAction(value, actionId);
  await page.mouse.click(action.x + action.width / 2, action.y + action.height / 2);
}

function expectSameRect(actual: ActionRect, expected: ActionRect): void {
  expect(actual.x).toBeCloseTo(expected.x, 3);
  expect(actual.y).toBeCloseTo(expected.y, 3);
  expect(actual.width).toBeCloseTo(expected.width, 3);
  expect(actual.height).toBeCloseTo(expected.height, 3);
}

function overlaps(left: ActionRect, right: ActionRect): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

// Manual diagnostic only: browser proof is never a substitute for later device
// verification. It keeps a real rendered input path available when needed.
test("boots Progression Home and starts the current level through the Phaser hit area", async ({ page }) => {
  await page.goto("/");
  const menu = await waitForState(page, "menu");
  await tapAction(page, menu, "start-current");
  await expect.poll(async () => (await snapshot(page)).state).toBe("level");
});

test("drives four distinct Phaser beats through live action rectangles", async ({ page }) => {
  await page.goto("/");

  const menu = await waitForState(page, "menu");
  const menuFrame = await page.screenshot();
  await tapAction(page, menu, "start-current");

  const level = await waitForState(page, "level");
  const levelFrame = await page.screenshot();
  await tapAction(page, level, "test-win");

  const winPreclaim = await waitForState(page, "win");
  const claim = liveAction(winPreclaim, "claim");
  const claimDouble = liveAction(winPreclaim, "claim-double");
  expect(winPreclaim.actions.filter((action) =>
    ["next", "result-home"].includes(action.actionId) && action.visible,
  )).toHaveLength(0);
  const winPreclaimFrame = await page.screenshot();
  await tapAction(page, winPreclaim, "claim");

  await page.waitForFunction(() => {
    const value = window.__SHELL_PROOF_PHASER_EVIDENCE_PROBE__?.snapshot();
    return value?.state === "win"
      && value.ready
      && value.actions.some((action) => action.actionId === "next" && action.visible && !action.disabled);
  });
  const winPostclaim = await snapshot(page);
  const next = liveAction(winPostclaim, "next");
  const home = liveAction(winPostclaim, "result-home");
  const winPostclaimFrame = await page.screenshot();

  expectSameRect(next, claim);
  expectSameRect(home, claimDouble);
  expect(overlaps(next, home)).toBe(false);
  expect(winPostclaim.actions.filter((action) =>
    ["claim", "claim-double"].includes(action.actionId) && action.visible,
  )).toHaveLength(0);

  const frames = [menuFrame, levelFrame, winPreclaimFrame, winPostclaimFrame]
    .map((frame) => frame.toString("base64"));
  expect(new Set(frames).size).toBe(4);
});
