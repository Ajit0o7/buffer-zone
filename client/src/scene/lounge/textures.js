import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

// Procedural textures for the lounge, painted once on a 2D canvas: no downloads, nothing to load.

// A seeded random, so the rug and the marble come out the same for both players.
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RUG = {
  red: '#8a1a1c',
  redDeep: '#5c0e13',
  navy: '#1c2650',
  navyDeep: '#121a38',
  ivory: '#e9dcc0',
  gold: '#c9973f',
  sky: '#6b8bb3',
  green: '#3f5b3c',
  ink: '#2a1813',
  rose: '#c2584e',
};

/** A lobed outline (r(θ) = 1 + a·cos(nθ)), stretched to rx × ry, as a closed canvas path. */
function lobed(ctx, cx, cy, rx, ry, lobes, depth, rotate = 0) {
  ctx.beginPath();
  const steps = 360;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r = 1 + depth * Math.cos(lobes * t + rotate);
    const x = cx + Math.cos(t) * rx * r;
    const y = cy + Math.sin(t) * ry * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** An eight-petal rosette: the motif that repeats through the field and the border. */
function rosette(ctx, x, y, r, petal, centre, ring = null) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = petal;
  for (let k = 0; k < 8; k++) {
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.ellipse(r * 0.55, 0, r * 0.45, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (ring) {
    ctx.strokeStyle = ring;
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = centre;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A small leaf (palmette), pointing along +x before rotation. */
function leaf(ctx, x, y, len, angle, fill) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -len * 0.38, len, 0);
  ctx.quadraticCurveTo(len * 0.5, len * 0.38, 0, 0);
  ctx.fill();
  ctx.restore();
}

/** A stripe of reciprocal triangles (a "running" guard border) along a rectangle's edge band. */
function guardBand(ctx, x0, y0, x1, y1, width, a, b) {
  ctx.fillStyle = a;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.fillStyle = b;
  const tooth = width * 1.1;
  const edge = (ax, ay, bx, by, nx, ny) => {
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / tooth));
    const dx = (bx - ax) / n;
    const dy = (by - ay) / n;
    for (let i = 0; i < n; i++) {
      const sx = ax + dx * i;
      const sy = ay + dy * i;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + dx, sy + dy);
      ctx.lineTo(sx + dx / 2 + nx * width, sy + dy / 2 + ny * width);
      ctx.closePath();
      ctx.fill();
    }
  };
  // Teeth point inward from the outer edge of the band.
  edge(x0, y0, x1, y0, 0, 1);
  edge(x0, y1, x1, y1, 0, -1);
  edge(x0, y0, x0, y1, 1, 0);
  edge(x1, y0, x1, y1, -1, 0);
}

/**
 * A Persian rug, long axis along the canvas's x: an ivory outer guard, a navy main border with a vine of rosettes
 * and palmettes, gold and red minor guards, a deep-red field with a lattice of small flowers, navy corner spandrels,
 * and a lobed central medallion with pendants. The short ends carry a knotted ivory fringe on transparent ground
 * (the material alpha-tests it), `fringe` metres long on a rug `length` × `width` metres.
 */
