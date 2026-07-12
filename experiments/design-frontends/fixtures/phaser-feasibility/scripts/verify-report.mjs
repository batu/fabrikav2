// Report integrity gate (plan U7): schema-validates report.json, resolves
// every evidence pointer, recomputes the hashes.json manifest, and privacy-
// scans all text artifacts. Deterministic code — no LLM, no network.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureRoot, listFiles } from "./lib.mjs";
import { buildManifest } from "./hash.mjs";

const VERDICTS = new Set(["pass", "no-go", "blocked"]);
const THREE_STATE = new Set(["supported", "unsupported", "blocked"]);

export function validateReport() {
  const problems = [];
  const reportPath = join(fixtureRoot, "report", "report.json");
  const schemaPath = join(fixtureRoot, "report", "report.schema.json");
  const hashesPath = join(fixtureRoot, "report", "hashes.json");
  for (const p of [reportPath, schemaPath, hashesPath]) {
    if (!existsSync(p)) return [`missing ${p}`];
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

  // structural validation against the schema's required tree (subset checker:
  // required keys + verdict enums are what the machine contract relies on)
  const requireKeys = (obj, required, path) => {
    for (const key of required) {
      if (obj?.[key] === undefined) problems.push(`missing required field ${path}.${key}`);
    }
  };
  requireKeys(report, schema.required, "report");
  requireKeys(report.acceptance ?? {}, schema.properties.acceptance.required, "acceptance");
  requireKeys(report.feasibility ?? {}, schema.properties.feasibility.required, "feasibility");
  requireKeys(report.ledger ?? {}, schema.properties.ledger.required, "ledger");
  requireKeys(report.dependencies ?? {}, schema.properties.dependencies.required, "dependencies");

  // every acceptance criterion: three-state verdict + resolvable evidence
  for (const [name, entry] of Object.entries(report.acceptance ?? {})) {
    if (!VERDICTS.has(entry.verdict)) problems.push(`acceptance.${name}: invalid verdict '${entry.verdict}'`);
    if (entry.verdict === "blocked" && !entry.blockedOn) problems.push(`acceptance.${name}: blocked without blockedOn`);
    if (entry.verdict === "no-go" && !entry.failedProperty) problems.push(`acceptance.${name}: no-go without failedProperty`);
    const evidence = entry.evidence ?? [];
    if (entry.verdict === "pass" && evidence.length === 0) problems.push(`acceptance.${name}: pass without evidence pointer`);
    for (const ev of evidence) {
      if (!existsSync(join(fixtureRoot, ev))) problems.push(`acceptance.${name}: evidence pointer does not resolve: ${ev}`);
    }
  }

  // R14a command-surface verdicts: three-state per shared lane command
  for (const cmd of ["validate", "publish", "preflight", "apply", "status", "proof"]) {
    const v = report.feasibility?.command_surface?.[cmd];
    if (!v) problems.push(`feasibility.command_surface.${cmd} missing`);
    else if (!THREE_STATE.has(v.verdict)) problems.push(`feasibility.command_surface.${cmd}: invalid verdict '${v.verdict}'`);
  }

  // hashes.json binds evidence to committed bytes
  const hashes = JSON.parse(readFileSync(hashesPath, "utf8"));
  const current = buildManifest();
  const recorded = hashes.files ?? {};
  for (const [file, hash] of Object.entries(recorded)) {
    if (current[file] !== hash) problems.push(`hash mismatch: ${file}`);
  }
  for (const file of Object.keys(current)) {
    if (!(file in recorded)) problems.push(`file not covered by hashes.json: ${file}`);
  }

  // privacy scan over all text artifacts (R13)
  const PRIVACY = [
    // absolute home paths only: require a boundary before the leading slash so
    // repo-relative segments like "ui/home/..." don't false-positive
    [/(^|["'\s(=:])\/Users\/[a-z0-9_-]+/im, "home path"],
    [/(^|["'\s(=:])\/home\/[a-z0-9_-]+\//im, "home path"],
    [/Bearer\s+[A-Za-z0-9._-]{10,}/, "bearer token"],
    [/(?:api[_-]?key|apikey)["']?\s*[:=]/i, "api key"],
    [/gh[pousr]_[A-Za-z0-9]{20,}/, "github token"],
    [/AKIA[0-9A-Z]{16}/, "aws key"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
    [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, "email address"],
  ];
  const scanDirs = ["report", "evidence", "catalog"];
  for (const dir of scanDirs) {
    for (const f of listFiles(join(fixtureRoot, dir))) {
      if (!/\.(json|md|txt)$/.test(f)) continue;
      const text = readFileSync(f, "utf8");
      for (const [pattern, kind] of PRIVACY) {
        if (pattern.test(text)) problems.push(`privacy: ${kind} in ${f.slice(fixtureRoot.length + 1)}`);
      }
    }
  }

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = validateReport();
  if (problems.length > 0) {
    for (const p of problems) console.error(`[report] ${p}`);
    process.exit(1);
  }
  console.log("[report] report.json schema-valid, evidence resolves, hashes match, privacy scan clean");
}
