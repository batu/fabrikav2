// Hash-bracketed GUI-session ledger (plan KTD5). Every editor-GUI step is
// bracketed by before/after content hashes of the editor project tree, so an
// observation can always be checked against committed bytes.
//
//   node scripts/session-snapshot.mjs begin <step>
//   node scripts/session-snapshot.mjs end <step> "<observation>"
//   node scripts/session-snapshot.mjs note <step> "<observation>"   (no hash change expected)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fixtureRoot, projectManifest, manifestHash } from "./lib.mjs";

const ledgerPath = join(fixtureRoot, "evidence", "sessions", "session-ledger.json");

function loadLedger() {
  if (!existsSync(ledgerPath)) return { entries: [] };
  return JSON.parse(readFileSync(ledgerPath, "utf8"));
}

function saveLedger(ledger) {
  mkdirSync(join(fixtureRoot, "evidence", "sessions"), { recursive: true });
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
}

const [, , phase, step, observation] = process.argv;
if (!phase || !step) {
  console.error("usage: session-snapshot.mjs begin|end|note <step> [observation]");
  process.exit(2);
}

const manifest = projectManifest();
const ledger = loadLedger();
ledger.entries.push({
  step,
  phase,
  timestamp: new Date().toISOString(),
  treeHash: manifestHash(manifest),
  files: manifest,
  ...(observation ? { observation } : {}),
});
saveLedger(ledger);
console.log(`[session] ${phase} ${step} tree=${manifestHash(manifest).slice(0, 12)}`);
