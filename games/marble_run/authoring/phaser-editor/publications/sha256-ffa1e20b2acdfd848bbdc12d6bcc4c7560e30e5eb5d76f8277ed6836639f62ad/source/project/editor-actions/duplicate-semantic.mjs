/* global structuredClone */

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function visit(objects, visitor) {
  for (const object of objects) {
    visitor(object);
    if (object.type === 'Container') visit(object.list ?? [], visitor);
  }
}

function findOwner(objects, semanticId) {
  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index];
    if (object['Semantic.fabSemanticId'] === semanticId) return { objects, index, object };
    if (object.type === 'Container') {
      const nested = findOwner(object.list ?? [], semanticId);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Duplicate one hierarchy in Phaser Editor's native scene model.
 *
 * Phaser Editor supplies clone geometry and component values, but custom string
 * properties are copied verbatim. This action makes the required identity repair
 * explicit and atomic: every native id, label, and Semantic instance id is
 * rewritten before the cloned hierarchy is inserted into the scene.
 */
export function duplicateSemanticHierarchy(scene, sourceSemanticId, cloneSemanticId) {
  if (!ID_PATTERN.test(cloneSemanticId)) throw new Error(`invalid clone semantic id ${cloneSemanticId}`);
  const owner = findOwner(scene.displayList ?? [], sourceSemanticId);
  if (!owner) throw new Error(`semantic object ${sourceSemanticId} was not found`);

  const existing = new Set();
  visit(scene.displayList ?? [], (object) => {
    existing.add(object.id);
    existing.add(object['Semantic.fabSemanticId']);
  });
  const clone = structuredClone(owner.object);
  const sourceRootId = owner.object['Semantic.fabSemanticId'];
  const assigned = new Set();
  visit([clone], (object) => {
    const oldId = object['Semantic.fabSemanticId'];
    const suffix = oldId === sourceRootId
      ? ''
      : oldId.startsWith(`${sourceRootId}.`)
        ? oldId.slice(sourceRootId.length)
        : `.${oldId.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
    const nextId = `${cloneSemanticId}${suffix}`;
    if (!ID_PATTERN.test(nextId) || existing.has(nextId) || assigned.has(nextId)) {
      throw new Error(`duplicate action would create non-unique identity ${nextId}`);
    }
    assigned.add(nextId);
    object.id = nextId;
    object.label = nextId;
    object['Semantic.fabSemanticId'] = nextId;
  });
  clone.x = (clone.x ?? 0) + 12;
  clone.y = (clone.y ?? 0) + 12;
  owner.objects.splice(owner.index + 1, 0, clone);
  return clone;
}
