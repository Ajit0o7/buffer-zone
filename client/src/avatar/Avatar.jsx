import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import { MathUtils } from 'three';
import { ANIMATION_URLS, RUN_SPEED, WALK_SPEED } from '../world/config';
import { damp } from '../utils/math';

const CLIP_NAMES = ['idle', 'walk', 'run'];

/**
 * 1-D blend tree driven by ground speed:
 *   0 m/s → idle, WALK_SPEED → walk, RUN_SPEED → run, with linear cross-weights in between.
 * Weights always sum to 1, so the pose never over- or under-shoots.
 */
export function blendWeights(speed) {
  if (speed <= WALK_SPEED) {
    const t = speed / WALK_SPEED;
    return { idle: 1 - t, walk: t, run: 0 };
  }
  const t = MathUtils.clamp((speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1);
  return { idle: 0, walk: 1 - t, run: t };
}

/**
 * @param url        avatar GLB (boy/girl), rigged to the shared skeleton
 * @param motion     object with { speed, yaw }, read every frame (never via React state)
 * @param footOffset vertical offset so the model's feet sit on the physics capsule's base
 */
export default function Avatar({ url, motion, footOffset = 0 }) {
  const root = useRef();
  const { scene } = useGLTF(url);
  const idle = useGLTF(ANIMATION_URLS.idle);
  const walk = useGLTF(ANIMATION_URLS.walk);
  const run = useGLTF(ANIMATION_URLS.run);

  // Clones so the cached GLTF clips can be renamed and reused safely across avatars.
  const clips = useMemo(
    () =>
      [idle, walk, run].map((gltf, i) => {
        const clip = gltf.animations[0].clone();
        clip.name = CLIP_NAMES[i];
        return clip;
      }),
    [idle, walk, run],
  );

  const { actions } = useAnimations(clips, root);
  const weights = useRef({ idle: 1, walk: 0, run: 0 });

  useEffect(() => {
    scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    // Start every clip playing; the weights decide what the viewer actually sees.
    for (const name of CLIP_NAMES) actions[name]?.reset().play();
  }, [scene, actions]);

  useFrame((_, dt) => {
    const target = blendWeights(motion.speed);
    const w = weights.current;

    for (const name of CLIP_NAMES) {
      w[name] = damp(w[name], target[name], 8, dt); // smooth transitions, no popping
      actions[name]?.setEffectiveWeight(w[name]);
    }

    // Scale stride with speed to limit foot sliding. Clamped so the gait never looks cartoonish.
    if (actions.walk) actions.walk.timeScale = MathUtils.clamp(motion.speed / WALK_SPEED, 0.6, 1.4);
    if (actions.run) actions.run.timeScale = MathUtils.clamp(motion.speed / RUN_SPEED, 0.6, 1.4);

    if (root.current) root.current.rotation.y = motion.yaw;
  });

  return (
    <group ref={root} position={[0, footOffset, 0]}>
      <primitive object={scene} />
    </group>
  );
}
