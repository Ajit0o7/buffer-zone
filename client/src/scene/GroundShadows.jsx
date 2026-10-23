import { useEffect, useMemo } from 'react';
import { CanvasTexture, Euler, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { LOUNGE_FOOTPRINTS } from './Lounge';
import { FOUNTAIN } from './Fountain';
import { STANDS, TREES } from './Greenery';
import { BENCH, BENCHES } from '../world/seats';
import { PRACTICALS } from '../world/rooms';
import { keepOutOfReflections } from '../world/layers';

// Soft contact shadows: a dark, blurred patch on the floor under each piece of furniture, the fountain, the benches,
// plant pots, flower stands and lamp stands. The house has no baked ambient occlusion, so without these things look
// as if they hover. One instanced quad with one shared gradient texture: one draw call for all of them.

const LIFT = 0.016; // above the marble (6 mm) and the rug (12 mm)

/** A rounded-rectangle shadow, darkest under the middle and fading out well past the edge. */
function shadowTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = Math.abs((x + 0.5) / size - 0.5) * 2;
      const v = Math.abs((y + 0.5) / size - 0.5) * 2;
      const r = (u ** 4 + v ** 4) ** 0.25; // a superellipse: square-ish with round corners
      const a = Math.max(0, 1 - r) ** 1.6;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      img.data[i + 3] = Math.round(255 * Math.min(1, a * 1.25));
    }
  }
  g.putImageData(img, 0, 0);
  return new CanvasTexture(canvas);
}

function footprints() {
  const list = [...LOUNGE_FOOTPRINTS.map((f) => ({ y: 0, k: 1, ...f }))];
  list.push({ x: FOUNTAIN.x, y: 0, z: FOUNTAIN.z, w: FOUNTAIN.radius * 2.5, d: FOUNTAIN.radius * 2.5, yaw: 0, k: 0.9 });
  for (const b of BENCHES) list.push({ x: b.x, y: b.y, z: b.z, w: BENCH.length + 0.4, d: BENCH.depth + 0.45, yaw: b.yaw, k: 0.75 });
  for (const t of TREES) list.push({ x: t.x, y: 0, z: t.z, w: 1.1, d: 1.1, yaw: 0, k: 0.8 });
  for (const s of STANDS) list.push({ x: s.x, y: 0, z: s.z, w: 0.75, d: 0.75, yaw: 0, k: 0.6 });
  for (const p of PRACTICALS) {
    if (p.kind !== 'lamp' && p.kind !== 'candles') continue;
    const floor = p.position.y - (p.kind === 'candles' ? 1.5 : 1.7);
    list.push({ x: p.position.x, y: floor, z: p.position.z, w: 0.6, d: 0.6, yaw: 0, k: 0.55 });
  }
  return list;
}

export default function GroundShadows() {
  const mesh = useMemo(() => {
    const list = footprints();
    const material = new MeshBasicMaterial({
      map: shadowTexture(),
      color: '#000000',
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const m = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material, list.length);
    const q = new Quaternion();
    const e = new Euler();
    const s = new Vector3();
    const p = new Vector3();
    const mat = new Matrix4();
    list.forEach((f, i) => {
      // Lighter pieces (a side table, a lamp) get a smaller patch, so they darken the floor less.
      q.setFromEuler(e.set(0, f.yaw, 0));
      m.setMatrixAt(i, mat.compose(p.set(f.x, f.y + LIFT, f.z), q, s.set(f.w * (0.8 + 0.2 * f.k), 1, f.d * (0.8 + 0.2 * f.k))));
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.renderOrder = 1;
    m.frustumCulled = false;
    keepOutOfReflections(m);
    return m;
  }, []);

  useEffect(() => () => {
    mesh.geometry.dispose();
    mesh.material.map.dispose();
    mesh.material.dispose();
    mesh.dispose();
  }, [mesh]);

  return <primitive object={mesh} />;
}
