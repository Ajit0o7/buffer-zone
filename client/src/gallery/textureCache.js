import {
  ImageBitmapLoader,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  Texture,
} from 'three';
import { getKTX2Loader } from '../scene/loaders';
import { GALLERY } from '../world/config';

/**
 * Reference-counted photo textures with an LRU budget.
 *
 * - acquire(src) loads on first use and returns the shared texture; release(src) hands it back.
 * - Textures that nobody references stay resident (so walking back to a painting is instant) until
 *   either limit is passed: more than GALLERY.maxResident textures loaded, or idle ones estimated
 *   above GALLERY.textureBudgetMB. Then the least recently used idle ones are disposed, freeing their
 *   VRAM. Textures in use are never dropped, so the count can exceed the limit only while that many
 *   paintings are actually open.
 * - Decoding never blocks the render loop: JPEG/PNG/WebP decode through createImageBitmap
 *   (ImageBitmapLoader), KTX2 transcodes in KTX2Loader's workers. The GPU upload happens once, in
 *   the load callback (gl.initTexture), instead of stalling the first frame that draws it.
 */
const BUDGET_BYTES = GALLERY.textureBudgetMB * 1024 * 1024;
const MAX_RESIDENT = GALLERY.maxResident;
const MAX_SIDE = 4096; // pixels; photos you add are shrunk to 1600 before upload, so this only refuses foreign files
const entries = new Map(); // src -> { refs, texture, bytes, promise, lastUsed }

let bitmapLoader = null;
const getBitmapLoader = () => {
  // The bitmap is flipped at decode time, because WebGL ignores flipY for ImageBitmap uploads.
  bitmapLoader ??= new ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
  return bitmapLoader;
};

/** Estimated GPU bytes: RGBA8 for decoded images, ~1 byte/px for transcoded KTX2, plus a third for mips. */
function estimateBytes(texture, compressed) {
  const { width = 0, height = 0 } = texture.image ?? {};
  return Math.round(width * height * (compressed ? 1 : 4) * 1.34);
}

async function load(src, gl) {
  const compressed = src.endsWith('.ktx2');
  let texture;
  if (compressed) {
    texture = await getKTX2Loader(gl).loadAsync(src);
  } else {
    const bitmap = await getBitmapLoader().loadAsync(src);
    if (Math.max(bitmap.width, bitmap.height) > MAX_SIDE) {
      bitmap.close(); // a few kilobytes on the wire can still decode to a texture too big for the GPU
      throw new Error(`image is larger than ${MAX_SIDE}px`);
    }
    texture = new Texture(bitmap);
    texture.flipY = false;
    texture.generateMipmaps = true;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.needsUpdate = true;
  }
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
  gl.initTexture(texture); // upload now, between frames, rather than mid-draw
  return { texture, bytes: estimateBytes(texture, compressed) };
}

function dispose(entry) {
  const data = entry.texture?.source?.data;
  entry.texture?.dispose();
  if (typeof ImageBitmap !== 'undefined' && data instanceof ImageBitmap) data.close();
}

function evict() {
  let idleBytes = 0;
  let resident = 0;
  for (const e of entries.values()) {
    if (!e.texture) continue;
    resident += 1;
    if (e.refs === 0) idleBytes += e.bytes;
  }
  if (idleBytes <= BUDGET_BYTES && resident <= MAX_RESIDENT) return;

  const idle = [...entries.entries()]
    .filter(([, e]) => e.refs === 0 && e.texture)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [src, e] of idle) {
    if (idleBytes <= BUDGET_BYTES && resident <= MAX_RESIDENT) break;
    dispose(e);
    entries.delete(src);
    idleBytes -= e.bytes;
    resident -= 1;
  }
}

/** Resolves to the texture. Every acquire must be matched by one release. */
export function acquireTexture(src, gl) {
  let entry = entries.get(src);
  if (!entry) {
    entry = { refs: 0, texture: null, bytes: 0, promise: null, lastUsed: 0 };
    entries.set(src, entry);
    entry.promise = load(src, gl).then(
      ({ texture, bytes }) => {
        entry.texture = texture;
        entry.bytes = bytes;
        evict(); // it may have finished loading after everyone released it
        return texture;
      },
      (err) => {
        entries.delete(src); // let a later attempt retry
        throw err;
      },
    );
  }
  entry.refs += 1;
  entry.lastUsed = performance.now();
  return entry.promise;
}

export function releaseTexture(src) {
  const entry = entries.get(src);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  entry.lastUsed = performance.now();
  evict();
}

/** For debugging and the perf HUD: how many photo textures are resident, and their estimated size. */
export function textureCacheStats() {
  let resident = 0;
  let bytes = 0;
  for (const e of entries.values()) {
    if (e.texture) {
      resident += 1;
      bytes += e.bytes;
    }
  }
  return { resident, megabytes: +(bytes / 1048576).toFixed(1) };
}
