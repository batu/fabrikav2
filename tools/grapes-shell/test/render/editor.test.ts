import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

interface EditorProject {
  presentation: {
    pages: Array<{
      stateId: string;
      instances: Array<{
        id: string;
        prototypeInstanceId: string;
        presentation: {
          copy?: string;
          geometry: {
            offset: { x: number; y: number };
            size: { width: number; height: number };
          };
        };
      }>;
    }>;
  };
}

describe("constrained editor pointer workflow", () => {
  let server: ViteDevServer;
  let browser: Browser;
  let editorUrl: string;

  beforeAll(async () => {
    server = await createServer({
      root: workspaceRoot,
      configFile: false,
      server: { host: "127.0.0.1", port: 0, strictPort: false },
    });
    await server.listen();
    editorUrl = server.resolvedUrls?.local[0] ?? "";
    if (!editorUrl) throw new Error("Vite did not expose a local editor URL.");
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  async function project(page: Page): Promise<EditorProject> {
    return page.evaluate(() => window.__FABRIKAV2_GRAPES_SHELL_EDITOR__!.getValidatedProject()) as Promise<EditorProject>;
  }

  async function instance(page: Page, id: string) {
    const current = await project(page);
    return current.presentation.pages.flatMap((item) => item.instances).find((item) => item.id === id)!;
  }

  it("persists resize, drag, live copy, duplication, and Shop through a browser save/reload", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const unexpectedConsoleErrors: string[] = [];
    const offOriginRequests: string[] = [];
    page.on("console", (message) => {
      const value = message.text();
      const expectedDevSocketBlock = value.includes("ws://") && value.includes("connect-src 'none'");
      if (message.type() === "error" && !expectedDevSocketBlock) unexpectedConsoleErrors.push(value);
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== new URL(editorUrl).origin) {
        offOriginRequests.push(request.url());
      }
    });
    await page.goto(editorUrl, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__FABRIKAV2_GRAPES_SHELL_EDITOR__));

    const canvas = page.frameLocator("iframe.gjs-frame");
    const play = canvas.locator('[data-semantic-instance="menu.play"]');
    await play.click();
    const resizeHandle = page.locator(".gjs-resizer-h-br");
    await resizeHandle.waitFor({ state: "visible" });
    const resizeBefore = (await instance(page, "menu.play")).presentation.geometry;
    const handleBox = await resizeHandle.boundingBox();
    if (!handleBox) throw new Error("Resize handle has no rendered bounds.");
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 10, handleBox.y + handleBox.height / 2 + 8, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await instance(page, "menu.play")).presentation.geometry.size.width).toBeGreaterThan(
      resizeBefore.size.width,
    );

    await canvas.locator('[data-semantic-instance="menu.title"]').click();
    await play.click();
    const dragBefore = (await instance(page, "menu.play")).presentation.geometry;
    const dragBox = await play.boundingBox();
    if (!dragBox) throw new Error("menu.play has no rendered bounds.");
    await page.mouse.move(dragBox.x + 12, dragBox.y + 12);
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.move(dragBox.x + 26, dragBox.y + 4, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => (await instance(page, "menu.play")).presentation.geometry.offset.x).not.toBe(
      dragBefore.offset.x,
    );

    await page.locator('[data-instance-id="menu.title"]').click();
    const copy = page.getByLabel("Copy");
    await copy.fill("Live title");
    await copy.pressSequentially("!", { delay: 20 });
    expect(await copy.inputValue()).toBe("Live title!");
    await canvas.locator('[data-semantic-instance="menu.title"] [data-semantic-copy]').getByText("Live title!").waitFor();

    await page.locator('[data-instance-id="menu.currency"]').click();
    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    expect((await instance(page, "menu.currency.copy-1")).prototypeInstanceId).toBe("menu.currency");

    await page.getByRole("button", { name: "Shop", exact: true }).click();
    await canvas.locator('[data-editor-page="shop"]').waitFor();
    await page.getByRole("button", { name: "Save browser draft", exact: true }).click();
    const saved = await project(page);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__FABRIKAV2_GRAPES_SHELL_EDITOR__));
    expect(await project(page)).toEqual(saved);

    expect(unexpectedConsoleErrors).toEqual([]);
    expect(offOriginRequests).toEqual([]);
    await page.close();
  });
});
