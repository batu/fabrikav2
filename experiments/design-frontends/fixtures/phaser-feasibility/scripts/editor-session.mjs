// Drives a real Phaser Editor 5 workbench session for the GUI evidence legs
// (plan U2/U3): the local, human-authenticated editor server plus a Chromium
// page running the actual workbench client. This script only automates the
// editor's own surfaces (HTTP API, workbench commands, DOM inspector fields);
// it never touches auth material. Each recorded step is hash-bracketed via
// session-snapshot.mjs so observations bind to committed project bytes.
//
//   node scripts/editor-session.mjs <step> [--port 19591] [--headed]
//
// Steps: probe | compile | save-reopen | duplicate | retarget-duplicate |
//        live-typing | live-typing-plugin
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { fixtureRoot, sha256File } from "./lib.mjs";

const SERVER_BIN =
  process.env.PHASER_EDITOR_SERVER ??
  "/Applications/Phaser Editor 5.app/Contents/Resources/app/server/PhaserEditor";

const CMD = {
  compileProject: "phasereditor2d.ide.ui.actions.CompileProject",
  save: "colibri.ui.ide.actions.Save",
  editorClose: "colibri.ui.ide.actions.EditorClose",
  duplicateObject: "phasereditor2d.scene.ui.editor.commands.DuplicateObject",
};

const args = process.argv.slice(2);
const step = args[0];
const portFlag = args.indexOf("--port");
const port = portFlag >= 0 ? Number(args[portFlag + 1]) : 19591;
const headed = args.includes("--headed");

const projectDir = join(fixtureRoot, "editor-project");
const scenePath = join(projectDir, "src", "scenes", "Probe.scene");
const generatedScenePath = join(projectDir, "src", "scenes", "Probe.ts");
const generatedComponentsPath = join(projectDir, "src", "components", "Semantic.ts");
const sessionsDir = join(fixtureRoot, "evidence", "sessions");
const shotsDir = join(sessionsDir, "shots");
mkdirSync(shotsDir, { recursive: true });

function snapshot(phase, name, observation) {
  const argv = [join(fixtureRoot, "scripts", "session-snapshot.mjs"), phase, name];
  if (observation) argv.push(observation);
  execFileSync(process.execPath, argv, { stdio: "inherit" });
}

