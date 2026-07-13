// The single Phaser authoring/publisher CLI (U5, KTD-H). U5 owns the base
// verbs `validate` / `preflight` / `status` / `proof` / `reset` / `launch`
// (and `publish`); U6 EXTENDS/composes these base handlers and adds `apply` —
// it never duplicates them. Run under tsx (imports the lane's .ts modules).
import process from 'node:process';
import { validateProject } from './publish/validate.ts';
import { preflight } from './publish/preflight.ts';
import { status } from './publish/status.ts';
import { offlineProof } from './publish/proof.ts';
import { loadCommittedProject } from './loadProject.ts';
import { resetToScratch } from './reset.ts';
import { runLaunch } from './launch.ts';

function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

async function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case 'validate': {
      const result = validateProject(loadCommittedProject());
      print(result);
      return result.result === 'ok' ? 0 : 1;
    }
    case 'preflight': {
      const result = await preflight(loadCommittedProject(), rest[0]);
      print(result);
      return result.result === 'ok' ? 0 : 1;
    }
    case 'status': {
      if (!rest[0]) { process.stderr.write('usage: cli status <publicationDir>\n'); return 2; }
      const result = await status(rest[0]);
      print(result);
      return result.outcome === 'ready' ? 0 : 1;
    }
    case 'proof': {
      if (!rest[0]) { process.stderr.write('usage: cli proof <publicationDir>\n'); return 2; }
      const result = await offlineProof(rest[0]);
      print(result);
      return result.ok ? 0 : 1;
    }
    case 'reset': {
      const result = await resetToScratch(rest[0]);
      print(result);
      return 0;
    }
    case 'launch': {
      // Executes the real-Editor provenance protocol against an explicit scratch
      // (vendor-gated); prints scrubbed hash-only evidence and returns nonzero on
      // block. Usage: cli launch <scratch> [--out <path>] [--port <n>].
      if (!rest[0]) { process.stderr.write('usage: cli launch <scratch> [--out <path>] [--port <n>]\n'); return 2; }
      const { code, result } = await runLaunch(rest);
      print(result.evidence);
      process.stderr.write(`evidence: ${result.evidencePath}\n`);
      return code;
    }
    case 'publish': {
      // Publishing requires the accepted GUI-compiled generated `.ts` + the
      // runtime `scenes/shell.js` bundle, which are produced by the vendor-gated
      // P6 leg. The editor-free `publish()` API is exercised by the unit suite
      // with a synthesized bundle; the committed P0/A/B set is published in P6.
      print({
        result: 'unavailable',
        detail:
          'publish requires the GUI-compiled generated code + runtime bundle (P6, vendor-gated). '
          + 'Use `validate` for editor-free checks; the publisher API is unit-tested (determinism/atomicity/manifest/handoff).',
      });
      return 0;
    }
    case 'verify-authoring': {
      // Editor-free card verification leg: validate the committed project. The
      // npm `verify-authoring` script chains typecheck + unit + lint around this.
      const result = validateProject(loadCommittedProject());
      print(result);
      return result.result === 'ok' ? 0 : 1;
    }
    default:
      process.stderr.write('usage: cli <validate|preflight|status|proof|reset|launch|publish|verify-authoring>\n');
      return 2;
  }
}

main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`cli error: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
