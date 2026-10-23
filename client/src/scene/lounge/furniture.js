import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  LatheGeometry,
  Matrix4,
  Path,
  PlaneGeometry,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Geometry for the lounge's furniture, built from three.js primitives in each piece's own frame (x across it, y up,
// z the way a sitter or player faces, origin on the floor) and baked into world space. Parts that share a material
// are collected in a Batch and merged into one geometry each, with per-vertex colours for their shades: a sofa, two
// armchairs and a piano bench in velvet are a single draw call.

export const FINISH = {
  velvet: new Color('#0d3a2a'), // deep emerald
  velvetShade: new Color('#0a2e21'),
  button: new Color('#06200f'),
  walnut: new Color('#3a2214'),
  spruce: new Color('#c9a26a'),
  paper: new Color('#efe6d0'),
  bookRed: new Color('#6e1a1a'),
  bookNavy: new Color('#1d2a4a'),
  brass: new Color('#d4a85c'),
  copper: new Color('#c4774a'),
  steel: new Color('#d8d8d8'),
  black: new Color('#0b0b0c'),
  felt: new Color('#5a0f14'),
  rose: new Color('#8c0c1c'),
  leaf: new Color('#1f4a22'),
  stem: new Color('#2d4a1f'),
};

/** Collects parts per material: each part is a geometry already moved into place, with a uniform vertex colour. */
export class Batch {
  constructor() {
    this.parts = {};
  }

  /** Adds `geometry` (consumed: it is disposed) under `key`, transformed by `matrix`, coloured `color`. */
  add(key, geometry, matrix, color) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(matrix);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    (this.parts[key] ??= []).push(g);
  }

  /** One merged geometry per material key. */
  merge() {
    const out = {};
    for (const [key, list] of Object.entries(this.parts)) {
      out[key] = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      out[key].computeBoundingSphere();
    }
    this.parts = {};
    return out;
  }
}

const tmpQ = new Quaternion();
const tmpE = new Euler();

/** A matrix: translate, rotate (XYZ Euler), scale. */
export function T(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new Matrix4().compose(new Vector3(x, y, z), tmpQ.setFromEuler(tmpE.set(rx, ry, rz)), new Vector3(sx, sy, sz));
}

/** parent × local. */
export const under = (parent, local) => new Matrix4().multiplyMatrices(parent, local);

/** A floor placement: position on the floor, turned by yaw (0 faces +z). */
export const placement = (x, z, yaw, y = 0) => T(x, y, z, 0, yaw, 0);

/** Matrix that stretches a unit Y-axis cylinder (height 1, centred) between two points. */
export function between(a, b) {
  const dir = new Vector3().subVectors(b, a);
  const length = dir.length();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  return new Matrix4().compose(mid, q, new Vector3(1, length, 1));
}

const box = (sx, sy, sz) => new BoxGeometry(sx, sy, sz);
const rbox = (sx, sy, sz, r, seg = 3) => new RoundedBoxGeometry(sx, sy, sz, seg, Math.min(r, sx / 2, sy / 2, sz / 2) - 1e-4);
const cyl = (rt, rb, h, seg = 20) => new CylinderGeometry(rt, rb, h, seg);
const lathe = (profile, seg = 20) => new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), seg);

// ---------------------------------------------------------------- upholstery

/**
 * A deep-buttoned panel facing +z: a dense plane pushed out into pillows between buttons on a diamond lattice, pulled
 * in at each button and along the diagonal pleats between them, and tucked in at its edges. Returns the geometry and
 * the button positions (on the dimpled surface), both in the panel's frame.
 */
