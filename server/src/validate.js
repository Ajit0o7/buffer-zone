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
