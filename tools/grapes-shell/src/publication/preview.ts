import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { ShellStateIdV2 } from "@fabrikav2/kernel";

import type { PreviewRenderer } from "./publisher.ts";

const NETWORK_URL = /^https?:\/\//iu;
const FORBIDDEN_PORTABLE_CONTENT = /<script\b|\s(?:on[a-z]+|style)\s*=|(?:javascript|data|blob|https?)\s*:/iu;
const CANVAS_WIDTH = 390;
const CANVAS_HEIGHT = 844;

function assertPortableHtml(html: string, stateId: ShellStateIdV2): void {
  if (FORBIDDEN_PORTABLE_CONTENT.test(html)) {
    throw new Error(`Portable ${stateId} page contains executable or networked content.`);
  }
  if (!html.includes(`data-shell-page="${stateId}"`) || !html.includes('data-render-ready="true"')) {
    throw new Error(`Portable ${stateId} page is missing its render barrier.`);
  }
}

export const renderPortablePreviews: PreviewRenderer = async ({ portableDirectory, states }) => {
  await Promise.all(
    states.map(async (stateId) => assertPortableHtml(
      await readFile(path.join(portableDirectory, `${stateId}.html`), "utf8"),
      stateId,
    )),
  );

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  const networkRequests: string[] = [];
  try {
    const context = await browser.newContext({
      viewport: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      deviceScaleFactor: 1,
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      await page.route("**/*", async (route) => {
        const url = route.request().url();
        if (NETWORK_URL.test(url)) {
          networkRequests.push(url);
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      });
      const pages: Array<{ stateId: ShellStateIdV2; bytes: Uint8Array }> = [];
      const browserViolations: string[] = [];
      page.on("console", (message) => {
        if (/content security policy|refused to/iu.test(message.text())) browserViolations.push(message.text());
      });
      page.on("pageerror", (error) => browserViolations.push(error.message));
      for (const stateId of states) {
        await page.goto(pathToFileURL(path.join(portableDirectory, `${stateId}.html`)).href, { waitUntil: "load" });
        await page.waitForSelector(`[data-shell-page="${stateId}"][data-render-ready="true"]`);
        await page.evaluate(async () => {
          await document.fonts.ready;
          if (document.querySelector("script") !== null) throw new Error("Portable page contains a script element.");
          await Promise.all([...document.images].map((image) => image.decode()));
          for (const instance of document.querySelectorAll<HTMLElement>("[data-shell-instance]")) {
            const style = getComputedStyle(instance);
            if (style.position !== "absolute" || style.left === "auto" || style.top === "auto") {
              throw new Error(`Portable instance ${instance.dataset.shellInstance ?? "unknown"} has unresolved layout.`);
            }
          }
        });
        pages.push({ stateId, bytes: await page.screenshot({ type: "png", animations: "disabled" }) });
      }
      if (networkRequests.length > 0) {
        throw new Error(`Portable renderer blocked unexpected network requests: ${networkRequests.join(", ")}`);
      }
      if (browserViolations.length > 0) {
        throw new Error(`Portable renderer observed browser safety violations: ${browserViolations.join(" | ")}`);
      }
      return {
        fingerprint: {
          renderer: `playwright-chromium-${browser.version()}`,
          fonts: "ui-rounded-system-ui-local-v1",
          deviceScaleFactor: 1,
          animations: "disabled",
          loadBarrier: "portable-html-safety-images-fonts-and-render-marker",
          encoder: "playwright-png",
        },
        pages,
      };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
};
