import { AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';

// Mixamo bone names carry a "mixamorig" prefix (three.js drops the ":" when it loads them);
// Ready Player Me and most humanoid exports use the same names without it.
const PREFIX = /^mixamorig[:_]?/;
const normalise = (name) => name.replace(PREFIX, '');
const SAMPLE_FPS = 30;

/** Finds the clip for a state from a list of candidate names, ignoring case. */
export function findClip(animations, candidates) {
  const wanted = candidates.map((c) => c.toLowerCase());
  return animations.find((a) => wanted.includes(a.name.toLowerCase())) ?? null;
}

function boneMap(root) {
  const map = new Map();
  root.traverse((o) => {
    if (o.name) map.set(normalise(o.name), o);
  });
  return map;
}

/**
 * Poses a rig with the first frame of a clip (typically its T-pose) and returns a function that
 * restores the previous pose. Used so both rigs are measured from the same reference pose.
 */
function poseWith(root, clip) {
  if (!clip) return () => {};
  const bones = boneMap(root);
  const saved = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const bone = bones.get(normalise(track.name.slice(0, dot)));
    const property = track.name.slice(dot + 1);
    if (!bone || (property !== 'quaternion' && property !== 'position')) continue;
    saved.push([bone, property, bone[property].clone()]);
    bone[property].fromArray(track.createInterpolant().evaluate(0));
  }
  root.updateMatrixWorld(true);
  return () => {
    for (const [bone, property, value] of saved) bone[property].copy(value);
    root.updateMatrixWorld(true);
  };
}

const UP = new Vector3(0, 1, 0);

/**
 * Which way a rig faces at rest, as a yaw angle (0 = facing +Z). Measured from the hip-width
 * direction (left thigh minus right thigh), which doesn't depend on whether the arms are in a
 * T-pose or an A-pose. Mixamo FBX exports often face -Z; Ready Player Me faces +Z.
 */
export function facingYaw(root) {
  root.updateMatrixWorld(true);
  const bones = boneMap(root);
  const l = bones.get('LeftUpLeg');
  const r = bones.get('RightUpLeg');
  if (!l || !r) return 0;
  const left = l.getWorldPosition(new Vector3()).sub(r.getWorldPosition(new Vector3()));
  return Math.atan2(-left.z, left.x); // facing is the left direction turned 90° about +Y
}

/**
 * The child both bones point at: the first child of the source bone whose name the target bone also
 * has as a child. Rigs hang limbs differently (a 3ds Max Biped parents the thighs to the spine and the
 * collarbones to the neck), so "first child" alone could aim a spine bone at a thigh.
 */
function commonChild(targetBone, sourceBone) {
  const names = new Set(targetBone.children.map((c) => normalise(c.name)));
  const s = sourceBone.children.find((c) => names.has(normalise(c.name)));
  if (!s) return null;
  return [targetBone.children.find((c) => normalise(c.name) === normalise(s.name)), s];
}

/** World-space direction from a bone to one of its children. */
function boneDirection(bone, child) {
  const d = child.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3()));
  return d.lengthSq() > 1e-10 ? d.normalize() : null;
}

/** Depth-first list of an object and its descendants (parents always before children). */
function hierarchy(root) {
  const list = [];
  root.traverse((o) => list.push(o));
  return list;
}

/**
 * Retargets a humanoid clip onto another humanoid rig with the same bone names (with or without the
 * Mixamo prefix), even when the two rigs' rest poses, armature rotation or units differ.
 *
 * The clip is sampled at 30 fps. At each sample, the source skeleton is posed bone by bone in world
 * space; each bone's world-space change from its own rest pose is then applied to the matching
 * target bone's rest pose, and converted back into the target's local space through its (already
 * retargeted) parent. This is what keeps a Ready Player Me spine upright on a Mixamo clip, where a
 * plain copy of local rotations leaves it hunched: their rest orientations differ slightly per bone.
 *
 * Facing and rest pose may differ too. The motion is rotated from the source's facing to the
 * target's, and each target bone's reference is corrected by the rotation that points it the same way
 * as the source bone at rest, so an A-pose rig plays T-pose-referenced clips correctly.
 *
 * Hips translation is carried through both armatures (rotation and unit scale) and rescaled by the
 * ratio of rest hip heights, so a shorter or taller body keeps its feet on the floor. Bones the
 * target lacks are skipped; target bones the clip doesn't drive keep their rest pose.
 *
 * Rest poses: rigs often store an arbitrary pose in their node transforms. When a rig's file ships a
 * T-pose clip, pass it (targetRest / sourceRest) and that pose is used as the reference instead.
 *
 * The source clip and rigs are not modified. Both rigs must not be animated yet.
 */
