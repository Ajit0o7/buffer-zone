import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AVATARS, CAPSULE, CLIP_NAMES, CLIP_REFERENCE_SPEED, HEAD_LOOK, RUN_SPEED, WALK_SPEED } from '../world/config';
import { facingYaw, findClip, retargetClip } from './retarget';
import { damp } from '../utils/math';

const STATES = Object.keys(CLIP_NAMES); // ['idle', 'walk', 'run']
// If a rig's file ships one of these, its first frame is the reference pose for retargeting.
const T_POSE = ['TPose', 'T-Pose', 'tpose', 'bind'];

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

// Scratch objects for the head-look, reused every frame.
const target = new Vector3();
const local = new Vector3();
const euler = new Euler(0, 0, 0, 'YXZ');
const offset = new Quaternion();
const rootQ = new Quaternion();
const rootQInv = new Quaternion();
const worldOffset = new Quaternion();
const boneWorld = new Quaternion();
const parentWorld = new Quaternion();

/** Adds a yaw/pitch (in the avatar's own frame) on top of a bone's animated pose. */
function turnBone(bone, yaw, pitch) {
  if (!bone || (yaw === 0 && pitch === 0)) return;
  offset.setFromEuler(euler.set(pitch, yaw, 0));
  worldOffset.copy(rootQ).multiply(offset).multiply(rootQInv); // avatar-space rotation, expressed in world space
  bone.getWorldQuaternion(boneWorld).premultiply(worldOffset);
  bone.parent.getWorldQuaternion(parentWorld);
  bone.quaternion.copy(parentWorld.invert().multiply(boneWorld));
}

const findBone = (root, name) => {
  let found = null;
  root.traverse((o) => {
    if (!found && o.isBone && o.name.replace(/^mixamorig[:_]?/, '') === name) found = o;
  });
  return found;
};

/**
 * @param id         avatar key in AVATARS (boy | girl)
 * @param motion     object with { speed, yaw }, read every frame (never via React state)
 * @param lookAt     optional { position: Vector3, known: boolean }: the partner's capsule centre
 * @param footOffset vertical offset so the model's feet sit on the physics capsule's base
 */
export default function Avatar({ id, motion, lookAt = null, footOffset = 0 }) {
  const root = useRef();
  const config = AVATARS[id];
  const gltf = useGLTF(config.url);
  const source = useGLTF(config.clipSource);

  // A skeleton-aware clone, so the same model file could appear twice without sharing bones.
  const scene = useMemo(() => cloneSkinned(gltf.scene), [gltf.scene]);

  // Same rig as the clips: use them as they are. A different rig: retarget by bone name.
  const clips = useMemo(() => {
    const sameRig = config.clipSource === config.url;
    return STATES.map((state) => {
      const clip = findClip(source.animations, CLIP_NAMES[state]);
      if (!clip) throw new Error(`No "${state}" clip in ${config.clipSource}`);
      if (sameRig) {
        const own = clip.clone();
        own.name = state;
        return own;
      }
      return retargetClip(clip, scene, source.scene, {
        name: state,
        targetRest: findClip(gltf.animations, T_POSE),
        sourceRest: findClip(source.animations, T_POSE),
      });
    });
  }, [source, scene, gltf.animations, config.clipSource, config.url]);

  const { actions } = useAnimations(clips, root);
  const weights = useRef({ idle: 1, walk: 0, run: 0 });
  const look = useRef({ yaw: 0, pitch: 0 });
  const bones = useMemo(() => ({ neck: findBone(scene, 'Neck'), head: findBone(scene, 'Head') }), [scene]);
  // Some exports face -Z; turn them so every avatar faces +Z, the direction motion.yaw assumes.
  const nativeYaw = useMemo(() => facingYaw(scene), [scene]);

  useEffect(() => {
    scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        obj.frustumCulled = false; // skinned bounds don't follow the animation; avoid popping at screen edges
      }
    });
    // Start every clip playing; the weights decide what the viewer actually sees.
    for (const name of STATES) actions[name]?.reset().play();
  }, [scene, actions]);

  // Runs after useAnimations' mixer update (it was registered first), so the head-look is layered
  // on top of this frame's animated pose and never accumulates.
  useFrame((_, dt) => {
    const targetW = blendWeights(motion.speed);
    const w = weights.current;
    for (const name of STATES) {
      w[name] = damp(w[name], targetW[name], 8, dt); // smooth transitions, no popping
      actions[name]?.setEffectiveWeight(w[name]);
    }

    // Play each clip at the rate that matches ground speed, so the feet don't slide.
    const ref = config.clipSpeed ?? CLIP_REFERENCE_SPEED;
    if (actions.walk) actions.walk.timeScale = MathUtils.clamp(motion.speed / ref.walk, 0.6, 2.0);
    if (actions.run) actions.run.timeScale = MathUtils.clamp(motion.speed / ref.run, 0.6, 1.7);

    // Phase lock: while walk and run blend, put run's gait at walk's point in its cycle, so the legs don't ghost.
    if (actions.walk && actions.run && w.walk > 0.01 && w.run > 0.01) {
      const walkDuration = actions.walk.getClip().duration;
      const runDuration = actions.run.getClip().duration;
      actions.run.time = (actions.walk.time / walkDuration) * runDuration;
    }

    const r = root.current;
    if (!r) return;
    r.rotation.y = motion.yaw;

    // Head-look: when the partner is close and roughly in front, ease the head toward their eyes.
    let goalYaw = 0;
    let goalPitch = 0;
    if (lookAt?.known && bones.head) {
      target.copy(lookAt.position);
      target.y += HEAD_LOOK.eyeHeight - CAPSULE.center; // capsule centre -> eye height
      local.copy(target);
      r.worldToLocal(local); // avatar space: feet at the origin, facing +Z
      const horizontal = Math.hypot(local.x, local.z);
      const yaw = Math.atan2(local.x, local.z);
      if (horizontal < HEAD_LOOK.radius && Math.abs(yaw) < HEAD_LOOK.maxYaw + 0.5) {
        goalYaw = MathUtils.clamp(yaw, -HEAD_LOOK.maxYaw, HEAD_LOOK.maxYaw);
        goalPitch = MathUtils.clamp(-Math.atan2(local.y - HEAD_LOOK.eyeHeight, horizontal), -HEAD_LOOK.maxPitch, HEAD_LOOK.maxPitch);
      }
    }
    const l = look.current;
    l.yaw = damp(l.yaw, goalYaw, 4, dt);
    l.pitch = damp(l.pitch, goalPitch, 4, dt);
    if (Math.abs(l.yaw) > 1e-3 || Math.abs(l.pitch) > 1e-3) {
      r.getWorldQuaternion(rootQ);
      rootQInv.copy(rootQ).invert();
      turnBone(bones.neck, l.yaw * 0.4, l.pitch * 0.4); // the neck takes some of the turn...
      turnBone(bones.head, l.yaw * 0.6, l.pitch * 0.6); // ...the head the rest, so it doesn't look robotic
    }
  });

  return (
    <group ref={root} position={[0, footOffset, 0]}>
      <group rotation-y={-nativeYaw}>
        <primitive object={scene} />
      </group>
    </group>
  );
}
