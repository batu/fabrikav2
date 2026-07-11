import grapesjs from "grapesjs";

import {
  type ShellPresentationDocument,
  type ShellPresentationInstance,
  type ShellVisualPresentation,
} from "@fabrikav2/kernel";

import { projectSemanticLayout } from "../shared/layout.ts";
import {
  semanticAssetCss,
  semanticCopyCss,
  semanticDefaultInk,
  semanticDefaultSurface,
  semanticInstanceCss,
} from "../shared/visual.ts";
import { editorAssetUrl } from "./assets.ts";
import { editorAssetCatalog } from "./seed.ts";

const FRAME_CONTENT = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'"></head><body></body></html>`;
const FRAME_STYLE = `
  * { box-sizing: border-box; }
  html, body { width: 390px; height: 844px; margin: 0; overflow: hidden; background: #f8fafc; font-family: ui-rounded, system-ui, sans-serif; }
  [data-editor-page] { position: relative; isolation: isolate; width: 390px; height: 844px; overflow: hidden; background: #f8fafc; }
  [data-safe-guide] { position: absolute; z-index: 255; left: 0; right: 0; height: 1px; background: repeating-linear-gradient(90deg, #0f9bb8 0 5px, transparent 5px 10px); pointer-events: none; opacity: .72; }
  [data-safe-guide="top"] { top: 59px; } [data-safe-guide="bottom"] { bottom: 34px; }
  [data-semantic-instance] { position: absolute; ${semanticInstanceCss} }
  [data-semantic-instance][data-selected="true"] { outline: 3px solid #e0a23b; outline-offset: 3px; }
  [data-semantic-instance][data-hidden="true"] { visibility: hidden; }
  [data-semantic-asset] { ${semanticAssetCss} }
  [data-semantic-copy] { ${semanticCopyCss} }
  [data-asset-chip] { position: absolute; right: 7px; bottom: 6px; max-width: calc(100% - 14px); overflow: hidden; color: #0b1725; font: 700 8px/1 ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; opacity: .62; }
`;

interface CanvasOptions {
  readonly container: HTMLElement;
  readonly onSelect: (instanceId: string) => void;
}

function visiblePresentation(
  instance: ShellPresentationInstance,
  selectedId: string,
  selectedVariant: string,
): ShellVisualPresentation {
  if (instance.id !== selectedId || !selectedVariant) return instance.presentation;
  const variant = instance.variants[selectedVariant];
  if (!variant) return instance.presentation;
  return {
    ...instance.presentation,
    ...variant,
    ...(instance.presentation.colors || variant.colors
      ? { colors: { ...instance.presentation.colors, ...variant.colors } }
      : {}),
  };
}

function componentDefinition(
  instance: ShellPresentationInstance,
  selectedId: string,
  selectedVariant: string,
): Record<string, unknown> {
  const presentation = visiblePresentation(instance, selectedId, selectedVariant);
  const geometry = presentation.geometry ?? instance.presentation.geometry;
  const bounds = projectSemanticLayout(instance.roleId, geometry);
  const copy = presentation.copy ?? instance.presentation.copy ?? instance.id;
  const assetId = presentation.assetId ?? instance.presentation.assetId;
  const asset = assetId ? editorAssetCatalog.assets.find((candidate) => candidate.id === assetId) : undefined;
  const assetUrl = asset ? editorAssetUrl(asset) : undefined;
  return {
    tagName: "section",
    attributes: {
      "data-semantic-instance": instance.id,
      "data-role": instance.roleId,
      "data-binding": instance.bindingId,
      "data-hidden": presentation.visibility === "hidden" ? "true" : "false",
      "data-selected": instance.id === selectedId ? "true" : "false",
      "aria-label": `${instance.roleId}: ${instance.accessibility.nameKey}`,
    },
    style: {
      left: `${bounds.x}px`,
      top: `${bounds.y}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      "z-index": String(presentation.order ?? instance.presentation.order),
      "--scale": String(presentation.scale ?? instance.presentation.scale ?? 1),
      "--opacity": String(presentation.opacity ?? instance.presentation.opacity ?? 1),
      "--fit": geometry.fit,
      "--surface": presentation.colors?.background ?? instance.presentation.colors?.background ?? semanticDefaultSurface,
      "--ink": presentation.colors?.foreground ?? instance.presentation.colors?.foreground ?? semanticDefaultInk,
    },
    draggable: false,
    resizable: false,
    removable: false,
    copyable: false,
    stylable: false,
    traits: [],
    components: [
      ...(assetUrl
        ? [{
            tagName: "img",
            attributes: {
              "data-semantic-asset": assetId,
              src: assetUrl,
              alt: "",
              "aria-hidden": "true",
            },
            selectable: false,
          }]
        : []),
      {
        tagName: "span",
        attributes: { "data-semantic-copy": "true" },
        content: copy,
        selectable: false,
      },
      {
        tagName: "span",
        attributes: { "data-asset-chip": "true" },
        content: assetId ?? "no-raster",
        selectable: false,
      },
    ],
  };
}

export interface ConstrainedGrapesCanvas {
  render(document: ShellPresentationDocument, stateId: string, selectedId: string, selectedVariant: string): void;
  destroy(): void;
}

export function createConstrainedGrapesCanvas(options: CanvasOptions): ConstrainedGrapesCanvas {
  const editor = grapesjs.init({
    container: options.container,
    fromElement: false,
    storageManager: false,
    height: "844px",
    width: "390px",
    panels: { defaults: [] },
    blockManager: { blocks: [] },
    styleManager: { sectors: [] },
    traitManager: {},
    layerManager: {},
    assetManager: { assets: [] },
    deviceManager: { devices: [] },
    selectorManager: { componentFirst: true },
    canvas: { frameContent: FRAME_CONTENT, frameStyle: FRAME_STYLE, scripts: [], styles: [] },
    cssIcons: "",
    nativeDnD: false,
    dragMode: "absolute",
    showToolbar: false,
    telemetry: false,
  });

  editor.on("load", () => {
    const frame = editor.Canvas.getFrameEl();
    frame.setAttribute("sandbox", "allow-same-origin");
  });
  editor.on("component:selected", (component: { getAttributes(): Record<string, string> }) => {
    const instanceId = component.getAttributes()["data-semantic-instance"];
    if (instanceId) options.onSelect(instanceId);
  });

  return {
    render(document, stateId, selectedId, selectedVariant) {
      const page = document.pages.find((candidate) => candidate.stateId === stateId);
      if (!page) return;
      const definitions: Record<string, unknown>[] = [
        {
          tagName: "main",
          attributes: { "data-editor-page": stateId, "aria-label": `${stateId} editor artboard` },
          selectable: false,
          draggable: false,
          droppable: false,
          components: [
            { tagName: "i", attributes: { "data-safe-guide": "top", "aria-hidden": "true" }, selectable: false },
            { tagName: "i", attributes: { "data-safe-guide": "bottom", "aria-hidden": "true" }, selectable: false },
            ...page.instances.map((instance) => componentDefinition(instance, selectedId, selectedVariant)),
          ],
        },
      ];
      editor.setComponents(definitions);
    },
    destroy() {
      editor.destroy();
    },
  };
}
