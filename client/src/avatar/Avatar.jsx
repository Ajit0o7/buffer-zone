import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import { MathUtils } from 'three';
import { CLIP_NAMES, CLIP_REFERENCE_SPEED, CLIP_SOURCE_URL, RUN_SPEED, WALK_SPEED } from '../world/config';
import { damp } from '../utils/math';

const STATES = Object.keys(CLIP_NAMES); // ['idle', 'walk', 'run']

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
 * @param url        avatar model (boy or girl), a Mixamo rig
 * @param motion     object with { speed, yaw }, read every frame (never via React state)
 * @param footOffset vertical offset so the model's feet sit on the physics capsule's base
 */
export default function Avatar({ url, motion, footOffset = 0 }) {
  const root = useRef();
  const { scene } = useGLTF(url);
  const source = useGLTF(CLIP_SOURCE_URL);

  // Clones so the cached clips can be renamed to our state names without touching the shared GLTF.
  const clips = useMemo(
    () =>
      STATES.map((state) => {
        const clip = source.animations.find((a) => a.name === CLIP_NAMES[state]).clone();
        clip.name = state;
        return clip;
      }),
    [source],
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
    for (const name of STATES) actions[name]?.reset().play();
  }, [scene, actions]);

  useFrame((_, dt) => {
    const target = blendWeights(motion.speed);
    const w = weights.current;

    for (const name of STATES) {
      w[name] = damp(w[name], target[name], 8, dt); // smooth transitions, no popping
      actions[name]?.setEffectiveWeight(w[name]);
    }

    // Play each clip at the rate that matches ground speed, so the feet don't slide.
    // Clamped so the gait never looks cartoonish.
    if (actions.walk) actions.walk.timeScale = MathUtils.clamp(motion.speed / CLIP_REFERENCE_SPEED.walk, 0.6, 2.0);
    if (actions.run) actions.run.timeScale = MathUtils.clamp(motion.speed / CLIP_REFERENCE_SPEED.run, 0.6, 1.7);

    // Phase lock: while walk and run blend, put run's gait at walk's point in its cycle, so the legs don't ghost.
    if (actions.walk && actions.run && w.walk > 0.01 && w.run > 0.01) {
      const walkDuration = actions.walk.getClip().duration;
      const runDuration = actions.run.getClip().duration;
      actions.run.time = (actions.walk.time / walkDuration) * runDuration;
    }

    if (root.current) root.current.rotation.y = motion.yaw;
  });

  return (
    <group ref={root} position={[0, footOffset, 0]}>
      <primitive object={scene} />
    </group>
  );
}
