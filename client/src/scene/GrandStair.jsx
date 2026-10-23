import { useLayoutEffect, useMemo, useRef } from 'react';
import { ConvexHullCollider, CuboidCollider, RigidBody } from '@react-three/rapier';
import { BoxGeometry, Color, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { MANSION_SCALE } from '../world/config';
import { stoneMaterial } from './stone';

// Fitted to the house: the east bridge (upper floor) is reached over its balustrade, through the
// two-arched opening above it. Authored-scale numbers, converted to metres.
const S = MANSION_SCALE;
const BRIDGE_Y = 3.327 * S; // bridge floor (4.99 m)
export const LANDING = {
  west: 6.4 * S, // 9.6 m: the flight arrives here, just short of the balustrade
  east: 7.667 * S, // 11.5 m: past the balustrade, above the bridge floor
  south: -1.667 * S, // spans both arches of the opening
  north: 1.167 * S,
  top: 4.167 * S, // 6.25 m: clears the balustrade top (6.1 m)
  thickness: 0.4,
};
const HALF_WIDTH = 1.3; // the main flight is 2.6 m wide, clear of the urns beside the nave's centre line
const RUN = 0.28; // tread depth
const TARGET_RISE = 0.18; // riser height; the actual rise divides the height evenly
const RISERS = Math.round(LANDING.top / TARGET_RISE); // 35
const RISE = LANDING.top / RISERS;
export const STAIR_START = LANDING.west - (RISERS - 1) * RUN; // x of the first riser (0.08 m)
const DOWN_RISERS = Math.round((LANDING.top - BRIDGE_Y) / TARGET_RISE); // 7, onto the bridge
const DOWN_RISE = (LANDING.top - BRIDGE_Y) / DOWN_RISERS;
const RAIL_HEIGHT = 0.95; // handrail height above the treads
// The flight's dimensions, for seats and anything else placed on the steps.
export const FLIGHT = { run: RUN, rise: RISE, risers: RISERS, halfWidth: HALF_WIDTH };
/** The top of step k (0 is the lowest): its centre's x, and its height. */
export const stepTop = (k) => ({ x: STAIR_START + (k + 0.5) * RUN, y: (k + 1) * RISE });
export const NEWEL = { x: -0.25, z: HALF_WIDTH, height: 1.15 }; // the lanterns at the foot sit on these

// Tints. Stone parts are multiplied by the house's own floor texture (see stone.js); the carpet,
// being a strong colour, is left untextured.
const COLORS = {
  stone: new Color('#f2ece0'),
  rail: new Color('#fffaf0'),
  carpet: new Color('#6a1120'),
};
/** One box instance: centre, size, optional rotation about z (for sloped rails), colour. */
const box = (list, [x, y, z], [sx, sy, sz], color, tint = 0, rotZ = 0) => list.push({ x, y, z, sx, sy, sz, color, tint, rotZ });

function buildStair() {
  const parts = [];
  const carpetHalf = 0.8;

  // Main flight: solid masonry steps from the floor, a carpet runner on each tread and riser.
  for (let k = 0; k < RISERS - 1; k++) {
    const x0 = STAIR_START + k * RUN;
    const top = (k + 1) * RISE;
    box(parts, [x0 + RUN / 2, top / 2, 0], [RUN, top, HALF_WIDTH * 2], COLORS.stone, (k % 3) * 0.015);
    box(parts, [x0 + RUN / 2 + 0.005, top + 0.006, 0], [RUN + 0.01, 0.012, carpetHalf * 2], COLORS.carpet);
    box(parts, [x0 - 0.006, top - RISE / 2, 0], [0.012, RISE, carpetHalf * 2], COLORS.carpet);
  }
  // Landing slab. The runner stops short of the column between the two arches.
  const lx = (LANDING.west + LANDING.east) / 2;
  const lz = (LANDING.south + LANDING.north) / 2;
  const lw = LANDING.east - LANDING.west;
  box(parts, [lx, LANDING.top - LANDING.thickness / 2, lz], [lw, LANDING.thickness, LANDING.north - LANDING.south], COLORS.stone);
  box(parts, [LANDING.west + 0.375, LANDING.top + 0.006, 0], [0.75, 0.012, carpetHalf * 2], COLORS.carpet);
  box(parts, [LANDING.west - 0.006, LANDING.top - RISE / 2, 0], [0.012, RISE, carpetHalf * 2], COLORS.carpet);
  // Down onto the bridge: the full width of the opening.
  for (let j = 1; j < DOWN_RISERS; j++) {
    const x0 = LANDING.east + (j - 1) * RUN;
    const top = LANDING.top - j * DOWN_RISE;
    box(parts, [x0 + RUN / 2, (top + BRIDGE_Y) / 2, lz], [RUN, top - BRIDGE_Y, LANDING.north - LANDING.south], COLORS.stone);
    box(parts, [x0 + RUN / 2, top + 0.006, 0], [RUN, 0.012, carpetHalf * 2], COLORS.carpet);
  }

  // Balustrades: a baluster on every tread and a sloped handrail along each side of the flight.
  for (const side of [-1, 1]) {
    const z = side * (HALF_WIDTH - 0.07);
    for (let k = 0; k < RISERS - 1; k++) {
      const top = (k + 1) * RISE;
      box(parts, [STAIR_START + (k + 0.5) * RUN, top + (RAIL_HEIGHT - 0.06) / 2, z], [0.08, RAIL_HEIGHT - 0.06, 0.08], COLORS.rail);
    }
    const x0 = STAIR_START - RUN / 2;
    const x1 = LANDING.west;
    const y0 = RAIL_HEIGHT + RISE / 2;
    const y1 = LANDING.top + RAIL_HEIGHT;
    const length = Math.hypot(x1 - x0, y1 - y0);
    box(parts, [(x0 + x1) / 2, (y0 + y1) / 2, z], [length, 0.1, 0.16], COLORS.rail, 0, Math.atan2(y1 - y0, x1 - x0));
    box(parts, [NEWEL.x, NEWEL.height / 2, side * NEWEL.z], [0.26, NEWEL.height, 0.26], COLORS.rail);
    box(parts, [x1, LANDING.top + (RAIL_HEIGHT + 0.1) / 2, z], [0.22, RAIL_HEIGHT + 0.1, 0.22], COLORS.rail);
  }
  // Landing rails: the west edge beside the flight, where the nave falls away below.
  for (const [z0, z1] of [[LANDING.south, -HALF_WIDTH], [HALF_WIDTH, LANDING.north]]) {
    const x = LANDING.west + 0.06;
    for (let z = z0 + 0.15; z < z1 - 0.05; z += 0.3) box(parts, [x, LANDING.top + (RAIL_HEIGHT - 0.06) / 2, z], [0.08, RAIL_HEIGHT - 0.06, 0.08], COLORS.rail);
    box(parts, [x, LANDING.top + RAIL_HEIGHT, (z0 + z1) / 2], [0.16, 0.1, z1 - z0], COLORS.rail);
  }
  return parts;
}

/** Sloped solid under the steps, with its top through the middle of every tread: smooth to walk and camera-friendly. */
function flightHull() {
  const xs = STAIR_START - RUN / 2;
  const xe = LANDING.west + RUN / 2;
  const w = HALF_WIDTH;
  return [xs, 0, -w, xs, 0, w, xe, 0, -w, xe, 0, w, xe, LANDING.top, -w, xe, LANDING.top, w];
}

function downHull() {
  const xs = LANDING.east - RUN / 2;
  const xe = LANDING.east + (DOWN_RISERS - 0.5) * RUN;
  const [s, n] = [LANDING.south, LANDING.north];
  return [xs, BRIDGE_Y, s, xs, BRIDGE_Y, n, xs, LANDING.top, s, xs, LANDING.top, n, xe, BRIDGE_Y, s, xe, BRIDGE_Y, n];
}

/** A sloped wall along one side of the flight, so nobody walks off the edge halfway up. */
function railHull(side) {
  const xs = STAIR_START - RUN / 2;
  const xe = LANDING.west;
  const z0 = side * HALF_WIDTH;
  const z1 = side * (HALF_WIDTH + 0.1);
  const h = 1.1;
  const pts = [];
  for (const z of [z0, z1]) pts.push(xs, 0, z, xs, h, z, xe, LANDING.top, z, xe, LANDING.top + h, z);
  return pts;
}

const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpP = new Vector3();
const tmpS = new Vector3();
const tmpM = new Matrix4();
const tmpC = new Color();

/**
 * The grand staircase up the middle of the nave to the east bridge (the Upper Sunset Balcony).
 *
 * - Walking: the steps' collider is one smooth convex ramp through the middle of each tread, plus the
 *   landing and a short ramp down onto the bridge. The character controller climbs it like any slope
 *   (32°, under its 35° slide limit), so the camera doesn't bob on every step, and feet stay within a
 *   half riser (9 cm) of each tread.
 * - Drawing: every step, carpet strip, baluster, rail and newel is one instance of a single box, with
 *   a per-instance colour: one draw call for the whole staircase. Pass the house's floor texture as
 *   `stoneMap` so the stone matches the building.
 */
export default function GrandStair({ stoneMap = null }) {
  const mesh = useRef();
  const parts = useMemo(buildStair, []);
  const assets = useMemo(() => ({ geometry: new BoxGeometry(1, 1, 1), material: stoneMaterial(stoneMap, { roughness: 0.95, metalness: 0 }) }), [stoneMap]);

  useLayoutEffect(() => {
    const m = mesh.current;
    parts.forEach((p, i) => {
      tmpQ.setFromEuler(tmpE.set(0, 0, p.rotZ));
      m.setMatrixAt(i, tmpM.compose(tmpP.set(p.x, p.y, p.z), tmpQ, tmpS.set(p.sx, p.sy, p.sz)));
      m.setColorAt(i, tmpC.copy(p.color).offsetHSL(0, 0, -p.tint));
    });
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    return () => {
      assets.geometry.dispose();
      assets.material.dispose();
    };
  }, [parts, assets]);

  const lz = (LANDING.south + LANDING.north) / 2;
  // The landing's collider starts where the ramp reaches the landing's height (half a tread past its visible edge),
  // so there is no lip at the top of the flight: a capsule can't climb even a 9 cm edge while it is also on the slope,
  // and the player used to stall half a metre short of the landing.
  const landingStart = LANDING.west + RUN / 2;
  const landingHalf = [(LANDING.east - landingStart) / 2, LANDING.thickness / 2, (LANDING.north - LANDING.south) / 2];
  const sideRail = (z) => (
    <CuboidCollider args={[(LANDING.east - LANDING.west) / 2, 0.55, 0.05]} position={[(LANDING.west + LANDING.east) / 2, LANDING.top + 0.55, z]} />
  );

  return (
    <>
      <RigidBody type="fixed" colliders={false} friction={0.8}>
        <ConvexHullCollider args={[flightHull()]} />
        <ConvexHullCollider args={[railHull(-1)]} />
        <ConvexHullCollider args={[railHull(1)]} />
        <CuboidCollider args={landingHalf} position={[(landingStart + LANDING.east) / 2, LANDING.top - LANDING.thickness / 2, lz]} />
        <ConvexHullCollider args={[downHull()]} />
        {/* The landing's open edges: west, beside the flight, and both ends */}
        <CuboidCollider args={[0.05, 0.55, (-HALF_WIDTH - LANDING.south) / 2]} position={[LANDING.west + 0.06, LANDING.top + 0.55, (LANDING.south - HALF_WIDTH) / 2]} />
        <CuboidCollider args={[0.05, 0.55, (LANDING.north - HALF_WIDTH) / 2]} position={[LANDING.west + 0.06, LANDING.top + 0.55, (LANDING.north + HALF_WIDTH) / 2]} />
        {sideRail(LANDING.south - 0.05)}
        {sideRail(LANDING.north + 0.05)}
      </RigidBody>
      <instancedMesh ref={mesh} args={[assets.geometry, assets.material, parts.length]} receiveShadow />
    </>
  );
}
