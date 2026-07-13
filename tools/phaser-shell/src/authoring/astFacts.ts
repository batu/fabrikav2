// AST-fact parity for generated Phaser Editor scene code (U5, KTD-D).
//
// Headless regeneration is unsupported, so the real Editor owns generated
// modules. Publication parses those modules with the preseeded TypeScript API
// and proves that every editable scene fact survived generation: semantic
// carrier, object type, geometry, texture, copy, color, visibility, parent, and
// sibling order. Any mismatch is blocked as drift; unsafe imports and user-code
// calls are blocked separately.
import ts from 'typescript';
import type { SceneDoc, SemanticObject } from './sceneModel.ts';
import type { Block } from '../publish/safety.ts';

const CARRIER_PROPS = new Set(['fabSemanticId', 'fabRole', 'fabBinding', 'fabSlot', 'fabVariant']);
const BANNED_CALLS = new Set(['fetch', 'eval', 'XMLHttpRequest', 'WebSocket', 'require', 'importScripts']);

interface GeometryFact {
  x: number;
  y: number;
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
  width: number | null;
  height: number | null;
}

interface VisualFact extends GeometryFact {
  type: string;
  textureKey: string | null;
  copy: string | null;
  color: number | string | null;
  visible: boolean;
  order: number;
  parent: string | null;
}

export interface GeneratedFact extends VisualFact {
  semanticId: string;
  role: string;
  binding: string;
  slot: string;
  variant: string;
}

interface ObjectRecord extends Omit<VisualFact, 'order' | 'parent'> {
  created: number;
  parentVar: string | null;
  order: number;
}

/** Facts the scene authority declares, keyed by semantic id + variant. */
export interface SceneFact extends VisualFact {
  semanticId: string;
  role: string;
  binding: string;
  slot: string;
  variant: string;
}

export function factKey(semanticId: string, variant: string): string {
  return `${semanticId} ${variant}`;
}

function sceneParentKey(obj: SemanticObject, byUuid: ReadonlyMap<string, SemanticObject>): string | null {
  if (!obj.parentUuid) return null;
  const parent = byUuid.get(obj.parentUuid);
  return parent ? factKey(parent.carrier.fabSemanticId, parent.carrier.fabVariant) : null;
}

/** Build the scene-authority facts a generated module must reproduce exactly. */
export function sceneFacts(doc: SceneDoc): Map<string, SceneFact> {
  const facts = new Map<string, SceneFact>();
  const byUuid = new Map(doc.objects.map((obj) => [obj.uuid, obj]));
  for (const obj of doc.objects) {
    const fact: SceneFact = {
      semanticId: obj.carrier.fabSemanticId,
      role: obj.carrier.fabRole,
      binding: obj.carrier.fabBinding,
      slot: obj.carrier.fabSlot,
      variant: obj.carrier.fabVariant,
      type: obj.type,
      x: obj.geometry.x,
      y: obj.geometry.y,
      originX: obj.geometry.originX,
      originY: obj.geometry.originY,
      scaleX: obj.geometry.scaleX,
      scaleY: obj.geometry.scaleY,
      width: obj.geometry.width,
      height: obj.geometry.height,
      textureKey: obj.textureKey,
      copy: obj.copy,
      color: obj.color,
      visible: obj.visible,
      order: obj.order,
      parent: sceneParentKey(obj, byUuid),
    };
    facts.set(factKey(fact.semanticId, fact.variant), fact);
  }
  return facts;
}

function stringLiteral(node: ts.Node | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function numberLiteral(node: ts.Node | undefined): number | null {
  if (!node) return null;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node)
    && node.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(node.operand)
  ) return -Number(node.operand.text);
  return null;
}

function booleanLiteral(node: ts.Node | undefined): boolean | null {
  if (!node) return null;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return null;
}

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  return null;
}

function objectProperty(object: ts.ObjectLiteralExpression, wanted: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || propertyName(property.name) !== wanted) continue;
    return property.initializer;
  }
  return undefined;
}

/** Is this call `this.add.image(...)` / `text(...)` / `container(...)`? */
function addFactoryKind(call: ts.CallExpression): { kind: string; args: ts.NodeArray<ts.Expression> } | null {
  const expr = call.expression;
  if (!ts.isPropertyAccessExpression(expr)) return null;
  const inner = expr.expression;
  if (!ts.isPropertyAccessExpression(inner)) return null;
  if (inner.name.text !== 'add' || inner.expression.kind !== ts.SyntaxKind.ThisKeyword) return null;
  return { kind: expr.name.text, args: call.arguments };
}

