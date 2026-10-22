// Gallery dimensions in metres, in each frame's local space: +Z points out of the wall into the room,
// the origin is on the wall surface at the centre of the painting.

export const PAINTING = { width: 1.5, height: 1.05, z: 0.083 };
export const FRAME = { width: 1.78, height: 1.33, depth: 0.08 };
export const BACKER_Z = 0.081; // velvet panel the painting sits on; doubles as the loading placeholder

export const CURTAIN = {
  width: FRAME.width + 0.5, // full width, both halves together
  height: FRAME.height + 0.75, // rod to hem
  rodY: FRAME.height / 2 + 0.42,
  z: 0.22, // how far the rod stands off the wall
  segmentsX: 28, // per half; enough for 7 smooth pleats
  segmentsY: 12,
};

export const ROD = { radius: 0.022, length: CURTAIN.width + 0.25 };