function tuftedPanel(width, height, depth, spacingX, rows) {
  const segX = Math.max(8, Math.round(width / 0.018));
  const segY = Math.max(6, Math.round(height / 0.018));
  const g = new PlaneGeometry(width, height, segX, segY);
  const cols = Math.max(1, Math.round(width / spacingX));
  const sx = width / cols; // full spacing between buttons in a row
  const sy = height / (rows + 1);
  const ox = -width / 2; // lattice origin: a button column on the left edge (outside), first row one step up
  const oy = -height / 2;
  const gradU = Math.sqrt(1 / (sx * sx) + 1 / (4 * sy * sy));
  const buttons = [];
  const lattice = new Set(); // 'i,j' of every button, for a quick nearest-button lookup per vertex
  for (let j = 1; j <= rows; j++) {
    for (let i = 0; i <= cols * 2; i++) {
      if ((i + j) % 2) continue; // diamond lattice: alternate rows are offset by half a step
      const x = ox + (i * sx) / 2;
      if (x < -width / 2 + sx * 0.3 || x > width / 2 - sx * 0.3) continue;
      buttons.push(new Vector3(x, oy + j * sy, depth * 0.12));
      lattice.add(`${i},${j}`);
    }
  }
  const pos = g.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const y = pos.getY(k);
    const a = (x - ox) / (sx / 2);
    const bb = (y - oy) / sy;
    let dimple = 0;
    for (let j = Math.floor(bb); j <= Math.ceil(bb); j++) {
      for (let i = Math.floor(a) - 1; i <= Math.ceil(a) + 1; i++) {
        if (!lattice.has(`${i},${j}`)) continue;
        const d2 = (x - (ox + (i * sx) / 2)) ** 2 + (y - (oy + j * sy)) ** 2;
        dimple = Math.max(dimple, Math.exp(-d2 / (0.032 * 0.032)));
      }
    }
    // Pleats: the diagonals through the buttons, in lattice coordinates u and v.
    const u = (a + bb) / 2;
    const v = (a - bb) / 2;
    const du = Math.abs(u - Math.round(u)) / gradU;
    const dv = Math.abs(v - Math.round(v)) / gradU;
    const crease = Math.exp(-((Math.min(du, dv) / 0.012) ** 2));
    const ex = Math.min(x + width / 2, width / 2 - x);
    const ey = Math.min(y + height / 2, height / 2 - y);
    const edge = Math.min(1, Math.min(ex, ey) / 0.035);
    const tuck = edge * edge * (3 - 2 * edge);
    const pillow = Math.max(0, 1 - 0.88 * dimple - 0.22 * crease * (1 - dimple));
    pos.setZ(k, depth * pillow * tuck);
  }
  g.computeVertexNormals();
  return { geometry: g, buttons };
}

/**
 * A Chesterfield: rolled arms and back of equal height, a deep-buttoned back and inner arms, loose seat cushions,
 * on short turned walnut feet with brass cups. Its frame: x across, z forward (the sitter faces +z), floor origin.
 */
