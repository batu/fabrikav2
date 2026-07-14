// AST-fact parity for generated Phaser Editor scene code (U5, KTD-D).
//
// Headless regeneration is unsupported, so the real Editor owns generated
// modules. Publication parses those modules with the preseeded TypeScript API
// and proves that every editable scene fact survived generation: semantic
// carrier, object type, geometry, texture, copy, color, visibility, parent, and
// sibling order. Any mismatch is blocked as drift; unsafe imports and user-code
// calls are blocked separately.
import ts from 'typescript';
import { sceneCreationFacts, type SceneDoc, type SemanticObject } from './sceneModel.ts';
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

interface CreationAppearanceFact {
  alpha: number | null;
  fontFamily: string | null;
  fontSize: number | string | null;
  fillAlpha: number | null;
  strokeColor: number | string | null;
  strokeAlpha: number | null;
  lineWidth: number | null;
  isFilled: boolean | null;
  isStroked: boolean | null;
  rounded: number | null;
}

export interface GeneratedFact extends VisualFact {
  semanticId: string;
  role: string;
  binding: string;
  slot: string;
  variant: string;
}

interface ObjectRecord extends Omit<VisualFact, 'order' | 'parent'>, CreationAppearanceFact {
  created: number;
  attached: number | null;
  parentVar: string | null;
  order: number;
}

export interface GeneratedCreationFact extends GeometryFact, CreationAppearanceFact {
  path: string;
  type: string;
  textureKey: string | null;
  copy: string | null;
  color: number | string | null;
  visible: boolean;
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
  const record: ObjectRecord = {
    type: kind,
    x: numberLiteral(args[0]) ?? 0,
    y: numberLiteral(args[1]) ?? 0,
    originX: kind === 'text' ? 0 : 0.5,
    originY: kind === 'text' ? 0 : 0.5,
    scaleX: 1,
    scaleY: 1,
    width: kind === 'rectangle' ? numberLiteral(args[2]) : null,
    height: kind === 'rectangle' ? numberLiteral(args[3]) : null,
    textureKey: kind === 'image' || kind === 'sprite' || kind === 'nineslice'
      ? stringLiteral(args[2])
      : null,
    copy: kind === 'text' ? stringLiteral(args[2]) : null,
    color: null,
    visible: true,
    alpha: null,
    fontFamily: null,
    fontSize: null,
    fillAlpha: null,
    strokeColor: null,
    strokeAlpha: null,
    lineWidth: null,
    isFilled: null,
    isStroked: null,
    rounded: null,
    created,
    attached: null,
    parentVar: null,
    order: -1,
  };
  if (kind === 'text' && args[3] && ts.isObjectLiteralExpression(args[3])) {
    applyTextStyle(record, args[3]);
  }
  return record;
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
  } else if (method === 'setRounded') {
    const value = numberLiteral(args[0]);
    if (value !== null) record.rounded = value;
  } else if (method === 'setStyle' && args[0] && ts.isObjectLiteralExpression(args[0])) {
    applyTextStyle(record, args[0]);
  }
}

