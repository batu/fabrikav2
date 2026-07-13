import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SHELL_CONTRACT_ID,
  SHELL_CONTRACT_IDS,
  SHELL_CONTRACT_V2_ID,
  SHELL_CONTRACT_V2_VERSION,
  SHELL_CONTRACT_VERSION,
  SHELL_RENDERER_PROFILE_IDS,
  SHELL_STATE_IDS,
  SHELL_STATE_IDS_V2,
  ShellContractValidationError,
  computeShellPublicationIdV2,
  computeShellProjectionIdV2,
  createDefaultShellPresentation,
  createDefaultShellPresentationForContract,
  createDefaultShellPresentationV2,
  createShellPublicationCompatibilityForContract,
  getShellContractById,
  hashShellContractById,
  isShellPublicationCompatibleForContract,
  migrateShellPresentationV1ToV2,
  parseProjectionRevisionV2,
  parseShellAssetCatalogDocument,
  parseShellAssetIdentityDocument,
  parseShellPresentationContractV2,
  parseShellPresentationDocument,
  parseShellPresentationV2,
  parseShellProjectionRevisionDocument,
  parseShellPublicationDocument,
  parseShellPublishedRevisionV2,
  shellPresentationContract,
  shellPresentationContractV2,
  hashCanonicalJson,
  type ShellProjectionRevisionV2,
  type ShellPublishedRevisionV2,
} from '../src/shellContract.ts';

const v1ContractPath = resolve(import.meta.dirname, '../contracts/shell-presentation.v1.json');
const rawV2 = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../contracts/shell-presentation.v2.json'), 'utf8'),
) as Record<string, unknown>;

function issueCodes(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof ShellContractValidationError) {
      return error.issues.map((issue) => issue.code);
    }
    throw error;
  }
  throw new Error('Expected a ShellContractValidationError.');
}

async function issueCodesAsync(run: () => Promise<unknown>): Promise<string[]> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ShellContractValidationError) {
      return error.issues.map((issue) => issue.code);
    }
    throw error;
  }
  throw new Error('Expected a ShellContractValidationError.');
}

async function validPublicationV2(
  rendererProfile: 'dom-css' | 'phaser-native',
): Promise<ShellPublishedRevisionV2> {
  const profile = shellPresentationContractV2.rendererProfiles.find(
    (candidate) => candidate.id === rendererProfile,
  )!;
  const editorSources = await Promise.all(
    profile.editorSourceKinds.map(async (kind) => ({
      kind,
      sha256: await hashCanonicalJson({ kind, seed: 'registry-test' }),
    })),
  );
  const revision = {
    contractId: SHELL_CONTRACT_V2_ID,
    contractVersion: SHELL_CONTRACT_V2_VERSION,
    rendererProfile,
    editorSources,
    assetCatalogHash: await hashCanonicalJson({ catalog: rendererProfile }),
    pageCount: 7 as const,
    states: [...SHELL_STATE_IDS_V2],
  };
  return { ...revision, publicationId: await computeShellPublicationIdV2(revision) };
}

async function validProjectionV2(
  rendererProfile: 'dom-css' | 'phaser-native',
  paths: string[],
): Promise<ShellProjectionRevisionV2> {
  const artifacts = await Promise.all(
    [...paths].sort().map(async (path) => ({
      path,
      sha256: await hashCanonicalJson({ path }),
      bytes: 64,
    })),
  );
  const base = {
    contractId: SHELL_CONTRACT_V2_ID,
    contractVersion: SHELL_CONTRACT_V2_VERSION,
    rendererProfile,
    compatibilityHash: await hashShellContractById(SHELL_CONTRACT_V2_ID),
    sourcePublicationId: await hashCanonicalJson({ source: rendererProfile }),
    artifacts,
  };
  const projectionId = await computeShellProjectionIdV2(base);
  return { ...base, projectionId, revisionPath: `design/revisions/${projectionId}` };
}

const DOM_ARTIFACTS = ['tokens.css', 'copy.ts', 'assets.ts', 'presentation.ts', 'asset-identity.json'];
const PHASER_ARTIFACTS = ['scene-manifest.json', 'asset-pack.json', 'asset-identity.json', 'scenes/menu.ts'];

