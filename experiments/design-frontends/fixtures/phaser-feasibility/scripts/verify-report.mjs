// Report integrity gate (plan U7): validates report.json against its declared
// schema, checks verdict/evidence semantics, recomputes the evidence manifest,
// and privacy-scans every committed text surface. Deterministic code only.
import { readFileSync, existsSync } from "node:fs";
import { join, relative, resolve, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureRoot, listFiles, sha256File } from "./lib.mjs";
import { buildManifest } from "./hash.mjs";

const VERDICTS = new Set(["pass", "no-go", "blocked"]);
const THREE_STATE = new Set(["supported", "unsupported", "blocked"]);

function matchesType(value, type) {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

export function validateAgainstSchema(value, schema, path = "report") {
  const problems = [];

  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    problems.push(`${path} must equal ${schema.const}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    problems.push(`${path} must be one of ${schema.enum.join(", ")}`);
  }
  if (schema.type && !matchesType(value, schema.type)) {
    problems.push(`${path} must be ${schema.type}`);
    return problems;
  }

  if (schema.type === "object" && matchesType(value, "object")) {
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) problems.push(`missing required field ${path}.${key}`);
    }
    const properties = schema.properties ?? {};
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) {
        problems.push(...validateAgainstSchema(item, properties[key], `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        problems.push(`${path}.${key} is not allowed`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        problems.push(...validateAgainstSchema(item, schema.additionalProperties, `${path}.${key}`));
      }
    }
  }

  if (schema.type === "array" && matchesType(value, "array") && schema.items) {
    value.forEach((item, index) => {
      problems.push(...validateAgainstSchema(item, schema.items, `${path}[${index}]`));
    });
  }

  return problems;
}

export function expectedOverall(entries) {
  if (entries.some((entry) => entry?.verdict === "no-go")) return "no-go";
  if (entries.some((entry) => entry?.verdict === "blocked")) return "blocked";
  if (entries.length > 0 && entries.every((entry) => entry?.verdict === "pass")) return "pass";
  return null;
}

export function validateEvidencePointers(acceptance, manifest, root) {
  const problems = [];
  for (const [name, entry] of Object.entries(acceptance ?? {})) {
    const evidence = Array.isArray(entry?.evidence) ? entry.evidence : [];
    if (evidence.length === 0) problems.push(`acceptance.${name}: verdict without evidence pointer`);
    for (const pointer of evidence) {
      if (typeof pointer !== "string") continue;
      const absolute = resolve(root, pointer);
      const rel = relative(root, absolute);
      if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        problems.push(`acceptance.${name}: evidence pointer escapes fixture: ${pointer}`);
        continue;
      }
      if (!existsSync(absolute)) {
        problems.push(`acceptance.${name}: evidence pointer does not resolve: ${pointer}`);
        continue;
      }
      if (!Object.hasOwn(manifest, pointer)) {
        problems.push(`acceptance.${name}: evidence pointer is not hash-bound: ${pointer}`);
      }
    }
  }
  return problems;
}

export function validateOfflineEvidence(record, transcript) {
  const problems = [];
  const network = record?.environment?.network ?? "";
  if (!/RestrictAddressFamilies=AF_UNIX/.test(network)) {
    problems.push("offline evidence does not record a network-blocked verification run");
  }
  if (record?.source?.cleanCheckout !== true || !/^[0-9a-f]{8,40}$/.test(record?.source?.commit ?? "")) {
    problems.push("offline evidence is not bound to a clean committed checkout");
  }
  if (record?.environment?.editorInstalled !== false) {
    problems.push("offline evidence does not prove Phaser Editor was absent");
  }
  if (!/^pass/i.test(record?.results?.build ?? "")) {
    problems.push("offline evidence does not record a passing runtime build");
  }
  if (!/^pass/i.test(record?.results?.unitTests ?? "")) {
    problems.push("offline evidence does not record passing unit tests");
  }
  if (!/7\/7 steps PASS/i.test(record?.results?.finalRun ?? "")) {
    problems.push("offline evidence does not record a passing final full verify");
  }
  for (const fact of [
    `[offline] commit=${record?.source?.commit}`,
    "[offline] clean_sparse_checkout=yes",
    "[offline] phaser_editor_present=no",
    "[offline] network_probe=blocked_by_AF_UNIX_only",
  ]) {
    if (!transcript.includes(fact)) problems.push(`offline transcript missing provenance fact: ${fact}`);
  }
  if (!/\[verify\]\s+7 steps: 7 pass, 0 fail, 0 blocked/.test(transcript)) {
    problems.push("offline transcript does not contain a zero-failure full verify summary");
  }
  return problems;
}

