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
  assertShellPublicationCompatible,
  canonicalizeJson,
  computeShellProjectionId,
  computeShellPublicationId,
  createDefaultShellPresentation,
  createShellPublicationCompatibility,
  hashCanonicalJson,
  hashShellPresentationContract,
  isShellPublicationCompatible,
  normalizeShellGeometry,
  parseAssetIdentityProjection,
  parseProjectionRevision,
  parseShellAssetCatalog,
  parseShellPresentation,
  parseShellPresentationContract,
  parseShellPublishedRevision,
  projectShellGeometry,
  shellPresentationContract,
  type ShellProjectionRevision,
  type ShellPublishedRevision,
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
    assets: [validAssetCatalogEntry()],
  };
}

function validAssetCatalogEntry(overrides: JsonRecord = {}): JsonRecord {
  return {
    id: 'asset.primary-action.default',
    name: 'Primary action button',
    description: 'Wide button surface for primary and secondary shell actions.',
    slotId: 'button-surface',
    path: 'assets/primary-action.default.png',
    mimeType: 'image/png',
    width: 384,
    height: 128,
    bytes: 1_024,
    hasAlpha: true,
    sha256: `sha256-${'1'.repeat(64)}`,
    provenance: {
      sourceId: 'kenney-ui-pack',
      sourcePath: 'UI/PNG/Blue/Default/button_primary.png',
      sourceHash: `sha256-${'2'.repeat(64)}`,
      license: 'CC0-1.0',
    },
    ...overrides,
  };
}

