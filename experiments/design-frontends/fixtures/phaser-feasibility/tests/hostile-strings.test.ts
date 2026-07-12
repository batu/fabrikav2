// R5/AE2: hostile copy and identifier strings must survive generation as
// inert data — byte-exact values, confined to string literals. Compile
// success alone is not proof (KTD7); these tests parse the generated code.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scenePath = join(root, "editor-project", "src", "scenes", "Probe.scene");
const generatedPath = join(root, "editor-project", "src", "scenes", "Probe.ts");

const scene = JSON.parse(readFileSync(scenePath, "utf8"));

function findObj(label: string): Record<string, unknown> {
  let hit: Record<string, unknown> | undefined;
  const walk = (list: Record<string, unknown>[]) => {
    for (const o of list ?? []) {
      if (o.label === label) hit = o;
      walk((o.list as Record<string, unknown>[]) ?? []);
    }
  };
  walk(scene.displayList);
  if (!hit) throw new Error(`scene object ${label} not found`);
  return hit;
}

function generatedSource(): ts.SourceFile {
  const text = readFileSync(generatedPath, "utf8");
  return ts.createSourceFile("Probe.ts", text, ts.ScriptTarget.ES2022, true);
}

function stringLiteralValues(sf: ts.SourceFile): string[] {
  const values: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      values.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return values;
}

// Replace every string-literal range with spaces, leaving only code,
// comments, and structure — hostile content must not survive there.
function sourceWithoutStringLiterals(sf: ts.SourceFile): string {
  const text = sf.getFullText();
  const ranges: Array<[number, number]> = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      ranges.push([node.getStart(sf), node.getEnd()]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  let out = text;
  for (const [start, end] of ranges) {
    out = out.slice(0, start) + " ".repeat(end - start) + out.slice(end);
  }
  return out;
}

describe("hostile strings survive generation as inert data (R5, AE2)", () => {
  const hostileText = findObj("copyHostile")["text"] as string;
  const hostileSlot = findObj("copyHostile")["Semantic.fabSlot"] as string;
  const sentinel = findObj("copyTitle")["text"] as string;

  it("authored fixtures actually contain every hostile class", () => {
    for (const frag of ["'", '"', "`", "${", "}", "*/", "//", "</script>", "\n"]) {
      expect(hostileText, `hostile text lost fragment ${JSON.stringify(frag)}`).toContain(frag);
    }
  });

  it("generated code parses cleanly (no unterminated strings / syntax breakout)", () => {
    const sf = generatedSource();
    // parseDiagnostics is internal but stable; empty array = clean parse
    const diags = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
    expect(diags).toHaveLength(0);
  });

  it("hostile copy round-trips byte-exact into a plain string literal", () => {
    const values = stringLiteralValues(generatedSource());
    expect(values).toContain(hostileText);
  });

  it("hostile component property value round-trips byte-exact", () => {
    const values = stringLiteralValues(generatedSource());
    expect(values).toContain(hostileSlot);
  });

  it("probe sentinel round-trips", () => {
    const values = stringLiteralValues(generatedSource());
    expect(values).toContain(sentinel);
  });

  it("hostile content appears ONLY inside string literals (no comment/template/code escape)", () => {
    const stripped = sourceWithoutStringLiterals(generatedSource());
    for (const frag of ["H'", 'H"', "H`", "${x}", "</script>"]) {
      expect(stripped, `fragment ${JSON.stringify(frag)} escaped a string literal`).not.toContain(frag);
    }
  });

  it("hostile content is never emitted into a template expression", () => {
    const sf = generatedSource();
    const visit = (node: ts.Node) => {
      if (ts.isTemplateExpression(node)) {
        expect(node.getText(sf)).not.toContain("H'");
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  });
});
