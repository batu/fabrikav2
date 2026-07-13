// AST-fact parity for generated Phaser Editor scene code (U5, KTD-D).
//
// Headless regeneration is unsupported (U2 finding 2), so U5 NEVER regenerates:
// the editor auto-compiles on save and U5 validates the committed generated code
// against the `.scene` authority by parsing it with the PRESEEDED TypeScript
// compiler API (no `acorn`; card comment 14). For each generated scene module it
// extracts the per-object facts the editor emits — semantic id, role, binding,
// slot, variant, texture key, copy — and diffs them against the scene. Any
// divergence is `blocked-drift`; a remote/bare/escaping import is
// `blocked-unsafe-import`; a call to a banned network/storage/eval API (user
// code outside the deterministic generated shape) is `blocked-user-code`.
import ts from 'typescript';
import type { SceneDoc } from './sceneModel.ts';
import type { Block } from '../publish/safety.ts';

const CARRIER_PROPS = new Set(['fabSemanticId', 'fabRole', 'fabBinding', 'fabSlot', 'fabVariant']);
const BANNED_CALLS = new Set(['fetch', 'eval', 'XMLHttpRequest', 'WebSocket', 'require', 'importScripts']);

export interface GeneratedFact {
  semanticId: string;
  role: string;
  binding: string;
  slot: string;
  variant: string;
  textureKey: string | null;
  copy: string | null;
}

interface ObjectRecord {
  textureKey: string | null;
  copy: string | null;
}

/** Facts the scene authority declares, keyed by `${semanticId} ${variant}`. */
export interface SceneFact {
  semanticId: string;
  role: string;
  binding: string;
  slot: string;
  variant: string;
  textureKey: string | null;
  copy: string | null;
}

export function factKey(semanticId: string, variant: string): string {
  return `${semanticId} ${variant}`;
}

/** Build the scene-authority facts a generated module must reproduce exactly. */
export function sceneFacts(doc: SceneDoc): Map<string, SceneFact> {
  const facts = new Map<string, SceneFact>();
  for (const obj of doc.objects) {
    const fact: SceneFact = {
      semanticId: obj.carrier.fabSemanticId,
      role: obj.carrier.fabRole,
      binding: obj.carrier.fabBinding,
      slot: obj.carrier.fabSlot,
      variant: obj.carrier.fabVariant,
      textureKey: obj.textureKey,
      copy: obj.copy,
    };
    facts.set(factKey(fact.semanticId, fact.variant), fact);
  }
  return facts;
}

