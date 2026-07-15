import grapesjs, { type Asset, type Component, type Editor, type ProjectData } from "grapesjs";

import "grapesjs/dist/css/grapes.min.css";
import "./editor.css";

import { applyExactAssetReplacement } from "./asset-replacement.ts";
import { REQUIRED_PAGES, type AssetManifest } from "./contract.ts";

interface PublicationResult {
  readonly revision: string;
  readonly previewUrl: string;
}

interface WorkingState {
  readonly project: ProjectData;
  readonly revision: string;
}

interface AuthoringSession {
  readonly capability: string;
}

declare global {
  interface Window {
    __FABRIKAV2_MARBLE_GRAPES__?: {
      getProjectData(): ProjectData;
      select(instanceId: string): boolean;
      selectPage(pageId: string): boolean;
      save(): Promise<void>;
      publish(): Promise<PublicationResult>;
    };
  }
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const value = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error((value as { error?: string }).error ?? `Request failed (${response.status}).`);
  return value as T;
}

function assetSources(manifest: AssetManifest) {
  return manifest.assets.filter((asset) => asset.tray).map((asset) => ({
    src: `/marble-assets/${asset.file}`,
    name: `${asset.role} · ${asset.description}`,
    type: "image",
    category: "Marble Run · exact source assets",
    custom: { role: asset.role, sha256: asset.sha256, dimensions: [asset.width, asset.height], status: asset.status },
  }));
}

function semanticComponents(editor: Editor): Component[] {
  const all: Component[] = [];
  for (const page of editor.Pages.getAll()) {
    const root = page.getMainComponent();
    all.push(...root.find("[data-fab-id]"));
  }
  return all;
}

function nextId(editor: Editor, source: string): string {
  const ids = new Set(semanticComponents(editor).map((component) => component.getAttributes()["data-fab-id"]));
  let index = 1;
  while (ids.has(`${source}.copy-${index}`)) index += 1;
  return `${source}.copy-${index}`;
}

function labelComponents(editor: Editor): void {
  for (const component of semanticComponents(editor)) {
    const attributes = component.getAttributes();
    component.set("name", attributes["data-fab-label"] ?? attributes["data-fab-id"] ?? "Marble layer");
  }
}

function setEditorReadonly(editor: Editor): void {
  for (const component of semanticComponents(editor)) {
    component.set({ selectable: false, hoverable: false, draggable: false, resizable: false, editable: false });
  }
}

function createEditor(container: HTMLElement, readonly: boolean, canvasStyles = ["/marble-design/tokens.css"]): Editor {
  return grapesjs.init({
    container,
    height: "100%",
    width: "100%",
    fromElement: false,
    storageManager: false,
    telemetry: false,
    dragMode: "absolute",
    nativeDnD: false,
    selectorManager: { componentFirst: true },
    canvas: { styles: canvasStyles },
    deviceManager: { devices: [{ id: "marble-390", name: "Marble 390 × 844", width: "390px", height: "844px" }] },
    panels: readonly ? { defaults: [] } : undefined,
    blockManager: { blocks: [] },
    assetManager: { upload: false, assets: [] },
    styleManager: readonly ? { sectors: [] } : {
      sectors: [
        { name: "Position & size", open: true, buildProps: ["position", "left", "top", "width", "height", "z-index"] },
        { name: "Typography", open: true, buildProps: ["font-family", "font-size", "font-weight", "line-height", "color", "text-align"] },
        { name: "Surface", open: true, buildProps: ["background-color", "border", "border-radius", "box-shadow", "opacity"] },
      ],
    },
  });
}