export function chesterfield(batch, M, { width, depth, cushions, seatTop = 0.45 }) {
  const V = FINISH.velvet;
  const legH = 0.1;
  const r = 0.115; // arm roll radius
  const rollY = 0.645; // roll centre height: the top of arms and back is ~0.76
  const armInner = width / 2 - 0.215; // inner face of each arm
  const backDepth = 0.24; // back, from the rear to the tufted face
  const rear = -depth / 2;

  // Feet: turned walnut buns on brass cups, at the corners (and the middle of a long sofa).
  const footXs = width > 1.6 ? [-1, 0, 1] : [-1, 1];
  for (const fx of footXs) {
    for (const fz of [-1, 1]) {
      const x = fx * (width / 2 - 0.1);
      const z = fz * (depth / 2 - 0.1);
      batch.add('brass', cyl(0.028, 0.03, 0.02, 14), under(M, T(x, 0.01, z)), FINISH.brass);
      batch.add('wood', lathe([[0, 0], [0.028, 0], [0.04, 0.02], [0.042, 0.045], [0.03, 0.068], [0.036, 0.085], [0.045, 0.1], [0, 0.1]], 16), under(M, T(x, 0.0, z)), FINISH.walnut);
    }
  }
  // Base: the upholstered frame under the seat.
  batch.add('velvet', rbox(width - 0.02, 0.22, depth - 0.02, 0.03), under(M, T(0, legH + 0.11, 0)), FINISH.velvetShade);

  // Arms: a panel with a roll on top, rolled outward, and a scroll disc on the front of each roll.
  for (const s of [-1, 1]) {
    const outer = width / 2 - 0.02;
    const panelW = outer - armInner;
    const panelBottom = legH + 0.18;
    batch.add('velvet', rbox(panelW, rollY - panelBottom, depth - 0.02, 0.02), under(M, T(s * (armInner + panelW / 2), (panelBottom + rollY) / 2, 0)), V);
    const rollX = s * (width / 2 - r);
    batch.add('velvet', cyl(r, r, depth, 28), under(M, T(rollX, rollY, 0.005, Math.PI / 2, 0, 0)), V);
    batch.add('velvet', cyl(r * 0.92, r * 0.92, 0.03, 24), under(M, T(rollX, rollY, depth / 2 + 0.008, Math.PI / 2, 0, 0)), FINISH.velvetShade);
    batch.add('velvet', new SphereGeometry(0.014, 8, 6), under(M, T(rollX, rollY, depth / 2 + 0.024)), FINISH.button);
    // Scroll front: the arm's front face, set back a little under the roll.
    batch.add('velvet', rbox(panelW - 0.02, rollY - panelBottom - 0.04, 0.02, 0.008), under(M, T(s * (armInner + panelW / 2), (panelBottom + rollY) / 2 - 0.02, depth / 2 - 0.004)), FINISH.velvetShade);
  }

  // Back: a body, a slimmer roll along the top, and the tufted face in front of the roll, rising to just under it.
  const rb = 0.085;
  const backFaceZ = rear + 2 * rb;
  batch.add('velvet', rbox(width - 2 * r, rollY - legH - 0.2, backFaceZ - rear - 0.01, 0.02), under(M, T(0, (legH + 0.2 + rollY) / 2, (rear + backFaceZ) / 2 + 0.005)), V);
  batch.add('velvet', cyl(rb, rb, width - 2 * r + 0.04, 28), under(M, T(0, rollY + 0.03, rear + rb, 0, 0, Math.PI / 2)), V);
  const tuftBottom = seatTop - 0.03;
  const tuftTop = rollY + 0.06;
  const back = tuftedPanel(armInner * 2, tuftTop - tuftBottom, 0.075, 0.2, 3);
  const backM = under(M, T(0, (tuftBottom + tuftTop) / 2, backFaceZ));
  batch.add('velvet', back.geometry, backM, V);
  for (const b of back.buttons) batch.add('velvet', new SphereGeometry(0.011, 8, 6), under(backM, T(b.x, b.y, b.z)), FINISH.button);

  // Inner arms: tufted too, facing inward.
  const armLen = depth / 2 - (backFaceZ + 0.02) - 0.03;
  for (const s of [-1, 1]) {
    const arm = tuftedPanel(armLen, rollY - 0.05 - tuftBottom, 0.04, 0.17, 2);
    const armM = under(M, T(s * armInner, (tuftBottom + rollY - 0.05) / 2, backFaceZ + 0.02 + armLen / 2, 0, -s * Math.PI / 2, 0));
    batch.add('velvet', arm.geometry, armM, V);
    for (const b of arm.buttons) batch.add('velvet', new SphereGeometry(0.01, 8, 6), under(armM, T(b.x, b.y, b.z)), FINISH.button);
  }

  // Seat cushions, between the arms, from the tufted back to just past the front.
  const seatW = armInner * 2;
  const cw = seatW / cushions;
  const seatD = depth / 2 + 0.01 - (backFaceZ + 0.01);
  for (let k = 0; k < cushions; k++) {
    const x = -seatW / 2 + cw * (k + 0.5);
    batch.add('velvet', rbox(cw - 0.012, 0.13, seatD, 0.045, 4), under(M, T(x, seatTop - 0.065, backFaceZ + 0.01 + seatD / 2)), V);
  }
  // Seat deck under the cushions, so no gap shows at the arms.
  batch.add('velvet', box(seatW, 0.02, seatD), under(M, T(0, seatTop - 0.135, backFaceZ + seatD / 2)), FINISH.velvetShade);
}

// ---------------------------------------------------------------- tables, lamp

