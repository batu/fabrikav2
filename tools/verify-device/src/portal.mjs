// OPTIONAL Portal delivery (portal-spec.md §10): after a verify-device run
// produces grid.html + summary.json, also POST them to the Portal as a `report`
// post so the evidence is delivered, not just written to disk. Evidence folders
// stay the source of truth; the Portal copy is push-only convenience.
//
// HARD CONTRACT: Portal delivery must NEVER fail or block the verify run or
// affect its exit code. `deliverReport` never throws — every failure path
// (missing config, network error, non-2xx) logs exactly one warning line and
// returns. The HTTP + fs layers are injectable so the whole thing is
// unit-testable without a network or a real ~/.gallery/config.json.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Free-text display author for Portal report posts from this tool. */
export const PORTAL_AUTHOR = 'verify-device @ fabrikav2';

/**
 * Resolve the Portal (gallery) URL + token. env GALLERY_URL/GALLERY_TOKEN win;
 * otherwise ~/.gallery/config.json {url, token} — mirroring gallery's own
 * client_config precedence (both env vars present → use env; else fall back to
 * the config file, still letting an individual env var override its field).
 * @returns {{url:string, token:string}|null} null when neither source yields both.
 */
export function resolvePortalConfig({
  env = process.env,
  homeDir = os.homedir(),
  readFile = fs.readFileSync,
} = {}) {
  const envUrl = env.GALLERY_URL;
  const envToken = env.GALLERY_TOKEN;
  if (envUrl && envToken) {
    return { url: envUrl.replace(/\/+$/, ''), token: envToken };
  }
  let cfg = {};
  try {
    cfg = JSON.parse(readFile(path.join(homeDir, '.gallery', 'config.json'), 'utf8'));
  } catch {
    cfg = {};
  }
  const url = envUrl || cfg.url;
  const token = envToken || cfg.token;
  if (!url || !token) return null;
  return { url: String(url).replace(/\/+$/, ''), token: String(token) };
}

/** Title derived from the run context, e.g. "device-verify marble_run 2026-07-08". */
export function buildReportTitle({ game, date }) {
  return `device-verify ${game} ${date}`;
}

/**
 * POST a report post to {url}/api/streams/{slug}/posts as multipart form-data.
 * Throws on a non-2xx response or transport error — `deliverReport` is the
 * never-throws wrapper. HTTP/FormData/Blob and the file reader are injectable.
 * @returns {Promise<object>} the parsed JSON response body
 */
export async function postReport({
  config,
  slug,
  title,
  author = PORTAL_AUTHOR,
  files,
  fetchImpl = fetch,
  FormDataImpl = FormData,
  BlobImpl = Blob,
  readFile = fs.readFileSync,
}) {
  const form = new FormDataImpl();
  form.append('type', 'report');
  form.append('title', title);
  form.append('author', author);
  for (const file of files) {
    form.append('files', new BlobImpl([readFile(file)]), path.basename(file));
  }
  const res = await fetchImpl(`${config.url}/api/streams/${encodeURIComponent(slug)}/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}` },
    body: form,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.detail) detail = `HTTP ${res.status}: ${body.detail}`;
    } catch {
      /* non-JSON error body — status is enough */
    }
    throw new Error(detail);
  }
  return res.json();
}

/**
 * Optional Portal delivery entry point. NEVER throws. When `slug` is set,
 * resolves config and POSTs the files as a `report`; any failure (no config,
 * network, non-2xx, missing files) logs one warning line and returns.
 * @param {object} opts
 * @param {string} [opts.slug] stream slug; when falsy, delivery is a silent no-op.
 * @param {string} opts.game
 * @param {string} opts.date
 * @param {string[]} opts.files absolute paths (grid.html [, summary.json]).
 * @param {(line:string)=>void} [opts.log]
 * @returns {Promise<{delivered:boolean, reason?:string, post?:object}>}
 */
export async function deliverReport({
  slug,
  game,
  date,
  files = [],
  env = process.env,
  homeDir,
  readFile,
  fetchImpl,
  FormDataImpl,
  BlobImpl,
  log = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  if (!slug) return { delivered: false, reason: 'no stream slug' };
  try {
    const config = resolvePortalConfig({ env, homeDir, readFile });
    if (!config) {
      log(`verify-device: WARNING portal delivery skipped for stream ${slug} — `
        + 'no GALLERY_URL/GALLERY_TOKEN and no ~/.gallery/config.json {url, token}');
      return { delivered: false, reason: 'no portal config' };
    }
    const present = files.filter((f) => f && fs.existsSync(f));
    if (!present.length) {
      log(`verify-device: WARNING portal delivery skipped for stream ${slug} — no files to post`);
      return { delivered: false, reason: 'no files' };
    }
    const post = await postReport({
      config,
      slug,
      title: buildReportTitle({ game, date }),
      files: present,
      fetchImpl,
      FormDataImpl,
      BlobImpl,
      readFile,
    });
    log(`verify-device: posted report to portal stream ${slug} at ${config.url}`);
    return { delivered: true, post };
  } catch (err) {
    log(`verify-device: WARNING portal delivery failed for stream ${slug} — ${err.message}`);
    return { delivered: false, reason: err.message };
  }
}
