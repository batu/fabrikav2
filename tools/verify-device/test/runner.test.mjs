import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runnerSwift = path.resolve(__dirname, '..', 'runner', 'VerifyDeviceRunner', 'InsituTourTests.swift');

describe('VerifyDeviceRunner template', () => {
  it('F2-7 waits on exact tourstate labels and fails loud on explicit -FAILED markers', () => {
    const src = fs.readFileSync(runnerSwift, 'utf8');
    expect(src).not.toMatch(/CONTAINS/);
    expect(src).toContain(String.raw`let exactLabel = "tourstate:\(state)"`);
    expect(src).toContain(String.raw`let failedLabel = "\(exactLabel)-FAILED"`);
    expect(src).toMatch(/NSPredicate\(format:\s*"label == %@"/);
    expect(src).toContain('case .reached:');
    expect(src).toContain('case .failed:');
    expect(src).toMatch(/case\s+\.failed:[\s\S]*shot\("\\\(name\)-MISSING"\)[\s\S]*XCTFail\("state '\\\(state\)' published tourstate:\\\(state\)-FAILED/);
    expect(src.indexOf('shot(name)')).toBeGreaterThan(src.indexOf('case .reached:'));
  });

  it('reads and attaches the matching viewport metrics marker for every reached state', () => {
    const src = fs.readFileSync(runnerSwift, 'utf8');
    expect(src).toContain(String.raw`let prefix = "viewportmetrics:state=tourstate:\(state);"`);
    expect(src).toMatch(/NSPredicate\(format:\s*"label BEGINSWITH %@"/);
    expect(src).toContain(String.raw`attachText("\(name)-viewportmetrics", metrics)`);
    expect(src).toContain(String.raw`attachText("\(name)-viewportmetrics-MISSING"`);
    expect(src.indexOf(String.raw`attachText("\(name)-viewportmetrics", metrics)`))
      .toBeLessThan(src.indexOf('shot(name)'));
  });
});
