import {
  createDefaultShellPresentationV2,
  type ShellPresentationDocumentV2,
  type ShellPresentationInstance,
  type ShellProjectionRevisionV2,
} from "@fabrikav2/kernel";

import selectedRevision from "../../../design/revision.json";

interface Module<T> {
  readonly default: T;
}

type CopyProjection = Readonly<Record<string, string>>;
type AssetProjection = Readonly<Record<string, string>>;

const presentations = import.meta.glob<Module<ShellPresentationDocumentV2>>(
  "../../../design/revisions/*/presentation.ts",
  { eager: true },
);
const copies = import.meta.glob<Module<CopyProjection>>("../../../design/revisions/*/copy.ts", { eager: true });
const assets = import.meta.glob<Module<AssetProjection>>("../../../design/revisions/*/assets.ts", { eager: true });
const tokenSheets = import.meta.glob<string>("../../../design/revisions/*/tokens.css", {
  eager: true,
  import: "default",
  query: "?inline",
});

const baseline = createDefaultShellPresentationV2();

function moduleKey(revision: ShellProjectionRevisionV2, filename: string): string {
  return `../../../${revision.revisionPath}/${filename}`;
}

function requiredModule<T>(modules: Readonly<Record<string, Module<T>>>, key: string): T {
  const value = modules[key]?.default;
  if (!value) throw new Error(`Selected Grapes projection module is missing: ${key}`);
  return value;
}

function instanceMap(document: ShellPresentationDocumentV2): ReadonlyMap<string, ShellPresentationInstance> {
  return new Map(document.pages.flatMap((page) => page.instances.map((instance) => [instance.id, instance] as const)));
}

function applyCopy(element: HTMLElement, value: string): void {
  const target = element.matches("h1,h2,h3,p,span")
    ? element
    : element.querySelector<HTMLElement>(
        ".fab-modal-title, .fab-action-label, .template-shell__title, .template-shell__subtitle",
      );
  if (target) target.textContent = value;
}

function applyGeometry(
  element: HTMLElement,
  selected: ShellPresentationInstance,
  original: ShellPresentationInstance | undefined,
): void {
  if (!original) return;
  const selectedGeometry = selected.presentation.geometry;
  const originalGeometry = original.presentation.geometry;
  const deltaX = (selectedGeometry.offset.x - originalGeometry.offset.x) * 390;
  const deltaY = (selectedGeometry.offset.y - originalGeometry.offset.y) * 844;
  const scaleX = selectedGeometry.size.width / originalGeometry.size.width;
  const scaleY = selectedGeometry.size.height / originalGeometry.size.height;
  if (deltaX !== 0 || deltaY !== 0 || scaleX !== 1 || scaleY !== 1) {
    element.style.transformOrigin = "center";
    element.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;
  }
}

export interface GrapesProjection {
  readonly publicationId: string;
  readonly projectionId: string;
  apply(root: HTMLElement): void;
  dispose(): void;
}

export function loadSelectedGrapesProjection(): GrapesProjection {
  const revision = selectedRevision as ShellProjectionRevisionV2;
  if (
    revision.rendererProfile !== "dom-css" ||
    revision.revisionPath !== `design/revisions/${revision.projectionId}`
  ) {
    throw new Error("Selected Grapes projection pointer is incompatible.");
  }
  const presentation = requiredModule(presentations, moduleKey(revision, "presentation.ts"));
  const copy = requiredModule(copies, moduleKey(revision, "copy.ts"));
  const asset = requiredModule(assets, moduleKey(revision, "assets.ts"));
  const tokenKey = moduleKey(revision, "tokens.css");
  const tokenCss = tokenSheets[tokenKey];
  if (typeof tokenCss !== "string") throw new Error(`Selected Grapes token sheet is missing: ${tokenKey}`);

  const baselineInstances = instanceMap(baseline);
  const style = document.createElement("style");
  style.dataset.fabProjection = revision.projectionId;
  style.textContent = tokenCss;
  document.head.append(style);

  return {
    publicationId: revision.sourcePublicationId,
    projectionId: revision.projectionId,
    apply(root): void {
      const state = root.dataset.fabState;
      const page = presentation.pages.find((candidate) => candidate.stateId === state);
      if (!page) throw new Error(`Selected Grapes projection has no page for state "${state ?? "unknown"}".`);
      for (const selected of page.instances) {
        const instanceId = selected.id.replace(/["\\]/gu, (character) => `\\${character}`);
        const element = root.querySelector<HTMLElement>(`[data-fab-instance="${instanceId}"]`);
        if (!element) {
          if (selected.presentation.visibility === "hidden") continue;
          throw new Error(`Selected Grapes instance has no runtime mount: ${selected.id}`);
        }
        element.style.visibility = selected.presentation.visibility === "hidden" ? "hidden" : "";
        element.style.zIndex = String(selected.presentation.order);
        if (selected.presentation.colors?.background) {
          element.style.backgroundColor = selected.presentation.colors.background;
        }
        if (selected.presentation.colors?.foreground) {
          element.style.color = selected.presentation.colors.foreground;
        }
        if (copy[selected.id] !== undefined && !selected.bindingId.startsWith("state.")) {
          applyCopy(element, copy[selected.id]!);
        }
        const image = element.matches("img") ? element : element.querySelector<HTMLImageElement>("img");
        if (image instanceof HTMLImageElement && asset[selected.id]) image.src = asset[selected.id]!;
        applyGeometry(element, selected, baselineInstances.get(selected.id));
      }
      root.dataset.fabProjection = revision.projectionId;
      root.dataset.fabPublication = revision.sourcePublicationId;
    },
    dispose(): void {
      style.remove();
    },
  };
}
