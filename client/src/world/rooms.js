// Axis-aligned zones in metres, Y-up. They must match the mansion layout in the GLB.
// `music` is the relative background-music level for the zone (0..1).
export const ROOMS = [
  { id: 'entrance-hall', min: [-6, -1, -12], max: [6, 6, -4], music: 0.45 },
  { id: 'bedroom', min: [-12, -1, -4], max: [-2, 6, 6], music: 1.0 },
  { id: 'lounge', min: [4, -1, -4], max: [14, 6, 6], music: 0.3 },
];

const inside = (p, room) =>
  p.x >= room.min[0] && p.x <= room.max[0] &&
  p.y >= room.min[1] && p.y <= room.max[1] &&
  p.z >= room.min[2] && p.z <= room.max[2];

export const roomAt = (position) => ROOMS.find((room) => inside(position, room)) ?? null;
