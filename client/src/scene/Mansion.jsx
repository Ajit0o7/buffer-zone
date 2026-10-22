import { useEffect } from 'react';
import { useGLTF } from '@react-three/drei';
import { RigidBody } from '@react-three/rapier';

// The decoder is copied from three by scripts/copy-draco.mjs (run on npm install).
useGLTF.setDecoderPath('/draco/gltf/');

const MANSION_URL = '/models/mansion.glb';

/**
 * The house is one Draco-compressed GLB. It is also its own collider: a trimesh built from the
 * same geometry, so walls, columns and floors all stop the player. For a larger map, swap in a
 * decimated collision mesh, as described in the README.
 */
export default function Mansion() {
  const { scene } = useGLTF(MANSION_URL);

  useEffect(() => {
    scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }, [scene]);

  return (
    <RigidBody type="fixed" colliders="trimesh" friction={0.8}>
      <primitive object={scene} />
    </RigidBody>
  );
}
