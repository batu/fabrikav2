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

  it('gates the ordered manifest vocabulary from TARGET_STATES, never a hardcoded state list — the seven-page Shop regression (card qWCv9tUo)', () => {
    const src = fs.readFileSync(runnerSwift, 'utf8');
    // The legacy hardcoded property is exactly what silently skipped Shop when the
    // shell grew from six to seven pages; it must be gone, and no literal
    // six-state array may remain.
    expect(src).not.toMatch(/private let states\s*=\s*\[/);
    expect(src).not.toMatch(/\[\s*"menu"\s*,\s*"level"\s*,\s*"settings"\s*,\s*"pause"\s*,\s*"win"\s*,\s*"fail"\s*\]/);
    // The ordered vocabulary is injected by verify-device via TEST_RUNNER_TARGET_STATES,
    // read here (prefix stripped) as TARGET_STATES and split on commas in order.
    expect(src).toContain('ProcessInfo.processInfo.environment["TARGET_STATES"]');
    expect(src).toMatch(/\.split\(separator:\s*","\)/);
    // Absent/empty vocabulary is a loud failure (like TARGET_BUNDLE_ID), never a
    // fallback to a stale default that could skip a state.
    expect(src).toMatch(/guard\s+!states\.isEmpty\s+else\s*\{[\s\S]*XCTFail\([\s\S]*TARGET_STATES/);
    // The capture loop iterates the injected states in their manifest order.
    expect(src).toMatch(/for\s+\(index,\s*state\)\s+in\s+states\.enumerated\(\)/);
  });
});
