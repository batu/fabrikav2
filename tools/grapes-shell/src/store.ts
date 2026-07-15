import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { publicationRevision, validateProjectData, verifyAssetBytes, type AssetManifest } from "./model.ts";

export interface StorePaths {
  readonly baseline: string;
  readonly working: string;
  readonly publications: string;
  readonly latest: string;
  readonly manifest: string;
  readonly assetRoot: string;
}

export interface PublicationResult {
  readonly revision: string;
  readonly projectUrl: string;
  readonly previewUrl: string;
}

async function json(pathname: string): Promise<unknown> {
  return JSON.parse(await readFile(pathname, "utf8")) as unknown;
}

async function atomicJson(pathname: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(pathname), { recursive: true });
  const temporary = `${pathname}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, pathname);
}

export class MarbleProjectStore {
  public constructor(private readonly paths: StorePaths) {}

  public async manifest(): Promise<AssetManifest> {
    return json(this.paths.manifest) as Promise<AssetManifest>;
  }

  public async readWorking(): Promise<Record<string, unknown>> {
    return validateProjectData(await json(this.paths.working), await this.manifest());
  }

  public async saveWorking(project: unknown): Promise<Record<string, unknown>> {
    const manifest = await this.manifest();
    await verifyAssetBytes(this.paths.assetRoot, manifest);
    const validated = validateProjectData(project, manifest);
    await atomicJson(this.paths.working, validated);
    return validated;
  }

  public async reset(): Promise<Record<string, unknown>> {
    const manifest = await this.manifest();
    const baseline = validateProjectData(await json(this.paths.baseline), manifest);
    await atomicJson(this.paths.working, baseline);
    return baseline;
  }

  public async publish(project: unknown): Promise<PublicationResult> {
    const manifest = await this.manifest();
    await verifyAssetBytes(this.paths.assetRoot, manifest);
    const validated = validateProjectData(project, manifest);
    const revision = publicationRevision(validated, manifest);
    const directory = path.join(this.paths.publications, revision);
    await mkdir(directory, { recursive: true });
    await atomicJson(path.join(directory, "project.json"), validated);
    await atomicJson(path.join(directory, "publication.json"), {
      schema: "fabrikav2-grapes-publication/v1",
      game: "marble_run",
      frontend: "grapesjs",
      revision,
      source: "native GrapesJS project data",
      pages: ["menu", "gameplay-hud", "pause", "settings-menu", "settings-level", "win", "fail", "finale", "shop"],
    });
    await atomicJson(this.paths.latest, { revision });
    return {
      revision,
      projectUrl: `/api/publications/${revision}/project`,
      previewUrl: `/preview?revision=${revision}&page=menu`,
    };
  }

  public async readPublication(revision: string): Promise<Record<string, unknown>> {
    if (!/^sha256-[a-f0-9]{64}$/u.test(revision)) throw new Error("Invalid publication revision.");
    return validateProjectData(await json(path.join(this.paths.publications, revision, "project.json")), await this.manifest());
  }

  public async clearPublicationsForTest(): Promise<void> {
    await rm(this.paths.publications, { recursive: true, force: true });
  }
}