/** A stadium (a rectangle with round ends) as a Shape, long along y. */
function stadium(width, length) {
  const r = width / 2;
  const h = length / 2 - r;
  const s = new Shape();
  s.moveTo(r, -h);
  s.lineTo(r, h);
  s.absarc(0, h, r, 0, Math.PI, false);
  s.lineTo(-r, -h);
  s.absarc(0, -h, r, Math.PI, Math.PI * 2, false);
  return s;
}

function stadiumPath(width, length) {
  const r = width / 2;
  const h = length / 2 - r;
  const p = new Path();
  p.moveTo(r, -h);
  p.absarc(0, -h, r, 0, -Math.PI, true);
  p.lineTo(-r, h);
  p.absarc(0, h, r, Math.PI, 0, true);
  p.lineTo(r, -h);
  return p;
}

/** Extrudes a shape (drawn in x, z) downward from y = top, `depth` thick, with a small bevel. */
function slab(shape, depth, top, bevel = 0) {
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 24,
  });
  g.rotateX(Math.PI / 2); // shape (x, y) → (x, z); the extrusion runs down
  g.translate(0, top - bevel, 0);
  return g;
}

/** Planar UVs from above, in metres / `tile`, for a texture that should lie flat across a top. */
function topUVs(g, tile) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / tile + 0.37;
    uv[i * 2 + 1] = p.getZ(i) / tile + 0.21;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  return g;
}

export const COFFEE = { width: 0.55, length: 0.8, top: 0.43 };

/**
 * The coffee table: a racetrack top of white veined marble on a brass frame (apron, four slender legs, a low ring),
 * long along its z. Returns the candle tray's top centre (local) for the candles.
 */
export function coffeeTable(batch, M) {
  const { width, length, top } = COFFEE;
  const marble = topUVs(slab(stadium(width, length), 0.035, top, 0.006), 1.1);
  batch.add('marble', marble, M, FINISH.paper);
  const ring = stadium(width - 0.03, length - 0.03);
  ring.holes.push(stadiumPath(width - 0.07, length - 0.07));
  batch.add('brass', slab(ring, 0.05, top - 0.035), M, FINISH.brass);
  const low = stadium(width - 0.1, length - 0.1);
  low.holes.push(stadiumPath(width - 0.13, length - 0.13));
  batch.add('brass', slab(low, 0.015, 0.1), M, FINISH.brass);
  const lx = width / 2 - 0.06;
  const lz = length / 2 - width / 2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * lx;
      const z = sz * lz;
      batch.add('brass', cyl(0.013, 0.009, top - 0.08, 12), under(M, T(x, (top - 0.08) / 2 + 0.03, z)), FINISH.brass);
      batch.add('brass', new SphereGeometry(0.02, 12, 8), under(M, T(x, 0.02, z)), FINISH.brass);
      batch.add('brass', cyl(0.018, 0.013, 0.03, 12), under(M, T(x, top - 0.065, z)), FINISH.brass);
    }
  }
  // A brass tray for the candles at one end, two books at the other.
  const tray = { x: 0, y: top + 0.014, z: -0.16 };
  batch.add('brass', cyl(0.16, 0.155, 0.014, 32), under(M, T(tray.x, top + 0.007, tray.z)), FINISH.brass);
  batch.add('wood', rbox(0.16, 0.035, 0.22, 0.004, 1), under(M, T(0.0, top + 0.0175, 0.2, 0, 0.12, 0)), FINISH.bookNavy);
  batch.add('wood', rbox(0.14, 0.03, 0.19, 0.004, 1), under(M, T(0.01, top + 0.05, 0.2, 0, -0.1, 0)), FINISH.bookRed);
  batch.add('wood', box(0.13, 0.026, 0.18), under(M, T(0.012, top + 0.05, 0.201, 0, -0.1, 0)), FINISH.paper);
  return tray;
}

export const SIDE_TABLE = { radius: 0.24, top: 0.6 };

/**
 * A round side table (marble on a brass pedestal) with either a brass lamp or a bud vase of red roses. With the lamp,
 * returns the lampshade's centre (local) so the glowing shade can be its own mesh.
 */
