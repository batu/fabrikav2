import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  publicationRevision,
  validateProjectData,
  validateTokenCss,
  workingRevision,
  type AssetManifest,
  type FrozenDependencies,
} from "./model.ts";

export interface StorePaths {
  readonly baseline: string;
  readonly working: string;
  readonly publications: string;
  readonly latest: string;
  readonly manifest: string;
  readonly assetRoot: string;
  readonly tokens: string;
}

export interface WorkingState {
  readonly project: Record<string, unknown>;
  readonly revision: string;
}

export interface PublicationResult {
  readonly revision: string;
  readonly projectUrl: string;
  readonly previewUrl: string;
}

interface SourceDependencies {
  readonly snapshot: FrozenDependencies;
  readonly bytes: ReadonlyMap<string, Buffer>;
}

interface PublicationBundle {
  readonly project: Record<string, unknown>;
  readonly manifest: AssetManifest;
  readonly dependencies: FrozenDependencies;
  readonly directory: string;
}

export class RevisionConflictError extends Error {
  public constructor(expected: string, actual: string) {
    super(`Working revision conflict: expected ${expected || "<missing>"}, current revision is ${actual}. Reload before saving or resetting.`);
    this.name = "RevisionConflictError";
  }
}

async function json(pathname: string): Promise<unknown> {
  return JSON.parse(await readFile(pathname, "utf8")) as unknown;
}

