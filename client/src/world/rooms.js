import { MANSION_SCALE } from './config';

// Zones are written at the house's authored scale (Sponza: x -15..15, z -9.5..9, floor at y = 0)
// and scaled with it, so they always line up with the geometry.
const zone = (id, min, max, music) => ({
  id,
  min: min.map((v) => v * MANSION_SCALE),
  max: max.map((v) => v * MANSION_SCALE),
  music, // relative background-music level inside the zone (0..1)
});

export const ROOMS = [
  zone('central-nave', [-6, -1, -4], [6, 12, 4], 0.5),
  zone('west-gallery', [-16, -1, -10], [-6, 12, 10], 0.9),
  zone('east-gallery', [6, -1, -10], [16, 12, 10], 1.0),
];

// In halls this size a hard switch at a zone edge is jarring, so music crossfades over this distance.
export const MUSIC_FADE_METRES = 6;
const OUTSIDE_LEVEL = 0.25;

const inside = (p, room) =>
  p.x >= room.min[0] && p.x <= room.max[0] &&
  p.y >= room.min[1] && p.y <= room.max[1] &&
  p.z >= room.min[2] && p.z <= room.max[2];

export const roomAt = (position) => ROOMS.find((room) => inside(position, room)) ?? null;

/** Distance from a point to a zone's box (0 inside). */
function distanceOutside(p, room) {
  const dx = Math.max(room.min[0] - p.x, 0, p.x - room.max[0]);
  const dy = Math.max(room.min[1] - p.y, 0, p.y - room.max[1]);
  const dz = Math.max(room.min[2] - p.z, 0, p.z - room.max[2]);
  return Math.hypot(dx, dy, dz);
}

/** Music level at a point: each zone's level, faded out over MUSIC_FADE_METRES beyond its edge. */
export function musicLevelAt(p) {
  let level = OUTSIDE_LEVEL;
  for (const room of ROOMS) {
    const w = Math.max(0, 1 - distanceOutside(p, room) / MUSIC_FADE_METRES);
    level = Math.max(level, OUTSIDE_LEVEL + (room.music - OUTSIDE_LEVEL) * w);
  }
  return level;
}