export function sideTable(batch, M, { lamp }) {
  const { radius, top } = SIDE_TABLE;
  batch.add('marble', topUVs(cyl(radius, radius, 0.03, 40), 0.9), under(M, T(0, top - 0.015, 0)), FINISH.paper);
  batch.add('brass', cyl(radius + 0.006, radius + 0.006, 0.012, 40), under(M, T(0, top - 0.032, 0)), FINISH.brass);
  batch.add('brass', lathe([[0, 0], [0.16, 0], [0.16, 0.015], [0.06, 0.04], [0.03, 0.09], [0.022, 0.3], [0.03, 0.42], [0.022, 0.5], [0.05, top - 0.04], [0, top - 0.04]], 24), M, FINISH.brass);
  if (!lamp) {
    // Roses: velvet suits their petals. Heads at slightly different heights and angles above a slim vase.
    batch.add('brass', lathe([[0, 0], [0.04, 0], [0.05, 0.03], [0.03, 0.1], [0.016, 0.17], [0.024, 0.2], [0, 0.2]], 20), under(M, T(0, top, 0)), FINISH.brass);
    const heads = [[0, 0.33, 0], [0.05, 0.3, 0.03], [-0.045, 0.31, 0.03], [0.02, 0.29, -0.05], [-0.03, 0.28, -0.04]];
    for (const [x, y, z] of heads) {
      batch.add('wood', cyl(0.003, 0.003, y - 0.17, 5), under(M, between(new Vector3(0, top + 0.17, 0), new Vector3(x, top + y, z))), FINISH.stem);
      batch.add('velvet', new SphereGeometry(0.026, 12, 8), under(M, T(x, top + y, z, 0.4 * x * 10, 0, 0.4 * z * 10, 1, 0.85, 1)), FINISH.rose);
      batch.add('velvet', new SphereGeometry(0.02, 6, 4), under(M, T(x * 0.8, top + y - 0.035, z * 0.8, 0, 0, 0, 1.6, 0.35, 0.8)), FINISH.leaf);
    }
    return null;
  }
  // Lamp: a brass baluster with a pleated silk shade.
  const base = lathe([[0, 0], [0.075, 0], [0.078, 0.012], [0.05, 0.03], [0.07, 0.11], [0.06, 0.19], [0.02, 0.24], [0.012, 0.25], [0.008, 0.42], [0.015, 0.43], [0, 0.44]], 24);
  batch.add('brass', base, under(M, T(0, top, 0)), FINISH.brass);
  return { x: 0, y: top + 0.39, z: 0 };
}

/** The lampshade: an open, gently fluted cone. Height 0.22, centred on its frame. */
export function lampshadeGeometry() {
  const g = new CylinderGeometry(0.09, 0.165, 0.22, 48, 1, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.025 * Math.cos(a * 24); // pleats
    p.setX(i, x * k);
    p.setZ(i, z * k);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- piano

const PIANO = {
  width: 1.48,
  length: 1.72,
  caseBottom: 0.67,
  rimTop: 0.99,
  rim: 0.045,
  keyTop: 0.735,
  lidOpen: 0.6, // radians
};

/** The grand's case outline from above, as polygon points (x across, y = z back toward the tail); spine at +x. */
function pianoOutline() {
  const h = PIANO.width / 2;
  const L = PIANO.length;
  const s = new Shape();
  s.moveTo(h, 0);
  s.lineTo(-h, 0);
  s.lineTo(-h, 0.3);
  s.bezierCurveTo(-h, 0.78, -0.12, 0.88, 0.16, 1.3); // the bentside: in toward the spine
  s.bezierCurveTo(0.3, 1.52, 0.33, L, 0.52, L); // out around the tail
  s.quadraticCurveTo(h, L, h, L - 0.2);
  s.lineTo(h, 0);
  return s.getPoints(16).filter((p, i, a) => i === 0 || p.distanceTo(a[i - 1]) > 1e-4);
}

/** A polygon offset inward by d (points in either winding, first ≠ last). */
function inset(points, d) {
  const pts = points[0].distanceTo(points[points.length - 1]) < 1e-6 ? points.slice(0, -1) : points.slice();
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  const inward = area > 0 ? 1 : -1;
  return pts.map((p, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const next = pts[(i + 1) % pts.length];
    const e1 = new Vector2().subVectors(p, prev).normalize();
    const e2 = new Vector2().subVectors(next, p).normalize();
    const n1 = new Vector2(-e1.y, e1.x).multiplyScalar(inward);
    const n2 = new Vector2(-e2.y, e2.x).multiplyScalar(inward);
    const n = n1.clone().add(n2).normalize();
    const miter = Math.min(2.5, 1 / Math.max(0.3, n.dot(n1)));
    return p.clone().addScaledVector(n, d * miter);
  });
}

/** Keeps the part of a polygon with y ≥ y0. */
function clipAbove(points, y0) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ain = a.y >= y0;
    const bin = b.y >= y0;
    if (ain) out.push(a.clone());
    if (ain !== bin) {
      const t = (y0 - a.y) / (b.y - a.y);
      out.push(new Vector2(a.x + (b.x - a.x) * t, y0));
    }
  }
  return out;
}

