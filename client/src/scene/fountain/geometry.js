import { BufferAttribute, BufferGeometry, CircleGeometry } from 'three';

// Shapes of the courtyard fountain, in its own frame: the axis at the origin, y up from the floor.
// The marble is two lathe profiles (outer basin, and the pedestal with both tiers and the finial)
// merged into one geometry; the water is three discs and three falling sheets.

export const GRAVITY = 9.81;
const TAU = Math.PI * 2;

/** Water levels (m above the floor) and the inner radius each pool fills to. */
export const POOLS = {
  basin: { y: 0.4, radius: 1.205 },
  lower: { y: 1.079, radius: 0.665 },
  upper: { y: 1.511, radius: 0.35 },
};

/**
 * The three falling sheets: where each leaves (r0, y0) with what speed (vr, vy), where it lands (yEnd),
 * and how many streams it breaks into (0: an unbroken bell). Landing radii are filled in below.
 */
export const FALLS = [
  // Over the lower bowl's lip into the basin.
  { r0: 0.712, y0: 1.062, vr: 0.3, vy: 0, yEnd: POOLS.basin.y, streams: 14, seed: 3.1, segments: 140 },
  // Over the upper bowl's lip into the lower bowl.
  { r0: 0.392, y0: 1.5, vr: 0.24, vy: 0, yEnd: POOLS.lower.y, streams: 9, seed: 7.7, segments: 90 },
  // A low bell of water from the finial into the upper bowl.
  { r0: 0.012, y0: 1.668, vr: 0.5, vy: 0.7, yEnd: POOLS.upper.y, streams: 0, seed: 1.9, segments: 48 },
].map((f) => {
  const fall = f.y0 - f.yEnd;
  const time = (f.vy + Math.sqrt(f.vy * f.vy + 2 * GRAVITY * fall)) / GRAVITY;
  return { ...f, time, landRadius: f.r0 + f.vr * time };
});

/** Where each fall lands, matched to the pool it lands in (the water shader rings it there). */
export const LANDINGS = { basin: FALLS[0], lower: FALLS[1], upper: FALLS[2] };

// ---------------------------------------------------------------------------------------------
// Lathe profiles. Each is traced anticlockwise round the stone's cross-section (r to the right, y up),
// so faces point out of the stone. `zone` tags let the painter shade each part.

function profile() {
  const pts = [];
  let zone = 'out';
  const api = {
    pts,
    zone(z) {
      zone = z;
      return api;
    },
    pt(r, y) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(last.r - r, last.y - y) > 1e-5) pts.push({ r, y, zone });
      return api;
    },
    /** A circular arc (a torus or cove moulding) from a0 to a1 degrees. */
    arc(cr, cy, rad, a0, a1, n = 8) {
      for (let k = 0; k <= n; k++) {
        const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180;
        api.pt(cr + rad * Math.cos(a), cy + rad * Math.sin(a));
      }
      return api;
    },
    /** A smooth curve through the given [r, y] points (Catmull-Rom), from the current point. */
    curve(points, n = 4) {
      const all = [[pts[pts.length - 1].r, pts[pts.length - 1].y], ...points];
      for (let i = 0; i < all.length - 1; i++) {
        const p0 = all[Math.max(0, i - 1)];
        const p1 = all[i];
        const p2 = all[i + 1];
        const p3 = all[Math.min(all.length - 1, i + 2)];
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const t2 = t * t;
          const t3 = t2 * t;
          const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
          api.pt(f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]));
        }
      }
      return api;
    },
  };
  return api;
}

/** The outer basin: plinth, base torus, body, cove, rim roll, a flat rim to sit on, inner wall and floor. */
function basinProfile() {
  const p = profile();
  p.zone('out').pt(1.44, -0.02).pt(1.44, 0.055).pt(1.405, 0.065);
  p.arc(1.405, 0.1, 0.035, -90, 90, 8); // base torus
  p.arc(1.39, 0.18, 0.04, 270, 180, 6); // cove up into the body (concave)
  p.pt(1.35, 0.325);
  p.zone('under').arc(1.395, 0.325, 0.045, 180, 90, 6); // cavetto under the rim
  p.zone('out').arc(1.405, 0.43, 0.045, -90, 90, 12); // the rim roll
  p.zone('top').arc(1.385, 0.47, 0.02, 15, 90, 4);
  p.pt(1.235, 0.49);
  p.arc(1.235, 0.465, 0.025, 90, 180, 5); // rounded inner edge
  p.zone('inner').curve([[1.205, 0.4], [1.185, 0.24], [1.17, 0.17]], 4);
  p.arc(1.12, 0.17, 0.05, 0, -90, 5); // cove into the floor (concave)
  p.zone('floor').pt(0.6, 0.12).pt(0, 0.12);
  return p.pts;
}

