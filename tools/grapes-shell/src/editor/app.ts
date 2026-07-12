import {
  hashCanonicalJson,
  shellPresentationContractV2,
  type ShellPresentationInstance,
  type ShellStateIdV2,
} from "@fabrikav2/kernel";

import {
  canReorderInstance,
  createStarterProject,
  GRAPES_TARGET_GAME,
  duplicateInstance,
  reorderInstance,
  updateInstancePresentation,
  validateProjectFile,
  type GrapesShellProject,
} from "../shared/project.ts";
import { normalizeSemanticLayout } from "../shared/layout.ts";
import { createConstrainedGrapesCanvas } from "./grapes-canvas.ts";
import { editorAssetUrl } from "./assets.ts";
import { editorAssetCatalog } from "./seed.ts";

import "grapesjs/dist/css/grapes.min.css";
import "./editor.css";

const EDITOR_TARGET_GAME = GRAPES_TARGET_GAME;
// project-v2 supersedes project-v1: the U1/U2 asset-authority repair changed the
// asset vocabulary, so any pre-repair draft stored under the v1 key is orphaned
// and can never re-load as a "saved" project reviewed against the current catalog.
const STORAGE_KEY = `fabrikav2:grapes-shell:project-v2:${EDITOR_TARGET_GAME}`;

type StoredState = "unsaved" | "dirty" | "saved-unpublished";
type FeedbackTone = "neutral" | "success" | "error";

export interface LoadedProject {
  readonly project: GrapesShellProject;
  readonly status: StoredState;
  readonly feedback: string;
  readonly feedbackTone: FeedbackTone;
}

interface ValidatedEditorSnapshot {
  readonly project: GrapesShellProject;
  readonly projectHash: string;
  readonly assetCatalogHash: string;
  readonly status: StoredState;
}

declare global {
  interface Window {
    __FABRIKAV2_GRAPES_SHELL_EDITOR__?: {
      getValidatedProject(): GrapesShellProject;
      getValidatedSnapshot(): Promise<ValidatedEditorSnapshot>;
      getStatus(): StoredState;
    };
  }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function text(node: Node, value: string): void {
  node.textContent = value;
}

function titleCase(value: string): string {
  return value.split(/[.-]/u).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function editErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "The requested constrained edit was rejected.";
  const firstIssue = message.split("\n").map((line) => line.trim()).find((line) => line.startsWith("- "));
  return `Edit rejected. ${(firstIssue?.replace(/^- [^:]+:\s*/u, "") ?? message).trim()}`;
}

function editRejection(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return editErrorMessage(error).replace(/^Edit rejected\.\s*/u, "");
  }
}

export function loadBrowserProject(readStoredProject: () => string | null): LoadedProject {
  let serialized: string | null;
  try {
    serialized = readStoredProject();
  } catch {
    return {
      project: createStarterProject(EDITOR_TARGET_GAME),
      status: "unsaved",
      feedback: "Browser storage is unavailable. The starter project is open but has not been saved.",
      feedbackTone: "error",
    };
  }
  if (!serialized) {
    return {
      project: createStarterProject(EDITOR_TARGET_GAME),
      status: "unsaved",
      feedback: "Validated starter loaded. Save it before handing this project to Fabrika.",
      feedbackTone: "neutral",
    };
  }
  try {
    return {
      project: validateProjectFile(JSON.parse(serialized) as unknown, editorAssetCatalog, EDITOR_TARGET_GAME),
      status: "saved-unpublished",
      feedback: "Validated browser draft loaded. Raw HTML, CSS, and unsupported GrapesJS panels are unavailable.",
      feedbackTone: "neutral",
    };
  } catch {
    return {
      project: createStarterProject(EDITOR_TARGET_GAME),
      status: "unsaved",
      feedback: "The stored browser draft was invalid and was not loaded. Review and save the starter before handoff.",
      feedbackTone: "error",
    };
  }
}

