import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, Color, IcosahedronGeometry, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { PRACTICALS } from '../world/rooms';
import { isVisible, registerTarget, unregisterTarget } from '../world/visibility';
import { localMotion } from '../world/shared';
import { MANSION_SCALE } from '../world/config';
import { damp } from '../utils/math';
import { NEWEL } from './GrandStair';
import { stoneMaterial } from './stone';

const POOL_SIZE = 3; // point lights in the scene, ever: the nearest practicals borrow them
const LIGHT_DISTANCE = 10; // metres; each light's reach is cut off here, so it costs nothing beyond
const SELECT_RADIUS = LIGHT_DISTANCE + 3; // practicals farther than this from the player stay dark
const FADE = 4; // how fast a practical fades in or out when it gains or loses a light

const FINISH = {
  stone: new Color('#e6ddcc'), // a tint: stone parts take the house's texture (stone.js)
  brass: new Color('#a8854f'),
  iron: new Color('#2b2622'),
  soot: new Color('#1a1210'),
  log: new Color('#2a1a10'),
  wax: new Color('#efe6d2'),
};
const hot = (hex, boost) => new Color(hex).multiplyScalar(boost); // above 1: catches the bloom pass

/**
 * Prop parts per kind, relative to the practical's floor point (the floor below its light).
 * Solid parts are [x, y, z, sx, sy, sz, colour]; glowing parts add a flicker weight (0 = steady).
 */
function partsFor(p) {
  const solid = [];
  const glow = [];
  const S = (x, y, z, sx, sy, sz, c) => solid.push({ x, y, z, sx, sy, sz, c });
  const G = (x, y, z, sx, sy, sz, c, flick = 0) => glow.push({ x, y, z, sx, sy, sz, c, flick });
  const lantern = (x, y, z) => {
    S(x, y + 0.02, z, 0.26, 0.04, 0.26, FINISH.iron);
    for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) S(x + dx * 0.11, y + 0.2, z + dz * 0.11, 0.02, 0.34, 0.02, FINISH.iron);
    S(x, y + 0.38, z, 0.3, 0.05, 0.3, FINISH.iron);
    S(x, y + 0.46, z, 0.06, 0.1, 0.06, FINISH.iron);
    G(x, y + 0.2, z, 0.1, 0.14, 0.1, hot(p.color, 2.6), 0.3);
  };
  const light = p.position;
  switch (p.kind) {
    case 'hearth': {
      // Against the north wall (54 cm behind the fire), facing the room.
      const w = 0.54;
      S(0, 0.04, w - 0.75, 2.6, 0.08, 0.7, FINISH.stone); // hearth stone
      S(-1, 0.65, w - 0.3, 0.4, 1.3, 0.6, FINISH.stone); // jambs
      S(1, 0.65, w - 0.3, 0.4, 1.3, 0.6, FINISH.stone);
      S(0, 1.15, w - 0.3, 1.6, 0.3, 0.6, FINISH.stone); // lintel
      S(0, 1.36, w - 0.36, 2.6, 0.12, 0.72, FINISH.stone); // mantel shelf
      S(0, 0.5, w - 0.05, 1.6, 1.0, 0.1, FINISH.soot); // firebox
      S(0, 0.09, w - 0.3, 1.6, 0.02, 0.5, FINISH.soot);
      S(0, 0.16, w - 0.32, 1.0, 0.12, 0.14, FINISH.log); // logs
      S(0.05, 0.26, w - 0.26, 0.9, 0.1, 0.12, FINISH.log);
      G(0, 0.21, w - 0.3, 0.5, 0.05, 0.16, hot('#ff4a12', 3)); // embers
      G(-0.26, 0.42, w - 0.3, 0.12, 0.26, 0.09, hot('#ff9a3a', 3.2), 1); // flames
      G(0.04, 0.47, w - 0.3, 0.15, 0.32, 0.1, hot('#ffb24a', 3.2), 1);
      G(0.3, 0.4, w - 0.3, 0.11, 0.24, 0.09, hot('#ff8a30', 3.2), 1);
      break;
    }
    case 'lamp': {
      // A brass floor lamp; the light is its globe, 1.7 m up.
      S(0, 0.02, 0, 0.36, 0.04, 0.36, FINISH.brass);
      S(0, 0.8, 0, 0.035, 1.56, 0.035, FINISH.brass);
      S(0, 1.56, 0, 0.12, 0.05, 0.12, FINISH.brass);
      G(0, 1.7, 0, 0.16, 0.16, 0.16, hot(p.color, 2.2));
      break;
    }
    case 'candles': {
      // A three-branch iron candelabrum; the light is its flames, 1.5 m up.
      S(0, 0.03, 0, 0.34, 0.06, 0.34, FINISH.iron);
      S(0, 0.65, 0, 0.05, 1.25, 0.05, FINISH.iron);
      S(0, 1.27, 0, 0.62, 0.04, 0.04, FINISH.iron);
      for (const x of [-0.29, 0, 0.29]) {
        S(x, 1.3, 0, 0.08, 0.03, 0.08, FINISH.iron);
        S(x, 1.38, 0, 0.035, 0.14, 0.035, FINISH.wax);
        G(x, 1.48, 0, 0.022, 0.05, 0.022, hot(p.color, 4), 1);
      }
      break;
    }
    case 'newels': {
      // Lanterns on the two newel posts at the foot of the grand stair (the posts belong to the stair).
      for (const side of [-1, 1]) lantern(NEWEL.x - light.x, NEWEL.height, side * NEWEL.z - light.z);
      break;
    }
    case 'lanterns': {
      // Two lanterns on stone posts, flanking the foot of the steps down onto the bridge.
      for (const z of [-2.5, 2.35]) {
        S(0, 0.6, z, 0.24, 1.2, 0.24, FINISH.stone);
        lantern(0, 1.2, z);
      }
      break;
    }
    default:
  }
  return { solid, glow };
}