export function rugTexture({ length, width, fringe, pixels = 2048, seed = 7 }) {
  const W = pixels;
  const pxPerM = W / (length + 2 * fringe);
  const H = Math.round(width * pxPerM);
  const F = Math.round(fringe * pxPerM);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const rand = random(seed);
  const C = RUG;

  // Rug body (between the fringes).
  const x0 = F;
  const x1 = W - F;
  const y0 = 0;
  const y1 = H;
  const m = (metres) => metres * pxPerM;

  ctx.fillStyle = C.ivory;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

  // Bands from the edge inward: [inset, colour] rings.
  const outer = m(0.05); // ivory outer guard (edge to here)
  const g1 = m(0.04); // red reciprocal guard
  const main = m(0.3); // navy main border
  const g2 = m(0.04); // gold guard
  const g3 = m(0.025); // ivory thin
  const rect = (inset) => [x0 + inset, y0 + inset, x1 - inset, y1 - inset];

  let inset = m(0.015);
  ctx.fillStyle = C.ink;
  ctx.fillRect(...(([a, b, c, d]) => [a, b, c - a, d - b])(rect(inset)));
  inset += m(0.01);
  ctx.fillStyle = C.ivory;
  ctx.fillRect(...(([a, b, c, d]) => [a, b, c - a, d - b])(rect(inset)));
  inset = outer;
  {
    const [a, b, c, d] = rect(inset);
    guardBand(ctx, a, b, c, d, g1, C.redDeep, C.ivory);
    // Clear the middle again, leaving only the band.
  }
  inset += g1;
  const mainRect = rect(inset);
  {
    const [a, b, c, d] = mainRect;
    ctx.fillStyle = C.navy;
    ctx.fillRect(a, b, c - a, d - b);
  }
  // Main border vine: a meandering gold stem with alternating rosettes and palmettes along every side.
  {
    const [a, b, c, d] = mainRect;
    const mid = main / 2;
    const sides = [
      [a + mid, b + mid, c - mid, b + mid],
      [a + mid, d - mid, c - mid, d - mid],
      [a + mid, b + mid, a + mid, d - mid],
      [c - mid, b + mid, c - mid, d - mid],
    ];
    for (const [sx, sy, ex, ey] of sides) {
      const len = Math.hypot(ex - sx, ey - sy);
      const n = Math.max(2, Math.round(len / (main * 1.25)));
      const ux = (ex - sx) / len;
      const uy = (ey - sy) / len;
      const nx = -uy;
      const ny = ux;
      // The stem.
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = main * 0.05;
      ctx.beginPath();
      for (let i = 0; i <= n * 16; i++) {
        const t = i / (n * 16);
        const wob = Math.sin(t * n * Math.PI) * main * 0.22;
        const px = sx + (ex - sx) * t + nx * wob;
        const py = sy + (ey - sy) * t + ny * wob;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const px = sx + (ex - sx) * t;
        const py = sy + (ey - sy) * t;
        if (i % 2 === 0) {
          rosette(ctx, px, py, main * 0.36, C.red, C.gold, C.ivory);
        } else {
          const ang = Math.atan2(uy, ux);
          leaf(ctx, px, py, main * 0.42, ang + Math.PI / 2, C.rose);
          leaf(ctx, px, py, main * 0.42, ang - Math.PI / 2, C.rose);
          rosette(ctx, px, py, main * 0.2, C.ivory, C.navy);
        }
        // Little leaves on the stem between motifs.
        if (i < n) {
          const qx = sx + (ex - sx) * (t + 0.5 / n);
          const qy = sy + (ey - sy) * (t + 0.5 / n);
          const s = i % 2 === 0 ? 1 : -1;
          leaf(ctx, qx + nx * s * main * 0.12, qy + ny * s * main * 0.12, main * 0.24, Math.atan2(uy, ux) + s * 0.9, C.sky);
          leaf(ctx, qx - nx * s * main * 0.05, qy - ny * s * main * 0.05, main * 0.18, Math.atan2(uy, ux) + Math.PI - s * 0.9, C.green);
        }
      }
    }
  }
  inset += main;
  {
    const [a, b, c, d] = rect(inset);
    guardBand(ctx, a, b, c, d, g2, C.gold, C.redDeep);
  }
  inset += g2;
  {
    const [a, b, c, d] = rect(inset);
    ctx.fillStyle = C.ivory;
    ctx.fillRect(a, b, c - a, d - b);
    // Dots along the thin ivory guard.
    ctx.fillStyle = C.navy;
    const step = g3 * 1.6;
    for (let x = a + step / 2; x < c; x += step) {
      ctx.fillRect(x - g3 * 0.18, b + g3 * 0.32, g3 * 0.36, g3 * 0.36);
      ctx.fillRect(x - g3 * 0.18, d - g3 * 0.68, g3 * 0.36, g3 * 0.36);
    }
    for (let y = b + step / 2; y < d; y += step) {
      ctx.fillRect(a + g3 * 0.32, y - g3 * 0.18, g3 * 0.36, g3 * 0.36);
      ctx.fillRect(c - g3 * 0.68, y - g3 * 0.18, g3 * 0.36, g3 * 0.36);
    }
  }
  inset += g3;

  // The field.
  const [fx0, fy0, fx1, fy1] = rect(inset);
  const fw = fx1 - fx0;
  const fh = fy1 - fy0;
  const cx = (fx0 + fx1) / 2;
  const cy = (fy0 + fy1) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(fx0, fy0, fw, fh);
  ctx.clip();
  ctx.fillStyle = C.red;
  ctx.fillRect(fx0, fy0, fw, fh);

  // Lattice of diamonds in a darker red, with a small flower at every node and a sprig in every cell.
  const cell = m(0.2);
  ctx.strokeStyle = C.redDeep;
  ctx.lineWidth = m(0.012);
  for (let k = -40; k <= 40; k++) {
    ctx.beginPath();
    ctx.moveTo(cx + k * cell - fh, cy - fh);
    ctx.lineTo(cx + k * cell + fh, cy + fh);
    ctx.moveTo(cx + k * cell + fh, cy - fh);
    ctx.lineTo(cx + k * cell - fh, cy + fh);
    ctx.stroke();
  }
  for (let j = -20; j <= 20; j++) {
    for (let i = -30; i <= 30; i++) {
      const px = cx + i * cell;
      const py = cy + j * cell;
      if (px < fx0 - cell || px > fx1 + cell || py < fy0 - cell || py > fy1 + cell) continue;
      if ((i + j) % 2 === 0) rosette(ctx, px, py, cell * 0.2, (i + j) % 4 === 0 ? C.ivory : C.gold, C.navy);
      else {
        leaf(ctx, px, py, cell * 0.2, -Math.PI / 2, C.navy);
        leaf(ctx, px, py, cell * 0.2, Math.PI / 2, C.navy);
        ctx.fillStyle = C.gold;
        ctx.beginPath();
        ctx.arc(px, py, cell * 0.04, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Corner spandrels: navy quarter-lobes with an ivory outline and a scatter of flowers.
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const ox = sx < 0 ? fx0 : fx1;
    const oy = sy < 0 ? fy0 : fy1;
    const rx = fw * 0.2;
    const ry = fh * 0.3;
    ctx.fillStyle = C.ivory;
    lobed(ctx, ox, oy, rx + m(0.03), ry + m(0.03), 10, 0.05);
    ctx.fill();
    ctx.fillStyle = C.navy;
    lobed(ctx, ox, oy, rx, ry, 10, 0.05);
    ctx.fill();
    for (let k = 0; k < 6; k++) {
      const t = (k + 0.5) / 6;
      const ang = t * Math.PI / 2;
      const r = 0.62;
      const px = ox - sx * Math.cos(ang) * rx * r;
      const py = oy - sy * Math.sin(ang) * ry * r;
      rosette(ctx, px, py, m(0.05), k % 2 ? C.gold : C.rose, C.ivory);
    }
    rosette(ctx, ox - sx * rx * 0.25, oy - sy * ry * 0.25, m(0.08), C.red, C.gold, C.ivory);
  }

  // Pendants: shield-shaped cartouches above and below the medallion along the long axis, with finials.
  const mrx = fw * 0.25;
  const mry = fh * 0.33;
  for (const s of [-1, 1]) {
    const px = cx + s * (mrx + m(0.16));
    ctx.fillStyle = C.ivory;
    lobed(ctx, px, cy, m(0.17), m(0.12), 6, 0.08);
    ctx.fill();
    ctx.fillStyle = C.navy;
    lobed(ctx, px, cy, m(0.14), m(0.095), 6, 0.08);
    ctx.fill();
    rosette(ctx, px, cy, m(0.07), C.gold, C.red, C.ivory);
    // Finial.
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(px + s * m(0.17), cy - m(0.03));
    ctx.lineTo(px + s * m(0.3), cy);
    ctx.lineTo(px + s * m(0.17), cy + m(0.03));
    ctx.fill();
    rosette(ctx, px + s * m(0.33), cy, m(0.04), C.ivory, C.navy);
  }

  // The medallion: layered lobed rings, navy, ivory, gold, red, and a rosette at its heart.
  const layers = [
    [1.0, C.ivory, 16, 0.07],
    [0.95, C.navy, 16, 0.07],
    [0.68, C.gold, 12, 0.08],
    [0.64, C.red, 12, 0.08],
    [0.4, C.ivory, 8, 0.1],
    [0.36, C.navyDeep, 8, 0.1],
  ];
  for (const [k, col, lobes, depth] of layers) {
    ctx.fillStyle = col;
    lobed(ctx, cx, cy, mrx * k, mry * k, lobes, depth);
    ctx.fill();
  }
  // Rosettes around the navy ring and palmettes pointing out.
  for (let k = 0; k < 16; k++) {
    const t = (k / 16) * Math.PI * 2;
    const r = 0.82;
    const px = cx + Math.cos(t) * mrx * r;
    const py = cy + Math.sin(t) * mry * r;
    if (k % 2 === 0) rosette(ctx, px, py, m(0.045), C.rose, C.ivory);
    else leaf(ctx, px - Math.cos(t) * m(0.04), py - Math.sin(t) * m(0.04), m(0.08), t, C.sky);
  }
  for (let k = 0; k < 12; k++) {
    const t = (k / 12) * Math.PI * 2 + Math.PI / 12;
    leaf(ctx, cx + Math.cos(t) * mrx * 0.42, cy + Math.sin(t) * mry * 0.42, m(0.07), t, C.gold);
  }
  rosette(ctx, cx, cy, m(0.14), C.red, C.gold, C.ivory);
  rosette(ctx, cx, cy, m(0.06), C.ivory, C.navy);
  ctx.restore();

  // Wool: abrash (slow colour banding across the weave), knot-scale noise, and a little wear in the middle.
  const img = ctx.getImageData(x0, 0, x1 - x0, H);
  const d = img.data;
  const bw = x1 - x0;
  const bands = new Float32Array(bw);
  let drift = 0;
  for (let x = 0; x < bw; x++) {
    drift = drift * 0.995 + (rand() - 0.5) * 0.012;
    bands[x] = drift;
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < bw; x++) {
      const i = (y * bw + x) * 4;
      const knot = ((x >> 1) + (y >> 1)) & 1 ? 0.97 : 1.02;
      const wx = (x / bw - 0.5) * 2;
      const wy = (y / H - 0.5) * 2;
      const wear = 1 - 0.07 * Math.exp(-(wx * wx * 3 + wy * wy * 2));
      const k = knot * wear * (1 + bands[x] + (rand() - 0.5) * 0.09);
      d[i] = Math.min(255, d[i] * k);
      d[i + 1] = Math.min(255, d[i + 1] * k);
      d[i + 2] = Math.min(255, d[i + 2] * k);
    }
  }
  ctx.putImageData(img, x0, 0);

  // Fringe: knotted bundles of ivory warp threads on transparent ground at both short ends.
  ctx.clearRect(0, 0, F, H);
  ctx.clearRect(x1, 0, F, H);
  const strand = Math.max(2, Math.round(m(0.006)));
  for (const side of [-1, 1]) {
    const edge = side < 0 ? x0 : x1;
    for (let y = strand; y < H - strand; y += strand * 2) {
      const len = F * (0.78 + rand() * 0.2);
      const sway = (rand() - 0.5) * strand * 3;
      const shade = 200 + Math.floor(rand() * 40);
      ctx.strokeStyle = `rgb(${shade + 15}, ${shade + 5}, ${shade - 20})`;
      ctx.lineWidth = strand;
      ctx.beginPath();
      ctx.moveTo(edge, y);
      ctx.quadraticCurveTo(edge + side * len * 0.5, y + sway * 0.5, edge + side * len, y + sway);
      ctx.stroke();
    }
    // A knotted band where the warp leaves the weave.
    ctx.fillStyle = '#d8c8a4';
    ctx.fillRect(side < 0 ? edge - m(0.012) : edge, 0, m(0.012), H);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** White Carrara-style marble: a soft grey cloud with fine branching veins, some faintly gold. Tiles seamlessly enough for a tabletop. */
export function marbleTexture({ pixels = 1024, seed = 3 } = {}) {
  const S = pixels;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const rand = random(seed);
  ctx.fillStyle = '#f1eee8';
  ctx.fillRect(0, 0, S, S);
  // Cloudy grey patches.
  ctx.filter = `blur(${Math.round(S * 0.03)}px)`;
  for (let k = 0; k < 40; k++) {
    ctx.fillStyle = `rgba(150, 150, 158, ${0.04 + rand() * 0.06})`;
    ctx.beginPath();
    ctx.ellipse(rand() * S, rand() * S, S * (0.05 + rand() * 0.15), S * (0.02 + rand() * 0.06), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Veins: wandering lines, wide and soft first, then fine and sharp on top.
  const vein = (width, alpha, colour, blur) => {
    ctx.filter = blur ? `blur(${blur}px)` : 'none';
    let x = rand() * S;
    let y = -S * 0.1;
    let angle = Math.PI / 2 + (rand() - 0.5) * 0.9;
    ctx.strokeStyle = `rgba(${colour}, ${alpha})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, y);
    while (y < S * 1.1 && x > -S * 0.2 && x < S * 1.2) {
      angle += (rand() - 0.5) * 0.5;
      angle = Math.PI / 2 + Math.max(-1.1, Math.min(1.1, angle - Math.PI / 2));
      x += Math.cos(angle) * S * 0.015;
      y += Math.sin(angle) * S * 0.015;
      ctx.lineTo(x, y);
      if (rand() < 0.04) {
        // A branch.
        ctx.moveTo(x, y);
      }
    }
    ctx.stroke();
  };
  for (let k = 0; k < 6; k++) vein(S * 0.02, 0.08, '110, 110, 120', S * 0.008);
  for (let k = 0; k < 10; k++) vein(S * 0.004, 0.35, '95, 95, 105', 1);
  for (let k = 0; k < 3; k++) vein(S * 0.003, 0.45, '170, 135, 80', 0);
  ctx.filter = 'none';
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}
