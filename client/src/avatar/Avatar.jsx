import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AVATARS, CAPSULE, CLIP_NAMES, CLIP_REFERENCE_SPEED, HEAD_LOOK, RUN_SPEED, WALK_SPEED } from '../world/config';
import { facingYaw, findClip, retargetClip } from './retarget';
import { damp } from '../utils/math';
import { pushStep } from '../world/footsteps';
import { measureContacts, measureSeated } from './contacts';
import { createCoupleLayer } from './couplePose';
import { EXTRA_CLIPS } from './emotes';
import { sitFits } from '../world/couple';

const STATES = Object.keys(CLIP_NAMES); // ['idle', 'walk', 'run']
const GAITS = ['walk', 'run'];
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
 * @param own        true for the local player's avatar (softens its footsteps; takes its own emotes)
 * @param holdHand   { active, side: 'Left' | 'Right', other: Vector3 | null }, read each frame: when active, this
 *                   avatar's arm on `side` reaches for the middle between itself and `other` (walking together)
 */
export default function Avatar({ id, motion, lookAt = null, footOffset = 0, own = false, holdHand = null }) {
  const root = useRef();
  const config = AVATARS[id];
  const gltf = useGLTF(config.url);
  const source = useGLTF(config.clipSource);

  // A skeleton-aware clone, so the same model file could appear twice without sharing bones.
  const scene = useMemo(() => cloneSkinned(gltf.scene), [gltf.scene]);

  // Same rig as the clips: use them as they are. A different rig: retarget by bone name.
  const clips = useMemo(() => {
    const sameRig = config.clipSource === config.url;
    const make = (state, names) => {
      const clip = findClip(source.animations, names);
      if (!clip) return null;
      if (sameRig) {
        const copy = clip.clone();
        copy.name = state;
        return copy;
      }
      return retargetClip(clip, scene, source.scene, {
        name: state,
        targetRest: findClip(gltf.animations, T_POSE),
        sourceRest: findClip(source.animations, T_POSE),
      });
    };
    const base = STATES.map((state) => {
      const clip = make(state, CLIP_NAMES[state]);
      if (!clip) throw new Error(`No "${state}" clip in ${config.clipSource}`);
      return clip;
    });
    // Emotes and sitting are optional extras: an avatar file without them just doesn't do them.
    const extras = EXTRA_CLIPS.map((name) => make(name, [name])).filter(Boolean);
    return [...base, ...extras];
  }, [source, scene, gltf.animations, config.clipSource, config.url]);

  const { actions } = useAnimations(clips, root);
  const weights = useRef({ idle: 1, walk: 0, run: 0 });
  const lastScale = useRef({ walk: 1, run: 1 }); // the playback rate the mixer used for the frame just advanced
  const look = useRef({ yaw: 0, pitch: 0 });
  const bones = useMemo(() => ({ neck: findBone(scene, 'Neck'), head: findBone(scene, 'Head') }), [scene]);

  // Footsteps: when, in each gait's cycle, each foot lands. Measured once on a throwaway copy of the character.
  const contacts = useMemo(() => {
    const out = {};
    for (const [k, state] of STATES.entries()) {
      if (!GAITS.includes(state)) continue;
      out[state] = measureContacts(cloneSkinned(gltf.scene), clips[k]);
    }
    return out;
  }, [gltf.scene, clips]);
  const feet = useMemo(() => ['LeftFoot', 'RightFoot'].map((name) => findBone(scene, name)), [scene]);

  // Where this avatar's pelvis sits when seated, so a seat can place it (see world/seats.js).
  useEffect(() => {
    const sit = clips.find((c) => c.name === 'sit');
    if (!sit || sitFits[id]) return;
    const copy = cloneSkinned(gltf.scene);
    sitFits[id] = measureSeated(copy, sit, facingYaw(copy));
  }, [clips, gltf.scene, id]);

  // Emotes, sitting and hand-holding, layered on the locomotion (avatar/couplePose.js).
  const layer = useMemo(() => {
    const names = ['Head', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand'];
    return createCoupleLayer({ actions, own, bones: Object.fromEntries(names.map((n) => [n, findBone(scene, n)])) });
  }, [actions, scene, own]);
  const footWorld = useMemo(() => new Vector3(), []);
  const rootWorld = useMemo(() => new Vector3(), []);

  /**
   * Fires a step for every contact the gait's cycle passed since the last frame. It works from how far the
   * animation advanced (its speed and the frame time), so a slow frame passes several contacts at once and
   * none are missed; each lands at the right spot in the stride.
   */
  function detectSteps(dt) {
    const w = weights.current;
    const state = w.run > w.walk ? 'run' : 'walk';
    const action = actions[state];
    const list = contacts[state];
    if (!action || !list?.length || w[state] < 0.4) return;
    const duration = action.getClip().duration;
    const end = action.time / duration; // phase now, 0..1 (the mixer has already advanced it this frame)
    const start = end - Math.min(dt, 2) * lastScale.current[state] / duration; // (a long stall counts at most 2 s of steps)
    for (let loop = Math.floor(start); loop <= Math.floor(end); loop++) {
      for (const c of list) {
        const at = loop + c.phase;
        if (at <= start || at > end) continue;
        const bone = feet[c.foot];
        if (!bone) continue;
        bone.getWorldPosition(footWorld);
        root.current.getWorldPosition(rootWorld);
        pushStep({ x: footWorld.x, y: rootWorld.y, z: footWorld.z, speed: motion.speed, foot: c.foot, own });
        if (import.meta.env.DEV) window.__feetLog?.push([c.foot, +c.phase.toFixed(3), +motion.speed.toFixed(2)]);
      }
    }
  }

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
    const moveScale = layer.step(dt, motion); // less than 1 while sitting or doing a motion-capture emote
    for (const name of STATES) {
      w[name] = damp(w[name], targetW[name], 8, dt); // smooth transitions, no popping
      actions[name]?.setEffectiveWeight(w[name] * moveScale);
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

    if (motion.speed > 0.5) detectSteps(dt);
    for (const gait of GAITS) if (actions[gait]) lastScale.current[gait] = actions[gait].timeScale;

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

    layer.pose(dt, r, holdHand, motion); // arm poses on top: hand-holding, kiss, heart
  });

  return (
    <group ref={root} position={[0, footOffset, 0]}>
      <group rotation-y={-nativeYaw}>
        <primitive object={scene} />
      </group>
    </group>
  );
}
