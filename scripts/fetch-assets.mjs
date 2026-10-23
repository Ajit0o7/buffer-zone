// Downloads the real house, avatars and lighting used by the scene into client/public/, then builds
// the house into a single compressed GLB. Run from `client/` with `npm run assets`.
//
// These are third-party files with their own licences, so they stay local and are gitignored:
//   - Mansion: Khronos glTF Sample Assets "Sponza" (CRYENGINE Limited License; the metadata is CC-BY 4.0)
//   - Host avatar (boy1): Mixamo "Soldier", as shipped in the three.js examples (Mixamo terms)
//   - Shared motion-capture clips (idle, walk, run): Mixamo "Xbot", as shipped in the three.js examples
//   - Guest avatar (boy2): a Ready Player Me avatar, as shipped in the three.js examples (Ready Player Me terms)
// If any of the three can't be downloaded, box-built stand-ins (avatars and clips) replace all three,
// so the rigs and clips always match.
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
  // 1. Avatars and the clips both of them use.
  try {
    await download(`${THREE_EXAMPLES}/models/gltf/Xbot.glb`, join(PUBLIC, 'models/animations/locomotion.glb'));
    await download(`${THREE_EXAMPLES}/models/gltf/Soldier.glb`, join(PUBLIC, 'models/avatars/boy1.glb'));
    await download(`${THREE_EXAMPLES}/models/gltf/readyplayer.me.glb`, join(PUBLIC, 'models/avatars/boy2.glb'));
  } catch (err) {
    console.warn(`[assets] avatars unavailable (${err.message}); generating stand-ins instead`);
    execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'make-standins.mjs'), '--avatars'], { stdio: 'inherit' });
  }

  // 2. Lighting.
  await download(`${THREE_EXAMPLES}/textures/equirectangular/venice_sunset_1k.hdr`, join(PUBLIC, 'hdri/venice_sunset_1k.hdr'));

  // 3. Sponza: the .gltf refers to a .bin and 69 textures, so fetch them all, then pack and compress.
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
