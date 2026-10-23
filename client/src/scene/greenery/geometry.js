import { BufferAttribute, BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute, LatheGeometry, Matrix4, PlaneGeometry, Quaternion, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A seeded random source, so the plants grow the same way on every machine and every load. */
export function seeded(seed) {
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  rand.range = (a, b) => a + (b - a) * rand();
  rand.sign = () => (rand() < 0.5 ? -1 : 1);
  return rand;
}

/**
 * A leaf blade: a unit quad with its stalk at the origin and its tip at +y, facing +z. `fold` lifts the
 * edges off the midrib (a shallow V, so it catches light unevenly); `curl` bends the tip back toward -z.
 */
export function leafGeometry({ fold = 0.18, curl = 0, segX = 2, segY = 2 } = {}) {
  const g = new PlaneGeometry(1, 1, segX, segY);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    p.setZ(i, fold * Math.abs(x) * 2 * Math.min(1, y * 3) - curl * y * y);
  }
  g.computeVertexNormals();
  return g;
}

/** Two blades crossed at right angles: a raceme reads as a volume from any side. */
export function crossGeometry() {
  const a = leafGeometry({ fold: 0, segX: 1, segY: 1 });
  const b = a.clone().rotateY(Math.PI / 2);
  const g = mergeGeometries([a, b]);
  a.dispose();
  b.dispose();
  return g;
}

const basis = new Matrix4();
const X = new Vector3();
const Y = new Vector3();
const Z = new Vector3();

/** The rotation that points a blade's tip along `dir` with its face turned as close to `facing` as it can. */
export function orient(dir, facing, out = new Quaternion()) {
  Y.copy(dir).normalize();
  Z.copy(facing).addScaledVector(Y, -Y.dot(facing));
  if (Z.lengthSq() < 1e-6) Z.set(Y.y, -Y.x, 0.3).addScaledVector(Y, -Y.dot(Z));
  Z.normalize();
  X.crossVectors(Y, Z);
  return out.setFromRotationMatrix(basis.makeBasis(X, Y, Z));
}

/**
 * Instances for one instanced mesh, gathered as plain numbers: matrix, colour, sway (amplitude,
 * phase) and atlas cell.
 */
export class InstanceList {
  constructor() {
    this.matrices = [];
    this.colors = [];
    this.sway = [];
    this.cells = [];
    this.count = 0;
  }

  add(position, quaternion, width, length, color, amplitude = 0, phase = 0, cell = 0) {
    const m = new Matrix4().compose(position, quaternion, new Vector3(width, length, width));
    this.matrices.push(...m.elements);
    this.colors.push(color.r, color.g, color.b);
    this.sway.push(amplitude, phase);
    this.cells.push(cell);
    this.count++;
  }

  /**
   * Splits the list by area of the house: north or south of the courtyard's centre line, and four bands along it. Each
   * part becomes its own mesh with its own bounds, so the parts off screen or behind the camera aren't drawn at all.
   */
  splitByArea() {
    const parts = new Map();
    for (let i = 0; i < this.count; i++) {
      const x = this.matrices[i * 16 + 12];
      const z = this.matrices[i * 16 + 14];
      const key = `${z > -0.45 ? 'n' : 's'}${Math.max(0, Math.min(3, Math.floor((x + 17) / 8.5)))}`;
      let part = parts.get(key);
      if (!part) parts.set(key, (part = new InstanceList()));
      for (let k = 0; k < 16; k++) part.matrices.push(this.matrices[i * 16 + k]);
      part.colors.push(this.colors[i * 3], this.colors[i * 3 + 1], this.colors[i * 3 + 2]);
      part.sway.push(this.sway[i * 2], this.sway[i * 2 + 1]);
      part.cells.push(this.cells[i]);
      part.count++;
    }
    return parts;
  }

  /** Writes the instances into a mesh made with this count, and the per-instance attributes into its geometry. */
  apply(mesh, withCells = false) {
    mesh.instanceMatrix.array.set(this.matrices);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(this.colors), 3);
    mesh.geometry.setAttribute('aSway', new InstancedBufferAttribute(new Float32Array(this.sway), 2));
    if (withCells) mesh.geometry.setAttribute('aCell', new InstancedBufferAttribute(new Float32Array(this.cells), 1));
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
  }
}

/** Paints a whole geometry one colour (a vertex colour attribute), so differently coloured parts can merge. */
export function painted(geometry, color) {
  const n = geometry.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
  geometry.setAttribute('color', new BufferAttribute(c, 3));
  return geometry;
}

/** A turned shape (pot, urn, vase, baluster) from [radius, height] pairs, bottom to top, placed at `at`. */
export function turned(profile, at, color, segments = 20) {
  const g = new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), segments);
  g.translate(at.x, at.y, at.z);
  return painted(g, color);
}

const tmpA = new Vector3();
const tmpN = new Vector3();

/**
 * A tube that tapers (and can bulge) along a polyline: trunks, branches and stems. Frames are carried
 * along the line by parallel transport, so it never twists. Radii are given per point.
 */
export function taperedTube(points, radii, color, radial = 7) {
  const rings = points.length;
  const pos = new Float32Array(rings * (radial + 1) * 3);
  const nor = new Float32Array(rings * (radial + 1) * 3);
  const uv = new Float32Array(rings * (radial + 1) * 2);
  const normal = new Vector3();
  const binormal = new Vector3();
  const tangent = new Vector3();
  for (let i = 0; i < rings; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(rings - 1, i + 1)];
    tangent.subVectors(b, a).normalize();
    if (i === 0) {
      normal.set(0, 0, 1);
      if (Math.abs(tangent.z) > 0.9) normal.set(1, 0, 0);
      normal.addScaledVector(tangent, -tangent.dot(normal)).normalize();
    } else {
      normal.addScaledVector(tangent, -tangent.dot(normal)).normalize(); // transport the previous frame
    }
    binormal.crossVectors(tangent, normal);
    for (let k = 0; k <= radial; k++) {
      const ang = (k / radial) * Math.PI * 2;
      tmpN.copy(normal).multiplyScalar(Math.cos(ang)).addScaledVector(binormal, Math.sin(ang));
      tmpA.copy(points[i]).addScaledVector(tmpN, radii[i]);
      const j = i * (radial + 1) + k;
      pos.set([tmpA.x, tmpA.y, tmpA.z], j * 3);
      nor.set([tmpN.x, tmpN.y, tmpN.z], j * 3);
      uv.set([k / radial, i / (rings - 1)], j * 2);
    }
  }
  const index = [];
  for (let i = 0; i < rings - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * (radial + 1) + k;
      const b = a + radial + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return painted(g, color);
}

/** Merges solid parts into one geometry, keeping only the attributes they all share. */
export function mergeParts(parts) {
  for (const p of parts) {
    for (const name of Object.keys(p.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) p.deleteAttribute(name);
    if (!p.attributes.uv) p.setAttribute('uv', new BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2));
  }
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return g;
}
