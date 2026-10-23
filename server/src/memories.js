import { MAX_MEMORY_BYTES, sanitizeMemoryMeta, sniffImage } from './validate.js';

// HTTP side of "Add memory": a photo is far too big for the socket's 16 KB message limit, so it travels as
// an ordinary POST, authorised by the same room token the player's socket seat uses.
//
//   POST /api/rooms/:roomId/memories      body: the image bytes (WebP, JPEG or PNG, at most 1.5 MB)
//        Authorization: Bearer <room token>, X-Caption: <URL-encoded text>, X-Date: YYYY-MM-DD
//   GET  /api/rooms/:roomId/memories/:id  the image. The id is a 128-bit random capability that only
//                                         the room's two players are ever told.
//
// Photos live in server memory with their room, and go when it is cleaned up (a minute after both
// players leave). See docs/MEMORIES.md.

const ROUTE = /^\/api\/rooms\/([\w-]{1,64})\/memories(?:\/([\w-]{1,64}))?$/;

const STATUS_FOR = {
  unauthorized: 401,
  too_fast: 429,
  room_full: 409,
  server_full: 507,
};

/**
 * Returns a handler (req, res) => boolean: true if it handled the request, false if the URL isn't ours.
 * `announce(sockets, memory)` is called after a successful upload, to tell both players' sockets.
 */
export function createMemoryRoutes({ store, origins, announce }) {
  const allowed = new Set(origins);

  function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Caption, X-Date');
    res.setHeader('Access-Control-Max-Age', '600');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
  };

  /** Reads the body, refusing as soon as it passes the limit instead of buffering it. */
  function readBody(req, limit) {
    return new Promise((resolve) => {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > limit) return resolve(null);
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          resolve(null);
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', () => resolve(null));
    });
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const match = ROUTE.exec(url.pathname);
    if (!match) return false;
    const [, roomId, id] = match;
    cors(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return true;
    }

    if (req.method === 'GET' && id) {
      const memory = store.getMemory(roomId, id);
      if (!memory) return json(res, 404, { ok: false, error: 'not_found' }), true;
      res.writeHead(200, {
        'Content-Type': memory.type,
        'Content-Length': memory.bytes.length,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      }).end(memory.bytes);
      return true;
    }

    if (req.method === 'POST' && !id) {
      const token = /^Bearer (\S{1,128})$/.exec(req.headers.authorization ?? '')?.[1];
      if (!token) return json(res, 401, { ok: false, error: 'unauthorized' }), true;

      const bytes = await readBody(req, MAX_MEMORY_BYTES);
      if (!bytes) return json(res, 413, { ok: false, error: 'too_large' }), true;
      const type = sniffImage(bytes);
      if (!type) return json(res, 415, { ok: false, error: 'unsupported_type' }), true;

      const meta = sanitizeMemoryMeta({ caption: req.headers['x-caption'], date: req.headers['x-date'] });
      const result = store.addMemory(roomId, token, { ...meta, type, bytes });
      if (result.error) return json(res, STATUS_FOR[result.error] ?? 400, { ok: false, error: result.error }), true;

      announce(result.sockets, result.memory);
      json(res, 201, { ok: true, memory: result.memory });
      return true;
    }

    json(res, 405, { ok: false, error: 'method_not_allowed' });
    return true;
  };
}
