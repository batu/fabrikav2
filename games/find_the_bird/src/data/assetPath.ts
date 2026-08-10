export function isBundledAssetPath(path: string, bundled: boolean): boolean {
  return bundled && !path.startsWith('/assets/');
}
