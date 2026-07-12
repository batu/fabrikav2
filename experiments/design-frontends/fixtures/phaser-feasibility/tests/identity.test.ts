// R1/R2 identity proofs against committed editor-native state plus the
// hash-bracketed session evidence (AE1).
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain .mjs helper without type declarations
import { projectManifest, manifestHash } from "../scripts/lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scenePath = join(root, "editor-project", "src", "scenes", "Probe.scene");
const sessionsDir = join(root, "evidence", "sessions");

interface FlatObj {
  id: string;
  label: string;
  parentId: string | null;
  semanticId: string | null;
  role: string | null;
  binding: string | null;
  hasSemantic: boolean;
}

function flatten(): FlatObj[] {
  const out: FlatObj[] = [];
  const walk = (list: Record<string, unknown>[], parentId: string | null) => {
    for (const obj of list ?? []) {
      out.push({
        id: obj.id as string,
        label: obj.label as string,
        parentId,
        semanticId: (obj["Semantic.fabSemanticId"] as string) ?? null,
        role: (obj["Semantic.fabRole"] as string) ?? null,
        binding: (obj["Semantic.fabBinding"] as string) ?? null,
        hasSemantic: Array.isArray(obj.components) && (obj.components as string[]).includes("Semantic"),
      });
      walk((obj.list as Record<string, unknown>[]) ?? [], obj.id as string);
    }
  };
  walk(JSON.parse(readFileSync(scenePath, "utf8")).displayList, null);
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("semantic identity in editor-native state (R1)", () => {
  const objs = flatten();

  it("every scene object carries a stable UUID instance id", () => {
    for (const o of objs) expect(o.id, o.label).toMatch(UUID);
  });

  it("instance ids are unique", () => {
    const ids = objs.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every semantic object carries a semantic id and role (missing metadata fails)", () => {
    for (const o of objs.filter((o) => o.hasSemantic)) {
      expect(o.semanticId, `${o.label} missing fabSemanticId`).toBeTruthy();
      expect(o.role, `${o.label} missing fabRole`).toBeTruthy();
    }
  });
});

describe("save/close/reopen stability (R1, AE1)", () => {
  it("recorded identity list is unchanged across the editor save/reopen session", () => {
    const beforePath = join(sessionsDir, "identity-before.json");
    const afterPath = join(sessionsDir, "identity-after.json");
    expect(existsSync(beforePath), "identity-before.json evidence missing (editor session not recorded)").toBe(true);
    expect(existsSync(afterPath), "identity-after.json evidence missing (editor session not recorded)").toBe(true);
    const before = JSON.parse(readFileSync(beforePath, "utf8")) as FlatObj[];
    const after = JSON.parse(readFileSync(afterPath, "utf8")) as FlatObj[];
    const afterById = new Map(after.map((o) => [o.id, o]));
    for (const o of before) {
      const a = afterById.get(o.id);
      expect(a, `object ${o.label} (${o.id}) lost across save/reopen`).toBeDefined();
      expect(a!.semanticId).toBe(o.semanticId);
      expect(a!.parentId).toBe(o.parentId);
    }
  });
});

describe("editor duplicate (R2, AE1)", () => {
  it("duplicate got a distinct new id in the same parent, binding retained at duplication then explicitly retargeted", () => {
    const resultPath = join(sessionsDir, "duplicate-result.json");
    const retargetPath = join(sessionsDir, "retarget-result.json");
    expect(existsSync(resultPath), "duplicate-result.json evidence missing (editor session not recorded)").toBe(true);
    expect(existsSync(retargetPath), "retarget-result.json evidence missing (editor session not recorded)").toBe(true);
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    const retarget = JSON.parse(readFileSync(retargetPath, "utf8"));
    expect(result.added).toHaveLength(1);
    const dup = result.added[0];
    expect(dup.id).toMatch(UUID);
    expect(dup.id).not.toBe(result.originalId);
    // at duplication time the binding was retained verbatim
    expect(dup.semanticId).toBe("shell.counter.primary");
    expect(dup.binding).toBe("currency:primary");
    // the committed scene holds the duplicate after its explicit retarget to
    // the second currency (performed through the editor inspector)
    const objs = flatten();
    const committed = objs.find((o) => o.id === dup.id);
    const original = objs.find((o) => o.id === result.originalId);
    expect(committed, "duplicate not present in committed scene").toBeDefined();
    expect(original, "original not present in committed scene").toBeDefined();
    expect(committed!.parentId).toBe(original!.parentId);
    expect(retarget.id).toBe(dup.id);
    expect(committed!.semanticId).toBe(retarget.semanticId);
    expect(committed!.binding).toBe(retarget.binding);
  });
});

describe("session-ledger hash bracket (KTD5)", () => {
  it("last ledger entry matches the committed editor-project bytes", () => {
    const ledgerPath = join(sessionsDir, "session-ledger.json");
    expect(existsSync(ledgerPath), "session ledger missing").toBe(true);
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    expect(ledger.entries.length).toBeGreaterThan(0);
    const last = ledger.entries[ledger.entries.length - 1];
    expect(manifestHash(projectManifest())).toBe(last.treeHash);
  });
});
