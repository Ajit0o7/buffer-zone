import { useGLTF } from '@react-three/drei';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

// Every useGLTF call shares one Draco decoder. Point it at the local copy (scripts/copy-decoders.mjs)
// before anything loads; otherwise drei falls back to Google's CDN, an extra network dependency.
export const DRACO_PATH = '/draco/gltf/';
useGLTF.setDecoderPath(DRACO_PATH);

// One KTX2Loader for the whole app. It transcodes Basis Universal textures in Web Workers, so the
// main thread never blocks on decoding, and picks the best GPU format the device supports
// (ASTC, BC7, ETC2...). The transcoder is copied into /basis/ by scripts/copy-decoders.mjs.
let ktx2 = null;

export function getKTX2Loader(gl) {
  if (!ktx2) {
    ktx2 = new KTX2Loader().setTranscoderPath('/basis/').setWorkerLimit(2).detectSupport(gl);
  }
  return ktx2;
}

/** For useGLTF's extendLoader argument: lets GLBs carry KHR_texture_basisu (KTX2) textures. */
export const withKTX2 = (gl) => (loader) => loader.setKTX2Loader(getKTX2Loader(gl));