function stringLiteral(node: ts.Node | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

/** Is this call `this.add.image(...)` / `this.add.text(...)` / `this.add.container(...)`? */
function addFactoryKind(call: ts.CallExpression): { kind: string; args: ts.NodeArray<ts.Expression> } | null {
  const expr = call.expression;
  if (!ts.isPropertyAccessExpression(expr)) return null;
  const inner = expr.expression;
  if (!ts.isPropertyAccessExpression(inner)) return null;
  if (inner.name.text !== 'add' || inner.expression.kind !== ts.SyntaxKind.ThisKeyword) return null;
  return { kind: expr.name.text, args: call.arguments };
}

/**
 * Extract the generated facts, import specifiers, and any user-code/import
 * issues from a generated scene module source.
 */
export function extractGeneratedFacts(source: string): {
  facts: Map<string, GeneratedFact>;
  imports: string[];
  issues: Block[];
} {
  const sf = ts.createSourceFile('scene.ts', source, ts.ScriptTarget.ES2022, true);
  const objects = new Map<string, ObjectRecord>(); // gameObject var -> record
  const semanticToObject = new Map<string, string>(); // semantic var -> gameObject var
  const carriers = new Map<string, Partial<GeneratedFact>>(); // semantic var -> carrier fields
  const imports: string[] = [];
  const issues: Block[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
    // const X = this.add.image(a,b,"key")  |  const XSemantic = new Semantic(obj)
    if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.initializer) {
      const varName = node.name.text;
      const init = node.initializer;
      if (ts.isCallExpression(init)) {
        const factory = addFactoryKind(init);
        if (factory) {
          const textureKey = factory.kind === 'image' ? stringLiteral(factory.args[2]) : null;
          objects.set(varName, { textureKey, copy: null });
        }
      }
      if (ts.isNewExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'Semantic') {
        const arg = init.arguments?.[0];
        if (arg && ts.isIdentifier(arg)) semanticToObject.set(varName, arg.text);
      }
    }
    // X.prop = "literal"
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression)
    ) {
      const objName = node.left.expression.text;
      const prop = node.left.name.text;
      const value = stringLiteral(node.right);
      if (CARRIER_PROPS.has(prop) && value !== null) {
        const carrier = carriers.get(objName) ?? {};
        (carrier as Record<string, string>)[prop === 'fabSemanticId' ? 'semanticId'
          : prop === 'fabRole' ? 'role'
          : prop === 'fabBinding' ? 'binding'
          : prop === 'fabSlot' ? 'slot'
          : 'variant'] = value;
        carriers.set(objName, carrier);
      } else if (prop === 'text' && value !== null && objects.has(objName)) {
        objects.get(objName)!.copy = value;
      }
    }
    // Banned call → user code.
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)
          ? callee.name.text
          : '';
      if (BANNED_CALLS.has(name)) {
        issues.push({ code: 'blocked-user-code', where: 'generated', detail: `banned call "${name}()"` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const facts = new Map<string, GeneratedFact>();
  for (const [semVar, carrier] of carriers) {
    if (!carrier.semanticId) continue;
    const objVar = semanticToObject.get(semVar);
    const obj = objVar ? objects.get(objVar) : undefined;
    const fact: GeneratedFact = {
      semanticId: carrier.semanticId,
      role: carrier.role ?? '',
      binding: carrier.binding ?? '',
      slot: carrier.slot ?? '',
      variant: carrier.variant ?? '',
      textureKey: obj?.textureKey ?? null,
      copy: obj?.copy ?? null,
    };
    facts.set(factKey(fact.semanticId, fact.variant), fact);
  }
  return { facts, imports, issues };
}

/**
 * True when an import specifier is inside the closed local generated graph.
 * `phaser` and relative imports that resolve WITHIN the project `src/` root are
 * allowed; bare non-phaser packages, remote URLs, and relative imports that
 * escape the src root are rejected. `moduleRelDir` is the importing module's
 * directory relative to the project src root (generated scenes live in `scenes`).
 */
export function isAllowedImport(specifier: string, moduleRelDir = 'scenes'): boolean {
  if (specifier === 'phaser') return true;
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return false; // bare non-phaser package or remote URL
  }
  const stack: string[] = [];
  for (const part of `${moduleRelDir}/${specifier}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return false; // escapes above the project src root
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return true;
}

/** Diff a generated module against the scene authority, returning typed blocks. */
export function verifyGeneratedModule(source: string, scene: SceneDoc, moduleRelDir = 'scenes'): Block[] {
  const blocks: Block[] = [];
  const { facts, imports, issues } = extractGeneratedFacts(source);
  blocks.push(...issues);

  for (const specifier of imports) {
    if (!isAllowedImport(specifier, moduleRelDir)) {
      blocks.push({ code: 'blocked-unsafe-import', where: 'generated', detail: `import "${specifier}"` });
    }
  }

  const authority = sceneFacts(scene);
  for (const [key, sceneFact] of authority) {
    const gen = facts.get(key);
    if (!gen) {
      blocks.push({ code: 'blocked-drift', where: `${scene.sceneKey}:${sceneFact.semanticId}`, detail: 'scene object missing from generated code' });
      continue;
    }
    for (const field of ['role', 'binding', 'slot', 'textureKey', 'copy'] as const) {
      if ((gen[field] ?? null) !== (sceneFact[field] ?? null)) {
        blocks.push({
          code: 'blocked-drift',
          where: `${scene.sceneKey}:${sceneFact.semanticId}`,
          detail: `generated ${field} "${gen[field]}" != scene "${sceneFact[field]}"`,
        });
      }
    }
  }
  return blocks;
}
