// Loopback-only workbench client for the provenance leg (P6 §6/§10). Drives the
// editor's OWN surfaces (workbench command manager, file tree) in a headless
// Chromium page whose network is ROUTE-BLOCKED to loopback only — any non-127.0.0.1
// request is aborted, so the GUI session cannot reach the network. This never
// touches auth material; it only invokes CompileProject and open/save. Regeneration
// happens exclusively here (the scene compiler lives in the browser client — U2
// finding 2). Chromium comes from this workspace's declared `@playwright/test`
// (the render-proof spec's driver), loaded as a dynamic import so the module
// stays loadable without a browser installed — no new dependency, lock unchanged.
import type { Browser, Page } from '@playwright/test';
import process from 'node:process';

/** Workbench command ids (carried from the U2 editor-session driver). */
const CMD = {
  compileProject: 'phasereditor2d.ide.ui.actions.CompileProject',
} as const;

export class WorkbenchBlocked extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkbenchBlocked';
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export interface Workbench {
  browser: Browser;
  page: Page;
}

/**
 * Launch headless Chromium, route-block every non-loopback request, open the
 * editor workbench over 127.0.0.1, and wait until it is active.
 */
export async function openWorkbench(port: number): Promise<Workbench> {
  let chromium: typeof import('@playwright/test').chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    throw new WorkbenchBlocked('browser-driver-missing', 'the Chromium driver (@playwright/test) is unavailable');
  }
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath });
  } catch {
    throw new WorkbenchBlocked('browser-launch-failed', 'a headless Chromium could not be launched');
  }
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  // Route-block non-loopback: the GUI session is outbound-blocked except 127.0.0.1.
  await context.route('**/*', (route) => {
    let host = '';
    try {
      host = new URL(route.request().url()).hostname;
    } catch {
      /* malformed → block */
    }
    if (LOOPBACK_HOSTS.has(host)) return void route.continue();
    return void route.abort();
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/editor/`, { waitUntil: 'load' });
  await page.waitForFunction(
    'Boolean(globalThis.colibri?.Platform?.getWorkbench?.()?.getActiveWindow?.())',
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(3_000); // project scan / part restore
  return { browser, page };
}

/** Execute a workbench command by id. */
async function exec(page: Page, commandId: string): Promise<void> {
  await page.evaluate(
    `globalThis.colibri.Platform.getWorkbench().getCommandManager().executeCommand(${JSON.stringify(commandId)}, false)`,
  );
}

/** Invoke the Workbench CompileProject action (regenerates the graph on disk). */
export async function compileProject(page: Page): Promise<void> {
  await exec(page, CMD.compileProject);
}

/**
 * Open a scene by file name, wait until it is the active editor, save it, then
 * close it. Used to open + save all seven scenes in canonical order.
 */
export async function openAndSaveScene(page: Page, sceneFileName: string): Promise<void> {
  const literal = JSON.stringify(sceneFileName);
  await page.evaluate(
    `(() => {
      const FileUtils = globalThis.colibri.ui.ide.FileUtils;
      const root = FileUtils.getRoot();
      const find = (f) => {
        if (f.getName() === ${literal}) return f;
        for (const c of (f.getFiles?.() ?? [])) { const hit = find(c); if (hit) return hit; }
        return null;
      };
      const file = find(root);
      if (!file) throw new Error('scene not found: ' + ${literal});
      globalThis.colibri.Platform.getWorkbench().openEditor(file);
    })()`,
  );
  await page.waitForFunction(
    `globalThis.colibri.Platform.getWorkbench().getActiveEditor()?.getInput?.()?.getName?.() === ${literal}`,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(1_500); // textures load async
  // Address the opened editor directly. The generic Save command can receive
  // a transient null `activeEditor` while the Scene Editor finishes restoring,
  // even after the input-name wait has passed (observed in Editor 5.0.2).
  await page.evaluate(
    `(async () => {
      const wb = globalThis.colibri.Platform.getWorkbench();
      const editor = wb.getEditors().find((candidate) =>
        candidate.getInput?.()?.getName?.() === ${literal});
      if (!editor) throw new Error('opened scene editor disappeared: ' + ${literal});
      await editor.save();
      wb.getActiveWindow().getEditorArea().closeEditors([editor]);
    })()`,
  );
  await page.waitForTimeout(500);
}

/** Close the browser (best-effort). */
export async function closeWorkbench(wb: Workbench | null): Promise<void> {
  if (!wb) return;
  try {
    await wb.browser.close();
  } catch {
    /* already gone */
  }
}
