import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type FrameLocator, type Page } from "@playwright/test";

import { publishAuthoringProject } from "../../../tools/grapes-shell/src/publication/publisher.ts";
import { createStarterProject } from "../../../tools/grapes-shell/src/shared/project.ts";
import { projectSemanticLayout } from "../../../tools/grapes-shell/src/shared/layout.ts";

interface BoundsRecord {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface AssetStyleRecord {
  readonly id: string;
  readonly insetX: number;
  readonly insetY: number;
  readonly width: number;
  readonly height: number;
  readonly objectFit: string;
  readonly opacity: string;
  readonly filter: string;
}

interface SurfaceStyleRecord {
  readonly id: string;
  readonly backgroundColor: string;
  readonly color: string;
  readonly borderColor: string;
  readonly boxShadow: string;
}

const evidenceRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(evidenceRoot, "../../..");
const seedRoot = path.join(repositoryRoot, "games/_template/design");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "grapes-shell-layout-seam-"));

function expectedMenuBounds(): BoundsRecord[] {
  const menu = createStarterProject().presentation.pages.find((page) => page.stateId === "menu")!;
  return menu.instances
    .map((instance) => ({ id: instance.id, ...projectSemanticLayout(instance.roleId, instance.presentation.geometry) }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function measure(locator: FrameLocator | Page, selector: string): Promise<BoundsRecord[]> {
  return locator.locator(selector).evaluateAll((nodes) => nodes
    .map((node) => {
      const rect = node.getBoundingClientRect();
      const id = node.getAttribute("data-semantic-instance") ?? node.getAttribute("data-shell-instance") ?? "";
      return { id, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })
    .sort((left, right) => left.id.localeCompare(right.id)));
}

async function measureAssets(
  locator: FrameLocator | Page,
  componentSelector: string,
  assetSelector: string,
): Promise<AssetStyleRecord[]> {
  return locator.locator(componentSelector).evaluateAll((nodes, nestedSelector) => nodes
    .flatMap((node) => {
      const asset = node.querySelector<HTMLElement>(nestedSelector);
      if (!asset) return [];
      const componentRect = node.getBoundingClientRect();
      const assetRect = asset.getBoundingClientRect();
      const style = getComputedStyle(asset);
      const id = node.getAttribute("data-semantic-instance") ?? node.getAttribute("data-shell-instance") ?? "";
      return [{
        id,
        insetX: assetRect.x - componentRect.x,
        insetY: assetRect.y - componentRect.y,
        width: assetRect.width,
        height: assetRect.height,
        objectFit: style.objectFit,
        opacity: style.opacity,
        filter: style.filter,
      }];
    })
    .sort((left, right) => left.id.localeCompare(right.id)), assetSelector);
}

async function measureSurfaces(locator: FrameLocator | Page, selector: string): Promise<SurfaceStyleRecord[]> {
  return locator.locator(selector).evaluateAll((nodes) => nodes
    .map((node) => {
      const style = getComputedStyle(node);
      const id = node.getAttribute("data-semantic-instance") ?? node.getAttribute("data-shell-instance") ?? "";
      return {
        id,
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderColor: style.borderColor,
        boxShadow: style.boxShadow,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id)));
}

function maxDelta(expected: readonly BoundsRecord[], actual: readonly BoundsRecord[]): number {
  if (expected.length !== actual.length) throw new Error(`Identity count mismatch: ${expected.length} != ${actual.length}.`);
  let maximum = 0;
  for (const [index, expectedRecord] of expected.entries()) {
    const actualRecord = actual[index]!;
    if (expectedRecord.id !== actualRecord.id) throw new Error(`Identity mismatch: ${expectedRecord.id} != ${actualRecord.id}.`);
    for (const key of ["x", "y", "width", "height"] as const) {
      maximum = Math.max(maximum, Math.abs(expectedRecord[key] - actualRecord[key]));
    }
  }
  return maximum;
}

const browser = await chromium.launch({ headless: true });
try {
  const expected = expectedMenuBounds();
  const editorPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await editorPage.goto("http://127.0.0.1:5203/", { waitUntil: "networkidle" });
  const editor = await measure(editorPage.locator(".gjs-frame").contentFrame(), "[data-semantic-instance]");
  const editorAssets = await measureAssets(
    editorPage.locator(".gjs-frame").contentFrame(),
    "[data-semantic-instance]",
    "[data-semantic-asset]",
  );
  const editorSurfaces = await measureSurfaces(
    editorPage.locator(".gjs-frame").contentFrame(),
    "[data-semantic-instance]",
  );

  const authoringDir = path.join(temporaryRoot, "games/shell_proof/authoring/grapesjs");
  await mkdir(authoringDir, { recursive: true });
  await writeFile(path.join(authoringDir, "project.json"), JSON.stringify(createStarterProject()), "utf8");
  const publication = await publishAuthoringProject({ authoringDir, seedRoot });
  const portablePage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await portablePage.goto(pathToFileURL(path.join(
    authoringDir,
    "publications",
    publication.publicationId,
    "portable/menu.html",
  )).href, { waitUntil: "load" });
  const portable = await measure(portablePage, "[data-shell-instance]");
  const portableAssets = await measureAssets(portablePage, "[data-shell-instance]", "img[data-asset-id]");
  const portableSurfaces = await measureSurfaces(portablePage, "[data-shell-instance]");

  const editorDelta = maxDelta(expected, editor);
  const portableDelta = maxDelta(expected, portable);
  const crossConsumerDelta = maxDelta(editor, portable);
  const assetGeometryDelta = maxDelta(
    editorAssets.map(({ id, insetX, insetY, width, height }) => ({ id, x: insetX, y: insetY, width, height })),
    portableAssets.map(({ id, insetX, insetY, width, height }) => ({ id, x: insetX, y: insetY, width, height })),
  );
  const assetStyleMismatch = editorAssets.some((record, index) => {
    const portableRecord = portableAssets[index];
    return !portableRecord || record.id !== portableRecord.id || record.objectFit !== portableRecord.objectFit ||
      record.opacity !== portableRecord.opacity || record.filter !== portableRecord.filter;
  });
  const surfaceStyleMismatch = editorSurfaces.some((record, index) => {
    const portableRecord = portableSurfaces[index];
    return !portableRecord || record.id !== portableRecord.id || record.backgroundColor !== portableRecord.backgroundColor ||
      record.color !== portableRecord.color || record.borderColor !== portableRecord.borderColor ||
      record.boxShadow !== portableRecord.boxShadow;
  });
  const tolerance = 0.02;
  if (editorDelta > tolerance || portableDelta > tolerance || crossConsumerDelta > tolerance || assetGeometryDelta > tolerance || assetStyleMismatch || surfaceStyleMismatch) {
    throw new Error(`Layout or visual seam exceeds tolerance: ${JSON.stringify({ editorDelta, portableDelta, crossConsumerDelta, assetGeometryDelta, assetStyleMismatch, surfaceStyleMismatch, expected, editor, portable, editorAssets, portableAssets, editorSurfaces, portableSurfaces })}`);
  }
  process.stdout.write(`${JSON.stringify({
    publicationId: publication.publicationId,
    instanceCount: expected.length,
    tolerance,
    maximumDelta: { editorVsKernel: editorDelta, portableVsKernel: portableDelta, editorVsPortable: crossConsumerDelta },
    assetFidelity: { geometryDelta: assetGeometryDelta, styleMismatch: assetStyleMismatch, editor: editorAssets, portable: portableAssets },
    surfaceFidelity: { styleMismatch: surfaceStyleMismatch, editor: editorSurfaces, portable: portableSurfaces },
    expected,
    editor,
    portable,
  }, null, 2)}\n`);
} finally {
  await browser.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}