async function mountPreview(root: HTMLElement): Promise<void> {
  const parameters = new URLSearchParams(location.search);
  const revision = parameters.get("revision");
  const requestedPage = parameters.get("page") ?? "menu";
  if (!revision) throw new Error("Preview requires a content-addressed revision.");
  const shell = node("main", "preview-shell");
  const toolbar = node("header", "preview-toolbar");
  const stamp = node("strong");
  stamp.textContent = `Saved revision ${revision}`;
  const pageSelect = node("select");
  for (const pageId of REQUIRED_PAGES) {
    const option = node("option");
    option.value = pageId;
    option.textContent = pageId;
    option.selected = pageId === requestedPage;
    pageSelect.append(option);
  }
  toolbar.append(stamp, pageSelect);
  const canvas = node("div", "preview-canvas");
  shell.append(toolbar, canvas);
  root.replaceChildren(shell);
  const editor = createEditor(canvas, true, [`/api/publications/${revision}/tokens.css`]);
  editor.loadProjectData(await request<ProjectData>(`/api/publications/${revision}/preview-project`));
  editor.Devices.select("marble-390");
  labelComponents(editor);
  setEditorReadonly(editor);
  const selectPage = (pageId: string) => {
    const page = editor.Pages.get(pageId);
    if (page) editor.Pages.select(page);
  };
  selectPage(requestedPage);
  pageSelect.addEventListener("change", () => {
    selectPage(pageSelect.value);
    history.replaceState(null, "", `/preview?revision=${revision}&page=${pageSelect.value}`);
  });
}

