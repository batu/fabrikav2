import type { LevelData } from '../data/levels';
import { selectRuntimeColorImageUrl } from './RuntimeTexturePolicy';

export interface LevelPrewarmTarget {
  key: string;
  url: string;
}

export function buildLevelPrewarmTargets(
  level: LevelData,
  runtimeTextureLongEdge: number,
  restorationMode: boolean,
): { targets: LevelPrewarmTarget[]; spriteKeys: string[] } {
  const targets: LevelPrewarmTarget[] = [{
    key: 'color',
    url: selectRuntimeColorImageUrl(
      level.colorImage,
      level.width,
      level.height,
      runtimeTextureLongEdge,
    ),
  }];
  const spriteKeys: string[] = [];
  if (!restorationMode) return { targets, spriteKeys };

  for (let i = 0; i < (level.bgImageUrls?.length ?? 0); i += 1) {
    targets.push({ key: `bg_${i}`, url: level.bgImageUrls![i] });
  }
  for (const dog of level.dogs) {
    const spriteUrl = dog.sprite?.image;
    if (spriteUrl === undefined) continue;
    const key = `dog_sprite_${level.id}_${dog.id}`;
    spriteKeys.push(key);
    targets.push({ key, url: spriteUrl });
  }
  return { targets, spriteKeys };
}
