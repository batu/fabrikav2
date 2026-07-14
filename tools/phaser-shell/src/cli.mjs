// The single Phaser authoring/publisher CLI (U5, KTD-H). U5 owns the base
// verbs `validate` / `preflight` / `status` / `proof` / `reset` / `launch` and
// `publish`; U6 EXTENDS/composes these base handlers and adds `apply` — it never
// duplicates them. Run under tsx (imports the lane's .ts modules). `run(argv)` is
// exported for tests; the module only self-executes when invoked directly.
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { validateProject } from './publish/validate.ts';
import { preflight } from './publish/preflight.ts';
import { status } from './publish/status.ts';
import { offlineProof } from './publish/proof.ts';
import { publish } from './publish/publish.ts';
import { loadCommittedProject, loadScratchProject, COMMITTED_PUBLICATIONS_ROOT } from './loadProject.ts';
import { resetToScratch } from './reset.ts';
import { runLaunch } from './launch.ts';

function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

/** Parse `<scratch> [--out <publicationRoot>]`; returns null on a usage error. */
function parsePublishArgs(rest) {
  let scratch;
  let outputRoot = COMMITTED_PUBLICATIONS_ROOT;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--out') {
      outputRoot = rest[++i];
      if (outputRoot === undefined) return null;
    } else if (scratch === undefined) {
      scratch = rest[i];
    } else {
      return null;
    }
  }
  if (scratch === undefined) return null;
  return { scratch, outputRoot };
}

export async function run(argv) {
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
      // Publish a session-validated scratch (minted by `reset`, GUI-compiled in
      // P6) into an immutable publication. The scratch MUST be outside the landing
      // worktree; the runtime bundle is DERIVED from the accepted generated graph,
      // never supplied. A block (bad scratch / graph / validation) returns nonzero
      // and writes NOTHING to the output root.
      const args = parsePublishArgs(rest);
      if (!args) { process.stderr.write('usage: cli publish <scratch> [--out <publicationRoot>]\n'); return 2; }
      let input;
      try {
        input = loadScratchProject(args.scratch, args.outputRoot);
      } catch (err) {
        print({ result: 'blocked', code: err && err.code ? err.code : 'load-error', detail: err && err.message ? err.message : String(err) });
        return 1;
      }
      const result = await publish(input);
      print(result);
      return result.result === 'blocked' ? 1 : 0;
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

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  run(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`cli error: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}
