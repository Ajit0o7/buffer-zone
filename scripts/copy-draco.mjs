// Copies the Draco decoder (WASM + JS) from three into client/public so GLBs compressed with
// Draco can be decoded locally, with no CDN round trip. Runs as the client's postinstall step.
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'client');
const source = join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf');
const target = join(root, 'public', 'draco', 'gltf');

if (!existsSync(source)) {
  console.warn('[copy-draco] three is not installed yet; skipping');
} else {
  cpSync(source, target, { recursive: true });
  console.log('[copy-draco] decoder copied to client/public/draco/gltf');
}
