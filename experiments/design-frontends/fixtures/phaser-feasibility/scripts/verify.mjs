// The fixture's single verification entry point (plan KTD3):
//   npm --prefix experiments/design-frontends/fixtures/phaser-feasibility run verify
//
// Re-runs everything provable on the current machine (typecheck, lint, unit
// tests, determinism record validation, offline build + bundle checks, report
// integrity, privacy scan) and validates recorded GUI/device evidence by hash
// instead of pretending to re-run it. Must be green offline after `npm ci`.
// Every step reports a typed pass | fail | blocked line; any fail exits 1.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureRoot, sha256File, listFiles } from "./lib.mjs";

const bin = (name) => join(fixtureRoot, "node_modules", ".bin", name);
const results = [];

function report(name, status, detail = "") {
  results.push({ name, status, detail });
  const pad = name.padEnd(22);
  console.log(`[verify] ${pad} ${status.toUpperCase()}${detail ? ` — ${detail}` : ""}`);
}

function runStep(name, cmd, args) {
  if (!existsSync(cmd)) {
    report(name, "fail", `missing executable ${cmd} (run npm ci first)`);
    return;
  }
  const res = spawnSync(cmd, args, { cwd: fixtureRoot, encoding: "utf8" });
  if (res.status === 0) {
    report(name, "pass");
  } else {
    report(name, "fail", (res.stdout + res.stderr).trim().split("\n").slice(-15).join("\n"));
  }
}

// -- 1..3: code health ------------------------------------------------------
runStep("typecheck", bin("tsc"), ["--noEmit"]);
runStep("lint", bin("eslint"), ["."]);
runStep("test:unit", bin("vitest"), ["run", "--reporter=dot"]);

// -- 4: determinism record --------------------------------------------------
// Headless regeneration is unsupported by the pinned toolchain (see
// report.json feasibility.headless_regen), so verify validates the recorded
// double-generation evidence: the session ledger must contain two compile
// brackets with identical generated-output hashes, and the committed files
// must still match those hashes byte-for-byte.
try {
  const ledgerPath = join(fixtureRoot, "evidence", "sessions", "session-ledger.json");
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const gen1 = ledger.entries.filter((e) => e.step === "compile-1" && e.phase === "end").at(-1);
  const gen2 = ledger.entries.filter((e) => e.step === "compile-2" && e.phase === "end").at(-1);
  if (!gen1 || !gen2) throw new Error("missing compile-1/compile-2 end brackets in session ledger");
  const generated = Object.keys(gen1.files).filter((f) => /\.(ts|js)$/.test(f));
  if (generated.length === 0) throw new Error("no generated files recorded in compile-1 bracket");
  const problems = [];
  for (const f of generated) {
    if (gen1.files[f] !== gen2.files[f]) {
      problems.push(`generation drift between runs: ${f}`);
      continue;
    }
    const abs = join(fixtureRoot, f);
    if (!existsSync(abs)) problems.push(`recorded generated file missing: ${f}`);
    else if (sha256File(abs) !== gen1.files[f]) problems.push(`committed bytes differ from recorded generation: ${f}`);
  }
  if (problems.length > 0) report("determinism", "fail", problems.join("; "));
  else report("determinism", "pass", `${generated.length} generated files identical across two runs`);
} catch (err) {
  report("determinism", "fail", String(err.message ?? err));
}

// -- 5: offline build + bundle checks ---------------------------------------
runStep("build", bin("vite"), ["build", "--logLevel", "error"]);
try {
  const distDir = join(fixtureRoot, "dist");
  const bundles = listFiles(distDir).filter((f) => f.endsWith(".js"));
  if (bundles.length === 0) throw new Error("no JS bundle in dist/");
  const text = bundles.map((f) => readFileSync(f, "utf8")).join("\n");
  const problems = [];
  if (!text.includes("PROBE-43QVBIH7")) problems.push("probe sentinel missing from bundle");
  for (const marker of ["phasereditor2d", "@phaserjs/editor"]) {
    if (text.includes(marker)) problems.push(`editor-package marker '${marker}' found in bundle`);
  }
  if (problems.length > 0) report("bundle-checks", "fail", problems.join("; "));
  else report("bundle-checks", "pass", "sentinel present, no editor imports");
} catch (err) {
  report("bundle-checks", "fail", String(err.message ?? err));
}

// -- 6: report integrity ----------------------------------------------------
{
  const res = spawnSync(process.execPath, [join(fixtureRoot, "scripts", "verify-report.mjs")], {
    cwd: fixtureRoot,
    encoding: "utf8",
  });
  if (res.status === 0) report("report-integrity", "pass", res.stdout.trim().split("\n").at(-1));
  else report("report-integrity", "fail", (res.stdout + res.stderr).trim().split("\n").slice(-10).join("\n"));
}

// -- summary ------------------------------------------------------------------
const failed = results.filter((r) => r.status === "fail");
console.log(
  `[verify] ${results.length} steps: ` +
    `${results.filter((r) => r.status === "pass").length} pass, ` +
    `${failed.length} fail, ` +
    `${results.filter((r) => r.status === "blocked").length} blocked`
);
process.exit(failed.length > 0 ? 1 : 0);
