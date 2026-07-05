import { describe, expect, test } from 'vitest';

import { selectSupportedMediaRecorderMime } from './video.ts';

describe('selectSupportedMediaRecorderMime', (): void => {
  test('returns the first supported mime type', (): void => {
    const mimeType = selectSupportedMediaRecorderMime((candidate: string): boolean => {
      return candidate === 'video/webm;codecs=vp8,opus';
    });

    expect(mimeType).toBe('video/webm;codecs=vp8,opus');
  });

  test('returns null when no candidates are supported', (): void => {
    expect(selectSupportedMediaRecorderMime((): boolean => false)).toBeNull();
  });
});
