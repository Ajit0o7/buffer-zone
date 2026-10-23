// Generates placeholder ("stand-in") assets, so the scene runs before real files exist:
//   default      one gradient photo per painting in client/src/gallery/photos.js, plus two audio clips
//   --avatars    also two box-built avatars (boy1, boy2) and a clip file, all on one rig (idle/walk/run),
//                used by fetch-assets.mjs when the real avatars can't be downloaded
// Node built-ins only, so `npm run standins` works anywhere. Replace the files with real ones later;
// the code keeps the same paths.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'client', 'public');
const { PHOTOS } = await import(pathToFileURL(join(ROOT, 'client', 'src', 'gallery', 'photos.js')).href);
const WITH_AVATARS = process.argv.includes('--avatars');

const out = (rel, data) => {
  const path = join(PUBLIC, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`wrote ${rel} (${data.length} bytes)`);
};

// ---------------------------------------------------------------- GLB writer

const COMPONENTS = { SCALAR: 1, VEC3: 3, VEC4: 4 };
const COMPONENT_TYPE = { Float32Array: 5126, Uint16Array: 5123 };

/** Builds a binary glTF 2.0 file from a node tree, materials and animations. */
function buildGLB({ roots, materials = [], animations = [] }) {
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [];
  const accessors = [];

  const addAccessor = (array, type, { normalized = false } = {}) => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      byteLength += pad;
    }
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    chunks.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length });
    byteLength += bytes.length;

    const n = COMPONENTS[type];
    const count = array.length / n;
    const accessor = { bufferView: bufferViews.length - 1, componentType: COMPONENT_TYPE[array.constructor.name], count, type };
    if (normalized) accessor.normalized = true;
    if (array instanceof Float32Array) {
      accessor.min = [];
      accessor.max = [];
      for (let c = 0; c < n; c++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = c; i < array.length; i += n) {
          lo = Math.min(lo, array[i]);
          hi = Math.max(hi, array[i]);
        }
        accessor.min.push(lo);
        accessor.max.push(hi);
      }
    }
    accessors.push(accessor);
    return accessors.length - 1;
  };

  // A box centred on the origin, with flat normals and per-face vertices.
  const boxMeshes = new Map();
  const addBoxMesh = (size, material) => {
    const key = `${size}|${material}`;
    if (boxMeshes.has(key)) return boxMeshes.get(key);
    const [sx, sy, sz] = size;
    const [hx, hy, hz] = [sx / 2, sy / 2, sz / 2];
    const faces = [
      { n: [1, 0, 0], v: [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]] },
      { n: [-1, 0, 0], v: [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]] },
      { n: [0, 1, 0], v: [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]] },
      { n: [0, -1, 0], v: [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]] },
      { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
      { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    ];
    const positions = new Float32Array(24 * 3);
    const normals = new Float32Array(24 * 3);
    const indices = new Uint16Array(36);
    faces.forEach((face, f) => {
      face.v.forEach((p, k) => {
        const i = f * 4 + k;
        positions.set(p, i * 3);
        normals.set(face.n, i * 3);
      });
      indices.set([0, 1, 2, 0, 2, 3].map((x) => x + f * 4), f * 6);
    });
    const mesh = {
      primitives: [{
        attributes: { POSITION: addAccessor(positions, 'VEC3'), NORMAL: addAccessor(normals, 'VEC3') },
        indices: addAccessor(indices, 'SCALAR'),
        material,
      }],
    };
    meshes.push(mesh);
    boxMeshes.set(key, meshes.length - 1);
    return meshes.length - 1;
  };

  const meshes = [];
  const nodes = [];
  const nodeByName = new Map();

  const addNode = (spec) => {
    const index = nodes.length;
    const node = { name: spec.name };
    nodes.push(node);
    nodeByName.set(spec.name, index);
    if (spec.translation) node.translation = spec.translation;
    if (spec.rotation) node.rotation = spec.rotation;
    if (spec.box) node.mesh = addBoxMesh(spec.box.size, spec.box.material);
    if (spec.children?.length) node.children = spec.children.map(addNode);
    return index;
  };

  const rootIndices = roots.map(addNode);

  const animationJSON = animations.map((anim) => {
    const samplers = [];
    const channels = [];
    for (const track of anim.tracks) {
      const values = Float32Array.from(track.values.flat());
      const type = track.path === 'translation' ? 'VEC3' : 'VEC4';
      samplers.push({
        input: addAccessor(Float32Array.from(track.times), 'SCALAR'),
        output: addAccessor(values, type),
        interpolation: 'LINEAR',
      });
      channels.push({ sampler: samplers.length - 1, target: { node: nodeByName.get(track.node), path: track.path } });
    }
    return { name: anim.name, samplers, channels };
  });

  const bin = Buffer.concat(chunks);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);

  const json = {
    asset: { version: '2.0', generator: 'buffer-zone stand-ins' },
    scene: 0,
    scenes: [{ nodes: rootIndices }],
    nodes,
    meshes,
    materials: materials.map((m) => ({
      pbrMetallicRoughness: { baseColorFactor: [...m.color, 1], metallicFactor: 0, roughnessFactor: m.rough },
      doubleSided: true,
    })),
    accessors,
    bufferViews,
    buffers: [{ byteLength: binPadded.length }],
    animations: animationJSON,
  };

  let jsonBytes = Buffer.from(JSON.stringify(json));
  jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);

  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  const total = 12 + 8 + jsonBytes.length + 8 + binPadded.length;
  header.writeUInt32LE(total, 8);

  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonBytes.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binPadded.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  return Buffer.concat([header, jsonHead, jsonBytes, binHead, binPadded]);
}

