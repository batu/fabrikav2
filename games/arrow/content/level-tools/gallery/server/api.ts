// Gallery backend. Reads level yamls + catalogue, writes archives, shells out to icon2level.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import YAML from "yaml";

// Serialize a level yaml in the format expected by content/level-tools/levels-gen.mjs:
// top-level keys as block YAML, `arrows` as a single-line JSON array,
// `opts` and `meta` as nested block maps. Matches the authoring style in
// content/levels/<pack>/*.yaml.
function dumpLevelYaml(d: Record<string, unknown>): string {
  const lines: string[] = [];
  const pushScalar = (k: string, v: unknown): void => { if (v != null) lines.push(`${k}: ${v}`); };
  pushScalar("schemaVersion", d.schemaVersion);
  pushScalar("cols", d.cols);
  pushScalar("rows", d.rows);
  pushScalar("arrowCount", d.arrowCount);
  if (d.arrows) lines.push("arrows: " + JSON.stringify(d.arrows));
  if (d.opts) {
    lines.push("opts:");
    for (const [k, v] of Object.entries(d.opts as Record<string, unknown>)) lines.push(`  ${k}: ${v}`);
  }
  pushScalar("seed", d.seed);
  pushScalar("seedSweep", d.seedSweep);
  pushScalar("transform", d.transform);
  pushScalar("solverCheck", d.solverCheck);
  if (d.meta) {
    lines.push("meta:");
    for (const [k, v] of Object.entries(d.meta as Record<string, unknown>)) lines.push(`  ${k}: ${v}`);
  }
  return lines.join("\n") + "\n";
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARROW_ROOT = resolve(__dirname, "..", "..", "..", "..");
const LEVELS_DIR = join(ARROW_ROOT, "content/levels");
const CATALOGUE = join(LEVELS_DIR, "catalogue.json");
const ICONS_YAML = join(ARROW_ROOT, "content/level-tools", "icon2level", "icons.yaml");
const ICON2LEVEL_DIR = join(ARROW_ROOT, "content/level-tools", "icon2level");
const DRAFTS_DIR = join(LEVELS_DIR, "drafts");
const RESOLVER_SCRIPT = join(__dirname, "resolve-levels.mts");

// Precompute every level's resolved arrows via a tsx subprocess that imports
// the game's runtime level registry. Cached in-memory for the server's
// lifetime; the gallery dev server is short-lived so no invalidation needed.
let resolvedArrowsCache: Map<string, Array<Array<[number, number]>>> | null = null;
async function loadResolvedArrows(): Promise<Map<string, Array<Array<[number, number]>>>> {
  if (resolvedArrowsCache) return resolvedArrowsCache;
  const json = await new Promise<string>((resolve, reject) => {
    const p = spawn("npx", ["tsx", RESOLVER_SCRIPT], { cwd: ARROW_ROOT });
    let out = "", err = "";
    p.stdout.on("data", d => { out += d; });
    p.stderr.on("data", d => { err += d; });
    p.on("close", code => code === 0 ? resolve(out) : reject(new Error(`resolve-levels exit ${code}: ${err}`)));
  });
  const obj = JSON.parse(json) as Record<string, Array<Array<[number, number]>>>;
  resolvedArrowsCache = new Map(Object.entries(obj));
  return resolvedArrowsCache;
}

type Json = unknown;

function json(res: ServerResponse, status: number, body: Json): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// Scan content/levels/<pack>/*.yaml and return them grouped by pack in file-sort order.
function scanPacks(): Array<{ pack: string; files: Array<{ file: string; data: any }> }> {
  const out: Array<{ pack: string; files: Array<{ file: string; data: any }> }> = [];
  for (const entry of readdirSync(LEVELS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "drafts") continue;
    const packDir = join(LEVELS_DIR, entry.name);
    const yamls = readdirSync(packDir).filter(f => f.endsWith(".yaml")).sort();
    const files = yamls.map(f => ({
      file: f,
      data: YAML.parse(readFileSync(join(packDir, f), "utf8")),
    }));
    if (files.length) out.push({ pack: entry.name, files });
  }
  return out;
}

function readCatalogue(): any {
  if (!existsSync(CATALOGUE)) return { schemaVersion: 1, levels: [] };
  return JSON.parse(readFileSync(CATALOGUE, "utf8"));
}

function readIcons(): any {
  return YAML.parse(readFileSync(ICONS_YAML, "utf8"));
}

// Resolve the yaml filename for a (pack, indexInPack) by scanning the pack dir.
function findYamlFile(pack: string, indexInPack: number): string | null {
  const packDir = join(LEVELS_DIR, pack);
  if (!existsSync(packDir)) return null;
  for (const f of readdirSync(packDir)) {
    if (!f.endsWith(".yaml")) continue;
    const data = YAML.parse(readFileSync(join(packDir, f), "utf8"));
    if (data?.meta?.indexInPack === indexInPack) return f;
  }
  return null;
}

function renumberPack(pack: string, newOrder: string[]): void {
  // newOrder is filename list in desired play order. Rewrite meta.indexInPack
  // and rename files so filename prefix matches play order. Done atomically:
  // (1) read+parse every source up-front, (2) delete all sources, (3) write
  // all destinations. This way a mid-loop crash can't leave orphan tmp files
  // that poison the next reorder.
  const packDir = join(LEVELS_DIR, pack);
  const loaded = newOrder.map((oldName, i) => {
    const newIndex = i + 1;
    const stem = oldName.replace(/^\d{2}-/, "").replace(/\.yaml$/, "");
    const finalName = `${String(newIndex).padStart(2, "0")}-${stem}.yaml`;
    const data = YAML.parse(readFileSync(join(packDir, oldName), "utf8"));
    if (data.meta) data.meta.indexInPack = newIndex;
    return { oldName, finalName, data };
  });
  for (const { oldName } of loaded) unlinkSync(join(packDir, oldName));
  for (const { finalName, data } of loaded) writeFileSync(join(packDir, finalName), dumpLevelYaml(data));
}

function runLevelsGen(): Promise<{ code: number; out: string }> {
  return new Promise(r => {
    const p = spawn("node", ["content/level-tools/levels-gen.mjs"], { cwd: ARROW_ROOT });
    let out = "";
    p.stdout.on("data", d => { out += d; });
    p.stderr.on("data", d => { out += d; });
    p.on("close", code => r({ code: code ?? 1, out }));
  });
}

// Generator args for the new skeleton+fill pipeline. Mirrors Hyperparams
// fields exposed in content/level-tools/icon2level/src/icon2level/schema.py; anything
// not passed uses the Python default (matches icons.yaml conventions).
interface GenerateArgs {
  emoji: string;
  grid: [number, number];
  pack: string;
  indexInPack: number;
  title?: string;
  seed?: number;
  outPath: string;
  minCells?: number;
  minFeatureWidth?: number;
  maxArrowLength?: number;
  branchingThreshold?: number;
  stage?: "preview" | "save";
  skeletonMethod?: "zhang" | "lee" | "medial";
  orientationSigma?: number;
  coherenceThreshold?: number;
}

function buildShim(args: GenerateArgs): string {
  // Python shim: emits NDJSON progress lines on stdout so the SSE layer
  // can stream stage-by-stage feedback back to the browser. The final
  // line carries the full LevelSpec + verified flag.
  return `
import json, sys, time
sys.stdout.reconfigure(line_buffering=True)

def emit(**kw):
    sys.stdout.write(json.dumps(kw) + "\\n")
    sys.stdout.flush()

t0 = time.monotonic()
def elapsed():
    return int((time.monotonic() - t0) * 1000)

emit(stage="start", elapsed_ms=elapsed())
from pathlib import Path
from icon2level.pipeline import generate_one, _atomic_write, _dump_yaml
from icon2level.schema import Hyperparams, IconSpec
emit(stage="import_done", elapsed_ms=elapsed())

hp = Hyperparams(
    grid=(${args.grid[0]}, ${args.grid[1]}),
    min_cells=${args.minCells ?? 6},
    min_feature_width=${args.minFeatureWidth ?? 2},
    seed=${args.seed ?? 0},
    max_arrow_length=${args.maxArrowLength ?? 20},
    branching_threshold=${args.branchingThreshold ?? 2.5},
    stage=${JSON.stringify(args.stage ?? "preview")},
    skeleton_method=${JSON.stringify(args.skeletonMethod ?? "zhang")},
    orientation_sigma=${args.orientationSigma ?? 2.0},
    coherence_threshold=${args.coherenceThreshold ?? 0.1},
)
icon = IconSpec(
    emoji=${JSON.stringify(args.emoji)},
    pack=${JSON.stringify(args.pack)},
    index_in_pack=${args.indexInPack},
    title=${args.title ? JSON.stringify(args.title) : "None"},
)
emit(stage="pipeline_start", elapsed_ms=elapsed())
level = generate_one(icon, hp)
emit(stage="pipeline_done", elapsed_ms=elapsed(), arrow_count=len(level["arrows"]))
_atomic_write(Path(${JSON.stringify(args.outPath)}), _dump_yaml(level))
emit(stage="written", elapsed_ms=elapsed(), out=${JSON.stringify(args.outPath)})
emit(stage="result", elapsed_ms=elapsed(), level=level)
`;
}

function runIcon2Level(args: GenerateArgs): Promise<{ code: number; out: string }> {
  // Non-streaming fallback: collect stdout, parse the final "result" line.
  const py = buildShim(args);
  return new Promise(r => {
    const p = spawn("uv", ["run", "python", "-u", "-c", py], {
      cwd: ICON2LEVEL_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let out = "";
    p.stdout.on("data", d => { out += d; });
    p.stderr.on("data", d => { out += d; });
    p.on("close", code => r({ code: code ?? 1, out }));
  });
}

// Spawn the python shim and pipe NDJSON progress lines to the SSE response.
// Each stdout line from python becomes one SSE `data: ...` event; stderr
// becomes `event: stderr` lines. The final `event: done` sentinel carries
// the process exit code so the client can distinguish clean exit from crash.
function streamIcon2Level(
  args: GenerateArgs,
  res: ServerResponse,
): void {
  const py = buildShim(args);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // X-Accel-Buffering: no is required so cloudflared tunnels don't
  // buffer the SSE stream — otherwise the UI gets all events at once
  // after the subprocess exits, defeating the purpose.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const p = spawn("uv", ["run", "python", "-u", "-c", py], {
    cwd: ICON2LEVEL_DIR,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });

  let stdoutBuf = "";
  p.stdout.on("data", chunk => {
    stdoutBuf += chunk.toString("utf8");
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) res.write(`data: ${line}\n\n`);
    }
  });
  let stderrBuf = "";
  p.stderr.on("data", chunk => {
    stderrBuf += chunk.toString("utf8");
    // Forward stderr as `event: stderr` so the client can surface it in
    // a log panel without mixing it into the main `data:` channel.
    res.write(`event: stderr\ndata: ${JSON.stringify(chunk.toString("utf8"))}\n\n`);
  });
  p.on("close", code => {
    if (stdoutBuf.trim()) res.write(`data: ${stdoutBuf}\n\n`);
    res.write(`event: done\ndata: ${JSON.stringify({ code: code ?? 1, stderr: stderrBuf.slice(-2000) })}\n\n`);
    res.end();
  });
  // Kill the subprocess if the client disconnects mid-stream so we
  // don't leak python processes on a browser reload.
  res.on("close", () => {
    if (!p.killed) p.kill("SIGTERM");
  });
}