const PRIVACY_PATTERNS = [
  [/(^|["'\s(=:])\/Users\/[a-z0-9_-]+/im, "home path"],
  [/(^|["'\s(=:])\/home\/[a-z0-9_-]+\//im, "home path"],
  [/Bearer\s+[A-Za-z0-9._-]{10,}/, "bearer token"],
  [/(?:api[_-]?key|apikey)["']?\s*[:=]/i, "api key"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/, "github token"],
  [/AKIA[0-9A-Z]{16}/, "aws key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, "email address"],
];

export function privacyProblems(text, label) {
  const problems = [];
  for (const [pattern, kind] of PRIVACY_PATTERNS) {
    if (pattern.test(text)) problems.push(`privacy: ${kind} in ${label}`);
  }
  return problems;
}

export function validateLiveCopyEvidence(root) {
  const problems = [];
  let base;
  let plugin;
  try {
    const readResult = (name) =>
      JSON.parse(readFileSync(join(root, "evidence", "sessions", `${name}-result.json`), "utf8"));
    base = readResult("live-typing");
    plugin = readResult("live-typing-plugin");
  } catch (error) {
    return [`live-copy evidence unreadable: ${error.message}`];
  }

  for (const result of [base, plugin]) {
    for (const shot of result.shots ?? []) {
      const path = join(root, "evidence", "sessions", "shots", `${shot.name}.png`);
      if (!existsSync(path) || sha256File(path) !== shot.hash) {
        problems.push(`live-copy evidence hash mismatch: ${shot.name}`);
      }
    }
  }

  const baseKeys = (base.shots ?? []).slice(0, 4).map((shot) => shot.hash);
  const baseCommit = base.shots?.at(-1)?.hash;
  if (
    base.changedPerKeystroke !== false ||
    baseKeys.length !== 4 ||
    new Set(baseKeys).size !== 1 ||
    base.changedOnCommit !== true ||
    baseCommit === baseKeys[0]
  ) {
    problems.push("base live-copy evidence does not prove commit-only behavior");
  }
  const pluginKeys = (plugin.shots ?? []).slice(0, 4).map((shot) => shot.hash);
  const pluginCommit = plugin.shots?.at(-1)?.hash;
  if (
    plugin.changedPerKeystroke !== true ||
    pluginKeys.length !== 4 ||
    new Set(pluginKeys).size !== pluginKeys.length ||
    plugin.changedOnCommit !== false ||
    pluginCommit !== pluginKeys.at(-1)
  ) {
    problems.push("plugin live-copy evidence does not prove per-keystroke behavior");
  }
  return problems;
}

export function validateReport() {
  const problems = [];
  const reportPath = join(fixtureRoot, "report", "report.json");
  const schemaPath = join(fixtureRoot, "report", "report.schema.json");
  const hashesPath = join(fixtureRoot, "report", "hashes.json");
  for (const path of [reportPath, schemaPath, hashesPath]) {
    if (!existsSync(path)) return [`missing ${path}`];
  }

  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  problems.push(...validateAgainstSchema(report, schema));
  const generated = Date.parse(report.generated);
  if (!Number.isFinite(generated) || generated > Date.now() + 300_000) {
    problems.push("report.generated must be a valid finalization time, not a future timestamp");
  }

  for (const [name, entry] of Object.entries(report.acceptance ?? {})) {
    if (!VERDICTS.has(entry?.verdict)) problems.push(`acceptance.${name}: invalid verdict '${entry?.verdict}'`);
    if (entry?.verdict === "blocked" && !entry.blockedOn) problems.push(`acceptance.${name}: blocked without blockedOn`);
    if (entry?.verdict === "no-go" && !entry.failedProperty) problems.push(`acceptance.${name}: no-go without failedProperty`);
  }
  const aggregate = expectedOverall(Object.values(report.acceptance ?? {}));
  if (aggregate && report.overall !== aggregate) {
    problems.push(`overall '${report.overall}' does not match acceptance aggregate '${aggregate}'`);
  }

  for (const command of ["validate", "publish", "preflight", "apply", "status", "proof"]) {
    const verdict = report.feasibility?.command_surface?.[command];
    if (!verdict) problems.push(`feasibility.command_surface.${command} missing`);
    else if (!THREE_STATE.has(verdict.verdict)) {
      problems.push(`feasibility.command_surface.${command}: invalid verdict '${verdict.verdict}'`);
    }
  }

  const hashes = JSON.parse(readFileSync(hashesPath, "utf8"));
  const current = buildManifest();
  const recorded = hashes.files ?? {};
  for (const [file, hash] of Object.entries(recorded)) {
    if (current[file] !== hash) problems.push(`hash mismatch: ${file}`);
  }
  for (const file of Object.keys(current)) {
    if (!Object.hasOwn(recorded, file)) problems.push(`file not covered by hashes.json: ${file}`);
  }
  problems.push(...validateEvidencePointers(report.acceptance, current, fixtureRoot));

  if (report.acceptance?.["offline-runtime-build"]?.verdict === "pass") {
    const record = JSON.parse(
      readFileSync(join(fixtureRoot, "evidence", "offline-build", "offline-build.json"), "utf8")
    );
    if (typeof record.transcript !== "string" || !existsSync(join(fixtureRoot, record.transcript))) {
      problems.push("offline evidence transcript pointer does not resolve");
    } else {
      const transcript = readFileSync(join(fixtureRoot, record.transcript), "utf8");
      problems.push(...validateOfflineEvidence(record, transcript));
    }
  }
  if (report.acceptance?.["live-copy-preview"]?.verdict === "pass") {
    problems.push(...validateLiveCopyEvidence(fixtureRoot));
  }

  const textExtensions = /\.(?:components|css|html|js|json|md|mjs|scene|ts|txt)$/;
  for (const file of listFiles(fixtureRoot, {
    skipDirs: new Set([".git", "android", "dist", "node_modules"]),
  })) {
    if (!textExtensions.test(file)) continue;
    const label = relative(fixtureRoot, file);
    problems.push(...privacyProblems(readFileSync(file, "utf8"), label));
  }

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = validateReport();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[report] ${problem}`);
    process.exit(1);
  }
  console.log("[report] report.json schema-valid, evidence resolves, hashes match, privacy scan clean");
}