function applyTextStyle(record: ObjectRecord, style: ts.ObjectLiteralExpression): void {
  const color = stringLiteral(objectProperty(style, 'color'));
  if (color !== null) record.color = color;
  const fontFamily = stringLiteral(objectProperty(style, 'fontFamily'));
  if (fontFamily !== null) record.fontFamily = fontFamily;
  const fontSizeNode = objectProperty(style, 'fontSize');
  const fontSize = stringLiteral(fontSizeNode) ?? numberLiteral(fontSizeNode);
  if (fontSize !== null) record.fontSize = fontSize;
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
  if (prop === 'isFilled' || prop === 'isStroked') {
    const value = booleanLiteral(right);
    if (value !== null) record[prop] = value;
    return;
  }
  if (prop === 'tint' || prop === 'fillColor') {
    const value = numberLiteral(right) ?? stringLiteral(right);
    if (value !== null) record.color = value;
    return;
  }
  if (prop === 'strokeColor') {
    const value = numberLiteral(right) ?? stringLiteral(right);
    if (value !== null) record.strokeColor = value;
    return;
  }
  const numericAppearanceField = {
    alpha: 'alpha', fillAlpha: 'fillAlpha', strokeAlpha: 'strokeAlpha', lineWidth: 'lineWidth',
  }[prop] as keyof Pick<CreationAppearanceFact, 'alpha' | 'fillAlpha' | 'strokeAlpha' | 'lineWidth'> | undefined;
  if (numericAppearanceField) {
    const value = numberLiteral(right);
    if (value !== null) record[numericAppearanceField] = value;
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
  creationFacts: Map<string, GeneratedCreationFact>;
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
  let attached = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const varName = node.name.text;
      const init = node.initializer;
      if (ts.isCallExpression(init)) {
        const factory = addFactoryKind(init);
        if (factory) {
          if (objects.has(varName)) {
            issues.push({ code: 'blocked-drift', where: `generated:${varName}`, detail: 'duplicate generated display variable' });
          } else {
            objects.set(varName, recordForFactory(factory.kind, factory.args, created++));
          }
        }
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
          if (child && objects.has(target.text)) {
            if (child.attached !== null || child.parentVar !== null) {
              issues.push({ code: 'blocked-drift', where: `generated:${node.arguments[0].text}`, detail: 'display object attached more than once' });
            } else {
              child.parentVar = target.text;
              child.attached = attached++;
            }
          }
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
  for (const [parent, group] of siblings) {
    group.sort((a, b) => parent === null
      ? a.created - b.created
      : (a.attached ?? Number.MAX_SAFE_INTEGER) - (b.attached ?? Number.MAX_SAFE_INTEGER))
      .forEach((record, order) => { record.order = order; });
  }

  const pathFor = (variable: string, visiting = new Set<string>()): string | null => {
    const record = objects.get(variable);
    if (!record || visiting.has(variable) || record.order < 0) return null;
    if (record.parentVar === null) return `${record.order}`;
    visiting.add(variable);
    const parentPath = pathFor(record.parentVar, visiting);
    visiting.delete(variable);
    return parentPath === null ? null : `${parentPath}/${record.order}`;
  };
  const creationFacts = new Map<string, GeneratedCreationFact>();
  for (const [variable, record] of objects) {
    const treePath = pathFor(variable);
    if (treePath === null) {
      issues.push({ code: 'blocked-drift', where: `generated:${variable}`, detail: 'display parent graph is cyclic or unresolved' });
      continue;
    }
    if (creationFacts.has(treePath)) {
      issues.push({ code: 'blocked-drift', where: `generated:${treePath}`, detail: 'duplicate generated display path' });
      continue;
    }
    creationFacts.set(treePath, {
      path: treePath,
      type: record.type,
      x: record.x,
      y: record.y,
      originX: record.originX,
      originY: record.originY,
      scaleX: record.scaleX,
      scaleY: record.scaleY,
      width: record.width,
      height: record.height,
      textureKey: record.textureKey,
      copy: record.copy,
      color: record.color,
      visible: record.visible,
      alpha: record.alpha,
      fontFamily: record.fontFamily,
      fontSize: record.fontSize,
      fillAlpha: record.fillAlpha,
      strokeColor: record.strokeColor,
      strokeAlpha: record.strokeAlpha,
      lineWidth: record.lineWidth,
      isFilled: record.isFilled,
      isStroked: record.isStroked,
      rounded: record.rounded,
    });
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
  return { facts, creationFacts, imports, issues };
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

function methodName(member: ts.ClassElement): string | null {
  const name = member.name;
  return name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) ? name.text : null;
}

function callPath(call: ts.CallExpression): string {
  const parts: string[] = [];
  let node: ts.Expression = call.expression;
  while (ts.isPropertyAccessExpression(node)) {
    parts.unshift(node.name.text);
    node = node.expression;
  }
  if (node.kind === ts.SyntaxKind.ThisKeyword) parts.unshift('this');
  else if (ts.isIdentifier(node)) parts.unshift(node.text);
  return parts.join('.');
}

const GENERATED_FACTORIES = new Set(['container', 'image', 'rectangle', 'text']);
const GENERATED_METHODS = new Set(['add', 'setOrigin', 'setRounded', 'setStyle']);
const GENERATED_TEXT_STYLE_PROPERTIES = new Set(['color', 'fontFamily', 'fontSize']);
const GENERATED_PROPERTIES = new Set([
  'alpha', 'fabBinding', 'fabRole', 'fabSemanticId', 'fabSlot', 'fabVariant',
  'fillAlpha', 'fillColor', 'isFilled', 'isStroked', 'lineWidth', 'scaleX',
  'scaleY', 'strokeAlpha', 'strokeColor', 'text', 'tint', 'visible',
]);

/** Values the Editor emits as inert constructor/property data (never executable expressions). */
function isGeneratedData(node: ts.Expression): boolean {
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
    || node.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isPrefixUnaryExpression(node)
    && (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken)
    && ts.isNumericLiteral(node.operand)) return true;
  if (ts.isArrayLiteralExpression(node)) return node.elements.every((item) => ts.isExpression(item) && isGeneratedData(item));
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((property) => ts.isPropertyAssignment(property)
      && propertyName(property.name) !== null
      && isGeneratedData(property.initializer));
  }
  return false;
}

function validFactory(factory: { kind: string; args: ts.NodeArray<ts.Expression> } | null): boolean {
  if (!factory || !GENERATED_FACTORIES.has(factory.kind) || !factory.args.every(isGeneratedData)) return false;
  const args = [...factory.args];
  if (factory.kind === 'container') return args.length === 2 && args.every((arg) => numberLiteral(arg) !== null);
  if (factory.kind === 'image') return args.length === 3
    && numberLiteral(args[0]) !== null && numberLiteral(args[1]) !== null && stringLiteral(args[2]) !== null;
  if (factory.kind === 'rectangle') return args.length === 4 && args.every((arg) => numberLiteral(arg) !== null);
  return factory.kind === 'text' && args.length === 4
    && numberLiteral(args[0]) !== null && numberLiteral(args[1]) !== null
    && stringLiteral(args[2]) !== null && ts.isObjectLiteralExpression(args[3])
    && validTextStyle(args[3]);
}

function validTextStyle(style: ts.ObjectLiteralExpression): boolean {
  const seen = new Set<string>();
  return style.properties.every((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = propertyName(property.name);
    if (!name || seen.has(name) || !GENERATED_TEXT_STYLE_PROPERTIES.has(name)) return false;
    seen.add(name);
    return name === 'fontSize'
      ? stringLiteral(property.initializer) !== null || numberLiteral(property.initializer) !== null
      : stringLiteral(property.initializer) !== null;
  });
}

function validGeneratedProperty(prop: string, value: ts.Expression, objectType: string | undefined): boolean {
  if (CARRIER_PROPS.has(prop)) {
    return objectType === undefined && stringLiteral(value) !== null;
  }
  if (prop === 'text') {
    return objectType === 'text' && stringLiteral(value) !== null;
  }
  if (prop === 'tint') {
    return objectType === 'image' && numberLiteral(value) !== null;
  }
  if (['fillAlpha', 'fillColor', 'isFilled', 'isStroked', 'lineWidth', 'strokeAlpha', 'strokeColor'].includes(prop)
    && objectType !== 'rectangle') {
    return false;
  }
  if (prop === 'scaleX' || prop === 'scaleY' || prop === 'alpha' || prop === 'visible') {
    if (objectType === undefined) return false;
  }
  if (prop === 'isFilled' || prop === 'isStroked' || prop === 'visible') {
    return booleanLiteral(value) !== null;
  }
  return numberLiteral(value) !== null;
}

function validGeneratedMethod(
  call: ts.CallExpression,
  declared: ReadonlySet<string>,
  objectTypes: ReadonlyMap<string, string>,
): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)
    || !ts.isIdentifier(call.expression.expression)
    || !declared.has(call.expression.expression.text)
    || !GENERATED_METHODS.has(call.expression.name.text)
    ) return false;
  const targetType = objectTypes.get(call.expression.expression.text);
  if (call.expression.name.text === 'add') {
    return call.arguments.length === 1
      && targetType === 'container'
      && ts.isIdentifier(call.arguments[0])
      && objectTypes.has(call.arguments[0].text);
  }
  if (!call.arguments.every(isGeneratedData)) return false;
  if (call.expression.name.text === 'setOrigin') {
    return targetType !== undefined
      && ['image', 'rectangle', 'text'].includes(targetType)
      && call.arguments.length === 2
      && call.arguments.every((arg) => numberLiteral(arg) !== null);
  }
  if (call.expression.name.text === 'setRounded') {
    return targetType === 'rectangle'
      && call.arguments.length === 1
      && numberLiteral(call.arguments[0]) !== null;
  }
  return targetType === 'text'
    && call.arguments.length === 1
    && ts.isObjectLiteralExpression(call.arguments[0])
    && validTextStyle(call.arguments[0]);
}

