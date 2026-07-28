export function isPlayableLevelAspect(width: number, height: number): boolean {
  return height > width || width >= 1.5 * height;
}