/** The pedestal: a baluster carrying the lower bowl, a smaller baluster, the upper bowl and a finial. */
function pedestalProfile() {
  const p = profile();
  // Square-edged plinth sitting in the basin, then a torus and a scotia.
  p.zone('wet').pt(0.315, 0.1).pt(0.315, 0.175).pt(0.29, 0.185);
  p.arc(0.29, 0.21, 0.025, -90, 90, 6);
  p.pt(0.245, 0.25);
  p.arc(0.245, 0.29, 0.04, 270, 180, 5);
  // Lower baluster: a belly low down, a slender neck, then a collar.
  p.zone('stem').curve([[0.2, 0.36], [0.215, 0.46], [0.19, 0.56], [0.13, 0.66], [0.105, 0.715]], 5);
  p.pt(0.125, 0.722);
  p.arc(0.125, 0.745, 0.023, -90, 90, 6);
  p.pt(0.11, 0.775);
  // Underside of the lower bowl, flaring out to its lip.
  p.zone('under').curve([[0.17, 0.805], [0.3, 0.855], [0.46, 0.92], [0.6, 0.985], [0.675, 1.015]], 4);
  p.zone('lip').arc(0.675, 1.045, 0.03, -90, 90, 8);
  p.pt(0.655, 1.077);
  // Inside the lower bowl, under water.
  p.zone('pool').curve([[0.62, 1.055], [0.5, 1.0], [0.32, 0.972], [0.13, 0.962]], 4);
  // Upper baluster.
  p.zone('stem').curve([[0.1, 1.0], [0.118, 1.08], [0.112, 1.16], [0.085, 1.23], [0.075, 1.255]], 4);
  p.pt(0.09, 1.26);
  p.arc(0.09, 1.276, 0.016, -90, 90, 5);
  p.pt(0.08, 1.295);
  // Underside of the upper bowl and its lip.
  p.zone('under').curve([[0.13, 1.32], [0.22, 1.37], [0.31, 1.425], [0.36, 1.455]], 4);
  p.zone('lip').arc(0.362, 1.48, 0.025, -90, 90, 7);
  p.pt(0.345, 1.508);
  p.zone('pool').curve([[0.325, 1.495], [0.25, 1.46], [0.13, 1.437], [0.065, 1.432]], 4);
  // The finial: a small vase, water running down it.
  p.zone('finial').curve([[0.052, 1.46], [0.04, 1.49]], 3);
  p.pt(0.058, 1.497);
  p.arc(0.058, 1.507, 0.01, -90, 90, 4);
  p.pt(0.048, 1.52);
  p.curve([[0.066, 1.565], [0.058, 1.605], [0.036, 1.638], [0.018, 1.658], [0, 1.668]], 4);
  return p.pts;
}

/** Shade per vertex: colour (ambient occlusion and the green of stone under water) and wetness (0..1). */
function paintBasin(r, y, zone) {
  if (zone === 'floor' || (zone === 'inner' && y < POOLS.basin.y)) {
    const ao = zone === 'floor' ? 0.62 + 0.25 * Math.min(1, Math.max(0, (r - 0.35) / 0.6)) : 0.78;
    return { tint: [0.7 * ao, 0.83 * ao, 0.76 * ao], wet: 1 };
  }
  if (zone === 'inner') {
    const damp = Math.max(0, Math.min(1, (POOLS.basin.y + 0.05 - y) / 0.05)); // a damp band just above the water
    return { tint: [0.93, 0.93, 0.92], wet: damp * 0.8 };
  }
  const ao = zone === 'under' ? 0.82 : y < 0.07 ? 0.8 : 1;
  return { tint: [ao, ao, ao], wet: 0 };
}

function paintPedestal(r, y, zone) {
  const underBasin = y < POOLS.basin.y;
  const underLower = zone === 'pool' && y < POOLS.lower.y;
  const underUpper = zone === 'pool' && y > 1.3;
  if (underBasin || underLower || underUpper) return { tint: [0.68, 0.8, 0.74], wet: 1 };
  if (zone === 'lip' || zone === 'finial') return { tint: [0.95, 0.95, 0.94], wet: 0.9 }; // water runs over these
  // Spray keeps the foot of each baluster damp.
  const splashed = y < POOLS.basin.y + 0.12 ? 1 - (y - POOLS.basin.y) / 0.12 : y > POOLS.lower.y && y < POOLS.lower.y + 0.08 ? 1 - (y - POOLS.lower.y) / 0.08 : 0;
  // The undersides of the bowls are shaded by the bowls, most of all close to the stem.
  const ao = zone === 'under' ? 0.68 + 0.3 * Math.min(1, r / 0.6) : zone === 'stem' ? 0.86 : 1;
  return { tint: [ao, ao, ao], wet: splashed * 0.6 };
}

/** Sharp corners get a doubled vertex, so each face keeps its own normal there. */
function withCreases(pts, degrees = 38) {
  const out = [];
  const limit = Math.cos((degrees * Math.PI) / 180);
  for (let i = 0; i < pts.length; i++) {
    out.push(pts[i]);
    if (i === 0 || i === pts.length - 1) continue;
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const ux = b.r - a.r;
    const uy = b.y - a.y;
    const vx = c.r - b.r;
    const vy = c.y - b.y;
    const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    if (cos < limit) out.push(pts[i]);
  }
  return out;
}

