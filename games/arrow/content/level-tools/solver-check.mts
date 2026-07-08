#!/usr/bin/env -S node --import tsx
/**
 * solver-check — validates a LevelSpec JSON via the game's solveTrace.
 *
 * Contract entry point for the icon-to-level pipeline's Python validator
 * (games/arrow/content/level-tools/icon2level/src/icon2level/validate.py, landing in a
 * later Trello card). The pipeline spawns this script, writes LevelSpec
 * JSON to stdin, and reads a SolveTrace-shaped JSON from stdout.
 *
 * Protocol:
 *   stdin  → LevelSpec JSON: { cols, rows, paths: [{ id, cells: [{x,y}] }] }
 *   stdout → SolveTrace JSON: see contracts/solver-metrics.schema.json
 *   stderr → human-readable logs only (never parsed by the caller)
 *
 * Exit codes:
 *   0 → measurement succeeded; verdict (solved | unsolvable) is in stdout
 *   1 → internal CLI error (stdout still contains a kind='error' JSON)
 *   2 → input malformed (unparseable JSON or schema mismatch)
 *
 * See docs/decisions/2026-04-20-solver-contract-surface.md for the
 * stability contract around solveTrace.
 */

import { solveTrace, type SolveTrace } from "../../src/game/solver.js";
import type { Path } from "../../src/game/path.js";

type ErrorPayload = {
  readonly kind: "error";
  readonly reason: "malformed-json" | "schema-mismatch" | "internal";
  readonly message: string;
};

type Output = SolveTrace | ErrorPayload;

/** Serialize to stdout + exit. Stdout is pure JSON — no pretty-print, no trailing noise. */
function emit(output: Output, exitCode: number): never {
  process.stdout.write(JSON.stringify(output));
  process.stdout.write("\n");
  process.exit(exitCode);
}

/**
 * Type guard for the LevelSpec-subset the solver accepts. Validates:
 *   - top-level cols/rows are positive integers
 *   - paths is an array of {id, cells}
 *   - ids are positive integers and unique across paths
 *   - cells is length≥2, integer {x,y} in-bounds (0 ≤ x < cols, 0 ≤ y < rows)
 *   - no duplicate cells within a path
 *
 * Does NOT validate 4-connectedness or arrow-disjointness — those remain
 * placePath's responsibility, but any throw from there is caught in main()
 * and re-emitted as schema-mismatch rather than internal error.
 */
function isLevelSpecInput(
  value: unknown,
): value is { cols: number; rows: number; paths: Path[] } {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.cols !== "number" || !Number.isInteger(v.cols) || v.cols < 1) return false;
  if (typeof v.rows !== "number" || !Number.isInteger(v.rows) || v.rows < 1) return false;
  if (!Array.isArray(v.paths)) return false;
  const seenIds = new Set<number>();
  for (const p of v.paths) {
    if (p === null || typeof p !== "object") return false;
    const pr = p as Record<string, unknown>;
    if (typeof pr.id !== "number" || !Number.isInteger(pr.id) || pr.id < 1) return false;
    if (seenIds.has(pr.id)) return false;
    seenIds.add(pr.id);
    if (!Array.isArray(pr.cells) || pr.cells.length < 2) return false;
    const seenCells = new Set<string>();
    for (const c of pr.cells) {
      if (c === null || typeof c !== "object") return false;
      const cr = c as Record<string, unknown>;
      if (typeof cr.x !== "number" || !Number.isInteger(cr.x) || cr.x < 0 || cr.x >= v.cols) return false;
      if (typeof cr.y !== "number" || !Number.isInteger(cr.y) || cr.y < 0 || cr.y >= v.rows) return false;
      const key = `${cr.x},${cr.y}`;
      if (seenCells.has(key)) return false;
      seenCells.add(key);
    }
  }
  return true;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Top-level uncaught-exception guard — if anything throws during solver
// execution that we didn't anticipate, still emit structured JSON on stdout
// so the Python parent isn't left guessing. Per the learnings solution
// cascade-must-propagate-structured-errors.md.
process.on("uncaughtException", (err: Error) => {
  emit(
    {
      kind: "error",
      reason: "internal",
      message: `${err.name}: ${err.message}`,
    },
    1,
  );
});

async function main(): Promise<never> {
  const raw = await readStdin();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit(
      { kind: "error", reason: "malformed-json", message: msg },
      2,
    );
  }

  if (!isLevelSpecInput(parsed)) {
    emit(
      {
        kind: "error",
        reason: "schema-mismatch",
        message:
          "input does not match LevelSpec shape: expected { cols, rows, paths: [{id, cells: [{x,y}]}] } with integer fields",
      },
      2,
    );
  }

  // Canonicalize paths by id ASC before handing to solveTrace — the greedy
  // tiebreak is insertion-order-sensitive, and the ADR requires callers
  // pass paths in a canonical order. The CLI enforces this so the Python
  // pipeline doesn't have to.
  const sortedPaths: Path[] = [...parsed.paths].sort((a, b) => a.id - b.id);

  // solveTrace calls placePath, which enforces 4-connectedness and
  // arrow-disjointness invariants beyond what the structural type guard
  // above checks. If a caller supplies e.g. a diagonal step, that's a
  // bad input — emit schema-mismatch (exit 2), not internal (exit 1).
  // The uncaughtException handler stays as a last-resort safety net for
  // truly unexpected failures deep in the solver.
  let trace;
  try {
    trace = solveTrace(parsed.cols, parsed.rows, sortedPaths);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit(
      { kind: "error", reason: "schema-mismatch", message: msg },
      2,
    );
  }

  emit(trace, 0);
}

void main();