async function mountEditor(root: HTMLElement): Promise<void> {
  const [initialState, manifest, session] = await Promise.all([
    request<WorkingState>("/api/project"),
    request<AssetManifest>("/api/assets"),
    request<AuthoringSession>("/api/session"),
  ]);
  const shell = node("main", "authoring-shell");
  const toolbar = node("header", "authoring-toolbar");
  const identity = node("div", "authoring-identity");
  identity.innerHTML = "<strong>Marble Run</strong><span>native GrapesJS · working project</span>";
  const pageSelect = node("select", "authoring-page-select");
  const copyInput = node("input", "authoring-copy-input");
  copyInput.type = "text";
  copyInput.placeholder = "Select a text layer to edit copy live";
  const feedback = node("span", "authoring-feedback");
  feedback.textContent = "Working state loaded";
  const button = (label: string, action: () => void | Promise<void>, primary = false) => {
    const control = node("button", primary ? "is-primary" : undefined);
    control.type = "button";
    control.textContent = label;
    control.addEventListener("click", () => {
      void Promise.resolve(action()).catch((error: unknown) => {
        feedback.textContent = error instanceof Error ? error.message : "Editor action failed.";
      });
    });
    return control;
  };
  const stage = node("div", "authoring-stage");
  shell.append(toolbar, stage);
  root.replaceChildren(shell);
  const editor = createEditor(stage, false);
  let loading = true;
  let workingRevision = initialState.revision;
  editor.AssetManager.add(assetSources(manifest));
  editor.loadProjectData(initialState.project);
  editor.Devices.select("marble-390");
  labelComponents(editor);
  for (const pageId of REQUIRED_PAGES) {
    const option = node("option");
    option.value = pageId;
    option.textContent = pageId;
    pageSelect.append(option);
  }
  const selectPage = (pageId: string) => {
    const page = editor.Pages.get(pageId);
    if (page) editor.Pages.select(page);
  };
  pageSelect.addEventListener("change", () => selectPage(pageSelect.value));
  editor.on("page:select", (page) => { pageSelect.value = page.getId(); });
  loading = false;

  editor.on("component:add", (component: Component) => {
    if (loading) return;
    const attributes = component.getAttributes();
    const source = attributes["data-fab-id"];
    if (!source) return;
    const peers = semanticComponents(editor).filter((candidate) => candidate !== component && candidate.getAttributes()["data-fab-id"] === source);
    if (peers.length === 0) return;
    const id = nextId(editor, source);
    component.addAttributes({ "data-fab-id": id, "data-fab-label": `${attributes["data-fab-label"] ?? source} copy` });
    component.set("name", `${attributes["data-fab-label"] ?? source} copy`);
    feedback.textContent = `Duplicate created as ${id}`;
  });

  const selectedText = (): Component | undefined => {
    const selected = editor.getSelected();
    if (!selected) return undefined;
    if (selected.get("type") === "text") return selected;
    return selected.findType("text")[0];
  };
  editor.on("component:selected", () => {
    const textLayer = selectedText();
    copyInput.disabled = !textLayer;
    copyInput.value = textLayer ? String(textLayer.get("content") ?? "") : "";
  });
  copyInput.addEventListener("input", () => {
    const textLayer = selectedText();
    if (!textLayer) return;
    textLayer.set("content", copyInput.value);
    feedback.textContent = "Copy changed · save to persist";
  });

  const save = async () => {
    const state = await request<WorkingState>("/api/project", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "if-match": workingRevision,
        "x-fabrikav2-capability": session.capability,
      },
      body: JSON.stringify(editor.getProjectData()),
    });
    workingRevision = state.revision;
    feedback.textContent = `Saved ${workingRevision}`;
  };
  const saveButton = button("Save", save, true);
  const publish = async (): Promise<PublicationResult> => {
    await save();
    const result = await request<PublicationResult>("/api/publish", {
      method: "POST",
      headers: {
        "if-match": workingRevision,
        "x-fabrikav2-capability": session.capability,
      },
    });
    feedback.textContent = result.revision;
    return result;
  };
  const publishButton = button("Publish Preview", async () => {
    const result = await publish();
    window.open(result.previewUrl, "_blank", "noopener,noreferrer");
  });
  const resetButton = button("Reset baseline", async () => {
    if (!window.confirm("Replace the working project with the protected Marble baseline?")) return;
    const reset = await request<WorkingState>("/api/reset", {
      method: "POST",
      headers: {
        "if-match": workingRevision,
        "x-fabrikav2-capability": session.capability,
      },
    });
    loading = true;
    editor.loadProjectData(reset.project);
    workingRevision = reset.revision;
    labelComponents(editor);
    loading = false;
    feedback.textContent = "Working state reset from protected baseline";
  });
  const assetsButton = button("Replace exact asset", () => {
    const selected = editor.getSelected();
    if (!selected || selected.get("type") !== "image") {
      feedback.textContent = "Select an image layer before replacing its exact asset";
      return;
    }
    editor.runCommand("open-assets", {
      target: selected,
      types: ["image"],
      select(asset: Asset, complete: boolean) {
        const replacement = applyExactAssetReplacement(selected, manifest, String(asset.getSrc()));
        feedback.textContent = `Replaced with ${replacement.role} · save to persist`;
        if (complete) editor.Modal.close();
      },
    });
  });
  const duplicateButton = button("Duplicate", () => {
    const selected = editor.getSelected();
    const parent = selected?.parent();
    if (!selected || !parent || !selected.getAttributes()["data-fab-id"]) return;
    parent.append(selected.clone());
  });
  const visibilityButton = button("Show / hide", () => {
    const selected = editor.getSelected();
    if (!selected) return;
    const style = selected.getStyle();
    selected.setStyle({ ...style, display: style.display === "none" ? "" : "none" });
  });
  toolbar.append(identity, pageSelect, copyInput, saveButton, publishButton, resetButton, assetsButton, duplicateButton, visibilityButton, feedback);
  window.__FABRIKAV2_MARBLE_GRAPES__ = {
    getProjectData: () => editor.getProjectData(),
    select(instanceId) {
      const component = semanticComponents(editor).find((candidate) => candidate.getAttributes()["data-fab-id"] === instanceId);
      if (!component) return false;
      editor.select(component);
      return true;
    },
    selectPage(pageId) {
      const page = editor.Pages.get(pageId);
      if (!page) return false;
      editor.Pages.select(page);
      return true;
    },
    save,
    publish,
  };
}

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing application root.");
void (location.pathname === "/preview" ? mountPreview(root) : mountEditor(root)).catch((error: unknown) => {
  root.textContent = error instanceof Error ? error.message : "The authoring frontend failed to load.";
  root.className = "fatal-error";
});
