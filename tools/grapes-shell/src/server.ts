import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import path from "node:path";

import type { Connect, Plugin } from "vite";

import { MarbleProjectStore, type StorePaths } from "./store.ts";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

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

async function staticFile(response: ServerResponse, pathname: string, root: string): Promise<boolean> {
  const decoded = decodeURIComponent(pathname);
  if (!/^[a-zA-Z0-9_./-]+$/u.test(decoded) || decoded.includes("..")) return false;
  const filename = path.resolve(root, decoded);
  if (!filename.startsWith(`${path.resolve(root)}${path.sep}`)) return false;
  try {
    const bytes = await readFile(filename);
    response.statusCode = 200;
    response.setHeader("content-type", CONTENT_TYPES[path.extname(filename)] ?? "application/octet-stream");
    response.setHeader("cache-control", "public, max-age=31536000, immutable");
    response.end(bytes);
    return true;
  } catch {
    return false;
  }
}

function apiMiddleware(store: MarbleProjectStore, paths: StorePaths): Connect.NextHandleFunction {
  return async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://authoring.local");
    try {
      if (request.method === "GET" && url.pathname === "/api/project") {
        responseJson(response, 200, await store.readWorking());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/assets") {
        responseJson(response, 200, await store.manifest());
        return;
      }
      if (request.method === "PUT" && url.pathname === "/api/project") {
        responseJson(response, 200, await store.saveWorking(await body(request)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/reset") {
        responseJson(response, 200, await store.reset());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/publish") {
        responseJson(response, 200, await store.publish(await body(request)));
        return;
      }
      const publicationMatch = url.pathname.match(/^\/api\/publications\/(sha256-[a-f0-9]{64})\/project$/u);
      if (request.method === "GET" && publicationMatch) {
        responseJson(response, 200, await store.readPublication(publicationMatch[1]!));
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
      responseJson(response, 400, { error: error instanceof Error ? error.message : "Authoring request failed." });
    }
  };
}

export function marbleAuthoringPlugin(repositoryRoot = path.resolve(import.meta.dirname, "../../..")): Plugin {
  const paths = authoringPaths(repositoryRoot);
  const store = new MarbleProjectStore(paths);
  return {
    name: "fabrikav2-marble-grapes-authoring",
    configureServer(server) {
      server.middlewares.use(apiMiddleware(store, paths));
    },
    configurePreviewServer(server) {
      server.middlewares.use(apiMiddleware(store, paths));
    },
  };
}
