import { Vector3 } from 'three';

// Per-frame state lives outside React on purpose: 60 fps writes must not trigger re-renders.

/** The local player's motion, written by LocalPlayer and read by its Avatar and the audio system. */
export const localMotion = {
  position: new Vector3(),
  yaw: 0,
  speed: 0,
  anim: 'idle',
};

// Partner snapshots are stamped with the LOCAL receive time, so no clock sync with the server is needed.
// RemotePlayer renders INTERP_DELAY_MS in the past and blends between the two snapshots that bracket it.
const MAX_SNAPSHOTS = 12;
const snapshots = []; // ordered oldest -> newest: { at, p: [x,y,z], r, v, a }

export const remote = {
  hasData: false,
  pushSnapshot(sample, at = performance.now()) {
    snapshots.push({ at, p: sample.p, r: sample.r, v: sample.v, a: sample.a });
    if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();
    this.hasData = true;
  },
  /** Samples the partner's state `delayMs` in the past. Returns null until data exists. */
  sample(renderAt, out) {
    const n = snapshots.length;
    if (n === 0) return null;
    if (n === 1 || renderAt <= snapshots[0].at) return fill(out, snapshots[0], snapshots[0], 0);
    for (let i = 1; i < n; i++) {
      const a = snapshots[i - 1];
      const b = snapshots[i];
      if (renderAt <= b.at) return fill(out, a, b, (renderAt - a.at) / (b.at - a.at || 1));
    }
    // Ran out of buffer (lost packets): hold the newest pose rather than extrapolating.
    const last = snapshots[n - 1];
    return fill(out, last, last, 0);
  },
};

function fill(out, a, b, t) {
  out.position.set(
    a.p[0] + (b.p[0] - a.p[0]) * t,
    a.p[1] + (b.p[1] - a.p[1]) * t,
    a.p[2] + (b.p[2] - a.p[2]) * t,
  );
  out.yaw = a.r + shortestAngle(a.r, b.r) * t;
  out.speed = a.v + (b.v - a.v) * t;
  out.anim = t < 0.5 ? a.a : b.a;
  return out;
}

function shortestAngle(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}
