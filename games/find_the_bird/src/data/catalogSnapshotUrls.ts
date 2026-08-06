export function catalogSnapshotFetchUrls(
  catalogRevision: string,
  cdnOrigin: string | null,
): readonly string[] {
  const relativePath = `levels/catalog-snapshots/${encodeURIComponent(catalogRevision)}.json`;
  if (cdnOrigin === null) return [relativePath];
  return [relativePath, `${cdnOrigin.replace(/\/$/, '')}/${relativePath}`];
}
