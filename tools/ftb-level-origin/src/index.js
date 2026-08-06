// ftb-level-origin — static R2 passthrough for Find The Bird level streaming.
// Serves the publish contract of tools/level-editor/scripts/publish_ftb_cdn.py:
//   /manifest.json          no-cache (progression + level entries)
//   /assets/<sha256>.<ext>  immutable (content-addressed, runtime-verified)
//   /levels/<id>/dogs/...   immutable-ish (sprites are re-exported under new
//                           level ids, never mutated in place)
const MIME = { webp: 'image/webp', png: 'image/png', json: 'application/json' };

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405 });
    }
    const key = new URL(request.url).pathname.replace(/^\/+/, '');
    if (key === '' || key.includes('..')) return new Response('not found', { status: 404 });
    const object = await env.LEVELS.get(key);
    if (object === null) return new Response('not found', { status: 404 });
    const ext = key.split('.').pop();
    const headers = new Headers({
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': key === 'manifest.json'
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
    });
    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  },
};
