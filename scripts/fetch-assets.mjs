// Downloads the real house, avatars and lighting used by the scene into client/public/, then builds
// the house into a single compressed GLB. Run from `client/` with `npm run assets`.
//
// These are third-party files with their own licences, so they stay local and are gitignored:
//   - Mansion: Khronos glTF Sample Assets "Sponza" (CRYENGINE Limited License; the metadata is CC-BY 4.0)
//   - Avatars and motion-capture clips: Mixamo characters, as shipped in three.js examples (Mixamo terms)
//   - Environment: a Venice sunset HDRI (Poly Haven, CC0), as shipped in three.js examples
// Check the licences before you publish anything built from them.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public');
const THREE_EXAMPLES = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples';
const SPONZA = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Sponza/glTF';

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} while fetching ${url}`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`downloaded ${dest.replace(`${PUBLIC}/`, '')}`);
}

/** Runs `tasks` (functions returning promises) with at most `limit` in flight. */
async function pool(tasks, limit) {
  const queue = [...tasks];
  await Promise.all(Array.from({ length: limit }, async () => {
    while (queue.length) await queue.shift()();
  }));
}

const work = mkdtempSync(join(tmpdir(), 'sponza-'));
try {
  // 1. Avatars and the HDRI. The boy file also carries the idle, walk and run clips for both avatars.
  await download(`${THREE_EXAMPLES}/models/gltf/Xbot.glb`, join(PUBLIC, 'models/avatars/boy.glb'));
  await download(`${THREE_EXAMPLES}/models/gltf/Michelle.glb`, join(PUBLIC, 'models/avatars/girl.glb'));
  await download(`${THREE_EXAMPLES}/textures/equirectangular/venice_sunset_1k.hdr`, join(PUBLIC, 'hdri/venice_sunset_1k.hdr'));

  // 2. Sponza: the .gltf refers to a .bin and 69 textures, so fetch them all, then pack and compress.
  await download(`${SPONZA}/Sponza.gltf`, join(work, 'Sponza.gltf'));
  const gltf = JSON.parse(readFileSync(join(work, 'Sponza.gltf'), 'utf8'));
  const files = [...gltf.buffers.map((b) => b.uri), ...gltf.images.map((i) => i.uri)];
  await pool(files.map((name) => () => download(`${SPONZA}/${name}`, join(work, name))), 8);

  execFileSync('npx', ['-y', '@gltf-transform/cli@4', 'copy', join(work, 'Sponza.gltf'), join(work, 'sponza-raw.glb')], { stdio: 'inherit', shell: process.platform === 'win32' });
  execFileSync('npx', ['-y', '@gltf-transform/cli@4', 'optimize', join(work, 'sponza-raw.glb'), join(PUBLIC, 'models/mansion.glb'), '--compress', 'draco', '--texture-compress', 'webp', '--texture-size', '2048'], { stdio: 'inherit', shell: process.platform === 'win32' });
  console.log('built models/mansion.glb');
} finally {
  rmSync(work, { recursive: true, force: true });
}
