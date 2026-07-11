import { Buffer } from "node:buffer";
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
const failures = [];

function resolveRoot(root, label) {
  try {
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) throw new Error("is not a directory");
    return fs.realpathSync(root);
  } catch (error) {
    throw new Error(`${label} cannot be audited: ${error.message}`);
  }
}

const approvedSourceRootReal = resolveRoot(approvedSourceRoot, "Approved source root");
const templateRootReal = resolveRoot(templateRoot, "Template root");

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function readRegularFileWithin(root, rootReal, segments, label) {
  const candidate = path.resolve(root, ...segments);
  if (!isWithin(root, candidate)) {
    failures.push(`${label}: manifest path escapes its configured root`);
    return undefined;
  }

  try {
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      failures.push(`${label}: expected a regular non-symlink file`);
      return undefined;
    }
    const realPath = fs.realpathSync(candidate);
    if (!isWithin(rootReal, realPath)) {
      failures.push(`${label}: resolved path escapes its configured root`);
      return undefined;
    }
    return { bytes: fs.readFileSync(realPath), realPath };
  } catch (error) {
    failures.push(`${label}: cannot read file (${error.code ?? error.message})`);
    return undefined;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function prefixedSha256(bytes) {
  return `sha256-${sha256(bytes)}`;
}

function canonicalText(bytes) {
  return bytes
    .toString("utf8")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function pngFacts(bytes) {
  const pngSignature = "89504e470d0a1a0a";
  if (bytes.length < 26 || bytes.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error("expected PNG bytes");
  }
  const colorType = bytes.readUInt8(25);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    hasAlpha: colorType === 4 || colorType === 6 || bytes.includes(Buffer.from("tRNS")),
  };
}

const sources = new Map(manifest.sources.map((source) => [source.id, source]));
const assets = manifest.assetCatalog?.assets;
if (!Array.isArray(assets)) {
  throw new Error("Kenney manifest must contain assetCatalog.assets");
}

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

for (const source of manifest.sources) {
  const sourceFile = readRegularFileWithin(
    approvedSourceRoot,
    approvedSourceRootReal,
    [source.approvedSourcePath, source.licenseSourcePath],
    `${source.id}: approved license`,
  );
  const targetFile = readRegularFileWithin(
    templateRoot,
    templateRootReal,
    ["design", source.licenseFile],
    `${source.id}: committed license`,
  );
  if (!sourceFile || !targetFile) continue;

  if (
    sha256(sourceFile.bytes) !== source.licenseSourceSha256 ||
    sha256(targetFile.bytes) !== source.licenseSha256 ||
    canonicalText(sourceFile.bytes) !== canonicalText(targetFile.bytes)
  ) {
    failures.push(
      `${source.id}: committed license text or pinned hashes differ from the approved source`,
    );
  }
}

for (const asset of assets) {
  const source = sources.get(asset.provenance?.sourceId);
  if (!source) {
    failures.push(`${asset.id}: unknown source pack ${asset.provenance?.sourceId}`);
    continue;
  }

  const sourceFile = readRegularFileWithin(
    approvedSourceRoot,
    approvedSourceRootReal,
    [source.approvedSourcePath, asset.provenance.sourcePath],
    `${asset.id}: approved source`,
  );
  const targetFile = readRegularFileWithin(
    templateRoot,
    templateRootReal,
    ["design", asset.path],
    `${asset.id}: committed fixture`,
  );
  if (!sourceFile || !targetFile) continue;

  let sourceFacts;
  let targetFacts;
  try {
    sourceFacts = pngFacts(sourceFile.bytes);
    targetFacts = pngFacts(targetFile.bytes);
  } catch (error) {
    failures.push(`${asset.id}: ${error.message}`);
    continue;
  }

  const sourceHash = prefixedSha256(sourceFile.bytes);
  const targetHash = prefixedSha256(targetFile.bytes);
  if (!sourceFile.bytes.equals(targetFile.bytes)) {
    failures.push(`${asset.id}: committed bytes differ from the approved source`);
  }
  if (
    asset.sha256 !== sourceHash ||
    asset.sha256 !== targetHash ||
    asset.provenance.sourceHash !== sourceHash
  ) {
    failures.push(`${asset.id}: catalog hashes do not match approved and committed bytes`);
  }
  if (
    asset.width !== sourceFacts.width ||
    asset.height !== sourceFacts.height ||
    asset.width !== targetFacts.width ||
    asset.height !== targetFacts.height
  ) {
    failures.push(`${asset.id}: catalog dimensions do not match approved and committed bytes`);
  }
  if (asset.bytes !== sourceFile.bytes.byteLength || asset.bytes !== targetFile.bytes.byteLength) {
    failures.push(`${asset.id}: catalog byte size does not match approved and committed bytes`);
  }
  if (asset.hasAlpha !== sourceFacts.hasAlpha || asset.hasAlpha !== targetFacts.hasAlpha) {
    failures.push(`${asset.id}: catalog alpha fact does not match approved and committed bytes`);
  }
  if (asset.mimeType !== "image/png" || !asset.path.endsWith(".png")) {
    failures.push(`${asset.id}: catalog MIME and committed extension must identify PNG bytes`);
  }
  if (asset.provenance.license !== source.license) {
    failures.push(`${asset.id}: catalog license does not match its approved source pack`);
  }
}

for (const font of fontFixtures) {
  const source = sources.get(font.sourcePack);
  if (!source) {
    failures.push(`${font.id}: unknown source pack ${font.sourcePack}`);
    continue;
  }
  const sourceFile = readRegularFileWithin(
    approvedSourceRoot,
    approvedSourceRootReal,
    [source.approvedSourcePath, font.sourcePath],
    `${font.id}: approved source`,
  );
  const targetFile = readRegularFileWithin(
    templateRoot,
    templateRootReal,
    [font.targetPath],
    `${font.id}: committed fixture`,
  );
  if (!sourceFile || !targetFile) continue;

  if (!sourceFile.bytes.equals(targetFile.bytes) || sha256(sourceFile.bytes) !== font.sha256) {
    failures.push(`${font.id}: committed bytes or hash differ from the approved source`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  throw new Error(`Kenney source audit failed with ${failures.length} issue(s)`);
}

console.log(
  `Kenney source audit passed: ${assets.length} canonical fixtures and ${fontFixtures.length} fonts match source bytes; ${manifest.sources.length} licenses match pinned source content`,
);