function verifyEditorCreateBody(body: ts.Block): Block[] {
  const blocks: Block[] = [];
  const declared = new Set<string>();
  const objectTypes = new Map<string, string>();
  const awakeIndexes = body.statements.flatMap((statement, index) => {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return [];
    return callPath(statement.expression) === 'this.events.emit'
      && statement.expression.arguments.length === 1
      && stringLiteral(statement.expression.arguments[0]) === 'scene-awake'
      ? [index]
      : [];
  });
  if (awakeIndexes.length !== 1 || awakeIndexes[0] !== body.statements.length - 1) {
    blocks.push({ code: 'blocked-user-code', where: 'generated:editorCreate', detail: 'scene-awake must be emitted exactly once as the final statement' });
  }
  for (const statement of body.statements) {
    // Validate and register declarations in source order. A second pass would
    // incorrectly make later declarations visible to earlier assignments or
    // container.add calls, admitting code that throws before the scene exists.
    if (ts.isVariableStatement(statement)) {
      if (statement.declarationList.flags !== ts.NodeFlags.Const) {
        blocks.push({ code: 'blocked-user-code', where: 'generated:editorCreate', detail: 'generated declarations must use const' });
        continue;
      }
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer
          || declared.has(declaration.name.text)) {
          blocks.push({ code: 'blocked-user-code', where: 'generated:editorCreate', detail: 'unsupported or duplicate generated declaration' });
          continue;
        }
        const init = declaration.initializer;
        const factory = ts.isCallExpression(init) ? addFactoryKind(init) : null;
        const validObjectFactory = validFactory(factory);
        const semantic = ts.isNewExpression(init)
          && ts.isIdentifier(init.expression)
          && init.expression.text === 'Semantic'
          && init.arguments?.length === 1
          && ts.isIdentifier(init.arguments[0])
          && objectTypes.has(init.arguments[0].text);
        if (!validObjectFactory && !semantic) {
          blocks.push({ code: 'blocked-user-code', where: 'generated:editorCreate', detail: `unsupported initializer for "${declaration.name.text}"` });
          continue;
        }
        if (factory && validObjectFactory) objectTypes.set(declaration.name.text, factory.kind);
        declared.add(declaration.name.text);
      }
      continue;
    }
    if (!ts.isExpressionStatement(statement)) {
      blocks.push({ code: 'blocked-user-code', where: 'generated:editorCreate', detail: 'unsupported generated statement' });
      continue;
    }
    const expression = statement.expression;
    if (ts.isBinaryExpression(expression)
      && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(expression.left)
      && ts.isIdentifier(expression.left.expression)
      && declared.has(expression.left.expression.text)
      && GENERATED_PROPERTIES.has(expression.left.name.text)
      && validGeneratedProperty(
        expression.left.name.text,
        expression.right,
        objectTypes.get(expression.left.expression.text),
      )) {
      continue;
    }
    if (ts.isCallExpression(expression)) {
      const path = callPath(expression);
      if ((path === 'this.events.emit'
          && expression.arguments.length === 1
          && stringLiteral(expression.arguments[0]) === 'scene-awake')
        || validGeneratedMethod(expression, declared, objectTypes)) {
        continue;
      }
    }
    blocks.push({ code: 'blocked-user-code', where: 'generated:editorCreate', detail: 'statement is outside the Editor-generated grammar' });
  }
  return blocks;
}

