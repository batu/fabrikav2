// Reusable fail-closed safety guards for the Phaser authoring/publisher gate
// (U5, KTD-F). Pure string/path/object predicates shared by validate.ts (scene
// content) and publish.ts (publication tree + generated code + plugin trust).
// Every guard is READ-ONLY; a caller that finds a hit performs zero writes.

/** The complete typed block-code surface (R10 + safety). */
export const BLOCK_CODES = [
  'blocked-missing-semantic-id',
  'blocked-duplicate-semantic-id',
  'blocked-invalid-binding',
  'blocked-invalid-catalog-id',
  'blocked-unknown-texture',
  'blocked-missing-required-action',
  'blocked-unsafe-geometry',
  'blocked-active-content',
  'blocked-remote-content',
  'blocked-unsafe-asset-path',
  'blocked-symlink',
  'blocked-non-raster-pack-entry',
  'blocked-guide-leak',
  'blocked-unexpected-file',
  'blocked-drift',
  'blocked-unsafe-import',
  'blocked-user-code',
  'blocked-untrusted-plugin',
  'blocked-unsafe-string-encoding',
  'blocked-unrepresentable',
  'blocked-publication-mismatch',
] as const;
export type BlockCode = (typeof BLOCK_CODES)[number];

/** A typed block. A blocked result implies zero writes to any publication output. */
export interface Block {
  code: BlockCode;
  /** The scene / file / object the block anchors to. */
  where: string;
  detail: string;
}

/** Map a lane block onto the shared typed outcome vocabulary (R16/R17). */
export function outcomeForBlock(code: BlockCode): 'invalid-revision' | 'unsupported-intent' | 'blocked-drift' {
  switch (code) {
    case 'blocked-drift':
    case 'blocked-unsafe-import':
    case 'blocked-user-code':
      return 'blocked-drift';
    case 'blocked-unrepresentable':
    case 'blocked-untrusted-plugin':
      return 'unsupported-intent';
    default:
      return 'invalid-revision';
  }
}

// --- string / URL guards -------------------------------------------------------

const ACTIVE_SCHEME = /\b(?:javascript|vbscript)\s*:/i;
const EVENT_HANDLER = /\bon[a-z]+\s*=/i;
const SCRIPT_TAG = /<\/?\s*script\b/i;
const REMOTE_SCHEME = /\b(?:https?|ftp|ws|wss):\/\//i;
const INLINE_DATA = /\b(?:data|blob):/i;

/** Active/executable content: script tags, event handlers, or active URL schemes. */
export function isActiveContent(value: string): boolean {
  return ACTIVE_SCHEME.test(value) || EVENT_HANDLER.test(value) || SCRIPT_TAG.test(value);
}

/** Remote or inline-data content: http(s)/ftp/ws URLs or data:/blob: URIs. */
export function isRemoteContent(value: string): boolean {
  return REMOTE_SCHEME.test(value) || INLINE_DATA.test(value);
}

// Control chars (except \t \n \r) and Unicode line/paragraph separators are
// rejected as unsafe string encoding; lone surrogates are caught by the regex.
// eslint-disable-next-line no-control-regex
const UNSAFE_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u2028\u2029]/;

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** True when a string carries control characters or an unpaired surrogate. */
export function isUnsafeStringEncoding(value: string): boolean {
  return UNSAFE_CONTROL.test(value) || LONE_SURROGATE.test(value);
}

// --- filesystem / pack guards --------------------------------------------------

/**
 * True when an asset path escapes its pack root: absolute paths, `..` segments,
 * Windows drive/backslash paths, or leading-slash absolutes are all unsafe.
 */
export function isUnsafeAssetPath(path: string): boolean {
  if (path.length === 0) return true;
  if (path.startsWith('/') || path.startsWith('\\')) return true;
  if (/^[a-zA-Z]:[\\/]/.test(path)) return true;
  if (path.includes('\\')) return true;
  const segments = path.split('/');
  return segments.some((seg) => seg === '..' || seg === '');
}

const RASTER_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

/** True when a filename is a permitted runtime raster (png/jpg/jpeg/webp). */
export function isRasterFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return RASTER_EXTENSIONS.has(ext);
}

/** True when the pack file entry is a non-raster (e.g. a font) — forbidden in the RUNTIME pack. */
export function isNonRasterPackEntry(file: { type?: unknown; url?: unknown }): boolean {
  if (file.type === 'image') {
    return typeof file.url === 'string' ? !isRasterFile(file.url) : true;
  }
  // Any non-image entry (bitmapFont, audio, …) is a non-raster runtime entry.
  return true;
}

// --- editor-only safe-area guides ---------------------------------------------

/**
 * True when a scene object is an editor-only safe-area guide (marked by a
 * `Semantic.fabGuide` flag or a `guide:` label). Guides must never leak into
 * generated/runtime output (`blocked-guide-leak`).
 */
export function isGuideObject(obj: Record<string, unknown>): boolean {
  if (obj['Semantic.fabGuide'] === true || obj['fabGuide'] === true) return true;
  const label = obj['label'];
  return typeof label === 'string' && label.startsWith('guide:');
}

// --- plugin trust --------------------------------------------------------------

/** APIs an authoring plugin may never call (network/storage/exfiltration/eval). */
export const BANNED_PLUGIN_APIS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'navigator.sendBeacon',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'eval',
  'import(',
  'Function(',
] as const;

/** Return the banned APIs a plugin's source references (empty = clean). */
export function scanPluginSource(source: string): string[] {
  return BANNED_PLUGIN_APIS.filter((api) => source.includes(api));
}

export interface PluginAllowlistEntry {
  id: string;
  sha256: string;
}

/** True when a plugin's id + content hash are on the allowlist. */
export function isAllowlistedPlugin(
  id: string,
  sha256: string,
  allowlist: readonly PluginAllowlistEntry[],
): boolean {
  return allowlist.some((entry) => entry.id === id && entry.sha256 === sha256);
}
