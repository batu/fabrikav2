import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";

import type { Connect, Plugin } from "vite";

import { MarbleProjectStore, RevisionConflictError, type StorePaths } from "./store.ts";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

type HeaderValues = Record<string, string | string[] | undefined>;

function firstHeader(headers: HeaderValues, name: string): string | undefined {
  const value = headers[name];
  const scalar = Array.isArray(value) ? value[0] : value;
  return scalar?.split(",", 1)[0]?.trim();
}

function expectedOrigin(headers: HeaderValues): string | undefined {
  const host = firstHeader(headers, "x-forwarded-host") ?? firstHeader(headers, "host");
  if (!host || /[\s/@\\]/u.test(host)) return undefined;
  const protocol = firstHeader(headers, "x-forwarded-proto") ?? "http";
  if (protocol !== "http" && protocol !== "https") return undefined;
  return `${protocol}://${host}`;
}

function capabilityMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

export function mutationRequestFailure(headers: HeaderValues, capability: string): string | undefined {
  const origin = firstHeader(headers, "origin");
  const expected = expectedOrigin(headers);
  if (!origin || !expected || origin !== expected) return "Mutation request must come from the same origin as the editor.";
  if (!capabilityMatches(firstHeader(headers, "x-fabrikav2-capability"), capability)) {
    return "Mutation request is missing the active editor session capability.";
  }
  return undefined;
}

export function authoringPaths(repositoryRoot: string): StorePaths {
  const game = path.join(repositoryRoot, "games/marble_run");
  const authoring = path.join(game, "authoring/grapesjs");
  return {
    baseline: path.join(authoring, "baseline/project.json"),
    working: path.join(authoring, "working/project.json"),
    publications: path.join(authoring, "publications"),
    latest: path.join(authoring, "latest.json"),
    manifest: path.join(authoring, "assets-manifest.json"),
    assetRoot: path.join(game, "design/assets"),
    tokens: path.join(game, "design/tokens.css"),
  };
}

async function body(request: Connect.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > 12 * 1024 * 1024) throw new Error("Request body exceeds 12 MiB.");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function responseJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(`${JSON.stringify(value)}\n`);
}

function responseBytes(response: ServerResponse, bytes: Uint8Array | string, extension: string): void {
  response.statusCode = 200;
  response.setHeader("content-type", CONTENT_TYPES[extension] ?? "application/octet-stream");
  response.setHeader("cache-control", "public, max-age=31536000, immutable");
  response.end(bytes);
}

async function staticFile(response: ServerResponse, pathname: string, root: string): Promise<boolean> {
  const decoded = decodeURIComponent(pathname);
  if (!/^[a-zA-Z0-9_./-]+$/u.test(decoded) || decoded.includes("..")) return false;
  const filename = path.resolve(root, decoded);
  if (!filename.startsWith(`${path.resolve(root)}${path.sep}`)) return false;
  try {
    responseBytes(response, await readFile(filename), path.extname(filename));
    return true;
  } catch {
    return false;
  }
}

function expectedRevision(request: Connect.IncomingMessage): string {
  const value = firstHeader(request.headers as HeaderValues, "if-match") ?? "";
  return value.replace(/^"|"$/gu, "");
}

function apiMiddleware(store: MarbleProjectStore, paths: StorePaths, capability: string): Connect.NextHandleFunction {
  return async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://authoring.local");
    try {
      if (request.method === "GET" && url.pathname === "/api/session") {
        responseJson(response, 200, { capability });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/project") {
        responseJson(response, 200, await store.readWorkingState());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/assets") {
        responseJson(response, 200, await store.manifest());
        return;
      }
      if (request.method === "PUT" && url.pathname === "/api/project") {
        const failure = mutationRequestFailure(request.headers as HeaderValues, capability);
        if (failure) throw new AuthorizationError(failure);
        responseJson(response, 200, await store.saveWorking(await body(request), expectedRevision(request)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/reset") {
        const failure = mutationRequestFailure(request.headers as HeaderValues, capability);
        if (failure) throw new AuthorizationError(failure);
        responseJson(response, 200, await store.reset(expectedRevision(request)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/publish") {
        const failure = mutationRequestFailure(request.headers as HeaderValues, capability);
        if (failure) throw new AuthorizationError(failure);
        responseJson(response, 200, await store.publishWorking(expectedRevision(request)));
        return;
      }
      const publicationMatch = url.pathname.match(/^\/api\/publications\/(sha256-[a-f0-9]{64})\/(project|preview-project|tokens\.css)$/u);
      if (request.method === "GET" && publicationMatch) {
        const revision = publicationMatch[1]!;
        const resource = publicationMatch[2]!;
        if (resource === "project") responseJson(response, 200, await store.readPublication(revision));
        else if (resource === "preview-project") responseJson(response, 200, await store.readPublicationPreview(revision));
        else responseBytes(response, await store.readPublicationTokens(revision), ".css");
        return;
      }
      const assetMatch = url.pathname.match(/^\/api\/publications\/(sha256-[a-f0-9]{64})\/assets\/([a-zA-Z0-9_./-]+)$/u);
      if (request.method === "GET" && assetMatch && !assetMatch[2]!.includes("..")) {
        responseBytes(response, await store.readPublicationAsset(assetMatch[1]!, assetMatch[2]!), path.extname(assetMatch[2]!));
        return;
      }
      if (request.method === "GET" && url.pathname.startsWith("/marble-assets/")) {
        if (await staticFile(response, url.pathname.slice("/marble-assets/".length), paths.assetRoot)) return;
      }
      if (request.method === "GET" && url.pathname.startsWith("/marble-design/")) {
        if (await staticFile(response, url.pathname.slice("/marble-design/".length), path.dirname(paths.assetRoot))) return;
      }
      next();
    } catch (error) {
      const status = error instanceof AuthorizationError ? 403 : error instanceof RevisionConflictError ? 409 : 400;
      responseJson(response, status, { error: error instanceof Error ? error.message : "Authoring request failed." });
    }
  };
}

class AuthorizationError extends Error {}

export function marbleAuthoringPlugin(repositoryRoot = path.resolve(import.meta.dirname, "../../..")): Plugin {
  const paths = authoringPaths(repositoryRoot);
  const store = new MarbleProjectStore(paths);
  const capability = randomBytes(32).toString("base64url");
  return {
    name: "fabrikav2-marble-grapes-authoring",
    configureServer(server) {
      server.middlewares.use(apiMiddleware(store, paths, capability));
    },
    configurePreviewServer(server) {
      server.middlewares.use(apiMiddleware(store, paths, capability));
    },
  };
}