function hasExactGeneratedMemberSignature(member: ts.MethodDeclaration | ts.ConstructorDeclaration): boolean {
  if ((member.modifiers?.length ?? 0) !== 0 || member.parameters.length !== 0
    || member.typeParameters !== undefined) return false;
  if (ts.isConstructorDeclaration(member)) return true;
  return member.asteriskToken === undefined
    && member.questionToken === undefined
    && member.exclamationToken === undefined
    && (member.type === undefined || member.type.kind === ts.SyntaxKind.VoidKeyword);
}

/** Exact closed shape the current seven Editor-generated scene modules may use. */
export function verifyGeneratedModuleShape(source: string, expectedClass: string): Block[] {
  const sf = ts.createSourceFile('scene.ts', source, ts.ScriptTarget.ES2022, true);
  const blocks: Block[] = [];
  const parseDiagnostics = (sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    return [{ code: 'blocked-drift', where: 'generated', detail: 'generated module has parse diagnostics' }];
  }
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const classes = sf.statements.filter(ts.isClassDeclaration);
  const extras = sf.statements.filter((statement) => !ts.isImportDeclaration(statement) && !ts.isClassDeclaration(statement));
  const importSpecifiers = imports.map((statement) => stringLiteral(statement.moduleSpecifier)).filter((value): value is string => value !== null);
  if (JSON.stringify(importSpecifiers) !== JSON.stringify(['phaser', '../components/Semantic'])) {
    blocks.push({ code: 'blocked-unsafe-import', where: 'generated', detail: 'scene imports must be exactly phaser + Semantic' });
  }
  if (extras.length > 0 || classes.length !== 1) {
    blocks.push({ code: 'blocked-user-code', where: 'generated', detail: 'scene module has extra top-level statements' });
    return blocks;
  }
  const cls = classes[0];
  const modifierKinds = cls.modifiers?.map((modifier) => modifier.kind) ?? [];
  const isDefaultExport = JSON.stringify(modifierKinds) === JSON.stringify([
    ts.SyntaxKind.ExportKeyword,
    ts.SyntaxKind.DefaultKeyword,
  ]);
  const extendsPhaserScene = cls.heritageClauses?.length === 1
    && cls.heritageClauses[0].token === ts.SyntaxKind.ExtendsKeyword
    && cls.heritageClauses[0].types.length === 1
    && cls.heritageClauses[0].types[0].typeArguments === undefined
    && ts.isPropertyAccessExpression(cls.heritageClauses[0].types[0].expression)
    && ts.isIdentifier(cls.heritageClauses[0].types[0].expression.expression)
    && cls.heritageClauses[0].types[0].expression.expression.text === 'Phaser'
    && cls.heritageClauses[0].types[0].expression.name.text === 'Scene';
  const hasExactClassSignature = isDefaultExport && cls.typeParameters === undefined && extendsPhaserScene;
  if (cls.name?.text !== expectedClass || !hasExactClassSignature) {
    blocks.push({ code: 'blocked-drift', where: 'generated', detail: `expected default class ${expectedClass} extends Phaser.Scene` });
  }
  const allowedNames = new Set(['constructor', 'preload', 'editorCreate', 'create']);
  const seenNames = new Set<string>();
  for (const member of cls.members) {
    if (!ts.isMethodDeclaration(member) && !ts.isConstructorDeclaration(member)) {
      blocks.push({ code: 'blocked-user-code', where: 'generated', detail: 'scene class has an unsupported member' });
      continue;
    }
    const name = ts.isConstructorDeclaration(member) ? 'constructor' : methodName(member);
    const body = member.body;
    if (!name || !allowedNames.has(name) || seenNames.has(name) || !body) {
      blocks.push({ code: 'blocked-user-code', where: 'generated', detail: 'scene class has an unsupported or duplicate member' });
      continue;
    }
    seenNames.add(name);
    if (!hasExactGeneratedMemberSignature(member)) {
      blocks.push({ code: 'blocked-user-code', where: `generated:${name}`, detail: `${name} has parameters, modifiers, or a non-void signature` });
    }
    if (name === 'editorCreate') {
      blocks.push(...verifyEditorCreateBody(body));
      continue;
    }
    const statements = body.statements;
    if (statements.length !== 1 || !ts.isExpressionStatement(statements[0]) || !ts.isCallExpression(statements[0].expression)) {
      blocks.push({ code: 'blocked-user-code', where: `generated:${name}`, detail: `${name} body differs from the Editor template` });
      continue;
    }
    const call = statements[0].expression;
    const expectedPath = name === 'constructor' ? 'super' : name === 'preload' ? 'this.load.pack' : 'this.editorCreate';
    const observedPath = call.expression.kind === ts.SyntaxKind.SuperKeyword ? 'super' : callPath(call);
    const expectedArgs = name === 'constructor'
      ? [expectedClass]
      : name === 'preload'
        ? ['asset-pack', 'asset-pack.json']
        : [];
    const actualArgs = call.arguments.map((arg: ts.Expression) => stringLiteral(arg));
    if (observedPath !== expectedPath || JSON.stringify(actualArgs) !== JSON.stringify(expectedArgs)) {
      blocks.push({ code: 'blocked-user-code', where: `generated:${name}`, detail: `${name} call differs from the Editor template` });
    }
  }
  const missingMethods = [...allowedNames].filter((name) => !seenNames.has(name));
  if (missingMethods.length > 0) {
    blocks.push({ code: 'blocked-drift', where: 'generated', detail: `scene module is missing Editor lifecycle methods: ${missingMethods.join(', ')}` });
  }
  return blocks;
}