const shapeOf = (pts) => new Shape(pts);
const pathOf = (pts) => new Path(pts.slice().reverse());

/** The x-range of a polygon at depth y (its leftmost and rightmost crossing). */
function spanAt(points, y) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
    const x = a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return [lo, hi];
}

/** Key layout: 52 white keys from A0, and 36 black keys between them. In the piano's frame. */
export function pianoKeys() {
  const white = [];
  const black = [];
  const pitch = 0.0235;
  const count = 52;
  const x0 = -((count - 1) * pitch) / 2;
  for (let w = 0; w < count; w++) {
    white.push({ x: x0 + w * pitch, y: PIANO.keyTop - 0.011, z: -0.075, sx: pitch - 0.0012, sy: 0.022, sz: 0.15 });
    const letter = 'ABCDEFG'[w % 7];
    if (w < count - 1 && 'ACDFG'.includes(letter)) {
      black.push({ x: x0 + (w + 0.5) * pitch, y: PIANO.keyTop + 0.001, z: -0.048, sx: 0.0125, sy: 0.024, sz: 0.095 });
    }
  }
  return { white, black };
}

/**
 * A black lacquered grand piano with its lid propped open, and its bench. Frame: the keyboard's front edge at z = 0,
 * the case running back to +z, the straight spine at +x (the pianist's left; the pianist sits at -z facing +z).
 * Returns the outline bands for colliders, in the same frame.
 */
