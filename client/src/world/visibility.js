import { roomAt } from './rooms';

/**
 * Zone culling. Which rooms can see each painting and light is baked at load with physics rays
 * (world/VisibilityBake.jsx); each frame, things that can't be seen from the rooms the viewer is in
 * are skipped: hidden instances, unlit lights, no spotlight.
 *
 * Nothing is culled until its bake has finished, and a room with no sample points sees everything,
 * so a failed or partial bake only costs performance, never a missing painting.
 */

const targets = new Map(); // id -> { points: Vector3[], rooms: Set<roomId> | null (not baked yet) }
export const bakeQueue = [];

/** Rooms the viewer is in: the player's and the camera's (they differ near doorways and on the stair). */
export const viewer = { rooms: new Set(), playerRoom: null, cameraRoom: null };

/** Adds (or re-adds, after it moved) a point set to bake: a painting's corners, a light's position. */
export function registerTarget(id, points) {
  targets.set(id, { points, rooms: null });
  if (!bakeQueue.includes(id)) bakeQueue.push(id);
}

export function unregisterTarget(id) {
  targets.delete(id);
  const i = bakeQueue.indexOf(id);
  if (i >= 0) bakeQueue.splice(i, 1);
}

export const getTarget = (id) => targets.get(id);

/** For tests and the console: each target's baked rooms (null while waiting to be baked). */
export const visibilityReport = () =>
  Object.fromEntries([...targets].map(([id, t]) => [id, t.rooms ? [...t.rooms] : null]));

/** True if the target could be on screen from the viewer's rooms (or if that isn't known yet). */
export function isVisible(id) {
  const t = targets.get(id);
  if (!t || !t.rooms || viewer.rooms.size === 0) return true;
  for (const r of viewer.rooms) if (t.rooms.has(r)) return true;
  return false;
}

/** Updates the viewer's rooms. Returns true when they changed. */
export function updateViewer(playerPosition, cameraPosition) {
  const player = roomAt(playerPosition)?.id ?? null;
  const camera = roomAt(cameraPosition)?.id ?? null;
  if (player === viewer.playerRoom && camera === viewer.cameraRoom) return false;
  viewer.playerRoom = player;
  viewer.cameraRoom = camera;
  viewer.rooms.clear();
  if (player) viewer.rooms.add(player);
  if (camera) viewer.rooms.add(camera);
  return true;
}

