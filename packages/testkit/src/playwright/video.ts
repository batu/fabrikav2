import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Page } from '@playwright/test';

export const DEFAULT_MEDIA_RECORDER_MIME_CANDIDATES: string[] = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function selectSupportedMediaRecorderMime(
  isSupported: (mimeType: string) => boolean,
  candidates: readonly string[] = DEFAULT_MEDIA_RECORDER_MIME_CANDIDATES,
): string | null {
  return candidates.find((candidate: string): boolean => isSupported(candidate)) ?? null;
}

export async function savePlaywrightVideo(page: Page, destination: string): Promise<boolean> {
  const video = page.video();
  if (!video) return false;

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await video.saveAs(destination);
  return true;
}
