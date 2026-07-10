import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  SHELL_CONTRACT_ID as INDEX_CONTRACT_ID,
  SHELL_CONTRACT_VERSION as INDEX_CONTRACT_VERSION,
} from '../src/index.ts';

import {
  ANCHOR_IDS,
  SHELL_CONTRACT_ID,
  SHELL_CONTRACT_VERSION,
  ShellContractValidationError,
  canonicalizeJson,
  createDefaultShellPresentation,
  hashCanonicalJson,
  normalizeShellGeometry,
  parseProjectionRevision,
  parseShellAssetCatalog,
  parseShellPresentation,
  parseShellPresentationContract,
  parseShellPublishedRevision,
  projectShellGeometry,
  shellPresentationContract,
  type ShellPresentationContract,
} from '../src/shellContract.ts';

type JsonRecord = Record<string, unknown>;

interface GoldenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GoldenProfile {
  id: string;
  viewport: {
    width: number;
    height: number;
    insets: { top: number; right: number; bottom: number; left: number };
  };
  geometry: {
    offset: { x: number; y: number };
    size: { width: number; height: number };
    fit: 'contain' | 'cover';
  };
  expected: Record<string, GoldenRect>;
}

const nodeContract = JSON.parse(
  readFileSync(new URL('../contracts/shell-presentation.v1.json', import.meta.url), 'utf8'),
) as JsonRecord;

const golden = JSON.parse(
  readFileSync(new URL('./fixtures/shell-geometry.golden.json', import.meta.url), 'utf8'),
) as { profiles: GoldenProfile[] };

function mutableContract(): ShellPresentationContract {
  return structuredClone(shellPresentationContract);
}

function records(value: unknown): JsonRecord[] {
  return value as JsonRecord[];
}

function record(value: unknown): JsonRecord {
  return value as JsonRecord;
}

