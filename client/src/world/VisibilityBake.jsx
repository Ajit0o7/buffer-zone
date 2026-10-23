import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { Vector3 } from 'three';
import { ROOMS } from './rooms';
import { bakeQueue, getTarget, updateViewer, viewer, visibilityReport } from './visibility';
import { useSession } from '../state/session';
import { localMotion } from './shared';
import { CAPSULE } from './config';

const GRID = 1.5; // one standing spot every 1.5 m across each room
const EYE_HEIGHTS = [1.7, 3.3]; // a standing player's eyes, and roughly where the follow camera rides
const PROBE_HEIGHT = 3.6; // floors are found by casting down from this far above the room's lowest point
const BUDGET_MS = 2; // bake work allowed per frame, so loading never hitches the render loop

/**
 * Bakes zone visibility with physics rays, a few milliseconds per frame, and tracks which rooms the
 * viewer (player and camera) is in. Must sit inside <Physics>.
 *
 * For every room it finds standing spots (a grid of downward rays that land on a floor belonging to
 * that room), then for every registered target (a painting's corners, a light) it asks: does any
 * standing spot in this room have a clear line of sight to any of the target's points? Only the
 * house and other fixed colliders block a line; players and curtains don't.
 */
export default function VisibilityBake() {
  const { world, rapier } = useRapier();
  const camera = useThree((s) => s.camera);
  const job = useRef(null);
  const eyes = useRef(null);

  // Development only: lets tests and the console inspect the bake.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__zones = { viewer, report: visibilityReport, pending: () => bakeQueue.length, spots: () => eyes.current && Object.fromEntries([...eyes.current].map(([k, v]) => [k, v.length])) };
    return () => delete window.__zones;
  }, []);

  useFrame(() => {
    // Which rooms the viewer is in; React hears only when the player's room changes (for the HUD).
    if (updateViewer(localMotion.position, camera.position) && viewer.playerRoom) {
      const session = useSession.getState();
      if (session.room !== viewer.playerRoom) session.setRoom(viewer.playerRoom);
    }
    if (!job.current && bakeQueue.length === 0) return;

    const filter = rapier.QueryFilterFlags.ONLY_FIXED;
    if (!eyes.current) {
      // Wait until the house's collider exists: a ray down onto the nave floor must land.
      const probe = world.castRay(new rapier.Ray({ x: -3, y: 3, z: 0 }, { x: 0, y: -1, z: 0 }), 6, true, filter);
      if (!probe) return;
      eyes.current = findStandingSpots(world, rapier, filter);
    }

    const start = performance.now();
    while (performance.now() - start < BUDGET_MS) {
      if (!job.current) {
        const id = bakeQueue.shift();
        if (id === undefined) return;
        job.current = bakeTarget(id, eyes.current, world, rapier, filter);
      }
      if (job.current.next().done) job.current = null;
    }
  });

  return null;
}

function findStandingSpots(world, rapier, filter) {
  const spots = new Map();
  const ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  for (const room of ROOMS) {
    const list = [];
    const top = room.min[1] + PROBE_HEIGHT;
    for (let x = room.min[0] + GRID / 2; x < room.max[0]; x += GRID) {
      for (let z = room.min[2] + GRID / 2; z < room.max[2]; z += GRID) {
        ray.origin = { x, y: top, z };
        const hit = world.castRay(ray, PROBE_HEIGHT + 2, true, filter);
        if (!hit || hit.timeOfImpact < 0.05) continue; // no floor, or the probe started inside a wall
        const floor = top - hit.timeOfImpact;
        const centre = floor + CAPSULE.center;
        if (centre < room.min[1] || centre > room.max[1]) continue; // someone standing here is in another room
        for (const h of EYE_HEIGHTS) list.push(new Vector3(x, floor + h, z));
      }
    }
    spots.set(room.id, list);
  }
  return spots;
}

const dir = new Vector3();

/** Generator: yields after each standing spot, so the bake can stop at any point and resume next frame. */
function* bakeTarget(id, spots, world, rapier, filter) {
  const target = getTarget(id);
  if (!target) return;
  const rooms = new Set();
  const ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  for (const room of ROOMS) {
    const list = spots.get(room.id);
    if (list.length === 0) {
      rooms.add(room.id); // nowhere to sample from: assume it can see everything
      continue;
    }
    search: for (const eye of list) {
      for (const point of target.points) {
        dir.subVectors(point, eye);
        const distance = dir.length();
        ray.origin = eye;
        ray.dir = dir.divideScalar(distance);
        if (!world.castRay(ray, distance - 0.05, true, filter)) {
          rooms.add(room.id);
          break search;
        }
      }
      yield;
    }
  }
  if (getTarget(id) === target) target.rooms = rooms; // unless it was moved and re-queued meanwhile
}