export function createApi() {
  return {
    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const url = new URL(req.url ?? "/", "http://x");
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (method === "GET" && path === "/catalogue") {
        const packs = scanPacks();
        const resolved = await loadResolvedArrows();
        for (const p of packs) {
          for (const f of p.files) {
            const key = `${p.pack}/${f.data?.meta?.indexInPack}`;
            const r = resolved.get(key);
            if (r) f.data.arrows = r;
          }
        }
        const catalogue = readCatalogue();
        return json(res, 200, { packs, catalogue });
      }
      if (method === "GET" && path === "/icons") {
        return json(res, 200, readIcons());
      }
      if (method === "POST" && path === "/archive") {
        const body = JSON.parse(await readBody(req));
        const { pack, file } = body as { pack: string; file: string };
        const src = join(LEVELS_DIR, pack, file);
        if (!existsSync(src)) return json(res, 404, { error: "not found" });
        const destDir = join(DRAFTS_DIR, pack);
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        const dest = join(destDir, file);
        renameSync(src, dest);
        // Renumber surviving files in pack.
        const remaining = readdirSync(join(LEVELS_DIR, pack)).filter(f => f.endsWith(".yaml")).sort();
        renumberPack(pack, remaining);
        const genResult = await runLevelsGen();
        resolvedArrowsCache = null;
        return json(res, 200, { ok: true, archived: dest, gen: genResult });
      }
      if (method === "POST" && path === "/reorder-global") {
        // All levels live in a single flat pack ("all") now; reorder is
        // just renumberPack on that single pack. Accepts [{pack,file}] for
        // forward-compatibility with a multi-pack future.
        const body = JSON.parse(await readBody(req));
        const order = (body.order as Array<{ pack: string; file: string }>).map(x => x.file);
        renumberPack("all", order);
        const genResult = await runLevelsGen();
        resolvedArrowsCache = null;
        return json(res, 200, { ok: true, gen: genResult });
      }
      if (method === "POST" && path === "/reorder") {
        const body = JSON.parse(await readBody(req));
        const { pack, order } = body as { pack: string; order: string[] };
        renumberPack(pack, order);
        const genResult = await runLevelsGen();
        resolvedArrowsCache = null;
        return json(res, 200, { ok: true, gen: genResult });
      }
      if (method === "POST" && path === "/generate") {
        const body = JSON.parse(await readBody(req));
        const { emoji, title, pack, indexInPack, grid, seed,
                minCells, minFeatureWidth, maxArrowLength, branchingThreshold,
                stage, skeletonMethod, orientationSigma, coherenceThreshold,
                save } = body;
        const packDir = join(LEVELS_DIR, pack);
        if (save && !existsSync(packDir)) mkdirSync(packDir, { recursive: true });
        const stem = (title ?? "icon").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const fname = `${String(indexInPack).padStart(2, "0")}-${stem}.yaml`;
        const tmpPath = save ? join(packDir, fname) : join(ARROW_ROOT, "tmp", `gallery-${Date.now()}.yaml`);
        if (!save && !existsSync(dirname(tmpPath))) mkdirSync(dirname(tmpPath), { recursive: true });
        const result = await runIcon2Level({
          emoji, title, pack, indexInPack,
          grid: grid as [number, number], seed,
          minCells, minFeatureWidth,
          maxArrowLength, branchingThreshold,
          stage: stage ?? (save ? "save" : "preview"),
          skeletonMethod, orientationSigma, coherenceThreshold,
          outPath: tmpPath,
        });
        if (result.code !== 0) return json(res, 500, { error: "icon2level failed", stderr: result.out });
        const levelData = YAML.parse(readFileSync(tmpPath, "utf8"));
        let genResult = null;
        if (save) { genResult = await runLevelsGen(); resolvedArrowsCache = null; }
        return json(res, 200, {
          level: levelData,
          file: save ? fname : null,
          saved: !!save,
          gen: genResult,
          stderr: result.out,
        });
      }
      if (method === "POST" && path === "/generate-stream") {
        // SSE variant: streams python subprocess stdout lines live so the
        // UI can show per-stage progress ("skeleton", "fill", "verify")
        // plus elapsed times. Final `data:` line has `stage=result` and
        // contains the full LevelSpec dict. `event: done` sentinel fires
        // on subprocess exit.
        const body = JSON.parse(await readBody(req));
        const { emoji, title, pack, indexInPack, grid, seed,
                minCells, minFeatureWidth, maxArrowLength, branchingThreshold,
                stage, skeletonMethod, orientationSigma, coherenceThreshold,
                save } = body;
        const packDir = join(LEVELS_DIR, pack);
        if (save && !existsSync(packDir)) mkdirSync(packDir, { recursive: true });
        const stem = (title ?? "icon").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const fname = `${String(indexInPack).padStart(2, "0")}-${stem}.yaml`;
        const tmpPath = save ? join(packDir, fname) : join(ARROW_ROOT, "tmp", `gallery-${Date.now()}.yaml`);
        if (!save && !existsSync(dirname(tmpPath))) mkdirSync(dirname(tmpPath), { recursive: true });
        streamIcon2Level({
          emoji, title, pack, indexInPack,
          grid: grid as [number, number], seed,
          minCells, minFeatureWidth,
          maxArrowLength, branchingThreshold,
          stage: stage ?? (save ? "save" : "preview"),
          skeletonMethod, orientationSigma, coherenceThreshold,
          outPath: tmpPath,
        }, res);
        // streamIcon2Level terminates the response itself; return void.
        return;
      }
      return json(res, 404, { error: `unknown route ${method} ${path}` });
    },
  };
}
