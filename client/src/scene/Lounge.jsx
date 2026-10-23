import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import {
  BENCH_SIZE,
  Batch,
  COFFEE,
  FINISH,
  SIDE_TABLE,
  T,
  chesterfield,
  coffeeTable,
  flameGeometry,
  grandPiano,
  lampshadeGeometry,
  pianoBench,
  pianoKeys,
  placement,
  sideTable,
  under,
} from './lounge/furniture';
import { marbleTexture, rugTexture } from './lounge/textures';

// The lounge in the covered west alcove at the end of the courtyard (free floor x -16.5..-11.0, z -2.6..1.7), in
// world metres. The seating group sits under the lion relief on the west wall, facing the courtyard; the piano
// stands in the north-east corner with its spine along the north side, so the alcove stays open from the east
// along its southern two thirds.

const SOFA = { x: -15.99, z: -0.45, yaw: Math.PI / 2, width: 2.2, depth: 0.92 };
const CHAIR = { width: 0.98, depth: 0.86 };
const TURN = 0.12; // the armchairs face each other across the table, turned this far toward the sofa
// Each armchair stands 0.8 m clear of the table's end: room for a player to walk in to the sofa, and to stand up.
const CHAIRS = [
  { id: 'north', x: -14.55, z: 1.19, yaw: Math.PI + TURN },
  { id: 'south', x: -14.55, z: -2.09, yaw: -TURN },
];
const TABLE = { x: -14.42, z: -0.45 };
const SIDE_TABLES = [
  { id: 'lamp', x: -16.08, z: -2.05 },
  { id: 'roses', x: -16.08, z: 1.15 },
];
// The piano's frame: keyboard front edge at the origin, the case running back toward -x (west), spine to the north.
const PIANO_AT = { x: -11.8, z: 0.9, yaw: -Math.PI / 2 };
const BENCH_AT = -0.62; // the bench's centre, in front of the keys (piano frame z)
const RUG = { x: -14.8, z: -0.45, length: 4.1, width: 2.9, fringe: 0.08, y: 0.012 };

const SEAT_TOP = 0.45;
const PELVIS_IN = 0.02; // the pelvis sits this far forward of the seat cushion's middle (furniture frame z)
const STAND_OFF = { sofa: 0.82, chair: 0.85 }; // from pelvis to standing spot: clear of the seat by a capsule radius

/** A point given in a piece's frame (x across, z forward), in world metres. */
function toWorld(piece, lx, ly, lz) {
  const c = Math.cos(piece.yaw);
  const s = Math.sin(piece.yaw);
  return { x: piece.x + lx * c + lz * s, y: ly, z: piece.z - lx * s + lz * c };
}

const round = (p) => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) });

function seat(id, label, piece, lx, seatTop, standOff) {
  const point = toWorld(piece, lx, seatTop, PELVIS_IN);
  const exit = toWorld(piece, lx, 0, PELVIS_IN + standOff);
  return { id, label, point: round(point), yaw: piece.yaw, exit: round(exit) };
}

const BENCH = { ...toWorld(PIANO_AT, 0, 0, BENCH_AT), yaw: PIANO_AT.yaw };

/**
 * Where to sit in the lounge, in the same form as world/seats.js: two places on the sofa, 0.9 m apart, one in each
 * armchair, and the piano bench. The bench's standing spot is beside it (south), since the keyboard is in front.
 */
export const LOUNGE_SEATS = [
  seat('sofa-a', 'on the sofa', SOFA, -0.45, SEAT_TOP, STAND_OFF.sofa),
  seat('sofa-b', 'on the sofa', SOFA, 0.45, SEAT_TOP, STAND_OFF.sofa),
  ...CHAIRS.map((c) => seat(`armchair-${c.id}`, 'in the armchair', c, 0, SEAT_TOP, STAND_OFF.chair)),
  {
    id: 'piano',
    label: 'at the piano',
    point: round({ x: BENCH.x, y: BENCH_SIZE.seat, z: BENCH.z }),
    yaw: PIANO_AT.yaw,
    exit: round({ x: BENCH.x - 0.02, y: 0, z: BENCH.z - 0.8 }),
  },
];

