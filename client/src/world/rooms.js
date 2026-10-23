import { Vector3 } from 'three';
import { MANSION_SCALE } from './config';

// The mansion's rooms. Coordinates are written at the house's authored scale (Sponza: x -11.4..10.4,
// z -5.2..5.2, ground floor at y = 0, upper floor at y = 3.33) and multiplied by MANSION_SCALE, so they
// always line up with the geometry. Bounds hold the player's capsule centre, which is 0.9 m above the floor.
const S = MANSION_SCALE;
const scaled = (v) => v.map((n) => n * S);

const room = ({ id, name, min, max, music }) => ({
  id,
  name,
  min: scaled(min),
  max: scaled(max),
  music, // relative background-music level inside the room (0..1)
});

/**
 * Listed in priority order: the first room whose box holds a point wins, so the balcony (everything
 * on the upper floor) is checked before the ground-floor rooms beneath it.
 *
 *   Grand Atrium           the open nave, where both players spawn and the grand stair rises
 *   Memory Corridor        the south aisle, a long gallery of everyday moments
 *   Study & Library        the west half of the north aisle: early days
 *   Living Salon & Hearth  the east half of the north aisle, around the fireplace: milestones
 *   Upper Sunset Balcony   the upper galleries and the east bridge, reached by the stair: travels
 */
export const ROOMS = [
  room({ id: 'balcony', name: 'Upper Sunset Balcony', min: [-11.8, 3.05, -5.4], max: [10.8, 8, 5.4], music: 1.0 }),
  room({ id: 'corridor', name: 'Memory Corridor', min: [-11.8, -1, -5.4], max: [10.8, 3.05, -3], music: 0.75 }),
  room({ id: 'study', name: 'Study & Library', min: [-11.8, -1, 3], max: [0, 3.05, 5.4], music: 0.6 }),
  room({ id: 'salon', name: 'Living Salon & Hearth', min: [0, -1, 3], max: [10.8, 3.05, 5.4], music: 0.85 }),
  room({ id: 'atrium', name: 'Grand Atrium', min: [-11.8, -1, -3], max: [10.8, 3.05, 3], music: 0.5 }),
];
export const ROOM_BY_ID = Object.fromEntries(ROOMS.map((r) => [r.id, r]));

/**
 * Practical lights: the hearth, lamps, candles and lanterns that light each room. They are served by
 * a small fixed pool of point lights (scene/Practicals.jsx) that follows the player, so the light count,
 * and with it every lit shader, never changes. `kind` picks the prop drawn around the light.
 * Positions are where the flame or bulb sits.
 */
const practical = (id, roomId, kind, position, extra = {}) => ({ id, room: roomId, kind, position: new Vector3(...position).multiplyScalar(S), ...extra });
export const PRACTICALS = [
  practical('hearth', 'salon', 'hearth', [2.333, 0.37, 4.233], { color: '#ff8a3d', intensity: 34, flicker: 1 }),
  practical('study-lamp-west', 'study', 'lamp', [-8.533, 1.13, 4.267], { color: '#ffd9a0', intensity: 14 }),
  practical('study-lamp-east', 'study', 'lamp', [-5.267, 1.13, 4.267], { color: '#ffd9a0', intensity: 14 }),
  practical('corridor-candles-west', 'corridor', 'candles', [-4.967, 1.0, -4.8], { color: '#ffc46b', intensity: 10, flicker: 0.4 }),
  practical('corridor-candles-east', 'corridor', 'candles', [4.033, 1.0, -4.8], { color: '#ffc46b', intensity: 10, flicker: 0.4 }),
  practical('stair-foot', 'atrium', 'newels', [-0.167, 0.93, 0], { color: '#ffb35c', intensity: 16, flicker: 0.15 }),
  practical('bridge-lanterns', 'balcony', 'lanterns', [9.1, 4.27, -0.2], { color: '#ffb35c', intensity: 16, flicker: 0.15 }),
  practical('balcony-north', 'balcony', 'lamp', [0.667, 4.46, 4.2], { color: '#ffcf8f', intensity: 14 }),
  practical('balcony-south', 'balcony', 'lamp', [0.667, 4.46, -4.733], { color: '#ffcf8f', intensity: 14 }),
];

const inside = (p, r) =>
  p.x >= r.min[0] && p.x <= r.max[0] &&
  p.y >= r.min[1] && p.y <= r.max[1] &&
  p.z >= r.min[2] && p.z <= r.max[2];

/** The room holding a point (a capsule centre or a camera position), or null outside the house. */
export const roomAt = (position) => ROOMS.find((r) => inside(position, r)) ?? null;

// In halls this size a hard switch at a room edge is jarring, so music crossfades over this distance.
export const MUSIC_FADE_METRES = 6;
const OUTSIDE_LEVEL = 0.25;

/** Distance from a point to a room's box (0 inside). */
function distanceOutside(p, r) {
  const dx = Math.max(r.min[0] - p.x, 0, p.x - r.max[0]);
  const dy = Math.max(r.min[1] - p.y, 0, p.y - r.max[1]);
  const dz = Math.max(r.min[2] - p.z, 0, p.z - r.max[2]);
  return Math.hypot(dx, dy, dz);
}

/** Music level at a point: each room's level, faded out over MUSIC_FADE_METRES beyond its edge. */
export function musicLevelAt(p) {
  let level = OUTSIDE_LEVEL;
  for (const r of ROOMS) {
    const w = Math.max(0, 1 - distanceOutside(p, r) / MUSIC_FADE_METRES);
    level = Math.max(level, OUTSIDE_LEVEL + (r.music - OUTSIDE_LEVEL) * w);
  }
  return level;
}
