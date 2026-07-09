import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PORTAL_AUTHOR,
  buildReportTitle,
  deliverReport,
  postReport,
  resolvePortalConfig,
} from '../src/portal.mjs';

// A fetch double that records the last call and returns a scripted response.
function stubFetch({ ok = true, status = 200, body = { post: { id: 'p_1' } } } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return { ok, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

describe('resolvePortalConfig', () => {
  it('prefers GALLERY_URL/GALLERY_TOKEN from env when both are set', () => {
    const cfg = resolvePortalConfig({
      env: { GALLERY_URL: 'http://portal.local/', GALLERY_TOKEN: 'tok' },
      readFile: () => { throw new Error('should not read config file'); },
    });
    expect(cfg).toEqual({ url: 'http://portal.local', token: 'tok' });
  });

  it('falls back to ~/.gallery/config.json {url, token} when env is unset', () => {
    const cfg = resolvePortalConfig({
      env: {},
      homeDir: '/home/x',
      readFile: (p) => {
        expect(p).toBe(path.join('/home/x', '.gallery', 'config.json'));
        return JSON.stringify({ url: 'http://cfg.local//', token: 'cfgtok' });
      },
    });
    expect(cfg).toEqual({ url: 'http://cfg.local', token: 'cfgtok' });
  });

  it('lets a single env var override its field over the config file', () => {
    const cfg = resolvePortalConfig({
      env: { GALLERY_TOKEN: 'envtok' },
      readFile: () => JSON.stringify({ url: 'http://cfg.local', token: 'cfgtok' }),
    });
    expect(cfg).toEqual({ url: 'http://cfg.local', token: 'envtok' });
  });

  it('returns null when neither source yields both url and token', () => {
    expect(resolvePortalConfig({ env: {}, readFile: () => { throw new Error('ENOENT'); } })).toBe(null);
    expect(resolvePortalConfig({ env: {}, readFile: () => JSON.stringify({ url: 'x' }) })).toBe(null);
  });
});

describe('buildReportTitle', () => {
  it('derives the title from game + date', () => {
    expect(buildReportTitle({ game: 'marble_run', date: '2026-07-08' }))
      .toBe('device-verify marble_run 2026-07-08');
  });
});

describe('postReport', () => {
  it('POSTs multipart report fields + files to the stream posts endpoint', async () => {
    const { fetchImpl, calls } = stubFetch();
    const captured = new Map();
    const FormDataImpl = class {
      constructor() { this.entries = []; }
      append(name, value, filename) { this.entries.push({ name, value, filename }); }
    };
    const BlobImpl = class {
      constructor(parts) { this.parts = parts; }
    };
    const out = await postReport({
      config: { url: 'http://portal.local', token: 'tok' },
      slug: 'run-0708',
      title: 'device-verify marble_run 2026-07-08',
      files: ['/e/grid.html', '/e/summary.json'],
      fetchImpl,
      FormDataImpl,
      BlobImpl,
      readFile: (f) => { captured.set(f, true); return Buffer.from(`bytes:${f}`); },
    });
    expect(out).toEqual({ post: { id: 'p_1' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://portal.local/api/streams/run-0708/posts');
    expect(calls[0].opts.method).toBe('POST');
    expect(calls[0].opts.headers.Authorization).toBe('Bearer tok');
    const form = calls[0].opts.body;
    expect(form.entries.filter((e) => e.name === 'type')[0].value).toBe('report');
    expect(form.entries.filter((e) => e.name === 'title')[0].value)
      .toBe('device-verify marble_run 2026-07-08');
    expect(form.entries.filter((e) => e.name === 'author')[0].value).toBe(PORTAL_AUTHOR);
    const fileEntries = form.entries.filter((e) => e.name === 'files');
    expect(fileEntries.map((e) => e.filename)).toEqual(['grid.html', 'summary.json']);
    expect(captured.has('/e/grid.html') && captured.has('/e/summary.json')).toBe(true);
  });

  it('throws with the status (and detail when present) on a non-2xx response', async () => {
    const { fetchImpl } = stubFetch({ ok: false, status: 409, body: { detail: 'stream is closed' } });
    await expect(postReport({
      config: { url: 'http://portal.local', token: 'tok' },
      slug: 's', title: 't', files: [],
      fetchImpl,
      FormDataImpl: class { append() {} },
      BlobImpl: class {},
      readFile: () => Buffer.from(''),
    })).rejects.toThrow(/HTTP 409: stream is closed/);
  });
});

describe('deliverReport (never throws)', () => {
  let dir;
  let grid;
  const logs = [];
  const log = (line) => logs.push(line);

  beforeEach(() => {
    logs.length = 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-test-'));
    grid = path.join(dir, 'grid.html');
    fs.writeFileSync(grid, '<html>grid</html>');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('is a silent no-op when no slug is provided', async () => {
    const r = await deliverReport({ files: [grid], log });
    expect(r.delivered).toBe(false);
    expect(logs).toHaveLength(0);
  });

  it('posts and reports delivered=true on success', async () => {
    const { fetchImpl, calls } = stubFetch();
    const r = await deliverReport({
      slug: 'run-0708', game: 'marble_run', date: '2026-07-08', files: [grid],
      env: { GALLERY_URL: 'http://portal.local', GALLERY_TOKEN: 'tok' },
      fetchImpl,
      log,
    });
    expect(r.delivered).toBe(true);
    expect(calls).toHaveLength(1);
    expect(logs.some((l) => /posted report to portal stream run-0708/.test(l))).toBe(true);
  });

  it('logs one warning and does not throw when config is missing', async () => {
    const r = await deliverReport({
      slug: 'run-0708', game: 'g', date: '2026-07-08', files: [grid],
      env: {},
      readFile: () => { throw new Error('ENOENT'); },
      fetchImpl: () => { throw new Error('should not be called'); },
      log,
    });
    expect(r.delivered).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/WARNING portal delivery skipped .* no GALLERY_URL/);
  });

  it('logs one warning and does not throw when the POST fails', async () => {
    const { fetchImpl } = stubFetch({ ok: false, status: 500, body: {} });
    const r = await deliverReport({
      slug: 'run-0708', game: 'g', date: '2026-07-08', files: [grid],
      env: { GALLERY_URL: 'http://portal.local', GALLERY_TOKEN: 'tok' },
      fetchImpl,
      log,
    });
    expect(r.delivered).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/WARNING portal delivery failed for stream run-0708 — HTTP 500/);
  });

  it('warns when the slug is set but none of the files exist on disk', async () => {
    const { fetchImpl } = stubFetch();
    const r = await deliverReport({
      slug: 'run-0708', game: 'g', date: '2026-07-08',
      files: [path.join(dir, 'missing.html')],
      env: { GALLERY_URL: 'http://portal.local', GALLERY_TOKEN: 'tok' },
      fetchImpl,
      log,
    });
    expect(r.delivered).toBe(false);
    expect(logs[0]).toMatch(/no files to post/);
  });
});
