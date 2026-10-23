import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHANDELIERS, COURTYARD } from '../world/canopy';
import { keepOutOfReflections } from '../world/layers';

// Above the courtyard: a glazed iron roof across its open top (so the sunset shows through glass, and the vault has
// an apex), two gilded crystal chandeliers on long chains from its ridge, and warm festoons of fairy lights along the
// upper balustrades and strung across the courtyard.
//
// Draw calls: glass, iron (roof frame, chains' anchors and festoon wires), gilt, wax, crystal, chain links, flames,
// bulbs: eight in all, whatever the number of parts. The chandeliers' light comes from the practical-light pool
// (world/rooms.js, kind 'chandelier'), so no light is added here.

const GILT = new Color('#c9a158');
const IRON = new Color('#2a2420');
const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpP = new Vector3();
const tmpS = new Vector3();

// ---------------------------------------------------------------- roof

function roofParts() {
  const { x0, x1, zNorth, zSouth, eaveY, ridgeY } = COURTYARD;
  const ridgeZ = (zNorth + zSouth) / 2;
  const length = x1 - x0;
  const cx = (x0 + x1) / 2;
  const glass = [];
  const iron = [];
  for (const edge of [zNorth, zSouth]) {
    const run = Math.abs(edge - ridgeZ);
    const rise = ridgeY - eaveY;
    const slope = Math.hypot(run, rise);
    const tilt = Math.atan2(rise, run) * Math.sign(edge - ridgeZ);
    const mz = (edge + ridgeZ) / 2;
    const my = (eaveY + ridgeY) / 2;
    // The pane: a plane tilted about x.
    glass.push(new PlaneGeometry(length, slope).rotateX(-Math.PI / 2).rotateX(tilt).translate(cx, my, mz));
    // Rafters every bay, purlins along the slope.
    const bays = Math.round(length / 1.5);
    for (let b = 0; b <= bays; b++) {
      const x = x0 + (b / bays) * length;
      iron.push(new BoxGeometry(0.07, 0.12, slope).rotateX(tilt).translate(x, my, mz));
    }
    for (const t of [0, 0.5]) {
      const z = edge + (ridgeZ - edge) * t;
      const y = eaveY + (ridgeY - eaveY) * t;
      iron.push(new BoxGeometry(length, 0.1, 0.08).translate(cx, y, z));
    }
  }
  iron.push(new BoxGeometry(length, 0.14, 0.12).translate(cx, ridgeY + 0.02, ridgeZ)); // ridge beam
  // Tie rods with a small arched brace under each pair of rafters: the classic Victorian glasshouse truss.
  const bays = Math.round(length / 3);
  for (let b = 0; b <= bays; b++) {
    const x = x0 + (b / bays) * length;
    iron.push(new BoxGeometry(0.04, 0.04, zNorth - zSouth).translate(x, eaveY + 0.05, ridgeZ));
    iron.push(new BoxGeometry(0.04, ridgeY - eaveY, 0.04).translate(x, (eaveY + ridgeY) / 2, ridgeZ));
  }
  return { glass, iron };
}

// ---------------------------------------------------------------- chandelier

const ARMS_LOW = 8;
const ARMS_HIGH = 6;
const SIZE = 1.75; // the chandelier is modelled about 1.4 m across; hung 9 m up it needs to be grander