// Candles on the coffee table's tray: [x, z] on the tray, radius, height. Different heights, as a cluster.
const CANDLES = [
  [0, 0, 0.042, 0.21],
  [0.072, 0.05, 0.036, 0.15],
  [-0.066, 0.058, 0.034, 0.11],
  [0.05, -0.075, 0.033, 0.18],
  [-0.075, -0.05, 0.038, 0.125],
];
const FLAME = { height: 0.042, width: 0.022 };
const FLAME_COLOR = new Color('#ffb060').multiplyScalar(3); // above 1: the bloom pass catches it

/** Everything static, built once: merged geometry per material, candle and flame placements, key instances. */
function buildLounge() {
  const batch = new Batch();

  chesterfield(batch, placement(SOFA.x, SOFA.z, SOFA.yaw), { width: SOFA.width, depth: SOFA.depth, cushions: 2, seatTop: SEAT_TOP });
  for (const c of CHAIRS) chesterfield(batch, placement(c.x, c.z, c.yaw), { width: CHAIR.width, depth: CHAIR.depth, cushions: 1, seatTop: SEAT_TOP });

  const tableM = placement(TABLE.x, TABLE.z, 0);
  const tray = coffeeTable(batch, tableM);

  // A lamp at one end of the sofa, red roses at the other.
  let shade = null;
  for (const t of SIDE_TABLES) {
    const M = placement(t.x, t.z, 0);
    const s = sideTable(batch, M, { lamp: t.id === 'lamp' });
    if (s) shade = new Vector3(s.x, s.y, s.z).applyMatrix4(M);
  }

  const pianoM = placement(PIANO_AT.x, PIANO_AT.z, PIANO_AT.yaw);
  const piano = grandPiano(batch, pianoM);
  pianoBench(batch, under(pianoM, T(0, 0, BENCH_AT)));

  // Candles: wax pillars (instanced), a wick each (merged, black), a flame each (instanced, animated).
  const candles = [];
  const flames = [];
  CANDLES.forEach(([dx, dz, r, h], i) => {
    const base = new Vector3(tray.x + dx, tray.y, tray.z + dz).applyMatrix4(tableM);
    candles.push({ position: new Vector3(base.x, base.y + h / 2, base.z), scale: new Vector3(r, h, r) });
    batch.add('lacquer', new BoxGeometry(0.003, 0.012, 0.003), T(base.x, base.y + h + 0.004, base.z), FINISH.black);
    flames.push({ position: new Vector3(base.x, base.y + h + 0.006, base.z), phase: i * 2.3 + 0.7 });
  });

  const keys = pianoKeys();
  const keyMatrices = (list) => list.map((k) => under(pianoM, T(k.x, k.y, k.z, 0, 0, 0, k.sx, k.sy, k.sz)));

  return {
    geometry: batch.merge(),
    candles,
    flames,
    shade,
    whiteKeys: keyMatrices(keys.white),
    blackKeys: keyMatrices(keys.black),
    pianoBands: piano.bands,
    pianoHeight: piano.height,
  };
}

