import type { DogSprite, DogSpriteCleanup, LevelFileV1, Section } from './generated/levelFile';

type JsonObject = Record<string, unknown>;
export type RuntimeLevelFile = Pick<LevelFileV1, 'id' | 'name' | 'width' | 'height' | 'colorImage' | 'dogs' | 'sections'>;

interface RuntimeLevelFileContext {
  levelId: string;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isUnitIntervalNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function fail(context: RuntimeLevelFileContext, reason: string): never {
  throw new Error(`Invalid level.json for '${context.levelId}': ${reason}`);
}

function assertPositiveBox(
  value: unknown,
  context: RuntimeLevelFileContext,
  path: string,
): asserts value is { x: number; y: number; width: number; height: number } {
  if (!isObject(value)) fail(context, `${path} must be an object`);
  if (!isFiniteNumber(value.x)) fail(context, `${path}.x must be a finite number`);
  if (!isFiniteNumber(value.y)) fail(context, `${path}.y must be a finite number`);
  if (!isPositiveFiniteNumber(value.width)) fail(context, `${path}.width must be a positive finite number`);
  if (!isPositiveFiniteNumber(value.height)) fail(context, `${path}.height must be a positive finite number`);
}

function assertDogSpriteCleanup(
  value: unknown,
  context: RuntimeLevelFileContext,
  path: string,
): asserts value is DogSpriteCleanup {
  assertPositiveBox(value, context, path);
}

function assertDogSprite(
  value: unknown,
  context: RuntimeLevelFileContext,
  path: string,
): asserts value is DogSprite {
  assertPositiveBox(value, context, path);
  const sprite = value as JsonObject;
  if (!isNonEmptyString(sprite.image)) fail(context, `${path}.image must be a non-empty string`);
  assertDogSpriteCleanup(sprite.cleanup, context, `${path}.cleanup`);
  if (sprite.anchorX !== undefined && !isUnitIntervalNumber(sprite.anchorX)) {
    fail(context, `${path}.anchorX must be a finite number in [0, 1] when present`);
  }
  if (sprite.anchorY !== undefined && !isUnitIntervalNumber(sprite.anchorY)) {
    fail(context, `${path}.anchorY must be a finite number in [0, 1] when present`);
  }
}

function assertSections(
  value: unknown,
  context: RuntimeLevelFileContext,
  levelWidth: number,
): asserts value is Section[] {
  if (value === undefined) return;
  if (!Array.isArray(value)) fail(context, 'sections must be an array when present');
  if (value.length === 0) return;
  let expectedXStart = 0;
  for (const [index, section] of value.entries()) {
    const path = `sections[${index}]`;
    if (!isObject(section)) fail(context, `${path} must be an object`);
    if (!isFiniteNumber(section.xStart)) fail(context, `${path}.xStart must be a finite number`);
    if (!isFiniteNumber(section.xEnd)) fail(context, `${path}.xEnd must be a finite number`);
    if (section.xStart < 0) fail(context, `${path}.xStart must be non-negative`);
    if (section.xStart !== expectedXStart) fail(context, `${path}.xStart must equal ${expectedXStart}`);
    if (section.xEnd <= section.xStart) fail(context, `${path}.xEnd must be greater than xStart`);
    if (section.xEnd > levelWidth) fail(context, `${path}.xEnd must be <= level width`);
    expectedXStart = section.xEnd;
  }
  if (expectedXStart !== levelWidth) fail(context, 'sections must cover the full level width');
}

function assertDogInLevelBounds(
  dog: JsonObject,
  context: RuntimeLevelFileContext,
  path: string,
  levelWidth: number,
  levelHeight: number,
): void {
  if (!isFiniteNumber(dog.x)) fail(context, `${path}.x must be a finite number`);
  if (!isFiniteNumber(dog.y)) fail(context, `${path}.y must be a finite number`);
  if (!isPositiveFiniteNumber(dog.r)) fail(context, `${path}.r must be a positive finite number`);
  if (dog.x - dog.r < 0 || dog.x + dog.r > levelWidth) {
    fail(context, `${path} hitbox must fit within level width`);
  }
  if (dog.y - dog.r < 0 || dog.y + dog.r > levelHeight) {
    fail(context, `${path} hitbox must fit within level height`);
  }
}

function assertCleanupContainsDog(
  dog: JsonObject,
  context: RuntimeLevelFileContext,
  path: string,
): void {
  if (!isObject(dog.sprite) || !isObject(dog.sprite.cleanup)) return;
  const cleanup = dog.sprite.cleanup;
  if (
    isFiniteNumber(dog.x)
    && isFiniteNumber(dog.y)
    && isFiniteNumber(cleanup.x)
    && isFiniteNumber(cleanup.y)
    && isPositiveFiniteNumber(cleanup.width)
    && isPositiveFiniteNumber(cleanup.height)
    && (
      dog.x < cleanup.x
      || dog.x > cleanup.x + cleanup.width
      || dog.y < cleanup.y
      || dog.y > cleanup.y + cleanup.height
    )
  ) {
    fail(context, `${path}.sprite.cleanup must contain the dog center`);
  }
}

export function assertRuntimeLevelFile(
  value: unknown,
  context: RuntimeLevelFileContext,
): asserts value is RuntimeLevelFile {
  if (!isObject(value)) fail(context, 'root must be an object');
  if (!isNonEmptyString(value.id)) fail(context, 'id must be a non-empty string');
  if (value.id !== context.levelId) {
    fail(context, `id '${value.id}' does not match requested level id`);
  }
  if (!isNonEmptyString(value.name)) fail(context, 'name must be a non-empty string');
  if (!isPositiveFiniteNumber(value.width)) fail(context, 'width must be a positive finite number');
  if (!isPositiveFiniteNumber(value.height)) fail(context, 'height must be a positive finite number');
  if (!isNonEmptyString(value.colorImage)) fail(context, 'colorImage must be a non-empty string');
  if (!Array.isArray(value.dogs)) fail(context, 'dogs must be an array');
  if (value.dogs.length === 0) fail(context, 'dogs must contain at least one dog');

  for (const [index, dog] of value.dogs.entries()) {
    const path = `dogs[${index}]`;
    if (!isObject(dog)) fail(context, `${path} must be an object`);
    if (!isNonEmptyString(dog.id)) fail(context, `${path}.id must be a non-empty string`);
    assertDogInLevelBounds(dog, context, path, value.width, value.height);
    if (dog.sprite !== undefined) assertDogSprite(dog.sprite, context, `${path}.sprite`);
    assertCleanupContainsDog(dog, context, path);
  }

  assertSections(value.sections, context, value.width);
}
