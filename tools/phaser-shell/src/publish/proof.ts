// Offline proof of a publication (U5, KTD-I). The DETERMINISTIC, editor-free
// leg lives here: verify a published projection is network-free, editor-free,
// and raster-only — no editor package markers in the runtime bundle, no
// remote/active content, and a raster-only runtime asset-pack. The REAL-BROWSER
// render of `scenes/shell.js` in Phaser 4.2.1 across all seven states (with
// fonts loaded, no fallback) is the vendor-gated leg and runs in
// `test/render-proof.spec.ts` under Playwright once P6 has produced the bundle.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isActiveContent, isRemoteContent, isNonRasterPackEntry } from './safety.ts';

/** Editor-footprint sentinels that must never appear in a runtime bundle. */
const EDITOR_MARKERS = ['phasereditor2d', 'phaser-editor', 'START-USER-CODE', 'editorCreate'];

export interface ProofFinding {
  where: string;
  code: string;
  detail: string;
}

export interface ProofResult {
  ok: boolean;
  findings: ProofFinding[];
}

/**
 * Run the offline, editor-free proof over a publication's `projection/` bundle.
 * A clean result means the runtime projection is network-free, editor-free, and
 * raster-only. It does NOT assert Phaser instantiation — that is the P6 browser leg.
 */
export async function offlineProof(publicationDir: string): Promise<ProofResult> {
  const findings: ProofFinding[] = [];
  const projection = path.join(publicationDir, 'projection');
  if (!existsSync(projection)) {
    return { ok: false, findings: [{ where: 'projection', code: 'missing-projection', detail: 'no projection/ directory' }] };
  }

  const shellJs = path.join(projection, 'scenes', 'shell.js');
  if (!existsSync(shellJs)) {
    findings.push({ where: 'scenes/shell.js', code: 'missing-canonical-scene', detail: 'no canonical projection module' });
  } else {
    const source = await readFile(shellJs, 'utf8');
    for (const marker of EDITOR_MARKERS) {
      if (source.includes(marker)) {
        findings.push({ where: 'scenes/shell.js', code: 'editor-footprint', detail: `runtime bundle contains editor marker "${marker}"` });
      }
    }
    if (isActiveContent(source.replace(/\bon[a-z]+\s*=/gi, ''))) {
      // (the on*= handler check is web-DOM oriented; the sentinel here targets
      // script/scheme injection, not legitimate JS event wiring)
      findings.push({ where: 'scenes/shell.js', code: 'active-content', detail: 'runtime bundle contains active/script content' });
    }
    if (isRemoteContent(source)) {
      findings.push({ where: 'scenes/shell.js', code: 'remote-content', detail: 'runtime bundle references a remote/data URL' });
    }
  }

  // Runtime asset-pack must be raster-only (no fonts, no editor keys).
  const packPath = path.join(projection, 'asset-pack.json');
  if (existsSync(packPath)) {
    const pack = JSON.parse(await readFile(packPath, 'utf8')) as Record<string, unknown>;
    for (const [section, value] of Object.entries(pack)) {
      if (section === 'meta' || value === null || typeof value !== 'object') continue;
      const files = (value as Record<string, unknown>)['files'];
      if (!Array.isArray(files)) continue;
      for (const file of files as Array<{ type?: unknown; url?: unknown }>) {
        if (isNonRasterPackEntry(file)) {
          findings.push({ where: 'asset-pack.json', code: 'non-raster-runtime-entry', detail: String(file.url) });
        }
      }
    }
  }

  // No stray files outside the allowed projection shape.
  for (const name of await readdir(projection)) {
    if (name.endsWith('.scene') || name.endsWith('.components') || name.endsWith('.ttf')) {
      findings.push({ where: name, code: 'unexpected-file', detail: `raw editor/font file leaked into projection` });
    }
  }

  return { ok: findings.length === 0, findings };
}