async function atomicJson(pathname: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(pathname), { recursive: true });
  const temporary = `${pathname}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, pathname);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function publicationPath(directory: string, relative: string): string {
  const resolved = path.resolve(directory, relative);
  if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error("Invalid publication dependency path.");
  return resolved;
}

function rewritePreviewUrls(value: unknown, revision: string): unknown {
  if (Array.isArray(value)) return value.map((item) => rewritePreviewUrls(item, revision));
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    return value.replaceAll(/url\(\s*(['"]?)(\/marble-assets\/([^)'"\s]+))\1\s*\)/giu,
      (_match, quote: string, _url: string, file: string) => `url(${quote}/api/publications/${revision}/assets/${file}${quote})`);
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (key === "src" && typeof item === "string" && item.startsWith("/marble-assets/")) {
      return [key, `/api/publications/${revision}/assets/${item.slice("/marble-assets/".length)}`];
    }
    return [key, rewritePreviewUrls(item, revision)];
  }));
}

export class MarbleProjectStore {
  private mutationTail: Promise<void> = Promise.resolve();

  public constructor(private readonly paths: StorePaths) {}

  private async mutate<T>(action: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.mutationTail;
    this.mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }

  public async manifest(): Promise<AssetManifest> {
    return json(this.paths.manifest) as Promise<AssetManifest>;
  }

  public async readWorking(): Promise<Record<string, unknown>> {
    return (await this.readWorkingState()).project;
  }

  public async readWorkingState(): Promise<WorkingState> {
    const project = validateProjectData(await json(this.paths.working), await this.manifest());
    return { project, revision: workingRevision(project) };
  }

  public async saveWorking(project: unknown, expectedRevision: string): Promise<WorkingState> {
    return this.mutate(async () => {
      const current = await this.readWorkingState();
      if (expectedRevision !== current.revision) throw new RevisionConflictError(expectedRevision, current.revision);
      const manifest = await this.manifest();
      await this.sourceDependencies(manifest);
      const validated = validateProjectData(project, manifest);
      await atomicJson(this.paths.working, validated);
      return { project: validated, revision: workingRevision(validated) };
    });
  }

  public async reset(expectedRevision: string): Promise<WorkingState> {
    return this.mutate(async () => {
      const current = await this.readWorkingState();
      if (expectedRevision !== current.revision) throw new RevisionConflictError(expectedRevision, current.revision);
      const manifest = await this.manifest();
      const baseline = validateProjectData(await json(this.paths.baseline), manifest);
      await atomicJson(this.paths.working, baseline);
      return { project: baseline, revision: workingRevision(baseline) };
    });
  }

  private async sourceDependencies(manifest: AssetManifest): Promise<SourceDependencies> {
    const bytes = new Map<string, Buffer>();
    const files = [];
    for (const asset of [...manifest.assets, ...manifest.fonts].sort((left, right) => left.file.localeCompare(right.file))) {
      const fileBytes = await readFile(path.join(this.paths.assetRoot, asset.file));
      const hash = sha256(fileBytes);
      if (hash !== asset.sha256) throw new Error(`Exact bytes changed for ${asset.file}.`);
      bytes.set(`assets/${asset.file}`, fileBytes);
      files.push({ file: asset.file, sha256: hash });
    }
    const tokenBytes = await readFile(this.paths.tokens);
    validateTokenCss(tokenBytes.toString("utf8"), manifest);
    bytes.set("tokens.css", tokenBytes);
    return {
      snapshot: {
        schema: "fabrikav2-grapes-dependencies/v1",
        tokens: { file: "tokens.css", sha256: sha256(tokenBytes) },
        files,
      },
      bytes,
    };
  }

  public async sourceDependenciesForTest(): Promise<SourceDependencies> {
    return this.sourceDependencies(await this.manifest());
  }

  public async publishWorking(expectedRevision: string): Promise<PublicationResult> {
    return this.mutate(async () => {
      const state = await this.readWorkingState();
      if (expectedRevision !== state.revision) throw new RevisionConflictError(expectedRevision, state.revision);
      const manifest = await this.manifest();
      const dependencies = await this.sourceDependencies(manifest);
      const revision = publicationRevision(state.project, manifest, dependencies.snapshot);
      const directory = path.join(this.paths.publications, revision);
      const staging = `${directory}.${process.pid}.${randomUUID()}.tmp`;
      await mkdir(staging, { recursive: true });
      try {
        await atomicJson(path.join(staging, "project.json"), state.project);
        await atomicJson(path.join(staging, "assets-manifest.json"), manifest);
        for (const [relative, fileBytes] of dependencies.bytes) {
          const destination = publicationPath(staging, relative);
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, fileBytes, { flag: "wx" });
        }
        await atomicJson(path.join(staging, "publication.json"), {
          schema: "fabrikav2-grapes-publication/v2",
          game: "marble_run",
          frontend: "grapesjs",
          revision,
          source: "native GrapesJS project data",
          dependencies: dependencies.snapshot,
          pages: ["menu", "gameplay-hud", "pause", "settings-menu", "settings-level", "win", "fail", "finale", "shop"],
        });
        try {
          await rename(staging, directory);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
          await rm(staging, { recursive: true, force: true });
          await this.verifiedPublication(revision);
        }
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
      await atomicJson(this.paths.latest, { revision });
      return {
        revision,
        projectUrl: `/api/publications/${revision}/project`,
        previewUrl: `/preview?revision=${revision}&page=menu`,
      };
    });
  }

  private async verifiedPublication(revision: string): Promise<PublicationBundle> {
    if (!/^sha256-[a-f0-9]{64}$/u.test(revision)) throw new Error("Invalid publication revision.");
    const directory = path.join(this.paths.publications, revision);
    const manifest = await json(path.join(directory, "assets-manifest.json")) as AssetManifest;
    const project = validateProjectData(await json(path.join(directory, "project.json")), manifest);
    const metadata = await json(path.join(directory, "publication.json")) as Record<string, unknown>;
    if (metadata.schema !== "fabrikav2-grapes-publication/v2" || metadata.revision !== revision) {
      throw new Error(`Publication ${revision} failed revision integrity metadata validation.`);
    }

    const tokenBytes = await readFile(path.join(directory, "tokens.css"));
    validateTokenCss(tokenBytes.toString("utf8"), manifest);
    const files = [];
    for (const asset of [...manifest.assets, ...manifest.fonts].sort((left, right) => left.file.localeCompare(right.file))) {
      const fileBytes = await readFile(publicationPath(directory, `assets/${asset.file}`));
      const hash = sha256(fileBytes);
      if (hash !== asset.sha256) throw new Error(`Publication ${revision} failed revision integrity for ${asset.file}.`);
      files.push({ file: asset.file, sha256: hash });
    }
    const dependencies: FrozenDependencies = {
      schema: "fabrikav2-grapes-dependencies/v1",
      tokens: { file: "tokens.css", sha256: sha256(tokenBytes) },
      files,
    };
    if (JSON.stringify(metadata.dependencies) !== JSON.stringify(dependencies)) {
      throw new Error(`Publication ${revision} failed revision integrity dependency validation.`);
    }
    const actualRevision = publicationRevision(project, manifest, dependencies);
    if (actualRevision !== revision) throw new Error(`Publication ${revision} failed revision integrity; computed ${actualRevision}.`);
    return { project, manifest, dependencies, directory };
  }

  public async readPublication(revision: string): Promise<Record<string, unknown>> {
    return (await this.verifiedPublication(revision)).project;
  }

  public async readPublicationPreview(revision: string): Promise<Record<string, unknown>> {
    const bundle = await this.verifiedPublication(revision);
    return rewritePreviewUrls(bundle.project, revision) as Record<string, unknown>;
  }

  public async readPublicationTokens(revision: string): Promise<string> {
    const bundle = await this.verifiedPublication(revision);
    return readFile(path.join(bundle.directory, "tokens.css"), "utf8");
  }

  public async readPublicationAsset(revision: string, file: string): Promise<Buffer> {
    const bundle = await this.verifiedPublication(revision);
    if (!bundle.dependencies.files.some((dependency) => dependency.file === file)) {
      throw new Error(`Publication ${revision} has no frozen dependency ${file}.`);
    }
    return readFile(publicationPath(bundle.directory, `assets/${file}`));
  }

  public async clearPublicationsForTest(): Promise<void> {
    await rm(this.paths.publications, { recursive: true, force: true });
  }
}