/** One chandelier, around its hub (origin): gilt parts, wax candles, candle flame and crystal positions. */
function chandelierParts() {
  const gilt = [];
  const wax = [];
  const flames = [];
  const crystals = []; // { p: Vector3, s: scale, tilt }

  // Central baluster: a turned profile from the finial below to the crown above.
  const profile = [
    [0.0, -1.05], [0.03, -1.02], [0.06, -0.94], [0.035, -0.86], [0.09, -0.74], [0.16, -0.6], [0.12, -0.5],
    [0.07, -0.42], [0.11, -0.3], [0.2, -0.14], [0.17, -0.06], [0.07, 0.0], [0.05, 0.12], [0.09, 0.26],
    [0.06, 0.38], [0.04, 0.52], [0.08, 0.6], [0.05, 0.7], [0.03, 0.78], [0.0, 0.8],
  ].map(([r, y]) => new Vector2(r, y));
  gilt.push(new LatheGeometry(profile, 24));
  gilt.push(new TorusGeometry(0.22, 0.02, 8, 32).rotateX(Math.PI / 2).translate(0, -0.12, 0)); // drip ring under the bowl

  const arm = (count, reach, baseY, cupY, phase) => {
    for (let k = 0; k < count; k++) {
      const a = phase + (k / count) * Math.PI * 2;
      const dir = new Vector3(Math.cos(a), 0, Math.sin(a));
      const at = (r, y) => dir.clone().multiplyScalar(r).setY(y);
      // An S-scroll: out and down from the bowl, curling up into the candle cup.
      const curve = new CatmullRomCurve3([at(0.12, baseY), at(reach * 0.45, baseY - 0.12), at(reach * 0.85, baseY - 0.06), at(reach, cupY - 0.06), at(reach, cupY)]);
      gilt.push(new TubeGeometry(curve, 24, 0.016, 6, false));
      const cup = at(reach, cupY);
      gilt.push(new CylinderGeometry(0.055, 0.035, 0.03, 12).translate(cup.x, cup.y + 0.015, cup.z)); // bobeche
      wax.push(new CylinderGeometry(0.017, 0.019, 0.16, 10).translate(cup.x, cup.y + 0.11, cup.z));
      flames.push(new Vector3(cup.x, cup.y + 0.215, cup.z));
      // A crystal pendant under each cup, and a swag of beads to the next arm.
      crystals.push({ p: new Vector3(cup.x, cup.y - 0.09, cup.z), s: 1.6, tilt: 0 });
      const next = at(reach, cupY).applyAxisAngle(new Vector3(0, 1, 0), -(Math.PI * 2) / count);
      for (let i = 1; i < 9; i++) {
        const t = i / 9;
        const p = cup.clone().lerp(next, t);
        p.y -= 0.03 + Math.sin(Math.PI * t) * 0.16;
        crystals.push({ p, s: 0.55, tilt: a });
      }
    }
  };
  arm(ARMS_LOW, 0.78, -0.18, 0.02, 0);
  arm(ARMS_HIGH, 0.46, 0.34, 0.5, Math.PI / ARMS_HIGH);
  // Rings that tie the arms together.
  gilt.push(new TorusGeometry(0.7, 0.012, 6, 64).rotateX(Math.PI / 2).translate(0, -0.18, 0));
  gilt.push(new TorusGeometry(0.4, 0.01, 6, 48).rotateX(Math.PI / 2).translate(0, 0.32, 0));
  // Crown: small upright leaves around the top.
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    gilt.push(new ConeLeaf().translate(Math.cos(a) * 0.08, 0.66, Math.sin(a) * 0.08));
  }
  // The finial drop: a large crystal, and a cascade of drops below the bowl.
  crystals.push({ p: new Vector3(0, -1.14, 0), s: 3.2, tilt: 0 });
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    for (let j = 0; j < 4; j++) crystals.push({ p: new Vector3(Math.cos(a) * 0.2, -0.2 - j * 0.07, Math.sin(a) * 0.2), s: 0.7, tilt: a });
  }
  return { gilt, wax, flames, crystals };
}

/** A small pointed leaf for the crown. */
class ConeLeaf extends CylinderGeometry {
  constructor() {
    super(0.0, 0.025, 0.14, 4);
  }
}

// ---------------------------------------------------------------- festoons

/** Points along a hanging curve (a parabola, close enough to a catenary at this sag) from a to b. */
function swag(a, b, sag, spacing, out) {
  const span = a.distanceTo(b);
  const n = Math.max(2, Math.round(span / spacing));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(a.clone().lerp(b, t).setY(a.y + (b.y - a.y) * t - 4 * sag * t * (1 - t)));
  }
  return out;
}

