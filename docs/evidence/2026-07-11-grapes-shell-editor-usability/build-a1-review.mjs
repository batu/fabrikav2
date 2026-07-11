import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const evidenceRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(evidenceRoot, "../../..");
const distRoot = path.join(repositoryRoot, "tools/grapes-shell/dist");
const assetNames = await readdir(path.join(distRoot, "assets"));
const scriptName = assetNames.find((name) => name.endsWith(".js"));
const styleName = assetNames.find((name) => name.endsWith(".css"));
if (!scriptName || !styleName) throw new Error("Build the Grapes Shell editor before creating the A1 view.");

const [appScript, appStyle] = await Promise.all([
  readFile(path.join(distRoot, "assets", scriptName), "utf8"),
  readFile(path.join(distRoot, "assets", styleName), "utf8"),
]);

function escapeClosingTag(source, tag) {
  return source.split(`</${tag}`).join(`<\\/${tag}`);
}

function stripTrailingWhitespace(source) {
  return source.replace(/[ \t]+$/gmu, "");
}

const reviewStyle = `
.a1-review-launch { position: fixed; z-index: 2147483600; top: 12px; left: 50%; min-height: 42px; padding: 9px 16px; transform: translateX(-50%); border: 1px solid #d7942e; border-radius: 999px; background: #fff8e9; color: #5d3e0c; box-shadow: 0 8px 24px #152b3a33; cursor: pointer; font: 800 12px/1 ui-rounded, system-ui, sans-serif; }
.a1-review-launch:hover { background: #f4ae49; color: #382306; }
.a1-review-dialog { width: min(720px, calc(100vw - 40px)); max-height: calc(100dvh - 72px); padding: 0; overflow: auto; border: 1px solid #9db2c1; border-radius: 16px; background: #f8fafc; color: #1d3445; box-shadow: 0 28px 90px #0b172577; font-family: ui-rounded, system-ui, sans-serif; }
.a1-review-dialog::backdrop { background: #102839aa; backdrop-filter: blur(5px); }
.a1-review-header { position: sticky; z-index: 2; top: 0; display: flex; align-items: start; justify-content: space-between; gap: 18px; padding: 20px 22px 16px; border-bottom: 1px solid #c5d2dd; background: #f8fafcee; backdrop-filter: blur(8px); }
.a1-review-eyebrow { margin: 0 0 5px; color: #0f7f98; font: 800 10px/1 ui-monospace, monospace; letter-spacing: .1em; text-transform: uppercase; }
.a1-review-header h2 { margin: 0; color: #142636; font-size: 22px; letter-spacing: -.03em; }
.a1-review-header > div > p:not(.a1-review-eyebrow) { margin: 7px 0 0; color: #587082; font-size: 12px; line-height: 1.45; }
.a1-review-details { margin: 9px 0 0; }
.a1-review-details summary { color: #3b5567; font: 800 10px/1 ui-monospace, monospace; letter-spacing: .06em; text-transform: uppercase; cursor: pointer; }
.a1-review-details p { margin: 6px 0 0; }
.a1-review-close { min-width: 38px; min-height: 38px; border: 1px solid #b8c8d3; border-radius: 9px; background: #fff; color: #395367; cursor: pointer; font-size: 20px; }
.a1-review-form { padding: 18px 22px 22px; }
.a1-review-checks { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0 0 18px; padding: 0; border: 0; }
.a1-review-checks legend { grid-column: 1 / -1; margin-bottom: 3px; color: #3b5567; font: 800 10px/1 ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; }
.a1-review-check { display: flex; align-items: center; gap: 9px; min-height: 42px; padding: 8px 10px; border: 1px solid #d4dee5; border-radius: 9px; background: #fff; color: #314f61; font-size: 12px; }
.a1-review-check:has(input:checked) { border-color: #2a9d72; background: #e8f7f0; color: #185d46; }
.a1-review-check input { width: 18px; height: 18px; accent-color: #2a9d72; }
.a1-review-notes { display: grid; gap: 6px; margin-bottom: 16px; color: #3b5567; font-size: 11px; font-weight: 800; }
.a1-review-notes textarea { min-height: 88px; resize: vertical; border: 1px solid #b8c8d3; border-radius: 9px; padding: 9px 10px; background: #fff; color: #1d3445; font: 400 13px/1.45 system-ui, sans-serif; }
.a1-review-reject-hint { margin: -8px 0 14px; padding: 0 2px; color: #8a6d1f; font-size: 11px; font-weight: 700; }
.a1-review-reject-hint[hidden] { display: none; }
.a1-review-status { min-height: 36px; margin: 0 0 14px; padding: 8px 10px; border-left: 3px solid #0f9bb8; background: #edf9fb; color: #486778; font-size: 12px; line-height: 1.35; }
.a1-review-status[data-tone="error"] { border-color: #c84b4b; background: #fff0f0; color: #7c2727; }
.a1-review-status[data-tone="success"] { border-color: #2a9d72; background: #e8f7f0; color: #185d46; }
.a1-review-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.a1-review-lock { margin: 0 auto 0 0; display: inline-flex; align-items: center; gap: 7px; font: 800 11px/1.3 ui-monospace, monospace; letter-spacing: .02em; }
.a1-review-lock::before { content: "\\25CF"; font-size: 11px; }
.a1-review-lock[data-state="locked"] { color: #8a6d1f; }
.a1-review-lock[data-state="ready"] { color: #185d46; }
.a1-review-action { min-height: 40px; padding: 9px 14px; border: 1px solid #a9bac8; border-radius: 9px; background: #fff; color: #1d3445; cursor: pointer; font-size: 12px; font-weight: 800; }
.a1-review-action--reject { border-color: #c84b4b; color: #8a3030; }
.a1-review-action--accept { border-color: #167a5b; background: #2a9d72; color: #fff; }
.a1-review-action:disabled { cursor: not-allowed; }
/* A disabled decision reads as neutral, never a primed primary action. */
.a1-review-action--accept:disabled, .a1-review-action--reject:disabled { border-color: #ccd6de; background: #eef2f5; color: #8595a1; }
body > div[aria-hidden="true"][style*="height:44px"] ~ #app .editor-shell { height: calc(100dvh - 44px); }
body > div[aria-hidden="true"][style*="height:44px"] ~ #app .editor-artboard-frame { --editor-artboard-scale: .75; }
body > div[aria-hidden="true"][style*="height:44px"] ~ .a1-review-launch { top: 56px; }
@media (max-width: 760px) { .a1-review-checks { grid-template-columns: 1fr; } }
`;

