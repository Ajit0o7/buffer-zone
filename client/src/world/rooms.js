// Zones in metres, Y-up, matched to the house (about x -15..15, z -9.5..9, floor at y = 0).
// `music` is the relative background-music level for the zone (0..1).
export const ROOMS = [
  { id: 'central-nave', min: [-6, -1, -4], max: [6, 12, 4], music: 0.5 },
  { id: 'west-gallery', min: [-16, -1, -10], max: [-6, 12, 10], music: 0.9 },
  { id: 'east-gallery', min: [6, -1, -10], max: [16, 12, 10], music: 1.0 },
];

const inside = (p, room) =>
  p.x >= room.min[0] && p.x <= room.max[0] &&
  p.y >= room.min[1] && p.y <= room.max[1] &&
  p.z >= room.min[2] && p.z <= room.max[2];

export const roomAt = (position) => ROOMS.find((room) => inside(position, room)) ?? null;
