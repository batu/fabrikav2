// Deterministic derivation of the single canonical runtime projection module
// `scenes/shell.js` from the accepted Editor-generated TypeScript graph
// (U5, KTD-D/KTD-G, card comment 15 §2/§11).
//
// The publisher NEVER accepts caller-provided runtime bytes: `scenes/shell.js` is
// a pure function of the accepted generated `.ts` graph (the seven scene modules
// plus the `Semantic` user-component), so a source change necessarily moves the
// output bytes and arbitrary bytes cannot be injected. Derivation uses ONLY the
// preseeded TypeScript compiler API (no added dependency, lock unchanged): for
// each module it strips the TypeScript type annotations and the Phaser Editor
// user-code MARKER COMMENTS (`/* START-USER-… */`, `/* … COMPILED CODE */`),
// drops the per-module `import` statements, renames the Editor-only `editorCreate`
// build method to a neutral `build` (so the runtime bundle carries no editor
// footprint), then concatenates the type-stripped classes into ONE ES module
// that binds Phaser from the runtime global/local contract (`globalThis.Phaser`)
// and exports a stable seven-state registry + bootstrap the browser render proof
// drives.
//
// AST-fact parity against the `.scene` authority is verified FIRST by the caller
// (publish.ts) — this module only transforms an already-accepted graph.
import ts from 'typescript';
import type { ShellStateIdV2 } from '@fabrikav2/kernel';
import { STATE_IDS, CANVAS } from '../authoring/extractV2.ts';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The accepted generated module graph a runtime bundle is derived from. */
export interface RuntimeGraph {
  /** Accepted generated scene module source, keyed by state id (`Menu.ts`, …). */
  scenesByState: ReadonlyMap<ShellStateIdV2, string>;
  /** Accepted generated `Semantic` user-component module source (`Semantic.ts`). */
  semanticSource: string;
}

/** A generated module required by the derivation was absent. */
export class RuntimeDeriveError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeDeriveError';
  }
}

/**
 * Type-strip transformer: drop imports, strip a class's `export`/`default`
 * modifiers (the modules are concatenated and re-exported through the registry),
 * and rename the Editor-only `editorCreate` build method to the neutral `build`.
 */
function neutralize(): ts.TransformerFactory<ts.SourceFile> {
  return (ctx) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isImportDeclaration(node)) return undefined;
      if (ts.isClassDeclaration(node)) {
        const modifiers = (node.modifiers ?? []).filter(
          (m) => m.kind !== ts.SyntaxKind.ExportKeyword && m.kind !== ts.SyntaxKind.DefaultKeyword,
        );
        return ctx.factory.updateClassDeclaration(
          node,
          modifiers,
          node.name,
          node.typeParameters,
          node.heritageClauses,
          node.members.map((member) => ts.visitNode(member, visit) as ts.ClassElement),
        );
      }
      if (ts.isIdentifier(node) && node.text === 'editorCreate') {
        return ctx.factory.createIdentifier('build');
      }
      return ts.visitEachChild(node, visit, ctx);
    };
    return (sf) => ts.visitNode(sf, visit) as ts.SourceFile;
  };
}

/** Type- and marker-strip one generated module to a bare class declaration. */
function stripModule(source: string, label: string): string {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      newLine: ts.NewLineKind.LineFeed,
    },
    transformers: { before: [neutralize()] },
    reportDiagnostics: true,
  });
  if (result.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    throw new RuntimeDeriveError('generated-diagnostics', `${label} has TypeScript diagnostics`);
  }
  const output = result.outputText;
  // Drop transpile's synthetic empty-module marker; the registry adds the real
  // exports. Every module contributes a bare `class …` declaration only.
  return output
    .split('\n')
    .filter((line) => line.trim() !== 'export {};')
    .join('\n')
    .trimEnd();
}

/**
 * Derive the canonical `scenes/shell.js` bytes from the accepted generated graph.
 * Deterministic: fixed module order (canonical state order), fixed compiler
 * options, and a fixed registry shape make two clean derivations byte-identical.
 */
export function deriveRuntimeBundle(graph: RuntimeGraph): Buffer {
  const header = [
    '// scenes/shell.js — DERIVED canonical phaser-native runtime projection.',
    '// Do not edit. Deterministically derived from the accepted Editor-generated',
    '// TypeScript graph by the U5 publisher (types + user-code markers stripped).',
    '// Binds Phaser from the runtime global/local contract and exports a stable',
    '// seven-state registry + bootstrap for the browser render proof.',
    'const Phaser = globalThis.Phaser;',
  ].join('\n');

  const parts: string[] = [header, stripModule(graph.semanticSource, 'Semantic.ts')];
  for (const state of STATE_IDS) {
    const source = graph.scenesByState.get(state);
    if (source === undefined) {
      throw new RuntimeDeriveError('missing-generated-module', `no accepted generated module for state "${state}"`);
    }
    parts.push(stripModule(source, `${cap(state)}.ts`));
  }

  const entries = STATE_IDS.map((state) => `${state}: ${cap(state)}`).join(', ');
  const registry = [
    `export const states = ${JSON.stringify(STATE_IDS)};`,
    `export const scenes = { ${entries} };`,
    'export function boot(config) {',
    '  return new Phaser.Game({',
    '    type: Phaser.AUTO,',
    `    width: ${CANVAS.width},`,
    `    height: ${CANVAS.height},`,
    '    ...config,',
    '    scene: states.map((state) => scenes[state]),',
    '  });',
    '}',
    'export default { states, scenes, boot };',
  ].join('\n');
  parts.push(registry);

  return Buffer.from(parts.join('\n\n') + '\n', 'utf8');
}
