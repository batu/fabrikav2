#!/usr/bin/env -S node --import tsx
/**
 * levels:check-all — single-process validator for every committed level.
 *
 * Loads the solver once in-proc (no per-level subprocess spawn), iterates
 * RECIPES, runs solveTrace on each LevelSpec, and compares the result
 * against games/arrow/content/levels/catalogue.json. Intended to run in CI on
 * every PR that touches the level corpus or the solver.
 *
 * Modes:
 *   --update   regenerate catalogue.json from the current solver output
 *              (used when a solver change is intentional — bumps the
 *              recorded solverHash and accepts the new metrics).
 *   (default)  read catalogue.json and fail on any drift.
 *
 * Drift detection (Revision 14):
 *   - Compute sha256 of games/arrow/src/game/solver.ts → currentHash.
 *   - If currentHash === recorded hash: STRICT equality on every
 *     numeric field. Any drift means the CI runner produced different
 *     numbers with identical source — investigate.
 *   - Else: TOLERANCE band (±10% on meanBranchingFactor,
 *     ±10% on maxBranchingFactor). Exceeding the band fails with
 *     "solver drift requires catalogue regeneration", which the
 *     author resolves by running `npm run levels:check-all -- --update`
 *     and reviewing the diff before committing.
 *
 * See docs/decisions/2026-04-20-solver-contract-surface.md for the
 * tolerance-band rationale.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildLevel } from "../../src/game/levels.js";
import { RECIPES } from "../../src/game/levels-data.js";
import { solveTrace, type SolveTrace } from "../../src/game/solver.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARROW_ROOT = join(HERE, "..", "..");
// Hash every .ts file in src/game/ that the solver transitively
// depends on. Starting narrow (solver.ts only) missed the case where
// a helper (path.ts, grid utils) changed in a way that shifted solver
// output without bumping the hash. Over-hashing is cheap; false-
// positive "solver drifted" fires --update and a reviewer glance.
const SOLVER_DEPS = [
  "src/game/solver.ts",
  "src/game/path.ts",
  "src/game/slither.ts",
].map((p) => join(ARROW_ROOT, p));
// CATALOGUE path is env-overridable so the regression test can point
// at a mutated copy without disturbing the committed artifact.
const CATALOGUE = process.env.ARROW_CATALOGUE
  ? process.env.ARROW_CATALOGUE
  : join(ARROW_ROOT, "content/levels/catalogue.json");
const TOLERANCE = 1.1; // ±10% on branching metrics when solver hash drifts.

type CatalogueEntry = {
  readonly pack: string;
  readonly indexInPack: number;
  readonly kind: "solved" | "unsolvable";
  readonly meanBranchingFactor?: number;
  readonly maxBranchingFactor?: number;
  readonly blockedAtStart: number;
};

type Catalogue = {
  readonly solverHash: string;
  readonly schemaVersion: 1;
  readonly levels: ReadonlyArray<CatalogueEntry>;
};

function solverHash(): string {
  const h = createHash("sha256");
  for (const p of SOLVER_DEPS) {
    h.update(readFileSync(p));
  }
  return h.digest("hex");
}

function traceToEntry(
  pack: string,
  indexInPack: number,
  trace: SolveTrace,
): CatalogueEntry {
  if (trace.kind === "solved") {
    return {
      pack,
      indexInPack,
      kind: "solved",
      meanBranchingFactor: trace.meanBranchingFactor,
      maxBranchingFactor: trace.maxBranchingFactor,
      blockedAtStart: trace.blockedAtStart,
    };
  }
  return {
    pack,
    indexInPack,
    kind: "unsolvable",
    blockedAtStart: trace.blockedAtStart,
  };
}

function solveAll(): CatalogueEntry[] {
  const out: CatalogueEntry[] = [];
  for (let i = 0; i < RECIPES.length; i++) {
    const r = RECIPES[i]!;
    const spec = buildLevel(i + 1, r);
    const trace = solveTrace(spec.cols, spec.rows, spec.paths);
    out.push(traceToEntry(r.meta.pack, r.meta.indexInPack, trace));
  }
  return out;
}

function writeCatalogue(entries: CatalogueEntry[]): void {
  const payload: Catalogue = {
    solverHash: solverHash(),
    schemaVersion: 1,
    levels: entries,
  };
  writeFileSync(CATALOGUE, JSON.stringify(payload, null, 2) + "\n");
  console.log(`wrote ${CATALOGUE} (${entries.length} levels)`);
}

function readCatalogue(): Catalogue {
  if (!existsSync(CATALOGUE)) {
    throw new Error(
      `${CATALOGUE} missing. Run 'npm run levels:check-all -- --update' to create it.`,
    );
  }
  const parsed = JSON.parse(readFileSync(CATALOGUE, "utf8")) as Catalogue;
  if (parsed.schemaVersion !== 1) {
    throw new Error(
      `catalogue schemaVersion ${parsed.schemaVersion} unsupported (expected 1)`,
    );
  }
  return parsed;
}

function compareEntries(
  recorded: CatalogueEntry,
  current: CatalogueEntry,
  strict: boolean,
): string[] {
  const key = `${recorded.pack}#${recorded.indexInPack}`;
  const issues: string[] = [];
  if (recorded.kind !== current.kind) {
    issues.push(
      `${key}: kind changed ${recorded.kind} → ${current.kind}`,
    );
    return issues;
  }
  if (recorded.blockedAtStart !== current.blockedAtStart) {
    issues.push(
      `${key}: blockedAtStart ${recorded.blockedAtStart} → ${current.blockedAtStart}`,
    );
  }
  if (recorded.kind === "solved" && current.kind === "solved") {
    const cmp = (label: string, rec: number | undefined, cur: number | undefined): void => {
      if (typeof rec !== "number" || typeof cur !== "number") {
        issues.push(`${key}: ${label} missing in recorded or current (rec=${rec}, cur=${cur})`);
        return;
      }
      if (strict) {
        if (rec !== cur) {
          issues.push(`${key}: ${label} ${rec} → ${cur} (strict mismatch)`);
        }
      } else {
        // Symmetric band: drift UP over +10% OR DOWN over -10% both
        // fail. Asymmetric bounds would hide regressions that simplify
        // solver output (e.g. a bug dropping branching to 0).
        const upper = rec * TOLERANCE;
        const lower = rec / TOLERANCE;
        if (cur > upper || cur < lower) {
          issues.push(
            `${key}: ${label} ${cur.toFixed(3)} outside tolerance [${lower.toFixed(3)}, ${upper.toFixed(3)}] (recorded ${rec.toFixed(3)})`,
          );
        }
      }
    };
    cmp("meanBranchingFactor", recorded.meanBranchingFactor, current.meanBranchingFactor);
    cmp("maxBranchingFactor", recorded.maxBranchingFactor, current.maxBranchingFactor);
  }
  return issues;
}

function main(): void {
  const args = process.argv.slice(2);
  const updateMode = args.includes("--update");

  if (updateMode && process.env.ARROW_ALLOW_REGEN !== "1") {
    console.error(
      "--update refuses to regenerate catalogue without ARROW_ALLOW_REGEN=1.\n" +
        "Set the env var when you have reviewed the upcoming diff:\n" +
        "  ARROW_ALLOW_REGEN=1 npm run levels:check-all -- --update",
    );
    process.exit(2);
  }

  // Visibility: always log which catalogue is in use so a shell-
  // exported ARROW_CATALOGUE doesn't silently redirect runs.
  console.log(
    `catalogue: ${CATALOGUE}${process.env.ARROW_CATALOGUE ? " [env override]" : ""}`,
  );

  console.time("levels:check-all");
  const entries = solveAll();
  console.timeEnd("levels:check-all");

  if (updateMode) {
    writeCatalogue(entries);
    return;
  }

  const recorded = readCatalogue();
  const currentHash = solverHash();
  const strict = currentHash === recorded.solverHash;

  if (recorded.levels.length !== entries.length) {
    console.error(
      `catalogue has ${recorded.levels.length} entries, corpus has ${entries.length}. Run --update.`,
    );
    process.exit(1);
  }

  const issues: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const rec = recorded.levels[i]!;
    const cur = entries[i]!;
    if (rec.pack !== cur.pack || rec.indexInPack !== cur.indexInPack) {
      issues.push(
        `slot ${i}: pack/index mismatch ${rec.pack}#${rec.indexInPack} vs ${cur.pack}#${cur.indexInPack}`,
      );
      continue;
    }
    issues.push(...compareEntries(rec, cur, strict));
  }

  if (issues.length > 0) {
    console.error(
      strict
        ? `levels:check-all FAILED (strict, solver hash matches): ${issues.length} drift(s)`
        : `levels:check-all FAILED (tolerance, solver hash differs): ${issues.length} out-of-band drift(s) — solver drift requires catalogue regeneration`,
    );
    for (const i of issues) console.error(`  ${i}`);
    process.exit(1);
  }

  console.log(
    `levels:check-all OK (${entries.length} levels, ${strict ? "strict" : "tolerance"} mode)`,
  );
}

main();