export function retargetClip(clip, targetRoot, sourceRoot, { name = clip.name, targetRest = null, sourceRest = null } = {}) {
  const restoreTarget = poseWith(targetRoot, targetRest);
  const restoreSource = poseWith(sourceRoot, sourceRest);
  targetRoot.updateMatrixWorld(true);
  sourceRoot.updateMatrixWorld(true);
  const sBones = boneMap(sourceRoot);
  const tBones = boneMap(targetRoot);
  const sHips = sBones.get('Hips');
  const tHips = tBones.get('Hips');
  if (!sHips || !tHips) throw new Error('retargetClip: both rigs need a Hips bone');

  const rotations = new Map(); // normalised bone name -> interpolant
  let hipsPosition = null;
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const node = normalise(track.name.slice(0, dot));
    const property = track.name.slice(dot + 1);
    if (property === 'quaternion') rotations.set(node, track.createInterpolant());
    else if (property === 'position' && node === 'Hips') hipsPosition = track.createInterpolant();
  }

  const sOrder = hierarchy(sHips);
  const tOrder = hierarchy(tHips);

  // Facing: rotate the source's motion so it faces the way the target rig faces.
  const turn = new Quaternion().setFromAxisAngle(UP, facingYaw(targetRoot) - facingYaw(sourceRoot));
  const turnInv = turn.clone().invert();

  // Rest pose: for each target bone, the rotation that would point it like its source bone does at rest.
  const reference = new Map(); // target bone -> corrected rest world rotation
  const restWorld = new Map(); // object -> world rotation at rest
  for (const o of [...sOrder, ...tOrder, sHips.parent, tHips.parent]) restWorld.set(o, o.getWorldQuaternion(new Quaternion()));
  const restWorldInv = new Map([...sOrder].map((o) => [o, restWorld.get(o).clone().invert()]));
  for (const b of tOrder) {
    const sb = sBones.get(normalise(b.name));
    const ref = restWorld.get(b).clone();
    const pair = sb && commonChild(b, sb);
    if (pair) {
      const dt = boneDirection(b, pair[0]);
      const ds = boneDirection(sb, pair[1]);
      if (ds && dt) {
        const align = new Quaternion().setFromUnitVectors(dt, ds.applyQuaternion(turn)); // target rest -> source pose
        ref.premultiply(align);
      }
    }
    reference.set(b, ref);
  }
  const sParentMatrix = sHips.parent.matrixWorld.clone();
  const tParentMatrixInv = tHips.parent.matrixWorld.clone().invert();
  const heightRatio = tHips.getWorldPosition(new Vector3()).y / sHips.getWorldPosition(new Vector3()).y;

  const frames = Math.max(2, Math.ceil(clip.duration * SAMPLE_FPS) + 1);
  const times = new Float32Array(frames);
  const outRotations = new Map(tOrder.map((o) => [o, new Float32Array(frames * 4)]));
  const outHips = new Float32Array(frames * 3);

  const sWorld = new Map();
  const tWorld = new Map();
  const local = new Quaternion();
  const v = new Vector3();

  for (let f = 0; f < frames; f++) {
    const t = Math.min(f / SAMPLE_FPS, clip.duration);
    times[f] = t;

    // Pose the source in world space.
    for (const b of sOrder) {
      const interp = rotations.get(normalise(b.name));
      if (interp) local.fromArray(interp.evaluate(t));
      else local.copy(b.quaternion);
      const parent = b === sHips ? restWorld.get(sHips.parent) : sWorld.get(b.parent);
      sWorld.set(b, (sWorld.get(b) ?? new Quaternion()).copy(parent).multiply(local));
    }

    // Carry each bone's change-from-rest onto the target, parent before child.
    for (const b of tOrder) {
      const sb = sBones.get(normalise(b.name));
      const parentWorld = b === tHips ? restWorld.get(tHips.parent) : tWorld.get(b.parent);
      const w = tWorld.get(b) ?? new Quaternion();
      if (sb && sWorld.has(sb)) {
        // Source change-from-rest, turned to the target's facing, applied to the target's corrected rest.
        w.copy(turn).multiply(sWorld.get(sb)).multiply(restWorldInv.get(sb)).multiply(turnInv).multiply(reference.get(b));
      } else {
        w.copy(parentWorld).multiply(b.quaternion); // not driven by the clip: keep its rest pose
      }
      tWorld.set(b, w);
      local.copy(parentWorld).invert().multiply(w);
      local.toArray(outRotations.get(b), f * 4);
    }

    if (hipsPosition) {
      v.fromArray(hipsPosition.evaluate(t)).applyMatrix4(sParentMatrix).applyQuaternion(turn).multiplyScalar(heightRatio).applyMatrix4(tParentMatrixInv);
    } else {
      v.copy(tHips.position);
    }
    v.toArray(outHips, f * 3);
  }

  restoreTarget();
  restoreSource();
  const tracks = tOrder.map((b) => new QuaternionKeyframeTrack(`${b.name}.quaternion`, times, outRotations.get(b)));
  tracks.push(new VectorKeyframeTrack(`${tHips.name}.position`, times, outHips));
  return new AnimationClip(name, clip.duration, tracks);
}
