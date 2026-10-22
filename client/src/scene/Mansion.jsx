import { useEffect } from 'react';
import { useGLTF } from '@react-three/drei';
import { RigidBody } from '@react-three/rapier';

// The decoder is copied from three by scripts/copy-draco.mjs (run on npm install).
useGLTF.setDecoderPath('/draco/gltf/');

const MANSION_URL = '/models/mansion.glb'; // visual: Draco geometry, KTX2 textures
const COLLISION_URL = '/models/mansion.collision.glb'; // low-poly walls, floors and furniture blockers

/**
 * The visual mesh is never used for physics. A separate, decimated collision mesh keeps the
 * trimesh cheap, so walking into a wall stops the player and the cost stays flat.
 */
export default function Mansion() {
  const visual = useGLTF(MANSION_URL);
  const collision = useGLTF(COLLISION_URL);

  useEffect(() => {
    visual.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }, [visual.scene]);

  return (
    <>
      <primitive object={visual.scene} />
      <RigidBody type="fixed" colliders="trimesh" friction={0.8}>
        <primitive object={collision.scene} visible={false} />
      </RigidBody>
    </>
  );
}
