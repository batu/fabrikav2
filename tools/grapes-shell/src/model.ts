import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { REQUIRED_PAGES, type AssetManifest } from "./contract.ts";

export type { AssetManifest } from "./contract.ts";

type JsonRecord = Record<string, unknown>;

export interface FrozenDependency {
  readonly file: string;
  readonly sha256: string;
}

export interface FrozenDependencies {
  readonly schema: "fabrikav2-grapes-dependencies/v1";
  readonly tokens: FrozenDependency;
  readonly files: readonly FrozenDependency[];
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonRecord;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function styleRecord(project: JsonRecord, component: JsonRecord): JsonRecord {
  const attributes = record(component.attributes, "component attributes");
  const grapeId = attributes.id;
  const style: JsonRecord = {};
  if (typeof grapeId === "string" && Array.isArray(project.styles)) {
    for (const candidate of project.styles) {
      const rule = record(candidate, "GrapesJS style rule");
      if (!Array.isArray(rule.selectors) || !rule.selectors.includes(`#${grapeId}`) || rule.style === undefined) continue;
      Object.assign(style, record(rule.style, `style rule #${grapeId}`));
    }
  }
  if (component.style !== undefined) Object.assign(style, record(component.style, "component style"));
  return style;
}

function cssUrls(value: string): string[] {
  const urls: string[] = [];
  const declarations = value.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
  const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)/giu;
  for (const match of declarations.matchAll(pattern)) urls.push(match[2] ?? "");
  return urls;
}

type MarbleComponentType = "wrapper" | "default" | "image" | "text";

interface ComponentSchema {
  readonly fields: ReadonlySet<string>;
  readonly required: ReadonlySet<string>;
  readonly attributes: ReadonlySet<string>;
  readonly tags: ReadonlySet<string | undefined>;
}

const SEMANTIC_ATTRIBUTES = ["data-fab-id", "data-fab-label", "data-fab-role", "id"] as const;
const WRAPPER_STYLABLE = [
  "background",
  "background-color",
  "background-image",
  "background-repeat",
  "background-attachment",
  "background-position",
  "background-size",
] as const;
const COMPONENT_SCHEMAS: Readonly<Record<MarbleComponentType, ComponentSchema>> = {
  wrapper: {
    fields: new Set(["type", "name", "stylable", "attributes", "components", "docEl", "head"]),
    required: new Set(["type", "name", "stylable", "attributes", "components", "docEl", "head"]),
    attributes: new Set(["data-fab-page", "data-fab-role", "id"]),
    tags: new Set([undefined]),
  },
  default: {
    fields: new Set(["type", "tagName", "name", "resizable", "attributes", "components"]),
    required: new Set(["type", "tagName", "name", "resizable", "attributes"]),
    attributes: new Set(SEMANTIC_ATTRIBUTES),
    tags: new Set(["section", "span"]),
  },
  image: {
    fields: new Set(["type", "name", "resizable", "attributes", "src"]),
    required: new Set(["type", "name", "resizable", "attributes"]),
    attributes: new Set([...SEMANTIC_ATTRIBUTES, "alt", "data-asset-role", "data-asset-sha", "src"]),
    tags: new Set([undefined]),
  },
  text: {
    fields: new Set(["type", "tagName", "name", "resizable", "attributes", "content"]),
    required: new Set(["type", "tagName", "name", "resizable", "attributes"]),
    attributes: new Set(SEMANTIC_ATTRIBUTES),
    tags: new Set(["span"]),
  },
};

function componentSchemaError(label: string, detail: string): never {
  throw new Error(`Invalid Marble component schema at ${label}: ${detail}.`);
}

function hasHtmlDelimiter(value: string): boolean {
  if (value.includes("<") || value.includes(">")) return true;
  const lower = value.toLowerCase();
  for (let index = lower.indexOf("&"); index >= 0; index = lower.indexOf("&", index + 1)) {
    const tail = lower.slice(index + 1);
    if (tail.startsWith("lt;") || tail.startsWith("gt;") || tail === "lt" || tail === "gt") return true;
    if (!tail.startsWith("#")) continue;
    const hexadecimal = tail[1] === "x";
    const digits = tail.slice(hexadecimal ? 2 : 1).match(hexadecimal ? /^[0-9a-f]+/u : /^\d+/u)?.[0];
    if (!digits) continue;
    const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
    if (codePoint === 60 || codePoint === 62) return true;
  }
  return false;
}