export function grandPiano(batch, M) {
  const { caseBottom, rimTop, rim, lidOpen } = PIANO;
  const outline = pianoOutline();
  const inner = inset(outline, rim);

  // Case: the rim (outline with the inside cut out), and its bottom.
  const rimShape = shapeOf(outline);
  rimShape.holes.push(pathOf(inner));
  batch.add('lacquer', slab(rimShape, rimTop - caseBottom - 0.04, rimTop, 0.006), M, FINISH.black);
  batch.add('lacquer', slab(shapeOf(inset(outline, 0.012)), 0.05, caseBottom + 0.05, 0.01), M, FINISH.black);

  // Inside: the spruce soundboard, a gold iron plate, strings (copper in the bass, steel in the treble), dampers.
  batch.add('wood', slab(shapeOf(inner), 0.01, 0.8), M, FINISH.spruce);
  const plateOuter = inset(outline, rim + 0.01);
  const plateInner = inset(outline, rim + 0.09);
  const plate = shapeOf(plateOuter);
  plate.holes.push(pathOf(plateInner));
  batch.add('brass', slab(plate, 0.02, 0.84), M, FINISH.brass);
  for (const [x0, z0, x1, z1] of [[0.55, 0.3, -0.2, 1.05], [0.3, 0.3, 0.38, 1.45]]) {
    // Keep each strut's ends inside the plate, which narrows along the bentside.
    const fit = (x, z) => {
      const [lo, hi] = spanAt(plateInner, z);
      return Math.min(hi - 0.05, Math.max(lo + 0.05, x));
    };
    const a = new Vector3(fit(x0, z0), 0.835, z0);
    const b = new Vector3(fit(x1, z1), 0.835, z1);
    batch.add('brass', cyl(0.025, 0.025, 1, 6), under(M, between(a, b)), FINISH.brass);
  }
  const strings = 44;
  for (let k = 0; k < strings; k++) {
    const x = 0.66 - (k / (strings - 1)) * 1.24;
    let end = 0.3;
    for (let z = 0.3; z < PIANO.length; z += 0.01) {
      const [lo, hi] = spanAt(plateInner, z);
      if (x < lo || x > hi) break;
      end = z;
    }
    const length = end - 0.33;
    if (length < 0.1) continue;
    batch.add('brass', box(0.003, 0.003, length), under(M, T(x, 0.852, 0.33 + length / 2)), k < 16 ? FINISH.copper : FINISH.steel);
  }
  batch.add('lacquer', box(1.26, 0.035, 0.07), under(M, T(0.04, 0.875, 0.3)), FINISH.black);

  // Keyboard surround: keybed, cheek blocks, a felt strip behind the keys, the music desk with a sheet on it.
  batch.add('lacquer', box(1.36, 0.05, 0.19), under(M, T(0, PIANO.keyTop - 0.047, -0.075)), FINISH.black);
  for (const s of [-1, 1]) batch.add('lacquer', rbox(0.075, 0.13, 0.19, 0.01, 2), under(M, T(s * 0.655, PIANO.keyTop - 0.012, -0.075)), FINISH.black);
  batch.add('wood', box(1.22, 0.012, 0.012), under(M, T(0, PIANO.keyTop + 0.006, 0.006)), FINISH.felt);
  batch.add('lacquer', box(1.23, 0.07, 0.04), under(M, T(0, PIANO.keyTop + 0.035, 0.03)), FINISH.black); // fallboard
  const desk = under(M, T(0, rimTop + 0.15, 0.22, -0.2, 0, 0));
  batch.add('lacquer', rbox(0.8, 0.3, 0.016, 0.006, 2), desk, FINISH.black);
  batch.add('lacquer', box(0.8, 0.02, 0.05), under(desk, T(0, -0.15, -0.02)), FINISH.black);
  batch.add('wood', box(0.44, 0.27, 0.003), under(desk, T(0, 0.0, -0.01)), FINISH.paper);
  batch.add('lacquer', box(0.04, 0.12, 0.04), under(M, T(0, rimTop + 0.01, 0.24)), FINISH.black);

  // Lid: the outline behind the music desk, hinged along the spine and lifted on the treble side.
  const lidPts = clipAbove(outline, 0.4);
  const lidPivot = new Vector3(PIANO.width / 2, rimTop + 0.012, 0);
  const lidM = under(M, under(T(lidPivot.x, lidPivot.y, 0, 0, 0, -lidOpen), T(-lidPivot.x, -lidPivot.y, 0)));
  batch.add('lacquer', slab(shapeOf(lidPts), 0.022, rimTop + 0.022, 0.006), lidM, FINISH.black);
  for (const z of [0.6, 1.1, 1.5]) batch.add('brass', box(0.03, 0.03, 0.07), under(M, T(PIANO.width / 2 - 0.005, rimTop + 0.012, z)), FINISH.brass);
  // Prop stick: from the rim on the treble side up to the lid's underside.
  const stickZ = 0.95;
  const [rimLo] = spanAt(outline, stickZ);
  const foot = new Vector3(rimLo + 0.03, rimTop, stickZ);
  const lidLocal = new Vector3(rimLo + 0.07, rimTop + 0.001, stickZ).applyMatrix4(under(T(lidPivot.x, lidPivot.y, 0, 0, 0, -lidOpen), T(-lidPivot.x, -lidPivot.y, 0)));
  batch.add('lacquer', cyl(0.011, 0.011, 1, 8), under(M, between(foot, lidLocal)), FINISH.black);

  // Legs: three tapered columns with collars, on brass casters; a lyre with three brass pedals.
  const legs = [[0.64, 0.0], [-0.64, 0.0], [0.5, 1.48]];
  for (const [x, z] of legs) {
    batch.add('lacquer', lathe([[0, 0.04], [0.035, 0.04], [0.042, 0.07], [0.038, 0.09], [0.05, 0.45], [0.06, 0.55], [0.07, 0.57], [0.07, 0.6], [0.06, 0.62], [0.065, caseBottom], [0, caseBottom]], 18), under(M, T(x, 0, z)), FINISH.black);
    batch.add('brass', new SphereGeometry(0.028, 12, 8), under(M, T(x, 0.028, z)), FINISH.brass);
    batch.add('brass', cyl(0.042, 0.038, 0.015, 16), under(M, T(x, 0.08, z)), FINISH.brass);
  }
  for (const s of [-1, 1]) batch.add('lacquer', box(0.03, caseBottom - 0.1, 0.03), under(M, T(s * 0.08, (caseBottom + 0.1) / 2, 0.28, 0, 0, s * 0.06)), FINISH.black);
  batch.add('lacquer', rbox(0.3, 0.07, 0.11, 0.015, 2), under(M, T(0, 0.08, 0.28)), FINISH.black);
  for (const x of [-0.06, 0, 0.06]) batch.add('brass', rbox(0.025, 0.012, 0.09, 0.005, 1), under(M, T(x, 0.075, 0.2)), FINISH.brass);

  // Collider bands: the case's x-span over a few depth ranges (the bentside narrows toward the tail).
  const bands = [];
  for (const [z0, z1] of [[-0.19, 0.6], [0.6, 1.2], [1.2, PIANO.length]]) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let z = Math.max(0, z0); z <= Math.min(PIANO.length - 0.001, z1); z += 0.02) {
      const [a, b] = spanAt(outline, z);
      lo = Math.min(lo, a);
      hi = Math.max(hi, b);
    }
    bands.push({ x0: lo, x1: hi, z0, z1 });
  }
  return { bands, height: rimTop + 0.03 };
}

