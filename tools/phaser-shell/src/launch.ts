// Launch the scratch P0 in the human-authenticated Phaser Editor session
// (U5, KTD-J; vendor-gated). This module is a THIN, honest descriptor: opening a
// real Editor GUI session is an environment/human step (P6), never repo
// automation (R13). It returns the exact loopback-only commands the operator
// runs — attaching to the already-running licensed Editor over the loopback CDP
// endpoint — so the rehearsal + provenance capture never touch the landing worktree.
export interface LaunchInstructions {
  vendorGated: true;
  boundary: string;
  project: string;
  steps: string[];
  note: string;
}

/**
 * Return the loopback-only launch instructions for opening a scratch project in
 * the human-authenticated Phaser Editor 5.0.2 session.
 */
export function launchInstructions(scratchProjectDir?: string): LaunchInstructions {
  const project = scratchProjectDir ?? '<run `cli reset` first to mint a scratch P0>';
  return {
    vendorGated: true,
    boundary: 'loopback-only (outbound blocked except 127.0.0.1); scrub account/private paths from evidence',
    project,
    steps: [
      'Confirm the licensed Phaser Editor 5.0.2 desktop session is running with --remote-debugging-port=9222.',
      'Attach over CDP at http://127.0.0.1:9222 (never a remote host).',
      `Open the SCRATCH project (never the landing worktree): open-project { project: "${project}" }.`,
      'Author/refine the seven scenes; the editor auto-compiles generated code on save.',
      'Record real-Editor provenance: delete generated output, CompileProject twice, compare hashes, save all seven scenes, then fully terminate/restart/reopen and re-verify.',
    ],
    note: 'Headless regeneration is unsupported (U2 finding 2); the generated code + P0/A/B publications are a measured vendor cost recorded in P6, not faked here.',
  };
}