function validateComponentSchema(value: unknown, label: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) componentSchemaError(label, "component must be an object");
  const component = value as JsonRecord;
  const type = component.type;
  if (type !== "wrapper" && type !== "default" && type !== "image" && type !== "text") {
    componentSchemaError(label, `unsupported type ${String(type)}`);
  }
  const schema = COMPONENT_SCHEMAS[type];
  for (const field of Object.keys(component)) {
    if (!schema.fields.has(field)) componentSchemaError(label, `field ${field} is not allowed for ${type}`);
  }
  for (const field of schema.required) {
    if (!(field in component)) componentSchemaError(label, `required field ${field} is missing for ${type}`);
  }
  if (!schema.tags.has(typeof component.tagName === "string" ? component.tagName : undefined)) {
    componentSchemaError(label, `tag ${String(component.tagName)} is not allowed for ${type}`);
  }
  if (typeof component.name !== "string" || component.name.length === 0) componentSchemaError(label, "name must be a non-empty string");
  if (type !== "wrapper" && component.resizable !== true) componentSchemaError(label, `${type} must remain resizable`);

  if (!component.attributes || typeof component.attributes !== "object" || Array.isArray(component.attributes)) {
    componentSchemaError(label, "attributes must be an object");
  }
  for (const [attribute, attributeValue] of Object.entries(component.attributes as JsonRecord)) {
    if (!schema.attributes.has(attribute)) componentSchemaError(label, `attribute ${attribute} is not allowed for ${type}`);
    if (typeof attributeValue !== "string") componentSchemaError(label, `attribute ${attribute} must be a string`);
  }

  if (type === "wrapper") {
    if (JSON.stringify(component.docEl) !== JSON.stringify({ tagName: "html" })) componentSchemaError(label, "docEl must be the canonical html document element");
    if (JSON.stringify(component.head) !== JSON.stringify({ type: "head" })) componentSchemaError(label, "head must be the canonical empty Grapes head");
    if (JSON.stringify(component.stylable) !== JSON.stringify(WRAPPER_STYLABLE)) {
      componentSchemaError(label, "stylable must be the canonical Marble background property list");
    }
  }
  if (type === "image") {
    const attributeSrc = (component.attributes as JsonRecord).src;
    const source = component.src ?? attributeSrc;
    if (typeof source !== "string") componentSchemaError(label, "image src must be a string field or attribute");
    if (component.src !== undefined && attributeSrc !== undefined && component.src !== attributeSrc) {
      componentSchemaError(label, "image src field and attribute must match");
    }
  }
  if (type === "text") {
    if (component.content !== undefined && typeof component.content !== "string") componentSchemaError(label, "text content must be a string");
    if (typeof component.content === "string" && hasHtmlDelimiter(component.content)) {
      componentSchemaError(label, "text content must be plain text, not HTML markup");
    }
  }

  if (component.components !== undefined) {
    if (!Array.isArray(component.components)) componentSchemaError(label, "components must be an array");
    component.components.forEach((child, index) => validateComponentSchema(child, `${label}.components[${index}]`));
  }
}

