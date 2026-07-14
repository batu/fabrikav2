import Phaser from "phaser";

import type {
  TemplateShellController,
  TemplateShellSnapshot,
} from "../../core/TemplateShellController.ts";
import type { TemplateSettingKey } from "../../sdk/TemplateSdk.ts";

type Surface = "menu" | "level" | "shop" | "settings" | "pause" | "win" | "fail";

interface SemanticCarrier {
  readonly fabSemanticId: string;
  readonly fabBinding: string;
  readonly fabSlot?: string;
}

type ProjectedObject = Phaser.GameObjects.GameObject & {
  readonly __Semantic?: SemanticCarrier;
  getBounds?: () => Phaser.Geom.Rectangle;
  visible?: boolean;
  alpha?: number;
};

interface ProjectionModule {
  readonly states: readonly Surface[];
  readonly scenes: Readonly<Record<Surface, new () => Phaser.Scene>>;
}

interface AssetPackFile {
  url: string;
  readonly [key: string]: unknown;
}

type AssetPack = Record<string, unknown> & {
  "shell-runtime": { readonly files: AssetPackFile[] };
};

interface SelectedRevision {
  readonly artifacts: readonly {
    readonly bytes: number;
    readonly path: string;
    readonly sha256: string;
  }[];
  readonly sourcePublicationId: string;
  readonly projectionId: string;
  readonly revisionPath: string;
}

export interface PhaserProjectionIdentity {
  readonly publicationId: string;
  readonly projectionId: string;
}

export interface PhaserProjectionAction {
  readonly actionId: string;
  readonly instanceId: string;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly visible: boolean;
  readonly disabled: boolean;
}

export interface PhaserProjectionHandle {
  readonly game: Phaser.Game;
  readonly identity: PhaserProjectionIdentity;
  render(): void;
  ready(): boolean;
  actions(): readonly PhaserProjectionAction[];
  dispose(): void;
}