// Flat [{id,label,parentId,semanticId,binding}] view of the scene file on disk.
function identityList() {
  const scene = JSON.parse(readFileSync(scenePath, "utf8"));
  const out = [];
  const walk = (list, parentId) => {
    for (const obj of list ?? []) {
      out.push({
        id: obj.id,
        label: obj.label,
        parentId,
        semanticId: obj["Semantic.fabSemanticId"] ?? null,
        binding: obj["Semantic.fabBinding"] ?? null,
      });
      walk(obj.list, obj.id);
    }
  };
  walk(scene.displayList, null);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function startServer(extraArgs = []) {
  if (!existsSync(SERVER_BIN)) {
    console.error(`[session] BLOCKED: Phaser Editor server not found at ${SERVER_BIN}`);
    process.exit(3);
  }
  const proc = spawn(
    SERVER_BIN,
    [
      "-project",
      projectDir,
      "-port",
      String(port),
      "-disable-open-browser",
      "-disable-check-for-updates",
      ...extraArgs,
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  proc.stderr.on("data", (d) => {
    const line = String(d);
    if (/error|panic/i.test(line)) process.stderr.write(`[pe] ${line}`);
  });
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/editor/`);
      if (res.ok) return proc;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error("editor server did not become ready");
}

async function openWorkbench() {
  // CHROMIUM_PATH lets the driver use a full Chromium build when the
  // playwright headless-shell download is unavailable.
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  const browser = await chromium.launch({ headless: !headed, executablePath });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    // the scene editor's duplicate is clipboard-backed (copy + paste)
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[page:error] ${msg.text()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/editor/`, { waitUntil: "load" });
  await page.waitForFunction(
    () => {
      try {
        return Boolean(globalThis.colibri?.Platform?.getWorkbench?.()?.getActiveWindow?.());
      } catch {
        return false;
      }
    },
    { timeout: 60_000 }
  );
  await page.waitForTimeout(3_000); // project scan / part restore
  return { browser, page };
}

async function shot(page, name) {
  await page.screenshot({ path: join(shotsDir, `${name}.png`) });
  console.log(`[session] screenshot ${name}.png`);
}

async function exec(page, commandId) {
  await page.evaluate((id) => {
    globalThis.colibri.Platform.getWorkbench().getCommandManager().executeCommand(id, false);
  }, commandId);
}

async function waitForFiles(paths, timeoutMs = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (paths.every((p) => existsSync(p))) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// Open the Probe scene in a Scene Editor part and wait until it is active.
async function openProbeScene(page) {
  await page.evaluate(async () => {
    const FileUtils = globalThis.colibri.ui.ide.FileUtils;
    const root = FileUtils.getRoot();
    const find = (f) => {
      if (f.getName() === "Probe.scene") return f;
      for (const c of f.getFiles?.() ?? []) {
        const hit = find(c);
        if (hit) return hit;
      }
      return null;
    };
    const file = find(root);
    if (!file) throw new Error("Probe.scene not found in workbench file tree");
    globalThis.colibri.Platform.getWorkbench().openEditor(file);
  });
  await page.waitForFunction(
    () =>
      globalThis.colibri.Platform.getWorkbench().getActiveEditor()?.getInput?.()?.getName?.() ===
      "Probe.scene",
    { timeout: 30_000 }
  );
  // let the scene render (textures load async)
  await page.waitForTimeout(2_500);
}

// Select a scene object by label inside the active scene editor.
async function selectObject(page, label) {
  const found = await page.evaluate((wanted) => {
    const editor = globalThis.colibri.Platform.getWorkbench().getActiveEditor();
    const scene = editor.getScene();
    let target = null;
    const visit = (objs) => {
      for (const obj of objs) {
        const es = obj.getEditorSupport?.();
        if (es?.getLabel?.() === wanted) target = obj;
        if (obj.list) visit(obj.list);
      }
    };
    visit(scene.children.list);
    if (!target) return false;
    editor.setSelection([target]);
    return true;
  }, label);
  if (!found) throw new Error(`scene object '${label}' not found for selection`);
  await page.waitForTimeout(800); // let the inspector rebuild
}

// Locate a form field (input/textarea) by exact current value, expanding the
// named collapsed inspector section when needed.
async function findFormField(page, sectionTitle, value) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const exists = await page.evaluate(
      (v) => [...document.querySelectorAll("input, textarea")].some((el) => el.value === v),
      value
    );
    if (exists) return;
    await page.getByText(sectionTitle, { exact: true }).first().click();
    await page.waitForTimeout(1_000);
  }
  throw new Error(`form field with value '${value}' not found (section '${sectionTitle}')`);
}

// Screenshot just the scene-editor canvas (the largest canvas on the page).
async function canvasShot(page, name) {
  const clip = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll("canvas")];
    canvases.sort((a, b) => b.width * b.height - a.width * a.height);
    const r = canvases[0].getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const path = join(shotsDir, `${name}.png`);
  await page.screenshot({ path, clip });
  return sha256File(path);
}

