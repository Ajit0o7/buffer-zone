// Turns a frame of the 3D view into a vintage instant print: a square crop, a warm faded colour grade, a soft
// vignette and film grain, inside a cream border that's thicker at the bottom, with a handwritten caption.

const BORDER = 0.055; // side and top border, as a fraction of the picture's width
const FOOT = 0.2; // the bottom border

/** `source` is the game's canvas; `caption` is two short lines. Returns a new canvas. */
export function makePolaroid(source, caption = {}) {
  const side = Math.min(source.width, source.height);
  const shot = Math.min(side, 1600);
  const border = Math.round(shot * BORDER);
  const foot = Math.round(shot * FOOT);
  const out = document.createElement('canvas');
  out.width = shot + border * 2;
  out.height = shot + border + foot;
  const g = out.getContext('2d');

  // Card: warm white with a faint paper tone at the edges.
  const paper = g.createLinearGradient(0, 0, out.width, out.height);
  paper.addColorStop(0, '#f6f0e2');
  paper.addColorStop(1, '#ebe2cf');
  g.fillStyle = paper;
  g.fillRect(0, 0, out.width, out.height);

  // The picture, cropped to a square from the middle of the view.
  g.save();
  g.beginPath();
  g.rect(border, border, shot, shot);
  g.clip();
  g.drawImage(source, (source.width - side) / 2, (source.height - side) / 2, side, side, border, border, shot, shot);

  // Faded colour: lift the blacks and warm the whole picture.
  g.globalCompositeOperation = 'lighten';
  g.fillStyle = 'rgb(30, 22, 18)';
  g.fillRect(border, border, shot, shot);
  g.globalCompositeOperation = 'soft-light';
  g.fillStyle = 'rgba(255, 190, 120, 0.35)';
  g.fillRect(border, border, shot, shot);
  g.globalCompositeOperation = 'source-over';

  // Vignette.
  const cx = border + shot / 2;
  const vignette = g.createRadialGradient(cx, cx, shot * 0.3, cx, cx, shot * 0.78);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(20, 8, 0, 0.5)');
  g.fillStyle = vignette;
  g.fillRect(border, border, shot, shot);

  // Grain: a small noise tile, tiled over the picture.
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const tg = tile.getContext('2d');
  const noise = tg.createImageData(128, 128);
  for (let i = 0; i < noise.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 120;
    noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = v;
    noise.data[i + 3] = 22;
  }
  tg.putImageData(noise, 0, 0);
  g.fillStyle = g.createPattern(tile, 'repeat');
  g.fillRect(border, border, shot, shot);
  g.restore();

  // A thin inner edge, as a real print has where the emulsion stops.
  g.strokeStyle = 'rgba(80, 60, 40, 0.28)';
  g.lineWidth = Math.max(1, shot / 500);
  g.strokeRect(border, border, shot, shot);

  // Handwritten caption.
  g.fillStyle = '#4a3b2b';
  g.textAlign = 'center';
  const family = '"Segoe Print", "Bradley Hand", "Noteworthy", "Comic Sans MS", cursive';
  g.font = `${Math.round(shot * 0.062)}px ${family}`;
  g.fillText(caption.title ?? '', out.width / 2, border + shot + foot * 0.45, shot);
  g.fillStyle = '#7a6a56';
  g.font = `${Math.round(shot * 0.04)}px ${family}`;
  g.fillText(caption.subtitle ?? '', out.width / 2, border + shot + foot * 0.78, shot);
  return out;
}
