import { BoxGeometry, Color, CylinderGeometry, Quaternion, Vector3 } from 'three';
import { orient, painted, taperedTube, turned } from './geometry';

// Builders for every plant and its pot. Each writes leaves and blossoms into the instance lists in
// `ctx` (ivy, lance, fig, raceme, bloom) and solid parts into `ctx.solid` (vertex-coloured: terracotta,
// soil, bark, glaze, stems) or `ctx.stone` (the house's stone). All positions are world metres.

const UP = new Vector3(0, 1, 0);
const q = new Quaternion();
const v = new Vector3();
const w = new Vector3();
const dir = new Vector3();
const face = new Vector3();

const hex = (h) => new Color(h);
/** A colour near `base`, varied in hue, saturation and lightness. */
function vary(base, rand, dh = 0.02, ds = 0.08, dl = 0.08) {
  const hsl = {};
  base.getHSL(hsl);
  return new Color().setHSL(hsl.h + (rand() * 2 - 1) * dh, Math.min(1, Math.max(0, hsl.s + (rand() * 2 - 1) * ds)), Math.min(1, Math.max(0, hsl.l + (rand() * 2 - 1) * dl)));
}

const IVY = { old: hex('#2c4a1f'), young: hex('#5f8a32') };
const WISTERIA_LEAF = hex('#58783a');
const BARK = { olive: hex('#6b6152'), vine: hex('#5a4a3c'), fig: hex('#5e5244') };
const OLIVE = { top: hex('#58663f'), silver: hex('#97a08a') };
const FIG = { old: hex('#2b5320'), young: hex('#5a8c36') };
const SOIL = hex('#2e2219');
const TERRACOTTA = hex('#9a5a3e');
const STEM = hex('#4a6a2c');

// ---------------------------------------------------------------------------------------------------
// Hanging plants

/**
 * One hanging strand of ivy, following `path(s)` (s = metres from its root) for `length` metres.
 * Leaves come in nodes every few centimetres, turned out toward `out` (the open side); the tip is
 * younger (smaller, fresher green) and sways most.
 */
function ivyStrand(ctx, rand, path, length, out, phase, startS = 0) {
  const step = 0.045;
  for (let s = startS; s < length; s += step * rand.range(0.7, 1.3)) {
    const u = s / length;
    path(s, v);
    const perNode = rand() < 0.45 ? 2 : 1;
    for (let k = 0; k < perNode; k++) {
      const side = rand.sign();
      // Blades hang down and sideways from their stalks, faces turned to the light.
      dir.set(side * rand.range(0.3, 0.9), -rand.range(0.25, 0.95), 0).addScaledVector(out, rand.range(0.1, 0.5));
      face.copy(out).addScaledVector(UP, rand.range(0, 0.5)).add(w.set(rand.range(-0.4, 0.4), 0, rand.range(-0.2, 0.2)));
      orient(dir, face, q);
      const size = (0.085 + 0.055 * (1 - u) * rand()) * (u > 0.85 ? 0.75 : 1);
      const color = new Color().lerpColors(IVY.old, IVY.young, Math.min(1, u * 0.8 + rand() * 0.35));
      w.copy(v).addScaledVector(out, rand.range(0.0, 0.05)).add(dir.set(rand.range(-0.03, 0.03), 0, 0));
      ctx.ivy.add(w, q, size, size, vary(color, rand, 0.015, 0.06, 0.05), 0.012 + 0.16 * Math.pow(u, 1.4) * Math.min(1, length / 1.6), phase - s * 0.9);
    }
  }
}

/**
 * Ivy spilling over a balustrade: a mat of leaves on the coping between x0 and x1, a frill over its
 * front edge, and a curtain of strands of uneven length hanging down the courtyard face.
 *
 * `rail` = { topY, lipZ, out } where lipZ is the front edge of the coping and out (+1 or -1) the way
 * the courtyard lies in z. `bottomAt(x)` gives the lowest a strand may reach at x.
 */
