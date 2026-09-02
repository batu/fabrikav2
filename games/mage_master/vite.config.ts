import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { baseViteConfig } from "../../configs/vite.base.ts";

/**
 * Dev-only remote drive channel for on-device iteration (see src/shell/devDrive.ts).
 * GET  /__drive.json        → .work/drive.json (the agent writes commands here)
 * POST /__drive/result      → .work/drive-result.json
 * POST /__drive/frames      → .work/frames/<seq>-<i>.png (canvas frame bursts)
 */
function devDrivePlugin(): Plugin {
  const work = join(process.cwd(), ".work");
  return {
    name: "mage-master-dev-drive",
    apply: "serve",
    configureServer(server) {
      mkdirSync(join(work, "frames"), { recursive: true });
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (req.method === "GET" && url.startsWith("/__drive.json")) {
          const file = join(work, "drive.json");
          res.setHeader("content-type", "application/json");
          res.setHeader("cache-control", "no-store");
          res.end(existsSync(file) ? readFileSync(file, "utf8") : '{"seq":-1,"op":"snapshot"}');
          return;
        }
        if (req.method === "POST" && url.startsWith("/__drive/")) {
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            if (url.startsWith("/__drive/frames")) {
              try {
                const parsed = JSON.parse(body) as { seq: number; frames: string[] };
                parsed.frames.forEach((frame, i) => {
                  const data = frame.replace(/^data:image\/png;base64,/, "");
                  writeFileSync(join(work, "frames", `${parsed.seq}-${String(i).padStart(2, "0")}.png`), Buffer.from(data, "base64"));
                });
                writeFileSync(join(work, "frames", `${parsed.seq}.done`), String(parsed.frames.length));
              } catch {
                // ignore malformed frame posts
              }
            } else {
              writeFileSync(join(work, "drive-result.json"), body);
            }
            res.statusCode = 204;
            res.end();
          });
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(
  baseViteConfig({
    server: { port: 5199, host: true },
    plugins: [devDrivePlugin()],
    build: { chunkSizeWarningLimit: 2000, assetsInlineLimit: 0 },
  }),
);
