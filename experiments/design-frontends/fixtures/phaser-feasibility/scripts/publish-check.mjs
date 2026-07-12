// Typed publication gate for the probe (plan U4). Validates catalog IDs and
// required bindings in editor-native scene state and returns named block
// codes. Read-only by design: a blocked publication performs no writes, so
// prior outputs are untouched.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureRoot } from "./lib.mjs";

export const BLOCK_CODES = [
  "blocked-missing-semantic-id",
  "blocked-invalid-binding",
  "blocked-invalid-catalog-id",
  "blocked-duplicate-semantic-id",
  "blocked-unknown-texture",
];

// Roles that must carry a binding to publish.
const BINDING_REQUIRED_ROLES = new Set(["asset", "action", "copy", "counter"]);

function* walkObjects(list, parent = null) {
  for (const obj of list ?? []) {
    yield { obj, parent };
    if (Array.isArray(obj.list)) yield* walkObjects(obj.list, obj);
  }
}

export function checkScene(sceneJson, catalogJson, packJson) {
  const blocks = [];
  const catalogIds = new Set((catalogJson.entries ?? []).map((e) => e.id));
  const packKeys = new Set(
    Object.entries(packJson ?? {})
      .filter(([k]) => k !== "meta")
      .flatMap(([, section]) => (section.files ?? []).map((f) => f.key))
  );
  const seenSemantic = new Map();

  for (const { obj } of walkObjects(sceneJson.displayList)) {
    const label = obj.label ?? obj.id;
    const hasSemantic = (obj.components ?? []).includes("Semantic");
    if (!hasSemantic) continue;
    const semanticId = obj["Semantic.fabSemanticId"] ?? "";
    const role = obj["Semantic.fabRole"] ?? "";
    const binding = obj["Semantic.fabBinding"] ?? "";
    const variant = obj["Semantic.fabVariant"] ?? "";

    if (!semanticId) {
      blocks.push({ code: "blocked-missing-semantic-id", object: label });
    } else {
      const key = `${semanticId}\u0000${variant}`;
      if (seenSemantic.has(key)) {
        blocks.push({
          code: "blocked-duplicate-semantic-id",
          object: label,
          detail: `(${semanticId}, variant '${variant}') already used by ${seenSemantic.get(key)}`,
        });
      } else {
        seenSemantic.set(key, label);
      }
    }

    if (BINDING_REQUIRED_ROLES.has(role) && !binding) {
      blocks.push({ code: "blocked-invalid-binding", object: label, detail: `role '${role}' requires a binding` });
    }

    if (role === "asset") {
      const m = /^asset:(.+)$/.exec(binding);
      if (m && !catalogIds.has(m[1])) {
        blocks.push({ code: "blocked-invalid-catalog-id", object: label, detail: `no catalog entry '${m[1]}'` });
      }
      if (binding && !m) {
        blocks.push({ code: "blocked-invalid-binding", object: label, detail: `asset role needs asset:<id> binding, got '${binding}'` });
      }
    }

    if (obj.texture?.key && packKeys.size > 0 && !packKeys.has(obj.texture.key)) {
      blocks.push({ code: "blocked-unknown-texture", object: label, detail: `texture '${obj.texture.key}' not in asset pack` });
    }
  }

  return blocks.length > 0 ? { result: "blocked", blocks } : { result: "ok", blocks: [] };
}

export function checkDefaultProject() {
  const scene = JSON.parse(
    readFileSync(join(fixtureRoot, "editor-project", "src", "scenes", "Probe.scene"), "utf8")
  );
  const catalog = JSON.parse(readFileSync(join(fixtureRoot, "catalog", "catalog.json"), "utf8"));
  const pack = JSON.parse(
    readFileSync(join(fixtureRoot, "editor-project", "public", "assets", "asset-pack.json"), "utf8")
  );
  return checkScene(scene, catalog, pack);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const verdict = checkDefaultProject();
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.result === "ok" ? 0 : 1);
}
