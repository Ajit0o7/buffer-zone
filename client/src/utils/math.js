// Frame-rate independent smoothing. `lambda` is the responsiveness (higher = snappier).
export const damp = (current, target, lambda, dt) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

// Shortest-arc version for angles in radians.
export const dampAngle = (current, target, lambda, dt) =>
  current + Math.atan2(Math.sin(target - current), Math.cos(target - current)) * (1 - Math.exp(-lambda * dt));