export function ivyCurtain(ctx, rand, x0, x1, rail, bottomAt, maxLength = 2.4) {
  const out = new Vector3(0, 0, rail.out);
  const width = x1 - x0;
  // Mat on top: leaves lying on the coping, faces up.
  const mat = Math.round(width * 130);
  for (let i = 0; i < mat; i++) {
    const x = rand.range(x0, x1);
    const back = rand.range(-0.02, 0.3);
    // Heaped highest near the front edge, like ivy that has grown up and over it.
    const heap = 0.12 * (1 - back / 0.3) * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, (x - x0) / width))), 0.4);
    v.set(x, rail.topY + rand.range(0.0, 0.03) + heap * rand(), rail.lipZ - rail.out * back);
    dir.set(rand.range(-1, 1), rand.range(-0.1, 0.35), rand.range(-1, 1));
    face.set(rand.range(-0.5, 0.5), 1, rand.range(-0.5, 0.5)).addScaledVector(out, 0.4);
    orient(dir, face, q);
    const size = rand.range(0.08, 0.13);
    ctx.ivy.add(v, q, size, size, vary(IVY.old, rand, 0.02, 0.06, 0.06), 0.008, rand() * 6);
  }
  // Strands, spaced unevenly; their lengths follow a soft envelope, longest mid-patch.
  for (let x = x0 + rand.range(0, 0.05); x < x1; x += rand.range(0.05, 0.13)) {
    const u = (x - x0) / width;
    const envelope = Math.pow(Math.sin(Math.PI * u), 0.6);
    const limit = rail.topY - bottomAt(x);
    let length = Math.min(limit, maxLength * envelope * rand.range(0.45, 1.05) + 0.25);
    if (rand() < 0.2) length *= 0.5; // short sprigs between the long ones
    if (length < 0.2) continue;
    const lean = rand.range(-0.08, 0.08);
    const sway = rand.range(0.02, 0.06);
    const phase = x * 1.3 + rand() * 0.8;
    const drop = rand.range(0.0, 0.04);
    // Over the lip, then straight down with a slight wander, drifting out from the face as it falls.
    const path = (s, target) => {
      if (s < 0.08) return target.set(x, rail.topY + 0.03 - s * 0.4, rail.lipZ + rail.out * (s - 0.04));
      const d = s - 0.08;
      return target.set(x + lean * d + Math.sin(d * 3.1 + phase) * sway, rail.topY - d - drop, rail.lipZ + rail.out * (0.06 + 0.03 * d));
    };
    ivyStrand(ctx, rand, path, length, out, phase);
  }
  // A frill of leaves over the front edge hides where the strands begin.
  for (let i = 0; i < width * 40; i++) {
    const x = rand.range(x0, x1);
    v.set(x, rail.topY + rand.range(-0.12, 0.04), rail.lipZ + rail.out * rand.range(0.02, 0.1));
    dir.set(rand.range(-0.8, 0.8), rand.range(-0.9, 0.3), 0).addScaledVector(out, rand.range(0.3, 0.9));
    face.copy(out).addScaledVector(UP, 0.6);
    orient(dir, face, q);
    const size = rand.range(0.09, 0.13);
    ctx.ivy.add(v, q, size, size, vary(IVY.old, rand, 0.02, 0.06, 0.07), 0.01, x * 1.3);
  }
}

/**
 * Ivy that has climbed onto an upper arch and falls back down the face of its column: a clump round
 * the anchor and a narrow curtain of strands, from topY down to as low as bottomY.
 */
