// Pure input-validation helpers. Kept free of I/O so they can be unit-tested directly.

export const ANIMATIONS = new Set(['idle', 'walk', 'run']);
export const WORLD_BOUND = 200; // metres; anything outside is clamped (anti-teleport / sanity)
export const MAX_SPEED = 10; // m/s; the game's run speed is 4.8

const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

const CURTAIN_ID = /^[\w-]{1,64}$/;

/** A curtain event: { id: painting id, open: true | false | null }. Returns null if malformed. */
export function sanitizeCurtain(payload) {
  const id = payload?.id;
  const open = payload?.open;
  if (typeof id !== 'string' || !CURTAIN_ID.test(id)) return null;
  if (open !== true && open !== false && open !== null) return null;
  return { id, open };
}

/** Keys are shown as XXXX-XXXX; accept any case, dashes and spaces. Returns '' if malformed. */
export function normalizeKey(raw) {
  if (typeof raw !== 'string') return '';
  const key = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return key.length >= 4 && key.length <= 16 ? key : '';
}

/**
 * Never trust a client payload: check the shape, clamp the ranges, whitelist the enums.
 * Returns a clean sample, or null if the payload is unusable.
 */
export function sanitizeState(payload, now = Date.now()) {
  if (!payload || !Array.isArray(payload.p) || payload.p.length !== 3 || !payload.p.every(isFiniteNumber)) {
    return null;
  }
  return {
    p: payload.p.map((n) => clamp(n, -WORLD_BOUND, WORLD_BOUND)),
    r: isFiniteNumber(payload.r) ? payload.r : 0,
    a: ANIMATIONS.has(payload.a) ? payload.a : 'idle',
    v: isFiniteNumber(payload.v) ? clamp(payload.v, 0, MAX_SPEED) : 0,
    t: now,
  };
}

// ---- Voice chat signalling ------------------------------------------------------------------------
// The server never sees audio: it only relays the two browsers' connection setup messages (WebRTC
// offers, answers and ICE candidates). Each message is rebuilt from validated fields, so a client can't
// smuggle anything else through to its partner.

const SESSION_ID = /^[\w-]{1,32}$/;
const MAX_SDP = 24_000; // characters; a real audio-only offer is 1-4 thousand
const MAX_CANDIDATE = 1_000;

/**
 * { sid, kind: 'offer' | 'answer' | 'candidate' | 'bye' | 'hello', data }. Returns null if malformed.
 * 'hello' is the guest saying their page is ready to hear an offer (an offer sent earlier would have been lost).
 */
export function sanitizeVoiceSignal(payload) {
  const sid = payload?.sid;
  const kind = payload?.kind;
  const data = payload?.data;
  if (typeof sid !== 'string' || !SESSION_ID.test(sid)) return null;
  if (kind === 'bye' || kind === 'hello') return { sid, kind, data: null };
  if (kind === 'offer' || kind === 'answer') {
    if (typeof data?.sdp !== 'string' || data.sdp.length === 0 || data.sdp.length > MAX_SDP) return null;
    return { sid, kind, data: { sdp: data.sdp } };
  }
  if (kind === 'candidate') {
    const mid = data?.sdpMid;
    const index = data?.sdpMLineIndex;
    if (typeof data?.candidate !== 'string' || data.candidate.length > MAX_CANDIDATE) return null; // '' marks the end
    if (mid !== null && mid !== undefined && (typeof mid !== 'string' || mid.length > 64)) return null;
    if (index !== null && index !== undefined && !(Number.isInteger(index) && index >= 0 && index <= 8)) return null;
    return { sid, kind, data: { candidate: data.candidate, sdpMid: mid ?? null, sdpMLineIndex: index ?? null } };
  }
  return null;
}

// ---- Memories (photos the players add) ------------------------------------------------------------

export const MAX_MEMORY_BYTES = 1_500_000; // per photo; the client shrinks to about 300 KB
export const MAX_CAPTION = 140;

/** The image type of the bytes themselves (never the client's say-so), or null if it isn't WebP, JPEG or PNG. */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

/** A caption and a date from request headers: control characters removed, length capped, date checked. */
export function sanitizeMemoryMeta({ caption, date }) {
  let text = '';
  try {
    text = decodeURIComponent(typeof caption === 'string' ? caption : '');
  } catch {
    text = '';
  }
  text = text.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CAPTION);
  const iso = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) ? date : '';
  return { caption: text, date: iso };
}