const tmpM = new Matrix4();
const tmpP = new Vector3();
const tmpS = new Vector3();
const IDENTITY = new Quaternion();
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

const flicker = (t, phase) => 0.55 * Math.sin(7.3 * t + phase) + 0.3 * Math.sin(13.1 * t + 2 * phase) + 0.15 * Math.sin(23.9 * t + 3 * phase);

/**
 * The house's practical lights (world/rooms.js PRACTICALS): their props, and the point lights that
 * make them glow.
 *
 * - A fixed pool of POOL_SIZE point lights, each cut off at LIGHT_DISTANCE, is handed to the nearest
 *   practicals that can be seen from the viewer's rooms; the rest are dark. Lights fade as they change
 *   hands, and the light count, and so every lit shader, never changes. None casts shadows: the house
 *   keeps a single shadow-casting light.
 * - Props are boxes and glowing icosahedra in two instanced meshes: two draw calls for every lamp,
 *   candelabrum, lantern and the hearth. A practical that can't be seen from the viewer's rooms has
 *   its props hidden too.
 */
export default function Practicals({ stoneMap = null }) {
  const solidMesh = useRef();
  const glowMesh = useRef();
  const lights = useRef([]);

  const layout = useMemo(() => {
    const solid = [];
    const glow = [];
    const items = PRACTICALS.map((p, index) => {
      const floor = p.position.clone();
      floor.y = p.kind === 'lanterns' ? 3.327 * MANSION_SCALE : p.kind === 'newels' ? 0 : p.position.y - partsHeight(p);
      const parts = partsFor(p);
      const item = {
        ...p,
        index,
        floor,
        sightId: `light:${p.id}`,
        solid: [solid.length, solid.length + parts.solid.length],
        glow: [glow.length, glow.length + parts.glow.length],
        level: 0,
        shown: true,
        phase: index * 1.7,
        base: new Color(p.color),
      };
      solid.push(...parts.solid.map((part) => ({ ...part, item })));
      glow.push(...parts.glow.map((part) => ({ ...part, item })));
      return item;
    });
    return { items, solid, glow };
  }, []);

  const assets = useMemo(
    () => ({
      box: new BoxGeometry(1, 1, 1),
      ball: new IcosahedronGeometry(1, 1),
      solid: stoneMaterial(stoneMap, { roughness: 0.35, metalness: 0.85 }), // brass where tinted, stone elsewhere
      glow: new MeshBasicMaterial(),
    }),
    [stoneMap],
  );

  const writePart = (mesh, i, part, flick = 0) => {
    const f = part.item.floor;
    const k = 1 + 0.3 * flick;
    mesh.setMatrixAt(i, tmpM.compose(tmpP.set(f.x + part.x, f.y + part.y, f.z + part.z), IDENTITY, tmpS.set(part.sx, part.sy * k, part.sz)));
  };

  useLayoutEffect(() => {
    layout.solid.forEach((part, i) => {
      writePart(solidMesh.current, i, part);
      solidMesh.current.setColorAt(i, part.c);
    });
    layout.glow.forEach((part, i) => {
      writePart(glowMesh.current, i, part);
      glowMesh.current.setColorAt(i, part.c);
    });
    for (const m of [solidMesh.current, glowMesh.current]) {
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [layout, assets]);

  useEffect(() => {
    // Visibility is tested from the light and four points around it, a metre out: roughly where its glow lands.
    for (const item of layout.items) {
      const p = item.position;
      const around = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => new Vector3(p.x + dx, p.y, p.z + dz));
      registerTarget(item.sightId, [p, ...around]);
    }
    return () => {
      for (const item of layout.items) unregisterTarget(item.sightId);
      assets.box.dispose();
      assets.ball.dispose();
      assets.solid.dispose();
      assets.glow.dispose();
    };
  }, [layout, assets]);

  const ranked = useMemo(() => [], []);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const t = state.clock.elapsedTime;
    const player = localMotion.position;

    // 1. Which practicals deserve a light: visible from the viewer's rooms and near enough, nearest first.
    ranked.length = 0;
    for (const item of layout.items) {
      item.visible = isVisible(item.sightId);
      item.distance = item.position.distanceTo(player);
      if (item.visible && item.distance < (item.reach ? item.reach + 3 : SELECT_RADIUS)) ranked.push(item);
    }
    ranked.sort((a, b) => a.distance - b.distance);
    for (const item of layout.items) {
      const rank = ranked.indexOf(item);
      const wanted = rank > -1 && rank < POOL_SIZE;
      item.level = damp(item.level, wanted ? 1 : 0, FADE, dt);
      if (item.level < 0.002) item.level = 0;
    }

    // 2. Hand the pool to the brightest (fading ones finish fading out first, so nothing pops).
    ranked.length = 0;
    for (const item of layout.items) if (item.level > 0) ranked.push(item);
    ranked.sort((a, b) => b.level - a.level);
    for (let k = 0; k < POOL_SIZE; k++) {
      const light = lights.current[k];
      const item = ranked[k];
      if (!item) {
        light.intensity = 0;
        continue;
      }
      light.position.copy(item.position);
      light.color.copy(item.base);
      light.distance = item.reach ?? LIGHT_DISTANCE; // the chandeliers reach further than lamps
      light.intensity = item.intensity * item.level * (1 + 0.25 * (item.flicker ?? 0) * flicker(t, item.phase));
    }

    // 3. Props: hide those that can't be seen; animate the flames of those that can.
    let dirtySolid = false;
    let dirtyGlow = false;
    for (const item of layout.items) {
      const changed = item.visible !== item.shown;
      if (changed) {
        item.shown = item.visible;
        for (let i = item.solid[0]; i < item.solid[1]; i++) {
          if (item.shown) writePart(solidMesh.current, i, layout.solid[i]);
          else solidMesh.current.setMatrixAt(i, HIDDEN);
        }
        dirtySolid = true;
      }
      if (!changed && !item.shown) continue;
      for (let i = item.glow[0]; i < item.glow[1]; i++) {
        const part = layout.glow[i];
        if (!item.shown) glowMesh.current.setMatrixAt(i, HIDDEN);
        else if (changed || part.flick > 0) writePart(glowMesh.current, i, part, part.flick * flicker(t * 1.6, item.phase + i));
        else continue;
        dirtyGlow = true;
      }
    }
    if (dirtySolid) solidMesh.current.instanceMatrix.needsUpdate = true;
    if (dirtyGlow) glowMesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={solidMesh} args={[assets.box, assets.solid, layout.solid.length]} receiveShadow />
      <instancedMesh ref={glowMesh} args={[assets.ball, assets.glow, layout.glow.length]} />
      {Array.from({ length: POOL_SIZE }, (_, k) => (
        <pointLight key={k} ref={(el) => (lights.current[k] = el)} intensity={0} distance={LIGHT_DISTANCE} decay={2} />
      ))}
    </>
  );
}

/** Height of a practical's light above its floor, per kind. */
function partsHeight(p) {
  if (p.kind === 'hearth') return 0.55;
  if (p.kind === 'candles') return 1.5;
  return 1.7; // lamps
}