function festoonLines() {
  const lines = [];
  const { x0, x1, zNorth, zSouth } = COURTYARD;
  // Along both upper balustrades, just on the courtyard side, swagging between the posts.
  for (const z of [zNorth - 0.08, zSouth + 0.08]) {
    for (let x = -11.4; x < 9.9; x += 2.9) lines.push({ a: new Vector3(x, 6.18, z), b: new Vector3(Math.min(x + 2.9, 10.1), 6.18, z), sag: 0.3 });
  }
  // Across the courtyard, high up, between the chandeliers and over the stair.
  for (const x of [x0 + 0.6, -5.5, 0.6, 5.0, x1 - 0.8]) lines.push({ a: new Vector3(x, 10.8, zNorth - 0.02), b: new Vector3(x, 10.8, zSouth + 0.02), sag: 0.9 });
  return lines;
}

const BULB_VERTEX = /* glsl */ `
  uniform float uTime;
  varying float vGlow;
  void main() {
    float id = float(gl_InstanceID);
    float tw = 0.75 + 0.25 * sin(uTime * (1.3 + fract(id * 0.618) * 1.7) + id * 2.4);
    vGlow = tw;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position * (0.85 + 0.25 * tw), 1.0);
  }
`;
const BULB_FRAGMENT = /* glsl */ `
  varying float vGlow;
  void main() {
    gl_FragColor = vec4(vec3(3.4, 2.0, 0.9) * vGlow, 1.0); // warm, above 1.0: blooms softly
  }
`;

// ---------------------------------------------------------------- component

