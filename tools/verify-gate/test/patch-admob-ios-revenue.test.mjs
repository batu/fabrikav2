import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  admobIosRevenuePatch,
  patchAdmobIosRevenue,
  patchAdmobIosRevenueSource,
  verifyAdmobIosRevenueSource,
} from '../../patch-admob-ios-revenue.mjs';

const installedPackage = fileURLToPath(new URL('../../../node_modules/@capacitor-community/admob/', import.meta.url));
const fixtures = [];
const digest = (source) => createHash('sha256').update(source).digest('hex');

async function originalSource(file) {
  const installed = await readFile(path.join(installedPackage, file.path), 'utf8');
  // npm postinstall may already have corrected the local copy. Reconstruct
  // the original only from either of the approved complete-source hashes.
  patchAdmobIosRevenueSource(installed, file);
  return installed.replace(admobIosRevenuePatch.after, admobIosRevenuePatch.before);
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'admob-revenue-patch-'));
  fixtures.push(root);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: admobIosRevenuePatch.version }));
  for (const file of admobIosRevenuePatch.files) {
    await mkdir(path.dirname(path.join(root, file.path)), { recursive: true });
    await writeFile(path.join(root, file.path), await originalSource(file));
  }
  await mkdir(path.join(root, 'android'), { recursive: true });
  await writeFile(path.join(root, 'android', 'revenue.kt'), 'adValue.valueMicros');
  return root;
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('pinned AdMob iOS decimal revenue correction', () => {
  it('corrects all five native formats exactly once and preserves the approved complete source', async () => {
    expect(admobIosRevenuePatch.files).toHaveLength(5);
    for (const file of admobIosRevenuePatch.files) {
      const original = await originalSource(file);
      expect(digest(original)).toBe(file.unpatchedSha256);
      const patched = patchAdmobIosRevenueSource(original, file);
      expect(patched).toContain('adValue.value.multiplying(by: NSDecimalNumber(value: 1_000_000)).int64Value');
      expect(digest(patched)).toBe(file.patchedSha256);
      expect(patchAdmobIosRevenueSource(patched, file)).toBe(patched);
      expect(() => verifyAdmobIosRevenueSource(original, file)).toThrow(/not applied/);
      expect(verifyAdmobIosRevenueSource(patched, file)).toBeUndefined();
      expect(() => patchAdmobIosRevenueSource(`${patched}\n// drift`, file)).toThrow(/digest/);
    }
  });

  it('refuses an unapproved package version before changing any source', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '8.2.0' }));
    await expect(patchAdmobIosRevenue({ packageRoot: root })).rejects.toThrow(/8.2.0.*8.1.0/);
    const first = admobIosRevenuePatch.files[0];
    expect(digest(await readFile(path.join(root, first.path), 'utf8'))).toBe(first.unpatchedSha256);
  });

  it('preflights every source so last-file drift cannot partially patch a package', async () => {
    const root = await fixture();
    const last = admobIosRevenuePatch.files.at(-1);
    await writeFile(path.join(root, last.path), 'unexpected upstream implementation');
    await expect(patchAdmobIosRevenue({ packageRoot: root })).rejects.toThrow(/digest/);
    const first = admobIosRevenuePatch.files[0];
    expect(digest(await readFile(path.join(root, first.path), 'utf8'))).toBe(first.unpatchedSha256);
  });

  it('keeps verification read-only, applies idempotently, and leaves Android unchanged', async () => {
    const root = await fixture();
    await expect(patchAdmobIosRevenue({ packageRoot: root, verifyOnly: true })).rejects.toThrow(/not applied/);
    const first = admobIosRevenuePatch.files[0];
    expect(digest(await readFile(path.join(root, first.path), 'utf8'))).toBe(first.unpatchedSha256);
    expect((await patchAdmobIosRevenue({ packageRoot: root })).patchedFiles).toBe(5);
    expect((await patchAdmobIosRevenue({ packageRoot: root })).patchedFiles).toBe(0);
    expect((await patchAdmobIosRevenue({ packageRoot: root, verifyOnly: true })).patchedFiles).toBe(0);
    expect(await readFile(path.join(root, 'android', 'revenue.kt'), 'utf8')).toBe('adValue.valueMicros');
  });
});
