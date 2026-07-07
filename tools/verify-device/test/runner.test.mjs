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
});
