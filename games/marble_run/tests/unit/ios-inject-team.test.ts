import { describe, expect, it } from "vitest";
import { DEVELOPMENT_TEAM, injectDevelopmentTeam } from "../../../../tools/marble-run/ios-inject-team.mjs";

// Two build configs (Debug + Release), each with an Automatic sign style — the
// exact shape `cap add ios` emits and v1 sugar3d's pbxproj carries. Tabs match
// the real generator's indentation.
const PBXPROJ_TWO_CONFIGS = [
  "\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;",
  "\t\t\t\tCODE_SIGN_STYLE = Automatic;",
  "\t\t\t\tINFOPLIST_FILE = App/Info.plist;",
  "\t\t\t};",
  "\t\t\t8888 /* Release */ = {",
  "\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;",
  "\t\t\t\tCODE_SIGN_STYLE = Automatic;",
  "\t\t\t\tINFOPLIST_FILE = App/Info.plist;",
  "",
].join("\n");

describe("injectDevelopmentTeam", () => {
  it("injects the team after every CODE_SIGN_STYLE = Automatic;", () => {
    const { text, occurrences, injected } = injectDevelopmentTeam(PBXPROJ_TWO_CONFIGS);
    expect(occurrences).toBe(2);
    expect(injected).toBe(2);
    const teamLines = text.split("\n").filter((l) => l.includes(`DEVELOPMENT_TEAM = ${DEVELOPMENT_TEAM};`));
    expect(teamLines).toHaveLength(2);
    // Team line immediately follows each sign-style line, with matching indent.
    for (const line of teamLines) {
      expect(line).toBe(`\t\t\t\tDEVELOPMENT_TEAM = ${DEVELOPMENT_TEAM};`);
    }
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (line.trim() === "CODE_SIGN_STYLE = Automatic;") {
        expect(lines[i + 1].trim()).toBe(`DEVELOPMENT_TEAM = ${DEVELOPMENT_TEAM};`);
      }
    });
  });

  it("is idempotent — a second run is a byte-for-byte no-op", () => {
    const once = injectDevelopmentTeam(PBXPROJ_TWO_CONFIGS).text;
    const twice = injectDevelopmentTeam(once);
    expect(twice.text).toBe(once);
    expect(twice.injected).toBe(0);
    expect(twice.occurrences).toBe(2);
  });

  it("leaves an already-signed config untouched", () => {
    const signed = [
      "\t\t\t\tCODE_SIGN_STYLE = Automatic;",
      "\t\t\t\tDEVELOPMENT_TEAM = 42L77JAX72;",
      "",
    ].join("\n");
    const { text, injected } = injectDevelopmentTeam(signed);
    expect(injected).toBe(0);
    expect(text).toBe(signed);
  });

  it("reports zero occurrences for a file without the sign-style line", () => {
    const { occurrences, injected } = injectDevelopmentTeam("// no signing here\n");
    expect(occurrences).toBe(0);
    expect(injected).toBe(0);
  });
});
