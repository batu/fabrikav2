import { expect, test, type Page } from "@playwright/test";

interface ActionSnapshot {
  readonly actionId: string;
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
  readonly rendererProfile: string;
  readonly revision: string | null;
  readonly sentinel: string | null;
  readonly actions: readonly ActionSnapshot[];
}

interface PhaserTestGlobals {
  readonly __SHELL_PROOF_PHASER_HARNESS__: {
    driveTo(state: string): Promise<boolean>;
    snapshot(): { readonly surface: string; readonly rewardClaimed: boolean };
  };
  readonly __SHELL_PROOF_PHASER_EVIDENCE_PROBE__: { snapshot(): ProbeSnapshot };
}

async function probe(page: Page): Promise<ProbeSnapshot> {
  return page.evaluate(() => (globalThis as unknown as PhaserTestGlobals).__SHELL_PROOF_PHASER_EVIDENCE_PROBE__.snapshot());
}

async function clickAction(page: Page, actionId: string): Promise<void> {
  const action = await page.waitForFunction(
    (wanted) => (globalThis as unknown as PhaserTestGlobals).__SHELL_PROOF_PHASER_EVIDENCE_PROBE__
      .snapshot().actions.find((entry) => entry.actionId === wanted && entry.visible && !entry.disabled) ?? false,
    actionId,
  ).then((handle) => handle.jsonValue() as Promise<ActionSnapshot>);
  expect(action, `${actionId} must exist`).toBeDefined();
  expect(action?.visible, `${actionId} must be visible`).toBe(true);
  expect(action?.disabled, `${actionId} must be enabled`).toBe(false);
  await page.mouse.click(
    (action?.x ?? 0) + (action?.width ?? 0) / 2,
    (action?.y ?? 0) + (action?.height ?? 0) / 2,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((globalThis as unknown as PhaserTestGlobals).__SHELL_PROOF_PHASER_HARNESS__));
  await page.waitForFunction(() => {
    const snapshot = (globalThis as unknown as PhaserTestGlobals).__SHELL_PROOF_PHASER_EVIDENCE_PROBE__.snapshot();
    return snapshot.state === "menu" && snapshot.ready;
  });
});

test("renders every shell state from the selected Phaser projection", async ({ page }) => {
  for (const state of ["menu", "level", "shop", "settings", "pause", "win", "fail"]) {
    await expect(page.evaluate((next) => (globalThis as unknown as PhaserTestGlobals).__SHELL_PROOF_PHASER_HARNESS__.driveTo(next), state)).resolves.toBe(true);
    await page.waitForFunction(
      (next) => {
        const snapshot = (globalThis as unknown as PhaserTestGlobals).__SHELL_PROOF_PHASER_EVIDENCE_PROBE__.snapshot();
        return snapshot.state === next && snapshot.ready;
      },
      state,
    );
    await expect(probe(page)).resolves.toMatchObject({
      state,
      ready: true,
      rendererProfile: "phaser-native",
      revision: "sha256-42f2a6ef36c7cde7dcd3a759a32832f786e346751091c8a12e09f6538f61c4ea",
      sentinel: "42f2a6ef",
    });
  }
});

test("reconciles the real Claim to Next interaction", async ({ page }) => {
  await page.evaluate(() => (globalThis as unknown as PhaserTestGlobals).__SHELL_PROOF_PHASER_HARNESS__.driveTo("level"));
  await page.waitForFunction(() => {
    const snapshot = (globalThis as unknown as PhaserTestGlobals).__SHELL_PROOF_PHASER_EVIDENCE_PROBE__.snapshot();
    return snapshot.state === "level" && snapshot.ready;
  });
  await page.evaluate(() => (globalThis as unknown as PhaserTestGlobals).__SHELL_PROOF_PHASER_HARNESS__.driveTo("win"));
  await page.waitForFunction(() => {
    const snapshot = (globalThis as unknown as PhaserTestGlobals).__SHELL_PROOF_PHASER_EVIDENCE_PROBE__.snapshot();
    return snapshot.state === "win" && snapshot.ready && snapshot.actions.some((action) => action.actionId === "claim");
  });
  await clickAction(page, "claim");
  await page.waitForFunction(() => {
    const globals = globalThis as unknown as PhaserTestGlobals;
    return globals.__SHELL_PROOF_PHASER_HARNESS__.snapshot().rewardClaimed
      && globals.__SHELL_PROOF_PHASER_EVIDENCE_PROBE__.snapshot().actions.some(
        (action) => action.actionId === "next" && action.visible && !action.disabled,
      );
  });

  const postClaim = await probe(page);
  const claimedAction = postClaim.actions.find((entry) => entry.actionId === "claim");
  expect(claimedAction === undefined || (!claimedAction.visible && claimedAction.disabled)).toBe(true);
  expect(postClaim.actions.find((entry) => entry.actionId === "next")).toMatchObject({ visible: true, disabled: false });
  expect(postClaim.actions.find((entry) => entry.actionId === "result-home")).toMatchObject({ visible: true, disabled: false });

  await clickAction(page, "next");
  await page.waitForFunction(() => (globalThis as unknown as PhaserTestGlobals).__SHELL_PROOF_PHASER_HARNESS__.snapshot().surface === "level");
});