function expectCatalogIssue(
  mutate: (catalog: JsonRecord) => void,
  expectedCode: string,
  expectedPath?: string,
): void {
  const candidate = validAssetCatalog();
  mutate(candidate);

  try {
    parseShellAssetCatalog(candidate);
    throw new Error('expected asset catalog validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ShellContractValidationError);
    const validationError = error as ShellContractValidationError;
    expect(validationError.issues.map((issue) => issue.code)).toContain(expectedCode);
    if (expectedPath) {
      expect(validationError.issues.some(
        (issue) => issue.code === expectedCode && issue.path === expectedPath,
      )).toBe(true);
    }
  }
}

async function validProjectionRevision(): Promise<JsonRecord> {
  const artifact = (path: string, digit: string): JsonRecord => ({
    path,
    sha256: `sha256-${digit.repeat(64)}`,
    bytes: 1,
  });

  const compatibility = await createShellPublicationCompatibility();
  const revision = {
    contractId: SHELL_CONTRACT_ID,
    contractVersion: SHELL_CONTRACT_VERSION,
    compatibilityHash: compatibility.compatibilityHash,
    sourcePublicationId: `sha256-${'c'.repeat(64)}`,
    artifacts: [
      artifact('asset-identity.json', '1'),
      artifact('assets.ts', '2'),
      artifact('copy.ts', '3'),
      artifact('presentation.ts', '4'),
      artifact('tokens.css', '5'),
    ],
  } as Omit<ShellProjectionRevision, 'projectionId' | 'revisionPath'>;
  const projectionId = await computeShellProjectionId(revision);
  return {
    ...revision,
    projectionId,
    revisionPath: `design/revisions/${projectionId}`,
  };
}

async function validPublishedRevision(): Promise<JsonRecord> {
  const revision = {
    contractId: SHELL_CONTRACT_ID,
    contractVersion: SHELL_CONTRACT_VERSION,
    projectJsonHash: `sha256-${'b'.repeat(64)}`,
    portableExportHash: `sha256-${'c'.repeat(64)}`,
    componentRecordsHash: `sha256-${'d'.repeat(64)}`,
    assetCatalogHash: `sha256-${'e'.repeat(64)}`,
    pageCount: 6,
    states: ['menu', 'level', 'settings', 'pause', 'win', 'fail'],
  } as Omit<ShellPublishedRevision, 'publicationId'>;
  return {
    ...revision,
    publicationId: await computeShellPublicationId(revision),
  };
}

function validAssetIdentityProjection(): JsonRecord {
  return {
    contractId: SHELL_CONTRACT_ID,
    contractVersion: SHELL_CONTRACT_VERSION,
    projectionId: `sha256-${'a'.repeat(64)}`,
    sourcePublicationId: `sha256-${'b'.repeat(64)}`,
    assets: [
      {
        instanceId: 'menu.play',
        slotId: 'button-surface',
        assetId: 'asset.primary-action.default',
        path: 'assets/primary-action.default.png',
        sha256: `sha256-${'c'.repeat(64)}`,
      },
    ],
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
    const play = shellPresentationContract.requiredActions.find((action) => action.id === 'play');
    expect(play?.minimumCount).toBe(2);
    expect(play?.instanceIds).toEqual(['menu.node.current', 'menu.play']);
    expect(instances.get('menu.node.current')).toMatchObject({
      bindingId: 'flow.start-current',
      actionId: 'play',
    });

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

  it('keeps rendered role geometry separate from source raster requirements', () => {
    const buttonSlot = shellPresentationContract.assetSlots.find(
      (slot) => slot.id === 'button-surface',
    )!;
    expect(record(buttonSlot).geometry).toBeUndefined();
    expect(record(buttonSlot).sourceRaster).toEqual({
      minWidth: 72,
      minHeight: 48,
      aspectRatio: { min: 0.75, max: 6.25 },
    });
    expect(shellPresentationContract.roles.find(
      (role) => role.id === 'bottom-primary-action',
    )?.geometryCaps).toEqual({
      minWidth: 120,
      maxWidth: 300,
      minHeight: 48,
      maxHeight: 96,
    });
    expect(record(shellPresentationContract).assetRasterPolicy).toEqual({
      maxEdge: 4_096,
      maxAssets: 256,
      maxAssetBytes: 8_388_608,
      maxAggregateBytes: 67_108_864,
      maxDecodedPixels: 67_108_864,
    });
  });

  it('rejects malformed source raster and raster policy contract metadata', () => {
    expectContractIssue((candidate) => {
      record(record(candidate).assetRasterPolicy).maxEdge = 0;
    }, 'invalid-raster-policy');

    expectContractIssue((candidate) => {
      record(record(candidate).assetRasterPolicy).extraBudget = 1;
    }, 'unsupported-field');

    expectContractIssue((candidate) => {
      const slot = records(record(candidate).assetSlots)[0]!;
      record(record(slot).sourceRaster).minWidth = 0;
    }, 'invalid-source-raster');

    expectContractIssue((candidate) => {
      const slot = records(record(candidate).assetSlots)[0]!;
      record(record(record(slot).sourceRaster).aspectRatio).max = 0;
    }, 'invalid-source-raster');

    expectContractIssue((candidate) => {
      const slot = records(record(candidate).assetSlots)[0]!;
      slot.geometry = { minWidth: 1, maxWidth: 2, minHeight: 1, maxHeight: 2 };
    }, 'unsupported-field');

    expectContractIssue((candidate) => {
      const slot = records(record(candidate).assetSlots).find((entry) => entry.id === 'button-surface')!;
      slot.compatibleRoleIds = [];
    }, 'compatibility-mismatch');

    expectContractIssue((candidate) => {
      const slot = records(record(candidate).assetSlots).find((entry) => entry.id === 'button-surface')!;
      slot.compatibleRoleIds = ['top-icon-action'];
    }, 'compatibility-mismatch');
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

    expect(() =>
      projectShellGeometry({
        anchor: 'center',
        geometry: profile.geometry,
        viewport: profile.viewport,
        caps: { minWidth: -10, maxWidth: -1, minHeight: 10, maxHeight: 5 },
      }),
    ).toThrow(/caps/i);
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
      const action = records(record(candidate).requiredActions)[0]!;
      action.bindingId = 'state.primary-currency';
      for (const instanceId of action.instanceIds as string[]) {
        const instance = records(record(candidate).instances).find((item) => item.id === instanceId)!;
        instance.bindingId = 'state.primary-currency';
      }
    }, 'invalid-binding-kind');

    expectContractIssue((candidate) => {
      const role = records(record(candidate).roles)[0]!;
      role.id = 'green-play-button';
    }, 'non-neutral-id');

    expectContractIssue((candidate) => {
      const instance = records(record(candidate).instances).find((item) => item.id === 'settings.back')!;
      instance.parentInstanceId = 'settings.back';
    }, 'hierarchy-cycle');
  });

  it('fails closed when registry metadata cannot satisfy the trusted TypeScript shape', () => {
    expectContractIssue((candidate) => {
      record(candidate).schemaDialect = 42;
    }, 'missing-field');

    expectContractIssue((candidate) => {
      record(candidate).editableAst = { copy: null };
    }, 'missing-field');

    expectContractIssue((candidate) => {
      record(record(candidate).schemas).presentation = 'not-a-schema';
    }, 'invalid-type');

    expectContractIssue((candidate) => {
      (record(candidate).gameScreenNames as unknown[]).push('NotAGameScreen');
    }, 'unknown-screen');

    expectContractIssue((candidate) => {
      record(record(candidate).neutralIdPolicy).pattern = '[';
    }, 'invalid-pattern');
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

  it('validates required actions through every effective visual variant and viewport profile', () => {
    for (const mutate of [
      (pressed: JsonRecord) => {
        pressed.visibility = 'hidden';
      },
      (pressed: JsonRecord) => {
        pressed.opacity = 0;
      },
      (pressed: JsonRecord) => {
        pressed.geometry = {
          offset: { x: 1, y: 1 },
          size: { width: 0.01, height: 0.01 },
          fit: 'contain',
        };
      },
    ]) {
      const candidate = createDefaultShellPresentation();
      const play = candidate.pages
        .flatMap((page) => page.instances)
        .find((instance) => instance.id === 'menu.play')!;
      mutate(record(play.variants.pressed));
      expect(() => parseShellPresentation(candidate)).toThrow(/required (?:semantic instance|action)/i);
    }

    const overflow = createDefaultShellPresentation();
    overflow.pages
      .flatMap((page) => page.instances)
      .find((instance) => instance.id === 'menu.play')!.presentation.geometry.offset.x = 0.8;
    expect(() => parseShellPresentation(overflow, { viewportProfiles: [] })).toThrow(
      /viewport profile/i,
    );
  });

  it('rejects slot-incompatible assets in visual variants', () => {
    const source = validAssetCatalog();
    records(source.assets).push({
      id: 'asset.title.default',
      name: 'Default title logo',
      description: 'Logo surface used for the shell title.',
      slotId: 'title-logo',
      path: 'assets/title.default.png',
      mimeType: 'image/png',
      width: 240,
      height: 96,
      bytes: 1_024,
      hasAlpha: true,
      sha256: `sha256-${'3'.repeat(64)}`,
      provenance: {
        sourceId: 'kenney-ui-pack',
        sourcePath: 'UI/PNG/Blue/Default/title.png',
        sourceHash: `sha256-${'4'.repeat(64)}`,
        license: 'CC0-1.0',
      },
    });
    const catalog = parseShellAssetCatalog(source);
    const candidate = createDefaultShellPresentation();
    candidate.pages
      .flatMap((page) => page.instances)
      .find((instance) => instance.id === 'menu.play')!.variants.pressed!.assetId =
      'asset.title.default';
    expect(() => parseShellPresentation(candidate, { assetCatalog: catalog })).toThrow(
      /not role slot/i,
    );
  });

  it('requires an asset use to retain its slot fit in base and inherited variants', () => {
    const catalog = parseShellAssetCatalog(validAssetCatalog());
    const candidate = createDefaultShellPresentation();
    const play = candidate.pages
      .flatMap((page) => page.instances)
      .find((instance) => instance.id === 'menu.play')!;
    play.presentation.assetId = 'asset.primary-action.default';
    play.presentation.geometry.fit = 'contain';
    expect(() => parseShellPresentation(candidate, { assetCatalog: catalog })).toThrow(
      /requires cover fitting/i,
    );

    play.presentation.geometry.fit = 'cover';
    play.variants.pressed = {
      ...play.variants.pressed,
      geometry: { ...play.presentation.geometry, fit: 'contain' },
    };
    expect(() => parseShellPresentation(candidate, { assetCatalog: catalog })).toThrow(
      /requires cover fitting/i,
    );
  });

  it('always returns structured validation errors for malformed authored instances', () => {
    for (const field of ['accessibility', 'presentation'] as const) {
      const candidate = createDefaultShellPresentation() as unknown as JsonRecord;
      const instance = records(records(candidate.pages)[0]!.instances)[0]!;
      delete instance[field];
      try {
        parseShellPresentation(candidate);
        throw new Error('expected presentation validation to fail');
      } catch (error) {
        expect(error, field).toBeInstanceOf(ShellContractValidationError);
      }
    }
  });

  it('accepts high-resolution sources while enforcing slot floors, aspect, and edge safety', () => {
    expect(() => parseShellAssetCatalog(validAssetCatalog())).not.toThrow();

    const formerlyRenderedMax = validAssetCatalog();
    Object.assign(records(formerlyRenderedMax.assets)[0]!, {
      width: 4_096,
      height: 1_024,
    });
    expect(() => parseShellAssetCatalog(formerlyRenderedMax)).not.toThrow();

    expectCatalogIssue((candidate) => {
      Object.assign(records(candidate.assets)[0]!, { width: 71, height: 48 });
    }, 'source-raster-floor', '$.assets[0]');

    expectCatalogIssue((candidate) => {
      Object.assign(records(candidate.assets)[0]!, { width: 72, height: 97 });
    }, 'source-raster-aspect', '$.assets[0]');

    expectCatalogIssue((candidate) => {
      Object.assign(records(candidate.assets)[0]!, { width: 4_097, height: 1_024 });
    }, 'raster-edge-limit', '$.assets[0]');
  });

  it('bounds asset count, encoded bytes, and decoded pixel load deterministically', () => {
    expectCatalogIssue((candidate) => {
      records(candidate.assets)[0]!.bytes = 8_388_609;
    }, 'asset-byte-limit', '$.assets[0].bytes');

    expectCatalogIssue((candidate) => {
      candidate.assets = Array.from({ length: 257 }, (_, index) =>
        validAssetCatalogEntry({ id: `asset.primary-action.${String(index).padStart(3, '0')}` }),
      );
    }, 'asset-count-limit', '$.assets');

    expectCatalogIssue((candidate) => {
      candidate.assets = Array.from({ length: 9 }, (_, index) =>
        validAssetCatalogEntry({
          id: `asset.primary-action.${String(index).padStart(3, '0')}`,
          bytes: 8_388_608,
        }),
      );
    }, 'aggregate-byte-limit', '$.assets');

    expectCatalogIssue((candidate) => {
      candidate.assets = Array.from({ length: 17 }, (_, index) =>
        validAssetCatalogEntry({
          id: `asset.primary-action.${String(index).padStart(3, '0')}`,
          width: 4_096,
          height: 1_024,
          bytes: 1,
        }),
      );
    }, 'decoded-pixel-limit', '$.assets');
  });

  it('requires bounded semantic metadata and normalized provenance source paths', () => {
    expectCatalogIssue((candidate) => {
      records(candidate.assets)[0]!.name = '';
    }, 'invalid-asset-metadata', '$.assets[0].name');

    expectCatalogIssue((candidate) => {
      records(candidate.assets)[0]!.name = '🎮'.repeat(81);
    }, 'invalid-asset-metadata', '$.assets[0].name');

    expectCatalogIssue((candidate) => {
      records(candidate.assets)[0]!.description = 'a'.repeat(321);
    }, 'invalid-asset-metadata', '$.assets[0].description');

    for (const metadata of ['   ', `Button${String.fromCharCode(0)}surface`]) {
      expectCatalogIssue((candidate) => {
        records(candidate.assets)[0]!.description = metadata;
      }, 'invalid-asset-metadata', '$.assets[0].description');
    }

    for (const sourcePath of [
      '/UI/button.png',
      'UI\\button.png',
      'UI//button.png',
      'UI/./button.png',
      'UI/../button.png',
      'UI/button.png?raw=1',
      'UI/button.png#fragment',
      `UI/${String.fromCharCode(0)}button.png`,
    ]) {
      expectCatalogIssue((candidate) => {
        record(records(candidate.assets)[0]!.provenance).sourcePath = sourcePath;
      }, 'unsafe-source-path', '$.assets[0].provenance.sourcePath');
    }
  });

  it('enforces slot MIME and alpha policies independently of file extensions', () => {
    expectCatalogIssue((candidate) => {
      Object.assign(records(candidate.assets)[0]!, {
        id: 'asset.icon.default',
        slotId: 'icon-control',
        path: 'assets/icon.default.jpg',
        mimeType: 'image/jpeg',
        width: 100,
        height: 100,
      });
    }, 'unsafe-asset', '$.assets[0].mimeType');

    expectCatalogIssue((candidate) => {
      Object.assign(records(candidate.assets)[0]!, {
        id: 'asset.icon.default',
        slotId: 'icon-control',
        path: 'assets/icon.default.png',
        width: 100,
        height: 100,
        hasAlpha: false,
      });
    }, 'invalid-alpha', '$.assets[0].hasAlpha');
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

  it('keeps embedded presentation and artifact schemas aligned with parser safety', () => {
    const presentationSchema = record(shellPresentationContract.schemas.presentation);
    const definitions = record(presentationSchema.$defs);
    const fullPresentation = record(definitions.defaultPresentation);
    expect(records(fullPresentation.allOf)[1]!.required).toEqual([
      'geometry',
      'order',
      'visibility',
    ]);

    const visual = record(definitions.visual);
    const visualProperties = record(visual.properties);
    const copy = record(visualProperties.copy);
    const copyPattern = new RegExp(String(copy.pattern), 'u');
    expect(copyPattern.test('Plain Unicode copy 🎮')).toBe(true);
    for (const unsafe of [
      '<button>Play</button>',
      'DATA:image/png;base64,AAAA',
      `bad${String.fromCharCode(0)}copy`,
      String.fromCharCode(0xd800),
    ]) {
      expect(copyPattern.test(unsafe), unsafe).toBe(false);
    }
    const colors = record(visualProperties.colors);
    expect(record(colors.propertyNames).enum).toEqual([
      'background',
      'foreground',
      'accent',
      'border',
      'shadow',
    ]);

    const projectionSchema = record(shellPresentationContract.schemas.projectionRevision);
    const projectionProperties = record(projectionSchema.properties);
    const artifacts = record(projectionProperties.artifacts);
    const artifactPath = record(record(record(artifacts.items).properties).path);
    const pathRules = records(artifactPath.anyOf);
    const schemaAcceptsPath = (path: string): boolean =>
      pathRules.some((rule) =>
        Array.isArray(rule.enum)
          ? rule.enum.includes(path)
          : typeof rule.pattern === 'string' && new RegExp(rule.pattern, 'u').test(path),
      );
    expect(schemaAcceptsPath('presentation.ts')).toBe(true);
    expect(schemaAcceptsPath('assets/ui/button.png')).toBe(true);
    for (const unsafe of ['../presentation.ts', 'assets/a/../b.png', 'assets/a//b.png']) {
      expect(schemaAcceptsPath(unsafe), unsafe).toBe(false);
    }

    const assetCatalogSchema = record(shellPresentationContract.schemas.assetCatalog);
    const assetCatalogProperties = record(assetCatalogSchema.properties);
    const assets = record(assetCatalogProperties.assets);
    expect(assets.maxItems).toBe(256);
    const asset = record(assets.items);
    expect(asset.required).toEqual([
      'id',
      'name',
      'description',
      'slotId',
      'path',
      'mimeType',
      'width',
      'height',
      'bytes',
      'hasAlpha',
      'sha256',
      'provenance',
    ]);
    const assetProperties = record(asset.properties);
    expect(record(assetProperties.width).maximum).toBe(4_096);
    expect(record(assetProperties.height).maximum).toBe(4_096);
    expect(record(assetProperties.bytes).maximum).toBe(8_388_608);
    expect(record(assetProperties.name).maxLength).toBe(80);
    expect(record(assetProperties.description).maxLength).toBe(320);
    const descriptionPattern = new RegExp(String(record(assetProperties.description).pattern), 'u');
    expect(descriptionPattern.test('Primary button surface')).toBe(true);
    expect(descriptionPattern.test('   ')).toBe(false);
    expect(descriptionPattern.test(`Button${String.fromCharCode(0)}surface`)).toBe(false);
    const provenance = record(assetProperties.provenance);
    expect(provenance.required).toContain('sourcePath');
    const sourcePath = record(record(provenance.properties).sourcePath);
    const sourcePathPattern = new RegExp(String(sourcePath.pattern), 'u');
    expect(sourcePathPattern.test('UI/PNG/Blue/button.png')).toBe(true);
    for (const unsafe of [
      '/UI/button.png',
      'UI\\button.png',
      'UI//button.png',
      'UI/../button.png',
      'UI/button.png?raw=1',
    ]) {
      expect(sourcePathPattern.test(unsafe), unsafe).toBe(false);
    }
  });

  it('covers valid and fail-closed asset identity projections', () => {
    expect(() => parseAssetIdentityProjection(validAssetIdentityProjection())).not.toThrow();

    const mutations: Array<(candidate: JsonRecord) => void> = [
      (candidate) => {
        records(candidate.assets).push(structuredClone(records(candidate.assets)[0]!));
      },
      (candidate) => {
        records(candidate.assets)[0]!.slotId = 'unknown-slot';
      },
      (candidate) => {
        records(candidate.assets)[0]!.instanceId = '../menu.play';
      },
      (candidate) => {
        records(candidate.assets)[0]!.path = 'assets/a/../button.png';
      },
      (candidate) => {
        records(candidate.assets)[0]!.sha256 = 'sha256-invalid';
      },
      (candidate) => {
        records(candidate.assets)[0]!.url = 'https://example.com/button.png';
      },
    ];
    for (const mutate of mutations) {
      const candidate = validAssetIdentityProjection();
      mutate(candidate);
      expect(() => parseAssetIdentityProjection(candidate)).toThrow(ShellContractValidationError);
    }
  });

  it('validates the immutable projection pointer and required generated files', async () => {
    await expect(parseProjectionRevision(await validProjectionRevision())).resolves.toBeTruthy();

    const missingPresentation = await validProjectionRevision();
    missingPresentation.artifacts = records(missingPresentation.artifacts).filter(
      (artifact) => artifact.path !== 'presentation.ts',
    );
    await expect(parseProjectionRevision(missingPresentation)).rejects.toThrow(/presentation\.ts/);

    const unsafePath = await validProjectionRevision();
    records(unsafePath.artifacts)[0]!.path = '../asset-identity.json';
    await expect(parseProjectionRevision(unsafePath)).rejects.toThrow(/artifact path/i);

    const staleArtifact = await validProjectionRevision();
    records(staleArtifact.artifacts)[0]!.sha256 = `sha256-${'f'.repeat(64)}`;
    await expect(parseProjectionRevision(staleArtifact)).rejects.toThrow(/projection id/i);
  });

  it('binds project JSON and portable export hashes into one compatible publication record', async () => {
    await expect(parseShellPublishedRevision(await validPublishedRevision())).resolves.toBeTruthy();

    const mixed = await validPublishedRevision();
    mixed.states = ['menu', 'level', 'settings', 'pause', 'fail', 'win'];
    await expect(parseShellPublishedRevision(mixed)).rejects.toThrow(/canonical order/i);

    const stale = await validPublishedRevision();
    stale.contractVersion = '2.0.0';
    await expect(parseShellPublishedRevision(stale)).rejects.toThrow(/incompatible/i);

    const staleContent = await validPublishedRevision();
    staleContent.projectJsonHash = `sha256-${'f'.repeat(64)}`;
    await expect(parseShellPublishedRevision(staleContent)).rejects.toThrow(/publication id/i);
  });

  it('verifies the full canonical compatibility identity', async () => {
    const compatibility = await createShellPublicationCompatibility();
    expect(compatibility).toEqual({
      contractId: SHELL_CONTRACT_ID,
      contractVersion: SHELL_CONTRACT_VERSION,
      compatibilityHash: await hashShellPresentationContract(),
    });
    expect(await isShellPublicationCompatible(compatibility)).toBe(true);
    await expect(assertShellPublicationCompatible(compatibility)).resolves.toBeUndefined();

    const stale = {
      ...compatibility,
      compatibilityHash: `sha256-${'0'.repeat(64)}`,
    };
    expect(await isShellPublicationCompatible(stale)).toBe(false);
    await expect(assertShellPublicationCompatible(stale)).rejects.toThrow(/compatibility/i);

    const invalidContract = mutableContract();
    invalidContract.states = invalidContract.states.slice(1);
    await expect(hashShellPresentationContract(invalidContract)).rejects.toThrow(
      /missing required state/i,
    );
  });

  it('serializes canonically and hashes repeatably', async () => {
    const left = { z: [3, { b: 2, a: 1 }], a: 'copy' };
    const right = { a: 'copy', z: [3, { a: 1, b: 2 }] };

    expect(canonicalizeJson(left)).toBe(canonicalizeJson(right));
    expect(await hashCanonicalJson(left)).toBe(await hashCanonicalJson(right));
    expect(await hashCanonicalJson(left)).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(() => canonicalizeJson({ unsafe: Number.POSITIVE_INFINITY })).toThrow(/finite/i);

    const reserved = JSON.parse('{"__proto__":{"polluted":true},"x":1}') as JsonRecord;
    expect(canonicalizeJson(reserved)).toBe('{"__proto__":{"polluted":true},"x":1}');
    expect(await hashCanonicalJson(reserved)).not.toBe(await hashCanonicalJson({ x: 1 }));

    let deep: unknown = null;
    for (let depth = 0; depth < 130; depth += 1) deep = [deep];
    expect(() => canonicalizeJson(deep)).toThrow(/nesting depth/i);
  });

  it('bounds validation diagnostics for adversarially large malformed collections', () => {
    const candidate = {
      contractId: SHELL_CONTRACT_ID,
      contractVersion: SHELL_CONTRACT_VERSION,
      pages: Array.from({ length: 10_000 }, () => null),
    };
    try {
      parseShellPresentation(candidate);
      throw new Error('expected presentation validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ShellContractValidationError);
      const validationError = error as ShellContractValidationError;
      expect(validationError.issues.length).toBeLessThanOrEqual(256);
      expect(validationError.message.length).toBeLessThan(20_000);
      expect(validationError.issues.some((issue) => issue.code === 'too-many-issues')).toBe(true);
    }
  });
});