const selectionSources = import.meta.glob("../../../design/revision.*", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Readonly<Record<string, string>>;
const selectedRevisionSource = Object.values(selectionSources)[0];
const parsedSelectedRevision = selectedRevisionSource ? JSON.parse(selectedRevisionSource) as SelectedRevision : undefined;
if (!parsedSelectedRevision || Object.keys(selectionSources).length !== 1) {
  throw new Error("The Phaser runtime requires exactly one selected revision pointer.");
}
const selectedRevision = parsedSelectedRevision;
const revisionPrefix = `../../../${selectedRevision.revisionPath}/`;
const shellSources = import.meta.glob("../../../design/revisions/*/scenes/shell.js", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Readonly<Record<string, string>>;
const revisionRootSources = import.meta.glob("../../../design/revisions/*/*.*", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Readonly<Record<string, string>>;
const revisionAssetUrls = import.meta.glob("../../../design/revisions/*/assets/*", {
  eager: true,
  import: "default",
  query: "?url",
}) as Readonly<Record<string, string>>;

export const selectedProjectionIdentity: PhaserProjectionIdentity = Object.freeze({
  publicationId: selectedRevision.sourcePublicationId,
  projectionId: selectedRevision.projectionId,
});

function selectedArtifact<T>(artifacts: Readonly<Record<string, T>>, relativePath: string): T {
  const key = `${revisionPrefix}${relativePath}`;
  const artifact = artifacts[key];
  if (artifact === undefined) throw new Error(`Selected Phaser projection is missing ${relativePath}.`);
  return artifact;
}

async function artifactBytes(path: string): Promise<Uint8Array> {
  if (path.startsWith("assets/")) {
    const response = await fetch(selectedArtifact(revisionAssetUrls, path));
    if (!response.ok) throw new Error(`Selected Phaser projection could not read ${path}.`);
    return new Uint8Array(await response.arrayBuffer());
  }
  const source = path === "scenes/shell.js"
    ? selectedArtifact(shellSources, path)
    : selectedArtifact(revisionRootSources, path);
  return new TextEncoder().encode(source);
}

async function verifySelectedRevision(): Promise<void> {
  const expectedRevisionPath = `design/revisions/${selectedRevision.projectionId}`;
  if (selectedRevision.revisionPath !== expectedRevisionPath) {
    throw new Error("Selected Phaser projection path does not match its projection id.");
  }
  const availablePaths = new Set(
    [...Object.keys(revisionRootSources), ...Object.keys(shellSources), ...Object.keys(revisionAssetUrls)]
      .filter((path) => path.startsWith(revisionPrefix))
      .map((path) => path.slice(revisionPrefix.length)),
  );
  if (selectedRevision.artifacts.length !== availablePaths.size) {
    throw new Error("Selected Phaser projection manifest does not cover every bundled artifact.");
  }
  const paths = new Set<string>();
  for (const artifact of selectedRevision.artifacts) {
    if (!availablePaths.has(artifact.path) || paths.has(artifact.path) || artifact.path.startsWith("/") || artifact.path.includes("..")) {
      throw new Error(`Selected Phaser projection has an invalid artifact path: ${artifact.path}.`);
    }
    paths.add(artifact.path);
    const bytes = await artifactBytes(artifact.path);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
    const sha256 = `sha256-${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (bytes.byteLength !== artifact.bytes || sha256 !== artifact.sha256) {
      throw new Error(`Selected Phaser projection failed integrity verification for ${artifact.path}.`);
    }
  }
}

async function prepareProjectionModule(): Promise<{ readonly source: string; readonly assetPackUrl: string }> {
  await verifySelectedRevision();
  const packPath = ["asset-pack", "json"].join(".");
  const pack = JSON.parse(selectedArtifact(revisionRootSources, packPath)) as AssetPack;
  for (const file of pack["shell-runtime"].files) {
    file.url = selectedArtifact(revisionAssetUrls, file.url);
  }
  const assetPackUrl = URL.createObjectURL(new Blob([JSON.stringify(pack)], { type: "application/json" }));
  const source = selectedArtifact(shellSources, "scenes/shell.js")
    .replaceAll('"asset-pack.json"', JSON.stringify(assetPackUrl));
  return { source, assetPackUrl };
}

const SCENE_KEY: Readonly<Record<Surface, string>> = {
  menu: "Menu",
  level: "Level",
  shop: "Shop",
  settings: "Settings",
  pause: "Pause",
  win: "Win",
  fail: "Fail",
};

function settingForBinding(binding: string): TemplateSettingKey | undefined {
  if (binding === "settings.music") return "music";
  if (binding === "settings.sfx") return "sfx";
  if (binding === "settings.haptics") return "haptics";
  return undefined;
}

async function invokeBinding(controller: TemplateShellController, binding: string): Promise<void> {
  const setting = settingForBinding(binding);
  if (setting) {
    controller.setSetting(setting, !controller.snapshot().settings[setting]);
    return;
  }
  switch (binding) {
    case "flow.start-current": controller.startCurrent(); break;
    case "flow.open-shop": controller.openShop(); break;
    case "flow.open-settings": controller.openSettings(); break;
    case "flow.shop-back": controller.backFromShop(); break;
    case "flow.settings-back": controller.backFromSettings(); break;
    case "flow.pause": controller.pause(); break;
    case "flow.resume": controller.resume(); break;
    case "flow.pause-home":
    case "flow.result-home": controller.home(); break;
    case "flow.test-win": controller.win(); break;
    case "flow.test-lose": controller.lose(); break;
    case "flow.claim": controller.claim(); break;
    case "flow.claim-double": await controller.claimDouble(); break;
    case "flow.next": controller.next(); break;
    case "flow.retry": controller.retry(); break;
    case "flow.continue-coins": controller.continueCoins(); break;
    case "commerce.bundle": await controller.purchaseBundle(); break;
    default: break;
  }
}

function activeScene(game: Phaser.Game): Phaser.Scene | undefined {
  return game.scene.getScenes(true)[0];
}

function actionId(binding: string): string {
  return binding.startsWith("flow.") ? binding.slice(5) : binding;
}

function authoredActionBounds(scene: Phaser.Scene, object: ProjectedObject): Phaser.Geom.Rectangle | undefined {
  const semanticBounds = object.getBounds?.();
  if (!semanticBounds) return undefined;
  const centerX = semanticBounds.centerX;
  const centerY = semanticBounds.centerY;
  const visibleBounds = (scene.children.list as ProjectedObject[]).flatMap((candidate) => {
    if (candidate === object || candidate.__Semantic || candidate.visible === false || (candidate.alpha ?? 1) <= 0) return [];
    const bounds = candidate.getBounds?.();
    return bounds ? [bounds] : [];
  });
  if (object.__Semantic?.fabSlot === "toggle-control") {
    const track = visibleBounds
      .filter((bounds) => bounds.width >= 40 && bounds.width <= 100 && bounds.height >= 20 && bounds.height <= 60)
      .filter((bounds) => Math.abs(bounds.centerY - centerY) <= 24)
      .sort((left, right) => Math.abs(left.centerX - centerX) - Math.abs(right.centerX - centerX))[0];
    if (track) {
      const left = Math.min(semanticBounds.left, track.left);
      const top = Math.min(semanticBounds.top, track.top);
      const right = Math.max(semanticBounds.right, track.right);
      const bottom = Math.max(semanticBounds.bottom, track.bottom);
      const width = Math.max(48, right - left);
      const height = Math.max(48, bottom - top);
      return new Phaser.Geom.Rectangle((left + right - width) / 2, (top + bottom - height) / 2, width, height);
    }
  }
  const containing = visibleBounds.filter((bounds) =>
    bounds.contains(centerX, centerY)
    && bounds.width >= semanticBounds.width
    && bounds.height >= semanticBounds.height
    && bounds.width <= 340
    && bounds.height <= 120,
  );
  const authored = containing.reduce<Phaser.Geom.Rectangle | undefined>((closest, bounds) => {
    if (!closest) return bounds;
    const distance = (bounds.centerX - centerX) ** 2 + (bounds.centerY - centerY) ** 2;
    const closestDistance = (closest.centerX - centerX) ** 2 + (closest.centerY - centerY) ** 2;
    return distance <= closestDistance ? bounds : closest;
  }, undefined) ?? semanticBounds;
  const width = Math.max(48, authored.width);
  const height = Math.max(48, authored.height);
  return new Phaser.Geom.Rectangle(authored.centerX - width / 2, authored.centerY - height / 2, width, height);
}

function colorCss(value: number): string {
  return Phaser.Display.Color.IntegerToColor(value).rgba;
}

function actionState(binding: string, snapshot: TemplateShellSnapshot): {
  readonly visible: boolean;
  readonly disabled: boolean;
} {
  switch (binding) {
    case "flow.claim":
      return { visible: !snapshot.rewardClaimed, disabled: snapshot.rewardClaimed };
    case "flow.claim-double":
      return {
        visible: !snapshot.rewardClaimed,
        disabled: snapshot.rewardClaimed || !snapshot.adAvailable,
      };
    case "flow.next":
    case "flow.result-home":
      return { visible: snapshot.rewardClaimed, disabled: !snapshot.rewardClaimed };
    case "flow.continue-coins":
      return { visible: true, disabled: !snapshot.continueAffordable };
    case "commerce.bundle":
      return { visible: true, disabled: !snapshot.bundleAvailable };
    default:
      return { visible: true, disabled: false };
  }
}

export async function mountPhaserProjection(options: {
  readonly mountInto: HTMLElement;
  readonly controller: TemplateShellController;
  readonly identity: PhaserProjectionIdentity;
}): Promise<PhaserProjectionHandle> {
  (globalThis as typeof globalThis & { Phaser?: typeof Phaser }).Phaser = Phaser;
  const prepared = await prepareProjectionModule();
  const moduleUrl = URL.createObjectURL(new Blob([prepared.source], { type: "text/javascript" }));
  let projection: ProjectionModule;
  try {
    projection = await import(/* @vite-ignore */ moduleUrl) as unknown as ProjectionModule;
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  const missing = (Object.keys(SCENE_KEY) as Surface[]).filter((state) => !projection.scenes[state]);
  if (missing.length > 0) {
    URL.revokeObjectURL(prepared.assetPackUrl);
    throw new Error(`Selected Phaser projection is missing states: ${missing.join(", ")}`);
  }

  options.mountInto.replaceChildren();
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: options.mountInto,
    width: 390,
    height: 844,
    backgroundColor: 0xf7f5ef,
    scene: projection.states.map((state) => projection.scenes[state]),
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 390,
      height: 844,
    },
  });

  let paintedSurface: Surface | undefined;
  let postRenderSeen = false;
  const sentinelText = `PHASER · ${options.identity.projectionId.slice(7, 15)}`;

  const wireScene = (scene: Phaser.Scene): void => {
    const objects = scene.children.list as ProjectedObject[];
    if (!objects.some((object) => object.name === "fabrikav2-revision-sentinel")) {
      const sentinel = scene.add.text(195, 18, sentinelText, {
        color: colorCss(0x173042),
        fontFamily: "monospace",
        fontSize: "12px",
        backgroundColor: colorCss(0xfff7c2),
        padding: { x: 7, y: 4 },
      }).setOrigin(0.5, 0).setDepth(10_000).setName("fabrikav2-revision-sentinel");
      sentinel.setAlpha(0.96);
    }
    const snapshot = options.controller.snapshot();
    for (const object of objects) {
      const semantic = object.__Semantic;
      if (!semantic || (!semantic.fabBinding.startsWith("flow.") && !semantic.fabBinding.startsWith("settings.") && semantic.fabBinding !== "commerce.bundle")) continue;
      object.visible = actionState(semantic.fabBinding, snapshot).visible;
    }
  };

  game.events.on(Phaser.Core.Events.POST_RENDER, () => {
    const scene = activeScene(game);
    if (!scene) return;
    wireScene(scene);
    const expected = SCENE_KEY[options.controller.snapshot().surface];
    if (scene.scene.key === expected) {
      paintedSurface = options.controller.snapshot().surface;
      postRenderSeen = true;
    }
  });

  const onCanvasPointerUp = (event: PointerEvent): void => {
    const scene = activeScene(game);
    if (!scene) return;
    const canvasRect = game.canvas.getBoundingClientRect();
    const worldX = (event.clientX - canvasRect.left) * (390 / canvasRect.width);
    const worldY = (event.clientY - canvasRect.top) * (844 / canvasRect.height);
    for (const object of [...scene.children.list].reverse() as ProjectedObject[]) {
      const semantic = object.__Semantic;
      const bounds = authoredActionBounds(scene, object);
      if (!semantic || !bounds || !bounds.contains(worldX, worldY)) continue;
      if (!semantic.fabBinding.startsWith("flow.") && !semantic.fabBinding.startsWith("settings.") && semantic.fabBinding !== "commerce.bundle") continue;
      const state = actionState(semantic.fabBinding, options.controller.snapshot());
      if (!state.visible || state.disabled) continue;
      void invokeBinding(options.controller, semantic.fabBinding).then(() => handle.render());
      return;
    }
  };

  const handle: PhaserProjectionHandle = {
    game,
    identity: options.identity,
    render(): void {
      const surface = options.controller.snapshot().surface;
      const key = SCENE_KEY[surface];
      postRenderSeen = false;
      if (!game.scene.isActive(key)) {
        for (const scene of game.scene.getScenes(true)) game.scene.stop(scene.scene.key);
        game.scene.start(key);
      }
      else {
        const scene = activeScene(game);
        if (scene) wireScene(scene);
      }
    },
    ready(): boolean {
      return postRenderSeen && paintedSurface === options.controller.snapshot().surface;
    },
    actions(): readonly PhaserProjectionAction[] {
      const scene = activeScene(game);
      const canvas = game.canvas;
      if (!scene || !canvas) return [];
      const canvasRect = canvas.getBoundingClientRect();
      const scaleX = canvasRect.width / 390;
      const scaleY = canvasRect.height / 844;
      return (scene.children.list as ProjectedObject[]).flatMap((object) => {
        const semantic = object.__Semantic;
        const bounds = authoredActionBounds(scene, object);
        if (!semantic || !bounds || (!semantic.fabBinding.startsWith("flow.") && !semantic.fabBinding.startsWith("settings.") && semantic.fabBinding !== "commerce.bundle")) return [];
        const state = actionState(semantic.fabBinding, options.controller.snapshot());
        return [{
          actionId: actionId(semantic.fabBinding),
          instanceId: semantic.fabSemanticId,
          rect: {
            x: canvasRect.left + bounds.x * scaleX,
            y: canvasRect.top + bounds.y * scaleY,
            width: bounds.width * scaleX,
            height: bounds.height * scaleY,
          },
          visible: state.visible && object.visible !== false && (object.alpha ?? 1) > 0,
          disabled: state.disabled,
        }];
      });
    },
    dispose(): void {
      game.canvas.removeEventListener("pointerup", onCanvasPointerUp);
      game.destroy(true);
      URL.revokeObjectURL(prepared.assetPackUrl);
      options.mountInto.replaceChildren();
    },
  };
  game.canvas.addEventListener("pointerup", onCanvasPointerUp);

  await new Promise<void>((resolve) => {
    if (game.isBooted) resolve();
    else game.events.once(Phaser.Core.Events.READY, () => resolve());
  });
  handle.render();
  console.info("[fabrikav2:projection-ready]", JSON.stringify({
    gameId: "shell_proof_phaser",
    publicationId: options.identity.publicationId,
    projectionId: options.identity.projectionId,
  }));
  return handle;
}
