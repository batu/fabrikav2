/**
 * Renderer-neutral shell evidence probe (dual-design-frontends U1 seam).
 *
 * Both proof shells expose the same four facts — current shell state, visible
 * semantic action rectangles, selected presentation revision, and a
 * post-paint readiness signal — regardless of whether the renderer is DOM/CSS
 * or Phaser-native. The probe is a tool: it answers one snapshot query and
 * returns; it never loops, polls, or drives the shell.
 *
 * The producer owns this wire contract. The host-side consumer parser lives
 * in `tools/verify-device/src/evidenceProbe.mjs` and must accept a snapshot
 * produced here with zero adaptation (round-trip tested there).
 */

export const SHELL_EVIDENCE_PROBE_VERSION = 1;

export interface ShellEvidenceActionRect {
  /** Semantic action hook (the `data-fab-action` value / contract actionHook). */
  actionId: string;
  /** Semantic instance identity when the renderer knows it, else null. */
  instanceId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  disabled: boolean;
}

export interface ShellEvidenceViewport {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface ShellEvidenceProbeSnapshot {
  probeVersion: typeof SHELL_EVIDENCE_PROBE_VERSION;
  gameId: string;
  contractId: string;
  rendererProfile: string;
  /** Current shell state id (e.g. menu, level, shop, ...). */
  state: string;
  /** Selected projection revision id, or null while running the seed design. */
  revision: string | null;
  /** Short visual sentinel token derived from the revision, or null. */
  sentinel: string | null;
  /** True only after the renderer reports the current state fully painted. */
  ready: boolean;
  viewport: ShellEvidenceViewport;
  /** Sorted by actionId, then instanceId. */
  actions: ShellEvidenceActionRect[];
}

export interface ShellEvidenceProbeReaders {
  state(): string;
  revision(): string | null;
  ready(): boolean;
  actions(): ShellEvidenceActionRect[];
  viewport(): ShellEvidenceViewport;
}

export interface ShellEvidenceProbeOptions {
  gameId: string;
  contractId: string;
  rendererProfile: string;
  readers: ShellEvidenceProbeReaders;
}

export interface ShellEvidenceProbe {
  snapshot(): ShellEvidenceProbeSnapshot;
}

/** Window key the host reads the probe from (mirrored in verify-device). */
export function evidenceProbeWindowKeyForGame(gameId: string): string {
  return `__${gameId.toUpperCase()}_EVIDENCE_PROBE__`;
}

/**
 * The revision-derived token a shell renders on screen so a host screenshot
 * can verify the selected revision independently of the runtime's own claim.
 */
export function shellEvidenceSentinelForRevision(revision: string | null): string | null {
  if (revision === null) return null;
  const match = /^sha256-([a-f0-9]{64})$/.exec(revision);
  return match ? match[1].slice(0, 8) : null;
}

function sortedActions(actions: ShellEvidenceActionRect[]): ShellEvidenceActionRect[] {
  return [...actions].sort((left, right) => {
    if (left.actionId !== right.actionId) return left.actionId < right.actionId ? -1 : 1;
    const leftInstance = left.instanceId ?? '';
    const rightInstance = right.instanceId ?? '';
    if (leftInstance === rightInstance) return 0;
    return leftInstance < rightInstance ? -1 : 1;
  });
}

/**
 * Renderer-neutral core: assembles one canonical snapshot from injected
 * readers. The DOM lane feeds it {@link readDomShellEvidenceActions}; the
 * Phaser lane derives the same facts from live display objects.
 */
export function createShellEvidenceProbe(options: ShellEvidenceProbeOptions): ShellEvidenceProbe {
  return {
    snapshot(): ShellEvidenceProbeSnapshot {
      const revision = options.readers.revision();
      return {
        probeVersion: SHELL_EVIDENCE_PROBE_VERSION,
        gameId: options.gameId,
        contractId: options.contractId,
        rendererProfile: options.rendererProfile,
        state: options.readers.state(),
        revision,
        sentinel: shellEvidenceSentinelForRevision(revision),
        ready: options.readers.ready(),
        viewport: options.readers.viewport(),
        actions: sortedActions(options.readers.actions()),
      };
    },
  };
}

interface DomActionElementLike {
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
}

interface DomRootLike {
  querySelectorAll(selector: string): ArrayLike<DomActionElementLike> & Iterable<DomActionElementLike>;
}

/**
 * DOM adapter: derives action rectangles from the stable `data-fab-*` hooks.
 * Rectangle values are only meaningful in a real layout engine (browser or
 * WebView); under happy-dom they degrade to zero-sized rects, so unit tests
 * assert identity and flags while device lanes assert geometry.
 */
export function readDomShellEvidenceActions(root: DomRootLike): ShellEvidenceActionRect[] {
  const actions: ShellEvidenceActionRect[] = [];
  for (const element of root.querySelectorAll('[data-fab-action]')) {
    const actionId = element.getAttribute('data-fab-action');
    if (!actionId) continue;
    const rect = element.getBoundingClientRect();
    const hiddenAncestor = element.closest('[hidden], [aria-hidden="true"]') !== null;
    const disabled =
      element.getAttribute('disabled') !== null ||
      element.getAttribute('aria-disabled') === 'true';
    actions.push({
      actionId,
      instanceId: element.getAttribute('data-fab-instance'),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      visible: rect.width > 0 && rect.height > 0 && !hiddenAncestor,
      disabled,
    });
  }
  return sortedActions(actions);
}

interface DomViewportLike {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
}

export function readDomShellEvidenceViewport(view: DomViewportLike): ShellEvidenceViewport {
  return {
    width: view.innerWidth,
    height: view.innerHeight,
    devicePixelRatio: view.devicePixelRatio,
  };
}
