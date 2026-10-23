import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';

// Leaf and flower cut-outs, painted once on canvases. Each is drawn with its stalk at the bottom edge
// and its tip at the top, matching the quads in geometry.js (pivot at the stalk, tip along +y).
// They are painted near-white with lighter veins, so one texture serves every shade of green: the
// colour comes from each instance. Only the flowers carry colour of their own.

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function texture(c) {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

// A soft shading across the blade: brighter along the midrib, darker toward the edges.
function bladeShade(g, w, h) {
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#b9b9b9');
  grad.addColorStop(0.5, '#f2f2f2');
  grad.addColorStop(1, '#b9b9b9');
  return grad;
}

/** Ivy: a heart-shaped leaf with three faint lobes, pale veins, and its stalk. */
export function ivyTexture() {
  const [c, g] = canvas(128, 128);
  const W = 128;
  g.fillStyle = bladeShade(g, W, W);
  g.beginPath();
  g.moveTo(64, 104); // the notch where the stalk joins
  g.bezierCurveTo(44, 120, 2, 112, 6, 78);
  g.bezierCurveTo(8, 58, 30, 52, 30, 52); // side lobe
  g.bezierCurveTo(26, 34, 50, 18, 64, 3); // tip
  g.bezierCurveTo(78, 18, 102, 34, 98, 52);
  g.bezierCurveTo(98, 52, 120, 58, 122, 78);
  g.bezierCurveTo(126, 112, 84, 120, 64, 104);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 2.2;
  g.beginPath();
  for (const [x, y] of [[64, 8], [22, 64], [106, 64], [14, 92], [114, 92]]) {
    g.moveTo(64, 104);
    g.quadraticCurveTo((64 + x) / 2, (104 + y) / 2 + 6, x, y);
  }
  g.stroke();
  g.fillStyle = '#9a9a7a'; // stalk
  g.fillRect(62, 104, 4, 24);
  return texture(c);
}

/** A narrow lance leaf: olive, wisteria leaflets and the flowers' foliage. */
export function lanceTexture() {
  const [c, g] = canvas(64, 256);
  g.fillStyle = bladeShade(g, 64, 256);
  g.beginPath();
  g.moveTo(32, 250);
  g.bezierCurveTo(4, 200, 2, 70, 32, 2);
  g.bezierCurveTo(62, 70, 60, 200, 32, 250);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(32, 252);
  g.lineTo(32, 10);
  g.stroke();
  g.fillStyle = '#a0a080';
  g.fillRect(30, 244, 4, 12);
  return texture(c);
}

/** Fiddle-leaf fig: broad at the tip, pinched at the waist, wavy-edged, with strong pale veins. */
export function figTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = bladeShade(g, 256, 256);
  g.beginPath();
  g.moveTo(128, 250);
  g.bezierCurveTo(70, 246, 54, 200, 66, 168); // base
  g.bezierCurveTo(76, 140, 30, 120, 18, 80); // waist out to the shoulders
  g.bezierCurveTo(8, 40, 60, 2, 128, 6); // broad rounded tip
  g.bezierCurveTo(196, 2, 248, 40, 238, 80);
  g.bezierCurveTo(226, 120, 180, 140, 190, 168);
  g.bezierCurveTo(202, 200, 186, 246, 128, 250);
  g.fill();
  g.strokeStyle = 'rgba(255,255,240,0.95)';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(128, 256);
  g.lineTo(128, 12);
  g.stroke();
  g.lineWidth = 2.5;
  g.beginPath();
  for (let k = 0; k < 7; k++) {
    const y = 220 - k * 30;
    const spread = 40 + 60 * Math.sin((k / 7) * Math.PI);
    g.moveTo(128, y);
    g.quadraticCurveTo(128 - spread * 0.5, y - 10, 128 - spread, y - 30);
    g.moveTo(128, y);
    g.quadraticCurveTo(128 + spread * 0.5, y - 10, 128 + spread, y - 30);
  }
  g.stroke();
  return texture(c);
}

/** Wisteria raceme: florets packed thick at the top (canvas bottom), tapering to buds; painted in colour. */
export function racemeTexture() {
  const [c, g] = canvas(96, 256);
  let s = 11;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  g.fillStyle = '#6f7a4a'; // the stalk through the middle
  g.fillRect(46, 20, 4, 236);
  for (let i = 0; i < 260; i++) {
    const u = Math.pow(rand(), 0.8); // 0 at the attachment, 1 at the tip
    const y = 250 - u * 238;
    const half = 44 * (1 - u * 0.82);
    const x = 48 + (rand() * 2 - 1) * half;
    const r = 7.5 - u * 4.5 + rand() * 1.5;
    // Open florets near the top are pale lilac; buds toward the tip deepen to violet.
    const l = 78 - u * 30 + rand() * 8;
    g.fillStyle = `hsl(${268 + rand() * 14}, ${45 + u * 25}%, ${l}%)`;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.8, rand() * 3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `hsla(${280}, 60%, ${l - 22}%, 0.7)`;
    g.beginPath();
    g.arc(x + r * 0.15, y + r * 0.2, r * 0.35, 0, Math.PI * 2);
    g.fill();
  }
  return texture(c);
}

/**
 * Blossoms, an atlas of two cells side by side: a four-petalled hydrangea floret (left) and a
 * rose petal (right). Both white, tinted per instance.
 */
export function blossomTexture() {
  const [c, g] = canvas(256, 128);
  // Floret: four rounded petals round a small eye.
  g.save();
  g.translate(64, 64);
  for (let k = 0; k < 4; k++) {
    g.rotate(Math.PI / 2);
    const grad = g.createRadialGradient(0, -26, 2, 0, -26, 34);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#d8d8d8');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(0, -30, 25, 32, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#c9c39a';
  g.beginPath();
  g.arc(0, 0, 7, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // Rose petal: a broad rounded shell, a little darker and warmer at its base.
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, '#d9cdb8');
  grad.addColorStop(0.45, '#fbf8f2');
  grad.addColorStop(1, '#ffffff');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(192, 126);
  g.bezierCurveTo(150, 110, 128, 60, 136, 22);
  g.bezierCurveTo(146, 0, 238, 0, 248, 22);
  g.bezierCurveTo(256, 60, 234, 110, 192, 126);
  g.fill();
  g.strokeStyle = 'rgba(200,190,170,0.5)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(140, 20);
  g.quadraticCurveTo(192, 30, 244, 20);
  g.stroke();
  return texture(c);
}
