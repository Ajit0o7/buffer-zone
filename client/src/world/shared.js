import { Vector3 } from 'three';

// Per-frame state lives outside React on purpose: 60 fps writes must not trigger re-renders.

/** The local player's motion, written by LocalPlayer and read by its Avatar and the audio system. */
export const localMotion = {
  position: new Vector3(),
  yaw: 0,
  speed: 0,
  anim: 'idle',
};

/** Latest authoritative sample from the partner, written by the socket listener in net/socket.js. */
export const remoteTarget = {
  position: new Vector3(),
  yaw: 0,
  speed: 0,
  anim: 'idle',
  hasData: false,
};
