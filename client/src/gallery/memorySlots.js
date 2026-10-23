import { PHOTOS } from './photos';

// Wall spots for the photos the players add themselves ("Add memory"), at the house's authored scale like
// photos.js. They were picked from the same flat-wall, line-of-sight search as the permanent paintings,
// spread over the corridor and the balcony. The server hands a new photo the lowest free spot, so both
// players hang it in the same place. Each is set aside as an unused instance in the gallery batch.

export const MAX_MEMORIES = 12; // keep equal to MAX_MEMORIES_PER_ROOM in server/src/rooms.js

const GROUND = 1.333;
const UPPER = 4.667;
const FACE = { north: [0, Math.PI, 0], south: [0, 0, 0], west: [0, Math.PI / 2, 0] };
const slot = (room, position, rotation) => ({ room, position, rotation });

export const MEMORY_SLOTS = [
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

/** Instances the gallery batch is built with: every permanent painting, then a spot per possible memory. */
export const GALLERY_CAPACITY = PHOTOS.length + MAX_MEMORIES;

/**
 * A memory from the server as a gallery entry, in its slot's place. `url` is where its image is served.
 * Curtain ids must match the server's /^[\w-]{1,64}$/, which a server-made id already does.
 */
export function memoryAsPhoto(memory, url) {
  const spot = MEMORY_SLOTS[memory.index];
  return {
    id: `m-${memory.id}`,
    memoryId: memory.id,
    slot: PHOTOS.length + memory.index,
    src: url,
    room: spot.room,
    category: 'memories',
    caption: memory.caption || 'A new memory',
    date: memory.date,
    position: spot.position,
    rotation: spot.rotation,
  };
}