function expectContractIssue(
  mutate: (contract: ShellPresentationContract) => void,
  expectedCode: string,
): void {
  const candidate = mutableContract();
  mutate(candidate);

  try {
    parseShellPresentationContract(candidate);
    throw new Error('expected contract validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ShellContractValidationError);
    const validationError = error as ShellContractValidationError;
    expect(validationError.issues.map((issue) => issue.code)).toContain(expectedCode);
  }
}

function validAssetCatalog(): JsonRecord {
  return {
    contractId: SHELL_CONTRACT_ID,
    contractVersion: SHELL_CONTRACT_VERSION,
    assets: [
      {
        id: 'asset.primary-action.default',
        slotId: 'button-surface',
        path: 'assets/primary-action.default.png',
        mimeType: 'image/png',
        width: 240,
        height: 96,
        hasAlpha: true,
        sha256: `sha256-${'1'.repeat(64)}`,
        provenance: {
          sourceId: 'kenney-ui-pack',
          sourceHash: `sha256-${'2'.repeat(64)}`,
          license: 'CC0-1.0',
        },
      },
    ],
  };
}

function validProjectionRevision(): JsonRecord {
  const artifact = (path: string, digit: string): JsonRecord => ({
    path,
    sha256: `sha256-${digit.repeat(64)}`,
    bytes: 1,
  });

  return {
    contractId: SHELL_CONTRACT_ID,
    contractVersion: SHELL_CONTRACT_VERSION,
    compatibilityHash: `sha256-${'a'.repeat(64)}`,
    projectionId: `sha256-${'b'.repeat(64)}`,
    sourcePublicationId: `sha256-${'c'.repeat(64)}`,
    revisionPath: `design/revisions/sha256-${'b'.repeat(64)}`,
    artifacts: [
      artifact('asset-identity.json', '1'),
      artifact('assets.ts', '2'),
      artifact('copy.ts', '3'),
      artifact('presentation.ts', '4'),
      artifact('tokens.css', '5'),
    ],
  };
}

function validPublishedRevision(): JsonRecord {
  return {
    contractId: SHELL_CONTRACT_ID,
    contractVersion: SHELL_CONTRACT_VERSION,
    publicationId: `sha256-${'a'.repeat(64)}`,
    projectJsonHash: `sha256-${'b'.repeat(64)}`,
    portableExportHash: `sha256-${'c'.repeat(64)}`,
    componentRecordsHash: `sha256-${'d'.repeat(64)}`,
    assetCatalogHash: `sha256-${'e'.repeat(64)}`,
    pageCount: 6,
    states: ['menu', 'level', 'settings', 'pause', 'win', 'fail'],
  };
}

describe('shell presentation contract', () => {
  it('exposes the same canonical identity to Node JSON and TypeScript consumers', () => {
    expect(nodeContract.contractId).toBe(SHELL_CONTRACT_ID);
    expect(nodeContract.contractVersion).toBe(SHELL_CONTRACT_VERSION);
    expect(shellPresentationContract.contractId).toBe(nodeContract.contractId);
    expect(shellPresentationContract.contractVersion).toBe(nodeContract.contractVersion);
    expect(INDEX_CONTRACT_ID).toBe(nodeContract.contractId);
    expect(INDEX_CONTRACT_VERSION).toBe(nodeContract.contractVersion);
    expect(shellPresentationContract.states.map((state) => state.id)).toEqual([
      'menu',
      'level',
      'settings',
      'pause',
      'win',
      'fail',
    ]);
  });

  it('gives every required action a binding, instance, geometry, accessibility, and complete variants', () => {
    const instances = new Map(
      shellPresentationContract.instances.map((instance) => [instance.id, instance]),
    );
    const bindings = new Set(shellPresentationContract.bindings.map((binding) => binding.id));
    const families = new Map(
      shellPresentationContract.stateFamilies.map((family) => [family.id, family]),
    );

    expect(shellPresentationContract.requiredActions.map((action) => action.id)).toEqual([
      'play',
      'menu.settings',
      'pause',
      'test-win',
      'test-lose',
      'settings.music',
      'settings.sfx',
      'settings.haptics',
      'settings-back',
      'resume',
      'pause.settings',
      'pause-home',
      'win-next',
      'win-home',
      'fail-retry',
      'fail-home',
    ]);

    for (const action of shellPresentationContract.requiredActions) {
      expect(action.minimumCount).toBeGreaterThanOrEqual(1);
      expect(bindings.has(action.bindingId)).toBe(true);
      expect(action.instanceIds).toHaveLength(action.minimumCount);
      for (const instanceId of action.instanceIds) {
        const instance = instances.get(instanceId);
        expect(instance?.stateId).toBe(action.stateId);
        expect(instance?.bindingId).toBe(action.bindingId);
        expect(instance?.accessibility.nameKey).toBeTruthy();
        expect(instance?.defaultPresentation.geometry.size.width).toBeGreaterThan(0);
        expect(instance?.defaultPresentation.geometry.size.height).toBeGreaterThan(0);
        const family = instance ? families.get(instance.stateFamilyId) : undefined;
        expect(family?.requiredVariants).toEqual(Object.keys(family?.variants ?? {}));
      }
    }
  });

  it('keeps parent hierarchy and generated schemas machine-readable', () => {
    const instances = new Map(
      shellPresentationContract.instances.map((instance) => [instance.id, instance]),
    );
    for (const instance of shellPresentationContract.instances) {
      if (instance.parentInstanceId !== null) {
        expect(instances.get(instance.parentInstanceId)?.stateId).toBe(instance.stateId);
      }
    }

    expect(shellPresentationContract.schemas.presentation.additionalProperties).toBe(false);
    expect(shellPresentationContract.schemas.assetCatalog.additionalProperties).toBe(false);
    expect(shellPresentationContract.schemas.publication.additionalProperties).toBe(false);
    expect(shellPresentationContract.schemas.projectionRevision.additionalProperties).toBe(false);
    expect(shellPresentationContract.schemas.assetIdentity.additionalProperties).toBe(false);
  });

  it('reconstructs every 3x3 anchor for representative runtime insets', () => {
    expect(new Set(ANCHOR_IDS)).toEqual(new Set(Object.keys(golden.profiles[0]!.expected)));

    for (const profile of golden.profiles) {
      for (const anchor of ANCHOR_IDS) {
        const projected = projectShellGeometry({
          anchor,
          geometry: profile.geometry,
          viewport: profile.viewport,
        });
        expect(projected.bounds, `${profile.id}/${anchor}`).toEqual(profile.expected[anchor]);
      }
    }
  });

  it('round-trips baseline geometry and applies slot caps with contain/cover fitting', () => {
    const profile = golden.profiles[0]!;
    for (const anchor of ANCHOR_IDS) {
      const bounds = profile.expected[anchor]!;
      const normalized = normalizeShellGeometry({
        anchor,
        bounds,
        viewport: profile.viewport,
        fit: 'contain',
      });
      expect(normalized).toEqual(profile.geometry);
    }

    const contain = projectShellGeometry({
      anchor: 'center',
      geometry: {
        offset: { x: 0, y: 0 },
        size: { width: 0.8, height: 0.8 },
        fit: 'contain',
      },
      viewport: profile.viewport,
      caps: { minWidth: 48, maxWidth: 100, minHeight: 48, maxHeight: 100 },
      assetSize: { width: 200, height: 100 },
    });
    expect(contain.bounds).toEqual({ x: 145, y: 384.5, width: 100, height: 100 });
    expect(contain.contentBounds).toEqual({ x: 145, y: 409.5, width: 100, height: 50 });

    const cover = projectShellGeometry({
      anchor: 'center',
      geometry: {
        offset: { x: 0, y: 0 },
        size: { width: 0.8, height: 0.8 },
        fit: 'cover',
      },
      viewport: profile.viewport,
      caps: { minWidth: 48, maxWidth: 100, minHeight: 48, maxHeight: 100 },
      assetSize: { width: 200, height: 100 },
    });
    expect(cover.contentBounds).toEqual({ x: 95, y: 384.5, width: 200, height: 100 });
  });

  it('rejects duplicate IDs, missing variants/accessibility, bad geometry, unknown bindings, and non-neutral roles', () => {
    expectContractIssue((candidate) => {
      const states = records(record(candidate).states);
      states.push(structuredClone(states[0]!));
    }, 'duplicate-id');

    expectContractIssue((candidate) => {
      const family = records(record(candidate).stateFamilies).find((item) => item.id === 'button')!;
      delete record(family.variants).pressed;
    }, 'missing-variant');

    expectContractIssue((candidate) => {
      const instance = records(record(candidate).instances).find((item) => item.id === 'menu.play')!;
      delete instance.accessibility;
    }, 'missing-accessibility');

    expectContractIssue((candidate) => {
      const instance = records(record(candidate).instances).find((item) => item.id === 'menu.play')!;
      record(record(record(instance.defaultPresentation).geometry).size).width = 0;
    }, 'invalid-geometry');

    expectContractIssue((candidate) => {
      const action = records(record(candidate).requiredActions)[0]!;
      action.bindingId = 'flow.unknown';
    }, 'unknown-binding');

    expectContractIssue((candidate) => {
      const role = records(record(candidate).roles)[0]!;
      role.id = 'green-play-button';
    }, 'non-neutral-id');

    expectContractIssue((candidate) => {
      const instance = records(record(candidate).instances).find((item) => item.id === 'settings.back')!;
      instance.parentInstanceId = 'settings.back';
    }, 'hierarchy-cycle');
  });

  it('supports same-semantic duplication while rejecting binding and accessibility drift', () => {
    const valid = createDefaultShellPresentation();
    const menu = valid.pages.find((page) => page.stateId === 'menu')!;
    const duplicate = structuredClone(
      menu.instances.find((instance) => instance.id === 'menu.currency')!,
    );
    duplicate.id = 'menu.currency.duplicate-1';
    duplicate.presentation.order = 4;
    menu.instances.push(duplicate);
    expect(() => parseShellPresentation(valid)).not.toThrow();

    duplicate.bindingId = 'state.level-label';
    expect(() => parseShellPresentation(valid)).toThrow(/non-editable bindingId/i);
    duplicate.bindingId = 'state.primary-currency';
    duplicate.accessibility.nameKey = 'shell.currency.diamonds';
    expect(() => parseShellPresentation(valid)).toThrow(/accessibility metadata/i);
  });

  it('fails closed on unsafe authored presentation and incomplete action variants', () => {
    const valid = createDefaultShellPresentation();
    expect(() => parseShellPresentation(valid)).not.toThrow();

    const missingVariant = structuredClone(valid);
    const play = missingVariant.pages
      .flatMap((page) => page.instances)
      .find((instance) => instance.id === 'menu.play')!;
    delete play.variants.pressed;
    expect(() => parseShellPresentation(missingVariant)).toThrow(/variant/i);

    const hiddenPlay = structuredClone(valid);
    hiddenPlay.pages
      .flatMap((page) => page.instances)
      .find((instance) => instance.id === 'menu.play')!.presentation.visibility = 'hidden';
    expect(() => parseShellPresentation(hiddenPlay)).toThrow(/required action/i);

    const overflow = structuredClone(valid);
    overflow.pages
      .flatMap((page) => page.instances)
      .find((instance) => instance.id === 'menu.play')!.presentation.geometry.offset.x = 0.8;
    expect(() => parseShellPresentation(overflow)).toThrow(/safe bounds/i);

    for (const [field, fragment] of [
      ['css', '.play { display: none }'],
      ['html', '<button>Play</button>'],
      ['url', 'https://example.com'],
      ['attributes', { onclick: 'run()' }],
      ['source', 'export default {}'],
    ] as const) {
      const sourceFragment = structuredClone(valid) as unknown as JsonRecord;
      const sourcePage = records(sourceFragment.pages)[0]!;
      const sourceInstance = records(sourcePage.instances)[0]!;
      record(sourceInstance.presentation)[field] = fragment;
      expect(() => parseShellPresentation(sourceFragment), field).toThrow(/unsupported field/i);
    }

    const htmlCopy = structuredClone(valid);
    htmlCopy.pages
      .flatMap((page) => page.instances)
      .find((instance) => instance.id === 'menu.title')!.presentation.copy =
      '<img src=x onerror=alert(1)>';
    expect(() => parseShellPresentation(htmlCopy)).toThrow(/plain unicode copy/i);
  });

  it('accepts only known local raster assets and rejects SVG, URL, data, and blob inputs', () => {
    const catalog = parseShellAssetCatalog(validAssetCatalog());
    const valid = createDefaultShellPresentation();
    valid.pages
      .flatMap((page) => page.instances)
      .find((instance) => instance.id === 'menu.play')!.presentation.assetId =
      'asset.primary-action.default';
    expect(() => parseShellPresentation(valid, { assetCatalog: catalog })).not.toThrow();

    for (const assetId of [
      'asset.unknown',
      'https://example.com/button.png',
      'data:image/png;base64,AAAA',
      'blob:button',
      'assets/active.svg',
    ]) {
      const candidate = structuredClone(valid);
      candidate.pages
        .flatMap((page) => page.instances)
        .find((instance) => instance.id === 'menu.play')!.presentation.assetId = assetId;
      expect(() => parseShellPresentation(candidate, { assetCatalog: catalog }), assetId).toThrow();
    }

    for (const [path, mimeType] of [
      ['assets/active.svg', 'image/svg+xml'],
      ['https://example.com/button.png', 'image/png'],
      ['data:image/png;base64,AAAA', 'image/png'],
      ['blob:button', 'image/png'],
    ]) {
      const candidate = validAssetCatalog();
      const asset = records(candidate.assets)[0]!;
      asset.path = path;
      asset.mimeType = mimeType;
      expect(() => parseShellAssetCatalog(candidate), path).toThrow();
    }
  });

  it('validates the immutable projection pointer and required generated files', () => {
    expect(() => parseProjectionRevision(validProjectionRevision())).not.toThrow();

    const missingPresentation = validProjectionRevision();
    missingPresentation.artifacts = records(missingPresentation.artifacts).filter(
      (artifact) => artifact.path !== 'presentation.ts',
    );
    expect(() => parseProjectionRevision(missingPresentation)).toThrow(/presentation\.ts/);

    const unsafePath = validProjectionRevision();
    records(unsafePath.artifacts)[0]!.path = '../asset-identity.json';
    expect(() => parseProjectionRevision(unsafePath)).toThrow(/artifact path/i);
  });

  it('binds project JSON and portable export hashes into one compatible publication record', () => {
    expect(() => parseShellPublishedRevision(validPublishedRevision())).not.toThrow();

    const mixed = validPublishedRevision();
    mixed.states = ['menu', 'level', 'settings', 'pause', 'fail', 'win'];
    expect(() => parseShellPublishedRevision(mixed)).toThrow(/canonical order/i);

    const stale = validPublishedRevision();
    stale.contractVersion = '2.0.0';
    expect(() => parseShellPublishedRevision(stale)).toThrow(/incompatible/i);
  });

  it('serializes canonically and hashes repeatably', async () => {
    const left = { z: [3, { b: 2, a: 1 }], a: 'copy' };
    const right = { a: 'copy', z: [3, { a: 1, b: 2 }] };

    expect(canonicalizeJson(left)).toBe(canonicalizeJson(right));
    expect(await hashCanonicalJson(left)).toBe(await hashCanonicalJson(right));
    expect(await hashCanonicalJson(left)).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(() => canonicalizeJson({ unsafe: Number.POSITIVE_INFINITY })).toThrow(/finite/i);
  });
});