export default function Canopy() {
  const flameMesh = useRef();

  const built = useMemo(() => {
    const roof = roofParts();
    const one = chandelierParts();

    // Place both chandeliers and their chains.
    const giltParts = [];
    const waxParts = [];
    const flames = [];
    const crystals = [];
    const links = [];
    for (const c of CHANDELIERS) {
      const hub = new Vector3(c.x, c.y, c.z);
      const move = (g) => g.clone().scale(SIZE, SIZE, SIZE).translate(c.x, c.y, c.z);
      giltParts.push(...one.gilt.map(move));
      waxParts.push(...one.wax.map(move));
      for (const f of one.flames) flames.push(f.clone().multiplyScalar(SIZE).add(hub));
      for (const k of one.crystals) crystals.push({ ...k, s: k.s * SIZE, p: k.p.clone().multiplyScalar(SIZE).add(hub) });
      // Chain from the crown to the ridge: alternating links.
      const top = c.y + 0.8 * SIZE;
      const linkLength = 0.1;
      for (let y = top, i = 0; y < COURTYARD.ridgeY - 0.05; y += linkLength, i++) links.push({ x: c.x, y: y + linkLength / 2, z: c.z, turn: i % 2 ? Math.PI / 2 : 0 });
      giltParts.push(new CylinderGeometry(0.16, 0.05, 0.12, 16).translate(c.x, COURTYARD.ridgeY - 0.1, c.z)); // ceiling rose
    }

    // Festoon wires join the iron; bulbs hang along them every 22 cm.
    const bulbs = [];
    for (const line of festoonLines()) {
      const pts = swag(line.a, line.b, line.sag, 0.22, []);
      roof.iron.push(new TubeGeometry(new CatmullRomCurve3(pts), pts.length * 2, 0.005, 4, false));
      for (let i = 1; i < pts.length - 1; i++) bulbs.push(pts[i].clone().setY(pts[i].y - 0.04));
    }

    const merge = (parts) => {
      const nonIndexed = parts.map((g) => (g.index ? g.toNonIndexed() : g));
      for (const g of nonIndexed) {
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      }
      const merged = mergeGeometries(nonIndexed);
      parts.forEach((g) => g.dispose());
      nonIndexed.forEach((g) => g.dispose());
      return merged;
    };

    const materials = {
      glass: new MeshPhysicalMaterial({ color: '#d8ecf2', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, envMapIntensity: 1.6, side: DoubleSide, depthWrite: false }),
      iron: new MeshStandardMaterial({ color: IRON, roughness: 0.55, metalness: 0.7 }),
      gilt: new MeshStandardMaterial({ color: GILT, roughness: 0.28, metalness: 0.95, envMapIntensity: 1.4 }),
      wax: new MeshStandardMaterial({ color: '#f3ead8', roughness: 0.6, emissive: '#ffcf8a', emissiveIntensity: 0.25 }),
      crystal: new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.02, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0, specularIntensity: 1, ior: 2.0, envMapIntensity: 3.2, emissive: '#ffe6c0', emissiveIntensity: 0.35 }),
      chain: new MeshStandardMaterial({ color: GILT, roughness: 0.35, metalness: 0.9 }),
      flame: new MeshBasicMaterial({ color: new Color('#ffb85c').multiplyScalar(4) }),
      bulb: new ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: BULB_VERTEX, fragmentShader: BULB_FRAGMENT }),
    };

    const glass = new Mesh(merge(roof.glass), materials.glass);
    glass.renderOrder = 10; // after the opaque house, so it tints what's behind it
    const iron = new Mesh(merge(roof.iron), materials.iron);
    const gilt = new Mesh(merge(giltParts), materials.gilt);
    const wax = new Mesh(merge(waxParts), materials.wax);

    const crystalMesh = new InstancedMesh(new OctahedronGeometry(0.026, 0).scale(0.8, 1.6, 0.8), materials.crystal, crystals.length);
    crystals.forEach((k, i) => {
      tmpQ.setFromEuler(tmpE.set(0, k.tilt + i * 0.7, 0));
      crystalMesh.setMatrixAt(i, tmpM.compose(k.p, tmpQ, tmpS.setScalar(k.s)));
    });
    const linkMesh = new InstancedMesh(new TorusGeometry(0.04, 0.012, 6, 12).scale(1, 1.5, 1), materials.chain, links.length);
    links.forEach((l, i) => {
      tmpQ.setFromEuler(tmpE.set(0, l.turn, 0));
      linkMesh.setMatrixAt(i, tmpM.compose(tmpP.set(l.x, l.y, l.z), tmpQ, tmpS.setScalar(1)));
    });
    const flameGeometry = new SphereGeometry(0.018 * SIZE, 8, 6).scale(1, 2.2, 1);
    const flameMeshObj = new InstancedMesh(flameGeometry, materials.flame, flames.length);
    const bulbMesh = new InstancedMesh(new SphereGeometry(0.03, 8, 6), materials.bulb, bulbs.length);
    bulbs.forEach((p, i) => bulbMesh.setMatrixAt(i, tmpM.makeTranslation(p.x, p.y, p.z)));

    for (const m of [crystalMesh, linkMesh, flameMeshObj, bulbMesh]) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
    for (const m of [iron, gilt, wax, crystalMesh, linkMesh]) m.receiveShadow = true;
    for (const m of [wax, crystalMesh, linkMesh, flameMeshObj]) keepOutOfReflections(m); // too small to show in the floor
    return { glass, iron, gilt, wax, crystalMesh, linkMesh, flameMesh: flameMeshObj, bulbMesh, flames, materials };
  }, []);

  useLayoutEffect(() => {
    flameMesh.current = built.flameMesh;
  }, [built]);

  useEffect(() => () => {
    for (const m of [built.glass, built.iron, built.gilt, built.wax, built.crystalMesh, built.linkMesh, built.flameMesh, built.bulbMesh]) m.geometry.dispose();
    for (const mat of Object.values(built.materials)) mat.dispose();
  }, [built]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    built.materials.bulb.uniforms.uTime.value = t;
    // Candle flames breathe, each out of step with its neighbours.
    const mesh = flameMesh.current;
    if (!mesh) return;
    built.flames.forEach((p, i) => {
      const k = 1 + 0.12 * Math.sin(t * 9.1 + i * 1.7) + 0.08 * Math.sin(t * 15.3 + i * 0.9);
      mesh.setMatrixAt(i, tmpM.compose(p, tmpQ.identity(), tmpS.set(1, k, 1)));
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <primitive object={built.iron} />
      <primitive object={built.gilt} />
      <primitive object={built.wax} />
      <primitive object={built.crystalMesh} />
      <primitive object={built.linkMesh} />
      <primitive object={built.flameMesh} />
      <primitive object={built.bulbMesh} />
      <primitive object={built.glass} />
    </>
  );
}