describe('shell contract compatibility cut', () => {
  it('keeps the v1 contract bytes and exports unchanged', () => {
    const bytes = readFileSync(v1ContractPath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    // Pinned at the U1 baseline: any drift here is a compatibility break.
    expect(`sha256-${digest}`).toBe(
      'sha256-2ccf3700ee1f9c6b3c821a448c7cc13dfe241cc19dc9a8ef0aa935ee990cabbb',
    );
    expect(SHELL_CONTRACT_ID).toBe('shell-presentation-v1');
    expect(SHELL_CONTRACT_VERSION).toBe('1.0.0');
    expect([...SHELL_STATE_IDS]).toEqual(['menu', 'level', 'settings', 'pause', 'win', 'fail']);
    expect(shellPresentationContract.publication.publicationIdDomain).toBe('shell-publication-v1');
  });

  it('registers exactly the v1 and v2 contracts', () => {
    expect([...SHELL_CONTRACT_IDS]).toEqual(['shell-presentation-v1', 'shell-presentation-v2']);
    expect(getShellContractById(SHELL_CONTRACT_ID).contractVersion).toBe('1.0.0');
    expect(getShellContractById(SHELL_CONTRACT_V2_ID).contractVersion).toBe('2.0.0');
    expect(() => getShellContractById('shell-presentation-v9')).toThrowError(
      ShellContractValidationError,
    );
    const codes = issueCodes(() => getShellContractById('shell-presentation-v9'));
    expect(codes).toContain('unknown-contract');
  });

  it('hashes each registered contract to a distinct canonical identity', async () => {
    const v1Hash = await hashShellContractById(SHELL_CONTRACT_ID);
    const v2Hash = await hashShellContractById(SHELL_CONTRACT_V2_ID);
    expect(v1Hash).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(v2Hash).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(v1Hash).not.toBe(v2Hash);
  });
});

describe('shell-presentation-v2 contract document', () => {
  it('declares seven ordered states including shop', () => {
    expect([...SHELL_STATE_IDS_V2]).toEqual(['menu', 'level', 'shop', 'settings', 'pause', 'win', 'fail']);
    expect(shellPresentationContractV2.publication.requiredStates).toEqual([
      'menu', 'level', 'shop', 'settings', 'pause', 'win', 'fail',
    ]);
    const shopState = shellPresentationContractV2.states.find((state) => state.id === 'shop');
    expect(shopState?.gameScreenNames).toEqual(['Shop']);
  });

  it('declares the shop vocabulary: bindings, roles, family, actions, instances', () => {
    const bindingIds = shellPresentationContractV2.bindings.map((binding) => binding.id);
    expect(bindingIds).toEqual(
      expect.arrayContaining([
        'flow.open-shop',
        'flow.shop-back',
        'commerce.restore',
        'state.shop-items',
        'state.secondary-currency',
      ]),
    );
    const roleIds = shellPresentationContractV2.roles.map((role) => role.id);
    expect(roleIds).toEqual(
      expect.arrayContaining(['page-surface', 'header-back-action', 'item-grid', 'item-card']),
    );
    const shopItem = shellPresentationContractV2.stateFamilies.find((family) => family.id === 'shop-item');
    expect(shopItem?.requiredVariants).toEqual(['available', 'owned', 'locked']);
    const actionIds = shellPresentationContractV2.requiredActions.map((action) => action.id);
    expect(actionIds).toEqual(expect.arrayContaining(['menu.shop', 'shop-back', 'shop-restore']));
    const menuShop = shellPresentationContractV2.requiredActions.find((action) => action.id === 'menu.shop');
    expect(menuShop?.actionHook).toBe('shop');
    const itemCards = shellPresentationContractV2.instances.filter(
      (instance) => instance.roleId === 'item-card',
    );
    expect(itemCards.map((instance) => instance.id)).toEqual([
      'shop.item.available',
      'shop.item.owned',
      'shop.item.locked',
    ]);
    // Item cards are read-only: no action identity, no action hook.
    expect(itemCards.every((instance) => instance.actionId === undefined)).toBe(true);
  });

  it('makes settings a full page surface while pause stays a modal dialog', () => {
    const settingsPage = shellPresentationContractV2.instances.find(
      (instance) => instance.id === 'settings.page',
    );
    const pausePanel = shellPresentationContractV2.instances.find(
      (instance) => instance.id === 'pause.panel',
    );
    expect(settingsPage?.roleId).toBe('page-surface');
    expect(settingsPage?.accessibility.role).toBe('region');
    expect(pausePanel?.roleId).toBe('modal-panel');
    expect(pausePanel?.accessibility.role).toBe('dialog');
    const settingsBack = shellPresentationContractV2.instances.find(
      (instance) => instance.id === 'settings.back',
    );
    expect(settingsBack?.roleId).toBe('header-back-action');
    expect(shellPresentationContractV2.instances.some((instance) => instance.id === 'settings.panel')).toBe(
      false,
    );
  });

  it('models the FTD menu nav dock, win claim, and fail rescue (card qWCv9tUo 2026-07-13)', () => {
    const instances = new Map(
      shellPresentationContractV2.instances.map((instance) => [instance.id, instance]),
    );
    const roleIds = new Set(shellPresentationContractV2.roles.map((role) => role.id));
    const bindingIds = new Set(shellPresentationContractV2.bindings.map((binding) => binding.id));
    const actionIds = shellPresentationContractV2.requiredActions.map((action) => action.id);

    // Menu: a persistent bottom nav GROUP parents shop, play, settings — and the
    // three sit contiguously in shop < play < settings traversal order.
    expect(roleIds.has('bottom-nav')).toBe(true);
    expect(instances.get('menu.nav')?.roleId).toBe('bottom-nav');
    for (const id of ['menu.shop', 'menu.play', 'menu.settings']) {
      expect(instances.get(id)?.parentInstanceId).toBe('menu.nav');
      expect(instances.get(id)?.accessibility.traversalGroup).toBe('nav');
    }
    const navChildOrder = shellPresentationContractV2.instances
      .filter((instance) => instance.parentInstanceId === 'menu.nav')
      .map((instance) => instance.id);
    expect(navChildOrder).toEqual(['menu.shop', 'menu.play', 'menu.settings']);
    // Play stays the dominant primary action of the dock.
    expect(instances.get('menu.play')?.roleId).toBe('bottom-primary-action');

    // Win: reward readout + claim + claim-double replace the initial Next/Home.
    expect(bindingIds.has('state.reward-amount')).toBe(true);
    expect(instances.get('win.reward')?.bindingId).toBe('state.reward-amount');
    expect(instances.get('win.claim')?.bindingId).toBe('flow.claim');
    expect(instances.get('win.claim')?.actionId).toBe('win-claim');
    expect(instances.get('win.claim-double')?.bindingId).toBe('flow.claim-double');
    expect(instances.get('win.claim-double')?.actionId).toBe('win-claim-double');
    expect(instances.has('win.home')).toBe(false);
    expect(instances.get('win.next')?.bindingId).toBe('flow.next'); // still present, runtime-gated
    expect(actionIds).toEqual(expect.arrayContaining(['win-claim', 'win-claim-double', 'win-next']));
    expect(actionIds).not.toContain('win-home');
    const claimDouble = shellPresentationContractV2.requiredActions.find((a) => a.id === 'win-claim-double');
    expect(claimDouble?.actionHook).toBe('claim-double');

    // Fail: rescue surface — currency + continue-coins + retry + optional bundle,
    // and NO Home on the required initial surface.
    expect(instances.get('fail.currency')?.bindingId).toBe('state.primary-currency');
    expect(instances.get('fail.continue-coins')?.bindingId).toBe('flow.continue-coins');
    expect(instances.get('fail.continue-coins')?.actionId).toBe('fail-continue-coins');
    expect(instances.get('fail.retry')?.actionId).toBe('fail-retry');
    // The bundle is optional: an IAP-bound action instance carrying no required
    // action identity, so a lane may omit or disable it without breaking Retry.
    expect(instances.get('fail.bundle')?.bindingId).toBe('commerce.bundle');
    expect(instances.get('fail.bundle')?.required).toBe(false);
    expect(instances.get('fail.bundle')?.actionId).toBeUndefined();
    expect(instances.has('fail.home')).toBe(false);
    expect(actionIds).toEqual(expect.arrayContaining(['fail-continue-coins', 'fail-retry']));
    expect(actionIds).not.toContain('fail-home');
  });

  it('rejects a v2 contract whose renderer profiles are missing or indistinguishable', () => {
    const withoutProfiles = structuredClone(rawV2);
    delete withoutProfiles.rendererProfiles;
    expect(issueCodes(() => parseShellPresentationContractV2(withoutProfiles))).toContain(
      'missing-profile',
    );

    const collapsed = structuredClone(rawV2) as {
      rendererProfiles: Array<{ requiredArtifacts: string[]; allowedArtifactPatterns: string[] }>;
    };
    collapsed.rendererProfiles[1].requiredArtifacts = [
      ...collapsed.rendererProfiles[0].requiredArtifacts,
    ];
    expect(issueCodes(() => parseShellPresentationContractV2(collapsed))).toContain(
      'indistinguishable-profiles',
    );
  });

  it('fails closed when a six-state contract is parsed against the v2 shape', () => {
    const rawV1 = JSON.parse(readFileSync(v1ContractPath, 'utf8')) as Record<string, unknown>;
    expect(issueCodes(() => parseShellPresentationContractV2(rawV1))).toContain('missing-state');
  });
});

describe('registry dispatch by input contractId', () => {
  it('routes presentation documents by contractId', () => {
    const v1Document = createDefaultShellPresentation();
    const v2Document = createDefaultShellPresentationV2();
    expect(parseShellPresentationDocument(v1Document).contractId).toBe(SHELL_CONTRACT_ID);
    expect(parseShellPresentationDocument(v2Document).contractId).toBe(SHELL_CONTRACT_V2_ID);
    expect(v2Document.pages.map((page) => page.stateId)).toEqual([...SHELL_STATE_IDS_V2]);
    expect(issueCodes(() => parseShellPresentationDocument({ contractId: 'nope', pages: [] }))).toContain(
      'unknown-contract',
    );
  });

  it('routes default-document creation by contractId', () => {
    expect(createDefaultShellPresentationForContract(SHELL_CONTRACT_ID).pages).toHaveLength(6);
    expect(createDefaultShellPresentationForContract(SHELL_CONTRACT_V2_ID).pages).toHaveLength(7);
    expect(issueCodes(() => createDefaultShellPresentationForContract('shell-presentation-v9'))).toContain(
      'unknown-contract',
    );
  });

  it('rejects a v1 presentation document that claims the v2 contract', () => {
    const document = createDefaultShellPresentation();
    const forged = { ...document, contractId: SHELL_CONTRACT_V2_ID, contractVersion: '2.0.0' };
    const codes = issueCodes(() => parseShellPresentationDocument(forged));
    expect(codes).toContain('missing-state');
  });

  it('routes asset catalogs by contractId', () => {
    const v2Catalog = { contractId: SHELL_CONTRACT_V2_ID, contractVersion: '2.0.0', assets: [] };
    expect(parseShellAssetCatalogDocument(v2Catalog).contractId).toBe(SHELL_CONTRACT_V2_ID);
    const v1Catalog = { contractId: SHELL_CONTRACT_ID, contractVersion: '1.0.0', assets: [] };
    expect(parseShellAssetCatalogDocument(v1Catalog).contractId).toBe(SHELL_CONTRACT_ID);
    expect(issueCodes(() => parseShellAssetCatalogDocument({ contractId: 'x', assets: [] }))).toContain(
      'unknown-contract',
    );
  });

  it('verifies publication compatibility per registered contract', async () => {
    for (const contractId of SHELL_CONTRACT_IDS) {
      const compatibility = await createShellPublicationCompatibilityForContract(contractId);
      expect(await isShellPublicationCompatibleForContract(compatibility)).toBe(true);
    }
    const v1Compatibility = await createShellPublicationCompatibilityForContract(SHELL_CONTRACT_ID);
    const cross = { ...v1Compatibility, contractId: SHELL_CONTRACT_V2_ID };
    expect(await isShellPublicationCompatibleForContract(cross)).toBe(false);
    expect(
      await isShellPublicationCompatibleForContract({
        contractId: 'shell-presentation-v9',
        contractVersion: '9.0.0',
        compatibilityHash: v1Compatibility.compatibilityHash,
      }),
    ).toBe(false);
  });
});

describe('v2 publication records', () => {
  it('accepts a canonical publication for each renderer profile', async () => {
    expect([...SHELL_RENDERER_PROFILE_IDS]).toEqual(['dom-css', 'phaser-native']);
    for (const profile of ['dom-css', 'phaser-native'] as const) {
      const publication = await validPublicationV2(profile);
      const parsed = await parseShellPublishedRevisionV2(publication);
      expect(parsed.rendererProfile).toBe(profile);
      const dispatched = await parseShellPublicationDocument(publication);
      expect(dispatched.publicationId).toBe(publication.publicationId);
    }
  });

  it('rejects publications missing shop, missing pages, or missing the profile', async () => {
    const publication = await validPublicationV2('dom-css');
    const missingShop = {
      ...publication,
      states: publication.states.filter((state) => state !== 'shop'),
    };
    expect(await issueCodesAsync(() => parseShellPublishedRevisionV2(missingShop))).toContain(
      'missing-state',
    );
    const sixPages = { ...publication, pageCount: 6 };
    expect(await issueCodesAsync(() => parseShellPublishedRevisionV2(sixPages))).toContain(
      'page-mismatch',
    );
    const { rendererProfile: _dropped, ...withoutProfile } = publication;
    expect(await issueCodesAsync(() => parseShellPublishedRevisionV2(withoutProfile))).toContain(
      'unknown-profile',
    );
  });

  it('requires exactly the profile-declared editor source kinds', async () => {
    const publication = await validPublicationV2('dom-css');
    const phaserSources = (await validPublicationV2('phaser-native')).editorSources;
    const crossed = { ...publication, editorSources: phaserSources };
    const codes = await issueCodesAsync(() => parseShellPublishedRevisionV2(crossed));
    expect(codes).toContain('missing-editor-source');
    const unsorted = {
      ...publication,
      editorSources: [...publication.editorSources].reverse(),
    };
    expect(await issueCodesAsync(() => parseShellPublishedRevisionV2(unsorted))).toContain(
      'non-canonical-order',
    );
  });

  it('rejects the legacy v1 hash fields under the v2 contract while v1 still parses', async () => {
    const v1Style = {
      contractId: SHELL_CONTRACT_V2_ID,
      contractVersion: SHELL_CONTRACT_V2_VERSION,
      publicationId: await hashCanonicalJson({ id: 1 }),
      projectJsonHash: await hashCanonicalJson({ id: 2 }),
      portableExportHash: await hashCanonicalJson({ id: 3 }),
      componentRecordsHash: await hashCanonicalJson({ id: 4 }),
      assetCatalogHash: await hashCanonicalJson({ id: 5 }),
      pageCount: 7,
      states: [...SHELL_STATE_IDS_V2],
    };
    const codes = await issueCodesAsync(() => parseShellPublicationDocument(v1Style));
    expect(codes).toContain('unsupported-field');
  });
});

describe('v2 projection revisions and profile isolation', () => {
  it('accepts each profile with its own artifact set', async () => {
    const dom = await validProjectionV2('dom-css', [...DOM_ARTIFACTS, 'assets/icon-control-shop.png']);
    expect((await parseProjectionRevisionV2(dom)).rendererProfile).toBe('dom-css');
    const phaser = await validProjectionV2('phaser-native', [
      ...PHASER_ARTIFACTS,
      'assets/icon-control-shop.png',
    ]);
    const dispatched = await parseShellProjectionRevisionDocument(phaser);
    expect(dispatched.projectionId).toBe(phaser.projectionId);
  });

  it("rejects the other profile's artifacts as profile-mismatch", async () => {
    const domWithScene = await validProjectionV2('dom-css', [...DOM_ARTIFACTS, 'scene-manifest.json']);
    expect(await issueCodesAsync(() => parseProjectionRevisionV2(domWithScene))).toContain(
      'profile-mismatch',
    );
    const phaserWithTokens = await validProjectionV2('phaser-native', [...PHASER_ARTIFACTS, 'tokens.css']);
    expect(await issueCodesAsync(() => parseProjectionRevisionV2(phaserWithTokens))).toContain(
      'profile-mismatch',
    );
  });

  it('rejects missing-profile, missing-artifact, and unsafe paths', async () => {
    const dom = await validProjectionV2('dom-css', DOM_ARTIFACTS);
    const { rendererProfile: _dropped, ...missingProfile } = dom;
    expect(await issueCodesAsync(() => parseProjectionRevisionV2(missingProfile))).toContain(
      'unknown-profile',
    );
    const missingArtifact = await validProjectionV2(
      'dom-css',
      DOM_ARTIFACTS.filter((path) => path !== 'presentation.ts'),
    );
    expect(await issueCodesAsync(() => parseProjectionRevisionV2(missingArtifact))).toContain(
      'missing-artifact',
    );
    const unsafe = await validProjectionV2('dom-css', [...DOM_ARTIFACTS, 'evil.exe']);
    expect(await issueCodesAsync(() => parseProjectionRevisionV2(unsafe))).toContain('unsafe-artifact');
  });

  it('keeps the v1 projection dispatcher path intact', async () => {
    const badV1 = { contractId: SHELL_CONTRACT_ID, contractVersion: '1.0.0' };
    await expect(parseShellProjectionRevisionDocument(badV1)).rejects.toThrowError(
      ShellContractValidationError,
    );
    expect(await issueCodesAsync(() => parseShellProjectionRevisionDocument({ contractId: 'x' }))).toContain(
      'unknown-contract',
    );
  });
});

describe('v2 phaser-native canonical bundled layout (card qWCv9tUo item 6)', () => {
  // The runtime phaser-native profile is intentionally UNCHANGED here: these
  // tests pin the decided bundled-artifact contract (lowercase scenes/*.js plus
  // the three required manifests) and prove raw Phaser-Editor source paths are
  // rejected. U5 owns the bundler that produces this layout; U1 only fences it.
  it('accepts the lowercase bundled scene plus required manifests', async () => {
    const bundled = await validProjectionV2('phaser-native', [
      'scene-manifest.json',
      'asset-pack.json',
      'asset-identity.json',
      'scenes/shell.js',
      'assets/icon-control-shop.png',
    ]);
    expect((await parseProjectionRevisionV2(bundled)).rendererProfile).toBe('phaser-native');
  });

  it('rejects raw Phaser-Editor component/prefab/PascalCase source paths', async () => {
    for (const raw of ['components/Button.ts', 'prefabs/Card.prefab', 'scenes/Shell.ts']) {
      const projection = await validProjectionV2('phaser-native', [...PHASER_ARTIFACTS, raw]);
      expect(await issueCodesAsync(() => parseProjectionRevisionV2(projection))).toContain(
        'unsafe-artifact',
      );
    }
  });
});

describe('v2 asset-identity breaks the projectionId cycle (card qWCv9tUo item 8)', () => {
  // V1 embedded projectionId inside asset-identity.json while projectionId is
  // ALSO hashed from the artifact set (asset-identity.json included) — no file
  // could ever contain its own downstream hash. V2 drops the field; this proves
  // a real, file-backed preimage now exists and an embedded id is rejected.
  it('validates a file-backed asset-identity.json feeding a realizable projectionId', async () => {
    const assetIdentity = {
      contractId: SHELL_CONTRACT_V2_ID,
      contractVersion: SHELL_CONTRACT_V2_VERSION,
      sourcePublicationId: await hashCanonicalJson({ source: 'phaser-native' }),
      assets: [
        {
          instanceId: 'menu.play',
          slotId: 'button-surface',
          assetId: 'asset.primary-action.default',
          path: 'assets/primary-action.default.png',
          sha256: await hashCanonicalJson({ raster: 'primary-action' }),
        },
      ],
    };
    // The file is valid on its own — no placeholder projectionId inside it.
    expect(() => parseShellAssetIdentityDocument(assetIdentity)).not.toThrow();

    const dir = mkdtempSync(join(tmpdir(), 'u1-asset-identity-'));
    try {
      const filePath = join(dir, 'asset-identity.json');
      const bytes = Buffer.from(JSON.stringify(assetIdentity, null, 2), 'utf8');
      writeFileSync(filePath, bytes);
      // Hash the REAL on-disk bytes — the artifact hash that feeds projectionId.
      const assetIdentitySha = `sha256-${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;

      const artifacts = [
        { path: 'asset-identity.json', sha256: assetIdentitySha, bytes: bytes.length },
        { path: 'asset-pack.json', sha256: await hashCanonicalJson({ path: 'asset-pack.json' }), bytes: 64 },
        { path: 'scene-manifest.json', sha256: await hashCanonicalJson({ path: 'scene-manifest.json' }), bytes: 64 },
      ].sort((a, b) => (a.path < b.path ? -1 : 1));
      const base = {
        contractId: SHELL_CONTRACT_V2_ID,
        contractVersion: SHELL_CONTRACT_V2_VERSION,
        rendererProfile: 'phaser-native' as const,
        compatibilityHash: await hashShellContractById(SHELL_CONTRACT_V2_ID),
        sourcePublicationId: assetIdentity.sourcePublicationId,
        artifacts,
      };
      const projectionId = await computeShellProjectionIdV2(base);
      const projection = { ...base, projectionId, revisionPath: `design/revisions/${projectionId}` };
      expect((await parseProjectionRevisionV2(projection)).projectionId).toBe(projectionId);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a v2 asset-identity.json that embeds a projectionId', async () => {
    const embedded = {
      contractId: SHELL_CONTRACT_V2_ID,
      contractVersion: SHELL_CONTRACT_V2_VERSION,
      projectionId: `sha256-${'a'.repeat(64)}`,
      sourcePublicationId: await hashCanonicalJson({ source: 'x' }),
      assets: [],
    };
    expect(issueCodes(() => parseShellAssetIdentityDocument(embedded))).toContain('unsupported-field');
  });

  it('still requires projectionId inside a frozen v1 asset-identity file', () => {
    const v1WithoutId = {
      contractId: SHELL_CONTRACT_ID,
      contractVersion: SHELL_CONTRACT_VERSION,
      sourcePublicationId: `sha256-${'b'.repeat(64)}`,
      assets: [],
    };
    // Dispatches by contractId to the frozen v1 context, which still demands it.
    expect(() => parseShellAssetIdentityDocument(v1WithoutId)).toThrow(ShellContractValidationError);
  });
});

describe('v1 to v2 migration', () => {
  it('migrates the neutral v1 default document to a fresh v2 identity', () => {
    const source = createDefaultShellPresentation();
    const playPage = source.pages.find((page) => page.stateId === 'menu')!;
    const play = playPage.instances.find((instance) => instance.id === 'menu.play')!;
    play.presentation.copy = 'Start the run';

    const { document, report } = migrateShellPresentationV1ToV2(source);
    expect(document.contractId).toBe(SHELL_CONTRACT_V2_ID);
    expect(document.contractVersion).toBe('2.0.0');
    expect(document.pages.map((page) => page.stateId)).toEqual([...SHELL_STATE_IDS_V2]);
    // parseShellPresentationV2 already ran inside the migration; run again explicitly.
    expect(() => parseShellPresentationV2(document)).not.toThrow();

    const migratedPlay = document.pages
      .find((page) => page.stateId === 'menu')!
      .instances.find((instance) => instance.id === 'menu.play')!;
    expect(migratedPlay.presentation.copy).toBe('Start the run');

    expect(report.carriedInstanceIds).toContain('menu.play');
    expect(report.carriedInstanceIds).toContain('settings.music');
    expect(report.resetInstanceIds).toEqual(['settings.back']);
    // The FTD structure rewire drops the header Home affordances from the win
    // claim and fail rescue surfaces (card qWCv9tUo, 2026-07-13): initial win is
    // reward + claim + claim-double, and the fail rescue has no Home.
    expect(report.droppedInstanceIds).toEqual(['settings.panel', 'win.home', 'fail.home']);
    expect(report.addedInstanceIds).toEqual(
      expect.arrayContaining([
        'menu.shop',
        'menu.nav',
        'shop.page',
        'shop.title',
        'shop.back',
        'shop.currency',
        'shop.currency.secondary',
        'shop.grid',
        'shop.item.available',
        'shop.item.owned',
        'shop.item.locked',
        'shop.restore',
        'settings.page',
        'settings.title',
        'win.reward',
        'win.claim',
        'win.claim-double',
        'fail.currency',
        'fail.continue-coins',
        'fail.bundle',
      ]),
    );
    expect(report.addedInstanceIds).not.toContain('settings.back');
  });

  it('migrates exactly once: v2 input fails closed', () => {
    const { document } = migrateShellPresentationV1ToV2(createDefaultShellPresentation());
    expect(() => migrateShellPresentationV1ToV2(document)).toThrowError(ShellContractValidationError);
  });

  it('produces a different canonical identity than its v1 source', async () => {
    const source = createDefaultShellPresentation();
    const { document } = migrateShellPresentationV1ToV2(source);
    expect(await hashCanonicalJson(document)).not.toBe(await hashCanonicalJson(source));
  });
});