function recordForFactory(kind: string, args: ts.NodeArray<ts.Expression>, created: number): ObjectRecord {
  return {
    type: kind,
    x: numberLiteral(args[0]) ?? 0,
    y: numberLiteral(args[1]) ?? 0,
    originX: 0.5,
    originY: 0.5,
    scaleX: 1,
    scaleY: 1,
    width: null,
    height: null,
    textureKey: kind === 'image' || kind === 'sprite' || kind === 'nineslice'
      ? stringLiteral(args[2])
      : null,
    copy: null,
    color: null,
    visible: true,
    created,
    parentVar: null,
    order: -1,
  };
}

function setNumeric(record: ObjectRecord, field: keyof GeometryFact, node: ts.Node): void {
  const value = numberLiteral(node);
  if (value !== null) record[field] = value;
}

function applyMethodCall(record: ObjectRecord, method: string, args: ts.NodeArray<ts.Expression>): void {
  if (method === 'setOrigin') {
    setNumeric(record, 'originX', args[0]);
    setNumeric(record, 'originY', args[1] ?? args[0]);
  } else if (method === 'setScale') {
    setNumeric(record, 'scaleX', args[0]);
    setNumeric(record, 'scaleY', args[1] ?? args[0]);
  } else if (method === 'setSize' || method === 'setDisplaySize') {
    setNumeric(record, 'width', args[0]);
    setNumeric(record, 'height', args[1]);
  } else if (method === 'setVisible') {
    const value = booleanLiteral(args[0]);
    if (value !== null) record.visible = value;
  } else if (method === 'setTint') {
    const value = numberLiteral(args[0]);
    if (value !== null) record.color = value;
  } else if (method === 'setStyle' && args[0] && ts.isObjectLiteralExpression(args[0])) {
    const value = stringLiteral(objectProperty(args[0], 'color'));
    if (value !== null) record.color = value;
  }
}

function applyAssignment(record: ObjectRecord, prop: string, right: ts.Expression): void {
  if (prop === 'text') {
    const value = stringLiteral(right);
    if (value !== null) record.copy = value;
    return;
  }
  if (prop === 'visible') {
    const value = booleanLiteral(right);
    if (value !== null) record.visible = value;
    return;
  }
  if (prop === 'tint' || prop === 'fillColor') {
    const value = numberLiteral(right);
    if (value !== null) record.color = value;
    return;
  }
  const geometryField = {
    x: 'x', y: 'y', originX: 'originX', originY: 'originY',
    scaleX: 'scaleX', scaleY: 'scaleY', width: 'width', height: 'height',
    displayWidth: 'width', displayHeight: 'height',
  }[prop] as keyof GeometryFact | undefined;
  if (geometryField) setNumeric(record, geometryField, right);
}