function validateProjectUrls(value: unknown, exactAssets: ReadonlyMap<string, unknown>, cssContext = false): void {
  if (Array.isArray(value)) {
    for (const item of value) validateProjectUrls(item, exactAssets, cssContext);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [childKey, child] of Object.entries(value as JsonRecord)) {
    const childCssContext = cssContext || childKey === "style" || childKey === "styles" || childKey === "css";
    if (childKey === "src" && typeof child === "string" && !exactAssets.has(child)) {
      throw new Error(`Component references uncurated asset URL ${child}.`);
    }
    if (typeof child === "string") {
      if (childCssContext && child.includes("\\")) {
        throw new Error(`CSS escapes are not supported in ${childKey}; use the literal curated URL.`);
      }
      if (childKey === "srcset" || /\b(?:src|srcset|poster|href)\s*=/iu.test(child)) {
        throw new Error(`Project contains an unsupported embedded asset URL form in ${childKey}.`);
      }
      if (/(?:-webkit-)?image-set\s*\(|@import\b/iu.test(child)) {
        throw new Error(`Project contains an unsupported CSS URL form in ${childKey}.`);
      }
      for (const url of cssUrls(child)) {
        if (!exactAssets.has(url)) throw new Error(`Project contains uncurated CSS URL ${url}.`);
      }
      if (/https?:\/\/|data:|(?:^|[^:])\/\//iu.test(child) && !exactAssets.has(child)) {
        throw new Error(`Project contains uncurated asset URL ${child}.`);
      }
    } else {
      validateProjectUrls(child, exactAssets, childCssContext);
    }
  }
}

export function validateTokenCss(css: string, manifest: AssetManifest): void {
  const declarations = css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
  if (declarations.includes("\\")) throw new Error("CSS escapes are not supported in token CSS; use literal curated URLs.");
  if (/@import\b|(?:-webkit-)?image-set\s*\(|https?:\/\/|data:/iu.test(declarations)) {
    throw new Error("Token CSS contains an uncurated or unsupported CSS URL form.");
  }
  const allowed = new Set(manifest.fonts.map((font) => `./assets/${font.file}`));
  for (const url of cssUrls(css)) {
    if (!allowed.has(url)) throw new Error(`Token CSS contains uncurated CSS URL ${url}.`);
  }
}

function walkComponents(value: unknown, visit: (component: JsonRecord) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkComponents(item, visit);
    return;
  }
  if (!value || typeof value !== "object") return;
  const component = value as JsonRecord;
  visit(component);
  walkComponents(component.components, visit);
}

export function validateProjectData(value: unknown, manifest: AssetManifest): JsonRecord {
  const project = record(value, "GrapesJS project data");
  if (!Array.isArray(project.pages)) throw new Error("GrapesJS project data must contain pages.");
  const pages = project.pages.map((item, index) => record(item, `pages[${index}]`));
  const pageIds = pages.map((page) => page.id);
  if (JSON.stringify(pageIds) !== JSON.stringify(REQUIRED_PAGES)) {
    throw new Error(`Pages must be exactly ${REQUIRED_PAGES.join(", ")} in canonical order.`);
  }

  for (const [pageIndex, page] of pages.entries()) {
    if (page.component !== undefined) validateComponentSchema(page.component, `pages[${pageIndex}].component`);
    if (!Array.isArray(page.frames)) componentSchemaError(`pages[${pageIndex}]`, "frames must be an array");
    for (const [frameIndex, frameValue] of page.frames.entries()) {
      const frame = record(frameValue, `pages[${pageIndex}].frames[${frameIndex}]`);
      validateComponentSchema(frame.component, `pages[${pageIndex}].frames[${frameIndex}].component`);
    }
  }

  const exactAssets = new Map(manifest.assets.map((asset) => [`/marble-assets/${asset.file}`, asset]));
  validateProjectUrls(project, exactAssets);
  const ids = new Set<string>();
  for (const page of pages) {
    const frames = Array.isArray(page.frames) ? page.frames.map((frame, index) => record(frame, `page ${String(page.id)} frames[${index}]`)) : [];
    const component = page.component
      ? record(page.component, `page ${String(page.id)} component`)
      : record(frames[0]?.component, `page ${String(page.id)} frame component`);
    const attributes = record(component.attributes, `page ${String(page.id)} attributes`);
    if (attributes["data-fab-page"] !== page.id) throw new Error(`Page ${String(page.id)} root is not self-identifying.`);
    const rootStyle = styleRecord(project, component);
    if (rootStyle.width !== "390px" || rootStyle.height !== "844px") throw new Error(`Page ${String(page.id)} must be 390x844.`);

    walkComponents(component, (candidate) => {
      const attrs = candidate.attributes;
      if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return;
      const componentAttrs = attrs as JsonRecord;
      const id = componentAttrs["data-fab-id"];
      if (id !== undefined) {
        if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/u.test(id)) throw new Error(`Invalid semantic instance id ${String(id)}.`);
        if (ids.has(id)) throw new Error(`Duplicate semantic instance id ${id}.`);
        ids.add(id);
        if (typeof componentAttrs["data-fab-role"] !== "string") throw new Error(`Instance ${id} is missing data-fab-role.`);
      }
      const src = candidate.src ?? componentAttrs.src;
      if (candidate.type === "image" && typeof src !== "string") throw new Error(`Image ${String(id ?? "without semantic id")} is missing a curated asset URL.`);
      if (typeof src !== "string") return;
      const asset = exactAssets.get(src);
      if (!asset) throw new Error(`Component references uncurated asset URL ${src}.`);
      if (componentAttrs["data-asset-sha"] !== asset.sha256) throw new Error(`Asset hash metadata diverges for ${src}.`);
      if (componentAttrs["data-asset-role"] !== undefined && componentAttrs["data-asset-role"] !== asset.role) {
        throw new Error(`Asset role metadata diverges for ${src}.`);
      }
    });
  }
  if (ids.size < 50) throw new Error(`Project exposes only ${ids.size} semantic instances; expected at least 50.`);
  return structuredClone(project);
}

export async function verifyAssetBytes(assetRoot: string, manifest: AssetManifest): Promise<void> {
  for (const asset of [...manifest.assets, ...manifest.fonts]) {
    const bytes = await readFile(`${assetRoot}/${asset.file}`);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== asset.sha256) throw new Error(`Exact bytes changed for ${asset.file}.`);
  }
}

export function workingRevision(project: unknown): string {
  return `sha256-${sha256(canonical({ project, profile: "fabrikav2-grapes-working/v1" }))}`;
}

export function publicationRevision(project: unknown, manifest: AssetManifest, dependencies: FrozenDependencies): string {
  const payload = {
    project,
    assets: manifest,
    dependencies,
    profile: { game: "marble_run", frontend: "grapesjs", viewport: [390, 844], version: 2 },
  };
  return `sha256-${sha256(canonical(payload))}`;
}
