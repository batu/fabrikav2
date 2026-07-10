import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const approvedSourceRootValue = process.env.KENNEY_APPROVED_SOURCE_ROOT;
if (!approvedSourceRootValue) {
  throw new Error(
    "KENNEY_APPROVED_SOURCE_ROOT must point to the approved asset library root",
  );
}

const dirname = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.resolve(dirname, "../..");
const approvedSourceRoot = path.resolve(approvedSourceRootValue);
const manifest = JSON.parse(
  fs.readFileSync(path.join(templateRoot, "design/kenney-seed.manifest.json"), "utf8"),
);

function resolveWithin(root, ...segments) {
  const resolved = path.resolve(root, ...segments);
  const relative = path.relative(root, resolved);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return resolved;
  }
  throw new Error(`Manifest path escapes its configured root: ${segments.join("/")}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function dimensions(bytes) {
  const pngSignature = "89504e470d0a1a0a";
  if (bytes.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error("Expected PNG bytes");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const sources = new Map(manifest.sources.map((source) => [source.id, source]));
const failures = [];

for (const asset of manifest.assets) {
  const source = sources.get(asset.source.pack);
  if (!source) {
    failures.push(`${asset.id}: unknown source pack ${asset.source.pack}`);
    continue;
  }

  const sourceFile = resolveWithin(
    approvedSourceRoot,
    source.approvedSourcePath,
    asset.source.path,
  );
  const targetFile = resolveWithin(templateRoot, "design", asset.file);
  if (!fs.existsSync(sourceFile)) {
    failures.push(`${asset.id}: approved source file is missing`);
    continue;
  }
  if (!fs.existsSync(targetFile)) {
    failures.push(`${asset.id}: committed semantic fixture is missing`);
    continue;
  }

  const sourceBytes = fs.readFileSync(sourceFile);
  const targetBytes = fs.readFileSync(targetFile);
  const sourceHash = sha256(sourceBytes);
  const targetHash = sha256(targetBytes);
  const sourceDimensions = dimensions(sourceBytes);

  if (!sourceBytes.equals(targetBytes)) {
    failures.push(`${asset.id}: committed bytes differ from the approved source`);
  }
  if (asset.sha256 !== sourceHash || asset.sha256 !== targetHash) {
    failures.push(`${asset.id}: manifest hash does not match approved and committed bytes`);
  }
  if (
    asset.dimensions.width !== sourceDimensions.width ||
    asset.dimensions.height !== sourceDimensions.height
  ) {
    failures.push(`${asset.id}: manifest dimensions do not match the approved source`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  throw new Error(`Kenney source audit failed with ${failures.length} issue(s)`);
}

console.log(
  `Kenney source audit passed: ${manifest.assets.length} semantic fixtures match approved source bytes`,
);