function makeMaterials() {
  const rugMap = rugTexture({ length: RUG.length, width: RUG.width, fringe: RUG.fringe, pixels: 2048 });
  const marbleMap = marbleTexture({ pixels: 1024 });
  return {
    rugMap,
    marbleMap,
    rug: new MeshStandardMaterial({ map: rugMap, roughness: 0.95, metalness: 0, alphaTest: 0.5 }),
    // Velvet: a soft sheen at grazing angles, which is what reads as pile.
    velvet: new MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0,
      sheen: 1,
      sheenColor: new Color('#3f9c78'),
      sheenRoughness: 0.4,
    }),
    wood: new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0 }),
    brass: new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 1 }),
    marble: new MeshPhysicalMaterial({ map: marbleMap, roughness: 0.18, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.1 }),
    // Piano lacquer: black, under a mirror clearcoat.
    lacquer: new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04 }),
    ivory: new MeshStandardMaterial({ color: '#f3eee2', roughness: 0.35, metalness: 0 }),
    ebony: new MeshPhysicalMaterial({ color: '#0d0d0e', roughness: 0.35, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    wax: new MeshStandardMaterial({ color: '#f2e9d6', roughness: 0.55, metalness: 0, emissive: new Color('#ff9a48'), emissiveIntensity: 0.12 }),
    flame: new MeshBasicMaterial({ color: FLAME_COLOR, vertexColors: true }),
    // Lit from inside: emissive only, no light of its own (the house keeps a fixed pool of three).
    shade: new MeshStandardMaterial({ color: '#e9d4ad', roughness: 0.9, emissive: new Color('#ffbf78'), emissiveIntensity: 1.25, side: DoubleSide }),
  };
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpS = new Vector3();
const flicker = (t, phase) => 0.55 * Math.sin(7.3 * t + phase) + 0.3 * Math.sin(13.1 * t + 2 * phase) + 0.15 * Math.sin(23.9 * t + 3 * phase);

/**
 * A Venetian palazzo lounge in the west alcove: a Persian rug, an emerald velvet Chesterfield sofa and two armchairs
 * around a marble-and-brass coffee table with a cluster of lit candles, side tables with a brass lamp, and a black
 * lacquered grand piano with its lid propped open, and its bench.
 *
 * - Built in code from three.js primitives; the rug and the marble are painted on canvases at mount.
 * - Draw calls: parts that share a material are merged into one geometry (velvet, wood, brass, marble, lacquer);
 *   keys, candles and flames are instanced; the rug and the lampshade are one mesh each. Eleven in all.
 * - Only the sofa group and the piano cast shadows. The candles and the lamp glow by colour alone (emissive, bright
 *   enough for the bloom pass) and add no lights.
 * - Fixed colliders keep players out of the furniture; LOUNGE_SEATS are the places to sit.
 */
export default function Lounge({ stoneMap = null }) {
  void stoneMap; // accepted like the other furnishings; nothing here is stone
  const built = useMemo(buildLounge, []);
  const mats = useMemo(makeMaterials, []);
  const shapes = useMemo(
    () => ({
      rug: new PlaneGeometry(RUG.length + 2 * RUG.fringe, RUG.width).rotateX(-Math.PI / 2).rotateY(Math.PI / 2),
      candle: new CylinderGeometry(1, 1, 1, 20),
      key: new BoxGeometry(1, 1, 1),
      flame: flameGeometry(),
      shade: lampshadeGeometry(),
    }),
    [],
  );
  const whiteKeys = useRef();
  const blackKeys = useRef();
  const candles = useRef();
  const flames = useRef();

  useLayoutEffect(() => {
    built.whiteKeys.forEach((m, i) => whiteKeys.current.setMatrixAt(i, m));
    built.blackKeys.forEach((m, i) => blackKeys.current.setMatrixAt(i, m));
    built.candles.forEach((c, i) => candles.current.setMatrixAt(i, tmpM.compose(c.position, tmpQ.identity(), c.scale)));
    for (const m of [whiteKeys.current, blackKeys.current, candles.current]) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [built]);

  useEffect(
    () => () => {
      Object.values(built.geometry).forEach((g) => g.dispose());
      Object.values(shapes).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
    [built, mats, shapes],
  );

  // Flames: each stretches and leans a little, out of step with the others.
  useFrame((state) => {
    const mesh = flames.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < built.flames.length; i++) {
      const f = built.flames[i];
      const k = flicker(t * 1.6, f.phase);
      tmpQ.setFromEuler(tmpE.set(0.07 * Math.sin(3.1 * t + f.phase), 0, 0.07 * Math.sin(2.3 * t + 1.7 * f.phase)));
      tmpS.set(FLAME.width * (1 - 0.06 * k), FLAME.height * (1 + 0.16 * k), FLAME.width * (1 - 0.06 * k));
      mesh.setMatrixAt(i, tmpM.compose(f.position, tmpQ, tmpS));
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  const g = built.geometry;
  const sofaHalf = [SOFA.width / 2, 0.4, SOFA.depth / 2];
  const chairHalf = [CHAIR.width / 2, 0.4, CHAIR.depth / 2];
  const tableEnd = COFFEE.length / 2 - COFFEE.width / 2;
  const bench = toWorld(PIANO_AT, 0, 0, BENCH_AT);

  return (
    <>
      <RigidBody type="fixed" colliders={false} friction={0.8}>
        <CuboidCollider args={sofaHalf} position={[SOFA.x, 0.4, SOFA.z]} rotation={[0, SOFA.yaw, 0]} />
        {CHAIRS.map((c) => (
          <CuboidCollider key={c.id} args={chairHalf} position={[c.x, 0.4, c.z]} rotation={[0, c.yaw, 0]} />
        ))}
        {/* The racetrack table: a box between two round ends */}
        <CuboidCollider args={[COFFEE.width / 2, 0.225, tableEnd]} position={[TABLE.x, 0.225, TABLE.z]} />
        <CylinderCollider args={[0.225, COFFEE.width / 2]} position={[TABLE.x, 0.225, TABLE.z - tableEnd]} />
        <CylinderCollider args={[0.225, COFFEE.width / 2]} position={[TABLE.x, 0.225, TABLE.z + tableEnd]} />
        {SIDE_TABLES.map((t) => (
          <CylinderCollider key={t.id} args={[0.3, SIDE_TABLE.radius]} position={[t.x, 0.3, t.z]} />
        ))}
        {built.pianoBands.map((b, i) => {
          const c = toWorld(PIANO_AT, (b.x0 + b.x1) / 2, built.pianoHeight / 2, (b.z0 + b.z1) / 2);
          return (
            <CuboidCollider
              key={i}
              args={[(b.x1 - b.x0) / 2, built.pianoHeight / 2, (b.z1 - b.z0) / 2]}
              position={[c.x, c.y, c.z]}
              rotation={[0, PIANO_AT.yaw, 0]}
            />
          );
        })}
        <CuboidCollider args={[BENCH_SIZE.width / 2, 0.25, BENCH_SIZE.depth / 2]} position={[bench.x, 0.25, bench.z]} rotation={[0, PIANO_AT.yaw, 0]} />
      </RigidBody>

      <mesh geometry={shapes.rug} material={mats.rug} position={[RUG.x, RUG.y, RUG.z]} receiveShadow />
      <mesh geometry={g.velvet} material={mats.velvet} castShadow receiveShadow />
      <mesh geometry={g.wood} material={mats.wood} receiveShadow />
      <mesh geometry={g.brass} material={mats.brass} receiveShadow />
      <mesh geometry={g.marble} material={mats.marble} receiveShadow />
      <mesh geometry={g.lacquer} material={mats.lacquer} castShadow receiveShadow />
      <instancedMesh ref={whiteKeys} args={[shapes.key, mats.ivory, built.whiteKeys.length]} receiveShadow />
      <instancedMesh ref={blackKeys} args={[shapes.key, mats.ebony, built.blackKeys.length]} receiveShadow />
      <instancedMesh ref={candles} args={[shapes.candle, mats.wax, built.candles.length]} receiveShadow />
      <instancedMesh ref={flames} args={[shapes.flame, mats.flame, built.flames.length]} frustumCulled={false} />
      {built.shade && <mesh geometry={shapes.shade} material={mats.shade} position={built.shade} />}
    </>
  );
}
