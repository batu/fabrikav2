/**
 * End-to-end tests for content/level-tools/solver-check.mts — spawns the CLI as a
 * real subprocess and exercises the stdin → stdout JSON contract.
 *
 * These tests are the contract tests for the Python pipeline's
 * validate.py, which spawns this exact binary. Any change to the CLI's
 * protocol (stdin format, stdout shape, exit codes) must update both
 * this test file and contracts/solver-metrics.schema.json.
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(HERE, "../../content/level-tools/solver-check.mts");

type RunResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
};

function runCli(stdin: string): Promise<RunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("node", ["--import", "tsx", CLI_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ stdout, stderr, code }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

describe("solver-check CLI — happy path", () => {
  it("emits empty stderr on success (pure-stdout protocol)", async () => {
    const input = {
      cols: 2,
      rows: 1,
      paths: [{ id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }],
    };
    const { stderr, code } = await runCli(JSON.stringify(input));
    expect(code).toBe(0);
    expect(stderr).toBe("");
  });

  it("solves the spine-lock fixture and emits valid SolveTrace JSON", async () => {
    // Same fixture as solver-trace.test.ts (L06 spine-lock). Four arrows
    // on an 8×1 grid; forced order D → C → B → A; meanBF=1.0.
    const input = {
      cols: 8,
      rows: 1,
      paths: [
        { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
        { id: 2, cells: [{ x: 2, y: 0 }, { x: 3, y: 0 }] },
        { id: 3, cells: [{ x: 4, y: 0 }, { x: 5, y: 0 }] },
        { id: 4, cells: [{ x: 6, y: 0 }, { x: 7, y: 0 }] },
      ],
    };
    const { stdout, code } = await runCli(JSON.stringify(input));
    expect(code).toBe(0);
    const trace = JSON.parse(stdout);
    expect(trace.kind).toBe("solved");
    expect(trace.meanBranchingFactor).toBe(1);
    expect(trace.maxBranchingFactor).toBe(1);
    expect(trace.blockedAtStart).toBe(3);
    expect(trace.path).toEqual([
      { x: 7, y: 0 },
      { x: 5, y: 0 },
      { x: 3, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it("canonicalizes input path order by id before measuring", async () => {
    // ADR requires paths be sorted by id before solveTrace sees them.
    // CLI does the sort so Python callers don't have to. Verify that
    // shuffled-input produces the same trace as sorted-input.
    const sorted = {
      cols: 8,
      rows: 1,
      paths: [
        { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
        { id: 2, cells: [{ x: 2, y: 0 }, { x: 3, y: 0 }] },
        { id: 3, cells: [{ x: 4, y: 0 }, { x: 5, y: 0 }] },
        { id: 4, cells: [{ x: 6, y: 0 }, { x: 7, y: 0 }] },
      ],
    };
    const shuffled = {
      ...sorted,
      paths: [sorted.paths[2], sorted.paths[0], sorted.paths[3], sorted.paths[1]],
    };
    const [sortedResult, shuffledResult] = await Promise.all([
      runCli(JSON.stringify(sorted)),
      runCli(JSON.stringify(shuffled)),
    ]);
    expect(sortedResult.code).toBe(0);
    expect(shuffledResult.code).toBe(0);
    expect(JSON.parse(sortedResult.stdout)).toEqual(JSON.parse(shuffledResult.stdout));
  });

  it("reports unsolvable with exit 0 (successful measurement)", async () => {
    // Two arrows in mutual deadlock on 4×1. CLI should report
    // kind='unsolvable' with exit code 0 — the tool measured
    // successfully, the puzzle just has no solution. Exit != 0 is
    // reserved for TOOL failure, not PUZZLE verdict.
    const input = {
      cols: 4,
      rows: 1,
      paths: [
        { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
        { id: 2, cells: [{ x: 3, y: 0 }, { x: 2, y: 0 }] },
      ],
    };
    const { stdout, code } = await runCli(JSON.stringify(input));
    expect(code).toBe(0);
    const trace = JSON.parse(stdout);
    expect(trace.kind).toBe("unsolvable");
    expect(trace.blockedAtStart).toBe(2);
  });
});

describe("solver-check CLI — error paths", () => {
  it("rejects malformed JSON with exit 2 + kind='error' + reason='malformed-json'", async () => {
    const { stdout, code } = await runCli("{not valid json");
    expect(code).toBe(2);
    const out = JSON.parse(stdout);
    expect(out.kind).toBe("error");
    expect(out.reason).toBe("malformed-json");
    expect(typeof out.message).toBe("string");
  });

  it("rejects empty stdin as malformed-json (JSON.parse('') throws)", async () => {
    const { stdout, code } = await runCli("");
    expect(code).toBe(2);
    const out = JSON.parse(stdout);
    expect(out.kind).toBe("error");
    expect(out.reason).toBe("malformed-json");
  });

  it("rejects out-of-bounds coords with schema-mismatch (guard catches, doesn't reach placePath)", async () => {
    const { stdout, code } = await runCli(
      JSON.stringify({
        cols: 4,
        rows: 4,
        paths: [{ id: 1, cells: [{ x: 4, y: 0 }, { x: 5, y: 0 }] }],
      }),
    );
    expect(code).toBe(2);
    const out = JSON.parse(stdout);
    expect(out.reason).toBe("schema-mismatch");
  });

  it("rejects duplicate path ids with schema-mismatch (canonical-order contract)", async () => {
    const { stdout, code } = await runCli(
      JSON.stringify({
        cols: 4,
        rows: 4,
        paths: [
          { id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
          { id: 1, cells: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
        ],
      }),
    );
    expect(code).toBe(2);
    const out = JSON.parse(stdout);
    expect(out.reason).toBe("schema-mismatch");
  });

  it("rejects duplicate cells within a path with schema-mismatch", async () => {
    const { stdout, code } = await runCli(
      JSON.stringify({
        cols: 4,
        rows: 4,
        paths: [
          {
            id: 1,
            cells: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 0 },
            ],
          },
        ],
      }),
    );
    expect(code).toBe(2);
    const out = JSON.parse(stdout);
    expect(out.reason).toBe("schema-mismatch");
  });

  it("maps placePath invariant violations (diagonal step) to schema-mismatch, not internal", async () => {
    // Structurally valid per the guard (length≥2, integer in-bounds coords,
    // unique ids, unique cells) but violates 4-connectedness → placePath
    // throws inside solveTrace. CLI's try/catch around solveTrace must
    // re-emit this as schema-mismatch (exit 2), not leak to the
    // uncaughtException handler as 'internal' (exit 1).
    const { stdout, code } = await runCli(
      JSON.stringify({
        cols: 4,
        rows: 4,
        paths: [{ id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
      }),
    );
    expect(code).toBe(2);
    const out = JSON.parse(stdout);
    expect(out.kind).toBe("error");
    expect(out.reason).toBe("schema-mismatch");
  });

  it("rejects schema mismatch with exit 2 + reason='schema-mismatch'", async () => {
    // Missing rows field — structurally invalid LevelSpec.
    const { stdout, code } = await runCli(
      JSON.stringify({ cols: 4, paths: [] }),
    );
    expect(code).toBe(2);
    const out = JSON.parse(stdout);
    expect(out.kind).toBe("error");
    expect(out.reason).toBe("schema-mismatch");
  });

  it("rejects negative coordinates with schema-mismatch", async () => {
    const { stdout, code } = await runCli(
      JSON.stringify({
        cols: 4,
        rows: 4,
        paths: [{ id: 1, cells: [{ x: -1, y: 0 }, { x: 0, y: 0 }] }],
      }),
    );
    expect(code).toBe(2);
    const out = JSON.parse(stdout);
    expect(out.reason).toBe("schema-mismatch");
  });

  it("rejects single-cell paths (placePath invariant: length >= 2)", async () => {
    const { stdout, code } = await runCli(
      JSON.stringify({
        cols: 4,
        rows: 4,
        paths: [{ id: 1, cells: [{ x: 0, y: 0 }] }],
      }),
    );
    expect(code).toBe(2);
    const out = JSON.parse(stdout);
    expect(out.reason).toBe("schema-mismatch");
  });
});

describe("solver-check CLI — protocol guarantees", () => {
  it("stdout is pure JSON (no log lines mixed in)", async () => {
    const input = {
      cols: 2,
      rows: 1,
      paths: [{ id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }],
    };
    const { stdout } = await runCli(JSON.stringify(input));
    // Should parse cleanly with no leading/trailing non-JSON noise.
    // Allow a single trailing newline.
    const trimmed = stdout.trim();
    expect(() => JSON.parse(trimmed)).not.toThrow();
  });

  it("handles pretty-printed input (newlines inside JSON)", async () => {
    // solveTrace is stateless; CLI reads to EOF then parses. A pretty-
    // printed JSON with embedded newlines must work. Distinguishes
    // read-to-EOF from line-delimited framing.
    const input = {
      cols: 2,
      rows: 1,
      paths: [{ id: 1, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }],
    };
    const { stdout, code } = await runCli(JSON.stringify(input, null, 2));
    expect(code).toBe(0);
    expect(JSON.parse(stdout).kind).toBe("solved");
  });
});
