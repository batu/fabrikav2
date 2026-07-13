import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { editorPackFiles } from './catalog.ts';

export interface LoadedEditorAssets {
  bytesByUrl: Map<string, Buffer>;
  symlinkUrls: string[];
}

function resolveInside(root: string, relative: string): string | null {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\')) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  return resolved;
}

/**
 * Load only payloads declared by the editor asset pack. Missing and unsafe
 * entries are deliberately omitted so the validation gate reports them.
 */
export function loadEditorAssets(publicRoot: string, pack: unknown): LoadedEditorAssets {
  const bytesByUrl = new Map<string, Buffer>();
  const symlinkUrls: string[] = [];
  for (const file of editorPackFiles(pack)) {
    if (typeof file.url !== 'string') continue;
    const resolved = resolveInside(publicRoot, file.url);
    if (!resolved) continue;
    try {
      const stat = lstatSync(resolved);
      if (stat.isSymbolicLink()) {
        symlinkUrls.push(file.url);
      } else if (stat.isFile()) {
        bytesByUrl.set(file.url, readFileSync(resolved));
      }
    } catch {
      // Validation reports the absent payload as `asset-file-missing`.
    }
  }
  return { bytesByUrl, symlinkUrls };
}