/** Extract generated facts, import specifiers, and typed safety issues. */
export function extractGeneratedFacts(source: string): {
  facts: Map<string, GeneratedFact>;
  imports: string[];
  issues: Block[];
} {
  const sf = ts.createSourceFile('scene.ts', source, ts.ScriptTarget.ES2022, true);
  const objects = new Map<string, ObjectRecord>();
  const semanticToObject = new Map<string, string>();
  const carriers = new Map<string, Partial<GeneratedFact>>();
  const imports: string[] = [];
  const issues: Block[] = [];
  let created = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const varName = node.name.text;
      const init = node.initializer;
      if (ts.isCallExpression(init)) {
        const factory = addFactoryKind(init);
        if (factory) objects.set(varName, recordForFactory(factory.kind, factory.args, created++));
      }
      if (ts.isNewExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'Semantic') {
        const arg = init.arguments?.[0];
        if (arg && ts.isIdentifier(arg)) semanticToObject.set(varName, arg.text);
      }
    }
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left)
      && ts.isIdentifier(node.left.expression)
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
      } else {
        const record = objects.get(objName);
        if (record) applyAssignment(record, prop, node.right);
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const target = node.expression.expression;
      const method = node.expression.name.text;
      if (ts.isIdentifier(target)) {
        const record = objects.get(target.text);
        if (record) applyMethodCall(record, method, node.arguments);
        if (method === 'add' && node.arguments[0] && ts.isIdentifier(node.arguments[0])) {
          const child = objects.get(node.arguments[0].text);
          if (child && objects.has(target.text)) child.parentVar = target.text;
        }
      }
    }
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

  const siblings = new Map<string | null, ObjectRecord[]>();
  for (const record of objects.values()) {
    const group = siblings.get(record.parentVar) ?? [];
    group.push(record);
    siblings.set(record.parentVar, group);
  }
  for (const group of siblings.values()) {
    group.sort((a, b) => a.created - b.created).forEach((record, order) => { record.order = order; });
  }

  const carrierKeyByObject = new Map<string, string>();
  for (const [semVar, carrier] of carriers) {
    if (!carrier.semanticId) continue;
    const objVar = semanticToObject.get(semVar);
    if (objVar) carrierKeyByObject.set(objVar, factKey(carrier.semanticId, carrier.variant ?? ''));
  }
  const nearestSemanticParent = (record: ObjectRecord): string | null => {
    let parent = record.parentVar;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const key = carrierKeyByObject.get(parent);
      if (key) return key;
      parent = objects.get(parent)?.parentVar ?? null;
    }
    return null;
  };

  const facts = new Map<string, GeneratedFact>();
  for (const [semVar, carrier] of carriers) {
    if (!carrier.semanticId) continue;
    const objVar = semanticToObject.get(semVar);
    const obj = objVar ? objects.get(objVar) : undefined;
    if (!obj) continue;
    const fact: GeneratedFact = {
      semanticId: carrier.semanticId,
      role: carrier.role ?? '',
      binding: carrier.binding ?? '',
      slot: carrier.slot ?? '',
      variant: carrier.variant ?? '',
      type: obj.type,
      x: obj.x,
      y: obj.y,
      originX: obj.originX,
      originY: obj.originY,
      scaleX: obj.scaleX,
      scaleY: obj.scaleY,
      width: obj.width,
      height: obj.height,
      textureKey: obj.textureKey,
      copy: obj.copy,
      color: obj.color,
      visible: obj.visible,
      order: obj.order,
      parent: nearestSemanticParent(obj),
    };
    const key = factKey(fact.semanticId, fact.variant);
    if (facts.has(key)) {
      issues.push({ code: 'blocked-drift', where: `generated:${key}`, detail: 'duplicate generated semantic fact' });
    }
    facts.set(key, fact);
  }
  return { facts, imports, issues };
}

/** True when an import specifier stays inside the closed local generated graph. */
export function isAllowedImport(specifier: string, moduleRelDir = 'scenes'): boolean {
  if (specifier === 'phaser') return true;
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
  const stack: string[] = [];
  for (const part of `${moduleRelDir}/${specifier}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return false;
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return true;
}

function sameType(generated: string, scene: string): boolean {
  return generated.toLowerCase() === scene.toLowerCase();
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
    const generated = facts.get(key);
    if (!generated) {
      blocks.push({ code: 'blocked-drift', where: `${scene.sceneKey}:${sceneFact.semanticId}`, detail: 'scene object missing from generated code' });
      continue;
    }
    if (!sameType(generated.type, sceneFact.type)) {
      blocks.push({
        code: 'blocked-drift',
        where: `${scene.sceneKey}:${sceneFact.semanticId}`,
        detail: `generated type "${generated.type}" != scene "${sceneFact.type}"`,
      });
    }
    for (const field of [
      'role', 'binding', 'slot', 'textureKey', 'copy', 'x', 'y', 'originX', 'originY',
      'scaleX', 'scaleY', 'width', 'height', 'color', 'visible', 'order', 'parent',
    ] as const) {
      if ((generated[field] ?? null) !== (sceneFact[field] ?? null)) {
        blocks.push({
          code: 'blocked-drift',
          where: `${scene.sceneKey}:${sceneFact.semanticId}`,
          detail: `generated ${field} "${generated[field]}" != scene "${sceneFact[field]}"`,
        });
      }
    }
  }
  for (const key of facts.keys()) {
    if (!authority.has(key)) {
      blocks.push({ code: 'blocked-drift', where: `${scene.sceneKey}:${key}`, detail: 'unexpected generated semantic object' });
    }
  }
  return blocks;
}