// ---------------------------------------------------------------- avatar rig

const quatX = (angle) => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];

/** Hips-rooted rig. Material indices: 0 shirt, 1 skin, 2 pants, 3 hair. */
function avatarRig() {
  const mat = { shirt: 0, skin: 1, pants: 2, hair: 3 };
  return [{
    name: 'Hips',
    translation: [0, 0.9, 0],
    children: [
      { name: 'Torso', translation: [0, 0.3, 0], box: { size: [0.5, 0.6, 0.28], material: mat.shirt } },
      {
        name: 'Head',
        translation: [0, 0.75, 0],
        box: { size: [0.3, 0.3, 0.28], material: mat.skin },
        children: [{ name: 'Hair', translation: [0, 0.17, -0.02], box: { size: [0.32, 0.07, 0.3], material: mat.hair } }],
      },
      {
        name: 'ArmL',
        translation: [-0.32, 0.55, 0],
        children: [{ name: 'ArmLMesh', translation: [0, -0.28, 0], box: { size: [0.14, 0.56, 0.14], material: mat.skin } }],
      },
      {
        name: 'ArmR',
        translation: [0.32, 0.55, 0],
        children: [{ name: 'ArmRMesh', translation: [0, -0.28, 0], box: { size: [0.14, 0.56, 0.14], material: mat.skin } }],
      },
      {
        name: 'LegL',
        translation: [-0.12, 0, 0],
        children: [{ name: 'LegLMesh', translation: [0, -0.45, 0], box: { size: [0.18, 0.9, 0.2], material: mat.pants } }],
      },
      {
        name: 'LegR',
        translation: [0.12, 0, 0],
        children: [{ name: 'LegRMesh', translation: [0, -0.45, 0], box: { size: [0.18, 0.9, 0.2], material: mat.pants } }],
      },
    ],
  }];
}

/** Materials for one avatar, in the order avatarRig() expects. */
const avatarMaterials = (shirt, hair) => [
  { color: shirt, rough: 0.8 },
  { color: [0.9, 0.75, 0.65], rough: 0.6 },
  { color: [0.2, 0.2, 0.25], rough: 0.9 },
  { color: hair, rough: 0.5 },
];

/** Walk-cycle-style clip: legs and arms swing in opposition, the hips bob twice per cycle. */
function gaitClip({ name, duration, swing, bob, armSwing = swing * 0.8 }) {
  const samples = 16;
  const times = [];
  const legL = [];
  const legR = [];
  const armL = [];
  const armR = [];
  const hips = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const phase = 2 * Math.PI * t;
    times.push(t * duration);
    const s = Math.sin(phase);
    legL.push(quatX(swing * s));
    legR.push(quatX(-swing * s));
    armL.push(quatX(-armSwing * s));
    armR.push(quatX(armSwing * s));
    hips.push([0, 0.9 + bob * Math.abs(s), 0]);
  }
  return {
    name,
    tracks: [
      { node: 'LegL', path: 'rotation', times, values: legL },
      { node: 'LegR', path: 'rotation', times, values: legR },
      { node: 'ArmL', path: 'rotation', times, values: armL },
      { node: 'ArmR', path: 'rotation', times, values: armR },
      { node: 'Hips', path: 'translation', times, values: hips },
    ],
  };
}

const CLIPS = [
  gaitClip({ name: 'idle', duration: 2.4, swing: 0.02, bob: 0.008, armSwing: 0.04 }),
  gaitClip({ name: 'walk', duration: 0.8, swing: 0.5, bob: 0.04 }),
  gaitClip({ name: 'run', duration: 0.5, swing: 0.9, bob: 0.07 }),
];

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

// One placeholder per painting in photos.js, each with its own colours (derived from its id).
function photoStyle(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = (h % 360) / 360;
  const rgb = (hh, s, l) => {
    const f = (n) => {
      const k = (n + hh * 12) % 12;
      return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    };
    return [f(0), f(8), f(4)];
  };
  return {
    top: rgb(hue, 0.45, 0.62),
    bottom: rgb((hue + 0.08) % 1, 0.55, 0.82),
    disc: { x: 0.2 + ((h >> 8) % 60) / 100, y: 0.22 + ((h >> 4) % 20) / 100, r: 0.08 + ((h >> 12) % 5) / 100, color: [255, 244, 222] },
  };
}

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

for (const photo of PHOTOS) {
  const style = photoStyle(photo.id);
  out(photo.src.replace(/^\//, ''), png(640, 480, photoPixel(style.top, style.bottom, style.disc)));
}
out('audio/footstep.wav', wav(footstepSamples()));
out('audio/romantic-theme.wav', wav(musicSamples()));

if (WITH_AVATARS) {
  // Same rig in all three files; config.js takes the clips from locomotion.glb.
  out('models/avatars/boy1.glb', buildGLB({ roots: avatarRig(), materials: avatarMaterials([0.2, 0.35, 0.7], [0.18, 0.12, 0.08]), animations: CLIPS }));
  out('models/avatars/boy2.glb', buildGLB({ roots: avatarRig(), materials: avatarMaterials([0.25, 0.5, 0.3], [0.45, 0.3, 0.15]), animations: CLIPS }));
  out('models/animations/locomotion.glb', buildGLB({ roots: avatarRig(), materials: avatarMaterials([0.5, 0.5, 0.5], [0.3, 0.3, 0.3]), animations: CLIPS }));
}