export function ivyDrape(ctx, rand, x, faceZ, out, topY, bottomY, width = 0.8) {
  const o = new Vector3(0, 0, out);
  for (let i = 0; i < 160; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    v.set(x + Math.cos(a) * r * width * 0.75, topY + Math.sin(a) * r * 0.35, faceZ + out * rand.range(0.02, 0.1));
    dir.set(rand.range(-1, 1), rand.range(-1, 0.6), 0).addScaledVector(o, 0.3);
    face.copy(o).addScaledVector(UP, rand.range(-0.2, 0.5));
    orient(dir, face, q);
    const size = rand.range(0.085, 0.13);
    ctx.ivy.add(v, q, size, size, vary(IVY.old, rand, 0.02, 0.06, 0.07), 0.01, x);
  }
  for (let sx = x - width / 2; sx < x + width / 2; sx += rand.range(0.05, 0.11)) {
    const u = (sx - (x - width / 2)) / width;
    const length = (topY - bottomY) * Math.pow(Math.sin(Math.PI * u), 0.5) * rand.range(0.5, 1);
    if (length < 0.2) continue;
    const phase = sx * 1.7 + rand();
    const lean = rand.range(-0.06, 0.06);
    const path = (s, t) => t.set(sx + lean * s + Math.sin(s * 2.7 + phase) * 0.04, topY - s, faceZ + out * (0.05 + 0.02 * s));
    ivyStrand(ctx, rand, path, length, o, phase);
  }
}

/**
 * Wisteria over a balustrade: twisted woody vines along the coping, leafy hanging shoots and dense
 * lilac racemes hanging below the edge, longest racemes and shoots mid-patch.
 */
