export type DropPosition = 'before' | 'after';

export function moveId(ids: string[], fromId: string, toId: string, position: DropPosition): string[] {
  const from = ids.indexOf(fromId);
  const target = ids.indexOf(toId);
  if (from < 0 || target < 0 || from === target) return ids;
  const next = ids.slice();
  const [item] = next.splice(from, 1);
  const targetAfterRemoval = next.indexOf(toId);
  const insertAt = position === 'before' ? targetAfterRemoval : targetAfterRemoval + 1;
  next.splice(insertAt, 0, item);
  return next;
}

export function insertionNeighbors<T>(
  items: T[],
  getId: (item: T) => string,
  dragId: string | null,
  dropId: string | null,
  position: DropPosition,
): { leftId: string | null; rightId: string | null } {
  if (dragId === null || dropId === null || dragId === dropId) {
    return { leftId: null, rightId: null };
  }
  const itemsWithoutDragged = items.filter((item) => getId(item) !== dragId);
  const targetIndex = itemsWithoutDragged.findIndex((item) => getId(item) === dropId);
  if (targetIndex < 0) return { leftId: null, rightId: null };
  const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
  return {
    leftId: itemsWithoutDragged[insertIndex - 1] ? getId(itemsWithoutDragged[insertIndex - 1]) : null,
    rightId: itemsWithoutDragged[insertIndex] ? getId(itemsWithoutDragged[insertIndex]) : null,
  };
}

export function dropPositionFromPoint(
  rect: DOMRect,
  clientX: number,
  clientY: number,
): DropPosition {
  const xProgress = (clientX - rect.left) / Math.max(1, rect.width);
  const yProgress = (clientY - rect.top) / Math.max(1, rect.height);
  return yProgress > 0.5 || (yProgress > 0.35 && xProgress > 0.5) ? 'after' : 'before';
}
