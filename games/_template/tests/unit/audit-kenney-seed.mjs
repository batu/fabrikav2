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
const fontFixtures = [
  {
    id: "font.future",
    sourcePack: "kenney-ui-pack-2.0",
    sourcePath: "Font/Kenney Future.ttf",
    targetPath: "design/fonts/kenney-future.ttf",
    sha256: "7a55b07f5968fac872648a7c5e959bd2b93e06f63153b585d56e4d5298ddff61",
  },
  {
    id: "font.future-narrow",
    sourcePack: "kenney-ui-pack-2.0",
    sourcePath: "Font/Kenney Future Narrow.ttf",
    targetPath: "design/fonts/kenney-future-narrow.ttf",
    sha256: "17e182587a3264dcf9e5b17c055715d5597187546ce81925c64e9184c26d597f",
  },
];

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

for (const font of fontFixtures) {
  const source = sources.get(font.sourcePack);
  if (!source) {
    failures.push(`${font.id}: unknown source pack ${font.sourcePack}`);
    continue;
  }
  const sourceFile = resolveWithin(approvedSourceRoot, source.approvedSourcePath, font.sourcePath);
  const targetFile = resolveWithin(templateRoot, font.targetPath);
  if (!fs.existsSync(sourceFile) || !fs.existsSync(targetFile)) {
    failures.push(`${font.id}: approved source or committed font is missing`);
    continue;
  }
  const sourceBytes = fs.readFileSync(sourceFile);
  const targetBytes = fs.readFileSync(targetFile);
  if (!sourceBytes.equals(targetBytes) || sha256(sourceBytes) !== font.sha256) {
    failures.push(`${font.id}: committed bytes or hash differ from the approved source`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  throw new Error(`Kenney source audit failed with ${failures.length} issue(s)`);
}

console.log(
  `Kenney source audit passed: ${manifest.assets.length} semantic fixtures and ${fontFixtures.length} fonts match approved source bytes`,
);
