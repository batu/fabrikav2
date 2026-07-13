// Launch + capture real-Editor provenance for a scratch P0 (U5, KTD-J / P6 §6;
// vendor-gated). This is the EXECUTABLE launch/provenance verb: it opens the
// installed, human-authenticated Phaser Editor 5 session loopback-only against an
// explicit scratch (never the landing worktree — R13) and runs the full provenance
// protocol via the session seam, returning a nonzero exit on any block. Opening a
// licensed GUI is a measured vendor cost (U2 finding 2); this driver performs it,
// it never fakes it, and it emits only scrubbed hash-only evidence.
import { captureProvenance, type CaptureResult } from './session/index.ts';

export interface LaunchOutcome {
  /** Process exit code: 0 when provenance is ok, nonzero when blocked. */
  code: number;
  result: CaptureResult;
}

/**
 * Parse `<scratch> [--out <path>] [--port <n>]` and run the provenance capture.
 * Returns the scrubbed evidence and a 0/1 exit code (nonzero on block).
 */
export async function runLaunch(argv: readonly string[]): Promise<LaunchOutcome> {
  const positional: string[] = [];
  let output: string | undefined;
  let port: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') output = argv[++i];
    else if (arg === '--port') port = Number(argv[++i]);
    else positional.push(arg);
  }
  const result = await captureProvenance({ scratch: positional[0], output, port });
  return { code: result.result === 'ok' ? 0 : 1, result };
}