function sameType(generated: string, scene: string): boolean {
  return generated.toLowerCase() === scene.toLowerCase();
}

/**
 * Canonicalize an editor color for comparison. Two representations must fold to
 * one key so equal colors compare equal while a real recolor still differs:
 *  - Phaser Editor stores a shape's `fillColor`/`tint` as a `#rrggbb` string in
 *    the `.scene` but emits the equivalent decimal in generated code
 *    (`"#f7f6ef"` -> `16250607`).
 *  - When the fill/tint IS the Phaser default (white), the Editor omits the
 *    setter entirely, so the generated fact is `null` while the `.scene` still
 *    records `"#ffffff"`. An unset color therefore means the white default.
 */
const DEFAULT_COLOR = 0xffffff;
function colorKey(value: number | string | null): number | string {
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
    return Number.parseInt(value.slice(1), 16);
  }
  return value ?? DEFAULT_COLOR;
}

/** Diff a generated module against the scene authority, returning typed blocks. */
export function verifyGeneratedModule(source: string, scene: SceneDoc, moduleRelDir = 'scenes'): Block[] {
  const blocks: Block[] = [];
  blocks.push(...verifyGeneratedModuleShape(source, scene.sceneKey));
  const { facts, creationFacts, imports, issues } = extractGeneratedFacts(source);
  blocks.push(...issues);

  for (const specifier of imports) {
    if (!isAllowedImport(specifier, moduleRelDir)) {
      blocks.push({ code: 'blocked-unsafe-import', where: 'generated', detail: `import "${specifier}"` });
    }
  }

  const rawCreations = sceneCreationFacts(scene);
  for (const [treePath, raw] of rawCreations) {
    const generated = creationFacts.get(treePath);
    if (!generated) {
      blocks.push({
        code: 'blocked-drift',
        where: `${scene.sceneKey}:${raw.label}`,
        detail: `generated display object missing at ${treePath}`,
      });
      continue;
    }
    if (!sameType(generated.type, raw.type)) {
      blocks.push({
        code: 'blocked-drift',
        where: `${scene.sceneKey}:${raw.label}`,
        detail: `generated type "${generated.type}" != scene "${raw.type}" at ${treePath}`,
      });
    }
    // Non-semantic companions carry no Semantic carrier, so the semantic-fact
    // loop below never sees them — yet the visible shell (backgrounds, cards,
    // result/shop copy, toggled surfaces) is built entirely from them. Compare
    // every accepted runtime-visible field here too, so a generated module
    // whose companion appearance diverges from its `.scene` is blocked as
    // drift instead of being stripped verbatim into `scenes/shell.js`.
    for (const field of [
      'x', 'y', 'originX', 'originY', 'scaleX', 'scaleY', 'width', 'height',
      'textureKey', 'copy', 'color', 'visible', 'alpha', 'fontFamily', 'fontSize',
      'fillAlpha', 'strokeColor', 'strokeAlpha', 'lineWidth', 'isFilled', 'isStroked', 'rounded',
    ] as const) {
      const colorField = field === 'color' || field === 'strokeColor';
      const gen = colorField ? colorKey(generated[field]) : (generated[field] ?? null);
      const src = colorField ? colorKey(raw[field]) : (raw[field] ?? null);
      if (gen !== src) {
        blocks.push({
          code: 'blocked-drift',
          where: `${scene.sceneKey}:${raw.label}`,
          detail: `generated ${field} ${JSON.stringify(generated[field] ?? null)} != scene ${JSON.stringify(raw[field] ?? null)} at ${treePath}`,
        });
      }
    }
  }
  for (const treePath of creationFacts.keys()) {
    if (!rawCreations.has(treePath)) {
      blocks.push({ code: 'blocked-drift', where: `generated:${treePath}`, detail: 'unexpected generated display object' });
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
