// Foreground-verify guard (fixes the ledger A5 near-miss / capture-integrity rule
// for the REFERENCE lane). Before every `screencap` we run
// `dumpsys activity activities | grep topResumedActivity` and assert the expected
// package is actually foreground. A mismatch is a HARD error — it is how we avoid
// stamping "menu" onto a screenshot of the launcher/home screen. This module is
// pure string parsing so it is unit-testable without a device.

/**
 * Parse the component (package/activity) out of a `dumpsys topResumedActivity`
 * (a.k.a. mResumedActivity) line.
 * Example line:
 *   topResumedActivity=ActivityRecord{9a3f u0 com.basegamelab.marblerun/.MainActivity t42}
 * @param {string} output raw dumpsys text
 * @returns {{package:string, activity:string}|null}
 */
export function parseForegroundActivity(output) {
  // Match "com.pkg.name/.Activity" or "com.pkg.name/com.pkg.name.Activity"
  const re = /(?:topResumedActivity|mResumedActivity|ResumedActivity:)[^\n]*?\s([a-zA-Z][\w.]+)\/([\w.]*[\w])/;
  const m = output.match(re);
  if (!m) return null;
  return { package: m[1], activity: m[2] };
}

/**
 * @param {string} dumpsysOutput
 * @param {string} expectedPackage
 * @returns {{ok:boolean, actual:({package:string,activity:string}|null), expected:string}}
 */
export function verifyForeground(dumpsysOutput, expectedPackage) {
  const actual = parseForegroundActivity(dumpsysOutput);
  return {
    ok: actual !== null && actual.package === expectedPackage,
    actual,
    expected: expectedPackage,
  };
}

/**
 * Throw with a clear message if the foreground package does not match.
 * @param {string} dumpsysOutput
 * @param {string} expectedPackage
 * @param {string} state state being captured (for the error)
 * @returns {{package:string, activity:string}}
 */
export function assertForeground(dumpsysOutput, expectedPackage, state) {
  const result = verifyForeground(dumpsysOutput, expectedPackage);
  if (!result.ok) {
    const seen = result.actual ? `${result.actual.package}/${result.actual.activity}` : '(no activity parsed)';
    throw new Error(
      `foreground-verify FAILED for state "${state}": expected package ${expectedPackage} ` +
      `to be foreground, but topResumedActivity is ${seen}. Refusing to capture — ` +
      `a screencap of the wrong app would be a mislabeled capture (ledger B5).`
    );
  }
  return result.actual;
}
