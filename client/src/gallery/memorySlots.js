import { PHOTOS } from './photos';

import { MANSION_SCALE } from '../world/config';

// Where the photos the players add themselves ("Add memory") can hang. Every painting's curtain is a spot: a photo
// hung there takes the painting's place (and the painting comes back if the photo is taken down). Then come extra
// spots, at the house's authored scale like photos.js, picked from the same flat-wall, line-of-sight search as the
// paintings and spread over the corridor and the balcony.
//
// A new photo hangs on the curtain the player is standing at: the client lists the free spots nearest first, and
// the server takes the first one still free, so both players hang it in the same place.

const GROUND = 1.333;
const UPPER = 4.667;
const FACE = { north: [0, Math.PI, 0], south: [0, 0, 0], west: [0, Math.PI / 2, 0] };
const slot = (room, position, rotation) => ({ room, position, rotation });

const EXTRA_SLOTS = [
  slot('corridor', [-10.4, GROUND, -5.147], FACE.south), // the south aisle's free walls
  slot('corridor', [8.2, GROUND, -5.147], FACE.south),
  slot('balcony', [-11.45, UPPER, -3.333], FACE.west), // the west end of the upper galleries
  slot('balcony', [-11.45, UPPER, 2.667], FACE.west),
  slot('balcony', [-6.333, UPPER, -5.127], FACE.south), // along the upper galleries
  slot('balcony', [-6.333, UPPER, 4.6], FACE.north),
  slot('balcony', [1, UPPER, -5.127], FACE.south),
  slot('balcony', [1, UPPER, 4.6], FACE.north),
  slot('balcony', [-9, UPPER, -5.127], FACE.south),
  slot('balcony', [-9, UPPER, 4.6], FACE.north),
  slot('balcony', [7, UPPER, -5.127], FACE.south),
  slot('balcony', [7, UPPER, 4.6], FACE.north),
];

/** Every spot: the paintings first (spot i is painting i), then the extra ones. Spot n is gallery instance n. */
export const SPOTS = [...PHOTOS.map(({ room, position, rotation }) => ({ room, position, rotation })), ...EXTRA_SLOTS];
export const MEMORY_SPOTS = SPOTS.length; // keep equal to MEMORY_SPOTS in server/src/rooms.js (30)

/** Instances the gallery batch is built with: one per spot. */
export const GALLERY_CAPACITY = SPOTS.length;

const CENTRE_ABOVE_PLAYER = 1.1; // a frame's centre hangs 2 m up; a standing player's capsule centre is 0.9 m up
const FLOOR_PENALTY = 4; // metres of distance per metre of height difference, so the floor above or below is "far"

/**
 * Free spots, nearest first, for a player at `position` (a capsule centre). The painting whose curtain is open in
 * front of them (`facingId`, a painting's id) comes first when it's free: that's the one they mean.
 */
export function spotsNearest(position, taken, facingId = null) {
  const scored = [];
  SPOTS.forEach((spot, n) => {
    if (taken.has(n)) return;
    const [x, y, z] = spot.position;
    const dx = x * MANSION_SCALE - position.x;
    const dz = z * MANSION_SCALE - position.z;
    const dy = Math.abs(y * MANSION_SCALE - (position.y + CENTRE_ABOVE_PLAYER));
    let score = Math.hypot(dx, dz) + FLOOR_PENALTY * dy;
    if (n < PHOTOS.length && PHOTOS[n].id === facingId) score = -1;
    scored.push([score, n]);
  });
  return scored.sort((a, b) => a[0] - b[0]).map(([, n]) => n);
}

/**
 * A memory from the server as a gallery entry, in its slot's place. `url` is where its image is served.
 * Curtain ids must match the server's /^[\w-]{1,64}$/, which a server-made id already does.
 */
export function memoryAsPhoto(memory, url) {
  const spot = SPOTS[memory.spot] ?? SPOTS[SPOTS.length - 1];
  return {
    id: `m-${memory.id}`,
    memoryId: memory.id,
    slot: memory.spot,
    src: url,
    room: spot.room,
    category: 'memories',
    caption: memory.caption || 'A new memory',
    date: memory.date,
    position: spot.position,
    rotation: spot.rotation,
  };
}
