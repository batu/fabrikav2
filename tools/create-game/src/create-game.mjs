// create-game — scaffold a new game by copying games/_template and substituting
// the name. Deterministic, dependency-free, and side-effect-light: it writes a
// new games/<name>/ directory and prints next steps. It does NOT `git add`,
// install, or touch anything outside the new directory.
//
// Usage (from repo root):  npm run create-game -- <name>

import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE_NAME = '_template';
const NAME_RE = /^[a-z][a-z0-9_]*$/;
const SHARED_WORKSPACE_DEV_DEPS = [
  '@fabrikav2/kernel',
  '@fabrikav2/ui',
  '@fabrikav2/sdk',
  '@fabrikav2/testkit',
];

// Never copied into a new game (build/install artifacts).
const SKIP_ENTRIES = new Set(['node_modules', 'dist', 'coverage', '.DS_Store']);

/** Repo root, inferred from this file (tools/create-game/src/create-game.mjs). */
export function repoRootFrom(metaUrl) {
  const here = fileURLToPath(metaUrl);
  return join(here, '..', '..', '..', '..');
}

/** "marble_run" / "block-blast" -> "Marble Run" / "Block Blast". */
export function titleCase(name) {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** Reverse-domain-safe app id segment: strip everything but [a-z0-9]. */
function appIdSegment(name) {
  return name.replace(/[^a-z0-9]/g, '');
}

/** Read a file, apply anchored replacements, write it back. Missing file = skip. */
function substitute(path, replacements) {
  if (!existsSync(path)) return;
  let text = readFileSync(path, 'utf8');
  for (const [from, to] of replacements) text = text.split(from).join(to);
  writeFileSync(path, text);
}

function gameDevDependencies(existing = {}) {
  const shared = Object.fromEntries(SHARED_WORKSPACE_DEV_DEPS.map((dep) => [dep, '*']));
  const nonShared = Object.fromEntries(
    Object.entries(existing).filter(([dep]) => !SHARED_WORKSPACE_DEV_DEPS.includes(dep)),
  );
  return { ...shared, ...nonShared };
}

function generatedReadme({ name, packageName, title }) {
  return `# ${title}

\`${name}\` is a v2 game scaffold created with \`npm run create-game -- ${name}\`.

This workspace starts from the shared template and is ready for a game-specific
design pass. Keep gameplay code in \`src/\`, source references in \`refs/\`,
promoted evidence in \`evidence/\`, and design-owned copy, tokens, and assets in
\`design/\`.

Shared workspace dependencies are declared up front: \`@fabrikav2/kernel\`,
\`@fabrikav2/ui\`, \`@fabrikav2/sdk\`, and \`@fabrikav2/testkit\`.

Native shell inputs live in \`native-resources/\`. Before the first device run,
create the generated shell with \`npx cap add ios\` or \`npx cap add android\`;
\`verify-device\` reapplies the committed recipe after \`cap sync\`. For iOS
signing, set \`DEVELOPMENT_TEAM=<team id>\` in the environment instead of
hard-coding it in the generated Xcode project.

Useful checks:

- \`npm run typecheck -w ${packageName}\`
- \`npm run test:unit -w ${packageName}\`
- \`npm run audit\`
`;
}

function generatedBrief({ name, title }) {
  return `# ${title} - design brief

Game id: \`${name}\`

Replace this scaffolded brief with the game-specific design contract. Keep the
title and game id above so agents can identify the workspace while the design is
still being authored.

## What it is
One paragraph for ${title}: the mechanic, the fantasy, and the session shape.

## Feel
The 3-5 adjectives ${title} should evoke, plus any motion or juice references
from \`refs/\`.

## Constraints
Platform targets, monetization posture, content scope, and anything a
contributor must not break.
`;
}

/**
 * Scaffold games/<name>/ from games/_template.
 * @param {{name:string, repoRoot:string}} opts
 * @returns {{targetDir:string, packageName:string, title:string}}
 */
export function createGame({ name, repoRoot }) {
  if (!name || !NAME_RE.test(name)) {
    throw new Error(
      `invalid game name ${JSON.stringify(name)} — use lowercase letters, digits, and _ (must start with a letter), e.g. "marble_run"`,
    );
  }
  if (name === TEMPLATE_NAME) {
    throw new Error(`"${TEMPLATE_NAME}" is the template itself — pick a game name`);
  }

  const templateDir = join(repoRoot, 'games', TEMPLATE_NAME);
  const targetDir = join(repoRoot, 'games', name);
  if (!existsSync(templateDir)) {
    throw new Error(`template not found at ${templateDir}`);
  }
  if (existsSync(targetDir)) {
    throw new Error(`games/${name} already exists — refusing to overwrite`);
  }

  cpSync(templateDir, targetDir, {
    recursive: true,
    filter: (src) => !SKIP_ENTRIES.has(basename(src)),
  });

  const title = titleCase(name);
  const packageName = `@fabrikav2/${name}`;
  const appId = `com.fabrika.${appIdSegment(name)}`;

  // package.json: bump the name (JSON, so rewrite the field precisely).
  const pkgPath = join(targetDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.name = packageName;
  delete pkg.description; // the template's "copied by create-game" note no longer applies
  pkg.devDependencies = gameDevDependencies(pkg.devDependencies);
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  // Anchored text substitutions across config + titles. The game title is a
  // copy KEY in game.config.ts; the human title lives in design/copy.ts, so we
  // substitute the "game.title" copy value there (not a literal in the config).
  substitute(join(targetDir, 'game.config.ts'), [['id: "template"', `id: "${name}"`]]);
  substitute(join(targetDir, 'design', 'copy.ts'), [
    ['"game.title": "Template Game"', `"game.title": "${title}"`],
  ]);
  substitute(join(targetDir, 'index.html'), [['<title>Template Game</title>', `<title>${title}</title>`]]);
  substitute(join(targetDir, 'capacitor.config.ts'), [
    ['appId: "com.fabrika.template"', `appId: "${appId}"`],
    ['appName: "Template Game"', `appName: "${title}"`],
  ]);
  substitute(join(targetDir, 'native-resources', 'ios', 'App', 'Info.plist'), [
    ['<string>Template Game</string>', `<string>${title}</string>`],
  ]);
  substitute(join(targetDir, 'native-resources', 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'), [
    ['Template Game', title],
    ['com.fabrika.template', appId],
  ]);
  substitute(join(targetDir, 'refs', 'manifest.yaml'), [
    ['game: template', `game: ${name}`],
    ['package: com.fabrikav2.template', `package: com.fabrikav2.${name}`],
  ]);
  writeFileSync(join(targetDir, 'README.md'), generatedReadme({ name, packageName, title }));
  writeFileSync(join(targetDir, 'docs', 'brief.md'), generatedBrief({ name, title }));

  return { targetDir, packageName, title };
}

function main() {
  const name = process.argv[2];
  const repoRoot = repoRootFrom(import.meta.url);
  let result;
  try {
    result = createGame({ name, repoRoot });
  } catch (err) {
    console.error(`create-game: ${err.message}`);
    process.exit(1);
  }

  const rel = `games/${name}`;
  console.log(`Created ${rel} (${result.packageName})\n`);
  console.log('Next steps:');
  console.log('  1. npm install                          # link the new workspace');
  console.log(`  2. npm run typecheck -w ${result.packageName}`);
  console.log(`  3. npm run test:unit -w ${result.packageName}`);
  console.log('  4. npm run audit                        # structure + guardrail linters');
  console.log(`  5. edit ${rel}/game.config.ts, ${rel}/docs/brief.md, and run the design-sheets round-trip`);
  console.log('\nNothing was git-added or installed — review, then commit when ready.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