export function wisteriaCurtain(ctx, rand, x0, x1, rail, bottomAt) {
  const out = new Vector3(0, 0, rail.out);
  const width = x1 - x0;
  // Two old vines run along the coping, twisting round each other, half hidden under leaves.
  for (let vine = 0; vine < 2; vine++) {
    const pts = [];
    const radii = [];
    const n = Math.max(8, Math.round(width * 7));
    const wander = rand() * 6;
    for (let i = 0; i <= n; i++) {
      const x = x0 - 0.15 + ((width + 0.3) * i) / n;
      const a = i * 1.1 + vine * Math.PI + Math.sin(i * 0.7 + wander);
      pts.push(new Vector3(x, rail.topY + 0.045 + Math.sin(a) * 0.035, rail.lipZ - rail.out * (0.09 + Math.cos(a) * 0.06)));
      radii.push(0.026 * (0.7 + 0.3 * Math.sin(i * 2.3 + vine)) * (i === 0 || i === n ? 0.5 : 1));
    }
    ctx.solid.push(taperedTube(pts, radii, vary(BARK.vine, rand, 0.01, 0.03, 0.04), 6));
  }
  // A compound leaf: a stalk reaching out and down with leaflets in pairs and one at its tip.
  const rachis = new Vector3();
  const side = new Vector3();
  const leaf = (base, reach, amplitude, phase) => {
    rachis.set(rand.range(-0.7, 0.7), -rand.range(0.2, 0.9), 0).addScaledVector(out, rand.range(0.2, 0.8)).normalize();
    side.crossVectors(rachis, out);
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    side.normalize();
    const pairs = 3 + Math.floor(rand() * 3);
    const color = vary(WISTERIA_LEAF, rand, 0.02, 0.06, 0.07);
    for (let p = 0; p <= pairs; p++) {
      const at = w.copy(base).addScaledVector(rachis, (reach * (p + 0.6)) / (pairs + 1));
      const len = rand.range(0.06, 0.085) * (p === pairs ? 1.1 : 1);
      for (const s of p === pairs ? [0] : [-1, 1]) {
        dir.copy(rachis).multiplyScalar(0.5).addScaledVector(side, s).add(face.set(0, -0.25, 0));
        if (s === 0) dir.copy(rachis);
        face.copy(out).addScaledVector(UP, 0.7);
        orient(dir, face, q);
        ctx.lance.add(at, q, len * 0.42, len, color, amplitude, phase);
      }
    }
  };
  // Leaves heaped along the coping over the vines.
  for (let i = 0; i < width * 14; i++) {
    v.set(rand.range(x0, x1), rail.topY + rand.range(0.04, 0.14), rail.lipZ - rail.out * rand.range(-0.02, 0.25));
    leaf(v, rand.range(0.12, 0.2), 0.008, v.x);
  }
  // Hanging shoots, longest mid-patch; leaves all the way down and racemes among them.
  for (let x = x0 + rand.range(0, 0.06); x < x1; x += rand.range(0.07, 0.14)) {
    const u = (x - x0) / width;
    const envelope = Math.pow(Math.sin(Math.PI * u), 0.5);
    const length = Math.min(rail.topY - bottomAt(x), rand.range(0.3, 1.9) * envelope + 0.15);
    if (length < 0.15) continue;
    const phase = x * 1.1 + rand();
    const lean = rand.range(-0.12, 0.12);
    const bow = rand.range(0.04, 0.12);
    const at = (s, t) => t.set(x + lean * s, rail.topY - 0.03 - s, rail.lipZ + rail.out * (0.07 + bow * Math.sin(Math.min(s, 1.2) * 2.2)));
    const sway = (s) => 0.012 + 0.11 * Math.pow(s / 1.8, 1.2);
    for (let s = 0; s < length; s += rand.range(0.07, 0.11)) {
      at(s, v);
      leaf(v, rand.range(0.14, 0.24), sway(s), phase - s);
    }
    // Racemes hang from the whole shoot, a little more thickly toward the top.
    const count = Math.round(rand.range(1, 3) + length * 4.5);
    for (let i = 0; i < count; i++) {
      const s = Math.pow(rand(), 1.25) * length;
      at(s, v);
      v.x += rand.range(-0.07, 0.07);
      v.addScaledVector(out, rand.range(0.02, 0.12));
      dir.set(rand.range(-0.15, 0.15), -1, 0).addScaledVector(out, rand.range(0.05, 0.3));
      face.copy(out);
      orient(dir, face, q);
      const len = rand.range(0.24, 0.48) * (0.8 + 0.2 * envelope);
      ctx.raceme.add(v, q, len * rand.range(0.34, 0.42), len, vary(hex('#ffffff'), rand, 0.03, 0.0, 0.1), sway(s) + 0.02, phase - s);
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Pots

/** A large Mediterranean terracotta pot with a rolled rim. Returns its height and widest radius. */
export function terracottaPot(ctx, at) {
  const profile = [[0, 0], [0.25, 0], [0.27, 0.03], [0.34, 0.25], [0.39, 0.48], [0.4, 0.52], [0.45, 0.54], [0.47, 0.58], [0.46, 0.63], [0.42, 0.64], [0.4, 0.6]];
  ctx.solid.push(turned(profile, at, TERRACOTTA, 24));
  ctx.solid.push(turned([[0.4, 0.57], [0.2, 0.59], [0, 0.6]], at, SOIL, 16));
  return { height: 0.64, radius: 0.47, soil: at.y + 0.59 };
}

/** A classical stone urn: footed, with a gadrooned-looking bowl and a heavy lip. */
export function stoneUrn(ctx, at) {
  const profile = [[0, 0], [0.3, 0], [0.3, 0.07], [0.25, 0.1], [0.16, 0.15], [0.13, 0.24], [0.2, 0.28], [0.34, 0.36], [0.42, 0.48], [0.45, 0.6], [0.49, 0.63], [0.49, 0.7], [0.44, 0.71], [0.42, 0.64]];
  ctx.stone.push(turned(profile, at, hex('#ffffff'), 24));
  ctx.solid.push(turned([[0.42, 0.63], [0.2, 0.655], [0, 0.66]], at, SOIL, 16));
  return { height: 0.71, radius: 0.49, soil: at.y + 0.65 };
}

// ---------------------------------------------------------------------------------------------------
// Potted trees

/** A Mediterranean olive: a twisted, gnarled double trunk, a few crooked limbs and a silvery crown. */
export function oliveTree(ctx, rand, base, height, away = new Vector3()) {
  // Leans out from whatever stands beside it (`away`), a little off-line, as trees grow toward light.
  const lean = new Vector3(rand.range(-0.6, 0.6), 0, rand.range(-0.6, 0.6)).add(away).normalize().multiplyScalar(0.2);
  const trunkTop = height * 0.42;
  // Two stems twisting round each other.
  for (let stem = 0; stem < 2; stem++) {
    const pts = [];
    const radii = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const a = t * 4.2 + stem * Math.PI;
      pts.push(new Vector3(
        base.x + lean.x * t + Math.cos(a) * 0.045 + Math.sin(t * 9 + stem) * 0.02,
        base.y - 0.04 + t * trunkTop,
        base.z + lean.z * t + Math.sin(a) * 0.045 + Math.cos(t * 7 + stem) * 0.02,
      ));
      radii.push((0.075 - 0.025 * t) * (1 + 0.18 * Math.sin(t * 17 + stem * 3)) + (i === 0 ? 0.02 : 0));
    }
    ctx.solid.push(taperedTube(pts, radii, vary(BARK.olive, rand, 0.01, 0.03, 0.04), 8));
  }
  const top = new Vector3(base.x + lean.x, base.y + trunkTop, base.z + lean.z);
  const limbs = 6;
  const sprays = [];
  for (let l = 0; l < limbs; l++) {
    const a = (l / limbs) * Math.PI * 2 + rand.range(-0.4, 0.4);
    const spread = rand.range(0.35, 0.65);
    const d = new Vector3(Math.cos(a) * spread, 1, Math.sin(a) * spread).normalize();
    const len = (height - trunkTop) * rand.range(0.62, 0.85);
    const start = top.clone().add(new Vector3(rand.range(-0.03, 0.03), rand.range(-0.15, 0), rand.range(-0.03, 0.03)));
    const pts = [];
    const radii = [];
    const p = start.clone();
    for (let i = 0; i <= 6; i++) {
      pts.push(p.clone());
      radii.push(0.042 * (1 - i / 7.5));
      // Crooked: each segment kinks a little, and the limb curls upward toward its end.
      p.addScaledVector(d, len / 6).add(new Vector3(rand.range(-0.04, 0.04), 0.02 * i, rand.range(-0.04, 0.04)));
    }
    ctx.solid.push(taperedTube(pts, radii, vary(BARK.olive, rand, 0.01, 0.03, 0.04), 6));
    sprays.push({ at: pts[6], d });
    // Side branches from its upper half, each ending in a spray.
    for (let b = 0; b < 4; b++) {
      const i = 2 + Math.floor(rand() * 4);
      const from = pts[i];
      const bd = d.clone().add(new Vector3(rand.range(-0.9, 0.9), rand.range(-0.2, 0.3), rand.range(-0.9, 0.9))).normalize();
      const blen = rand.range(0.25, 0.45);
      const to = from.clone().addScaledVector(bd, blen);
      const mid = from.clone().lerp(to, 0.5).add(new Vector3(0, 0.04, 0));
      ctx.solid.push(taperedTube([from, mid, to], [0.016, 0.011, 0.006], BARK.olive, 5));
      sprays.push({ at: to, d: bd });
      sprays.push({ at: mid, d: bd.clone().add(new Vector3(0, 0.5, 0)).normalize() });
    }
  }
  // Leaf sprays: short twigs fanning out of each branch end, narrow leaves in pairs along them.
  const twigDir = new Vector3();
  for (const spray of sprays) {
    const twigs = 4 + Math.floor(rand() * 3);
    const phase = rand() * 6;
    for (let t = 0; t < twigs; t++) {
      twigDir.copy(spray.d).add(v.set(rand.range(-0.9, 0.9), rand.range(-0.5, 0.6), rand.range(-0.9, 0.9))).normalize();
      const tl = rand.range(0.18, 0.32);
      for (let s = 0.02; s < tl; s += rand.range(0.025, 0.035)) {
        const pos = w.copy(spray.at).addScaledVector(twigDir, s);
        for (const side of [-1, 1]) {
          const perp = v.crossVectors(twigDir, UP);
          if (perp.lengthSq() < 0.01) perp.set(1, 0, 0);
          perp.normalize();
          dir.copy(twigDir).multiplyScalar(rand.range(0.6, 1.1)).addScaledVector(perp, side * rand.range(0.5, 0.9)).add(face.set(0, -rand.range(0, 0.4), 0));
          face.set(rand.range(-0.4, 0.4), 1, rand.range(-0.4, 0.4));
          orient(dir, face, q);
          const len = rand.range(0.095, 0.125);
          const color = rand() < 0.32 ? vary(OLIVE.silver, rand, 0.02, 0.05, 0.05) : vary(OLIVE.top, rand, 0.02, 0.06, 0.06);
          ctx.lance.add(pos, q, len * 0.27, len, color, 0.006 + 0.012 * (pos.y - base.y) / height, phase);
        }
      }
      // A leaf at the very tip of the twig.
      orient(twigDir, w.set(0, 1, 0), q);
      ctx.lance.add(v.copy(spray.at).addScaledVector(twigDir, tl), q, 0.02, 0.08, vary(OLIVE.top, rand), 0.015, phase);
    }
  }
}

/** A fiddle-leaf fig: two or three slim stems with big glossy violin-shaped leaves spiralling up them. */
export function figTree(ctx, rand, base, height, away = new Vector3()) {
  const stems = 3;
  for (let k = 0; k < stems; k++) {
    const a = (k / stems) * Math.PI * 2 + rand();
    const tilt = new Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(k === 0 ? 0.05 : rand.range(0.12, 0.22)).addScaledVector(away, 0.08);
    const h = height * (k === 0 ? 1 : rand.range(0.72, 0.9));
    const pts = [];
    const radii = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push(new Vector3(base.x + tilt.x * t * h + Math.sin(t * 3 + k) * 0.02, base.y - 0.03 + t * h, base.z + tilt.z * t * h));
      radii.push(0.026 - 0.014 * t);
    }
    ctx.solid.push(taperedTube(pts, radii, BARK.fig, 6));
    const phase = rand() * 6;
    let ang = rand() * Math.PI * 2;
    for (let s = h * 0.32; s < h; s += rand.range(0.035, 0.05)) {
      const t = s / h;
      ang += 2.4; // golden angle: leaves never stack
      const stemAt = v.set(base.x + tilt.x * s, base.y + s, base.z + tilt.z * s);
      const outward = w.set(Math.cos(ang), 0, Math.sin(ang));
      // Lower leaves reach out level and droop; the youngest at the top stand up.
      // Blades held out and up, faces turned outward to the room rather than flat to the ceiling.
      dir.copy(outward).add(face.set(0, 0.35 + 1.2 * t * t, 0)).normalize();
      face.set(rand.range(-0.3, 0.3), 0.7, rand.range(-0.3, 0.3)).addScaledVector(outward, 0.8);
      orient(dir, face, q);
      const len = (0.5 - 0.2 * t) * rand.range(0.85, 1.1);
      const pos = stemAt.addScaledVector(outward, 0.03);
      const color = new Color().lerpColors(FIG.old, FIG.young, Math.max(0, t - 0.55) * 2 + rand() * 0.15);
      ctx.fig.add(pos, q, len * 0.78, len, vary(color, rand, 0.01, 0.05, 0.04), 0.006 + 0.01 * t, phase);
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Flowers

/** A slender stone pedestal, 1.03 m tall, with a base, a round shaft and a square top. */
export function pedestal(ctx, at) {
  const box = (sx, sy, sz, y) => painted(new BoxGeometry(sx, sy, sz).translate(at.x, at.y + y, at.z), hex('#ffffff'));
  ctx.stone.push(box(0.44, 0.12, 0.44, 0.06));
  ctx.stone.push(box(0.36, 0.08, 0.36, 0.16));
  ctx.stone.push(painted(new CylinderGeometry(0.105, 0.13, 0.72, 16, 1, true).translate(at.x, at.y + 0.56, at.z), hex('#ffffff')));
  ctx.stone.push(box(0.34, 0.06, 0.34, 0.95));
  ctx.stone.push(box(0.4, 0.05, 0.4, 1.005));
  return { top: at.y + 1.03, half: 0.22 };
}

/** A glazed vase standing at `at`, 0.3 m tall. Returns its mouth. */
function vase(ctx, at, color) {
  const profile = [[0, 0], [0.07, 0], [0.08, 0.02], [0.115, 0.1], [0.12, 0.15], [0.09, 0.23], [0.06, 0.26], [0.07, 0.29], [0.085, 0.3], [0.075, 0.305], [0.06, 0.27]];
  ctx.solid.push(turned(profile, at, color, 20));
  ctx.solid.push(turned([[0.06, 0.26], [0, 0.265]], at, SOIL, 10));
  return new Vector3(at.x, at.y + 0.28, at.z);
}

const headQ = new Quaternion();
const petal = new Quaternion();
const local = new Vector3();
const localDir = new Vector3();
const localFace = new Vector3();

/** One rose: three rings of cupped petals, tighter and more upright toward the heart. */
function rose(ctx, rand, centre, axis, scale, color) {
  headQ.setFromUnitVectors(UP, axis);
  const rings = [
    { n: 3, r: 0.004, tilt: 0.12, len: 0.028, wid: 0.026 },
    { n: 5, r: 0.009, tilt: 0.45, len: 0.036, wid: 0.034 },
    { n: 6, r: 0.014, tilt: 0.95, len: 0.042, wid: 0.042 },
  ];
  rings.forEach((ring, ri) => {
    const offset = rand() * Math.PI;
    for (let k = 0; k < ring.n; k++) {
      const a = offset + (k / ring.n) * Math.PI * 2 + rand.range(-0.2, 0.2);
      const ox = Math.cos(a);
      const oz = Math.sin(a);
      const tilt = ring.tilt + rand.range(-0.08, 0.12);
      localDir.set(ox * Math.sin(tilt), Math.cos(tilt), oz * Math.sin(tilt));
      localFace.set(-ox * Math.cos(tilt), Math.sin(tilt), -oz * Math.cos(tilt));
      local.set(ox * ring.r, -0.012 + ri * 0.002, oz * ring.r);
      dir.copy(localDir).applyQuaternion(headQ);
      face.copy(localFace).applyQuaternion(headQ);
      orient(dir, face, petal);
      v.copy(local).multiplyScalar(scale).applyQuaternion(headQ).add(centre);
      const shade = ri === 0 ? color.clone().multiplyScalar(0.92) : color;
      ctx.bloom.add(v, petal, ring.wid * scale, ring.len * scale, vary(shade, rand, 0.01, 0.02, 0.02), 0.004, 0, 1);
    }
  });
  // A green calyx under the head.
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    dir.set(Math.cos(a), -0.6, Math.sin(a)).applyQuaternion(headQ);
    face.set(0, 1, 0).applyQuaternion(headQ);
    orient(dir, face, q);
    ctx.lance.add(v.copy(centre).addScaledVector(axis, -0.012 * scale), q, 0.012 * scale, 0.03 * scale, STEM, 0.004, 0);
  }
}

/** One hydrangea head: a dome of four-petalled florets. */
function hydrangea(ctx, rand, centre, axis, radius, color) {
  const n = Math.round(radius * radius * 7600);
  for (let i = 0; i < n; i++) {
    // Even-ish cover of a dome (more than a hemisphere, so it reads round from the side).
    const y = 1 - rand() * 1.25;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = rand() * Math.PI * 2;
    face.set(Math.cos(a) * r, y, Math.sin(a) * r);
    headQ.setFromUnitVectors(UP, axis);
    face.applyQuaternion(headQ);
    dir.set(rand.range(-1, 1), rand.range(-1, 1), rand.range(-1, 1)).cross(face);
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0).cross(face);
    orient(dir, face, q);
    const size = rand.range(0.032, 0.044);
    v.copy(centre).addScaledVector(face, radius * rand.range(0.9, 1.0)).addScaledVector(dir.normalize(), -size / 2);
    ctx.bloom.add(v, q, size, size, vary(color, rand, 0.025, 0.08, 0.06), 0.003, 0, 0);
  }
}

/** A thin green stem from a vase mouth to a flower. */
function stem(ctx, from, to) {
  const mid = from.clone().lerp(to, 0.5);
  mid.y += 0.02;
  ctx.solid.push(taperedTube([from.clone(), mid, to.clone()], [0.005, 0.0045, 0.004], STEM, 4));
}

/** Leaves round the vase mouth, arching out and down. */
function vaseLeaves(ctx, rand, mouth, count, len, color) {
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const reach = rand.range(0.03, 0.12);
    v.set(mouth.x + Math.cos(a) * reach, mouth.y + rand.range(0.03, 0.2), mouth.z + Math.sin(a) * reach);
    dir.set(Math.cos(a), rand.range(-0.5, 0.4), Math.sin(a));
    face.set(0, 1, 0);
    orient(dir, face, q);
    const l = len * rand.range(0.8, 1.15);
    ctx.lance.add(v, q, l * 0.5, l, vary(color, rand, 0.02, 0.06, 0.06), 0.004, 0);
  }
}

/** A pedestal with a vase of white roses ('roses') or blue-and-white hydrangeas ('hydrangeas'). */
export function flowerStand(ctx, rand, at, kind) {
  const { top, half } = pedestal(ctx, at);
  const isRoses = kind === 'roses';
  const mouth = vase(ctx, new Vector3(at.x, top, at.z), isRoses ? hex('#2e4a6a') : hex('#e9e3d6'));
  if (isRoses) {
    const heads = 14;
    for (let i = 0; i < heads; i++) {
      const a = (i / heads) * Math.PI * 2 + rand.range(-0.3, 0.3);
      const out = i === 0 ? 0 : rand.range(0.07, 0.17);
      const head = new Vector3(mouth.x + Math.cos(a) * out, mouth.y + rand.range(0.2, 0.32) - out * 0.5, mouth.z + Math.sin(a) * out);
      stem(ctx, mouth, head);
      const axis = head.clone().sub(mouth).normalize().lerp(UP, 0.4).normalize();
      const color = rand() < 0.25 ? hex('#f6e6e0') : hex('#fbf7ee');
      rose(ctx, rand, head, axis, rand.range(1.15, 1.4), color);
    }
    vaseLeaves(ctx, rand, mouth, 40, 0.075, hex('#2f5226'));
  } else {
    const palette = [hex('#7d98d8'), hex('#a5b4ea'), hex('#f1f2f6'), hex('#8fa0e0'), hex('#e6e9f4')];
    const heads = 5;
    for (let i = 0; i < heads; i++) {
      const a = (i / heads) * Math.PI * 2 + rand.range(-0.3, 0.3);
      const out = i === 0 ? 0 : rand.range(0.13, 0.17);
      const head = new Vector3(mouth.x + Math.cos(a) * out, mouth.y + (i === 0 ? 0.26 : rand.range(0.12, 0.18)), mouth.z + Math.sin(a) * out);
      stem(ctx, mouth, head);
      const axis = head.clone().sub(mouth).normalize().lerp(UP, 0.5).normalize();
      hydrangea(ctx, rand, head, axis, rand.range(0.1, 0.125), palette[i % palette.length]);
    }
    vaseLeaves(ctx, rand, mouth, 30, 0.15, hex('#3c6a2c'));
  }
  return { top, half };
}