const reviewMarkup = `
<button type="button" class="a1-review-launch" id="a1-review-launch">Review A1 checkpoint</button>
<dialog class="a1-review-dialog" id="a1-review-dialog" aria-labelledby="a1-review-title">
  <header class="a1-review-header">
    <div>
      <p class="a1-review-eyebrow">U3 usability gate</p>
      <h2 id="a1-review-title">Accept or reject the constrained editor</h2>
      <p>Exercise the editor first, then record your verdict. It carries the exact validated six-page project so U4 begins from what you accepted.</p>
      <details class="a1-review-details">
        <summary>Technical details</summary>
        <p>The verdict also carries the saved project hash and the reviewed asset-catalog hash for the future shell_proof target. Portal transports the decision but never becomes the design authority.</p>
      </details>
    </div>
    <button type="button" class="a1-review-close" id="a1-review-close" aria-label="Close review">×</button>
  </header>
  <form class="a1-review-form" id="a1-review-form">
    <fieldset class="a1-review-checks">
      <legend>Representative V1 edit set</legend>
      <label class="a1-review-check"><input type="checkbox" name="check" value="six_pages">Review all six pages</label>
      <label class="a1-review-check"><input type="checkbox" name="check" value="palette">Change a background color</label>
      <label class="a1-review-check"><input type="checkbox" name="check" value="copy">Edit visible copy</label>
      <label class="a1-review-check"><input type="checkbox" name="check" value="move_resize">Move and resize a component</label>
      <label class="a1-review-check"><input type="checkbox" name="check" value="reorder">Reorder semantic layers</label>
      <label class="a1-review-check"><input type="checkbox" name="check" value="asset">Replace a compatible asset</label>
      <label class="a1-review-check"><input type="checkbox" name="check" value="duplicate">Duplicate with the same binding</label>
      <label class="a1-review-check"><input type="checkbox" name="check" value="hide_optional">Hide an optional duplicate</label>
      <label class="a1-review-check"><input type="checkbox" name="check" value="save">Save the browser draft</label>
    </fieldset>
    <label class="a1-review-notes">Notes for Fabrika<textarea id="a1-review-notes" maxlength="4000" placeholder="What worked, what blocked you, or what must change before U4?"></textarea></label>
    <p class="a1-review-reject-hint" id="a1-review-reject-hint">A written reason is required before Reject unlocks.</p>
    <p class="a1-review-status" id="a1-review-status">No decision sent yet. Accept unlocks once every representative edit is checked; Reject requires a written reason.</p>
    <div class="a1-review-actions">
      <p class="a1-review-lock" id="a1-review-lock" data-state="locked" aria-live="polite">Accept locked · 0 of 9 checks</p>
      <button type="button" class="a1-review-action a1-review-action--reject" data-decision="rejected" disabled>Reject U3</button>
      <button type="button" class="a1-review-action a1-review-action--accept" data-decision="accepted" disabled>Accept U3</button>
    </div>
  </form>
</dialog>`;

