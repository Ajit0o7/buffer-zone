// The courtyard's open top and what hangs in it (scene/Canopy.jsx), in world metres. Measured from the house's
// collision mesh: the courtyard walls stand at z ≈ 2.07 (north) and -2.97 (south) from the upper galleries up,
// x -11.75 to 10.35 between the end walls, and their tops are at about 15.75 m.

export const COURTYARD = { x0: -11.75, x1: 10.35, zNorth: 2.07, zSouth: -2.97, eaveY: 15.75, ridgeY: 16.9 };

// Two chandeliers on the courtyard's centre line, either side of the fountain, their hubs 9.4 m up: well above the
// upper balustrades (6.1 m), low enough to read as part of the room.
export const CHANDELIERS = [
  { x: -8.75, y: 9.4, z: -0.45 },
  { x: -2.25, y: 9.4, z: -0.45 },
];
