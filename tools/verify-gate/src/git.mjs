// Shared command runner for the gate CLIs (landed-gate, release-provenance).
// The visual verify gate's diff plumbing that used to live here was removed
// with the gate itself (2026-07-23) — landing safety now rests on landed-gate,
// project-gate, and release-provenance-gate.
import { execSync } from 'node:child_process';

/**
 * The one shared command runner for every gate CLI. Captures stderr so a
 * fail-closed gate can say WHY a git or npm call failed instead of a bare
 * "command failed".
 * @param {string} cwd
 * @param {{trim?: boolean}} [opts] trim stdout (release-provenance behavior)
 * @returns {(cmd:string)=>{ok:boolean, stdout:string, stderr:string}}
 */
export function makeRunner(cwd, { trim = false } = {}) {
  return (cmd) => {
    try {
      const stdout = execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { ok: true, stdout: trim ? stdout.trim() : stdout, stderr: '' };
    } catch (e) {
      const stdout = e && e.stdout ? String(e.stdout) : '';
      const stderr = e && e.stderr ? String(e.stderr) : '';
      return { ok: false, stdout: trim ? stdout.trim() : stdout, stderr };
    }
  };
}
