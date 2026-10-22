import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { RigidBody } from '@react-three/rapier';
import { SRGBColorSpace, TextureLoader } from 'three';
import { DRACO_PATH, withKTX2 } from './loaders';
import { LIGHTMAP_URL, MANSION_SCALE } from '../world/config';

const MANSION_URL = '/models/mansion.glb';

/**
 * The house: one GLB with Draco geometry and WebP or KTX2 (Basis Universal) textures, scaled up to
 * cathedral size. It is also its own collider: a trimesh built from the same geometry.
 *
 * Performance notes (see docs/PERFORMANCE.md):
 * - It casts no real-time shadows. Its occlusion should be baked (LIGHTMAP_URL) or come from IBL;
 *   only the avatars cast, so the shadow pass stays tiny.
 * - It never moves, so its matrices are computed once and per-frame matrix updates are switched off.
 * - Static trimesh colliders cost nothing per frame; Rapier only tests them against moving shapes
 *   whose bounding boxes overlap them (the two capsules).
 */
export default function Mansion() {
  const gl = useThree((s) => s.gl);
  const { scene } = useGLTF(MANSION_URL, DRACO_PATH, false, withKTX2(gl));

  useEffect(() => {
    scene.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = false;
      obj.receiveShadow = true;
    });
    scene.updateMatrixWorld(true);
    scene.traverse((obj) => {
      if (obj !== scene) obj.matrixAutoUpdate = false; // the root keeps auto-update for the scale prop
    });
  }, [scene]);

  // Optional baked lightmap (Blender: bake to a second UV set, TEXCOORD_1, export as PNG/KTX2).
  useEffect(() => {
    if (!LIGHTMAP_URL) return undefined;
    let cancelled = false;
    new TextureLoader().loadAsync(LIGHTMAP_URL).then((lightMap) => {
      if (cancelled) return;
      lightMap.flipY = false; // glTF UV convention
      lightMap.channel = 1; // read from uv1 (TEXCOORD_1)
      lightMap.colorSpace = SRGBColorSpace;
      scene.traverse((obj) => {
        if (!obj.isMesh || !obj.geometry.attributes.uv1) return;
        obj.material.lightMap = lightMap;
        obj.material.lightMapIntensity = 1;
        obj.material.needsUpdate = true;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [scene]);

  return (
    <RigidBody type="fixed" colliders="trimesh" friction={0.8}>
      <primitive object={scene} scale={MANSION_SCALE} />
    </RigidBody>
  );
}