const reviewScript = `
(() => {
  const launch = document.getElementById("a1-review-launch");
  const dialog = document.getElementById("a1-review-dialog");
  const close = document.getElementById("a1-review-close");
  const form = document.getElementById("a1-review-form");
  const status = document.getElementById("a1-review-status");
  const notes = document.getElementById("a1-review-notes");
  const lock = document.getElementById("a1-review-lock");
  const rejectHint = document.getElementById("a1-review-reject-hint");
  const checks = [...form.querySelectorAll('input[name="check"]')];
  const decisionButtons = [...document.querySelectorAll("[data-decision]")];
  const accept = document.querySelector('[data-decision="accepted"]');
  const reject = document.querySelector('[data-decision="rejected"]');
  launch.addEventListener("click", () => dialog.showModal());
  close.addEventListener("click", () => dialog.close());

  // Accept stays disabled until every representative edit is checked; Reject
  // stays disabled until a written reason exists. The buttons are the gate, not
  // just an error after the click. A disabled decision is styled neutral (never a
  // primed green primary) and carries an explicit N-of-9 lock indicator so the
  // remaining prerequisites are unmistakable before any click.
  function updateGate() {
    const done = checks.filter((input) => input.checked).length;
    const total = checks.length;
    accept.disabled = done < total;
    reject.disabled = notes.value.trim().length === 0;
    lock.dataset.state = accept.disabled ? "locked" : "ready";
    lock.textContent = accept.disabled
      ? "Accept locked · " + done + " of " + total + " checks"
      : "All " + total + " checks complete · Accept unlocked";
    rejectHint.hidden = !reject.disabled;
  }
  checks.forEach((input) => input.addEventListener("change", updateGate));
  notes.addEventListener("input", updateGate);
  updateGate();

  function requestId() {
    return new URLSearchParams(location.search).get("request_id")
      || location.pathname.match(/\\/media\\/([^/]+)\\//)?.[1]
      || location.pathname.match(/\\/r\\/([^/]+)/)?.[1]
      || null;
  }

  async function decide(decision) {
    const checked = Object.fromEntries(checks.map((input) => [input.value, input.checked]));
    if (decision === "accepted" && Object.values(checked).some((value) => !value)) {
      status.dataset.tone = "error";
      status.textContent = "Accept is blocked until every representative edit is checked.";
      return;
    }
    if (decision === "rejected" && notes.value.trim().length === 0) {
      status.dataset.tone = "error";
      status.textContent = "Reject is blocked until you write the reason the editor must change.";
      return;
    }
    const editor = window.__FABRIKAV2_GRAPES_SHELL_EDITOR__;
    if (!editor) {
      status.dataset.tone = "error";
      status.textContent = "The validated editor bridge is unavailable; no decision was sent.";
      return;
    }
    const id = requestId();
    if (!id) {
      status.dataset.tone = "error";
      status.textContent = "This local preview has no Portal request ID; no decision was sent.";
      return;
    }
    const snapshot = await editor.getValidatedSnapshot();
    if (decision === "accepted" && snapshot.status !== "saved-unpublished") {
      status.dataset.tone = "error";
      status.textContent = "Accept is blocked until the exact browser draft is saved.";
      return;
    }
    const payload = {
      schema: "fabrikav2-grapes-shell-a1-v1",
      decision,
      targetGame: snapshot.project.targetGame,
      reviewedAt: new Date().toISOString(),
      checklist: checked,
      notes: notes.value.trim(),
      editorStatus: snapshot.status,
      projectHash: snapshot.projectHash,
      assetCatalogHash: snapshot.assetCatalogHash,
      project: snapshot.project,
    };
    const encoded = JSON.stringify(payload);
    if (new TextEncoder().encode(encoded).byteLength > 950000) {
      status.dataset.tone = "error";
      status.textContent = "The decision payload exceeds the safe Portal limit; no decision was sent.";
      return;
    }
    decisionButtons.forEach((button) => { button.disabled = true; });
    status.dataset.tone = "neutral";
    status.textContent = "Sending the exact validated project and A1 verdict…";
    try {
      const response = await fetch("/r/" + encodeURIComponent(id) + "/decide" + location.search, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(typeof error.detail === "string" ? error.detail : "Portal rejected the decision.");
      }
      status.dataset.tone = "success";
      status.textContent = decision === "accepted"
        ? "A1 accepted U3. Fabrika may close this checkpoint before starting U4."
        : "A1 rejected U3. Fabrika will keep U4 locked and reopen the named issues.";
    } catch (error) {
      updateGate();
      status.dataset.tone = "error";
      status.textContent = error instanceof Error ? error.message : "Decision submission failed.";
    }
  }

  decisionButtons.forEach((button) => button.addEventListener("click", () => decide(button.dataset.decision)));
})();`;

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Fabrikav2 Grapes Shell · A1 Usability Checkpoint</title>
  <style>${escapeClosingTag(stripTrailingWhitespace(appStyle), "style")}\n${reviewStyle}</style>
</head>
<body>
  <div id="app"></div>
${reviewMarkup.trim()}
  <script type="module">${escapeClosingTag(stripTrailingWhitespace(appScript), "script")}</script>
  <script>${reviewScript}</script>
</body>
</html>\n`;

await writeFile(path.join(evidenceRoot, "a1-review.html"), html, "utf8");
process.stdout.write(`${path.join(evidenceRoot, "a1-review.html")}\n`);
