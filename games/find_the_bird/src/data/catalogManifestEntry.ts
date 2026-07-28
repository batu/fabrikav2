import type { CohortBucketSpec, LevelAsset, LevelAssets, ManifestLevelEntry } from '../v1core/assets';
import type { RuntimeCatalogManifestLevel, RuntimeCatalogPackageAsset } from '../sequence/runtimeSequence';

function assetFromCatalog(asset: RuntimeCatalogPackageAsset | undefined): LevelAsset | null {
  if (asset === undefined || asset.path === undefined) return null;
  return {
    hash: asset.hash,
    size: asset.size,
    path: asset.path,
  };
}

function assetsByRole(catalogLevel: RuntimeCatalogManifestLevel): ReadonlyMap<string, RuntimeCatalogPackageAsset> {
  const result = new Map<string, RuntimeCatalogPackageAsset>();
  for (const asset of catalogLevel.package?.requiredAssets ?? []) {
    if (asset.role === undefined) continue;
    result.set(asset.role, asset);
  }
  return result;
}

function orderedRoleAssets(
  roles: ReadonlyMap<string, RuntimeCatalogPackageAsset>,
  prefix: string,
): LevelAsset[] {
  return [...roles.entries()]
    .filter(([role]) => role.startsWith(prefix))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, asset]) => assetFromCatalog(asset))
    .filter((asset): asset is LevelAsset => asset !== null);
}

export function manifestEntryFromCatalogLevel(catalogLevel: RuntimeCatalogManifestLevel): ManifestLevelEntry | null {
  if (catalogLevel.package?.complete !== true) return null;
  if (catalogLevel.width === undefined || catalogLevel.height === undefined) return null;

  const roles = assetsByRole(catalogLevel);
  const levelJson = assetFromCatalog(roles.get('levelJson'));
  const colorImage = assetFromCatalog(roles.get('colorImage'));
  if (levelJson === null || colorImage === null) return null;

  const bgImages = orderedRoleAssets(roles, 'bgImage:');
  const dogSprites = orderedRoleAssets(roles, 'dogSprite:');
  const assets: LevelAssets = {
    levelJson,
    colorImage,
    ...(bgImages.length > 0 ? { bgImages } : {}),
    ...(dogSprites.length > 0 ? { dogSprites } : {}),
  };

  return {
    id: catalogLevel.id,
    name: catalogLevel.name ?? `Level ${catalogLevel.id}`,
    width: catalogLevel.width,
    height: catalogLevel.height,
    cohort_buckets: (catalogLevel.cohortBuckets ?? []) as readonly CohortBucketSpec[],
    bundled: catalogLevel.bundledInApp === true,
    assets,
  };
}
