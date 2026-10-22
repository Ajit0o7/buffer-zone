// Generates placeholder photos and audio so the gallery and sound work before your own files exist.
// The house and avatars are real assets now (see the README). Replace these files with your own
// photos and music; the code keeps the same paths. Node built-ins only, so `npm run standins` works anywhere.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public');
const out = (rel, data) => {
  const path = join(PUBLIC, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`wrote ${rel} (${data.length} bytes)`);
};

// ---------------------------------------------------------------- PNG

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(width, height, pixel) {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x / width, y / height);
      const o = y * row + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A soft placeholder "photo": sky gradient, a sun or moon disc, and a ground band. */
function photoPixel(top, bottom, disc) {
  return (u, v) => {
    const sky = v < 0.7;
    const t = Math.min(v / 0.7, 1);
    const base = sky ? top.map((c, i) => c + (bottom[i] - c) * t) : [60, 48, 40];
    const dx = u - disc.x;
    const dy = v - disc.y;
    const px = dx * dx + dy * dy < disc.r * disc.r ? disc.color : base;
    return px.map((c) => Math.round(Math.max(0, Math.min(255, c))));
  };
}

const PHOTOS = [
  { file: 'first-trip.png', top: [120, 170, 220], bottom: [250, 200, 150], disc: { x: 0.72, y: 0.3, r: 0.1, color: [255, 240, 200] } },
  { file: 'rainy-kitchen.png', top: [110, 120, 130], bottom: [190, 180, 170], disc: { x: 0.25, y: 0.35, r: 0.08, color: [255, 220, 150] } },
  { file: 'the-yes.png', top: [240, 150, 170], bottom: [255, 220, 200], disc: { x: 0.5, y: 0.25, r: 0.12, color: [255, 250, 230] } },
];

// ---------------------------------------------------------------- WAV

const RATE = 22050;

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function footstepSamples() {
  const n = Math.floor(RATE * 0.18);
  return Array.from({ length: n }, (_, i) => {
    const t = i / RATE;
    const thump = Math.sin(2 * Math.PI * 110 * t) * Math.exp(-t * 25) * 0.6;
    const grit = (Math.random() * 2 - 1) * Math.exp(-t * 40) * 0.25;
    return thump + grit;
  });
}

/** 16 s of a soft four-chord pad. Each chord fades to zero at its edges, so the loop is seamless. */
function musicSamples() {
  const chords = [
    [261.63, 329.63, 392.0, 493.88],
    [220.0, 261.63, 329.63, 392.0],
    [174.61, 220.0, 261.63, 329.63],
    [196.0, 246.94, 293.66, 392.0],
  ];
  const chordLen = 4;
  const out = new Float32Array(RATE * chordLen * chords.length);
  chords.forEach((freqs, c) => {
    const start = c * RATE * chordLen;
    for (let i = 0; i < RATE * chordLen; i++) {
      const t = i / RATE;
      const env = Math.sin((Math.PI * i) / (RATE * chordLen));
      let v = 0;
      for (const f of freqs) v += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t);
      out[start + i] = (v / freqs.length) * env * 0.18;
    }
  });
  return Array.from(out);
}

// ---------------------------------------------------------------- write

for (const p of PHOTOS) out(`photos/${p.file}`, png(640, 480, photoPixel(p.top, p.bottom, p.disc)));
out('audio/footstep.wav', wav(footstepSamples()));
out('audio/romantic-theme.wav', wav(musicSamples()));
