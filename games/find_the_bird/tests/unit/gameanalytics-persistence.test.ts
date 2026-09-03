import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('pinned GameAnalytics persistence patch', () => {
  it('persists successful queue deletion before a short relaunch can reload sent UUIDs', () => {
    const source = readFileSync(require.resolve('gameanalytics'), 'utf8');
    const successStart = source.indexOf('if (responseEnum === EGAHTTPApiResponse.Ok)');
    const failureStart = source.indexOf('else', successStart);
    const successBranch = source.slice(successStart, failureStart);

    expect(successStart).toBeGreaterThan(-1);
    expect(successBranch).toContain('GAStore["delete"](EGAStore.Events, requestIdWhereArgs)');
    expect(successBranch).toContain('GAStore.save(GAState.getGameKey())');
  });
});
