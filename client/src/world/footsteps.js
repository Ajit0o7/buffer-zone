// Foot contacts, from the avatars' own animation to the audio. Avatar.jsx pushes one event each time a
// foot lands; SpatialAudio.jsx drains the queue every frame. Plain module state, not React state.

const MAX_PENDING = 16; // a stalled tab can't build up a burst of steps to play at once

export const steps = []; // { x, y, z, speed, foot: 0 | 1, own: boolean }

export function pushStep(step) {
  if (steps.length >= MAX_PENDING) steps.shift();
  steps.push(step);
}
