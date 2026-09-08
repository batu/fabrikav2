/** Manifest URLs alone do not prove the clean backgrounds downloaded. */
export function assertRestorationBackgroundTextures(
  urls: readonly string[],
  textureExists: (key: string) => boolean,
): void {
  for (let i = 0; i < urls.length; i++) {
    const key = `bg_${i}`;
    if (!textureExists(key)) throw new Error(`Restoration is missing loaded background ${key}`);
  }
}
