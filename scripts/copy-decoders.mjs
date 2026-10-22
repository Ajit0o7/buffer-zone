// Copies the Draco decoder and the Basis Universal (KTX2) transcoder from three into
// client/public, so compressed geometry and GPU textures decode locally, with no CDN round trip.
// Runs as the client's postinstall step.
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'client');
const libs = join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs');
const copies = [
  [join(libs, 'draco', 'gltf'), join(root, 'public', 'draco', 'gltf')],
  [join(libs, 'basis'), join(root, 'public', 'basis')],
];

if (!existsSync(libs)) {
  console.warn('[copy-decoders] three is not installed yet; skipping');
} else {
  for (const [from, to] of copies) {
    cpSync(from, to, { recursive: true });
    console.log(`[copy-decoders] ${from.split('libs/')[1]} -> ${to.split('client/')[1]}`);
  }
}
