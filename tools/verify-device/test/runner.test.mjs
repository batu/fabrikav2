import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runnerSwift = path.resolve(__dirname, '..', 'runner', 'VerifyDeviceRunner', 'InsituTourTests.swift');

describe('VerifyDeviceRunner template', () => {
  it('captures only after the tour marker exists, and fail-loud attaches *-MISSING before XCTFail', () => {
    const src = fs.readFileSync(runnerSwift, 'utf8');
    expect(src).toMatch(/if\s+marker\.waitForExistence\(timeout:\s*stateTimeout\)\s*\{\s*shot\(name\)\s*\}\s*else\s*\{/s);
    expect(src).toMatch(/else\s*\{[\s\S]*shot\("\\\(name\)-MISSING"\)[\s\S]*XCTFail\(/);
    expect(src.indexOf('shot(name)')).toBeGreaterThan(src.indexOf('marker.waitForExistence'));
  });
});