// Shared body for the two live-typing legs. Returns per-keystroke hashes.
async function runTypingProbe(page, label) {
  await openProbeScene(page);
  await selectObject(page, "copyTitle");
  await findFormField(page, "Text Content", "PROBE-43QVBIH7");
  const shots = [];
  const grab = async (name) => {
    const hash = await canvasShot(page, name);
    shots.push({ name, hash });
  };
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("input, textarea")].find(
      (i) => i.value === "PROBE-43QVBIH7"
    );
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  });
  await grab(`${label}-0`);
  for (let i = 1; i <= 3; i++) {
    await page.keyboard.type("X", { delay: 60 });
    await page.waitForTimeout(900);
    await grab(`${label}-${i}`);
  }
  const changedPerKeystroke = shots.every((s, i) => i === 0 || s.hash !== shots[i - 1].hash);
  // commit explicitly (what blur/Enter would do), observe, then restore the
  // original value and commit again so nothing persists
  await page.evaluate(() => {
    const el = document.activeElement;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(900);
  await grab(`${label}-commit`);
  const changedOnCommit = shots.at(-1).hash !== shots.at(-2).hash;
  await page.evaluate(() => {
    const el = document.activeElement;
    el.value = "PROBE-43QVBIH7";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(900);
  await exec(page, CMD.save);
  await page.waitForTimeout(1_200);
  await exec(page, CMD.editorClose);
  await page.waitForTimeout(500);
  return { shots, changedPerKeystroke, changedOnCommit };
}

async function main() {
  const pluginStep = step === "live-typing-plugin";
  const server = await startServer(
    pluginStep ? ["-plugins", join(fixtureRoot, "editor-plugins")] : []
  );
  const { browser, page } = await openWorkbench();
  try {
    switch (step) {
      case "probe": {
        await shot(page, "probe-workbench");
        const state = await page.evaluate(() => {
          const FileUtils = globalThis.colibri.ui.ide.FileUtils;
          const root = FileUtils.getRoot();
          const files = [];
          const walk = (f) => {
            for (const c of f.getFiles?.() ?? []) {
              files.push(c.getFullName());
              walk(c);
            }
          };
          if (root) walk(root);
          return { projectRoot: root?.getName?.() ?? null, files };
        });
        console.log(JSON.stringify(state, null, 2));
        break;
      }

      case "compile": {
        // Generation 1 from the pristine project state.
        snapshot("begin", "compile-1");
        await exec(page, CMD.compileProject);
        if (!(await waitForFiles([generatedScenePath, generatedComponentsPath]))) {
          throw new Error("generated files did not appear after CompileProject");
        }
        await page.waitForTimeout(1_500);
        snapshot("end", "compile-1", "CompileProject produced Probe.ts and Semantic.ts");
        const gen1 = {
          scene: sha256File(generatedScenePath),
          components: sha256File(generatedComponentsPath),
        };

        // Generation 2: delete outputs, regenerate from unchanged editor state.
        rmSync(generatedScenePath);
        rmSync(generatedComponentsPath);
        snapshot("begin", "compile-2");
        await exec(page, CMD.compileProject);
        if (!(await waitForFiles([generatedScenePath, generatedComponentsPath]))) {
          throw new Error("generated files did not reappear after second CompileProject");
        }
        await page.waitForTimeout(1_500);
        const gen2 = {
          scene: sha256File(generatedScenePath),
          components: sha256File(generatedComponentsPath),
        };
        const identical = gen1.scene === gen2.scene && gen1.components === gen2.components;
        snapshot(
          "end",
          "compile-2",
          identical
            ? "second generation byte-identical to first (outputs deleted between runs)"
            : `DETERMINISM FAILURE gen1=${JSON.stringify(gen1)} gen2=${JSON.stringify(gen2)}`
        );
        await shot(page, "compile-done");
        console.log(JSON.stringify({ gen1, gen2, identical }, null, 2));
        if (!identical) process.exitCode = 1;
        break;
      }

      case "save-reopen": {
        snapshot("begin", "save-reopen");
        writeFileSync(join(sessionsDir, "identity-before.json"), JSON.stringify(identityList(), null, 2) + "\n");
        await openProbeScene(page);
        await shot(page, "save-reopen-opened");
        // First save may re-serialize the hand-authored JSON (a recorded fact).
        await exec(page, CMD.save);
        await page.waitForTimeout(1_500);
        const afterFirstSave = sha256File(scenePath);
        await exec(page, CMD.editorClose);
        await page.waitForTimeout(1_000);
        await openProbeScene(page);
        await exec(page, CMD.save);
        await page.waitForTimeout(1_500);
        const afterSecondSave = sha256File(scenePath);
        await exec(page, CMD.editorClose);
        await page.waitForTimeout(500);
        writeFileSync(join(sessionsDir, "identity-after.json"), JSON.stringify(identityList(), null, 2) + "\n");
        const stable = afterFirstSave === afterSecondSave;
        snapshot(
          "end",
          "save-reopen",
          stable
            ? "save/close/reopen/save: second save byte-stable; identity lists recorded"
            : "second save produced different bytes than first save (instability)"
        );
        console.log(JSON.stringify({ afterFirstSave, afterSecondSave, stable }, null, 2));
        if (!stable) process.exitCode = 1;
        break;
      }

      case "duplicate": {
        snapshot("begin", "duplicate");
        const before = identityList();
        await openProbeScene(page);
        await selectObject(page, "counterPrimary");
        await exec(page, CMD.duplicateObject);
        await page.waitForTimeout(1_000);
        await shot(page, "duplicate-done");
        await exec(page, CMD.save);
        await page.waitForTimeout(1_500);
        await exec(page, CMD.editorClose);
        await page.waitForTimeout(500);
        const after = identityList();
        const beforeIds = new Set(before.map((o) => o.id));
        const added = after.filter((o) => !beforeIds.has(o.id));
        const original = after.find((o) => o.label === "counterPrimary" && beforeIds.has(o.id));
        const result = { added, originalId: original?.id ?? null, beforeCount: before.length, afterCount: after.length };
        writeFileSync(join(sessionsDir, "duplicate-result.json"), JSON.stringify(result, null, 2) + "\n");
        const ok =
          added.length === 1 &&
          added[0].id !== result.originalId &&
          added[0].parentId === before.find((o) => o.label === "counterPrimary")?.parentId &&
          added[0].binding === "currency:primary";
        snapshot(
          "end",
          "duplicate",
          ok
            ? `editor duplicate created new id ${added[0].id} in same parent with binding retained`
            : `unexpected duplicate outcome: ${JSON.stringify(result)}`
        );
        console.log(JSON.stringify(result, null, 2));
        if (!ok) process.exitCode = 1;
        break;
      }

      case "live-typing": {
        // Base-editor behavior, recorded as-is: fields commit on the change
        // event, so no per-keystroke preview is expected — the honest R3
        // baseline observation, whatever it turns out to be.
        snapshot("begin", "live-typing");
        const result = await runTypingProbe(page, "live-typing");
        writeFileSync(
          join(sessionsDir, "live-typing-result.json"),
          JSON.stringify(result, null, 2) + "\n"
        );
        snapshot(
          "end",
          "live-typing",
          `base editor: per-keystroke canvas update=${result.changedPerKeystroke}, ` +
            `update on commit=${result.changedOnCommit} (typed 3 chars, no Enter/blur, then committed and restored)`
        );
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "live-typing-plugin": {
        // Same probe with the fixture's live-copy-preview plugin loaded via
        // the documented -plugins flag: the smallest recorded plugin path.
        const loaded = await page.evaluate(() => Boolean(globalThis.__liveCopyPreviewPluginLoaded));
        if (!loaded) throw new Error("live-copy-preview plugin did not load (-plugins flag)");
        snapshot("begin", "live-typing-plugin");
        const result = await runTypingProbe(page, "live-typing-plugin");
        writeFileSync(
          join(sessionsDir, "live-typing-plugin-result.json"),
          JSON.stringify(result, null, 2) + "\n"
        );
        snapshot(
          "end",
          "live-typing-plugin",
          `live-copy-preview plugin: per-keystroke canvas update=${result.changedPerKeystroke}, ` +
            `update on commit=${result.changedOnCommit}`
        );
        console.log(JSON.stringify(result, null, 2));
        if (!result.changedPerKeystroke) process.exitCode = 1;
        break;
      }

      case "retarget-duplicate": {
        // AE1's "binding retained or explicitly changed": turn the duplicate
        // into the second-currency counter through the editor's inspector.
        snapshot("begin", "retarget-duplicate");
        await openProbeScene(page);
        await selectObject(page, "counterPrimary_1");
        // Inspector fields commit on the native change event (createStringField
        // in the scene plugin); set the value and fire it, same as blur/Enter.
        // The Semantic user-component section is collapsed by default and only
        // builds its inputs on expand, so click its header until they appear.
        const fillInspectorInput = async (currentValue, newValue) => {
          let found = false;
          for (let attempt = 0; attempt < 10 && !found; attempt++) {
            found = await page.evaluate(
              (cur) => [...document.querySelectorAll("input, textarea")].some((i) => i.value === cur),
              currentValue
            );
            if (!found) {
              await page.getByText("Semantic", { exact: true }).first().click();
              await page.waitForTimeout(1_200);
            }
          }
          if (!found) {
            const values = await page.evaluate(() =>
              [...document.querySelectorAll("input, textarea")].map((i) => i.value).filter(Boolean)
            );
            throw new Error(
              `inspector input with value '${currentValue}' not found; visible inputs: ${JSON.stringify(values)}`
            );
          }
          await page.evaluate(
            ([cur, next]) => {
              const input = [...document.querySelectorAll("input, textarea")].find((i) => i.value === cur);
              input.focus();
              input.value = next;
              input.dispatchEvent(new Event("change", { bubbles: true }));
            },
            [currentValue, newValue]
          );
          await page.waitForTimeout(500);
        };
        await fillInspectorInput("shell.counter.primary", "shell.counter.secondary");
        await fillInspectorInput("currency:primary", "currency:secondary");
        await shot(page, "retarget-duplicate-done");
        await exec(page, CMD.save);
        await page.waitForTimeout(1_500);
        await exec(page, CMD.editorClose);
        await page.waitForTimeout(500);
        const objs = identityList();
        const dup = objs.find((o) => o.label === "counterPrimary_1");
        const result = { id: dup?.id, semanticId: dup?.semanticId, binding: dup?.binding };
        writeFileSync(join(sessionsDir, "retarget-result.json"), JSON.stringify(result, null, 2) + "\n");
        const ok = dup?.semanticId === "shell.counter.secondary" && dup?.binding === "currency:secondary";
        snapshot(
          "end",
          "retarget-duplicate",
          ok
            ? "duplicate retargeted to shell.counter.secondary / currency:secondary via inspector fields"
            : `retarget failed: ${JSON.stringify(result)}`
        );
        console.log(JSON.stringify(result, null, 2));
        if (!ok) process.exitCode = 1;
        break;
      }

      default:
        console.error(`unknown step: ${step}`);
        process.exitCode = 2;
    }
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