/** Revolves a profile into an indexed surface (sharing vertices round the ring, so it has no seam). */
function revolve(source, segments, paint) {
  const pts = withCreases(source);
  const n = pts.length;
  const position = new Float32Array(n * segments * 3);
  const color = new Float32Array(n * segments * 3);
  const wet = new Float32Array(n * segments);
  for (let i = 0; i < segments; i++) {
    const phi = (i / segments) * TAU;
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    for (let j = 0; j < n; j++) {
      const { r, y, zone } = pts[j];
      const v = i * n + j;
      position.set([r * s, y, r * c], v * 3);
      const shade = paint(r, y, zone);
      color.set(shade.tint, v * 3);
      wet[v] = shade.wet;
    }
  }
  const index = [];
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j;
      const b = next * n + j;
      index.push(a, b, a + 1, b + 1, a + 1, b);
    }
  }
  return { position, color, wet, index };
}

/** Concatenates indexed parts with the same attributes into one geometry. */
function merge(parts, names) {
  const geometry = new BufferGeometry();
  const vertices = parts.reduce((s, p) => s + p.position.length / 3, 0);
  for (const [name, size] of names) {
    const array = new Float32Array(vertices * size);
    let offset = 0;
    for (const p of parts) {
      array.set(p[name], offset);
      offset += p[name].length;
    }
    geometry.setAttribute(name, new BufferAttribute(array, size));
  }
  const index = [];
  let base = 0;
  for (const p of parts) {
    for (const k of p.index) index.push(k + base);
    base += p.position.length / 3;
  }
  geometry.setIndex(index);
  return geometry;
}

/** All the marble, one geometry: position, normal, color (shade) and aWet. */
export function marbleGeometry() {
  const geometry = merge(
    [revolve(basinProfile(), 96, paintBasin), revolve(pedestalProfile(), 64, paintPedestal)],
    [
      ['position', 3],
      ['color', 3],
      ['wet', 1],
    ],
  );
  geometry.setAttribute('aWet', geometry.getAttribute('wet'));
  geometry.deleteAttribute('wet');
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The three pools' surfaces as one geometry. aPool tells the water shader what lands in each:
 * x streams (0: an unbroken ring), y landing radius, z the fall's seed (to match its streams).
 */
export function waterGeometry() {
  const parts = Object.entries(POOLS).map(([name, pool]) => {
    const disc = new CircleGeometry(pool.radius, name === 'basin' ? 96 : 48);
    disc.rotateX(-Math.PI / 2);
    disc.translate(0, pool.y, 0);
    const land = LANDINGS[name];
    const count = disc.getAttribute('position').count;
    const aPool = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) aPool.set([land.streams, land.landRadius, land.seed], i * 3);
    const part = {
      position: disc.getAttribute('position').array,
      normal: disc.getAttribute('normal').array,
      aPool,
      index: Array.from(disc.getIndex().array),
    };
    disc.dispose();
    return part;
  });
  return merge(parts, [
    ['position', 3],
    ['normal', 3],
    ['aPool', 3],
  ]);
}

/**
 * The falling sheets as one geometry: each a surface of revolution along its fall's parabola. uv.x runs round
 * (0..1), uv.y down the fall in time (0 at the lip, 1 where it lands), so a pattern scrolled at a steady rate
 * in uv.y speeds up in space, as falling water does. aFall: x streams, y seed, z seconds to fall.
 */
export function fallsGeometry(rows = 14) {
  const parts = FALLS.map((f) => {
    const cols = f.segments;
    const count = (cols + 1) * (rows + 1);
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const aFall = new Float32Array(count * 3);
    for (let i = 0; i <= cols; i++) {
      const phi = (i / cols) * TAU;
      const s = Math.sin(phi);
      const c = Math.cos(phi);
      for (let j = 0; j <= rows; j++) {
        const v = j / rows;
        const t = v * f.time;
        const r = f.r0 + f.vr * t;
        const y = f.y0 + f.vy * t - 0.5 * GRAVITY * t * t;
        // Normal of the sheet: perpendicular to its direction of travel, facing outward.
        const dr = f.vr;
        const dy = f.vy - GRAVITY * t;
        const len = Math.hypot(dr, dy);
        const k = i * (rows + 1) + j;
        position.set([r * s, y, r * c], k * 3);
        normal.set([(-dy / len) * s, dr / len, (-dy / len) * c], k * 3);
        uv.set([i / cols, v], k * 2);
        aFall.set([f.streams, f.seed, f.time], k * 3);
      }
    }
    const index = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const a = i * (rows + 1) + j;
        const b = (i + 1) * (rows + 1) + j;
        index.push(a, b, a + 1, b + 1, a + 1, b);
      }
    }
    return { position, normal, uv, aFall, index };
  });
  return merge(parts, [
    ['position', 3],
    ['normal', 3],
    ['uv', 2],
    ['aFall', 3],
  ]);
}
