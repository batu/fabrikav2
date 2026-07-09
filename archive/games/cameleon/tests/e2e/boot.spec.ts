import { test, expect } from "@playwright/test";

// Manual browser diagnostic. Worker close-out uses unit/type/audit plus device
// verification in the later pipeline stage; this remains directly runnable.
test("boots and shows the Cameleon canvas shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#app .cameleon-screen__canvas")).toBeVisible();
});
