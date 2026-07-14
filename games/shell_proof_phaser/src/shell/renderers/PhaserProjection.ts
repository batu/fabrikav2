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
  // Vite deliberately refuses to import JavaScript from publicDir in dev.
  // Fetching the immutable bytes ourselves keeps dev and Capacitor on the same
  // publication path without asking Vite to transform the projection.
  const response = await fetch("/scenes/shell.js", { cache: "no-store" });
  if (!response.ok) throw new Error(`Selected Phaser projection could not be loaded (${response.status}).`);
  const moduleUrl = URL.createObjectURL(new Blob([await response.text()], { type: "text/javascript" }));
  let projection: ProjectionModule;
  try {
    projection = await import(/* @vite-ignore */ moduleUrl) as unknown as ProjectionModule;
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  const missing = (Object.keys(SCENE_KEY) as Surface[]).filter((state) => !projection.scenes[state]);
  if (missing.length > 0) throw new Error(`Selected Phaser projection is missing states: ${missing.join(", ")}`);

  options.mountInto.replaceChildren();
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: options.mountInto,
    width: 390,
    height: 844,
    backgroundColor: "#f7f5ef",
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
  const wiredScenes = new WeakSet<Phaser.Scene>();
  const sentinelText = `PHASER · ${options.identity.projectionId.slice(7, 15)}`;

  const wireScene = (scene: Phaser.Scene): void => {
    const objects = scene.children.list as ProjectedObject[];
    if (!objects.some((object) => object.name === "fabrikav2-revision-sentinel")) {
      const sentinel = scene.add.text(195, 18, sentinelText, {
        color: "#173042",
        fontFamily: "monospace",
        fontSize: "12px",
        backgroundColor: "#fff7c2",
        padding: { x: 7, y: 4 },
      }).setOrigin(0.5, 0).setDepth(10_000).setName("fabrikav2-revision-sentinel");
      sentinel.setAlpha(0.96);
    }
    const snapshot = options.controller.snapshot();
    if (!wiredScenes.has(scene)) {
      scene.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
        for (const object of scene.children.list as ProjectedObject[]) {
          const semantic = object.__Semantic;
          const bounds = object.getBounds?.();
          if (!semantic || !bounds || !bounds.contains(pointer.worldX, pointer.worldY)) continue;
          if (!semantic.fabBinding.startsWith("flow.") && !semantic.fabBinding.startsWith("settings.") && semantic.fabBinding !== "commerce.bundle") continue;
          const state = actionState(semantic.fabBinding, options.controller.snapshot());
          if (!state.visible || state.disabled) return;
          void invokeBinding(options.controller, semantic.fabBinding).then(() => handle.render());
          return;
        }
      });
      wiredScenes.add(scene);
    }
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
        const bounds = object.getBounds?.();
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
      game.destroy(true);
      options.mountInto.replaceChildren();
    },
  };

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
