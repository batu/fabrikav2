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
  semanticPlaceholderCss,
  semanticSwitchCss,
  semanticSwitchDisabledCss,
  semanticSwitchKnobCss,
  semanticSwitchKnobOnCss,
  semanticSwitchOnCss,
  semanticTitleCss,
  semanticToggleCss,
} from "../shared/visual.ts";
import { editorAssetUrl } from "./assets.ts";
import { editorAssetCatalog } from "./seed.ts";

const TOGGLE_ROLE = "center-toggle-action";

function humanRoleLabel(roleId: string): string {
  return roleId.split(/[.-]/u).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function toggleStateName(
  instance: ShellPresentationInstance,
  selectedId: string,
  selectedVariant: string,
): "on" | "off" | "disabled" {
  const active = instance.id === selectedId && selectedVariant && instance.variants[selectedVariant] ? selectedVariant : "";
  if (active === "off") return "off";
  if (active === "disabled") return "disabled";
  return "on";
}

const FRAME_CONTENT = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'"></head><body></body></html>`;
const FRAME_STYLE = `
  * { box-sizing: border-box; }
  html, body { width: 390px; height: 844px; margin: 0; overflow: hidden; background: #f8fafc; font-family: ui-rounded, system-ui, sans-serif; }
  [data-editor-page] { position: relative; isolation: isolate; width: 390px; height: 844px; overflow: hidden; background: #f8fafc; }
  [data-safe-guide] { position: absolute; z-index: 255; left: 0; right: 0; height: 1px; background: repeating-linear-gradient(90deg, #0f9bb8 0 5px, transparent 5px 10px); pointer-events: none; opacity: .72; }
  [data-safe-guide="top"] { top: 59px; } [data-safe-guide="bottom"] { bottom: 34px; }
  [data-semantic-instance] { position: absolute; ${semanticInstanceCss} }
  [data-semantic-instance][data-toggle="true"] { ${semanticToggleCss} }
  [data-semantic-instance][data-selected="true"] { outline: 3px solid #e0a23b; outline-offset: 3px; }
  [data-semantic-instance][data-hidden="true"] { visibility: hidden; }
  [data-semantic-asset] { ${semanticAssetCss} }
  [data-semantic-copy] { ${semanticCopyCss} }
  [data-semantic-title] { ${semanticTitleCss} }
  [data-semantic-placeholder] { ${semanticPlaceholderCss} }
  [data-semantic-switch] { ${semanticSwitchCss} }
  [data-semantic-switch]::after { ${semanticSwitchKnobCss} }
  [data-semantic-switch][data-toggle-state="on"] { ${semanticSwitchOnCss} }
  [data-semantic-switch][data-toggle-state="on"]::after { ${semanticSwitchKnobOnCss} }
  [data-semantic-switch][data-toggle-state="disabled"] { ${semanticSwitchDisabledCss} }
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
  containerIds: ReadonlySet<string>,
): Record<string, unknown> {
  const presentation = visiblePresentation(instance, selectedId, selectedVariant);
  const geometry = presentation.geometry ?? instance.presentation.geometry;
  const bounds = projectSemanticLayout(instance.roleId, geometry);
  const copy = presentation.copy ?? instance.presentation.copy;
  const assetId = presentation.assetId ?? instance.presentation.assetId;
  const asset = assetId ? editorAssetCatalog.assets.find((candidate) => candidate.id === assetId) : undefined;
  const assetUrl = asset ? editorAssetUrl(asset) : undefined;
  const isContainer = containerIds.has(instance.id);
  const isToggle = instance.roleId === TOGGLE_ROLE;

  const children: Record<string, unknown>[] = [];
  if (assetUrl) {
    children.push({
      tagName: "img",
      attributes: { "data-semantic-asset": assetId, src: assetUrl, alt: "", "aria-hidden": "true" },
      selectable: false,
    });
  }
  if (isContainer && copy) {
    children.push({ tagName: "span", attributes: { "data-semantic-title": "true" }, content: copy, selectable: false });
  }
  if (isToggle) {
    if (copy) {
      children.push({ tagName: "span", attributes: { "data-semantic-copy": "true" }, content: copy, selectable: false });
    }
    children.push({
      tagName: "span",
      attributes: {
        "data-semantic-switch": "true",
        "data-toggle-state": toggleStateName(instance, selectedId, selectedVariant),
        "aria-hidden": "true",
      },
      selectable: false,
    });
  } else if (copy && !isContainer) {
    children.push({ tagName: "span", attributes: { "data-semantic-copy": "true" }, content: copy, selectable: false });
  } else if (!copy && !assetUrl && !isContainer) {
    children.push({
      tagName: "span",
      attributes: { "data-semantic-placeholder": "true" },
      content: humanRoleLabel(instance.roleId),
      selectable: false,
    });
  }

  return {
    tagName: "section",
    attributes: {
      "data-semantic-instance": instance.id,
      "data-role": instance.roleId,
      "data-binding": instance.bindingId,
      "data-hidden": presentation.visibility === "hidden" ? "true" : "false",
      "data-selected": instance.id === selectedId ? "true" : "false",
      ...(isContainer ? { "data-container": "true" } : {}),
      ...(isToggle ? { "data-toggle": "true" } : {}),
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
    components: children,
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
      const containerIds = new Set(
        page.instances.map((instance) => instance.parentInstanceId).filter((id): id is string => id !== null),
      );
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
            ...page.instances.map((instance) => componentDefinition(instance, selectedId, selectedVariant, containerIds)),
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