export const BENCH_SIZE = { width: 0.76, depth: 0.36, seat: 0.5 };

/** A piano bench: lacquered frame and legs, a buttoned velvet top. Frame: centre on the floor, the player sits facing +z. */
export function pianoBench(batch, M) {
  const { width, depth, seat } = BENCH_SIZE;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      batch.add('lacquer', cyl(0.022, 0.016, seat - 0.08, 10), under(M, T(sx * (width / 2 - 0.05), (seat - 0.08) / 2, sz * (depth / 2 - 0.05))), FINISH.black);
      batch.add('brass', cyl(0.018, 0.018, 0.012, 10), under(M, T(sx * (width / 2 - 0.05), 0.006, sz * (depth / 2 - 0.05))), FINISH.brass);
    }
  }
  batch.add('lacquer', rbox(width, 0.08, depth, 0.01, 2), under(M, T(0, seat - 0.1, 0)), FINISH.black);
  batch.add('velvet', rbox(width - 0.02, 0.07, depth - 0.02, 0.03, 3), under(M, T(0, seat - 0.035, 0)), FINISH.velvet);
  for (const x of [-0.24, 0, 0.24]) batch.add('velvet', new SphereGeometry(0.01, 8, 6), under(M, T(x, seat - 0.001, 0)), FINISH.button);
}

/** The flame: a teardrop lathe, unit height from its base, white-hot at the root and orange at the tip. */
export function flameGeometry() {
  const profile = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    profile.push(new Vector2(Math.sin(Math.PI * Math.pow(t, 0.7)) * (1 - t * 0.3) * 0.5, t));
  }
  const g = new LatheGeometry(profile, 12);
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  const root = new Color('#fff4d8');
  const tip = new Color('#ff8a2a');
  const tmp = new Color();
  for (let i = 0; i < p.count; i++) {
    tmp.copy(root).lerp(tip, Math.min(1, p.getY(i) * 1.2));
    c[i * 3] = tmp.r;
    c[i * 3 + 1] = tmp.g;
    c[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new BufferAttribute(c, 3));
  return g;
}

export { PIANO };
