import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalizeJson, hashCanonicalJson } from "@fabrikav2/kernel";

import {
  ApplicationError,
  applyPublication,
  preflightPublication,
  readSelectedProjection,
} from "../application/projector.ts";
import { publicationStatus, publishAuthoringProject, type PreviewRenderer } from "../publication/publisher.ts";
import { renderPortablePreviews } from "../publication/preview.ts";
import { createStarterProject, validateProjectFile } from "./project.ts";
import { readSeedManifest } from "./seed.ts";

export interface CliDependencies {
  readonly emit?: (line: string) => void;
  readonly renderPreviews?: PreviewRenderer;
}

interface CliContext {
  readonly command: string;
  readonly game: string;
  readonly authoringDir: string;
  readonly seedRoot: string;
  readonly expectedProjectHash?: string;
  readonly expectedAssetCatalogHash?: string;
  readonly publicationId?: string;
}

const GAME_NAME = /^[a-z][a-z0-9_]*$/u;
const SHA256_HASH = /^sha256-[a-f0-9]{64}$/u;

function repositoryRoot(): string {
  return path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
}

function parseContext(argv: readonly string[]): CliContext {
  const [command, ...rawFlags] = argv;
  if (!command) throw new Error("A one-shot command is required: init, validate, publish, preflight, apply, or status.");
  const flags = new Map<string, string>();
  for (let index = 0; index < rawFlags.length; index += 2) {
    const flag = rawFlags[index];
    const value = rawFlags[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--") || flags.has(flag)) {
      throw new Error("Flags must be unique --name value pairs.");
    }
    if (!["--game", "--root", "--seed-root", "--expected-project-hash", "--expected-asset-catalog-hash", "--publication-id"].includes(flag)) {
      throw new Error(`Unsupported flag "${flag}".`);
    }
    flags.set(flag, value);
  }
  const game = flags.get("--game");
  if (!game || !GAME_NAME.test(game)) throw new Error("--game must use lowercase letters, digits, and underscores.");
  const expectedProjectHash = flags.get("--expected-project-hash");
  const expectedAssetCatalogHash = flags.get("--expected-asset-catalog-hash");
  const publicationId = flags.get("--publication-id");
  if (command === "publish") {
    if (!expectedProjectHash || !SHA256_HASH.test(expectedProjectHash)) {
      throw new Error("publish requires --expected-project-hash sha256-<64 lowercase hex> from the reviewed editor snapshot.");
    }
    if (!expectedAssetCatalogHash || !SHA256_HASH.test(expectedAssetCatalogHash)) {
      throw new Error("publish requires --expected-asset-catalog-hash sha256-<64 lowercase hex> from the reviewed editor snapshot.");
    }
  } else {
    if (expectedProjectHash) throw new Error("--expected-project-hash is accepted only by publish.");
    if (expectedAssetCatalogHash) throw new Error("--expected-asset-catalog-hash is accepted only by publish.");
  }
  if (command === "preflight" || command === "apply") {
    if (!publicationId || !SHA256_HASH.test(publicationId)) {
      throw new Error(`${command} requires --publication-id sha256-<64 lowercase hex>.`);
    }
  } else if (publicationId) {
    throw new Error("--publication-id is accepted only by preflight and apply.");
  }
  const root = path.resolve(flags.get("--root") ?? repositoryRoot());
  return {
    command,
    game,
    authoringDir: path.join(root, "games", game, "authoring", "grapesjs"),
    seedRoot: path.resolve(flags.get("--seed-root") ?? path.join(root, "games", game, "design")),
    ...(expectedProjectHash ? { expectedProjectHash } : {}),
    ...(expectedAssetCatalogHash ? { expectedAssetCatalogHash } : {}),
    ...(publicationId ? { publicationId } : {}),
  };
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Command failed.";
  return message.replace(/[\r\n]+/gu, " ").slice(0, 600);
}

function emit(dependencies: CliDependencies, value: unknown): void {
  (dependencies.emit ?? ((line) => process.stdout.write(`${line}\n`)))(canonicalizeJson(value));
}

async function initialize(context: CliContext): Promise<Record<string, unknown>> {
  await readSeedManifest(context.seedRoot);
  await mkdir(context.authoringDir, { recursive: true });
  const projectPath = path.join(context.authoringDir, "project.json");
  try {
    await readFile(projectPath, "utf8");
    throw new Error("A project already exists; init never overwrites authoring state.");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const project = createStarterProject(context.game);
  await writeFile(projectPath, `${canonicalizeJson(project)}\n`, "utf8");
  return { operation: "init", authoringDir: context.authoringDir, pages: project.presentation.pages.length };
}

async function validate(context: CliContext): Promise<Record<string, unknown>> {
  const [raw, catalog] = await Promise.all([
    readFile(path.join(context.authoringDir, "project.json"), "utf8"),
    readSeedManifest(context.seedRoot),
  ]);
  const project = validateProjectFile(JSON.parse(raw) as unknown, catalog, context.game);
  const [projectHash, assetCatalogHash] = await Promise.all([
    hashCanonicalJson(project),
    hashCanonicalJson(catalog),
  ]);
  return {
    operation: "validate",
    projectHash,
    assetCatalogHash,
    pages: project.presentation.pages.map((page) => page.stateId),
    componentCount: project.presentation.pages.reduce((total, page) => total + page.instances.length, 0),
  };
}

export async function runCli(argv: readonly string[], dependencies: CliDependencies = {}): Promise<number> {
  try {
    const context = parseContext(argv);
    let result: Record<string, unknown>;
    switch (context.command) {
      case "init":
        result = await initialize(context);
        break;
      case "validate":
        result = await validate(context);
        break;
      case "publish": {
        const publication = await publishAuthoringProject({
          authoringDir: context.authoringDir,
          seedRoot: context.seedRoot,
          expectedProjectJsonHash: context.expectedProjectHash,
          expectedAssetCatalogHash: context.expectedAssetCatalogHash,
          renderPreviews: dependencies.renderPreviews ?? renderPortablePreviews,
        });
        result = { operation: "publish", ...publication };
        break;
      }
      case "preflight":
        result = {
          operation: "preflight",
          ...(await preflightPublication({ ...context, publicationId: context.publicationId! })),
        };
        break;
      case "apply":
        result = {
          operation: "apply",
          ...(await applyPublication({ ...context, publicationId: context.publicationId! })),
        };
        break;
      case "status": {
        const [authoring, application] = await Promise.all([
          publicationStatus(context),
          readSelectedProjection(context),
        ]);
        result = {
          operation: "status",
          status: {
            ...authoring,
            application,
            canApply: authoring.state === "published" && application.state !== "drifted",
          },
        };
        break;
      }
      default:
        throw new Error(`Unsupported command "${context.command}".`);
    }
    emit(dependencies, { ok: true, ...result });
    return 0;
  } catch (error) {
    emit(dependencies, {
      ok: false,
      ...(error instanceof ApplicationError ? { outcome: error.outcome } : {}),
      error: safeError(error),
    });
    return 1;
  }
}