export function saveBrowserProject(project: GrapesShellProject, writeStoredProject: (value: string) => void): boolean {
  try {
    writeStoredProject(JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}

function downloadProject(project: GrapesShellProject): void {
  const link = document.createElement("a");
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${project.targetGame}-grapes-shell-project.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function button(label: string, onClick: () => void, className = "editor-button"): HTMLButtonElement {
  const control = element("button", className);
  control.type = "button";
  text(control, label);
  control.addEventListener("click", onClick);
  return control;
}

function instanceFor(project: GrapesShellProject, instanceId: string): ShellPresentationInstance | undefined {
  return project.presentation.pages.flatMap((page) => page.instances).find((instance) => instance.id === instanceId);
}

function roleAllows(instance: ShellPresentationInstance, property: string): boolean {
  return shellPresentationContractV2.roles.find((role) => role.id === instance.roleId)?.editableProperties.includes(property) ?? false;
}

export function mountConstrainedEditor(root: HTMLElement): void {
  const loaded = loadBrowserProject(() => localStorage.getItem(STORAGE_KEY));
  let project = loaded.project;
  let selectedState: ShellStateIdV2 = "menu";
  let selectedId = project.presentation.pages.find((page) => page.stateId === selectedState)?.instances[0]?.id ?? "";
  let selectedVariant = "";
  let status: StoredState = loaded.status;
  let feedback = loaded.feedback;
  let feedbackTone: FeedbackTone = loaded.feedbackTone;
  let previewMode: "author" | "clean" = "author";

  const shell = element("div", "editor-shell");
  const header = element("header", "editor-header");
  const body = element("div", "editor-workspace");
  const navigation = element("aside", "editor-navigation");
  const stage = element("main", "editor-stage");
  const inspector = element("aside", "editor-inspector");
  const footer = element("footer", "editor-footer");
  const stageToolbar = element("div", "editor-stage-toolbar");
  const modeSwitch = element("div", "editor-mode-switch");
  modeSwitch.setAttribute("role", "group");
  modeSwitch.setAttribute("aria-label", "Canvas view");
  const authorModeButton = button("Author", () => setPreviewMode("author"), "editor-mode-button");
  const cleanModeButton = button("Clean preview", () => setPreviewMode("clean"), "editor-mode-button");
  modeSwitch.append(authorModeButton, cleanModeButton);
  const modeHint = element("p", "editor-mode-hint");
  stageToolbar.append(modeSwitch, modeHint);
  const canvasFrame = element("div", "editor-artboard-frame");
  const canvasHost = element("div", "editor-artboard");
  canvasFrame.append(canvasHost);
  stage.append(stageToolbar, canvasFrame);
  body.append(navigation, stage, inspector);
  shell.append(header, body, footer);
  root.replaceChildren(shell);

  function setPreviewMode(mode: "author" | "clean"): void {
    if (previewMode === mode) return;
    previewMode = mode;
    refresh();
  }

  function refreshStageToolbar(): void {
    const clean = previewMode === "clean";
    authorModeButton.classList.toggle("is-active", !clean);
    authorModeButton.setAttribute("aria-pressed", String(!clean));
    cleanModeButton.classList.toggle("is-active", clean);
    cleanModeButton.setAttribute("aria-pressed", String(clean));
    text(
      modeHint,
      clean
        ? "Clean preview — authored pixels only. Editor guides, selection, and unfilled optional art are hidden."
        : "Author view — selection outline, safe-area guides, and empty-slot labels help you compose.",
    );
  }

  const canvas = createConstrainedGrapesCanvas({
    container: canvasHost,
    onSelect(instanceId) {
      const page = project.presentation.pages.find((candidate) => candidate.instances.some((item) => item.id === instanceId));
      if (!page) return;
      const wasVariantPreview = selectedVariant !== "";
      selectedState = page.stateId;
      selectedId = instanceId;
      selectedVariant = "";
      // Rebuilding GrapesJS components from inside component:selected destroys
      // the pointer target and prevents the same gesture from becoming a drag.
      // Base selection updates editor chrome in place; a read-only variant
      // still needs one full render to return its pixels to the base state.
      if (wasVariantPreview) refresh();
      else refreshEditorChrome();
    },
    onGeometryCommit(instanceId, bounds) {
      const instance = instanceFor(project, instanceId);
      if (!instance) return;
      selectedId = instanceId;
      selectedVariant = "";
      commitCanvasGeometry(
        () => updateInstancePresentation(
          project,
          instanceId,
          { geometry: normalizeSemanticLayout(instance.roleId, bounds, instance.presentation.geometry.fit) },
          editorAssetCatalog,
        ),
        "Canvas position and size saved as normalized semantic geometry.",
      );
    },
  });
  window.__FABRIKAV2_GRAPES_SHELL_EDITOR__ = {
    getValidatedProject: () => structuredClone(validateProjectFile(project, editorAssetCatalog, EDITOR_TARGET_GAME)),
    getValidatedSnapshot: async () => {
      const validated = structuredClone(validateProjectFile(project, editorAssetCatalog, EDITOR_TARGET_GAME));
      const snapshotStatus = status;
      const [projectHash, assetCatalogHash] = await Promise.all([
        hashCanonicalJson(validated),
        hashCanonicalJson(editorAssetCatalog),
      ]);
      return { project: validated, projectHash, assetCatalogHash, status: snapshotStatus };
    },
    getStatus: () => status,
  };

  function currentPage() {
    return project.presentation.pages.find((page) => page.stateId === selectedState)!;
  }

  function currentInstance(): ShellPresentationInstance {
    return instanceFor(project, selectedId) ?? currentPage().instances[0]!;
  }

  function applyCommit(
    action: () => GrapesShellProject,
    message: string,
    refreshAfter: () => void,
  ): boolean {
    try {
      const next = action();
      if (next === project) return true;
      project = next;
      status = "dirty";
      feedback = message;
      feedbackTone = "success";
    } catch (error) {
      feedback = editErrorMessage(error);
      feedbackTone = "error";
    }
    refreshAfter();
    return feedbackTone !== "error";
  }

  function commit(action: () => GrapesShellProject, message: string): void {
    applyCommit(action, message, refresh);
  }

  function commitLive(action: () => GrapesShellProject, message: string): boolean {
    return applyCommit(action, message, refreshLiveCanvas);
  }

  function commitCanvasGeometry(action: () => GrapesShellProject, message: string): void {
    try {
      const next = action();
      if (next === project) return;
      project = next;
      status = "dirty";
      feedback = message;
      feedbackTone = "success";
      // GrapesJS already painted the accepted pointer result. Preserve that
      // component and its active resize handles while updating semantic chrome.
      refreshEditorChrome();
    } catch (error) {
      feedback = editErrorMessage(error);
      feedbackTone = "error";
      // A rejected gesture must snap back to canonical project geometry.
      refresh();
    }
  }

  function selectState(stateId: ShellStateIdV2): void {
    selectedState = stateId;
    selectedId = currentPage().instances[0]?.id ?? "";
    selectedVariant = "";
    refresh();
  }

  function refreshHeader(): void {
    header.replaceChildren();
    const identity = element("div", "editor-brand");
    const eyebrow = element("p", "editor-eyebrow");
    text(eyebrow, "Fabrikav2 · constrained authoring");
    const heading = element("h1");
    text(heading, "Shell Studio");
    identity.append(eyebrow, heading);
    const state = element("div", "editor-publication-state");
    const stateTitle = element("strong");
    text(
      stateTitle,
      status === "dirty" ? "Dirty" : status === "saved-unpublished" ? "Saved · unpublished" : "Unsaved · unpublished",
    );
    const stateDetail = element("span");
    text(
      stateDetail,
      status === "dirty"
        ? "Browser draft changed · save or export the validated project."
        : status === "saved-unpublished"
          ? "Saved in this browser · not yet handed to Fabrika."
          : "Starter or recovery state · not saved in this browser.",
    );
    state.append(stateTitle, stateDetail);
    const actions = element("div", "editor-header-actions");
    actions.append(
      button("Save browser draft", () => {
        if (saveBrowserProject(project, (value) => localStorage.setItem(STORAGE_KEY, value))) {
          status = "saved-unpublished";
          feedback = "Browser draft saved. Fabrika has not received or published it.";
          feedbackTone = "success";
        } else {
          feedback = "Browser draft was not saved because browser storage is unavailable.";
          feedbackTone = "error";
        }
        refresh();
      }, "editor-button editor-button--primary"),
      button("Export validated project", () => {
        const validated = validateProjectFile(project, editorAssetCatalog, EDITOR_TARGET_GAME);
        downloadProject(validated);
        feedback = "Validated project JSON exported for Fabrika handoff. No repository publication occurred.";
        feedbackTone = "success";
        refresh();
      }),
    );
    header.append(identity, state, actions);
  }

  function refreshNavigation(): void {
    navigation.replaceChildren();
    const pagesHeading = element("h2", "editor-panel-heading");
    text(pagesHeading, "Seven surfaces");
    const pages = element("nav", "editor-page-switcher");
    for (const state of shellPresentationContractV2.states) {
      const control = button(state.label, () => selectState(state.id), "editor-page-button");
      control.setAttribute("aria-current", state.id === selectedState ? "page" : "false");
      if (state.id === selectedState) control.classList.add("is-active");
      pages.append(control);
    }
    const layersHeading = element("h2", "editor-panel-heading");
    text(layersHeading, "Semantic layers");
    const layers = element("div", "editor-layer-tree");
    const instances = [...currentPage().instances].sort(
      (left, right) => left.presentation.order - right.presentation.order || left.id.localeCompare(right.id),
    );
    const byId = new Map(instances.map((instance) => [instance.id, instance]));
    for (const instance of instances) {
      let depth = 0;
      let parentId = instance.parentInstanceId;
      while (parentId) {
        depth += 1;
        parentId = byId.get(parentId)?.parentInstanceId ?? null;
      }
      const prefix = depth > 0 ? `${"↳ ".repeat(depth)}` : "";
      const control = button(`${prefix}${titleCase(instance.roleId)} · ${instance.id}`, () => {
        selectedId = instance.id;
        selectedVariant = "";
        refresh();
      }, "editor-layer-button");
      control.dataset.instanceId = instance.id;
      control.dataset.depth = String(depth);
      if (instance.parentInstanceId) {
        control.setAttribute("aria-label", `${titleCase(instance.roleId)} ${instance.id}, child of ${instance.parentInstanceId}`);
      }
      control.setAttribute("aria-pressed", String(instance.id === selectedId));
      if (instance.id === selectedId) control.classList.add("is-selected");
      layers.append(control);
    }
    navigation.append(pagesHeading, pages, layersHeading, layers);
  }

  function numericControl(
    label: string,
    value: number,
    step: number,
    onChange: (next: number) => void,
    disabled = false,
  ): HTMLLabelElement {
    const field = element("label", "editor-field");
    const caption = element("span");
    text(caption, label);
    const input = element("input") as HTMLInputElement;
    input.type = "number";
    input.step = String(step);
    input.value = String(Math.round(value * 1_000) / 1_000);
    input.disabled = disabled;
    input.addEventListener("change", () => {
      const next = Number(input.value);
      if (Number.isFinite(next)) onChange(next);
    });
    field.append(caption, input);
    return field;
  }

  function textControl(
    label: string,
    value: string,
    onChange: (next: string) => boolean,
    disabled = false,
  ): HTMLLabelElement {
    const field = element("label", "editor-field editor-field--wide");
    const caption = element("span");
    text(caption, label);
    const input = element("input") as HTMLInputElement;
    input.type = "text";
    input.value = value;
    input.disabled = disabled;
    let acceptedValue = value;
    input.addEventListener("input", () => {
      if (onChange(input.value)) acceptedValue = input.value;
      else input.value = acceptedValue;
    });
    field.append(caption, input);
    return field;
  }

  function refreshInspector(): void {
    inspector.replaceChildren();
    const instance = currentInstance();
    const heading = element("h2", "editor-panel-heading");
    text(heading, "Selected component");
    const identity = element("div", "editor-component-identity");
    const name = element("strong");
    text(name, titleCase(instance.roleId));
    const id = element("code");
    text(id, instance.id);
    identity.append(name, id);
    const metadata = element("dl", "editor-metadata");
    for (const [term, value] of [
      ["Binding", instance.bindingId],
      ["Accessible name", instance.accessibility.nameKey],
      ["Traversal", instance.accessibility.traversalGroup],
    ]) {
      const dt = element("dt");
      text(dt, term);
      const dd = element("dd");
      text(dd, value);
      metadata.append(dt, dd);
    }
    const locked = element("p", "editor-locked-note");
    text(locked, "Runtime binding and accessibility are visible contract data; they cannot be edited here.");
    const editingBase = selectedVariant === "";

    const geometry = element("div", "editor-control-grid");
    const current = instance.presentation.geometry;
    if (roleAllows(instance, "geometry")) {
      geometry.append(
        numericControl("X offset %", current.offset.x * 100, 1, (next) =>
          commit(
            () => updateInstancePresentation(project, selectedId, { geometry: { ...current, offset: { ...current.offset, x: next / 100 } } }, editorAssetCatalog),
            "Position updated in the safe authoring rectangle.",
          ),
          !editingBase,
        ),
        numericControl("Y offset %", current.offset.y * 100, 1, (next) =>
          commit(
            () => updateInstancePresentation(project, selectedId, { geometry: { ...current, offset: { ...current.offset, y: next / 100 } } }, editorAssetCatalog),
            "Position updated in the safe authoring rectangle.",
          ),
          !editingBase,
        ),
        numericControl("Width %", current.size.width * 100, 1, (next) =>
          commit(
            () => updateInstancePresentation(project, selectedId, { geometry: { ...current, size: { ...current.size, width: next / 100 } } }, editorAssetCatalog),
            "Width updated under the role geometry cap.",
          ),
          !editingBase,
        ),
        numericControl("Height %", current.size.height * 100, 1, (next) =>
          commit(
            () => updateInstancePresentation(project, selectedId, { geometry: { ...current, size: { ...current.size, height: next / 100 } } }, editorAssetCatalog),
            "Height updated under the role geometry cap.",
          ),
          !editingBase,
        ),
      );
    }
    if (roleAllows(instance, "copy")) {
      geometry.append(textControl("Copy", instance.presentation.copy ?? "", (next) =>
        commitLive(() => updateInstancePresentation(project, selectedId, { copy: next }, editorAssetCatalog), "Copy updated as inert plain text."),
      !editingBase,
      ));
    }
    if (roleAllows(instance, "colors")) {
      const colorField = element("label", "editor-field");
      const caption = element("span");
      text(caption, "Background color");
      const picker = element("input") as HTMLInputElement;
      picker.type = "color";
      picker.value = instance.presentation.colors?.background?.slice(0, 7) ?? "#d9e7f1";
      picker.disabled = !editingBase;
      picker.addEventListener("change", () => commit(
        () => updateInstancePresentation(project, selectedId, { colors: { ...instance.presentation.colors, background: picker.value } }, editorAssetCatalog),
        "Background palette color updated through the U1 contract.",
      ));
      colorField.append(caption, picker);
      geometry.append(colorField);
    }
    if (roleAllows(instance, "visibility")) {
      const nextVisibility = instance.presentation.visibility === "visible" ? "hidden" : "visible";
      const visibilityRejection = editRejection(() =>
        updateInstancePresentation(project, selectedId, { visibility: nextVisibility }, editorAssetCatalog));
      if (visibilityRejection) {
        const required = element("p", "editor-locked-note editor-locked-note--compact");
        text(required, `Visibility locked · ${visibilityRejection}`);
        geometry.append(required);
      } else {
        const visibility = element("label", "editor-toggle");
        const checkbox = element("input") as HTMLInputElement;
        checkbox.type = "checkbox";
        checkbox.checked = instance.presentation.visibility === "visible";
        checkbox.disabled = !editingBase;
        checkbox.addEventListener("change", () => commit(
          () => updateInstancePresentation(project, selectedId, { visibility: checkbox.checked ? "visible" : "hidden" }, editorAssetCatalog),
          checkbox.checked ? "Component shown." : "Component hidden.",
        ));
        visibility.append(checkbox);
        const caption = element("span");
        text(caption, "Visible");
        visibility.append(caption);
        geometry.append(visibility);
      }
    }

    const variantHeading = element("h3", "editor-subheading");
    text(variantHeading, "Named variant preview");
    const variant = element("select", "editor-variant-select") as HTMLSelectElement;
    const base = element("option");
    base.value = "";
    text(base, "Base presentation");
    variant.append(base);
    for (const name of Object.keys(instance.variants)) {
      const option = element("option");
      option.value = name;
      text(option, titleCase(name));
      variant.append(option);
    }
    variant.value = selectedVariant;
    variant.addEventListener("change", () => {
      selectedVariant = variant.value;
      feedback = selectedVariant
        ? `${titleCase(selectedVariant)} is a read-only preview. Return to Base presentation before editing.`
        : "Base presentation selected for editing.";
      feedbackTone = "neutral";
      refresh();
    });
    const variantNote = element("p", "editor-locked-note editor-locked-note--compact");
    text(
      variantNote,
      editingBase
        ? "Choose a named variant to inspect it. Edits apply only to Base presentation."
        : `${titleCase(selectedVariant)} preview is read-only so a base edit cannot succeed invisibly.`,
    );

    const arrange = element("div", "editor-inline-actions");
    if (roleAllows(instance, "order")) {
      const backward = button("Send backward", () => commit(
        () => reorderInstance(project, selectedId, "backward", editorAssetCatalog),
        "Layer order updated within its semantic sibling group.",
      ));
      backward.disabled = !editingBase || !canReorderInstance(project, selectedId, "backward");
      if (backward.disabled) {
        backward.title = editingBase
          ? "This component is already the backmost layer in its semantic sibling group."
          : "Return to Base presentation before reordering.";
      }
      const forward = button("Bring forward", () => commit(
        () => reorderInstance(project, selectedId, "forward", editorAssetCatalog),
        "Layer order updated within its semantic sibling group.",
      ));
      forward.disabled = !editingBase || !canReorderInstance(project, selectedId, "forward");
      if (forward.disabled) {
        forward.title = editingBase
          ? "This component is already the frontmost layer in its semantic sibling group."
          : "Return to Base presentation before reordering.";
      }
      arrange.append(backward, forward);
    }
    const duplicateCandidate = duplicateInstance(project, selectedId);
    const duplicateRejection = editRejection(() =>
      validateProjectFile(duplicateCandidate.project, editorAssetCatalog, EDITOR_TARGET_GAME));
    const duplicateControl = button("Duplicate", () => {
        const duplicate = duplicateInstance(project, selectedId);
        project = validateProjectFile(duplicate.project, editorAssetCatalog, EDITOR_TARGET_GAME);
        selectedId = duplicate.instanceId;
        selectedVariant = "";
        status = "dirty";
        feedback = "Duplicated with a new stable instance identity and copied binding.";
        feedbackTone = "success";
        refresh();
      }, "editor-button editor-button--accent");
    duplicateControl.disabled = !editingBase || duplicateRejection !== undefined;
    if (!editingBase) duplicateControl.title = "Return to Base presentation before duplicating.";
    else if (duplicateRejection) duplicateControl.title = duplicateRejection;
    arrange.append(duplicateControl);

    const assetsHeading = element("h3", "editor-subheading");
    text(assetsHeading, "Curated asset tray");
    const assetSlotId = shellPresentationContractV2.roles.find((role) => role.id === instance.roleId)?.assetSlotId ?? null;
    const compatible = assetSlotId
      ? editorAssetCatalog.assets.filter((asset) => asset.slotId === assetSlotId)
      : [];
    const installedAssetId = selectedVariant
      ? (instance.variants[selectedVariant]?.assetId ?? instance.presentation.assetId)
      : instance.presentation.assetId;
    const installedAsset = installedAssetId
      ? editorAssetCatalog.assets.find((asset) => asset.id === installedAssetId)
      : undefined;

    const assetContext = element("dl", "editor-asset-context");
    for (const [term, value] of [
      ["Asset slot", assetSlotId ?? "None — this role has no raster"],
      ["Current asset", installedAsset ? installedAsset.name : "No raster installed"],
    ]) {
      const dt = element("dt");
      text(dt, term);
      const dd = element("dd");
      text(dd, value);
      assetContext.append(dt, dd);
    }

    const assets = element("div", "editor-asset-tray");
    if (compatible.length === 0) {
      const empty = element("p", "editor-empty");
      text(empty, "This role has no curated raster replacement.");
      assets.append(empty);
    }
    for (const asset of compatible) {
      const control = element("button", "editor-asset-card");
      control.type = "button";
      control.title = `${asset.name} · ${asset.description}`;
      const installed = asset.id === installedAssetId;
      control.disabled = !editingBase;
      if (!editingBase) control.title = "Return to Base presentation before replacing an asset.";
      control.setAttribute("aria-pressed", String(installed));
      if (installed) control.classList.add("is-installed");
      control.addEventListener("click", () => commit(
        () => updateInstancePresentation(project, selectedId, { assetId: asset.id }, editorAssetCatalog),
        `Installed ${asset.name} from the pinned ${asset.provenance.sourceId} seed.`,
      ));

      const thumbnail = element("span", "editor-asset-thumbnail");
      const image = element("img");
      image.src = editorAssetUrl(asset);
      image.alt = "";
      image.setAttribute("aria-hidden", "true");
      thumbnail.append(image);

      const details = element("span", "editor-asset-details");
      const name = element("strong");
      text(name, asset.name);
      const provenance = element("span", "editor-asset-provenance");
      text(provenance, `${asset.width}×${asset.height}px · ${asset.provenance.sourceId}`);
      details.append(name, provenance);

      const state = element("span", "editor-asset-state");
      text(state, installed ? "Installed" : "Use asset");
      control.append(thumbnail, details, state);
      assets.append(control);
    }
    inspector.append(heading, identity, metadata, locked, geometry, variantHeading, variant, variantNote, arrange, assetsHeading, assetContext, assets);
  }

  function refreshFooter(): void {
    footer.replaceChildren();
    const message = element("p", "editor-feedback");
    text(message, feedback);
    message.dataset.tone = feedbackTone;
    message.setAttribute("role", feedbackTone === "error" ? "alert" : "status");
    message.setAttribute("aria-live", feedbackTone === "error" ? "assertive" : "polite");
    const publication = element("div", "editor-publication-controls");
    const handoff = element("div", "editor-handoff-note");
    const handoffTitle = element("strong");
    text(handoffTitle, "Next · Fabrika project handoff");
    const handoffDetail = element("span");
    text(
      handoffDetail,
      "An agent saves this exact hash-bound JSON, then runs one-shot publish with `--expected-project-hash` and `--expected-asset-catalog-hash`.",
    );
    handoff.append(handoffTitle, handoffDetail);
    const apply = element("button", "editor-button editor-button--disabled") as HTMLButtonElement;
    apply.type = "button";
    apply.disabled = true;
    apply.title = "Apply is unavailable until an immutable publication and U4 preflight exist.";
    text(apply, "Apply locked · U4");
    publication.append(handoff, apply);
    footer.append(message, publication);
  }

  function refresh(): void {
    refreshEditorChrome();
    canvas.render(project.presentation, selectedState, selectedId, selectedVariant, previewMode === "clean");
  }

  function refreshEditorChrome(): void {
    refreshHeader();
    refreshNavigation();
    refreshInspector();
    refreshStageToolbar();
    refreshFooter();
  }

  function refreshLiveCanvas(): void {
    refreshHeader();
    canvas.render(project.presentation, selectedState, selectedId, selectedVariant, previewMode === "clean");
    refreshFooter();
  }

  refresh();
  window.addEventListener("beforeunload", () => canvas.destroy(), { once: true });
}
