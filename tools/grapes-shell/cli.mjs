#!/usr/bin/env node
import { createServer } from "vite";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));
const server = await createServer({
  root: workspaceRoot,
  configFile: path.join(workspaceRoot, "vite.config.ts"),
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true },
});

try {
  const { runCli } = await server.ssrLoadModule("/src/shared/cli.ts");
  process.exitCode = await runCli(process.argv.slice(2));
} finally {
  await server.close();
}
